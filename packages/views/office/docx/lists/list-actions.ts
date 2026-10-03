// B5 (UNI-924): the editor-side list operations the numbering command area
// drives. Every mutator either edits real blocks (toggle, level, restart,
// continue) or appends a pending numbering definition (the save writes the
// part those numIds point at), so a save carries both halves.
import type { Editor } from "@tiptap/core";
import type { Node as PmNode, NodeType } from "@tiptap/pm/model";
import type { DocxNewNumberingDef, DocxNumberingLevelSpec } from "@uniwork/office-engine/docx";
import { isParagraphBlock, readLevel } from "../paragraph/paragraph-format";
import {
  clonePresetLevels,
  DOCX_LIST_MAX_LEVEL,
  findRestartableDef,
  listDefsOf,
  listLevelInfos,
  nextListNumId,
  overlayDefForNew,
  overlayListDef,
  parseBackedListBaseline,
  type DocxListKind,
  type DocxListPreset,
  type DocxListState,
  type DocxNumberingSnapshot,
} from "./list-numbering";

interface ListBlockChange {
  /** Present only when the block type changes (paragraph <-> list item). */
  type?: NodeType;
  attrs?: Record<string, unknown>;
}

function editable(editor: Editor | null): Editor | null {
  return editor && !editor.isDestroyed && editor.isEditable ? editor : null;
}

function readNumId(attrs: Record<string, unknown>): string | null {
  return typeof attrs.numId === "string" && attrs.numId.length > 0 ? attrs.numId : null;
}

function listKindOf(node: PmNode): DocxListKind {
  return node.attrs.kind === "ordered" ? "ordered" : "bullet";
}

/** A block type may only be swapped where the parent's content expression
 * accepts the new type at that index (paragraph-commands.ts:52). */
function canHostBlock(parent: PmNode | null, index: number, type: NodeType): boolean {
  return parent !== null && parent.canReplaceWith(index, index, type);
}

/** Applies one change to every paragraph-family block the selection touches —
 * the same walk TipTap's updateAttributes does (paragraph-commands.ts:69). */
function updateSelectedListBlocks(
  editor: Editor,
  change: (node: PmNode, parent: PmNode | null, index: number) => ListBlockChange | null,
): boolean {
  const { state } = editor;
  const { from, to } = state.selection;
  const tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos, parent, index) => {
    if (!isParagraphBlock(node)) return true;
    const patch = change(node, parent, index);
    if (patch === null) return false;
    if (patch.type && !canHostBlock(parent, index, patch.type)) return false;
    tr.setNodeMarkup(pos, patch.type, { ...node.attrs, ...patch.attrs });
    changed = true;
    return false;
  });
  if (changed) editor.view.dispatch(tr.scrollIntoView());
  // Clicking a ribbon control must not steal the caret from the document.
  editor.commands.focus();
  return changed;
}

/** Append a brand-new definition (blank-template style, or the cloned levels
 * of a this-session preset) and overlay it so the editor draws markers before
 * the save writes the part. */
function createPendingListDef(
  editor: Editor,
  pending: DocxNumberingSnapshot,
  kind: DocxListKind,
  levels?: readonly DocxNumberingLevelSpec[],
): string {
  const numId = nextListNumId(listDefsOf(editor), pending);
  const def: DocxNewNumberingDef = { numId, kind, ...(levels ? { levels: clonePresetLevels(levels) } : {}) };
  pending.newDefs.push(def);
  overlayListDef(editor, overlayDefForNew(def));
  return numId;
}

/** A numId a new list can use right away: a restart num over a same-kind
 * abstractNum when the document already has one (counters start at 1), else a
 * new definition (genoffice allocateListNumId:93). */
function allocateListNumId(editor: Editor, pending: DocxNumberingSnapshot, kind: DocxListKind): string {
  const defs = listDefsOf(editor);
  const match = findRestartableDef(defs, pending, kind);
  if (!match) return createPendingListDef(editor, pending, kind);
  const numId = nextListNumId(defs, pending);
  const restart = { numId, abstractNumId: match.abstractNumId, startOverrides: { 0: 1 } };
  pending.restartNums.push(restart);
  overlayListDef(editor, { ...match, numId, startOverrides: { ...restart.startOverrides } });
  return numId;
}

