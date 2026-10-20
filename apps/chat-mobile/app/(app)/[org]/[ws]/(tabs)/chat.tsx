// The Chat tab (spec §2.1, MobileList board): every conversation in one list,
// sorted and counted like the web's sidebar, with search, the filter chips,
// pin and mute on a long-press, the workspace pill (the workspace switch) and
// the compose button for a new DM or the channel directory. It is also where a deep link
// lands: `?room=` opens that room, with `&message=` jumping to the message,
// and `?dm=` opens (or creates) the DM with that person — the params
// lib/deep-link.ts › deepLinkHref writes.
import { Ionicons } from "@expo/vector-icons";
import { useNetInfo } from "@react-native-community/netinfo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, Pressable, RefreshControl, View } from "react-native";
import { CatchUpBanner, CatchUpSheet, type CatchUpTarget } from "@/components/chat/catch-up-sheet";
import { FilterChips, RoomListEmpty, RoomListError, RoomListSkeleton, ScopeHint, ScopeSwitch, WorkspacePill } from "@/components/chat/room-list-parts";
import { RoomPreview } from "@/components/chat/room-preview";
import { RoomRow } from "@/components/chat/room-row";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { Header } from "@/components/ui/header";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { WorkspaceSwitchSheet } from "@/components/workspace/workspace-switch-sheet";
import { callEngine } from "@/data/calls/call-store";
import { resolveDMRoom, setRoomMuted } from "@/data/chat-actions";
import { nicknamesOptions, roomsOptions, unreadSummaryOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useChatPinsStore } from "@/data/stores/chat-pins-store";
import { useChatSendStore } from "@/data/stores/chat-send-store";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import { chatRoutes } from "@/lib/chat-routes";
import { ROOM_LIST_FILTERS_BY_SCOPE, scopeRows, type ChatScope } from "@/lib/chat-scope";
import { buildRoomList, filterRoomList, type RoomListFilter, type RoomListRow } from "@/lib/room-list";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { unreadInOtherWorkspaces } from "@/lib/workspace-unread";

/** Opens the room a deep link names, once per link. */
function useDeepLinkTarget(chat: ChatWorkspace | null) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ room?: string; message?: string; dm?: string; call?: string }>();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const key = [params.room, params.message, params.dm, params.call].map((value) => value ?? "").join("|");
    if (key === "|||") {
      handled.current = null;
      return;
    }
    if (!chat || handled.current === key) return;
    handled.current = key;
    const { room, message, dm, call } = params;
    router.setParams({ room: undefined, message: undefined, dm: undefined, call: undefined });
    // A "X đang gọi" push: answer while it rings, else the room, where the missed call is logged.
    if (room && call) {
      void callEngine.joinFromPush(room, call).then((joined) => {
        if (!joined) router.push(chatRoutes.room(chat, room));
      });
      return;
    }
    if (room) {
      router.push(chatRoutes.room(chat, room, message));
      return;
    }
    if (dm) {
      resolveDMRoom(qc, chat.wsId, dm)
        .then((resolved) => {
          if (resolved) router.push(chatRoutes.room(chat, resolved.id));
          else Alert.alert(t("chat.dm_failed"));
        })
        .catch(() => Alert.alert(t("chat.dm_failed")));
    }
  }, [chat, params, qc, t]);
}

