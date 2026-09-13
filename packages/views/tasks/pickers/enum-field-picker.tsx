"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { usePickerTriggerLabel } from "./trigger-label";

export type EnumOption = { value: string; label: string; icon?: ReactNode };

/**
 * Shared trigger + radio-group picker for finite, server-free enum fields
 * (status, priority). Callers own the trigger's visible content via
 * `children` and decide what happens on selection via `onChange`; the menu
 * itself closes on selection (Base UI's Menu.Root default) so no call site
 * needs to manage `open` state.
 *
 * `onTriggerNavigationGuard` exists so a table cell can stop a row-level
 * navigation handler before it fires. It is named for the job, not the
 * mechanism, because that job needs two independent paths covered:
 *  - `DropdownMenuContent` already stops left-click (`onClick`) from
 *    bubbling out of the portalled menu, but NOT aux-click (middle click),
 *    so a middle-click on an open menu ITEM can still reach a row handler
 *    that reacts to aux-click. We forward the same callback to the content
 *    popup's `onAuxClick` to close that path.
 *  - The trigger button itself needs three events covered for a
 *    click/aux-click that lands on it directly, before the menu is even
 *    open — `onPointerDown` covers press-based row handlers, `onAuxClick`
 *    covers the middle-click case `DropdownMenuContent` doesn't apply to
 *    (it isn't inside the popup), and `onClick` covers plain left-click:
 *    `stopPropagation` on `pointerdown` does NOT stop the `click` event
 *    that follows it (they are separate events), and nothing else in this
 *    tree calls `preventDefault()` on that click, so a row's `onClick`
 *    handler that checks `e.defaultPrevented` (DataTable's does) still
 *    fires on a plain click of the trigger without this.
 * Losing any one of these makes clicking (or middle-clicking) a cell
 * picker navigate to the row instead of just opening/using the menu.
 *
 * One callback, four event/element combinations. Do not narrow it back down
 * to a single event: each one was added for a reproduced navigation escape.
 */
export function EnumFieldPicker({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  valueLabel,
  onTriggerNavigationGuard,
  triggerClassName,
  align = "start",
  children,
}: {
  value: string | null;
  options: EnumOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** The value the trigger shows, as text. Joined into the accessible name
   * ("field: value") so the name contains what is visible; omit it only when
   * the trigger shows a fixed action label. */
  valueLabel?: string;
  onTriggerNavigationGuard?: (event: SyntheticEvent) => void;
  /** Additive: lets a call site match its own layout (table cell density,
   * sidebar row width, ...) without every consumer sharing one trigger size. */
  triggerClassName?: string;
  /** Additive: preserves each call site's existing menu alignment instead of
   * forcing one on all three (batch pickers used "center" before this
   * consolidation; table cell and sidebar used "start"). */
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  // `disabled` stays off the trigger's own `disabled` prop: Base UI would put
  // a native `disabled` on the button and drop it from the tab order. But
  // MenuTrigger opens on mousedown and ignores `aria-disabled`
  // (@base-ui/react 1.7.0 menu/trigger/MenuTrigger.js:161-163), so `open` is
  // held closed here, as AssigneePicker does for its combobox.
  const [open, setOpen] = useState(false);
  const triggerLabel = usePickerTriggerLabel(ariaLabel, valueLabel);

  return (
    <DropdownMenu
      open={disabled ? false : open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
    >
      <DropdownMenuTrigger
        onPointerDown={onTriggerNavigationGuard}
        onClick={onTriggerNavigationGuard}
        onAuxClick={onTriggerNavigationGuard}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={triggerClassName}
            aria-disabled={disabled || undefined}
            aria-label={triggerLabel}
          />
        }
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} onAuxClick={onTriggerNavigationGuard}>
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
