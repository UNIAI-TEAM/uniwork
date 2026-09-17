"use client";

import { useMemo, useState } from "react";
import { ClearablePillButton } from "../../common/pill-button";
import { ProjectIcon } from "../../projects/components/project-icon";
import {
  PickerEmpty,
  PickerItem,
  PropertyPicker,
} from "./property-picker";
import { SEARCHABLE_OPTION_THRESHOLD } from "./searchable-option-picker";

type OptionItem = { value: string; label: string };

/** Multica create-issue: ProjectPicker + ClearablePillButton. */
export function CreateTaskProjectField({
  items,
  value,
  noneLabel,
  searchPlaceholder,
  noResultsLabel,
  clearLabel,
  onChange,
}: {
  items: OptionItem[];
  value: string | undefined;
  noneLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  clearLabel: string;
  onChange: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = items.find((item) => item.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLocaleLowerCase().includes(q));
  }, [items, query]);

  return (
    <PropertyPicker
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        setOpen(next);
      }}
      width="w-52"
      align="start"
      searchable
      searchPlaceholder={searchPlaceholder}
      onSearchChange={setQuery}
      triggerRender={
        <ClearablePillButton
          onClear={value ? () => onChange(undefined) : undefined}
          clearLabel={clearLabel}
        />
      }
      trigger={
        selected ? (
          <>
            <ProjectIcon />
            <span className="truncate">{selected.label}</span>
          </>
        ) : (
          <>
            <ProjectIcon />
            <span className="truncate">{noneLabel}</span>
          </>
        )
      }
    >
      <PickerItem
        emptyValue
        selected={!value}
        onClick={() => {
          onChange(undefined);
          setOpen(false);
          setQuery("");
        }}
      >
        <ProjectIcon />
        <span className="text-muted-foreground">{noneLabel}</span>
      </PickerItem>
      {filtered.map((item) => (
        <PickerItem
          key={item.value}
          selected={item.value === value}
          onClick={() => {
            onChange(item.value);
            setOpen(false);
            setQuery("");
          }}
        >
          <ProjectIcon />
          <span className="truncate">{item.label}</span>
        </PickerItem>
      ))}
      {items.length > 0 && filtered.length === 0 ? (
        <PickerEmpty>{noResultsLabel}</PickerEmpty>
      ) : null}
    </PropertyPicker>
  );
}

/** Overflow parent field — same PropertyPicker shell, ClearablePill chrome. */
export function CreateTaskParentField({
  items,
  value,
  ariaLabel,
  noneLabel,
  searchPlaceholder,
  noResultsLabel,
  clearLabel,
  onChange,
  onClear,
  open,
  onOpenChange,
}: {
  items: OptionItem[];
  value: string | undefined;
  ariaLabel: string;
  noneLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  clearLabel: string;
  onChange: (value: string | undefined) => void;
  onClear: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = items.find((item) => item.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLocaleLowerCase().includes(q));
  }, [items, query]);
  const searchable = items.length + 1 > SEARCHABLE_OPTION_THRESHOLD;

  return (
    <PropertyPicker
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      width="w-64"
      align="start"
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
      onSearchChange={setQuery}
      triggerRender={
        <ClearablePillButton
          aria-label={ariaLabel}
          onClear={() => {
            onChange(undefined);
            onClear();
          }}
          clearLabel={clearLabel}
        />
      }
      trigger={<span className="truncate">{selected?.label ?? noneLabel}</span>}
    >
      <PickerItem
        emptyValue
        selected={!value}
        onClick={() => {
          onChange(undefined);
          onOpenChange(false);
          setQuery("");
        }}
      >
        <span className="text-muted-foreground">{noneLabel}</span>
      </PickerItem>
      {filtered.map((item) => (
        <PickerItem
          key={item.value}
          selected={item.value === value}
          onClick={() => {
            onChange(item.value);
            onOpenChange(false);
            setQuery("");
          }}
        >
          <span className="truncate">{item.label}</span>
        </PickerItem>
      ))}
      {filtered.length === 0 ? <PickerEmpty>{noResultsLabel}</PickerEmpty> : null}
    </PropertyPicker>
  );
}
