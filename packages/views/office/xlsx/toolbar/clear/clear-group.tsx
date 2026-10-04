"use client";

import { ChevronDown, Eraser } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
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

/** Home > clear: content / format / all behind one dropdown. No confirm
 *  dialog — Undo covers a clear — and read-only/no-selection states stay on
 *  the controls as `aria-disabled` (never hidden). */
export function XlsxClearGroup({ readOnly = false, canFormat, commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = readOnly || !canFormat || !commands;
  const [open, setOpen] = useState(false);
  const label = t("office.xlsx.toolbar.groups.clear.label");
  const run = (command: string) => {
    if (blocked) return;
    fireCommand(commands, command);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(next) => setOpen(blocked ? false : next)}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            aria-label={label}
            aria-disabled={blocked || undefined}
            data-testid="xlsx-clear-trigger"
          />
        }
      >
        <Eraser aria-hidden />
        <ChevronDown aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label={label}
        align="start"
        data-testid="xlsx-clear-menu"
        className="w-auto max-w-56 flex-col items-stretch gap-1 p-2"
      >
        {CLEAR_ACTIONS.map(({ key, command }) => (
          <Button
            key={key}
            type="button"
            variant="toolbar"
            size="sm"
            className="justify-start"
            aria-disabled={blocked || undefined}
            data-testid={`xlsx-clear-${key}`}
            onClick={() => run(command)}
          >
            {t(`office.xlsx.toolbar.groups.clear.${key}`)}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
