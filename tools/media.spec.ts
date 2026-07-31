import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';

/*
 * Media capture pipeline (§7 L6 task 1).
 *
 * "A Playwright script that drives a deterministic scroll pass at a fixed frame
 *  rate with the seed pinned, recording video, and capturing stills at each
 *  plate's peak moment."
 *
 * A PNG *sequence* rather than a recorded video, deliberately. Playwright's
 * video recorder captures at wall-clock rate, and under a software rasteriser
 * that is whatever the machine managed — so the same run produces a different
 * number of frames each time and the GIF's speed depends on the build agent's
 * load. Driving scroll to an explicit offset per frame and screenshotting makes
 * the output a pure function of the frame index. Two runs are byte-comparable.
 *
 * tools/make-gifs.mjs turns the sequences into GIFs with the two-pass palette.
 */

const MEDIA = join(process.cwd(), 'docs', 'media');
const FRAMES = join(MEDIA, 'frames');

// Software rasterisation makes each frame expensive; see D-019.
test.setTimeout(600_000);

/** Settle time after a scroll change, in ms. Lenis smooths toward the target. */
const SETTLE = 90;

async function captureSequence(
  page: Page,
  name: string,
  frames: number,
  offsetAt: (i: number) => number,
  perFrame?: (page: Page, i: number) => Promise<void>,
): Promise<void> {
  const dir = join(FRAMES, name);
  await mkdir(dir, { recursive: true });

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );

  for (let i = 0; i < frames; i++) {
    await page.evaluate(
      (y) => {
        window.scrollTo(0, y);
      },
      offsetAt(i) * scrollable,
    );
    if (perFrame) await perFrame(page, i);
    await page.waitForTimeout(SETTLE);
    await page.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.png`) });
  }
  console.log(`[media] ${name}: ${String(frames)} frames`);
}

test.beforeAll(async () => {
  await rm(FRAMES, { recursive: true, force: true });
  await mkdir(MEDIA, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1800);
});

/*
 * Hero: the Plate I → II transformation (§7 L6 README block 1).
 *
 * Runs from the middle of Plate I, through its exit transformation and the
 * blend band where both plates are live, into Plate II's fan. This is the
 * boundary §1.2 says must read as a transformation rather than a cut, so it is
 * the honest thing to lead the README with.
 */
test('hero: Plate I → II', async ({ page }) => {
  await captureSequence(page, 'hero', 44, (i) => 0.06 + (i / 43) * 0.2);
});

test('plate I: the thread under load', async ({ page }) => {
  // A grab and release, so the GIF shows the thread responding rather than
  // merely existing. The pointer path is fixed, so the run is deterministic.
  await captureSequence(
    page,
    'plate-01',
    34,
    () => 0.03,
    async (p, i) => {
      if (i === 4) {
        await p.mouse.move(520, 470);
        await p.mouse.down();
      }
      if (i > 4 && i < 16) await p.mouse.move(520 + (i - 4) * 26, 470 - (i - 4) * 17);
      if (i === 16) await p.mouse.up();
    },
  );
});

test('plate II: the prism', async ({ page }) => {
  // Rotating the wedge sweeps the spectrum, which is the plate's interaction.
  await captureSequence(
    page,
    'plate-02',
    34,
    () => 0.245,
    async (p, i) => {
      if (i === 3) {
        await p.mouse.move(700, 450);
        await p.mouse.down();
      }
      if (i > 3 && i < 28) await p.mouse.move(700 + (i - 3) * 14, 450);
      if (i === 28) await p.mouse.up();
    },
  );
});

/* ---- stills ------------------------------------------------------------ */

test('stills', async ({ page }) => {
  await mkdir(MEDIA, { recursive: true });

  const shots: [string, number][] = [
    ['still-masthead', 0.0],
    ['still-plate-01', 0.05],
    ['still-plate-02', 0.245],
  ];

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );

  for (const [name, at] of shots) {
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, at * scrollable);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(MEDIA, `${name}.png`) });
    console.log(`[media] ${name}.png at ${at.toFixed(3)}`);
  }

  // Open Graph card, 1200x630 (§7 L6 task 4).
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(MEDIA, 'og.png') });
  console.log('[media] og.png 1200x630');
});
