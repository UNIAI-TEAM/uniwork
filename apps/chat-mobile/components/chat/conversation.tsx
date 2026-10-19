// The body of a conversation, shared by a room and a thread: the message list
// on the chat wall with day separators, bubbles shaped by run, quotes, "Đã xem"
// on a DM, the typing line and the task cards under messages; in a thread the
// root stands out above an "N trả lời" divider; the composer with its voice, sticker/GIF and reminder
// sends; and the long-press sheet with what each action does to the server
// and the cache (send queue, reactions, edit, delete, copy, thread, poll vote,
// follow-up, task).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import wallDotsDark from "@/assets/chat-wall-dots-dark.png";
import wallDotsLight from "@/assets/chat-wall-dots-light.png";
import { titleFromMessageBody } from "@uniwork/core/chat/message-links";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import { deliveredToAllAt, furthestReadAt, isMessageSeenByPeer, seenByMembers } from "@uniwork/core/chat/read-receipt-utils";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, ImageBackground, KeyboardAvoidingView, View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Text } from "@/components/ui/text";
import {
  createTaskFromMessage,
  deleteMessage,
  editMessage,
  followUpCommand,
  sendReminder,
  sendVoiceMessage,
  togglePin,
  toggleReaction,
  votePoll,
} from "@/data/chat-actions";
import { chatApi } from "@/data/chat-api";
import { chatSendDeps, deliverPendingSend, discardPendingSend, sendChatMessage } from "@/data/chat-send";
import { followUpsOptions, roomLinksOptions } from "@/data/queries/chat";
import { chatRoutes } from "@/lib/chat-routes";
import { continuedRunKeys } from "@/lib/conversation-display";
import { deserializeMessageBodyToComposerDraft } from "@/lib/mentions";
import { messagePreviewText } from "@/lib/message-display";
import type { PendingFile } from "@/lib/send-pipeline";
import { albumsOf } from "@/lib/album";
import { messageView } from "@/lib/message-display";
import { buildTimelineRows, type TimelineMessage, type TimelineRow } from "@/lib/timeline-display";
import { useColorScheme } from "@/lib/use-color-scheme";
import { Composer, type ComposerEdit, type ComposerReply } from "./composer";
import { EmojiSheet } from "./emoji-sheet";
import { ExpressionSheet } from "./expression-sheet";
import { ForwardSheet } from "./forward-sheet";
import { ImageViewer, type ViewerPhoto } from "./image-viewer";
import { MessageActionsSheet } from "./message-actions";
import type { MessageCardContext } from "./message-cards";
import { MessageList } from "./message-list";
import { MessageRow, type Receipt } from "./message-row";
import { PinnedBar } from "./pinned-bar";
import { ReminderSheet } from "./reminder-sheet";
import { SwipeToReply } from "./swipe-to-reply";
import { TypingBubble } from "./typing-bubble";

// The MobileChat wall: a dot every 22 pt, one tile per scheme, repeated.
const WALL_DOTS = { light: wallDotsLight, dark: wallDotsDark };
import type { ChatWorkspace } from "./use-chat-workspace";
import type { useRoomContext } from "./use-room-context";

interface Props {
  chat: ChatWorkspace;
  roomId: string;
  /** Set in a thread: sends go to it and no message opens another one. */
  threadRootId?: string;
  room: ReturnType<typeof useRoomContext>;
  header: ReactNode;
  banner?: ReactNode;
  messages: TimelineMessage[];
  loading: boolean;
  loadingOlder: boolean;
  onLoadOlder?: () => void;
  jumpTo: { id: string; seq: number } | null;
  onQuoteJump: (messageId: string) => void;
  onAtLatestChange: (atLatest: boolean) => void;
  /** Before a send: the room leaves a jumped-to page for the latest, where the message lands. */
  onSend?: () => void;
}

