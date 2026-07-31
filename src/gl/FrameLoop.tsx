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
import { attachPointer, pointerState } from './pointer';
import { setTouchField } from './registry';
import { appStore } from '../state/store';
import { disposeTouchDebug, drawTouchDebug } from './touchDebugView';
import { createTierController, stepTierController } from '../perf/controller';
import { setTierController } from './registry';
import { Composite } from './composite';
import { Bloom } from './bloom';
import { TIER_PROFILES } from '../perf/tier';
import {
  getDispersionPlate,
  getTensionPlate,
  getTurbulencePlate,
  getWeavePlate,
} from './registry';

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

/** Previous pointer x, for plates that want a drag delta rather than a position. */
let lastPointerX = 0.5;

/*
 * Whether the camera is currently displaced from its neutral pose. Lets the
 * orbit run one final frame at weight zero, which returns the camera exactly to
 * where the other plates expect it rather than leaving it a fraction off.
 *
 * Module scope for the same reason as `lastPointerX`: there is exactly one
 * frame loop in the application (ADR-0001), and per-frame state that lives in
 * the component body would be reset by every React render (§5.2).
 */
let cameraOrbited = false;

/**
 * Any non-zero priority makes r3f hand rendering over to this callback instead
 * of issuing its own `gl.render` after the loop. Required: r3f's automatic
 * render happens *after* priority-0 callbacks and clears the buffer, so
 * anything a subsystem draws — a debug inset, a post-processing composite —
 * would be wiped by it.
 */
const RENDER_PRIORITY = 1;

/**
 * The clock value every plate is held at in Specimen Mode.
 *
 * Fixed rather than frozen-at-current, so the frozen frame is the same one
 * every time and can be captured for the no-WebGL fallback (§6.3) and for the
 * README's accessibility comparison. Chosen so the idle standing wave sits near
 * a crest — the most legible moment for a thread whose subject is its shape.
 */
const SPECIMEN_FROZEN_TIME = 1.7;

/**
 * Plate III's camera orbit (§2).
 *
 * A sixth of a turn across the whole plate. Wide enough that the parallax
 * between the near and far edges of the cloud is unmistakable — which is the
 * point, since a particle cloud with no parallax reads as a flat texture — and
 * narrow enough that the plate's composition does not swing across the frame
 * while a visitor is reading the type pinned beside it.
 */
const ORBIT_SWEEP = Math.PI / 3;
/** Vertical travel, world units. Small: the horizon should stay level. */
const ORBIT_RISE = 0.55;
/** Matches the Canvas camera's resting z, so weight 0 is exactly neutral. */
const CAMERA_DISTANCE = 6;

/**
 * Frames Specimen Mode steps before it stops stepping.
 *
 * Pinning the clock is not enough: the wave equation is an *integrator*, so
 * every call advances its state whatever time it is told. Feeding it a constant
 * `uTime` freezes only the forcing term, and the frames keep changing — which
 * is what the reduced-motion test measured, two screenshots 2.5 s apart that
 * were not identical.
 *
 * The plates solve this properly, by making their frozen state *idempotent*
 * (see the uFreeze branch in tensionWave.frag.glsl) so they can be stepped
 * every frame and still produce the same pixels. Only the shared touch field
 * needs a window, to decay any in-flight stamp; 12 frames is enough for that
 * and does not depend on the frame rate the way 150 did — at a software
 * rasteriser's ~220 ms it would have been half a minute before anything froze.
 */
const SPECIMEN_SETTLE_FRAMES = 12;

