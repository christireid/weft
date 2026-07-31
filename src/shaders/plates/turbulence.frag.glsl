/*
 * turbulence.frag.glsl — the streak, and the luminance cap (§2 Plate III).
 *
 * Each particle carries a wavelength, so the cloud is "a spectrum in
 * suspension" (§2). The wavelength comes from where on the source filament the
 * particle was born — see the note in turbulence.vert.glsl — so it is fixed for
 * the particle's whole life and survives a respawn unchanged. The cloud does not
 * shimmer through the spectrum as it moves, and neighbouring particles carry
 * neighbouring wavelengths.
 *
 * THE CAP, AND WHY IT IS IN THIS SHADER
 *
 * §2: "Depth-sorted additive blending with a tone-mapped bloom pass. Watch for
 * the classic failure: additive plus bloom saturates to white mush. Cap
 * accumulated luminance in the shader before the pass, not after."
 *
 * There are two caps in this piece and they do different jobs. The one in
 * bloom.frag.glsl bounds what a single bright fragment may contribute to its
 * neighbours. This one bounds what a single *particle* may contribute to the
 * frame, before anything accumulates. Without it, the depth ranges where the
 * cloud is dense would blow past the tone mapper's shoulder purely by count —
 * a thousand particles at 0.02 is 20.0 — and no curve applied afterwards can
 * tell that apart from one genuinely bright thing.
 *
 * It is deliberately a *per-particle* cap on emission rather than a clamp on
 * the accumulated buffer, because clamping the accumulation is what produces
 * the white mush: it flattens every dense region to the same value, so the
 * cloud loses its interior structure and reads as a solid.
 */

precision highp float;

#include "../lib/spectral.glsl";

uniform float uWeight;
/** Wavelengths the plate spans. §2: the cloud carries Plate II's spectrum. */
uniform float uNmLow;
uniform float uNmHigh;
/** Per-particle emission ceiling. See the header. */
uniform float uEmissionCap;
uniform vec3 uBandWhite;
/** 0 during the plate, 1 through the exit. Desaturates into the lattice. */
uniform float uLattice;

varying float vSpeed;
varying float vAge;
varying float vBand;
varying vec2 vDirection;
varying float vStretch;

void main() {
  /*
   * The streak. `gl_PointCoord` is 0..1 across the sprite; recentre to −1..1,
   * rotate into the velocity frame, and evaluate a capsule — a segment of
   * half-length (stretch − 1) with a round cap of radius 1, all in units where
   * the sprite half-width is `stretch`.
   *
   * Dividing by `vStretch` first is what makes a fast particle a long thin
   * streak rather than a big round dot: the sprite grew, so the capsule's
   * radius has to shrink in sprite-relative terms to keep its real width.
   */
  vec2 offset = (gl_PointCoord - 0.5) * 2.0 * vStretch;
  vec2 axis = vDirection;
  vec2 local = vec2(dot(offset, axis), dot(offset, vec2(-axis.y, axis.x)));

  float halfLength = max(0.0, vStretch - 1.0);
  float along = clamp(local.x, -halfLength, halfLength);
  float distance = length(local - vec2(along, 0.0));

  // Soft edge rather than a discard: a hard-edged 2 px sprite aliases badly,
  // and additive blending makes the aliasing sparkle as the cloud moves.
  float profile = 1.0 - smoothstep(0.35, 1.0, distance);
  if (profile <= 0.0) discard;

  /*
   * Life envelope. A particle fades in over the first tenth of its life and out
   * over the last third, so respawning is invisible — a particle that popped in
   * at full brightness on the filament would read as a scatter of flashes along
   * the thread rather than as fraying.
   */
  float birth = smoothstep(0.0, 0.10, vAge);
  float death = 1.0 - smoothstep(0.67, 1.0, vAge);
  float envelope = birth * death;

  float nm = mix(uNmLow, uNmHigh, vBand);
  vec3 hue = weftWavelengthToLinearSRGB(nm, uBandWhite);

  /*
   * Pulled a fifth of the way toward the band's white point.
   *
   * A monochromatic wavelength is fully saturated by definition, and a
   * one-pixel element at full saturation is the definition of chroma noise —
   * there is no neighbourhood for the eye to average. Real scattered light is
   * never monochromatic either: a particle in a beam returns a band, not a
   * line. A fifth is enough to make the strands read as coloured light and not
   * enough to lose the spectrum.
   */
  hue = mix(hue, uBandWhite / max(uBandWhite.g, 1e-5), 0.20);

  /*
   * Faster particles are brighter as well as longer. Two cues for one variable
   * is usually a mistake, but here it is what separates the streaks from the
   * field they move through — a long dim streak in a cloud of bright dots reads
   * as a smear, which is the opposite of the intent.
   */
  float speedGain = 0.55 + 0.85 * min(1.0, vSpeed);

  /*
   * §2's exit: as the lattice engages the cloud loses its colour along with its
   * motion, so what settles into rows and columns is a monochrome grid — the
   * warp and weft Plate IV starts from, rather than a coloured one that would
   * have to be drained again a plate later.
   */
  vec3 colour = mix(hue, uBandWhite, uLattice);

  vec3 emission = colour * profile * envelope * speedGain;

  // The cap. Luminance-preserving: scaling the colour keeps its hue, where a
  // per-channel clamp would pull a saturated particle toward white, which is
  // the exact failure this exists to prevent arrived at from the other side.
  float lum = dot(emission, vec3(0.2126, 0.7152, 0.0722));
  float scale = lum > uEmissionCap ? uEmissionCap / max(lum, 1e-5) : 1.0;

  gl_FragColor = vec4(emission * scale * uWeight, 1.0);
}
