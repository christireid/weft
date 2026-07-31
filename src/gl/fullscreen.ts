import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  Scene,
  type Material,
  Vector2,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';

/**
 * Fullscreen pass plumbing, allocated once for the whole application.
 *
 * A *triangle*, not a quad. A quad is two triangles meeting on the screen
 * diagonal, and fragments along that seam are rasterised by both, which both
 * wastes them and can produce a visible hairline in a pass that reads its own
 * derivatives. One oversized triangle covers the viewport with no seam and one
 * fewer vertex. It is the standard trick and it costs nothing to do correctly.
 *
 * Everything here is module scope and created on first use: the geometry, the
 * camera, the scene and the mesh are shared by every pass in the piece. Passes
 * swap the mesh's material and render. Nothing is allocated per frame (§5.2).
 */

let geometry: BufferGeometry | null = null;
let scene: Scene | null = null;
let mesh: Mesh | null = null;

const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

function ensure(): { scene: Scene; mesh: Mesh } {
  if (!geometry) {
    geometry = new BufferGeometry();
    // Clip-space positions covering [-1,1]² and beyond; uv derived so the
    // visible region maps to 0..1.
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  }
  if (!mesh) {
    mesh = new Mesh(geometry);
    mesh.frustumCulled = false;
  }
  if (!scene) {
    scene = new Scene();
    scene.add(mesh);
  }
  return { scene, mesh };
}

/** Vertex shader every fullscreen pass shares. */
export const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Render `material` over `target` (or the canvas when target is null).
 * Restores the renderer's previous target so callers cannot leak state.
 */
export function renderFullscreen(
  gl: WebGLRenderer,
  material: Material,
  target: WebGLRenderTarget | null,
  { accumulate = false }: { accumulate?: boolean } = {},
): void {
  const { scene: s, mesh: m } = ensure();
  const previousTarget = gl.getRenderTarget();
  const previousAutoClear = gl.autoClear;

  /*
   * `accumulate` is for additively-blended passes that must *add to* what is
   * already in the target rather than replace it — the bloom pyramid's combine
   * step, principally.
   *
   * Without it three's `render` auto-clears the target first, so an additive
   * material draws onto an empty buffer and the accumulation silently does
   * nothing. That is exactly how bloom shipped with a correct-looking pyramid
   * and no measurable effect on the frame: coverage moved 5.82% to 5.84%.
   */
  m.material = material;
  if (accumulate) gl.autoClear = false;
  gl.setRenderTarget(target);
  gl.render(s, camera);
  gl.setRenderTarget(previousTarget);
  gl.autoClear = previousAutoClear;
}

/** Scratch for reading the renderer's drawing-buffer size. Module scope (§5.2). */
const sizeScratch = new Vector2();

/**
 * Render `material` into a rectangle of the current target, leaving everything
 * outside it untouched. Used by the L1 debug views to inset an instrument in a
 * corner of the frame without clearing the frame.
 *
 * **Coordinates are CSS pixels, origin bottom-left.** Not device pixels —
 * three's `setViewport`/`setScissor` multiply by the renderer's pixel ratio
 * internally, so passing `canvas.width` (which is already device pixels) sets a
 * viewport twice the size of the canvas. That bug is invisible while the scene
 * is empty, because a clear is bounded by the scissor rather than the viewport,
 * and would have surfaced in L2 as the whole scene rendering at 2× scale.
 */
export function renderFullscreenInset(
  gl: WebGLRenderer,
  material: Material,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const { scene: s, mesh: m } = ensure();

  const previousAutoClear = gl.autoClear;
  const previousScissorTest = gl.getScissorTest();

  m.material = material;
  gl.autoClear = false;
  gl.setViewport(x, y, width, height);
  gl.setScissor(x, y, width, height);
  gl.setScissorTest(true);
  gl.render(s, camera);

  gl.setScissorTest(previousScissorTest);
  gl.autoClear = previousAutoClear;

  // Restore the full viewport for whatever draws next in this frame.
  // getSize reports CSS pixels, which is what setViewport expects.
  gl.getSize(sizeScratch);
  gl.setViewport(0, 0, sizeScratch.x, sizeScratch.y);
  gl.setScissor(0, 0, sizeScratch.x, sizeScratch.y);
}

/** Test seam. Releases the shared geometry; passes own their own materials. */
export function disposeFullscreen(): void {
  geometry?.dispose();
  geometry = null;
  mesh = null;
  scene = null;
}
