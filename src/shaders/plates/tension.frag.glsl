/*
 * tension.frag.glsl — the filament's material (§2 Plate I, §3.1).
 *
 * "It is lit by one white source. Where the curve is tightest, the light
 *  fringes into spectrum."
 *
 * There is no accent colour anywhere in WEFT (§3.1). The core is white; the
 * only chroma is produced here, by dispersion, and it appears only where the
 * geometry justifies it. That constraint is the piece's whole colour strategy
 * and this is the first plate that has to honour it.
 *
 * The cross-section is not a flat fill. A real filament lit from one side has a
 * bright specular core and falls off toward its silhouette, and reproducing
 * that in the ribbon's `side` coordinate is most of what makes this read as a
 * cylinder rather than a stroke.
 */

precision highp float;

#include "../lib/spectral.glsl";

uniform float uExit;
uniform float uFringe;      // strength of the spectral edge
uniform float uCurvature;   // how tight the catenary is, drives the fringe

/** Fraction of the ribbon's half-width occupied by the white core. */
const float CORE_FRACTION = 0.34;

/** Core is driven well above 1.0; the wings sit below it so they read as fringe. */
const float CORE_GAIN = 2.4;
const float WING_GAIN = 0.85;

varying float vAlong;
varying float vSide;
varying float vWidthPx;

void main() {
  float edge = abs(vSide);

  /*
   * TWO PROFILES, NOT ONE.
   *
   * A real dispersive filament is not a coloured stroke. It is a narrow, bright,
   * essentially white core with *wings* either side, and the wings are where the
   * dispersion lives — the core is where every wavelength overlaps, so it
   * integrates back to white, and only at the edges does the separation exceed
   * the core width and become visible as colour.
   *
   * The first version of this file mapped wavelength across the whole ribbon and
   * weighted it by edge², which is the same idea confined to one profile. At a
   * 2.6 px ribbon that put the entire fringe inside a single pixel and it was
   * invisible — mathematically present, visually absent. Widening the ribbon and
   * splitting core from wings is what makes §2's "the light fringes into
   * spectrum" something a visitor can actually see.
   */

  // Core: narrow. `1 − e²` raised hard is the projected brightness of a
  // cylinder under a distant source.
  float coreEdge = clamp(edge / CORE_FRACTION, 0.0, 1.0);
  float core = pow(max(1.0 - coreEdge * coreEdge, 0.0), 1.6);

  // Wings: the rest of the ribbon, falling off smoothly to nothing.
  float wing = pow(max(1.0 - edge * edge, 0.0), 2.0);

  /*
   * The antialias term is the reason `vWidthPx` is carried through: a ribbon a
   * few pixels wide has to fade its own edge, because there is no MSAA on this
   * target and a hard cutoff at that scale crawls as the thread moves.
   */
  float aa = clamp(vWidthPx * 0.5, 1.0, 4.0);
  float silhouette = smoothstep(1.0, 1.0 - 1.0 / aa, edge);
  core *= silhouette;
  wing *= silhouette;

  /*
   * Wavelength across the ribbon: the two sides carry opposite ends of the
   * visible band, which is what refraction through a curved dielectric does.
   *
   * The band is self-normalising — weftWavelengthToLinearSRGB divides by the
   * flat-spectrum integral over the same sampling — so the wings integrate back
   * to white across the width rather than tinting the thread. That property is
   * asserted on the GPU in tools/shaders.spec.ts.
   */
  vec3 bandWhite = weftBandWhite(16);
  float lambdaT = clamp(vSide * 0.5 + 0.5, 0.0, 1.0);
  vec3 spectrum = weftWavelengthToLinearSRGB(weftLambdaAt(lambdaT), bandWhite);

  // §2: "where the curve is tightest, the light fringes into spectrum".
  float fringeWeight = clamp(uFringe * uCurvature * (1.0 - uExit * 0.4), 0.0, 1.0);

  vec3 colour = vec3(core) * CORE_GAIN + spectrum * wing * WING_GAIN * fringeWeight;

  // Values above 1.0 are deliberate: the composite's ACES curve needs something
  // to roll off, and the HDR buffer exists precisely to carry it. A filament
  // that peaks at exactly white is a filament with no highlight.

  // Ends fade rather than stopping, so the thread reads as continuing past the
  // frame rather than terminating in it.
  float endFade = smoothstep(0.0, 0.04, vAlong) * smoothstep(1.0, 0.96, vAlong);

  float alpha = max(core, wing * fringeWeight) * endFade;
  if (alpha < 0.002) discard;

  gl_FragColor = vec4(colour * endFade, alpha);
}
