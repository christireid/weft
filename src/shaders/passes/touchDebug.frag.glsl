/*
 * touchDebug.frag.glsl — debug view for the shared pointer field (§7 L1 task 3).
 *
 * Shows all four channels at once as a 2×2 grid, because the interesting bugs
 * are the ones where three channels look right and the fourth is stuck:
 *
 *   top-left      R  velocity x     signed, 0.5 = at rest
 *   top-right     G  velocity y     signed, 0.5 = at rest
 *   bottom-left   B  pressure       0 up, 1 down
 *   bottom-right  A  age            1 where the pointer just was
 *
 * Achromatic, like everything else authored in this piece (§3.1). Signed
 * channels are biased to mid-grey so a leftward flick reads dark and a rightward
 * one reads bright, which makes a sign error visible instead of merely present.
 */

precision highp float;

uniform sampler2D uField;
varying vec2 vUv;

const float VELOCITY_VIEW_GAIN = 2.0;

void main() {
  // Which quadrant, and where within it.
  vec2 cell = floor(vUv * 2.0);
  vec2 local = fract(vUv * 2.0);

  vec4 field = texture2D(uField, local);

  float value;
  if (cell.y > 0.5) {
    value = cell.x < 0.5
      ? field.r * VELOCITY_VIEW_GAIN + 0.5
      : field.g * VELOCITY_VIEW_GAIN + 0.5;
  } else {
    value = cell.x < 0.5 ? field.b : field.a;
  }
  value = clamp(value, 0.0, 1.0);

  // Hairline between quadrants and around the edge, in --ink-12 over --void, so
  // the panel reads as an instrument rather than as four floating squares.
  vec2 d = abs(local - 0.5);
  float grid = step(0.494, max(d.x, d.y));

  vec3 rgb = mix(vec3(value), vec3(0.133), grid);
  gl_FragColor = vec4(rgb, 1.0);
}
