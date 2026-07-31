/**
 * `pnpm media:gifs` — PNG sequences → GIFs.
 *
 * WHY NOT FFMPEG
 *
 * §7 L6 specifies the two-pass ffmpeg palette recipe, and that is the right
 * tool. It is not available here: the only ffmpeg in this container ships with
 * Playwright and is built `--disable-everything`, with just enough enabled to
 * write the webm screen recordings Playwright needs. It has no GIF muxer, no
 * `palettegen`/`paletteuse` filters, and no PNG *decoder* — so it can neither
 * read the frame sequence nor write the output. There is no network route to
 * fetch a full build.
 *
 * So the same two-pass idea is implemented directly: quantise across all frames
 * to one shared 256-colour palette, then map every frame through it. `gifenc`
 * supplies the octree quantiser and the LZW encoder; pngjs decodes the frames.
 *
 * WHAT IS PRESERVED FROM THE SPECIFIED RECIPE
 *
 *   one shared palette   Built from a sample of *all* frames rather than
 *                        per-frame, which is what stops the spectrum shifting
 *                        hue between frames — the artefact a per-frame palette
 *                        produces and the reason the recipe is two-pass.
 *
 *   change-weighted      ffmpeg's `stats_mode=diff` weights the palette toward
 *                        pixels that change. Approximated here by sampling more
 *                        densely from pixels that differ from the first frame,
 *                        so the 256 colours are spent on the filament and the
 *                        spectrum rather than on acres of dithered void.
 *
 *   no re-dither         ffmpeg's default error diffusion would fight the
 *                        ordered dither the site already applies in its final
 *                        pass (§3.4) and produce a crawling interference
 *                        pattern. Nearest-colour mapping against a palette
 *                        built from the real pixels keeps the halftone intact.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';

// gifenc publishes CommonJS; named ESM exports are not available.
const { GIFEncoder, quantize, applyPalette } = gifenc;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = join(root, 'docs', 'media');
const FRAMES = join(MEDIA, 'frames');

/** name → [fps, output width, MB budget]. Widths and budgets from §7 L6. */
const SEQUENCES = [
  ['hero', 14, 880, 8],
  ['plate-01', 14, 760, 4],
  ['plate-02', 14, 760, 4],
  // Slower: the fray develops over simulation time rather than over scroll, and
  // at 14 fps the strands move faster than the eye can follow a single one.
  ['plate-03', 10, 760, 5],
];

/** Box-filter downscale. Lanczos would be sharper; at these ratios, on a piece
 *  this dark, the difference is below the GIF's own quantisation. */
function resize(png, targetWidth) {
  const scale = targetWidth / png.width;
  const targetHeight = Math.round(png.height * scale);
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const boxW = png.width / targetWidth;
  const boxH = png.height / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const sy0 = Math.floor(y * boxH);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * boxH));
    for (let x = 0; x < targetWidth; x++) {
      const sx0 = Math.floor(x * boxW);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * boxW));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * png.width + sx) * 4;
          r += png.data[i];
          g += png.data[i + 1];
          b += png.data[i + 2];
          n++;
        }
      }
      const o = (y * targetWidth + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: targetWidth, height: targetHeight };
}

await mkdir(MEDIA, { recursive: true });

let total = 0;
for (const [name, fps, width, budgetMb] of SEQUENCES) {
  const dir = join(FRAMES, name);
  if (!existsSync(dir)) {
    console.log(`${name}: no frames, skipping`);
    continue;
  }

  const files = readdirSync(dir)
    .filter((f) => /^\d+\.png$/.test(f))
    .sort();
  if (files.length === 0) continue;

  const frames = files.map((f) => resize(PNG.sync.read(readFileSync(join(dir, f))), width));

  /* ---- pass 1: one palette, weighted toward what changes --------------- */
  const first = frames[0];
  const sample = [];
  for (const frame of frames) {
    for (let i = 0; i < frame.data.length; i += 4) {
      const changed =
        Math.abs(frame.data[i] - first.data[i]) +
        Math.abs(frame.data[i + 1] - first.data[i + 1]) +
        Math.abs(frame.data[i + 2] - first.data[i + 2]);
      // Every changing pixel, and a thin sample of the static background so the
      // void's own gradient still gets colours allocated to it.
      if (changed > 6 || i % (4 * 97) === 0) {
        sample.push(frame.data[i], frame.data[i + 1], frame.data[i + 2], 255);
      }
    }
  }
  const palette = quantize(new Uint8ClampedArray(sample), 256, { format: 'rgb565' });

  /* ---- pass 2: map every frame through it ------------------------------ */
  const encoder = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (const frame of frames) {
    const indexed = applyPalette(frame.data, palette, 'rgb565');
    encoder.writeFrame(indexed, frame.width, frame.height, { palette, delay });
  }
  encoder.finish();

  const out = join(MEDIA, `${name}.gif`);
  writeFileSync(out, Buffer.from(encoder.bytes()));

  const bytes = statSync(out).size;
  total += bytes;
  const mb = bytes / 1048576;
  console.log(
    `${name}.gif  ${String(frames.length)} frames  ${String(width)}px  ` +
      `${mb.toFixed(2)} MB  ${mb <= budgetMb ? 'ok' : `OVER BUDGET (${String(budgetMb)} MB)`}`,
  );
}

console.log(`total ${(total / 1048576).toFixed(2)} MB`);

// Frame sequences are large and fully reproducible; not committed.
await rm(FRAMES, { recursive: true, force: true });
