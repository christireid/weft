/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Source: WCAG 2.1 §1.4.3 definitions — https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *
 * This exists because WEFT's palette is four alpha values of one ink over one
 * void, which means every contrast decision on the site is a composite that
 * cannot be read off a swatch. Guessing at it is how a piece with this little
 * colour still ends up failing an audit.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over composite of a translucent ink onto an opaque backdrop. */
export function composite(ink: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return {
    r: Math.round(alpha * ink.r + (1 - alpha) * backdrop.r),
    g: Math.round(alpha * ink.g + (1 - alpha) * backdrop.g),
    b: Math.round(alpha * ink.b + (1 - alpha) * backdrop.b),
  };
}

export function parseHex(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Parses `rgba(247, 247, 245, 0.60)` into its ink and its alpha. */
export function parseRgba(value: string): { rgb: Rgb; alpha: number } {
  const nums = value.match(/[\d.]+/g)?.map(Number) ?? [];
  const [r = 0, g = 0, b = 0, alpha = 1] = nums;
  return { rgb: { r, g, b }, alpha };
}
