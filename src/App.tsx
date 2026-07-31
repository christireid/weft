import { Suspense, lazy, useSyncExternalStore } from 'react';
import { hasWebGL2 } from './gl/capability';
import { StaticShell } from './document/StaticShell';
import { DebugOverlay } from './ui/DebugOverlay';
import { useKeyboard } from './ui/useKeyboard';

/*
 * The renderer is loaded lazily, and only when it can run.
 *
 * `three` is 190 KB gzipped — over half the bundle. A visitor without WebGL2
 * (§5.6 tier 4) can never render a frame, and was downloading all of it anyway
 * before paying to parse it. On 4G that is seconds spent on code that will not
 * execute, ahead of the text layer they actually came for.
 *
 * Splitting it behind `hasWebGL2()` also means the document layer paints from
 * the prerendered markup without waiting on the renderer chunk at all.
 */
const Stage = lazy(async () => {
  const mod = await import('./gl/Stage');
  return { default: mod.Stage };
});

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

  /*
   * The renderer mounts after hydration, never during it.
   *
   * React's first client render has to match the prerendered markup exactly or
   * it discards the server HTML — which would undo the whole point of the
   * prerender. `mounted` guarantees the first pass is the shell and nothing
   * else; the canvas is appended on the next tick.
   *
   * `useSyncExternalStore` rather than `useState` + `useEffect`: it is the hook
   * built for exactly this — a value that differs between the server snapshot
   * and the client — and it avoids the cascading render that setting state
   * inside an effect causes.
   */
  const mounted = useSyncExternalStore(
    // Never changes after the first client render, so it needs no subscription.
    () => () => undefined,
    () => true, // client
    () => false, // server / hydration pass
  );

  return (
    <>
      <StaticShell />
      {mounted && hasWebGL2() ? (
        <Suspense fallback={null}>
          <Stage />
        </Suspense>
      ) : null}
      {mounted ? <DebugOverlay /> : null}
    </>
  );
}
