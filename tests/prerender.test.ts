import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { StaticShell } from '../src/document/StaticShell';
import { PLATES } from '../src/config/plates';
import { identity } from '../src/config/identity';

/*
 * §5.1 justifies choosing Vite over Next.js on the grounds that "SEO is solved
 * by build-time prerender of the text layer into index.html", and §6.1 promises
 * a complete document without a single WebGL frame. Both depend on the
 * prerender existing *and* staying in step with the component React renders.
 *
 * These tests guard the second half. The plugin bundles the component for Node
 * and renders it there; if that ever drifts from what React produces in the
 * browser, hydration mismatches and the copy silently forks in two.
 */

const markup = renderToString(createElement(StaticShell));

describe('the prerendered document layer', () => {
  it('contains every plate heading', () => {
    for (const plate of PLATES) {
      expect(markup, `Plate ${plate.numeral} missing`).toContain(plate.label);
      expect(markup).toContain(`plate-${plate.numeral.toLowerCase()}-title`);
    }
  });

  it('contains the masthead copy verbatim from §4.2', () => {
    expect(markup).toContain(identity.name);
    expect(markup).toContain(identity.tagline);
    expect(markup).toContain('A single filament, held under load.');
  });

  it('has one h1 and one h2 per plate, in correct order (§6.1)', () => {
    expect(markup.match(/<h1/g) ?? []).toHaveLength(1);
    expect(markup.match(/<h2/g) ?? []).toHaveLength(PLATES.length);
    // The h1 must precede every h2, or the heading order is wrong for a
    // screen-reader walk regardless of what the tags say.
    expect(markup.indexOf('<h1')).toBeLessThan(markup.indexOf('<h2'));
  });

  it('makes every plate a keyboard stop (§6.1)', () => {
    /*
     * tabindex="0", not "-1". -1 is focusable only programmatically, which
     * looks correct in source and leaves Tab skipping every plate — the exact
     * bug this test was written after finding.
     */
    const stops = markup.match(/tabindex="0"/g) ?? [];
    expect(stops).toHaveLength(PLATES.length);
    expect(markup).not.toContain('tabindex="-1"');
  });

  it('renders without touching any browser API', () => {
    // The whole point: it has already been rendered above, at module scope,
    // under jsdom-free conditions in the plugin. If it needed `window` it would
    // have thrown there. This asserts the output is substantial rather than an
    // empty shell that happened not to throw.
    expect(markup.length).toBeGreaterThan(1200);
  });
});

describe('the built index.html', () => {
  const dist = join(process.cwd(), 'dist', 'index.html');
  let html = '';
  try {
    html = readFileSync(dist, 'utf8');
  } catch {
    html = '';
  }

  it.skipIf(html === '')('ships the prerendered markup, not an empty mount point', () => {
    expect(html, 'index.html still ships an empty div — the prerender did not run').not.toContain(
      '<div id="weft"></div>',
    );
    for (const plate of PLATES) {
      expect(html).toContain(plate.label);
    }
    expect(html).toContain(identity.tagline);
  });

  it.skipIf(html === '')('carries a noscript fallback for a failed or blocked script', () => {
    expect(html).toContain('<noscript>');
  });
});
