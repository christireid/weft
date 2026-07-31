import { expect, test } from '@playwright/test';

/**
 * Every shader program links, on every plate.
 *
 * WHY THIS TEST EXISTS
 *
 * Bloom shipped once with a fragment shader that never compiled. `luminance` is
 * defined by the chunk three prepends to every ShaderMaterial
 * (`tonemapping_pars_fragment`), so declaring `float luminance(vec3 c)` in a
 * pass is a redefinition with different parameter qualifiers rather than an
 * override. three logged the failure and carried on. The program never linked,
 * every draw that used it was dropped with INVALID_OPERATION, and the bloom
 * targets stayed at their clear colour.
 *
 * Nothing about the frame looked broken — it simply had no bloom in it. Three
 * separate rounds of reasoning about the render graph missed it, because every
 * line of the render graph was correct. Only the browser console said so.
 *
 * The general shape of the defect, which is the reason for the general shape of
 * this test: a GPU program that fails to link is not an exception. It is a
 * console message and a frame that is quietly missing a pass. So this asserts on
 * the console rather than on any particular pass, and it scrolls the whole piece
 * so that every plate's materials are actually compiled — a program is only
 * linked on first use, so a test that never scrolls only proves the first plate.
 */

/** Software rasterisation compiles slowly; the sweep visits every plate. */
test.setTimeout(300_000);

/**
 * Known-benign console output. Anything not matched here fails the test.
 *
 * Deliberately short, and each entry has to be justified. A permissive filter
 * here recreates exactly the blindness this test exists to remove.
 */
const ALLOWED = [
  // three 0.185 deprecates Clock in favour of Timer. r3f still constructs one
  // internally, so it is not ours to fix and not a signal about our shaders.
  /THREE\.Clock: This module has been deprecated/,
];

test('no shader program fails to link, on any plate', async ({ page }) => {
  const noise: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const text = message.text();
    if (ALLOWED.some((pattern) => pattern.test(text))) return;
    noise.push(`[${message.type()}] ${text}`);
  });
  page.on('pageerror', (error) => {
    noise.push(`[pageerror] ${error.message}`);
  });

  // Tier 1 so the full post chain is exercised. On tier 3 bloom is disabled by
  // §5.6 and its program is never compiled, so an unpinned run would pass while
  // the bloom shader was broken — which is the exact hole being closed.
  await page.goto('/?tier=1', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  /*
   * Sweep the whole document. Materials are compiled lazily on first draw, so
   * a plate that is never scrolled into range never links its programs and
   * this test would say nothing about it.
   */
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  const STOPS = 24;
  for (let i = 0; i <= STOPS; i++) {
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, (i / STOPS) * scrollable);
    await page.waitForTimeout(220);
  }

  // Interaction compiles nothing new today, but a pass gated behind a pointer
  // would otherwise be invisible here, and the cost is one second.
  await page.mouse.move(640, 420);
  await page.mouse.down();
  await page.mouse.move(820, 320);
  await page.mouse.up();
  await page.waitForTimeout(400);

  expect(noise, `console output during a full scroll sweep:\n${noise.join('\n')}`).toEqual([]);
});
