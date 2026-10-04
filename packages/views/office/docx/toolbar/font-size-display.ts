"use client";

// C8 (UNI-924 T7): the Font group's size readout. \`format.fontSizePt\` is null
// both when the run carries no explicit size and when a mixed selection has no
// single value, and the composed command state cannot tell the two apart. This
// helper reads the live editor's marks across the selection so the size box can
// show the real size when there is one, the document's effective size for
// unstyled runs (Word shows 11 for a plain paragraph), and the picker's mixed
// placeholder only when the selection genuinely touches different sizes.
import type { Editor } from "@tiptap/core";
import { DEFAULT_FONT_SIZE_PT } from "../character/font-size";

export interface DocxFontSizeDisplay {
  /** The single run size in points across the selection, or null. */
  value: number | null;
  /** The selection carries more than one run size. */
  mixed: boolean;
}

const NONE: DocxFontSizeDisplay = { value: null, mixed: false };

/** A positive pt figure from a CSS length (\`11pt\`, \`14.6667px\`); null otherwise. */
function cssLengthPt(raw: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(pt|px)?\s*$/i.exec(raw);
  if (!match) return null;
  const amount = Number.parseFloat(match[1] as string);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return (match[2] ?? "").toLowerCase() === "px" ? (amount * 72) / 96 : amount;
}

/**
 * The document's effective body size: the parsed styles.xml/theme materialize
 * as \`--doc-base-fs\` on the page root (docx-doc-styles -> docStyleCss, which
 * already resolves Normal/docDefaults/Word's built-in 10pt), so reading that
 * variable is reading the document's own default. A document that declares
 * none (no styles part, a stub engine) falls back to Word's built-in 11pt.
 */
export function docxDefaultFontSizePt(editor: Editor | null): number {
  const root = editor && !editor.isDestroyed ? (editor.view?.dom as HTMLElement | null) : null;
  const view = root?.ownerDocument?.defaultView;
  if (root && view) {
    const pt = cssLengthPt(view.getComputedStyle(root).getPropertyValue("--doc-base-fs"));
    if (pt !== null) return pt;
  }
  return DEFAULT_FONT_SIZE_PT;
}

/** The explicit size mark on the caret itself, or null when the run is unstyled. */
function caretSize(editor: Editor): number | null {
  for (const mark of editor.state.selection.$from.marks()) {
    if (mark.type.name !== "docTextStyle") continue;
    const half = (mark.attrs as { sizeHalfPoints?: unknown }).sizeHalfPoints;
    if (typeof half === "number" && half > 0) return half / 2;
  }
  return null;
}

/**
 * Run sizes (points) of every text node the selection touches. A text node
 * without a \`docTextStyle\` size mark carries no size of its own: Word renders it
 * at the document default, so it resolves to \`defaultPt\` here — otherwise a
 * mixed selection that includes an unstyled run would look uniform.
 */
function selectionSizes(editor: Editor, defaultPt: number): number[] {
  const { from, to } = editor.state.selection;
  const sizes: number[] = [];
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    let explicit: number | null = null;
    for (const mark of node.marks) {
      if (mark.type.name !== "docTextStyle") continue;
      const half = (mark.attrs as { sizeHalfPoints?: unknown }).sizeHalfPoints;
      if (typeof half === "number" && half > 0) explicit = half / 2;
    }
    sizes.push(explicit ?? defaultPt);
  });
  return sizes;
}

/**
 * The size the box shows for the caret/selection. A collapsed caret keeps the
 * command state's own value, falling back to the document default so plain text
 * shows 11 instead of an empty field. A range resolves every touched run
 * (unstyled runs at the default) and shows the shared size, or the mixed
 * placeholder when the resolved sizes genuinely differ.
 */
export function docxFontSizeDisplay(
  editor: Editor | null,
  stateValue: number | null,
  defaultPt?: number,
): DocxFontSizeDisplay {
  if (!editor || editor.isDestroyed) return stateValue === null ? NONE : { value: stateValue, mixed: false };
  const fallback = defaultPt ?? docxDefaultFontSizePt(editor);
  const { from, to } = editor.state.selection;
  if (to <= from) {
    // A collapsed caret: the marks at the caret win, then the composed state
    // (which already read them), then the document default.
    return { value: caretSize(editor) ?? stateValue ?? fallback, mixed: false };
  }
  const sizes = selectionSizes(editor, fallback);
  if (sizes.length === 0) return { value: stateValue ?? fallback, mixed: false };
  const first = sizes[0] as number;
  if (sizes.some((size) => Math.round(size * 2) !== Math.round(first * 2))) return { value: null, mixed: true };
  return { value: first, mixed: false };
}
