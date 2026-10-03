"use client";

import { Columns3, Eye, EyeOff, RotateCcw, Rows3 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { selectionSpan } from "./structure-insert";
import type { XlsxToolbarGroupProps } from "./types";

/** Excel's own ceilings: row height 409.5 points, column width 255 character
 *  units. The top of the row range is clamped to a whole point. */
export const XLSX_ROW_HEIGHT_MIN_POINTS = 1;
export const XLSX_ROW_HEIGHT_MAX_POINTS = 409;
export const XLSX_COLUMN_WIDTH_MIN = 1;
export const XLSX_COLUMN_WIDTH_MAX = 255;
/** Calibri 11's max digit width in px — the vendored renderer's default
 *  workbook mdw, so a width typed in character units round-trips at the
 *  default Normal font. Known limitation: the renderer journals px→charWidth
 *  with the workbook's measured mdw, which the commands port exposes no read
 *  for, so another Normal font persists at w*7/mdw. Follow-up: pass character
 *  units to a UniWork command and convert with the real mdw shim-side. */
export const XLSX_COLUMN_WIDTH_MDW = 7;

/** Character width → Univer pixels at the renderer's default mdw. */
export function characterWidthToPixels(width: number): number {
  return Math.max(1, Math.round(width * XLSX_COLUMN_WIDTH_MDW));
}

/** Points → Univer pixels (1 pt = 4/3 px at 96 dpi), the inverse of the
 *  renderer journal's px * 0.75 conversion. */
export function pointsToPixels(points: number): number {
  return Math.max(1, Math.round((points * 4) / 3));
}

/** A positive decimal draft inside [min, max]; null keeps the last value. */
export function parseBoundedNumber(draft: string, min: number, max: number): number | null {
  const trimmed = draft.trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return null;
  const parsed = Number.parseFloat(trimmed);
  return parsed >= min && parsed <= max ? parsed : null;
}

/** Home tab: row height / column width for the selection's lines, plus
 *  hide/unhide for the selection's rows and columns. Sizes are entered in
 *  file units (points for rows, character width for columns) and converted to
 *  the renderer's pixels before the command runs. */
export function XlsxStructureSizeGroup({ readOnly = false, selection, commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const span = selectionSpan(selection);
  const blocked = readOnly || !commands || !span;
  const [heightDraft, setHeightDraft] = useState("15");
  const [widthDraft, setWidthDraft] = useState("8.43");

  const run = (id: string, params?: unknown) => {
    if (blocked) return;
    commands?.execute(id, params);
  };
  const ranges = span === null ? [] : [
    { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn },
  ];
  const applyHeight = () => {
    const points = parseBoundedNumber(heightDraft, XLSX_ROW_HEIGHT_MIN_POINTS, XLSX_ROW_HEIGHT_MAX_POINTS);
    if (points === null) return;
    run("sheet.command.set-row-height", { value: pointsToPixels(points) });
  };
  const applyWidth = () => {
    const width = parseBoundedNumber(widthDraft, XLSX_COLUMN_WIDTH_MIN, XLSX_COLUMN_WIDTH_MAX);
    if (width === null) return;
    run("sheet.command.set-worksheet-col-width", { value: characterWidthToPixels(width) });
  };

  return (
    <>
      <Rows3 aria-hidden className="text-muted-foreground" />
      <Input
        className="h-7 w-12 px-1 text-center text-caption"
        inputMode="decimal"
        aria-label={t("office.xlsx.structure.rowHeight")}
        disabled={blocked}
        value={heightDraft}
        onChange={(event) => setHeightDraft(event.target.value)}
        onBlur={applyHeight}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          applyHeight();
        }}
      />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.resetRowHeight")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.set-row-is-auto-height")}
      >
        <RotateCcw aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.hideRows")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.set-rows-hidden", { ranges })}
      >
        <EyeOff aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.showRows")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.set-specific-rows-visible", { ranges })}
      >
        <Eye aria-hidden />
      </Button>
      <Columns3 aria-hidden className="text-muted-foreground" />
      <Input
        className="h-7 w-12 px-1 text-center text-caption"
        inputMode="decimal"
        aria-label={t("office.xlsx.structure.colWidth")}
        disabled={blocked}
        value={widthDraft}
        onChange={(event) => setWidthDraft(event.target.value)}
        onBlur={applyWidth}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          applyWidth();
        }}
      />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.resetColWidth")}
        aria-disabled={blocked || undefined}
        onClick={() => {
          if (span === null) return;
          run("uniwork.command.set-cols-default-width", { start: span.startColumn, end: span.endColumn });
        }}
      >
        <RotateCcw aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.hideCols")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.set-col-hidden", { ranges })}
      >
        <EyeOff aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.showCols")}
        aria-disabled={blocked || undefined}
        onClick={() => run("sheet.command.set-col-visible-on-cols", { ranges })}
      >
        <Eye aria-hidden />
      </Button>
    </>
  );
}
