"use client";

import { Hash, Search, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import {
  comparePinnedRoomOrder,
  useChatRoomPreferencesStore,
} from "@uniwork/core/chat/room-preferences-store";
import type { PendingInvitation } from "@uniwork/core/types";
import { useAcceptInvite, useMyInvitations } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { CreateGroupDialog } from "./create-group-dialog";
import { StartDmDialog } from "./start-dm-dialog";
import { compareRoomPreviewRecency } from "./chat-sidebar-preview";
import { SidebarNavItem } from "./chat-sidebar-rows";
import type { ChatSidebarProps, ChatSidebarTarget } from "./chat-sidebar-types";

export type { ChatSidebarTarget } from "./chat-sidebar-types";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function matchesConversationFilter(text: string, filter: string): boolean {
  if (!filter) return true;
  return text.toLowerCase().includes(filter);
}

export function ChatSidebar({
  currentUserId,
  workspaceId,
  target,
  onTargetChange,
  contacts,
  groups,
  onCreateGroup,
  creatingGroup = false,
  createGroupOpen: createGroupOpenProp,
  onCreateGroupOpenChange,
  onJoinedWorkspace,
  workspaceRoomId = null,
  unreadByRoomId = {},
  mentionUnreadByRoomId = {},
  roomPreviewsByRoomId = {},
  unreadBadgesReady = false,
  nicknamesByUserId = {},
  embedded = false,
}: ChatSidebarProps) {
  const { t } = useTranslation();
  const [filterQuery, setFilterQuery] = useState("");
  const [startDmOpen, setStartDmOpen] = useState(false);
  const [createGroupOpenInternal, setCreateGroupOpenInternal] = useState(false);
  const createGroupOpen = createGroupOpenProp ?? createGroupOpenInternal;
  const setCreateGroupOpen = onCreateGroupOpenChange ?? setCreateGroupOpenInternal;
  const { data: invites = [] } = useMyInvitations();
  const accept = useAcceptInvite();

  const filterText = filterQuery.trim().toLowerCase();
  const pinnedByRoomId = useChatRoomPreferencesStore((state) => state.byRoomId);
  const isRoomPinned = (roomId: string | null | undefined) =>
    Boolean(roomId && pinnedByRoomId[roomId]?.pinned);
  const isRoomNotificationsMuted = (roomId: string | null | undefined) =>
    Boolean(roomId && pinnedByRoomId[roomId]?.notificationsMuted);
  const workspaceTitle = t("chat.workspace_room");
  const workspaceHint = t("chat.workspace_room_hint");

  const filteredGroups = useMemo(
    () =>
      groups
        .filter((group) => matchesConversationFilter(group.name, filterText))
        .sort((a, b) => {
          const pinOrder = comparePinnedRoomOrder(a.room_id, b.room_id, pinnedByRoomId);
          if (pinOrder !== 0) return pinOrder;
          return compareRoomPreviewRecency(
            roomPreviewsByRoomId[a.room_id],
            roomPreviewsByRoomId[b.room_id],
          );
        }),
    [groups, filterText, pinnedByRoomId, roomPreviewsByRoomId],
  );

  const filteredContacts = useMemo(
    () =>
      contacts
        .filter((contact) => {
          const label = displayLabelForChatContact(contact, nicknamesByUserId);
          return (
            matchesConversationFilter(label, filterText) ||
            matchesConversationFilter(contact.email, filterText)
          );
        })
        .sort((a, b) => {
          const leftRoomId = a.dm_room_id ?? "";
          const rightRoomId = b.dm_room_id ?? "";
          const pinOrder = comparePinnedRoomOrder(leftRoomId, rightRoomId, pinnedByRoomId);
          if (pinOrder !== 0) return pinOrder;
          const leftPreview = a.dm_room_id ? roomPreviewsByRoomId[a.dm_room_id] : null;
          const rightPreview = b.dm_room_id ? roomPreviewsByRoomId[b.dm_room_id] : null;
          return compareRoomPreviewRecency(leftPreview, rightPreview);
        }),
    [contacts, filterText, pinnedByRoomId, roomPreviewsByRoomId, nicknamesByUserId],
  );

  const youLabel = t("chat.you");
  const voiceCallPreviewLabel = t("chat.sidebar_voice_call_preview");
  const yesterdayLabel = t("chat.sidebar_yesterday");

  const showWorkspace =
    !filterText ||
    matchesConversationFilter(workspaceTitle, filterText) ||
    matchesConversationFilter(workspaceHint, filterText);

  const hasListResults =
    showWorkspace || filteredGroups.length > 0 || filteredContacts.length > 0;

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
      <aside
        className={cn(
          "flex min-h-0 flex-col gap-3 bg-surface p-3",
          embedded ? "h-full min-w-0 flex-1 border-r border-border" : "gap-4 rounded-lg border border-border",
        )}
      >
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t("chat.search_conversations")}
              aria-label={t("chat.search_conversations")}
              type="search"
              autoComplete="off"
              className="h-10 rounded-full border-border/80 bg-muted/40 pl-9"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("chat.add_dm_aria")}
            onClick={() => setStartDmOpen(true)}
          >
            <UserPlus className="size-5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("chat.create_group_aria")}
            disabled={!onCreateGroup}
            onClick={() => setCreateGroupOpen(true)}
          >
            <Users className="size-5" aria-hidden />
          </Button>
        </div>

        {invites.length > 0 ? (
          <section className="space-y-2">
            <h2 className="px-1 text-label font-medium text-foreground">{t("chat.pending_invites")}</h2>
            <ul className="space-y-1">
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2"
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

        <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden" aria-label={t("chat.sidebar_nav")}>
          {!hasListResults ? (
            <p className="px-1 text-caption text-muted-foreground">{t("chat.search_no_results")}</p>
          ) : null}

          {showWorkspace ? (
            <section className="space-y-1">
              <SidebarNavItem
                active={target.kind === "workspace"}
                onClick={() => onTargetChange({ kind: "workspace" })}
                avatar={
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Hash className="size-4" aria-hidden />
                  </span>
                }
                title={workspaceTitle}
                fallbackSubtitle={workspaceHint}
                preview={
                  workspaceRoomId ? roomPreviewsByRoomId[workspaceRoomId] : undefined
                }
                roomId={workspaceRoomId}
                contacts={contacts}
                previewOptions={{
                  currentUserId,
                  isGroup: true,
                  youLabel,
                  voiceCallLabel: voiceCallPreviewLabel,
                  yesterdayLabel,
                  nicknamesByUserId,
                }}
                unread={workspaceRoomId ? (unreadByRoomId[workspaceRoomId] ?? 0) : 0}
                mentionUnread={workspaceRoomId ? (mentionUnreadByRoomId[workspaceRoomId] ?? 0) : 0}
                unreadBadgesReady={unreadBadgesReady}
                pinned={isRoomPinned(workspaceRoomId)}
                notificationsMuted={isRoomNotificationsMuted(workspaceRoomId)}
              />
            </section>
          ) : null}

          {filteredGroups.length > 0 ? (
            <section className="flex min-h-0 flex-col gap-1.5">
              <h2 className="px-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                {t("chat.groups_title")}
              </h2>
              <ul className="min-h-0 space-y-0.5 overflow-y-auto">
                {filteredGroups.map((group) => {
                  const active = target.kind === "group" && target.group.id === group.id;
                  const unread = unreadByRoomId[group.room_id] ?? 0;
                  const mentionUnread = mentionUnreadByRoomId[group.room_id] ?? 0;
                  return (
                    <li key={group.id}>
                      <SidebarNavItem
                        active={active}
                        onClick={() => onTargetChange({ kind: "group", group })}
                        avatar={
                          <ActorAvatar name={group.name} initials={initialOf(group.name)} size="sm" />
                        }
                        title={group.name}
                        fallbackSubtitle={t("chat.group_member_count", {
                          count: group.member_user_ids.length + 1,
                        })}
                        preview={roomPreviewsByRoomId[group.room_id]}
                        roomId={group.room_id}
                        contacts={contacts}
                        previewOptions={{
                          currentUserId,
                          isGroup: true,
                          youLabel,
                          voiceCallLabel: voiceCallPreviewLabel,
                          yesterdayLabel,
                          nicknamesByUserId,
                        }}
                        unread={unread}
                        mentionUnread={mentionUnread}
                        unreadBadgesReady={unreadBadgesReady}
                        pinned={isRoomPinned(group.room_id)}
                        notificationsMuted={isRoomNotificationsMuted(group.room_id)}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : !filterText && groups.length === 0 ? (
            <section className="flex flex-col gap-1.5">
              <h2 className="px-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                {t("chat.groups_title")}
              </h2>
              <p className="px-1 text-caption text-muted-foreground">{t("chat.groups_empty")}</p>
            </section>
          ) : null}

          {filteredContacts.length > 0 ? (
            <section className="flex min-h-0 flex-1 flex-col gap-1.5">
              <h2 className="px-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                {t("chat.contacts_title")}
              </h2>
              <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                {filteredContacts.map((contact) => {
                  const active = target.kind === "dm" && target.contact.user_id === contact.user_id;
                  const dmRoomId = contact.dm_room_id ?? null;
                  const unread = dmRoomId ? (unreadByRoomId[dmRoomId] ?? 0) : 0;
                  const mentionUnread = dmRoomId ? (mentionUnreadByRoomId[dmRoomId] ?? 0) : 0;
                  const label = displayLabelForChatContact(contact, nicknamesByUserId);
                  return (
                    <li key={contact.user_id}>
                      <SidebarNavItem
                        active={active}
                        onClick={() => onTargetChange({ kind: "dm", contact })}
                        avatar={
                          <ActorAvatar name={label} initials={initialOf(label)} size="sm" />
                        }
                        title={label}
                        fallbackSubtitle={contact.email}
                        preview={dmRoomId ? roomPreviewsByRoomId[dmRoomId] : undefined}
                        roomId={dmRoomId}
                        contacts={contacts}
                        previewOptions={{
                          currentUserId,
                          isGroup: false,
                          youLabel,
                          voiceCallLabel: voiceCallPreviewLabel,
                          yesterdayLabel,
                          nicknamesByUserId,
                        }}
                        unread={unread}
                        mentionUnread={mentionUnread}
                        unreadBadgesReady={unreadBadgesReady}
                        pinned={isRoomPinned(dmRoomId)}
                        notificationsMuted={isRoomNotificationsMuted(dmRoomId)}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : !filterText && contacts.length === 0 ? (
            <section className="flex flex-col gap-1.5">
              <h2 className="px-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                {t("chat.contacts_title")}
              </h2>
              <p className="px-1 text-caption text-muted-foreground">{t("chat.contacts_empty")}</p>
            </section>
          ) : null}
        </nav>
      </aside>

      <StartDmDialog
        open={startDmOpen}
        onOpenChange={setStartDmOpen}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        contacts={contacts}
        onStartDm={(contact) => onTargetChange({ kind: "dm", contact })}
      />

      <CreateGroupDialog
        open={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        creating={creatingGroup}
        onCreate={handleCreateGroup}
      />
    </>
  );
}
