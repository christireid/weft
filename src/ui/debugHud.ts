import { frame } from '../state/frame';
import { PLATES } from '../config/plates';
import { appStore } from '../state/store';

/**
 * Debug HUD painter.
 *
 * The overlay proves the L1 wiring: global progress, which plates are live, and
 * each one's local `t` to three decimals (§7 L1 task 1).
 *
 * It is painted by writing `textContent` on refs registered here, called from
 * the one frame loop. It is deliberately *not* React state — a HUD that
 * re-rendered the tree at 60 Hz to display the frame rate would be measuring
 * its own overhead, and §5.2 forbids reading scroll progress through React
 * anyway.
 *
 * `toFixed` allocates a string per field per paint, which breaks the
 * no-allocation rule. Two mitigations, both deliberate: the HUD is off by
 * default and never rendered in production, and when on it paints at
 * PAINT_EVERY-frame intervals rather than every frame. The L1 heap-growth gate
 * runs with the HUD off, which is the shipped configuration.
 */

/** ~10 Hz at 60 fps. Faster than this is unreadable to a human anyway. */
const PAINT_EVERY = 6;

export interface HudRefs {
  progress: HTMLElement | null;
  primary: HTMLElement | null;
  active: HTMLElement | null;
  rows: (HTMLElement | null)[];
  fps: HTMLElement | null;
}

const refs: HudRefs = {
  progress: null,
  primary: null,
  active: null,
  rows: PLATES.map(() => null),
  fps: null,
};

export function registerHud(next: Partial<HudRefs>): void {
  if (next.progress !== undefined) refs.progress = next.progress;
  if (next.primary !== undefined) refs.primary = next.primary;
  if (next.active !== undefined) refs.active = next.active;
  if (next.fps !== undefined) refs.fps = next.fps;
  if (next.rows) {
    for (let i = 0; i < next.rows.length; i++) refs.rows[i] = next.rows[i] ?? null;
  }
}

export function clearHud(): void {
  refs.progress = null;
  refs.primary = null;
  refs.active = null;
  refs.fps = null;
  for (let i = 0; i < refs.rows.length; i++) refs.rows[i] = null;
}

/** Rolling mean of frame delta, for the HUD's fps readout only. */
let smoothedDelta = 1 / 60;

export function paintHud(): void {
  smoothedDelta += (frame.delta - smoothedDelta) * 0.1;

  if (!appStore.getState().debug) return;
  if (frame.count % PAINT_EVERY !== 0) return;

  const { router } = frame;

  if (refs.progress) refs.progress.textContent = frame.progress.toFixed(3);
  if (refs.fps) refs.fps.textContent = (1 / Math.max(1e-6, smoothedDelta)).toFixed(0);
  if (refs.active) refs.active.textContent = String(router.activeCount);
  if (refs.primary) {
    const plate = PLATES[router.primary];
    refs.primary.textContent = plate ? `${plate.numeral} ${plate.label}` : '—';
  }

  for (let i = 0; i < refs.rows.length; i++) {
    const el = refs.rows[i];
    const slot = router.slots[i];
    if (!el || !slot) continue;
    el.textContent = slot.active ? `t ${slot.t.toFixed(3)}  w ${slot.weight.toFixed(3)}` : '—';
    el.dataset.active = slot.active ? 'true' : 'false';
  }
}
