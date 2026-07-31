/**
 * `pnpm fit:cmf` — fits the CIE 1931 colour-matching functions and emits
 * src/shaders/lib/cmfFit.glsl.
 *
 * WHY THIS EXISTS
 *
 * §2 Plate II requires spectral rendering: sample 16 wavelengths, refract each
 * with its own IOR, convert to sRGB through a CIE colour-matching
 * approximation, accumulate. Doing that in a fragment shader needs the x̄/ȳ/z̄
 * curves as closed-form functions rather than a 361-entry table.
 *
 * The standard approach is Wyman, Sloan & Shirley, "Simple Analytic
 * Approximations to the CIE XYZ Color Matching Functions", JCGT 2(2) 2013:
 * approximate each curve as a small sum of *piecewise* Gaussians, which have
 * different widths either side of their peak and so can follow the curves'
 * asymmetry. That paper is unreachable from this sandbox (RESEARCH.md §5), and
 * §0.4 forbids inventing numbers, so its coefficients are not used.
 *
 * Instead: the functional form is taken from the literature and cited; the
 * coefficients are fitted here, by this script, to tabulated CIE data checked
 * into tools/data/. Seeds are derived from the data itself — peak locations by
 * local maxima, widths by half-width-at-half-maximum — not from recalled
 * values. The measured error is printed and embedded in the generated file, so
 * the claim "this approximates the CIE curves" carries a number.
 *
 * The XYZ→linear-sRGB matrix is derived here too, from the sRGB primary
 * chromaticities and the D65 white point (IEC 61966-2-1), rather than
 * transcribed. tests assert it maps D65 to (1,1,1).
 *
 * Data: tools/data/cie1931-2deg-1nm.json, extracted from colour-science
 * (BSD-3-Clause). The values are the CIE standard observer itself. Credited in
 * CREDITS.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const table = JSON.parse(readFileSync(join(root, 'tools/data/cie1931-2deg-1nm.json'), 'utf8'));

const LO = 380;
const HI = 740;

const lambdas = [];
const target = { x: [], y: [], z: [] };
for (let w = LO; w <= HI; w++) {
  const row = table.data[String(w)];
  if (!row) throw new Error(`missing wavelength ${w}`);
  lambdas.push(w);
  target.x.push(row[0]);
  target.y.push(row[1]);
  target.z.push(row[2]);
}

/* ---------------------------------------------------------------- *
 * The functional form (Wyman/Sloan/Shirley): a piecewise Gaussian has
 * one mean and two standard deviations, so it can be narrow on one
 * side of its peak and wide on the other. The CIE curves are strongly
 * asymmetric, which is why a symmetric Gaussian sum needs many more
 * lobes to reach the same error.
 * ---------------------------------------------------------------- */
function piecewiseGaussian(x, amplitude, mean, sigmaLow, sigmaHigh) {
  const s = x < mean ? sigmaLow : sigmaHigh;
  if (s <= 0) return 0;
  const t = (x - mean) / s;
  return amplitude * Math.exp(-0.5 * t * t);
}

/** params is a flat array of [amp, mean, sLow, sHigh] per lobe. */
function evaluate(params, x) {
  let sum = 0;
  for (let i = 0; i < params.length; i += 4) {
    sum += piecewiseGaussian(x, params[i], params[i + 1], params[i + 2], params[i + 3]);
  }
  return sum;
}

function rmse(params, values) {
  let acc = 0;
  for (let i = 0; i < lambdas.length; i++) {
    const d = evaluate(params, lambdas[i]) - values[i];
    acc += d * d;
  }
  return Math.sqrt(acc / lambdas.length);
}

function maxError(params, values) {
  let worst = 0;
  for (let i = 0; i < lambdas.length; i++) {
    worst = Math.max(worst, Math.abs(evaluate(params, lambdas[i]) - values[i]));
  }
  return worst;
}

/* ---------------------------------------------------------------- *
 * Seeds, derived from the data.
 * ---------------------------------------------------------------- */
