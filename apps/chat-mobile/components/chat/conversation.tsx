// The body of a conversation, shared by a room and a thread: the message list
// on the chat wall with day separators, bubbles shaped by run, quotes, "Đã xem"
// on a DM, the typing line and the task cards under messages; in a thread the
// root stands out above an "N trả lời" divider; the composer with its voice, sticker/GIF and reminder
// sends; and the long-press sheet with what each action does to the server
// and the cache (send queue, reactions, edit, delete, copy, thread, poll vote,
// follow-up, task).
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import wallDotsDark from "@/assets/chat-wall-dots-dark.png";
import wallDotsLight from "@/assets/chat-wall-dots-light.png";
import { titleFromMessageBody } from "@uniwork/core/chat/message-links";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import { deliveredToAllAt, furthestReadAt, isMessageSeenByPeer, seenByMembers } from "@uniwork/core/chat/read-receipt-utils";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, ImageBackground, KeyboardAvoidingView, View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import {
  createTaskFromMessage,
  deleteMessage,
  editMessage,
  followUpCommand,
  togglePin,
} from "@/data/chat-actions";
import { chatApi } from "@/data/chat-api";
import { chatSendDeps, discardPendingSend, retryPendingSend, sendChatMessage, type ChatSendInput } from "@/data/chat-send";
import { toggleReaction, votePoll } from "@/data/pending-ops";
import { followUpsOptions, roomLinksOptions } from "@/data/queries/chat";
import { chatRoutes } from "@/lib/chat-routes";
import { continuedRunKeys } from "@/lib/conversation-display";
import { linkWindows } from "@/lib/link-windows";
import { deserializeMessageBodyToComposerDraft } from "@/lib/mentions";
import { messagePreviewText } from "@/lib/message-display";
import { buildMessageRowModels, type MessageRowModel, type Receipt } from "@/lib/message-row-model";
import type { PendingFile } from "@/lib/send-pipeline";
import { albumsOf } from "@/lib/album";
import { messageView } from "@/lib/message-display";
import { buildTimelineRows, type TimelineMessage, type TimelineRow } from "@/lib/timeline-display";
import { useColorScheme } from "@/lib/use-color-scheme";
import { Composer, type ComposerEdit, type ComposerReply } from "./composer";
import { ConnectionBanner } from "./connection-banner";
import { EmojiSheet } from "./emoji-sheet";
import { ExpressionSheet } from "./expression-sheet";
import { ForwardSheet } from "./forward-sheet";
import { ImageViewer, type ViewerPhoto } from "./image-viewer";
import { MessageActionsSheet } from "./message-actions";
import type { MessageCardContext } from "./message-cards";
import { MessageCell, type MessageHandlers } from "./message-cell";
import { MessageList } from "./message-list";
import { PinnedBar } from "./pinned-bar";
import { ReportSheet } from "./report-sheet";
import { ReminderSheet } from "./reminder-sheet";
import { ConversationTyping } from "./room-typing";
import { useStableHandlers } from "./use-stable-handlers";
import type { ChatWorkspace } from "./use-chat-workspace";
import type { useRoomContext } from "./use-room-context";
import { toast } from "@/data/stores/toast-store";

// The MobileChat wall: a dot every 22 pt, one tile per scheme, repeated.
const WALL_DOTS = { light: wallDotsLight, dark: wallDotsDark };

type ChatMessageLink = Awaited<ReturnType<typeof chatApi.listRoomMessageLinks>>[number];

