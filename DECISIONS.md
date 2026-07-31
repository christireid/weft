# DECISIONS

Every choice the spec delegated, with the reason. Architectural decisions large enough to
need their own reasoning live in `docs/adr/`; this file is the ledger, including the small
ones.

Format: **D-NNN · loop · what was decided · why.**

---

## D-001 · L0 · Vite 6 pinned, not Vite 8

§5.1 names Vite 6. Vite 8 is current. Pinned to `vite@6.4.3` as specified, with
`@vitejs/plugin-react@5.2.0` (peer range `^4.2 || ^5 || ^6 || ^7 || ^8`) and `vitest@4.1.10`
(peer range `^6 || ^7 || ^8`) — a fully supported combination, checked against published peer
ranges rather than assumed. The spec's stack table is a made decision, not a delegated one,
and nothing in the build needs a Vite 7+ feature. Revisit only if a dependency forces it.

## D-002 · L0 · TypeScript 6.0.3, not 7.x

`typescript@7` is published. `typescript-eslint@8.65.0` declares
`typescript: ">=4.8.4 <6.1.0"`. Type-aware linting across the whole source tree is worth
more here than being on the newest compiler, and running the linter outside its supported
range is the kind of thing that fails silently rather than loudly. TS 6.0.3, strict, plus
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.

## D-003 · L0 · Annotations are set in `--ink-60`, not `--ink-35`

**This is the one place the token layer departs from §3.1's table, and it is a conflict
between two parts of the spec rather than a preference.**

§3.1 assigns `--ink-35` to "annotations, rules". Composited over `--void`, `--ink-35` is
`rgb(90,90,90)`, a contrast ratio of **2.95:1**. WCAG AA requires 4.5:1 for text at
11–12px. §6.1, §6.3, the L0 exit gate (Lighthouse a11y ≥ 95) and rubric axis 6 all depend
on passing that.

Resolution: the five token **values** in §3.1 are shipped exactly as specified and are
asserted verbatim in `tests/tokens.test.ts`. What changes is the **assignment**. Annotation
_text_ is set in `--ink-60` (**6.88:1**). `--ink-35` is reserved for leader rules and the
Specimen Mode wireframe — marks that carry no information their adjacent text does not
already carry, and so are decoration under WCAG 1.4.11.

The visual hierarchy `--ink-35` was providing by value is provided by size and tracking
instead: 12px mono at `0.14em` uppercase does not compete with 21px Geist at any value.
Verified by looking at the L0 capture, not by reasoning about it.

Guard: `tests/contrast.test.ts` fails the build if `--ink-35` or `--ink-12` is ever used as
a `color:`. Measured ratios for all four inks are recorded in that test so a token edit
that moves one shows up as a diff.

## D-004 · L0 · Latin subset only, three variable faces, all preloaded

§3.2 names Bodoni Moda (variable, `opsz`), Geist Sans, Geist Mono. Shipped from the
Fontsource OFL distributions, latin subset only, copied into `public/fonts` by
`pnpm fonts:sync` so the served bytes are checked in and auditable rather than resolved at
build time from whatever the lockfile points at. 96.5 KB total (45.2 / 28.7 / 22.6). All
three appear in the first viewport, so all three are preloaded.

Dropped: the math, symbol, cyrillic, greek and vietnamese subsets Fontsource also publishes.
Every string on this site is in §4 and none of them leave latin.

## D-005 · L0 · `opsz` is bound to viewport width, not to font-size

§3.2 says "drive `opsz` from viewport width". Implemented as
`font-variation-settings: 'opsz' clamp(24, 6vw, 96)` rather than tying the axis to the
computed font-size. The reason is the L2 dependency: the display face's hairlines are what
the Plate II dispersion pass fringes against, and binding `opsz` to the viewport keeps the
hairlines thinning past the point where the font-size clamp tops out. Confirmed by looking
at the L0 capture at 2880×1800 — the serifs of the W render as true 1px hairlines.

## D-006 · L0 · The perf harness measures four series, and gates on a difference

§7's L0 exit gate is "a blank void page at 60 fps with DPR 2". There is no GPU in the build
container; every frame is rasterised by SwiftShader, where filling a 2880×1800 framebuffer
costs ~17 ms regardless of what is drawn into it. Asserting an absolute 60 fps there would
either fail for a reason that has nothing to do with the site, or pass by being weakened
until it meant nothing.

So `tools/perf.spec.ts` samples four series every run — `idle` (no canvas: the compositor's
rAF ceiling), `baseline` (a bare `gl.clear()` loop at the same size and DPR), `render` (the
site with the DOM layer hidden), `weft` (the site as shipped) — and gates on
`render − baseline`: the cost the renderer adds over the framebuffer it draws into.

