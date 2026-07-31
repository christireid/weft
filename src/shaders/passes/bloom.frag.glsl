/*
 * bloom.frag.glsl — bright-pass extraction and separable blur (§2, §5.6).
 *
 * Two entry points in one file, selected by uMode, because they share the
 * sampler and the resolution uniform and splitting them would mean two
 * near-identical shaders that could drift apart.
 *
 *   uMode 0   extract   threshold, cap, downsample
 *   uMode 1   blur      separable gaussian along uDirection
 *
 * THE LUMINANCE CAP, AND WHY IT IS HERE
 *
 * §2 Plate III: "Depth-sorted additive blending with a tone-mapped bloom pass.
 * Watch for the classic failure: additive plus bloom saturates to white mush.
 * Cap accumulated luminance in the shader before the pass, not after."
 *
 * That instruction is precise and the reason is worth stating. Additive
 * geometry produces unbounded values where many primitives overlap — the core
 * of Plate I's filament already sits above 1.0 by design, and Plate III's
 * particle cloud will reach far higher. Bloom then blurs those values across a
 * wide radius, so a single very bright fragment smears its excess over
 * everything near it and the whole region clips to white.
 *
 * Tone mapping afterwards cannot undo it: by then the blur has already spread
 * energy that should have been bounded. So the cap is applied at extraction,
 * before a single texel of blur — which preserves *where* the light is while
 * refusing to let any one point contribute more than CAP to its neighbours.
 */

precision highp float;

uniform sampler2D uSource;
uniform vec2 uTexel;       // 1 / resolution of the source
uniform vec2 uDirection;   // blur axis, in texels
uniform float uThreshold;  // luminance below this contributes nothing
uniform float uCap;        // see the note above
uniform int uMode;

varying vec2 vUv;

/*
 * Rec. 709 luma, matching the primaries the rest of the pipeline works in.
 *
 * The `weft` prefix is not decoration. three prepends its own chunks to every
 * ShaderMaterial fragment shader, and `tonemapping_pars_fragment` defines
 * `float luminance( const in vec3 rgb )`. An unprefixed `luminance(vec3 c)`
 * here is not an override — it is a redefinition with different parameter
 * qualifiers, which fails to compile:
 *
 *   ERROR: 'in' : function must have the same parameter qualifiers in all of
 *          its declarations
 *   ERROR: 'luminance' : function already has a body
 *
 * three logs that to the console and carries on; the program never links, every
 * draw using it is dropped with INVALID_OPERATION, and the bloom targets stay
 * at the clear colour. The frame still renders, so nothing looks broken — it
 * simply has no bloom in it. Prefix every helper in this project.
 */
float weftLuminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 extract() {
  /*
   * A 4-tap box at half resolution rather than a single sample. The extract
   * target is half the size of the scene, so a point sample would alias the
   * filament — a 2 px ribbon lands on alternate texels and the bloom flickers
   * as it moves. Averaging the 2x2 it came from is one extra tap set and
   * removes the shimmer entirely.
   */
  vec3 sum = vec3(0.0);
  sum += texture2D(uSource, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
  sum += texture2D(uSource, vUv + uTexel * vec2(0.5, -0.5)).rgb;
  sum += texture2D(uSource, vUv + uTexel * vec2(-0.5, 0.5)).rgb;
  sum += texture2D(uSource, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  vec3 colour = sum * 0.25;

  float lum = weftLuminance(colour);

  // Soft knee: a hard threshold makes the bloom pop in as a shape when
  // something crosses it, which reads as a bug rather than as light.
  float contribution = smoothstep(uThreshold, uThreshold * 2.0, lum);

  /*
   * The cap. Scale the colour so its luminance cannot exceed uCap, preserving
   * hue and saturation — clamping per channel instead would desaturate toward
   * white, which is precisely the mush this exists to prevent, arrived at by a
   * different route.
   */
  float scale = lum > uCap ? uCap / max(lum, 1e-5) : 1.0;

  return colour * scale * contribution;
}

vec3 blur() {
  /*
   * Nine-tap gaussian, separable, using linear-filtered taps at fractional
   * offsets so nine samples cover the reach of thirteen. Weights are the
   * standard sigma≈2 kernel folded into five fetches per direction.
   */
  vec2 step1 = uDirection * uTexel * 1.3846153846;
  vec2 step2 = uDirection * uTexel * 3.2307692308;

  vec3 sum = texture2D(uSource, vUv).rgb * 0.2270270270;
  sum += texture2D(uSource, vUv + step1).rgb * 0.3162162162;
  sum += texture2D(uSource, vUv - step1).rgb * 0.3162162162;
  sum += texture2D(uSource, vUv + step2).rgb * 0.0702702703;
  sum += texture2D(uSource, vUv - step2).rgb * 0.0702702703;
  return sum;
}

void main() {
  vec3 result = uMode == 0 ? extract() : blur();
  gl_FragColor = vec4(result, 1.0);
}
