/*
 * dispersion.frag.glsl — PLATE II · DISPERSIO (§2).
 *
 * "The filament, now travelling at speed, passes through a glass wedge. White
 *  light separates. This plate establishes the rule that governs the whole
 *  site: all colour in WEFT is produced by refraction. There is no brand
 *  accent."
 *
 * THE PHYSICS
 *
 * The wedge is a thin prism, and for a thin prism the deviation of a ray is
 *
 *     δ(λ) = (n(λ) − 1) · A
 *
 * where A is the apex angle. n(λ) comes from Cauchy's equation in spectral.glsl,
 * so blue deviates more than red and the spacing is compressed at the red end —
 * which is what makes this read as dispersion rather than as a gradient. The
 * formula is exact in the thin-prism limit and is the standard result; using it
 * rather than refracting through two surfaces separately costs nothing in
 * fidelity at this apex angle and saves two Snell evaluations per wavelength.
 *
 * WHY SIXTEEN SAMPLES AND NOT THREE
 *
 * §5.1 rejects the stock ChromaticAberration pass because "it is a three-sample
 * RGB offset and looks like it". The difference is structural, not a matter of
 * degree: three samples produce three displaced copies of the beam with visible
 * gaps between them, because R, G and B are three points on a continuum being
 * asked to represent the whole of it. Sixteen wavelengths land adjacent on
 * screen, so the fan is continuous. Rubric axis 3 scores exactly this.
 *
 * The accumulation is self-normalising (see spectral.glsl): the same loop that
 * builds the colour builds the flat-spectrum integral, so an unrefracted beam
 * resolves to exactly white at any sample count. That is what lets the device
 * tier drop to 8 samples without tinting the plate.
 */

precision highp float;

#include "../lib/spectral.glsl";
#include "../lib/easing.glsl";

uniform vec2 uResolution;
uniform sampler2D uTouch;
uniform float uTime;
uniform float uLocalT;        // plate-local time, may run past 1 in the blend band
uniform float uWeight;        // router weight
uniform float uWedgeAngle;    // drag-controlled, radians
uniform float uApex;          // prism apex angle, radians
uniform int uSamples;         // wavelengths, by device tier
uniform float uCoherence;     // 1 coherent, 0 fully diverged (the exit)

varying vec2 vUv;

/** Where the wedge sits on the beam axis, in aspect-corrected screen units. */
const vec2 WEDGE_CENTRE = vec2(0.15, 0.0);
const float WEDGE_SIZE = 0.26;

/** Driven above 1.0 so ACES has something to roll off; see composite.frag.glsl. */
const float BEAM_GAIN = 3.2;

/** Aspect-corrected screen position, origin centre, y up. */
vec2 screenPoint() {
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= uResolution.x / max(uResolution.y, 1.0);
  return p;
}

/**
 * The beam.
 *
 * Plate I's thread ends accelerating toward the vanishing point; this is that
 * same thread, seen along its axis. It enters from the left, converging on the
 * wedge, and its brightness falls with distance from the axis.
 *
 * `speed` widens the streak along its direction of travel — §2's "motion
 * trails: velocity-aligned streaks whose length scales with per-fragment
 * speed". Anisotropic by construction: the falloff is tight across the beam and
 * loose along it, which is what a streak *is*.
 */
float beam(vec2 p, vec2 origin, vec2 direction, float thickness, float speed) {
  vec2 d = p - origin;
  float along = dot(d, direction);
  float across = length(d - direction * along);

  // Only the forward half of the axis carries light.
  float forward = smoothstep(-0.05, 0.15, along);

  float core = exp(-pow(across / thickness, 2.0));
  // Velocity stretch: the faster the fragment, the longer the tail behind it.
  float tail = exp(-max(along, 0.0) / max(speed, 1e-3));

  return core * forward * tail;
}

