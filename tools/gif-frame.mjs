/**
 * `node tools/gif-frame.mjs <gif> <index> [out.png]`
 *
 * Extract one frame of a GIF as a PNG, so a GIF can be *looked at* rather than
 * inferred from its file size.
 *
 * WHY THIS EXISTS
 *
 * §0.2's inner loop says to open the captured output and look at it, and the
 * GIFs are the artifact a reader of the README actually sees. But
 * `tools/make-gifs.mjs` deletes its PNG source frames after encoding — 146 full
 * -resolution screenshots are not something to leave in a repository — so once
 * a GIF is built there is nothing left to inspect except the GIF.
 *
 * The tempting substitute is to reason from the file size: a 3.3 MB GIF for 34
 * frames "must" have motion in it, because a static one would compress away.
 * That is exactly the kind of inference this project keeps being burned by. A
 * decoder is sixty lines and answers the question directly.
 *
 * Handles what `make-gifs.mjs` produces: GIF89a, one global palette, no local
 * palettes, no interlacing, full-frame images with no disposal. It is not a
 * general GIF reader and does not pretend to be — it asserts on anything
 * outside that, so a future encoder change fails loudly instead of silently
 * decoding to garbage.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [, , source, indexArg, outArg] = process.argv;
if (!source) {
  console.error('usage: node tools/gif-frame.mjs <gif> <index> [out.png]');
  process.exit(2);
}
const wanted = Number(indexArg ?? 0);

const bytes = readFileSync(source);
let at = 0;

function u8() {
  return bytes[at++];
}
function u16() {
  const v = bytes[at] | (bytes[at + 1] << 8);
  at += 2;
  return v;
}

const signature = bytes.toString('latin1', 0, 6);
if (signature !== 'GIF89a' && signature !== 'GIF87a') throw new Error(`not a GIF: ${signature}`);
at = 6;

const screenWidth = u16();
const screenHeight = u16();
const packed = u8();
u8(); // background colour index
u8(); // pixel aspect ratio

let palette = null;
if (packed & 0x80) {
  const size = 2 ** ((packed & 0x07) + 1);
  palette = bytes.subarray(at, at + size * 3);
  at += size * 3;
}

/** Skip a chain of length-prefixed sub-blocks. */
function skipSubBlocks() {
  for (;;) {
    const size = u8();
    if (size === 0) return;
    at += size;
  }
}

/** Concatenate a chain of length-prefixed sub-blocks. */
function readSubBlocks() {
  const parts = [];
  for (;;) {
    const size = u8();
    if (size === 0) break;
    parts.push(bytes.subarray(at, at + size));
    at += size;
  }
  return Buffer.concat(parts);
}

/**
 * LZW, as GIF specifies it: variable code width starting at minCodeSize + 1,
 * with the clear and end codes reserved immediately above the palette.
 */
function inflate(data, minCodeSize, pixelCount) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;

  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const stack = new Uint8Array(4096);

  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let mask = (1 << codeSize) - 1;
  let previous = -1;

  const out = new Uint8Array(pixelCount);
  let written = 0;

  let bitBuffer = 0;
  let bitCount = 0;
  let read = 0;

  while (written < pixelCount) {
    while (bitCount < codeSize) {
      if (read >= data.length) return out;
      bitBuffer |= data[read++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuffer & mask;
    bitBuffer >>= codeSize;
    bitCount -= codeSize;

    if (code === clear) {
      codeSize = minCodeSize + 1;
      mask = (1 << codeSize) - 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) break;

    let current = code;
    let depth = 0;

    if (current >= next) {
      // The one legal forward reference: a code emitted before it was defined,
      // which always means "the previous string plus its own first byte".
      if (previous < 0) throw new Error('corrupt LZW stream');
      stack[depth++] = first[previous];
      current = previous;
    }
    while (current >= clear) {
      stack[depth++] = suffix[current];
      current = prefix[current];
    }
    stack[depth++] = current;

    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next] = current;
      first[next] = first[previous] === 0 && previous < clear ? previous : first[previous];
      if (previous < clear) first[next] = previous;
      next++;
      if ((next & mask) === 0 && next < 4096) {
        codeSize++;
        mask = (1 << codeSize) - 1;
      }
    }
    first[code < next ? code : previous] ??= current;
    if (code < 4096) first[code] = first[code] || current;

    while (depth > 0 && written < pixelCount) out[written++] = stack[--depth];
    previous = code;
  }

  return out;
}

let frame = 0;
let decoded = null;
let geometry = null;

loop: for (;;) {
  const marker = u8();
  if (marker === 0x3b) break; // trailer
  if (marker === 0x21) {
    u8(); // extension label
    skipSubBlocks();
    continue;
  }
  if (marker !== 0x2c) throw new Error(`unexpected block 0x${marker.toString(16)} at ${at - 1}`);

  const left = u16();
  const top = u16();
  const width = u16();
  const height = u16();
  const flags = u8();
  if (flags & 0x40) throw new Error('interlaced frames are not handled');

  /*
   * A local palette, when present, replaces the global one for this frame.
   * gifenc emits one on any frame whose quantised colours differ from the
   * shared palette enough to be worth it, so this is not an exotic case — the
   * first version of this tool threw on frame 30 of the very first GIF it was
   * pointed at.
   */
  let framePalette = palette;
  if (flags & 0x80) {
    const size = 2 ** ((flags & 0x07) + 1);
    framePalette = bytes.subarray(at, at + size * 3);
    at += size * 3;
  }

  const minCodeSize = u8();
  const data = readSubBlocks();

  if (frame === wanted) {
    decoded = inflate(data, minCodeSize, width * height);
    geometry = { left, top, width, height };
    palette = framePalette;
    break loop;
  }
  frame++;
}

if (!decoded || !geometry) {
  console.error(`frame ${String(wanted)} not found; the file has ${String(frame)} frames`);
  process.exit(1);
}
if (!palette) throw new Error('no global palette');

const png = new PNG({ width: geometry.width, height: geometry.height });
for (let i = 0; i < decoded.length; i++) {
  const index = decoded[i] * 3;
  const o = i * 4;
  png.data[o] = palette[index];
  png.data[o + 1] = palette[index + 1];
  png.data[o + 2] = palette[index + 2];
  png.data[o + 3] = 255;
}

const out = outArg ?? source.replace(/\.gif$/, `-frame-${String(wanted).padStart(4, '0')}.png`);
writeFileSync(out, PNG.sync.write(png));
console.log(
  `${out}  ${String(geometry.width)}x${String(geometry.height)}  ` +
    `(screen ${String(screenWidth)}x${String(screenHeight)})`,
);
