/**
 * The plate table (§2, §3.3).
 *
 * This is the declarative source the plate router reads, *and* the source the
 * DOM section heights are computed from. One table, so the document and the
 * renderer cannot drift out of alignment — if a range moves here, the section
 * that carries its type moves with it. `tests/plateRouter.test.ts` asserts the
 * ranges tile [0,1] with no gap and no overlap.
 *
 * Scroll ranges are exactly as specified in §2 and are not tunable by eye.
 */

export const PLATE_IDS = [
  'tension',
  'dispersion',
  'turbulence',
  'weave',
  'vitrification',
  'fracture',
] as const;

export type PlateId = (typeof PLATE_IDS)[number];

export interface Plate {
  readonly id: PlateId;
  /** Roman, because these are plates in a catalogue rather than steps in a process (§3.3). */
  readonly numeral: string;
  /** Latin binomial-style label. I and III are fixed by §4.2/§3.3; the rest are delegated copy (§4.3). */
  readonly label: string;
  /**
   * Visitor-facing subtitle. Plate I's is fixed verbatim by §4.2. II–VI are
   * delegated copy (§4.3) and are written in L4, when the plate they describe
   * exists to be observed — `null` until then rather than drafted, per §0.2 and
   * the §4.1 voice.
   */
  readonly subtitle: string | null;
  /**
   * Internal shorthand from §2 ("Signature: the catenary"). Design vocabulary,
   * not copy — never rendered. Kept because it is the one-line answer to "what
   * is this plate for" and the README's plate table is built from it.
   */
  readonly signature: string;
  readonly start: number;
  readonly end: number;
}

export const PLATES: readonly Plate[] = [
  {
    id: 'tension',
    numeral: 'I',
    label: 'TENSIO',
    subtitle: 'A single filament, held under load.',
    signature: 'the catenary',
    start: 0.0,
    end: 0.16,
  },
  {
    id: 'dispersion',
    numeral: 'II',
    label: 'DISPERSIO',
    subtitle: null,
    signature: 'the prism',
    start: 0.16,
    end: 0.33,
  },
  {
    id: 'turbulence',
    numeral: 'III',
    label: 'TURBULENTIA',
    subtitle: null,
    signature: 'the fray',
    start: 0.33,
    end: 0.5,
  },
  {
    id: 'weave',
    numeral: 'IV',
    label: 'TEXTURA',
    subtitle: null,
    signature: 'the cloth',
    start: 0.5,
    end: 0.66,
  },
  {
    id: 'vitrification',
    numeral: 'V',
    label: 'VITRIFICATIO',
    subtitle: null,
    signature: 'reading through glass',
    start: 0.66,
    end: 0.83,
  },
  {
    id: 'fracture',
    numeral: 'VI',
    label: 'FRACTURA',
    subtitle: null,
    signature: 'the radial slit-scan',
    start: 0.83,
    end: 1.0,
  },
] as const;

export const PLATE_COUNT = PLATES.length;

/**
 * How far either side of a boundary both plates keep stepping, in global
 * progress.
 *
 * This exists so exit transformations are transformations rather than cuts
 * (§1.2). At a boundary the outgoing plate's final state has to be the incoming
 * plate's initial state, which means both have to be live at the same instant —
 * plate I's thread accelerating toward the vanishing point *is* plate II's
 * beam, and that hand-off cannot happen if one is switched off before the other
 * switches on.
 *
 * 0.012 of global progress is roughly 3/4 of a viewport of scroll at the
 * document length in src/styles/global.css. Wide enough that the hand-off is
 * never visible as an event; narrow enough that no more than two plates ever
 * simulate at once, which is what keeps the frame budget affordable.
 */
export const BLEND = 0.012;

/** Total document scroll length, as a multiple of viewport height. */
export const SCROLL_LENGTH_VH = 700;

/** Section height for a plate, in vh, proportional to its share of the scroll. */
export function sectionHeightVh(plate: Plate): number {
  return (plate.end - plate.start) * SCROLL_LENGTH_VH;
}
