import { Canvas } from '@react-three/fiber';
import {
  Color,
  ColorManagement,
  LinearSRGBColorSpace,
  NoToneMapping,
  type WebGLRenderer,
} from 'three';
import { FrameLoop } from './FrameLoop';
import { Tension } from '../plates/tension/Tension';
import { Dispersion } from '../plates/dispersion/Dispersion';
import { Turbulence } from '../plates/turbulence/Turbulence';
import { hasWebGL2 } from './capability';
import { appStore } from '../state/store';

/*
 * Colour management is set once, here, and never touched again.
 *
 *   working space  linear-sRGB   (ColorManagement.enabled — all Color and
 *                                 material inputs are converted on assignment)
 *   scene pass     linear, half-float — nothing is tone mapped or encoded here
 *   composite      ACES → sRGB → dither → quantise (src/gl/composite.ts)
 *
 * The renderer's own tone mapping and output encoding are switched off so the
 * scene can accumulate spectral energy above 1.0 (§2 Plate III) and reach the
 * tone mapper intact. Doing it twice crushes exactly the darks §3.4's dither
 * exists to protect.
 *
 * The clear colour survives that intact: three converts it linear→sRGB on the
 * way to the framebuffer and the composite pass round-trips it, so #050507 in
 * this file is #050507 in the captured PNG. Asserted in tools/capture.spec.ts
 * rather than trusted.
 */
ColorManagement.enabled = true;

/*
 * Black, not --void. The scene buffer holds *light*; the void is applied by the
 * composite pass after tone mapping, because ACES compresses the bottom of the
 * range and would turn #050507 into rgb(1.5, 1.5, 1.8). See composite.frag.glsl.
 */
const clearColor = new Color(0x000000);

function configure(gl: WebGLRenderer): void {
  /*
   * Both tone mapping and the sRGB encode are OFF here, and that is deliberate.
   *
   * The scene renders into a half-float HDR buffer and the composite pass
   * (src/gl/composite.ts) owns tone mapping, the encode and the dither, in that
   * order. Leaving them on would encode twice — once into the HDR buffer and
   * once on the way out — which crushes the darks the dither pass exists to
   * protect, and would tone map before the spectral accumulation had finished.
   */
  gl.outputColorSpace = LinearSRGBColorSpace;
  gl.toneMapping = NoToneMapping;
  gl.toneMappingExposure = 1;
  gl.setClearColor(clearColor, 1);
}

export function Stage() {
  /*
   * The capability check lives in App, which is what decides whether to load
   * this module at all — r3f throws during construction on a context it cannot
   * create, and that would take the DOM text layer down with it. This guard
   * stays as a second line of defence for anyone importing Stage directly.
   */
  if (!hasWebGL2()) {
    if (appStore.getState().tier !== 4) appStore.getState().setTier(4);
    return null;
  }

  return (
    <div className="stage" aria-hidden="true" data-stage>
      <Canvas
        // DPR is clamped at 2: past that the dither pass in §3.4 stops being a
        // visible texture and starts being noise nobody can see, at 2.25x cost.
        dpr={[1, 2]}
        gl={{
          antialias: false,
          alpha: false,
          stencil: false,
          depth: true,
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl }) => {
          configure(gl);
        }}
        camera={{ fov: 35, near: 0.1, far: 100, position: [0, 0, 6] }}
        frameloop="always"
      >
        <FrameLoop />
        <Tension />
        <Dispersion />
        <Turbulence />
      </Canvas>
    </div>
  );
}
