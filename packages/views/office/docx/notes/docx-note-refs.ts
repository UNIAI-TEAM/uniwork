// The note reference markers over one live TipTap editor: the vendored
// `docNoteRef` atom node (editor/extensions.ts:806) is the parser's own run
// shape (`run.noteRef` in both directions), so every mutation here round-trips
// through the one save plan — the marker saves as
// w:footnoteReference/w:endnoteReference, never as text.
import type { Editor } from "@tiptap/core";
import type { DocxNoteKind } from "@uniwork/office-engine/docx";

/** Positions of every marker of `kind` (optionally of one id), document order. */
function noteRefPositions(editor: Editor, kind: DocxNoteKind, id?: string): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "docNoteRef" || node.attrs.kind !== kind) return true;
    if (id !== undefined && String(node.attrs.id) !== id) return true;
    out.push(pos);
    return true;
  });
  return out;
}

/** True when the open document still carries a reference for this note (a
 * panel hint for a note whose marker was edited or pasted away). */
export function hasNoteRef(editor: Editor, kind: DocxNoteKind, id: string): boolean {
  return noteRefPositions(editor, kind, id).length > 0;
}

/** Insert the marker at the caret/selection; false when the editor refused. */
export function insertNoteRef(editor: Editor, kind: DocxNoteKind, id: string, num: number): boolean {
  return editor.chain().focus().insertContent({ type: "docNoteRef", attrs: { kind, id, num } }).run();
}

/** Delete every marker of the note; true when anything was removed. */
export function removeNoteRefs(editor: Editor, kind: DocxNoteKind, id: string): boolean {
  const positions = noteRefPositions(editor, kind, id);
  if (positions.length === 0) return false;
  const tr = editor.state.tr;
  for (const pos of [...positions].reverse()) {
    const node = editor.state.doc.nodeAt(pos);
    if (node) tr.delete(pos, pos + node.nodeSize);
  }
  editor.view.dispatch(tr);
  return true;
}

/** Rewrite the display number of every marker of `kind` (0/absent ids are
 * left alone); true when anything changed. */
export function renumberNoteRefs(editor: Editor, kind: DocxNoteKind, numbers: ReadonlyMap<string, number>): boolean {
  const tr = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "docNoteRef" || node.attrs.kind !== kind) return true;
    const num = numbers.get(String(node.attrs.id));
    if (num !== undefined && node.attrs.num !== num) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, num });
      changed = true;
    }
    return true;
  });
  if (changed) editor.view.dispatch(tr);
  return changed;
}

/** Scroll the first marker into view and select it: the atom's own
 * ProseMirror-selectednode outline is the jump highlight (styles.css:9700),
 * so no extra class or sheet entry is needed. */
export function jumpToNoteRef(editor: Editor, kind: DocxNoteKind, id: string): boolean {
  const pos = noteRefPositions(editor, kind, id)[0];
  if (pos === undefined) return false;
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement && typeof dom.scrollIntoView === "function") {
    dom.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  editor.chain().focus().setNodeSelection(pos).run();
  return true;
}
