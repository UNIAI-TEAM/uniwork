"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import { UserMinus } from "lucide-react";
import { AgentBadge } from "../../agents/agent-badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@uniwork/ui/components/ui/avatar";
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

export type AssigneeKind = "human" | "agent";

/** ADR 0007: attribution travels as an (id, kind) pair, never id alone. */
export type AssigneeRef = { id: string; kind: AssigneeKind };

export type AssigneeOption = {
  id: string;
  kind: AssigneeKind;
  name: string;
  /** Shown next to the name in the list, e.g. an email. Agents rarely have one. */
  secondaryLabel?: string;
  avatarUrl?: string;
};

type AssigneeEntry = {
  ref: AssigneeRef | null;
  label: string;
  secondaryLabel?: string;
  avatarUrl?: string;
};

const UNASSIGNED_KEY = "__unassigned__";

function entryKey(entry: AssigneeEntry): string {
  return entry.ref ? `${entry.ref.kind}:${entry.ref.id}` : UNASSIGNED_KEY;
}

function refsEqual(a: AssigneeRef | null, b: AssigneeRef | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.kind === b.kind;
}

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

/**
 * Below this many entries (including "unassigned") a search box only adds
 * friction — the whole list already fits without scrolling or scanning, so
 * we skip it entirely rather than show an input nobody needs to use.
 */
const SEARCH_VISIBILITY_THRESHOLD = 8;

function AssigneeRow({ entry }: { entry: AssigneeEntry }) {
  return (
    <>
      <Avatar size="sm" className="size-5">
        {entry.avatarUrl ? <AvatarImage src={entry.avatarUrl} alt="" /> : null}
        <AvatarFallback>
          {entry.ref ? initialOf(entry.label) : <UserMinus className="size-3" aria-hidden />}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.ref?.kind === "agent" ? <AgentBadge className="shrink-0" /> : null}
      {entry.secondaryLabel ? (
        <span className="shrink-0 truncate text-caption text-muted-foreground">
          {entry.secondaryLabel}
        </span>
      ) : null}
    </>
  );
}

/**
 * Shared trigger + searchable list picker for the assignee field (member or
 * agent). Callers own the trigger's visible content via `children` and the
 * offerable set via `options` — the table cell and batch toolbar pass human
 * members only, and keep doing exactly that; the sidebar passes members and
 * agents. Widening this component to *offer* agents everywhere is not this
 * task's call to make (see the assignee-picker report).
 *
 * `onTriggerPointerDown` mirrors `EnumFieldPicker`'s stop-row-navigation
 * forwarding (same two event/element combinations, not a new one): the
 * trigger's `onPointerDown`/`onAuxClick`, and the popup's `onAuxClick`.
 */
export function AssigneePicker({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  unassignedLabel,
  searchPlaceholder,
  noResultsLabel,
  onTriggerPointerDown,
  triggerClassName,
  align = "start",
  children,
}: {
  value: AssigneeRef | null;
  options: AssigneeOption[];
  onChange: (value: AssigneeRef | null) => void;
  disabled?: boolean;
  ariaLabel: string;
  unassignedLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  onTriggerPointerDown?: (event: SyntheticEvent) => void;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  const entries = useMemo<AssigneeEntry[]>(
    () => [
      { ref: null, label: unassignedLabel },
      ...options.map((option) => ({
        ref: { id: option.id, kind: option.kind },
        label: option.name,
        secondaryLabel: option.secondaryLabel,
        avatarUrl: option.avatarUrl,
      })),
    ],
    [options, unassignedLabel],
  );

  const selected = useMemo(
    () => entries.find((entry) => refsEqual(entry.ref, value)) ?? null,
    [entries, value],
  );

  const showSearch = entries.length > SEARCH_VISIBILITY_THRESHOLD;

  // `disabled` is deliberately not forwarded to Combobox's own `disabled`
  // prop: that lands on the rendered native <button> as a real `disabled`
  // attribute (removing it from the tab order), which is exactly what the
  // project's accessibility contract forbids (aria-disabled, never
  // `disabled`, on an interactive control that must stay reachable). Instead
  // we hold `open` closed ourselves — Combobox opens on pointerdown, earlier
  // than the click-time `aria-disabled` guard on `Button` would run.
  const [open, setOpen] = useState(false);

  return (
    <Combobox
      items={entries}
      itemToStringLabel={(entry: AssigneeEntry) => entry.label}
      itemToStringValue={(entry: AssigneeEntry) => entryKey(entry)}
      isItemEqualToValue={(a: AssigneeEntry, b: AssigneeEntry) => entryKey(a) === entryKey(b)}
      value={selected}
      onValueChange={(entry: AssigneeEntry | null) => onChange(entry?.ref ?? null)}
      open={disabled ? false : open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
    >
      <ComboboxTrigger
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
      </ComboboxTrigger>
      <ComboboxContent align={align} onAuxClick={onTriggerPointerDown} className="w-64">
        {showSearch ? (
          <ComboboxInput
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            showTrigger={false}
          />
        ) : null}
        <ComboboxEmpty>{noResultsLabel}</ComboboxEmpty>
        <ComboboxList>
          {(entry: AssigneeEntry) => (
            <ComboboxItem key={entryKey(entry)} value={entry}>
              <AssigneeRow entry={entry} />
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
