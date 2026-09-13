"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";

export type EnumOption = { value: string; label: string; icon?: ReactNode };

/**
 * Shared trigger + radio-group picker for finite, server-free enum fields
 * (status, priority). Callers own the trigger's visible content via
 * `children` and decide what happens on selection via `onChange`; the menu
 * itself closes on selection (Base UI's Menu.Root default) so no call site
 * needs to manage `open` state.
 *
 * `onTriggerPointerDown` exists so a table cell can stop a row-level
 * navigation handler before it fires. It is wired to more than its name
 * says, on purpose, because the row-nav bug has two independent paths:
 *  - `DropdownMenuContent` already stops left-click (`onClick`) from
 *    bubbling out of the portalled menu, but NOT aux-click (middle click),
 *    so a middle-click on an open menu ITEM can still reach a row handler
 *    that reacts to aux-click. We forward the same callback to the content
 *    popup's `onAuxClick` to close that path.
 *  - The trigger button itself needs the same two events covered for a
 *    click/aux-click that lands on it directly, before the menu is even
 *    open — `onPointerDown` covers press-based row handlers, `onAuxClick`
 *    covers the middle-click case `DropdownMenuContent` doesn't apply to
 *    (it isn't inside the popup).
 * Losing any one of these makes clicking (or middle-clicking) a cell
 * picker navigate to the row instead of just opening/using the menu.
 */
export function EnumFieldPicker({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  onTriggerPointerDown,
  triggerClassName,
  align = "start",
  children,
}: {
  value: string | null;
  options: EnumOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  onTriggerPointerDown?: (event: SyntheticEvent) => void;
  /** Additive: lets a call site match its own layout (table cell density,
   * sidebar row width, ...) without every consumer sharing one trigger size. */
  triggerClassName?: string;
  /** Additive: preserves each call site's existing menu alignment instead of
   * forcing one on all three (batch pickers used "center" before this
   * consolidation; table cell and sidebar used "start"). */
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onPointerDown={onTriggerPointerDown}
        onAuxClick={onTriggerPointerDown}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={triggerClassName}
            aria-disabled={disabled || undefined}
            aria-label={ariaLabel}
          />
        }
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} onAuxClick={onTriggerPointerDown}>
        <DropdownMenuRadioGroup
          value={value ?? undefined}
          onValueChange={(next) => {
            if (next) onChange(next);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.icon}
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