Measured at L0: idle p50 16.7 ms, baseline p50 16.7 ms, render p50 17.1 ms, weft p50 21.3 ms.
**Renderer cost 0.4 ms. DOM-composite cost 4.2 ms.** The void page holds the 60 Hz cadence
with the renderer running; the only thing off-cadence is SwiftShader blending the 200 px
text layer on the CPU, which is GPU work on real hardware.

The absolute tier-1 figure stays in `[BRACKETS]` until L5 measures it on real hardware, per
§0.4. `docs/verification/perf.json` carries the renderer string so the two can never be
confused. On a non-software renderer the harness additionally asserts the §5.6 tier-1
contract (p95 < 16.6 ms) automatically.

## D-007 · L0 · Reference gathering is cited to primary sources, not screenshots

§7 L0 task 3 names `21st.dev` and Framer's showcase. The build sandbox's egress policy
refuses a CONNECT to both (403 at the gateway, not the origin); `raw.githubusercontent.com`
and web search are allowed. Rather than describe pages I could not open, `RESEARCH.md`
cites each technique to a paper or to an implementation whose source I fetched and read,
with the file and line numbers. Twelve entries, plus a table of rejected directions.

Two entries are marked **[to validate in L1]** because the primary source could not be
downloaded: the CIE colour-matching fit coefficients and the Cauchy glass constants. Neither
number will be typed from memory — both get validated numerically against tabulated data in
the shader chunk's unit test, per §0.4.

## D-008 · L0 · Chromium is resolved from disk when the CDN is unreachable

`playwright install` cannot reach `cdn.playwright.dev` from this sandbox (403). Both
`playwright.config.ts` and `tools/lighthouse.mjs` fall back to the newest
`chromium-<rev>` found under `PLAYWRIGHT_BROWSERS_PATH`, overridable with `WEFT_CHROMIUM`,
and return `undefined` when neither applies so a normal `playwright install` setup is
unaffected. Revision skew is harmless here — nothing in the capture or audit path depends on
protocol features newer than the installed build.

## D-009 · L0 · The clear-colour assertion isolates the canvas from the page

A screenshot of WEFT is `#050507` whether or not the renderer ever drew a frame, because the
body is also `#050507`. So `tools/capture.spec.ts` paints the page behind the canvas magenta
and hides the document layer before sampling. Anything still reading `#050507` can only be
coming from the WebGL framebuffer. Measured delta at L0: **0**, at DPR 2, backing store
2880×1800.

## D-010 · L0 · Sitemap deferred, robots.txt shipped

Lighthouse SEO reported 91 on the empty page, from a missing `robots.txt`. Shipped.
`sitemap.xml` needs the deployed origin, which is not known until L6; it is listed in
`STATE.md` as an L6 task rather than shipped with a guessed URL.

## D-011 · L1 · Disney's 12 principles apply to the DOM layer and the camera, not to the simulation

A motion-design brief covering the 12 classical animation principles was applied to this
build. Most of it lands cleanly. Two parts of it directly contradict the spec, and the spec
wins both times — recorded here so the contradiction is a decision rather than an oversight.

**Conflict 1 — easing physical motion.** The brief prescribes overshoot and elastic curves
(`cubic-bezier(0.34, 1.56, 0.64, 1)`), anticipation as a scripted counter-move, and
exaggeration via scale beyond 1.0. §5.5 says: _"Physical motion (thread, cloth, shards) is
simulated, never eased. Do not tween something that has mass."_

These are not really in tension once you see what the principles are _for_. Squash-and-
stretch, anticipation and overshoot are how a keyframe system **fakes** mass it cannot
simulate. WEFT simulates mass — a travelling wave with exponential amplitude decay, a verlet
cloth with constraint projection, shards with angular momentum. Applying an elastic ease on
top of a solver that already produces elasticity is double-counting, and it reads as wrong
immediately: the thread gets a rubberiness that does not correspond to any tension.

So the split is:

| Layer                                                                          | Motion source                          |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| DOM micro-motion — type reveal, annotation entrance, spool gauge, focus states | Eased, on the §5.5 curve family        |
| Camera and staging choreography                                                | Scroll-scrubbed; no duration (§5.5)    |
| Thread, particles, cloth, glass, shards                                        | Simulated. Never eased, never tweened. |

