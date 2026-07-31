import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ShaderMaterial,
  type Points,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import turbulenceVert from '../../shaders/plates/turbulence.vert.glsl';
import turbulenceFrag from '../../shaders/plates/turbulence.frag.glsl';
import { Particles, SOURCE_SPAN } from './particles';
import { setTurbulencePlate } from '../../gl/registry';
import { appStore } from '../../state/store';
import { TIER_PROFILES } from '../../perf/tier';
import { bandWhite } from '../../colour/spectrum';

/**
 * PLATE III · TURBULENTIA — the fray (§2).
 *
 * The filament from Plate I comes apart into a cloud of particles advected
 * through a curl-noise field, each carrying a wavelength from Plate II. The
 * simulation is in `particles.ts`; this file owns the draw and the plate's
 * relationship to scroll.
 *
 * DEPTH SORTING
 *
 * §2 asks for "depth-sorted additive blending". Additive blending is
 * order-independent — a + b = b + a — so sorting changes nothing about the
 * result, and sorting half a million points per frame on the CPU is exactly the
 * per-particle JavaScript the same section forbids. What sorting is actually
 * for in an additive cloud is the depth *test*, and the resolution here is to
 * turn the depth test off and the depth write off: every particle contributes,
 * nothing occludes anything, and the accumulation is bounded by the per-particle
 * emission cap in the fragment shader instead. That is recorded as D-023.
 */

/** Wavelength range the cloud carries. Plate II's band (§2). */
const NM_LOW = 380;
const NM_HIGH = 740;

/**
 * The ceiling on what one particle may emit, in linear light.
 *
 * At tier 1 the densest regions stack a few hundred particles into a pixel. The
 * cap is what keeps that from reaching the tone mapper as a number so large
 * that every dense region resolves to the same white — see the header of
 * turbulence.frag.glsl for why it is per-particle rather than on the sum.
 */
const EMISSION_CAP = 0.9;

/**
 * Point diameter at rest, in CSS pixels at one world unit from the camera.
 *
 * Deliberately larger than one pixel. At a pixel each particle is an isolated
 * fully-saturated sample with nothing around it to average against, and the
 * cloud reads as chroma noise; overlapping sprites let neighbouring wavelengths
 * sum, which is what makes a dense region go white and an edge stay coloured.
 * The cost is fill rather than vertices, which is the cheaper half here.
 */
const POINT_SIZE = 3.4;

/** Speed, in world units per second, that draws the longest streak. */
const SPEED_SCALE = 0.55;

const scratchWhite = new Vector3();

export interface TurbulenceHandle {
  step: (gl: WebGLRenderer, dt: number, elapsed: number, touch: Texture | null) => void;
  setLocalTime: (t: number, weight: number) => void;
  /** Live count, for the §3.3 measurement strings — never a hardcoded number. */
  readonly count: number;
  dispose: () => void;
}

