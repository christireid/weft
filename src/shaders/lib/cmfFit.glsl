/*
 * cmfFit.glsl — GENERATED. Do not edit by hand.
 *
 * Regenerate with:  pnpm fit:cmf
 * Source script:    tools/fit-cmf.mjs
 * Source data:      tools/data/cie1931-2deg-1nm.json
 *                   (CIE 1931 2 Degree Standard Observer, 380–740 nm at 1 nm)
 *
 * Analytic approximation of the CIE 1931 2° colour-matching functions as sums
 * of piecewise Gaussians. The functional form is from Wyman, Sloan & Shirley,
 * JCGT 2(2) 2013; the coefficients below are NOT that paper's — they were
 * fitted by tools/fit-cmf.mjs to the tabulated data above, seeded from the
 * data's own peaks and half-widths. See RESEARCH.md §5 and DECISIONS.md D-012.
 *
 * Measured fit error against the table, 361 samples:
 *
 *   x-bar   rmse 7.705e-3   max |err| 2.016e-2
 *   y-bar   rmse 3.031e-3   max |err| 7.332e-3
 *   z-bar   rmse 4.532e-3   max |err| 2.208e-2
 *
 * tools/shaders.spec.ts asserts these hold on the GPU, at 361 wavelengths,
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
  sum += weftPiecewiseGaussian(nm, 0.939145, 600.3624, 31.4820, 29.8689);
  sum += weftPiecewiseGaussian(nm, 0.366062, 443.5046, 16.9463, 22.3854);
  sum += weftPiecewiseGaussian(nm, 0.177011, 549.1177, 14.9820, 61.6100);
  return sum;
}

float weftCmfY(float nm) {
  float sum = 0.0;
  sum += weftPiecewiseGaussian(nm, 0.820865, 568.7903, 46.8853, 40.4963);
  sum += weftPiecewiseGaussian(nm, 0.285812, 530.8743, 16.3151, 31.0777);
  return sum;
}

float weftCmfZ(float nm) {
  float sum = 0.0;
  sum += weftPiecewiseGaussian(nm, 1.216488, 436.9624, 11.8406, 35.9868);
  sum += weftPiecewiseGaussian(nm, 0.681273, 459.0343, 25.9612, 13.7927);
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
  3.24096994, -0.96924364, 0.05563008,
  -1.53738318, 1.87596750, -0.20397696,
  -0.49861076, 0.04155506, 1.05697151
);

vec3 weftXYZToLinearSRGB(vec3 xyz) {
  return WEFT_XYZ_TO_LINEAR_SRGB * xyz;
}

#endif
