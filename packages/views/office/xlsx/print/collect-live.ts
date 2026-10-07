// UNI-952 (D2-xlsx): what the mounted grid paints, for print. The renderer's
// readPrintRange returns each cell's composed style through its view model
// (session style edits and conditional-format colours included - the same
// evaluated result the canvas draws; nothing is re-evaluated here) plus live
// row heights, column widths, visibility and merges. This module turns that
// into the copy builder's inputs: live styles are appended after the file's
// style table (deduplicated) so the builder's per-index classes still apply.
// D3: the data bars and icons the canvas paints come along as marks (the CF
// view model's evaluated result, absent from older bundles).
import type { XlsxRenderBorderEdge, XlsxRenderStyle } from "@uniwork/office-engine/xlsx";
import type { XlsxVisualsGrid } from "../visuals/use-xlsx-visuals";
import type { XlsxPrintMark } from "./print-marks";
import type { XlsxPrintRange } from "./print-setup";

type LiveEdge = { readonly style: string; readonly color?: string | undefined } | null | undefined;

/** One composed cell style in the renderer-neutral wire shape. */
interface XlsxLiveCellStyle {
  readonly bold?: boolean | undefined;
  readonly italic?: boolean | undefined;
  readonly underline?: boolean | undefined;
  readonly strikethrough?: boolean | undefined;
  readonly fontFamily?: string | undefined;
  readonly fontSize?: number | undefined;
  readonly fontColor?: string | null | undefined;
  readonly fillColor?: string | null | undefined;
  readonly horizontalAlignment?: string | undefined;
  readonly verticalAlignment?: string | undefined;
  readonly wrapText?: boolean | undefined;
  readonly textRotation?: number | undefined;
  readonly indent?: number | undefined;
  readonly numberFormat?: string | undefined;
  readonly borderTop?: LiveEdge;
  readonly borderBottom?: LiveEdge;
  readonly borderLeft?: LiveEdge;
  readonly borderRight?: LiveEdge;
}

/** The renderer's print read of one range (sizes in unzoomed pixels). */
interface XlsxLivePrintRange {
  readonly styles: readonly (readonly (XlsxLiveCellStyle | null)[])[];
  readonly rows: readonly { readonly height: number; readonly hidden: boolean }[];
  readonly columns: readonly { readonly width: number; readonly hidden: boolean }[];
  readonly merges: readonly XlsxPrintRange[];
  readonly marks?: readonly (XlsxPrintMark & { readonly row: number; readonly column: number })[] | undefined;
}

/** The grid members print reads; every one optional (older bundles and test
 *  doubles print from the model instead). */
export interface XlsxPrintGrid extends XlsxVisualsGrid {
  readPrintRange?(sheetId: string, range: XlsxPrintRange): XlsxLivePrintRange | null;
}

const PT_PER_PX = 0.75;

const edge = (value: LiveEdge): XlsxRenderBorderEdge | undefined =>
  value ? { style: value.style, ...(value.color ? { color: value.color } : {}) } : undefined;

/** A live style as a render-model style (absent = Excel's default). */
function renderStyleOf(live: XlsxLiveCellStyle): XlsxRenderStyle {
  const optional = {
    fontFamily: live.fontFamily,
    fontSize: live.fontSize,
    fontColor: live.fontColor ?? undefined,
    fillColor: live.fillColor ?? undefined,
    horizontalAlignment: live.horizontalAlignment,
    verticalAlignment: live.verticalAlignment,
    indent: live.indent,
    textRotation: live.textRotation,
    numberFormat: live.numberFormat,
    borderTop: edge(live.borderTop),
    borderBottom: edge(live.borderBottom),
    borderLeft: edge(live.borderLeft),
    borderRight: edge(live.borderRight),
  };
  const present = Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined));
  return {
    bold: live.bold === true,
    italic: live.italic === true,
    underline: live.underline === true,
    strikethrough: live.strikethrough === true,
    wrapText: live.wrapText === true,
    diagonalUp: false,
    diagonalDown: false,
    ...present,
  };
}

