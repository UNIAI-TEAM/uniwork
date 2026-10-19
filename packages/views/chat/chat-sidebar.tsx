"use client";

import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatRooms } from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { useChatRoomPreferencesStore } from "@uniwork/core/chat/room-preferences-store";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { cn } from "@uniwork/ui/lib/utils";
import { ChannelDirectorySheet } from "./channel-directory-sheet";
import { CreateChannelDialog } from "./create-channel-dialog";
import { CreateGroupDialog } from "./create-group-dialog";
import { StartDmDialog } from "./start-dm-dialog";
import type { ChatSidebarProps } from "./chat-sidebar-types";
import {
  buildUnifiedSidebarEntries,
  CHAT_SIDEBAR_TABS_BY_SCOPE,
  chatSidebarTabCounts,
  chatSidebarTabFilters,
  type ChatSidebarTab,
} from "./chat-sidebar-unified";
import { ChatSidebarList } from "./chat-sidebar-list";
import { ChatScopeSwitch, SidebarHeader, SidebarSearch } from "./chat-sidebar-header";
import { typingNameByUserIdFromContext } from "./chat-sidebar-typing";
import {
  SidebarEmpty,
  SidebarInvitations,
  SidebarLoadError,
  SidebarSkeleton,
  SidebarStarter,
} from "./chat-sidebar-parts";
import type { SidebarRowLabels } from "./chat-sidebar-unified-row";
import { pickQuickCatchUp, SidebarCatchUpCard } from "./chat-sidebar-catch-up";

const EMPTY_COUNTS: Record<string, number> = {};
const EMPTY_PREVIEWS: NonNullable<ChatSidebarProps["roomPreviewsByRoomId"]> = {};
const EMPTY_NICKNAMES: Record<string, string> = {};
const EMPTY_CHANNELS: NonNullable<ChatSidebarProps["channels"]> = [];
const EMPTY_MEMBER_AVATARS: NonNullable<ChatSidebarProps["memberAvatarByUserId"]> = {};
const EMPTY_PEOPLE: NonNullable<ChatSidebarProps["knownPeople"]> = [];
const EMPTY_GROUPS: ChatSidebarProps["groups"] = [];
const EMPTY_CONTACTS: ChatSidebarProps["contacts"] = [];

export type { ChatSidebarTarget } from "./chat-sidebar-types";

/* One tab row (canvas "Main"): 14px labels, 10px apart, the brand and a
   2.5px underline when chosen; it scrolls sideways when the column is narrow. */
const TAB =
  "relative h-11 gap-1.5 rounded-none border-0 px-2.5 text-body font-semibold text-muted-foreground transition-colors duration-(--duration-fast) " +
  "after:absolute after:inset-x-0 after:bottom-0 after:h-[2.5px] after:bg-transparent " +
  "hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent aria-pressed:text-brand aria-pressed:after:bg-brand";

/* The count beside a tab: neutral, the brand fill on the chosen tab. */
const TAB_COUNT =
  "h-5 min-w-5 rounded-full bg-border px-1.5 text-center text-caption leading-5 text-chat-chip-foreground tabular-nums";

/**
 * Memoised: the page re-renders on every composer keystroke and typing
 * signal, and none of that reaches the list unless its own props moved.
 */
