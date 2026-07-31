# BLOCKERS

Anything that survived five inner-loop iterations without being solved. Empty is the goal
(§0.3). Per §12.4, every entry that is still here at the end must carry a written reason it
is acceptable to ship.

An entry here is not "something I deferred". Deferred work lives in `STATE.md`. This file is
for things I tried to solve and could not.

---

## Open

### B-001 · Plate IV's refraction destroys the specimen it is meant to reveal

**Status:** built, verified as far as the simulation, **not mounted**.

The cloth works. It is a GPU Verlet solver with structural, shear and bend constraints and
long-range attachments, it drapes from two pinned corners, the pointer collides with it, and
the specimen is sampled through it — all of that is verified by capture, and the captures are
in `docs/verification/`.

What does not work is the last step. §2 asks that the photograph be "legible only through the
distortion". It is not legible at all: the plate renders as oil-slick iridescence.

**Diagnosis, and it is a real one rather than a guess.** The colour is supposed to come from
sampling the specimen at sixteen wavelength-dependent offsets, per D-028. That requires the
offsets to be *small relative to the features of the photograph* — neighbouring wavelengths
should land on the same stone and differ slightly, not on different stones. `gravel.png` is
512 px square and the plate magnifies it, so a two-texel offset already crosses an edge
between grains. Every wavelength therefore samples an unrelated value and the result is
chroma noise that survives any refraction strength.

The evidence is that the strength constant does not control it. Four values were tried —
0.42, 0.12, 0.055, 0.012, a factor of thirty-five — and the image is structurally the same at
all of them. A term that does not respond to its own coefficient is not the term producing
the effect.

**Next step, specific:** the specimen needs a lower spatial frequency relative to the offset.
In order of preference: sample it through a mip level chosen from the offset magnitude (so the
lookup is band-limited to the spread, which is what a real refracting surface does anyway); or
pre-blur the texture; or find a lower-frequency CC0 macro photograph, though the sandbox's
network constraints (D-027) make that the expensive option.

**Why it is not shipped meanwhile.** §0.4 forbids placeholder content and §10 forbids shipping
something that looks like a bug. A plate that reads as an iridescent smear is worse than a
plate that is not there, and the scroll ranges tile [0,1] either way. The component, its
shaders, the specimen and its licence record are all committed; only the mount in `Stage.tsx`
is commented out, with a pointer to this entry.

---

## Environmental constraints — not blockers, recorded so they are not rediscovered

These are properties of the build sandbox, not of the artifact. Each has a resolution
already applied; they are listed here because they will look like blockers to anyone who
picks this up cold and tries to reproduce a step.

| Constraint                                  | Effect                                                          | Resolution                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| No GPU; SwiftShader only                    | Absolute frame times are software-rasteriser numbers            | Perf harness gates on `render − baseline`, not on an absolute. Tier figures stay in `[BRACKETS]` until L5 on real hardware. D-006. |
| Egress policy refuses CONNECT to most hosts | `21st.dev`, `threejs.org`, `iquilezles.org`, Framer unreachable | References cited to primary sources fetched via `raw.githubusercontent.com` and located by web search. D-007.                      |
| `cdn.playwright.dev` unreachable            | `playwright install` fails                                      | Chromium resolved from `PLAYWRIGHT_BROWSERS_PATH`. D-008.                                                                          |
| Two paper PDFs undownloadable               | CIE fit coefficients and Cauchy constants unavailable           | Neither is typed from memory. Both validated numerically against tabulated data in L1 unit tests, per §0.4. D-007.                 |
