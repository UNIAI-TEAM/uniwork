"use client";

// Design review X1: Home > Styles > Cell Styles. The pinned engine has no
// named-cell-style write path, so each preset is the Office built-in style's
// look applied as DIRECT formatting through the allowlisted
// `sheet.command.set-range-values` (style only: the pinned mutation merges `s`
// into each cell and leaves its value alone), one undo step. The file keeps
// ordinary cell formatting, not a named style; the menu says so. "Normal" is
// Excel's reset and maps to the allowlisted clear-format command.
//
// The colours are document data (what the cell will carry in the saved file,
// the Office preset values), not UI chrome, so they are literal here.

import { useState, type CSSProperties } from "react";
import { SwatchBook } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { XLSX_CLIENT_MAX_EDIT_OPS } from "../xlsx-clipboard";
import { fireCommand } from "../fire-command";
import { selectionSpan, type XlsxSelectionSpan } from "./structure-insert";
import { XlsxLargeButton, XlsxLargeLabel } from "./group-layout";
import type { XlsxToolbarGroupProps } from "./types";

/** The Univer style fields a preset writes (`IStyleData` subset). */
export interface XlsxCellStyle {
  readonly bg?: { readonly rgb: string };
  readonly cl?: { readonly rgb: string };
  readonly bl?: 0 | 1;
  readonly fs?: number;
}

export type XlsxCellStylePresetId =
  | "normal" | "good" | "bad" | "neutral" | "input" | "calculation" | "title" | "heading1" | "heading2";

/** Office's built-in "Good, Bad and Neutral", "Data and Model" and "Titles
 *  and Headings" looks. `normal` has no style: it clears the formatting. */
export const XLSX_CELL_STYLE_PRESETS: readonly { readonly id: XlsxCellStylePresetId; readonly style: XlsxCellStyle | null }[] = [
  { id: "normal", style: null },
  { id: "good", style: { bg: { rgb: "#C6EFCE" }, cl: { rgb: "#006100" } } },
  { id: "bad", style: { bg: { rgb: "#FFC7CE" }, cl: { rgb: "#9C0006" } } },
  { id: "neutral", style: { bg: { rgb: "#FFEB9C" }, cl: { rgb: "#9C5700" } } },
  { id: "input", style: { bg: { rgb: "#FFCC99" }, cl: { rgb: "#3F3F76" } } },
  { id: "calculation", style: { bg: { rgb: "#F2F2F2" }, cl: { rgb: "#FA7D00" }, bl: 1 } },
  { id: "title", style: { fs: 18, cl: { rgb: "#44546A" } } },
  { id: "heading1", style: { fs: 15, bl: 1, cl: { rgb: "#44546A" } } },
  { id: "heading2", style: { fs: 13, bl: 1, cl: { rgb: "#44546A" } } },
];

export const XLSX_CELL_STYLE_COMMAND = "sheet.command.set-range-values";
export const XLSX_CLEAR_FORMAT_COMMAND = "sheet.command.clear-selection-format";

/** The style-only `set-range-values` payload over the span, or null when the
 *  span has more cells than one save job may edit (never partially styled). */
export function cellStyleParams(
  span: XlsxSelectionSpan,
  unitId: string,
  subUnitId: string,
  style: XlsxCellStyle,
): { unitId: string; subUnitId: string; range: Omit<XlsxSelectionSpan, "rows" | "columns">; value: Record<string, Record<string, { s: XlsxCellStyle }>> } | null {
  if (span.rows * span.columns > XLSX_CLIENT_MAX_EDIT_OPS) return null;
  const value: Record<string, Record<string, { s: XlsxCellStyle }>> = {};
  for (let row = span.startRow; row <= span.endRow; row += 1) {
    const cells: Record<string, { s: XlsxCellStyle }> = {};
    for (let column = span.startColumn; column <= span.endColumn; column += 1) cells[String(column)] = { s: style };
    value[String(row)] = cells;
  }
  const { startRow, endRow, startColumn, endColumn } = span;
  return { unitId, subUnitId, range: { startRow, endRow, startColumn, endColumn }, value };
}

function previewStyle(style: XlsxCellStyle | null): CSSProperties {
  if (style === null) return {};
  return {
    ...(style.bg ? { backgroundColor: style.bg.rgb } : {}),
    ...(style.cl ? { color: style.cl.rgb } : {}),
    ...(style.bl ? { fontWeight: 600 } : {}),
  };
}

export function XlsxCellStylesMenu({ readOnly = false, commands, selection, unitId, sheetName, resolveSheetId }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [limitError, setLimitError] = useState(false);
  const span = selectionSpan(selection);
  const sheetId = sheetName ? resolveSheetId?.(sheetName) : undefined;
  const blocked = readOnly || !commands || span === null || sheetId === undefined || unitId == null;
  const label = t("office.xlsx.styles.cellStyles");

  const apply = (style: XlsxCellStyle | null) => {
    setLimitError(false);
    if (blocked || span === null || sheetId === undefined || unitId == null) return;
    if (style === null) {
      fireCommand(commands, XLSX_CLEAR_FORMAT_COMMAND);
      return;
    }
    const params = cellStyleParams(span, unitId, sheetId, style);
    if (params === null) {
      setLimitError(true);
      return;
    }
    fireCommand(commands, XLSX_CELL_STYLE_COMMAND, params);
  };

  return (
    <div className="flex h-full min-h-0 items-stretch gap-1">
      <DropdownMenu
        open={open && !blocked}
        onOpenChange={(next) => {
          if (!next || !blocked) setOpen(next);
        }}
      >
        <DropdownMenuTrigger
          render={
            <XlsxLargeButton aria-label={label} title={label} aria-disabled={blocked || undefined} data-testid="xlsx-cell-styles" />
          }
        >
          <SwatchBook aria-hidden />
          <XlsxLargeLabel>{label}</XlsxLargeLabel>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {XLSX_CELL_STYLE_PRESETS.map((preset) => (
            <DropdownMenuItem key={preset.id} data-testid={`xlsx-cell-style-${preset.id}`} onClick={() => apply(preset.style)}>
              <span
                className="min-w-0 flex-1 truncate rounded-sm border border-border px-1.5 py-0.5"
                style={previewStyle(preset.style)}
              >
                {t(`office.xlsx.styles.presets.${preset.id}`)}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <p className="max-w-56 px-2 py-1 text-caption text-muted-foreground">{t("office.xlsx.styles.cellStylesNote")}</p>
        </DropdownMenuContent>
      </DropdownMenu>
      {limitError ? (
        <p role="alert" className="max-w-40 text-caption leading-tight text-destructive" data-testid="xlsx-cell-styles-limit">
          {t("office.xlsx.styles.limitExceeded", { limit: XLSX_CLIENT_MAX_EDIT_OPS })}
        </p>
      ) : null}
    </div>
  );
}
