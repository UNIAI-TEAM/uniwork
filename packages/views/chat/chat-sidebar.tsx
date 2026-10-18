"use client";

import { Compass, Hash, ListChecks, PanelLeftClose, Plus, Search, UserPlus, Users } from "lucide-react";
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatRooms } from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { useChatRoomPreferencesStore } from "@uniwork/core/chat/room-preferences-store";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { ChannelDirectorySheet } from "./channel-directory-sheet";
import { CreateChannelDialog } from "./create-channel-dialog";
import { CreateGroupDialog } from "./create-group-dialog";
import { StartDmDialog } from "./start-dm-dialog";
import type { ChatSidebarProps, ChatSidebarTarget } from "./chat-sidebar-types";
import {
  buildUnifiedSidebarEntries,
  chatSidebarActivityFilterOptions,
  chatSidebarFilterOptions,
  type ChatSidebarActivityFilter,
  type ChatSidebarKindFilter,
} from "./chat-sidebar-unified";
import { ChatSidebarList } from "./chat-sidebar-list";
import { typingNameByUserIdFromContext } from "./chat-sidebar-typing";
import {
  SidebarEmpty,
  SidebarIconAction,
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

export type { ChatSidebarTarget } from "./chat-sidebar-types";

/* The kind filter is the list's tab strip: a quiet label that takes the brand
   and an underline when chosen, sitting on the rule above the list. */
/* Menu rows at the canvas' 40px, icon and label 12px apart. */
const MENU_ITEM = "h-10 gap-3 rounded-md px-2.5 font-medium";

const KIND_TAB =
  "relative h-11 min-w-0 flex-1 truncate rounded-md border-0 px-1 text-label font-semibold text-muted-foreground transition-colors duration-(--duration-fast) " +
  "after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent " +
  "hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent aria-pressed:text-brand aria-pressed:after:bg-brand";

/* The read-state filter is a row of pills under the tabs: muted when off, the
   brand wash when on, so the two filters never read as one control. */
const ACTIVITY_CHIP =
  "h-7 rounded-full border-0 px-3 text-label font-medium text-muted-foreground bg-muted transition-colors duration-(--duration-fast) pointer-coarse:h-11 " +
  "hover:bg-surface-hover hover:text-foreground aria-pressed:bg-brand-subtle aria-pressed:text-brand-subtle-foreground";

/**
 * Memoised: the page re-renders on every composer keystroke and typing
 * signal, and none of that reaches the list unless its own props moved.
 */
export const ChatSidebar = memo(function ChatSidebar({
  currentUserId,
  workspaceId,
  target,
  onTargetChange,
  contacts,
  groups,
  channels = EMPTY_CHANNELS,
  onOpenFollowUps,
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
  const [kindFilter, setKindFilter] = useState<ChatSidebarKindFilter>("all");
  const [activityFilter, setActivityFilter] = useState<ChatSidebarActivityFilter>("all");
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
  const workspaceTitle = workspaceRoomTitle ?? t("chat.workspace_room");
  const typingNameByUserId = useMemo(
    () => typingNameByUserIdFromContext(knownPeople),
    [knownPeople],
  );

  const filterOptions = useMemo(() => chatSidebarFilterOptions(), []);
  const activityFilterOptions = useMemo(() => chatSidebarActivityFilterOptions(), []);

  const entries = useMemo(
    () =>
      buildUnifiedSidebarEntries({
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
            workspaceRoomId,
            workspaceTitle,
            channels,
            groups,
            contacts,
            nicknamesByUserId,
          })
        : null,
    [channels, contacts, groups, nicknamesByUserId, onQuickCatchUp, unreadByRoomId, workspaceRoomId, workspaceTitle],
  );

  const handleCreateGroup = (members: ChatContact[], name: string, avatar: File | null) => {
    if (!onCreateGroup) return;
    onCreateGroup(members, name, avatar);
  };
  const openStartDm = useCallback(() => setStartDmOpen(true), []);
  const openCreateGroup = onCreateGroup ? () => setCreateGroupOpen(true) : undefined;
  const filtering = filterText.length > 0 || kindFilter !== "all" || activityFilter !== "all";

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

  const activityFilterLabel = (kind: ChatSidebarActivityFilter) => {
    switch (kind) {
      case "all":
        return t("chat.filter_activity_all");
      case "unread":
        return t("chat.filter_unread");
      case "mentions":
        return t("chat.filter_mentions");
      default:
        return kind;
    }
  };

  return (
    <>
      <aside
        className={cn(
          "flex min-h-0 flex-col bg-surface",
          embedded ? "h-full min-w-0 flex-1 border-r border-border" : "rounded-lg border border-border",
        )}
      >
        <header className="flex shrink-0 items-center gap-1 pt-3.5 pr-3 pb-3 pl-5">
          <h2
            id="chat-sidebar-title"
            className="min-w-0 flex-1 truncate font-display text-title-lg font-extrabold text-foreground"
          >
            {t("chat.title")}
          </h2>
          {onOpenFollowUps ? (
            <SidebarIconAction icon={ListChecks} label={t("chat.follow_up.list_title")} onClick={onOpenFollowUps} />
          ) : null}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-lg"
                        // A filled square, so the one way to start a conversation
                        // stands apart from the quiet icons beside it.
                        className="size-10 rounded-lg bg-muted text-foreground hover:bg-surface-hover aria-expanded:bg-brand-subtle aria-expanded:text-brand-subtle-foreground dark:hover:bg-surface-hover"
                        aria-label={t("chat.new_conversation_aria")}
                      />
                    }
                  />
                }
              >
                <Plus aria-hidden className="size-5" />
              </TooltipTrigger>
              <TooltipContent>{t("chat.new_conversation_aria")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-60 rounded-xl p-1.5">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2.5 pt-2 pb-1.5">{t("chat.new_conversation_aria")}</DropdownMenuLabel>
                <DropdownMenuItem className={MENU_ITEM} onClick={() => setStartDmOpen(true)}>
                  <UserPlus aria-hidden />
                  {t("chat.add_dm_aria")}
                </DropdownMenuItem>
                <DropdownMenuItem className={MENU_ITEM} disabled={!onCreateGroup} onClick={() => setCreateGroupOpen(true)}>
                  <Users aria-hidden />
                  {t("chat.create_group_aria")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator className="mx-1 my-1.5" />
              <DropdownMenuItem className={MENU_ITEM} onClick={() => setCreateChannelOpen(true)}>
                <Hash aria-hidden />
                {t("chat.channel.create_aria")}
              </DropdownMenuItem>
              <DropdownMenuItem className={MENU_ITEM} onClick={() => setChannelDirectoryOpen(true)}>
                <Compass aria-hidden />
                {t("chat.channel.directory_aria")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {onCollapse ? (
            <SidebarIconAction
              icon={PanelLeftClose}
              label={t("chat.hide_conversations")}
              onClick={onCollapse}
              expanded
              data-chat-sidebar-collapse=""
              className="hidden lg:inline-flex"
            />
          ) : null}
        </header>

        <div className="shrink-0 px-4 pb-1">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t("chat.search_conversations")}
              aria-label={t("chat.search_conversations_label")}
              type="search"
              autoComplete="off"
              className="h-11 rounded-full border-transparent bg-muted pr-4 pl-10 hover:bg-surface-hover focus-visible:bg-surface md:text-body-lg dark:bg-muted dark:focus-visible:bg-surface"
            />
          </div>
        </div>
        {/* Registry toggle groups: arrow keys move between options (roving focus). */}
        <ToggleGroup
          value={[kindFilter]}
          onValueChange={(value) => {
            const next = value[0] as ChatSidebarKindFilter | undefined;
            if (next) setKindFilter(next);
          }}
          aria-label={t("chat.filter_aria")}
          className="flex w-full shrink-0 rounded-none border-b border-border px-2.5"
        >
          {filterOptions.map((kind) => (
            <ToggleGroupItem key={kind} value={kind} className={KIND_TAB}>
              {filterLabel(kind)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          value={[activityFilter]}
          onValueChange={(value) => {
            const next = value[0] as ChatSidebarActivityFilter | undefined;
            if (next) setActivityFilter(next);
          }}
          aria-label={t("chat.filter_activity_aria")}
          spacing={1.5}
          className="flex w-full shrink-0 px-4 pt-2.5 pb-1"
        >
          {activityFilterOptions.map((kind) => (
            <ToggleGroupItem key={kind} value={kind} className={ACTIVITY_CHIP}>
              {activityFilterLabel(kind)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <SidebarInvitations />

        <nav
          className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2"
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
                  setKindFilter("all");
                  setActivityFilter("all");
                  setFilterQuery("");
                },
              }}
            />
          ) : (
            <ChatSidebarList
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
            />
          )}
          {!loading && !loadError && !filtering && entries.length === 1 && entries[0]?.kind === "workspace" ? (
            <SidebarStarter onStartDm={openStartDm} onCreateGroup={openCreateGroup} />
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
