// A conversation's details (spec §2.4): its name, mute, search inside it
// (searchChatRoomMessages; a result opens the room at that message), its
// members, and leaving it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { ChatHeader } from "@/components/chat/chat-header";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { useRoomContext } from "@/components/chat/use-room-context";
import { Text } from "@/components/ui/text";
import { leaveRoom, setRoomMuted } from "@/data/chat-actions";
import { roomSearchOptions } from "@/data/queries/chat";
import { chatRoutes } from "@/lib/chat-routes";
import { messagePreviewText } from "@/lib/message-display";
import { senderLabelFor } from "@/lib/people-display";
import { THEME } from "@/lib/theme";
import { formatMessageDay, toTimelineMessage } from "@/lib/timeline-display";
import { useColorScheme } from "@/lib/use-color-scheme";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-1 pt-5">
      <Text className="px-4 pb-1 text-xs font-semibold uppercase text-muted-foreground" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function RoomInfo({ chat, roomId }: { chat: ChatWorkspace; roomId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const room = useRoomContext(chat, roomId);
  const [q, setQ] = useState("");
  const search = useQuery(roomSearchOptions(chat.wsId, roomId, q));
  const muted = room.room?.notifications_muted === true;
  const canLeave = room.room !== null && !isDefaultWorkspaceChannel(room.room);

  const leave = () =>
    Alert.alert(t("chat.leave_conversation_confirm_title"), room.room?.kind === "dm" ? t("chat.leave_conversation_confirm_description_dm") : t("chat.leave_conversation_confirm_description_group"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("chat.leave_conversation"),
        style: "destructive",
        onPress: () =>
          void leaveRoom(qc, chat.wsId, roomId)
            .then(() => router.dismissAll())
            .catch(() => Alert.alert(t("chat.leave_conversation_failed"))),
      },
    ]);

  return (
    <View className="flex-1 bg-background">
      <ChatHeader title={t("chat.mobile.room_info")} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="pb-10">
        <Text className="px-4 pt-5 text-2xl font-semibold text-foreground" accessibilityRole="header">
          {room.title}
        </Text>
        {room.room ? (
          <View className="mt-4 min-h-12 flex-row items-center justify-between px-4">
            <Text className="text-base text-foreground">{t("chat.settings_mute_notifications")}</Text>
            <Switch
              value={muted}
              accessibilityLabel={t("chat.settings_mute_notifications")}
              onValueChange={(next) => void setRoomMuted(qc, chat.wsId, roomId, next).catch(() => Alert.alert(t("common.error")))}
              trackColor={{ true: theme.primary }}
            />
          </View>
        ) : null}

        <Section title={t("chat.search_messages")}>
          <View className="px-4">
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={t("chat.search_messages_placeholder")}
              placeholderTextColor={theme.mutedForeground}
              accessibilityLabel={t("chat.search_messages")}
              autoCorrect={false}
              className="h-11 rounded-lg bg-secondary px-3 text-base text-foreground"
            />
          </View>
          {search.isFetching ? <ActivityIndicator className="py-3" accessibilityLabel={t("chat.search_loading")} /> : null}
          {q.trim().length >= 2 && search.data?.length === 0 ? (
            <Text className="px-4 py-3 text-sm text-muted-foreground">{t("chat.search_messages_no_results")}</Text>
          ) : null}
          {(search.data ?? []).map((record) => {
            const message = toTimelineMessage(record);
            return (
              <Pressable
                key={record.id}
                accessibilityRole="button"
                onPress={() => router.dismissTo(chatRoutes.room(chat, roomId, record.id))}
                className="min-h-14 justify-center gap-0.5 px-4 py-2 active:bg-secondary"
              >
                <Text className="text-xs text-muted-foreground">
                  {room.senderName(message)} · {formatMessageDay(message.ts, i18n.language, { today: t("chat.day_today"), yesterday: t("chat.sidebar_yesterday") })}
                </Text>
                <Text className="text-sm text-foreground" numberOfLines={2}>
                  {messagePreviewText(record, t)}
                </Text>
              </Pressable>
            );
          })}
        </Section>

        <Section title={t("chat.members_title")}>
          {room.members.map((member) => (
            <View key={member.user_id} className="min-h-12 justify-center px-4 py-1.5" accessible>
              <Text className="text-base text-foreground">{senderLabelFor({ sender: member.user_id }, chat.userId, t("chat.you"), room.nameContext)}</Text>
              {member.email ? <Text className="text-xs text-muted-foreground">{member.email}</Text> : null}
            </View>
          ))}
        </Section>

        {canLeave ? (
          <Pressable accessibilityRole="button" onPress={leave} className="mt-8 min-h-12 justify-center px-4 active:bg-secondary">
            <Text className="text-base text-destructive">{t("chat.leave_conversation")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default function RoomInfoScreen() {
  const chat = useChatWorkspace();
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {chat && roomId ? <RoomInfo chat={chat} roomId={roomId} /> : null}
    </>
  );
}
