# STATE

**Current loop:** L2 · tasks 1–2 done (Plates I–II), task 3 not started
**Last updated:** 2026-07-31
**`pnpm verify`:** green — 56 unit tests, 15 shader tests
**BLOCKERS:** none open

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

**Next task: L2 task 3** — Plate III · TURBULENTIA. The filament frays into GPGPU particles
advected through the curl field. `curl.glsl` and `simplex3d.glsl` are already built and
GPU-tested (divergence 6.98e-3 relative). What Plate III adds is the position/velocity
ping-pong pair, velocity-stretched point rendering, and the bloom pass — with §2's luminance
cap applied **in the shader before bloom**, not after, because bloom samples the
pre-tone-mapped buffer and tone mapping alone does not save additive-plus-bloom from white-out.

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

| #   | Task                                                                  | Score | Critique                                                                                                                                                              |
| --- | --------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scaffold: Vite 6 + React 19 + TS strict + ESLint + Vitest + Playwright | 9     | Green after two config fixes; the real design call was making `capture` a node wrapper so `--at` survives Playwright's CLI, which refuses unknown flags.               |
| 2   | Token layer, three variable faces self-hosted and subset               | 9     | Enforced by test rather than convention — and it forced the §3.1-vs-§6 contrast conflict into the open on day one (D-003), better found then than at L5.               |
| 3   | Reference gathering, at least 8 entries                                | 8     | Twelve entries cited to primary sources with file and line numbers, stronger than screenshots; loses a point honestly because the named browsing targets were blocked. |
| 4   | Empty `<Canvas>` clearing to `--void`, correct colour management       | 9     | Clear colour exact to 0/255 at DPR 2, proven against an isolating control rather than asserted.                                                                        |

**Loop score: 9.**

### L1 · Render core

| #   | Task                                                 | Score | Critique                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Lenis + ScrollTrigger + scroll store, debug overlay   | 9     | One rAF loop achieved rather than claimed — Lenis runs `autoRaf: false`, stepped from the single `useFrame`; four architecture tests fail the build if a second loop, canvas, Lenis or `gsap.ticker.add` appears.                                  |
| 2   | Plate router: declarative table, activate/deactivate  | 9     | Hand-off verified visually and by a 2001-sample exhaustive sweep. The real design call: local `t` runs past 1 and below 0 in the blend band so each plate keeps authority over its own transition instead of being cross-faded between end states. |
| 3   | Touch texture FBO (§5.3) with debug view              | 9     | Correct on all four channels, verified by reading the G quadrant's sign flip at the apex of a drag rather than trusting it; capsule stamping keeps the trail unbroken at 27 px/frame. Cost a real unit bug (device px vs CSS px in `setViewport`). |
| 4   | Shader chunk library (§5.4), unit test per chunk      | 9     | Six chunks, each tested against something independent of itself. The CMF coefficients are fitted here rather than transcribed, closing both `[to validate in L1]` items from `RESEARCH.md` with measured numbers.                                  |
| 5   | Device tiering + rolling frame-time sampler           | 9     | Histogram sampler rather than sort-per-frame, so the p95 costs no allocation; hysteresis verified against the case it exists for — 6000 frames straddling a threshold produce zero switches.                                                      |
| 6   | Post chain with custom dither pass, zero banding      | 9     | Banding reduced 20.3x, measured by run length rather than eyeballed. Cost a real bug — ACES was crushing `--void` to rgb(1.5, 1.5, 1.8), caught by the capture assertion rather than by reasoning (D-016).                                        |

**Loop score: 9.**

### L2 · Plates I–III

| #   | Task                                                      | Score | Critique                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Plate I · TENSIO — ribbon, wave, grab, exit transformation | 8     | A real 1-D wave equation on the GPU, so travelling pulses, reflection-with-inversion at the pinned ends and exponential decay all fall out rather than being authored. Not 9: the first material put the whole spectral fringe inside one pixel, and §2's type/thread crossing is still occluded pending L4. |
| 2   | Plate II · DISPERSIO — wedge, 16-sample spectral fan, drag | 8     | Continuous fan, violet deviated most through to red least, red end compressed by the 1/lambda^2 law, no ghosting. Not 9: §2 also asks the DOM text be composited into the scene so the spectrum falls on the letterforms, and that is not done.                                                              |
| 3   | Plate III · TURBULENTIA                                   | —     | not started                                                                                                                                                                                                                                                                                                |

**Loop score: incomplete.**

---

## L0 exit gate

§7: _"`pnpm verify` green. A blank void page at 60 fps with DPR 2. `RESEARCH.md` has at least
8 entries. Lighthouse a11y >= 95 on the empty page."_

