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
