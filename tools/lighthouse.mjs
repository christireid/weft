/**
 * `pnpm lh` — Lighthouse accessibility audit against the production preview.
 *
 * The L0 exit gate is "Lighthouse a11y >= 95". axe-core (tools/a11y.spec.ts)
 * and Lighthouse overlap but are not the same audit: Lighthouse also checks
 * document structure, viewport meta, and tap-target sizing, and it is the
 * number the spec names. Both are run, and both artifacts are committed.
 *
 * Assumes `pnpm preview` is already serving on :4173. Categories other than
 * accessibility are collected too, but only accessibility gates the run —
 * performance under SwiftShader in a container is not a meaningful figure and
 * is never reported as one (§0.4).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const URL_UNDER_TEST = process.env.WEFT_URL ?? 'http://127.0.0.1:4173/';
const THRESHOLD = Number(process.env.WEFT_A11Y_MIN ?? '95');
const OUT = join(process.cwd(), 'docs', 'verification');

function resolveChromium() {
  if (process.env.WEFT_CHROMIUM && existsSync(process.env.WEFT_CHROMIUM)) {
    return process.env.WEFT_CHROMIUM;
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || root === '0' || !existsSync(root)) return undefined;
  return readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map((d) => join(root, d, 'chrome-linux', 'chrome'))
    .find((p) => existsSync(p));
}

const chromePath = resolveChromium();
const chrome = await launch({
  ...(chromePath ? { chromePath } : {}),
  chromeFlags: [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});

try {
  const runnerResult = await lighthouse(
    URL_UNDER_TEST,
    { port: chrome.port, output: 'json', logLevel: 'error' },
    {
      extends: 'lighthouse:default',
      settings: {
        onlyCategories: ['accessibility', 'seo', 'best-practices'],
        formFactor: 'desktop',
        screenEmulation: { mobile: false, width: 1440, height: 900, deviceScaleFactor: 2 },
        throttlingMethod: 'provided',
      },
    },
  );

  const lhr = runnerResult.lhr;
  const scores = Object.fromEntries(
    Object.entries(lhr.categories).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)]),
  );

  const failed = Object.values(lhr.audits)
    .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative')
    .map((a) => ({ id: a.id, title: a.title, score: a.score }));

  await mkdir(OUT, { recursive: true });
  await writeFile(
    join(OUT, 'lighthouse.json'),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        url: lhr.finalDisplayedUrl,
        lighthouseVersion: lhr.lighthouseVersion,
        userAgent: lhr.environment.hostUserAgent,
        scores,
        failedAudits: failed,
        accessibilityAuditsPassed: Object.values(lhr.audits).filter(
          (a) => a.score === 1 && lhr.categories.accessibility.auditRefs.some((r) => r.id === a.id),
        ).length,
      },
      null,
      2,
    )}\n`,
  );

  console.log(JSON.stringify(scores, null, 2));
  if (failed.length) {
    console.log('failed audits:');
    for (const f of failed) console.log(`  - ${f.id}: ${f.title}`);
  }

  if (scores.accessibility < THRESHOLD) {
    console.error(`\nFAIL: accessibility ${scores.accessibility} < ${THRESHOLD}`);
    process.exitCode = 1;
  } else {
    console.log(`\nPASS: accessibility ${scores.accessibility} >= ${THRESHOLD}`);
  }
} finally {
  await chrome.kill();
}
