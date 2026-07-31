/*
 * tonemap.glsl — tone mapping, output encoding, and the void lift (§5.4, §3.1).
 *
 * These three are a library chunk rather than being inlined in the composite
 * pass for two reasons: the shard pass in Plate VI needs the same encode, and
 * keeping them here means the unit tests can exercise the exact functions the
 * pass ships rather than a reimplementation of them.
 */

#ifndef WEFT_TONEMAP
#define WEFT_TONEMAP

/*
 * ACES filmic, Narkowicz 2015 rational fit — the curve behind three's
 * ACESFilmicToneMapping, reproduced here because the renderer's own tone
 * mapping is switched off so the scene pass can stay linear.
 *
 * ACES rather than Reinhard or a clamp, specifically because of Plate III:
 * accumulating 16 wavelengths additively produces values well above 1.0 in the
 * bright core of the particle cloud. Reinhard desaturates as it compresses,
 * draining exactly the spectral colour the plate exists to show; a hard clamp
 * gives the flat white blob §2 warns about. ACES rolls off while holding
 * saturation into the highlight.
 */
vec3 weftACES(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/** Linear → sRGB, the piecewise IEC 61966-2-1 transfer function. */
vec3 weftLinearToSRGB(vec3 linear) {
  vec3 lo = linear * 12.92;
  vec3 hi = 1.055 * pow(max(linear, vec3(1e-8)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(linear, vec3(0.0031308)));
}

/**
 * Composite encoded light over the void.
 *
 * §3.1 fixes the background at #050507, and that is an **authored colour, not a
 * luminance**. Clearing the scene buffer to it and tone mapping gives
 * rgb(1.5, 1.5, 1.8) — ACES compresses the bottom of the range by roughly 4x,
 * which is right for light and wrong for a page colour.
 *
 * So the scene clears to black, everything the renderer produces is treated as
 * light, and the void is the floor that light sits on. Equivalent to a screen
 * blend, and exact at both ends: zero light resolves to --void to the last code
 * value, full light to white.
 *
 * `voidColour` is in sRGB, because this runs after the encode.
 */
vec3 weftLiftOverVoid(vec3 encoded, vec3 voidColour) {
  return voidColour + encoded * (1.0 - voidColour);
}

#endif