/** Every window's links as one list; TanStack keeps it the same array while no answer changed. */
const allLinks = (results: UseQueryResult<ChatMessageLink[]>[]): ChatMessageLink[] => results.flatMap((result) => result.data ?? []);

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
  const [reported, setReported] = useState<{ messageId: string; senderId: string; name: string } | null>(null);
  const { wsId, userId } = chat;
  const { colorScheme } = useColorScheme();

  const rows = useMemo(() => buildTimelineRows(messages), [messages]);
  const continued = useMemo(() => continuedRunKeys(rows), [rows]);
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
  const roomKind = room.room?.kind;
  const receiptOf = useCallback(
    (message: TimelineMessage, own: boolean): Receipt | null => {
      if (!own || !message.record || !roomKind) return null;
      if (roomKind !== "dm" && !receiptsOn) return null;
      if (isMessageSeenByPeer(message.ts, cursors.readAt)) return "seen";
      if (isMessageSeenByPeer(message.ts, cursors.deliveredAt)) return "delivered";
      return "sent";
    },
    [roomKind, receiptsOn, cursors],
  );
  const seenByOf = (message: TimelineMessage | null) => (message?.record && receiptsOn ? seenByMembers(message.record, room.members, message.sender) : []);

  const failed = useCallback(() => toast.error(t("common.error")), [t]);

  const ctx: MessageCardContext = useMemo(
    () => ({
      wsId,
      orgSlug: chat.orgSlug,
      wsSlug: chat.wsSlug,
      roomId,
      userId,
      onOpenImage: (url, name, messageId) => setImage({ id: messageId ?? url, url, name }),
      onVotePoll: (messageId, optionId) => void votePoll(qc, wsId, roomId, messageId, optionId, userId).catch(() => toast.error(t("chat.message_list.poll_vote_failed"))),
    }),
    [wsId, chat.orgSlug, chat.wsSlug, roomId, userId, qc, t],
  );

  // The tasks made from the messages on screen, one request per window of lib/link-windows.ts (the web's
  // chat-message-links-context): a new message refetches the newest window, not everything shown.
  const windows = useMemo(() => linkWindows(messages.flatMap((m) => (m.record ? [m.id] : []))), [messages]);
  const links = useQueries({ queries: windows.map((ids) => roomLinksOptions(wsId, roomId, ids)), combine: allLinks });
  const taskIdsByMessage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of links) if (link.target_type === "task") map.set(link.message_id, [...(map.get(link.message_id) ?? []), link.target_id]);
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
  // Every send goes through the outbox (data/chat-send.ts): on screen at once, kept across a restart, sent in order.
  const enqueue = (input: Omit<ChatSendInput, "workspaceId" | "roomId" | "senderId">) =>
    void sendChatMessage(qc, { workspaceId: wsId, roomId, senderId: userId, ...input }, chatSendDeps);
  const send = (body: string) => enqueue({ body, replyToMessageId: takeReply(), threadRootId });
  const sendFile = (file: PendingFile) => enqueue({ body: "", file, replyToMessageId: takeReply() });
  const quoteText = useCallback((message: TimelineMessage) => (message.record ? messagePreviewText(message.record, t) : message.body), [t]);
  const quoteOf = (message: TimelineMessage) => ({ id: message.id, sender: room.senderName(message), text: quoteText(message) });

  // Each row worked out once per change and kept as the same object while it draws the same (audit H1).
  const previousModels = useRef<ReadonlyMap<string, MessageRowModel>>(new Map());
  const models = useMemo(() => {
    const next = buildMessageRowModels(
      {
        rows,
        messages,
        userId,
        threadRootId,
        isGroup: room.isGroup,
        continued,
        albums,
        senderName: room.senderName,
        quoteText,
        unknownQuoteSender: t("chat.action_reply"),
        receiptOf,
        highlightedId: props.jumpTo?.id,
        taskIdsByMessage,
      },
      previousModels.current,
    );
    previousModels.current = next;
    return next;
  }, [rows, messages, userId, threadRootId, room.isGroup, continued, albums, room.senderName, quoteText, t, receiptOf, props.jumpTo?.id, taskIdsByMessage]);

  // One object of handlers for every cell, always running the latest closures.
  const handlers: MessageHandlers = useStableHandlers({
    onLongPress: (message: TimelineMessage) => setActionMessage(message),
    onPressQuote: (messageId: string) => props.onQuoteJump(messageId),
    onPressThread: (message: TimelineMessage) => router.push(chatRoutes.thread(chat, roomId, message.id)),
    onPressPending: (message: TimelineMessage) => setActionMessage(message),
    onToggleReaction: (message: TimelineMessage, emoji: string) =>
      void toggleReaction(qc, wsId, roomId, message.id, emoji, userId).catch(() => toast.error(t("chat.message_list.react_failed"))),
    onReply: (message: TimelineMessage) => {
      setEdit(null);
      setReply(quoteOf(message));
    },
  });

  const renderMessage = useCallback(
    (row: Extract<TimelineRow, { type: "message" }>) => {
      const model = models.get(row.key);
      // A photo folded into the album its run starts has no row of its own.
      return model ? <MessageCell model={model} ctx={ctx} scheme={colorScheme} handlers={handlers} /> : null;
    },
    [models, ctx, colorScheme, handlers],
  );

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background" testID={`conversation-${roomId}`}>
      {props.header}
      <ConnectionBanner />
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
              bottom={<ConversationTyping roomId={roomId} nameContext={room.nameContext} isGroup={room.isGroup} />}
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
          void editMessage(qc, wsId, roomId, messageId, body).catch(() => toast.error(t("chat.message_list.edit_failed")));
        }}
        onTyping={() => void chatApi.signalTyping(wsId, roomId).catch(() => undefined)}
        onSendVoice={(clip) =>
          enqueue({ body: "", file: { uri: clip.uri, name: "voice.m4a", mimeType: "audio/mp4" }, voiceDurationMs: clip.durationMs, replyToMessageId: takeReply() })
        }
        onOpenExpressions={() => setSheet("expressions")}
        onOpenReminder={() => setSheet("reminder")}
      />
      <ExpressionSheet wsId={wsId} visible={sheet === "expressions"} onClose={() => setSheet(null)} onPick={send} />
      <ReminderSheet
        visible={sheet === "reminder"}
        onClose={() => setSheet(null)}
        onCreate={(input) => enqueue({ body: "", reminder: { body: input.body.trim(), remindAt: input.remindAt.toISOString(), repeat: input.repeat } })}
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
        onReact={(m, emoji) => void toggleReaction(qc, wsId, roomId, m.id, emoji, userId).catch(() => toast.error(t("chat.message_list.react_failed")))}
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
              onPress: () => void deleteMessage(qc, wsId, roomId, m.id).catch(() => toast.error(t("chat.message_list.delete_failed"))),
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
          void run.catch(() => toast.error(t(command === "convert" ? "chat.follow_up.convert_failed" : "chat.follow_up.update_failed")));
        }}
        onCreateTask={(m) =>
          void createTaskFromMessage(qc, wsId, roomId, { messageId: m.id, title: titleFromMessageBody(deserializeMessageBodyToComposerDraft(m.body)) }).catch(() =>
            toast.error(t("chat.link.create_error")),
          )
        }
        onRetry={(m) => m.pending && void retryPendingSend(qc, m.pending, chatSendDeps)}
        onDiscard={(m) => m.pending && discardPendingSend(m.pending.clientMsgId, chatSendDeps)}
        onMoreReactions={setEmojiFor}
        onPin={(m) => void togglePin(qc, wsId, roomId, m.id).catch(failed)}
        onForward={(m) => setForwardId(m.id)}
        onReport={(m) => setReported({ messageId: m.id, senderId: m.sender, name: room.senderName(m) })}
      />
      <ReportSheet
        wsId={wsId}
        target={reported ? { kind: "message", messageId: reported.messageId, name: reported.name } : null}
        blockUserId={reported?.senderId}
        onClose={() => setReported(null)}
        // A block hides the DM from the one who blocked (ChatService.hideDMWithPeer): back to the list.
        onReported={(blocked) => blocked && room.room?.kind === "dm" && router.dismissAll()}
      />
      <EmojiSheet
        visible={emojiFor !== null}
        onClose={() => setEmojiFor(null)}
        onPick={(emoji) => {
          const target = emojiFor;
          setEmojiFor(null);
          if (target) void toggleReaction(qc, wsId, roomId, target.id, emoji, userId).catch(() => toast.error(t("chat.message_list.react_failed")));
        }}
      />
      <ForwardSheet chat={chat} messageId={forwardId} onClose={() => setForwardId(null)} />
      <ImageViewer wsId={wsId} roomId={roomId} photos={photos} opened={image} onClose={() => setImage(null)} />
    </KeyboardAvoidingView>
  );
}
