// Editor-side comment anchors — the in-document half of the feature.
//
// A range that sits inside one top-level block is stored on the vendored
// `comment` mark (space-separated ids per text node: the renderer's own
// in-paragraph representation). A range that crosses blocks is stored as
// commentStarts/commentEnds on the first/last boundary block (the parser's
// cross-paragraph representation). Both re-emit commentRangeStart/End +
// reference on save (vendored generate.ts) and survive a reparse, so the
// anchor rectangles never have to be invented here.
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

const COMMENT_MARK = "comment";
const ANCHOR_ATTRS = ["commentStarts", "commentEnds"] as const;
type AnchorAttr = (typeof ANCHOR_ATTRS)[number];

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function markIds(mark: { attrs: Record<string, unknown> } | undefined): string[] {
  return String(mark?.attrs.ids ?? "").split(" ").filter(Boolean);
}

/** Top-level child index containing `pos` (clamped), or null at depth 0. */
function blockIndexOf(doc: PmNode, pos: number): number | null {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const resolved = doc.resolve(clamped);
  if (resolved.depth === 0) return null;
  const index = resolved.index(0);
  return index >= doc.childCount ? null : index;
}

function childAt(doc: PmNode, index: number): { node: PmNode; pos: number } | null {
  let found: { node: PmNode; pos: number } | null = null;
  doc.forEach((node, offset, current) => {
    if (current === index) found = { node, pos: offset };
  });
  return found;
}

/** Add/remove one id on a block's anchor attr; true when the attr changed. */
function setBlockAnchorAttr(tr: Transaction, pos: number, attr: AnchorAttr, id: string, add: boolean): boolean {
  const node = tr.doc.nodeAt(pos);
  if (!node) return false;
  const current = idList(node.attrs[attr]);
  const next = add
    ? [...new Set([...current, id])].sort((a, b) => a.localeCompare(b))
    : current.filter((value) => value !== id);
  if (next.length === current.length && next.every((value, index) => value === current[index])) return false;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: next.length > 0 ? next : null });
  return true;
}

/** The current non-empty selection, or null (a collapsed caret has nothing to
 * anchor — the caller disables Add instead of guessing a word range). */
export function selectionRange(editor: Editor): { from: number; to: number } | null {
  const { from, to } = editor.state.selection;
  return from < to ? { from, to } : null;
}

/** Anchor the current selection to comment `id`; false when there is nothing
 * to anchor or the schema lost its comment mark. */
export function addCommentAnchor(editor: Editor, id: string): boolean {
  const { state } = editor;
  const markType = state.schema.marks[COMMENT_MARK];
  const range = selectionRange(editor);
  if (!markType || !range) return false;
  const startIndex = blockIndexOf(state.doc, range.from);
  const endIndex = blockIndexOf(state.doc, Math.max(range.from, range.to - 1));
  if (startIndex === null || endIndex === null) return false;
  const tr = state.tr;
  if (startIndex === endIndex) {
    // In-paragraph range: one mark instance per covered text node, sharing the
    // id list (the parser's own shape).
    state.doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (!node.isText) return;
      const from = Math.max(pos, range.from);
      const to = Math.min(pos + node.nodeSize, range.to);
      if (from >= to) return;
      const existing = node.marks.find((mark) => mark.type === markType);
      const ids = new Set(markIds(existing));
      ids.add(id);
      tr.addMark(from, to, markType.create({ ids: [...ids].sort().join(" ") }));
    });
    if (!tr.docChanged) return false;
    editor.view.dispatch(tr);
    return true;
  }
  // Cross-paragraph range: boundary block attrs only — marking the boundary
  // text too would emit a second, in-paragraph range for the same id.
  const start = childAt(state.doc, startIndex);
  const end = childAt(state.doc, endIndex);
  if (!start || !end) return false;
  tr.setNodeMarkup(start.pos, undefined, { ...start.node.attrs, commentStarts: [...new Set([...idList(start.node.attrs.commentStarts), id])].sort((a, b) => a.localeCompare(b)) });
  tr.setNodeMarkup(end.pos, undefined, { ...end.node.attrs, commentEnds: [...new Set([...idList(end.node.attrs.commentEnds), id])].sort((a, b) => a.localeCompare(b)) });
  editor.view.dispatch(tr);
  return true;
}

/** Make `newId` share whatever anchor `anchorId` uses (Word: a reply hangs on
 * the parent's range). True when at least one anchor existed. */
