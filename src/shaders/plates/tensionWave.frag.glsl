/*
 * tensionWave.frag.glsl — the filament's transverse displacement (§2 Plate I).
 *
 * A 1-D wave equation solved along the thread, one texel per station:
 *
 *   ∂²u/∂t² = c² ∂²u/∂x² − 2γ ∂u/∂t
 *
 * discretised with a centred second difference in both time and space:
 *
 *   uₙ₊₁ = 2uₙ − uₙ₋₁ + C²(uᵢ₊₁ − 2uᵢ + uᵢ₋₁) − 2γΔt(uₙ − uₙ₋₁)
 *
 * where C = cΔt/Δx is the Courant number.
 *
 * WHY A SIMULATION AND NOT A TWEEN
 *
 * §2 asks for "a travelling wave in both directions with realistic damping.
 * Wave speed is constant; amplitude decays exponentially. The thread must feel
 * like it has mass." Every one of those properties falls out of this equation
 * and none of them falls out of an eased displacement:
 *
 *   - a disturbance splits into two pulses travelling in opposite directions,
 *     because that is what the wave equation does with an initial displacement
 *   - both travel at c regardless of how hard the thread was pulled
 *   - the pulses reflect and invert at the pinned ends
 *   - amplitude decays exponentially through the γ term
 *
 * §5.5 forbids easing anything with mass, and this is the file that earns that
 * rule: the thread's feel comes from the physics being right, not from a curve.
 *
 * Channels: R = uₙ (current), G = uₙ₋₁ (previous). Both signed, so the target
 * is a float format.
 */

precision highp float;

uniform sampler2D uState;
uniform sampler2D uTouch;      // the shared pointer field (ADR-0002)
uniform float uStations;       // texels along the thread
uniform float uCourant;        // C = c·dt/dx — see the stability note below
uniform float uDamping;        // γ·dt
uniform float uTime;
uniform float uIdleAmplitude;  // §2: 0.004–0.010 world units
uniform float uIdleHz;         // §2: ~0.3 Hz
uniform float uGrab;           // pointer pressure, 0–1
uniform vec2 uGrabPoint;       // pointer in thread space: x = along, y = offset
uniform float uRelease;        // 1 on the frame the pointer lets go

varying vec2 vUv;

void main() {
  float dx = 1.0 / uStations;
  float x = vUv.x;

  vec2 state = texture2D(uState, vUv).rg;
  float current = state.r;
  float previous = state.g;

  // Neighbours, clamped at the ends. Clamping is a *fixed* boundary: the
  // reflected pulse inverts, which is what a thread pinned at both ends does
  // and is a large part of why this reads as a physical object.
  float left = texture2D(uState, vec2(max(x - dx, 0.0), vUv.y)).r;
  float right = texture2D(uState, vec2(min(x + dx, 1.0), vUv.y)).r;

  float laplacian = left - 2.0 * current + right;

  float next =
    2.0 * current
    - previous
    + uCourant * uCourant * laplacian
    - 2.0 * uDamping * (current - previous);

  /*
   * Idle: a standing wave travelling the length at ~0.3 Hz (§2).
   *
   * Driven as a *forcing term* rather than assigned, so it superposes with
   * whatever the pointer has left ringing instead of overwriting it. A thread
   * that stops breathing the moment you touch it is a thread that is animating
   * rather than alive.
   *
   * The envelope is a half-sine over the length so the drive vanishes at the
   * pinned ends, where the boundary condition forbids displacement anyway.
   */
  float envelope = sin(x * 3.14159265);
  float idle = sin(x * 6.2831853 - uTime * uIdleHz * 6.2831853) * envelope;
  next += (idle * uIdleAmplitude - next) * 0.012;

  /*
   * Pointer grab. While held, the thread is pulled toward the pointer at the
   * grabbed station with a narrow gaussian falloff. On release the drive simply
   * stops and the stored displacement becomes the initial condition of two
   * counter-propagating pulses — no impulse needs to be injected, because
   * releasing a stretched string *is* the initial-value problem.
   */
  float reach = exp(-pow((x - uGrabPoint.x) / 0.06, 2.0));
  float pull = reach * uGrab;
  next = mix(next, uGrabPoint.y, pull * 0.65);

  // Fixed ends. Written last so nothing above can violate them.
  float endMask = step(0.5 * dx, x) * step(x, 1.0 - 0.5 * dx);
  next *= endMask;

  // The simulation is unconditionally stable only for C <= 1 (the CFL
  // condition); the clamp is a guard against a hostile uniform rather than a
  // correction, and the value is asserted in tools/shaders.spec.ts.
  next = clamp(next, -1.0, 1.0);

  gl_FragColor = vec4(next, current, 0.0, 1.0);
}
