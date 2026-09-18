"use client";

import { useMemo, useState } from "react";
import { Tag, UserMinus } from "lucide-react";
import type { TaskLabel, TaskPriority } from "@uniwork/core/types";
import { AgentBadge } from "../../agents/agent-badge";
import { PillButton } from "../../common/pill-button";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@uniwork/ui/components/ui/avatar";
import { PriorityIcon } from "../icons/priority-icon";
import { StatusIcon } from "../icons/status-icon";
import { priorityTone } from "../modes/priority-config";
import type { AssigneeOption, AssigneeRef } from "./assignee-picker";
import {
  PickerEmpty,
  PickerItem,
  PickerSection,
  PropertyPicker,
} from "./property-picker";
import { SEARCHABLE_OPTION_THRESHOLD } from "./searchable-option-picker";

type StatusItem = { value: string; label: string; category: string };
type OptionItem = { value: string; label: string };

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function refsEqual(a: AssigneeRef | null, b: AssigneeRef | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.kind === b.kind;
}

/** Create-task status field: StatusPicker + PillButton. */
export function CreateTaskStatusField({
  items,
  value,
  searchPlaceholder,
  noResultsLabel,
  onChange,
}: {
  items: StatusItem[];
  value: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = items.find((item) => item.value === value) ?? items[0];
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLocaleLowerCase().includes(q));
  }, [items, query]);
  const searchable = items.length > SEARCHABLE_OPTION_THRESHOLD;

  return (
    <PropertyPicker
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        setOpen(next);
      }}
      width="w-52"
      align="start"
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
      onSearchChange={setQuery}
      triggerRender={<PillButton />}
      trigger={
        <>
          <StatusIcon
            status={value}
            category={selected?.category}
            className="size-3.5 shrink-0"
          />
          <span className="truncate">{selected?.label ?? value}</span>
        </>
      }
    >
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
          <StatusIcon
            status={item.value}
            category={item.category}
            className="size-3.5"
          />
          <span className="truncate">{item.label}</span>
        </PickerItem>
      ))}
      {filtered.length === 0 ? <PickerEmpty>{noResultsLabel}</PickerEmpty> : null}
    </PropertyPicker>
  );
}

/** Create-task priority field: PriorityPicker + PillButton. */
export function CreateTaskPriorityField({
  items,
  value,
  onChange,
}: {
  items: OptionItem[];
  value: TaskPriority;
  onChange: (value: TaskPriority) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.value === value) ?? items[0];

  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      width="w-44"
      align="start"
      triggerRender={<PillButton />}
      trigger={
        <>
          <PriorityIcon priority={value} className="shrink-0" />
          <span className="truncate">{selected?.label ?? value}</span>
        </>
      }
    >
      {items.map((item) => {
        const priority = item.value as TaskPriority;
        return (
          <PickerItem
            key={item.value}
            selected={item.value === value}
            onClick={() => {
              onChange(priority);
              setOpen(false);
            }}
          >
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-caption font-medium ${tintClass[priorityTone(priority)]}`}
            >
              <PriorityIcon priority={priority} className="size-3" inheritColor />
              {item.label}
            </span>
          </PickerItem>
        );
      })}
    </PropertyPicker>
  );
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
  membersLabel,
  agentsLabel,
}: {
  value: AssigneeRef | null;
  options: AssigneeOption[];
  onChange: (value: AssigneeRef | null) => void;
  ariaLabel: string;
  unassignedLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  valueLabel: string;
  membersLabel: string;
  agentsLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) =>
    refsEqual({ id: option.id, kind: option.kind }, value),
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return options;
    return options.filter(
      (option) =>
        option.name.toLocaleLowerCase().includes(q) ||
        option.secondaryLabel?.toLocaleLowerCase().includes(q),
    );
  }, [options, query]);
  const members = filtered.filter((option) => option.kind === "human");
  const agents = filtered.filter((option) => option.kind === "agent");

  return (
    <PropertyPicker
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        setOpen(next);
      }}
      width="w-64"
      align="start"
      searchable
      searchPlaceholder={searchPlaceholder}
      searchAriaLabel={searchPlaceholder}
      onSearchChange={setQuery}
      triggerRender={<PillButton aria-label={ariaLabel} />}
      trigger={
        selected ? (
          <>
            <Avatar size="sm" className="size-4">
              {selected.avatarUrl ? <AvatarImage src={selected.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-micro">{initialOf(selected.name)}</AvatarFallback>
            </Avatar>
            <span className="truncate">{valueLabel}</span>
          </>
        ) : (
          <span className="truncate text-muted-foreground">{valueLabel}</span>
        )
      }
    >
      <PickerItem
        emptyValue
        selected={value == null}
        onClick={() => {
          onChange(null);
          setOpen(false);
          setQuery("");
        }}
      >
        <UserMinus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{unassignedLabel}</span>
      </PickerItem>
      {members.length > 0 ? (
        <PickerSection label={membersLabel}>
          {members.map((option) => (
            <AssigneePickerItem
              key={`human:${option.id}`}
              option={option}
              selected={refsEqual({ id: option.id, kind: option.kind }, value)}
              onSelect={(ref) => {
                onChange(ref);
                setOpen(false);
                setQuery("");
              }}
            />
          ))}
        </PickerSection>
      ) : null}
      {agents.length > 0 ? (
        <PickerSection label={agentsLabel}>
          {agents.map((option) => (
            <AssigneePickerItem
              key={`agent:${option.id}`}
              option={option}
              selected={refsEqual({ id: option.id, kind: option.kind }, value)}
              onSelect={(ref) => {
                onChange(ref);
                setOpen(false);
                setQuery("");
              }}
            />
          ))}
        </PickerSection>
      ) : null}
      {filtered.length === 0 ? <PickerEmpty>{noResultsLabel}</PickerEmpty> : null}
    </PropertyPicker>
  );
}

function AssigneePickerItem({
  option,
  selected,
  onSelect,
}: {
  option: AssigneeOption;
  selected: boolean;
  onSelect: (value: AssigneeRef) => void;
}) {
  const ref: AssigneeRef = { id: option.id, kind: option.kind };
  return (
    <PickerItem selected={selected} onClick={() => onSelect(ref)}>
      <Avatar size="sm" className="size-5">
        {option.avatarUrl ? <AvatarImage src={option.avatarUrl} alt="" /> : null}
        <AvatarFallback>{initialOf(option.name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate">{option.name}</span>
      {option.kind === "agent" ? <AgentBadge className="shrink-0" /> : null}
    </PickerItem>
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