export const ChatSidebar = memo(function ChatSidebar({
  scope,
  currentUserId,
  workspaceId,
  target,
  onTargetChange,
  contacts,
  groups,
  channels = EMPTY_CHANNELS,
  onOpenFollowUps,
  onOpenFollowedThreads,
  onQuickCatchUp,
  onCreateGroup,
  creatingGroup = false,
  createGroupOpen: createGroupOpenProp,
  onCreateGroupOpenChange,
  workspaceRoomId = null,
  unreadByRoomId = EMPTY_COUNTS,
  mentionUnreadByRoomId = EMPTY_COUNTS,
  roomPreviewsByRoomId = EMPTY_PREVIEWS,
  unreadBadgesReady = false,
  nicknamesByUserId = EMPTY_NICKNAMES,
  embedded = false,
  loading = false,
  loadError = false,
  onRetry,
  workspaceRoomTitle,
  onCollapse,
  memberAvatarByUserId = EMPTY_MEMBER_AVATARS,
  knownPeople = EMPTY_PEOPLE,
}: ChatSidebarProps) {
  const { t } = useTranslation();
  const [filterQuery, setFilterQuery] = useState("");
  const [chosenTab, setTab] = useState<ChatSidebarTab>("all");
  const tabs = CHAT_SIDEBAR_TABS_BY_SCOPE[scope];
  // A kind tab the other scope does not have falls back to "All".
  const tab = tabs.includes(chosenTab) ? chosenTab : "all";
  const { kindFilter, activityFilter } = chatSidebarTabFilters(tab);
  const messages = scope === "messages";
  const [startDmOpen, setStartDmOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [channelDirectoryOpen, setChannelDirectoryOpen] = useState(false);
  const [createGroupOpenInternal, setCreateGroupOpenInternal] = useState(false);
  const createGroupOpen = createGroupOpenProp ?? createGroupOpenInternal;
  const setCreateGroupOpen = onCreateGroupOpenChange ?? setCreateGroupOpenInternal;
  // The field answers every keystroke; the list re-sorts when React is idle.
  const filterText = useDeferredValue(filterQuery.trim());
  const pinnedByRoomId = useChatRoomPreferencesStore((state) => state.byRoomId);
  const { data: rooms } = useChatRooms(workspaceId);
  const mutedRoomIds = useMemo(
    () => new Set((rooms ?? []).filter((room) => room.notifications_muted).map((room) => room.id)),
    [rooms],
  );
  const peerReadAtByRoomId = useMemo(() => {
    const out: Record<string, string> = {};
    for (const room of rooms ?? []) if (room.kind === "dm" && room.peer_last_read_at) out[room.id] = room.peer_last_read_at;
    return out;
  }, [rooms]);
  const workspaceTitle = workspaceRoomTitle ?? t("chat.workspace_room");
  const typingNameByUserId = useMemo(
    () => typingNameByUserIdFromContext(knownPeople),
    [knownPeople],
  );

  const tabCounts = useMemo(
    () =>
      chatSidebarTabCounts({
        roomIds: messages
          ? [...groups.map((group) => group.room_id), ...contacts.map((contact) => contact.dm_room_id ?? "")]
          : [workspaceRoomId ?? "", ...channels.map((channel) => channel.id)],
        unreadByRoomId,
        mentionUnreadByRoomId,
        mutedRoomIds,
      }),
    [messages, workspaceRoomId, channels, groups, contacts, unreadByRoomId, mentionUnreadByRoomId, mutedRoomIds],
  );

  const entries = useMemo(
    () =>
      buildUnifiedSidebarEntries({
        scope,
        kindFilter,
        activityFilter,
        filterText,
        workspaceTitle,
        workspaceRoomId,
        channels,
        groups,
        contacts,
        nicknamesByUserId,
        roomPreviewsByRoomId,
        pinnedByRoomId,
        unreadByRoomId,
        mentionUnreadByRoomId,
      }),
    [
      scope,
      kindFilter,
      activityFilter,
      filterText,
      workspaceTitle,
      workspaceRoomId,
      channels,
      groups,
      contacts,
      nicknamesByUserId,
      roomPreviewsByRoomId,
      pinnedByRoomId,
      unreadByRoomId,
      mentionUnreadByRoomId,
    ],
  );

  const labels = useMemo(
    (): SidebarRowLabels => ({
      youLabel: t("chat.you"),
      voiceCallLabel: t("chat.sidebar_voice_call_preview"),
      voiceMessageLabel: t("chat.sidebar_voice_message_preview"),
      missedCallLabel: t("chat.voice_call_log_missed"),
      fileMessageLabel: t("chat.sidebar_file_message_preview"),
      yesterdayLabel: t("chat.sidebar_yesterday"),
    }),
    [t],
  );
  const memberChannelIds = useMemo(() => new Set(channels.map((c) => c.id)), [channels]);
  const quickCatchUp = useMemo(
    () =>
      onQuickCatchUp
        ? pickQuickCatchUp({
            unreadByRoomId,
            // Only what this scope lists: the busiest room of the other one is a click away.
            workspaceRoomId: messages ? null : workspaceRoomId,
            workspaceTitle,
            channels: messages ? EMPTY_CHANNELS : channels,
            groups: messages ? groups : EMPTY_GROUPS,
            contacts: messages ? contacts : EMPTY_CONTACTS,
            nicknamesByUserId,
          })
        : null,
    [messages, channels, contacts, groups, nicknamesByUserId, onQuickCatchUp, unreadByRoomId, workspaceRoomId, workspaceTitle],
  );

  const handleCreateGroup = (members: ChatContact[], name: string, avatar: File | null) => {
    if (!onCreateGroup) return;
    onCreateGroup(members, name, avatar);
  };
  const openStartDm = useCallback(() => setStartDmOpen(true), []);
  const openCreateGroup = onCreateGroup ? () => setCreateGroupOpen(true) : undefined;
  const filtering = filterText.length > 0 || tab !== "all";

  const tabLabel = (value: ChatSidebarTab) => {
    switch (value) {
      case "all":
        return t("chat.filter_all");
      case "unread":
        return t("chat.filter_unread");
      case "mentions":
        return t("chat.filter_mentions");
      case "dm":
        return t("chat.filter_dm");
      case "group":
        return t("chat.filter_group");
      case "channel":
        return t("chat.filter_channel");
      default:
        return value;
    }
  };
  const tabCount = (value: ChatSidebarTab) =>
    unreadBadgesReady && (value === "all" || value === "unread" || value === "mentions") ? tabCounts[value] : 0;

  return (
    <>
      <aside
        className={cn(
          "flex min-h-0 flex-col bg-surface",
          embedded ? "h-full min-w-0 flex-1 border-r border-border" : "rounded-lg border border-border",
        )}
      >
        <ChatScopeSwitch scope={scope} />
        <SidebarHeader
          scope={scope}
          onOpenFollowUps={onOpenFollowUps}
          onOpenFollowedThreads={onOpenFollowedThreads}
          onCollapse={onCollapse}
          onStartDm={openStartDm}
          onCreateGroup={openCreateGroup}
          onCreateChannel={() => setCreateChannelOpen(true)}
          onBrowseChannels={() => setChannelDirectoryOpen(true)}
        />
        <SidebarSearch scope={scope} value={filterQuery} onChange={setFilterQuery} />
        {/* Registry toggle group: arrow keys move between tabs (roving focus). */}
        <ToggleGroup
          value={[tab]}
          onValueChange={(value) => {
            const next = value[0] as ChatSidebarTab | undefined;
            if (next) setTab(next);
          }}
          aria-label={t("chat.filter_aria")}
          spacing={0.5}
          className="no-scrollbar flex w-full shrink-0 overflow-x-auto rounded-none border-b border-border px-2.5"
        >
          {tabs.map((value) => {
            const count = tabCount(value);
            return (
              <ToggleGroupItem key={value} value={value} className={TAB}>
                {tabLabel(value)}
                {count > 0 ? (
                  <>
                    <span aria-hidden className={cn(TAB_COUNT, value === tab && "bg-brand text-brand-foreground")}>
                      {count}
                    </span>
                    <span className="sr-only">{t("chat.sidebar_result_count", { count })}</span>
                  </>
                ) : null}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>

        <SidebarInvitations />

        <nav
          className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pt-2"
          aria-label={t("chat.sidebar_nav")}
        >
          {/* One persistent region: the count a filter or search leaves is
              announced politely, instead of every row change. */}
          <p className="sr-only" role="status">
            {filtering && !loading ? t("chat.sidebar_result_count", { count: entries.length }) : ""}
          </p>
          {loadError ? <SidebarLoadError onRetry={onRetry} /> : null}
          {quickCatchUp && onQuickCatchUp && unreadBadgesReady && !loading && !loadError && !filtering ? (
            <SidebarCatchUpCard catchUp={quickCatchUp} onOpen={onQuickCatchUp} />
          ) : null}
          {loading && !loadError && entries.length <= 1 ? (
            <SidebarSkeleton />
          ) : entries.length === 0 && messages && !filtering ? (
            // No DM or group yet: the two ways to start one.
            <SidebarStarter onStartDm={openStartDm} onCreateGroup={openCreateGroup} />
          ) : entries.length === 0 ? (
            <SidebarEmpty
              searching={filterText.length > 0}
              kindFilter={kindFilter}
              activityFilter={activityFilter}
              actions={{
                onStartDm: openStartDm,
                onCreateGroup: openCreateGroup,
                onCreateChannel: () => setCreateChannelOpen(true),
                onBrowseChannels: () => setChannelDirectoryOpen(true),
                onShowAll: () => {
                  setTab("all");
                  setFilterQuery("");
                },
              }}
            />
          ) : (
            <ChatSidebarList
              sectionAfterFirst={
                !messages && !filtering && entries[0]?.kind === "workspace" ? (
                  <ChannelsSectionHeading onBrowse={() => setChannelDirectoryOpen(true)} />
                ) : undefined
              }
              entries={entries}
              target={target}
              onTargetChange={onTargetChange}
              workspaceTitle={workspaceTitle}
              contacts={contacts}
              currentUserId={currentUserId}
              nicknamesByUserId={nicknamesByUserId}
              roomPreviewsByRoomId={roomPreviewsByRoomId}
              unreadByRoomId={unreadByRoomId}
              mentionUnreadByRoomId={mentionUnreadByRoomId}
              unreadBadgesReady={unreadBadgesReady}
              preferencesByRoomId={pinnedByRoomId}
              mutedRoomIds={mutedRoomIds}
              labels={labels}
              memberAvatarByUserId={memberAvatarByUserId}
              typingNameByUserId={typingNameByUserId}
              peerReadAtByRoomId={peerReadAtByRoomId}
            />
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
        onCreateChannel={() => {
          setChannelDirectoryOpen(false);
          setCreateChannelOpen(true);
        }}
        onJoined={(room) => {
          setChannelDirectoryOpen(false);
          onTargetChange({ kind: "channel", channel: room });
        }}
      />
    </>
  );
});

/** "KÊNH · Duyệt kênh" under the workspace's own room (canvas "Workspace"). */
function ChannelsSectionHeading({ onBrowse }: { onBrowse: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between pt-3 pr-1.5 pb-1 pl-3">
      <h3 className="text-caption font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {t("chat.channel.section_title")}
      </h3>
      <button
        type="button"
        onClick={onBrowse}
        className="flex h-11 items-center rounded-md px-2 text-label font-semibold text-brand hover:underline"
      >
        {t("chat.channel.directory_title")}
      </button>
    </div>
  );
}