export function Conversation(props: Props) {
  const { chat, roomId, threadRootId, room, messages } = props;
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [actionMessage, setActionMessage] = useState<TimelineMessage | null>(null);
  const [reply, setReply] = useState<ComposerReply | null>(null);
  const [edit, setEdit] = useState<ComposerEdit | null>(null);
  const [image, setImage] = useState<{ id: string; url: string; name: string } | null>(null);
  const [sheet, setSheet] = useState<"expressions" | "reminder" | null>(null);
  const [emojiFor, setEmojiFor] = useState<TimelineMessage | null>(null);
  const [forwardId, setForwardId] = useState<string | null>(null);
  const { wsId, userId } = chat;
  const { colorScheme } = useColorScheme();

  const rows = useMemo(() => buildTimelineRows(messages), [messages]);
  const continued = useMemo(() => continuedRunKeys(rows), [rows]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const albums = useMemo(() => albumsOf(messages), [messages]);
  // The viewer pages through every photo on screen, oldest first.
  const photos: ViewerPhoto[] = useMemo(
    () => messages.filter((m) => m.record && !m.pending && messageView(m.record) === "image").map((m) => ({ id: m.id, record: m.record, sender: room.senderName(m), ts: m.ts })),
    [messages, room],
  );
  // Receipts per sent message (bảng Ngôn ngữ): a DM reads its peer's two cursors off the room,
  // a group or channel the furthest read and the earliest delivered among the others (chat-seen-by.tsx).
  const receiptsOn = room.room?.kind === "group" || (room.room?.kind === "channel" && !isDefaultWorkspaceChannel(room.room));
  const cursors = useMemo(() => {
    const record = room.room;
    if (!record) return { readAt: null as string | null, deliveredAt: null as string | null };
    if (record.kind === "dm") return { readAt: record.peer_last_read_at ?? null, deliveredAt: record.peer_last_delivered_at ?? null };
    if (receiptsOn) return { readAt: furthestReadAt(room.members, userId), deliveredAt: deliveredToAllAt(room.members, userId) };
    return { readAt: null, deliveredAt: null };
  }, [room.room, room.members, receiptsOn, userId]);
  const receiptOf = (message: TimelineMessage, own: boolean): Receipt | null => {
    if (!own || !message.record || !room.room) return null;
    if (room.room.kind !== "dm" && !receiptsOn) return null;
    if (isMessageSeenByPeer(message.ts, cursors.readAt)) return "seen";
    if (isMessageSeenByPeer(message.ts, cursors.deliveredAt)) return "delivered";
    return "sent";
  };
  const seenByOf = (message: TimelineMessage | null) => (message?.record && receiptsOn ? seenByMembers(message.record, room.members, message.sender) : []);

  const failed = useCallback(() => Alert.alert(t("common.error")), [t]);

  const ctx: MessageCardContext = useMemo(
    () => ({
      wsId,
      orgSlug: chat.orgSlug,
      wsSlug: chat.wsSlug,
      roomId,
      userId,
      onOpenImage: (url, name, messageId) => setImage({ id: messageId ?? url, url, name }),
      onVotePoll: (messageId, optionId) => void votePoll(qc, wsId, roomId, messageId, optionId).catch(() => Alert.alert(t("chat.message_list.poll_vote_failed"))),
    }),
    [wsId, chat.orgSlug, chat.wsSlug, roomId, userId, qc, t],
  );

  // The tasks made from the messages on screen, one request per window (the web's chat-message-links-context).
  const serverIds = useMemo(() => messages.flatMap((m) => (m.record ? [m.id] : [])), [messages]);
  const links = useQuery(roomLinksOptions(wsId, roomId, serverIds)).data;
  const taskIdsByMessage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of links ?? []) if (link.target_type === "task") map.set(link.message_id, [...(map.get(link.message_id) ?? []), link.target_id]);
    return map;
  }, [links]);
  const followUps = useQuery(followUpsOptions(wsId)).data;
  const openFollowUp = (messageId: string) => followUps?.find((f) => f.message_id === messageId && !f.completed_at) ?? null;
  // The quote goes with this message only: cleared now, not when a slow delivery ends.
  const takeReply = () => {
    const replyToMessageId = reply?.id;
    setReply(null);
    props.onSend?.();
    return replyToMessageId;
  };
  const send = (body: string) =>
    void sendChatMessage(qc, { workspaceId: wsId, roomId, senderId: userId, body, replyToMessageId: takeReply(), threadRootId }, chatSendDeps);
  const sendFile = (file: PendingFile) =>
    void sendChatMessage(qc, { workspaceId: wsId, roomId, senderId: userId, body: "", file, replyToMessageId: takeReply() }, chatSendDeps);
  const quoteOf = (message: TimelineMessage) => ({ id: message.id, sender: room.senderName(message), text: message.record ? messagePreviewText(message.record, t) : message.body });

  const renderMessage = (row: Extract<TimelineRow, { type: "message" }>) => {
    const { message } = row;
    // A photo folded into the album its run starts.
    if (albums.folded.has(message.id)) return null;
    const own = message.sender === userId;
    const quotedId = message.replyToEventId;
    const quoted = quotedId ? byId.get(quotedId) : undefined;
    const isContinued = continued.has(row.key);
    // A group's avatar sits on the last bubble of a run (the canvas aligns it to the bottom); the others keep its width.
    const avatar = room.isGroup && !own && message.id !== threadRootId ? (isContinued ? <View style={{ width: 30 }} /> : <PersonAvatar name={room.senderName(message)} size={30} seed={message.sender} />) : undefined;
    const bubble = (
      <MessageRow
        message={message}
        own={own}
        compactTop={row.compactTop}
        continued={isContinued}
        senderName={room.senderName(message)}
        showSender={room.isGroup && !own && row.showAvatar}
        // In a thread every reply answers the root above it: no quote of the root on each one.
        quote={quotedId && quotedId !== threadRootId ? (quoted ? quoteOf(quoted) : { id: quotedId, sender: t("chat.action_reply"), text: "…" }) : null}
        receipt={receiptOf(message, own)}
        avatar={avatar}
        album={albums.byFirstId.get(message.id)}
        ringed={message.id === threadRootId}
        highlighted={message.id === props.jumpTo?.id}
        showThread={!threadRootId}
        ctx={ctx}
        scheme={colorScheme}
        taskIds={taskIdsByMessage.get(message.id)}
        onLongPress={setActionMessage}
        onPressQuote={props.onQuoteJump}
        onPressThread={(m) => router.push(chatRoutes.thread(chat, roomId, m.id))}
        onPressPending={setActionMessage}
        onToggleReaction={(m, emoji) => void toggleReaction(qc, wsId, roomId, m.id, emoji).catch(() => Alert.alert(t("chat.message_list.react_failed")))}
      />
    );
    if (message.id !== threadRootId)
      return (
        <SwipeToReply
          enabled={!threadRootId && Boolean(message.record)}
          onReply={() => {
            setEdit(null);
            setReply(quoteOf(message));
          }}
        >
          {bubble}
        </SwipeToReply>
      );
    // The server's count covers replies on pages not loaded yet; the loaded ones cover a count not refreshed yet.
    const replies = Math.max(message.record?.reply_count ?? 0, messages.length - 1);
    const label = t("chat.thread_replies", { count: replies });
    // One view, so the root and its divider stay in order inside the inverted list's cell.
    return (
      <View>
        <View className="border-b border-primary/20 bg-primary/10 pb-3">{bubble}</View>
        {replies > 0 ? (
          <View className="flex-row items-center gap-2.5 px-3 pb-1.5 pt-3.5" accessible accessibilityRole="header" accessibilityLabel={label}>
            <View className="h-px flex-1 bg-border" />
            <View className="rounded-full bg-chat-chip px-3 py-[3px]">
              <Text className="text-[13px] font-semibold text-chat-chip-foreground">{label}</Text>
            </View>
            <View className="h-px flex-1 bg-border" />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background" testID={`conversation-${roomId}`}>
      {props.header}
      {props.banner}
      {props.loading ? (
        <View className="flex-1 items-center justify-center bg-chat-wall">
          <ActivityIndicator accessibilityLabel={t("common.loading")} />
        </View>
      ) : (
        <View className="flex-1 bg-chat-wall">
          {!threadRootId ? <PinnedBar messages={messages} onJump={props.onQuoteJump} /> : null}
          <ImageBackground source={WALL_DOTS[colorScheme]} resizeMode="repeat" style={{ flex: 1 }}>
            <MessageList
              rows={rows}
              renderMessage={renderMessage}
              onLoadOlder={props.onLoadOlder}
              loadingOlder={props.loadingOlder}
              jumpTo={props.jumpTo}
              onAtLatestChange={props.onAtLatestChange}
              empty={threadRootId || !room.room ? null : t(room.room.kind === "dm" ? "chat.dm_empty" : "chat.group_empty", { name: room.title })}
              bottom={
                room.typingLabel ? (
                  <TypingBubble label={room.typingLabel} avatar={room.isGroup && room.typingNames[0] ? <PersonAvatar name={room.typingNames[0]} size={30} seed={room.typingIds[0]} /> : undefined} />
                ) : null
              }
            />
          </ImageBackground>
        </View>
      )}
      <Composer
        candidates={room.candidates}
        canSend={room.canSend}
        allowAttachments={!threadRootId}
        placeholder={threadRootId ? t("chat.mobile.thread_reply_placeholder") : undefined}
        reply={reply}
        edit={edit}
        onCancelReply={() => setReply(null)}
        onCancelEdit={() => setEdit(null)}
        onSend={send}
        onSendFile={sendFile}
        onEdit={(messageId, body) => {
          setEdit(null);
          void editMessage(qc, wsId, roomId, messageId, body).catch(() => Alert.alert(t("chat.message_list.edit_failed")));
        }}
        onTyping={() => void chatApi.signalTyping(wsId, roomId).catch(() => undefined)}
        onSendVoice={(clip) => {
          const quote = reply;
          // A clip is not queued like text: a failed send says so and gives the quote back.
          void sendVoiceMessage(qc, wsId, roomId, { ...clip, replyToMessageId: takeReply() }).catch(() => {
            setReply((current) => current ?? quote);
            Alert.alert(t("chat.voice_record_failed"));
          });
        }}
        onOpenExpressions={() => setSheet("expressions")}
        onOpenReminder={() => setSheet("reminder")}
      />
      <ExpressionSheet wsId={wsId} visible={sheet === "expressions"} onClose={() => setSheet(null)} onPick={send} />
      <ReminderSheet
        visible={sheet === "reminder"}
        onClose={() => setSheet(null)}
        onCreate={(input) => void sendReminder(qc, wsId, roomId, input).catch(() => Alert.alert(t("chat.reminder_create_failed")))}
      />
      <MessageActionsSheet
        message={actionMessage}
        own={actionMessage?.sender === userId}
        senderName={actionMessage ? room.senderName(actionMessage) : undefined}
        seenBy={seenByOf(actionMessage)}
        avatar={actionMessage && room.isGroup && actionMessage.sender !== userId ? <PersonAvatar name={room.senderName(actionMessage)} size={30} seed={actionMessage.sender} /> : undefined}
        inThread={Boolean(threadRootId)}
        followUp={actionMessage ? openFollowUp(actionMessage.id) : null}
        onClose={() => setActionMessage(null)}
        onReact={(m, emoji) => void toggleReaction(qc, wsId, roomId, m.id, emoji).catch(() => Alert.alert(t("chat.message_list.react_failed")))}
        onReply={(m) => {
          setEdit(null);
          setReply(quoteOf(m));
        }}
        onThread={(m) => router.push(chatRoutes.thread(chat, roomId, m.id))}
        onCopy={(m) => void Clipboard.setStringAsync(deserializeMessageBodyToComposerDraft(m.body)).catch(failed)}
        onEdit={(m) => {
          setReply(null);
          setEdit({ id: m.id, body: m.body });
        }}
        onDelete={(m) =>
          Alert.alert(t("chat.message_list.delete_confirm_title"), t("chat.message_list.delete_confirm_description"), [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("chat.action_delete"),
              style: "destructive",
              onPress: () => void deleteMessage(qc, wsId, roomId, m.id).catch(() => Alert.alert(t("chat.message_list.delete_failed"))),
            },
          ])
        }
        onFollowUp={(m, command) => {
          const followUp = openFollowUp(m.id);
          const run =
            command === "create"
              ? followUpCommand(qc, wsId, "create", m.id)
              : !followUp
                ? Promise.resolve()
                : command === "convert"
                  ? createTaskFromMessage(qc, wsId, roomId, { followUpId: followUp.id })
                  : followUpCommand(qc, wsId, command, followUp.id);
          void run.catch(() => Alert.alert(t(command === "convert" ? "chat.follow_up.convert_failed" : "chat.follow_up.update_failed")));
        }}
        onCreateTask={(m) =>
          void createTaskFromMessage(qc, wsId, roomId, { messageId: m.id, title: titleFromMessageBody(deserializeMessageBodyToComposerDraft(m.body)) }).catch(() =>
            Alert.alert(t("chat.link.create_error")),
          )
        }
        onRetry={(m) => m.pending && void deliverPendingSend(qc, m.pending, chatSendDeps)}
        onDiscard={(m) => m.pending && discardPendingSend(m.pending.clientMsgId)}
        onMoreReactions={setEmojiFor}
        onPin={(m) => void togglePin(qc, wsId, roomId, m.id).catch(failed)}
        onForward={(m) => setForwardId(m.id)}
      />
      <EmojiSheet
        visible={emojiFor !== null}
        onClose={() => setEmojiFor(null)}
        onPick={(emoji) => {
          const target = emojiFor;
          setEmojiFor(null);
          if (target) void toggleReaction(qc, wsId, roomId, target.id, emoji).catch(() => Alert.alert(t("chat.message_list.react_failed")));
        }}
      />
      <ForwardSheet chat={chat} messageId={forwardId} onClose={() => setForwardId(null)} />
      <ImageViewer wsId={wsId} roomId={roomId} photos={photos} opened={image} onClose={() => setImage(null)} />
    </KeyboardAvoidingView>
  );
}
