import { identity } from '../config/identity';
import { PLATES, sectionHeightVh } from '../config/plates';

/**
 * The document layer — every word a visitor can read (§6.1).
 *
 * Extracted from `App` so it can be rendered **twice**: once by React in the
 * browser, and once by `renderToStaticMarkup` at build time, injected into
 * `index.html` by the prerender plugin in `vite.config.ts`.
 *
 * §5.1: "SEO is solved by build-time prerender of the text layer into
 * index.html." §6.1: "All text lives in real, selectable, crawlable DOM." Both
 * were untrue before this file existed — the built `index.html` shipped
 * `<div id="weft"></div>` and nothing else, so a crawler, a reader-mode
 * extractor, or anyone whose JS chunk failed on a bad connection got a blank
 * page. That is the promise in §6.1 failing in exactly the case it was written
 * for.
 *
 * The component takes no props and reads no browser API, which is what makes it
 * safe to render on the server. Keep it that way: anything that needs `window`
 * belongs in `App`, around this, not inside it.
 */
export function Document() {
  return (
    <main className="document" id="catalogue">
      <header className="masthead">
        <p className="annotation annotation--leader">
          <span>Specimen series · 2026</span>
        </p>
        <h1 className="display display--xl">{identity.name}</h1>
        <p className="lede">{identity.tagline}</p>
      </header>

      {PLATES.map((plate) => {
        const id = `plate-${plate.numeral.toLowerCase()}`;
        return (
          <section
            key={plate.id}
            id={id}
            className="plate"
            style={{ minHeight: `${String(sectionHeightVh(plate))}svh` }}
            aria-labelledby={`${id}-title`}
            /*
             * §6.1: "Tab moves between plates and focuses them (visible focus
             * ring, 2px, --ink-100)."
             *
             * tabIndex 0, not -1. A section is not focusable at all by default;
             * -1 makes it focusable only programmatically, which reads as fixed
             * and leaves Tab skipping straight past every plate. 0 puts it in
             * the tab order, which is what the clause asks for.
             */
            tabIndex={0}
          >
            <h2 id={`${id}-title`} className="plate__title">
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
        );
      })}
    </main>
  );
}
