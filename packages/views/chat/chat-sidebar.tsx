"use client";

import { Compass, Hash, ListChecks, PanelLeftClose, Plus, Search, UserPlus, Users } from "lucide-react";
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { useChatRoomPreferencesStore } from "@uniwork/core/chat/room-preferences-store";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  chatSidebarFilterOptions,
  type ChatSidebarKindFilter,
} from "./chat-sidebar-unified";
import { ChatSidebarList } from "./chat-sidebar-list";
import {
  SidebarEmpty,
  SidebarIconAction,
  SidebarInvitations,
  SidebarLoadError,
  SidebarSkeleton,
  SidebarStarter,
} from "./chat-sidebar-parts";
import type { SidebarRowLabels } from "./chat-sidebar-unified-row";

const EMPTY_COUNTS: Record<string, number> = {};
const EMPTY_PREVIEWS: NonNullable<ChatSidebarProps["roomPreviewsByRoomId"]> = {};
const EMPTY_NICKNAMES: Record<string, string> = {};
const EMPTY_CHANNELS: NonNullable<ChatSidebarProps["channels"]> = [];

export type { ChatSidebarTarget } from "./chat-sidebar-types";

/* Same chip as the inbox triage row: a quiet label that rises to a raised
   surface when on, so the active filter reads without a second accent. */
/* One segment of the kind filter: a quiet label on the muted track that
   rises to a raised surface when chosen — one control, one row. */
const FILTER_SEGMENT =
  "h-7 min-w-0 flex-1 truncate rounded-md border-0 px-1.5 text-caption font-medium text-muted-foreground transition-colors duration-(--duration-fast) pointer-coarse:h-11 " +
  "hover:text-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[var(--surface-shadow)] dark:aria-pressed:bg-muted";

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
  workHubEnabled = false,
  onOpenFollowUps,
  onCreateGroup,
  creatingGroup = false,
  createGroupOpen: createGroupOpenProp,
  onCreateGroupOpenChange,
  onJoinedWorkspace,
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
  // The field answers every keystroke; the list re-sorts when React is idle.
  const filterText = useDeferredValue(filterQuery.trim());
  const pinnedByRoomId = useChatRoomPreferencesStore((state) => state.byRoomId);
  const workspaceTitle = workspaceRoomTitle ?? t("chat.workspace_room");

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

  const handleCreateGroup = (members: ChatContact[], name: string) => {
    if (!onCreateGroup) return;
    onCreateGroup(members, name);
  };
  const openStartDm = useCallback(() => setStartDmOpen(true), []);
  const openCreateGroup = onCreateGroup ? () => setCreateGroupOpen(true) : undefined;
  const filtering = filterText.length > 0 || kindFilter !== "all";

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
          "flex min-h-0 flex-col bg-surface",
          embedded ? "h-full min-w-0 flex-1 border-r border-border" : "rounded-lg border border-border",
        )}
      >
        {/* Same height as the conversation header, so one rule runs across
            both columns and the two titles share a baseline. */}
        <header className="flex h-14 shrink-0 items-center gap-0.5 border-b border-border pr-2 pl-3">
          <h2 id="chat-sidebar-title" className="min-w-0 flex-1 truncate text-title-sm font-semibold text-foreground">
            {t("chat.title")}
          </h2>
          {workHubEnabled && onOpenFollowUps ? (
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
                        className="text-foreground"
                        aria-label={t("chat.new_conversation_aria")}
                      />
                    }
                  />
                }
              >
                <Plus aria-hidden className="size-4.5" />
              </TooltipTrigger>
              <TooltipContent>{t("chat.new_conversation_aria")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onClick={() => setStartDmOpen(true)}>
                <UserPlus aria-hidden />
                {t("chat.add_dm_aria")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!onCreateGroup} onClick={() => setCreateGroupOpen(true)}>
                <Users aria-hidden />
                {t("chat.create_group_aria")}
              </DropdownMenuItem>
              {workHubEnabled ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setCreateChannelOpen(true)}>
                    <Hash aria-hidden />
                    {t("chat.channel.create_aria")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setChannelDirectoryOpen(true)}>
                    <Compass aria-hidden />
                    {t("chat.channel.directory_aria")}
                  </DropdownMenuItem>
                </>
              ) : null}
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

        <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t("chat.search_conversations")}
              aria-label={t("chat.search_conversations_label")}
              type="search"
              autoComplete="off"
              className="h-8 border-transparent bg-muted pl-8 hover:bg-surface-hover focus-visible:bg-surface dark:bg-muted dark:focus-visible:bg-surface"
            />
          </div>
          {/* Registry toggle group: arrow keys move between kinds (roving focus).
              Dark has no surface lighter than the sidebar, so there the track
              sinks (background) and the chosen segment rises (muted). */}
          <ToggleGroup
            value={[kindFilter]}
            onValueChange={(value) => {
              const next = value[0] as ChatSidebarKindFilter | undefined;
              if (next) setKindFilter(next);
            }}
            aria-label={t("chat.filter_aria")}
            spacing={1}
            className="flex w-full rounded-lg bg-muted p-0.5 dark:bg-background"
          >
            {filterOptions.map((kind) => (
              <ToggleGroupItem key={kind} value={kind} className={FILTER_SEGMENT}>
                {filterLabel(kind)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <SidebarInvitations onJoined={onJoinedWorkspace} />

        <nav
          className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3"
          aria-label={t("chat.sidebar_nav")}
        >
          {/* One persistent region: the count a filter or search leaves is
              announced politely, instead of every row change. */}
          <p className="sr-only" role="status">
            {filtering && !loading ? t("chat.sidebar_result_count", { count: entries.length }) : ""}
          </p>
          {loadError ? <SidebarLoadError onRetry={onRetry} /> : null}
          {loading && !loadError && entries.length <= 1 ? (
            <SidebarSkeleton />
          ) : entries.length === 0 ? (
            <SidebarEmpty
              searching={filterText.length > 0}
              kindFilter={kindFilter}
              actions={{
                onStartDm: openStartDm,
                onCreateGroup: openCreateGroup,
                onCreateChannel: workHubEnabled ? () => setCreateChannelOpen(true) : undefined,
                onBrowseChannels: workHubEnabled ? () => setChannelDirectoryOpen(true) : undefined,
                onShowAll: () => {
                  setKindFilter("all");
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
              labels={labels}
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
      ) : null}
    </>
  );
});
