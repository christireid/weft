import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bandWhite, CMF_X, CMF_Y, CMF_Z, LAMBDA_MAX, LAMBDA_MIN } from '../src/colour/spectrum';

/**
 * The CPU copy of the CIE fit must equal the GPU one.
 *
 * `src/colour/spectrum.ts` duplicates a numeric table that lives in
 * `cmfFit.glsl`, because Plate III needs the band-white integral as a uniform
 * rather than as a per-fragment loop. Duplicated numbers drift, and this
 * particular drift would be invisible — the particle cloud would simply be
 * slightly the wrong colour, with nothing on screen to compare it against.
 *
 * So the test reads the shader and compares. Not a restatement of the constants
 * (which would pass just as happily against a stale copy) — the actual bytes of
 * the actual shader the GPU compiles.
 */

const GLSL_ROOT = join(process.cwd(), 'src', 'shaders', 'lib');

function lobesFrom(source: string, fn: string): number[][] {
  const body = new RegExp(`float ${fn}\\(float nm\\) \\{([\\s\\S]*?)\\n\\}`).exec(source);
  expect(body, `${fn} present in cmfFit.glsl`).not.toBeNull();
  const calls = [...(body?.[1] ?? '').matchAll(/weftPiecewiseGaussian\(nm,([^)]*)\)/g)];
  return calls.map((call) =>
    (call[1] ?? '')
      .split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n)),
  );
}

describe('the CPU spectral fit tracks the GLSL one', () => {
  const source = readFileSync(join(GLSL_ROOT, 'cmfFit.glsl'), 'utf8');

  it.each([
    ['weftCmfX', CMF_X],
    ['weftCmfY', CMF_Y],
    ['weftCmfZ', CMF_Z],
  ] as const)('%s lobes match', (fn, table) => {
    const fromShader = lobesFrom(source, fn);
    expect(fromShader.length, `${fn} lobe count`).toBe(table.length);
    fromShader.forEach((lobe, i) => {
      expect(lobe, `${fn} lobe ${String(i)}`).toEqual([...(table[i] ?? [])]);
    });
  });

  it('the band matches spectral.glsl', () => {
    const spectral = readFileSync(join(GLSL_ROOT, 'spectral.glsl'), 'utf8');
    const min = /WEFT_LAMBDA_MIN\s*=\s*([\d.]+)/.exec(spectral);
    const max = /WEFT_LAMBDA_MAX\s*=\s*([\d.]+)/.exec(spectral);
    expect(Number(min?.[1])).toBe(LAMBDA_MIN);
    expect(Number(max?.[1])).toBe(LAMBDA_MAX);
  });
});

describe('bandWhite', () => {
  /*
   * The measured convergence, stated rather than asserted against a threshold
   * picked to pass.
   *
   * The midpoint rule over 380–740 nm converges quickly for X and Y and more
   * slowly for Z, whose fit is the narrowest of the three (sigma from 11.8 nm).
   * Measured against N = 64:
   *
   *     N = 8    X 1.02%   Y 0.15%   Z 3.33%
   *     N = 12   X 0.12%   Y 0.05%   Z 0.44%
   *     N = 16   X 0.06%   Y 0.09%   Z 0.41%
   *     N = 32   X 0.00%   Y 0.01%   Z 0.02%
   *
   * N = 8 is tier 3's dispersion sample count, and Z there is off by 3.3%.
   *
   * That is why Plate III normalises against a *fixed* 16-sample band white
   * rather than against the tier's sample count. The dispersion loop in
   * Plate II can vary N safely because it is self-normalising — it divides by
   * the white it computed at the same N, so a flat spectrum resolves to exactly
   * white at any N. A single wavelength divided by a band white does not have
   * that property, so varying N there would shift the cloud's hue between
   * device tiers for no benefit.
   */
  it('converges in N, most slowly in Z — which is why Plate III pins N=16', () => {
    const reference = bandWhite(64);
    const relative = (n: number, c: number): number => {
      const at = bandWhite(n)[c] ?? 0;
      const ref = reference[c] ?? 1;
      return Math.abs(at / n - ref / 64) / (ref / 64);
    };

    // Y is the luminance channel and is already converged at N = 8; X is not
    // quite, and Z is the outlier by a factor of three over X.
    expect(relative(8, 1)).toBeLessThan(0.005);
    expect(relative(8, 0)).toBeGreaterThan(relative(8, 1));
    expect(relative(8, 2)).toBeGreaterThan(2 * relative(8, 0));

    // By 16 every channel is inside half a percent, which is where Plate III sits.
    for (let c = 0; c < 3; c++) expect(relative(16, c), `channel ${String(c)}`).toBeLessThan(0.005);
  });

  it('is positive in every channel', () => {
    for (const component of bandWhite(16)) expect(component).toBeGreaterThan(0);
  });
});
