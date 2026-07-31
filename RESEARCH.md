# RESEARCH — reference gathering (L0, task 3)

What each reference contributes to WEFT, and what was deliberately not taken from it.

## A note on method, and on what was reachable

The brief names `21st.dev/community/components/s/{shader,background,animated-hero}` and
Framer's motion showcase as browsing targets. This build ran inside a sandbox whose egress
policy allows the npm registry, `raw.githubusercontent.com`, and web search, and refuses a
CONNECT to everything else — `21st.dev`, `threejs.org`, `iquilezles.org` and Framer all
return `403` at the gateway, not at the origin. Verified:

```
$ curl -sS -o /dev/null -w "%{http_code}" https://21st.dev/community/components/s/shader
curl: (56) CONNECT tunnel failed, response 403
$ curl -sS -o /dev/null -w "%{http_code}" https://raw.githubusercontent.com/mrdoob/three.js/dev/README.md
200
```

So there are no reference screenshots in this file, and I am not going to describe pages I
could not open. What I did instead is stronger for this particular build: every technique
below is cited to a primary source — a paper, or an implementation whose source I fetched
and read — with the specific file and line I read. The brief's own warning about registries
("it will supply DOM-layer patterns and some background shaders, not the six plates")
points the same way. A registry component would have given direction; these give the maths.

Where a reference is a paper I could not download in full, that is stated, and the
implementation derived from it is validated numerically in a unit test rather than trusted.
Those validations are the entries marked **[to validate in L1]**.

Attribution for everything actually shipped is duplicated in `CREDITS.md`.

---

## 1 — Screen-space ribbon expansion

**Source** `mrdoob/three.js` · `examples/jsm/lines/LineMaterial.js` (read at `dev`, 726 lines)
**Read** lines 175–251.

The technique: a line segment is drawn as instanced quad geometry, and the vertex shader
displaces each corner _after_ projection, along the screen-space normal of the segment
direction, by `linewidth` scaled by `clip.w` and divided by `resolution.y`. Aspect is
applied to `dir.x` before computing the perpendicular and undone afterwards:

```glsl
float aspect = resolution.x / resolution.y;
dir.x *= aspect;
vec2 offset = vec2( dir.y, - dir.x );
dir.x /= aspect; offset.x /= aspect;
offset *= linewidth; offset /= resolution.y; offset *= clip.w;
clip.xy += offset;
```

**Taken:** the post-projection offset with the `clip.w` multiply. That multiply is the whole
trick — it makes the ribbon's width perspective-correct so a filament receding toward the
vanishing point in Plate I's exit transformation thins the way a real thread would.

**Not taken:** `LineMaterial` itself. §2 Plate I requires the ribbon to _taper_ along its
length and to be displaced by a wave, so the width is a per-vertex varying, not a uniform.
The class also carries dashing, world-units mode and mitre handling that Plate I has no use
for. WEFT writes its own instanced-quad material against this idea.

---

## 2 — GPGPU ping-pong

**Source** `mrdoob/three.js` · `examples/jsm/misc/GPUComputationRenderer.js` (read at `dev`, 508 lines)
**Read** lines 117–140, 195–215, 250–315.

Two render targets per variable; `currentTextureIndex` flips each `compute()`; dependencies
are bound from `renderTargets[current]` while the shader writes `renderTargets[next]`; the
index flips only after every variable has been written, so variables within a step all read
the same generation.

**Taken:** the read-current/write-next-then-flip ordering, and the detail that the flip
happens once per step rather than once per variable. Getting that wrong makes velocity read
a position from the frame it is currently producing, which shows up as a shear in the
particle cloud that looks like a plausible fluid effect and is actually a bug.

**Not taken:** the class. It allocates a `ShaderMaterial` and a fullscreen mesh per variable
and re-binds uniforms by name every compute, and §5.2 forbids per-frame allocation. Plate III
needs exactly two variables (position, velocity) at one resolution, so WEFT keeps two
pre-allocated `WebGLRenderTarget` pairs and a single fullscreen triangle.

---

## 3 — Simplex noise, textureless

**Source** `ashima/webgl-noise` · `src/noise3D.glsl` (Ian McEwan, Ashima Arts; maintained by
Stefan Gustavson). MIT, licence header read in file.

**Taken:** `snoise(vec3)` as the potential field underneath the curl in Plate III. It is
textureless, which matters because the curl needs six evaluations per particle per frame and
a texture fetch per evaluation would dominate the step.

**Not taken:** nothing — but note this file provides the _value_ only, not its derivative.
See reference 4.

---

## 4 — Curl noise

**Source** Bridson, Hourihan, Nordenstam, _Curl-Noise for Procedural Fluid Flow_, ACM
SIGGRAPH 2007. `https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf`
(paper page located by search; PDF not downloadable through the sandbox gateway).

