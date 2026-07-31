import type { TouchField } from './touch';

/**
 * Raw pointer state, in normalised viewport coordinates with y up.
 *
 * The shared touch field (ADR-0002) is the right input for anything that wants
 * *influence over space and time* — a repulsor, a wake, a collider. A plate
 * that needs the bare coordinate (Plate I asks "which station of the thread is
 * being held") would have to read it back off a texture to get it, which is a
 * GPU→CPU round trip for two floats.
 *
 * So both exist, written from the same handlers in the same frame. Module
 * scope and mutated in place, never replaced (§5.2).
 */
export const pointerState = {
  x: 0.5,
  y: 0.5,
  pressure: 0,
  present: 0,
};

/**
 * Pointer input for the shared touch field (§5.3).
 *
 * Listeners are attached to `window`, not to the canvas, for two reasons that
 * both matter: the canvas is `pointer-events: none` so the DOM text over it
 * stays selectable (§6.1), and a drag that leaves the canvas should keep
 * driving the field rather than stopping at the edge.
 *
 * Handlers write scalars into the field and return. No allocation, no work
 * proportional to event rate — a pointermove burst at 1000 Hz on a high-polling
 * mouse costs six assignments each.
 *
 * §10 forbids a custom cursor that hides the system one, so nothing here
 * touches cursor styling.
 */
export function attachPointer(field: TouchField): () => void {
  let pressure = 0;

  function toField(event: PointerEvent, present: boolean): void {
    // Normalised, y up — matching GL convention so the shader does not have to
    // remember which way round the field is.
    const x = event.clientX / window.innerWidth;
    const y = 1 - event.clientY / window.innerHeight;
    pointerState.x = x;
    pointerState.y = y;
    pointerState.pressure = pressure;
    pointerState.present = present ? 1 : 0;
    field.setPointer(x, y, pressure, present);
  }

  function onMove(event: PointerEvent): void {
    toField(event, true);
  }

  function onDown(event: PointerEvent): void {
    pressure = 1;
    toField(event, true);
  }

  function onUp(event: PointerEvent): void {
    pressure = 0;
    toField(event, true);
  }

  function onLeave(): void {
    pressure = 0;
    pointerState.pressure = 0;
    pointerState.present = 0;
    field.clearPointer();
  }

  // passive: the field never calls preventDefault, and saying so lets the
  // browser keep scrolling off the main thread.
  const passive = { passive: true } as const;
  window.addEventListener('pointermove', onMove, passive);
  window.addEventListener('pointerdown', onDown, passive);
  window.addEventListener('pointerup', onUp, passive);
  window.addEventListener('pointercancel', onLeave, passive);
  window.addEventListener('pointerleave', onLeave, passive);
  window.addEventListener('blur', onLeave);

  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onLeave);
    window.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
  };
}
