import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, parseHex, parseRgba } from '../src/lib/contrast';
import { VOID_HEX } from '../src/config/identity';

const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const globals = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8');

function token(name: string): string {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens);
  if (!m?.[1]) throw new Error(`token ${name} not found`);
  return m[1].trim();
}

const voidRgb = parseHex(VOID_HEX);

function overVoid(name: string) {
  const value = token(name);
  if (value.startsWith('#')) return parseHex(value);
  const { rgb, alpha } = parseRgba(value);
  return composite(rgb, alpha, voidRgb);
}

const AA_NORMAL = 4.5;

describe('contrast over the void (§6, rubric axis 6)', () => {
  it('computes the reference ratios the design was decided against', () => {
    // Recorded rather than asserted loosely, so a token edit that silently
    // moves a ratio shows up as a diff in this file.
    const table = {
      '--ink-100': 18.98,
      '--ink-60': 6.88,
      '--ink-35': 2.95,
      '--ink-12': 1.28,
    };
    for (const [name, expected] of Object.entries(table)) {
      expect(contrastRatio(overVoid(name), voidRgb), name).toBeCloseTo(expected, 1);
    }
  });

  it('sets every text role at or above AA for normal text', () => {
    for (const role of ['--ink-100', '--ink-60']) {
      expect(contrastRatio(overVoid(role), voidRgb), role).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('never assigns --ink-35 or --ink-12 as a text colour', () => {
    /*
     * The guard for the §3.1-vs-§6 resolution recorded in DECISIONS.md: the
     * two lowest inks exist for rules and wireframe marks. If either turns up
     * as a `color:` the site has quietly dropped below AA somewhere.
     */
    const colourDecls = globals.match(/(?<!-)\bcolor:\s*var\((--[a-z0-9-]+)\)/g) ?? [];
    expect(
      colourDecls.length,
      'no color declarations found — did global.css move?',
    ).toBeGreaterThan(0);
    for (const decl of colourDecls) {
      expect(decl).not.toContain('--ink-35');
      expect(decl).not.toContain('--ink-12');
    }
  });

  it('keeps the focus ring at the maximum available contrast', () => {
    // §6.1 specifies a 2px ring in --ink-100. At 18.98:1 it is visible against
    // the void and against anything the renderer can put behind it.
    expect(globals).toMatch(/outline:\s*var\(--focus-ring\)\s+solid\s+var\(--ink-100\)/);
    expect(contrastRatio(overVoid('--ink-100'), voidRgb)).toBeGreaterThan(7);
  });
});
