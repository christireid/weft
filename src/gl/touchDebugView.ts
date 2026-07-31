import { ShaderMaterial, Vector2, type Texture, type WebGLRenderer } from 'three';
import { FULLSCREEN_VERT, renderFullscreenInset } from './fullscreen';
import touchDebugFrag from '../shaders/passes/touchDebug.frag.glsl';

/**
 * Debug view for the shared pointer field (§7 L1 task 3).
 *
 * Insets the field's four channels into the bottom-left of the frame when the
 * HUD is on. Created lazily on first use so nothing is allocated for a
 * visitor who never presses D — and the material is disposed with the field.
 */

const SIDE_FRACTION = 0.18;
const MARGIN_PX = 24;

let material: ShaderMaterial | null = null;

function ensure(): ShaderMaterial {
  material ??= new ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: touchDebugFrag,
    depthTest: false,
    depthWrite: false,
    uniforms: { uField: { value: null } },
  });
  return material;
}

/** Scratch for the renderer size. Module scope (§5.2). */
const sizeScratch = new Vector2();

export function drawTouchDebug(gl: WebGLRenderer, texture: Texture): void {
  // CSS pixels throughout — see the note on renderFullscreenInset.
  gl.getSize(sizeScratch);
  const side = Math.round(Math.min(sizeScratch.x, sizeScratch.y) * SIDE_FRACTION);

  const mat = ensure();
  if (mat.uniforms.uField) mat.uniforms.uField.value = texture;

  renderFullscreenInset(gl, mat, MARGIN_PX, MARGIN_PX, side, side);
}

export function disposeTouchDebug(): void {
  material?.dispose();
  material = null;
}
