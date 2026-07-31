# STATE

**Current loop:** L3 · task 1 (Plate IV) built but blocked, see B-001. Plates I–III shipped
**Last updated:** 2026-07-31
**`pnpm verify`:** green — 69 unit tests, 15 shader tests, 6 a11y tests, plus a program-link sweep and a plate-isolation measurement
**BLOCKERS:** one open — B-001, Plate IV's refraction destroys its specimen

---

## Resume from here

If you are picking this up cold, this section is the whole handover.

```bash
pnpm i
pnpm fonts:sync          # copy latin woff2 subsets into public/fonts
pnpm verify              # tsc --noEmit && eslint --max-warnings 0 && vitest run && vite build

pnpm capture --at 0.245 --debug   # a still at a scroll offset, HUD on — then OPEN IT
pnpm shaders             # GPU chunk tests against real WebGL2
pnpm a11y                # axe-core          -> docs/verification/axe.json
pnpm perf                # 4-series sampler  -> docs/verification/perf.json
pnpm gate:l1             # the L1 exit gate  -> docs/verification/gate-l1.json  (~5 min, D-019)
pnpm preview & pnpm lh   # Lighthouse a11y   -> docs/verification/lighthouse.json
pnpm media && pnpm media:gifs     # regenerate the README media
pnpm fit:cmf             # refit the colour-matching curves
```

`D` toggles the debug HUD in the browser, `S` toggles Specimen Mode.

**Next task: finish Plate IV.** It is built and every part of it is verified except the last
one. Read `BLOCKERS.md` B-001 first — it has the diagnosis and the specific next step (sample
the specimen through a mip level chosen from the refraction offset, so the lookup is
band-limited to the spread). The component is written, the specimen is committed with its
licence chain, and only the mount in `Stage.tsx` is commented out.

Three things were learned building it, all of them by measurement after reasoning had failed,
and all of them recorded where they happened:

1. A flat sheet under in-plane gravity is a **degenerate configuration** — it never leaves the
   plane, every normal is ±z, and the refraction term is identically zero. Raising the
   refraction strength 3.5× changed the frame by zero bytes.
2. The first fix, a cylindrical bow, did nothing, because **a cylinder is developable**: it
   flattens without changing any distance, and a solver made of distance constraints has no
   reason to keep it. The rest pose is now a saddle, which by Gauss's Theorema Egregium cannot
   flatten.
3. Twelve Jacobi iterations on a 64-cell sheet do not hold a hanging corner. The failure does
   not look like softness — the sheet **furls into a rope** about a pixel wide, which reads as
   a rendering bug. Sixteen iterations plus long-range attachments (Kim et al., SCA 2012) fix
   it.

**Two things to carry into it**, both learned the expensive way in L2:

1. Read the browser console before reasoning about the GPU. A program that fails to link is not
   an exception — it is one console line and a frame that is quietly missing a pass (RT-13).
   `tools/programs.spec.ts` now sweeps for it, and Plate IV must not be exempted from it.
2. A plate that is not live has to be told its weight is zero, or it keeps drawing (D-026).
   `tools/plates.spec.ts` measures the one bleed that is visible from the frame edge; Plate IV
   sits inside the frame, so it will need its own measurement rather than inheriting that one.

**Plate IV needs a photograph, and this sandbox can reach almost nothing.** §2 wants "a CC0
macro photograph (botanical or mineral)" refracted through the cloth — "the one place a
photograph appears in the whole site" — and §0.4 forbids unlicensed imagery. Probed: only
`raw.githubusercontent.com` answers; `upload.wikimedia.org`, `commons.wikimedia.org`,
`images.pexels.com` and `cdn.jsdelivr.net` all fail to connect. So the image has to come from a
GitHub-hosted repository with an explicit per-file licence, and it has to be fetched by a path
known in advance: `api.github.com` answers but is proxied and scoped to this repository, so
there is no search — `raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` is the only way in,
and it needs the exact path. `KhronosGroup/glTF-Sample-Assets` carries per-model licence READMEs
and is reachable, but its assets are 3-D models rather than macro photography. Resolve this **before** building the cloth, not after: if no properly
licensed photograph can be obtained, that is a §12.4 blocker with a written reason, not a
licence to substitute procedural content — the distorted-image requirement is specifically
about a photograph.

