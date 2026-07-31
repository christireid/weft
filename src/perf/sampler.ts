/**
 * Rolling p95 frame-time sampler (§5.6).
 *
 * §5.6 says to "adapt live from a rolling p95 frame-time sampler". The obvious
 * implementation — keep the last N deltas, sort, take the 95th percentile — is
 * an O(N log N) sort every frame plus an allocation for the sorted copy, in the
 * one place the piece cannot afford either (§5.2).
 *
 * So this uses a **histogram** instead. Frame times are bucketed at 0.5 ms
 * resolution across 0–64 ms, and the percentile is read by walking the buckets
 * until the cumulative count crosses the target. That is O(buckets) with no
 * allocation, no sort, and no per-frame garbage — and 0.5 ms resolution is far
 * finer than the 6 ms gaps between the §5.6 tier thresholds.
 *
 * The window is a ring: the oldest sample's bucket is decremented as the newest
 * is added, so the histogram always describes exactly the last N frames.
 */

/** 0.5 ms buckets from 0 to 64 ms. Anything slower lands in the last bucket. */
const BUCKET_MS = 0.5;
const BUCKETS = 128;

/** ~2 seconds at 60 fps. Long enough that one slow frame cannot move the p95. */
export const DEFAULT_WINDOW = 120;

export interface FrameSampler {
  readonly window: number;
  /** Ring of raw samples, in ms. Pre-allocated, never resized. */
  readonly samples: Float32Array;
  readonly histogram: Uint16Array;
  cursor: number;
  count: number;
  /** Total frames observed since boot, including those that have left the window. */
  observed: number;
}

export function createSampler(window: number = DEFAULT_WINDOW): FrameSampler {
  return {
    window,
    samples: new Float32Array(window),
    histogram: new Uint16Array(BUCKETS),
    cursor: 0,
    count: 0,
    observed: 0,
  };
}

function bucketOf(ms: number): number {
  if (!(ms > 0)) return 0;
  const index = Math.floor(ms / BUCKET_MS);
  return index >= BUCKETS ? BUCKETS - 1 : index;
}

/** Record one frame time, in milliseconds. Allocates nothing. */
export function pushSample(sampler: FrameSampler, ms: number): void {
  const { samples, histogram, window } = sampler;

  if (sampler.count === window) {
    // Evict the sample this slot is about to overwrite.
    const outgoing = bucketOf(samples[sampler.cursor] ?? 0);
    const previous = histogram[outgoing] ?? 0;
    if (previous > 0) histogram[outgoing] = previous - 1;
  } else {
    sampler.count += 1;
  }

  samples[sampler.cursor] = ms;
  const incoming = bucketOf(ms);
  histogram[incoming] = (histogram[incoming] ?? 0) + 1;

  sampler.cursor = sampler.cursor + 1 === window ? 0 : sampler.cursor + 1;
  sampler.observed += 1;
}

/**
 * Percentile of the current window, in milliseconds.
 *
 * Returns the *upper edge* of the bucket the percentile falls in, which biases
 * the reading pessimistic by up to 0.5 ms. That is the right direction to be
 * wrong in: it makes a tier downgrade slightly eager and an upgrade slightly
 * reluctant, so a marginal device settles at the lower tier rather than
 * oscillating around the boundary.
 */
export function percentile(sampler: FrameSampler, fraction: number): number {
  if (sampler.count === 0) return 0;

  const target = Math.ceil(fraction * sampler.count);
  let cumulative = 0;
  for (let i = 0; i < BUCKETS; i++) {
    cumulative += sampler.histogram[i] ?? 0;
    if (cumulative >= target) return (i + 1) * BUCKET_MS;
  }
  return BUCKETS * BUCKET_MS;
}

export function p95(sampler: FrameSampler): number {
  return percentile(sampler, 0.95);
}

export function p50(sampler: FrameSampler): number {
  return percentile(sampler, 0.5);
}

/** True once the window is full, so a tier decision is not made on 3 frames. */
export function isWarm(sampler: FrameSampler): boolean {
  return sampler.count === sampler.window;
}

export function resetSampler(sampler: FrameSampler): void {
  sampler.samples.fill(0);
  sampler.histogram.fill(0);
  sampler.cursor = 0;
  sampler.count = 0;
  sampler.observed = 0;
}
