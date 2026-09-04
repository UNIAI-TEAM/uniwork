"use client";

import { Search, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
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
import {
  filterWorkspaceMembers,
  findWorkspaceMemberByEmail,
  memberDisplayLabel,
  memberToChatContact,
  shouldLookupEmailOutsideWorkspace,
} from "./workspace-member-picker-utils";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function WorkspaceMemberSearchField({
  id,
  label,
  query,
  onQueryChange,
  onSubmit,
  placeholder,
}: {
  id: string;
  label: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
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
          placeholder={placeholder}
          type="search"
          autoComplete="off"
          className="rounded-full pl-9 pr-12"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          className="absolute right-1 top-1/2 size-8 -translate-y-1/2 rounded-full"
          aria-label={t("chat.search_action")}
        >
          <Search className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}

export function WorkspaceMemberPickerList({
  members,
  loading,
  emptyLabel,
  actionIcon,
  onPick,
}: {
  members: Member[];
  loading?: boolean;
  emptyLabel: string;
  actionIcon?: ReactNode;
  onPick: (contact: ChatContact) => void;
}) {
  const { t } = useTranslation();

  if (loading) {
    return <p className="text-caption text-muted-foreground">{t("chat.loading_members")}</p>;
  }

  if (members.length === 0) {
    return <p className="text-caption text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border/80 bg-muted/20 p-1">
      {members.map((member) => {
        const contact = memberToChatContact(member);
        const label = memberDisplayLabel(member);
        return (
          <li key={member.user_id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface"
              onClick={() => onPick(contact)}
            >
              <ActorAvatar name={label} initials={initialOf(label)} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-foreground">{label}</span>
                <span className="block truncate text-caption text-muted-foreground">
                  {member.email}
                </span>
              </span>
              {actionIcon ?? <UserPlus className="size-4 shrink-0 text-brand" aria-hidden />}
            </button>
          </li>
        );
      })}
    </ul>
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
}: {
  lookup: NonNullable<ReturnType<typeof useLookupChatUser>["data"]>;
  onPick: (contact: ChatContact) => void;
  actionLabel: string;
  hint: string;
}) {
  const contact = toChatContactFromLookup(lookup);
  const label = displayLabelForChatContact(contact);

  return (
    <div className="space-y-2">
      <p className="text-caption text-muted-foreground">{hint}</p>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
        <ActorAvatar name={label} initials={initialOf(label)} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-foreground">{label}</p>
          <p className="truncate text-caption text-muted-foreground">{lookup.email}</p>
        </div>
        <Button type="button" size="sm" className="rounded-full" onClick={() => onPick(contact)}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
