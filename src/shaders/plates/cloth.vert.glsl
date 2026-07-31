/*
 * cloth.vert.glsl — the sheet (§2 Plate IV).
 *
 * One vertex per simulation texel. Position comes from the solver's output
 * texture; the normal is derived here from the neighbouring texels rather than
 * being stored, because storing it would mean a fourth target and a fifth pass
 * to fill it, for a value that is three texture fetches to reconstruct.
 *
 * THE NORMAL IS THE WHOLE PLATE
 *
 * §2: "The cloth's normals drive a refraction of a backdrop texture." Everything
 * the visitor sees — where the specimen is legible, where it smears, how the
 * fold catches — is a function of this vector. So it is worth being careful
 * about the edges: a central difference is more accurate than a forward one and
 * costs one extra fetch, but it is wrong at the border where one side does not
 * exist. Falling back to a one-sided difference there keeps the hem from
 * developing a bright rim, which is what a clamped central difference produces
 * (the difference collapses to half its true magnitude and the normal tips
 * toward the viewer).
 */

precision highp float;

uniform sampler2D uPosition;
/** 1 / GRID. */
uniform float uTexel;

attribute vec2 aClothUv;

varying vec3 vNormal;
varying vec2 vClothUv;
/** View-space depth, for the falloff that keeps the far edge from glaring. */
varying float vDepth;

vec3 sampleAt(vec2 uv) {
  return texture2D(uPosition, clamp(uv, 0.0, 1.0)).xyz;
}

void main() {
  vec3 here = texture2D(uPosition, aClothUv).xyz;

  /*
   * The difference is taken over *four* texels, not one.
   *
   * A one-texel central difference reports the surface's slope including
   * whatever the solver left ringing at texel scale, and the refraction turns
   * that into colour: at a one-texel stencil this plate rendered as oil-slick
   * iridescence, with adjacent pixels sampling wildly different parts of the
   * specimen. The photograph stopped being legible, which is the one thing §2
   * asks of it.
   *
   * Widening the stencil is a low-pass filter on the normal. It is the *shape*
   * of the sheet that should refract — a fold, a sag, the twist across the
   * middle — not the sub-millimetre noise of a Jacobi solver that has not fully
   * converged. Four texels is about the scale of a fold at this grid.
   */
  const float SPAN = 2.0;
  vec2 du = vec2(uTexel * SPAN, 0.0);
  vec2 dv = vec2(0.0, uTexel * SPAN);

  vec3 right = sampleAt(aClothUv + du);
  vec3 left = sampleAt(aClothUv - du);
  vec3 up = sampleAt(aClothUv + dv);
  vec3 down = sampleAt(aClothUv - dv);

  float edge = uTexel * SPAN;
  vec3 tangentU = aClothUv.x <= edge ? right - here
    : aClothUv.x >= 1.0 - edge ? here - left
    : right - left;
  vec3 tangentV = aClothUv.y <= edge ? up - here
    : aClothUv.y >= 1.0 - edge ? here - down
    : up - down;

  vec3 normal = cross(tangentU, tangentV);
  float len = length(normal);
  // A degenerate cross product means the two tangents are parallel, which can
  // happen for a frame where the solver has collapsed a row. Facing the camera
  // is the least wrong answer and does not produce a NaN that would poison the
  // refraction.
  vNormal = len > 1e-8 ? normal / len : vec3(0.0, 0.0, 1.0);

  vClothUv = aClothUv;

  vec4 view = modelViewMatrix * vec4(here, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
