import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * Discrete application state.
 *
 * Everything here changes rarely — a device tier switch is hysteretic and needs
 * 90 consecutive frames past a threshold (§5.6), Specimen Mode is a keypress,
 * debug visibility is a keypress. Re-rendering React for these is correct and
 * cheap.
 *
 * Continuous per-frame state does *not* live here. See src/state/frame.ts and
 * ADR-0003.
 */

/** §5.6. Tier 4 is the no-WebGL2 path and is decided once, not sampled. */
export type Tier = 1 | 2 | 3 | 4;

export interface AppState {
  tier: Tier;
  /**
   * §6.2. Reduced motion is a designed state, not a disabled one: Specimen Mode
   * freezes each simulation at its most legible frame and turns the full
   * annotation layer on. Defaults to the user's OS preference and is toggleable
   * by anyone with the S key.
   */
  specimenMode: boolean;
  /** L1 debug overlay. Never visible in production unless explicitly toggled. */
  debug: boolean;

  setTier: (tier: Tier) => void;
  setSpecimenMode: (on: boolean) => void;
  toggleSpecimenMode: () => void;
  toggleDebug: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const appStore = createStore<AppState>()((set) => ({
  tier: 3,
  specimenMode: prefersReducedMotion(),
  debug: false,

  setTier: (tier) => {
    set({ tier });
  },
  setSpecimenMode: (specimenMode) => {
    set({ specimenMode });
  },
  toggleSpecimenMode: () => {
    set((s) => ({ specimenMode: !s.specimenMode }));
  },
  toggleDebug: () => {
    set((s) => ({ debug: !s.debug }));
  },
}));

/** React binding. Only for components that genuinely should re-render. */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
