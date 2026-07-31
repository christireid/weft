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
/*
 * Extra seconds to let a simulation develop before the shutter.
 *
 * Needed because of D-019: this container rasterises in software at roughly
 * 220 ms a frame, and the plates clamp their timestep so a long frame cannot
 * teleport the simulation. Plate III advances at most 1/30 s per frame, so a
 * default capture sees about a fifth of a second of physics and reports a cloud
 * that has not frayed yet — which says nothing about the plate and everything
 * about the machine.
 */
const settle = flag('settle', '0');
const label = flag('label', '');
/** `--debug` presses D on the page first, so the L1 HUD is in the still. */
const debug = argv.includes('--debug') ? '1' : '';

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
    env: {
      ...process.env,
      WEFT_CAPTURE_AT: String(parsed),
      WEFT_CAPTURE_LABEL: label,
      WEFT_CAPTURE_DEBUG: debug,
      WEFT_CAPTURE_SETTLE: String(Number(settle) || 0),
    },
    shell: process.platform === 'win32',
  },
);

process.exit(result.status ?? 1);
