/**
 * `node tools/crop.mjs <png> <x> <y> <w> <h> [scale]`
 *
 * Crops (and optionally nearest-neighbour magnifies) a region of a capture so a
 * detail can be inspected at pixel level. Step 4 of the inner loop is "look at
 * it", and a 2880-wide still shown at 2000px hides exactly the hairline
 * artefacts this project lives or dies on.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { PNG } from 'pngjs';

const [src, xs, ys, ws, hs, ss] = process.argv.slice(2);
if (!src) {
  console.error('usage: node tools/crop.mjs <png> <x> <y> <w> <h> [scale]');
  process.exit(2);
}

const x = Number(xs ?? 0);
const y = Number(ys ?? 0);
const w = Number(ws ?? 400);
const h = Number(hs ?? 300);
const scale = Math.max(1, Math.round(Number(ss ?? 1)));

const png = PNG.sync.read(readFileSync(src));
const out = new PNG({ width: w * scale, height: h * scale });

for (let oy = 0; oy < h * scale; oy++) {
  for (let ox = 0; ox < w * scale; ox++) {
    const sx = Math.min(png.width - 1, Math.max(0, x + Math.floor(ox / scale)));
    const sy = Math.min(png.height - 1, Math.max(0, y + Math.floor(oy / scale)));
    const si = (sy * png.width + sx) * 4;
    const di = (oy * out.width + ox) * 4;
    out.data[di] = png.data[si];
    out.data[di + 1] = png.data[si + 1];
    out.data[di + 2] = png.data[si + 2];
    out.data[di + 3] = png.data[si + 3];
  }
}

const dst = join(dirname(src), `crop-${basename(src, '.png')}-${x}x${y}.png`);
writeFileSync(dst, PNG.sync.write(out));
console.log(dst);