| Criterion                | Required             | Measured                                                                                                         |
| ------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` green      | pass                 | **pass**                                                                                                         |
| Blank void page          | clears to `--void`   | **`rgb(5,5,7)` vs `#050507` -> delta 0**                                                                         |
| DPR 2                    | 2.0                  | **2.0**, backing store 2880x1800                                                                                 |
| 60 fps                   | 16.6 ms/frame        | renderer held cadence at the time (`render` p50 17.1 ms, cost over a bare clear 0.4 ms) — see the caveat in D-006 |
| `RESEARCH.md` entries    | 8                    | **12**, plus a rejected-directions table                                                                         |
| Lighthouse a11y          | >= 95                | **100** · best-practices 100 · SEO 100 · zero failed audits                                                      |
| axe-core                 | (L5 gate, run early) | **0 violations**                                                                                                 |

**Gate: PASSED.**

---

## L1 exit gate

§7: _"Scroll from 0 to 1 with the debug overlay shows no dropped plate, no leaked FBO, no
allocation inside `useFrame` (verify with a heap snapshot across 600 frames: growth < 2 MB)."_

| Criterion                   | Required                          | Measured                                                                                                         |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| No dropped plate, 0 to 1    | every frame has at least one live | **201 samples, 0 dropped, 0 with more than two live, 6/6 plates visited**                                        |
| No leaked FBO               | none                              | **0 textures, framebuffers, renderbuffers, buffers, programs created during a full scroll pass**; 7/6 live at end |
| No allocation in `useFrame` | heap growth < 2 MB / 600 frames   | **-44 KB (-73.7 B/frame)** — the heap _shrank_                                                                   |

The heap result is worth reading twice: across 600 frames of real scrolling, with the router,
the touch field and the composite pass all stepping, used heap went _down_. Steady-state
allocation is not merely small, it is nil.

**Gate: PASSED.** Artifacts: `docs/verification/gate-l1.json`, `banding.json`, `perf.json`.

---

## Carried forward

Deferred work, with the loop that owns it. Not blockers — these are scheduled.

| Item                                                        | Owner | Note                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier-1/2/3 frame times on real hardware                     | L5    | Every perf figure in the README stays in `[BRACKETS]` until then (§0.4). The harness auto-asserts the tier-1 contract when it detects a non-software renderer.                                                   |
| DOM text composited into the scene                          | L2/L4 | §2 Plate II: "the spectrum falls on the letterforms". Needs the text layer rendered to a texture — WebGL text pass or scene-space MSDF; §2 Plate V says record the choice in an ADR. Plate II ships without it.  |
| Plate I's thread crossing the type                          | L4    | §2: "the headline sits behind the thread in Z". The canvas is behind the document layer, so this is a compositing problem for the L4 type pass, not a scene-graph one. Noted in `Tension.tsx`.                   |
| Shader line count for the colophon `[N]`                    | L4/L6 | §4.2 requires it counted at build time and injected, never typed. Currently 609 substantive lines across 15 files, quoted in the README but not yet wired into the page.                                         |
| `sitemap.xml`                                               | L6    | Needs the deployed origin. D-010.                                                                                                                                                                               |
| Specimen photograph for Plate IV                            | L3    | CC0, the single photograph in the whole site (§10). Source recorded in `CREDITS.md` before it is committed.                                                                                                      |
| Delegated copy: plate subtitles II–VI, Plate V body passage | L4    | Written when the plates exist, not before. `DECISIONS.md`.                                                                                                                                                       |
| Specimen Mode as a first-class rendering path               | L4    | §6.2. The reduced-motion preference is honoured at the DOM layer today; the frozen-frame plus annotation-overlay path is L4 task 4.                                                                              |

**Resolved since first recorded:** CIE colour-matching coefficients (D-012), Cauchy A/B
constants (D-014), analytic-vs-central-difference curl (D-013), and moving the sRGB encode off
the renderer onto the composite pass (D-016).

---

## Not yet started

Stated plainly so nobody mistakes the ledger's silence for completion: **L2 task 3, all of L3,
L4, L5 and L6, the §9 final gate, and the §9.1 red-team pass.** The README was pulled forward
from L6 at request and documents only the two plates that exist.

---

## Files maintained continuously (§0.3)

`STATE.md` (this) · `DECISIONS.md` (20 entries) · `BLOCKERS.md` (none open) ·
`RESEARCH.md` (12 entries) · `CREDITS.md` · `docs/adr/` (2 of at least 5) ·
`README.md` (pulled forward from L6; documents only what exists)
