import { Stage } from './gl/Stage';
import { identity } from './config/identity';

/*
 * The DOM is the source of truth (§6.1). Everything a visitor can read lives
 * here, in document order, and the canvas behind it is inert to the
 * accessibility tree. A screen reader gets the whole catalogue without a
 * single WebGL frame being drawn.
 */
export function App() {
  return (
    <>
      <Stage />
      <main className="document" id="catalogue">
        <header className="masthead">
          <p className="annotation annotation--leader">
            <span>Specimen series · 2026</span>
          </p>
          <h1 className="display display--xl">{identity.name}</h1>
          <p className="lede">{identity.tagline}</p>
        </header>
      </main>
    </>
  );
}
