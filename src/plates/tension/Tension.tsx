import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { AdditiveBlending, type Mesh, ShaderMaterial, Vector2, type WebGLRenderer } from 'three';
import { createRibbonGeometry } from './ribbon';
import { TensionWave } from './wave';
import tensionVert from '../../shaders/plates/tension.vert.glsl';
import tensionFrag from '../../shaders/plates/tension.frag.glsl';
import { setTensionPlate } from '../../gl/registry';

/**
 * PLATE I · TENSIO — a single filament, held under load (§2).
 *
 * The plate owns its geometry, its material and its wave simulation, and
 * exposes one `step` for the single frame loop to call. It never registers a
 * `useFrame` of its own: there is exactly one in the application (ADR-0001) and
 * `tests/architecture.test.ts` fails the build if a second appears.
 *
 * The mesh stays mounted for the life of the page. The router turns the
 * simulation on and off; nothing is created or destroyed as the visitor scrolls
 * past, which is what the L1 gate's zero-GL-objects-during-scroll result
 * depends on.
 */

/** Vertices along the ribbon. Fewer than the 512 wave stations, deliberately —
 *  the shader samples the wave texture with linear filtering between them. */
const RIBBON_STATIONS = 256;

/** Half-length in world units. At the configured camera this overshoots the
 *  viewport, so the thread runs off both edges rather than terminating in frame. */
const SPAN = 4.1;

/** Catenary depth. Shallow, per §2 — this is a thread under tension, not a chain. */
const SAG = 0.42;

const resolution = new Vector2();

export interface TensionHandle {
  /**
   * The wave takes the pointer through `setPointer` (the bare coordinate, which
   * is what "which station is held" needs) rather than through the shared touch
   * field — see the note in src/gl/pointer.ts on why both exist.
   */
  step: (gl: WebGLRenderer, elapsed: number, freeze?: boolean) => void;
  setLocalTime: (t: number, weight: number) => void;
  setPointer: (x: number, y: number, pressure: number) => void;
  dispose: () => void;
}

export function Tension() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const meshRef = useRef<Mesh>(null);

  const geometry = useMemo(() => createRibbonGeometry(RIBBON_STATIONS), []);
  const wave = useMemo(() => new TensionWave(gl), [gl]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: tensionVert,
        fragmentShader: tensionFrag,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        // Additive: the filament is light, and light adds. It also means the
        // thread brightens where it crosses itself during the exit
        // transformation, which is physically right and free.
        blending: AdditiveBlending,
        uniforms: {
          uWave: { value: wave.texture },
          uResolution: { value: resolution },
          // Wide enough that the spectral wings occupy real pixels rather than
          // living inside one. At DPR 2 this is ~4.5 CSS px of total ribbon, of
          // which the white core is about 1.5.
          uWidthPx: { value: 9.0 },
          uSpan: { value: SPAN },
          uSag: { value: SAG },
          uExit: { value: 0 },
          uVanishZ: { value: -26 },
          uFringe: { value: 0.9 },
          uCurvature: { value: 1 },
        },
      }),
    [wave],
  );

  useEffect(() => {
    const handle: TensionHandle = {
      step(renderer, elapsed, freeze = false) {
        wave.step(renderer, elapsed, freeze);
        const u = material.uniforms;
        if (u.uWave) u.uWave.value = wave.texture;
      },
      setLocalTime(t, weight) {
        const u = material.uniforms;
        /*
         * §2: "the thread's tension releases and it begins to travel — the far
         * end accelerates toward the vanishing point, becoming Plate II's
         * beam." The exit occupies the last 18% of the plate's local time, and
         * runs slightly past t=1 into the blend band, which is where the
         * hand-off to Plate II happens (see plateRouter's note on t).
         */
        const exit = Math.min(1, Math.max(0, (t - 0.82) / 0.3));
        if (u.uExit) u.uExit.value = exit;
        // Curvature drives the spectral fringe (§2: "where the curve is
        // tightest, the light fringes into spectrum"). It falls as the thread
        // straightens, so the fringe goes with the curve rather than lingering.
        if (u.uCurvature) u.uCurvature.value = 1 - exit * 0.8;
        if (meshRef.current) meshRef.current.visible = weight > 0.001;
      },
      setPointer(x, y, pressure) {
        /*
         * Pointer position, viewport-normalised, mapped into thread space.
         * `along` is the x position clamped to the span; `offset` is how far
         * the pointer is from where the thread rests, in world units, so
         * grabbing displaces the thread *to* the pointer rather than by a
         * fixed amount.
         */
        const along = Math.min(1, Math.max(0, x));
        const world = (y - 0.5) * 3.6;
        wave.setGrab(along, world, pressure);
      },
      dispose() {
        wave.dispose();
        geometry.dispose();
        material.dispose();
      },
    };

    setTensionPlate(handle);
    return () => {
      setTensionPlate(null);
      handle.dispose();
    };
  }, [wave, material, geometry]);

  useEffect(() => {
    resolution.set(size.width * gl.getPixelRatio(), size.height * gl.getPixelRatio());
  }, [gl, size.width, size.height]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      // Behind the DOM type in Z is a compositing question, not a scene one:
      // §2 says "the headline sits behind the thread in Z, so the filament
      // crosses the type", and the canvas is behind the document layer. The
      // crossing is achieved in L4 by lifting the display type's blend mode,
      // not by moving this mesh.
      renderOrder={0}
    />
  );
}
