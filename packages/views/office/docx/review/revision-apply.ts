// A12 (UNI-924): accept/reject operations over one live TipTap editor.
//
// Port of the vendored renderer's revisions.ts apply pass
// (packages/office-upstream/upstream/apps/docs/src/renderer/editor/revisions.ts)
// — the DOCX browser bundle does not export it. The operations mutate exactly
// the marks and node attrs the save plan reads (ins/del/rprChange marks,
// blockRevision/pPrChange attrs, row/cell markers + their raw trPr/tcPr), so
// an accepted or rejected change serializes like any other edit; no save-path
// or engine change is involved. Keep step with the vendored module.
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { DocxReviewChange } from "./revision-model";

/** Transactions carrying this meta are never recorded as new revisions. */
const TRACK_IGNORE = "trackIgnore";

const TEXT_STYLE_FIELDS = [
  "color",
  "sizeHalfPoints",
  "font",
  "fontAscii",
  "charSpacingTwips",
  "charScaleEm",
  "highlight",
  "vertAlign",
  "styleId",
] as const;

const PARAGRAPH_FORMAT_FIELDS = [
  "align",
  "lineSpacing",
  "lineRule",
  "lineRawTwips",
  "indentLeft",
  "indentRight",
  "indentFirstLine",
  "spaceBefore",
  "spaceAfter",
  "pageBreakBefore",
  "shadingFill",
  "borders",
  "tabStops",
  "dropCap",
  "bidi",
] as const;

const PARAGRAPH_STRUCTURE_FIELDS = ["styleId", "level", "kind", "numId", "ilvl"] as const;

/** Strip a tracked-change marker element from raw trPr/tcPr bytes; empty container → null. */
function stripTrackMarker(raw: string | null, tag: string, container: string): string | null {
  if (!raw) return raw;
  const out = raw
    .replace(new RegExp(`<${tag}[^>]*/>`, "g"), "")
    .replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "g"), "");
  if (new RegExp(`^<${container}(?:\\s[^>]*)?>\\s*</${container}>$`).test(out)) return null;
  return out;
}

/**
 * Apply accept/reject to `changes` (reverse document order so earlier
 * positions stay valid). Returns true when the document actually changed.
 */
