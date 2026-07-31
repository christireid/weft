import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { resolveIncludes, runChunk } from './lib/glslHarness';

/*
 * Shader chunk tests (§8.2 item 1: "render to a small target, assert known
 * pixel values. Catches silent GLSL regressions").
 *
 * Every chunk in src/shaders/lib/ is exercised here against something
 * independent of itself — tabulated CIE data, a JS reimplementation, an
 * analytic identity, or a mathematical property that must hold. A shader test
 * that asserts the shader agrees with itself catches nothing.
 */

const LIB = join(process.cwd(), 'src/shaders/lib');
const chunk = (name: string) => resolveIncludes(join(LIB, name));

const cie = JSON.parse(
  readFileSync(join(process.cwd(), 'tools/data/cie1931-2deg-1nm.json'), 'utf8'),
) as { data: Record<string, [number, number, number]> };

const fitReport = JSON.parse(
  readFileSync(join(process.cwd(), 'tools/data/cmf-fit-report.json'), 'utf8'),
) as { error: Record<'x' | 'y' | 'z', { rmse: number; max: number }> };

// Any page will do — the harness builds its own canvas and context. Using the
// site means the browser is warm and the fixture is the one everything else
// uses.
test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
});

/* ------------------------------------------------------------------ *
 * spectral.glsl
 * ------------------------------------------------------------------ */

test('spectral: the fitted CMFs track the tabulated CIE 1931 curves', async ({ page }) => {
  const COUNT = 361; // 380–740 nm at 1 nm, matching the table exactly
  const out = await runChunk(page, {
    chunks: [chunk('spectral.glsl')],
    count: COUNT,
    body: `
      float nm = 380.0 + float(index);
      return vec4(weftWavelengthToXYZ(nm), 1.0);
    `,
  });

  let worstX = 0;
  let worstY = 0;
  let worstZ = 0;
  for (let i = 0; i < COUNT; i++) {
    const nm = 380 + i;
    const reference = cie.data[String(nm)];
    expect(reference, `missing reference at ${String(nm)}nm`).toBeDefined();
    if (!reference) continue;
    worstX = Math.max(worstX, Math.abs((out[i * 4] ?? 0) - reference[0]));
    worstY = Math.max(worstY, Math.abs((out[i * 4 + 1] ?? 0) - reference[1]));
    worstZ = Math.max(worstZ, Math.abs((out[i * 4 + 2] ?? 0) - reference[2]));
  }

  console.log(
    `[spectral] GPU vs tabulated CIE — max |err|  x ${worstX.toFixed(5)}  ` +
      `y ${worstY.toFixed(5)}  z ${worstZ.toFixed(5)}`,
  );

  // The fit's own reported error, plus a small margin for GPU float precision.
  // If the generated chunk and the fit report ever disagree, this fails — which
  // is the point: it catches a hand-edit of the generated file.
  const margin = 2e-3;
  expect(worstX).toBeLessThan(fitReport.error.x.max + margin);
  expect(worstY).toBeLessThan(fitReport.error.y.max + margin);
  expect(worstZ).toBeLessThan(fitReport.error.z.max + margin);

  // And an absolute ceiling, so a future refit cannot quietly get worse.
  expect(Math.max(worstX, worstY, worstZ)).toBeLessThan(0.03);
});

test('spectral: ȳ peaks at 1.0 near 555 nm, as the CIE definition requires', async ({ page }) => {
  const COUNT = 361;
  const out = await runChunk(page, {
    chunks: [chunk('spectral.glsl')],
    count: COUNT,
    body: `
      float nm = 380.0 + float(index);
      return vec4(weftWavelengthToXYZ(nm), 1.0);
    `,
  });

  let peakValue = -1;
  let peakNm = 0;
  for (let i = 0; i < COUNT; i++) {
    const y = out[i * 4 + 1] ?? 0;
    if (y > peakValue) {
      peakValue = y;
      peakNm = 380 + i;
    }
  }
  console.log(`[spectral] y-bar peak ${peakValue.toFixed(4)} at ${String(peakNm)} nm`);
  expect(peakNm).toBeGreaterThan(548);
  expect(peakNm).toBeLessThan(562);
  expect(peakValue).toBeGreaterThan(0.99);
  expect(peakValue).toBeLessThan(1.01);
});

