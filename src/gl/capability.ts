/**
 * WebGL2 capability probe.
 *
 * Asked once, before the Canvas mounts. By the time r3f has a renderer the
 * question is already answered — `WebGLRenderer.getContext()` cannot return
 * null, because the renderer would have thrown during construction — so the
 * check has to happen upstream of it.
 *
 * §6.3's presentable static fallback is built in L5. What this does now is
 * stop a device without WebGL2 from throwing during render, which would take
 * the DOM text layer down with it. §6.1 promises a screen-reader user a
 * complete document without a single WebGL frame; that promise has to hold on
 * a browser that cannot draw one either.
 */

let cached: boolean | null = null;

export function hasWebGL2(): boolean {
  if (cached !== null) return cached;
  if (typeof document === 'undefined') {
    cached = false;
    return cached;
  }
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    cached = context !== null;
    // Release the probe context immediately: browsers cap live contexts, and a
    // leaked one here would count against the real canvas.
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}

/** Test seam. */
export function resetCapabilityCache(): void {
  cached = null;
}
