import {
  ClampToEdgeWrapping,
  Color,
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
import compositeFrag from '../shaders/passes/composite.frag.glsl';
import { VOID_HEX } from '../config/identity';

/**
 * The post-processing chain (§7 L1 task 6).
 *
 * At L1 the chain is one pass: tone map, encode, dither, quantise. Bloom joins
 * it in L2 when Plate III has something to bloom, and the dispersion and
 * slit-scan passes in L2/L3. The structure is here now because the *scene* has
 * to render into an HDR buffer from the first frame — retrofitting that later
 * means re-deciding colour management across six plates at once.
 *
 * The scene target is half-float. That is the whole reason this exists rather
 * than letting the renderer encode directly: an 8-bit scene buffer clips
 * everything above 1.0, and §2 Plate III accumulates 16 wavelengths additively
 * into values well above it. Clipping there is what produces the
 * additive-plus-bloom white mush the spec warns about, and no amount of tone
 * mapping afterwards recovers it — the information is already gone.
 */

const resolution = new Vector2();

/*
 * --void, in sRGB. NOT converted to linear: the composite applies it after the
 * encode, because it is an authored page colour rather than a luminance. See
 * the header of composite.frag.glsl.
 */
const voidColour = new Color();
voidColour.setHex(parseInt(VOID_HEX.slice(1), 16), NoColorSpace);

/**
 * §3.4 gives 0.02–0.06 and warns "too much and it reads as a filter".
 *
 * 0.035 was chosen by looking at a dark gradient at DPR 2: below 0.025 the
 * banding in the void is still visible as contour rings, and above 0.05 flat
 * areas start to shimmer at the pixel level rather than reading as paper grain.
 * The measured effect is recorded in docs/verification/banding.json.
 */
const DITHER_STRENGTH = 0.035;

/**
 * Mix of stochastic over ordered. At 0 the pure 8×8 Bayer grid is visible on
 * flat areas; at 1 the printed-plate character is gone and it is just noise.
 */
const BLUE_WEIGHT = 0.35;

export interface CompositeOptions {
  ditherStrength?: number;
  blueWeight?: number;
}

export class Composite {
  private readonly target: WebGLRenderTarget;
  private readonly material: ShaderMaterial;
  readonly type: TextureDataType;

  constructor(gl: WebGLRenderer, width: number, height: number, options: CompositeOptions = {}) {
    const ctx = gl.getContext();
    // Same Safari caveat as the touch field (ADR-0002): half-float rendering
    // needs the extension. Falling back to 8-bit loses HDR headroom, which is
    // a visible downgrade in Plate III rather than a crash.
    this.type =
      (ctx.getExtension('EXT_color_buffer_float') ??
      ctx.getExtension('EXT_color_buffer_half_float'))
        ? HalfFloatType
        : UnsignedByteType;

    this.target = new WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
      format: RGBAFormat,
      type: this.type,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      // The scene pass is linear; the encode happens in the composite shader.
      colorSpace: NoColorSpace,
    });

    this.material = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: compositeFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uScene: { value: this.target.texture },
        uResolution: { value: resolution },
        uDitherStrength: { value: options.ditherStrength ?? DITHER_STRENGTH },
        uBlueWeight: { value: options.blueWeight ?? BLUE_WEIGHT },
        uExposure: { value: 1 },
        uToneMap: { value: 1 },
        uVoid: { value: voidColour },
        uBloom: { value: null },
        uBloomIntensity: { value: 0 },
      },
    });
  }

  /** The HDR buffer the scene renders into. */
  get sceneTarget(): WebGLRenderTarget {
    return this.target;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, width), Math.max(1, height));
  }

  /** Composite the scene buffer, plus bloom, to the canvas. */
  present(gl: WebGLRenderer, bloom: Texture | null, bloomIntensity: number): void {
    resolution.set(this.target.width, this.target.height);
    const u = this.material.uniforms;
    if (u.uBloom) u.uBloom.value = bloom;
    if (u.uBloomIntensity) u.uBloomIntensity.value = bloom ? bloomIntensity : 0;
    renderFullscreen(gl, this.material, null);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
