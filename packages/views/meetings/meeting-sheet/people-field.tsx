"use client";
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import type { Member } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { meetingAvatarTint } from "../meeting-detail/avatar-tint";
import { kitButton } from "../meeting-detail/ui/kit-buttons";
import { TextButton } from "../meeting-detail/ui/text-button";
import { MeetingPersonAvatar } from "../meeting-person";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { PhonePeoplePicker } from "./phone-picker";
import { setRole, type DraftPerson, type DraftRole } from "./draft-model";
import { PersonRoleRow, PreviousSecretaryNote, SecretaryNote, type Rsvp } from "./person-role-row";
import { CONTROL, FIELD_LABEL } from "./sheet-styles";

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

const MAX_ROWS = 4;

/**
 * The search-first picker (create brief §2.4): typing opens a listbox of the
 * members not chosen yet (4 rows of 44, then it scrolls); Enter adds the
 * active one, the input clears and keeps focus. Esc closes the list without
 * closing the sheet.
 */
export function PeopleSearch({
  id,
  labelledBy,
  members,
  exclude,
  onPick,
  loadState,
  onRetry,
  readOnly,
  className,
}: {
  id: string;
  labelledBy: string;
  members: readonly Member[];
  exclude: ReadonlySet<string>;
  onPick: (userId: string) => void;
  loadState: "ready" | "pending" | "error";
  onRetry: () => void;
  readOnly?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const options = useMemo(() => {
    const needle = fold(query.trim());
    return members.filter((m) => !exclude.has(m.user_id) && (!needle || fold(`${m.display_name} ${m.email}`).includes(needle)));
  }, [members, exclude, query]);
  const others = members.filter((m) => !exclude.has(m.user_id)).length;
  const pick = (m: Member | undefined) => {
    if (!m) return;
    onPick(m.user_id);
    setQuery("");
    setActive(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (options.length ? (i + step + options.length) % options.length : 0));
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault();
      e.stopPropagation();
      pick(options[active]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    }
  };
  const showList = open && !readOnly && (query.trim() !== "" || loadState !== "ready" || options.length > 0);
  return (
    <div className={cn("relative", className)}>
      <div className={cn(CONTROL, "flex w-full items-center gap-2 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring group-data-[fresh]/sheet:px-3")}>
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          id={id}
          role="combobox"
          aria-labelledby={labelledBy}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && options[active] ? `${listId}-${options[active].user_id}` : undefined}
          aria-readonly={readOnly || undefined}
          readOnly={readOnly}
          autoComplete="off"
          placeholder={t("meetings.searchMembers")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(query.trim() !== "")}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground group-data-[fresh]/sheet:h-5"
        />
      </div>
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={labelledBy}
          className="absolute inset-x-0 top-full z-10 mt-1 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-(--menu-shadow)"
          style={{ maxHeight: `${MAX_ROWS * 44 + 10}px` }}
        >
          {loadState === "pending" ? (
            <li className="px-2 py-3 text-body text-muted-foreground">{t("common.loading")}</li>
          ) : loadState === "error" ? (
            <li className="flex items-center justify-between gap-2 px-2 py-2 text-body text-destructive">
              {t("meetings.membersLoadFailed")}
              <TextButton onMouseDown={(e) => e.preventDefault()} onClick={onRetry}>
                {t("common.retry")}
              </TextButton>
            </li>
          ) : options.length === 0 ? (
            <li className="px-2 py-3 text-body text-muted-foreground">
              {others === 0 ? t("meetings.noOtherMembers") : t("meetings.noPeopleMatch")}
            </li>
          ) : (
            options.map((m, i) => (
              // The combobox input drives these rows from the keyboard (arrows + Enter, aria-activedescendant).
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={m.user_id}
                id={`${listId}-${m.user_id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(m)}
                className={cn("flex h-11 cursor-default items-center gap-2.5 rounded-sm px-2 text-body", i === active && "bg-surface-hover")}
              >
                <MeetingPersonAvatar name={m.display_name} avatarUrl={m.avatar_url} size={24} tint={meetingAvatarTint(m.user_id, members)} />
                <span className="min-w-0 truncate">{m.display_name}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Người tham dự (create brief §2.4): the count at the label's right, the
 * search, then the host row (fixed) and one row per chosen person with a role
 * chip. `edit` adds RSVP dots, ⋯ remove with an inline confirm and hides the
 * search behind "+ Thêm người". `variant="chips"` is Họp ngay's compact form
 * (no roles).
 */
export function PeopleField({
  idPrefix,
  workspaceId,
  host,
  viewerId,
  people,
  onChange,
  readOnly,
  edit,
  rsvp,
  previousSecretaryId,
  previousWeek,
  variant = "rows",
}: {
  idPrefix: string;
  workspaceId: string;
  host: { userId: string; name: string; avatarUrl?: unknown };
  viewerId: string | undefined;
  people: readonly DraftPerson[];
  onChange: (people: DraftPerson[]) => void;
  readOnly?: boolean;
  edit?: boolean;
  rsvp?: ReadonlyMap<string, Rsvp>;
  /** Follow-up: the previous meeting's secretary, offered back as "Giao lại vai thư ký". */
  previousSecretaryId?: string;
  previousWeek?: number | null;
  variant?: "rows" | "chips";
}) {
  const { t } = useTranslation();
  const { data: members = [], isPending, isError, refetch } = useMembers(workspaceId);
  const [adding, setAdding] = useState(false);
  // Below the kit's phone width the picker is a bottom sheet (CreatePhone f2).
  const phone = useMediaQuery("(max-width: 639px)");
  const [picking, setPicking] = useState(false);
  const byId = new Map(members.map((m) => [m.user_id, m]));
  const exclude = new Set([host.userId, ...people.map((p) => p.userId)]);
  const labelId = `${idPrefix}-people-label`;
  const searchId = `${idPrefix}-people`;
  const nameOf = (userId: string) => byId.get(userId)?.display_name ?? t("meetings.formerMember");
  const add = (userId: string) => onChange([...people, { userId, role: "MEMBER" }]);
  const remove = (userId: string) => onChange(people.filter((p) => p.userId !== userId));
  const role = (userId: string, next: DraftRole) => onChange(setRole(people, userId, next));
  const secretary = people.find((p) => p.role === "SECRETARY");
  const showSearch = !edit || adding;
  const toggle = (userId: string) => (exclude.has(userId) ? remove(userId) : add(userId));
  const search = showSearch && phone && variant === "rows" ? (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => setPicking(true)}
      className={cn(CONTROL, "flex w-full items-center gap-2 text-left text-muted-foreground", edit && "mt-1")}
      aria-labelledby={labelId}
    >
      <Search aria-hidden className="size-4 shrink-0" />
      {t("meetings.searchMembers")}
    </button>
  ) : showSearch ? (
    <PeopleSearch
        id={searchId}
        labelledBy={labelId}
        members={members}
        exclude={exclude}
        onPick={add}
        loadState={isPending ? "pending" : isError ? "error" : "ready"}
        onRetry={() => void refetch()}
        readOnly={readOnly}
        className={edit ? "mt-1" : undefined}
      />
  ) : null;

  return (
    <div role="group" aria-labelledby={labelId}>
      {picking ? (
        <PhonePeoplePicker
          members={members}
          hostId={host.userId}
          chosen={new Set(people.map((p) => p.userId))}
          onToggle={toggle}
          onClose={() => setPicking(false)}
        />
      ) : null}
      <div className={cn("flex items-baseline justify-between gap-3", edit ? "mb-1 group-data-[mode=live]/sheet:mb-2.5" : "mb-2")}>
        <span id={labelId} className={cn(FIELD_LABEL, "mb-0")}>
          {t("meetings.attendees")}
        </span>
        <span className="text-caption text-muted-foreground" aria-live="polite">
          {t("meetings.sheet.peopleCount", { count: people.length + 1 })}
        </span>
      </div>
      {edit ? null : search}
      {variant === "chips" ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {people.map((p) => (
            <li key={p.userId} className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border pr-0.5 pl-1 text-label">
              <MeetingPersonAvatar name={nameOf(p.userId)} avatarUrl={byId.get(p.userId)?.avatar_url} size={20} tint={meetingAvatarTint(p.userId, members)} />
              {nameOf(p.userId)}
              <Button
                variant="ghost"
                size="icon-xs"
                className={kitButton.icon}
                aria-label={t("meetings.sheet.removePerson", { name: nameOf(p.userId) })}
                onClick={() => !readOnly && remove(p.userId)}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className={cn(!edit && "mt-1 group-data-[fresh]/sheet:mt-2")}>
          <PersonRoleRow
            name={host.name}
            avatarUrl={host.avatarUrl}
            tint={meetingAvatarTint(host.userId, members)}
            you={host.userId === viewerId}
            host
          />
          {people.map((p) => (
            <PersonGroup key={p.userId} isSecretary={!edit && secretary?.userId === p.userId} secretaryName={nameOf(p.userId)}>
              <PersonRoleRow
                name={nameOf(p.userId)}
                avatarUrl={byId.get(p.userId)?.avatar_url}
                tint={meetingAvatarTint(p.userId, members)}
                role={p.role}
                rsvp={rsvp?.get(p.userId)}
                readOnly={readOnly}
                onRole={(next) => role(p.userId, next)}
                onRemove={() => remove(p.userId)}
                removeStyle={edit ? "menu" : "x"}
                note={
                  previousSecretaryId === p.userId && p.role !== "SECRETARY" ? (
                    <PreviousSecretaryNote week={previousWeek ?? null} onAssign={readOnly ? undefined : () => role(p.userId, "SECRETARY")} />
                  ) : undefined
                }
              />
            </PersonGroup>
          ))}
        </ul>
      )}
      {edit ? (
        adding ? (
          search
        ) : (
          <button
            type="button"
            disabled={readOnly}
            onClick={() => {
              setAdding(true);
              requestAnimationFrame(() => document.getElementById(searchId)?.focus());
            }}
            className="-mx-2 mt-0.5 flex h-9 w-fit items-center gap-3 rounded-md pr-2.5 pl-2 text-body font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground pointer-coarse:min-h-11 [&_svg]:size-4"
          >
            <UserPlus aria-hidden />
            {t("meetings.sheet.addPerson")}
          </button>
        )
      ) : null}
    </div>
  );
}

function PersonGroup({ isSecretary, secretaryName, children }: { isSecretary: boolean; secretaryName: string; children: ReactNode }) {
  return (
    <>
      {children}
      {isSecretary ? <SecretaryNote name={secretaryName} /> : null}
    </>
  );
}
