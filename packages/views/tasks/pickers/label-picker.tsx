"use client";

import { useMemo, useState, type ReactNode, type SyntheticEvent } from "react";
import type { TaskLabel } from "@uniwork/core/types";
import { tintClass, tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { tintFromColor } from "@uniwork/ui/lib/tint-from-color";
import { cn } from "@uniwork/ui/lib/utils";
import { SEARCHABLE_OPTION_THRESHOLD } from "./searchable-option-picker";
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
 * When `searchPlaceholder` is set and the catalog exceeds
 * `SEARCHABLE_OPTION_THRESHOLD`, a search field is pinned above the scrollable
 * list (LabelPicker / PropertyPicker parity).
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
  searchPlaceholder,
  noResultsLabel,
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
  /** When set and the catalog is long, pins a search field above the list. */
  searchPlaceholder?: string;
  /** Shown when the catalog has labels but the query matches none. */
  noResultsLabel?: string;
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
  const [query, setQuery] = useState("");
  // A controlled close never fires onOpenChange, so disabling an open menu
  // would leave `open` true and the menu would pop back when `disabled`
  // clears. Reset it during render, before anything commits.
  if (disabled && open) setOpen(false);
  const triggerLabel = usePickerTriggerLabel(ariaLabel, valueLabel);
  const showSearch =
    Boolean(searchPlaceholder) && labels.length > SEARCHABLE_OPTION_THRESHOLD;
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return labels;
    return labels.filter((label) => label.name.toLocaleLowerCase().includes(q));
  }, [labels, query]);

  return (
    <DropdownMenu
      open={disabled ? false : open}
      onOpenChange={(next) => {
        if (!disabled) {
          setOpen(next);
          if (!next) setQuery("");
        }
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
        className={cn(
          "w-56",
          showSearch ? "flex max-h-72 flex-col overflow-hidden p-0" : "max-h-72 overflow-y-auto",
        )}
      >
        {showSearch && searchPlaceholder ? (
          <div className="shrink-0 border-b px-2 py-1.5">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 border-0 bg-transparent px-1 shadow-none"
            />
          </div>
        ) : null}
        <div className={showSearch ? "min-h-0 flex-1 overflow-y-auto p-1" : undefined}>
          {labels.length === 0 ? (
            <p className="px-2 py-4 text-center text-caption text-muted-foreground">
              {emptyLabel}
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-caption text-muted-foreground">
              {noResultsLabel ?? emptyLabel}
            </p>
          ) : (
            filtered.map((label) => (
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
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
