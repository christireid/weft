/*
 * touch.frag.glsl — the shared pointer field (§5.3).
 *
 * One 256x256 ping-pong target, sampled by every plate. Channels:
 *
 *   R, G   pointer velocity in screen space, signed, in units of
 *          viewport-fractions per second, scaled by VELOCITY_SCALE so a
 *          half-float carries it without clipping on a fast flick
 *   B      pressure — 1 while the pointer is down, decaying when it lifts
 *   A      age — 1 where the pointer just was, decaying toward 0
 *
 * Each frame the previous field is decayed and a new segment is stamped into
 * it. The segment matters: a pointer moving quickly jumps tens of pixels
 * between frames, and stamping a disc at the current position leaves a dotted
 * trail. Stamping the *capsule* between the previous and current position
 * leaves a continuous stroke at any speed, which is what makes the thread in
 * Plate I feel grabbed rather than tapped.
 *
 * Distance-to-segment is the standard closed form; see sdf.glsl, which shares
 * it.
 */

precision highp float;

uniform sampler2D uPrevious;
uniform vec2 uPointer;      // current position, 0..1, y up
uniform vec2 uPointerPrev;  // position last frame
uniform vec2 uVelocity;     // viewport-fractions per second
uniform float uPressure;    // 1 down, 0 up
uniform float uPresent;     // 0 when the pointer has never been seen or has left
uniform float uRadius;      // stamp radius in viewport fractions
uniform float uDecay;       // per-frame retention, §5.3 says 0.94–0.97
uniform float uAspect;      // width / height, so the stamp is round not oval

varying vec2 vUv;

const float VELOCITY_SCALE = 0.05;

float distanceToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float len2 = dot(ab, ab);
  // Degenerate segment (pointer stationary) collapses to a point, correctly.
  float h = len2 > 1e-12 ? clamp(dot(p - a, ab) / len2, 0.0, 1.0) : 0.0;
  return length(p - a - ab * h);
}

void main() {
  vec4 previous = texture2D(uPrevious, vUv);

  // Decay first, so a stamp written this frame is at full strength.
  vec4 field = previous * uDecay;

  // Aspect-correct the distance so the stamp is circular on screen rather than
  // circular in UV space, which on a 16:9 viewport is visibly an ellipse.
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 a = vec2(uPointerPrev.x * uAspect, uPointerPrev.y);
  vec2 b = vec2(uPointer.x * uAspect, uPointer.y);

  float d = distanceToSegment(p, a, b);

  // Smooth falloff rather than a hard disc: a hard edge shows up as a visible
  // circular boundary in every plate that samples this, and no amount of
  // downstream blurring hides it.
  float stamp = 1.0 - smoothstep(0.0, uRadius, d);
  stamp *= stamp;          // tighten the core
  stamp *= uPresent;

  field.rg = mix(field.rg, uVelocity * VELOCITY_SCALE, stamp);
  field.b = max(field.b, uPressure * stamp);
  field.a = max(field.a, stamp);

  // Half-float carries this comfortably, but a runaway max() across thousands
  // of frames is the kind of thing that only shows up after ten minutes.
  field = clamp(field, vec4(-8.0, -8.0, 0.0, 0.0), vec4(8.0, 8.0, 1.0, 1.0));

  gl_FragColor = field;
}
