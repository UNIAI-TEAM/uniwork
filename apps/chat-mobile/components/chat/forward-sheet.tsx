// "Chuyển tiếp" (MobileActions board): pick the conversation a message goes
// to, from the rooms list with a search box, as the web's chat-forward-dialog
// does (POST …/messages/{id}/forward). The target room hears its copy over
// realtime; nothing is written into a cache here. Every room of the workspace
// is a target, so the list recycles (FlashList, audit
// unvirtualized-secondary-lists): a few hundred rooms mount a screenful of
// memoized rows, each with its avatar, not all of them.
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useAfterDismiss } from "@/components/ui/action-sheet";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { useForwardMessage } from "@/data/mutations/messages";
import { nicknamesOptions, roomsOptions } from "@/data/queries/chat";
import { roomHeaderMark } from "@/lib/conversation-display";
import { roomTitle } from "@/lib/room-list";
import { foldedIncludes } from "@uniwork/core/chat/search-fold";
import { RoomAvatar } from "./room-avatar";
import type { ChatWorkspace } from "./use-chat-workspace";

interface ForwardRow {
  room: ChatRoomRecord;
  title: string;
}

const keyOf = (row: ForwardRow) => row.room.id;
// A search that still matches the room on top must not scroll the matches above it out of view.
const PINNED_TO_TOP = { disabled: true } as const;

/** One target: the room's avatar and name; memoized, so a keystroke in the search redraws only the rows it changes. */
const ForwardRoomRow = memo(function ForwardRoomRow({ room, title, onPick }: ForwardRow & { onPick: (roomId: string) => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => onPick(room.id)}
      className="min-h-14 flex-row items-center gap-3 px-5 active:bg-secondary"
    >
      <RoomAvatar mark={roomHeaderMark(room, title, false)} size={40} seed={room.id} />
      <Text className="flex-1 text-body text-foreground" numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
});

export function ForwardSheet({ chat, messageId, onClose }: { chat: ChatWorkspace; messageId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { choose, onDismiss } = useAfterDismiss(onClose);
  const [query, setQuery] = useState("");
  const forwardMessage = useForwardMessage(chat.wsId).mutateAsync;
  const rooms = useQuery({ ...roomsOptions(chat.wsId), enabled: messageId !== null });
  const nicknames = useQuery({ ...nicknamesOptions(chat.wsId), enabled: messageId !== null }).data;
  const rows = useMemo(() => {
    const titled = (rooms.data ?? []).map((room) => ({
      room,
      title: roomTitle(room, { nicknamesByUserId: nicknames ?? {}, workspaceName: chat.workspaceName, t }),
    }));
    const q = query.trim();
    return q ? titled.filter((row) => foldedIncludes(row.title, q)) : titled;
  }, [rooms.data, nicknames, chat.workspaceName, t, query]);

  // An Alert, not a toast: this sheet is a Modal, a native window above the
  // root view where components/ui/toast-host.tsx draws, so a toast would be hidden.
  const forward = (roomId: string) => {
    if (!messageId) return;
    void forwardMessage({ messageId, roomIds: [roomId] }).catch(() => Alert.alert(t("common.error")));
  };
  // One pick handler for every row (they are memoized); it reads this render's message and sheet.
  const latest = useRef({ choose, forward });
  useEffect(() => {
    latest.current = { choose, forward };
  });
  const onPick = useCallback((roomId: string) => latest.current.choose(() => latest.current.forward(roomId)), []);
  const renderItem: ListRenderItem<ForwardRow> = useCallback(
    ({ item }) => <ForwardRoomRow room={item.room} title={item.title} onPick={onPick} />,
    [onPick],
  );

  return (
    <BottomSheet
      visible={messageId !== null}
      onClose={onClose}
      onDismiss={onDismiss}
      dragFrom="handle"
      sizeClassName="h-[80%]"
      fill
      className="pb-2"
    >
      <Text accessibilityRole="header" className="px-5 pb-2 text-title3 font-display font-bold text-foreground">
        {t("chat.mobile.forward_pick_room")}
      </Text>
      <View className="px-4 pb-2">
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t("chat.mobile.search_placeholder")}
          accessibilityLabel={t("chat.search_conversations_label")}
        />
      </View>
      <View className="flex-1">
        <FlashList
          data={rows}
          keyExtractor={keyOf}
          renderItem={renderItem}
          maintainVisibleContentPosition={PINNED_TO_TOP}
          keyboardShouldPersistTaps="handled"
          testID="forward-targets"
        />
      </View>
    </BottomSheet>
  );
}
