import type { Node as PmNode } from "@tiptap/pm/model";
import type { Command, EditorState, Transaction } from "@tiptap/pm/state";
import type { Rect } from "@tiptap/pm/tables";
import { docxTableContext, type DocxTableContext } from "./table-selection";

/** One w:tcBorders side as the vendored converter stores it on the cell. */
export interface DocxBorderLine {
  style: string;
  szEighths?: number;
  color?: string;
}

/** Direct-formatting presets the table group offers. */
export type DocxTableBorderPreset = "grid" | "outline" | "none";

const SOLID: DocxBorderLine = { style: "single", szEighths: 4, color: "auto" };
const NONE: DocxBorderLine = { style: "none" };

type BorderSide = "top" | "right" | "bottom" | "left";
const SIDES: readonly BorderSide[] = ["top", "right", "bottom", "left"];

interface BorderEdges {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

function selectionEdges(cellRect: Rect, selection: Rect): BorderEdges {
  return {
    top: cellRect.top <= selection.top,
    bottom: cellRect.bottom >= selection.bottom,
    left: cellRect.left <= selection.left,
    right: cellRect.right >= selection.right,
  };
}

/** Rewrites the attrs of every distinct cell the selection covers (the whole
 * grid for a whole-table node selection). */
function mapSelectedCells(
  state: EditorState,
  ctx: DocxTableContext,
  patch: (cell: PmNode, edges: BorderEdges) => Record<string, unknown>,
): Transaction {
  const { rect } = ctx;
  const seen = new Set<number>();
  let tr = state.tr;
  for (let row = rect.top; row < rect.bottom; row += 1) {
    for (let col = rect.left; col < rect.right; col += 1) {
      const cellOffset = rect.map.map[row * rect.map.width + col];
      if (cellOffset === undefined || seen.has(cellOffset)) continue;
      seen.add(cellOffset);
      const pos = ctx.tableStart + cellOffset;
      const cell = state.doc.nodeAt(pos);
      if (!cell) continue;
      const cellRect = rect.map.findCell(cellOffset);
      tr = tr.setNodeMarkup(pos, undefined, patch(cell, selectionEdges(cellRect, rect)));
    }
  }
  return tr;
}

/**
 * Word's border presets over the selected cells: grid (All Borders) draws every
 * edge of every selected cell, outline draws only the selection's boundary,
 * none writes explicit no-borders and clears the table-level inside lines that
 * would otherwise survive (genoffice applyCellBorders semantics).
 */
export function applyTableBorderPreset(preset: DocxTableBorderPreset): Command {
  return (state, dispatch) => {
    const ctx = docxTableContext(state);
    if (!ctx) return false;
    let tr = mapSelectedCells(state, ctx, (cell, edges) => {
      const next: Record<string, DocxBorderLine> = {
        ...((cell.attrs.borders as Record<string, DocxBorderLine> | null) ?? {}),
      };
      for (const side of SIDES) {
        if (preset === "grid") next[side] = SOLID;
        else if (preset === "none") next[side] = NONE;
        else if (edges[side]) next[side] = SOLID;
      }
      return { ...cell.attrs, borders: next };
    });
    if (preset === "none") tr = clearTableInsideBorders(tr, ctx);
    dispatch?.(tr);
    return true;
  };
}

/** Cell shading (w:shd w:fill) over the selected cells; null clears the fill. */
export function applyCellFill(fill: string | null): Command {
  return (state, dispatch) => {
    const ctx = docxTableContext(state);
    if (!ctx) return false;
    dispatch?.(mapSelectedCells(state, ctx, (cell) => ({ ...cell.attrs, fill })));
    return true;
  };
}

/** Drops the table-level w:tblBorders inside lines so "No borders" holds. */
function clearTableInsideBorders(tr: Transaction, ctx: DocxTableContext): Transaction {
  const table = tr.doc.nodeAt(ctx.tablePos);
  if (!table || table.type.name !== "docTable") return tr;
  const prev = table.attrs.borders as Record<string, DocxBorderLine> | null;
  if (!prev || (!prev.insideH && !prev.insideV)) return tr;
  const rest: Record<string, DocxBorderLine> = { ...prev };
  delete rest.insideH;
  delete rest.insideV;
  return tr.setNodeMarkup(ctx.tablePos, undefined, {
    ...table.attrs,
    borders: Object.keys(rest).length > 0 ? rest : null,
  });
}
