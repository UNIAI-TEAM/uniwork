"use client";

import { useId, useRef, useState, type ReactElement } from "react";
import { ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { foldedIncludes } from "@uniwork/core/chat/search-fold";
import type { TrashKind } from "@uniwork/core/trash";
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

/** Every kind in the order the list and the request name them. */
export const TRASH_KIND_ORDER: readonly TrashKind[] = ["task", "project", "document"];

const PILL_OFF = "border-border bg-background text-foreground hover:bg-muted";
const ITEM = "gap-2 px-2 py-2 pointer-coarse:min-h-11";

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
        className: cn("inline-flex h-full min-w-0 items-center gap-1 rounded-full pl-3 pointer-coarse:min-h-11", active ? "pr-1" : "pr-2.5"),
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
          className="inline-flex h-full shrink-0 items-center justify-center rounded-full pr-2 pl-1 pointer-coarse:min-w-11"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Loại: a checkable item per kind, with the mark the Tên column shows. */
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
        picked={TRASH_KIND_ORDER.filter((k) => kinds.includes(k)).map(labelOf)}
        onClear={() => onChange([])}
        trigger={(props) => <DropdownMenuTrigger {...props} />}
      />
      <DropdownMenuContent align="start" className="min-w-44">
        {options.map((kind) => {
          const Icon = KIND_ICONS[kind];
          return (
            <DropdownMenuCheckboxItem
              key={kind}
              checked={kinds.includes(kind)}
              onCheckedChange={(on) => {
                const next = on ? [...kinds, kind] : kinds.filter((k) => k !== kind);
                onChange(TRASH_KIND_ORDER.filter((k) => next.includes(k)));
              }}
              className={ITEM}
            >
              {Icon ? <Icon aria-hidden className="size-4 text-muted-foreground" /> : null}
              {labelOf(kind)}
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

/** Người xóa: a people search over checkable rows, Tôi first, then the others by name. */
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
  const [query, setQuery] = useState("");
  const meLabel = t("trash.trashed_by_me");
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
      meLabel,
    ),
    ...members
      .filter((m) => m.user_id !== meId)
      .map((m) => person(m.user_id, m))
      .sort((a, b) => a.label.localeCompare(b.label, "vi")),
  ];
  const known = new Set(people.map((p) => p.id));
  const picked = [
    ...people.filter((p) => trashedBy.includes(p.id)).map((p) => p.label),
    // Someone who left the workspace still names the filter they were picked in.
    ...trashedBy.filter((id) => !known.has(id)).map(() => t("trash.unknown_member")),
  ];
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
          className="h-8"
        />
        <div role="group" aria-label={label} className="max-h-64 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="px-2 py-3 text-caption text-muted-foreground">{t("trash.no_people")}</p>
          ) : (
            shown.map((p) => {
              const id = `${baseId}-${p.id}`;
              return (
                <label
                  key={p.id}
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-muted pointer-coarse:min-h-11"
                >
                  <Checkbox
                    id={id}
                    checked={trashedBy.includes(p.id)}
                    onCheckedChange={(on) => onChange(on ? [...trashedBy, p.id] : trashedBy.filter((v) => v !== p.id))}
                  />
                  {/* The name follows in text; the initials would only repeat it. */}
                  <span aria-hidden className="contents">
                    <ActorAvatar name={p.name} initials={initials(p.name)} avatarUrl={p.avatarUrl} size="xs" />
                  </span>
                  <span className="min-w-0 truncate">{p.label}</span>
                </label>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
