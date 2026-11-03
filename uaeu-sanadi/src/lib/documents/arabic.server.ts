/**
 * Minimal Arabic text shaper for PDF output. Server only.
 *
 * pdf-lib draws glyphs in logical order with no OpenType shaping, so Arabic
 * text has to be converted to its Presentation Forms-B equivalents and then
 * reordered right-to-left before it is drawn.
 */

type Forms = [isolated: number, final: number, initial?: number, medial?: number];

const FORMS: Record<number, Forms> = {
  0x0621: [0xfe80, 0xfe80],
  0x0622: [0xfe81, 0xfe82],
  0x0623: [0xfe83, 0xfe84],
  0x0624: [0xfe85, 0xfe86],
  0x0625: [0xfe87, 0xfe88],
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  0x0627: [0xfe8d, 0xfe8e],
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94],
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4],
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa],
  0x0630: [0xfeab, 0xfeac],
  0x0631: [0xfead, 0xfeae],
  0x0632: [0xfeaf, 0xfeb0],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4],
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc],
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0],
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640],
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4],
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4],
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec],
  0x0648: [0xfeed, 0xfeee],
  0x0649: [0xfeef, 0xfef0],
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
};

/** lam + alef variants collapse into a single ligature glyph. */
const LAM_ALEF: Record<number, [isolated: number, final: number]> = {
  0x0622: [0xfef5, 0xfef6],
  0x0623: [0xfef7, 0xfef8],
  0x0625: [0xfef9, 0xfefa],
  0x0627: [0xfefb, 0xfefc],
};

const isTransparent = (cp: number) =>
  (cp >= 0x064b && cp <= 0x065f) || cp === 0x0670 || cp === 0x0610 || cp === 0x061a;

const canJoinNext = (cp: number) => {
  const f = FORMS[cp];
  return Boolean(f && f.length === 4);
};
const canJoinPrev = (cp: number) => Boolean(FORMS[cp]);

export const hasArabic = (text: string) => /[\u0600-\u06ff]/.test(text);

/** Converts logical Arabic text to contextual presentation forms. */
export function shapeArabic(text: string): string {
  const cps = [...text].map((c) => c.codePointAt(0) ?? 0);
  const out: number[] = [];

  const prevJoining = (i: number): boolean => {
    for (let k = i - 1; k >= 0; k--) {
      if (isTransparent(cps[k]!)) continue;
      return canJoinNext(cps[k]!);
    }
    return false;
  };
  const nextJoining = (i: number): boolean => {
    for (let k = i + 1; k < cps.length; k++) {
      if (isTransparent(cps[k]!)) continue;
      return canJoinPrev(cps[k]!);
    }
    return false;
  };

  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!;

    if (cp === 0x0644 && i + 1 < cps.length && LAM_ALEF[cps[i + 1]!]) {
      const pair = LAM_ALEF[cps[i + 1]!]!;
      out.push(prevJoining(i) ? pair[1] : pair[0]);
      i += 1;
      continue;
    }

    const forms = FORMS[cp];
    if (!forms) {
      out.push(cp);
      continue;
    }
    const before = prevJoining(i);
    const after = nextJoining(i);
    if (before && after && forms.length === 4) out.push(forms[3]!);
    else if (before) out.push(forms[1]!);
    else if (after && forms.length === 4) out.push(forms[2]!);
    else out.push(forms[0]!);
  }

  return String.fromCodePoint(...out);
}

const LTR_RUN = /[A-Za-z0-9\u0660-\u0669\u06f0-\u06f9@._/:%+\-#&()]+/g;

/**
 * Reverses a shaped Arabic line into visual order while keeping embedded
 * Latin words, numbers and references readable left-to-right.
 * Kept for renderers that do not reorder right-to-left themselves.
 */
export function toVisualRtl(line: string): string {
  const reversed = [...line].reverse().join("");
  return reversed.replace(LTR_RUN, (run) => [...run].reverse().join(""));
}

/**
 * Pre-flips embedded Latin runs (student numbers, references, URLs, years) so
 * that a renderer which mirrors the whole line still shows them left-to-right.
 */
export const reverseLtrRuns = (text: string) =>
  text.replace(LTR_RUN, (run) => [...run].reverse().join(""));

/**
 * Prepares an Arabic line for pdf-lib + fontkit: contextual presentation forms
 * with embedded Latin/number runs pre-flipped. fontkit performs the
 * right-to-left ordering, so the line itself must stay in logical order.
 */
export const arabicLine = (text: string) =>
  hasArabic(text) ? shapeArabic(reverseLtrRuns(text)) : text;
