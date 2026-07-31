import { PNG } from 'pngjs';

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Decoded {
  width: number;
  height: number;
  at(x: number, y: number): Rgb;
  /** Mean colour of a w×h box, for sampling a region rather than one fragile pixel. */
  mean(x: number, y: number, w: number, h: number): Rgb;
}

export function decode(buffer: Buffer): Decoded {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;

  const at = (x: number, y: number): Rgb => {
    const cx = Math.min(width - 1, Math.max(0, Math.round(x)));
    const cy = Math.min(height - 1, Math.max(0, Math.round(y)));
    const i = (cy * width + cx) * 4;
    return { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0, a: data[i + 3] ?? 0 };
  };

  const mean = (x: number, y: number, w: number, h: number): Rgb => {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let n = 0;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const p = at(x + dx, y + dy);
        r += p.r;
        g += p.g;
        b += p.b;
        a += p.a;
        n++;
      }
    }
    return { r: r / n, g: g / n, b: b / n, a: a / n };
  };

  return { width, height, at, mean };
}

/** '#050507' → { r: 5, g: 5, b: 7, a: 255 } */
export function fromHex(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
}

export function formatRgb(c: Rgb): string {
  return `rgb(${c.r.toFixed(1)}, ${c.g.toFixed(1)}, ${c.b.toFixed(1)})`;
}

/** Largest per-channel difference, in 8-bit levels. */
export function maxChannelDelta(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}
