import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const host = document.getElementById('weft');
if (!host) throw new Error('WEFT: mount point #weft is missing from index.html');

const tree = (
  <StrictMode>
    <App />
  </StrictMode>
);

/*
 * Hydrate when the build-time prerender is present, mount fresh otherwise.
 *
 * `hydrateRoot` on an empty container throws; `createRoot` over prerendered
 * markup throws it away, which would produce a visible flash of the text
 * disappearing and reappearing. Choosing by what is actually in the container
 * means dev (no prerender) and production (prerendered) both do the right
 * thing without a build-time flag.
 */
if (host.firstElementChild) {
  hydrateRoot(host, tree);
} else {
  createRoot(host).render(tree);
}