**Capturing anything with a simulation in it needs `--settle`.** This container advances Plate
III at about a sixth of wall-clock, because the plate clamps its timestep to 1/30 s and a frame
here costs ~220 ms. A default capture sees a fifth of a second of physics and reports a cloud
that has not frayed — which says nothing about the plate. `pnpm capture --at 0.40 --settle 45`
is what the L2 captures were taken with.

**Environment notes that will otherwise cost an hour:** there is no GPU here (SwiftShader, so
a frame costs ~220 ms once the composite pass is in the chain — see D-019); `playwright
install` cannot reach its CDN, so Chromium is resolved from `PLAYWRIGHT_BROWSERS_PATH`
automatically; the bundled ffmpeg is built `--disable-everything` and cannot make GIFs, so
`tools/make-gifs.mjs` encodes them directly; most outbound hosts are refused at the gateway.
All documented in `BLOCKERS.md` under "environmental constraints", with workarounds applied.

---

## Ledger

Score is the inner-loop step-5 rating: 1–10 against the task's acceptance criteria **and**
against the §3 art direction. Anything below 8 goes back to step 3.

### L0 · Foundation and reference

| #   | Task                                                                   | Score | Critique                                                                                                                                                               |
| --- | ---------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scaffold: Vite 6 + React 19 + TS strict + ESLint + Vitest + Playwright | 9     | Green after two config fixes; the real design call was making `capture` a node wrapper so `--at` survives Playwright's CLI, which refuses unknown flags.               |
| 2   | Token layer, three variable faces self-hosted and subset               | 9     | Enforced by test rather than convention — and it forced the §3.1-vs-§6 contrast conflict into the open on day one (D-003), better found then than at L5.               |
| 3   | Reference gathering, at least 8 entries                                | 8     | Twelve entries cited to primary sources with file and line numbers, stronger than screenshots; loses a point honestly because the named browsing targets were blocked. |
| 4   | Empty `<Canvas>` clearing to `--void`, correct colour management       | 9     | Clear colour exact to 0/255 at DPR 2, proven against an isolating control rather than asserted.                                                                        |

**Loop score: 9.**

### L1 · Render core

| #   | Task                                                 | Score | Critique                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lenis + ScrollTrigger + scroll store, debug overlay  | 9     | One rAF loop achieved rather than claimed — Lenis runs `autoRaf: false`, stepped from the single `useFrame`; four architecture tests fail the build if a second loop, canvas, Lenis or `gsap.ticker.add` appears.                                  |
| 2   | Plate router: declarative table, activate/deactivate | 9     | Hand-off verified visually and by a 2001-sample exhaustive sweep. The real design call: local `t` runs past 1 and below 0 in the blend band so each plate keeps authority over its own transition instead of being cross-faded between end states. |
| 3   | Touch texture FBO (§5.3) with debug view             | 9     | Correct on all four channels, verified by reading the G quadrant's sign flip at the apex of a drag rather than trusting it; capsule stamping keeps the trail unbroken at 27 px/frame. Cost a real unit bug (device px vs CSS px in `setViewport`). |
| 4   | Shader chunk library (§5.4), unit test per chunk     | 9     | Six chunks, each tested against something independent of itself. The CMF coefficients are fitted here rather than transcribed, closing both `[to validate in L1]` items from `RESEARCH.md` with measured numbers.                                  |
| 5   | Device tiering + rolling frame-time sampler          | 9     | Histogram sampler rather than sort-per-frame, so the p95 costs no allocation; hysteresis verified against the case it exists for — 6000 frames straddling a threshold produce zero switches.                                                       |
| 6   | Post chain with custom dither pass, zero banding     | 9     | Banding reduced 20.3x, measured by run length rather than eyeballed. Cost a real bug — ACES was crushing `--void` to rgb(1.5, 1.5, 1.8), caught by the capture assertion rather than by reasoning (D-016).                                         |

