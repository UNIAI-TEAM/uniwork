// The note reference markers over one live TipTap editor: the vendored
// `docNoteRef` atom node (editor/extensions.ts:806) is the parser's own run
// shape (`run.noteRef` in both directions), so every mutation here round-trips
// through the one save plan — the marker saves as
// w:footnoteReference/w:endnoteReference, never as text.
import type { Editor } from "@tiptap/core";
import type { DocxNoteKind } from "@uniwork/office-engine/docx";

/** One reference marker: its doc position, note id and displayed number. */
interface NoteRefHit {
  pos: number;
  id: string;
  num: number;
}

/** Every marker of `kind` in document order. */
function scanNoteRefs(editor: Editor, kind: DocxNoteKind): NoteRefHit[] {
  const out: NoteRefHit[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "docNoteRef" || node.attrs.kind !== kind) return true;
    out.push({ pos, id: String(node.attrs.id), num: Number(node.attrs.num) || 1 });
    return true;
  });
  return out;
}

/** Positions of every marker of `kind` (optionally of one id), document order. */
function noteRefPositions(editor: Editor, kind: DocxNoteKind, id?: string): number[] {
  return scanNoteRefs(editor, kind)
    .filter((hit) => id === undefined || hit.id === id)
    .map((hit) => hit.pos);
}

/** The markers of `kind` in document order, with their displayed numbers. */
export function noteRefsOf(editor: Editor, kind: DocxNoteKind): Array<{ id: string; num: number }> {
  return scanNoteRefs(editor, kind).map(({ id, num }) => ({ id, num }));
}

/** Marker ids per kind, partitioned once per document version: the notes pane
 * asks per rendered row on every state emit, so a full walk per row (or per
 * call) would repeat the same scan. The doc instance is immutable, so a cache
 * keyed by it is exact. */
const refIdsByDoc = new WeakMap<object, { footnote: Set<string>; endnote: Set<string> }>();

function noteRefIds(editor: Editor): { footnote: Set<string>; endnote: Set<string> } {
  const cached = refIdsByDoc.get(editor.state.doc);
  if (cached) return cached;
  const out = { footnote: new Set<string>(), endnote: new Set<string>() };
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "docNoteRef") return true;
    out[node.attrs.kind === "endnote" ? "endnote" : "footnote"].add(String(node.attrs.id));
    return true;
  });
  refIdsByDoc.set(editor.state.doc, out);
  return out;
}

/** True when the open document still carries a reference for this note (a
 * panel hint for a note whose marker was edited or pasted away). */
export function hasNoteRef(editor: Editor, kind: DocxNoteKind, id: string): boolean {
  return noteRefIds(editor)[kind].has(id);
}

/** True when the current selection sits where an inline marker can land: a
 * collapsed caret inside inline content. A block/node selection, a table cell
 * selection, or a live range selection (insertContent would replace and delete
 * the selected text) has no safe spot to insert into. */
export function canInsertNoteRef(editor: Editor): boolean {
  const { selection } = editor.state;
  return selection.empty && selection.$from.parent.inlineContent;
}

/** Insert the marker at the caret/selection; false when the editor refused. */
export function insertNoteRef(editor: Editor, kind: DocxNoteKind, id: string, num: number): boolean {
  if (!canInsertNoteRef(editor)) return false;
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
