// A conversation's details (spec §2.4, MobRoomInfo board): who it is, mute
// and search as round quick actions, search inside it (searchChatRoomMessages;
// a result opens the room at that message), its members with presence, and
// leaving it.
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { ChatHeader } from "@/components/chat/chat-header";
import { RoomAvatar } from "@/components/chat/room-avatar";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { useRoomContext } from "@/components/chat/use-room-context";
import { PersonAvatar } from "@/components/people/person-avatar";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { leaveRoom, setRoomMuted } from "@/data/chat-actions";
import { roomSearchOptions } from "@/data/queries/chat";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { chatRoutes } from "@/lib/chat-routes";
import { messagePreviewText } from "@/lib/message-display";
import { senderLabelFor } from "@/lib/people-display";
import type { RoomMark } from "@/lib/room-list";
import { THEME } from "@/lib/theme";
import { formatMessageDay, toTimelineMessage } from "@/lib/timeline-display";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

function markFor(room: ChatRoomRecord | null, title: string, online: boolean): RoomMark {
  if (room?.kind === "dm") return { kind: "dm", label: title, online };
  if (room && (room.kind === "workspace" || isDefaultWorkspaceChannel(room))) return { kind: "workspace" };
  if (room?.kind === "channel") return { kind: room.visibility === "private" ? "private-channel" : "channel" };
  return { kind: "group" };
}

function QuickAction(props: { icon: ComponentProps<typeof Ionicons>["name"]; label: string; accessibilityLabel?: string; onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      onPress={props.onPress}
      className="w-20 items-center gap-1.5 active:opacity-70"
    >
      <View className="h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Ionicons name={props.icon} size={22} color={THEME[colorScheme].primary} />
      </View>
      <Text className="text-center text-xs font-semibold text-foreground" numberOfLines={2}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const Divider = () => <View className="h-2 bg-muted" />;

function RoomInfo({ chat, roomId }: { chat: ChatWorkspace; roomId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const room = useRoomContext(chat, roomId);
  const online = usePresenceStore((s) => s.onlineUserIds);
  const searchInput = useRef<TextInput>(null);
  const [q, setQ] = useState("");
  const search = useQuery(roomSearchOptions(chat.wsId, roomId, q));
  const muted = room.room?.notifications_muted === true;
  const canLeave = room.room !== null && !isDefaultWorkspaceChannel(room.room);
  const isOnline = (userId: string) => Boolean(online[userId.trim().toUpperCase()]);
  const memberCount = room.members.length || (room.room?.member_count ?? 0);
  const heroLine =
    room.room?.kind === "dm"
      ? room.peerOnline
        ? t("chat.presence_online")
        : null
      : memberCount > 0
        ? t("chat.group_member_count", { count: memberCount })
        : null;

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
        <View className="items-center px-5 pb-5 pt-3">
          <RoomAvatar mark={markFor(room.room, room.title, room.peerOnline)} size={84} seed={roomId} />
          <Text className="mt-3 text-center text-[22px] font-extrabold leading-7 text-foreground" accessibilityRole="header">
            {room.title}
          </Text>
          {heroLine ? <Text className="mt-0.5 text-sm text-muted-foreground">{heroLine}</Text> : null}
        </View>

        {room.room ? (
          <View className="flex-row justify-center gap-6 px-3 pb-5">
            <QuickAction
              icon={muted ? "notifications-outline" : "notifications-off-outline"}
              label={muted ? t("chat.mobile.unmute_notifications") : t("chat.settings_mute_notifications")}
              onPress={() => void setRoomMuted(qc, chat.wsId, roomId, !muted).catch(() => Alert.alert(t("common.error")))}
            />
            <QuickAction icon="search" label={t("chat.search_conversations")} accessibilityLabel={t("chat.search_messages")} onPress={() => searchInput.current?.focus()} />
          </View>
        ) : null}

        <Divider />
        <View className="pb-2 pt-3.5">
          <Text className="mb-2 px-5 text-[13px] font-semibold text-muted-foreground">{t("chat.search_messages")}</Text>
          <View className="px-5">
            <SearchField
              ref={searchInput}
              value={q}
              onChangeText={setQ}
              placeholder={t("chat.search_messages_placeholder")}
              accessibilityLabel={t("chat.search_messages")}
              className="border border-border"
            />
          </View>
          {search.isFetching ? <ActivityIndicator className="py-3" accessibilityLabel={t("chat.search_loading")} /> : null}
          {q.trim().length >= 2 && search.data?.length === 0 ? (
            <Text className="px-5 py-3 text-sm text-muted-foreground">{t("chat.search_messages_no_results")}</Text>
          ) : null}
          {(search.data ?? []).map((record) => {
            const message = toTimelineMessage(record);
            return (
              <Pressable
                key={record.id}
                accessibilityRole="button"
                onPress={() => router.dismissTo(chatRoutes.room(chat, roomId, record.id))}
                className="min-h-14 justify-center gap-0.5 px-5 py-2 active:bg-secondary"
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
        </View>

        <Divider />
        <View className="px-5 pb-2 pt-3.5">
          <Text className="mb-1 text-[13px] font-semibold text-muted-foreground" accessibilityRole="header">
            {room.members.length > 0 ? `${t("chat.members_title")} · ${room.members.length}` : t("chat.members_title")}
          </Text>
          {room.members.map((member, index) => {
            const name = senderLabelFor({ sender: member.user_id }, chat.userId, t("chat.you"), room.nameContext);
            const memberOnline = isOnline(member.user_id);
            const status = memberOnline ? t("chat.presence_online") : member.email;
            const role = member.role === "admin" ? t("chat.room_role_admin") : null;
            return (
              <View
                key={member.user_id}
                accessible
                accessibilityLabel={[name, status, role].filter(Boolean).join(", ")}
                className="min-h-14 flex-row items-center gap-3"
              >
                <PersonAvatar name={name} size={40} online={memberOnline} />
                <View
                  className={cn(
                    "min-w-0 flex-1 flex-row items-center gap-2 self-stretch py-1.5",
                    index < room.members.length - 1 && "border-b-hairline border-border",
                  )}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
                      {name}
                    </Text>
                    {status ? (
                      <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>
                        {status}
                      </Text>
                    ) : null}
                  </View>
                  {role ? (
                    <View className="h-6 justify-center rounded-full bg-muted px-2.5">
                      <Text className="text-xs font-semibold text-foreground">{role}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        {canLeave ? (
          <>
            <Divider />
            <Pressable accessibilityRole="button" onPress={leave} className="min-h-14 flex-row items-center gap-3 px-5 active:bg-secondary">
              <Ionicons name="exit-outline" size={22} color={theme.destructive} />
              <Text className="text-base font-semibold text-destructive">{t("chat.leave_conversation")}</Text>
            </Pressable>
          </>
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
