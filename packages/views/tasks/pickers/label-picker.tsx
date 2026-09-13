"use client";

import type { ReactNode, SyntheticEvent } from "react";
import type { TaskLabel } from "@uniwork/core/types";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { tintFromColor } from "@uniwork/ui/lib/tint-from-color";
import { cn } from "@uniwork/ui/lib/utils";

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
  emptyLabel: string;
  onTriggerNavigationGuard?: (event: SyntheticEvent) => void;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
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
            aria-label={ariaLabel}
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
                className={cn("size-2 shrink-0 rounded-full", labelChipClass(label.color))}
              />
              <span className="truncate">{label.name}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
