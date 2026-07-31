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
