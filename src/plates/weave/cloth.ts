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
  Vector4,
  WebGLRenderTarget,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';
import { FULLSCREEN_VERT, renderFullscreen } from '../../gl/fullscreen';
import integrateFrag from '../../shaders/plates/clothIntegrate.frag.glsl';
import constrainFrag from '../../shaders/plates/clothConstrain.frag.glsl';

/**
 * The GPU cloth behind Plate IV (§2, §5.4).
 *
 * A Verlet integration followed by a fixed number of Jacobi relaxation passes,
 * all in fragment shaders, one texel per vertex. The numerics are documented in
 * the two shaders; this file owns the target layout and the reason for it.
 *
 * FOUR TARGETS, NOT TWO
 *
 * Verlet needs the last two positions, so the history alone is a ping-pong
 * pair. The constraint solver then needs somewhere to write, and it cannot
 * write into the buffer it is reading — that is a feedback loop, and WebGL
 * rejects the draw. It also must not write into the *previous* position, which
 * the next frame's integration still needs.
 *
 * So: two targets carry the history and two more are the relaxation pair. The
 * iteration count is forced even so the final result lands back in the buffer
 * the caller reads, with no copy pass at the end.
 */

/** The sheet, in world units. Matches Plate III's lattice, which it grows from. */
export const SHEET = { width: 3.4, height: 1.5 } as const;

/**
 * Corner height of the saddle the rest pose is cut from, world units.
 *
 * NOT decoration. Without out-of-plane shape this plate has no colour at all,
 * and getting it took two attempts, the second of which is the interesting one.
 *
 * A flat sheet pinned at two corners and pulled by in-plane gravity is a
 * degenerate configuration: every force lies in the plane, the solver deforms
 * the sheet within it, and the surface never leaves z = 0. Every normal is then
 * exactly ±z, the tangential component the refraction is driven by is
 * identically zero, and the plate renders as a grey photograph. Raising the
 * refraction strength by 3.5× changed the frame by exactly zero bytes, which is
 * how the degeneracy was found — the measurement was cheaper than the reasoning
 * and it was also the only one of the two that was right.
 *
 * The first fix was a cylindrical bow, and it did nothing, for a reason worth
 * knowing: **a cylinder is developable**. It can be flattened into a plane
 * without changing any distance on the surface, so a solver made entirely of
 * distance constraints is perfectly happy to flatten it, and gravity gives it
 * every reason to. Normals came back at |z| ≈ 1 again.
 *
 * A saddle — a hyperbolic paraboloid, z ∝ (u−½)(v−½) — is doubly curved and has
 * non-zero Gaussian curvature, so by Gauss's Theorema Egregium it *cannot* be
 * flattened without stretching. Distance constraints therefore hold it, and the
 * sheet keeps genuine 3-D shape for the whole plate.
 */
const TWIST = 0.42;

/**
 * Jacobi iterations per frame. §2 gives 8–16.
 *
 * Sixteen — the top of the range — and even by requirement rather than by
 * taste, see the note on the target layout.
 *
 * Twelve was not enough, and the failure mode is worth recording because it does
 * not look like "not enough iterations". Jacobi propagates one cell per pass, so
 * twelve passes carry tension twelve cells into a 64-cell sheet. Hung from a
 * single corner the unsupported region does not sag — it *furls*, collapsing into
 * a rope perhaps two cells across, which from the camera is a diagonal streak
 * about a pixel wide. It reads as a rendering bug rather than as a solver that
 * has run out of passes.
 */
const ITERATIONS = 16;

export interface ClothStep {
  dt: number;
  time: number;
  /** 0 while both corners are held, 1 once every pin has released. */
  pinRelease: number;
  /** World-space sphere collider: xyz centre, w radius. */
  collider: Vector4;
  colliderStrength: number;
}

export class Cloth {
  private history: [WebGLRenderTarget, WebGLRenderTarget];
  private relax: [WebGLRenderTarget, WebGLRenderTarget];
  private rest: DataTexture;
  private readonly integrate: ShaderMaterial;
  private readonly constrain: ShaderMaterial;
  private index: 0 | 1 = 0;
  private primed = false;
  readonly type: TextureDataType;
  grid: number;

