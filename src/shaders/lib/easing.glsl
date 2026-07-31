/*
 * easing.glsl — the GPU half of the motion language (§5.5, §5.4).
 *
 * WEFT uses one easing family across DOM and GPU so nothing feels like it
 * belongs to a different site. The CSS half lives in src/styles/tokens.css as
 * --ease-enter and --ease-exit. These are the same two curves, evaluated in the
 * shader, so a DOM element and a shader-driven vertex given the same normalised
 * time land in the same place.
 *
 *   --ease-enter  cubic-bezier(0.16, 1, 0.30, 1)   long tail; anything entering
 *   --ease-exit   cubic-bezier(0.70, 0, 0.84, 0)   anything leaving
 *
 * Method: a CSS cubic-bezier(x1,y1,x2,y2) is a parametric curve with P0=(0,0)
 * and P3=(1,1). Evaluating y at a given x means solving for the parameter s
 * where Bx(s) = x, then returning By(s). Newton-Raphson converges in 4
 * iterations to well below what a float can represent at this scale; the
 * derivative is analytic so there is no finite-difference error.
 *
 * Correctness is asserted against the browser's own implementation in
 * tools/shaders.spec.ts, which samples these against a real CSS animation
 * rather than against my arithmetic.
 *
 * NOTE ON USE (§5.5, D-011): these are for choreography — camera moves, type
 * reveals, annotation entrances, parameter ramps. They are NOT for the thread,
 * the cloth, the particles or the shards. Physical motion is simulated, never
 * eased. If you find yourself easing something with mass, the fix is in the
 * simulation constants.
 */

#ifndef WEFT_EASING
#define WEFT_EASING

float weftBezierX(float s, float x1, float x2) {
  float u = 1.0 - s;
  // 3u²s·x1 + 3us²·x2 + s³   (P0.x = 0, P3.x = 1)
  return 3.0 * u * u * s * x1 + 3.0 * u * s * s * x2 + s * s * s;
}

float weftBezierY(float s, float y1, float y2) {
  float u = 1.0 - s;
  return 3.0 * u * u * s * y1 + 3.0 * u * s * s * y2 + s * s * s;
}

float weftBezierDx(float s, float x1, float x2) {
  float u = 1.0 - s;
  return 3.0 * u * u * x1 + 6.0 * u * s * (x2 - x1) + 3.0 * s * s * (1.0 - x2);
}

/** Evaluate a CSS-style cubic-bezier easing at normalised time t. */
float weftEase(float t, float x1, float y1, float x2, float y2) {
  float x = clamp(t, 0.0, 1.0);
  float s = x;
  for (int i = 0; i < 4; i++) {
    float err = weftBezierX(s, x1, x2) - x;
    float d = weftBezierDx(s, x1, x2);
    // Guard the flat regions of aggressive curves, where d approaches zero and
    // an unguarded division sends s to infinity.
    s -= err / max(d, 1e-4);
    s = clamp(s, 0.0, 1.0);
  }
  return weftBezierY(s, y1, y2);
}

/** cubic-bezier(0.16, 1, 0.30, 1) — matches --ease-enter. */
float weftEaseEnter(float t) { return weftEase(t, 0.16, 1.0, 0.30, 1.0); }

/** cubic-bezier(0.70, 0, 0.84, 0) — matches --ease-exit. */
float weftEaseExit(float t) { return weftEase(t, 0.70, 0.0, 0.84, 0.0); }

/** Hermite ramp. Cheap, and the right choice when a curve just needs to be smooth. */
float weftSmoothstep(float e0, float e1, float x) {
  float t = clamp((x - e0) / max(e1 - e0, 1e-6), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

/**
 * Remap x from [a,b] to [0,1], clamped. Used constantly to turn a plate's local
 * t into a sub-phase — "the exit transformation occupies t 0.85 to 1.0".
 */
float weftRange(float a, float b, float x) {
  return clamp((x - a) / max(b - a, 1e-6), 0.0, 1.0);
}

#endif
