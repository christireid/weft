import { describe, expect, it } from 'vitest';
import {
  HYSTERESIS_FRAMES,
  TIER_PROFILES,
  createTierState,
  lockToFallback,
  stepTier,
  tierForP95,
} from '../src/perf/tier';
import {
  createSampler,
  isWarm,
  p50,
  p95,
  percentile,
  pushSample,
  resetSampler,
} from '../src/perf/sampler';

/*
 * §8.2 item 3: "Tier selection — given a frame-time series, assert the tier and
 * that hysteresis prevents oscillation."
 *
 * The oscillation case is the one that matters. A tier system without
 * hysteresis on a device sitting exactly at a threshold will flip every few
 * frames, and because a tier change reallocates GPGPU targets, that is not a
 * cosmetic wobble — it is a stutter every time it happens.
 */

describe('tier thresholds (§5.6)', () => {
  it('maps p95 to the specified tiers', () => {
    expect(tierForP95(8)).toBe(1);
    expect(tierForP95(11.99)).toBe(1);
    expect(tierForP95(12)).toBe(2);
    expect(tierForP95(18)).toBe(2);
    expect(tierForP95(18.01)).toBe(3);
    expect(tierForP95(40)).toBe(3);
  });

  it('gives every tier a complete profile, monotonically decreasing in cost', () => {
    const [t1, t2, t3] = [TIER_PROFILES[1], TIER_PROFILES[2], TIER_PROFILES[3]];
    expect(t1.particles).toBeGreaterThan(t2.particles);
    expect(t2.particles).toBeGreaterThan(t3.particles);
    expect(t1.cloth).toBeGreaterThan(t2.cloth);
    expect(t2.cloth).toBeGreaterThan(t3.cloth);
    expect(t1.maxDpr).toBeGreaterThan(t2.maxDpr);
    expect(t2.maxDpr).toBeGreaterThan(t3.maxDpr);

    // §5.6: tier 3 is "dither only" — the dither pass survives every tier
    // because §10 forbids removing it, and because it is what stops the void
    // banding on exactly the cheap panels that land in tier 3.
    expect(t3.bloom).toBe(false);
    expect(t1.dither && t2.dither && t3.dither).toBe(true);
  });

  it('matches §2 Plate II on tier 1 spectral sample count', () => {
    expect(TIER_PROFILES[1].spectralSamples).toBe(16);
    // Lower tiers may sample less; the loop self-normalises so this cannot
    // tint the plate (verified on the GPU in tools/shaders.spec.ts).
    expect(TIER_PROFILES[2].spectralSamples).toBeLessThan(16);
    expect(TIER_PROFILES[3].spectralSamples).toBeLessThan(16);
  });
});

describe('hysteresis', () => {
  it('does not switch before the specified number of consecutive frames', () => {
    const state = createTierState(2);
    for (let i = 0; i < HYSTERESIS_FRAMES - 1; i++) {
      expect(stepTier(state, 5), `switched early at frame ${String(i)}`).toBe(false);
      expect(state.current).toBe(2);
    }
    expect(stepTier(state, 5)).toBe(true);
    expect(state.current).toBe(1);
    expect(state.switches).toBe(1);
  });

  it('resets the streak when the reading returns to the current tier', () => {
    /*
     * The property that makes this hysteresis rather than a counter. A device
     * hovering at a boundary produces a fast frame now and then; without the
     * reset those accumulate and the tier flips minutes later for no reason
     * the visitor can perceive.
     */
    const state = createTierState(2);
    for (let i = 0; i < HYSTERESIS_FRAMES - 1; i++) stepTier(state, 5);
    expect(state.streak).toBe(HYSTERESIS_FRAMES - 1);

    stepTier(state, 15); // back inside tier 2
    expect(state.streak).toBe(0);

    // The near-miss is forgotten: a full run is needed again.
    for (let i = 0; i < HYSTERESIS_FRAMES - 1; i++) {
      expect(stepTier(state, 5)).toBe(false);
    }
    expect(state.current).toBe(2);
  });

  it('never oscillates on a signal sitting exactly on a threshold', () => {
    // The failure this whole mechanism exists to prevent.
    const state = createTierState(2);
    let switches = 0;
    for (let i = 0; i < 6000; i++) {
      // Alternates either side of the 12 ms boundary every frame.
      if (stepTier(state, i % 2 === 0 ? 11.9 : 12.1)) switches += 1;
    }
    expect(switches, 'tier oscillated on a boundary-straddling signal').toBe(0);
    expect(state.current).toBe(2);
  });

  it('does switch on a signal that is genuinely and persistently worse', () => {
    const state = createTierState(1);
    let switched = 0;
    for (let i = 0; i < 400; i++) {
      if (stepTier(state, 25)) switched += 1;
    }
    expect(state.current).toBe(3);
    expect(switched).toBe(1);
  });

  it('survives a burst of slow frames without downgrading', () => {
    // A GC pause, a shader compile, or a plate boundary. 30 frames is half a
    // second — well inside the 90-frame requirement.
    const state = createTierState(1);
    for (let i = 0; i < 500; i++) {
      const slow = i % 200 < 30;
      stepTier(state, slow ? 30 : 8);
    }
    expect(state.current).toBe(1);
    expect(state.switches).toBe(0);
  });

  it('latches tier 4 irreversibly', () => {
    // No WebGL2 is a capability, not a measurement; no amount of fast frames
    // brings a context back.
    const state = createTierState(1);
    lockToFallback(state);
    for (let i = 0; i < 1000; i++) expect(stepTier(state, 2)).toBe(false);
    expect(state.current).toBe(4);
  });
});

