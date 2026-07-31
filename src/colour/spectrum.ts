/**
 * The CIE 1931 fit, on the CPU.
 *
 * A direct port of `src/shaders/lib/cmfFit.glsl` and the band-white summation
 * in `spectral.glsl`. It exists for one reason: Plate III's particles each
 * carry a single wavelength, and turning a wavelength into a colour needs the
 * flat-spectrum integral to normalise against. Computing that integral in the
 * fragment shader would mean a sixteen-iteration loop of piecewise Gaussians
 * *per fragment*, for a value that is the same for every fragment in the frame.
 * So it is computed once here and passed as a uniform.
 *
 * THE DUPLICATION, AND WHY IT IS SAFE
 *
 * Two copies of a numeric table is exactly the kind of thing that drifts, and
 * drift here would be invisible — the cloud would simply be slightly the wrong
 * colour, which nobody can see without the other copy to compare against. So
 * `tests/spectrum.test.ts` reads the GLSL, extracts the lobe parameters with a
 * regex, and asserts they equal the table below. If either side is edited alone
 * the suite goes red. The GLSL remains the source of truth; this is the copy.
 *
 * The fit itself is from `tools/fit-cmf.mjs` (Nelder-Mead against the CIE 1931
 * 2° observer at 1 nm). Its residuals are in `tools/data/cmf-fit-report.json`.
 */

/** §2's band. Matches WEFT_LAMBDA_MIN/MAX in spectral.glsl. */
export const LAMBDA_MIN = 380;
export const LAMBDA_MAX = 740;

/** amplitude, mean, sigmaLow, sigmaHigh — one row per lobe. */
type Lobe = readonly [number, number, number, number];

export const CMF_X: readonly Lobe[] = [
  [0.939145, 600.3624, 31.482, 29.8689],
  [0.366062, 443.5046, 16.9463, 22.3854],
  [0.177011, 549.1177, 14.982, 61.61],
];

export const CMF_Y: readonly Lobe[] = [
  [0.820865, 568.7903, 46.8853, 40.4963],
  [0.285812, 530.8743, 16.3151, 31.0777],
];

export const CMF_Z: readonly Lobe[] = [
  [1.216488, 436.9624, 11.8406, 35.9868],
  [0.681273, 459.0343, 25.9612, 13.7927],
];

function piecewiseGaussian(x: number, [amplitude, mean, low, high]: Lobe): number {
  const sigma = x < mean ? low : high;
  const t = (x - mean) / sigma;
  return amplitude * Math.exp(-0.5 * t * t);
}

function sumLobes(nm: number, lobes: readonly Lobe[]): number {
  let sum = 0;
  for (const lobe of lobes) sum += piecewiseGaussian(nm, lobe);
  return sum;
}

/** Tristimulus response to a single wavelength, in nm. */
export function wavelengthToXYZ(nm: number): [number, number, number] {
  return [sumLobes(nm, CMF_X), sumLobes(nm, CMF_Y), sumLobes(nm, CMF_Z)];
}

/**
 * The flat-spectrum integral over `samples` uniform samples of the band.
 *
 * Same midpoint rule as `weftBandWhite`: sample at (i + 0.5)/N so the first and
 * last samples sit half a step inside the band rather than on its edges, which
 * is what makes the sum independent of N to first order.
 */
export function bandWhite(samples: number): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const [lx, ly, lz] = wavelengthToXYZ(LAMBDA_MIN + (LAMBDA_MAX - LAMBDA_MIN) * t);
    x += lx;
    y += ly;
    z += lz;
  }
  return [x, y, z];
}
