// What a search inside a conversation found (searchChatRoomMessages): a
// spinner while it asks, "no results" once a query of two letters or more
// found none, and each hit with its sender and day; a tap opens the room at
// that message. Moved out of the route file, which only composes.
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable } from "react-native";
import { Text } from "@/components/ui/text";
import { messagePreviewText } from "@/lib/message-display";
import { formatMessageDay, toTimelineMessage, type TimelineMessage } from "@/lib/timeline-display";

export function RoomSearchResults(props: {
  query: string;
  fetching: boolean;
  results: readonly ChatMessageRecord[] | undefined;
  senderName: (message: TimelineMessage) => string;
  onOpen: (messageId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {props.fetching ? <ActivityIndicator className="py-3" accessibilityLabel={t("chat.search_loading")} /> : null}
      {props.query.trim().length >= 2 && props.results?.length === 0 ? (
        <Text className="px-5 pb-3 text-callout text-muted-foreground">{t("chat.search_messages_no_results")}</Text>
      ) : null}
      {(props.results ?? []).map((record) => {
        const message = toTimelineMessage(record);
        return (
          <Pressable
            key={record.id}
            accessibilityRole="button"
            onPress={() => props.onOpen(record.id)}
            className="min-h-14 justify-center gap-0.5 px-5 py-2 active:bg-secondary"
          >
            <Text className="text-caption text-muted-foreground">
              {props.senderName(message)} ·{" "}
              {formatMessageDay(message.ts, i18n.language, { today: t("chat.day_today"), yesterday: t("chat.sidebar_yesterday") })}
            </Text>
            <Text className="text-callout text-foreground" numberOfLines={2}>
              {messagePreviewText(record, t)}
            </Text>
          </Pressable>
        );
      })}
    </>
  );
}
