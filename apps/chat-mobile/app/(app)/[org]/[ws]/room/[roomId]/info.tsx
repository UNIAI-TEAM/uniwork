// A conversation's details (spec §2.4, MobRoomInfo board): who it is; mute,
// search, call and (a group) add people as round quick actions; search inside
// it (searchChatRoomMessages; a result opens the room at that message); what it
// has shared (GET …/shared-summary: counts per kind, the newest photos); its
// pins, notes and polls; its members with presence; and leaving it.
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, useWindowDimensions, View } from "react-native";
import { ChatHeader } from "@/components/chat/chat-header";
import { RoomAvatar } from "@/components/chat/room-avatar";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { useRoomContext } from "@/components/chat/use-room-context";
import { PersonAvatar } from "@/components/people/person-avatar";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { callEngine } from "@/data/calls/call-store";
import { leaveRoom, setRoomMuted } from "@/data/chat-actions";
import type { ChatSharedSummary } from "@/data/chat-api";
import type { RoomTimeline } from "@/data/chat-timeline";
import { roomSearchOptions, roomTimelineOptions, sharedSummaryOptions } from "@/data/queries/chat";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { chatRoutes } from "@/lib/chat-routes";
import { messagePreviewText } from "@/lib/message-display";
import { senderLabelFor } from "@/lib/people-display";
import type { RoomMark } from "@/lib/room-list";
import { THEME } from "@/lib/theme";
import { formatMessageDay, toTimelineMessage } from "@/lib/timeline-display";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";
import { voiceCallKindFromServer } from "@/lib/voice-call";

/** Members shown before "Xem tất cả" (the board lists four). */
const MEMBERS_PREVIEW = 5;
/** Photo tiles in the shared grid; the last one says how many more there are. */
const PHOTO_TILES = 6;

type SharedTab = "photo" | "file" | "link" | "voice";

function markFor(room: ChatRoomRecord | null, title: string, online: boolean): RoomMark {
  if (room?.kind === "dm") return { kind: "dm", label: title, online, userId: room.peer_user_id };
  if (room && (room.kind === "workspace" || isDefaultWorkspaceChannel(room))) return { kind: "workspace" };
  if (room?.kind === "channel") return { kind: room.visibility === "private" ? "private-channel" : "channel" };
  return { kind: "group", label: title };
}

