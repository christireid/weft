import { Canvas } from '@react-three/fiber';
import {
  ACESFilmicToneMapping,
  Color,
  ColorManagement,
  SRGBColorSpace,
  type WebGLRenderer,
} from 'three';
import { VOID_HEX } from '../config/identity';
import { FrameLoop } from './FrameLoop';

/*
 * Colour management is set once, here, and never touched again.
 *
 *   working space  linear-sRGB   (ColorManagement.enabled — all Color and
 *                                 material inputs are converted on assignment)
 *   tone map       ACES Filmic   (so the spectral accumulation in Plate II has
 *                                 somewhere to put values above 1.0 instead of
 *                                 clipping to white)
 *   output         sRGB
 *
 * The clear colour is the one thing tone mapping does not touch: three writes
 * it straight to the framebuffer, converting linear→sRGB but not tone mapping,
 * so #050507 in this file is #050507 in the captured PNG. That exactness is
 * asserted in tools/capture.spec.ts rather than trusted.
 */
ColorManagement.enabled = true;

const clearColor = new Color(VOID_HEX);

function configure(gl: WebGLRenderer): void {
  gl.outputColorSpace = SRGBColorSpace;
  gl.toneMapping = ACESFilmicToneMapping;
  gl.toneMappingExposure = 1;
  gl.setClearColor(clearColor, 1);
}

export function Stage() {
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
      </Canvas>
    </div>
  );
}