export function FrameLoop() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);

  const touch = useMemo(() => new TouchField(gl), [gl]);
  const tier = useMemo(() => createTierController(), []);
  const composite = useMemo(
    () => new Composite(gl, size.width * gl.getPixelRatio(), size.height * gl.getPixelRatio()),
    // Constructed once; resized by the effect below rather than rebuilt, so a
    // window drag does not reallocate a full-viewport HDR target per frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gl],
  );

  const bloom = useMemo(
    () => new Bloom(gl, size.width * gl.getPixelRatio(), size.height * gl.getPixelRatio()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gl],
  );

  useEffect(() => {
    const ratio = gl.getPixelRatio();
    composite.setSize(size.width * ratio, size.height * ratio);
    bloom.setSize(size.width * ratio, size.height * ratio);
  }, [composite, bloom, gl, size.width, size.height]);

  useEffect(() => {
    initScroll();
    setTouchField(touch);
    setTierController(tier);
    // Publish the boot tier once so anything reading the store before the first
    // adaptation (the bloom gate, most importantly) sees the right value.
    appStore.getState().setTier(tier.state.current);

    const detachPointer = attachPointer(touch);
    return () => {
      detachPointer();
      setTouchField(null);
      setTierController(null);
      touch.dispose();
      composite.dispose();
      bloom.dispose();
      disposeTouchDebug();
      destroyScroll();
    };
  }, [touch, tier, gl, composite, bloom]);

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

    /*
     * §6.2: reduced motion is a *designed* state, not a disabled one. The full
     * Specimen Mode rendering path — frozen at each plate's most legible frame,
     * with the annotation layer on — is L4 task 4.
     *
     * What must be true *now*, and was not: a visitor who has asked their
     * operating system for reduced motion must not be shown moving simulations
     * while that path is being built. So the simulations stop stepping and each
     * plate is held at its most legible local time. Honouring the preference
     * partially is still honouring it; ignoring it until the pretty version
     * arrives is not.
     */
    const specimen = appStore.getState().specimenMode;
    // Once settled, nothing advances. See SPECIMEN_SETTLE_FRAMES.
    // Only the touch field needs a settle window; the plates are idempotent
    // under freeze and can be called every frame.
    const frozen = specimen && frame.count > SPECIMEN_SETTLE_FRAMES;

    // Measured on the *raw* delta, not the clamped one: clamping is a
    // simulation safeguard, and feeding the clamp into the sampler would hide
    // exactly the slow frames the tier system exists to notice.
    stepTierController(tier, delta);

    // Before anything samples it: a plate reading last frame's field would lag
    // the pointer by 16 ms, which §1.2 counts as a failure of response.
    /*
     * The pointer field decays fast in Specimen Mode rather than being skipped
     * outright, so a mode change mid-gesture does not leave a stamp frozen on
     * screen — and then stops once it has decayed to nothing.
     */
    if (!frozen) {
      touch.step(gl, specimen ? 0.25 : frame.delta, size.width / Math.max(1, size.height));
    }

    /*
     * Active plates step here, in table order, and only when live. §7 L1 task 2:
     * "only the active plate's GPGPU steps". The router has already decided
     * which those are; this loop does not re-derive it.
     */
    const tension = getTensionPlate();
    if (tension) {
      const slot = frame.router.slots[0];
      if (!slot?.active) {
        /*
         * Weight to zero when the plate is not live.
         *
         * A plate's mesh stays in the scene graph across the whole document —
         * mounting and unmounting it per plate would rebuild its buffers at
         * every crossing — so a plate that stops being told its weight keeps
         * drawing at whatever weight it last had. Plate I's filament was
         * visible across Plates III onward for exactly that reason: it was
         * never told it had stopped.
         */
        tension.setLocalTime(0, 0);
      } else {
        tension.setLocalTime(slot.t, slot.weight);
        if (specimen) {
          // Held at rest: no pointer drive, pinned clock, and no stepping at
          // all once the pose has settled.
          tension.setPointer(0.5, 0.5, 0);
          // Idempotent in freeze mode, so it is safe to call every frame and
          // no settle counter is needed.
          tension.step(gl, SPECIMEN_FROZEN_TIME, true);
        } else {
          tension.setPointer(pointerState.x, pointerState.y, pointerState.pressure);
          tension.step(gl, frame.elapsed);
        }
      }
    }

    /*
     * Plate III's GPGPU pair. Stepped before the scene render because the draw
     * that consumes it happens inside `gl.render` — the points mesh is in the
     * r3f scene, not a fullscreen pass — so stepping afterwards would draw the
     * previous frame's state.
     */
    const turbulence = getTurbulencePlate();
    if (turbulence) {
      const slot = frame.router.slots[2];
      if (slot?.active) {
        turbulence.setLocalTime(slot.t, slot.weight);
        if (specimen) {
          // The advection is not idempotent under a pinned clock — it is an
          // integrator like the wave, and a fixed Δt would keep carrying the
          // cloud. Freezing means not stepping at all; the pose the settle
          // window arrives at is what Specimen Mode holds.
          if (!frozen) turbulence.step(gl, frame.delta, SPECIMEN_FROZEN_TIME, touch.texture);
        } else {
          turbulence.step(gl, frame.delta, frame.elapsed, touch.texture);
        }
      } else {
        // Weight zero when the plate is not live, so a mesh that is still in
        // the scene graph contributes nothing rather than being culled by a
        // conditional mount that would rebuild its buffers on every crossing.
        turbulence.setLocalTime(0, 0);
      }
    }

    /*
     * Plate IV's cloth. Stepped before the scene render for the same reason as
     * Plate III: the mesh that consumes the solver's output is drawn inside
     * `gl.render`, so stepping afterwards would draw the previous frame.
     */
    const weave = getWeavePlate();
    if (weave) {
      const slot = frame.router.slots[3];
      if (slot?.active) {
        weave.setLocalTime(slot.t, slot.weight);
        weave.setPointer(pointerState.x, pointerState.y, specimen ? 0 : pointerState.pressure);
        // The cloth integrates, so freezing means not stepping — the same call
        // as Plate III and for the same reason.
        if (!specimen || !frozen) weave.step(gl, frame.elapsed, state.camera);
      } else {
        weave.setLocalTime(0, 0);
      }
    }

    /*
     * §2 Plate III: "Camera orbits slowly."
     *
     * Driven from here rather than from the plate, because there is one camera
     * and six plates: a plate that moved the camera itself would leave it
     * wherever it stopped, and the next plate would inherit a pose it never
     * asked for. Weighting by the slot's blend weight makes the orbit fade in
     * and out with the plate and guarantees the camera is back at the neutral
     * pose wherever no plate is asking for one.
     *
     * The angle comes from the plate's own local time, not from the clock, so
     * scrolling back up unwinds the orbit rather than continuing it — the piece
     * is a document, and a document does not have a different camera the second
     * time you read a page.
     */
    const orbitSlot = frame.router.slots[2];
    const orbitWeight = orbitSlot?.active ? orbitSlot.weight : 0;
    if (orbitWeight > 0 || cameraOrbited) {
      const angle = (orbitSlot?.t ?? 0) * ORBIT_SWEEP * orbitWeight;
      const camera = state.camera;
      camera.position.set(
        Math.sin(angle) * CAMERA_DISTANCE,
        Math.sin(angle * 0.6) * ORBIT_RISE * orbitWeight,
        Math.cos(angle) * CAMERA_DISTANCE,
      );
      camera.lookAt(0, 0, 0);
      cameraOrbited = orbitWeight > 0;
    }

    /*
     * Scene → HDR buffer → composite → canvas.
     *
     * The scene is rendered into a half-float target rather than straight to
     * the canvas so spectral accumulation above 1.0 survives to the tone
     * mapper. The composite pass does tone mapping, the sRGB encode and the
     * dither, in that order (§3.4).
     *
     * This is issued here rather than by r3f because the callback has a
     * non-zero renderPriority — anything drawn after an automatic render would
     * be cleared by the next one.
     */
    gl.setRenderTarget(composite.sceneTarget);
    gl.clear();
    gl.render(state.scene, state.camera);

    /*
     * Fullscreen plate passes draw into the same scene buffer, after the scene
     * geometry, before the composite. Plate II is a light-transport problem
     * rather than a shape one and has no geometry of its own.
     */
    const dispersion = getDispersionPlate();
    if (dispersion) {
      const slot = frame.router.slots[1];
      if (!slot?.active) {
        // Same reason as Plate I above. Plate II is a fullscreen pass that is
        // only issued while live, so it cannot bleed the way a mesh can — but
        // its weight is what the blend band reads, and leaving it stale means
        // the first frame after a re-entry is drawn at the old weight.
        dispersion.setLocalTime(0, 0);
      } else {
        dispersion.setLocalTime(slot.t, slot.weight);
        if (specimen) {
          dispersion.render(gl, SPECIMEN_FROZEN_TIME, touch.texture);
        } else {
          dispersion.drag(pointerState.x - lastPointerX, pointerState.pressure);
          dispersion.render(gl, frame.elapsed, touch.texture);
        }
      }
    }
    lastPointerX = pointerState.x;

    gl.setRenderTarget(null);

    /*
     * Bloom between the scene and the composite. §5.6 gives it to tiers 1 and
     * 2; tier 3 is "dither only", and the dither is the one pass §10 forbids
     * removing because it is what stops the void banding on exactly the cheap
     * panels that land in tier 3.
     */
    bloom.setEnabled(TIER_PROFILES[appStore.getState().tier].bloom);
    bloom.render(gl, composite.sceneTarget.texture);
    composite.present(gl, bloom.texture, bloom.intensity);

    if (appStore.getState().debug) {
      drawTouchDebug(gl, touch.texture);
    }

    // Last, so it reports the state the frame was actually drawn with.
    // No-ops in one branch when the HUD is off, which is the shipped path.
    paintHud();
  }, RENDER_PRIORITY);

  return null;
}
