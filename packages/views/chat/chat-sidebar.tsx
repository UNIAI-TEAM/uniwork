"use client";

import {
  Compass,
  Hash,
  ListChecks,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { useChatRoomPreferencesStore } from "@uniwork/core/chat/room-preferences-store";
import type { PendingInvitation } from "@uniwork/core/types";
import { useAcceptInvite, useMyInvitations } from "@uniwork/core/workspaces";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../layout/module-tones";
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

/* Same chip as the inbox triage row: a quiet label that rises to a raised
   surface when on, so the active filter reads without a second accent. */
/* One segment of the kind filter: a quiet label on the muted track that
   rises to a raised surface when chosen — one control, one row. */
const FILTER_SEGMENT =
  "h-7 min-w-0 flex-1 truncate rounded-md border-0 px-1.5 text-caption font-medium text-muted-foreground transition-colors duration-(--duration-fast) pointer-coarse:h-11 " +
  "hover:text-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[var(--surface-shadow)] dark:aria-pressed:bg-muted";

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
  loading = false,
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
  const { data: invites = [] } = useMyInvitations();
  const accept = useAcceptInvite();
  const filterText = filterQuery.trim().toLowerCase();
  const pinnedByRoomId = useChatRoomPreferencesStore((state) => state.byRoomId);
  const isRoomPinned = (roomId: string | null | undefined) =>
    Boolean(roomId && pinnedByRoomId[roomId]?.pinned);
  const isRoomNotificationsMuted = (roomId: string | null | undefined) =>
    Boolean(roomId && pinnedByRoomId[roomId]?.notificationsMuted);
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
          "flex min-h-0 flex-col bg-surface",
          embedded ? "h-full min-w-0 flex-1 border-r border-border" : "rounded-lg border border-border",
        )}
      >
        {/* Same height as the conversation header, so one rule runs across
            both columns and the two titles share a baseline. */}
        <header className="flex h-14 shrink-0 items-center gap-0.5 border-b border-border pr-2 pl-3">
          <h2 className="min-w-0 flex-1 truncate text-title-sm font-semibold text-foreground">{t("chat.title")}</h2>
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
                <Plus aria-hidden className="size-[18px]" />
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
              aria-label={t("chat.search_conversations")}
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

        {invites.length > 0 ? (
          <section className="space-y-2 px-3 pb-2">
            <h3 className="px-1 text-overline text-muted-foreground uppercase">
              {t("chat.pending_invites")}
            </h3>
            <ul className="space-y-1">
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-col gap-2 rounded-lg bg-brand-subtle px-3 py-2"
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
          className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3"
          aria-label={t("chat.sidebar_nav")}
        >
          {loading && entries.length <= 1 ? (
            <SidebarSkeleton />
          ) : entries.length === 0 ? (
            <SidebarEmpty
              searching={filterText.length > 0}
              filtered={kindFilter !== "all"}
              onStartDm={() => setStartDmOpen(true)}
            />
          ) : (
            <ul className="-mx-1 min-h-0 shrink space-y-px overflow-y-auto px-1">
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
          {!loading && !filterText && kindFilter === "all" && entries.length === 1 && entries[0]?.kind === "workspace" ? (
            <SidebarStarter onStartDm={() => setStartDmOpen(true)} onCreateGroup={onCreateGroup ? () => setCreateGroupOpen(true) : undefined} />
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
}

/** A quiet icon action in the sidebar header, named by its tooltip. */
function SidebarIconAction({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={cn("text-muted-foreground hover:text-foreground", className)}
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        <Icon aria-hidden className="size-[18px]" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A new workspace lists only its shared room. Under it, one quiet line says
 * what the list is for and offers the two ways to start — not an empty column.
 */
function SidebarStarter({ onStartDm, onCreateGroup }: { onStartDm: () => void; onCreateGroup?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-2 border-t border-border px-2 pt-3">
      <p className="text-caption text-pretty text-muted-foreground">{t("chat.sidebar_starter_hint")}</p>
      <div className="flex flex-col items-start gap-0.5">
        <Button type="button" variant="ghost" size="sm" className="-ml-2 text-foreground" onClick={onStartDm}>
          <UserPlus aria-hidden />
          {t("chat.add_dm_aria")}
        </Button>
        {onCreateGroup ? (
          <Button type="button" variant="ghost" size="sm" className="-ml-2 text-foreground" onClick={onCreateGroup}>
            <Users aria-hidden />
            {t("chat.create_group_aria")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The loading shape is the row's shape: a mark, a name, a preview. */
function SidebarSkeleton() {
  const widths = ["w-2/3", "w-1/2", "w-3/4", "w-2/5", "w-3/5"];
  return (
    <div className="space-y-px" aria-busy>
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={`h-3.5 ${w}`} />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Three different truths share this slot: a search with no hit, a kind filter
 * with nothing of that kind yet, and no conversation at all beyond the
 * workspace room. Each says which one it is and, when there is one, the next
 * step.
 */
function SidebarEmpty({
  searching,
  filtered,
  onStartDm,
}: {
  searching: boolean;
  filtered: boolean;
  onStartDm: () => void;
}) {
  const { t } = useTranslation();
  if (searching) {
    return <p className="px-2 py-3 text-caption text-muted-foreground">{t("chat.search_no_results")}</p>;
  }
  return (
    <div className="flex flex-col items-start gap-2 px-2 py-4">
      <IconTile icon={MessageSquare} tone={moduleTone("chat")} size="sm" />
      <p className="text-body font-medium text-foreground">
        {filtered ? t("chat.sidebar_filter_empty_title") : t("chat.sidebar_empty_title")}
      </p>
      <p className="text-caption text-pretty text-muted-foreground">{t("chat.sidebar_empty_hint")}</p>
      <Button type="button" variant="outline" size="sm" onClick={onStartDm}>
        <UserPlus aria-hidden />
        {t("chat.add_dm_aria")}
      </Button>
    </div>
  );
}
