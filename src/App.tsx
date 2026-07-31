import { Stage } from './gl/Stage';
import { identity } from './config/identity';
import { PLATES, sectionHeightVh } from './config/plates';
import { DebugOverlay } from './ui/DebugOverlay';
import { useKeyboard } from './ui/useKeyboard';

/*
 * The DOM is the source of truth (§6.1). Everything a visitor can read lives
 * here, in document order, with one h1 and an h2 per plate, and the canvas
 * behind it is inert to the accessibility tree. A screen reader gets the whole
 * catalogue without a single WebGL frame being drawn.
 *
 * Section heights come from the same plate table the renderer's router reads,
 * so the scroll offset at which a plate's type is on screen is by construction
 * the scroll offset at which that plate is simulating. They cannot drift.
 */
export function App() {
  useKeyboard();

  return (
    <>
      <Stage />
      <DebugOverlay />

      <main className="document" id="catalogue">
        <header className="masthead">
          <p className="annotation annotation--leader">
            <span>Specimen series · 2026</span>
          </p>
          <h1 className="display display--xl">{identity.name}</h1>
          <p className="lede">{identity.tagline}</p>
        </header>

        {PLATES.map((plate) => (
          <section
            key={plate.id}
            id={`plate-${plate.numeral.toLowerCase()}`}
            className="plate"
            style={{ minHeight: `${String(sectionHeightVh(plate))}svh` }}
            aria-labelledby={`plate-${plate.numeral.toLowerCase()}-title`}
          >
            <h2 id={`plate-${plate.numeral.toLowerCase()}-title`} className="plate__title">
              <span className="annotation annotation--leader plate__index">
                <span>
                  Plate {plate.numeral} · {plate.label}
                </span>
              </span>
              {plate.subtitle ? (
                <span className="display display--m plate__subtitle">{plate.subtitle}</span>
              ) : null}
            </h2>
          </section>
        ))}
      </main>
    </>
  );
}