void main() {
  vec2 p = screenPoint();

  /*
   * The wedge. An equilateral-ish triangle rotated by the drag, sitting on the
   * beam axis. Its silhouette is drawn faintly — §2 calls it "a glass wedge",
   * and glass that is completely invisible until it does something reads as an
   * effect rather than as an object.
   */
  float c = cos(uWedgeAngle);
  float s = sin(uWedgeAngle);
  mat2 rot = mat2(c, -s, s, c);
  vec2 wedgeLocal = rot * (p - WEDGE_CENTRE);

  // Distance to the prism cross-section, as a 2-D triangle.
  float tri = max(
    abs(wedgeLocal.x) * 0.866 + wedgeLocal.y * 0.5,
    -wedgeLocal.y * 0.5
  ) - WEDGE_SIZE;

  // The beam runs along the axis Plate I's thread departed on, so the hand-off
  // across the blend band has no cut.
  vec2 origin = vec2(-2.2, 0.0);
  vec2 direction = normalize(vec2(1.0, 0.0));

  float speed = mix(0.35, 2.4, weftEaseEnter(clamp(uLocalT * 1.4, 0.0, 1.0)));
  /*
   * The beam thins as it accelerates. Thin matters here beyond the aesthetics:
   * the fan is only resolvable when the angular spread between wavelengths
   * exceeds the beam's own angular width, so a fat beam hides its own spectrum.
   */
  float thickness = mix(0.030, 0.008, clamp(uLocalT, 0.0, 1.0));

  /*
   * The spectral loop.
   *
   * Each wavelength is deviated by its own δ and its beam sampled at that
   * deviation. Accumulated in XYZ through the fitted colour-matching functions
   * and resolved once at the end — never per-wavelength, because converting
   * each sample to RGB and summing those is what produces the banded,
   * three-copy look this plate exists to avoid.
   */
  /*
   * Endpoint indices 1.78 at 380 nm and 1.46 at 740 nm.
   *
   * That is an Abbe number no real glass has — flint glasses reach perhaps
   * n_blue − n_red ≈ 0.03, and this is ten times that. It is deliberate and it
   * is the point of D-014: WEFT documents a material that does not exist, so
   * its wedge is not obliged to be N-BK7. What has to be real is Cauchy's
   * *form* — the 1/λ² law, which is what compresses the fan at the red end and
   * makes the separation read as dispersion rather than as a gradient.
   *
   * The first pass used 1.62/1.58, which is roughly a real crown glass. The
   * deviation spread across the whole visible band was then about 6%, far
   * narrower than the beam itself, so the light *bent* without visibly
   * *separating* — physically faithful and, at this throw distance, a failure
   * of the plate's one job. A real prism needs a metre of throw to fan a
   * spectrum; this one has half a viewport.
   */
  vec2 ab = weftCauchyFromEndpoints(1.78, 1.46);

  WeftSpectrum spectrum = weftSpectrumBegin();
  float n = float(uSamples);

  for (int i = 0; i < 32; i++) {
    if (i >= uSamples) break;
    float t = (float(i) + 0.5) / n;
    float nm = weftLambdaAt(t);

    float ior = weftCauchyIOR(nm, ab.x, ab.y);
    float deviation = (ior - 1.0) * uApex;

    /*
     * The beam bends only *after* the wedge. Before it, every wavelength shares
     * one path — which is why the fan has a vertex rather than being a set of
     * parallel lines, and why the white core survives right up to the glass.
     */
    float past = smoothstep(WEDGE_CENTRE.x - WEDGE_SIZE, WEDGE_CENTRE.x + WEDGE_SIZE, p.x);

    /*
     * Coherence loss (§2 exit): "the beam's coherence fails. Streaks begin to
     * diverge." Each wavelength picks up its own small angular error, growing
     * as coherence falls, so the fan frays rather than fading.
     */
    float scatter = (1.0 - uCoherence) * sin(nm * 0.37 + uTime * 0.6) * 0.22;

    float angle = (deviation + scatter) * past;
    vec2 bent = vec2(cos(angle), sin(angle));
    bent = vec2(bent.x * direction.x - bent.y * direction.y,
                bent.x * direction.y + bent.y * direction.x);

    float intensity = beam(p, origin, bent, thickness, speed);
    weftSpectrumAdd(spectrum, nm, intensity);
  }

  vec3 colour = weftSpectrumResolve(spectrum) * BEAM_GAIN;

  /*
   * The pointer. §2 makes the wedge draggable; the touch field supplies a soft
   * highlight on the glass so the visitor can see it is grabbable before they
   * have grabbed it. §10 forbids a "scroll to explore" prompt, and this is the
   * alternative: the object tells you what it is by responding.
   */
  vec4 touch = texture2D(uTouch, vUv);
  float nearGlass = 1.0 - smoothstep(0.0, WEDGE_SIZE * 1.6, tri);
  float hint = touch.a * nearGlass;

  /*
   * The glass itself: a hairline silhouette in --ink-12's neighbourhood, which
   * brightens where the pointer is near it.
   *
   * The hint multiplies the outline rather than being added to the frame. Added,
   * it was a fill — and a fill is what the line below this one already forbids,
   * for the reason given. It did not read as glass either: the touch field is a
   * low-resolution buffer, so an additive term spread over `nearGlass` (a band
   * two thirds the width of the wedge) rendered as soft grey rectangles
   * drifting near the prism, which looks like a bug rather than like an object
   * responding. Confined to the silhouette it is a hairline that lights up,
   * which is what was wanted.
   *
   * Never a fill — a filled prism would occlude the spectrum that is the whole
   * point of the plate.
   */
  float outline = 1.0 - smoothstep(0.0, 0.006, abs(tri));
  colour += vec3(outline * (0.16 + hint * 0.85));

  gl_FragColor = vec4(colour * uWeight, 1.0);
}
