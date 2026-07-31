import type { TouchField } from './touch';
import type { TierController } from '../perf/controller';
import type { TensionHandle } from '../plates/tension/Tension';
import type { DispersionHandle } from '../plates/dispersion/Dispersion';

/**
 * Handles on the shared GPU primitives, for consumers outside the React tree.
 *
 * The touch field is created inside the Canvas (it needs the renderer) but the
 * debug view that inspects it lives in the DOM layer outside. Threading a
 * WebGLRenderTarget out through React context would re-render the tree whenever
 * it changed identity, and §5.2 is explicit that per-frame data does not travel
 * through React.
 *
 * This is deliberately tiny and deliberately not a general service locator:
 * one setter per shared primitive, set on mount and cleared on unmount.
 */

let touchField: TouchField | null = null;

export function setTouchField(field: TouchField | null): void {
  touchField = field;
}

export function getTouchField(): TouchField | null {
  return touchField;
}

let tierController: TierController | null = null;

export function setTierController(controller: TierController | null): void {
  tierController = controller;
}

export function getTierController(): TierController | null {
  return tierController;
}

let tensionPlate: TensionHandle | null = null;

/**
 * Plate I's handle. Plates register here rather than registering a `useFrame`
 * of their own — there is exactly one in the application (ADR-0001), and the
 * router decides which plates it calls each frame.
 */
export function setTensionPlate(handle: TensionHandle | null): void {
  tensionPlate = handle;
}

export function getTensionPlate(): TensionHandle | null {
  return tensionPlate;
}

let dispersionPlate: DispersionHandle | null = null;

export function setDispersionPlate(handle: DispersionHandle | null): void {
  dispersionPlate = handle;
}

export function getDispersionPlate(): DispersionHandle | null {
  return dispersionPlate;
}
