import {
  ClampToEdgeWrapping,
  FloatType,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';
import { FULLSCREEN_VERT, renderFullscreen } from './fullscreen';
import touchFrag from '../shaders/passes/touch.frag.glsl';

/**
 * The shared pointer field (§5.3, ADR-0002).
 *
 * One 256×256 ping-pong target holding pointer influence in screen space:
 * velocity in RG, pressure in B, age in A. Written once per frame, sampled by
 * every plate.
 *
 * Building this once and reusing it six times is the decision that makes the
 * piece both coherent and affordable — coherent because the pointer behaves
 * like one physical thing across six different materials rather than six
 * different event handlers that happen to be attached to the same mouse, and
 * affordable because the cost is one 256² pass per frame regardless of how many
 * plates are live.
 */

const SIZE = 256;

/**
 * §5.3 gives 0.94–0.97. Tuned to 0.955 by dragging: at 0.94 a fast stroke has
 * already faded by the time the eye follows it, and at 0.97 the trail outlives
 * the gesture and the field reads as smeared rather than responsive.
 * At 60 fps, 0.955 is a half-life of about 15 frames — a quarter of a second.
 */
const DECAY = 0.955;

/** Stamp radius in viewport fractions. Roughly 9% of the short edge. */
const RADIUS = 0.09;

/** Pre-allocated. Nothing in step() constructs anything (§5.2). */
const pointer = new Vector2(0.5, 0.5);
const pointerPrev = new Vector2(0.5, 0.5);
const velocity = new Vector2(0, 0);

export interface TouchFieldOptions {
  /** Half-float is preferred; see the note on Safari in pickType(). */
  type?: TextureDataType;
}

/**
 * Pick a renderable float type.
 *
 * WebGL2 makes RGBA16F color-renderable only when EXT_color_buffer_float (or
 * EXT_color_buffer_half_float) is present. It effectively always is on desktop.
 * Safari has historically been the exception and §7 L5 task 2 warns explicitly
 * that "Safari's float texture and highp behaviour will break something in the
 * GPGPU path" — so the capability is queried rather than assumed, and the
 * unsigned-byte fallback keeps the field working with reduced velocity range
 * instead of producing a black texture and six dead interactions.
 */
function pickType(gl: WebGLRenderer): TextureDataType {
  const ctx = gl.getContext();
  if (ctx.getExtension('EXT_color_buffer_float')) return HalfFloatType;
  if (ctx.getExtension('EXT_color_buffer_half_float')) return HalfFloatType;
  return UnsignedByteType;
}

export class TouchField {
  private readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  private readonly material: ShaderMaterial;
  private index: 0 | 1 = 0;
  private present = 0;
  private pressure = 0;
  private seeded = false;

  readonly type: TextureDataType;

  constructor(gl: WebGLRenderer, options: TouchFieldOptions = {}) {
    this.type = options.type ?? pickType(gl);

    const make = () =>
      new WebGLRenderTarget(SIZE, SIZE, {
        format: RGBAFormat,
        type: this.type,
        // Linear so plates can sample the field at any resolution without
        // seeing the 256² grid.
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        wrapS: ClampToEdgeWrapping,
        wrapT: ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
        // This is data, not colour. Letting three convert it would apply an
        // sRGB transfer function to a velocity.
        colorSpace: NoColorSpace,
      });

    this.targets = [make(), make()];

    this.material = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: touchFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrevious: { value: this.targets[1].texture },
        uPointer: { value: pointer },
        uPointerPrev: { value: pointerPrev },
        uVelocity: { value: velocity },
        uPressure: { value: 0 },
        uPresent: { value: 0 },
        uRadius: { value: RADIUS },
        uDecay: { value: DECAY },
        uAspect: { value: 1 },
      },
    });
  }

  /** The field as of the last step. Bind this into any plate's material. */
  get texture(): Texture {
    const [a, b] = this.targets;
    return (this.index === 0 ? a : b).texture;
  }

  /**
   * Report a pointer position in normalised viewport coordinates, y up.
   * Called from pointer events, not from the frame loop.
   */
  setPointer(x: number, y: number, pressure: number, present: boolean): void {
    if (!this.seeded) {
      // Without this the first move stamps a capsule from (0.5,0.5) to wherever
      // the pointer entered — a stripe across the viewport on the first frame.
      pointerPrev.set(x, y);
      this.seeded = true;
    }
    pointer.set(x, y);
    this.pressure = pressure;
    this.present = present ? 1 : 0;
  }

  /** Pointer left the window. Keeps the trail decaying rather than freezing it. */
  clearPointer(): void {
    this.present = 0;
    this.pressure = 0;
  }

  /**
   * Advance one frame. Called from the single frame loop, before any plate
   * samples the field.
   */
  step(gl: WebGLRenderer, delta: number, aspect: number): void {
    const dt = Math.max(delta, 1e-4);
    velocity.set((pointer.x - pointerPrev.x) / dt, (pointer.y - pointerPrev.y) / dt);

    const u = this.material.uniforms;
    const [a, b] = this.targets;
    const read = this.index === 0 ? a : b;
    const write = this.index === 0 ? b : a;

    if (u.uPrevious) u.uPrevious.value = read.texture;
    if (u.uPressure) u.uPressure.value = this.pressure;
    if (u.uPresent) u.uPresent.value = this.present;
    if (u.uAspect) u.uAspect.value = aspect;

    renderFullscreen(gl, this.material, write);

    this.index = this.index === 0 ? 1 : 0;
    pointerPrev.copy(pointer);
  }

  dispose(): void {
    this.targets[0].dispose();
    this.targets[1].dispose();
    this.material.dispose();
  }

  /** Diagnostics for the L1 debug view and the leak check in the exit gate. */
  get debugInfo(): { size: number; type: string } {
    return {
      size: SIZE,
      type:
        this.type === HalfFloatType
          ? 'HalfFloat'
          : this.type === FloatType
            ? 'Float'
            : 'UnsignedByte',
    };
  }
}
