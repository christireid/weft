import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The §5.2 frame contract is an architectural invariant, and architectural
 * invariants that live only in a document decay. These tests fail the build
 * when the source drifts from ADR-0001.
 *
 * They are deliberately crude — they read source text. A crude test that
 * actually runs on every commit beats a sophisticated one that does not exist.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

/** Strip comments so prose describing a rule does not read as breaking it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the single frame contract (§5.2, ADR-0001)', () => {
  it('registers exactly one useFrame in the whole application', () => {
    const callers = files.filter((f) => /\buseFrame\s*\(/.test(code(f.text)));
    expect(
      callers.map((f) => f.path.replace(process.cwd(), '.')),
      'more than one frame loop — see ADR-0001',
    ).toEqual(['./src/gl/FrameLoop.tsx']);
  });

  it('mounts exactly one Canvas', () => {
    const canvases = files.filter((f) => /<Canvas[\s>]/.test(code(f.text)));
    expect(canvases.map((f) => f.path.replace(process.cwd(), '.'))).toEqual(['./src/gl/Stage.tsx']);
  });

  it('creates exactly one Lenis instance, and does not let it own a rAF loop', () => {
    const constructors = files.filter((f) => code(f.text).includes('new Lenis('));
    expect(constructors.map((f) => f.path.replace(process.cwd(), '.'))).toEqual([
      './src/scroll/scroll.ts',
    ]);
    // autoRaf defaults to true and would start a second loop.
    expect(code(constructors[0]?.text ?? '')).toMatch(/autoRaf:\s*false/);
  });

  it('never drives Lenis from the GSAP ticker', () => {
    /*
     * `gsap.ticker.add(t => lenis.raf(t * 1000))` is the recipe in every
     * Lenis+GSAP article and is a second rAF loop. The frame loop calls
     * stepScroll instead.
     */
    for (const f of files) {
      expect(code(f.text), f.path).not.toMatch(/gsap\.ticker\.add/);
    }
  });
});

describe('no per-frame allocation in the frame loop (§5.2)', () => {
  const loop = files.find((f) => f.path.endsWith('FrameLoop.tsx'));

  it('finds the frame loop', () => {
    expect(loop).toBeDefined();
  });

  it('constructs nothing inside the useFrame callback', () => {
    const text = code(loop?.text ?? '');
    const body = /useFrame\(\([\s\S]*?\n {2}\}\);/.exec(text)?.[0] ?? '';
    expect(body.length, 'could not locate the useFrame body').toBeGreaterThan(50);

    // `new X()`, array literals and object literals all allocate.
    expect(body, 'allocation: new').not.toMatch(/\bnew\s+[A-Z]/);
    expect(body, 'allocation: array literal').not.toMatch(/=\s*\[/);
    expect(body, 'allocation: object literal').not.toMatch(/=\s*\{/);
    // Template strings allocate a string per frame and are the usual accident.
    expect(body, 'allocation: template literal').not.toMatch(/`/);
  });
});

describe('§10 guardrails', () => {
  it('ships no console calls outside the tools directory', () => {
    for (const f of files) {
      expect(code(f.text), f.path).not.toMatch(/\bconsole\.(log|debug|info|warn|error)\s*\(/);
    }
  });

  it('leaves no TODO or FIXME behind', () => {
    for (const f of files) {
      expect(f.text, f.path).not.toMatch(/\b(TODO|FIXME|XXX|HACK)\b/);
    }
  });

  it('imports leva nowhere in the application source', () => {
    // §5.1 allows leva as a dev dependency; §10 forbids shipping it. Nothing
    // imports it yet, and this test is what keeps that true by accident.
    for (const f of files) {
      expect(code(f.text), f.path).not.toMatch(/from\s+['"]leva['"]/);
    }
  });
});
