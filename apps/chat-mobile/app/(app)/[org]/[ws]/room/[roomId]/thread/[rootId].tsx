// A thread (spec §2.3): its root, then the replies (listChatThreadMessages),
// older pages chained from the oldest reply; replies go out with
// sendChatThreadMessage, and opening it marks the thread read.
import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { ChatHeader } from "@/components/chat/chat-header";
import { Conversation } from "@/components/chat/conversation";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { useActiveRoom } from "@/components/chat/use-read-marking";
import { useRoomContext } from "@/components/chat/use-room-context";
import { useMarkThreadRead } from "@/data/mutations/rooms";
import { bestEffort } from "@/data/report";
import { threadTimelineOptions } from "@/data/queries/chat";
import { selectRoomSends, useChatSendStore } from "@/data/stores/chat-send-store";
import { selectRoomOps, usePendingOpsStore } from "@/data/stores/pending-ops-store";
import { overlayPendingOps } from "@/lib/pending-ops-overlay";
import { THEME } from "@/lib/theme";
import { buildThreadViewMessages } from "@/lib/timeline-display";
import { useColorScheme } from "@/components/ui/use-color-scheme";

function ThreadConversation({ chat, roomId, rootId }: { chat: ChatWorkspace; roomId: string; rootId: string }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const markThreadRead = useMarkThreadRead(chat.wsId).mutateAsync;
  const room = useRoomContext(chat, roomId);
  const [atLatest, setAtLatest] = useState(true);
  const thread = useInfiniteQuery(threadTimelineOptions(chat.wsId, roomId, rootId));
  const sends = useChatSendStore(useShallow((s) => selectRoomSends(s.entries, chat.wsId, roomId, chat.userId)));
  const ops = usePendingOpsStore(useShallow((s) => selectRoomOps(s.ops, chat.wsId, roomId, chat.userId)));
  const rows = useMemo(() => overlayPendingOps(thread.data ?? [], ops, chat.userId), [thread.data, ops, chat.userId]);
  const root = rows.find((m) => m.id === rootId);
  const messages = useMemo(
    () =>
      root
        ? buildThreadViewMessages({ threadRoot: root, threadRows: rows.filter((m) => m.id !== rootId), pending: sends, currentUserId: chat.userId })
        : [],
    [root, rows, rootId, sends, chat.userId],
  );

  const onFocus = useCallback(() => {
    // The mutation layer reports a failure (data/query-errors.ts); a thread left unread only says so.
    void markThreadRead(rootId).catch(bestEffort("chat", "thread read not marked", "breadcrumb"));
  }, [markThreadRead, rootId]);
  useActiveRoom(roomId, onFocus);

  return (
    <Conversation
      chat={chat}
      roomId={roomId}
      threadRootId={rootId}
      room={room}
      header={
        <ChatHeader
          title={t("chat.thread_title")}
          subtitle={room.title}
          backLabel={t("chat.mobile.back_to_conversation")}
          avatar={
            <View className="h-10 w-10 items-center justify-center rounded-[13px] bg-tint-blue">
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={THEME[colorScheme].tintBlueForeground} />
            </View>
          }
        />
      }
      messages={messages}
      loading={thread.isPending}
      onRetryLoad={thread.isError && !thread.data ? () => void thread.refetch() : undefined}
      loadingOlder={thread.isFetchingNextPage}
      onLoadOlder={!thread.hasNextPage || thread.isFetchingNextPage ? undefined : () => void thread.fetchNextPage()}
      onRetryOlder={thread.isFetchNextPageError ? () => void thread.fetchNextPage() : undefined}
      jumpTo={null}
      onQuoteJump={() => undefined}
      atLatest={atLatest}
      onAtLatestChange={setAtLatest}
    />
  );
}

export default function ThreadScreen() {
  const chat = useChatWorkspace();
  const { roomId, rootId } = useLocalSearchParams<{ roomId: string; rootId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {chat && roomId && rootId ? <ThreadConversation chat={chat} roomId={roomId} rootId={rootId} /> : null}
    </>
  );
}
