import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { ShaderMaterial, Vector2, type Texture, type WebGLRenderer } from 'three';
import { FULLSCREEN_VERT, renderFullscreen } from '../../gl/fullscreen';
import dispersionFrag from '../../shaders/plates/dispersion.frag.glsl';
import { setDispersionPlate } from '../../gl/registry';
import { appStore } from '../../state/store';
import { TIER_PROFILES } from '../../perf/tier';

/**
 * PLATE II · DISPERSIO — the prism (§2).
 *
 * Rendered as a fullscreen pass into the scene buffer rather than as geometry.
 * The plate is a light-transport problem, not a shape one: every wavelength has
 * to be evaluated at every fragment the beam touches. Over a triangle mesh that
 * would be sixteen draws or a sixteen-wide varying; over a fullscreen pass it
 * is one loop.
 *
 * The wedge is drag-controlled (§2). There is no slider — §5.1's dev UI is
 * tree-shaken out of production and §10 forbids adding chrome. The visitor
 * discovers it because the glass responds to the pointer before it is grabbed.
 */

const resolution = new Vector2();

/**
 * Apex angle of the prism.
 *
 * Wide enough that the fan separates visibly at this scale, narrow enough that
 * the thin-prism deviation formula stays accurate — beyond about 0.7 rad the
 * approximation starts to understate the deviation at the blue end and the fan
 * compresses in a way that is subtly wrong.
 */
const APEX = 0.62;

export interface DispersionHandle {
  render: (gl: WebGLRenderer, elapsed: number, touch: Texture | null) => void;
  setLocalTime: (t: number, weight: number) => void;
  drag: (deltaX: number, pressure: number) => void;
}

export function Dispersion() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: dispersionFrag,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        uniforms: {
          uResolution: { value: resolution },
          uTouch: { value: null },
          uTime: { value: 0 },
          uLocalT: { value: 0 },
          uWeight: { value: 0 },
          uWedgeAngle: { value: 0.35 },
          uApex: { value: APEX },
          uSamples: { value: 16 },
          uEntry: { value: 0 },
          uCoherence: { value: 1 },
        },
      }),
    [],
  );

  useEffect(() => {
    let angle = 0.35;

    const handle: DispersionHandle = {
      render(renderer, elapsed, touch) {
        const u = material.uniforms;
        if (u.uTime) u.uTime.value = elapsed;
        if (u.uTouch) u.uTouch.value = touch;
        if (u.uWedgeAngle) u.uWedgeAngle.value = angle;
        /*
         * §5.6: the sample count follows the device tier. Safe to vary because
         * the accumulation is self-normalising — asserted on the GPU at N = 4
         * through 64 in tools/shaders.spec.ts — so a slow device gets a coarser
         * spectrum rather than a tinted one.
         */
        if (u.uSamples) u.uSamples.value = TIER_PROFILES[appStore.getState().tier].spectralSamples;
        renderFullscreen(renderer, material, renderer.getRenderTarget());
      },
      setLocalTime(t, weight) {
        const u = material.uniforms;
        if (u.uLocalT) u.uLocalT.value = t;
        if (u.uWeight) u.uWeight.value = weight;
        // §2 exit: "the beam's coherence fails. Streaks begin to diverge."
        const exit = Math.min(1, Math.max(0, (t - 0.84) / 0.28));
        if (u.uCoherence) u.uCoherence.value = 1 - exit;
      },
      drag(deltaX, pressure) {
        // A full-viewport drag is a little over a quarter turn — enough to
        // sweep the fan across the whole frame without the glass spinning.
        if (pressure > 0) angle += deltaX * 1.9;
      },
    };

    setDispersionPlate(handle);
    return () => {
      setDispersionPlate(null);
      material.dispose();
    };
  }, [material]);

  useEffect(() => {
    resolution.set(size.width * gl.getPixelRatio(), size.height * gl.getPixelRatio());
  }, [gl, size.width, size.height]);

  // No scene geometry: the plate draws itself from the frame loop.
  return null;
}
