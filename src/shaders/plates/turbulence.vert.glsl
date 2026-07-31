/*
 * turbulence.vert.glsl — velocity-stretched points (§2 Plate III).
 *
 * §2: "Particles render as velocity-stretched points: fast particles become
 * streaks, slow particles become dots. This single rule produces most of the
 * visual interest and costs one line in the vertex shader."
 *
 * HOW THE STRETCH IS DONE, AND WHY NOT INSTANCED QUADS
 *
 * `gl.POINTS` sprites are square and axis-aligned; there is no way to stretch
 * one along an arbitrary direction from the vertex stage. The usual answer is
 * an instanced quad per particle, oriented and scaled along velocity — four
 * vertices instead of one, and at tier 1's 500,000 particles that is two
 * million vertices per frame for a plate that also runs eighteen simplex
 * evaluations per particle in the sim step.
 *
 * So the sprite stays square and the *streak is drawn inside it*: this shader
 * sizes the point to contain the streak and hands the fragment shader the
 * screen-space velocity direction and the length in sprite-relative units. The
 * fragment shader draws an oriented capsule. One vertex per particle, a real
 * streak rather than a bigger dot, and the cost moves to fill — which is the
 * cheaper half on every device in §5.6's table.
 *
 * The trade is honest and worth stating: a very fast particle needs a large
 * sprite, and most of that sprite is discarded. `MAX_STRETCH` bounds it.
 */

precision highp float;

uniform sampler2D uPosition;
uniform sampler2D uVelocity;
uniform sampler2D uSeed;

/** Device pixel ratio, so a point is the same physical size at any DPR. */
uniform float uPixelRatio;
/** Point diameter in CSS pixels for a particle at rest. */
uniform float uPointSize;
/** Speed, in world units per second, that maps to MAX_STRETCH. */
uniform float uSpeedScale;
uniform float uWeight;
/** Full width of the source filament, world units, for the band mapping. */
uniform float uSpan;

/** The texel this vertex reads its particle from. */
attribute vec2 aParticleUv;

varying float vSpeed;
varying float vAge;
/** 0..1 along the filament the particle was born on. Selects its wavelength. */
varying float vBand;
/** Screen-space velocity direction, normalised. */
varying vec2 vDirection;
/** Streak half-length as a fraction of the sprite half-width. */
varying float vStretch;

/**
 * Longest streak, as a multiple of the resting point diameter.
 *
 * Above about 6 the plate stops reading as particles in a flow and starts
 * reading as a hatching pattern — the streaks are long enough to touch each
 * other and the eye groups them into lines rather than into a cloud.
 */
const float MAX_STRETCH = 6.0;

void main() {
  vec4 position = texture2D(uPosition, aParticleUv);
  vec4 velocity = texture2D(uVelocity, aParticleUv);
  vec4 seed = texture2D(uSeed, aParticleUv);

  vec4 view = modelViewMatrix * vec4(position.xyz, 1.0);
  vec4 clip = projectionMatrix * view;
  gl_Position = clip;

  float speed = length(velocity.xyz);
  // The one line §2 is talking about.
  float stretch = 1.0 + min(MAX_STRETCH - 1.0, speed / max(uSpeedScale, 1e-4) * (MAX_STRETCH - 1.0));

  /*
   * Screen-space direction. The velocity is transformed by the model-view
   * matrix as a *direction* (w = 0) and then divided by the clip w, which is
   * the perspective divide the position gets — without it a particle far from
   * the camera would streak in a direction that does not match its motion on
   * screen.
   */
  vec4 viewVelocity = modelViewMatrix * vec4(velocity.xyz, 0.0);
  vec2 screenVelocity = (projectionMatrix * viewVelocity).xy;
  float screenSpeed = length(screenVelocity);
  vDirection = screenSpeed > 1e-6 ? screenVelocity / screenSpeed : vec2(1.0, 0.0);
  vStretch = stretch;
  vSpeed = speed;
  vAge = position.w;
  /*
   * The wavelength comes from *where on the filament the particle started*,
   * not from its random seed.
   *
   * Seeding it randomly gave every pixel an independent, fully saturated hue,
   * and at one pixel per particle there is nothing for those hues to blend
   * against — the cloud read as RGB confetti rather than as a spectrum. Ordered
   * along the span, neighbouring particles carry neighbouring wavelengths, so
   * the fray separates into coloured strands and dense regions sum toward white.
   * It also matches Plate II, where wavelength maps to deviation angle and the
   * fan is ordered rather than scattered — this is meant to be the same light.
   */
  vBand = clamp(seed.x / uSpan + 0.5, 0.0, 1.0);

  /*
   * Perspective-correct sizing: a point sprite's size is in pixels, so it has
   * to be divided by the view distance by hand or the cloud has no depth. The
   * sprite is sized to contain the streak, which is why `stretch` appears here
   * as well as in the varying.
   */
  float distance = max(0.001, -view.z);
  gl_PointSize = uPointSize * uPixelRatio * stretch / distance;

  // A plate that is blending out shrinks its particles rather than only fading
  // them: fading alone leaves a full-size grey haze at low weight, which is
  // more visible in the blend band than the plate itself.
  gl_PointSize *= mix(0.35, 1.0, uWeight);
}