export function Turbulence() {
  const gl = useThree((state) => state.gl);
  const pointsRef = useRef<Points>(null);

  const tier = appStore.getState().tier;
  const particles = useMemo(() => new Particles(gl, TIER_PROFILES[tier].simSize), [gl, tier]);

  /**
   * One vertex per particle, carrying only the texel it should read its state
   * from. Everything else — position, velocity, colour, size — is looked up in
   * the sim textures by the vertex shader, so this buffer is uploaded once and
   * never touched again (§5.2).
   */
  const geometry = useMemo(() => {
    const size = particles.size;
    const count = size * size;
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      // Texel centres, not corners. Sampling at a corner with NearestFilter
      // lands on whichever side of the boundary rounding puts it, so half the
      // particles would read their neighbour's state.
      uv[i * 2] = ((i % size) + 0.5) / size;
      uv[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
    }
    const g = new BufferGeometry();
    g.setAttribute('aParticleUv', new BufferAttribute(uv, 2));
    // `position` is required by three's shader plumbing even though this
    // material never reads it; a zero-filled buffer is the cheapest way to
    // satisfy it, and frustum culling is off so its bounding box is unused.
    g.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    return g;
  }, [particles]);

  const material = useMemo(() => {
    /*
     * Sixteen samples, on every tier. Not TIER_PROFILES[tier].spectralSamples —
     * the dispersion loop can vary its sample count safely because it divides by
     * the white it computed at the same count, but a single wavelength divided
     * by a band white has no such self-correction, and the Z channel is 3.3%
     * away from converged at N = 8 (measured in tests/spectrum.test.ts). Varying
     * it here would give the cloud a different hue on a slow device for no
     * saving: this runs once per material, not per frame.
     */
    const white = bandWhite(16);
    scratchWhite.set(white[0], white[1], white[2]);
    return new ShaderMaterial({
      vertexShader: turbulenceVert,
      fragmentShader: turbulenceFrag,
      transparent: true,
      blending: AdditiveBlending,
      // See the header: additive is order-independent, so the depth test buys
      // nothing and costs occlusion.
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPosition: { value: null },
        uVelocity: { value: null },
        uSeed: { value: particles.seedTexture },
        uPixelRatio: { value: gl.getPixelRatio() },
        uPointSize: { value: POINT_SIZE },
        uSpan: { value: SOURCE_SPAN },
        uSpeedScale: { value: SPEED_SCALE },
        uWeight: { value: 0 },
        uNmLow: { value: NM_LOW },
        uNmHigh: { value: NM_HIGH },
        uEmissionCap: { value: EMISSION_CAP },
        uBandWhite: { value: scratchWhite },
        uLattice: { value: 0 },
      },
    });
  }, [gl, particles]);

  useEffect(() => {
    let lattice = 0;

    const handle: TurbulenceHandle = {
      step(renderer, dt, elapsed, touch) {
        const profile = TIER_PROFILES[appStore.getState().tier];
        if (profile.particles === 0) return;

        // Here rather than in an effect: a point's pixel size is in device
        // pixels, so it has to follow a DPR change, and the frame is the one
        // place that is guaranteed to run after one.
        const u0 = material.uniforms;
        if (u0.uPixelRatio) u0.uPixelRatio.value = renderer.getPixelRatio();

        particles.step(renderer, {
          // Clamped so a long frame — a tab restore, a GC pause — cannot
          // teleport the cloud. The sim is an advection, not an integrator with
          // a stability limit, so this is about the image rather than about
          // blowing up.
          dt: Math.min(dt, 1 / 30),
          time: elapsed,
          lattice,
          touch,
          octaves: profile.curlOctaves,
        });

        const u = material.uniforms;
        if (u.uPosition) u.uPosition.value = particles.positionTexture;
        if (u.uVelocity) u.uVelocity.value = particles.velocityTexture;
        if (u.uLattice) u.uLattice.value = lattice;
      },
      setLocalTime(t, weight) {
        const u = material.uniforms;
        if (u.uWeight) u.uWeight.value = weight;

        /*
         * Skip the draw entirely when the plate contributes nothing.
         *
         * Weight zero already makes every particle emit zero, so the frame is
         * correct either way. Measured at Plate I on this machine it is worth
         * about one frame per second — 22 fps drawing, 21 fps skipping, which is
         * noise. I put this in expecting it to be the reason a media capture had
         * slowed to two minutes a frame; it was not, and the real cause was
         * leftover browser processes from a run I had killed badly.
         *
         * It is kept because the measurement above is taken *before the plate
         * has ever been entered*, when every particle is still at the origin and
         * the whole cloud rasterises into one overlapping speck. Once the plate
         * has run, the particles are spread across the frame and the fill cost is
         * real. The honest summary is: correct, cheap, and not yet demonstrated
         * to matter — the demonstration needs a scroll pass that visits Plate III
         * and comes back, which belongs in the L5 perf harness.
         *
         * `Object3D.visible` rather than `Material.visible`: three tests the
         * former while building the render list, so the draw call is never
         * issued. The latter is checked after the object has already been
         * projected and sorted.
         */
        if (pointsRef.current) pointsRef.current.visible = weight > 0;
        /*
         * §2's exit: "the noise field's curl decays to zero and a lattice
         * attractor engages. Particles fall into rows and columns."
         *
         * Starting at 0.78 rather than at the very end of the plate because the
         * settle takes about a second of wall time and the visitor should be
         * watching it happen rather than arriving at Plate IV to find it
         * already done.
         */
        lattice = Math.min(1, Math.max(0, (t - 0.78) / 0.22));
      },
      get count() {
        return particles.count;
      },
      dispose() {
        particles.dispose();
        geometry.dispose();
        material.dispose();
      },
    };

    setTurbulencePlate(handle);
    return () => {
      setTurbulencePlate(null);
      handle.dispose();
    };
  }, [particles, geometry, material]);

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