function findLobes(values, wanted) {
  // Local maxima, strongest first.
  const peaks = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] >= values[i - 1] && values[i] > values[i + 1]) {
      peaks.push({ index: i, value: values[i] });
    }
  }
  peaks.sort((a, b) => b.value - a.value);

  const seeds = [];
  for (const peak of peaks.slice(0, wanted)) {
    const half = peak.value / 2;
    let lo = peak.index;
    while (lo > 0 && values[lo] > half) lo--;
    let hi = peak.index;
    while (hi < values.length - 1 && values[hi] > half) hi++;
    // HWHM → sigma, for a Gaussian: sigma = HWHM / sqrt(2 ln 2)
    const k = Math.sqrt(2 * Math.LN2);
    const sLow = Math.max(4, (peak.index - lo) / k);
    const sHigh = Math.max(4, (hi - peak.index) / k);
    seeds.push(peak.value, lambdas[peak.index], sLow, sHigh);
  }
  // If the curve has fewer local maxima than lobes requested, pad with a small
  // lobe near the peak; the optimiser moves it where it is needed.
  while (seeds.length < wanted * 4) {
    seeds.push(0.05, lambdas[Math.floor(lambdas.length / 2)], 20, 20);
  }
  return seeds;
}

/* ---------------------------------------------------------------- *
 * Nelder-Mead. Hand-rolled because there is no scipy here, and because
 * a 60-line optimiser in the repo is more auditable than a dependency.
 * ---------------------------------------------------------------- */
function nelderMead(objective, start, { iterations = 20000, step = 0.12, tolerance = 1e-12 } = {}) {
  const n = start.length;
  const simplex = [start.slice()];
  for (let i = 0; i < n; i++) {
    const point = start.slice();
    point[i] += (Math.abs(point[i]) || 1) * step;
    simplex.push(point);
  }
  const scores = simplex.map(objective);

  const centroid = new Array(n);
  for (let iter = 0; iter < iterations; iter++) {
    const order = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
    const best = order[0];
    const worst = order[n];
    const secondWorst = order[n - 1];

    centroid.fill(0);
    for (const idx of order.slice(0, n)) {
      for (let i = 0; i < n; i++) centroid[i] += simplex[idx][i] / n;
    }

    const reflect = centroid.map((c, i) => c + (c - simplex[worst][i]));
    const reflectScore = objective(reflect);

    if (reflectScore < scores[best]) {
      const expand = centroid.map((c, i) => c + 2 * (c - simplex[worst][i]));
      const expandScore = objective(expand);
      if (expandScore < reflectScore) {
        simplex[worst] = expand;
        scores[worst] = expandScore;
      } else {
        simplex[worst] = reflect;
        scores[worst] = reflectScore;
      }
    } else if (reflectScore < scores[secondWorst]) {
      simplex[worst] = reflect;
      scores[worst] = reflectScore;
    } else {
      const contract = centroid.map((c, i) => c + 0.5 * (simplex[worst][i] - c));
      const contractScore = objective(contract);
      if (contractScore < scores[worst]) {
        simplex[worst] = contract;
        scores[worst] = contractScore;
      } else {
        for (const idx of order.slice(1)) {
          for (let i = 0; i < n; i++) {
            simplex[idx][i] = simplex[best][i] + 0.5 * (simplex[idx][i] - simplex[best][i]);
          }
          scores[idx] = objective(simplex[idx]);
        }
      }
    }

    // Converged: the simplex has collapsed and further iterations only burn
    // time. Without this the fit takes minutes instead of seconds.
    const spread = Math.max(...scores) - Math.min(...scores);
    if (spread < tolerance) break;
  }
  const bestIndex = scores.indexOf(Math.min(...scores));
  return simplex[bestIndex];
}