/** The numbering-aware list toggle (the area's `toggleList` overrides the base
 * one — the runtime composes areas after base): a paragraph (or heading)
 * becomes a list item with a real numId, a same-kind list item goes back to a
 * plain paragraph. */
export function toggleDocxList(editor: Editor | null, pending: DocxNumberingSnapshot, kind: DocxListKind): boolean {
  const current = editable(editor);
  if (!current) return false;
  const caret = current.state.selection.$from.parent;
  if (caret.type.name === "docListItem" && listKindOf(caret) === kind) {
    const paragraph = current.schema.nodes.docParagraph;
    return updateSelectedListBlocks(current, (node) =>
      node.type.name === "docListItem" && listKindOf(node) === kind ? { type: paragraph, attrs: { styleId: null } } : null,
    );
  }
  // Allocate lazily, after a block accepts the new type: a selection that
  // changes nothing must not leave a pending definition behind (review F3).
  const listItem = current.schema.nodes.docListItem;
  if (!listItem) return false;
  let numId: string | null = null;
  return updateSelectedListBlocks(current, (node, parent, index) => {
    if (node.type.name === "docListItem" && listKindOf(node) === kind) return null;
    if (!canHostBlock(parent, index, listItem)) return null;
    if (numId === null) numId = allocateListNumId(current, pending, kind);
    return { type: listItem, attrs: { kind, numId, ilvl: 0 } };
  });
}

/** Applies a gallery preset: a brand-new definition with the preset's nine
 * levels (genoffice createCustomListDef:65), then the selection's blocks become
 * list items at level 1 under its numId. */
export function applyDocxListPreset(editor: Editor | null, pending: DocxNumberingSnapshot, preset: DocxListPreset): boolean {
  const current = editable(editor);
  if (!current) return false;
  const listItem = current.schema.nodes.docListItem;
  if (!listItem) return false;
  // Same lazy allocation as the toggle: a refused selection keeps no pending
  // definition (review F3).
  let numId: string | null = null;
  const ensureNumId = (): string => {
    if (numId === null) {
      numId = nextListNumId(listDefsOf(current), pending);
      pending.newDefs.push({ numId, kind: preset.kind, levels: clonePresetLevels(preset.levels) });
      overlayListDef(current, overlayDefForNew({ numId, kind: preset.kind, levels: preset.levels }));
    }
    return numId;
  };
  return updateSelectedListBlocks(current, (node, parent, index) => {
    if (numId !== null && node.type.name === "docListItem" && readNumId(node.attrs) === numId) return null;
    if (!canHostBlock(parent, index, listItem)) return null;
    return { type: listItem, attrs: { kind: preset.kind, numId: ensureNumId(), ilvl: 0 } };
  });
}

/** Sets the level (w:ilvl 0-8) of every list item the selection touches. */
export function setDocxListLevel(editor: Editor | null, ilvl: number): boolean {
  const current = editable(editor);
  if (!current || !Number.isInteger(ilvl) || ilvl < 0 || ilvl > DOCX_LIST_MAX_LEVEL) return false;
  return updateSelectedListBlocks(current, (node) => {
    if (node.type.name !== "docListItem") return null;
    return (readLevel(node.attrs.ilvl) ?? 0) === ilvl ? null : { attrs: { ilvl } };
  });
}

/** One level deeper or shallower for every list item the selection touches. */
export function stepDocxListLevel(editor: Editor | null, direction: 1 | -1): boolean {
  const current = editable(editor);
  if (!current) return false;
  return updateSelectedListBlocks(current, (node) => {
    if (node.type.name !== "docListItem") return null;
    const level = readLevel(node.attrs.ilvl) ?? 0;
    const next = Math.min(DOCX_LIST_MAX_LEVEL, Math.max(0, level + direction));
    return next === level ? null : { attrs: { ilvl: next } };
  });
}

/** The top-level block index of the selection start — the anchor a restart or
 * continue rewrites forward from. */
function topLevelIndexAtSelection(editor: Editor): number {
  const { doc, selection } = editor.state;
  if (doc.childCount === 0) return 0;
  const resolved = doc.resolve(Math.min(selection.from, doc.content.size));
  return Math.min(resolved.index(0), doc.childCount - 1);
}

interface ForwardListItem {
  offset: number;
  attrs: Record<string, unknown>;
}

