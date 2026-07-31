/*
 * turbulenceVelocity.frag.glsl — one GPGPU velocity step (§2 Plate III, §5.4).
 *
 * One texel per particle. Reads position and velocity, writes velocity. There
 * is no CPU-side particle loop anywhere in this plate, which §2 requires.
 *
 * THE MODEL
 *
 * A particle in this plate is not integrating forces. It is being *carried* by
 * a field, which is what advection means and what makes the cloud read as fluid
 * rather than as a swarm:
 *
 *   v ← mix(v, target, 1 − exp(−k·Δt))
 *
 * where `target` is the field velocity at the particle's position. The
 * exponential form rather than `mix(v, target, k*Δt)` because the latter is
 * frame-rate dependent — at 30 fps a particle would take twice as long to
 * adopt the field as at 60 — and §5.6 lets the frame rate vary by a factor of
 * four across tiers. This form gives the same trajectory at any Δt.
 *
 * THREE FIELDS SUM HERE, AND THE ORDER MATTERS
 *
 *   1. Curl noise         the flow itself, divergence-free by construction
 *   2. Pointer repulsion  §2: "a repulsor with a soft falloff"
 *   3. Lattice attractor  §2's exit: "the curl decays to zero and a lattice
 *                         attractor engages. Particles fall into rows and
 *                         columns."
 *
 * 1 and 3 cross-fade rather than add. If they were summed the exit would be a
 * fight between a flow and a grid, and the cloud would jitter on the lattice
 * sites instead of settling into them. The repulsor is added on top of both
 * because a visitor pushing the cloud during the exit should still displace it.
 */

precision highp float;

#include "../lib/curl.glsl";

uniform sampler2D uPosition;
uniform sampler2D uVelocity;
/** The shared touch field (§5.3), in viewport uv. */
uniform sampler2D uTouch;

uniform float uDt;
uniform float uTime;
/** Noise-space units per world unit. Sets the eddy size. */
uniform float uCurlScale;
/** World units per second the field carries a particle at. */
uniform float uCurlSpeed;
/** How fast a particle adopts the field, per second. */
uniform float uAdopt;
/** 0 during the plate, ramping to 1 through the exit transformation. */
uniform float uLattice;
/** World-space size of the exit lattice. See the note at its use. */
uniform vec2 uLatticeExtent;
uniform int uOctaves;

/** Half-extent of the plate's world box, for the uv projection below. */
uniform vec2 uBounds;

varying vec2 vUv;

/*
 * Repulsion strength and reach.
 *
 * The reach is generous — a quarter of the box — because the touch field is a
 * soft blob rather than a point, and a repulsor tighter than the blob that
 * drives it produces a hard edge in the flow that reads as a bug. The strength
 * is what stops it being a hole punched in the cloud: strong enough to open a
 * visible wake, weak enough that the curl closes it again within a second.
 */
const float REPULSE_REACH = 0.5;
const float REPULSE_STRENGTH = 2.6;

void main() {
  vec4 position = texture2D(uPosition, vUv);
  vec4 velocity = texture2D(uVelocity, vUv);
  vec3 p = position.xyz;
  vec3 v = velocity.xyz;

  /*
   * The flow. Advancing the sample point along z with time rather than
   * animating a 2-D field: a 3-D field sliced by a moving plane evolves
   * smoothly and never repeats, and it costs nothing over evaluating a static
   * one. The 0.11 is slow — the eddies should drift, not churn.
   */
  vec3 samplePoint = p * uCurlScale + vec3(0.0, 0.0, uTime * 0.11);
  vec3 flow = weftCurlOctaves(samplePoint, uOctaves, 2.03, 0.5) * uCurlSpeed;

  /*
   * The lattice.
   *
   * A particle's site comes from *its own index in the sim texture*, not from
   * the nearest point of a grid. The first version snapped to the nearest site
   * and it did not read as §2's "rows and columns" at all: particles pile onto
   * whichever sites the cloud happened to be dense around and leave the rest of
   * the grid empty, so the exit resolved to a scatter of bright dots.
   *
   * Indexing by vUv gives every particle a distinct site and fills the lattice
   * exactly once — a regular warp and weft, which is both what §2 describes and
   * the state Plate IV's cloth has to start from.
   *
   * The approach is critically damped rather than a spring, so particles arrive
   * and stay instead of overshooting and ringing into place, which would read
   * as a bounce.
   */
  vec3 site = vec3((vUv - 0.5) * uLatticeExtent, 0.0);
  vec3 toSite = (site - p) * 3.0;

  vec3 target = mix(flow, toSite, uLattice);

  /*
   * The pointer, projected. The sim box maps to the viewport linearly, so a
   * particle's uv in the touch field is its xy scaled by the box half-extent.
   * This is an approximation — the camera has perspective and the box has
   * depth, so a particle at the back is repelled by a pointer that is not quite
   * over it. At this depth range the error is under a pixel, and the honest
   * alternative (projecting through the view matrix in the sim step) would put
   * a matrix uniform in a pass that otherwise needs none.
   */
  vec2 touchUv = p.xy / (uBounds * 2.0) + 0.5;
  vec4 touch = texture2D(uTouch, touchUv);
  if (touch.a > 0.001) {
    // The field stores its centre in .xy; direction from it, not from the uv,
    // so the push is radial rather than axis-aligned.
    vec2 away = p.xy - ((touch.xy - 0.5) * uBounds * 2.0);
    float distance = length(away);
    float falloff = 1.0 - smoothstep(0.0, REPULSE_REACH, distance);
    target += vec3(normalize(away + 1e-5) * falloff * REPULSE_STRENGTH * touch.a, 0.0);
  }

  // Frame-rate independent approach. See the header.
  float k = 1.0 - exp(-uAdopt * uDt);
  v = mix(v, target, k);

  gl_FragColor = vec4(v, velocity.w);
}
