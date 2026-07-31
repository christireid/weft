import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const OUT = join(process.cwd(), 'docs', 'verification');

test('axe-core: zero violations on the document layer', async ({ page }) => {
  await mkdir(OUT, { recursive: true });

  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();

  await writeFile(
    join(OUT, 'axe.json'),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        url: results.url,
        passes: results.passes.length,
        incomplete: results.incomplete.map((r) => r.id),
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map((n) => n.html),
        })),
      },
      null,
      2,
    )}\n`,
  );

  if (results.violations.length > 0) {
    console.log(JSON.stringify(results.violations, null, 2));
  }
  expect(results.violations, 'axe violations').toEqual([]);
});

test('the canvas is outside the accessibility tree and the document is not', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });

  // §6.1: the canvas is aria-hidden; the text is real, selectable DOM.
  const stageHidden = await page.locator('[data-stage]').getAttribute('aria-hidden');
  expect(stageHidden).toBe('true');

  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('WEFT');
  await expect(page).toHaveTitle(/WEFT/);
  expect(await page.locator('html').getAttribute('lang')).toBe('en');

  // The tagline must be real text a screen reader can reach, not painted pixels.
  await expect(page.getByText('Field notes on a material that does not exist.')).toBeVisible();
});

test('keyboard: Tab reaches every plate, and arrows move the document (§6.1)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // First stop is the skip link, then one stop per plate.
  const reached: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.id ?? '');
    const cls = await page.evaluate(() => document.activeElement?.className ?? '');
    if (cls.includes('plate')) reached.push(id);
  }
  console.log(`[a11y] tab stops on plates: ${reached.join(', ')}`);
  expect(reached, 'Tab must reach all six plates (§6.1)').toEqual([
    'plate-i',
    'plate-ii',
    'plate-iii',
    'plate-iv',
    'plate-v',
    'plate-vi',
  ]);

  /*
   * Arrow keys nudge scroll. Wait for the frame loop to be running first: the
   * renderer is lazy-loaded, so Lenis does not exist for the first moment of
   * the page's life, and a nudge issued before it initialises is overwritten
   * the instant it does.
   */
  await page.waitForFunction(() => {
    const w = window as unknown as { __weftFrame?: { count: number } };
    return (w.__weftFrame?.count ?? 0) > 3;
  });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => window.scrollY);
  console.log(`[a11y] ArrowDown moved scrollY ${String(before)} -> ${String(after)}`);
  expect(after, 'ArrowDown must nudge scroll (§6.1)').toBeGreaterThan(before);
});

test('the skip link is reachable and targets the catalogue', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();
  expect(await skip.getAttribute('href')).toBe('#catalogue');
  await expect(page.locator('#catalogue')).toHaveCount(1);
});

test.describe('reduced motion (§6.2, §8.2 item 5)', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('Specimen Mode renders, and no simulation steps', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(6000);

    // Still a rendered page, not a blanked one — §6.2 calls this "a designed
    // state, not a disabled state".
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('WEFT');

    /*
     * And nothing moves. Byte-identical screenshots are the only assertion that
     * actually proves this: pinning a clock is not enough, because the wave
     * equation is an integrator that advances whatever time it is told. This
     * test was written after two screenshots 2.5 s apart turned out to differ.
     */
    const first = await page.screenshot();
    await page.waitForTimeout(3000);
    const second = await page.screenshot();
    expect(
      Buffer.compare(first, second),
      'reduced-motion frames must be byte-identical (§6.2)',
    ).toBe(0);
  });
});
