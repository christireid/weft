import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { VOID_HEX } from '../src/config/identity';
import { decode, formatRgb, fromHex, maxChannelDelta } from './lib/png';

const OUT = join(process.cwd(), 'docs', 'verification', 'captures');

const at = Number(process.env.WEFT_CAPTURE_AT ?? '0');
const label = process.env.WEFT_CAPTURE_LABEL ?? '';
const slug = `${label ? `${label}-` : ''}at-${at.toFixed(3).replace('.', 'p')}`;

test('capture a still at the requested scroll offset', async ({ page }) => {
  await mkdir(OUT, { recursive: true });

  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return !!c && c.width > 0 && c.height > 0;
  });
  await page.waitForTimeout(500);

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  if (scrollable > 0) {
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, at * scrollable);
    await page.waitForTimeout(500);
  }

  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2');
    return {
      backingWidth: canvas?.width ?? 0,
      backingHeight: canvas?.height ?? 0,
      cssWidth: canvas?.clientWidth ?? 0,
      cssHeight: canvas?.clientHeight ?? 0,
      webgl2: !!gl,
    };
  });

  const file = join(OUT, `${slug}.png`);
  const shot = await page.screenshot({ path: file, animations: 'allow' });

  /* ------------------------------------------------------------------ *
   * Gate evidence: the canvas clears to --void, exactly.
   *
   * Sampling the composited page proves nothing on its own — the body is
   * also --void, so a canvas that never drew a frame would pass. So paint
   * the page behind the canvas magenta and hide the document layer first.
   * Anything still reading #050507 after that can only be coming from the
   * WebGL framebuffer.
   * ------------------------------------------------------------------ */
  await page.addStyleTag({
    content: `
      html, body { background: #ff00ff !important; }
      .document { visibility: hidden !important; }
    `,
  });
  await page.waitForTimeout(300);
  const proof = decode(await page.screenshot({ animations: 'allow' }));

  const expected = fromHex(VOID_HEX);
  const sampled = proof.mean(24, 24, 8, 8);
  const delta = maxChannelDelta(sampled, expected);

  const dpr = geometry.backingWidth / Math.max(1, geometry.cssWidth);
  console.log(
    [
      `[capture] ${file}`,
      `[capture] webgl2=${String(geometry.webgl2)} dpr=${dpr.toFixed(2)} ` +
        `backing=${String(geometry.backingWidth)}x${String(geometry.backingHeight)} ` +
        `png=${String(proof.width)}x${String(proof.height)}`,
      `[capture] clear=${formatRgb(sampled)} expected=${formatRgb(expected)} delta=${String(delta)}`,
    ].join('\n'),
  );

  expect(shot.byteLength, 'screenshot is non-empty').toBeGreaterThan(1000);
  expect(geometry.webgl2, 'WebGL2 context').toBe(true);
  expect(dpr, 'canvas backing store is at DPR 2').toBeGreaterThanOrEqual(1.99);
  // ±1 level covers the 8-bit round trip through the compositor.
  expect(delta, 'canvas clear colour vs --void').toBeLessThanOrEqual(1);
});
