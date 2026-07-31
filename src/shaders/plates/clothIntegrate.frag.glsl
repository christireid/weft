/*
 * clothIntegrate.frag.glsl — one Verlet step for the cloth (§2 Plate IV, §5.4).
 *
 * One texel per vertex on a GRID×GRID sheet. Reads the current and previous
 * positions, writes the new current position. The previous-position texture is
 * updated by the caller swapping targets, so no second pass is needed.
 *
 * WHY VERLET AND NOT AN EXPLICIT INTEGRATOR
 *
 * Verlet stores no velocity. Position is advanced from the difference between
 * the last two positions:
 *
 *   xₙ₊₁ = xₙ + (xₙ − xₙ₋₁)·d + a·Δt²
 *
 * which matters here for one specific reason: the constraint solver that runs
 * after this moves vertices directly. With an explicit integrator every such
 * move would have to be paired with a velocity correction or the cloth gains
 * energy and eventually explodes. With Verlet, moving a vertex *is* changing
 * its velocity, consistently and for free. That is the entire reason cloth
 * solvers are written this way and it is why the pins below can simply overwrite
 * a position without any further bookkeeping.
 *
 * The damping `d` is applied to the inertia term rather than as a separate drag
 * force, so it cannot fight the constraint solver.
 */

precision highp float;

uniform sampler2D uCurrent;
uniform sampler2D uPrevious;
/** Rest positions, and the pin weight in .w. See uPinRelease. */
uniform sampler2D uRest;

uniform float uDt;
uniform vec3 uGravity;
/** Fraction of the previous frame's motion carried forward. */
uniform float uDamping;
/**
 * 0 while both corners are held, 1 once every pin has let go.
 *
 * §2: "Pinned at two corners at the start of the plate; pins release as the
 * plate progresses." The rest texture stores each pin's release threshold in
 * .w, so the two corners can let go at different times from one uniform — a
 * sheet that drops both corners at once falls straight down and reads as a
 * curtain, where releasing one and then the other makes it swing.
 */
uniform float uPinRelease;

/** Wind, so the cloth is never perfectly still. §2's plates all breathe. */
uniform float uTime;
uniform float uWind;

varying vec2 vUv;

void main() {
  vec4 current = texture2D(uCurrent, vUv);
  vec3 previous = texture2D(uPrevious, vUv).xyz;
  vec4 rest = texture2D(uRest, vUv);

  vec3 x = current.xyz;

  /*
   * A pinned vertex is not integrated at all. Clamping it after integrating
   * would leave the Verlet history showing motion that did not happen, and the
   * frame after a pin releases the vertex would inherit that phantom velocity
   * and snap.
   */
  float pinned = step(uPinRelease, rest.w);
  if (pinned > 0.5) {
    gl_FragColor = vec4(rest.xyz, current.w);
    return;
  }

  /*
   * Wind: a travelling wave along the sheet rather than a uniform push, so it
   * ripples instead of leaning. Cheap on purpose — the interest in this plate
   * is the constraint solve and the refraction, and a second noise field here
   * would cost more than it shows.
   */
  vec3 acceleration = uGravity;
  acceleration.z += sin(uTime * 1.7 + vUv.x * 9.0 + vUv.y * 3.0) * uWind;

  vec3 inertia = (x - previous) * uDamping;
  vec3 next = x + inertia + acceleration * uDt * uDt;

  gl_FragColor = vec4(next, current.w);
}
