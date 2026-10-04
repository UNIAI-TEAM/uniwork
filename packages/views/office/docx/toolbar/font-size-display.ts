"use client";

// C8 (UNI-924 T7): the Font group's size readout. `format.fontSizePt` is null
// both when the run carries no explicit size and when a mixed selection has no
// single value, and the composed command state cannot tell the two apart. This
// helper reads the live editor's marks across the selection so the size box can
// show the real size when there is one, and an empty field for a mixed
// selection (the FontSizePicker's "-" placeholder).
import type { Editor } from "@tiptap/core";

export interface DocxFontSizeDisplay {
  /** The single run size in points across the selection, or null. */
  value: number | null;
  /** The selection carries more than one run size. */
  mixed: boolean;
}

const NONE: DocxFontSizeDisplay = { value: null, mixed: false };

/** Run sizes (points) of every text node the selection touches. */
function selectionSizes(editor: Editor): number[] {
  const { from, to } = editor.state.selection;
  const sizes: number[] = [];
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== "docTextStyle") continue;
      const half = (mark.attrs as { sizeHalfPoints?: unknown }).sizeHalfPoints;
      if (typeof half === "number" && half > 0) sizes.push(half / 2);
    }
  });
  return sizes;
}

/**
 * The size the box shows for the caret/selection. A collapsed caret keeps the
 * command state's own value; a range reads its marks, so a partially styled
 * selection shows the shared size instead of an empty box.
 */
export function docxFontSizeDisplay(editor: Editor | null, stateValue: number | null): DocxFontSizeDisplay {
  if (!editor || editor.isDestroyed) return stateValue === null ? NONE : { value: stateValue, mixed: false };
  const { from, to } = editor.state.selection;
  if (to <= from) return stateValue === null ? NONE : { value: stateValue, mixed: false };
  const sizes = selectionSizes(editor);
  if (sizes.length === 0) return stateValue === null ? NONE : { value: stateValue, mixed: false };
  const first = sizes[0] as number;
  if (sizes.some((size) => Math.round(size * 2) !== Math.round(first * 2))) return { value: null, mixed: true };
  return { value: first, mixed: false };
}
