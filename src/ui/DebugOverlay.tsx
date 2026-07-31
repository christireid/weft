import { useEffect, useRef } from 'react';
import { PLATES } from '../config/plates';
import { useAppStore } from '../state/store';
import { clearHud, registerHud } from './debugHud';

/**
 * The L1 debug overlay (§7 L1 task 1).
 *
 * Renders a static shell once and hands its value nodes to the HUD painter,
 * which writes into them from the frame loop. This component re-renders only
 * when `debug` flips.
 *
 * Toggle with `D`. Off by default, and tree-shaken out of production alongside
 * the rest of the dev UI — §10 forbids shipping `leva`, and the same reasoning
 * applies to this.
 */
export function DebugOverlay() {
  const debug = useAppStore((s) => s.debug);
  const progressRef = useRef<HTMLSpanElement>(null);
  const primaryRef = useRef<HTMLSpanElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const tierRef = useRef<HTMLSpanElement>(null);
  const frametimeRef = useRef<HTMLSpanElement>(null);
  const rowRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!debug) return;
    registerHud({
      progress: progressRef.current,
      primary: primaryRef.current,
      active: activeRef.current,
      fps: fpsRef.current,
      tier: tierRef.current,
      frametime: frametimeRef.current,
      rows: rowRefs.current,
    });
    return () => {
      clearHud();
    };
  }, [debug]);

  if (!debug) return null;

  return (
    <aside className="hud annotation" aria-hidden="true">
      <div className="hud__row">
        <span className="hud__key">progress</span>
        <span ref={progressRef} className="hud__val">
          0.000
        </span>
      </div>
      <div className="hud__row">
        <span className="hud__key">primary</span>
        <span ref={primaryRef} className="hud__val">
          —
        </span>
      </div>
      <div className="hud__row">
        <span className="hud__key">live</span>
        <span ref={activeRef} className="hud__val">
          0
        </span>
      </div>
      <div className="hud__row">
        <span className="hud__key">fps</span>
        <span ref={fpsRef} className="hud__val">
          —
        </span>
      </div>

      <div className="hud__row">
        <span className="hud__key">tier</span>
        <span ref={tierRef} className="hud__val" data-active="true">
          —
        </span>
      </div>
      <div className="hud__row">
        <span className="hud__key">frame ms</span>
        <span ref={frametimeRef} className="hud__val" data-active="true">
          —
        </span>
      </div>

      <hr className="hud__rule" />

      {PLATES.map((plate, i) => (
        <div key={plate.id} className="hud__row">
          <span className="hud__key">
            {plate.numeral} {plate.label}
          </span>
          <span
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            className="hud__val"
            data-active="false"
          >
            —
          </span>
        </div>
      ))}
    </aside>
  );
}
