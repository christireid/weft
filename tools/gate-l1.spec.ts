import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/*
 * L1 EXIT GATE (§7).
 *
 * "Scroll from 0 to 1 with the debug overlay shows no dropped plate, no leaked
 *  FBO, no allocation inside useFrame (verify with a heap snapshot across 600
 *  frames: growth < 2 MB)."
 *
 * All three are measured here rather than asserted by inspection. The
 * artifacts land in docs/verification/gate-l1.json.
 */

const OUT = join(process.cwd(), 'docs', 'verification');

/*
 * The heap pass walks 600 frames of the real loop. Under SwiftShader in this
 * container a frame costs ~240 ms once the composite pass is in the chain — the
 * scene renders to a 2880x1800 half-float target and a second full-screen pass
 * reads it back — so 600 frames is around 2.5 minutes of wall clock. That is a
 * property of software rasterisation, not of the site; the default 120 s
 * timeout would fail the gate for the wrong reason.
 */
test.setTimeout(420_000);

/** §7 L1: heap growth across 600 frames. */
const HEAP_GROWTH_LIMIT_BYTES = 2 * 1024 * 1024;

test('L1 gate: no dropped plate across a full scroll pass', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  /*
   * Sampled by driving the *real* scroll and reading the router's own state,
   * not by calling the pure function — the pure function is already tested
   * exhaustively in tests/plateRouter.test.ts. What this checks is the wiring:
   * that Lenis's progress reaches the router at every point of a real pass.
   */
  const samples = await page.evaluate(async () => {
    const results: { progress: number; active: number; primary: number }[] = [];
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;

    for (let i = 0; i <= 200; i++) {
      window.scrollTo(0, (i / 200) * scrollable);
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      const w = window as unknown as {
        __weftFrame?: { progress: number; router: { activeCount: number; primary: number } };
      };
      const f = w.__weftFrame;
      if (f) {
        results.push({
          progress: f.progress,
          active: f.router.activeCount,
          primary: f.router.primary,
        });
      }
    }
    return results;
  });

  expect(samples.length, 'frame state was not exposed for the gate').toBeGreaterThan(150);

  const dropped = samples.filter((s) => s.active < 1);
  const overloaded = samples.filter((s) => s.active > 2);
  const platesSeen = new Set(samples.map((s) => s.primary));

  console.log(
    `[gate-l1] ${String(samples.length)} samples · dropped ${String(dropped.length)} · ` +
      `>2 live ${String(overloaded.length)} · plates visited ${String(platesSeen.size)}/6 · ` +
      `progress ${samples[0]?.progress.toFixed(3) ?? '?'} → ${samples[samples.length - 1]?.progress.toFixed(3) ?? '?'}`,
  );

  expect(dropped, 'a frame had no live plate').toHaveLength(0);
  expect(overloaded, 'more than two plates simulated at once').toHaveLength(0);
  expect(platesSeen.size, 'not every plate became primary during the pass').toBe(6);
  expect(samples[samples.length - 1]?.progress ?? 0).toBeGreaterThan(0.98);
});