  constructor(gl: WebGLRenderer, grid: number) {
    const ctx = gl.getContext();
    // Same reasoning as the particle system: half-float positions ratchet at
    // this world scale, and a cloth that ratchets reads as a bug rather than as
    // a material.
    this.type = ctx.getExtension('EXT_color_buffer_float') ? FloatType : HalfFloatType;
    this.grid = grid;

    this.history = [this.makeTarget(grid), this.makeTarget(grid)];
    this.relax = [this.makeTarget(grid), this.makeTarget(grid)];
    this.rest = makeRestTexture(grid);

    const shared = {
      depthTest: false,
      depthWrite: false,
      vertexShader: FULLSCREEN_VERT,
    } as const;

    this.integrate = new ShaderMaterial({
      ...shared,
      fragmentShader: integrateFrag,
      uniforms: {
        uCurrent: { value: null },
        uPrevious: { value: null },
        uRest: { value: this.rest },
        uDt: { value: 0 },
        // Down and slightly back, so the sheet hangs into the frame rather than
        // straight down the picture plane, where its silhouette would be a line.
        /*
         * Gentle. The magnitude that matters is not "how heavy is cloth" but
         * "how far can a vertex fall in one frame relative to what sixteen
         * Jacobi passes can pull back", and at 2.6 the sheet outran the solver
         * and furled into a rope. Slightly back in z as well as down, so the
         * sheet hangs into the frame rather than straight down the picture
         * plane, where its silhouette would be a line.
         */
        uGravity: { value: [0, -0.9, -0.12] },
        uDamping: { value: 0.982 },
        uPinRelease: { value: 0 },
        uTime: { value: 0 },
        /*
         * Large, because it is an acceleration and the step is 1/60 s: the
         * per-frame displacement is uWind·dt², so 0.55 moved a vertex 0.15 mm a
         * frame and settled at under a hundredth of a world unit. The sheet did
         * not breathe at all. 8 gives a ripple of a few centimetres against a
         * 1.5-unit sheet, which is visible in the normals without the cloth
         * flapping.
         */
        uWind: { value: 8.0 },
      },
    });

    this.constrain = new ShaderMaterial({
      ...shared,
      fragmentShader: constrainFrag,
      uniforms: {
        uPosition: { value: null },
        uRest: { value: this.rest },
        uTexel: { value: 1 / grid },
        uStructural: { value: 1.0 },
        uShear: { value: 0.7 },
        // Weakest by an order of magnitude. See the shader header: at parity
        // with structural the sheet becomes a board.
        uBend: { value: 0.13 },
        uPinRelease: { value: 0 },
        // Texel centres of the two pinned corners, matching makeRestTexture.
        uPinA: { value: new Vector2(0.5 / grid, (grid - 0.5) / grid) },
        uPinB: { value: new Vector2((grid - 0.5) / grid, (grid - 0.5) / grid) },
        uCollider: { value: new Vector4(0, 0, 0, 0.12) },
        uColliderStrength: { value: 0 },
      },
    });
  }