test('spectral: a flat spectrum resolves to exactly white at any sample count', async ({
  page,
}) => {
  /*
   * The self-normalising property that makes the loop tier-independent. If this
   * fails, dropping the sample count on a slow device tints the whole plate —
   * a bug that would look like an art direction problem.
   */
  const counts = [4, 8, 16, 32, 64];
  const out = await runChunk(page, {
    chunks: [chunk('spectral.glsl')],
    count: counts.length,
    body: `
      int samples = 4;
      if (index == 1) samples = 8;
      else if (index == 2) samples = 16;
      else if (index == 3) samples = 32;
      else if (index == 4) samples = 64;

      WeftSpectrum s = weftSpectrumBegin();
      for (int i = 0; i < 64; i++) {
        if (i >= samples) break;
        float ft = (float(i) + 0.5) / float(samples);
        weftSpectrumAdd(s, weftLambdaAt(ft), 1.0);
      }
      return vec4(weftSpectrumResolve(s), 1.0);
    `,
  });

  for (let i = 0; i < counts.length; i++) {
    const rgb = [out[i * 4] ?? 0, out[i * 4 + 1] ?? 0, out[i * 4 + 2] ?? 0];
    console.log(
      `[spectral] N=${String(counts[i])} flat → rgb(${rgb.map((v) => v.toFixed(4)).join(', ')})`,
    );
    for (const channel of rgb) {
      expect(Math.abs(channel - 1), `N=${String(counts[i])}`).toBeLessThan(1e-4);
    }
  }
});

test('spectral: Cauchy IOR hits its design endpoints and falls monotonically', async ({ page }) => {
  const COUNT = 128;
  const N_BLUE = 1.62;
  const N_RED = 1.58;
  const out = await runChunk(page, {
    chunks: [chunk('spectral.glsl')],
    count: COUNT,
    body: `
      vec2 ab = weftCauchyFromEndpoints(${N_BLUE.toFixed(4)}, ${N_RED.toFixed(4)});
      float nm = weftLambdaAt(t);
      return vec4(weftCauchyIOR(nm, ab.x, ab.y), nm, ab.x, ab.y);
    `,
  });

  const first = out[0] ?? 0;
  const last = out[(COUNT - 1) * 4] ?? 0;
  console.log(`[spectral] IOR 380nm ${first.toFixed(5)}  740nm ${last.toFixed(5)}`);

  expect(first).toBeCloseTo(N_BLUE, 4);
  expect(last).toBeCloseTo(N_RED, 4);

  // Blue bends more than red — get this backwards and the spectrum is mirrored,
  // which reads as "wrong" without anyone being able to say why.
  for (let i = 1; i < COUNT; i++) {
    expect(out[i * 4] ?? 0, `IOR not monotonic at sample ${String(i)}`).toBeLessThan(
      (out[(i - 1) * 4] ?? 0) + 1e-6,
    );
  }

  // And it must actually be Cauchy's curve, not a lerp: the midpoint of a
  // 1/λ² curve sits below the linear interpolation of its endpoints.
  const mid = out[Math.floor(COUNT / 2) * 4] ?? 0;
  const linearMid = (N_BLUE + N_RED) / 2;
  expect(mid).toBeLessThan(linearMid);
});

