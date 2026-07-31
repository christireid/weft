/*
 * turbulencePosition.frag.glsl — one GPGPU position step (§2 Plate III, §5.4).
 *
 * p ← p + v·Δt, plus the respawn that keeps the fray a fray.
 *
 * WHY PARTICLES RESPAWN
 *
 * §2 describes Plate III as "the single filament frays". A fray is a *process*
 * — it needs a source. Advecting a fixed set of particles from a line produces
 * one fray and then a cloud: within three seconds every particle is somewhere
 * in the middle of the box and the filament they came from is gone, so the
 * plate stops being about a thread coming apart and becomes a nebula.
 *
 * So each particle carries an age, and at the end of its life it returns to the
 * filament and starts again. The cloud reaches a steady state in which the
 * thread is always visibly present at one end and always visibly failing along
 * its length, which is the image the plate is named for.
 *
 * The lifetimes are spread by the particle's own seed rather than being equal,
 * because a shared lifetime makes the whole cloud blink at once.
 */

precision highp float;

uniform sampler2D uPosition;
uniform sampler2D uVelocity;
/** The seeded initial state: xyz on the filament, w the particle's seed. */
uniform sampler2D uSeed;

uniform float uDt;
/** Seconds a particle lives before returning to the filament. */
uniform float uLife;
/**
 * 0 during the plate, 1 through the exit transformation. Respawn stops with the
 * curl: §2's exit settles the cloud into a lattice, and a particle teleporting
 * back to the filament out of a settled grid is a hole opening in the image.
 */
uniform float uLattice;
/**
 * 1 on the priming pass, 0 every frame after.
 *
 * At boot the position targets are cleared to zero, so every particle would sit
 * at the origin until its first respawn — a solid dot at the centre of the
 * frame for the first few seconds of the plate. Priming forces one respawn for
 * everything, which places the cloud on the filament.
 *
 * An explicit uniform rather than the cute version (a Δt large enough that
 * every age crosses 1), because the cute version depends on the lifetime
 * spread staying what it is today and fails silently and confusingly if it
 * changes.
 */
uniform float uReset;

varying vec2 vUv;

void main() {
  vec4 position = texture2D(uPosition, vUv);
  vec4 velocity = texture2D(uVelocity, vUv);
  vec4 seed = texture2D(uSeed, vUv);

  vec3 p = position.xyz + velocity.xyz * uDt;

  /*
   * Age in .w, normalised to 0..1 over the particle's life. Spread by the seed
   * so the cloud does not pulse. Stored normalised rather than in seconds so
   * the render pass can fade a particle in and out without needing uLife.
   */
  float rate = uDt / (uLife * (0.55 + seed.w * 0.9));
  float age = position.w + rate;

  /*
   * Respawn. `step` rather than a branch: every fragment does the same work
   * either way on a GPU, and the branchless form keeps the wavefront coherent.
   * Multiplying by (1 − uLattice) freezes respawning through the exit.
   */
  float reborn = max(uReset, step(1.0, age) * (1.0 - uLattice));
  p = mix(p, seed.xyz, reborn);
  age = mix(age, 0.0, reborn);

  gl_FragColor = vec4(p, age);
}
