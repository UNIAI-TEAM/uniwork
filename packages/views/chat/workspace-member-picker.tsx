"use client";

import { Check, Search, UserPlus, X, type LucideIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toChatContactFromLookup, useLookupChatUser } from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import { selectIsUserOnline, usePresenceStore } from "@uniwork/core/chat/presence-store";
import type { Member } from "@uniwork/core/types/workspace";
import { useMembers } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import {
  filterWorkspaceMembers,
  findWorkspaceMemberByEmail,
  memberDisplayLabel,
  memberPickerEmptyReason,
  memberToChatContact,
  shouldLookupEmailOutsideWorkspace,
} from "./workspace-member-picker-utils";
import { memberAvatarUrl } from "./chat-member-avatar";
import { CHAT_FIELD_CLASS, CHAT_PILL_SM_CLASS, CHAT_SECTION_LABEL_CLASS } from "./chat-dialog-look";
import { initialsOf } from "./chat-initials";
import { chatPersonFaceClass } from "./chat-person-card";

/** A person's face in the pickers: two letters on their colour, and the presence dot. */
function MemberFace({
  userId,
  label,
  avatarUrl,
  small = false,
}: {
  userId: string;
  label: string;
  avatarUrl?: string;
  small?: boolean;
}) {
  const online = usePresenceStore((state) => selectIsUserOnline(state, userId));
  return (
    <span className="relative inline-flex shrink-0">
      <ActorAvatar
        name={label}
        initials={initialsOf(label)}
        avatarUrl={avatarUrl}
        size="fluid"
        className={cn(small ? "size-9 text-caption" : "size-10 text-label", chatPersonFaceClass(userId))}
      />
      {online ? (
        <span
          aria-hidden
          className="absolute -right-px -bottom-px size-3 rounded-full border-2 border-(--row-fill,var(--surface)) bg-success-solid"
        />
      ) : null}
    </span>
  );
}

/**
 * The search box every "add people" flow shares. Enter runs the search
 * (an exact email reaches people outside the workspace); the hint under the
 * field says so, and is wired to the input as its description.
 */
export function WorkspaceMemberSearchField({
  id,
  label,
  query,
  onQueryChange,
  onSubmit,
  placeholder,
  hint,
  inputRef,
  onArrowDown,
}: {
  id: string;
  label: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  hint?: string;
  /** The dialog returns focus here after a pick, a chip removal or a clear. */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** ↓ from the field moves into the result list. */
  onArrowDown?: () => void;
}) {
  const { t } = useTranslation();
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const hasQuery = query.trim().length > 0;
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-label font-semibold text-foreground">
        {label}
      </Label>
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={ref}
          id={id}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter that confirms a Telex/VNI syllable must not run the search.
            if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) {
              e.preventDefault();
            }
            if (e.key === "ArrowDown" && onArrowDown) {
              e.preventDefault();
              onArrowDown();
            }
          }}
          placeholder={placeholder}
          type="search"
          autoComplete="off"
          aria-describedby={hint ? hintId : undefined}
          className={cn(CHAT_FIELD_CLASS, "pl-10.5", hasQuery ? "pr-12" : "pr-3.5")}
        />
        {hasQuery ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="absolute right-0 top-1/2 size-11 -translate-y-1/2 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label={t("chat.clear_search")}
            onClick={() => {
              onQueryChange("");
              ref.current?.focus();
            }}
          >
            <X className="size-4" aria-hidden />
          </Button>
        ) : null}
      </form>
      {hint ? (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const ROW_SELECTOR = "[data-member-picker-row]";

/**
 * Focus plumbing every "add people" dialog shares: after a pick, a chip
 * removal or a cleared search, focus goes back to the search field (the row
 * that was picked is gone); ↓ from the field enters the list.
 */
export function useMemberPickerFocus() {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const focusFirstRow = useCallback(() => {
    listRef.current?.querySelector<HTMLElement>(ROW_SELECTOR)?.focus();
  }, []);
  return { inputRef, listRef, focusInput, focusFirstRow };
}

/** Up/Down/Home/End move focus between rows, like a menu; returns the new row. */
function moveRowFocus(event: KeyboardEvent<HTMLUListElement>): number | null {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return null;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR));
  if (rows.length === 0) return null;
  event.preventDefault();
  const current = rows.indexOf(document.activeElement as HTMLButtonElement);
  let next = 0;
  if (event.key === "End") next = rows.length - 1;
  else if (event.key === "ArrowDown") next = current < 0 ? 0 : Math.min(current + 1, rows.length - 1);
  else if (event.key === "ArrowUp") next = current < 0 ? 0 : Math.max(current - 1, 0);
  rows[next]?.focus();
  return next;
}

