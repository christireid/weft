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

interface SequenceOptions {
  /**
   * Milliseconds to hold on each frame before the shutter, overriding SETTLE.
   *
   * A plate with a simulation in it needs more than the scroll takes to settle,
   * because this container advances one simulation frame per ~220 ms of wall
   * clock and the plates clamp their timestep (D-019). At the default 90 ms a
   * sequence captures the same simulation state 34 times and the GIF is a still.
   */
  settleMs?: number;
  /** Milliseconds to hold at the first offset before capturing anything. */
  warmupMs?: number;
}

async function captureSequence(
  page: Page,
  name: string,
  frames: number,
  offsetAt: (i: number) => number,
  perFrame?: (page: Page, i: number) => Promise<void>,
  options: SequenceOptions = {},
): Promise<void> {
  /*
   * Clear this sequence's directory, not the whole tree.
   *
   * A `rm -rf` of FRAMES in `beforeAll` looked tidier and cost a full run: when
   * one sequence fails, Playwright retries it in a fresh worker, `beforeAll`
   * runs again, and twenty minutes of already-captured frames from the *other*
   * sequences are deleted. Scoping the clear to the sequence about to be
   * written makes a retry cost only the sequence that failed.
   */
  const dir = join(FRAMES, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );

  if (options.warmupMs) {
    await page.evaluate(
      (y) => {
        window.scrollTo(0, y);
      },
      offsetAt(0) * scrollable,
    );
    await page.waitForTimeout(options.warmupMs);
  }

  for (let i = 0; i < frames; i++) {
    await page.evaluate(
      (y) => {
        window.scrollTo(0, y);
      },
      offsetAt(i) * scrollable,
    );
    if (perFrame) await perFrame(page, i);
    await page.waitForTimeout(options.settleMs ?? SETTLE);
    await page.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.png`) });
  }
  console.log(`[media] ${name}: ${String(frames)} frames`);
}

test.beforeAll(async () => {
  await mkdir(FRAMES, { recursive: true });
  await mkdir(MEDIA, { recursive: true });
});

/*
 * Tier 1 (D-021). This container has no GPU and the boot probe settles it at
 * tier 3, where §5.6 disables bloom — so an unpinned capture documents a
 * degraded rendering path as if it were the piece. The whole point of these
 * files is to show what a visitor on real hardware sees.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/?tier=1', { waitUntil: 'load' });
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
  /*
   * The pointer pulls the filament for the first third and lets go, so the
   * thread is ringing as the transformation begins. Without it the hero opened
   * on a thread at its idle amplitude — a hairline that barely clears the void —
   * and the first two seconds of the README showed a still page that happened
   * to be scrolling.
   */
  await captureSequence(
    page,
    'hero',
    44,
    (i) => 0.06 + (i / 43) * 0.2,
    async (p, i) => {
      if (i === 2) {
        await p.mouse.move(430, 470);
        await p.mouse.down();
      }
      if (i > 2 && i < 14) await p.mouse.move(430 + (i - 2) * 32, 470 - (i - 2) * 20);
      if (i === 14) await p.mouse.up();
    },
  );
});

test('plate I: the thread under load', async ({ page }) => {
  // A grab and release, so the GIF shows the thread responding rather than
  // merely existing. The pointer path is fixed, so the run is deterministic.
  /*
   * Pull hard, hold a beat, release, and keep the shutter open while it rings.
   * The release is the interesting half: the wave equation is what makes this a
   * simulation rather than an eased curve, and it is only legible while the
   * disturbance is travelling back along the span. The first cut of this let go
   * on the second-to-last frame and the GIF was all pull and no physics.
   */
  await captureSequence(
    page,
    'plate-01',
    34,
    () => 0.03,
    async (p, i) => {
      if (i === 3) {
        await p.mouse.move(430, 470);
        await p.mouse.down();
      }
      if (i > 3 && i < 14) await p.mouse.move(430 + (i - 3) * 34, 470 - (i - 3) * 24);
      if (i === 15) await p.mouse.up();
    },
  );
});

test('plate II: the prism', async ({ page }) => {
  // Rotating the wedge sweeps the spectrum, which is the plate's interaction.
  /*
   * Sweep the wedge across and back. One direction alone reads as a slider being
   * dragged; the return makes it clear the fan is a function of the geometry
   * rather than of the gesture.
   */
  await captureSequence(
    page,
    'plate-02',
    34,
    () => 0.245,
    async (p, i) => {
      if (i === 2) {
        await p.mouse.move(640, 450);
        await p.mouse.down();
      }
      if (i > 2 && i <= 18) await p.mouse.move(640 + (i - 2) * 22, 450);
      if (i > 18 && i < 32) await p.mouse.move(640 + (34 - i) * 22, 450);
      if (i === 32) await p.mouse.up();
    },
  );
});

test('plate III: the fray', async ({ page }) => {
  /*
   * Held at one offset while the simulation develops, with the pointer pushing
   * through the cloud in the middle third.
   *
   * The offset barely moves: this plate's interest is entirely in time rather
   * than in scroll, and scrolling through it would spend the GIF's frames on a
   * blend band instead of on the fray. The warmup is what makes it a fray at
   * all — 24 seconds of wall clock is about four seconds of simulation here, by
   * which point the filament has come apart and the strands are legible.
   */
  await captureSequence(
    page,
    'plate-03',
    34,
    (i) => 0.4 + (i / 33) * 0.012,
    async (p, i) => {
      if (i === 8) {
        await p.mouse.move(560, 420);
        await p.mouse.down();
      }
      if (i > 8 && i < 24) await p.mouse.move(560 + (i - 8) * 26, 420 + (i - 8) * 9);
      if (i === 24) await p.mouse.up();
    },
    { settleMs: 2200, warmupMs: 24_000 },
  );
});

/* ---- stills ------------------------------------------------------------ */

test('stills', async ({ page }) => {
  await mkdir(MEDIA, { recursive: true });

  /*
   * Each still is taken at a *loaded* moment, not a resting one.
   *
   * The first pass of these captured Plate I at rest, where the filament is a
   * hairline at the idle amplitude and the frame is 96% void. That is an honest
   * photograph of an uninteresting instant. The plate is about a thread under
   * load, so the still holds it under load — the pointer is placed and dragged
   * before the shutter, and the wave is still travelling when it fires.
   */
  const shots: [string, number, ((p: Page) => Promise<void>) | null][] = [
    ['still-masthead', 0.0, null],
    [
      'still-plate-01',
      0.05,
      async (p) => {
        await p.mouse.move(430, 470);
        await p.mouse.down();
        // Far enough to pull the filament well clear of its sag, and held, so
        // the shutter catches the standing shape rather than the release.
        for (let i = 1; i <= 10; i++) await p.mouse.move(430 + i * 34, 470 - i * 22);
        await p.waitForTimeout(120);
      },
    ],
    [
      'still-plate-02',
      0.245,
      async (p) => {
        // Rotate the wedge off-axis so the fan is at its widest rather than
        // folded back along the incident beam.
        await p.mouse.move(700, 450);
        await p.mouse.down();
        for (let i = 1; i <= 12; i++) await p.mouse.move(700 + i * 22, 450);
        await p.waitForTimeout(120);
      },
    ],
    [
      'still-plate-03',
      0.4,
      async (p) => {
        // No pointer: the cloud is the subject. The wait is simulation time —
        // see the note on the plate III sequence above.
        await p.waitForTimeout(45_000);
      },
    ],
    [
      'still-plate-03-lattice',
      0.498,
      async (p) => {
        // §2's exit transformation, fully engaged: rows and columns.
        await p.waitForTimeout(45_000);
      },
    ],
  ];

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );

  for (const [name, at, load] of shots) {
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, at * scrollable);
    await page.waitForTimeout(700);
    if (load) await load(page);
    await page.screenshot({ path: join(MEDIA, `${name}.png`) });
    await page.mouse.up();
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

/* ---- the second pass -------------------------------------------------- *
 *
 * Everything above is the README's spine: one sequence and one still per
 * plate. What follows is the rest of what works and was not being shown —
 * the plate boundary, the states (debug, Specimen Mode, reduced motion), the
 * tier ladder §5.6 actually produces, and the exit transformation of Plate III
 * as a sequence rather than as a single frame.
 *
 * Split into its own tests rather than folded into `stills` so a failure in
 * one costs one re-run, and so the spine can be recaptured on its own.
 * ---------------------------------------------------------------------- */

test('plate III: the lattice forms', async ({ page }) => {
  /*
   * §2's exit transformation as a sequence. The lattice is a function of scroll
   * rather than of time, so this one *does* move through the document — from
   * just before the attractor engages to the end of the plate.
   *
   * The warmup is what makes it a transformation rather than a tidy-up: the
   * cloud has to be fully frayed before the lattice takes it, or the GIF shows
   * a thread becoming a grid and skips the part in between.
   */
  await captureSequence(
    page,
    'plate-03-lattice',
    30,
    (i) => 0.468 + (i / 29) * 0.031,
    undefined,
    { settleMs: 1800, warmupMs: 26_000 },
  );
});

test('stills: boundaries, states and tiers', async ({ page }) => {
  await mkdir(MEDIA, { recursive: true });

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  const goto = async (at: number, settleMs = 800) => {
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, at * scrollable);
    await page.waitForTimeout(settleMs);
  };

  // The plate boundary §1.2 says must read as a transformation, not a cut.
  await goto(0.16, 1200);
  await page.screenshot({ path: join(MEDIA, 'still-boundary.png') });
  console.log('[media] still-boundary.png at 0.160');

  // Plate II with the wedge swept far off axis, so the fan crosses the frame
  // at a different angle from the one the spine still shows.
  await goto(0.245, 900);
  await page.mouse.move(560, 450);
  await page.mouse.down();
  for (let i = 1; i <= 22; i++) await page.mouse.move(560 + i * 20, 450);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(MEDIA, 'still-plate-02-swept.png') });
  await page.mouse.up();
  console.log('[media] still-plate-02-swept.png at 0.245');

  // Plate III early: the filament still coherent, coming apart at its ends.
  await goto(0.36, 9000);
  await page.screenshot({ path: join(MEDIA, 'still-plate-03-early.png') });
  console.log('[media] still-plate-03-early.png at 0.360');

  // Plate III with the pointer driven through the cloud — the repulsor's wake.
  await goto(0.4, 30_000);
  await page.mouse.move(520, 420);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(520 + i * 28, 420 + i * 8);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(MEDIA, 'still-plate-03-wake.png') });
  await page.mouse.up();
  console.log('[media] still-plate-03-wake.png at 0.400');

  // The L1 debug HUD. Not shipped to visitors — §5.1 tree-shakes the dev UI —
  // but it is the instrument every number in the README was read from.
  await goto(0.245, 900);
  await page.keyboard.press('d');
  // Long enough to be sure the HUD has painted. It writes on every sixth frame
  // (PAINT_EVERY, so that a debug overlay cannot itself be what shows up in the
  // L1 heap-growth gate), and a frame here costs far more than on real
  // hardware — at 700 ms the first capture caught the static shell with every
  // value still at its placeholder, which reads as a HUD that does not work.
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(MEDIA, 'still-debug.png') });
  await page.keyboard.press('d');
  console.log('[media] still-debug.png at 0.245');
});

test('stills: the tier ladder', async ({ page }) => {
  /*
   * §5.6's four tiers, on one machine, from the same scroll offset.
   *
   * This is the only way to show the ladder without four devices, and it is why
   * `?tier=` exists at all (D-021). Tier 1 is the full post chain; tier 3 drops
   * bloom and keeps the dither, which §10 forbids removing because it is what
   * stops the void banding on exactly the cheap panels that land there.
   */
  for (const tier of [1, 2, 3] as const) {
    await page.goto(`/?tier=${String(tier)}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1600);
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, 0.245 * scrollable);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: join(MEDIA, `still-tier-${String(tier)}.png`) });
    console.log(`[media] still-tier-${String(tier)}.png`);
  }
});

test('stills: reduced motion and Specimen Mode', async ({ page }) => {
  /*
   * The two states §6.2 and §7 require, photographed rather than asserted.
   *
   * Both are held poses by construction — reduced motion states the wave rather
   * than integrating it (RT-02), and Specimen Mode stops stepping once settled —
   * so a still is the honest representation of each.
   */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?tier=1', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(MEDIA, 'still-reduced-motion.png') });
  console.log('[media] still-reduced-motion.png');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?tier=1', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1600);
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  await page.evaluate((y) => {
    window.scrollTo(0, y);
  }, 0.05 * scrollable);
  await page.waitForTimeout(1200);
  await page.keyboard.press('s');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(MEDIA, 'still-specimen.png') });
  console.log('[media] still-specimen.png');
});