test('L1 gate: no leaked WebGL objects across a full scroll pass', async ({ page }) => {
  /*
   * Counts creations and deletions by wrapping the context's own factory
   * methods before the app loads. Counting live objects is the only way to see
   * a ping-pong target being reallocated per frame — a leak that a frame-time
   * measurement would show as a slow drift and nothing else.
   */
  await page.addInitScript(() => {
    const counters: Record<string, number> = {};
    const w = window as unknown as { __weftGL: Record<string, number> };
    w.__weftGL = counters;

    /* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
      const ctx = original.apply(this, args as never);
      if (!ctx || !(ctx instanceof WebGL2RenderingContext)) return ctx;
      for (const kind of ['Texture', 'Framebuffer', 'Renderbuffer', 'Buffer', 'Program']) {
        counters[`create${kind}`] ??= 0;
        counters[`delete${kind}`] ??= 0;
        const proto = ctx as unknown as Record<string, (...a: unknown[]) => unknown>;
        for (const verb of ['create', 'delete']) {
          const name = `${verb}${kind}`;
          const fn = proto[name];
          if (typeof fn !== 'function') continue;
          proto[name] = function (...a: unknown[]) {
            counters[name] = (counters[name] ?? 0) + 1;
            return fn.apply(ctx, a);
          };
        }
      }
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;
    /* eslint-enable @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
  });

  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const before = await page.evaluate(() => ({
    ...(window as unknown as { __weftGL: Record<string, number> }).__weftGL,
  }));

  await page.evaluate(async () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    for (let i = 0; i <= 120; i++) {
      window.scrollTo(0, (i / 120) * scrollable);
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => ({
    ...(window as unknown as { __weftGL: Record<string, number> }).__weftGL,
  }));

  const delta: Record<string, number> = {};
  for (const key of Object.keys(after)) delta[key] = (after[key] ?? 0) - (before[key] ?? 0);
  console.log(`[gate-l1] GL objects created during a full scroll pass: ${JSON.stringify(delta)}`);

  // Nothing may be created during steady-state scrolling. Every target, buffer
  // and program is allocated at boot (ADR-0001, ADR-0002).
  expect(delta.createTexture ?? 0, 'textures created mid-scroll').toBe(0);
  expect(delta.createFramebuffer ?? 0, 'framebuffers created mid-scroll').toBe(0);
  expect(delta.createRenderbuffer ?? 0, 'renderbuffers created mid-scroll').toBe(0);
  expect(delta.createProgram ?? 0, 'programs compiled mid-scroll').toBe(0);

  // And the boot allocation must be bounded — a runaway here is a leak that
  // simply has not run long enough yet.
  const liveTextures = (after.createTexture ?? 0) - (after.deleteTexture ?? 0);
  const liveFramebuffers = (after.createFramebuffer ?? 0) - (after.deleteFramebuffer ?? 0);
  console.log(
    `[gate-l1] live at end: ${String(liveTextures)} textures, ${String(liveFramebuffers)} framebuffers`,
  );
  expect(liveTextures).toBeLessThan(24);
  expect(liveFramebuffers).toBeLessThan(24);
});

test('L1 gate: heap growth under 2 MB across 600 frames', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  // Let boot allocation and the first GC settle before the baseline.
  await page.waitForTimeout(2500);

  const result = await page.evaluate(async () => {
    interface PerfMemory {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
    }
    const perf = performance as unknown as { memory?: PerfMemory };
    if (!perf.memory) return { supported: false, before: 0, after: 0, frames: 0 };

    const settle = async (n: number) => {
      for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    };

    await settle(60);
    const before = perf.memory.usedJSHeapSize;

    // 600 frames of the steady-state loop, scrolling so the router and the
    // touch field are both doing real work rather than idling.
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    for (let i = 0; i < 600; i++) {
      window.scrollTo(0, (Math.sin(i / 95) * 0.5 + 0.5) * scrollable);
      await new Promise((r) => requestAnimationFrame(r));
    }

    const after = perf.memory.usedJSHeapSize;
    return { supported: true, before, after, frames: 600 };
  });

  if (!result.supported) {
    console.log('[gate-l1] performance.memory unavailable — heap gate skipped');
    test.skip();
    return;
  }

  const growth = result.after - result.before;
  const perFrame = growth / result.frames;
  console.log(
    `[gate-l1] heap ${(result.before / 1048576).toFixed(2)} MB → ${(result.after / 1048576).toFixed(2)} MB ` +
      `over ${String(result.frames)} frames · growth ${(growth / 1024).toFixed(1)} KB ` +
      `(${perFrame.toFixed(1)} B/frame)`,
  );

  await writeFile(
    join(OUT, 'gate-l1.json'),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        heap: {
          beforeBytes: result.before,
          afterBytes: result.after,
          growthBytes: growth,
          bytesPerFrame: Number(perFrame.toFixed(2)),
          frames: result.frames,
          limitBytes: HEAP_GROWTH_LIMIT_BYTES,
        },
      },
      null,
      2,
    )}\n`,
  );

  expect(growth, 'heap growth across 600 frames').toBeLessThan(HEAP_GROWTH_LIMIT_BYTES);
});
