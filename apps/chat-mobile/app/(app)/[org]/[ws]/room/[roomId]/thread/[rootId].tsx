// A thread (spec §2.3): its root, then the replies (listChatThreadMessages),
// older pages chained from the oldest reply; replies go out with
// sendChatThreadMessage, and opening it marks the thread read.
import { useInfiniteQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ChatHeader } from "@/components/chat/chat-header";
import { Conversation } from "@/components/chat/conversation";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { useActiveRoom } from "@/components/chat/use-read-marking";
import { useRoomContext } from "@/components/chat/use-room-context";
import { markThreadRead } from "@/data/chat-actions";
import { threadTimelineOptions } from "@/data/queries/chat";
import { selectRoomSends, useChatSendStore } from "@/data/stores/chat-send-store";
import { buildThreadViewMessages } from "@/lib/timeline-display";

function ThreadConversation({ chat, roomId, rootId }: { chat: ChatWorkspace; roomId: string; rootId: string }) {
  const { t } = useTranslation();
  const room = useRoomContext(chat, roomId);
  const thread = useInfiniteQuery(threadTimelineOptions(chat.wsId, roomId, rootId));
  const sends = useChatSendStore(useShallow((s) => selectRoomSends(s.entries, chat.wsId, roomId)));
  const rows = useMemo(() => thread.data ?? [], [thread.data]);
  const root = rows.find((m) => m.id === rootId);
  const messages = useMemo(
    () =>
      root
        ? buildThreadViewMessages({ threadRoot: root, threadRows: rows.filter((m) => m.id !== rootId), pending: sends, currentUserId: chat.userId })
        : [],
    [root, rows, rootId, sends, chat.userId],
  );

  const onFocus = useCallback(() => {
    void markThreadRead(chat.wsId, rootId).catch(() => undefined);
  }, [chat.wsId, rootId]);
  useActiveRoom(roomId, onFocus);

  return (
    <Conversation
      chat={chat}
      roomId={roomId}
      threadRootId={rootId}
      room={room}
      header={<ChatHeader title={t("chat.thread_title")} subtitle={room.title} />}
      messages={messages}
      loading={thread.isPending}
      loadingOlder={thread.isFetchingNextPage}
      onLoadOlder={!thread.hasNextPage || thread.isFetchingNextPage ? undefined : () => void thread.fetchNextPage()}
      jumpTo={null}
      onQuoteJump={() => undefined}
      onAtLatestChange={() => undefined}
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
