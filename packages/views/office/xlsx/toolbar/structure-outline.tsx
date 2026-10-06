"use client";

import { useState, type ReactNode } from "react";
import { ListIndentDecrease, ListIndentIncrease, ListMinus, ListPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { selectionSpan, type XlsxSelectionSpan } from "./structure-insert";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";
import { XLSX_RANGE_TYPE } from "../selection-mapping";
import {
  XLSX_SMALL_BUTTON_CLASS,
  XlsxGroupBody,
  XlsxGroupRow,
  XlsxGroupRows,
  XlsxLargeButton,
  XlsxLargeLabel,
} from "./group-layout";

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

const BASE = "office.xlsx.structure";

/** Data tab "Outline" group (Excel layout): Group / Ungroup dropdowns for the
 *  selection's rows and columns, plus Show / Hide Detail, which hide or show
 *  the selection's lines (columns for a whole-column selection). Subtotal is
 *  deliberately absent: the engine has no command for it. */
export function XlsxStructureOutlineGroup({ readOnly = false, selection, commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<"group" | "ungroup" | null>(null);
  const span = selectionSpan(selection);
  const blocked = readOnly || !commands || !span;

  const run = (id: string, params?: unknown) => {
    if (blocked) return;
    fireCommand(commands, id, params);
  };
  const outline = (axis: "rows" | "cols", action: XlsxOutlineAction) => {
    if (span === null) return;
    run(outlineCommandId(axis), outlineCommandParams(span, axis, action));
  };
  const detail = (hide: boolean) => {
    if (span === null) return;
    const ranges = [
      { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn },
    ];
    const byColumn = selection?.rangeType === XLSX_RANGE_TYPE.COLUMN;
    const id = byColumn
      ? hide ? "sheet.command.set-col-hidden" : "sheet.command.set-col-visible-on-cols"
      : hide ? "sheet.command.set-rows-hidden" : "sheet.command.set-specific-rows-visible";
    run(id, { ranges });
  };

  const dropdown = (
    which: "group" | "ungroup",
    icon: ReactNode,
    label: string,
    items: ReadonlyArray<{ key: string; label: string; onSelect: () => void; separatorBefore?: boolean }>,
  ) => (
    <DropdownMenu
      open={menu === which && !blocked}
      onOpenChange={(open) => {
        if (!open) setMenu((current) => (current === which ? null : current));
        else if (!blocked) setMenu(which);
      }}
    >
      <DropdownMenuTrigger
        render={
          <XlsxLargeButton
            aria-label={label}
            title={label}
            aria-disabled={blocked || undefined}
            data-testid={`xlsx-outline-${which}`}
          />
        }
      >
        {icon}
        <XlsxLargeLabel>{label}</XlsxLargeLabel>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {items.map((item) => (
          <span key={item.key} className="contents">
            {item.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem data-testid={`xlsx-outline-${item.key}`} onClick={item.onSelect}>
              {item.label}
            </DropdownMenuItem>
          </span>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <XlsxGroupBody>
      {dropdown("group", <ListIndentIncrease aria-hidden />, t(`${BASE}.group`), [
        { key: "group-rows", label: t(`${BASE}.groupRows`), onSelect: () => outline("rows", "group") },
        { key: "group-cols", label: t(`${BASE}.groupCols`), onSelect: () => outline("cols", "group") },
      ])}
      {dropdown("ungroup", <ListIndentDecrease aria-hidden />, t(`${BASE}.ungroup`), [
        { key: "ungroup-rows", label: t(`${BASE}.ungroupRows`), onSelect: () => outline("rows", "ungroup") },
        { key: "ungroup-cols", label: t(`${BASE}.ungroupCols`), onSelect: () => outline("cols", "ungroup") },
        {
          key: "clear-outline",
          label: t(`${BASE}.clearOutline`),
          separatorBefore: true,
          onSelect: () => {
            outline("rows", "clear");
            outline("cols", "clear");
          },
        },
      ])}
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="xs"
            className={XLSX_SMALL_BUTTON_CLASS}
            aria-label={t(`${BASE}.showDetail`)}
            title={t(`${BASE}.showDetail`)}
            aria-disabled={blocked || undefined}
            data-testid="xlsx-outline-show-detail"
            onClick={() => detail(false)}
          >
            <ListPlus aria-hidden />
            {t(`${BASE}.showDetail`)}
          </Button>
        </XlsxGroupRow>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="xs"
            className={XLSX_SMALL_BUTTON_CLASS}
            aria-label={t(`${BASE}.hideDetail`)}
            title={t(`${BASE}.hideDetail`)}
            aria-disabled={blocked || undefined}
            data-testid="xlsx-outline-hide-detail"
            onClick={() => detail(true)}
          >
            <ListMinus aria-hidden />
            {t(`${BASE}.hideDetail`)}
          </Button>
        </XlsxGroupRow>
      </XlsxGroupRows>
    </XlsxGroupBody>
  );
}
