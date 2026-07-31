/**
 * Single source of truth for the piece's name and fixed copy (spec §11).
 * If the name changes, it changes here and nowhere else.
 */

export const identity = {
  name: 'WEFT',
  tagline: 'Field notes on a material that does not exist.',
  author: 'Christi Reid',
  /** Roman numerals are used because these are plates in a catalogue, not steps in a process (§3.3). */
  plateNumerals: ['I', 'II', 'III', 'IV', 'V', 'VI'] as const,
} as const;

/** The void. Kept in TS as well as CSS because the renderer clears to it. */
export const VOID_HEX = '#050507';
