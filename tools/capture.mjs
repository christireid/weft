/**
 * `pnpm capture --at <0..1> [--label name]`
 *
 * Step 4 of the inner loop (§0.2): take a still at a scroll offset, write it to
 * docs/verification/captures/, and print the path so it can be opened and
 * looked at. Text-only reasoning about visual output is not permitted, so this
 * script's only job is to make looking cheap.
 *
 * Playwright's CLI rejects unknown flags, so the offset is parsed here and
 * handed to the spec through the environment.
 */
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return fallback;
  return v;
}

const at = flag('at', '0');
const label = flag('label', '');

const parsed = Number(at);
if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
  console.error(`capture: --at must be a number in [0,1], got "${at}"`);
  process.exit(2);
}

const result = spawnSync(
  'playwright',
  ['test', 'tools/capture.spec.ts', ...(argv.includes('--headed') ? ['--headed'] : [])],
  {
    stdio: 'inherit',
    env: { ...process.env, WEFT_CAPTURE_AT: String(parsed), WEFT_CAPTURE_LABEL: label },
    shell: process.platform === 'win32',
  },
);

process.exit(result.status ?? 1);
