"use client";

import { useMemo, useState } from "react";
import { Tag } from "lucide-react";
import type { TaskLabel } from "@uniwork/core/types";
import { PillButton } from "../../common/pill-button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@uniwork/ui/components/ui/avatar";
import {
  AssigneePicker,
  type AssigneeOption,
  type AssigneeRef,
} from "./assignee-picker";
import { PickerEmpty, PickerItem, PropertyPicker } from "./property-picker";
import { SEARCHABLE_OPTION_THRESHOLD } from "./searchable-option-picker";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

/** Create-task assignee field: AssigneePicker + PillButton. */
export function CreateTaskAssigneeField({
  value,
  options,
  onChange,
  ariaLabel,
  unassignedLabel,
  searchPlaceholder,
  noResultsLabel,
  valueLabel,
}: {
  value: AssigneeRef | null;
  options: AssigneeOption[];
  onChange: (value: AssigneeRef | null) => void;
  ariaLabel: string;
  unassignedLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  valueLabel: string;
}) {
  const selected = value
    ? options.find((option) => option.id === value.id && option.kind === value.kind)
    : undefined;

  return (
    <AssigneePicker
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={ariaLabel}
      unassignedLabel={unassignedLabel}
      searchPlaceholder={searchPlaceholder}
      noResultsLabel={noResultsLabel}
      triggerRender={<PillButton aria-label={ariaLabel} />}
    >
      {selected ? (
        <>
          <Avatar aria-hidden className="size-4">
            {selected.avatarUrl ? <AvatarImage src={selected.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-micro">{initialOf(selected.name)}</AvatarFallback>
          </Avatar>
          <span className="truncate">{valueLabel}</span>
        </>
      ) : (
        <span className="truncate text-muted-foreground">{valueLabel}</span>
      )}
    </AssigneePicker>
  );
}

/** Create-task label field: LabelPicker + PillButton (multi-select stays open). */
export function CreateTaskLabelField({
  labels,
  selectedIds,
  onToggle,
  ariaLabel,
  valueLabel,
  emptyLabel,
  searchPlaceholder,
  noResultsLabel,
}: {
  labels: TaskLabel[];
  selectedIds: ReadonlySet<string>;
  onToggle: (labelId: string, checked: boolean) => void;
  ariaLabel: string;
  valueLabel: string;
  emptyLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return labels;
    return labels.filter((label) => label.name.toLocaleLowerCase().includes(q));
  }, [labels, query]);
  const searchable = labels.length > SEARCHABLE_OPTION_THRESHOLD;
  const selectedLabels = labels.filter((label) => selectedIds.has(label.id));

  return (
    <PropertyPicker
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        setOpen(next);
      }}
      width="w-56"
      align="start"
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
      onSearchChange={setQuery}
      triggerRender={<PillButton aria-label={ariaLabel} />}
      trigger={
        selectedLabels.length > 0 ? (
          <>
            {selectedLabels.slice(0, 2).map((label) => (
              <span key={label.id} className="flex min-w-0 items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color ?? undefined }}
                  aria-hidden
                />
                <span className="max-w-24 truncate">{label.name}</span>
              </span>
            ))}
            {selectedLabels.length > 2 ? (
              <span className="text-muted-foreground">+{selectedLabels.length - 2}</span>
            ) : null}
          </>
        ) : (
          <>
            <Tag className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{valueLabel}</span>
          </>
        )
      }
    >
      {labels.length === 0 ? (
        <PickerEmpty>{emptyLabel}</PickerEmpty>
      ) : filtered.length === 0 ? (
        <PickerEmpty>{noResultsLabel}</PickerEmpty>
      ) : (
        filtered.map((label) => {
          const selected = selectedIds.has(label.id);
          return (
            <PickerItem
              key={label.id}
              selected={selected}
              onClick={() => onToggle(label.id, !selected)}
            >
              <span
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: label.color ?? undefined }}
                aria-hidden
              />
              <span className="truncate">{label.name}</span>
            </PickerItem>
          );
        })
      )}
    </PropertyPicker>
  );
}
