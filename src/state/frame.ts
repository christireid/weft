import { createRouterState, type RouterState } from '../gl/plateRouter';

/**
 * The per-frame signal.
 *
 * §5.1 specifies zustand "vanilla store, subscribed outside React for per-frame
 * reads", and §5.2 specifies that nothing in the frame loop allocates. Those two
 * requirements pull against each other at exactly one point: zustand's
 * `setState` builds a new state object on every call, so writing scroll progress
 * through it 60 times a second allocates 60 objects a second and hands the GC a
 * sawtooth — the specific failure §5.2 exists to prevent.
 *
 * So the split is by write frequency, not by kind:
 *
 *   this module   continuous, written every frame, read every frame, never
 *                 rendered by React. One mutable object, mutated in place,
 *                 zero allocation.
 *
 *   state/store   discrete, written rarely (device tier, Specimen Mode, debug
 *                 visibility), legitimately drives React renders. zustand.
 *
 * Both are read outside React in the frame loop. Neither is ever read through
 * `useState`. See ADR-0003.
 */
export interface FrameState {
  /** Global scroll progress in [0,1], smoothed by Lenis. */
  progress: number;
  /** Progress per second. Signed. Used to drive velocity-dependent effects. */
  velocity: number;
  /** -1 up, +1 down, 0 at rest. */
  direction: -1 | 0 | 1;
  /** Seconds since boot. */
  elapsed: number;
  /** Seconds since the previous frame, clamped — see the note in FrameLoop. */
  delta: number;
  /** Frames rendered since boot. */
  count: number;
  readonly router: RouterState;
}

/**
 * Module-scope singleton. There is exactly one of these and it is never
 * replaced — every consumer holds the same reference and reads fields off it.
 */
export const frame: FrameState = {
  progress: 0,
  velocity: 0,
  direction: 0,
  elapsed: 0,
  delta: 0,
  count: 0,
  router: createRouterState(),
};

/*
 * Instrumentation handle.
 *
 * §3.3 requires the measurement strings on screen to be read from live
 * application state — "a number on screen that does not correspond to
 * something the renderer actually knows is a fabrication". This is the same
 * state, exposed so the claim can be checked from outside: open the console and
 * read the numbers the page is displaying.
 *
 * It is a read handle on the existing singleton, not a copy, so it costs
 * nothing and cannot drift from what the renderer is using. The L1 exit gate
 * reads it to verify no plate is dropped across a real scroll pass.
 */
if (typeof window !== 'undefined') {
  (window as unknown as { __weftFrame: FrameState }).__weftFrame = frame;
}

/** Test seam: restore the singleton to boot state without reallocating it. */
export function resetFrame(): void {
  frame.progress = 0;
  frame.velocity = 0;
  frame.direction = 0;
  frame.elapsed = 0;
  frame.delta = 0;
  frame.count = 0;
}
