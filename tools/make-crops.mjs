/**
 * `node tools/make-crops.mjs`
 *
 * Cut 1:1 detail crops out of the full-resolution stills.
 *
 * WHY THESE EXIST
 *
 * The stills in the README are 2880×1800 screenshots displayed at whatever
 * width a reader's browser gives them, which is to say downscaled three or four
 * times. Everything this piece is actually about survives that badly: the
 * spectral wings on the filament are two pixels wide, the dither is a per-pixel
 * pattern, and the particle streaks are oriented capsules a few pixels long.
 * Downscaled, all three average away into a smooth glow — the reader sees a
 * nice image and none of the evidence.
 *
 * A crop at 1:1 is the only honest way to show them, and it is also the harder
 * test: an effect that only reads at a third scale is not an effect, it is a
 * blur. Plate III's colour was caught this way — at a third scale it looked
 * like fine spectral speckle and passed, and at 1:1 it was RGB confetti (D-024).
 *
 * Coordinates are in device pixels of the source still, top-left origin, and
 * they are hand-chosen. They are not derived from anything, so a still whose
 * composition changes will need them re-chosen; the script prints the mean
 * level of each crop so a crop that has fallen off its subject and landed on
 * empty void is obvious in the log rather than in the README.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const MEDIA = join(process.cwd(), 'docs', 'media');
const OUT = join(MEDIA, 'detail');

/**
 * Width the stills are captured at, before the halving at the end of this file.
 *
 * Both phases check it, and that is deliberate: running this script twice in a
 * row would otherwise cut the "1:1" crops out of already-halved stills at
 * coordinates meant for the full-resolution ones. The crops would come back
 * from the wrong part of the image at half the magnification, and they would
 * still look like plausible crops. Refusing is the only safe answer.
 */
const FULL_WIDTH = 2880;

/** [source, x, y, width, height, name, caption-for-the-log] */
const CROPS = [
  ['still-plate-01.png', 980, 640, 620, 380, 'detail-filament', 'the filament core and its wings'],
  ['still-plate-02.png', 1180, 700, 620, 380, 'detail-prism', 'white in, spectrum out'],
  ['still-plate-03.png', 1640, 720, 620, 380, 'detail-particles', 'velocity-stretched streaks'],
  ['still-plate-03-lattice.png', 1180, 720, 620, 380, 'detail-lattice', 'the warp and the weft'],
  ['still-masthead.png', 180, 660, 620, 380, 'detail-type', 'the thread crossing the wordmark'],
  ['still-masthead.png', 2100, 1300, 480, 300, 'detail-dither', 'the halftone in the void'],
];

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

for (const [source, x, y, w, h, name, caption] of CROPS) {
  const path = join(MEDIA, source);
  if (!existsSync(path)) {
    console.log(`${name}: ${source} missing, skipping`);
    continue;
  }
  const png = PNG.sync.read(readFileSync(path));
  if (png.width !== FULL_WIDTH) {
    console.log(
      `${name}: ${source} is ${String(png.width)} px wide, not ${String(FULL_WIDTH)} — ` +
        `it has already been halved. Re-run \`pnpm media\` before cropping.`,
    );
    continue;
  }

  const cw = Math.min(w, png.width - x);
  const ch = Math.min(h, png.height - y);
  if (cw <= 0 || ch <= 0) {
    console.log(`${name}: crop lies outside ${source} (${png.width}x${png.height})`);
    continue;
  }

  const out = new PNG({ width: cw, height: ch });
  let sum = 0;
  let peak = 0;
  for (let row = 0; row < ch; row++) {
    for (let col = 0; col < cw; col++) {
      const from = ((y + row) * png.width + (x + col)) * 4;
      const to = (row * cw + col) * 4;
      out.data[to] = png.data[from];
      out.data[to + 1] = png.data[from + 1];
      out.data[to + 2] = png.data[from + 2];
      out.data[to + 3] = 255;
      const level = Math.max(png.data[from], png.data[from + 1], png.data[from + 2]);
      sum += level;
      if (level > peak) peak = level;
    }
  }

  writeFileSync(join(OUT, `${name}.png`), PNG.sync.write(out));
  const mean = sum / (cw * ch);
  console.log(
    `${name.padEnd(18)} ${String(cw)}x${String(ch)}  mean ${mean.toFixed(1)}  peak ${String(peak)}  ${caption}`,
  );
}

/* ---- and then halve the full-frame stills ------------------------------- *
 *
 * The stills are captured at 2880×1800 because the crops above are cut from
 * them at 1:1, and a crop is only worth taking from a source that has the
 * detail in it. But a README displays them at perhaps 900 px wide, so shipping
 * them at full resolution costs a reader forty megabytes to see images their
 * browser is about to throw four fifths of away.
 *
 * Halving happens *here*, after the crops, and that ordering is the whole
 * reason it lives in this file rather than in its own: a downscale that ran
 * first would silently turn every 1:1 crop into a 2:1 one, and the result would
 * still look like a crop.
 *
 * A box filter rather than anything cleverer. At exactly 2:1 a box filter is an
 * average of four pixels, which is what a correct downsample by two *is*; the
 * sharpening a Lanczos kernel would add is only meaningful at non-integer
 * ratios.
 */
for (const entry of readdirSync(MEDIA)) {
  if (!entry.endsWith('.png')) continue;
  const path = join(MEDIA, entry);
  if (!statSync(path).isFile()) continue;

  const png = PNG.sync.read(readFileSync(path));
  if (png.width !== FULL_WIDTH) continue;

  const w = png.width >> 1;
  const h = png.height >> 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((y * 2 + dy) * png.width + (x * 2 + dx)) * 4;
          r += png.data[i];
          g += png.data[i + 1];
          b += png.data[i + 2];
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = Math.round(r / 4);
      out.data[o + 1] = Math.round(g / 4);
      out.data[o + 2] = Math.round(b / 4);
      out.data[o + 3] = 255;
    }
  }

  const before = statSync(path).size;
  writeFileSync(path, PNG.sync.write(out));
  const after = statSync(path).size;
  console.log(
    `${entry.padEnd(30)} ${String(png.width)}x${String(png.height)} -> ${String(w)}x${String(h)}  ` +
      `${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`,
  );
}
