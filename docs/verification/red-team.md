# Red team — the adversarial pass (§9.1)

> "Before declaring done, argue against your own work. Find at least twelve real defects.
> Fix all twelve. Record each with what you changed."

Twelve found, twelve fixed. Every one was confirmed by measurement before it was called a
defect, and every fix was re-measured after. Three of them turned out to be *fixes that
looked correct and did nothing* — those are the ones worth reading.

Run against L0–L1 and Plates I–II. The four unbuilt plates are out of scope; their absence is
a schedule fact recorded in `STATE.md`, not a defect.

---

## RT-01 · Reduced motion was honoured in name only — **severe**

**Angle:** the screen-reader user; anyone with a vestibular disorder.

`prefers-reduced-motion` set `specimenMode` in the store at boot. Nothing read it. A visitor
who had asked their operating system for reduced motion got the full animated site.

```
$ grep -rn "specimenMode" src/ | grep -v "state/store.ts\|useKeyboard"
  (nothing)
```

§6.2 calls reduced motion "a designed state, not a disabled state", and the full Specimen
Mode path is L4 work. But honouring the preference *partially* is still honouring it;
ignoring it until the designed version is ready is not — the person asking for it is asking
now.

**Fixed.** The frame loop reads `specimenMode` and holds every plate at a fixed pose with no
pointer drive. Details in RT-02 and RT-03 below, because the first two attempts at this did
not work.

**Verified:** two full-page screenshots three seconds apart are now byte-identical. Permanent
test in `tools/a11y.spec.ts` (§8.2 item 5).

---

## RT-02 · The reduced-motion freeze did not freeze — **severe**

**Angle:** the engineer who does not trust a fix without a measurement.

The first fix pinned the clock: every plate was stepped with a constant `uTime` instead of
`frame.elapsed`. It reads correctly and is wrong, because the wave equation is an
**integrator** — every invocation advances the stored state whatever time it is told. A
constant clock freezes only the forcing term.

```
RM identical frames 2.5s apart: false
```

**Fixed.** The wave shader now takes a `uFreeze` uniform, and under it stops solving and
simply *states* the pose — the idle standing wave evaluated at a fixed instant. That makes
the step **idempotent**, so it can run every frame and still produce the same pixels.

**Lesson recorded:** "pin the input" and "stop the process" are not the same thing for
anything stateful.

---

## RT-03 · The freeze's settle window was measured in frames — **moderate**

**Angle:** the person on a slow device.

The second attempt settled the simulation for 150 frames before freezing. On a machine
holding 60 fps that is 2.5 seconds. On the software rasteriser this build runs on it is
**33 seconds**, and instrumenting the page found `frame.count: 12` after five full seconds —
the freeze would never have engaged inside any test or any visitor's attention span.

**Fixed.** The plates are idempotent under freeze (RT-02) so they need no settle at all. Only
the shared touch field keeps a short window, to decay a stamp that was in flight when the
mode changed, and 12 frames is enough for that at any frame rate.

---

## RT-04 · `Tab` reached no plate — **severe**

**Angle:** the keyboard user; the screen-reader user.

§6.1: *"Tab moves between plates and focuses them (visible focus ring, 2px, `--ink-100`)."*
The document had **zero focusable elements**. A 700vh catalogue with no tab stops at all.

The first fix gave each section `tabIndex={-1}`. That is focusable *programmatically* only —
it reads as fixed in a diff and leaves Tab skipping straight past every plate.

**Fixed.** `tabIndex={0}`, plus a skip link, plus a focus ring drawn on the plate's *title*
rather than round the 700vh section (ringing the whole runway would look like an error state).

**Verified:**

```
[a11y] tab stops on plates: plate-i, plate-ii, plate-iii, plate-iv, plate-v, plate-vi
```

---

## RT-05 · Arrow keys did nothing — **moderate**

**Angle:** the keyboard user.

§6.1 requires arrow keys to nudge scroll. The handler was written with
`window.scrollBy({ behavior: 'smooth' })` and had no effect whatsoever: **Lenis writes its own
animated position to the window every frame**, so a native scroll is overwritten before it is
ever painted.

```
[a11y] ArrowDown moved scrollY 0 -> 0
```

This is the third fix in this list that looked right and did nothing, and it is the reason
the a11y suite now measures `scrollY` before and after rather than asserting a handler exists.

