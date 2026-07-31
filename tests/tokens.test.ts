import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VOID_HEX, identity } from '../src/config/identity';

const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const globals = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8');

/** Strip comments so prose about colour is not mistaken for a colour token. */
const code = tokens.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the palette is white light (§3.1)', () => {
  it('declares exactly the five neutrals, with the specified values', () => {
    const expected: Record<string, string> = {
      '--void': '#050507',
      '--ink-100': '#f7f7f5',
      '--ink-60': 'rgba(247, 247, 245, 0.6)',
      '--ink-35': 'rgba(247, 247, 245, 0.35)',
      '--ink-12': 'rgba(247, 247, 245, 0.12)',
    };
    for (const [name, value] of Object.entries(expected)) {
      const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(code);
      expect(m?.[1]?.trim(), name).toBe(value);
    }
  });

  it('contains no chromatic value anywhere in the token layer', () => {
    /*
     * §10 forbids a second accent colour, and §3.1 forbids the first one. This
     * is the guard: every colour literal in the token layer must be
     * achromatic. All colour in WEFT comes out of the dispersion shader, so a
     * hue appearing in CSS means someone reached for a gradient instead of
     * doing the physics.
     */
    const hexes = code.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    const rgbas = code.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g) ?? [];

    const channels: [string, number[]][] = [
      ...hexes.map((h): [string, number[]] => [
        h,
        [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)],
      ]),
      ...rgbas.map((r): [string, number[]] => [r, (r.match(/\d+/g) ?? []).slice(0, 3).map(Number)]),
    ];

    expect(channels.length, 'no colour literals found — did the file move?').toBeGreaterThan(0);

    for (const [literal, ch] of channels) {
      const spread = Math.max(...ch) - Math.min(...ch);
      // 2/255 of spread is the neutral-point wobble that keeps the void from
      // reading as flat grey. Anything beyond that is a hue.
      expect(spread, `${literal} is chromatic`).toBeLessThanOrEqual(2);
    }
  });

  it('keeps the renderer clear colour and the CSS void in sync', () => {
    expect(VOID_HEX.toLowerCase()).toBe('#050507');
    expect(code).toContain(`--void: ${VOID_HEX}`);
  });
});

describe('typography (§3.2)', () => {
  it('names the three specified faces and no fourth', () => {
    expect(code).toContain('Bodoni Moda Variable');
    expect(code).toContain('Geist Variable');
    expect(code).toContain('Geist Mono Variable');
  });

  it('sets annotations in mono, uppercase, at the specified tracking', () => {
    expect(code).toMatch(/--track-annotation:\s*0\.14em/);
    expect(globals).toMatch(/\.annotation\s*\{[^}]*text-transform:\s*uppercase/);
    expect(globals).toMatch(/\.annotation\s*\{[^}]*font-family:\s*var\(--face-mono\)/);
  });

  it('binds the optical-size axis to the viewport rather than fixing it', () => {
    expect(globals).toMatch(/font-variation-settings:\s*'opsz'\s*clamp\(/);
  });

  it('caps the measure at 62ch', () => {
    expect(code).toMatch(/--measure:\s*62ch/);
  });
});

describe('motion language (§5.5)', () => {
  it('declares one easing family, entering and exiting', () => {
    expect(code).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(code).toContain('cubic-bezier(0.7, 0, 0.84, 0)');
  });

  it('declares no duration for plate transitions, which are scroll-scrubbed', () => {
    expect(code).not.toMatch(/--dur-plate/);
  });
});

describe('identity (§11)', () => {
  it('is the single source of truth for the name', () => {
    expect(identity.name).toBe('WEFT');
    expect(identity.tagline).toBe('Field notes on a material that does not exist.');
    expect(identity.plateNumerals).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI']);
  });
});