function fit(values, lobes, label) {
  const seed = findLobes(values, lobes);
  let best = seed;
  let bestScore = rmse(seed, values);
  // Restarts from perturbed seeds: Nelder-Mead in 8–12 dimensions finds local
  // minima, and the cheapest defence is to run it several times.
  for (let restart = 0; restart < 10; restart++) {
    const start =
      restart === 0
        ? seed.slice()
        : seed.map((v, i) => v * (1 + (((i * 37 + restart * 101) % 21) - 10) / 60));
    const result = nelderMead((p) => rmse(p, values), start);
    const score = rmse(result, values);
    if (score < bestScore) {
      bestScore = score;
      best = result;
    }
  }
  console.log(
    `${label}: ${String(lobes)} lobes  rmse ${bestScore.toExponential(3)}  ` +
      `max |err| ${maxError(best, values).toExponential(3)}`,
  );
  return { params: best, rmse: bestScore, max: maxError(best, values) };
}

/* ---------------------------------------------------------------- *
 * XYZ -> linear sRGB, derived from primaries rather than transcribed.
 * ---------------------------------------------------------------- */
function inverse3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
}

function multiply3(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function rgbToXyzMatrix(primaries, white) {
  // Each primary's chromaticity gives a direction in XYZ; the scale of each is
  // fixed by requiring the primaries sum to the white point at (1,1,1).
  const columns = primaries.map(([x, y]) => [x / y, 1, (1 - x - y) / y]);
  const m = [
    columns[0][0],
    columns[1][0],
    columns[2][0],
    columns[0][1],
    columns[1][1],
    columns[2][1],
    columns[0][2],
    columns[1][2],
    columns[2][2],
  ];
  const whiteXyz = [white[0] / white[1], 1, (1 - white[0] - white[1]) / white[1]];
  const scale = multiply3(inverse3(m), whiteXyz);
  return [
    m[0] * scale[0],
    m[1] * scale[1],
    m[2] * scale[2],
    m[3] * scale[0],
    m[4] * scale[1],
    m[5] * scale[2],
    m[6] * scale[0],
    m[7] * scale[1],
    m[8] * scale[2],
  ];
}

// IEC 61966-2-1 sRGB primaries and D65 white, as chromaticities.
const SRGB_PRIMARIES = [
  [0.64, 0.33],
  [0.3, 0.6],
  [0.15, 0.06],
];
const D65 = [0.3127, 0.329];

const rgbToXyz = rgbToXyzMatrix(SRGB_PRIMARIES, D65);
const xyzToRgb = inverse3(rgbToXyz);

/* ---------------------------------------------------------------- *
 * Fit and emit.
 * ---------------------------------------------------------------- */
console.log(`fitting ${table.observer}, ${String(LO)}–${String(HI)} nm at 1 nm\n`);

const fitX = fit(target.x, 3, 'x-bar');
const fitY = fit(target.y, 2, 'y-bar');
const fitZ = fit(target.z, 2, 'z-bar');

const worst = Math.max(fitX.max, fitY.max, fitZ.max);
console.log(`\nworst max |error| across all three curves: ${worst.toFixed(5)}`);

function emitLobes(params) {
  const out = [];
  for (let i = 0; i < params.length; i += 4) {
    const [a, m, sl, sh] = [params[i], params[i + 1], params[i + 2], params[i + 3]];
    out.push(
      `  sum += weftPiecewiseGaussian(nm, ${a.toFixed(6)}, ${m.toFixed(4)}, ` +
        `${Math.abs(sl).toFixed(4)}, ${Math.abs(sh).toFixed(4)});`,
    );
  }
  return out.join('\n');
}

const m3 = (v) => v.map((n) => n.toFixed(8));
const xr = m3(xyzToRgb);

const generated = `/*
 * cmfFit.glsl — GENERATED. Do not edit by hand.
 *
 * Regenerate with:  pnpm fit:cmf
 * Source script:    tools/fit-cmf.mjs
 * Source data:      tools/data/cie1931-2deg-1nm.json
 *                   (${table.observer}, ${String(LO)}–${String(HI)} nm at 1 nm)
 *
 * Analytic approximation of the CIE 1931 2° colour-matching functions as sums
 * of piecewise Gaussians. The functional form is from Wyman, Sloan & Shirley,
 * JCGT 2(2) 2013; the coefficients below are NOT that paper's — they were
 * fitted by tools/fit-cmf.mjs to the tabulated data above, seeded from the
 * data's own peaks and half-widths. See RESEARCH.md §5 and DECISIONS.md D-012.
 *
 * Measured fit error against the table, ${String(lambdas.length)} samples:
 *
 *   x-bar   rmse ${fitX.rmse.toExponential(3)}   max |err| ${fitX.max.toExponential(3)}
 *   y-bar   rmse ${fitY.rmse.toExponential(3)}   max |err| ${fitY.max.toExponential(3)}
 *   z-bar   rmse ${fitZ.rmse.toExponential(3)}   max |err| ${fitZ.max.toExponential(3)}
 *
 * tools/shaders.spec.ts asserts these hold on the GPU, at ${String(lambdas.length)} wavelengths,
 * against the same table.
 */

#ifndef WEFT_CMF_FIT
#define WEFT_CMF_FIT

/*
 * A piecewise Gaussian: one mean, two standard deviations. The CIE curves are
 * strongly asymmetric, and a symmetric Gaussian sum needs far more lobes to
 * reach the same error.
 */
float weftPiecewiseGaussian(float x, float amplitude, float mean, float sigmaLow, float sigmaHigh) {
  float s = x < mean ? sigmaLow : sigmaHigh;
  float t = (x - mean) / s;
  return amplitude * exp(-0.5 * t * t);
}

float weftCmfX(float nm) {
  float sum = 0.0;
${emitLobes(fitX.params)}
  return sum;
}

float weftCmfY(float nm) {
  float sum = 0.0;
${emitLobes(fitY.params)}
  return sum;
}

float weftCmfZ(float nm) {
  float sum = 0.0;
${emitLobes(fitZ.params)}
  return sum;
}

/** Tristimulus response to a single wavelength, in nm. */
vec3 weftWavelengthToXYZ(float nm) {
  return vec3(weftCmfX(nm), weftCmfY(nm), weftCmfZ(nm));
}

/*
 * XYZ -> linear sRGB.
 *
 * Derived in tools/fit-cmf.mjs from the IEC 61966-2-1 primary chromaticities
 * and the D65 white point, by inverting the RGB->XYZ matrix built from them.
 * Not transcribed. tests assert it maps D65 to (1,1,1).
 *
 * GLSL matrices are column-major, so this is written transposed relative to how
 * the rows are usually printed.
 */
const mat3 WEFT_XYZ_TO_LINEAR_SRGB = mat3(
  ${xr[0]}, ${xr[3]}, ${xr[6]},
  ${xr[1]}, ${xr[4]}, ${xr[7]},
  ${xr[2]}, ${xr[5]}, ${xr[8]}
);

vec3 weftXYZToLinearSRGB(vec3 xyz) {
  return WEFT_XYZ_TO_LINEAR_SRGB * xyz;
}

#endif
`;

const outPath = join(root, 'src/shaders/lib/cmfFit.glsl');
writeFileSync(outPath, generated);
console.log(`\nwrote ${outPath.replace(root, '.')}`);

// Also emit the reference numbers the test suite asserts against, so the test
// and the shader cannot drift apart silently.
writeFileSync(
  join(root, 'tools/data/cmf-fit-report.json'),
  `${JSON.stringify(
    {
      generatedFrom: table.observer,
      range: [LO, HI],
      samples: lambdas.length,
      lobes: { x: 3, y: 2, z: 2 },
      error: {
        x: { rmse: fitX.rmse, max: fitX.max },
        y: { rmse: fitY.rmse, max: fitY.max },
        z: { rmse: fitZ.rmse, max: fitZ.max },
      },
      xyzToLinearSrgb: xyzToRgb,
      linearSrgbToXyz: rgbToXyz,
    },
    null,
    2,
  )}\n`,
);
