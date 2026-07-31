import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { frame } from '../state/frame';
import { updateRouter } from './plateRouter';
import {
  destroyScroll,
  initScroll,
  readScroll,
  stepScroll,
  type ScrollReading,
} from '../scroll/scroll';
import { paintHud } from '../ui/debugHud';

/**
 * The single frame loop (§5.2).
 *
 * This is the only `useFrame` in the application. That is an invariant, not a
 * convention, and `tests/architecture.test.ts` fails the build if a second one
 * appears. Ordering inside a frame is the reason: r3f runs priority-0 callbacks
 * in registration order, which is mount order, which is not something to build
 * a hand-off between six plates on. One callback that calls its subsystems in a
 * written order is legible and cannot reorder itself.
 *
 *     stepScroll        advance Lenis's smoothing
 *     readScroll        sample position into a pre-allocated struct
 *     updateRouter      decide which plates are live and their local t
 *     ...               touch FBO, active simulations, uniform writes
 *
 * Nothing in here allocates. `scratch` is module scope; `frame` and
 * `frame.router` are singletons mutated in place. No `new`, no array literals,
 * no template strings — a template string in a frame loop allocates a string
 * every frame and is the most common accidental violation.
 */

/** Pre-allocated read target. Never replaced. */
const scratch: ScrollReading = { progress: 0, velocity: 0, direction: 0 };

/**
 * A tab left in the background and returned to produces one enormous delta.
 * Clamped to 1/20 s so a simulation integrated against it cannot explode — the
 * classic "come back to the tab and the cloth has turned inside out".
 */
const MAX_DELTA = 0.05;

export function FrameLoop() {
  useEffect(() => {
    initScroll();
    return () => {
      destroyScroll();
    };
  }, []);

  useFrame((state, delta) => {
    const elapsed = state.clock.elapsedTime;

    frame.delta = delta > MAX_DELTA ? MAX_DELTA : delta;
    frame.elapsed = elapsed;
    frame.count += 1;

    stepScroll(elapsed * 1000);

    readScroll(scratch);
    frame.progress = scratch.progress;
    frame.velocity = scratch.velocity;
    frame.direction = scratch.direction;

    updateRouter(frame.router, frame.progress);

    // Last, so it reports the state the frame was actually drawn with.
    // No-ops in one branch when the HUD is off, which is the shipped path.
    paintHud();
  });

  return null;
}
