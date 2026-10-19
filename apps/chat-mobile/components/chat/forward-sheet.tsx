// "Chuyển tiếp" (MobileActions board): pick the conversation a message goes
// to, from the rooms list with a search box, as the web's chat-forward-dialog
// does (POST …/messages/{id}/forward). The target room hears its copy over
// realtime; nothing is written into a cache here.
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SheetGrabber, useAfterDismiss } from "@/components/ui/action-sheet";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { chatApi } from "@/data/chat-api";
import { nicknamesOptions, roomsOptions } from "@/data/queries/chat";
import { roomHeaderMark } from "@/lib/conversation-display";
import { continuousCorners } from "@/lib/radius";
import { roomTitle } from "@/lib/room-list";
import { foldedIncludes } from "@/lib/search-fold";
import { RoomAvatar } from "./room-avatar";
import type { ChatWorkspace } from "./use-chat-workspace";

export function ForwardSheet({ chat, messageId, onClose }: { chat: ChatWorkspace; messageId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { choose, onDismiss } = useAfterDismiss(onClose);
  const [query, setQuery] = useState("");
  const rooms = useQuery({ ...roomsOptions(chat.wsId), enabled: messageId !== null });
  const nicknames = useQuery({ ...nicknamesOptions(chat.wsId), enabled: messageId !== null }).data;
  const rows = useMemo(() => {
    const titled = (rooms.data ?? []).map((room) => ({ room, title: roomTitle(room, { nicknamesByUserId: nicknames ?? {}, workspaceName: chat.workspaceName, t }) }));
    const q = query.trim();
    return q ? titled.filter((row) => foldedIncludes(row.title, q)) : titled;
  }, [rooms.data, nicknames, chat.workspaceName, t, query]);

  const forward = (roomId: string) => {
    if (!messageId) return;
    void chatApi
      .forwardMessage(chat.wsId, messageId, [roomId])
      .then((count) => {
        if (count === 0) Alert.alert(t("common.error"));
      })
      .catch(() => Alert.alert(t("common.error")));
  };

  return (
    <Modal visible={messageId !== null} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismiss}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <SafeAreaView edges={["bottom"]} className="max-h-[80%] rounded-t-[24px] bg-card pb-2" style={continuousCorners} accessibilityViewIsModal>
        <SheetGrabber />
        <Text accessibilityRole="header" className="px-5 pb-2 text-lg font-display font-bold text-foreground">
          {t("chat.mobile.forward_pick_room")}
        </Text>
        <View className="px-4 pb-2">
          <SearchField value={query} onChangeText={setQuery} placeholder={t("chat.mobile.search_placeholder")} accessibilityLabel={t("chat.search_conversations_label")} className="h-10" />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {rows.map(({ room, title }) => (
            <Pressable
              key={room.id}
              accessibilityRole="button"
              accessibilityLabel={title}
              onPress={() => choose(() => forward(room.id))}
              className="min-h-14 flex-row items-center gap-3 px-5 active:bg-secondary"
            >
              <RoomAvatar mark={roomHeaderMark(room, title, false)} size={40} seed={room.id} />
              <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
                {title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
