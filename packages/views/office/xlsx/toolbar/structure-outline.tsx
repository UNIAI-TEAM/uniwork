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
import { XlsxSubtotalButton } from "./data-tools/subtotal-dialog";
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

/** Show / Hide Detail: the controller finds the outline group and runs the
 *  hidden/visible command on it. */
export const OUTLINE_DETAIL_COMMAND = "uniwork.command.set-outline-detail";

/** Data tab "Outline" group (Excel layout): Group / Ungroup dropdowns for the
 *  selection's rows and columns, plus Show / Hide Detail, which collapse or
 *  expand the outline group holding the selection's first line (or the group
 *  a summary line closes; columns for a whole-column selection). Subtotal
 *  follows Ungroup, as in Excel (./data-tools/subtotal-dialog.tsx). */
export function XlsxStructureOutlineGroup(props: XlsxToolbarGroupProps) {
  const { readOnly = false, selection, commands } = props;
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
  // Clear Outline is one user action: both axes go in one undo step.
  const clearOutline = () => {
    if (blocked || !commands || span === null) return;
    const steps = (["rows", "cols"] as const).map((axis) =>
      ({ id: outlineCommandId(axis), params: outlineCommandParams(span, axis, "clear") }));
    if (!commands.executeAsOneStep) {
      for (const step of steps) run(step.id, step.params);
      return;
    }
    void commands.executeAsOneStep(steps).then((ran) => {
      if (!ran) console.warn("[xlsx-command] clear outline was refused");
    }, (error: unknown) => console.warn(`[xlsx-command] ${error instanceof Error ? error.message : String(error)}`));
  };
  const detail = (hide: boolean) => {
    if (span === null) return;
    const axis = selection?.rangeType === XLSX_RANGE_TYPE.COLUMN ? "cols" : "rows";
    const { start, end } = outlineCommandParams(span, axis, "group");
    run(OUTLINE_DETAIL_COMMAND, { axis, start, end, hide });
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
          onSelect: clearOutline,
        },
      ])}
      <XlsxSubtotalButton {...props} />
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
