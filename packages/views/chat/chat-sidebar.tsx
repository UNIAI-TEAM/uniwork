"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useChatContactActions,
  useChatContacts,
  useGroupChats,
  useLookupChatUser,
} from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { PendingInvitation } from "@uniwork/core/types";
import { useAcceptInvite, useMyInvitations } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { CreateGroupDialog } from "./create-group-dialog";

export type ChatSidebarTarget =
  | { kind: "workspace" }
  | { kind: "dm"; contact: ChatContact }
  | { kind: "group"; group: GroupChat };

interface ChatSidebarProps {
  currentUserId: string;
  target: ChatSidebarTarget;
  onTargetChange: (target: ChatSidebarTarget) => void;
  onCreateGroup?: (members: ChatContact[], name: string) => void;
  creatingGroup?: boolean;
  createGroupOpen?: boolean;
  onCreateGroupOpenChange?: (open: boolean) => void;
  onJoinedWorkspace?: () => void;
  workspaceRoomId?: string | null;
  unreadByRoomId?: Record<string, number>;
  unreadBadgesReady?: boolean;
}

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function ChatSidebar({
  currentUserId,
  target,
  onTargetChange,
  onCreateGroup,
  creatingGroup = false,
  createGroupOpen: createGroupOpenProp,
  onCreateGroupOpenChange,
  onJoinedWorkspace,
  workspaceRoomId = null,
  unreadByRoomId = {},
  unreadBadgesReady = false,
}: ChatSidebarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [createGroupOpenInternal, setCreateGroupOpenInternal] = useState(false);
  const createGroupOpen = createGroupOpenProp ?? createGroupOpenInternal;
  const setCreateGroupOpen = onCreateGroupOpenChange ?? setCreateGroupOpenInternal;
  const contacts = useChatContacts(currentUserId);
  const groups = useGroupChats(currentUserId);
  const { addFromLookup } = useChatContactActions(currentUserId);
  const { data: invites = [] } = useMyInvitations();
  const accept = useAcceptInvite();

  const normalized = query.trim().toLowerCase();
  const lookup = useLookupChatUser(normalized, searchActive && normalized.includes("@"));

  const runSearch = () => {
    if (!normalized.includes("@")) return;
    setSearchActive(true);
  };

  const startDm = (fromLookup: NonNullable<typeof lookup.data>) => {
    if (!fromLookup.matrix_ready || !fromLookup.matrix_user_id) return;
    const contact = addFromLookup(fromLookup);
    onTargetChange({ kind: "dm", contact });
    setQuery("");
    setSearchActive(false);
  };

  const handleCreateGroup = (members: ChatContact[], name: string) => {
    if (!onCreateGroup) return;
    onCreateGroup(members, name);
  };

  const joinInvite = (inv: PendingInvitation) => {
    accept.mutate(inv.token, {
      onSuccess: () => onJoinedWorkspace?.(),
    });
  };

  return (
    <>
      <aside className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchActive(false);
            }}
            placeholder={t("chat.search_email")}
            aria-label={t("chat.search_email")}
            type="email"
            autoComplete="off"
          />
          <Button type="submit" variant="outline" size="icon" aria-label={t("chat.search_action")}>
            <Search aria-hidden className="size-4" />
          </Button>
        </form>

        {searchActive && lookup.isFetching ? (
          <p className="text-caption text-muted-foreground">{t("chat.searching")}</p>
        ) : null}

        {searchActive && !lookup.isFetching && lookup.isFetched && !lookup.data ? (
          <p className="text-caption text-muted-foreground">{t("chat.user_not_found")}</p>
        ) : null}

        {searchActive && lookup.data ? (
          <SearchResultRow lookup={lookup.data} onStart={() => startDm(lookup.data!)} />
        ) : null}

        {invites.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-label font-medium text-foreground">{t("chat.pending_invites")}</h2>
            <ul className="space-y-2">
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-col gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-foreground">
                      {inv.organization.name} › {inv.workspace.name}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {t("invitations.invitedBy", { name: inv.invited_by.display_name })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={accept.isPending}
                    onClick={() => joinInvite(inv)}
                  >
                    {t("invitations.join")}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Button
          type="button"
          variant={target.kind === "workspace" ? "secondary" : "ghost"}
          className="justify-between"
          onClick={() => onTargetChange({ kind: "workspace" })}
        >
          <span>{t("chat.workspace_room")}</span>
          <UnreadBadge count={workspaceRoomId ? (unreadByRoomId[workspaceRoomId] ?? 0) : 0} ready={unreadBadgesReady} />
        </Button>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-label font-medium text-foreground">{t("chat.groups_title")}</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!onCreateGroup}
              onClick={() => setCreateGroupOpen(true)}
            >
              {t("chat.create_group")}
            </Button>
          </div>
          <p className="text-caption text-muted-foreground">{t("chat.groups_hint")}</p>

          {groups.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("chat.groups_empty")}</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-auto">
              {groups.map((group) => {
                const active = target.kind === "group" && target.group.id === group.id;
                const unread = unreadByRoomId[group.room_id] ?? 0;
                return (
                  <li key={group.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted",
                        active && "bg-muted",
                      )}
                      onClick={() => onTargetChange({ kind: "group", group })}
                    >
                      <ActorAvatar name={group.name} initials={initialOf(group.name)} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-foreground">{group.name}</span>
                        <span className="block truncate text-caption text-muted-foreground">
                          {t("chat.group_member_count", { count: group.member_user_ids.length + 1 })}
                        </span>
                      </span>
                      <UnreadBadge count={unread} ready={unreadBadgesReady} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div>
          <h2 className="text-label font-medium text-foreground">{t("chat.contacts_title")}</h2>
          <p className="mt-1 text-caption text-muted-foreground">{t("chat.contacts_hint")}</p>
        </div>

        {contacts.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("chat.contacts_empty")}</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-auto">
          {contacts.map((contact) => {
            const active =
              target.kind === "dm" && target.contact.user_id === contact.user_id;
            const dmRoomId =
              contact.dm_room_id && !groups.some((group) => group.room_id === contact.dm_room_id)
                ? contact.dm_room_id
                : null;
            const unread = dmRoomId ? (unreadByRoomId[dmRoomId] ?? 0) : 0;
              return (
                <li key={contact.user_id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted",
                      active && "bg-muted",
                    )}
                    onClick={() => onTargetChange({ kind: "dm", contact })}
                  >
                    <ActorAvatar name={contact.display_name} initials={initialOf(contact.display_name)} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-foreground">
                        {displayLabelForChatContact(contact)}
                      </span>
                      <span className="block truncate text-caption text-muted-foreground">{contact.email}</span>
                    </span>
                    <UnreadBadge count={unread} ready={unreadBadgesReady} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <CreateGroupDialog
        open={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
        currentUserId={currentUserId}
        creating={creatingGroup}
        onCreate={handleCreateGroup}
      />
    </>
  );
}

function UnreadBadge({ count, ready }: { count: number; ready: boolean }) {
  const { t } = useTranslation();
  if (!ready || count <= 0) return <span className="min-w-5 shrink-0" aria-hidden />;
  const display = count > 99 ? "99+" : String(count);
  return (
    <Badge
      variant="default"
      className="min-w-5 shrink-0 px-1.5 tabular-nums"
      aria-label={t("chat.unread_badge_aria", { count })}
    >
      {display}
    </Badge>
  );
}

function SearchResultRow({
  lookup,
  onStart,
}: {
  lookup: {
    display_name: string;
    email: string;
    matrix_ready?: boolean;
  };
  onStart: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-foreground">{lookup.display_name}</p>
        <p className="truncate text-caption text-muted-foreground">{lookup.email}</p>
      </div>
      {lookup.matrix_ready ? (
        <Button type="button" size="sm" onClick={onStart}>
          {t("chat.start_dm")}
        </Button>
      ) : (
        <span className="text-caption text-muted-foreground">{t("chat.matrix_not_ready")}</span>
      )}
    </div>
  );
}
