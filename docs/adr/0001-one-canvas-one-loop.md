# ADR-0001 — One canvas, one loop, one scroll subscription

- **Status** Accepted
- **Loop** L0
- **Date** 2026-07-31
- **Spec** §5.2 (the single frame contract), §2 (the canvas is never torn down), §1.2 (continuity)

## Context

WEFT is six plates. The obvious structure — and the one most WebGL portfolio pieces use — is
a component per section, each mounting its own `<Canvas>`, each with its own render loop,
each unmounting as the visitor scrolls past. It is easy to reason about, it isolates
failures, and every plate can be developed without touching the others.

It also makes the piece this project is trying not to be.

§1.1 is explicit that the through-line is the point: _it is always the same thread_. §1.2
puts continuity first among the three things that produce the "studio or engineer?"
impression, and defines the failure as a plate boundary that reads as a cut. A per-section
canvas cannot produce a transformation across a boundary, only a crossfade between two
independent renderers — because at the moment of the boundary there are two GL contexts that
share no state, and the thread in one has no way to _become_ the thread in the other.

There are also three consequences that are not aesthetic:

1. Browsers cap live WebGL contexts (commonly around 16); exceeding it silently kills the
   oldest context. Six is under the cap, but six plus the post-processing chain's internal
   targets is not obviously safe on mobile.
2. Every context has its own shader cache. The same dispersion chunk compiled six times is
   six compile stalls, each landing exactly at a plate boundary — the worst possible moment.
3. Mounting a renderer mid-scroll allocates render targets during a frame the visitor is
   watching. That is a visible hitch precisely where §1.2 demands there be none.

## Decision

**Exactly one `<Canvas>`, one `requestAnimationFrame` loop, and one scroll subscription in
the application.** The canvas mounts once at boot and is never torn down. Plates are not
components that mount and unmount; they are entries in a declarative table that the plate
router activates and deactivates, and only the active plate's simulation steps.

The loop is the one in §5.2, and the ownership is one-directional:

```
lenis.raf(t)
  └─ scrollStore.set(progress)          // vanilla zustand — no React render
       └─ useFrame(({ clock }) => {
            plateRouter.update(progress) // which plates are active, local t each
            touchFBO.step()              // ADR-0002
            simFBOs.step()               // active plate only
            uniforms.write()             // direct .value assignment, no allocation
          })
```

Two rules follow from it and are treated as invariants rather than guidelines:

- **Scroll progress is never read through React state.** It is written to a vanilla zustand
  store from the Lenis callback and read inside `useFrame`. Routing it through `useState` or
  context re-renders the tree at 60 Hz, which costs more than everything else on this page
  combined.
- **Nothing inside `useFrame` allocates.** No `new THREE.Vector3()`, no array literals, no
  template strings. Scratch objects are pre-allocated at module scope and mutated in place.

## Consequences

**Bought:** transformation across boundaries becomes possible at all, because the thread's
state at the end of plate _n_ is literally the state plate _n+1_ starts from. Shaders compile
once. Shared primitives — the touch texture (ADR-0002), the shader chunk library, the post
chain — are built once and reused six times, which §5.3 identifies as the decision that makes
the piece both coherent and affordable.

**Paid:** plates cannot be developed in isolation. A change to shared state can break a plate
three sections away, and a shader compile failure could in principle take down the whole
canvas rather than one section. The second is mitigated in L5 task 5: a per-plate error
boundary degrades that plate to its static still without white-screening the page. The first
is mitigated by the plate router being a pure function of scroll progress and therefore
exhaustively testable (§8.2 item 2).

**Enforced by:** the L1 exit gate — a full 0→1 scroll pass with no dropped plate, no leaked
FBO, and heap growth under 2 MB across 600 frames. The allocation rule cannot be checked by a
linter (it cannot see into a closure), so it is checked by that heap assertion.

**Verified at L0:** with the scene empty, the renderer's per-frame cost over a bare
`gl.clear()` of the same framebuffer is **0.4 ms** (`docs/verification/perf.json`). That is
the floor this architecture starts from.

## Alternatives rejected

**A canvas per plate.** Rejected above — cannot produce transformation, only crossfade, and
§2 forbids fade-to-black transitions.

**One canvas, but plates as mounting React components.** Keeps the context but reintroduces
the allocation hitch at boundaries, since geometry and render targets would be created and
disposed mid-scroll. The router activates and deactivates pre-built plates instead.

**drei's `ScrollControls`.** Rejected in §5.1: it owns its own scroll container and fights
both Lenis's smoothing and ScrollTrigger's pinning. Recorded in `RESEARCH.md` §11 because it
is the obvious-looking choice.
