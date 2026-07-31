/**
 * Copies the latin-subset variable .woff2 files out of the Fontsource packages
 * and into public/fonts, so the bytes the site serves are checked into the
 * repository and can be audited, rather than being resolved at build time from
 * whatever the lockfile happens to point at.
 *
 * Run after changing a font dependency:  pnpm fonts:sync
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'fonts');

/** [package, file] — latin subset only; see the note in src/styles/fonts.css. */
const FACES = [
  ['@fontsource-variable/bodoni-moda', 'bodoni-moda-latin-standard-normal.woff2'],
  ['@fontsource-variable/geist', 'geist-latin-wght-normal.woff2'],
  ['@fontsource-variable/geist-mono', 'geist-mono-latin-wght-normal.woff2'],
];

await mkdir(out, { recursive: true });

let total = 0;
for (const [pkg, file] of FACES) {
  const src = join(root, 'node_modules', pkg, 'files', file);
  const dst = join(out, file);
  await copyFile(src, dst);
  const { size } = await stat(dst);
  total += size;
  console.log(`${file.padEnd(46)} ${(size / 1024).toFixed(1).padStart(7)} KB`);
}
console.log(`${'total'.padEnd(46)} ${(total / 1024).toFixed(1).padStart(7)} KB`);
