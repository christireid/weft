import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  ShaderMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type Mesh,
  type WebGLRenderer,
} from 'three';
import clothVert from '../../shaders/plates/cloth.vert.glsl';
import clothFrag from '../../shaders/plates/cloth.frag.glsl';
import { Cloth } from './cloth';
import { setWeavePlate } from '../../gl/registry';
import { appStore } from '../../state/store';
import { TIER_PROFILES } from '../../perf/tier';

/**
 * PLATE IV · TEXTURA — the cloth (§2).
 *
 * Plate III's lattice becomes a sheet. The simulation is in `cloth.ts`; this
 * file owns the mesh, the specimen, and the plate's relationship to scroll.
 *
 * THE SPECIMEN
 *
 * A CC0 macro photograph of gravel, the only photograph in the site (§10). Its
 * provenance is in CREDITS.md, in full, because a licence claim without a
 * traceable origin is worth nothing — and because this sandbox can reach almost
 * no image host, so the route it came by is itself part of the record.
 *
 * It is greyscale. The colour in this plate is produced entirely by the
 * wavelength-dependent displacement in `cloth.frag.glsl`, which is the rule
 * Plate II sets for the whole piece: all colour in WEFT comes from refraction.
 */

/** Sphere collider radius (§2: "~0.12 world units"). */
const COLLIDER_RADIUS = 0.12;

/** Smallest grid the solver will allocate. See the note at its use. */
const MIN_GRID = 64;

/**
 * Refraction strength, in specimen uv per unit of surface tilt.
 *
 * Tuned by looking, three times, and the window is narrower than it appears.
 *
 * The useful range is set by the size of a gravel grain in specimen uv. The
 * spread between the ends of the band is (n₃₈₀ − n₇₄₀)·tilt·uRefraction, about
 * 0.32·tilt·uRefraction; for fringing to read, that has to be a fraction of a
 * grain, and for the specimen to stay legible it must not exceed one.
 *
 * At 0.42 — set while the sheet was still degenerate and tilt was zero — the
 * sixteen wavelengths landed on sixteen unrelated stones once the sheet gained
 * real curvature. Uncorrelated samples average to the specimen's mean, so the
 * cloth turned flat grey with coloured noise in the creases: more refraction
 * produced *less* colour, which is the opposite of the intuition.
 */
const REFRACTION = 0.012;

/**
 * Magnification of the specimen under the sheet.
 *
 * Below 1 the photograph is enlarged, which is what "macro" wants: the image is
 * 512 px square and the sheet is most of the viewport, so showing it whole would
 * put four screen pixels on every specimen pixel and the grain would read as
 * blur rather than as stone.
 */
const SPECIMEN_SCALE = 0.55;

/*
 * Cauchy A and B from the same endpoints Plate II uses, so the two plates
 * disperse identically. Derived rather than transcribed: `weftCauchyFromEndpoints`
 * in the shader solves for A and B given n at each end of the band, and this is
 * the same solve on the CPU so the uniform can be a constant.
 */
const CAUCHY = cauchyFromEndpoints(1.78, 1.46);

const scratchNdc = new Vector3();
const scratchDirection = new Vector3();
const scratchCollider = new Vector4(0, 0, 0, COLLIDER_RADIUS);
const pointerUv = new Vector2(0.5, 0.5);
let pointerPressure = 0;

export interface WeaveHandle {
  step: (gl: WebGLRenderer, elapsed: number, camera: Camera) => void;
  setLocalTime: (t: number, weight: number) => void;
  setPointer: (x: number, y: number, pressure: number) => void;
  dispose: () => void;
}

