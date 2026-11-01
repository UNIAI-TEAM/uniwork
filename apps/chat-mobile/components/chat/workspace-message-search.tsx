// Hits from every conversation in the open sidebar scope, under the chat
// tab's search. A tap opens that room at the message.
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { workspaceSearchOptions } from "@/data/queries/chat";
import type { ChatScope } from "@/lib/chat-scope";
import { messagePreviewText } from "@/lib/message-display";

export function WorkspaceMessageSearch({
  wsId,
  query,
  scope,
  rooms,
  onOpen,
}: {
  wsId: string;
  query: string;
  scope: ChatScope;
  rooms: readonly ChatRoomRecord[];
  onOpen: (roomId: string, messageId: string) => void;
}) {
  const { t } = useTranslation();
  const term = query.trim();
  const search = useQuery(workspaceSearchOptions(wsId, term, scope));
  if (term.length < 2) return null;
  const titleOf = (roomId: string) => rooms.find((room) => room.id === roomId)?.name ?? "";
  return (
    <View className="pb-2">
      <Text className="px-5 pb-1 pt-2 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
        {t("chat.sidebar_search_messages_title")}
      </Text>
      {search.isFetching ? <ActivityIndicator className="py-2" accessibilityLabel={t("chat.search_loading")} /> : null}
      {search.data?.length === 0 ? (
        <Text className="px-5 pb-2 text-callout text-muted-foreground">{t("chat.search_messages_no_results")}</Text>
      ) : null}
      {(search.data ?? []).map((record: ChatMessageRecord) => (
        <Pressable
          key={record.id}
          accessibilityRole="button"
          onPress={() => onOpen(record.room_id, record.id)}
          className="min-h-14 justify-center gap-0.5 px-5 py-2 active:bg-secondary"
        >
          <Text className="text-caption text-muted-foreground" numberOfLines={1}>
            {titleOf(record.room_id)}
          </Text>
          <Text className="text-callout text-foreground" numberOfLines={2}>
            {messagePreviewText(record, t)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
