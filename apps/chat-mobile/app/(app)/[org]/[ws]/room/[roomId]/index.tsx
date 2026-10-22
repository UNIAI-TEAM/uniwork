// A conversation (spec §2.2). The newest page loads first and older pages
// chain by cursor as the reader scrolls up; `?message=` (a deep link, a
// search result) or a tap on a quote outside the loaded window shows the page
// around that message instead (listChatRoomMessagesAround), with a way back
// to the latest. Local sends join the timeline until the server echoes them.
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { HeaderIconButton } from "@/components/chat/chat-header";
import { Conversation } from "@/components/chat/conversation";
import { RoomAvatar } from "@/components/chat/room-avatar";
import { ensureCallPermissions } from "@/components/ui/permission-gate";
import { DmBlockBanner } from "@/components/chat/room-safety";
import { RoomChatHeader } from "@/components/chat/room-typing";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { useRoomReadMarking } from "@/components/chat/use-read-marking";
import { useRoomContext } from "@/components/chat/use-room-context";
import { useTimelineWindow } from "@/components/chat/use-timeline-window";
import { useUnreadBackfill } from "@/components/chat/use-unread-backfill";
import { Text } from "@/components/ui/text";
import { useMobileFlag } from "@/data/remote-config";
import { ScreenFullyDrawn } from "@/data/sentry";
import { callEngine } from "@/data/calls/call-store";
import { useRoomTimeline } from "@/data/queries/use-room-timeline";
import { chatRoutes } from "@/lib/chat-routes";
import { canCallRoom, roomHeaderMark } from "@/lib/conversation-display";
import { voiceCallKindFromServer } from "@uniwork/core/chat/voice-call-kind";

function RoomConversation({ chat, roomId, linkedMessageId }: { chat: ChatWorkspace; roomId: string; linkedMessageId: string | null }) {
  const { t } = useTranslation();
  const room = useRoomContext(chat, roomId);
  const [anchorId, setAnchorId] = useState<string | null>(linkedMessageId);
  const [jump, setJump] = useState<{ id: string; seq: number } | null>(linkedMessageId ? { id: linkedMessageId, seq: 0 } : null);
  // The list shows its newest message: the read pointer follows it, and the older pages drop when it comes back.
  const [atLatest, setAtLatest] = useState(true);
  const { timeline, messages, anchorRows, anchorPending, newestId, unread, otherUnread, historyComplete } = useRoomTimeline({
    wsId: chat.wsId,
    roomId,
    userId: chat.userId,
    anchorId,
  });

  // A new link while the room is open moves the anchor.
  useEffect(() => {
    setAnchorId(linkedMessageId);
    setJump(linkedMessageId ? { id: linkedMessageId, seq: Date.now() } : null);
  }, [linkedMessageId]);

  // More unread than the newest page holds: a few older pages load until the unread line has its place.
  useUnreadBackfill({
    messages,
    userId: chat.userId,
    since: unread?.since ?? null,
    complete: historyComplete,
    canLoadOlder: anchorRows === null && timeline.hasNextPage && !timeline.isFetching,
    loadOlder: () => void timeline.fetchNextPage(),
  });

  useRoomReadMarking(chat.wsId, roomId, newestId, atLatest && anchorRows === null);
  // Back at the newest message: the older pages scrolled in on the way up are dropped (a sliding window).
  useTimelineWindow(chat.wsId, roomId, atLatest && anchorRows === null);

  // The web's chat header calls from a DM, a group or a channel, never from the workspace room.
  // ...and only while the server's calls switch is on (data/remote-config.ts).
  const callsOn = useMobileFlag("unichat_mobile_calls");
  const callable = canCallRoom(room.room, callsOn);
  // The microphone (and the camera) is explained and asked before the call starts.
  const call = (withCamera: boolean) =>
    void ensureCallPermissions(withCamera).then(() =>
      callEngine.startCall(roomId, room.title, voiceCallKindFromServer(room.room?.kind), { withCamera }),
    );

  const backToLatest = () => {
    setAnchorId(null);
    setJump(null);
    router.setParams({ message: undefined });
  };

  return (
    <>
      <Conversation
        chat={chat}
        roomId={roomId}
        room={room}
        header={
          <RoomChatHeader
            roomId={roomId}
            nameContext={room.nameContext}
            online={room.peerOnline}
            title={room.title}
            backBadge={otherUnread}
            onPressTitle={() => router.push(chatRoutes.info(chat, roomId))}
            titleActionLabel={t("chat.mobile.room_info")}
            avatar={room.room ? <RoomAvatar mark={roomHeaderMark(room.room, room.title, room.peerOnline)} size={40} seed={roomId} /> : null}
            right={
              <View className="flex-row">
                {callable ? (
                  <>
                    <HeaderIconButton icon="call-outline" label={t("chat.voice_call_start")} testID="room-call-voice" onPress={() => call(false)} />
                    <HeaderIconButton
                      icon="videocam-outline"
                      label={t("chat.video_call_start")}
                      testID="room-call-video"
                      onPress={() => call(true)}
                    />
                  </>
                ) : null}
              </View>
            }
          />
        }
        banner={
          anchorRows ? (
            <View className="flex-row items-center justify-between gap-2 border-b border-border bg-secondary px-4 py-1">
              <Text className="flex-1 text-caption text-muted-foreground">{t("chat.search_jump_banner")}</Text>
              <Pressable accessibilityRole="button" onPress={backToLatest} className="min-h-11 justify-center">
                <Text className="text-callout font-semibold text-primary">{t("chat.search_back_to_latest")}</Text>
              </Pressable>
            </View>
          ) : room.room?.kind === "dm" && room.room.peer_user_id ? (
            // Which side blocked, so a refused send is not a mystery (room-safety.tsx).
            <DmBlockBanner wsId={chat.wsId} peerUserId={room.room.peer_user_id} />
          ) : null
        }
        messages={messages}
        loading={timeline.isPending || anchorPending}
        // Nothing cached and the newest page failed: an error with a retry, not an empty room.
        onRetryLoad={timeline.isError && !timeline.data ? () => void timeline.refetch() : undefined}
        loadingOlder={timeline.isFetchingNextPage}
        onLoadOlder={anchorRows || !timeline.hasNextPage || timeline.isFetchingNextPage ? undefined : () => void timeline.fetchNextPage()}
        onRetryOlder={!anchorRows && timeline.isFetchNextPageError ? () => void timeline.fetchNextPage() : undefined}
        jumpTo={jump}
        onQuoteJump={(messageId) => {
          if (!messages.some((m) => m.id === messageId)) setAnchorId(messageId);
          setJump({ id: messageId, seq: Date.now() });
        }}
        atLatest={atLatest}
        onAtLatestChange={setAtLatest}
        onSend={anchorRows ? backToLatest : undefined}
        onJumpToLatest={anchorRows ? backToLatest : undefined}
        unread={unread}
        historyComplete={historyComplete}
      />
      {/* The room's load span ends when its newest page is drawn (Sentry performance; no-op without a DSN). */}
      <ScreenFullyDrawn record={!timeline.isPending} />
    </>
  );
}

export default function RoomScreen() {
  const chat = useChatWorkspace();
  const { roomId, message } = useLocalSearchParams<{ roomId: string; message?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {chat && roomId ? <RoomConversation chat={chat} roomId={roomId} linkedMessageId={message || null} /> : null}
    </>
  );
}
