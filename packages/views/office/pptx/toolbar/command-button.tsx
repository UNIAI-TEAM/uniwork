"use client";

/**
 * One ribbon command button. The capability status comes straight from the
 * command map: an "available" command is enabled, everything else (readonly /
 * unavailable / unknown) stays disabled and says why on hover/focus. Nothing
 * here infers support from the fact that a button exists.
 */
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { PptxCommand, PptxCommandId } from "../command-map";

export interface PptxCommandButtonProps {
  command: PptxCommand;
  active?: boolean;
  onCommand: (id: PptxCommandId) => void;
  /** Roving tab-index of this control inside its tab panel. */
  tabIndex?: number;
  /** Arrow-key handling for the roving focus inside one panel. */
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef?: (element: HTMLButtonElement | null) => void;
  compact?: boolean;
  className?: string;
}

export function PptxCommandButton({
  command,
  active = false,
  onCommand,
  tabIndex,
  onKeyDown,
  buttonRef,
  compact = false,
  className,
}: PptxCommandButtonProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const enabled = command.capability.status === "available";
  const label = t(command.labelKey);
  return (
    <span className="group relative inline-flex">
      <Button
        ref={buttonRef}
        type="button"
        size={compact ? "xs" : "sm"}
        variant={active ? "secondary" : "ghost"}
        disabled={!enabled}
        aria-label={label}
        aria-pressed={active}
        data-command={command.id}
        data-capability={command.capability.status}
        className={cn(compact && "w-full justify-start", className)}
        onClick={() => enabled && onCommand(command.id)}
        onKeyDown={onKeyDown}
        tabIndex={tabIndex}
      >
        {label}
      </Button>
      {!enabled && command.capability.reason ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden max-w-56 rounded border border-border bg-popover p-2 text-caption text-popover-foreground shadow group-hover:block group-focus-within:block"
        >
          {command.capability.reason}
        </span>
      ) : null}
    </span>
  );
}