/** The top-level list items sharing `numId` from the selection start onward —
 * the set restart/continue rewrites (genoffice rewriteNumIdForward:118). Items
 * nested inside a table are not top-level and stay put. */
function collectForwardListItems(editor: Editor, numId: string): ForwardListItem[] {
  const startIdx = topLevelIndexAtSelection(editor);
  const items: ForwardListItem[] = [];
  editor.state.doc.forEach((node, offset, index) => {
    if (index < startIdx) return;
    if (node.type.name !== "docListItem" || readNumId(node.attrs) !== numId) return;
    items.push({ offset, attrs: node.attrs as Record<string, unknown> });
  });
  return items;
}

function applyListNumId(editor: Editor, items: readonly ForwardListItem[], newNumId: string): boolean {
  if (items.length === 0) return false;
  const tr = editor.state.tr;
  for (const item of items) tr.setNodeMarkup(item.offset, undefined, { ...item.attrs, numId: newNumId });
  editor.view.dispatch(tr);
  return true;
}

/** Restart numbering at the selection: a new num over the same abstractNum
 * with a w:startOverride at the item's level, and the items from here on moved
 * to it (genoffice restartNumbering:138). A list item whose numId has no
 * parse-backed definition gets a fresh one instead, which starts at 1 by
 * construction: a definition this session created (or a stale overlay) points
 * at a `pending-*` abstractNumId the save oracle refuses to restart over
 * (review F1), and a preset's levels are cloned so the list keeps its look. */
export function restartDocxListNumbering(editor: Editor | null, pending: DocxNumberingSnapshot): boolean {
  const current = editable(editor);
  if (!current) return false;
  const caret = current.state.selection.$from.parent;
  if (caret.type.name !== "docListItem") return false;
  const oldNumId = readNumId(caret.attrs);
  if (oldNumId === null) return false;
  const items = collectForwardListItems(current, oldNumId);
  if (items.length === 0) return false;
  const ilvl = readLevel(caret.attrs.ilvl) ?? 0;
  const defs = listDefsOf(current);
  const def = defs.get(oldNumId);
  const abstractNumIds = parseBackedListBaseline(current).abstractNumIds;
  let numId: string;
  if (def && abstractNumIds.has(def.abstractNumId)) {
    numId = nextListNumId(defs, pending);
    const restart = { numId, abstractNumId: def.abstractNumId, startOverrides: { [ilvl]: 1 } };
    pending.restartNums.push(restart);
    overlayListDef(current, { ...def, numId, startOverrides: { ...restart.startOverrides } });
  } else {
    const source = pending.newDefs.find((entry) => entry.numId === oldNumId);
    numId = createPendingListDef(current, pending, listKindOf(caret), source?.levels);
  }
  return applyListNumId(current, items, numId);
}

/** Continue numbering: merge the selection's items back into the previous
 * list's numId so the count carries on (genoffice continueNumbering:165). */
export function continueDocxListNumbering(editor: Editor | null): boolean {
  const current = editable(editor);
  if (!current) return false;
  const caret = current.state.selection.$from.parent;
  if (caret.type.name !== "docListItem") return false;
  const currentNumId = readNumId(caret.attrs);
  if (currentNumId === null) return false;
  const items = collectForwardListItems(current, currentNumId);
  if (items.length === 0) return false;
  const startIdx = topLevelIndexAtSelection(current);
  let previous: string | null = null;
  current.state.doc.forEach((node, _offset, index) => {
    if (index >= startIdx) return;
    if (node.type.name !== "docListItem") return;
    const numId = readNumId(node.attrs);
    if (numId !== null && numId !== currentNumId) previous = numId;
  });
  if (previous === null) return false;
  return applyListNumId(current, items, previous);
}

/** The caret's list context, with the definition's levels for the picker;
 * null when the caret is not in a list item. */
export function readDocxListState(editor: Editor | null): DocxListState | null {
  if (!editor || editor.isDestroyed) return null;
  const node = editor.state.selection.$from.parent;
  if (node.type.name !== "docListItem") return null;
  const numId = readNumId(node.attrs);
  return {
    kind: listKindOf(node),
    numId: numId ?? "",
    ilvl: readLevel(node.attrs.ilvl) ?? 0,
    levels: listLevelInfos(numId === null ? undefined : listDefsOf(editor).get(numId)),
  };
}
