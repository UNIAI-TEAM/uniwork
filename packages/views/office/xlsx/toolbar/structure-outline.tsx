"use client";

import { ChevronsDown, ChevronsUp, CircleX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { selectionSpan, type XlsxSelectionSpan } from "./structure-insert";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";

/** One outline action per axis, resolved by the controller's registered
 *  command (the pinned Univer has no outline model, so these two commands
 *  journal the level change directly). */
export type XlsxOutlineAction = "group" | "ungroup" | "clear";

export function outlineCommandId(axis: "rows" | "cols"): string {
  return axis === "rows" ? "uniwork.command.set-rows-outline" : "uniwork.command.set-cols-outline";
}

/** The 0-based inclusive line span the action applies to on its axis. */
export function outlineCommandParams(
  span: XlsxSelectionSpan,
  axis: "rows" | "cols",
  action: XlsxOutlineAction,
): { start: number; end: number; action: XlsxOutlineAction } {
  return axis === "rows"
    ? { start: span.startRow, end: span.endRow, action }
    : { start: span.startColumn, end: span.endColumn, action };
}

/** Data tab: outline group/ungroup for the selection's rows and columns, and
 *  a clear that removes the outline levels from both axes of the selection. */
export function XlsxStructureOutlineGroup({ readOnly = false, selection, commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const span = selectionSpan(selection);
  const blocked = readOnly || !commands || !span;

  const run = (axis: "rows" | "cols", action: XlsxOutlineAction) => {
    if (blocked || span === null) return;
    fireCommand(commands, outlineCommandId(axis), outlineCommandParams(span, axis, action));
  };

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.groupRows")}
        aria-disabled={blocked || undefined}
        onClick={() => run("rows", "group")}
      >
        <ChevronsUp aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.ungroupRows")}
        aria-disabled={blocked || undefined}
        onClick={() => run("rows", "ungroup")}
      >
        <ChevronsDown aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.groupCols")}
        aria-disabled={blocked || undefined}
        onClick={() => run("cols", "group")}
      >
        <ChevronsUp aria-hidden className="rotate-90" />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.ungroupCols")}
        aria-disabled={blocked || undefined}
        onClick={() => run("cols", "ungroup")}
      >
        <ChevronsDown aria-hidden className="rotate-90" />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.structure.clearOutline")}
        aria-disabled={blocked || undefined}
        onClick={() => {
          run("rows", "clear");
          run("cols", "clear");
        }}
      >
        <CircleX aria-hidden />
      </Button>
    </>
  );
}
