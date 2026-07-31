/*
 * clothConstrain.frag.glsl — one Jacobi relaxation pass (§2 Plate IV).
 *
 * §2: "Structural, shear, and bend constraints, [8–16] Jacobi iterations per
 * frame in a fragment shader."
 *
 * THE THREE CONSTRAINT FAMILIES, AND WHAT EACH ONE IS FOR
 *
 *   structural  ±1 in u and v            resists stretching
 *   shear       the four diagonals       resists the sheet racking into a
 *                                        parallelogram, which is what makes an
 *                                        unsheared grid look like a fishing net
 *   bend        ±2 in u and v            resists folding, which is the
 *                                        difference between cloth and foil
 *
 * All three are the same operation — pull a pair of vertices toward their rest
 * separation — applied over different neighbours with different stiffness. Bend
 * is deliberately the weakest: at parity with structural the sheet becomes a
 * board, and the fold that catches the light along a hanging edge disappears.
 *
 * WHY JACOBI AND NOT GAUSS-SEIDEL
 *
 * Gauss-Seidel converges roughly twice as fast per iteration because each
 * correction sees the previous ones. It cannot be done here: every texel is
 * computed in parallel from the same input texture, so a pass is Jacobi by
 * construction. The answer is more passes, which is what §2's 8–16 is. Reading
 * and writing the same texture to fake Gauss-Seidel is a feedback loop, and the
 * results would depend on fragment scheduling order — different on every GPU.
 *
 * Jacobi also needs a relaxation factor below 1 or it oscillates: each vertex
 * applies its full correction while its neighbour applies the opposite one, so
 * a pair that share a constraint overshoot past each other. Halving is the
 * standard fix and it is exact for a two-vertex system.
 */

precision highp float;

uniform sampler2D uPosition;
uniform sampler2D uRest;

/** 1 / GRID, so a neighbour is one texel away. */
uniform float uTexel;
uniform float uStructural;
uniform float uShear;
uniform float uBend;
uniform float uPinRelease;

/** Sphere collider (§2: "radius ~0.12 world units"). xyz centre, w radius. */
uniform vec4 uCollider;
/**
 * 0 when the pointer is absent, so the collider costs nothing at rest.
 *
 * The collider centre is computed on the CPU from the pointer ray rather than
 * being read from the shared touch field. The touch field is a screen-space
 * blob, and this needs a world-space sphere — projecting the blob back through
 * the camera per vertex would be a matrix multiply in the innermost loop of the
 * plate for a value that is the same for every vertex.
 */
uniform float uColliderStrength;

varying vec2 vUv;

/**
 * Accumulate one constraint.
 *
 * `offset` is in texels. The rest length is read from the rest texture rather
 * than assumed uniform, so a sheet that is not square, or one whose rest shape
 * is curved, needs no special case here.
 */
void constrain(
  inout vec3 correction,
  inout float weight,
  vec3 here,
  vec3 restHere,
  vec2 offset,
  float stiffness
) {
  vec2 uv = vUv + offset * uTexel;

  /*
   * Off the edge of the sheet there is no neighbour. Clamping the sample would
   * constrain a border vertex against itself at a rest length it can never
   * satisfy, which pulls the whole border inward — a visible hem that tightens
   * over a few seconds until the sheet looks like it was cut too small.
   */
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return;

  vec3 there = texture2D(uPosition, uv).xyz;
  vec3 restThere = texture2D(uRest, uv).xyz;

  vec3 delta = there - here;
  float distance = length(delta);
  if (distance < 1e-6) return;

  float rest = length(restThere - restHere);
  // Half, because the neighbour applies the mirror correction in the same pass.
  correction += delta * ((distance - rest) / distance) * 0.5 * stiffness;
  weight += stiffness;
}

void main() {
  vec4 position = texture2D(uPosition, vUv);
  vec4 rest = texture2D(uRest, vUv);
  vec3 x = position.xyz;

  // A held vertex is not relaxed; it is the boundary condition the rest of the
  // sheet is relaxed against.
  if (step(uPinRelease, rest.w) > 0.5) {
    gl_FragColor = vec4(rest.xyz, position.w);
    return;
  }

  vec3 correction = vec3(0.0);
  float weight = 0.0;

  // Structural.
  constrain(correction, weight, x, rest.xyz, vec2(1.0, 0.0), uStructural);
  constrain(correction, weight, x, rest.xyz, vec2(-1.0, 0.0), uStructural);
  constrain(correction, weight, x, rest.xyz, vec2(0.0, 1.0), uStructural);
  constrain(correction, weight, x, rest.xyz, vec2(0.0, -1.0), uStructural);

  // Shear.
  constrain(correction, weight, x, rest.xyz, vec2(1.0, 1.0), uShear);
  constrain(correction, weight, x, rest.xyz, vec2(-1.0, 1.0), uShear);
  constrain(correction, weight, x, rest.xyz, vec2(1.0, -1.0), uShear);
  constrain(correction, weight, x, rest.xyz, vec2(-1.0, -1.0), uShear);

  // Bend.
  constrain(correction, weight, x, rest.xyz, vec2(2.0, 0.0), uBend);
  constrain(correction, weight, x, rest.xyz, vec2(-2.0, 0.0), uBend);
  constrain(correction, weight, x, rest.xyz, vec2(0.0, 2.0), uBend);
  constrain(correction, weight, x, rest.xyz, vec2(0.0, -2.0), uBend);

  // Normalised by the stiffness actually applied, so a border vertex with
  // fewer neighbours is corrected as strongly as an interior one rather than
  // being left slack.
  if (weight > 0.0) x += correction / weight;

  /*
   * The pointer, as a sphere collider (§2: "radius ~0.12 world units. Pushing
   * the cloth must visibly re-refract the specimen underneath in the same
   * frame").
   *
   * Same frame is why this is inside the constraint loop rather than applied
   * afterwards: a vertex pushed out of the sphere after the last relaxation
   * would be a vertex the constraints never saw, so the sheet would stretch
   * around the pointer and recover on the following frame. Projecting inside
   * the loop lets the remaining iterations distribute the displacement, and the
   * normals the refraction reads are computed from the result.
   */
  if (uColliderStrength > 0.0) {
    vec3 away = x - uCollider.xyz;
    float distance = length(away);
    if (distance < uCollider.w && distance > 1e-6) {
      x += (away / distance) * (uCollider.w - distance) * uColliderStrength;
    }
  }

  gl_FragColor = vec4(x, position.w);
}