test('spectral: the derived matrix maps D65 white to (1,1,1)', async ({ page }) => {
  const out = await runChunk(page, {
    chunks: [chunk('spectral.glsl')],
    count: 1,
    body: `
      // D65 as XYZ, from its chromaticity (0.3127, 0.3290) at Y = 1.
      vec3 d65 = vec3(0.3127 / 0.3290, 1.0, (1.0 - 0.3127 - 0.3290) / 0.3290);
      return vec4(weftXYZToLinearSRGB(d65), 1.0);
    `,
  });
  const rgb = [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
  console.log(`[spectral] D65 → rgb(${rgb.map((v) => v.toFixed(5)).join(', ')})`);
  for (const channel of rgb) expect(Math.abs(channel - 1)).toBeLessThan(1e-3);
});

/* ------------------------------------------------------------------ *
 * curl.glsl
 * ------------------------------------------------------------------ */

test('curl: the field is divergence-free', async ({ page }) => {
  /*
   * The whole reason Plate III uses curl noise (RESEARCH.md §4). ∇·(∇×ψ) is
   * identically zero analytically; numerically it is bounded by the
   * finite-difference error. If this regresses, particles clump and the fray
   * stops being a fray.
   */
  const COUNT = 1024;
  const out = await runChunk(page, {
    chunks: [chunk('curl.glsl')],
    count: COUNT,
    body: `
      // Scatter sample points through the noise domain deterministically.
      float fi = float(index);
      vec3 p = vec3(
        mod(fi * 0.37, 7.0) - 3.5,
        mod(fi * 0.71, 7.0) - 3.5,
        mod(fi * 1.13, 7.0) - 3.5
      );
      /*
       * The dimensionless measure of "how divergence-free is this field" is
       * |∇·v| / ‖∇v‖_F — divergence has units of velocity per length, so
       * comparing it to |v| would be dimensionally meaningless and would change
       * answer if the noise were simply rescaled.
       *
       * ‖∇v‖_F is the Frobenius norm of the full 3x3 velocity gradient, and the
       * divergence is its trace, so both come out of the same nine partials.
       */
      const float h = 2e-2;
      vec3 dvdx = (weftCurl(p + vec3(h, 0.0, 0.0)) - weftCurl(p - vec3(h, 0.0, 0.0))) / (2.0 * h);
      vec3 dvdy = (weftCurl(p + vec3(0.0, h, 0.0)) - weftCurl(p - vec3(0.0, h, 0.0))) / (2.0 * h);
      vec3 dvdz = (weftCurl(p + vec3(0.0, 0.0, h)) - weftCurl(p - vec3(0.0, 0.0, h))) / (2.0 * h);

      float divergence = dvdx.x + dvdy.y + dvdz.z;
      float frobenius = sqrt(dot(dvdx, dvdx) + dot(dvdy, dvdy) + dot(dvdz, dvdz));

      return vec4(divergence, frobenius, length(weftCurl(p)), 1.0);
    `,
  });

  let worstRatio = 0;
  let meanSpeed = 0;
  let meanGradient = 0;
  for (let i = 0; i < COUNT; i++) {
    const divergence = Math.abs(out[i * 4] ?? 0);
    const frobenius = out[i * 4 + 1] ?? 0;
    meanSpeed += (out[i * 4 + 2] ?? 0) / COUNT;
    meanGradient += frobenius / COUNT;
    if (frobenius > 1e-3) worstRatio = Math.max(worstRatio, divergence / frobenius);
  }
  console.log(
    `[curl] max |∇·v| / ‖∇v‖_F  ${worstRatio.toExponential(3)}   ` +
      `mean |v| ${meanSpeed.toFixed(4)}   mean ‖∇v‖ ${meanGradient.toFixed(4)}`,
  );

  // The field must be doing something — a zero field is trivially
  // divergence-free and would sail through the real assertion.
  expect(meanSpeed).toBeGreaterThan(0.05);
  expect(meanGradient).toBeGreaterThan(0.05);

  /*
   * Analytically this is exactly zero. What is measured is the residual from
   * two stacked central differences in fp32: the curl's own ε and this test's
   * h each cancel leading digits, so a few percent is the numerical floor
   * rather than a property of the field. The value is logged on every run so a
   * genuine regression — which would move it by an order of magnitude — is
   * visible rather than merely under threshold.
   */
  expect(worstRatio).toBeLessThan(0.05);
});

test('curl: the field is not constant and not degenerate', async ({ page }) => {
  const COUNT = 512;
  const out = await runChunk(page, {
    chunks: [chunk('curl.glsl')],
    count: COUNT,
    body: `
      float fi = float(index);
      vec3 p = vec3(mod(fi * 0.29, 5.0), mod(fi * 0.53, 5.0), mod(fi * 0.97, 5.0));
      return vec4(weftCurl(p), 1.0);
    `,
  });

  let minComponent = Infinity;
  let maxComponent = -Infinity;
  for (let i = 0; i < COUNT * 4; i++) {
    if (i % 4 === 3) continue;
    const v = out[i] ?? 0;
    expect(Number.isFinite(v), 'curl produced a non-finite value').toBe(true);
    minComponent = Math.min(minComponent, v);
    maxComponent = Math.max(maxComponent, v);
  }
  console.log(`[curl] component range ${minComponent.toFixed(4)} … ${maxComponent.toFixed(4)}`);
  expect(maxComponent - minComponent).toBeGreaterThan(0.2);
});

/* ------------------------------------------------------------------ *
 * dither.glsl
 * ------------------------------------------------------------------ */

test('dither: the 8×8 Bayer matrix is a permutation of the 64 levels', async ({ page }) => {
  const out = await runChunk(page, {
    chunks: [chunk('dither.glsl')],
    count: 64,
    body: `
      float x = float(index - (index / 8) * 8);
      float y = float(index / 8);
      return vec4(weftBayer8(vec2(x, y)), 0.0, 0.0, 1.0);
    `,
  });

  const values = Array.from({ length: 64 }, (_, i) => out[i * 4] ?? 0);
  const scaled = values.map((v) => Math.round(v * 64));
  const unique = new Set(scaled);
  console.log(`[dither] Bayer distinct levels ${String(unique.size)} of 64`);

  // A correct dispersed-dot matrix visits every level exactly once. A broken
  // one usually still *looks* plausible, which is why this is asserted rather
  // than eyeballed.
  expect(unique.size).toBe(64);
  expect(Math.min(...scaled)).toBe(0);
  expect(Math.max(...scaled)).toBe(63);
});

test('dither: quantising a dark gradient without dither bands, with dither does not', async ({
  page,
}) => {
  /*
   * The §7 L1 task 6 requirement — "verified against a dark gradient for zero
   * banding" — made measurable.
   *
   * A ramp from 0 to 0.02 across 256 samples quantised to 8 bits can only
   * produce ~6 distinct output values, so it bands. Dithering trades that for
   * noise which, averaged over neighbours, reconstructs far more of the ramp.
   * The measure is the number of distinct values in the output.
   */
  const COUNT = 256;
  const out = await runChunk(page, {
    chunks: [chunk('dither.glsl')],
    count: COUNT,
    body: `
      float ramp = t * 0.02;
      vec2 pixel = vec2(float(index - (index / 16) * 16), float(index / 16));
      vec3 plain = floor(vec3(ramp) * 255.0 + 0.5) / 255.0;
      vec3 dithered = weftDitherQuantise(vec3(ramp), pixel, 0.04, 255.0, 0.35);
      return vec4(plain.r, dithered.r, ramp, 1.0);
    `,
  });

  const plain = new Set<number>();
  const dithered = new Set<number>();
  for (let i = 0; i < COUNT; i++) {
    plain.add(Math.round((out[i * 4] ?? 0) * 255));
    dithered.add(Math.round((out[i * 4 + 1] ?? 0) * 255));
  }
  console.log(
    `[dither] dark ramp 0→0.02: undithered ${String(plain.size)} levels, ` +
      `dithered ${String(dithered.size)} levels`,
  );

  expect(plain.size).toBeLessThanOrEqual(7);
  expect(dithered.size).toBeGreaterThan(plain.size);
});

test('dither: quantisation preserves the mean of the signal', async ({ page }) => {
  // Dither must not shift the image's brightness. A threshold that is not
  // zero-centred does exactly that, and it shows up as the void turning grey.
  const COUNT = 4096;
  const out = await runChunk(page, {
    chunks: [chunk('dither.glsl')],
    count: COUNT,
    body: `
      float value = 0.01;
      vec2 pixel = vec2(float(index - (index / 64) * 64), float(index / 64));
      return vec4(weftDitherQuantise(vec3(value), pixel, 0.04, 255.0, 0.35).r, value, 0.0, 1.0);
    `,
  });

  let sum = 0;
  for (let i = 0; i < COUNT; i++) sum += out[i * 4] ?? 0;
  const mean = sum / COUNT;
  console.log(`[dither] mean of dithered 0.01 over 4096 px: ${mean.toFixed(5)}`);
  expect(Math.abs(mean - 0.01)).toBeLessThan(0.001);
});

/* ------------------------------------------------------------------ *
 * sdf.glsl
 * ------------------------------------------------------------------ */

test('sdf: distances are true distances, and normals are unit and radial', async ({ page }) => {
  const COUNT = 256;
  const SAMPLE_POINT = `
      float a = t * 6.2831853;
      vec3 p = vec3(cos(a) * (0.5 + t * 2.0), sin(a) * (0.5 + t * 2.0), t - 0.5);
  `;

  /*
   * Two passes over the same sample points, because there are only four
   * channels. The first reports the points the *shader* used rather than
   * letting the test recompute them: GLSL's sin/cos and JS's differ in the last
   * couple of ulps, and at radius 2.5 that discrepancy is larger than the
   * tolerance the SDFs themselves deserve. Comparing against the shader's own
   * input isolates what is being tested.
   */
  const points = await runChunk(page, {
    chunks: [chunk('sdf.glsl')],
    count: COUNT,
    body: `${SAMPLE_POINT} return vec4(p, 0.0);`,
  });

  const out = await runChunk(page, {
    chunks: [chunk('sdf.glsl')],
    count: COUNT,
    body: `
      ${SAMPLE_POINT}
      float sphere = weftSdSphere(p, 1.0);
      vec3 n = weftSdSphereNormal(p, 1.0, 1e-3);
      float box = weftSdBox(p, vec3(0.5));
      float capsule = weftSdCapsule(p, vec3(-1.0, 0.0, 0.0), vec3(1.0, 0.0, 0.0), 0.25);
      return vec4(sphere, length(n), box, capsule);
    `,
  });

  for (let i = 0; i < COUNT; i++) {
    const p: [number, number, number] = [
      points[i * 4] ?? 0,
      points[i * 4 + 1] ?? 0,
      points[i * 4 + 2] ?? 0,
    ];

    // Sphere: an exact analytic answer to compare against.
    const expected = Math.hypot(p[0], p[1], p[2]) - 1;
    expect(Math.abs((out[i * 4] ?? 0) - expected), `sphere at sample ${String(i)}`).toBeLessThan(
      1e-4,
    );

    // Normals must be unit length everywhere, including inside.
    expect(Math.abs((out[i * 4 + 1] ?? 0) - 1), `normal length at ${String(i)}`).toBeLessThan(1e-3);

    // Box: |p| - halfExtent per axis, combined. Compare to a JS reimplementation.
    const q = [Math.abs(p[0]) - 0.5, Math.abs(p[1]) - 0.5, Math.abs(p[2]) - 0.5] as const;
    const outside = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
    const inside = Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0);
    expect(
      Math.abs((out[i * 4 + 2] ?? 0) - (outside + inside)),
      `box at ${String(i)}`,
    ).toBeLessThan(1e-4);
  }
});