**Loop score: 9.**

### L2 · Plates I–III

| #   | Task                                                       | Score | Critique                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Plate I · TENSIO — ribbon, wave, grab, exit transformation | 8     | A real 1-D wave equation on the GPU, so travelling pulses, reflection-with-inversion at the pinned ends and exponential decay all fall out rather than being authored. Not 9: the first material put the whole spectral fringe inside one pixel, and §2's type/thread crossing is still occluded pending L4. |
| 2   | Plate II · DISPERSIO — wedge, 16-sample spectral fan, drag | 8     | Continuous fan, violet deviated most through to red least, red end compressed by the 1/lambda^2 law, no ghosting. Not 9: §2 also asks the DOM text be composited into the scene so the spectrum falls on the letterforms, and that is not done.                                                              |
| 2b  | Bloom, and the shader that never compiled                  | 7     | The pass is right and §2's luminance cap is applied at extraction as required, but it shipped once with a fragment shader that did not compile and I argued about the render graph twice before reading the console. Scored on the process, not the pixels.                                                  |
| 3   | Plate III · TURBULENTIA — GPGPU fray, curl advection, lattice exit | 8 | Everything §2 asks for is there and verified by looking: divergence-free advection, velocity-stretched streaks, the pointer repulsor, the camera orbit, and an exit that resolves into rows and columns. Not 9: three of its defects were found by opening a capture rather than by a test, and the plate is only measured for isolation, not for shape. |

**Loop score: 8.** Three plates, each verified against a capture rather than against an
intention. The loop's real output is the two structural traps it exposed — a shader that fails
to link is a console line and a missing pass, and a plate that stops being told its weight keeps
drawing — both of which now have a test that fails on the defect and passes on the fix.

---

## L0 exit gate

§7: _"`pnpm verify` green. A blank void page at 60 fps with DPR 2. `RESEARCH.md` has at least
8 entries. Lighthouse a11y >= 95 on the empty page."_

| Criterion             | Required             | Measured                                                                                                          |
| --------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` green   | pass                 | **pass**                                                                                                          |
| Blank void page       | clears to `--void`   | **`rgb(5,5,7)` vs `#050507` -> delta 0**                                                                          |
| DPR 2                 | 2.0                  | **2.0**, backing store 2880x1800                                                                                  |
| 60 fps                | 16.6 ms/frame        | renderer held cadence at the time (`render` p50 17.1 ms, cost over a bare clear 0.4 ms) — see the caveat in D-006 |
| `RESEARCH.md` entries | 8                    | **12**, plus a rejected-directions table                                                                          |
| Lighthouse a11y       | >= 95                | **100** · best-practices 100 · SEO 100 · zero failed audits                                                       |
| axe-core              | (L5 gate, run early) | **0 violations**                                                                                                  |

**Gate: PASSED.**

---

## L1 exit gate

§7: _"Scroll from 0 to 1 with the debug overlay shows no dropped plate, no leaked FBO, no
allocation inside `useFrame` (verify with a heap snapshot across 600 frames: growth < 2 MB)."_

| Criterion                   | Required                          | Measured                                                                                                          |
| --------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| No dropped plate, 0 to 1    | every frame has at least one live | **201 samples, 0 dropped, 0 with more than two live, 6/6 plates visited**                                         |
| No leaked FBO               | none                              | **0 textures, framebuffers, renderbuffers, buffers, programs created during a full scroll pass**; 7/6 live at end |
| No allocation in `useFrame` | heap growth < 2 MB / 600 frames   | **-44 KB (-73.7 B/frame)** — the heap _shrank_                                                                    |

