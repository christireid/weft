import { useEffect } from 'react';
import { appStore } from '../state/store';
import { PLATES } from '../config/plates';
import { nudgeScroll } from '../scroll/scroll';

/**
 * Global keyboard controls (§6.1, §6.2).
 *
 *   S            toggle Specimen Mode — the reduced-motion rendering path,
 *                available to everyone and not only to people whose OS reports
 *                the preference (§6.2).
 *   D            toggle the debug overlay.
 *   ↑ ↓          nudge scroll by a third of a viewport.
 *   PgUp PgDn    a full viewport.
 *   Home End     the first and last plate.
 *   Esc          release the current plate and return focus to the document.
 *
 * §6.1 requires Tab to move between plates. That is done in App.tsx, by giving
 * each section `tabIndex={-1}` and the skip link a real target — a section is
 * not focusable by default, and without it the entire 700vh document has no tab
 * stops and a keyboard user cannot move through the catalogue at all.
 *
 * Keys are ignored while a text input or a contenteditable has focus, and when
 * a modifier is held, so nothing here shadows a browser shortcut.
 */
/** Ids of the plate sections, for Home/End and for the skip link's target. */
export const PLATE_SECTION_IDS = PLATES.map((p) => `plate-${p.numeral.toLowerCase()}`);

export function useKeyboard(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }

      const step = window.innerHeight;

      function nudge(amount: number): void {
        event.preventDefault();
        /*
         * Through Lenis, not `window.scrollBy`. Lenis writes its own animated
         * position to the window every frame, so a native scroll is overwritten
         * before it is painted — this handler existed and did nothing until the
         * a11y test measured scrollY before and after and found it unchanged.
         */
        nudgeScroll(amount);
      }

      switch (event.key) {
        case 'ArrowDown':
          nudge(step / 3);
          return;
        case 'ArrowUp':
          nudge(-step / 3);
          return;
        case 'PageDown':
          nudge(step);
          return;
        case 'PageUp':
          nudge(-step);
          return;
        case 'Home':
          nudge(-document.documentElement.scrollHeight);
          return;
        case 'End':
          nudge(document.documentElement.scrollHeight);
          return;
        case 'Escape': {
          // §6.1: Esc exits any plate-local interaction. With no modal state to
          // leave, what it does is release focus from a plate back to the
          // document, which is what a keyboard user expects it to mean.
          const active = document.activeElement;
          if (active instanceof HTMLElement && active.classList.contains('plate')) {
            active.blur();
          }
          return;
        }
        default:
          break;
      }

      switch (event.key.toLowerCase()) {
        case 's':
          appStore.getState().toggleSpecimenMode();
          break;
        case 'd':
          appStore.getState().toggleDebug();
          break;
        default:
          break;
      }
    }

    // Not passive: the arrow-key handlers call preventDefault so the browser's
    // own scroll does not fight the smoothed one.
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
