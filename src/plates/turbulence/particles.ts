import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  HalfFloatType,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';
import { FULLSCREEN_VERT, renderFullscreen } from '../../gl/fullscreen';
import positionFrag from '../../shaders/plates/turbulencePosition.frag.glsl';
import velocityFrag from '../../shaders/plates/turbulenceVelocity.frag.glsl';

/**
 * The GPGPU particle system behind Plate III (§2, §5.4).
 *
 * Position and velocity each live in a ping-pong pair of float render targets,
 * one texel per particle. A step is two fullscreen passes. Nothing about a
 * particle is ever read back to the CPU, and there is no per-particle
 * JavaScript anywhere in the frame — §2 is explicit about that, and it is also
 * the only way half a million particles fit in a frame budget.
 *
 * WHY FLOAT AND NOT HALF-FLOAT
 *
 * The rest of this piece uses half-float targets, which is right for colour.
 * Positions are different. A half-float has about three significant decimal
 * digits, so at a coordinate of 2.0 the spacing between representable values is
 * roughly 0.002 world units — and a particle drifting at 0.3 units per second
 * at 60 fps moves 0.005 units per frame. That is only two representable steps,
 * so slow particles visibly ratchet: they sit still for two frames and jump on
 * the third. Full float is requested for the sim pair and half-float is only
 * accepted as a fallback, where the ratcheting is preferable to not running.
 */

/**
 * The filament the cloud frays from, in world units.
 *
 * Matches Plate I's span and sag, because §2 describes this plate as the *same*
 * filament coming apart — a cloud that fraying from a different line would
 * break the continuity the plate boundary depends on.
 */
export const SOURCE_SPAN = 4.1;
const SPAN = SOURCE_SPAN;
const SAG = 0.42;

/** Half-extent of the box the sim works in. Used to project into the touch field. */
export const BOUNDS = new Vector2(SPAN / 2, 1.2);

export interface ParticleStep {
  dt: number;
  time: number;
  /** 0 during the plate, ramping to 1 through the exit transformation. */
  lattice: number;
  touch: Texture | null;
  octaves: number;
}

export class Particles {
  private position: [WebGLRenderTarget, WebGLRenderTarget];
  private velocity: [WebGLRenderTarget, WebGLRenderTarget];
  private seed: DataTexture;
  private readonly positionMaterial: ShaderMaterial;
  private readonly velocityMaterial: ShaderMaterial;
  private index: 0 | 1 = 0;
  private primed = false;
  readonly type: TextureDataType;
  size: number;

  constructor(gl: WebGLRenderer, size: number) {
    const ctx = gl.getContext();
    this.type = ctx.getExtension('EXT_color_buffer_float') ? FloatType : HalfFloatType;
    this.size = size;

    this.position = [this.makeTarget(size), this.makeTarget(size)];
    this.velocity = [this.makeTarget(size), this.makeTarget(size)];
    this.seed = makeSeedTexture(size);

    const shared = {
      depthTest: false,
      depthWrite: false,
      vertexShader: FULLSCREEN_VERT,
    } as const;

    this.positionMaterial = new ShaderMaterial({
      ...shared,
      fragmentShader: positionFrag,
      uniforms: {
        uPosition: { value: null },
        uVelocity: { value: null },
        uSeed: { value: this.seed },
        uDt: { value: 0 },
        uLife: { value: 5.4 },
        uLattice: { value: 0 },
        uReset: { value: 0 },
      },
    });

    this.velocityMaterial = new ShaderMaterial({
      ...shared,
      fragmentShader: velocityFrag,
      uniforms: {
        uPosition: { value: null },
        uVelocity: { value: null },
        uTouch: { value: null },
        uDt: { value: 0 },
        uTime: { value: 0 },
        /*
         * Eddy size. At 0.9 the largest structures are about the width of the
         * filament's sag, so the fray happens at the scale of the thread rather
         * than at the scale of the viewport — a lower value gives one big slow
         * swirl that carries the whole cloud together and reads as drift.
         */
        uCurlScale: { value: 0.9 },
        uCurlSpeed: { value: 0.42 },
        /*
         * A particle takes about a third of a second to adopt the field. Fully
         * adopting it every frame (a very high value) removes the particle's
         * own inertia, and the cloud stops having the slight lag that makes it
         * read as something being carried rather than something being drawn.
         */
        uAdopt: { value: 3.0 },
        uLattice: { value: 0 },
        /*
         * The lattice fills a rectangle a little narrower than the source
         * filament and about half as tall as the box. Narrower on purpose: the
         * cloth in Plate IV is a bounded piece of fabric, and a lattice that ran
         * to the edges of the frame would have to be shrunk again a plate later.
         */
        uLatticeExtent: { value: new Vector2(3.4, 1.5) },
        uOctaves: { value: 2 },
        uBounds: { value: BOUNDS },
      },
    });
  }

  private makeTarget(size: number): WebGLRenderTarget {
    return new WebGLRenderTarget(size, size, {
      format: RGBAFormat,
      type: this.type,
      // Nearest, always. These textures are addressed one texel per particle;
      // linear filtering would silently average two unrelated particles' state
      // wherever a uv lands off-centre.
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      colorSpace: NoColorSpace,
    });
  }