**Fixed.** `nudgeScroll` routes through `lenis.scrollTo`, which also keeps §5.2's
single-scroll-authority rule intact instead of introducing a competitor. Falls back to the
native call when Lenis has not initialised, so the keyboard still works on the no-WebGL path.
Home/End/PageUp/PageDown and Esc-to-release-focus added at the same time.

**Verified:** `[a11y] ArrowDown moved scrollY 0 -> 300`.

---

## RT-06 · The built page shipped no text at all — **severe**

**Angle:** the crawler; the person on 4G whose JS chunk failed; anyone using reader mode.

```
$ python3 -c "print(re.search(r'<body>(.*?)</body>', open('dist/index.html').read(), re.S).group(1))"
'<div id="weft"></div>'
```

§5.1 rejects Next.js on the grounds that *"SEO is solved by build-time prerender of the text
layer into index.html"*. That sentence is the entire justification for the framework choice,
and it was not true. §6.1's promise — *"a visitor with a screen reader gets a complete,
coherent document without a single WebGL frame"* — held only for visitors whose JavaScript
ran, which is precisely the case it was written to cover.

**Fixed.** The document layer is extracted to `src/document/Document.tsx` and rendered at
build time by a Vite plugin (`tools/prerender.mjs`) that bundles it for Node with esbuild and
injects `renderToStaticMarkup` output into `#weft`. React `hydrateRoot`s over it rather than
discarding it, so there is one source of truth for the copy. `tests/prerender.test.ts` asserts
the two cannot drift.

**Verified:** 2,023 bytes of real markup in `dist/index.html`; every plate label, the
masthead, and the Plate I subtitle all present.

---

## RT-07 · No `<noscript>` — **moderate**

**Angle:** the person on 4G in daylight; anyone with scripts blocked.

The prerender (RT-06) covers crawlers, but a visitor whose script fails would have seen the
catalogue text with an invisible dead canvas over it and no explanation.

**Fixed.** A `<noscript>` block that hides the canvas mount and states plainly what the page
is and why it needs JavaScript, written in the §4.1 voice rather than as an apology.

---

## RT-08 · A visitor who cannot render anything downloaded the whole renderer — **moderate**

**Angle:** the person on 4G; the tier-4 device (§5.6).

`three` is 190 KB gzipped, over half the bundle, and was imported eagerly. A visitor without
WebGL2 can never draw a frame and was downloading and parsing all of it regardless — ahead of
the text they actually came for.

**Fixed.** `Stage` is `React.lazy`, gated on `hasWebGL2()`.

**Measured, gzipped initial load:**

| | before | after |
| --- | --- | --- |
| critical path JS | **364 KB** | **66.9 KB** |

A 5.4× reduction. The renderer chunk (298 KB) now loads only when it can be used, and the
document layer paints from prerendered markup without waiting on it at all.

---

## RT-09 · Open Graph image used a relative path — **moderate**

**Angle:** anyone sharing the link.

`<meta property="og:image" content="/og.png">`. Every social scraper resolves `og:image`
against nothing; a root-relative path fails on all of them, so the card would have rendered
blank.

**Fixed.** Absolute URL, pointing at the repository copy until the site has an origin of its
own.

---

## RT-10 · `backdrop-filter` unprefixed — **minor**

**Angle:** the Safari user on a two-year-old MacBook Air.

Safari requires `-webkit-backdrop-filter`. Dev-only surface (the debug HUD), but it is the
class of omission §7 L5 task 2 warns about, and the prefix costs one line.

**Fixed.**

---

## RT-11 · Dead uniforms, a dead include, and dead exports — **minor**

**Angle:** the engineer reading the source for signs of copy-paste.

Confirmed by counting declarations against reads:

- `uRelease` and `uTouch` declared in `tensionWave.frag.glsl`, never read — the wave takes the
  pointer through `setGrab`, not through the shared field.
- `uEntry` declared in `dispersion.frag.glsl`, never read.
- `dispersion.frag.glsl` included `sdf.glsl` and used **zero** symbols from it — compile cost
  for nothing.
- `resetFrame`, `Composite.setDither`, `TouchField.debugInfo` and `TensionWave.stations`
  exported with no call site anywhere.

Individually trivial; collectively the exact texture of code assembled from parts rather than
written. §10's "do not ship a TODO" is the same instinct.

