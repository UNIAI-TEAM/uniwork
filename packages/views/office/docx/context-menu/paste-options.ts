import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment, Slice, type Node as PmNode, type Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/** Word's three paste modes: keep source formatting, merge with the destination, text only. */
export type DocxPasteMode = "source" | "merge" | "text";

export interface DocxPastePayload {
  html: string;
  text: string;
}

export interface DocxPasteRange {
  from: number;
  to: number;
}

/**
 * The clipboard payload the chip may offer modes for. A payload with no prose
 * (an image-only fragment) gets no chip — there is nothing to re-format, the
 * same rule the vendored renderer applies before stashing its chip payload.
 */
export function readPastePayload(
  input: { html?: string | null; text?: string | null } | null | undefined,
): DocxPastePayload | null {
  const html = input?.html ?? "";
  const text = input?.text ?? "";
  const rich = html.length > 0 && htmlHasText(html);
  if (!rich && text.trim().length === 0) return null;
  return { html: rich ? html : "", text };
}

/** Reads a real ClipboardEvent's DataTransfer through `getData`, tolerating a null one. */
export function pastePayloadFromDataTransfer(
  data: { getData(type: string): string } | null | undefined,
): DocxPastePayload | null {
  if (!data) return null;
  return readPastePayload({
    html: data.getData("text/html"),
    text: data.getData("text/plain"),
  });
}

function htmlHasText(html: string): boolean {
  if (typeof DOMParser === "undefined") return true;
  try {
    return (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * The range a transaction's steps touched, in final-document coordinates —
 * ported from genoffice `components/PasteOptionsChip.tsx` (`changedRangeOf`).
 * This is how the chip learns which range the paste inserted without guessing
 * from the selection.
 */
export function changedRangeOf(transaction: Transaction): DocxPasteRange | null {
  let from = Infinity;
  let to = -Infinity;
  const maps = transaction.mapping.maps;
  maps.forEach((stepMap, index) => {
    stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      let start = newFrom;
      let end = newTo;
      for (let later = index + 1; later < maps.length; later += 1) {
        const next = maps[later];
        if (!next) continue;
        start = next.map(start, 1);
        end = next.map(end, -1);
      }
      from = Math.min(from, start);
      to = Math.max(to, end);
    });
  });
  return from <= to ? { from, to } : null;
}

/** Plain text as docx paragraphs: one node per line, so `<` and `>` stay literal. */
export function plainTextContent(text: string): JSONContent[] {
  const lines = text.replace(/\r/g, "").split("\n");
  return lines.map((line) => ({
    type: "docParagraph",
    ...(line.length > 0 ? { content: [{ type: "text", text: line }] } : {}),
  }));
}

/** Insert plain text at the selection (menu Paste as plain text). */
export function insertPlainText(editor: Editor, text: string): boolean {
  if (!editor.isEditable || text.length === 0) return false;
  return editor.chain().focus().insertContent(plainTextContent(text)).run();
}

/**
 * Match destination: keep the block structure and the emphasis marks (bold,
 * italic, underline, links), drop the source run style so the text follows the
 * destination paragraph, and leave table subtrees untouched — the vendored
 * `mergeFormattingFragment` preserves them the same way. Pasted paragraphs keep
 * their own format attrs (alignment, spacing); UniWork does not rebind them to
 * the caret paragraph, which is the honest subset noted in the worker report.
 */
export function stripRunFormatting(fragment: Fragment, schema: Schema): Fragment {
  const styleType = schema.marks.docTextStyle;
  const mapped: PmNode[] = [];
  fragment.forEach((node) => {
    if (node.type.spec.tableRole === "table") {
      mapped.push(node);
      return;
    }
    if (node.isText) {
      mapped.push(styleType ? node.mark(node.marks.filter((mark) => mark.type !== styleType)) : node);
      return;
    }
    mapped.push(node.copy(stripRunFormatting(node.content, schema)));
  });
  return Fragment.from(mapped);
}

/** Replace a stored paste range with the chosen mode's rendering. */
export function applyDocxPasteMode(editor: Editor, range: DocxPasteRange, mode: DocxPasteMode): boolean {
  if (!editor.isEditable) return false;
  const size = editor.state.doc.content.size;
  const from = Math.max(0, Math.min(range.from, size));
  const to = Math.max(from, Math.min(range.to, size));
  if (mode === "source") return true;
  if (mode === "text") {
    const $from = editor.state.doc.resolve(from);
    const $to = editor.state.doc.resolve(to);
    if ($from.sameParent($to) && $from.parent.isTextblock) {
      // Inline paste: keep the text where it landed, only drop the marks.
      const text = editor.state.doc.textBetween(from, to);
      if (text.length === 0) return false;
      editor.view.dispatch(
        editor.state.tr.replaceRange(from, to, new Slice(Fragment.from(editor.state.schema.text(text)), 0, 0)),
      );
      return true;
    }
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (text.length === 0) return false;
    return editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, plainTextContent(text))
      .run();
  }
  const slice = editor.state.doc.slice(from, to);
  const mapped = stripRunFormatting(slice.content, editor.state.schema);
  editor.view.dispatch(editor.state.tr.replaceRange(from, to, new Slice(mapped, slice.openStart, slice.openEnd)));
  return true;
}
