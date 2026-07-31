import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
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
import { TouchField } from './touch';
import { attachPointer } from './pointer';
import { setTouchField } from './registry';
import { appStore } from '../state/store';
import { disposeTouchDebug, drawTouchDebug } from './touchDebugView';
import { createTierController, stepTierController } from '../perf/controller';
import { setTierController } from './registry';

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
 *     touch.step        stamp the shared pointer field, before anything reads it
 *     ...               active simulations, uniform writes
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

/**
 * Any non-zero priority makes r3f hand rendering over to this callback instead
 * of issuing its own `gl.render` after the loop. Required: r3f's automatic
 * render happens *after* priority-0 callbacks and clears the buffer, so
 * anything a subsystem draws — a debug inset, a post-processing composite —
 * would be wiped by it.
 */
const RENDER_PRIORITY = 1;

export function FrameLoop() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);

  const touch = useMemo(() => new TouchField(gl), [gl]);
  const tier = useMemo(() => createTierController(), []);

  useEffect(() => {
    initScroll();
    setTouchField(touch);
    setTierController(tier);

    const detachPointer = attachPointer(touch);
    return () => {
      detachPointer();
      setTouchField(null);
      setTierController(null);
      touch.dispose();
      disposeTouchDebug();
      destroyScroll();
    };
  }, [touch, tier, gl]);

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

    // Measured on the *raw* delta, not the clamped one: clamping is a
    // simulation safeguard, and feeding the clamp into the sampler would hide
    // exactly the slow frames the tier system exists to notice.
    stepTierController(tier, delta);

    // Before anything samples it: a plate reading last frame's field would lag
    // the pointer by 16 ms, which §1.2 counts as a failure of response.
    touch.step(gl, frame.delta, size.width / Math.max(1, size.height));

    // The scene render is issued here rather than by r3f, because this callback
    // has a non-zero renderPriority. That is the point: the post-processing
    // chain (L1 task 6) composites between this render and the frame being
    // presented, and anything drawn *after* an automatic render would be
    // cleared by the next one.
    gl.render(state.scene, state.camera);

    if (appStore.getState().debug) {
      drawTouchDebug(gl, touch.texture);
    }

    // Last, so it reports the state the frame was actually drawn with.
    // No-ops in one branch when the HUD is off, which is the shipped path.
    paintHud();
  }, RENDER_PRIORITY);

  return null;
}
