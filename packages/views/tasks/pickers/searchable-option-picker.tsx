"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@uniwork/ui/components/ui/combobox";
import { usePickerTriggerLabel } from "./trigger-label";

export type SearchableOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};

/**
 * Below this many options (including an optional empty row) a search box
 * only adds friction — status catalogs use 9; assignee uses 8.
 * Project/parent/status catalogs grow past this quickly.
 */
export const SEARCHABLE_OPTION_THRESHOLD = 8;

/**
 * Trigger + optional pinned search + icon-aware options. Used by create-task
 * for project/parent (and status when the catalog is long). Sibling of
 * AssigneePicker: same Combobox shell, string values instead of actor refs.
 */
export function SearchableOptionPicker({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  valueLabel,
  searchPlaceholder,
  noResultsLabel,
  emptyOption,
  onTriggerNavigationGuard,
  triggerClassName,
  align = "start",
  searchThreshold = SEARCHABLE_OPTION_THRESHOLD,
  children,
}: {
  value: string | null;
  options: SearchableOption[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
  ariaLabel: string;
  valueLabel?: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  /** Fixed empty row ("No project") pinned first; excluded from search defaults. */
  emptyOption?: SearchableOption;
  onTriggerNavigationGuard?: (event: SyntheticEvent) => void;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  searchThreshold?: number;
  children: ReactNode;
}) {
  const entries = useMemo(
    () => (emptyOption ? [emptyOption, ...options] : options),
    [emptyOption, options],
  );
  const selected = useMemo(
    () => entries.find((entry) => entry.value === (value ?? emptyOption?.value)) ?? null,
    [entries, emptyOption?.value, value],
  );
  const showSearch = entries.length > searchThreshold;

  const [open, setOpen] = useState(false);
  if (disabled && open) setOpen(false);
  const triggerLabel = usePickerTriggerLabel(ariaLabel, valueLabel);

  return (
    <Combobox
      items={entries}
      itemToStringLabel={(entry: SearchableOption) => entry.label}
      itemToStringValue={(entry: SearchableOption) => entry.value}
      isItemEqualToValue={(a: SearchableOption, b: SearchableOption) => a.value === b.value}
      value={selected}
      onValueChange={(entry: SearchableOption | null) => {
        if (!entry) {
          onChange(null);
          return;
        }
        if (emptyOption && entry.value === emptyOption.value) {
          onChange(null);
          return;
        }
        onChange(entry.value);
      }}
      open={disabled ? false : open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
    >
      <ComboboxTrigger
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
      </ComboboxTrigger>
      <ComboboxContent
        align={align}
        onClick={onTriggerNavigationGuard}
        onAuxClick={onTriggerNavigationGuard}
        className="w-64"
      >
        {showSearch ? (
          <ComboboxInput
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            showTrigger={false}
          />
        ) : null}
        <ComboboxEmpty>{noResultsLabel}</ComboboxEmpty>
        <ComboboxList>
          {(entry: SearchableOption) => (
            <ComboboxItem key={entry.value} value={entry}>
              {entry.icon}
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
