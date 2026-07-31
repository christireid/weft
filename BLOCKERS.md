# BLOCKERS

Anything that survived five inner-loop iterations without being solved. Empty is the goal
(§0.3). Per §12.4, every entry that is still here at the end must carry a written reason it
is acceptable to ship.

An entry here is not "something I deferred". Deferred work lives in `STATE.md`. This file is
for things I tried to solve and could not.

---

## Open

_None._

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
