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
 * `onTriggerPointerDown` exists so a table cell can call
 * `event.stopPropagation()` before the pointerdown reaches a row-level
 * navigation handler — losing that wiring makes clicking a cell picker
 * navigate to the row instead of opening the menu.
 */
export function EnumFieldPicker({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  onTriggerPointerDown,
  triggerClassName,
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
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onPointerDown={onTriggerPointerDown}
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
      <DropdownMenuContent align="start">
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