describe('the rolling sampler', () => {
  it('reports a percentile of the window, not of all history', () => {
    const sampler = createSampler(100);
    // 100 slow frames, then 100 fast ones: the window must forget the slow ones.
    for (let i = 0; i < 100; i++) pushSample(sampler, 40);
    expect(p95(sampler)).toBeGreaterThan(35);
    for (let i = 0; i < 100; i++) pushSample(sampler, 8);
    expect(p95(sampler)).toBeLessThan(9);
    expect(sampler.observed).toBe(200);
  });

  it('computes percentiles correctly against a known distribution', () => {
    const sampler = createSampler(100);
    // 95 frames at 10 ms and 5 at 30 ms: the p95 sits at the boundary.
    for (let i = 0; i < 95; i++) pushSample(sampler, 10);
    for (let i = 0; i < 5; i++) pushSample(sampler, 30);

    expect(p50(sampler)).toBeGreaterThanOrEqual(10);
    expect(p50(sampler)).toBeLessThanOrEqual(10.5);
    expect(p95(sampler)).toBeGreaterThanOrEqual(10);
    expect(p95(sampler)).toBeLessThanOrEqual(10.5);
    // p99 must catch the tail the p95 does not.
    expect(percentile(sampler, 0.99)).toBeGreaterThan(29);
  });

  it('is pessimistic by less than one bucket, never optimistic', () => {
    /*
     * The reading is the upper edge of the bucket, so it can overstate by up to
     * 0.5 ms and can never understate. Being wrong in that direction makes a
     * downgrade eager and an upgrade reluctant, which settles a marginal device
     * at the lower tier instead of hunting.
     */
    const sampler = createSampler(64);
    for (let i = 0; i < 64; i++) pushSample(sampler, 13.2);
    const reading = p95(sampler);
    expect(reading).toBeGreaterThanOrEqual(13.2);
    expect(reading - 13.2).toBeLessThan(0.5);
  });

  it('clamps absurd frame times into the top bucket rather than misreporting', () => {
    // A tab restored after an hour produces a delta in the millions.
    const sampler = createSampler(10);
    for (let i = 0; i < 10; i++) pushSample(sampler, 3_600_000);
    expect(Number.isFinite(p95(sampler))).toBe(true);
    expect(p95(sampler)).toBe(64);
  });

  it('handles zero and negative deltas without corrupting the histogram', () => {
    const sampler = createSampler(10);
    for (let i = 0; i < 5; i++) pushSample(sampler, 0);
    pushSample(sampler, -1);
    pushSample(sampler, Number.NaN);
    for (let i = 0; i < 3; i++) pushSample(sampler, 8);
    const total = sampler.histogram.reduce((a, b) => a + b, 0);
    expect(total, 'histogram count must equal window occupancy').toBe(sampler.count);
  });

  it('keeps the histogram consistent with the ring across many evictions', () => {
    // The eviction bookkeeping is the part that silently breaks.
    const sampler = createSampler(32);
    for (let i = 0; i < 5000; i++) pushSample(sampler, (i % 40) + 1);
    const total = sampler.histogram.reduce((a, b) => a + b, 0);
    expect(total).toBe(32);
    expect(sampler.count).toBe(32);
  });

  it('reports warmth so a tier is never chosen from three frames', () => {
    const sampler = createSampler(50);
    expect(isWarm(sampler)).toBe(false);
    for (let i = 0; i < 49; i++) pushSample(sampler, 10);
    expect(isWarm(sampler)).toBe(false);
    pushSample(sampler, 10);
    expect(isWarm(sampler)).toBe(true);
    resetSampler(sampler);
    expect(isWarm(sampler)).toBe(false);
    expect(p95(sampler)).toBe(0);
  });

  it('allocates nothing per sample', () => {
    // Runs in the frame loop (§5.2). Identity of the backing arrays proves the
    // ring is reused rather than rebuilt.
    const sampler = createSampler(64);
    const samplesRef = sampler.samples;
    const histogramRef = sampler.histogram;
    for (let i = 0; i < 1000; i++) pushSample(sampler, 8 + (i % 7));
    expect(sampler.samples).toBe(samplesRef);
    expect(sampler.histogram).toBe(histogramRef);
  });
});
