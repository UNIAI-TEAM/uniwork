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
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { PptxCommand, PptxCommandId } from "../command-map";

export interface PptxCommandButtonProps {
  command: PptxCommand;
  active?: boolean;
  /** Pressed state for a toggle command; ignored by a momentary action. */
  pressed?: boolean;
  /** Icon-only form (quick access, Find): the icon replaces the visible label
   *  while `aria-label` keeps the button named. */
  icon?: ReactNode;
  /** Icon + label that collapses to the icon below 480px (W6, F-09): the label
   *  stays in the accessibility tree (sr-only) and `aria-label` names it. */
  compactIcon?: ReactNode;
  /** Extra tooltip copy for an ENABLED command; a disabled command still shows
   *  its capability reason instead. */
  hint?: string;
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
  icon,
  compactIcon,
  hint,
  onCommand,
  tabIndex,
  onKeyDown,
  buttonRef,
  className,
}: PptxCommandButtonProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  // Capability reasons are FULL i18n keys (office.pptx.reasons.*); a reason that
  // is already translated text (the history remap) passes through unchanged.
  const { t: tRoot } = useTranslation();
  const enabled = command.capability.status === "available";
  const label = t(command.labelKey);
  const isToggle = command.toggle === true;
  // F4: the reason/hint is a real `role="tooltip"` node. A native `title` is
  // suppressed on a disabled control and never reaches a keyboard user, which
  // is exactly the audience that needs to hear why the control is dead.
  const reason = command.capability.reason;
  const tooltip = enabled ? hint : reason ? tRoot(reason, { defaultValue: reason }) : hint;
  // F6: a pressed toggle paints the selected token wash as well as setting
  // `aria-pressed`; a momentary action never paints the pressed state.
  const pressedStyle =
    isToggle && pressed
      ? "bg-surface-selected text-surface-selected-foreground hover:bg-surface-selected hover:text-surface-selected-foreground"
      : null;
  // Only a real toggle gets aria-pressed; undo/redo/save/open are momentary
  // actions, so they must not advertise a pressed state they cannot hold.
  return (
    <span className="group relative inline-flex">
      <Button
        ref={buttonRef}
        type="button"
        size={icon ? "icon-sm" : "sm"}
        variant={active ? "secondary" : "ghost"}
        disabled={!enabled}
        aria-label={label}
        aria-pressed={isToggle ? pressed : undefined}
        data-command={command.id}
        data-capability={command.capability.status}
        className={cn(pressedStyle, className)}
        onClick={() => enabled && onCommand(command.id)}
        onKeyDown={onKeyDown}
        tabIndex={tabIndex}
      >
        {icon ?? (compactIcon ? <>{compactIcon}<span className="max-[480px]:sr-only">{label}</span></> : label)}
      </Button>
      {tooltip ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden max-w-56 rounded border border-border bg-popover p-2 text-caption text-popover-foreground shadow group-hover:block group-focus-within:block"
        >
          {tooltip}
        </span>
      ) : null}
    </span>
  );
}