export function applyReviewChanges(
  editor: Editor,
  changes: readonly DocxReviewChange[],
  mode: "accept" | "reject",
): boolean {
  if (changes.length === 0) return false;
  const { state } = editor;
  const tr = state.tr;
  tr.setMeta(TRACK_IGNORE, true);

  for (const r of [...changes].sort((left, right) => right.from - left.from)) {
    if (r.kind === "blockIns" || r.kind === "blockDel") {
      const revisionKind = r.kind === "blockIns" ? "ins" : "del";
      const removeNode = mode === "accept" ? revisionKind === "del" : revisionKind === "ins";
      const nodePos = tr.mapping.map(r.from, -1);
      const node = tr.doc.nodeAt(nodePos);
      if (!node) continue;
      if (removeNode) {
        if (tr.doc.childCount > 1) tr.delete(nodePos, nodePos + node.nodeSize);
      } else {
        tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, blockRevision: null });
      }
      continue;
    }

    if (r.kind === "pPrChange") {
      const $pos = state.doc.resolve(Math.min(r.from + 1, state.doc.content.size));
      if ($pos.parent.attrs && $pos.parent.attrs.pPrChange != null) {
        const nodePos = $pos.before($pos.depth);
        if (mode === "reject") {
          const oldFormatStr = $pos.parent.attrs.pPrChange as string;
          let old: Record<string, unknown> = {};
          try {
            const info = JSON.parse(oldFormatStr) as { old?: Record<string, unknown>; oldAlign?: unknown };
            old = (info?.old ?? {}) as Record<string, unknown>;
            if (info?.oldAlign !== undefined) old = { ...old, align: info.oldAlign };
          } catch {
            /* malformed snapshot: keep the current format */
          }
          const oldFormat = (
            old.format && typeof old.format === "object" ? old.format : old
          ) as Record<string, unknown>;
          const restore: Record<string, unknown> = {};
          for (const field of PARAGRAPH_FORMAT_FIELDS) restore[field] = oldFormat[field] ?? null;
          if (typeof old.type === "string") {
            for (const field of PARAGRAPH_STRUCTURE_FIELDS) restore[field] = old[field] ?? null;
          }
          const oldTypeName = typeof old.type === "string" ? old.type : $pos.parent.type.name;
          const oldType = state.schema.nodes[oldTypeName] ?? $pos.parent.type;
          tr.setNodeMarkup(nodePos, oldType, {
            ...$pos.parent.attrs,
            pPrChange: null,
            ...restore,
          });
        } else {
          // accept: keep the current format, drop the recorded snapshot
          tr.setNodeMarkup(nodePos, undefined, { ...$pos.parent.attrs, pPrChange: null });
        }
      }
      continue;
    }

    if (r.kind === "rPrChange") {
      // accept = keep the current format; reject = restore the pre-revision
      // modeled format subset. Both clear the mark and strip the w:rPrChange
      // record from rawRPr (takes effect on save).
      state.doc.nodesBetween(r.from, r.to, (node, pos) => {
        if (!node.isText) return;
        const from = Math.max(pos, r.from);
        const to = Math.min(pos + node.nodeSize, r.to);
        const rpr = node.marks.find((mark) => mark.type.name === "rprChange");
        const textStyle = node.marks.find((mark) => mark.type.name === "docTextStyle");
        if (mode === "reject" && rpr) {
          const old = (rpr.attrs.old ?? {}) as Record<string, unknown>;
          for (const flag of ["bold", "italic", "underline", "strike"] as const) {
            const markType = state.schema.marks[flag];
            if (!markType) continue;
            if (old[flag]) tr.addMark(from, to, markType.create());
            else tr.removeMark(from, to, markType);
          }
          const textStyleType = state.schema.marks.docTextStyle;
          if (textStyleType) {
            const baseAttrs = textStyle ? { ...textStyle.attrs } : {};
            const nextAttrs: Record<string, unknown> = { ...baseAttrs };
            for (const field of TEXT_STYLE_FIELDS) nextAttrs[field] = old[field] ?? null;
            // rawRPr carries the new format plus the revision record: rebuild
            // instead of preserving it on a reject.
            nextAttrs.rawRPr = null;
            const hasAny = TEXT_STYLE_FIELDS.some(
              (field) => nextAttrs[field] !== null && nextAttrs[field] !== undefined,
            );
            if (textStyle || hasAny) tr.addMark(from, to, textStyleType.create(nextAttrs));
          }
        }
        if (textStyle?.attrs.rawRPr && /<w:rPrChange/.test(String(textStyle.attrs.rawRPr))) {
          const raw = String(textStyle.attrs.rawRPr).replace(
            /<w:rPrChange[\s\S]*?<\/w:rPrChange>|<w:rPrChange[^>]*\/>/,
            "",
          );
          const current = mode === "reject" ? null : textStyle;
          if (current) tr.addMark(from, to, current.type.create({ ...current.attrs, rawRPr: raw }));
        }
      });
      tr.removeMark(r.from, r.to, state.schema.marks.rprChange);
      continue;
    }

    if (r.kind === "moveFrom" || r.kind === "moveTo") {
      const effectiveKind = r.kind === "moveFrom" ? "del" : "ins";
      const removeText = mode === "accept" ? effectiveKind !== "ins" : effectiveKind !== "del";
      if (removeText) {
        const $from = state.doc.resolve(r.from);
        const $to = state.doc.resolve(Math.min(r.to, state.doc.content.size));
        if ($from.depth >= 1 && $from.sameParent($to) && state.doc.childCount > 1) {
          tr.delete($from.before(), $to.after());
        } else {
          tr.delete(r.from, r.to);
        }
      } else if (mode === "accept") {
        tr.removeMark(r.from, r.to, state.schema.marks.ins);
      } else {
        tr.removeMark(r.from, r.to, state.schema.marks.del);
      }
      try {
        const $pos = state.doc.resolve(Math.min(r.from + 1, state.doc.content.size));
        const nodePos = $pos.before($pos.depth);
        if ($pos.parent.attrs?.moveRevision) {
          tr.setNodeMarkup(nodePos, undefined, { ...$pos.parent.attrs, moveRevision: null });
        }
      } catch {
        /* the node is being deleted */
      }
      continue;
    }

    if (r.kind === "rowIns" || r.kind === "rowDel" || r.kind === "cellIns" || r.kind === "cellDel") {
      const isRow = r.kind === "rowIns" || r.kind === "rowDel";
      const revisionKind = r.kind === "rowIns" || r.kind === "cellIns" ? "ins" : "del";
      const removeNode = mode === "accept" ? revisionKind === "del" : revisionKind === "ins";
      const node = state.doc.nodeAt(r.from);
      if (!node) continue;
      if (removeNode && isRow) {
        // accepting a deleted row / rejecting an inserted row removes the row;
        // the only row takes the whole table
        const $pos = state.doc.resolve(r.from);
        if ($pos.parent.childCount <= 1) tr.delete($pos.before(), $pos.after());
        else tr.delete(r.from, r.to);
      } else if (removeNode) {
        // a cell cannot be removed outright (the table grid would re-add an
        // empty one): clear it in place and strip the marker
        tr.setNodeMarkup(r.from, undefined, {
          ...node.attrs,
          cellRevision: null,
          rawTcPr: stripTrackMarker(
            node.attrs.rawTcPr as string | null,
            revisionKind === "ins" ? "w:cellIns" : "w:cellDel",
            "w:tcPr",
          ),
        });
        const paragraphType = state.schema.nodes.docParagraph;
        const empty = paragraphType ? paragraphType.createAndFill() : null;
        if (empty) tr.replaceWith(r.from + 1, r.to - 1, empty);
      } else {
        // keep the content: clear the marker and strip the record from the raw
        // trPr/tcPr bytes (takes effect on save)
        const attrs = isRow
          ? {
              ...node.attrs,
              rowRevision: null,
              rawTrPr: stripTrackMarker(
                node.attrs.rawTrPr as string | null,
                revisionKind === "ins" ? "w:ins" : "w:del",
                "w:trPr",
              ),
            }
          : {
              ...node.attrs,
              cellRevision: null,
              rawTcPr: stripTrackMarker(
                node.attrs.rawTcPr as string | null,
                revisionKind === "ins" ? "w:cellIns" : "w:cellDel",
                "w:tcPr",
              ),
            };
        tr.setNodeMarkup(r.from, undefined, attrs);
        const markType = state.schema.marks[revisionKind];
        if (markType) tr.removeMark(r.from + 1, r.to - 1, markType);
      }
      continue;
    }

    const removeText = mode === "accept" ? r.kind !== "ins" : r.kind !== "del";
    if (removeText) {
      // a revision covering a block's whole content removes the block itself
      // (rejecting an inserted paragraph deletes the paragraph, not just its
      // text), unless it is the document's last remaining block
      const $from = state.doc.resolve(r.from);
      const $to = state.doc.resolve(Math.min(r.to, state.doc.content.size));
      if (
        $from.parent.isTextblock &&
        $from.sameParent($to) &&
        r.from === $from.start() &&
        r.to === $to.end() &&
        $from.depth === 1 &&
        state.doc.childCount > 1
      ) {
        tr.delete($from.before(), $to.after());
      } else {
        tr.delete(r.from, r.to);
      }
    } else if (mode === "accept") {
      tr.removeMark(r.from, r.to, state.schema.marks.ins);
    } else {
      tr.removeMark(r.from, r.to, state.schema.marks.del);
    }
  }

  tr.setMeta(TRACK_IGNORE, true);
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/** Move the selection onto the change and scroll it into view. */
export function jumpToReviewChange(editor: Editor, change: DocxReviewChange): boolean {
  const { state } = editor;
  const max = state.doc.content.size;
  const from = Math.max(0, Math.min(change.from, max));
  const to = Math.max(from, Math.min(change.to, max));
  const tr = state.tr;
  tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)));
  tr.scrollIntoView();
  tr.setMeta(TRACK_IGNORE, true);
  editor.view.dispatch(tr);
  return true;
}