export function Weave() {
  const gl = useThree((state) => state.gl);
  const meshRef = useRef<Mesh>(null);

  const tier = appStore.getState().tier;
  /*
   * `|| MIN_GRID` covers tier 4, whose profile sets the grid to 0 to mean "do
   * not run". Tier 4 is the no-WebGL2 path (§6.3) and never mounts a Canvas at
   * all, so this branch is unreachable in practice — but a WebGLRenderTarget of
   * size 0 is a GL error rather than a no-op, and a constructor that can produce
   * one is a trap for whoever changes the tier table next. The step is gated on
   * the profile separately, so nothing runs on a tier that asked for nothing.
   */
  const cloth = useMemo(() => new Cloth(gl, TIER_PROFILES[tier].cloth || MIN_GRID), [gl, tier]);

  /**
   * An indexed grid, one vertex per simulation texel.
   *
   * The vertex carries only its texel; the position comes from the solver's
   * output in the vertex shader. So this buffer is uploaded once and never
   * touched again, and the CPU never learns where the cloth is (§5.2).
   */
  const geometry = useMemo(() => {
    const n = cloth.grid;
    const uv = new Float32Array(n * n * 2);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const o = (y * n + x) * 2;
        // Texel centres. NearestFilter on a corner lands on whichever side
        // rounding puts it, so half the vertices would read a neighbour.
        uv[o] = (x + 0.5) / n;
        uv[o + 1] = (y + 0.5) / n;
      }
    }

    const quads = (n - 1) * (n - 1);
    // Uint32 unconditionally: 128² is 16,384 vertices, inside 16 bits today, but
    // a tier that raises the grid past 256 would silently wrap a Uint16 index
    // and fold the far corner of the sheet onto the near one.
    const index = new Uint32Array(quads * 6);
    let w = 0;
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = y * n + x;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        index[w++] = a;
        index[w++] = c;
        index[w++] = b;
        index[w++] = b;
        index[w++] = c;
        index[w++] = d;
      }
    }

    const g = new BufferGeometry();
    g.setAttribute('aClothUv', new BufferAttribute(uv, 2));
    // Required by three's plumbing; never read by this material.
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * n * 3), 3));
    g.setIndex(new BufferAttribute(index, 1));
    return g;
  }, [cloth]);

  const specimen = useMemo(() => {
    const texture = new TextureLoader().load(`${import.meta.env.BASE_URL}specimen/gravel.png`);
    texture.colorSpace = 'srgb';
    return texture;
  }, []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: clothVert,
        fragmentShader: clothFrag,
        // Both faces: the sheet turns over as it swings, and a single-sided
        // cloth vanishes at exactly the moment the fold is most interesting.
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uPosition: { value: null },
          uTexel: { value: 1 / cloth.grid },
          uSpecimen: { value: specimen },
          uWeight: { value: 0 },
          uRefraction: { value: REFRACTION },
          uSamples: { value: 16 },
          uCauchy: { value: new Vector2(CAUCHY.a, CAUCHY.b) },
          uSpecimenScale: { value: SPECIMEN_SCALE },
        },
      }),
    [cloth, specimen],
  );

  useEffect(() => {
    let pinRelease = 0;

    const handle: WeaveHandle = {
      step(renderer, elapsed, camera) {
        const profile = TIER_PROFILES[appStore.getState().tier];
        if (profile.cloth === 0) return;

        /*
         * The pointer, unprojected onto the sheet's plane.
         *
         * §2 puts the collider in world units, so a screen-space blob will not
         * do: the sheet has depth and the camera has perspective, and a
         * collider that ignored both would push the near edge and miss the far
         * one. Intersecting the pointer ray with z = 0 is exact for a flat rest
         * pose and close enough once it has swung, since the sheet's excursion
         * in z stays small relative to the camera distance.
         */
        scratchNdc.set(pointerUv.x * 2 - 1, pointerUv.y * 2 - 1, 0.5).unproject(camera);
        scratchDirection.copy(scratchNdc).sub(camera.position).normalize();
        const travel =
          Math.abs(scratchDirection.z) > 1e-6 ? -camera.position.z / scratchDirection.z : 0;
        scratchCollider.set(
          camera.position.x + scratchDirection.x * travel,
          camera.position.y + scratchDirection.y * travel,
          camera.position.z + scratchDirection.z * travel,
          COLLIDER_RADIUS,
        );

        cloth.step(renderer, {
          /*
           * A fixed step, and the frame delta is not passed in at all.
           *
           * A Verlet integrator's damping and its constraint stiffness are both
           * expressed per step, so a variable dt changes how stiff the cloth
           * *is* — a slow frame produces a visibly slacker sheet, and a fast one
           * a starchier one. Clamping is not enough. The honest trade is that
           * the plate runs a little slower on a slow device rather than
           * behaving like a different material on it.
           */
          dt: 1 / 60,
          time: elapsed,
          pinRelease,
          collider: scratchCollider,
          colliderStrength: pointerPressure > 0 ? 1 : 0,
        });

        const u = material.uniforms;
        if (u.uPosition) u.uPosition.value = cloth.positionTexture;
        if (u.uSamples) u.uSamples.value = profile.spectralSamples;
      },
      setLocalTime(t, weight) {
        const u = material.uniforms;
        if (u.uWeight) u.uWeight.value = weight;
        if (meshRef.current) meshRef.current.visible = weight > 0;
        // §2: "pins release as the plate progresses". The thresholds are in the
        // rest texture; this is the single value they are compared against.
        pinRelease = t;
      },
      setPointer(x, y, pressure) {
        pointerUv.set(x, y);
        pointerPressure = pressure;
      },
      dispose() {
        cloth.dispose();
        geometry.dispose();
        material.dispose();
        specimen.dispose();
      },
    };

    setWeavePlate(handle);
    return () => {
      setWeavePlate(null);
      handle.dispose();
    };
  }, [cloth, geometry, material, specimen]);

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />;
}

/**
 * Solve Cauchy's A and B from the refractive index at each end of the band.
 *
 * The CPU twin of `weftCauchyFromEndpoints`. Kept here rather than imported
 * from the spectral module because it is two lines and the shader is the
 * authority; `tools/shaders.spec.ts` asserts the GPU version against the same
 * identity this one is derived from.
 */
function cauchyFromEndpoints(nBlue: number, nRed: number): { a: number; b: number } {
  const blue = 380;
  const red = 740;
  const invBlue = 1 / (blue * blue);
  const invRed = 1 / (red * red);
  const b = (nBlue - nRed) / (invBlue - invRed);
  return { a: nRed - b * invRed, b };
}
