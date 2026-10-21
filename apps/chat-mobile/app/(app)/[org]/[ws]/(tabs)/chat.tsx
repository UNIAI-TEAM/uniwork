// The Chat tab (spec §2.1, MobileList board): every conversation in one list,
// sorted and counted like the web's sidebar, with search, the filter chips,
// pin and mute on a long-press, the workspace pill (the workspace switch) and
// the compose button for a new DM or the channel directory. It is also where a deep link
// lands: `?room=` opens that room, with `&message=` jumping to the message,
// and `?dm=` opens (or creates) the DM with that person — the params
// lib/deep-link.ts › deepLinkHref writes, carried out by
// components/chat/use-deep-link-target.ts.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, RefreshControl, View } from "react-native";
import { CatchUpBanner, CatchUpSheet, type CatchUpTarget } from "@/components/chat/catch-up-sheet";
import { ConnectionBanner } from "@/components/chat/connection-banner";
import { FilterChips, RoomListEmpty, RoomListError, RoomListSkeleton, ScopeHint, ScopeSwitch, WorkspacePill } from "@/components/chat/room-list-parts";
import { RoomListView } from "@/components/chat/room-list-view";
import { RoomPreview } from "@/components/chat/room-preview";
import { useChatWorkspace } from "@/components/chat/use-chat-workspace";
import { useDeepLinkTarget } from "@/components/chat/use-deep-link-target";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { Header } from "@/components/ui/header";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { WorkspaceSwitchSheet } from "@/components/workspace/workspace-switch-sheet";
import { useResolveDM, useSetRoomMuted } from "@/data/mutations/rooms";
import { nicknamesOptions, roomsOptions, unreadSummaryOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useChatPinsStore } from "@/data/stores/chat-pins-store";
import { selectQueuedRoomIds, useChatSendStore } from "@/data/stores/chat-send-store";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import { chatRoutes } from "@/lib/chat-routes";
import { ROOM_LIST_FILTERS_BY_SCOPE, scopeRows, type ChatScope } from "@/lib/chat-scope";
import { buildRoomList, filterRoomList, quickCatchUp, roomListTypingLines, type RoomListFilter, type RoomListRow } from "@/lib/room-list";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { unreadInOtherWorkspaces } from "@/lib/workspace-unread";
import { ScreenFullyDrawn } from "@/data/sentry";
import { toast } from "@/data/stores/toast-store";

