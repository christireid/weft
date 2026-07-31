/*
 * composite.frag.glsl — the final pass (§3.4, §7 L1 task 6).
 *
 * Everything the visitor sees goes through this shader on its way to the
 * screen. It is the last thing in the frame and it does three jobs, in this
 * order, for reasons that are not interchangeable:
 *
 *   1  tone map      ACES, applied here rather than by the renderer, so the
 *                    scene pass can stay linear and accumulate spectral energy
 *                    above 1.0 without clipping (§2 Plate III).
 *   2  encode        linear → sRGB.
 *   3  lift          map [0,1] onto [--void, white].
 *   4  dither        ordered + stochastic threshold, then quantise.
 *
 * STEP 3 EXISTS BECAUSE THE VOID IS AN AUTHORED COLOUR, NOT A LUMINANCE.
 * §3.1 fixes the background at #050507. Clearing the scene buffer to that value
 * and tone mapping it gives rgb(1.5, 1.5, 1.8) — ACES compresses the bottom of
 * the range by roughly 4x, which is correct behaviour for *light* and wrong for
 * a page colour. So the scene clears to black, everything the renderer produces
 * is treated as light, and the void is the floor that light sits on. Where the
 * scene is empty the output is exactly #050507; where it is saturated the
 * output is white.
 *
 * ORDER IS THE WHOLE POINT. Dithering must happen *after* the sRGB encode and
 * *immediately before* quantisation, because quantisation is a property of the
 * output encoding. Dithering in linear space puts the noise where the transfer
 * function will stretch it unevenly — too little in the darks, which is exactly
 * where the void needs it, and too much in the highlights, where it reads as
 * grain. This is the difference between §3.4's "halftone texture of a printed
 * plate" and "someone left a noise layer on".
 *
 * §10 forbids removing this pass. It is not decoration: the background is
 * #050507 and the plates are full of gradients in the darkest two percent of
 * the range, which is where 8-bit output bands into visible contour rings.
 */

precision highp float;

#include "../lib/dither.glsl";
#include "../lib/tonemap.glsl";

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uDitherStrength;  // §3.4 tuning window 0.02–0.06
uniform float uBlueWeight;      // mix of stochastic over ordered
uniform float uExposure;
uniform float uToneMap;         // 1 tone map, 0 pass through
uniform vec3 uVoid;             // --void, already in sRGB

varying vec2 vUv;

void main() {
  vec3 colour = texture2D(uScene, vUv).rgb * uExposure;

  colour = mix(colour, weftACES(colour), uToneMap);
  colour = weftLinearToSRGB(colour);

  // Light over the void. Equivalent to a screen blend, and exact at both ends:
  // zero light resolves to --void to the last code value, full light to white.
  colour = weftLiftOverVoid(colour, uVoid);

  /*
   * Pixel coordinates, not UV. The dither pattern has to be locked to the
   * output grid — expressed in UV it would rescale with the viewport and the
   * 8×8 matrix would land across fractional pixels, which turns the halftone
   * into moiré.
   */
  vec2 pixel = vUv * uResolution;

  colour = weftDitherQuantise(colour, pixel, uDitherStrength, 255.0, uBlueWeight);

  gl_FragColor = vec4(colour, 1.0);
}
