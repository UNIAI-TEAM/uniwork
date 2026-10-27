"use client";

import { useId, useRef, useState, type ReactElement } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { foldedIncludes } from "@uniwork/core/chat/search-fold";
import { TRASH_KINDS, TRASH_MAX_DELETERS, type TrashKind } from "@uniwork/core/trash";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { PILL, PILL_ON } from "../documents/documents-library-toolbar";
import { initials } from "../people/actor-chip";
import { KIND_ICONS } from "./trash-table";

const PILL_OFF = "border-border bg-background text-foreground hover:bg-muted";
// The global focus outline, drawn with no gap so it traces the chip's own
// border instead of a smaller pill inside it.
const CHIP_PART = "inline-flex h-full items-center focus-visible:outline-offset-0 pointer-coarse:min-h-11";
// The menu's own check mark is hidden: the row ends in a box like the people list's.
const KIND_ITEM = "gap-2 px-2 py-2 pointer-coarse:min-h-11 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden";

/**
 * One filter chip: a pill that opens its list and, once something is picked,
 * a separate × beside the opener that clears the filter without opening it.
 * Picked, the pill reads the picked values (cut with … past its width, whole
 * in `title`); empty, it reads only the filter's name.
 */
function ChipShell({
  label,
  picked,
  onClear,
  trigger,
}: {
  label: string;
  picked: string[];
  onClear: () => void;
  /** Renders the list's own trigger (DropdownMenuTrigger, PopoverTrigger) with the chip's props. */
  trigger: (props: React.ComponentProps<"button">) => ReactElement;
}) {
  const { t } = useTranslation();
  const opener = useRef<HTMLButtonElement>(null);
  const text = picked.join(", ");
  const active = picked.length > 0;
  return (
    <div className={cn(PILL, active ? PILL_ON : PILL_OFF, "max-w-full gap-0 px-0")}>
      {trigger({
        ref: opener,
        type: "button",
        "aria-label": active ? `${label}: ${text}` : undefined,
        title: active ? text : undefined,
        className: cn(CHIP_PART, "min-w-0 gap-1 pl-3", active ? "rounded-l-full pr-1" : "rounded-full pr-2.5"),
        children: (
          <>
            <span className="max-w-48 truncate">{active ? text : label}</span>
            {active ? null : <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />}
          </>
        ),
      })}
      {active ? (
        <button
          type="button"
          aria-label={t("trash.clear_filter", { name: label })}
          onClick={() => {
            onClear();
            // The × leaves with the filter; focus stays on the chip.
            opener.current?.focus();
          }}
          className={cn(CHIP_PART, "shrink-0 justify-center rounded-r-full pr-2 pl-1 pointer-coarse:min-w-11")}
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The Checkbox primitive's box, drawn only: inside a menu row the row itself
 * is the one control and announces its checked state.
 */
function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      data-slot="trash-filter-check"
      data-checked={checked ? "" : undefined}
      className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input text-primary-foreground dark:bg-input/30 data-checked:border-primary data-checked:bg-primary dark:data-checked:bg-primary"
    >
      {checked ? <Check className="size-3.5" /> : null}
    </span>
  );
}

/** Loại: a checkable row per kind, with the mark the Tên column shows and a box on the right. */
export function KindFilter({
  kinds,
  options,
  onChange,
}: {
  kinds: TrashKind[];
  options: readonly TrashKind[];
  onChange: (next: TrashKind[]) => void;
}) {
  const { t } = useTranslation();
  const labelOf = (kind: TrashKind) => t(`trash.kinds.${kind}`);
  return (
    <DropdownMenu>
      <ChipShell
        label={t("trash.kind_label")}
        picked={TRASH_KINDS.filter((k) => kinds.includes(k)).map(labelOf)}
        onClear={() => onChange([])}
        trigger={(props) => <DropdownMenuTrigger {...props} />}
      />
      <DropdownMenuContent align="start" className="min-w-44">
        {options.map((kind) => {
          const Icon = KIND_ICONS[kind];
          const checked = kinds.includes(kind);
          return (
            <DropdownMenuCheckboxItem
              key={kind}
              checked={checked}
              onCheckedChange={(on) => {
                const next = on ? [...kinds, kind] : kinds.filter((k) => k !== kind);
                onChange(TRASH_KINDS.filter((k) => next.includes(k)));
              }}
              className={KIND_ITEM}
            >
              {Icon ? <Icon aria-hidden className="size-4 text-muted-foreground" /> : null}
              {labelOf(kind)}
              <CheckMark checked={checked} />
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface Person {
  id: string;
  /** What the row and the chip read: Tôi for the reader, the name for the others. */
  label: string;
  name: string;
  /** Label, name and email, for the people search. */
  search: string;
  avatarUrl?: string;
}

/**
 * Người xóa: a people search over checkable rows, Tôi first, then the others
 * by name, each ending in its checkbox. Past TRASH_MAX_DELETERS picks the
 * unticked rows lock, as the server would refuse one more.
 */
export function PeopleFilter({
  trashedBy,
  members,
  meId,
  onChange,
}: {
  trashedBy: string[];
  members: readonly { user_id: string; display_name: string; email?: string; avatar_url?: unknown }[];
  meId: string;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const capId = `${baseId}-cap`;
  const [query, setQuery] = useState("");
  const person = (id: string, m: (typeof members)[number] | undefined, label?: string): Person => {
    const name = m?.display_name || m?.email || label || id;
    return {
      id,
      label: label ?? name,
      name,
      search: [label, m?.display_name, m?.email].filter(Boolean).join(" "),
      avatarUrl: typeof m?.avatar_url === "string" ? m.avatar_url : undefined,
    };
  };
  const people: Person[] = [
    person(
      meId,
      members.find((m) => m.user_id === meId),
      t("trash.trashed_by_me"),
    ),
    ...members
      .filter((m) => m.user_id !== meId)
      .map((m) => person(m.user_id, m))
      .sort((a, b) => a.label.localeCompare(b.label, "vi")),
  ];
  const known = new Set(people.map((p) => p.id));
  // People who left the workspace still name the filter they were picked in, once for all of them.
  const former = trashedBy.filter((id) => !known.has(id)).length;
  const picked = [
    ...people.filter((p) => trashedBy.includes(p.id)).map((p) => p.label),
    ...(former === 1 ? [t("trash.unknown_member")] : former > 1 ? [t("trash.former_members", { count: former })] : []),
  ];
  const full = trashedBy.length >= TRASH_MAX_DELETERS;
  const shown = people.filter((p) => foldedIncludes(p.search, query));
  const label = t("trash.trashed_by_label");

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <ChipShell label={label} picked={picked} onClear={() => onChange([])} trigger={(props) => <PopoverTrigger {...props} />} />
      <PopoverContent align="start" className="gap-2 p-2">
        <Input
          type="search"
          value={query}
          aria-label={t("trash.search_people")}
          placeholder={t("trash.search_people")}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 [&::-webkit-search-cancel-button]:hidden"
        />
        {full ? (
          <p id={capId} className="px-2 text-caption text-muted-foreground">
            {t("trash.people_cap", { max: TRASH_MAX_DELETERS })}
          </p>
        ) : null}
        <div role="group" aria-label={label} className="max-h-64 overflow-x-hidden overflow-y-auto">
          {shown.length === 0 ? (
            <p className="px-2 py-3 text-caption text-muted-foreground">{t("trash.no_people")}</p>
          ) : (
            shown.map((p) => {
              const id = `${baseId}-${p.id}`;
              const checked = trashedBy.includes(p.id);
              const locked = full && !checked;
              return (
                <label
                  key={p.id}
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-muted pointer-coarse:min-h-11 has-[[aria-disabled=true]]:cursor-not-allowed has-[[aria-disabled=true]]:opacity-50"
                >
                  {/* The name follows in text; the initials would only repeat it. */}
                  <span aria-hidden className="contents">
                    <ActorAvatar name={p.name} initials={initials(p.name)} avatarUrl={p.avatarUrl} size="xs" />
                  </span>
                  <span className="min-w-0 truncate">{p.label}</span>
                  {/* aria-disabled, not disabled: a locked row stays in the tab order and says why. */}
                  <Checkbox
                    id={id}
                    checked={checked}
                    aria-disabled={locked || undefined}
                    aria-describedby={locked ? capId : undefined}
                    onCheckedChange={(on) => {
                      if (on && full) return;
                      onChange(on ? [...trashedBy, p.id] : trashedBy.filter((v) => v !== p.id));
                    }}
                    className="ml-auto"
                  />
                </label>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
