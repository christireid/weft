import { expect, test } from '@playwright/test';
import { PLATES } from '../src/config/plates';
import { decode } from './lib/png';

/*
 * A plate that is not live contributes nothing to the frame.
 *
 * WHY THIS TEST EXISTS
 *
 * Plate I's filament was visible across Plate III, and would have been visible
 * across every plate after it. The cause is structural rather than a typo, so it
 * will recur: a plate's mesh stays in the scene graph for the whole document —
 * mounting and unmounting per plate would rebuild its buffers at every crossing
 * — and the router only tells a plate its weight while that plate is live. Stop
 * telling it, and it keeps drawing at the last weight it was given.
 *
 * Every plate added from here on has the same shape and the same trap.
 *
 * The measurement is a specific consequence rather than a general one, because a
 * general "is the frame different" assertion cannot distinguish a bleed from the
 * plate that is supposed to be there. Plate I's filament is the only thing in
 * the piece that spans the viewport edge to edge; Plate III's cloud and Plate
 * II's wedge both sit well inside the frame. So: at a scroll offset deep inside
 * a later plate, the outer columns of the frame must be void.
 */

test.setTimeout(240_000);

/** Fraction of the frame width, each side, that no later plate reaches into. */
const MARGIN = 0.04;

/**
 * Above --void by this much, in 8-bit levels, counts as something drawn.
 *
 * Not zero: §3.4's dither puts structured noise into the void by design, and
 * that noise is the point of it. Measured on a void-only capture the dither
 * stays inside ±4 levels, so 10 is clear of it without being so loose that a
 * dim filament would slip through — Plate I's thread reads at 60 to 200.
 */
const THRESHOLD = 10;

const turbulence = PLATES.find((plate) => plate.id === 'turbulence');

test('Plate I does not bleed into Plate III', async ({ page }) => {
  expect(turbulence, 'Plate III in the plate table').toBeDefined();
  if (!turbulence) return;

  await page.goto('/?tier=1', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);

  const middle = (turbulence.start + turbulence.end) / 2;
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  await page.evaluate((y) => {
    window.scrollTo(0, y);
  }, middle * scrollable);
  await page.waitForTimeout(1500);

  // Hide the document layer: the annotation and the plate labels are real DOM
  // text near the left edge, and they are not what this is measuring.
  await page.addStyleTag({ content: '.document { visibility: hidden !important; }' });
  await page.waitForTimeout(300);

  const shot = decode(await page.screenshot({ animations: 'allow' }));
  const marginPx = Math.floor(shot.width * MARGIN);

  let brightest = 0;
  let brightestAt = '';
  for (const [label, x0] of [
    ['left', 0],
    ['right', shot.width - marginPx],
  ] as const) {
    for (let y = 0; y < shot.height; y += 2) {
      for (let x = x0; x < x0 + marginPx; x += 2) {
        const pixel = shot.at(x, y);
        // Against --void (5,5,7): the filament is achromatic and bright, so the
        // largest channel excess over the void floor is the sharpest signal.
        const excess = Math.max(pixel.r - 5, pixel.g - 5, pixel.b - 7);
        if (excess > brightest) {
          brightest = excess;
          brightestAt = `${label} margin at (${String(x)}, ${String(y)})`;
        }
      }
    }
  }

  console.log(
    `[plates] brightest pixel in the outer ${String(MARGIN * 100)}% at Plate III: ` +
      `${brightest.toFixed(1)} levels over --void${brightestAt ? ` — ${brightestAt}` : ''}`,
  );

  expect(
    brightest,
    'something is drawing at the frame edge during Plate III — Plate I spans the ' +
      'full width and nothing else in the piece does',
  ).toBeLessThan(THRESHOLD);
});