function QuickAction(props: { icon: ComponentProps<typeof Ionicons>["name"]; label: string; accessibilityLabel?: string; onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      onPress={props.onPress}
      className="w-[84px] items-center gap-1.5 active:opacity-70"
    >
      <View className="h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Ionicons name={props.icon} size={22} color={THEME[colorScheme].primary} />
      </View>
      <Text className="text-center text-xs font-semibold text-foreground" numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const Divider = () => <View className="h-2 bg-muted" />;

function SharedSection({ shared, onOpenMessage }: { shared: ChatSharedSummary; onOpenMessage: (messageId: string) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SharedTab>("photo");
  // Three tiles to a row across the 20 pt margins, 4 pt apart.
  const tile = Math.floor((useWindowDimensions().width - 40 - 8) / 3);
  const counts: Record<SharedTab, number> = {
    photo: shared.counts.photo + shared.counts.gif + shared.counts.video,
    file: shared.counts.file,
    link: shared.counts.link,
    voice: shared.counts.voice,
  };
  const tabs: { key: SharedTab; label: string }[] = [
    { key: "photo", label: t("chat.mobile.tab_photos", { count: counts.photo }) },
    { key: "file", label: t("chat.mobile.tab_files", { count: counts.file }) },
    { key: "link", label: t("chat.mobile.tab_links", { count: counts.link }) },
    { key: "voice", label: t("chat.mobile.tab_voice", { count: counts.voice }) },
  ];
  const photos = shared.recent_photos.slice(0, PHOTO_TILES);
  const more = counts.photo - (photos.length - 1);
  return (
    <View className="pb-3.5 pt-3.5" accessibilityLabel={t("chat.mobile.shared_title")}>
      <Text className="mb-2 px-5 text-[13px] font-semibold text-muted-foreground" accessibilityRole="header">
        {t("chat.mobile.shared_title")}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="grow-0" contentContainerClassName="gap-1.5 px-5 pb-2.5" accessibilityRole="tablist" accessibilityLabel={t("chat.mobile.shared_kinds_aria")}>
        {tabs.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(item.key)}
              className={cn("h-8 justify-center rounded-full px-3", active ? "bg-tint-blue" : "active:bg-secondary")}
            >
              <Text className={cn("text-[13px] font-semibold", active ? "text-primary" : "text-muted-foreground")} style={{ fontVariant: ["tabular-nums"] }}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {tab === "photo" && photos.length > 0 ? (
        <View className="flex-row flex-wrap gap-1 px-5">
          {photos.map((photo, index) => {
            const last = index === photos.length - 1 && counts.photo > photos.length;
            return (
              <Pressable
                key={photo.message_id}
                accessibilityRole="imagebutton"
                accessibilityLabel={last ? t("chat.mobile.shared_more_photos", { count: counts.photo }) : photo.title || t("chat.media_image")}
                onPress={() => onOpenMessage(photo.message_id)}
                className="overflow-hidden rounded-[10px] bg-muted"
                style={{ width: tile, height: tile }}
              >
                {photo.thumb_url || photo.url ? <Image source={{ uri: photo.thumb_url ?? photo.url }} contentFit="cover" style={{ width: "100%", height: "100%" }} /> : null}
                {last ? (
                  <View className="absolute inset-0 items-center justify-center bg-black/45">
                    <Text className="text-lg font-display font-bold text-on-solid">+{more}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text className="px-5 py-2 text-sm text-muted-foreground">{t("chat.mobile.shared_tab_hint", { count: counts[tab] })}</Text>
      )}
    </View>
  );
}

function RoomInfo({ chat, roomId }: { chat: ChatWorkspace; roomId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const room = useRoomContext(chat, roomId);
  const online = usePresenceStore((s) => s.onlineUserIds);
  const searchInput = useRef<TextInput>(null);
  const [q, setQ] = useState("");
  const [allMembers, setAllMembers] = useState(false);
  const search = useQuery(roomSearchOptions(chat.wsId, roomId, q));
  const shared = useQuery(sharedSummaryOptions(chat.wsId, roomId)).data;
  const muted = room.room?.notifications_muted === true;
  const canLeave = room.room !== null && !isDefaultWorkspaceChannel(room.room);
  const callable = room.room !== null && ["dm", "group", "channel"].includes(room.room.kind) && !isDefaultWorkspaceChannel(room.room);
  const isGroup = room.room?.kind === "group";
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
  // Pins, notes and polls among the messages the room already loaded; the row opens the room, where the pinned bar is.
  const loaded = qc.getQueryData<RoomTimeline>(roomTimelineOptions(chat.wsId, roomId).queryKey);
  const kept = useMemo(() => {
    const rows = (loaded?.pages ?? []).flat();
    return { pins: rows.filter((m) => m.pinned).length, notes: rows.filter((m) => m.kind === "note").length, polls: rows.filter((m) => m.kind === "poll").length };
  }, [loaded]);
  const members = allMembers ? room.members : room.members.slice(0, MEMBERS_PREVIEW);

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
      <ChatHeader title={t("chat.mobile.room_info")} centered flat />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="pb-10">
        <View className="items-center px-5 pb-5 pt-3">
          <RoomAvatar mark={markFor(room.room, room.title, room.peerOnline)} size={84} seed={roomId} />
          <Text className="mt-3 text-center text-[22px] font-display font-extrabold leading-7 text-foreground" accessibilityRole="header">
            {room.title}
          </Text>
          {heroLine ? <Text className="mt-0.5 text-sm text-muted-foreground">{heroLine}</Text> : null}
        </View>

        {room.room ? (
          <View className="flex-row justify-center gap-1 px-2 pb-4">
            <QuickAction
              icon={muted ? "notifications-outline" : "notifications-off-outline"}
              label={muted ? t("chat.mobile.unmute_notifications") : t("chat.settings_mute_notifications")}
              onPress={() => void setRoomMuted(qc, chat.wsId, roomId, !muted).catch(() => Alert.alert(t("common.error")))}
            />
            <QuickAction icon="search" label={t("chat.mobile.search_short")} accessibilityLabel={t("chat.search_messages")} onPress={() => searchInput.current?.focus()} />
            {callable ? (
              <QuickAction
                icon="call-outline"
                label={t("chat.mobile.call_short")}
                accessibilityLabel={t("chat.voice_call_start")}
                onPress={() => void callEngine.startCall(roomId, room.title, voiceCallKindFromServer(room.room?.kind), { withCamera: false })}
              />
            ) : null}
            {isGroup ? <QuickAction icon="person-add-outline" label={t("chat.add_to_group")} accessibilityLabel={t("chat.add_group_members")} onPress={() => router.push(chatRoutes.newGroup(chat, roomId))} /> : null}
          </View>
        ) : null}

        <View className="px-5 pb-3.5">
          <SearchField
            ref={searchInput}
            value={q}
            onChangeText={setQ}
            placeholder={t("chat.search_messages")}
            accessibilityLabel={t("chat.search_messages")}
            className="h-10"
          />
        </View>
        {search.isFetching ? <ActivityIndicator className="py-3" accessibilityLabel={t("chat.search_loading")} /> : null}
        {q.trim().length >= 2 && search.data?.length === 0 ? <Text className="px-5 pb-3 text-sm text-muted-foreground">{t("chat.search_messages_no_results")}</Text> : null}
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

        <Divider />
        {shared ? <SharedSection shared={shared} onOpenMessage={(messageId) => router.dismissTo(chatRoutes.room(chat, roomId, messageId))} /> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.dismissTo(chatRoutes.room(chat, roomId))}
          className="min-h-[60px] flex-row items-center gap-3 border-t-hairline border-border px-5 active:bg-secondary"
        >
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-tint-yellow">
            <Ionicons name="pin-outline" size={20} color={theme.tintYellowForeground} />
          </View>
          <View className="flex-1">
            <Text className="text-[15px] font-semibold text-foreground">{t("chat.mobile.shared_notes_row")}</Text>
            <Text className="text-[13px] text-muted-foreground">{t("chat.mobile.shared_notes_counts", kept)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
        </Pressable>

        <Divider />
        <View className="px-5 pb-2 pt-3.5">
          <View className="mb-1 flex-row items-center">
            <Text className="flex-1 text-[13px] font-semibold text-muted-foreground" accessibilityRole="header">
              {room.members.length > 0 ? `${t("chat.members_title")} · ${room.members.length}` : t("chat.members_title")}
            </Text>
            {room.members.length > MEMBERS_PREVIEW && !allMembers ? (
              <Pressable accessibilityRole="button" onPress={() => setAllMembers(true)} hitSlop={10} className="min-h-11 justify-center">
                <Text className="text-[13px] font-semibold text-primary">{t("chat.mobile.see_all")}</Text>
              </Pressable>
            ) : null}
          </View>
          {members.map((member, index) => {
            const name = senderLabelFor({ sender: member.user_id }, chat.userId, t("chat.you"), room.nameContext);
            const memberOnline = isOnline(member.user_id);
            const status = memberOnline ? t("chat.presence_online") : member.email;
            const role = member.role === "admin" ? t("chat.mobile.room_role_admin_short") : null;
            return (
              <View key={member.user_id} accessible accessibilityLabel={[name, status, role].filter(Boolean).join(", ")} className="min-h-14 flex-row items-center gap-3">
                <PersonAvatar name={name} size={40} online={memberOnline} seed={member.user_id} />
                <View className={cn("min-w-0 flex-1 flex-row items-center gap-2 self-stretch py-1.5", index < members.length - 1 && "border-b-hairline border-border")}>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
                      {name}
                    </Text>
                    {status ? (
                      <Text className={cn("text-[13px]", memberOnline ? "text-success-solid" : "text-muted-foreground")} numberOfLines={1}>
                        {status}
                      </Text>
                    ) : null}
                  </View>
                  {role ? (
                    <View className="h-6 justify-center rounded-full bg-tint-blue px-2.5">
                      <Text className="text-xs font-semibold text-primary">{role}</Text>
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
