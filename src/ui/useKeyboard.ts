import { useEffect } from 'react';
import { appStore } from '../state/store';

/**
 * Global keyboard controls (§6.1, §6.2).
 *
 *   S   toggle Specimen Mode — the reduced-motion rendering path, available to
 *       everyone and not only to people whose OS reports the preference (§6.2).
 *   D   toggle the debug overlay.
 *
 * Arrow-key scroll nudging and Esc-to-exit plate interactions are §6.1 and land
 * with the interactions they exit, in L2–L4.
 *
 * Keys are ignored while a text input or a contenteditable has focus, and when
 * a modifier is held, so nothing here shadows a browser shortcut.
 */
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

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
