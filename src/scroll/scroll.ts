import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Scroll ownership (§5.1, §5.2).
 *
 * There is one scroll subscription in the application and this module owns it.
 *
 * The single-loop rule makes the wiring here non-obvious, so it is spelled out:
 *
 *   - Lenis is constructed with `autoRaf: false`. Left at its default it starts
 *     its own `requestAnimationFrame` loop, which would be a second loop.
 *   - GSAP's ticker is *not* used to drive Lenis either — that is the recipe
 *     every Lenis+GSAP article gives, and it is a second loop for the same
 *     reason.
 *   - Instead `step()` is called from the one `useFrame` in src/gl/FrameLoop.tsx,
 *     which is r3f's rAF. One loop, and scroll is advanced *before* the plate
 *     router reads it, so a frame renders the scroll position it was drawn for
 *     rather than the previous one's.
 *   - `lagSmoothing(0)` stops GSAP from silently rescaling time after a long
 *     frame. Scroll-scrubbed motion has no duration to rescale (§5.5), and a
 *     lag-smoothed tick would desynchronise ScrollTrigger from Lenis's position.
 *
 * ScrollTrigger is registered and fed here rather than in L4 because retrofitting
 * a second scroll authority later is how pinning ends up fighting smoothing.
 * Nothing subscribes to it yet.
 */

let lenis: Lenis | null = null;
let registered = false;

export interface ScrollReading {
  progress: number;
  velocity: number;
  direction: -1 | 0 | 1;
}

export function initScroll(): Lenis {
  if (lenis) return lenis;

  if (!registered) {
    gsap.registerPlugin(ScrollTrigger);
    gsap.ticker.lagSmoothing(0);
    registered = true;
  }

  lenis = new Lenis({
    autoRaf: false,
    // 0.09 was chosen by scrolling it, not by copying a default. Lower reads as
    // sludge and makes the thread feel like it is dragging behind the cursor;
    // higher loses the weight that makes a 700vh document feel like one
    // continuous movement rather than six jumps.
    lerp: 0.09,
    wheelMultiplier: 1,
    smoothWheel: true,
    // Touch is left unsmoothed. Smoothing a native touch scroll fights the
    // platform's own inertia and is the single most common way a site like this
    // feels broken on a phone.
    syncTouch: false,
    autoResize: true,
  });

  lenis.on('scroll', () => {
    ScrollTrigger.update();
  });

  return lenis;
}

/** Advance the smoothing. Called once per frame, from the one frame loop. */
export function stepScroll(timeMs: number): void {
  lenis?.raf(timeMs);
}

/**
 * Read the current position into a caller-owned object.
 * Takes an out-parameter so the read costs no allocation (§5.2).
 */
export function readScroll(out: ScrollReading): ScrollReading {
  if (!lenis) {
    out.progress = 0;
    out.velocity = 0;
    out.direction = 0;
    return out;
  }
  // Lenis reports NaN progress before the first resize on a non-scrollable
  // document; the void page at L0 was exactly that case.
  const p = lenis.progress;
  out.progress = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  out.velocity = lenis.velocity;
  out.direction = lenis.direction;
  return out;
}

/**
 * Move the document by `delta` pixels, through Lenis.
 *
 * Not `window.scrollBy`. Lenis writes its own animated position to the window
 * every frame, so a native scroll is overwritten before it is ever painted —
 * which is why the keyboard nudge in §6.1 silently did nothing until this
 * existed. Routing through Lenis also keeps the single-scroll-authority rule in
 * §5.2 intact rather than introducing a competing one.
 *
 * Falls back to the native call when Lenis has not initialised, so the keyboard
 * still works on the no-WebGL path where the renderer never mounts.
 */
export function nudgeScroll(delta: number): void {
  if (lenis) {
    lenis.scrollTo(lenis.actualScroll + delta, { duration: 0.6 });
    return;
  }
  window.scrollBy({ top: delta, behavior: 'smooth' });
}

export function destroyScroll(): void {
  lenis?.destroy();
  lenis = null;
  ScrollTrigger.getAll().forEach((t) => {
    t.kill();
  });
}

/** Exposed for the debug overlay and for tests. Do not use for per-frame reads. */
export function getLenis(): Lenis | null {
  return lenis;
}
