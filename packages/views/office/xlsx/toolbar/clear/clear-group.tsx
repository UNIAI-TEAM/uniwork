"use client";

import { Eraser } from "lucide-react";
import type { RibbonItem } from "../../../ribbon";
import type { XlsxToolbarGroupProps } from "../types";
import { fireCommand } from "../../fire-command";

/** The three pinned Univer clear commands. All three are already allowlisted
 *  and persist through the journal: they dispatch
 *  `sheet.mutation.set-range-values` (content writes `v`/`f`, Clear Formats
 *  writes `s: null`), which the renderer records like any manual edit. */
const CLEAR_ACTIONS = [
  { key: "content", command: "sheet.command.clear-selection-content" },
  { key: "format", command: "sheet.command.clear-selection-format" },
  { key: "all", command: "sheet.command.clear-selection-all" },
] as const;

/** Home > Editing as typed ribbon items: one Clear dropdown (content / format /
 *  all). Find & replace is not repeated here - it lives at the far right of the
 *  ribbon's tab row. No confirm dialog - Undo covers a clear - and the
 *  read-only / no-selection / no-port states keep the control rendered and
 *  `aria-disabled`, with the command guarded again in the handler. */
export function xlsxEditingRibbonItems({ readOnly = false, canFormat, commands }: XlsxToolbarGroupProps): readonly RibbonItem[] {
  const blocked = readOnly || !canFormat || !commands;
  return [
    {
      kind: "dropdown",
      id: "editing-clear",
      labelKey: "office.xlsx.toolbar.groups.clear.label",
      icon: Eraser,
      size: "small",
      collapseAs: "icon",
      disabled: blocked,
      menu: CLEAR_ACTIONS.map(({ key, command }) => ({
        id: `editing-clear-${key}`,
        labelKey: `office.xlsx.toolbar.groups.clear.${key}`,
        disabled: blocked,
        onSelect: () => {
          if (!blocked) fireCommand(commands, command);
        },
      })),
    },
  ];
}