function MemberRowSkeleton() {
  return (
    <li className="flex min-h-14 items-center gap-3 px-3.5 py-2" aria-hidden>
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </span>
    </li>
  );
}

/** A row's trailing action mark: it takes the brand wash while the row is hovered or focused. */
export function MemberRowActionMark({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors group-hover:bg-brand-subtle group-hover:text-brand-subtle-foreground group-focus-visible:bg-brand-subtle group-focus-visible:text-brand-subtle-foreground"
    >
      <Icon className="size-5" />
    </span>
  );
}

export function WorkspaceMemberPickerList({
  members,
  loading,
  query = "",
  hasOtherMembers = true,
  heading,
  emptyLabel,
  allPickedLabel,
  actionIcon,
  nameOnly = false,
  selectedUserIds,
  onPick,
  listRef,
}: {
  members: Member[];
  loading?: boolean;
  /** The text in the search box: an empty list only blames the query when there is one. */
  query?: string;
  /** False when the workspace has nobody but the current user. */
  hasOtherMembers?: boolean;
  heading?: string;
  /** Shown when a typed query matched no one. */
  emptyLabel?: string;
  /** Shown with no query when everyone left is already picked or already in the room. */
  allPickedLabel?: string;
  actionIcon?: ReactNode;
  /** Avatar and name only: for a screen that never shows an email (the access report). */
  nameOnly?: boolean;
  /** Checkbox rows (canvas create-group/channel): a pick toggles, and picked rows stay, ticked. */
  selectedUserIds?: ReadonlySet<string>;
  onPick: (contact: ChatContact) => void;
  /** From useMemberPickerFocus: lets ↓ in the search field reach the rows. */
  listRef?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  // Roving tabindex: the list is one Tab stop; arrows move inside it.
  const [focusIndex, setFocusIndex] = useState(0);
  const tabStop = focusIndex < members.length ? focusIndex : 0;

  let body: ReactNode;
  if (loading) {
    body = (
      <div role="status">
        <span className="sr-only">{t("chat.loading_members")}</span>
        <ul className="divide-y divide-border rounded-xl border border-border" aria-hidden>
          <MemberRowSkeleton />
          <MemberRowSkeleton />
          <MemberRowSkeleton />
        </ul>
      </div>
    );
  } else if (members.length === 0) {
    const reason = memberPickerEmptyReason({ query, hasOtherMembers });
    const line =
      reason === "no_match"
        ? (emptyLabel ?? t("chat.workspace_members_empty"))
        : reason === "all_picked"
          ? (allPickedLabel ?? t("chat.workspace_members_all_picked"))
          : t("chat.workspace_members_none");
    body = <p className="py-1 text-caption text-pretty text-muted-foreground">{line}</p>;
  } else {
    body = (
      // The list only forwards arrow keys to its row buttons; the rows are the interactive elements.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <ul
        aria-labelledby={headingId}
        className="divide-y divide-border rounded-[14px] border border-border"
        onKeyDown={(event) => {
          const next = moveRowFocus(event);
          if (next !== null) setFocusIndex(next);
        }}
      >
        {members.map((member, index) => {
          const contact = memberToChatContact(member);
          // A names-only screen never falls back to the email local part.
          const label = nameOnly ? member.display_name.trim() || t("chat.workspace_member_unnamed") : memberDisplayLabel(member);
          const checked = selectedUserIds?.has(member.user_id);
          return (
            <li key={member.user_id} className="first:*:rounded-t-[14px] last:*:rounded-b-[14px]">
              <button
                type="button"
                data-member-picker-row=""
                role={selectedUserIds ? "checkbox" : undefined}
                aria-checked={selectedUserIds ? Boolean(checked) : undefined}
                tabIndex={index === tabStop ? 0 : -1}
                onFocus={() => setFocusIndex(index)}
                className={cn(
                  "group flex w-full items-center gap-3 py-2 text-left transition-colors hover:bg-surface-hover [--row-fill:var(--surface)] hover:[--row-fill:var(--surface-hover)]",
                  selectedUserIds ? "min-h-14 px-3.5" : "min-h-15 pr-2 pl-3.5",
                  checked && "bg-surface-hover [--row-fill:var(--surface-hover)]",
                )}
                onClick={() => onPick(contact)}
              >
                {selectedUserIds ? (
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-5.5 shrink-0 items-center justify-center rounded-[7px] border-2",
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-surface text-transparent",
                    )}
                  >
                    <Check strokeWidth={3.2} className="size-3.5" />
                  </span>
                ) : null}
                <MemberFace
                  userId={member.user_id}
                  label={label}
                  avatarUrl={memberAvatarUrl(member.avatar_url)}
                  small={Boolean(selectedUserIds)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-lg font-medium text-foreground">{label}</span>
                  {nameOnly ? null : (
                    <span className="block truncate text-label text-muted-foreground">{member.email}</span>
                  )}
                </span>
                {selectedUserIds ? null : (actionIcon ?? <MemberRowActionMark icon={UserPlus} />)}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div ref={listRef} className="space-y-2">
      <p id={headingId} className={CHAT_SECTION_LABEL_CLASS}>
        {heading ?? t("chat.workspace_members")}
      </p>
      {body}
    </div>
  );
}

export function useWorkspaceMemberPicker({
  workspaceId,
  currentUserId,
  open,
  query,
  searchSubmitted,
  excludeUserIds,
}: {
  workspaceId: string;
  currentUserId: string;
  open: boolean;
  query: string;
  searchSubmitted: boolean;
  excludeUserIds?: ReadonlySet<string>;
}) {
  const { data: members = [], isLoading } = useMembers(open ? workspaceId : "");

  const filteredMembers = useMemo(
    () =>
      filterWorkspaceMembers(members, {
        currentUserId,
        excludeUserIds,
        query,
      }),
    [members, currentUserId, excludeUserIds, query],
  );

  const hasOtherMembers = useMemo(
    () => members.some((member) => member.user_id !== currentUserId),
    [members, currentUserId],
  );

  const normalized = query.trim().toLowerCase();
  const lookupEnabled = open && shouldLookupEmailOutsideWorkspace(query, members, searchSubmitted);
  const lookup = useLookupChatUser(workspaceId, normalized, lookupEnabled);

  const workspaceEmailMatch = useMemo(
    () => (searchSubmitted ? findWorkspaceMemberByEmail(members, query) : null),
    [members, query, searchSubmitted],
  );

  return {
    members,
    filteredMembers,
    hasOtherMembers,
    isLoading,
    lookup,
    lookupEnabled,
    workspaceEmailMatch,
  };
}

export function ExternalMemberLookupRow({
  lookup,
  onPick,
  actionLabel,
  hint,
  unavailableLabel,
}: {
  lookup: NonNullable<ReturnType<typeof useLookupChatUser>["data"]>;
  onPick: (contact: ChatContact) => void;
  actionLabel: string;
  hint: string;
  /** When set, the person cannot be picked (already in the room); this replaces the action. */
  unavailableLabel?: string;
}) {
  const contact = toChatContactFromLookup(lookup);
  const label = displayLabelForChatContact(contact);

  return (
    <div className="space-y-2">
      <p className={CHAT_SECTION_LABEL_CLASS}>{hint}</p>
      <div className="flex items-center gap-3 rounded-[14px] border border-border py-3 pr-3 pl-3.5">
        <MemberFace userId={contact.user_id} label={label} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-lg font-semibold text-foreground">{label}</p>
          <p className="truncate text-label text-muted-foreground">{lookup.email}</p>
        </div>
        {unavailableLabel ? (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-caption font-semibold text-muted-foreground">
            {unavailableLabel}
          </span>
        ) : (
          <Button type="button" size="sm" variant="secondary" className={CHAT_PILL_SM_CLASS} onClick={() => onPick(contact)}>
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The email lookup outside the workspace after Enter: a skeleton row while
 * it runs, a plain line when nobody has that email, or the person found.
 */
export function WorkspaceMemberLookupResult({
  enabled,
  lookup,
  onPick,
  actionLabel,
  unavailableLabel,
}: {
  enabled: boolean;
  lookup: ReturnType<typeof useLookupChatUser>;
  onPick: (contact: ChatContact) => void;
  actionLabel: string;
  /** Returns a reason the found person cannot be picked (e.g. already in the room). */
  unavailableLabel?: (userId: string) => string | undefined;
}) {
  const { t } = useTranslation();
  if (!enabled) return null;

  if (lookup.isFetching) {
    return (
      <div role="status" className="flex items-center gap-3 rounded-xl border border-border py-3 pr-3 pl-3.5">
        <span className="sr-only">{t("chat.searching")}</span>
        <Skeleton className="size-10 shrink-0 rounded-full" aria-hidden />
        <span className="min-w-0 flex-1 space-y-1.5" aria-hidden>
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </span>
      </div>
    );
  }

  if (lookup.data) {
    return (
      <ExternalMemberLookupRow
        lookup={lookup.data}
        onPick={onPick}
        actionLabel={actionLabel}
        hint={t("chat.external_member_found")}
        unavailableLabel={unavailableLabel?.(lookup.data.user_id)}
      />
    );
  }

  if (lookup.isFetched) {
    return (
      <p role="status" className="text-caption text-muted-foreground">
        {t("chat.user_not_found")}
      </p>
    );
  }

  return null;
}
