import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/*
 * Resolve a Chromium binary.
 *
 * Normally Playwright manages its own download and this returns undefined. In
 * sandboxes where the browser CDN is unreachable but a build is already on
 * disk, point at that build instead of failing: set WEFT_CHROMIUM, or let the
 * newest chromium-<rev> under PLAYWRIGHT_BROWSERS_PATH be found automatically.
 * A mismatched revision is fine for capture and audit work — none of it
 * depends on protocol features newer than the installed build.
 */
function resolveChromium(): string | undefined {
  const explicit = process.env.WEFT_CHROMIUM;
  if (explicit && existsSync(explicit)) return explicit;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || root === '0' || !existsSync(root)) return undefined;

  const candidates = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map((d) => join(root, d, 'chrome-linux', 'chrome'))
    .filter((p) => existsSync(p));

  return candidates[0];
}

const executablePath = resolveChromium();

/*
 * Every harness under tools/ runs against the production build, not the dev
 * server. A capture taken through Vite's dev transform is not the artifact
 * anyone will visit, and the perf numbers in the README have to come from the
 * bundle that ships (§0.4: no fabricated numbers).
 */
const PORT = 4173;

export default defineConfig({
  testDir: '.',
  testMatch: /tools\/.*\.spec\.ts/,
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    // Deterministic viewport and DPR: the capture pipeline in L6 depends on
    // frames being byte-comparable between runs.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    contextOptions: { reducedMotion: 'no-preference' },
    trace: 'off',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: [
            // Headless Chromium has no GPU here. SwiftShader gives a real
            // WebGL2 context with real float textures, which is what the
            // GPGPU path needs to be exercised at all. Frame times measured
            // under it are reported as software-rendered and are never
            // presented as the tier-1 numbers.
            '--enable-unsafe-swiftshader',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--disable-lcd-text',
            '--force-color-profile=srgb',
            '--hide-scrollbars',
            // performance.memory reports rounded, cached values without this;
            // the L1 heap gate needs real numbers.
            '--enable-precise-memory-info',
          ],
        },
      },
    },
  ],

  webServer: {
    command: 'pnpm build && pnpm preview',
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