The heap result is worth reading twice: across 600 frames of real scrolling, with the router,
the touch field and the composite pass all stepping, used heap went _down_. Steady-state
allocation is not merely small, it is nil.

**Gate: PASSED.** Artifacts: `docs/verification/gate-l1.json`, `banding.json`, `perf.json`.

---

## Carried forward

Deferred work, with the loop that owns it. Not blockers — these are scheduled.

| Item                                                        | Owner | Note                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier-1/2/3 frame times on real hardware                     | L5    | Every perf figure in the README stays in `[BRACKETS]` until then (§0.4). The harness auto-asserts the tier-1 contract when it detects a non-software renderer.                                                  |
| DOM text composited into the scene                          | L2/L4 | §2 Plate II: "the spectrum falls on the letterforms". Needs the text layer rendered to a texture — WebGL text pass or scene-space MSDF; §2 Plate V says record the choice in an ADR. Plate II ships without it. |
| Plate I's thread crossing the type                          | L4    | §2: "the headline sits behind the thread in Z". The canvas is behind the document layer, so this is a compositing problem for the L4 type pass, not a scene-graph one. Noted in `Tension.tsx`.                  |
| Shader line count for the colophon `[N]`                    | L4/L6 | §4.2 requires it counted at build time and injected, never typed. Currently 609 substantive lines across 15 files, quoted in the README but not yet wired into the page.                                        |
| `sitemap.xml`                                               | L6    | Needs the deployed origin. D-010.                                                                                                                                                                               |
| Specimen photograph for Plate IV                            | L3    | CC0, the single photograph in the whole site (§10). Source recorded in `CREDITS.md` before it is committed.                                                                                                     |
| Delegated copy: plate subtitles II–VI, Plate V body passage | L4    | Written when the plates exist, not before. `DECISIONS.md`.                                                                                                                                                      |
| Specimen Mode as a first-class rendering path               | L4    | §6.2. The reduced-motion preference is honoured at the DOM layer today; the frozen-frame plus annotation-overlay path is L4 task 4.                                                                             |

**Resolved since first recorded:** CIE colour-matching coefficients (D-012), Cauchy A/B
constants (D-014), analytic-vs-central-difference curl (D-013), and moving the sRGB encode off
the renderer onto the composite pass (D-016).

---

## Red team (§9.1)

**Thirteen defects found and fixed**, documented with evidence in
`docs/verification/red-team.md`. Five were changes that looked correct in the diff and did
nothing at runtime — reduced motion that pinned a clock without stopping an integrator, a
`tabIndex={-1}` that left Tab skipping every plate, an arrow-key nudge that Lenis overwrote
every frame, a settle window measured in frames on a machine running at 4 fps, and a bloom
shader that never compiled at all.

The severe ones: the built `index.html` shipped no text at all (§5.1's entire justification
for choosing Vite), `prefers-reduced-motion` was honoured in name only, and `Tab` reached
nothing in a 700vh document.

RT-13 is the one worth reading. `luminance` collides with a function three prepends to every
`ShaderMaterial`, so the bloom program never linked; three logged it and carried on, and the
frame rendered perfectly well with the pass simply absent. Three rounds of reasoning about a
render graph that was already correct, when one console listener said it in a line. The rule
that came out of it is D-020, and `tools/programs.spec.ts` enforces it.

---

## Not yet started

Stated plainly so nobody mistakes the ledger's silence for completion: **all of L3, L4, L5 and
L6, and the §9 final gate.** The README was pulled forward from L6 at request and documents
only the plates that exist; Plate III is not in it yet.

The §9.1 red-team pass has been run once (thirteen defects) but it was run against L1 and the
first two plates. It has to be run again at the end, against the whole piece.

---

## Files maintained continuously (§0.3)

`STATE.md` (this) · `DECISIONS.md` (22 entries) · `BLOCKERS.md` (none open) ·
`RESEARCH.md` (12 entries) · `CREDITS.md` · `docs/adr/` (2 of at least 5) ·
`README.md` (pulled forward from L6; documents only what exists)
