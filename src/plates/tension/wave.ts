import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
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
import { FULLSCREEN_VERT, renderFullscreen } from '../../gl/fullscreen';
import waveFrag from '../../shaders/plates/tensionWave.frag.glsl';

/**
 * The filament's transverse displacement (§2 Plate I).
 *
 * A 1-D wave equation on a STATIONS×1 ping-pong target. See
 * tensionWave.frag.glsl for the discretisation; this file owns the numerics
 * that make it stable and the tuning that makes it feel right.
 */

const STATIONS = 512;

/**
 * Courant number C = c·Δt/Δx.
 *
 * The scheme is stable only for C ≤ 1 (the CFL condition) and is *most*
 * accurate near 1 — at C = 1 the discrete solution is exact for the 1-D wave
 * equation, and lower values introduce numerical dispersion, which shows up as
 * a pulse that spreads and softens as it travels instead of holding its shape.
 * A spreading pulse reads as a thread made of rubber rather than fibre.
 *
 * 0.94 rather than 1.0 leaves headroom: the step is driven by a real frame
 * delta, and a frame that runs long would push an exactly-critical scheme over
 * the line and detonate it.
 */
const COURANT = 0.94;

/**
 * γ·Δt. §2 asks for "realistic damping [...] amplitude decays exponentially".
 *
 * 0.0016 gives a pulse that is still visible after about two seconds and gone
 * by four. Below 0.001 the thread rings like a struck wire and never settles,
 * which reads as a bug; above 0.004 the pulse dies before it has crossed the
 * viewport and the thread feels dead rather than damped.
 */
const DAMPING = 0.0016;

/** §2: idle standing wave, amplitude 0.004–0.010 world units, ~0.3 Hz. */
const IDLE_AMPLITUDE = 0.007;
const IDLE_HZ = 0.3;

/**
 * Substeps per frame.
 *
 * The wave equation's timestep is fixed by the Courant number and the station
 * spacing, not by the frame rate — running it once per frame would make the
 * wave speed depend on the display refresh, so the thread would behave
 * differently at 60 and 120 Hz. Two substeps at a fixed dt decouples them.
 */
const SUBSTEPS = 2;

const grabPoint = new Vector2(0.5, 0);

export class TensionWave {
  private readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  private readonly material: ShaderMaterial;
  private index: 0 | 1 = 0;
  private grab = 0;
  readonly type: TextureDataType;

  constructor(gl: WebGLRenderer) {
    const ctx = gl.getContext();
    this.type =
      (ctx.getExtension('EXT_color_buffer_float') ??
      ctx.getExtension('EXT_color_buffer_half_float'))
        ? HalfFloatType
        : UnsignedByteType;

    const make = () =>
      new WebGLRenderTarget(STATIONS, 1, {
        format: RGBAFormat,
        type: this.type,
        // NEAREST for the simulation's own neighbour reads — linear filtering
        // between stations would blur the stencil and damp the wave by an
        // amount that has nothing to do with the damping term.
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        wrapS: ClampToEdgeWrapping,
        wrapT: ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
        colorSpace: NoColorSpace,
      });

    this.targets = [make(), make()];

    this.material = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: waveFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uState: { value: this.targets[1].texture },
        uTouch: { value: null },
        uStations: { value: STATIONS },
        uCourant: { value: COURANT },
        uDamping: { value: DAMPING },
        uTime: { value: 0 },
        uIdleAmplitude: { value: IDLE_AMPLITUDE },
        uIdleHz: { value: IDLE_HZ },
        uGrab: { value: 0 },
        uGrabPoint: { value: grabPoint },
        uFreeze: { value: 0 },
        uRelease: { value: 0 },
      },
    });
  }

  /**
   * The displacement texture the ribbon reads.
   *
   * Sampled with LINEAR by the vertex shader — the ribbon has fewer vertices
   * than the simulation has stations, and interpolating between them is
   * correct there even though it would be wrong inside the solver.
   */
  get texture(): Texture {
    const [a, b] = this.targets;
    const target = this.index === 0 ? a : b;
    target.texture.minFilter = LinearFilter;
    target.texture.magFilter = LinearFilter;
    return target.texture;
  }

  /**
   * Where the pointer is holding the thread.
   * `along` is 0–1 down the filament; `offset` is world-unit displacement.
   */
  setGrab(along: number, offset: number, pressure: number): void {
    grabPoint.set(along, offset);
    this.grab = pressure;
  }

  step(gl: WebGLRenderer, elapsed: number, freeze = false): void {
    const u = this.material.uniforms;
    if (u.uTime) u.uTime.value = elapsed;
    if (u.uGrab) u.uGrab.value = this.grab;
    if (u.uFreeze) u.uFreeze.value = freeze ? 1 : 0;

    for (let i = 0; i < SUBSTEPS; i++) {
      const [a, b] = this.targets;
      const read = this.index === 0 ? a : b;
      const write = this.index === 0 ? b : a;
      if (u.uState) u.uState.value = read.texture;
      // NEAREST while the solver reads it; the getter flips it to LINEAR for
      // the ribbon. Swapping the filter per use is cheaper than a second copy.
      read.texture.minFilter = NearestFilter;
      read.texture.magFilter = NearestFilter;
      renderFullscreen(gl, this.material, write);
      this.index = this.index === 0 ? 1 : 0;
    }
  }

  dispose(): void {
    this.targets[0].dispose();
    this.targets[1].dispose();
    this.material.dispose();
  }
}