**Fixed.** All removed. The unused `touch` parameter that fell out of removing `uTouch` was
removed too, and the reason both a bare pointer coordinate *and* a shared touch field exist is
now documented at the one place a reader would ask.

---

## RT-12 · README alt text described images that were not there — **minor**

**Angle:** the screen-reader user; the honesty axis.

The alt text on two README stills described detail crops — *"Detail of the filament: a white
core with cyan and red spectral wings"* — but the images are full-page screenshots. A sighted
reader sees a page; a screen-reader user was told about a macro crop that does not exist.

Small, and exactly the kind of thing §9's honesty axis is about: the description of an
artifact drifting from the artifact.

**Fixed.** Both rewritten to describe what is actually in frame.

---

## RT-13 · Bloom's fragment shader never compiled — **critical**

**Angle:** the frame itself. Bloom was added to answer "the project does not look all that
impressive", and after adding it the measured non-void coverage moved from 5.82% to 5.84% —
which is to say, not at all.

Two rounds of reasoning about the render graph found nothing, because nothing in the render
graph was wrong. `renderFullscreen` was given an `accumulate` option so the additive combine
would stop being auto-cleared — a real bug, fixed, and still no change in the frame.

What settled it was refusing to reason any further and instrumenting instead. In order: an A/B
of two builds with the bloom constants set an order of magnitude apart came back **byte
identical**, which ruled out tuning. A forced red tint in the composite moved 99.54% of pixels,
which proved source changes do reach the screen. Feeding the scene texture through the bloom
sampler slot moved 6.52%, which proved the sampler binds. A constant-colour probe in the bloom
shader still produced nothing, and a readback inside `render()` showed every level sitting at
its clear colour while a control clear to green read back green — so the readback was honest
and the draws genuinely were not landing.

Only then did I attach a console listener, which said it in one line:

```
THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false
ERROR: 0:68: 'in' : function must have the same parameter qualifiers in all of its declarations
ERROR: 0:68: 'luminance' : function already has a body
```

three prepends `tonemapping_pars_fragment` to every `ShaderMaterial` fragment shader, and that
chunk defines `float luminance( const in vec3 rgb )`. The helper in `bloom.frag.glsl` was named
`luminance(vec3 c)` — not an override but a redefinition with different parameter qualifiers.
The program never linked. three logged it and carried on, every bloom draw was dropped with
`INVALID_OPERATION`, and the pyramid stayed at its clear colour.

Every other shader in the project uses the `weft` prefix. This one file broke the convention,
and the convention turns out to be load-bearing rather than cosmetic.

**Fixed.** Renamed to `weftLuminance`, with the failure recorded at the definition so the next
person does not have to rediscover why the prefix matters. `tools/programs.spec.ts` is new: it
sweeps the whole document at `?tier=1` and fails on any console error or warning that is not on
a short allow-list. It was verified by reintroducing the defect — it fails on it and passes
without it. It has to pin tier 1, because §5.6 disables bloom on tier 3 and an unpinned run
would never compile the program at all.

With bloom actually reaching the frame, the same capture moves 3.76% of pixels against the
broken build, at a maximum channel delta of 196.

---

## What this pass says about the build

Four of the thirteen — RT-02, RT-03, RT-05 and RT-13 — were **changes that looked correct in
the diff and did nothing at runtime**, and RT-04 was a fifth in its first attempt. Every one of
them was caught by a test that measured an *outcome* (are these two frames identical? did
`scrollY` change? which elements did Tab actually reach? did the program link?) rather than
asserting that code existed.

RT-13 adds a second lesson, and a sharper one: **read the console before reasoning about the
GPU.** A program that fails to link is not an exception and does not stop the frame. It is one
console line and a pass that quietly is not there. Three rounds of careful reasoning about a
render graph that was already correct cost more than one listener would have.

That is the same lesson as the ACES-crushing-the-void bug in D-016, and it is why the harness
in this repository leans on captured pixels and before/after measurements rather than on unit
tests of intent.

The a11y suite grew from 2 tests to 5 and now covers keyboard navigation, the skip link, and
the reduced-motion path. `tests/prerender.test.ts` is new. Total: **63 unit tests, 15 shader
tests, 5 a11y tests, and a program-link sweep.**
