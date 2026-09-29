"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { PptxCommand, PptxCommandId } from "./command-map";

export interface PptxToolbarProps {
  commands: readonly PptxCommand[];
  onCommand: (id: PptxCommandId) => void;
  activeCommand?: PptxCommandId | null;
  className?: string;
}

/** Command controls are intentionally dumb. In particular, this component
 * has no write port and cannot bypass the save coordinator. */
export function PptxToolbar({ commands, onCommand, activeCommand, className }: PptxToolbarProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  return (
    <div className={cn("flex min-w-max items-center gap-1", className)} role="toolbar" aria-label={t("toolbar_label")} data-pptx-toolbar>
      {commands.map((command) => {
        const enabled = command.capability.status === "available";
        const label = t(command.labelKey);
        return (
          <span key={command.id} className="group relative">
            <Button
              type="button"
              size="sm"
              variant={activeCommand === command.id ? "secondary" : "ghost"}
              disabled={!enabled}
              aria-label={label}
              aria-pressed={activeCommand === command.id}
              data-command={command.id}
              data-capability={command.capability.status}
              onClick={() => enabled && onCommand(command.id)}
            >
              {label}
            </Button>
            {!enabled && command.capability.reason ? (
              <span role="tooltip" className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden max-w-56 rounded border border-border bg-popover p-2 text-caption text-popover-foreground shadow group-hover:block group-focus-within:block">
                {command.capability.reason}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

