"use client";

// Home-tab Conditional Formatting group: one large dropdown with the "Highlight
// Cells Rules" presets plus two clear commands. Every action runs through the
// toolbar's one command port; the preset dialog is owned here (like the sort
// group's), so the editor shell is untouched.

import { useState } from "react";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, ArrowLeftRight, Copy, Eraser, Fingerprint, Highlighter, ListChecks, Trash2, Type, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { selectionDvRange } from "../data-validation/dv-commands";
import { fireCommand } from "../fire-command";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import { XlsxGroupBody, XlsxLargeButton, XlsxLargeLabel } from "../toolbar/group-layout";
import {
  clearRangeParams,
  clearSheetParams,
  XLSX_CF_CLEAR_RANGE_COMMAND,
  XLSX_CF_CLEAR_SHEET_COMMAND,
  type XlsxCfPreset,
} from "./cf-commands";
import { XlsxCfRuleManager } from "./cf-rule-manager";
import { XlsxConditionalFormatDialog } from "./conditional-format-dialog";
import type { RibbonItem } from "../../ribbon";

const BASE = "office.xlsx.conditionalFormat";
const PRESET_ITEMS: readonly XlsxCfPreset[] = ["greaterThan", "lessThan", "between", "containsText", "duplicateValues", "uniqueValues"];

const PRESET_ICONS: Record<XlsxCfPreset, LucideIcon> = {
  greaterThan: ArrowUpWideNarrow,
  lessThan: ArrowDownWideNarrow,
  between: ArrowLeftRight,
  containsText: Type,
  duplicateValues: Copy,
  uniqueValues: Fingerprint,
};

export function XlsxConditionalFormatGroup({
  readOnly = false,
  commands,
  selection,
  unitId,
  sheetName,
  resolveSheetId,
}: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [preset, setPreset] = useState<XlsxCfPreset | null>(null);
  const [managing, setManaging] = useState(false);
  const range = selectionDvRange(selection);
  const sheetId = sheetName ? resolveSheetId?.(sheetName) : undefined;
  const blocked = readOnly || !commands || range === null || sheetId === undefined || unitId == null;

  const canManage = !blocked && typeof commands?.readRuleSets === "function";

  const clearSelection = () => {
    if (blocked || range === null || sheetId === undefined || unitId == null) return;
    fireCommand(commands, XLSX_CF_CLEAR_RANGE_COMMAND, clearRangeParams(unitId, sheetId, range));
  };
  const clearSheet = () => {
    if (blocked || sheetId === undefined || unitId == null) return;
    fireCommand(commands, XLSX_CF_CLEAR_SHEET_COMMAND, clearSheetParams(unitId, sheetId));
  };

  return (
    <XlsxGroupBody>
      <DropdownMenu
        open={menuOpen && !blocked}
        onOpenChange={(open) => {
          if (!open || !blocked) setMenuOpen(open);
        }}
      >
        <DropdownMenuTrigger
          render={
            <XlsxLargeButton
              aria-label={t(`${BASE}.menu.label`)}
              title={t(`${BASE}.menu.label`)}
              aria-disabled={blocked || undefined}
              data-testid="xlsx-cf-menu"
            />
          }
        >
          <Highlighter aria-hidden />
          <XlsxLargeLabel>{t(`${BASE}.menu.label`)}</XlsxLargeLabel>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {PRESET_ITEMS.map((item) => {
            const Icon = PRESET_ICONS[item];
            return (
            <DropdownMenuItem key={item} data-testid={`xlsx-cf-${item}`} onClick={() => setPreset(item)}>
              <Icon aria-hidden />
              {t(`${BASE}.menu.${item}`)}
            </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="xlsx-cf-clear-selection" onClick={clearSelection}>
            <Eraser aria-hidden />
            {t(`${BASE}.menu.clearSelection`)}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="xlsx-cf-clear-sheet" onClick={clearSheet}>
            <Trash2 aria-hidden />
            {t(`${BASE}.menu.clearSheet`)}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="xlsx-cf-manage"
            aria-disabled={!canManage || undefined}
            title={canManage ? undefined : t(`${BASE}.manager.unavailable`)}
            onClick={() => {
              if (canManage) setManaging(true);
            }}
          >
            <ListChecks aria-hidden />
            {t(`${BASE}.menu.manage`)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {preset !== null && !blocked && range !== null && sheetId !== undefined && unitId != null && commands ? (
        <XlsxConditionalFormatDialog
          preset={preset}
          unitId={unitId}
          subUnitId={sheetId}
          range={range}
          commands={commands}
          readOnly={readOnly}
          onClose={() => setPreset(null)}
        />
      ) : null}
      {managing && canManage && range !== null && sheetId !== undefined && unitId != null && commands ? (
        <XlsxCfRuleManager
          unitId={unitId}
          subUnitId={sheetId}
          commands={commands}
          selection={range}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </XlsxGroupBody>
  );
}

/** Estimated full-size width of the one large dropdown button. */
const GROUP_WIDTH = 96;

/** The Home tab registers typed ribbon items; the group (menu + preset
 *  dialog) is one custom item, the ribbon's escape hatch for a whole group
 *  component. It keeps its large button when the strip shrinks. */
export function xlsxConditionalFormatRibbonItems(context: XlsxToolbarGroupProps): readonly RibbonItem[] {
  return [
    {
      kind: "custom",
      id: "conditional-format",
      labelKey: `${BASE}.menu.label`,
      size: "large",
      collapseAs: "large",
      width: GROUP_WIDTH,
      render: () => <XlsxConditionalFormatGroup {...context} />,
    },
  ];
}
