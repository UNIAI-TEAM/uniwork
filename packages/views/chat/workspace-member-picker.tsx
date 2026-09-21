"use client";

import { Search, UserPlus, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toChatContactFromLookup, useLookupChatUser } from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
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
import { initialOf } from "./chat-initials";

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
}: {
  id: string;
  label: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  hint?: string;
}) {
  const { t } = useTranslation();
  const hasQuery = query.trim().length > 0;
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-label font-medium text-foreground">
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
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter that confirms a Telex/VNI syllable must not run the search.
            if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) {
              e.preventDefault();
            }
          }}
          placeholder={placeholder}
          type="search"
          autoComplete="off"
          aria-describedby={hint ? hintId : undefined}
          className={cn("pl-9", hasQuery ? "pr-10" : "pr-3")}
        />
        {hasQuery ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={t("chat.clear_search")}
            onClick={() => onQueryChange("")}
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

/** Up/Down/Home/End move focus between rows, like a menu. */
function moveRowFocus(event: KeyboardEvent<HTMLUListElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR));
  if (rows.length === 0) return;
  event.preventDefault();
  const current = rows.indexOf(document.activeElement as HTMLButtonElement);
  let next = 0;
  if (event.key === "End") next = rows.length - 1;
  else if (event.key === "ArrowDown") next = current < 0 ? 0 : Math.min(current + 1, rows.length - 1);
  else if (event.key === "ArrowUp") next = current < 0 ? 0 : Math.max(current - 1, 0);
  rows[next]?.focus();
}

function MemberRowSkeleton() {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5" aria-hidden>
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </span>
    </li>
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
  onPick,
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
  onPick: (contact: ChatContact) => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();

  let body: ReactNode;
  if (loading) {
    body = (
      <div role="status">
        <span className="sr-only">{t("chat.loading_members")}</span>
        <ul className="divide-y divide-border rounded-lg border border-border" aria-hidden>
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
        className="divide-y divide-border rounded-lg border border-border"
        onKeyDown={moveRowFocus}
      >
        {members.map((member) => {
          const contact = memberToChatContact(member);
          const label = memberDisplayLabel(member);
          return (
            <li key={member.user_id} className="first:*:rounded-t-lg last:*:rounded-b-lg">
              <button
                type="button"
                data-member-picker-row=""
                className="group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-hover pointer-coarse:min-h-11"
                onClick={() => onPick(contact)}
              >
                <ActorAvatar name={label} initials={initialOf(label)} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-foreground">{label}</span>
                  <span className="block truncate text-caption text-muted-foreground">{member.email}</span>
                </span>
                {actionIcon ?? (
                  <UserPlus
                    className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                    aria-hidden
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="space-y-2">
      <p id={headingId} className="text-overline uppercase text-muted-foreground">
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
      <p className="text-overline uppercase text-muted-foreground">{hint}</p>
      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
        <ActorAvatar name={label} initials={initialOf(label)} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-foreground">{label}</p>
          <p className="truncate text-caption text-muted-foreground">{lookup.email}</p>
        </div>
        {unavailableLabel ? (
          <span className="shrink-0 text-caption text-muted-foreground">{unavailableLabel}</span>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => onPick(contact)}>
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
      <div role="status" className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
        <span className="sr-only">{t("chat.searching")}</span>
        <Skeleton className="size-8 shrink-0 rounded-full" aria-hidden />
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
