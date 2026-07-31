/*
 * tension.vert.glsl — the screen-facing ribbon (§2 Plate I).
 *
 * §2 is explicit that this is "a screen-facing ribbon (instanced quads oriented
 * to the camera), not THREE.Line — line width must be controllable and the
 * ribbon must taper".
 *
 * Geometry is a strip: two vertices per station, one either side. Attributes
 * carry `aAlong` (0→1 down the thread) and `aSide` (−1/+1). Everything else —
 * the catenary, the wave displacement, the width profile — is computed here.
 *
 * THE SCREEN-SPACE EXPANSION
 *
 * The technique is the one three's LineMaterial uses (RESEARCH.md §1): project
 * the centreline, then displace the corner *after* projection along the
 * screen-space perpendicular of the segment direction, scaled by `clip.w`.
 *
 * That `clip.w` multiply is the whole trick. Without it the ribbon is a
 * constant width in clip space, which means it gets *wider* as it recedes —
 * exactly backwards. With it, the width is constant in *pixels* and the
 * perspective is correct, so the far end of the thread thins as it accelerates
 * toward the vanishing point in the exit transformation.
 *
 * WHAT IS ADDED OVER LineMaterial
 *
 *   taper      width is a per-vertex function of position along the thread,
 *              not a uniform. §2 requires it, and it is what stops the filament
 *              reading as a drawn stroke.
 *   wave       the centreline is displaced by the GPGPU wave texture.
 *   exit       the far end accelerates toward the vanishing point.
 */

precision highp float;

#include "../lib/easing.glsl";

attribute float aAlong;
attribute float aSide;

uniform sampler2D uWave;
uniform vec2 uResolution;
uniform float uWidthPx;      // core width in device pixels
uniform float uSpan;         // half-length in world units
uniform float uSag;          // catenary depth in world units
uniform float uExit;         // 0–1, the exit transformation
uniform float uVanishZ;      // depth the far end accelerates toward

varying float vAlong;
varying float vSide;
varying float vWidthPx;

/*
 * The catenary: y = a·cosh(x/a) − a, the shape a thread takes under its own
 * weight. Normalised so the deepest point is exactly `uSag` below the ends.
 *
 * A parabola would be within a pixel of this at these proportions, and it is
 * what most people reach for. The catenary is used anyway because it costs one
 * `cosh` and because the plate is called TENSIO — the whole conceit is that
 * this is a specimen under load, and the curve a real filament makes under load
 * is this one.
 */
float catenary(float t, float a) {
  float x = (t - 0.5) * 2.0;   // −1 … 1
  float shape = cosh(x / a) - cosh(1.0 / a);
  float depth = cosh(0.0 / a) - cosh(1.0 / a);
  return shape / depth;        // 1 at the centre, 0 at the ends
}

/** Centreline position at `t` along the thread. */
vec3 centreline(float t) {
  float wave = texture2D(uWave, vec2(t, 0.5)).r;

  float x = (t - 0.5) * 2.0 * uSpan;
  float y = -catenary(t, 0.75) * uSag + wave;
  float z = 0.0;

  /*
   * Exit transformation (§2): "the thread's tension releases and it begins to
   * travel — the far end accelerates toward the vanishing point, becoming
   * Plate II's beam."
   *
   * The acceleration is weighted by t², so the near end barely moves while the
   * far end runs away. The sag is released at the same time, because a thread
   * being pulled taut straightens — releasing tension and keeping the curve
   * would read as the thread going slack, which is the opposite of what is
   * happening.
   */
  float pull = uExit * t * t;
  z += pull * uVanishZ;
  y = mix(y, y * (1.0 - uExit * 0.85), t);

  return vec3(x, y, z);
}

/*
 * Width profile.
 *
 * Tapers to nothing at both ends and holds near full width across the middle
 * two thirds. `weftEaseEnter` is used for the shoulder rather than a smoothstep
 * because §5.5 wants one curve family everywhere — the thread's silhouette and
 * a DOM element's entrance are shaped by the same function.
 *
 * The floor of 0.12 keeps the very ends from vanishing into sub-pixel
 * nothingness, where a tapering ribbon starts to sparkle as it crosses the
 * sample grid.
 */
float widthAt(float t) {
  float ends = min(t, 1.0 - t) * 2.0;
  float taper = weftEaseEnter(clamp(ends / 0.35, 0.0, 1.0));
  float profile = mix(0.12, 1.0, taper);

  // The thread thins as it accelerates away — a physical consequence of the
  // clip.w correction rather than an authored effect, amplified slightly here
  // so it reads at speed.
  profile *= 1.0 - uExit * t * 0.5;
  return profile;
}

void main() {
  vAlong = aAlong;
  vSide = aSide;

  float dt = 1.0 / 512.0;
  vec3 here = centreline(aAlong);
  vec3 ahead = centreline(min(aAlong + dt, 1.0));
  vec3 behind = centreline(max(aAlong - dt, 0.0));

  vec4 clipHere = projectionMatrix * modelViewMatrix * vec4(here, 1.0);
  vec4 clipAhead = projectionMatrix * modelViewMatrix * vec4(ahead, 1.0);
  vec4 clipBehind = projectionMatrix * modelViewMatrix * vec4(behind, 1.0);

  // Segment direction in normalised device coordinates, aspect-corrected so the
  // perpendicular is perpendicular *on screen* rather than in clip space.
  float aspect = uResolution.x / uResolution.y;
  vec2 ndcAhead = clipAhead.xy / max(clipAhead.w, 1e-6);
  vec2 ndcBehind = clipBehind.xy / max(clipBehind.w, 1e-6);
  vec2 dir = ndcAhead - ndcBehind;
  dir.x *= aspect;
  dir = normalize(dir + vec2(1e-9, 0.0));

  vec2 offset = vec2(dir.y, -dir.x);
  offset.x /= aspect;

  float widthPx = uWidthPx * widthAt(aAlong);
  vWidthPx = widthPx;

  // Pixels → clip space. The clip.w multiply is what makes the width constant
  // in pixels under perspective; see the header.
  offset *= aSide * widthPx / uResolution.y;
  offset *= clipHere.w;

  clipHere.xy += offset;
  gl_Position = clipHere;
}
