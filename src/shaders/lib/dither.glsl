/*
 * dither.glsl — ordered dithering and quantisation (§5.4, §3.4).
 *
 * §3.4 calls this "the one aesthetic risk" and "the thing that will make people
 * ask how it was made". It is both of those, and it is also load-bearing
 * engineering, which is the reason it survives the taste argument:
 *
 *   The background is #050507 and the plates are full of long, slow gradients
 *   in the darkest two percent of the range. That is exactly where 8-bit output
 *   bands — the eye resolves steps of one code value in a smooth dark ramp, and
 *   the result is contour rings across the void. Dithering *before*
 *   quantisation converts those contours into structured texture, and the
 *   structure happens to read as the halftone of a printed plate, which is the
 *   conceit of the whole piece.
 *
 * THE ORDER MATTERS. The threshold is added to the linear-ish signal and then
 * quantised. Applying noise *after* quantisation adds grain on top of banding
 * and fixes nothing; that is the usual mistake and it looks like a filter,
 * which is precisely the failure §3.4 warns about.
 *
 * SOURCES
 *   Bayer matrix    B. E. Bayer, "An optimum method for two-level rendition of
 *                   continuous-tone pictures", IEEE ICC 1973. The recursive
 *                   construction below is the standard one.
 *   Blue noise      R. Ulichney, "Digital Halftoning", MIT Press 1987 — why a
 *                   blue-noise (high-frequency-weighted) source beats white
 *                   noise as a dither signal: the error it leaves is pushed
 *                   into frequencies the eye is least sensitive to.
 *   Both in CREDITS.md.
 */

#ifndef WEFT_DITHER
#define WEFT_DITHER

/*
 * 8×8 Bayer threshold, computed rather than tabulated.
 *
 * The recursive definition is
 *   M_{2n} = [ 4·M_n + 0   4·M_n + 2 ]
 *            [ 4·M_n + 3   4·M_n + 1 ]
 * and the closed form for index (x, y) is the bit-reversed interleave of x^y
 * and y. This costs a handful of integer ops and avoids a 64-entry const array,
 * which some drivers place in memory rather than registers.
 *
 * Returns a value in [0,1).
 */
float weftBayer8(vec2 pixel) {
  vec2 p = mod(floor(pixel), 8.0);
  float x = p.x;
  float y = p.y;

  // Bit-reverse-interleave without integer ops, for GLSL ES 1.0 compatibility.
  float result = 0.0;
  float scale = 1.0;
  for (int i = 0; i < 3; i++) {
    float xb = mod(x, 2.0);
    float yb = mod(y, 2.0);
    // The pairing (y XOR x, y) is what makes the pattern dispersed rather than
    // clustered; expressed with mod because XOR on floats is not available.
    float bitA = mod(xb + yb, 2.0);
    scale *= 0.25;
    result += (bitA * 2.0 + yb) * scale;
    x = floor(x * 0.5);
    y = floor(y * 0.5);
  }
  return result;
}

/*
 * Cheap high-frequency hash, standing in for a blue-noise texture.
 *
 * A true blue-noise mask (a precomputed 64² tile with a void-and-cluster
 * spectrum) is better, and is what Ulichney's method produces. This is a
 * hash — its spectrum is white, not blue — and it is used *alongside* the Bayer
 * matrix rather than instead of it: Bayer supplies the ordered, structured
 * component that reads as halftone, and this breaks up the Bayer pattern's own
 * periodicity so it does not read as a visible 8-pixel grid.
 *
 * Being honest about what this is: if the grid is still visible at the shipped
 * strength, the fix is a real blue-noise tile, not a bigger hash weight.
 */
float weftHashNoise(vec2 pixel) {
  vec3 p = fract(vec3(pixel.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

/**
 * The combined dither threshold, in [-0.5, 0.5].
 *
 * `blueWeight` mixes the hash in over the ordered matrix. At 0 the pattern is
 * pure Bayer and the 8-pixel grid is visible on flat areas; at 1 it is pure
 * noise and the printed-plate texture is lost. Around 0.35 keeps the halftone
 * character while breaking the grid.
 */
float weftDitherThreshold(vec2 pixel, float blueWeight) {
  float ordered = weftBayer8(pixel);
  float stochastic = weftHashNoise(pixel);
  return mix(ordered, stochastic, blueWeight) - 0.5;
}

/**
 * Dither and quantise.
 *
 * `levels` is the number of output steps per channel — 255.0 for straight 8-bit
 * output. `strength` scales the threshold in units of one output step; §3.4
 * gives the tuning window 0.02–0.06, and that is a *fraction of the full range*
 * rather than of a step, so it is converted here.
 *
 * Call this last, on the final composite, after tone mapping and after the
 * sRGB encode — quantisation is a property of the output encoding, and
 * dithering in linear space puts the noise where the display transfer function
 * will stretch it unevenly across the dark end.
 */
vec3 weftDitherQuantise(vec3 colour, vec2 pixel, float strength, float levels, float blueWeight) {
  float threshold = weftDitherThreshold(pixel, blueWeight);
  // strength is a fraction of full range; express it in output steps.
  vec3 dithered = colour + threshold * strength;
  return floor(dithered * levels + 0.5) / levels;
}

/** Threshold without quantisation, for passes that feed another pass. */
vec3 weftDither(vec3 colour, vec2 pixel, float strength, float blueWeight) {
  return colour + weftDitherThreshold(pixel, blueWeight) * strength;
}

#endif
