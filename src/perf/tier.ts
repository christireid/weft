import type { Tier } from '../state/store';

/**
 * Device tiering (§5.6).
 *
 * | Tier | Trigger              | DPR   | Particles | Cloth | Post            |
 * | ---- | -------------------- | ----- | --------- | ----- | --------------- |
 * | 1    | p95 < 12 ms          | ≤2    | 500k      | 128²  | Full            |
 * | 2    | p95 12–18 ms         | 1.5   | 220k      | 96²   | Bloom + dither  |
 * | 3    | p95 > 18 ms or mobile| 1.0   | 80k       | 64²   | Dither only     |
 * | 4    | No WebGL2            | —     | —         | —     | Static (§6.3)   |
 *
 * Two things here are pure functions with no renderer dependency, so §8.2 item
 * 3 ("given a frame-time series, assert the tier and that hysteresis prevents
 * oscillation") can test them exhaustively.
 */

export interface TierProfile {
  readonly tier: Tier;
  /** Cap on devicePixelRatio. Tier 1 still respects the device's own value. */
  readonly maxDpr: number;
  readonly particles: number;
  /** Cloth simulation grid, one side. */
  readonly cloth: number;
  readonly bloom: boolean;
  readonly dither: boolean;
  /** Wavelengths sampled in the dispersion loop (§2 Plate II specifies 16). */
  readonly spectralSamples: number;
  /** GPGPU position/velocity target, one side. */
  readonly simSize: number;
  readonly curlOctaves: number;
}

export const TIER_PROFILES: Record<Tier, TierProfile> = {
  1: {
    tier: 1,
    maxDpr: 2,
    particles: 500_000,
    cloth: 128,
    bloom: true,
    dither: true,
    spectralSamples: 16,
    simSize: 1024,
    curlOctaves: 3,
  },
  2: {
    tier: 2,
    maxDpr: 1.5,
    particles: 220_000,
    cloth: 96,
    bloom: true,
    dither: true,
    spectralSamples: 12,
    simSize: 512,
    curlOctaves: 2,
  },
  3: {
    tier: 3,
    maxDpr: 1,
    particles: 80_000,
    cloth: 64,
    bloom: false,
    dither: true,
    spectralSamples: 8,
    simSize: 512,
    curlOctaves: 2,
  },
  4: {
    tier: 4,
    maxDpr: 1,
    particles: 0,
    cloth: 0,
    bloom: false,
    dither: false,
    spectralSamples: 0,
    simSize: 0,
    curlOctaves: 0,
  },
};

/** §5.6 thresholds, in milliseconds of p95 frame time. */
export const TIER_1_CEILING_MS = 12;
export const TIER_2_CEILING_MS = 18;

/**
 * Frames a candidate tier must hold before the switch happens.
 *
 * §5.6: "Tier changes are hysteretic: require 90 consecutive frames past the
 * threshold before switching, so the site never oscillates." At 60 fps that is
 * 1.5 seconds — long enough that a GC pause, a shader compile, or scrolling
 * past a plate boundary cannot trigger a downgrade, short enough that a
 * genuinely struggling device is rescued before the visitor gives up.
 */
export const HYSTERESIS_FRAMES = 90;

/** Which tier a given p95 implies, ignoring hysteresis. */
export function tierForP95(p95Ms: number): Tier {
  if (p95Ms < TIER_1_CEILING_MS) return 1;
  if (p95Ms <= TIER_2_CEILING_MS) return 2;
  return 3;
}

export interface TierState {
  current: Tier;
  /** The tier the current p95 implies, which may differ from `current`. */
  candidate: Tier;
  /** How many consecutive frames `candidate` has disagreed with `current`. */
  streak: number;
  /** Total switches since boot. Surfaced in the debug HUD. */
  switches: number;
  /** True once tier 4 is latched; it is a capability, not a measurement. */
  locked: boolean;
}

export function createTierState(initial: Tier = 3): TierState {
  return { current: initial, candidate: initial, streak: 0, switches: 0, locked: initial === 4 };
}

/**
 * Advance the tier state by one frame. Mutates in place — this runs in the
 * frame loop (§5.2).
 *
 * Returns true if the tier changed this frame, so the caller can reconfigure
 * without polling.
 */
export function stepTier(state: TierState, p95Ms: number): boolean {
  if (state.locked) return false;

  const implied = tierForP95(p95Ms);

  if (implied === state.current) {
    // Back in agreement: reset the streak. This is what makes the hysteresis
    // require *consecutive* frames rather than merely 90 frames in total —
    // without it, a device hovering at a threshold accumulates a switch over
    // several minutes and then flips for no visible reason.
    state.candidate = state.current;
    state.streak = 0;
    return false;
  }

  if (implied === state.candidate) {
    state.streak += 1;
  } else {
    state.candidate = implied;
    state.streak = 1;
  }

  if (state.streak >= HYSTERESIS_FRAMES) {
    state.current = state.candidate;
    state.streak = 0;
    state.switches += 1;
    return true;
  }

  return false;
}

/** Latch tier 4. Irreversible: a missing WebGL2 context does not come back. */
export function lockToFallback(state: TierState): void {
  state.current = 4;
  state.candidate = 4;
  state.streak = 0;
  state.locked = true;
}
