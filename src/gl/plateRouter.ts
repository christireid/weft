import { BLEND, PLATES, type PlateId } from '../config/plates';

/**
 * The plate router (§7 L1 task 2, §8.2 item 2).
 *
 * A pure function of global scroll progress. Given a progress in [0,1] it
 * decides which plates are live and what each one's local time is. It allocates
 * nothing: the caller owns a `RouterState` created once at boot, and
 * `updateRouter` mutates it in place. That is a hard requirement — this runs
 * inside the single `useFrame` (§5.2).
 *
 * Being pure and allocation-free also makes it exhaustively testable, which is
 * why §8.2 singles it out.
 */

export interface PlateSlot {
  readonly id: PlateId;
  /** Is this plate's simulation stepping this frame? */
  active: boolean;
  /**
   * Local time within the plate.
   *
   * Normally 0→1 across the plate's own scroll range. In the blend band it runs
   * slightly **past** 1 for the outgoing plate and slightly **below** 0 for the
   * incoming one, so each plate keeps authority over its own exit and entrance
   * motion through the hand-off instead of being frozen at its end state while
   * something else fades over it.
   */
  t: number;
  /**
   * Scheduling weight in [0,1]. Across a boundary the two live plates' weights
   * sum to 1.
   *
   * **This is not an opacity.** Cross-fading two frozen end states is precisely
   * the "fade to black" §1.2 forbids. Continuity comes from plate *n* at t=1
   * and plate *n+1* at t=0 being the same geometry in the same place — the
   * thread accelerating toward the vanishing point *is* the beam. The weight
   * exists so the frame budget can be apportioned (which plate gets the full
   * particle count, which gets the reduced one) and so the router can name a
   * primary plate for the annotation layer to read.
   */
  weight: number;
}

export interface RouterState {
  progress: number;
  /** Fixed length, index-aligned with PLATES. Never reallocated. */
  readonly slots: PlateSlot[];
  /** Index into PLATES of the highest-weighted live plate. */
  primary: number;
  activeCount: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function createRouterState(): RouterState {
  return {
    progress: 0,
    slots: PLATES.map((p) => ({ id: p.id, active: false, t: 0, weight: 0 })),
    primary: 0,
    activeCount: 0,
  };
}

export function updateRouter(state: RouterState, progress: number): RouterState {
  const x = Math.min(1, Math.max(0, progress));
  state.progress = x;

  let primary = 0;
  let best = -1;
  let activeCount = 0;

  for (let i = 0; i < PLATES.length; i++) {
    const plate = PLATES[i];
    const slot = state.slots[i];
    if (!plate || !slot) continue;

    const span = plate.end - plate.start;
    // Blend expressed in this plate's local time, so a short plate and a long
    // plate hand off over the same amount of *scroll*, not the same amount of t.
    const blendT = span > 0 ? BLEND / span : 0;

    const raw = span > 0 ? (x - plate.start) / span : 0;
    const live = raw >= -blendT && raw <= 1 + blendT;

    slot.active = live;
    slot.t = Math.min(1 + blendT, Math.max(-blendT, raw));

    if (live) {
      // The first plate has no predecessor and the last has no successor, so
      // neither ramps at the document's own ends — plate I is at full weight
      // from the first pixel.
      const rampIn = plate.start <= 0 ? 1 : smoothstep(plate.start - BLEND, plate.start + BLEND, x);
      const rampOut = plate.end >= 1 ? 1 : 1 - smoothstep(plate.end - BLEND, plate.end + BLEND, x);
      slot.weight = rampIn * rampOut;
      activeCount += 1;
    } else {
      slot.weight = 0;
    }

    if (slot.weight > best) {
      best = slot.weight;
      primary = i;
    }
  }

  state.primary = primary;
  state.activeCount = activeCount;
  return state;
}