The result being used: taking `v = ∇ × ψ` of a vector potential `ψ` gives a velocity field
that is exactly divergence-free by construction, so particles advected through it never
bunch or thin out the way they do in a raw noise field. That is precisely the difference
between "particles in a fluid" and "particles in a lava lamp", and it is the reason Plate III
uses curl at all.

**Decision this forces:** §2 says the curl must be derived _analytically_ from the gradient
of the simplex field. Reference 3 gives the noise value but not its gradient, so WEFT
computes the three partials by central differences at a fixed epsilon **or** carries a
derivative-returning variant. Which of the two is an L1 decision with a measurable answer —
central differences cost 6 noise evaluations per particle, the analytic derivative costs 3
but needs a rewritten `snoise`. It gets benchmarked, not guessed, and recorded as an ADR.

**[to validate in L1]** unit test: the divergence of the resulting field, sampled on a grid,
must be zero to within float epsilon. That test is the whole point of using curl and is
cheap to write.

---

## 5 — Spectral rendering: wavelength → XYZ

**Source** Wyman, Sloan, Shirley, _Simple Analytic Approximations to the CIE XYZ Color
Matching Functions_, JCGT 2(2), 2013. `https://jcgt.org/published/0002/02/01/`
Supplemental code: `github.com/JournalOfComputerGraphicsTechniques/TEST-0002-02-01-Wyman-Sloan-Shirley`
(paper and repo located by search; neither downloadable through the gateway).

The paper fits the CIE 1931 x̄/ȳ/z̄ curves with small sums of piecewise Gaussians, accurate
enough that the fitting error is below the variance between the human-subject datasets the
CIE standard was aggregated from. That is what makes a 16-sample spectral loop affordable in
a fragment shader: no LUT texture, no tabulated array, three closed-form evaluations per
wavelength.

**Taken:** the approach — analytic multi-lobe Gaussian fits, evaluated per wavelength inside
the dispersion loop, accumulated in XYZ and converted to linear sRGB once at the end.

**[to validate in L1]** I could not fetch the coefficients, and §0.4 forbids inventing
numbers. `spectral.glsl` will therefore be validated against tabulated CIE 1931 2° data:
render the fit to a 64×64 target across 380–740 nm and assert the resulting chromaticities
track the tabulated locus within a stated tolerance. If the fit cannot be reproduced to that
tolerance the fallback is a 1D LUT texture built from tabulated data at build time — slower
to author, identically correct, and recorded as an ADR either way.

**Why this rather than an RGB split:** §2 Plate II is explicit, and it is the single largest
quality difference in the piece. A three-sample R/G/B offset produces three ghosted copies
with visible seams between them. A 16-sample spectral accumulation produces a continuous
edge, because adjacent wavelengths land adjacent on screen. Rubric axis 3 scores exactly
this.

---

## 6 — Dispersion: index of refraction per wavelength

**Source** Cauchy's empirical equation, `n(λ) = A + B/λ²` (+ higher terms). Standard optics;
coefficients for common optical glasses are published per material.

**Taken:** the `B/λ²` term is what actually separates the spectrum in Plate II. Using a
single IOR and offsetting the sample position instead would produce a rainbow whose spacing
is linear in wavelength, which reads subtly wrong — real dispersion is compressed at the red
end. One term, and the fringe stops looking like a gradient.

**[to validate in L1]** the A and B used are stated in the shader header with the glass they
correspond to, and the resulting IOR at 380 and 740 nm is asserted in the chunk's unit test
so a later tweak cannot silently make the wedge behave like a material that does not exist.

---

## 7 — Position-based / verlet cloth

**Source** Jakobsen, _Advanced Character Physics_, GDC 2001 — the relaxation formulation
behind essentially every real-time cloth solver.

**Taken:** integrate positions with verlet (`x' = 2x - x_prev + a·dt²`, no stored velocity),
then satisfy distance constraints by iterated projection. Because there is no velocity term,
constraint projection _is_ the damping, which is why this survives being run in a fragment
shader where each texel can only see its neighbours.

**Adaptation forced by the GPU:** Jakobsen relaxes constraints in sequence (Gauss-Seidel);
a fragment shader must relax them in parallel (Jacobi), because every texel is written
simultaneously. Jacobi converges more slowly for the same iteration count, which is why §2
Plate IV budgets 8–16 iterations rather than the 2–4 a CPU solver would need. This is the
kind of detail that separates a working GPU cloth from one that visibly stretches.

**[to validate in L1/L3]** assert that total constraint error decreases monotonically across
iterations at fixed input.

---

## 8 — Thin-film iridescence

**Source** Belcour & Barla, _A Practical Extension to Microfacet Theory for the Modeling of
Varying Iridescence_, SIGGRAPH 2017 — the model behind `iridescence` in three.js's
`MeshPhysicalMaterial` and in glTF's `KHR_materials_iridescence`.