Several principles apply to the simulated layer _as outcomes rather than as techniques_, and
that is the correct way to get them here: **follow-through and overlapping action** emerge
from wave propagation and damping; **arcs** are what a catenary and a curl-noise streamline
already are; **secondary action** is the dispersion fringe responding to displacement,
driven by the same physics rather than authored alongside it. If those read as absent once
the plates exist, the fix is in the simulation constants, not in an added tween.

**Conflict 2 — the easing curves themselves.** The brief gives `cubic-bezier(0.4, 0, 0.2, 1)`
(Material's standard) and an enter/exit pair. §5.5 mandates `cubic-bezier(0.16, 1, 0.30, 1)`
entering and `cubic-bezier(0.7, 0, 0.84, 0)` exiting, and the _reason_ it mandates them is
that one family across DOM and GPU is what stops the piece feeling assembled from parts.
Shipping two easing families would defeat the token. The spec's curves are already in
`--ease-enter` / `--ease-exit` and are asserted in `tests/tokens.test.ts`; the brief's are
not used.

**Adopted without conflict:** transform/opacity only for anything animated on the DOM layer;
`will-change` used sparingly and removed after; staging as motion hierarchy; timing bands
(the brief's 100–200 ms micro is a superset of §5.5's 120–180 ms); consistent
`transform-origin`. The brief's "prefer CSS over JavaScript when the animation is
predictable" is also adopted and is why the spool gauge and type reveals are CSS/Framer and
not GSAP tweens.

**Not applicable:** the Remotion guidance in the same set. Remotion renders video frames to
a file. §0.4 rule 3 forbids pre-rendered video anywhere in this site, and the colophon's
central claim is that every frame is computed live on the visitor's machine. The one place
video is produced at all is `docs/media/` in L6 — capture _of_ the site for the README, by
Playwright and ffmpeg, which is a documentation artifact and not part of the page.

## D-012 · L1 · The CMF coefficients are fitted here, not transcribed

`RESEARCH.md` §5 flagged this as **[to validate in L1]**: the Wyman/Sloan/Shirley paper
(JCGT 2(2) 2013) is unreachable from this sandbox, and §0.4 forbids inventing numbers, so
its coefficients could not be used.

Resolution: take the **functional form** from the literature and cite it — each colour-
matching curve as a small sum of _piecewise_ Gaussians, which have different widths either
side of their peak and so can follow the CIE curves' asymmetry — and **fit the coefficients
here**, with `tools/fit-cmf.mjs`, to tabulated CIE 1931 2° data checked into `tools/data/`.
Seeds come from the data itself (peaks by local maxima, widths by half-width-at-half-
maximum), not from recalled values. Optimiser is a hand-rolled Nelder-Mead with restarts —
no scipy in this container, and a 60-line optimiser in the repo is more auditable than a
dependency anyway.

Lobe counts 3/2/2 for x̄/ȳ/z̄. More lobes were tried (up to 4/3/3) and did not improve the
worst-case error at all, so the cheapest configuration that reaches it is the one shipped:
seven piecewise Gaussians total.

**Measured against the tabulated table, 361 samples at 1 nm, on the GPU:**

| curve | rmse    | max abs error |
| ----- | ------- | ------------- |
| x̄     | 7.71e-3 | **0.0202**    |
| ȳ     | 3.03e-3 | **0.0073**    |
| z̄     | 4.53e-3 | **0.0221**    |

Two independent checks that the fit is the real thing rather than a plausible curve:
ȳ peaks at **0.9977 at 554 nm** (the CIE definition is exactly 1.0 at 555 nm), and a flat
spectrum resolves to **exactly (1,1,1)** at N = 4, 8, 16, 32 and 64 samples.

The XYZ→linear-sRGB matrix is derived in the same script from the IEC 61966-2-1 primary
chromaticities and D65, by inverting the RGB→XYZ matrix built from them. It comes out as
the standard sRGB matrix to eight decimal places, which is the check that the derivation is
right — and it maps D65 to (1.00000, 1.00000, 1.00000) on the GPU.

## D-013 · L1 · Curl uses central differences, not an analytic gradient

`RESEARCH.md` §4 left this open with a measurable answer required. §2 asks for curl "derived
analytically from the gradient of a 3D simplex field"; webgl-noise's `snoise` returns the
value only, so the options were central differences (6 noise evaluations per component set)
or rewriting `snoise` to return its gradient (3, but a modified copy of a well-known file).

Chose **central differences**, for a reason that outweighs the arithmetic: `simplex3d.glsl`
is shipped verbatim from Ashima's original apart from symbol renaming, and being able to
diff it against upstream and see that the maths is untouched is worth more than saving nine
noise evaluations per particle. A hand-modified derivative-returning variant is exactly the
kind of file that acquires a subtle error nobody can find. §9.1's "engineer reading the
source for signs of copy-paste" is better served by an unmodified copy plus an honest note.

The property that matters survives: the field is still the curl of _something_ (the
finite-difference potential), so it is divergence-free to the same order. Verified on the
GPU over 1024 scattered points: **max |∇·v| / ‖∇v‖\_F = 6.98e-3**, against a mean field
magnitude of 3.50 and mean gradient norm of 34.3.

The measure matters as much as the number. Dividing divergence by _speed_ — the obvious
thing — is dimensionally meaningless, since divergence has units of velocity per length; it
reported 7.7% and would have changed answer if the noise were simply rescaled. The
dimensionless ratio is divergence over the Frobenius norm of the velocity gradient, and by
that measure the field is 0.7% off divergence-free, which is the fp32 cancellation floor for
two stacked central differences rather than a property of the field.

ε is 1e-3: smaller loses the difference to fp32 cancellation, larger low-passes the curl and
costs the small eddies that make the fray read as turbulence.

## D-014 · L1 · The wedge glass is fictional, and says so

`RESEARCH.md` §6 flagged the Cauchy A/B constants as **[to validate in L1]**. Rather than
attribute a real glass whose catalogue values I could not fetch — which would be a
fabricated number under §0.4 — the wedge is parameterised by its two **endpoint indices**,
and A and B are solved from them in `weftCauchyFromEndpoints`.

This is the honest framing rather than a workaround: WEFT documents a material that does not
exist (§1), so its glass need not be N-BK7. What is real and load-bearing is Cauchy's
_form_, n(λ) = A + B/λ² — the 1/λ² term is what makes the fringe read as dispersion rather
than as a gradient, because real dispersion is compressed at the red end.

Expressing it through endpoints also makes the choice legible at the call site: "this glass
bends 380 nm at 1.62 and 740 nm at 1.58" instead of two opaque constants. Verified on the
GPU: endpoints exact to 5 decimal places, monotonically decreasing across the band, and the
midpoint sits **below** the linear interpolation of the endpoints — which is what
distinguishes an actual 1/λ² curve from a lerp between two IORs.

## D-015 · L1 · Shader chunk tests run in Playwright, not vitest

§8.2 item 1 requires rendering each chunk to a small target and asserting known pixel
values. jsdom has no WebGL, so these cannot run in vitest — a shader unit test that does not
run a shader is not a shader unit test. `tools/shaders.spec.ts` compiles each chunk into a
fragment shader, renders to an **RGBA32F** target in a real WebGL2 context, and reads the
pixels back.

Float target, not RGBA8: asserting a colour-matching fit to ±0.02 through an 8-bit target
means asserting against a 1/255 = 0.0039 quantisation floor, close enough to the tolerance
to make a passing test meaningless.

Every chunk is checked against something **independent of itself** — tabulated CIE data, an
independent JS bezier solver, an analytic identity, or a property that must hold
mathematically. A shader test that asserts the shader agrees with itself catches nothing.

Two tolerance failures on the first run were my tests' fault, not the shaders', and both are
worth recording because both would have been easy to "fix" by loosening a threshold:

- The SDF test recomputed its sample points in JS with `Math.cos`/`Math.sin`, which differ
  from GLSL's in the last ulps; at radius 2.5 that exceeded the tolerance the SDFs deserve.
  Fixed by having the shader report the points it actually used and comparing against those.
- The curl test used the dimensionally-wrong divergence measure described in D-013.

## D-016 · L1 · The void is applied after tone mapping, not before

Found by the capture assertion, not by reasoning — which is the whole reason that assertion
exists.

The composite pass was written to tone map, encode and dither. With the scene buffer cleared
to `--void`, the captured background came out as **rgb(1.5, 1.5, 1.8)** instead of
`#050507`. ACES compresses the bottom of its range by roughly 4×, which is correct behaviour
for _light_ and wrong for a page colour.

`#050507` is an authored value from §3.1. It has to appear on screen as itself, and it also
has to match the CSS `--void` behind the canvas or the seam is visible at every edge of the
composition.

Resolution: the scene buffer clears to **black**, everything the renderer produces is
treated as light, and the void is the floor that light sits on —
`weftLiftOverVoid(encoded, void)` in `tonemap.glsl`, applied after the sRGB encode and
before dither and quantisation. Equivalent to a screen blend and exact at both ends: zero
light resolves to `#050507` to the last code value, full light to white. Asserted on the GPU
and re-asserted end-to-end by the capture spec, which now reads `rgb(4.9, 4.9, 6.9)` — the
0.1 shortfall is the dither, working.

## D-017 · L1 · Dither strength 0.035, verified by run length rather than by eye

§3.4 gives the window 0.02–0.06 and warns "too much and it reads as a filter". 0.035, with
the stochastic term mixed at 0.35 over the ordered matrix.

The verification that matters is not "how many distinct levels" but **run length**. Banding
is visible as contour _edges_: a gradient quantised to 8 bits holds one output value for a
long run of pixels and then steps, and the eye finds the step. Measured on a 0→0.02 linear
ramp across 1024 samples — the darkest 2% of the range, where the void's gradients live:

|            | max run length | distinct levels |
| ---------- | -------------- | --------------- |
| undithered | **61 px**      | 27              |
| dithered   | **3 px**       | 35              |

A 20.3× reduction. Three device pixels at DPR 2 is 1.5 CSS pixels — below the width at
which a contour edge is resolvable. Recorded in `docs/verification/banding.json`.

The control matters as much as the result: the test asserts the _undithered_ ramp does band
(run > 60 px), because a test where the control passes is measuring nothing.

## D-018 · L1 · The tone map and encode are library chunks, not pass-private

Refactored mid-task, prompted by a test failure that was really a design signal: the shader
harness could not include `composite.frag.glsl` because a pass file carries its own
`varying` declarations and `main()`, which collide under GLSL ES 3.00.

The fix could have been a shim that strips them. Instead `weftACES`, `weftLinearToSRGB` and
`weftLiftOverVoid` moved into `src/shaders/lib/tonemap.glsl`, which is better regardless:
the shard pass in Plate VI needs the same encode, and it means the tests exercise **the
exact functions the pass ships** rather than a reimplementation of them in the test body.
A test that reimplements what it is testing is a test of the reimplementation.

## D-019 · L1 · Software-rasteriser frame cost is bounded separately from the GPU contract

Adding the composite pass took a frame under SwiftShader from ~21 ms to ~240 ms. That is
explainable and specific: the sRGB encode is three `pow()` per pixel over 5.2M pixels, about
15M transcendentals per frame — microseconds on a GPU, a quarter of a second in software.

Rather than weaken the renderer-cost assertion until it passed everywhere, the harness now
carries two ceilings and picks by detected renderer: the real contract on hardware, and a
loose regression tripwire on a software rasteriser, with the renderer string in the artifact
so the two can never be confused. Frame counts and test timeouts were raised to match; the
L1 heap gate walks 600 frames, which is ~2.5 minutes of wall clock here.

This is the same principle as D-006 and it keeps applying: measure, state which machine the
number came from, and never let a container's limitation become the shipped claim.

## D-020 · L2 · The wedge glass has an Abbe number no real glass has

Plate II's first pass used endpoint indices 1.62 / 1.58 — roughly a real crown glass. The
deviation spread across the entire visible band was then about 6%, far narrower than the
beam's own angular width, so the light **bent without visibly separating**. Physically
faithful, and at this throw distance a failure of the plate's one job: a real prism needs
close to a metre of throw to fan a spectrum, and this one has half a viewport.

Changed to 1.78 at 380 nm and 1.46 at 740 nm — about ten times the dispersion of a real
flint glass. This is the payoff of D-014 rather than a fudge of it: WEFT documents a material
that does not exist, so its wedge is not obliged to be N-BK7. What has to stay real is
Cauchy's _form_, the 1/λ² law, and it does — the red end of the fan is visibly compressed
relative to the blue, which is the signature that distinguishes dispersion from a gradient.

The beam was thinned at the same time (0.030 → 0.008 across the plate), because the fan is
only resolvable when the angular spread between wavelengths exceeds the beam's own angular
width. A fat beam hides its own spectrum.

Verified by looking: violet deviated most, through green, to red least, continuous across the
fan with no banding between wavelengths and no ghosted copies. That last property is what
rubric axis 3 scores and it is why §5.1 rejects the stock three-sample ChromaticAberration
pass.

---

## Delegated copy (§4.3)

Recorded here so it can be edited in one place, per §4.3. Written in the §4.1 voice: present
tense, observational, short sentences, no marketing adjectives.

_Plate subtitles II–VI, the Plate V body passage (90–140 words), and the annotation strings
are written in L4 and land here as they are written. Nothing is drafted early — §0.2 forbids
scaffolding for future tasks, and copy written before the plate exists describes something
imagined rather than something observed, which is exactly the voice §4.1 rules out._

Fixed strings from §4.2 are **not** repeated here. They live in `src/config/identity.ts` and
in the plate table, and duplicating them would create two places to edit one string.
