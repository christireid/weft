import { describe, expect, it } from 'vitest';
import { BLEND, PLATES, SCROLL_LENGTH_VH, sectionHeightVh } from '../src/config/plates';
import { createRouterState, updateRouter } from '../src/gl/plateRouter';

/*
 * §8.2 item 2: "Plate router — given a scroll progress, assert the active plate
 * set and each local t. Pure function, exhaustively testable."
 *
 * So it is tested exhaustively: a sweep at 0.0005 steps is 2001 samples, which
 * is cheap and covers every boundary and blend band rather than the handful of
 * points someone would think to pick.
 */

const STEP = 0.0005;

describe('the plate table (§2)', () => {
  it('tiles [0,1] with no gap and no overlap', () => {
    expect(PLATES[0]?.start).toBe(0);
    expect(PLATES[PLATES.length - 1]?.end).toBe(1);
    for (let i = 1; i < PLATES.length; i++) {
      expect(PLATES[i]?.start, `plate ${String(i)} starts where ${String(i - 1)} ends`).toBeCloseTo(
        PLATES[i - 1]?.end ?? -1,
        10,
      );
    }
  });

  it('matches the ranges in §2 exactly', () => {
    expect(PLATES.map((p) => [p.start, p.end])).toEqual([
      [0.0, 0.16],
      [0.16, 0.33],
      [0.33, 0.5],
      [0.5, 0.66],
      [0.66, 0.83],
      [0.83, 1.0],
    ]);
  });

  it('derives section heights that sum to the document length', () => {
    const total = PLATES.reduce((a, p) => a + sectionHeightVh(p), 0);
    expect(total).toBeCloseTo(SCROLL_LENGTH_VH, 6);
  });

  it('numbers plates in Roman, because they are plates and not steps (§3.3)', () => {
    expect(PLATES.map((p) => p.numeral)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI']);
  });

  it('fixes Plate I copy verbatim from §4.2', () => {
    expect(PLATES[0]?.label).toBe('TENSIO');
    expect(PLATES[0]?.subtitle).toBe('A single filament, held under load.');
  });
});

describe('the plate router', () => {
  it('always has at least one live plate across the whole document', () => {
    const state = createRouterState();
    for (let x = 0; x <= 1 + 1e-9; x += STEP) {
      updateRouter(state, x);
      expect(state.activeCount, `no live plate at progress ${x.toFixed(4)}`).toBeGreaterThanOrEqual(
        1,
      );
    }
  });

  it('never has more than two live plates at once', () => {
    /*
     * This is the frame budget. Blend bands are narrower than the shortest
     * plate, so three plates can never overlap — if that stops being true the
     * GPGPU step could be asked to run three simulations in one frame.
     */
    const state = createRouterState();
    let max = 0;
    for (let x = 0; x <= 1 + 1e-9; x += STEP) {
      updateRouter(state, x);
      max = Math.max(max, state.activeCount);
    }
    expect(max).toBe(2);
  });

  it('keeps local t within [-blend, 1+blend] and monotonic in progress', () => {
    const state = createRouterState();
    const previous = PLATES.map(() => Number.NEGATIVE_INFINITY);
    for (let x = 0; x <= 1 + 1e-9; x += STEP) {
      updateRouter(state, x);
      for (let i = 0; i < PLATES.length; i++) {
        const plate = PLATES[i];
        const slot = state.slots[i];
        if (!plate || !slot?.active) continue;
        const blendT = BLEND / (plate.end - plate.start);
        expect(slot.t).toBeGreaterThanOrEqual(-blendT - 1e-9);
        expect(slot.t).toBeLessThanOrEqual(1 + blendT + 1e-9);
        expect(slot.t, `t went backwards in plate ${plate.numeral}`).toBeGreaterThanOrEqual(
          (previous[i] ?? 0) - 1e-9,
        );
        previous[i] = slot.t;
      }
    }
  });

  it('hands weight over across a boundary summing to 1', () => {
    /*
     * The hand-off property that makes a boundary a transformation rather than
     * a switch: as one plate's weight falls the next one's rises by the same
     * amount, so the total authority in the frame is constant.
     */
    const state = createRouterState();
    for (let i = 1; i < PLATES.length; i++) {
      const boundary = PLATES[i]?.start ?? 0;
      for (let d = -BLEND; d <= BLEND; d += BLEND / 16) {
        updateRouter(state, boundary + d);
        const total = state.slots.reduce((a, s) => a + s.weight, 0);
        expect(total, `weights at boundary ${boundary.toFixed(3)}${d.toFixed(4)}`).toBeCloseTo(
          1,
          6,
        );
      }
    }
  });

  it('gives plate I full weight at the first pixel and plate VI full weight at the last', () => {
    const state = createRouterState();
    updateRouter(state, 0);
    expect(state.slots[0]?.weight).toBe(1);
    expect(state.slots[0]?.t).toBe(0);
    expect(state.primary).toBe(0);

    updateRouter(state, 1);
    expect(state.slots[5]?.weight).toBe(1);
    expect(state.slots[5]?.t).toBe(1);
    expect(state.primary).toBe(5);
  });

  it('names the plate whose range contains progress as primary, away from boundaries', () => {
    const state = createRouterState();
    for (let i = 0; i < PLATES.length; i++) {
      const plate = PLATES[i];
      if (!plate) continue;
      const mid = (plate.start + plate.end) / 2;
      updateRouter(state, mid);
      expect(state.primary, `midpoint of plate ${plate.numeral}`).toBe(i);
      expect(state.slots[i]?.weight).toBeCloseTo(1, 10);
      expect(state.activeCount).toBe(1);
    }
  });

  it('clamps out-of-range progress rather than extrapolating', () => {
    const state = createRouterState();
    updateRouter(state, -5);
    expect(state.progress).toBe(0);
    expect(state.primary).toBe(0);
    updateRouter(state, 12);
    expect(state.progress).toBe(1);
    expect(state.primary).toBe(5);
  });

  it('allocates nothing after the first call', () => {
    /*
     * The router runs inside the one frame loop, so this is not a style
     * preference (§5.2). Identity of the slot objects proves they are mutated
     * rather than rebuilt — a router that returned fresh objects would pass
     * every other test in this file and still hand the GC 60 objects a second.
     */
    const state = createRouterState();
    const slotsRef = state.slots;
    const slotRefs = state.slots.map((s) => s);

    for (let x = 0; x <= 1; x += 0.01) updateRouter(state, x);

    expect(state.slots).toBe(slotsRef);
    state.slots.forEach((s, i) => {
      expect(s).toBe(slotRefs[i]);
    });
  });
});