export function addCommentIdToAnchor(editor: Editor, anchorId: string, newId: string): boolean {
  const { state } = editor;
  const markType = state.schema.marks[COMMENT_MARK];
  const tr = state.tr;
  let found = false;
  if (markType) {
    state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const mark = node.marks.find((candidate) => candidate.type === markType);
      if (!mark) return;
      const ids = markIds(mark);
      if (!ids.includes(anchorId)) return;
      found = true;
      if (ids.includes(newId)) return;
      tr.addMark(pos, pos + node.nodeSize, markType.create({ ids: [...new Set([...ids, newId])].sort().join(" ") }));
    });
  }
  state.doc.descendants((node, pos) => {
    if (!node.isBlock) return;
    for (const attr of ANCHOR_ATTRS) {
      if (!idList(node.attrs[attr]).includes(anchorId)) continue;
      found = true;
      setBlockAnchorAttr(tr, pos, attr, newId, true);
    }
  });
  if (tr.docChanged) editor.view.dispatch(tr);
  return found;
}

/** Strip `id` from every mark and block attr (used by a thread delete). */
export function removeCommentAnchor(editor: Editor, id: string): void {
  const { state } = editor;
  const markType = state.schema.marks[COMMENT_MARK];
  const tr = state.tr;
  if (markType) {
    const removals: Array<{ from: number; to: number }> = [];
    const additions: Array<{ from: number; to: number; ids: string }> = [];
    state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const mark = node.marks.find((candidate) => candidate.type === markType);
      if (!mark) return;
      const ids = markIds(mark);
      if (!ids.includes(id)) return;
      const remaining = ids.filter((value) => value !== id);
      if (remaining.length === 0) removals.push({ from: pos, to: pos + node.nodeSize });
      else additions.push({ from: pos, to: pos + node.nodeSize, ids: remaining.join(" ") });
    });
    for (const entry of removals) tr.removeMark(entry.from, entry.to, markType);
    for (const entry of additions) tr.addMark(entry.from, entry.to, markType.create({ ids: entry.ids }));
  }
  state.doc.descendants((node, pos) => {
    if (!node.isBlock) return;
    for (const attr of ANCHOR_ATTRS) {
      if (idList(node.attrs[attr]).includes(id)) setBlockAnchorAttr(tr, pos, attr, id, false);
    }
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** True when the open document still carries `id` (panel hint for a comment
 * whose anchor was edited away). */
export function hasCommentAnchor(editor: Editor, id: string): boolean {
  const { doc, schema } = editor.state;
  const markType = schema.marks[COMMENT_MARK];
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.isText) {
      if (!markType) return true;
      const mark = node.marks.find((candidate) => candidate.type === markType);
      if (mark && markIds(mark).includes(id)) found = true;
      return true;
    }
    if (node.isBlock && ANCHOR_ATTRS.some((attr) => idList(node.attrs[attr]).includes(id))) found = true;
    return !found;
  });
  return found;
}

/** Anchor text per comment id, read from the rendered surface (one DOM pass;
 * cross-paragraph block anchors have no span yet, so absent ids stay absent). */
export function collectCommentAnchorTexts(editor: Editor): Map<string, string> {
  const out = new Map<string, string>();
  const root = editor.view.dom as HTMLElement | null;
  if (!root) return out;
  for (const span of root.querySelectorAll<HTMLElement>(".doc-comment")) {
    const text = span.textContent ?? "";
    for (const id of (span.dataset.commentIds ?? "").split(" ")) {
      if (id) out.set(id, (out.get(id) ?? "") + text);
    }
  }
  return out;
}

/** Scroll the first anchor of `id` into view and flash every piece of it. */
export function jumpToCommentAnchor(editor: Editor, id: string): boolean {
  const root = editor.view.dom as HTMLElement | null;
  if (!root) return false;
  const targets = [...root.querySelectorAll<HTMLElement>(".doc-comment")].filter((span) =>
    (span.dataset.commentIds ?? "").split(" ").includes(id),
  );
  const first = targets[0];
  if (!first) return false;
  if (typeof first.scrollIntoView === "function") first.scrollIntoView({ behavior: "smooth", block: "center" });
  for (const target of targets) {
    target.classList.remove("doc-comment-flash");
    void target.offsetWidth;
    target.classList.add("doc-comment-flash");
  }
  return true;
}
