// The top of a conversation's details (MobRoomInfo board): its face, its name,
// and one line under it — a DM's peer online, or a room's member count — and
// the round quick actions: mute, search, call (while calling is on and the
// room can be called) and, for a group, add people. Moved out of the route
// file, which only composes.
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { RoomAvatar } from "@/components/chat/room-avatar";
import { Text } from "@/components/ui/text";
import { roomHeaderMark } from "@/lib/conversation-display";
import { QuickAction } from "./quick-action";

export function RoomInfoHero({ room, roomId, title, peerOnline, memberCount }: { room: ChatRoomRecord | null; roomId: string; title: string; peerOnline: boolean; memberCount: number }) {
  const { t } = useTranslation();
  const line =
    room?.kind === "dm" ? (peerOnline ? t("chat.presence_online") : null) : memberCount > 0 ? t("chat.group_member_count", { count: memberCount }) : null;
  return (
    <View className="items-center px-5 pb-5 pt-3">
      <RoomAvatar mark={roomHeaderMark(room, title, peerOnline)} size={84} seed={roomId} />
      <Text className="mt-3 text-center text-title1 font-display font-extrabold leading-7 text-foreground" accessibilityRole="header">
        {title}
      </Text>
      {line ? <Text className="mt-0.5 text-callout text-muted-foreground">{line}</Text> : null}
    </View>
  );
}

export function RoomQuickActions(props: {
  muted: boolean;
  callable: boolean;
  isGroup: boolean;
  onToggleMute: () => void;
  onSearch: () => void;
  onCall: () => void;
  onAddPeople: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row justify-center gap-1 px-2 pb-4">
      <QuickAction
        icon={props.muted ? "notifications-outline" : "notifications-off-outline"}
        label={props.muted ? t("chat.mobile.unmute_notifications") : t("chat.settings_mute_notifications")}
        onPress={props.onToggleMute}
      />
      <QuickAction icon="search" label={t("chat.mobile.search_short")} accessibilityLabel={t("chat.search_messages")} onPress={props.onSearch} />
      {props.callable ? <QuickAction icon="call-outline" label={t("chat.mobile.call_short")} accessibilityLabel={t("chat.voice_call_start")} onPress={props.onCall} /> : null}
      {props.isGroup ? <QuickAction icon="person-add-outline" label={t("chat.add_to_group")} accessibilityLabel={t("chat.add_group_members")} onPress={props.onAddPeople} /> : null}
    </View>
  );
}
