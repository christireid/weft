import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every image the README points at exists, and is not empty.
 *
 * A broken image in a README is invisible to everyone who wrote it — the file
 * is on their disk — and is the first thing a stranger sees. The media pipeline
 * writes into `docs/media/` from a Playwright run that takes half an hour, so
 * the failure mode is not hypothetical: rename a still, or capture a subset,
 * and the README quietly acquires a row of broken-image icons.
 *
 * Runs in the unit suite rather than in Playwright, because it needs no browser
 * and should fail in the two seconds before a commit rather than in the ten
 * minutes of a browser run.
 */

const ROOT = process.cwd();
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

/** Both syntaxes: `![alt](path)` and `<img src="path">`. */
function referencedPaths(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    if (match[1]) found.add(match[1]);
  }
  for (const match of source.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found].filter((path) => !path.startsWith('http'));
}

const paths = referencedPaths(README);

describe('README media', () => {
  it('references some media at all', () => {
    // Guards the regexes above: if they stopped matching, every test below
    // would pass vacuously on an empty list.
    expect(paths.length).toBeGreaterThan(10);
  });

  it.each(paths)('%s exists and is non-empty', (path) => {
    const full = join(ROOT, path);
    expect(existsSync(full), `${path} is referenced by the README`).toBe(true);
    expect(statSync(full).size, `${path} is not a zero-byte file`).toBeGreaterThan(1024);
  });

  it('every image carries alt text', () => {
    /*
     * §6 is explicit about the site; a README is not the site, but a repository
     * whose own catalogue is unreadable to a screen reader while claiming a
     * Lighthouse accessibility score of 100 is making a claim it does not keep.
     */
    const markdownWithoutAlt = [...README.matchAll(/!\[\s*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    expect(markdownWithoutAlt, 'markdown images with empty alt text').toEqual([]);

    const imgTags = [...README.matchAll(/<img[^>]*>/g)].map((m) => m[0]);
    const withoutAlt = imgTags.filter((tag) => !/\salt="[^"]{10,}"/.test(tag));
    expect(withoutAlt, 'img tags with missing or trivial alt text').toEqual([]);
  });
});
