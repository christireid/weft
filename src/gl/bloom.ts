import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { FULLSCREEN_VERT, renderFullscreen } from './fullscreen';
import bloomFrag from '../shaders/passes/bloom.frag.glsl';

/**
 * Bloom (§2, §5.6 — full post on tier 1, bloom + dither on tier 2).
 *
 * Extract at half resolution, then blur at successively halved resolutions and
 * add the levels back together. Three levels, so the widest reach is 8× the
 * texel size of the scene while the widest blur runs over 1/64 of the pixels.
 *
 * WHY THIS AND NOT A BIG SINGLE BLUR
 *
 * A filament two pixels wide needs a very wide kernel before its glow reads as
 * light rather than as a slightly soft line, and a wide gaussian at full
 * resolution is unaffordable. A mip chain gets the reach for almost nothing:
 * each level costs a quarter of the one above, so the whole pyramid is about
 * a third of the cost of the first level alone. It also gives a more natural
 * falloff than one kernel — bright cores get a tight halo *and* a broad one,
 * which is what a real lens does.
 *
 * The luminance cap that keeps additive geometry from turning the frame to
 * white mush is applied at extraction, before any blur. See the header of
 * bloom.frag.glsl; §2 is explicit that it belongs there and not after.
 */

/** Levels in the pyramid. Three reaches wide enough at 2880×1800. */
const LEVELS = 3;

/**
 * Luminance below which a fragment contributes nothing.
 *
 * Set just above the composite's void floor so the background — which carries
 * the dither's structured noise — never blooms. Bloom on the dither would turn
 * §3.4's halftone into a grey haze and undo the one thing it exists for.
 */
const THRESHOLD = 0.55;

/** See bloom.frag.glsl. Nothing may contribute more than this to its neighbours. */
const CAP = 6.0;

/** How much of the pyramid reaches the final image. Tuned by looking. */
const INTENSITY = 0.62;

const texel = new Vector2();
const horizontal = new Vector2(1, 0);
const vertical = new Vector2(0, 1);

export class Bloom {
  private readonly levels: WebGLRenderTarget[] = [];
  /** Scratch targets for the second axis of each separable blur. */
  private readonly scratch: WebGLRenderTarget[] = [];
  private readonly material: ShaderMaterial;
  /** Same shader, additively blended, for folding coarse levels into fine. */
  private readonly combine: ShaderMaterial;
  private enabled = true;

  constructor(gl: WebGLRenderer, width: number, height: number) {
    const ctx = gl.getContext();
    const type =
      (ctx.getExtension('EXT_color_buffer_float') ??
      ctx.getExtension('EXT_color_buffer_half_float'))
        ? HalfFloatType
        : UnsignedByteType;

    const make = (w: number, h: number) =>
      new WebGLRenderTarget(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)), {
        format: RGBAFormat,
        type,
        // Linear filtering is what lets the upsample blend levels smoothly
        // rather than showing the lower level's texel grid.
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        wrapS: ClampToEdgeWrapping,
        wrapT: ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
        colorSpace: NoColorSpace,
      });

    for (let i = 0; i < LEVELS; i++) {
      const divisor = 2 ** (i + 1);
      this.levels.push(make(width / divisor, height / divisor));
      this.scratch.push(make(width / divisor, height / divisor));
    }

    this.material = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: bloomFrag,
      depthTest: false,
      depthWrite: false,
      // Levels are accumulated by additive blending rather than by a
      // combine shader with N samplers — one fewer program, and it scales if
      // LEVELS changes.
      uniforms: {
        uSource: { value: null },
        uTexel: { value: texel },
        uDirection: { value: horizontal },
        uThreshold: { value: THRESHOLD },
        uCap: { value: CAP },
        uMode: { value: 0 },
      },
    });

    this.combine = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: bloomFrag,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // Additive, so upsampling a coarse level *adds* its broad halo to the
      // finer one instead of replacing it. Without this the pyramid collapses
      // to whichever level was written last and the whole point is lost.
      blending: AdditiveBlending,
      uniforms: {
        uSource: { value: null },
        uTexel: { value: texel },
        uDirection: { value: horizontal },
        uThreshold: { value: THRESHOLD },
        uCap: { value: CAP },
        uMode: { value: 1 },
      },
    });
  }

  setSize(width: number, height: number): void {
    for (let i = 0; i < LEVELS; i++) {
      const divisor = 2 ** (i + 1);
      const w = Math.max(1, Math.floor(width / divisor));
      const h = Math.max(1, Math.floor(height / divisor));
      this.levels[i]?.setSize(w, h);
      this.scratch[i]?.setSize(w, h);
    }
  }

  /** §5.6: tier 3 is dither only. */
  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get intensity(): number {
    return this.enabled ? INTENSITY : 0;
  }

  /** The brightest level, which the composite samples. */
  get texture(): Texture | null {
    return this.enabled ? (this.levels[0]?.texture ?? null) : null;
  }

  /**
   * Build the pyramid from `source`. Called from the frame loop after the scene
   * has rendered and before the composite presents.
   */
  render(gl: WebGLRenderer, source: Texture): void {
    if (!this.enabled) return;
    const u = this.material.uniforms;

    let input = source;
    for (let i = 0; i < LEVELS; i++) {
      const level = this.levels[i];
      const scratchLevel = this.scratch[i];
      if (!level || !scratchLevel) continue;

      // Extract from the scene for level 0; downsample the previous level after.
      if (u.uMode) u.uMode.value = i === 0 ? 0 : 1;
      if (u.uSource) u.uSource.value = input;
      texel.set(1 / level.width, 1 / level.height);
      if (u.uDirection) u.uDirection.value = horizontal;
      renderFullscreen(gl, this.material, scratchLevel);

      // Second axis of the separable blur.
      if (u.uMode) u.uMode.value = 1;
      if (u.uSource) u.uSource.value = scratchLevel.texture;
      if (u.uDirection) u.uDirection.value = vertical;
      renderFullscreen(gl, this.material, level);

      input = level.texture;
    }

    /*
     * Fold coarse levels into fine, so the composite samples one texture.
     * Additively, from the widest level down — each one contributes its broad
     * halo on top of the tighter ones already there, which is the shape a lens
     * actually produces: a bright core with a tight ring and a soft field.
     */
    const c = this.combine.uniforms;
    for (let i = LEVELS - 1; i > 0; i--) {
      const coarse = this.levels[i];
      const finer = this.levels[i - 1];
      if (!coarse || !finer) continue;
      if (c.uSource) c.uSource.value = coarse.texture;
      texel.set(1 / finer.width, 1 / finer.height);
      if (c.uDirection) c.uDirection.value = horizontal;
      renderFullscreen(gl, this.combine, finer, { accumulate: true });
    }
  }

  dispose(): void {
    for (const target of this.levels) target.dispose();
    for (const target of this.scratch) target.dispose();
    this.material.dispose();
    this.combine.dispose();
  }
}
