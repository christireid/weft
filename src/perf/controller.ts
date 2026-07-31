import { appStore, type Tier } from '../state/store';
import { createSampler, isWarm, p50, p95, pushSample, type FrameSampler } from './sampler';
import {
  createTierState,
  lockToFallback,
  stepTier,
  tierForP95,
  TIER_PROFILES,
  type TierProfile,
  type TierState,
} from './tier';

/**
 * Device tiering, end to end (§5.6).
 *
 * "Detect once at boot with a 500 ms probe, then adapt live from a rolling p95
 * frame-time sampler."
 *
 * Two phases, and they behave differently on purpose:
 *
 *   Boot probe   The first 500 ms are measured and the tier is set from them
 *                *immediately*, with no hysteresis. A phone that cannot hold
 *                tier 1 should never render one second of tier 1 before being
 *                rescued — that first second is when the visitor decides
 *                whether the page is broken.
 *
 *   Live         From then on the tier only moves after 90 consecutive frames
 *                past a threshold, so nothing transient can move it.
 *
 * The controller owns no GPU resources. It reports a tier; reconfiguring is the
 * caller's job, via the `onChange` callback, so the reallocation happens in one
 * place rather than being scattered across six plates.
 */

const BOOT_PROBE_MS = 500;

export interface TierController {
  readonly sampler: FrameSampler;
  readonly state: TierState;
  /** Seconds accumulated since boot, for the probe window. */
  elapsed: number;
  probeComplete: boolean;
  onChange: ((tier: Tier, profile: TierProfile) => void) | null;
}

export function createTierController(initial: Tier = 3): TierController {
  return {
    sampler: createSampler(),
    state: createTierState(initial),
    elapsed: 0,
    probeComplete: false,
    onChange: null,
  };
}

/** No WebGL2 at all: latch tier 4 and stop measuring (§6.3). */
export function failToStaticTier(controller: TierController): void {
  lockToFallback(controller.state);
  controller.probeComplete = true;
  publish(controller);
}

function publish(controller: TierController): void {
  const tier = controller.state.current;
  if (appStore.getState().tier !== tier) {
    appStore.getState().setTier(tier);
  }
  controller.onChange?.(tier, TIER_PROFILES[tier]);
}

/**
 * Advance one frame. Called from the single frame loop with the frame delta in
 * seconds. Allocates nothing (§5.2).
 */
export function stepTierController(controller: TierController, deltaSeconds: number): void {
  if (controller.state.locked) return;

  const ms = deltaSeconds * 1000;
  pushSample(controller.sampler, ms);
  controller.elapsed += deltaSeconds;

  if (!controller.probeComplete) {
    /*
     * The probe ends on time *and* on data — a device so slow that 500 ms is
     * only a dozen frames is exactly the device whose tier matters most, and
     * deciding from a dozen samples is better than waiting. `isWarm` is not
     * required here; it gates the live phase.
     */
    if (controller.elapsed * 1000 >= BOOT_PROBE_MS && controller.sampler.count >= 8) {
      controller.probeComplete = true;
      const probed = tierForP95(p95(controller.sampler));
      if (probed !== controller.state.current) {
        controller.state.current = probed;
        controller.state.candidate = probed;
        controller.state.streak = 0;
        controller.state.switches += 1;
        publish(controller);
      }
    }
    return;
  }

  // Live phase: only act on a full window, so a tier is never chosen from a
  // handful of frames after a resize or a tab restore.
  if (!isWarm(controller.sampler)) return;

  if (stepTier(controller.state, p95(controller.sampler))) {
    publish(controller);
  }
}

/** Current profile, for callers that need it without subscribing. */
export function currentProfile(controller: TierController): TierProfile {
  return TIER_PROFILES[controller.state.current];
}

/** Diagnostics for the debug HUD. */
export function tierReadout(controller: TierController): {
  tier: Tier;
  p50: number;
  p95: number;
  streak: number;
  switches: number;
  warm: boolean;
} {
  return {
    tier: controller.state.current,
    p50: p50(controller.sampler),
    p95: p95(controller.sampler),
    streak: controller.state.streak,
    switches: controller.state.switches,
    warm: isWarm(controller.sampler),
  };
}