**Taken:** thin-film interference as a function of film thickness and view angle, which is
what §2 Plate IV asks for ("physically motivated, not a gradient overlay"). The distinction
that matters: the hue must shift with _grazing angle_, so it appears at the silhouette of a
fold and vanishes where the cloth faces the camera. A gradient overlay cannot do that, and
the failure is obvious the moment the cloth moves.

---

## 9 — Ordered dithering and blue noise

**Source** Bayer, _An optimum method for two-level rendition of continuous-tone pictures_
(1973), for the 8×8 threshold matrix; Ulichney, _Digital Halftoning_ (1987), for why blue
noise beats white noise as a dither source.

**Taken:** the recursive construction of the 8×8 Bayer matrix, and the pairing of ordered
dither with a blue-noise term. §3.4 calls this the piece's one aesthetic risk; it is also
load-bearing engineering. The void is `#050507` and the plates are full of long, dark
gradients, which is exactly where 8-bit output bands. Dithering before quantisation converts
that banding into structured texture — and the structure reads as the halftone of a printed
plate, which is the conceit.

**The failure mode to avoid:** applied at too high an amplitude, or applied after tone
mapping rather than before quantisation, it reads as a filter laid over the image. §3.4's
0.02–0.06 range is the tuning window and the value chosen gets recorded once measured.

---

## 10 — ACES filmic tone mapping

**Source** Narkowicz, _ACES Filmic Tone Mapping Curve_ (2015) — the cheap rational fit used
by `ACESFilmicToneMapping` in three.js.

**Taken:** the tone mapper is already configured in `src/gl/Stage.tsx`, and the reason it is
ACES rather than Reinhard or clamp is Plate III. Accumulating 16 wavelengths additively
produces values well above 1.0 in the bright core of the particle cloud. Reinhard desaturates
as it compresses, which would drain exactly the spectral colour the plate exists to show;
a hard clamp produces the flat white blob §2 warns about. ACES rolls off while retaining
saturation into the highlight.

**Related constraint, recorded here so it is not forgotten:** §2 Plate III says to cap
accumulated luminance _in the shader, before_ the bloom pass, not after. Tone mapping alone
does not save additive-plus-bloom from white-out, because bloom samples the pre-tone-mapped
buffer.

---

## 11 — Scroll: Lenis + GSAP ScrollTrigger

**Source** `darkroomengineering/lenis` and GSAP ScrollTrigger, both named in §5.1.

**Taken:** Lenis owns the RAF loop and publishes a smoothed scroll position; ScrollTrigger
handles pinning and scrubbed timelines. The architecture point in §5.2 is that this must be
_one_ subscription writing into a vanilla zustand store read outside React — reading scroll
progress through `useState` re-renders the tree at 60 Hz and is the single most common way a
piece like this ends up janky despite a fast renderer.

**Not taken:** drei's `ScrollControls`, which owns its own scroll container and fights both
Lenis's smoothing and ScrollTrigger's pins. Rejected in §5.1; recorded here because it is
the obvious-looking choice and the reason against it is not obvious.

---

## 12 — Slit-scan from a frame ring buffer

**Source** The technique predates graphics programming — Douglas Trumbull's slit-scan
photography for _2001: A Space Odyssey_ (1968) is the canonical instance, and the digital
form is the same idea: sample a moving image at a time offset that varies across space.

**Taken:** Plate VI's radial strips each sample a texture atlas of the last 64–128 rendered
frames at an offset proportional to strip angle. §2's requirement that this be "generated
honestly" is the interesting constraint — the spiral must be built from the site's _own_
prior frames, so what the visitor sees at the end is a recording of their own scroll rather
than a decorative spiral. The verification in L3 is specific about this: scroll to VI
immediately after a hard reload and confirm the strips show the buffer _filling_, rather
than garbage or a pre-baked texture.

---

## Deliberately rejected directions

Recorded because rejecting them was a decision, not an oversight.

| Direction                                          | Why not                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A registry background shader as the hero           | §3.1 forbids an accent colour and every registry shader ships a palette. Restyling one to a single white source leaves almost nothing of it, and it would not be the same thread as the other five plates — failing the §1.1 through-line test. |
| `MeshTransmissionMaterial` (drei) for Plate V      | It refracts a cubemap-ish backdrop, not the page's own DOM text. §2 Plate V requires the site's own body copy to be the thing behind the glass; that is a screen-space refraction of a rendered text texture, which is a different pass.        |
| Post-processing `ChromaticAberration` for Plate II | Explicitly rejected in §5.1. It is a three-sample RGB offset and looks like one.                                                                                                                                                                |
| A photograph per plate                             | §10 allows exactly one photograph in the whole site, in Plate IV.                                                                                                                                                                               |
