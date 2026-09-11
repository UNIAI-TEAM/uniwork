"use client";

import { Plus, Search, UserPlus, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { useChatRoomPreferencesStore } from "@uniwork/core/chat/room-preferences-store";
import type { PendingInvitation } from "@uniwork/core/types";
import { useAcceptInvite, useMyInvitations } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { ChannelDirectorySheet } from "./channel-directory-sheet";
import { CreateChannelDialog } from "./create-channel-dialog";
import { CreateGroupDialog } from "./create-group-dialog";
import { StartDmDialog } from "./start-dm-dialog";
import type { ChatSidebarProps, ChatSidebarTarget } from "./chat-sidebar-types";
import {
  buildUnifiedSidebarEntries,
  chatSidebarFilterOptions,
  type ChatSidebarKindFilter,
} from "./chat-sidebar-unified";
import { ChatSidebarUnifiedRow } from "./chat-sidebar-unified-row";

export type { ChatSidebarTarget } from "./chat-sidebar-types";

export function ChatSidebar({
  currentUserId,
  workspaceId,
  target,
  onTargetChange,
  contacts,
  groups,
  channels = [],
  workHubEnabled = false,
  onOpenFollowUps,
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
  const [kindFilter, setKindFilter] = useState<ChatSidebarKindFilter>("all");
  const [startDmOpen, setStartDmOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [channelDirectoryOpen, setChannelDirectoryOpen] = useState(false);
  const [createGroupOpenInternal, setCreateGroupOpenInternal] = useState(false);
  const createGroupOpen = createGroupOpenProp ?? createGroupOpenInternal;
  const setCreateGroupOpen = onCreateGroupOpenChange ?? setCreateGroupOpenInternal;
  const { data: invites = [] } = useMyInvitations();
  const accept = useAcceptInvite();
  const filterScrollRef = useRef<HTMLDivElement>(null);

  // Map vertical mouse-wheel to horizontal scroll on the filter chips row.
  useEffect(() => {
    const el = filterScrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      const max = el.scrollWidth - el.clientWidth;
      const next = Math.min(max, Math.max(0, el.scrollLeft + delta));
      if (next === el.scrollLeft) return;
      event.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const filterText = filterQuery.trim().toLowerCase();
  const pinnedByRoomId = useChatRoomPreferencesStore((state) => state.byRoomId);
  const isRoomPinned = (roomId: string | null | undefined) =>
    Boolean(roomId && pinnedByRoomId[roomId]?.pinned);
  const isRoomNotificationsMuted = (roomId: string | null | undefined) =>
    Boolean(roomId && pinnedByRoomId[roomId]?.notificationsMuted);
  const workspaceTitle = t("chat.workspace_room");

  const filterOptions = useMemo(
    () => chatSidebarFilterOptions(workHubEnabled),
    [workHubEnabled],
  );

  const entries = useMemo(
    () =>
      buildUnifiedSidebarEntries({
        kindFilter,
        filterText,
        workspaceTitle,
        workspaceRoomId,
        channels,
        groups,
        contacts,
        nicknamesByUserId,
        roomPreviewsByRoomId,
        pinnedByRoomId,
        workHubEnabled,
      }),
    [
      kindFilter,
      filterText,
      workspaceTitle,
      workspaceRoomId,
      channels,
      groups,
      contacts,
      nicknamesByUserId,
      roomPreviewsByRoomId,
      pinnedByRoomId,
      workHubEnabled,
    ],
  );

  const youLabel = t("chat.you");
  const voiceCallPreviewLabel = t("chat.sidebar_voice_call_preview");
  const voiceMessagePreviewLabel = t("chat.sidebar_voice_message_preview");
  const fileMessagePreviewLabel = t("chat.sidebar_file_message_preview");
  const yesterdayLabel = t("chat.sidebar_yesterday");
  const memberChannelIds = useMemo(() => new Set(channels.map((c) => c.id)), [channels]);

  const handleCreateGroup = (members: ChatContact[], name: string) => {
    if (!onCreateGroup) return;
    onCreateGroup(members, name);
  };

  const joinInvite = (inv: PendingInvitation) => {
    accept.mutate(inv.token, {
      onSuccess: () => onJoinedWorkspace?.(),
    });
  };

  const filterLabel = (kind: ChatSidebarKindFilter) => {
    switch (kind) {
      case "all":
        return t("chat.filter_all");
      case "dm":
        return t("chat.filter_dm");
      case "group":
        return t("chat.filter_group");
      case "channel":
        return t("chat.filter_channel");
      case "workspace":
        return t("chat.filter_workspace");
      default:
        return kind;
    }
  };

  return (
    <>
      <aside
        className={cn(
          "flex min-h-0 flex-col gap-3 bg-surface p-3",
          embedded
            ? "h-full min-w-0 flex-1 border-r border-border"
            : "gap-4 rounded-lg border border-border",
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
          {workHubEnabled ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("chat.channel.directory_aria")}
                onClick={() => setChannelDirectoryOpen(true)}
              >
                <Search className="size-5" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("chat.channel.create_aria")}
                onClick={() => setCreateChannelOpen(true)}
              >
                <Plus className="size-5" aria-hidden />
              </Button>
            </>
          ) : null}
        </div>

        <div
          ref={filterScrollRef}
          className="no-scrollbar flex items-center gap-1.5 overflow-x-auto"
          role="toolbar"
          aria-label={t("chat.filter_aria")}
        >
          {filterOptions.map((kind) => {
            const active = kindFilter === kind;
            return (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  "h-8 shrink-0 rounded-full px-3.5 text-caption transition-colors",
                  active
                    ? "bg-brand/15 font-semibold text-brand shadow-sm ring-1 ring-brand/25 hover:bg-brand/20 hover:text-brand"
                    : "bg-muted/70 font-medium text-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-pressed={active}
                onClick={() => setKindFilter(kind)}
              >
                {filterLabel(kind)}
              </Button>
            );
          })}
          {workHubEnabled && onOpenFollowUps ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 rounded-full bg-muted/70 px-3.5 text-caption font-medium text-foreground hover:bg-muted hover:text-foreground"
              onClick={onOpenFollowUps}
            >
              {t("chat.follow_up.list_title")}
            </Button>
          ) : null}
        </div>

        {invites.length > 0 ? (
          <section className="space-y-2">
            <h2 className="px-1 text-label font-medium text-foreground">
              {t("chat.pending_invites")}
            </h2>
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

        <nav
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          aria-label={t("chat.sidebar_nav")}
        >
          {entries.length === 0 ? (
            <p className="px-1 text-caption text-muted-foreground">
              {t("chat.search_no_results")}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {entries.map((entry) => (
                <li key={entry.key}>
                  <ChatSidebarUnifiedRow
                    entry={entry}
                    target={target}
                    onTargetChange={onTargetChange}
                    workspaceTitle={workspaceTitle}
                    workspaceRoomId={workspaceRoomId}
                    contacts={contacts}
                    currentUserId={currentUserId}
                    nicknamesByUserId={nicknamesByUserId}
                    roomPreviewsByRoomId={roomPreviewsByRoomId}
                    unreadByRoomId={unreadByRoomId}
                    mentionUnreadByRoomId={mentionUnreadByRoomId}
                    unreadBadgesReady={unreadBadgesReady}
                    isRoomPinned={isRoomPinned}
                    isRoomNotificationsMuted={isRoomNotificationsMuted}
                    youLabel={youLabel}
                    voiceCallPreviewLabel={voiceCallPreviewLabel}
                    voiceMessagePreviewLabel={voiceMessagePreviewLabel}
                    fileMessagePreviewLabel={fileMessagePreviewLabel}
                    yesterdayLabel={yesterdayLabel}
                  />
                </li>
              ))}
            </ul>
          )}
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

      {workHubEnabled ? (
        <>
          <CreateChannelDialog
            open={createChannelOpen}
            onOpenChange={setCreateChannelOpen}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
            onCreated={(room) => {
              setCreateChannelOpen(false);
              onTargetChange({ kind: "channel", channel: room });
            }}
          />
          <ChannelDirectorySheet
            open={channelDirectoryOpen}
            onOpenChange={setChannelDirectoryOpen}
            workspaceId={workspaceId}
            memberChannelIds={memberChannelIds}
            onJoined={(room) => {
              setChannelDirectoryOpen(false);
              onTargetChange({ kind: "channel", channel: room });
            }}
          />
        </>
      ) : null}
    </>
  );
}
