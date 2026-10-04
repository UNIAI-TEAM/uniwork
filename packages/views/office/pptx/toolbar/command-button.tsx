"use client";

/**
 * One ribbon command button. The capability status comes straight from the
 * command map: an "available" command is enabled, everything else (readonly /
 * unavailable / unknown) stays disabled and says why on hover/focus. Nothing
 * here infers support from the fact that a button exists.
 *
 * A command marked `toggle` renders `aria-pressed` and the pressed state; a
 * momentary action (undo, save, open) never advertises a pressed state it
 * cannot hold (C6).
 */
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { PptxCommand, PptxCommandId } from "../command-map";

export interface PptxCommandButtonProps {
  command: PptxCommand;
  active?: boolean;
  /** Pressed state for a toggle command; ignored by a momentary action. */
  pressed?: boolean;
  onCommand: (id: PptxCommandId) => void;
  /** Roving tab-index of this control inside its tab panel. */
  tabIndex?: number;
  /** Arrow-key handling for the roving focus inside one panel. */
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef?: (element: HTMLButtonElement | null) => void;
  className?: string;
}

export function PptxCommandButton({
  command,
  active = false,
  pressed = false,
  onCommand,
  tabIndex,
  onKeyDown,
  buttonRef,
  className,
}: PptxCommandButtonProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const enabled = command.capability.status === "available";
  const label = t(command.labelKey);
  const isToggle = command.toggle === true;
  // Only a real toggle gets aria-pressed; undo/redo/save/open are momentary
  // actions, so they must not advertise a pressed state they cannot hold.
  return (
    <span className="group relative inline-flex">
      <Button
        ref={buttonRef}
        type="button"
        size="sm"
        variant={active ? "secondary" : "ghost"}
        disabled={!enabled}
        aria-label={label}
        aria-pressed={isToggle ? pressed : undefined}
        data-command={command.id}
        data-capability={command.capability.status}
        className={cn(className)}
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