  /** §5.6: the sim resolution follows the tier. Reallocates; not per frame. */
  setSize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    for (const target of [...this.position, ...this.velocity]) target.dispose();
    this.seed.dispose();
    this.position = [this.makeTarget(size), this.makeTarget(size)];
    this.velocity = [this.makeTarget(size), this.makeTarget(size)];
    this.seed = makeSeedTexture(size);
    if (this.positionMaterial.uniforms.uSeed) {
      this.positionMaterial.uniforms.uSeed.value = this.seed;
    }
    this.primed = false;
  }

  get count(): number {
    return this.size * this.size;
  }

  get seedTexture(): Texture {
    return this.seed;
  }

  get positionTexture(): Texture {
    return this.position[this.index].texture;
  }

  get velocityTexture(): Texture {
    return this.velocity[this.index].texture;
  }

  /**
   * Place every particle on the filament, so the first frame of the plate is a
   * thread rather than a dot at the origin.
   *
   * Uses the position shader with `uReset` held high rather than a dedicated
   * copy pass — the respawn path already writes exactly the seed positions, and
   * a second shader that had to stay in step with it is a second thing to get
   * wrong.
   */
  private prime(gl: WebGLRenderer): void {
    const u = this.positionMaterial.uniforms;
    if (u.uDt) u.uDt.value = 0;
    if (u.uLattice) u.uLattice.value = 0;
    if (u.uReset) u.uReset.value = 1;
    if (u.uVelocity) u.uVelocity.value = this.velocity[0].texture;
    /*
     * The seed texture stands in for the position input here. It is read and
     * then discarded — `uReset` forces the respawn, which overwrites it — but it
     * has to be *something other than the target being written*: sampling a
     * texture that is attached to the current framebuffer is a feedback loop,
     * which WebGL rejects with INVALID_OPERATION and which would leave both
     * position targets at their clear colour.
     */
    if (u.uPosition) u.uPosition.value = this.seed;
    for (const target of this.position) {
      renderFullscreen(gl, this.positionMaterial, target);
    }
    if (u.uReset) u.uReset.value = 0;
    this.primed = true;
  }

  /** One sim step: velocity, then position. Allocates nothing (§5.2). */
  step(gl: WebGLRenderer, options: ParticleStep): void {
    if (!this.primed) this.prime(gl);

    const read = this.index;
    const write: 0 | 1 = this.index === 0 ? 1 : 0;

    const v = this.velocityMaterial.uniforms;
    if (v.uPosition) v.uPosition.value = this.position[read].texture;
    if (v.uVelocity) v.uVelocity.value = this.velocity[read].texture;
    if (v.uTouch) v.uTouch.value = options.touch;
    if (v.uDt) v.uDt.value = options.dt;
    if (v.uTime) v.uTime.value = options.time;
    if (v.uLattice) v.uLattice.value = options.lattice;
    if (v.uOctaves) v.uOctaves.value = options.octaves;
    renderFullscreen(gl, this.velocityMaterial, this.velocity[write]);

    const p = this.positionMaterial.uniforms;
    if (p.uPosition) p.uPosition.value = this.position[read].texture;
    // The velocity just written, not the one just read — a particle should move
    // by the velocity it has now, or the position lags the flow by one frame
    // and fast direction changes leave a visible kink.
    if (p.uVelocity) p.uVelocity.value = this.velocity[write].texture;
    if (p.uDt) p.uDt.value = options.dt;
    if (p.uLattice) p.uLattice.value = options.lattice;
    renderFullscreen(gl, this.positionMaterial, this.position[write]);

    this.index = write;
  }

  dispose(): void {
    for (const target of [...this.position, ...this.velocity]) target.dispose();
    this.seed.dispose();
    this.positionMaterial.dispose();
    this.velocityMaterial.dispose();
  }
}

/**
 * The filament, as a texture.
 *
 * xyz is where a particle is born and returns to; w is its seed, which selects
 * its wavelength and scales its lifetime. Built once on the CPU, which is not a
 * violation of "no CPU-side particle loop" — that rule is about the frame, and
 * this runs at construction.
 *
 * The distribution along the span is uniform in x with a small transverse
 * jitter, so the source reads as a thread with thickness rather than as a
 * mathematical line. The jitter is *not* random per axis: it is a disc, because
 * independent per-axis noise makes a square cross-section, which is visible
 * where the thread is still coherent.
 */
function makeSeedTexture(size: number): DataTexture {
  const count = size * size;
  const data = new Float32Array(count * 4);

  /*
   * A fixed generator rather than Math.random. §0.4 wants the piece
   * reproducible and the media pipeline (§7 L6) captures frames that have to be
   * comparable between runs; a seeded PRNG makes the whole plate deterministic.
   * This is the 32-bit xorshift from Marsaglia 2003.
   */
  let state = 0x9e3779b9;
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 0xffffff) / 0xffffff;
  };

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = (t - 0.5) * SPAN;

    // The catenary Plate I hangs in, so the source is the same curve.
    const sag = -SAG * (1 - 4 * (t - 0.5) * (t - 0.5));

    // Uniform in a disc: sqrt on the radius, or the points bunch at the centre.
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * 0.018;

    const o = i * 4;
    data[o] = x;
    data[o + 1] = sag + Math.sin(angle) * radius;
    data[o + 2] = Math.cos(angle) * radius;
    // Seed in w. Also the initial age: 1 means "due to respawn", which is what
    // `prime` relies on to place every particle on the filament at boot.
    data[o + 3] = random();
  }

  const texture = new DataTexture(data, size, size, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
