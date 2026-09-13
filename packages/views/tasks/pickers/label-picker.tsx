"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";
import type { TaskLabel } from "@uniwork/core/types";
import { tintClass, tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { tintFromColor } from "@uniwork/ui/lib/tint-from-color";
import { cn } from "@uniwork/ui/lib/utils";
import { usePickerTriggerLabel } from "./trigger-label";

/** Token classes for a label chip: the stored hex mapped onto the nearest tint. */
export function labelChipClass(color: string | null | undefined): string {
  return tintClass[tintFromColor(color)];
}

/**
 * Shared trigger + checkbox menu for a task's labels. Sibling of
 * `EnumFieldPicker`: callers own the trigger content via `children` and
 * what a toggle does via `onToggle` (see `useTaskLabelToggle`).
 *
 * Multi-select: every toggle applies immediately and the menu stays open, so
 * attaching three labels is three clicks in one visit. That relies on Base UI's
 * `Menu.CheckboxItem` default `closeOnClick=false`; it is passed explicitly so
 * a future change to the registry wrapper can't silently flip it.
 *
 * `onTriggerNavigationGuard` is wired exactly like `EnumFieldPicker`'s — the
 * trigger's `onPointerDown`/`onClick`/`onAuxClick` plus the popup's
 * `onAuxClick` — for the same reproduced row-navigation escapes; read that
 * component's comment before narrowing it. A left-click on a checkbox item is
 * stopped by `DropdownMenuContent` itself (dropdown-menu.tsx); the behavioural
 * test in label-picker.test.tsx holds that.
 */
export function LabelPicker({
  labels,
  selectedIds,
  pendingIds,
  onToggle,
  disabled,
  ariaLabel,
  valueLabel,
  emptyLabel,
  onTriggerNavigationGuard,
  triggerClassName,
  align = "start",
  children,
}: {
  /** The workspace label catalog, passed in so a table never queries per row. */
  labels: TaskLabel[];
  selectedIds: ReadonlySet<string>;
  /** Labels with a toggle in flight; their items are disabled until it settles. */
  pendingIds?: ReadonlySet<string>;
  onToggle: (labelId: string, checked: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** The value the trigger shows, as text. Joined into the accessible name
   * ("field: value") so the name contains what is visible; omit it only when
   * the trigger shows a fixed action label. */
  valueLabel?: string;
  emptyLabel: string;
  onTriggerNavigationGuard?: (event: SyntheticEvent) => void;
  triggerClassName?: string;
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
      <DropdownMenuContent
        align={align}
        onAuxClick={onTriggerNavigationGuard}
        className="max-h-72 w-56 overflow-y-auto"
      >
        {labels.length === 0 ? (
          <p className="px-2 py-4 text-center text-caption text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          labels.map((label) => (
            <DropdownMenuCheckboxItem
              key={label.id}
              checked={selectedIds.has(label.id)}
              disabled={disabled || pendingIds?.has(label.id)}
              closeOnClick={false}
              onCheckedChange={(checked) => onToggle(label.id, checked)}
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  tintSolidClass[tintFromColor(label.color)],
                )}
              />
              <span className="truncate">{label.name}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
