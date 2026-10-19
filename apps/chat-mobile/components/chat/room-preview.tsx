// The conversation lifted above a list row's long-press menu (canvas MobStates,
// "menu phòng"): the row itself, then its latest messages on the chat wall, so
// the reader sees what they are about to pin or mute. Read-only: it never
// marks the room read.
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { chatApi } from "@/data/chat-api";
import { chatKeys } from "@/data/queries/chat-keys";
import { bubbleCorners } from "@/lib/conversation-display";
import { messagePreviewText } from "@/lib/message-display";
import { continuousCorners } from "@/lib/radius";
import type { RoomListRow } from "@/lib/room-list";
import { senderNameClass } from "@/lib/sender-colors";
import { cn } from "@/lib/utils";
import { RoomAvatar } from "./room-avatar";

const PREVIEW_MESSAGES = 4;

export function RoomPreview({ wsId, row, userId }: { wsId: string; row: RoomListRow; userId: string }) {
  const { t } = useTranslation();
  const roomId = row.roomId ?? "";
  const latest = useQuery({
    queryKey: [...chatKeys.roomMessagesRoot(wsId), "preview", roomId],
    queryFn: ({ signal }) => chatApi.listMessages(wsId, roomId, { limit: PREVIEW_MESSAGES, markRead: false }, signal),
    enabled: roomId !== "",
    staleTime: 10_000,
  }).data;
  const messages = [...(latest ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(-PREVIEW_MESSAGES);
  const group = row.mark.kind !== "dm";
  return (
    <View className="mx-4 overflow-hidden rounded-[22px] bg-background shadow-xl" style={continuousCorners} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View className="min-h-[68px] flex-row items-center gap-3 px-3.5">
        <RoomAvatar mark={row.mark} seed={row.roomId ?? row.key} size={46} />
        <Text className="flex-1 text-base font-display font-bold text-foreground" numberOfLines={1}>
          {row.title}
        </Text>
        {row.unread > 0 ? (
          <View className="h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary px-[7px]">
            <Text className="text-xs font-semibold text-primary-foreground">{row.unread > 99 ? "99+" : String(row.unread)}</Text>
          </View>
        ) : null}
      </View>
      <View className="max-h-[300px] gap-2 bg-chat-wall px-2.5 py-3">
        {row.unread > 0 ? (
          <View className="self-center rounded-xl bg-chat-chip px-3 py-[3px]">
            <Text className="text-[13px] font-semibold text-chat-chip-foreground">{t("chat.unread_count_chip", { count: row.unread })}</Text>
          </View>
        ) : null}
        {messages.map((message: ChatMessageRecord, index) => {
          const own = message.sender_id === userId;
          // A run of one sender is named once, as the conversation does.
          const named = group && !own && messages[index - 1]?.sender_id !== message.sender_id;
          return (
            <View
              key={message.id}
              className={cn("max-w-[82%] px-[11px] pb-[7px] pt-1.5", own ? "self-end bg-chat-bubble-own" : "self-start bg-chat-bubble-other")}
              style={bubbleCorners(own, true, true)}
            >
              {named ? (
                <Text className={cn("text-[13px] font-semibold", senderNameClass(message.sender_id))} numberOfLines={1}>
                  {message.sender_display_name}
                </Text>
              ) : null}
              <Text className={cn("text-[15px] leading-[21px]", own ? "text-chat-bubble-own-foreground" : "text-foreground")} numberOfLines={3}>
                {messagePreviewText(message, t)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