export default function ChatTab() {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const chat = useChatWorkspace();
  const resolveDM = useResolveDM(chat?.wsId ?? "").mutateAsync;
  const setRoomMuted = useSetRoomMuted(chat?.wsId ?? "").mutateAsync;
  const wsId = chat?.wsId ?? "";
  useDeepLinkTarget(chat);

  const rooms = useQuery({ ...roomsOptions(wsId), enabled: Boolean(chat) });
  const nicknames = useQuery({ ...nicknamesOptions(wsId), enabled: Boolean(chat) });
  const members = useQuery({ ...workspaceMembersOptions(wsId), enabled: Boolean(chat) });
  const workspace = useQuery(workspaceListOptions()).data?.find((w) => w.id === wsId);
  const summary = useQuery({ ...unreadSummaryOptions(), enabled: Boolean(chat) });
  const otherUnread = unreadInOtherWorkspaces(summary.data, wsId);
  const sends = useChatSendStore((s) => s.entries);
  const queuedRooms = useMemo(() => selectQueuedRoomIds(sends, wsId, chat?.userId ?? ""), [sends, wsId, chat?.userId]);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [catchUp, setCatchUp] = useState<CatchUpTarget | null>(null);
  const pinnedByRoomId = useChatPinsStore((s) => s.byRoomId);
  const typingByRoomId = useSidebarTypingStore((s) => s.byRoomId);
  const [filterText, setFilterText] = useState("");
  const [chosenFilter, setFilter] = useState<RoomListFilter>("all");
  // DMs and groups are the organization's, channels the workspace's: one list at a time (lib/chat-scope.ts).
  const [scope, setScope] = useState<ChatScope>("messages");
  const filters = ROOM_LIST_FILTERS_BY_SCOPE[scope];
  const filter = filters.includes(chosenFilter) ? chosenFilter : "all";
  const [menuRow, setMenuRow] = useState<RoomListRow | null>(null);
  const [pulling, setPulling] = useState(false);

  // Built without typing or presence, which change by the second (components/chat/room-list-view.tsx).
  const rows = useMemo(
    () =>
      chat && rooms.data
        ? buildRoomList({
            rooms: rooms.data,
            filterText: filterText.trim(),
            workspaceName: chat.workspaceName,
            currentUserId: chat.userId,
            nicknamesByUserId: nicknames.data ?? {},
            workspaceMembers: members.data ?? [],
            pinnedByRoomId,
            t,
            locale: i18n.language,
          })
        : [],
    [chat, rooms.data, filterText, nicknames.data, members.data, pinnedByRoomId, t, i18n.language],
  );
  const typingLines = useMemo(
    () =>
      roomListTypingLines({
        rooms: rooms.data ?? [],
        nicknamesByUserId: nicknames.data ?? {},
        workspaceMembers: members.data ?? [],
        typingByRoomId,
        t,
        locale: i18n.language,
      }),
    [rooms.data, nicknames.data, members.data, typingByRoomId, t, i18n.language],
  );
  const scoped = useMemo(() => scopeRows(scope, rows), [rows, scope]);
  const shown = useMemo(() => filterRoomList(scoped, filter), [scoped, filter]);
  const mentionRooms = useMemo(() => filterRoomList(scoped, "mentions").length, [scoped]);
  // "Bắt kịp nhanh" sums the list's unread and opens the room holding the most of it.
  const catchUpPick = useMemo(() => quickCatchUp(scoped), [scoped]);

  const open = useCallback(
    (row: RoomListRow) => {
      if (!chat) return;
      if (row.roomId) {
        router.push(chatRoutes.room(chat, row.roomId));
        return;
      }
      if (row.entry.kind !== "dm") return;
      resolveDM(row.entry.contact.user_id)
        .then((room) => room && router.push(chatRoutes.room(chat, room.id)))
        .catch(() => toast.error(t("chat.dm_failed")));
    },
    [chat, resolveDM, t],
  );

  const menuActions: SheetAction[] = [];
  if (menuRow?.roomId && chat) {
    const roomId = menuRow.roomId;
    menuActions.push({
      key: "pin",
      label: menuRow.pinned ? t("chat.mobile.unpin_conversation") : t("chat.settings_pin_conversation"),
      icon: menuRow.pinned ? "pin" : "pin-outline",
      onPress: () => void useChatPinsStore.getState().toggle(roomId),
    });
    if (menuRow.room) {
      const muted = menuRow.muted;
      menuActions.push({
        key: "mute",
        label: muted ? t("chat.mobile.unmute_notifications") : t("chat.settings_mute_notifications"),
        icon: muted ? "notifications-outline" : "notifications-off-outline",
        onPress: () => void setRoomMuted({ roomId, muted: !muted }).catch(() => toast.error(t("common.error"))),
      });
    }
  }

  const pill = chat ? (
    <WorkspacePill name={chat.workspaceName} seed={wsId} iconUrl={workspace?.icon_url} iconEmoji={workspace?.icon_emoji} otherUnread={otherUnread} onPress={() => setSwitchOpen(true)} />
  ) : null;
  // "+" starts something where the reader is: a DM or group in messages, the channel directory in a workspace.
  const newChat = chat ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={scope === "messages" ? t("chat.new_conversation_aria") : t("chat.channel.directory_aria")}
      className="h-11 w-11 items-center justify-center rounded-full bg-muted active:opacity-80"
      onPress={() => router.push(scope === "messages" ? chatRoutes.newChat(chat) : chatRoutes.channels(chat))}
    >
      <Ionicons name={scope === "messages" ? "create-outline" : "compass-outline"} size={21} color={theme.primary} />
    </Pressable>
  ) : null;

  return (
    <View className="flex-1 bg-background">
      <Header large title={t("nav.chat")} right={newChat}>
        {chat ? (
          <ScopeSwitch
            value={scope}
            onChange={setScope}
            workspaceName={chat.workspaceName}
            workspaceSeed={wsId}
            workspaceIconUrl={workspace?.icon_url}
            workspaceIconEmoji={workspace?.icon_emoji}
            messages={summary.data?.direct}
            channels={summary.data?.workspaces.find((row) => row.workspace_id === wsId)}
          />
        ) : null}
        <ScopeHint scope={scope} />
        {scope === "workspace" && pill ? <View className="mt-3 flex-row">{pill}</View> : null}
        <SearchField
          value={filterText}
          onChangeText={setFilterText}
          placeholder={
            scope === "workspace" && chat ? t("chat.scope.search_channels", { name: chat.workspaceName }) : t("chat.mobile.search_placeholder")
          }
          accessibilityLabel={t("chat.search_conversations_label")}
          className="mt-2.5"
        />
      </Header>
      <ConnectionBanner />
      {!chat || rooms.isPending ? (
        <RoomListSkeleton />
      ) : rooms.isError && !rooms.data ? (
        <RoomListError onRetry={() => void rooms.refetch()} />
      ) : (
        <>
          <FilterChips value={filter} onChange={setFilter} mentionRooms={mentionRooms} total={scoped.length} filters={filters} />
          <RoomListView
            rows={shown}
            typingLines={typingLines}
            queuedRooms={queuedRooms}
            onOpen={open}
            onMenu={setMenuRow}
            ListHeaderComponent={
              catchUpPick.top && filter === "all" && filterText.trim() === "" ? (
                <CatchUpBanner
                  total={catchUpPick.total}
                  rooms={catchUpPick.rooms}
                  onPress={() => catchUpPick.top?.roomId && setCatchUp({ roomId: catchUpPick.top.roomId, title: catchUpPick.top.title, unread: catchUpPick.top.unread })}
                />
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={pulling}
                onRefresh={() => {
                  setPulling(true);
                  void rooms.refetch().finally(() => setPulling(false));
                }}
              />
            }
            ListEmptyComponent={
              <RoomListEmpty
                searching={filterText.trim().length > 0}
                filter={filter}
                onStartDm={() => router.push(chatRoutes.newChat(chat))}
                onBrowseChannels={() => router.push(chatRoutes.channels(chat))}
              />
            }
          />
        </>
      )}
      <ActionSheet
        visible={menuRow !== null && menuActions.length > 0}
        onClose={() => setMenuRow(null)}
        label={menuRow ? t("chat.sidebar_list_menu_aria", { name: menuRow.title }) : undefined}
        above={menuRow && chat ? <RoomPreview wsId={wsId} row={menuRow} userId={chat.userId} /> : null}
        actions={menuActions}
      />
      {/* The tab's load span ends when its rooms are drawn (Sentry performance; no-op without a DSN). */}
      <ScreenFullyDrawn record={Boolean(chat) && !rooms.isPending} />
      <WorkspaceSwitchSheet visible={switchOpen} onClose={() => setSwitchOpen(false)} currentWsId={wsId} />
      {chat ? (
        <CatchUpSheet
          wsId={wsId}
          target={catchUp}
          onClose={() => setCatchUp(null)}
          onOpenRoom={(roomId) => {
            setCatchUp(null);
            router.push(chatRoutes.room(chat, roomId));
          }}
        />
      ) : null}
    </View>
  );
}
