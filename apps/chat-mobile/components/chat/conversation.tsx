// The body of a conversation, shared by a room and a thread: the message list
// on the chat wall with day separators, bubbles shaped by run, quotes, "Đã xem"
// on a DM, the typing line and the task cards under messages; in a thread the
// root stands out above an "N trả lời" divider; the composer with its voice, sticker/GIF and reminder
// sends; and the long-press sheet with what each action does to the server
// and the cache (send queue, reactions, edit, delete, copy, thread, poll vote,
// follow-up, task). S6 (audit U2, P2 UX): the composer rides the keyboard
// frame by frame (react-native-keyboard-controller), a send, a long press and a
// reaction are felt (data/haptics.ts), new messages are read to a screen
// reader, and a conversation scrolled up shows "N new" to jump back down —
// where one's own send always lands too.
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import wallDotsDark from "@/assets/chat-wall-dots-dark.png";
import wallDotsLight from "@/assets/chat-wall-dots-light.png";
import { titleFromMessageBody } from "@uniwork/core/chat/message-links";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import { deliveredToAllAt, furthestReadAt, isMessageSeenByPeer, seenByMembers } from "@uniwork/core/chat/read-receipt-utils";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ImageBackground, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { haptics } from "@/components/ui/haptics";
import { PersonAvatar } from "@/components/people/person-avatar";
import type { ChatApi } from "@/data/chat-api";
import {
  useCreateTask,
  useDeleteMessage,
  useDiscardSend,
  useEditMessage,
  useFollowUp,
  useReact,
  useRetrySend,
  useSendMessage,
  useSignalTyping,
  useTogglePin,
  useVotePoll,
  type SendInput,
} from "@/data/mutations/messages";
import { followUpsOptions, roomLinksOptions } from "@/data/queries/chat";
import { countNewSince } from "@/lib/arrivals";
import { chatRoutes } from "@/lib/chat-routes";
import { linkWindows, taskIdsByMessage as readTaskIds } from "@/lib/link-windows";
import { deserializeMessageBodyToComposerDraft } from "@/lib/mentions";
import { messagePreviewText } from "@/lib/message-display";
import { buildMessageRowModels, type MessageRowModel, type Receipt } from "@/lib/message-row-model";
import type { PendingFile } from "@/lib/send-pipeline";
import { messageView } from "@/lib/message-display";
import type { TimelineMessage, TimelineRow } from "@/lib/timeline-display";
import { layoutTimeline } from "@/lib/timeline-layout";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { Composer, type ComposerEdit, type ComposerReply } from "./composer";
import { ConnectionBanner } from "./connection-banner";
import { ConversationLoadError, ConversationSkeleton } from "./conversation-states";
import { EmojiSheet } from "./emoji-sheet";
import { ExpressionSheet } from "./expression-sheet";
import { ForwardSheet } from "./forward-sheet";
import { ImageViewer, type ViewerPhoto } from "./image-viewer";
import { JumpToLatest } from "./jump-to-latest";
import { MessageActionsSheet } from "./message-actions";
import type { MessageCardContext } from "./message-cards";
import { MessageCell, type MessageHandlers } from "./message-cell";
import { MessageList } from "./message-list";
import { PinnedBar } from "./pinned-bar";
import { ReportSheet } from "./report-sheet";
import { ReminderSheet } from "./reminder-sheet";
import { ConversationTyping } from "./room-typing";
import { useArrivalAnnouncements } from "./use-arrival-announcements";
import { useStableHandlers } from "./use-stable-handlers";
import type { ChatWorkspace } from "./use-chat-workspace";
import type { useRoomContext } from "./use-room-context";
import { toast } from "@/data/stores/toast-store";

// The MobileChat wall: a dot every 22 pt, one tile per scheme, repeated.
const WALL_DOTS = { light: wallDotsLight, dark: wallDotsDark };
const NO_PHOTOS: ViewerPhoto[] = [];

type ChatMessageLink = Awaited<ReturnType<ChatApi["listRoomMessageLinks"]>>[number];

/** Each window's answer, or undefined while it has none; TanStack keeps the same array while no answer changed. */
const windowAnswers = (results: UseQueryResult<ChatMessageLink[]>[]): (ChatMessageLink[] | undefined)[] => results.map((result) => result.data);

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
  /** Set when the first page failed and nothing is cached: the wall says so and retries, never "start chatting". */
  onRetryLoad?: () => void;
  loadingOlder: boolean;
  onLoadOlder?: () => void;
  /** Set when the last older page failed: the top of the list offers to try it again. */
  onRetryOlder?: () => void;
  jumpTo: { id: string; seq: number } | null;
  onQuoteJump: (messageId: string) => void;
  onAtLatestChange: (atLatest: boolean) => void;
  /** Before a send: the room leaves a jumped-to page for the latest, where the message lands. */
  onSend?: () => void;
  /** Set while the room shows a page around an older message: the jump button goes back to the latest page. */
  onJumpToLatest?: () => void;
}