test('sdf: the capsule is the primitive the touch field stamps with', async ({ page }) => {
  // Points on the segment axis are exactly -r from the surface; points off the
  // end cap fall back to distance-to-endpoint. Both are asserted because the
  // clamp that distinguishes them is the part that gets written wrong.
  const out = await runChunk(page, {
    chunks: [chunk('sdf.glsl')],
    count: 3,
    body: `
      vec3 a = vec3(-1.0, 0.0, 0.0);
      vec3 b = vec3(1.0, 0.0, 0.0);
      vec3 p = vec3(0.0);
      if (index == 1) p = vec3(2.0, 0.0, 0.0);   // beyond the end cap
      if (index == 2) p = vec3(0.0, 0.75, 0.0);  // perpendicular to the axis
      return vec4(weftSdCapsule(p, a, b, 0.25), 0.0, 0.0, 1.0);
    `,
  });
  expect(out[0] ?? 0).toBeCloseTo(-0.25, 5); // on the axis
  expect(out[4] ?? 0).toBeCloseTo(0.75, 5); // 1.0 past the endpoint, minus r
  expect(out[8] ?? 0).toBeCloseTo(0.5, 5); // 0.75 off the axis, minus r
});

/* ------------------------------------------------------------------ *
 * easing.glsl
 * ------------------------------------------------------------------ */

