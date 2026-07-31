/*
 * sdf.glsl — signed distance functions (§5.4).
 *
 * Used by the glass slab in Plate V and the shard pass in Plate VI, and by the
 * capsule stamp in the shared touch field.
 *
 * These are the standard closed forms. The canonical collection is Inigo
 * Quilez's (iquilezles.org/articles/distfunctions), which is where most people
 * including me first met them; each one below is short enough that the
 * derivation is the comment. Credited in CREDITS.md.
 *
 * Convention throughout: negative inside, zero on the surface, positive
 * outside. Every function here returns a *true* distance (not a bound) unless
 * its comment says otherwise, which matters because the glass pass takes
 * gradient-based normals and a non-metric bound gives wrong normals.
 */

#ifndef WEFT_SDF
#define WEFT_SDF

/** Sphere of radius r at the origin. */
float weftSdSphere(vec3 p, float r) {
  return length(p) - r;
}

/**
 * Axis-aligned box of half-extents b.
 *
 * The two terms handle outside and inside separately: `length(max(q,0))` is the
 * distance to the nearest face when outside, and `min(max(q.x,max(q.y,q.z)),0)`
 * is the (negative) distance to the nearest face when inside. Summing them is
 * correct in both regions because exactly one is non-zero.
 */
float weftSdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

/** Box with rounded edges. Subtracting a radius from any SDF rounds it. */
float weftSdRoundBox(vec3 p, vec3 b, float r) {
  return weftSdBox(p, b - vec3(r)) - r;
}

/**
 * Capsule between a and b.
 *
 * Project p onto the segment, clamp the parameter to [0,1] so the projection
 * stays on the segment rather than its infinite line, then take the distance to
 * that point. The same closed form is used in touch.frag.glsl to stamp a
 * pointer stroke, which is why it lives in the shared library.
 */
float weftSdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float len2 = dot(ba, ba);
  float h = len2 > 1e-12 ? clamp(dot(pa, ba) / len2, 0.0, 1.0) : 0.0;
  return length(pa - ba * h) - r;
}

/** 2D form of the same, for screen-space work. */
float weftSdSegment2d(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float len2 = dot(ba, ba);
  float h = len2 > 1e-12 ? clamp(dot(pa, ba) / len2, 0.0, 1.0) : 0.0;
  return length(pa - ba * h);
}

/** Infinite plane with unit normal n at distance h from the origin. */
float weftSdPlane(vec3 p, vec3 n, float h) {
  return dot(p, n) + h;
}

/*
 * Booleans.
 *
 * The plain min/max forms are exact. The `smooth` variants are the polynomial
 * blends: they trade exactness for a rounded join, which is what Plate VI's
 * shards need where a fracture surface meets the slab face.
 */
float weftOpUnion(float a, float b) { return min(a, b); }
float weftOpSubtract(float a, float b) { return max(-a, b); }
float weftOpIntersect(float a, float b) { return max(a, b); }

float weftOpSmoothUnion(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

/**
 * Gradient normal by central differences.
 *
 * Four evaluations rather than six, using the tetrahedron trick: sampling at
 * four vertices of a regular tetrahedron and weighting by their positions gives
 * the gradient at two-thirds the cost.
 *
 * The caller supplies the field as a macro-free approach is not available in
 * GLSL ES 1.0 — so each pass defines its own normal function against its own
 * scene function. This one is provided for a sphere as the worked example the
 * unit test asserts against.
 */
vec3 weftSdSphereNormal(vec3 p, float r, float eps) {
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * weftSdSphere(p + k.xyy * eps, r) +
    k.yyx * weftSdSphere(p + k.yyx * eps, r) +
    k.yxy * weftSdSphere(p + k.yxy * eps, r) +
    k.xxx * weftSdSphere(p + k.xxx * eps, r)
  );
}

#endif
