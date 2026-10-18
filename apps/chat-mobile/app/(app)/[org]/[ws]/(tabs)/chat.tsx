// The Chat tab (spec §2.1, MobileList board): every conversation in one list,
// sorted and counted like the web's sidebar, with search, the filter chips,
// pin and mute on a long-press, the workspace pill (the workspace switch) and
// the compose button for a new DM or the channel directory. It is also where a deep link
// lands: `?room=` opens that room, with `&message=` jumping to the message,
// and `?dm=` opens (or creates) the DM with that person — the params
// lib/deep-link.ts › deepLinkHref writes.
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, Pressable, RefreshControl, View } from "react-native";
import { FilterChips, RoomListEmpty, RoomListError, RoomListSkeleton, WorkspacePill } from "@/components/chat/room-list-parts";
import { RoomRow } from "@/components/chat/room-row";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { Header } from "@/components/ui/header";
import { SearchField } from "@/components/ui/search-field";
import { callEngine } from "@/data/calls/call-store";
import { resolveDMRoom, setRoomMuted } from "@/data/chat-actions";
import { nicknamesOptions, roomsOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useChatPinsStore } from "@/data/stores/chat-pins-store";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import { chatRoutes } from "@/lib/chat-routes";
import { buildRoomList, filterRoomList, type RoomListFilter, type RoomListRow } from "@/lib/room-list";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

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
  const pinnedByRoomId = useChatPinsStore((s) => s.byRoomId);
  const typingByRoomId = useSidebarTypingStore((s) => s.byRoomId);
  const online = usePresenceStore((s) => s.onlineUserIds);
  const [filterText, setFilterText] = useState("");
  const [filter, setFilter] = useState<RoomListFilter>("all");
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
  const shown = useMemo(() => filterRoomList(rows, filter), [rows, filter]);
  const mentionRooms = useMemo(() => filterRoomList(rows, "mentions").length, [rows]);

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
      onPress: () => void useChatPinsStore.getState().toggle(roomId),
    });
    if (menuRow.room) {
      const muted = menuRow.muted;
      menuActions.push({
        key: "mute",
        label: muted ? t("chat.mobile.unmute_notifications") : t("chat.settings_mute_notifications"),
        onPress: () => void setRoomMuted(qc, chat.wsId, roomId, !muted).catch(() => Alert.alert(t("common.error"))),
      });
    }
  }

  const pill = chat ? (
    <WorkspacePill name={chat.workspaceName} iconUrl={workspace?.icon_url} iconEmoji={workspace?.icon_emoji} onPress={() => router.push("/select-workspace")} />
  ) : null;
  const newChat = chat ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("chat.new_conversation_aria")}
      className="h-11 w-11 items-center justify-center rounded-full bg-muted active:opacity-80"
      onPress={() => router.push(chatRoutes.newChat(chat))}
    >
      <Ionicons name="create-outline" size={21} color={theme.primary} />
    </Pressable>
  ) : null;

  return (
    <View className="flex-1 bg-background">
      <Header large title={t("nav.chat")} left={pill} right={newChat}>
        <SearchField
          value={filterText}
          onChangeText={setFilterText}
          placeholder={t("chat.search_conversations")}
          accessibilityLabel={t("chat.search_conversations_label")}
          className="mt-2.5 h-10"
        />
      </Header>
      {!chat || rooms.isPending ? (
        <RoomListSkeleton />
      ) : rooms.isError && !rooms.data ? (
        <RoomListError onRetry={() => void rooms.refetch()} />
      ) : (
        <>
          <FilterChips value={filter} onChange={setFilter} mentionRooms={mentionRooms} />
          <FlatList
            data={shown}
            keyExtractor={(row) => row.key}
            keyboardShouldPersistTaps="handled"
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
                subtitle={item.subtitle}
                typing={item.typing}
                time={item.time}
                unread={item.unread}
                mentionUnread={item.mentionUnread}
                muted={item.muted}
                pinned={item.pinned}
                onPress={() => open(item)}
                onLongPress={() => setMenuRow(item)}
              />
            )}
          />
        </>
      )}
      <ActionSheet visible={menuRow !== null && menuActions.length > 0} onClose={() => setMenuRow(null)} title={menuRow?.title} actions={menuActions} />
    </View>
  );
}
