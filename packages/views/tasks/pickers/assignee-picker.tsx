"use client";

import type { ReactElement, ReactNode, SyntheticEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UserMinus } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  ActorAvatar,
  type ActorAvatarStatus,
} from "@uniwork/ui/components/common/actor-avatar";
import { foldedIncludes } from "../../common/search-fold";
import {
  PickerEmpty,
  PickerItem,
  PickerSection,
  PropertyPicker,
  type PickerAnchor,
} from "./property-picker";
import { usePickerTriggerLabel } from "./trigger-label";

export type AssigneeKind = "human" | "agent";

/** ADR 0007: attribution travels as an (id, kind) pair, never id alone. */
export type AssigneeRef = { id: string; kind: AssigneeKind };

export type AssigneeOption = {
  id: string;
  kind: AssigneeKind;
  name: string;
  /** Searchable alongside the name, e.g. an email. Not shown in the list. */
  secondaryLabel?: string;
  avatarUrl?: string;
  /** Set when the option cannot take new work (e.g. a paused agent): the row
   * stays listed and readable but cannot be picked. */
  disabledReason?: string;
  /** Dot on the avatar: presence for a member, lifecycle for an agent. */
  status?: ActorAvatarStatus;
};

function refsEqual(a: AssigneeRef | null, b: AssigneeRef | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.kind === b.kind;
}

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function matchesQuery(option: AssigneeOption, query: string): boolean {
  return (
    foldedIncludes(option.name, query) ||
    (option.secondaryLabel ? foldedIncludes(option.secondaryLabel, query) : false)
  );
}

function AssigneeSection({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: AssigneeOption[];
  value: AssigneeRef | null;
  onSelect: (ref: AssigneeRef) => void;
}) {
  if (options.length === 0) return null;
  return (
    <PickerSection label={label}>
      {options.map((option) => {
        const ref: AssigneeRef = { id: option.id, kind: option.kind };
        return (
          <PickerItem
            key={`${option.kind}:${option.id}`}
            selected={refsEqual(ref, value)}
            disabled={option.disabledReason !== undefined}
            disabledReason={option.disabledReason}
            onClick={() => onSelect(ref)}
          >
            <span aria-hidden className="inline-flex shrink-0">
              <ActorAvatar
                name=""
                initials={initialOf(option.name)}
                avatarUrl={option.avatarUrl}
                isAgent={option.kind === "agent"}
                size="sm"
                status={option.status}
              />
            </span>
            <span className="min-w-0 truncate">{option.name}</span>
            {option.status ? <span className="sr-only">{option.status.label}</span> : null}
          </PickerItem>
        );
      })}
    </PickerSection>
  );
}

/**
 * The one picker for "who owns this": task assignee (detail sidebar, subtask
 * row, table cell, batch toolbar, create dialogs, chat) and project lead.
 * Search on top, "unassigned" pinned first, then members and agents in their
 * own groups. Callers own the trigger's content via `children` and the
 * offerable set via `options` — the table cell and batch toolbar pass human
 * members only.
 *
 * `onTriggerNavigationGuard` keeps every interaction with the picker from
 * reaching an enclosing row's navigation handler: trigger pointerdown, click
 * and middle click (separate events — stopping one does not stop the others),
 * and every click inside the portalled popup, which React still bubbles
 * through the component tree to the row. Enter in the search box clicks the
 * highlighted item, so it goes through the popup guard too.
 *
 * `disabled` never reaches a native `disabled` attribute: the trigger keeps
 * `aria-disabled` and stays in the tab order, and the list is held closed.
 *
 * A row action opens it from a menu instead of a trigger: pass `open` /
 * `onOpenChange` and an `anchor` (the menu button, or the pointer position of
 * a right click); no trigger is rendered then.
 */
export function AssigneePicker({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  valueLabel,
  unassignedLabel,
  searchPlaceholder,
  noResultsLabel,
  listMessage,
  onTriggerNavigationGuard,
  triggerClassName,
  triggerRender,
  open: controlledOpen,
  onOpenChange,
  anchor,
  align = "start",
  children,
}: {
  value: AssigneeRef | null;
  options: AssigneeOption[];
  onChange: (value: AssigneeRef | null) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** The value the trigger shows, as text. Joined into the accessible name
   * ("field: value") so the name contains what is visible; omit it only when
   * the trigger shows a fixed action label. */
  valueLabel?: string;
  unassignedLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  /** Shown under the list in place of the options, e.g. while they load. */
  listMessage?: string;
  onTriggerNavigationGuard?: (event: SyntheticEvent) => void;
  triggerClassName?: string;
  /** Replaces the default ghost button (e.g. a PillButton in a composer);
   * the caller then owns its accessible name. */
  triggerRender?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  anchor?: PickerAnchor;
  align?: "start" | "center" | "end";
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState("");
  // A controlled close never fires onOpenChange, so disabling an open list
  // would leave `open` true and it would pop back when `disabled` clears.
  // Reset it during render, before anything commits.
  if (disabled && internalOpen) setInternalOpen(false);
  const open = controlledOpen ?? internalOpen;
  const triggerLabel = usePickerTriggerLabel(ariaLabel, valueLabel);

  const matches = options.filter((option) => matchesQuery(option, query));
  const members = matches.filter((option) => option.kind === "human");
  const agents = matches.filter((option) => option.kind === "agent");

  const handleOpenChange = (next: boolean) => {
    if (disabled && next) return;
    setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) setQuery("");
  };
  const select = (ref: AssigneeRef | null) => {
    onChange(ref);
    handleOpenChange(false);
  };

  return (
    <PropertyPicker
      open={disabled ? false : open}
      onOpenChange={handleOpenChange}
      width="w-64"
      align={align}
      searchable
      searchPlaceholder={searchPlaceholder}
      searchAriaLabel={searchPlaceholder}
      onSearchChange={setQuery}
      popupEventGuard={onTriggerNavigationGuard}
      anchor={anchor}
      triggerRender={
        triggerRender ?? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={triggerClassName}
            aria-disabled={disabled || undefined}
            aria-label={triggerLabel}
            onPointerDown={onTriggerNavigationGuard}
            onClick={onTriggerNavigationGuard}
            onAuxClick={onTriggerNavigationGuard}
          />
        )
      }
      trigger={children}
    >
      <PickerItem emptyValue selected={value == null} onClick={() => select(null)}>
        <UserMinus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate text-muted-foreground">{unassignedLabel}</span>
      </PickerItem>
      <AssigneeSection
        label={t("tasks.create.assignee_members")}
        options={members}
        value={value}
        onSelect={select}
      />
      <AssigneeSection
        label={t("tasks.create.assignee_agents")}
        options={agents}
        value={value}
        onSelect={select}
      />
      {listMessage ? (
        <PickerEmpty>{listMessage}</PickerEmpty>
      ) : matches.length === 0 && query ? (
        <PickerEmpty>{noResultsLabel}</PickerEmpty>
      ) : null}
    </PropertyPicker>
  );
}