const edgeKey = (value: LiveEdge): string => (value ? `${value.style}/${value.color ?? ""}` : "");

/** A cheap identity for a live style: every field in a fixed order, so
 *  equal styles share one key without building and serialising the
 *  render-model style for every cell (R5: 400k cells took 1.9 s, now 0.6-0.8 s
 *  in jsdom). */
function liveKey(live: XlsxLiveCellStyle): string {
  return [
    live.bold, live.italic, live.underline, live.strikethrough, live.fontFamily, live.fontSize, live.fontColor, live.fillColor,
    live.horizontalAlignment, live.verticalAlignment, live.wrapText, live.textRotation, live.indent, live.numberFormat,
    edgeKey(live.borderTop), edgeKey(live.borderBottom), edgeKey(live.borderLeft), edgeKey(live.borderRight),
  ].join("\u0000");
}

/** Collects live reads into one style table, sizes and merges. */
export class XlsxLiveLayout {
  readonly styles: XlsxRenderStyle[];
  readonly rows = new Map<number, { height: number; hidden?: boolean }>();
  readonly columns = new Map<number, { width: number; hidden?: boolean }>();
  readonly merges: XlsxPrintRange[] = [];
  /** Data bars / icons by `${row}:${column}`. */
  readonly marks = new Map<string, XlsxPrintMark>();
  private readonly styleIndex = new Map<string, number>();
  private readonly liveIndex = new Map<string, number>();
  private readonly cellStyles = new Map<string, number | null>();
  private readonly mergeKeys = new Set<string>();

  constructor(fileStyles: readonly XlsxRenderStyle[]) {
    this.styles = [...fileStyles];
  }

  /** Fold one read; false when the grid could not answer (print uses the model). */
  add(range: XlsxPrintRange, live: XlsxLivePrintRange | null | undefined): boolean {
    if (!live) return false;
    live.styles.forEach((line, rowOffset) => line.forEach((style, columnOffset) => {
      this.cellStyles.set(`${range.startRow + rowOffset}:${range.startColumn + columnOffset}`, style ? this.internLive(style) : null);
    }));
    live.rows.forEach((row, offset) => {
      this.rows.set(range.startRow + offset, { height: row.height * PT_PER_PX, ...(row.hidden ? { hidden: true } : {}) });
    });
    live.columns.forEach((column, offset) => {
      this.columns.set(range.startColumn + offset, { width: column.width * PT_PER_PX, ...(column.hidden ? { hidden: true } : {}) });
    });
    for (const merge of live.merges) {
      const mergeKey = `${merge.startRow}:${merge.endRow}:${merge.startColumn}:${merge.endColumn}`;
      if (this.mergeKeys.has(mergeKey)) continue;
      this.mergeKeys.add(mergeKey);
      this.merges.push({ startRow: merge.startRow, endRow: merge.endRow, startColumn: merge.startColumn, endColumn: merge.endColumn });
    }
    for (const { row, column, dataBar, icon, hideValue } of live.marks ?? []) {
      this.marks.set(`${row}:${column}`, { ...(dataBar ? { dataBar } : {}), ...(icon ? { icon } : {}), ...(hideValue ? { hideValue } : {}) });
    }
    return true;
  }

  /** The live style index of a cell: a number, null (no style), or
   *  undefined when the cell was not read live. */
  styleAt(row: number, column: number): number | null | undefined {
    return this.cellStyles.get(`${row}:${column}`);
  }

  private internLive(live: XlsxLiveCellStyle): number {
    const key = liveKey(live);
    const known = this.liveIndex.get(key);
    if (known !== undefined) return known;
    const index = this.intern(renderStyleOf(live));
    this.liveIndex.set(key, index);
    return index;
  }

  private intern(style: XlsxRenderStyle): number {
    const styleKey = JSON.stringify(style);
    const known = this.styleIndex.get(styleKey);
    if (known !== undefined) return known;
    this.styles.push(style);
    this.styleIndex.set(styleKey, this.styles.length - 1);
    return this.styles.length - 1;
  }
}
