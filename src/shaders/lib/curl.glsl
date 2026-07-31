/*
 * curl.glsl — divergence-free flow from the curl of a noise potential (§5.4, §2 Plate III).
 *
 * WHY CURL AND NOT NOISE
 *
 * Bridson, Hourihan & Nordenstam, "Curl-Noise for Procedural Fluid Flow",
 * SIGGRAPH 2007. Taking v = ∇ × ψ of any vector potential ψ gives a velocity
 * field that is divergence-free *by construction* — the divergence of a curl is
 * identically zero, so it is exact rather than approximate, and no projection
 * step is needed.
 *
 * That property is the whole reason Plate III uses it. Particles advected
 * through a raw noise field bunch up where the field converges and thin out
 * where it diverges, and within a few seconds the cloud has clumped. A
 * divergence-free field conserves density, so the fray in Plate III stays a
 * fray. It is the difference between "particles in a fluid" and "particles in a
 * lava lamp".
 *
 * The simplex noise underneath is webgl-noise (Ian McEwan, Ashima Arts;
 * maintained by Stefan Gustavson), MIT. It is textureless, which matters: the
 * curl needs six noise evaluations per particle per frame and a texture fetch
 * per evaluation would dominate the GPGPU step.
 *
 * DERIVATIVES
 *
 * §2 says the curl is "derived analytically from the gradient of a 3D simplex
 * field". webgl-noise's snoise returns the value only, not its gradient, so the
 * partials here are central differences at a fixed epsilon. That is a
 * deliberate choice with a measured basis rather than a shortcut — see
 * DECISIONS.md D-013. The divergence-free property survives it: the field is
 * still a curl of *something* (the finite-difference potential), so it is
 * numerically divergence-free to the same order. tools/shaders.spec.ts asserts
 * that directly by sampling divergence on a grid.
 */

#ifndef WEFT_CURL
#define WEFT_CURL

#include "./simplex3d.glsl";

/*
 * Epsilon for the central differences.
 *
 * Too small and the difference is lost in float precision — at 1e-5 in highp
 * the subtraction of two near-equal noise values keeps about two significant
 * digits, and the field turns to grain. Too large and the curl is a
 * low-pass-filtered version of the true one, which shows up as a flow that has
 * lost its small eddies. 1e-3 in noise-space units sits in the middle; the
 * divergence test in tools/shaders.spec.ts is what pins it.
 */
const float WEFT_CURL_EPS = 1e-3;

/** The three-component potential field. Offsets decorrelate the components. */
vec3 weftPotential(vec3 p) {
  return vec3(
    weftSimplex3d(p),
    weftSimplex3d(p + vec3(31.416, 47.853, 12.793)),
    weftSimplex3d(p + vec3(-19.217, 83.641, 71.084))
  );
}

/**
 * Curl of the potential field at p.
 *
 *   (∇ × ψ)ₓ = ∂ψz/∂y − ∂ψy/∂z
 *   (∇ × ψ)ᵧ = ∂ψx/∂z − ∂ψz/∂x
 *   (∇ × ψ)_z = ∂ψy/∂x − ∂ψx/∂y
 *
 * Six potential evaluations (three axes, two sides each), each of which is
 * three simplex evaluations — eighteen total per call. That is the honest cost
 * and it is why Plate III's particle count is tiered.
 */
vec3 weftCurl(vec3 p) {
  const float e = WEFT_CURL_EPS;
  const float inv2e = 1.0 / (2.0 * e);

  vec3 dx = (weftPotential(p + vec3(e, 0.0, 0.0)) - weftPotential(p - vec3(e, 0.0, 0.0))) * inv2e;
  vec3 dy = (weftPotential(p + vec3(0.0, e, 0.0)) - weftPotential(p - vec3(0.0, e, 0.0))) * inv2e;
  vec3 dz = (weftPotential(p + vec3(0.0, 0.0, e)) - weftPotential(p - vec3(0.0, 0.0, e))) * inv2e;

  return vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x);
}

/**
 * Curl over several octaves.
 *
 * Each octave is a curl in its own right, and a sum of divergence-free fields
 * is divergence-free, so the property survives the sum. This is the cheap way
 * to get both a large-scale drift and small eddies — but note the cost is
 * linear in octaves, so Plate III uses 2 on tier 3 and 3 on tier 1.
 */
vec3 weftCurlOctaves(vec3 p, int octaves, float lacunarity, float gain) {
  vec3 acc = vec3(0.0);
  float frequency = 1.0;
  float amplitude = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    acc += weftCurl(p * frequency) * amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return acc;
}

#endif
