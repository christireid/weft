import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/*
 * Frame-time sampler.
 *
 * The problem this harness solves: in CI and in the container this project was
 * built in there is no GPU, so every frame is rasterised by SwiftShader.
 * An absolute "60 fps at DPR 2" assertion is unmeasurable there — not because
 * the site is slow, but because filling a 2880x1800 framebuffer in software
 * costs ~28 ms whatever is drawn into it.
 *
 * So three series are sampled every run:
 *
 *   idle      a page with no canvas       — the compositor's rAF ceiling
 *   baseline  a bare gl.clear() loop at   — the cost of the framebuffer alone
 *             the same size and DPR
 *   render    the site, DOM layer hidden  — the cost of the framebuffer + the
 *                                           renderer
 *   weft      the site as shipped         — the above + compositing the text
 *                                           layer over it
 *
 * `render - baseline` is the renderer's true per-frame cost and is the figure
 * this test gates on. `weft - render` isolates layer compositing, which on a
 * software rasteriser is CPU blending of a full-viewport text layer and is
 * therefore large here and near-free on a GPU — worth measuring separately so
 * it is never mistaken for renderer cost.
 *
 * The absolute p50/p95 are recorded in docs/verification/perf.json with the
 * renderer string attached, and are never presented as the tier-1 numbers —
 * those come from a real GPU in L5 (§0.4: no fabricated numbers).
 */

const OUT = join(process.cwd(), 'docs', 'verification');
const FRAMES = Number(process.env.WEFT_PERF_FRAMES ?? '600');

/**
 * How much per-frame cost the renderer is allowed to add on top of a bare
 * clear of the same framebuffer, with the DOM layer out of the picture. At L0
 * the scene is empty, so this is the cost of three's render path and r3f's
 * loop and nothing else; 2 ms is slack for scheduler noise. This ceiling is
 * raised deliberately, per loop, as real work lands in the scene.
 */
const OVERHEAD_CEILING_MS = Number(process.env.WEFT_PERF_OVERHEAD_MS ?? '2');

interface Series {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  frames: number;
}

function stats(deltas: number[]): Series {
  const s = [...deltas].sort((a, b) => a - b);
  const at = (p: number) =>
    s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? NaN;
  return {
    p50: Number(at(50).toFixed(2)),
    p95: Number(at(95).toFixed(2)),
    p99: Number(at(99).toFixed(2)),
    mean: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)),
    frames: s.length,
  };
}

async function sampleFrames(page: Page, frames: number): Promise<number[]> {
  return page.evaluate(async (n: number) => {
    const deltas: number[] = [];
    await new Promise<void>((resolve) => {
      let last = performance.now();
      let i = 0;
      const tick = () => {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        i += 1;
        if (i >= n) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // Drop the first delta: it is measured from before the loop started.
    return deltas.slice(1);
  }, frames);
}

test('frame-time sampler, against an idle and a bare-framebuffer control', async ({ page }) => {
  await mkdir(OUT, { recursive: true });

  /* ---- control 1: no canvas. Establishes the rAF ceiling. -------------- */
  await page.setContent('<!doctype html><html><body style="background:#050507"></body></html>');
  await page.waitForTimeout(800);
  const idle = stats(await sampleFrames(page, Math.min(FRAMES, 400)));

  /* ---- control 2: bare gl.clear() at the same size and DPR. ------------ */
  await page.setContent(`<!doctype html><html><body style="margin:0">
    <canvas id="c" style="width:100vw;height:100vh;display:block"></canvas>
    <script>
      const c = document.getElementById('c');
      c.width = c.clientWidth * window.devicePixelRatio;
      c.height = c.clientHeight * window.devicePixelRatio;
      const gl = c.getContext('webgl2', { antialias: false, alpha: false });
      gl.clearColor(5/255, 5/255, 7/255, 1);
      (function loop() {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        requestAnimationFrame(loop);
      })();
    </script></body></html>`);
  await page.waitForTimeout(1200);
  const baseline = stats(await sampleFrames(page, Math.min(FRAMES, 400)));

  /* ---- the site ------------------------------------------------------- */
  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('canvas')).toBeVisible();
  // Discard warm-up: shader compiles and first texture uploads land in the
  // first ~30 frames and would otherwise dominate the p95.
  await page.waitForTimeout(1500);
  const weft = stats(await sampleFrames(page, FRAMES));

  /* ---- the site with the DOM text layer taken out of the composite ----- */
  await page.addStyleTag({ content: '.document { display: none !important; }' });
  await page.waitForTimeout(600);
  const render = stats(await sampleFrames(page, FRAMES));

  const env = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: dbg && gl ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      vendor: dbg && gl ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : 'unknown',
      webgl2: !!gl,
      backingWidth: canvas?.width ?? 0,
      backingHeight: canvas?.height ?? 0,
      cssWidth: canvas?.clientWidth ?? 0,
      devicePixelRatio: window.devicePixelRatio,
    };
  });

  const dprEffective = env.backingWidth / Math.max(1, env.cssWidth);
  const rendererCostP50 = Number((render.p50 - baseline.p50).toFixed(2));
  const compositeCostP50 = Number((weft.p50 - render.p50).toFixed(2));
  const software = /swiftshader|llvmpipe|software|subzero/i.test(env.renderer);

  const artifact = {
    capturedAt: new Date().toISOString(),
    software,
    renderer: env.renderer,
    vendor: env.vendor,
    webgl2: env.webgl2,
    devicePixelRatio: env.devicePixelRatio,
    dprEffective: Number(dprEffective.toFixed(3)),
    backingStore: `${String(env.backingWidth)}x${String(env.backingHeight)}`,
    series: { idle, baseline, render, weft },
    rendererCostP50Ms: rendererCostP50,
    domCompositeCostP50Ms: compositeCostP50,
    note: software
      ? 'Software rasteriser. Absolute frame times are dominated by the cost of filling a ' +
        `${String(env.backingWidth)}x${String(env.backingHeight)} framebuffer in software and are NOT the tier-1 ` +
        'figure. rendererCostP50Ms is meaningful; domCompositeCostP50Ms is CPU layer ' +
        'blending and is near-free on a GPU. Tier numbers must be measured on real ' +
        'hardware (L5).'
      : 'Hardware rasteriser. Absolute frame times are meaningful.',
  };

  await writeFile(join(OUT, 'perf.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact, null, 2));

  expect(env.webgl2, 'WebGL2 context').toBe(true);
  expect(dprEffective, 'canvas backing store is at DPR 2').toBeGreaterThanOrEqual(1.99);

  // The compositor must be capable of 60 Hz, or nothing measured here means
  // anything.
  expect(idle.p50, 'idle rAF cadence (compositor ceiling)').toBeLessThan(17.5);

  // The real assertion: the renderer costs no more per frame than the
  // framebuffer it draws into.
  expect(rendererCostP50, 'per-frame cost added by the renderer over a bare clear').toBeLessThan(
    OVERHEAD_CEILING_MS,
  );

  if (!software) {
    // On real hardware the absolute contract from §5.6 tier 1 applies.
    expect(weft.p95, 'tier-1 p95 frame time at DPR 2').toBeLessThan(16.6);
  }
});