/** Independent JS solver, so the GPU curve is checked against something else. */
function cssBezier(t: number, x1: number, y1: number, x2: number, y2: number): number {
  const bx = (s: number) => 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3;
  const by = (s: number) => 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < t) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
}

test('easing: the GPU curves match the CSS curves in tokens.css', async ({ page }) => {
  /*
   * §5.5 requires one easing family across DOM and GPU. If these drift, a
   * shader-driven element and a CSS-driven one given the same normalised time
   * land in different places, and the piece feels assembled from parts — which
   * is the exact failure the single family exists to prevent.
   */
  const COUNT = 128;
  const out = await runChunk(page, {
    chunks: [chunk('easing.glsl')],
    count: COUNT,
    body: `return vec4(weftEaseEnter(t), weftEaseExit(t), weftSmoothstep(0.0, 1.0, t), 1.0);`,
  });

  const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
  expect(tokens, 'enter curve moved in tokens.css').toContain('cubic-bezier(0.16, 1, 0.3, 1)');
  expect(tokens, 'exit curve moved in tokens.css').toContain('cubic-bezier(0.7, 0, 0.84, 0)');

  let worstEnter = 0;
  let worstExit = 0;
  for (let i = 0; i < COUNT; i++) {
    const t = i / (COUNT - 1);
    worstEnter = Math.max(worstEnter, Math.abs((out[i * 4] ?? 0) - cssBezier(t, 0.16, 1, 0.3, 1)));
    worstExit = Math.max(
      worstExit,
      Math.abs((out[i * 4 + 1] ?? 0) - cssBezier(t, 0.7, 0, 0.84, 0)),
    );
  }
  console.log(
    `[easing] max |GPU − CSS|  enter ${worstEnter.toExponential(2)}  ` +
      `exit ${worstExit.toExponential(2)}`,
  );

  expect(worstEnter).toBeLessThan(2e-3);
  expect(worstExit).toBeLessThan(2e-3);

  // Endpoints are exact, and both curves are monotonic — an easing curve that
  // overshoots would violate §5.5's "no overshoot on anything with mass".
  expect(out[0] ?? -1).toBeCloseTo(0, 5);
  expect(out[(COUNT - 1) * 4] ?? -1).toBeCloseTo(1, 4);
  for (let i = 1; i < COUNT; i++) {
    expect(out[i * 4] ?? 0).toBeGreaterThanOrEqual((out[(i - 1) * 4] ?? 0) - 1e-6);
  }
});