  private makeTarget(grid: number): WebGLRenderTarget {
    return new WebGLRenderTarget(grid, grid, {
      format: RGBAFormat,
      type: this.type,
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

  /** §5.6: the grid follows the tier. Reallocates; never per frame. */
  setGrid(grid: number): void {
    if (grid === this.grid || grid <= 0) return;
    this.grid = grid;
    for (const target of [...this.history, ...this.relax]) target.dispose();
    this.rest.dispose();
    this.history = [this.makeTarget(grid), this.makeTarget(grid)];
    this.relax = [this.makeTarget(grid), this.makeTarget(grid)];
    this.rest = makeRestTexture(grid);
    if (this.integrate.uniforms.uRest) this.integrate.uniforms.uRest.value = this.rest;
    if (this.constrain.uniforms.uRest) this.constrain.uniforms.uRest.value = this.rest;
    if (this.constrain.uniforms.uTexel) this.constrain.uniforms.uTexel.value = 1 / grid;
    if (this.constrain.uniforms.uPinA) {
      (this.constrain.uniforms.uPinA.value as Vector2).set(0.5 / grid, (grid - 0.5) / grid);
    }
    if (this.constrain.uniforms.uPinB) {
      (this.constrain.uniforms.uPinB.value as Vector2).set((grid - 0.5) / grid, (grid - 0.5) / grid);
    }
    this.primed = false;
  }

  get positionTexture(): Texture {
    return this.history[this.index].texture;
  }

  get restTexture(): Texture {
    return this.rest;
  }

  /**
   * Fill both history buffers with the rest pose, so the first integration sees
   * zero velocity — `current − previous` is exactly zero — and the sheet starts
   * flat rather than snapping from the origin.
   *
   * Done with the constraint shader at `uPinRelease` = 0 rather than a copy
   * pass, because a pinned vertex returns its rest position unchanged and, on
   * the very first call, every vertex reads a cleared buffer whose constraint
   * corrections are all zero. Both branches therefore write the rest pose.
   */
  private prime(gl: WebGLRenderer): void {
    const u = this.constrain.uniforms;
    if (u.uPinRelease) u.uPinRelease.value = -1e9; // everything held
    if (u.uColliderStrength) u.uColliderStrength.value = 0;
    // The rest texture stands in for the position input: reading the target
    // being written is a feedback loop, and this branch ignores the value.
    if (u.uPosition) u.uPosition.value = this.rest;
    for (const target of this.history) renderFullscreen(gl, this.constrain, target);
    if (u.uPinRelease) u.uPinRelease.value = 0;
    this.primed = true;
  }

  /** One frame: integrate, then relax. Allocates nothing (§5.2). */
  step(gl: WebGLRenderer, options: ClothStep): void {
    if (!this.primed) this.prime(gl);

    const current = this.index;
    const previous: 0 | 1 = current === 0 ? 1 : 0;

    const i = this.integrate.uniforms;
    if (i.uCurrent) i.uCurrent.value = this.history[current].texture;
    if (i.uPrevious) i.uPrevious.value = this.history[previous].texture;
    if (i.uDt) i.uDt.value = options.dt;
    if (i.uPinRelease) i.uPinRelease.value = options.pinRelease;
    if (i.uTime) i.uTime.value = options.time;

    /*
     * The integration writes into the *previous* buffer. After the swap below
     * it holds x(n+1) and the other holds x(n), which is exactly the history
     * the next frame needs — the Verlet ping-pong falls out of the write target
     * rather than needing a copy.
     */
    renderFullscreen(gl, this.integrate, this.history[previous]);

    const c = this.constrain.uniforms;
    if (c.uPinRelease) c.uPinRelease.value = options.pinRelease;
    if (c.uCollider) c.uCollider.value = options.collider;
    if (c.uColliderStrength) c.uColliderStrength.value = options.colliderStrength;

    /*
     * Relaxation, ping-ponging between the freshly integrated buffer and a
     * scratch target. ITERATIONS is even, so the last pass lands back in
     * history[previous] and the swap below is all that is left to do.
     */
    let source = this.history[previous];
    let destination = this.relax[0];
    for (let n = 0; n < ITERATIONS; n++) {
      if (c.uPosition) c.uPosition.value = source.texture;
      renderFullscreen(gl, this.constrain, destination);
      const next = source;
      source = destination;
      destination = next;
    }

    this.index = previous;
  }

  dispose(): void {
    for (const target of [...this.history, ...this.relax]) target.dispose();
    this.rest.dispose();
    this.integrate.dispose();
    this.constrain.dispose();
  }
}

/**
 * The rest pose: a flat sheet, plus each vertex's pin threshold in `w`.
 *
 * THE PIN ENCODING
 *
 * The shaders hold a vertex while `rest.w >= uPinRelease`. So:
 *
 *   −1     never pinned. `uPinRelease` starts at 0, so this is already released.
 *   0.35   the first corner. Lets go a third of the way through the plate.
 *   0.75   the second corner.
 *
 * Two thresholds rather than one because §2 says "pins release as the plate
 * progresses", plural and gradual. Dropping both at once makes the sheet fall
 * straight down and read as a curtain; releasing one and then the other makes
 * it swing through an arc, which is the motion that shows it is simulated.
 */
function makeRestTexture(grid: number): DataTexture {
  const data = new Float32Array(grid * grid * 4);

  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const u = grid > 1 ? x / (grid - 1) : 0.5;
      const v = grid > 1 ? y / (grid - 1) : 0.5;
      const o = (y * grid + x) * 4;

      data[o] = (u - 0.5) * SHEET.width;
      data[o + 1] = (v - 0.5) * SHEET.height;
      // The saddle. Corners reach ±TWIST; the centre and the mid-edges sit at
      // zero, so the silhouette is barely changed and the curvature is all
      // interior.
      data[o + 2] = (u - 0.5) * (v - 0.5) * 4 * TWIST;
      data[o + 3] = -1;
    }
  }

  const topLeft = ((grid - 1) * grid + 0) * 4 + 3;
  const topRight = ((grid - 1) * grid + (grid - 1)) * 4 + 3;
  /*
   * Late, and staggered. §2 says "pins release as the plate progresses", and the
   * readable state of this plate is the one where the sheet is *held* — a
   * catenary surface under tension, with the specimen distorted across it. Once
   * the last pin lets go the cloth is in free fall and there is nothing to see
   * but it leaving the frame, so that is the last beat of the plate rather than
   * the middle of it.
   */
  data[topLeft] = 0.88;
  data[topRight] = 0.62;

  const texture = new DataTexture(data, grid, grid, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
