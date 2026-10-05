// P0-1 (UNI-927) — bidi-js shim for the vendored pptx render closure.
//
// packages/pptx-render/src/text-layout.ts:24 imports bidi-js and calls
// `getEmbeddingLevels(text, explicitDirection)` — it uses the returned
// `levels` to split tokens at direction boundaries and to reorder them per
// UAX#9 L2. bidi-js is NOT in this repo's lockfile, so the build resolves the
// specifier here.
//
// This implements the subset of UAX#9 the render path exercises for the
// common cases: explicit base direction or first-strong character, strong
// RTL/LTR runs, European/Arabic numbers (I1/I2), neutral resolution between
// adjacent strong types (N1/N2) and L1 trailing-whitespace reset. Directional
// isolates (BD8-BD13), bracket pairs (BD16) and paired LRE/RLE overrides are
// NOT implemented — a deck relying on those orders runs approximately. Adding
// bidi-js to the pnpm catalog (+ packages/office-upstream deps) is the
// follow-up that replaces this shim.

type StrongClass = "L" | "R";

const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const LETTER = /\p{L}/u;
const WHITESPACE = /\s/u;

/** Approximate per-code-point bidi class for level assignment. */
function classesOf(text: string): { classes: string[]; codePoints: string[] } {
  const classes: string[] = [];
  const codePoints: string[] = [];
  for (const char of text) {
    codePoints.push(char);
    if (RTL_SCRIPT.test(char)) classes.push("R");
    else if (char >= "0" && char <= "9") classes.push("EN");
    else if ((char >= "\u0660" && char <= "\u0669") || (char >= "\u06f0" && char <= "\u06f9")) classes.push("AN");
    else if (WHITESPACE.test(char)) classes.push("WS");
    else if (LETTER.test(char)) classes.push("L");
    else classes.push("ON");
  }
  return { classes, codePoints };
}

function firstStrongLevel(classes: readonly string[]): 0 | 1 {
  for (const cls of classes) {
    if (cls === "R") return 1;
    if (cls === "L") return 0;
  }
  return 0;
}

export interface BidiApi {
  getEmbeddingLevels(
    text: string,
    explicitDirection?: "ltr" | "rtl",
  ): { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> };
}

export default function bidiFactory(): BidiApi {
  return {
    getEmbeddingLevels(text, explicitDirection) {
      const { classes, codePoints } = classesOf(text);
      const base: 0 | 1 = explicitDirection === "rtl" ? 1 : explicitDirection === "ltr" ? 0 : firstStrongLevel(classes);
      const levels = new Uint8Array(text.length);
      const strongLevels = new Array<number | null>(classes.length).fill(null);

      for (let i = 0; i < classes.length; i += 1) {
        const cls = classes[i]!;
        if (cls === "R") strongLevels[i] = 1;
        else if (cls === "L") strongLevels[i] = 0;
        else if (cls === "EN" || cls === "AN") strongLevels[i] = 2;
      }
      // N1/N2: a neutral between equal strong types takes that level, else the base level.
      for (let i = 0; i < strongLevels.length; i += 1) {
        if (strongLevels[i] !== null) continue;
        let before: number | null = null;
        for (let j = i - 1; j >= 0; j -= 1) {
          const cls = classes[j]!;
          if (cls === "R") { before = 1; break; }
          if (cls === "L") { before = 0; break; }
        }
        let after: number | null = null;
        for (let j = i + 1; j < classes.length; j += 1) {
          const cls = classes[j]!;
          if (cls === "R") { after = 1; break; }
          if (cls === "L") { after = 0; break; }
        }
        strongLevels[i] = before !== null && before === after ? before : base;
      }
      // L1: trailing whitespace returns to the paragraph level.
      for (let i = classes.length - 1; i >= 0 && classes[i] === "WS"; i -= 1) strongLevels[i] = base;
      // Expand per-code-point levels onto UTF-16 code units.
      let unit = 0;
      for (let i = 0; i < codePoints.length; i += 1) {
        const level = strongLevels[i]!;
        for (let j = 0; j < codePoints[i]!.length; j += 1) {
          levels[unit] = level;
          unit += 1;
        }
      }
      return { levels, paragraphs: [{ start: 0, end: text.length, level: base }] };
    },
  };
}
