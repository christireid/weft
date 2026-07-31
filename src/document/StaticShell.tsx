import { Document } from './Document';

/**
 * Exactly what the build-time prerender emits, and exactly what React's first
 * client render must produce.
 *
 * Hydration compares the whole container, not just the part you thought about.
 * The first version prerendered `<Document>` alone while the client tree was
 * `[Stage, DebugOverlay, skip link, Document]` — React logged a hydration
 * mismatch (#418) and threw the server markup away, which quietly undid the
 * prerender it was meant to preserve.
 *
 * So this component is the contract: the shell is everything that exists before
 * JavaScript, in the order it exists, and the renderer is appended after mount.
 * If you add markup that should be crawlable, it goes here.
 */
export function StaticShell() {
  return (
    <>
      <a className="skip" href="#catalogue">
        Skip to the catalogue
      </a>
      <Document />
    </>
  );
}