export function Conversation(props: Props) {
  const { chat, roomId, threadRootId, room, messages } = props;
  const { t } = useTranslation();
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
  // Every change to the server goes through the mutation layer (data/mutations/*).
  const sendMessage = useSendMessage(wsId, roomId, userId).mutate;
  const retrySend = useRetrySend().mutate;
  const discardSend = useDiscardSend();
  const editMessage = useEditMessage(wsId, roomId, userId).mutateAsync;
  const deleteMessage = useDeleteMessage(wsId, roomId, userId).mutateAsync;
  const togglePin = useTogglePin(wsId, roomId).mutateAsync;
  const toggleReaction = useReact(wsId, roomId, userId).mutateAsync;
  const votePoll = useVotePoll(wsId, roomId, userId).mutateAsync;
  const followUpCommand = useFollowUp(wsId).mutateAsync;
  const createTask = useCreateTask(wsId, roomId).mutateAsync;
  const signalTyping = useSignalTyping(wsId, roomId);

  // One pass over the messages per change: rows newest first (the inverted list's order), runs, albums and the
  // index quotes read from, an unchanged message's rows kept from last time (lib/timeline-layout.ts).
  const { rows, continued, albums, byId } = useMemo(() => layoutTimeline(messages), [messages]);
  // The viewer pages through every photo on screen, oldest first: gathered while it is open, not on every change.
  const { senderName } = room;
  const viewerOpen = image !== null;
  const photos: ViewerPhoto[] = useMemo(
    () =>
      viewerOpen
        ? messages.filter((m) => m.record && !m.pending && messageView(m.record) === "image").map((m) => ({ id: m.id, record: m.record, sender: senderName(m), ts: m.ts }))
        : NO_PHOTOS,
    [viewerOpen, messages, senderName],
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
  // Two strings: a new room record (every new message) that leaves the cursors where they were keeps receiptOf.
  const { readAt, deliveredAt } = cursors;
  const roomKind = room.room?.kind;
  const receiptOf = useCallback(
    (message: TimelineMessage, own: boolean): Receipt | null => {
      if (!own || !message.record || !roomKind) return null;
      if (roomKind !== "dm" && !receiptsOn) return null;
      if (isMessageSeenByPeer(message.ts, readAt)) return "seen";
      if (isMessageSeenByPeer(message.ts, deliveredAt)) return "delivered";
      return "sent";
    },
    [roomKind, receiptsOn, readAt, deliveredAt],
  );
  const seenByOf = (message: TimelineMessage | null) => (message?.record && receiptsOn ? seenByMembers(message.record, room.members, message.sender) : []);

  const failed = useCallback(() => toast.error(t("common.error")), [t]);

  // Scrolled up: the newest message when the reader left, so the jump button counts what came after (the web's awaySinceId).
  const [atLatest, setAtLatest] = useState(true);
  const [awaySinceId, setAwaySinceId] = useState<string | null>(null);
  const [latestSignal, setLatestSignal] = useState(0);
  const newestId = useRef<string | null>(null);
  newestId.current = messages.at(-1)?.id ?? null;
  const { onAtLatestChange } = props;
  const atLatestChange = useCallback(
    (next: boolean) => {
      setAtLatest(next);
      setAwaySinceId(next ? null : newestId.current);
      onAtLatestChange(next);
    },
    [onAtLatestChange],
  );
  const jumpToLatest = () => {
    props.onJumpToLatest?.();
    setLatestSignal((n) => n + 1);
  };
  const newCount = countNewSince(messages, awaySinceId, userId);

  const ctx: MessageCardContext = useMemo(
    () => ({
      wsId,
      orgSlug: chat.orgSlug,
      wsSlug: chat.wsSlug,
      roomId,
      userId,
      onOpenImage: (url, name, messageId) => setImage({ id: messageId ?? url, url, name }),
      onVotePoll: (messageId, optionId) => void votePoll({ messageId, optionId }).catch(() => toast.error(t("chat.message_list.poll_vote_failed"))),
    }),
    [wsId, chat.orgSlug, chat.wsSlug, roomId, userId, votePoll, t],
  );

  // The tasks made from the messages on screen, one request per window of lib/link-windows.ts (the web's
  // chat-message-links-context): a new message refetches the newest window, not everything shown. A window
  // whose key just changed keeps the cards its messages had until its answer comes (readTaskIds).
  const windows = useMemo(() => linkWindows(messages.flatMap((m) => (m.record ? [m.id] : []))), [messages]);
  const answers = useQueries({ queries: windows.map((ids) => roomLinksOptions(wsId, roomId, ids)), combine: windowAnswers });
  const previousTaskIds = useRef<ReadonlyMap<string, readonly string[]>>(new Map());
  const taskIdsByMessage = useMemo(() => {
    const next = readTaskIds(windows, answers, previousTaskIds.current);
    previousTaskIds.current = next;
    return next;
  }, [windows, answers]);
  const followUps = useQuery(followUpsOptions(wsId)).data;
  const openFollowUp = (messageId: string) => followUps?.find((f) => f.message_id === messageId && !f.completed_at) ?? null;
  // The quote goes with this message only: cleared now, not when a slow delivery ends.
  const takeReply = () => {
    const replyToMessageId = reply?.id;
    setReply(null);
    return replyToMessageId;
  };
  // Every send goes through the outbox (data/chat-send.ts): on screen at once, kept across a restart, sent in order,
  // felt, and scrolled to wherever the reader was.
  const enqueue = (input: SendInput) => {
    haptics.send();
    props.onSend?.();
    setLatestSignal((n) => n + 1);
    sendMessage(input);
  };
  const send = (body: string) => enqueue({ body, replyToMessageId: takeReply(), threadRootId });
  const sendFile = (file: PendingFile) => enqueue({ body: "", file, replyToMessageId: takeReply() });
  const quoteText = useCallback((message: TimelineMessage) => (message.record ? messagePreviewText(message.record, t) : message.body), [t]);
  const quoteOf = (message: TimelineMessage) => ({ id: message.id, sender: room.senderName(message), text: quoteText(message) });
  const react = (messageId: string, emoji: string) => {
    haptics.reaction();
    void toggleReaction({ messageId, emoji }).catch(() => toast.error(t("chat.message_list.react_failed")));
  };
  // What VoiceOver / TalkBack hear when someone else's message arrives at the bottom (audit U2).
  useArrivalAnnouncements(roomId, messages, userId, (message) => ({ sender: room.senderName(message), preview: quoteText(message) }));

  // Each row worked out once per change and kept as the same object while it draws the same (audit H1).
  const previousModels = useRef<ReadonlyMap<string, MessageRowModel>>(new Map());
  const models = useMemo(() => {
    const next = buildMessageRowModels(
      {
        rows,
        byId,
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
  }, [rows, byId, userId, threadRootId, room.isGroup, continued, albums, room.senderName, quoteText, t, receiptOf, props.jumpTo?.id, taskIdsByMessage]);

  // One object of handlers for every cell, always running the latest closures.
  const handlers: MessageHandlers = useStableHandlers({
    onLongPress: (message: TimelineMessage) => {
      haptics.longPress();
      setActionMessage(message);
    },
    onPressQuote: (messageId: string) => props.onQuoteJump(messageId),
    onPressThread: (message: TimelineMessage) => router.push(chatRoutes.thread(chat, roomId, message.id)),
    onPressPending: (message: TimelineMessage) => setActionMessage(message),
    onToggleReaction: (message: TimelineMessage, emoji: string) => react(message.id, emoji),
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
      {props.loading || props.onRetryLoad ? (
        <View className="flex-1 bg-chat-wall">
          {props.onRetryLoad ? <ConversationLoadError thread={Boolean(threadRootId)} onRetry={props.onRetryLoad} /> : <ConversationSkeleton />}
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
              onRetryOlder={props.onRetryOlder}
              jumpTo={props.jumpTo}
              onAtLatestChange={atLatestChange}
              empty={threadRootId || !room.room ? null : t(room.room.kind === "dm" ? "chat.dm_empty" : "chat.group_empty", { name: room.title })}
              bottom={<ConversationTyping roomId={roomId} nameContext={room.nameContext} isGroup={room.isGroup} />}
              latestSignal={latestSignal}
            />
            {!atLatest || props.onJumpToLatest ? <JumpToLatest count={newCount} onPress={jumpToLatest} /> : null}
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
          void editMessage({ messageId, body }).catch(() => toast.error(t("chat.message_list.edit_failed")));
        }}
        onTyping={signalTyping}
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
        onReact={(m, emoji) => react(m.id, emoji)}
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
              onPress: () => void deleteMessage(m.id).catch(() => toast.error(t("chat.message_list.delete_failed"))),
            },
          ])
        }
        onFollowUp={(m, command) => {
          const followUp = openFollowUp(m.id);
          const run =
            command === "create"
              ? followUpCommand({ command: "create", id: m.id })
              : !followUp
                ? Promise.resolve()
                : command === "convert"
                  ? createTask({ followUpId: followUp.id })
                  : followUpCommand({ command, id: followUp.id });
          void run.catch(() => toast.error(t(command === "convert" ? "chat.follow_up.convert_failed" : "chat.follow_up.update_failed")));
        }}
        onCreateTask={(m) =>
          void createTask({ messageId: m.id, title: titleFromMessageBody(deserializeMessageBodyToComposerDraft(m.body)) }).catch(() =>
            toast.error(t("chat.link.create_error")),
          )
        }
        onRetry={(m) => m.pending && retrySend(m.pending)}
        onDiscard={(m) => m.pending && discardSend(m.pending.clientMsgId)}
        onMoreReactions={setEmojiFor}
        onPin={(m) => void togglePin(m.id).catch(failed)}
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
          if (target) react(target.id, emoji);
        }}
      />
      <ForwardSheet chat={chat} messageId={forwardId} onClose={() => setForwardId(null)} />
      <ImageViewer wsId={wsId} roomId={roomId} photos={photos} opened={image} onClose={() => setImage(null)} />
    </KeyboardAvoidingView>
  );
}