export default function ChatTab() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const chat = useChatWorkspace();
  const wsId = chat?.wsId ?? "";
  useDeepLinkTarget(chat);

  const rooms = useQuery({ ...roomsOptions(wsId), enabled: Boolean(chat) });
  const nicknames = useQuery({ ...nicknamesOptions(wsId), enabled: Boolean(chat) });
  const members = useQuery({ ...workspaceMembersOptions(wsId), enabled: Boolean(chat) });
  const workspace = useQuery(workspaceListOptions()).data?.find((w) => w.id === wsId);
  const summary = useQuery({ ...unreadSummaryOptions(), enabled: Boolean(chat) });
  const otherUnread = unreadInOtherWorkspaces(summary.data, wsId);
  const offline = useNetInfo().isConnected === false;
  const sends = useChatSendStore((s) => s.entries);
  const queuedRooms = useMemo(() => new Set(sends.filter((entry) => entry.status === "queued" && entry.workspaceId === wsId).map((entry) => entry.roomId)), [sends, wsId]);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [catchUp, setCatchUp] = useState<CatchUpTarget | null>(null);
  const pinnedByRoomId = useChatPinsStore((s) => s.byRoomId);
  const typingByRoomId = useSidebarTypingStore((s) => s.byRoomId);
  const online = usePresenceStore((s) => s.onlineUserIds);
  const [filterText, setFilterText] = useState("");
  const [chosenFilter, setFilter] = useState<RoomListFilter>("all");
  // DMs and groups are the organization's, channels the workspace's: one list at a time (lib/chat-scope.ts).
  const [scope, setScope] = useState<ChatScope>("messages");
  const filters = ROOM_LIST_FILTERS_BY_SCOPE[scope];
  const filter = filters.includes(chosenFilter) ? chosenFilter : "all";
  const [menuRow, setMenuRow] = useState<RoomListRow | null>(null);
  const [pulling, setPulling] = useState(false);

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
            typingByRoomId,
            isOnline: (userId) => Boolean(online[userId.trim().toUpperCase()]),
            t,
            locale: i18n.language,
          })
        : [],
    [chat, rooms.data, filterText, nicknames.data, members.data, pinnedByRoomId, typingByRoomId, online, t, i18n.language],
  );
  const scoped = useMemo(() => scopeRows(scope, rows), [rows, scope]);
  const shown = useMemo(() => filterRoomList(scoped, filter), [scoped, filter]);
  const mentionRooms = useMemo(() => filterRoomList(scoped, "mentions").length, [scoped]);
  // "Bắt kịp nhanh" sums the list's unread and opens the room holding the most of it (chat-sidebar-catch-up.tsx › pickQuickCatchUp).
  const quickCatchUp = useMemo(() => {
    let total = 0;
    let withUnread = 0;
    let top: RoomListRow | null = null;
    for (const row of scoped) {
      if (row.unread <= 0 || !row.roomId) continue;
      total += row.unread;
      withUnread += 1;
      if (!top || row.unread > top.unread) top = row;
    }
    return { total, rooms: withUnread, top };
  }, [scoped]);

  const open = useCallback(
    (row: RoomListRow) => {
      if (!chat) return;
      if (row.roomId) {
        router.push(chatRoutes.room(chat, row.roomId));
        return;
      }
      if (row.entry.kind !== "dm") return;
      resolveDMRoom(qc, chat.wsId, row.entry.contact.user_id)
        .then((room) => room && router.push(chatRoutes.room(chat, room.id)))
        .catch(() => Alert.alert(t("chat.dm_failed")));
    },
    [chat, qc, t],
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
        onPress: () => void setRoomMuted(qc, chat.wsId, roomId, !muted).catch(() => Alert.alert(t("common.error"))),
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
          className="mt-2.5 h-10"
        />
      </Header>
      {offline ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" className="flex-row items-center gap-2 bg-tint-yellow px-4 py-2">
          <Ionicons name="cloud-offline-outline" size={16} color={theme.tintYellowForeground} />
          <Text className="text-[13px] font-medium text-tint-yellow-foreground">{t("chat.mobile.offline_banner")}</Text>
        </View>
      ) : null}
      {!chat || rooms.isPending ? (
        <RoomListSkeleton />
      ) : rooms.isError && !rooms.data ? (
        <RoomListError onRetry={() => void rooms.refetch()} />
      ) : (
        <>
          <FilterChips value={filter} onChange={setFilter} mentionRooms={mentionRooms} total={scoped.length} filters={filters} />
          <FlatList
            data={shown}
            keyExtractor={(row) => row.key}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              quickCatchUp.top && filter === "all" && filterText.trim() === "" ? (
                <CatchUpBanner
                  total={quickCatchUp.total}
                  rooms={quickCatchUp.rooms}
                  onPress={() => quickCatchUp.top?.roomId && setCatchUp({ roomId: quickCatchUp.top.roomId, title: quickCatchUp.top.title, unread: quickCatchUp.top.unread })}
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
            renderItem={({ item }) => (
              <RoomRow
                title={item.title}
                mark={item.mark}
                seed={item.roomId ?? item.key}
                prefix={item.prefix}
                subtitle={item.subtitle}
                typing={item.typing}
                missed={item.missed}
                seen={item.seen}
                queued={item.roomId ? queuedRooms.has(item.roomId) : false}
                time={item.time}
                unread={item.unread}
                mentionUnread={item.mentionUnread}
                muted={item.muted}
                pinned={item.pinned}
                onPress={() => open(item)}
                onLongPress={() => setMenuRow(item)}
                testID={item.roomId ? `room-row-${item.roomId}` : undefined}
              />
            )}
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
