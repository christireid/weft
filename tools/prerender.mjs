/**
 * Build-time prerender of the document layer (§5.1, §6.1).
 *
 * A Vite plugin, used from vite.config.ts. It bundles `src/document/StaticShell.tsx`
 * for Node with esbuild — already a Vite dependency, so no new install — renders
 * it with `renderToStaticMarkup`, and injects the result into `#weft`.
 *
 * WHY THIS IS NOT OPTIONAL
 *
 * §5.1 rejects Next.js on the grounds that "SEO is solved by build-time
 * prerender of the text layer into index.html". That sentence is the entire
 * justification for the framework choice, and until this plugin existed it was
 * not true: the built index.html contained `<div id="weft"></div>` and nothing
 * else. §6.1's promise — "a visitor with a screen reader gets a complete,
 * coherent document without a single WebGL frame" — held only for visitors
 * whose JavaScript ran.
 *
 * React hydrates over the prerendered markup rather than replacing it, so there
 * is one source of truth for the copy: the component. `tests/prerender.test.ts`
 * asserts the injected markup matches what React renders, so the two cannot
 * drift.
 */
import { build } from 'esbuild';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Bundles the Document component for Node and returns its static markup. */
export async function renderDocument(root) {
  /*
   * Inside the project, not in tmpdir. React is left external so the prerender
   * and the browser build share one copy — and an external import only resolves
   * if the bundle sits somewhere Node's lookup can walk up to node_modules
   * from. A file in /tmp cannot.
   */
  const dir = join(root, 'node_modules', '.weft-prerender');
  const outfile = join(dir, 'document.mjs');
  await mkdir(dir, { recursive: true });

  try {
    await build({
      entryPoints: [join(root, 'src/document/StaticShell.tsx')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      jsx: 'automatic',
      // React resolves from the real node_modules; only our own source is
      // bundled, so the component and the browser build share one React.
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      logLevel: 'silent',
    });

    // Cache-bust: the plugin can run more than once in a watch build, and ESM
    // module caching would otherwise pin the first render forever.
    const mod = await import(`${pathToFileURL(outfile).href}?t=${String(Date.now())}`);
    /*
     * renderToString, NOT renderToStaticMarkup.
     *
     * Adjacent text nodes — `Plate {numeral} · {label}` is four of them — need
     * `<!-- -->` separators in the markup so React can tell where one ends and
     * the next begins when it hydrates. renderToStaticMarkup omits them, which
     * produces markup that looks identical and fails hydration with a text
     * mismatch, and React then throws the whole prerender away.
     */
    return renderToString(createElement(mod.StaticShell));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Vite plugin. Injects at build time only — in dev the client render is
 * immediate and a prerender would just be a second source of truth to keep in
 * sync while editing.
 */
export function prerenderPlugin() {
  let root = process.cwd();
  return {
    name: 'weft-prerender',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    async transformIndexHtml(html) {
      const markup = await renderDocument(root);
      if (!html.includes('<div id="weft"></div>')) {
        throw new Error('weft-prerender: mount point #weft not found in index.html');
      }
      return html.replace('<div id="weft"></div>', `<div id="weft">${markup}</div>`);
    },
  };
}

/** Also runnable directly, so the markup can be diffed by hand. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await renderDocument(process.cwd());
  await writeFile(join(process.cwd(), 'docs/verification/prerender.html'), `${out}\n`);
  console.log(`prerendered ${String(out.length)} bytes -> docs/verification/prerender.html`);
}
