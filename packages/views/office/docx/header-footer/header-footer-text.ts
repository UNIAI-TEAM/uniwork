// Task A13 (UNI-924): text view of a header/footer part.
//
// A port of the vendored renderer's editor/hf-text.ts onto the model's
// DocxHeaderFooter: paragraphs edit as lines, the invisible PAGE / NUMPAGES
// field sentinels as visible {PAGE} / {NUMPAGES} tokens, and layout-table rows
// (cells) stay out of the text flow. Formatting is preserved by mapping each
// edited line onto its original paragraph template (first-run style), which is
// the run formatting the model carries — this is an edit of the existing part,
// not a rebuild.
import type { DocxHeaderFooter } from "@uniwork/office-engine/docx";

/** Field sentinels the parser writes into text/paras (vendored docx-engine
 * types.ts: PAGE_MARK = U+E001, TOTAL_PAGES_MARK = U+E000). Not exported by
 * the docs-renderer shim, so the pinned values live here once. */
const TOTAL_PAGES_MARK = "\uE000";
const PAGE_MARK = "\uE001";

/** User-visible tokens for those sentinels (upstream hf-text.ts). */
export const PAGE_TOKEN = "{PAGE}";
export const TOTAL_TOKEN = "{NUMPAGES}";

/** Structural paragraph shape of DocxHeaderFooter.paras (upstream HfParagraph). */
export interface DocxHfParagraphLike {
  runs: Array<{ text?: string; [key: string]: unknown }>;
  /** Present on display-only layout-table rows; text editing leaves them alone. */
  cells?: unknown[];
  [key: string]: unknown;
}

function isParagraphLike(value: unknown): value is DocxHfParagraphLike {
  return typeof value === "object" && value !== null && Array.isArray((value as { runs?: unknown }).runs);
}

/** A part with no paragraph at all (a fresh slot) edits as one centered line. */
const EMPTY_HF_PARAGRAPH: DocxHfParagraphLike = { align: "center", runs: [] };

/** effective paragraphs: rich paras when present, else the legacy single line
 * (upstream hf-text.ts hfParasOf — a page-number field appended as PAGE_MARK). */
export function hfParasOf(value: DocxHeaderFooter): DocxHfParagraphLike[] {
  const paras = value.paras;
  if (Array.isArray(paras) && paras.length > 0 && paras.every(isParagraphLike)) return paras as DocxHfParagraphLike[];
  const runs: DocxHfParagraphLike["runs"] = value.text ? [{ text: value.text }] : [];
  if (value.pageNumber && !value.text.includes("#") && !value.text.includes(PAGE_MARK)) {
    runs.push({ text: runs.length > 0 ? ` ${PAGE_MARK}` : PAGE_MARK });
  }
  return [{ align: "center", runs }];
}

/** editable text of the part: one line per text paragraph, field sentinels as tokens. */
export function hfEditText(value: DocxHeaderFooter | null): string {
  if (!value) return "";
  return hfParasOf(value)
    .filter((p) => !p.cells)
    .map((p) => p.runs.map((r) => r.text ?? "").join(""))
    .join("\n")
    .replaceAll(PAGE_MARK, PAGE_TOKEN)
    .replaceAll(TOTAL_PAGES_MARK, TOTAL_TOKEN);
}

/**
 * Map edited lines back onto the part: each line keeps its original
 * paragraph's format and first-run styling (extra lines reuse the last
 * template), cells rows are spliced back at their original positions.
 */
export function applyHfText(value: DocxHeaderFooter | null, text: string): DocxHeaderFooter {
  const base = value ?? { text: "" };
  const paras = hfParasOf(base);
  const lines = text
    .replace(/\n+$/, "")
    .replaceAll(PAGE_TOKEN, PAGE_MARK)
    .replaceAll(TOTAL_TOKEN, TOTAL_PAGES_MARK)
    .split("\n");
  const textParas = paras.filter((p) => !p.cells);
  const templates: DocxHfParagraphLike[] = textParas.length > 0 ? textParas : [EMPTY_HF_PARAGRAPH];
  const edited: DocxHfParagraphLike[] = lines.map((line, i) => {
    const template = templates[Math.min(i, templates.length - 1)] ?? EMPTY_HF_PARAGRAPH;
    const style = template.runs[0] ?? {};
    return { ...template, runs: line === "" ? [] : [{ ...style, text: line }] };
  });
  const nextParas: DocxHfParagraphLike[] = [];
  let ei = 0;
  for (const p of paras) {
    if (p.cells) {
      nextParas.push(p);
      continue;
    }
    const next = edited[ei++];
    if (next) nextParas.push(next);
  }
  nextParas.push(...edited.slice(ei));
  const nextText = edited.map((p) => p.runs.map((r) => r.text ?? "").join("")).join("");
  return { ...base, text: nextText, paras: nextParas };
}

/** The draft has no visible content: no text and no field tokens. */
export function hfDraftIsEmpty(text: string): boolean {
  return text.replaceAll(PAGE_TOKEN, "1").replaceAll(TOTAL_TOKEN, "1").trim() === "";
}
