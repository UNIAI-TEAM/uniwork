// The body of a conversation, shared by a room and a thread: the message list
// on the chat wall with day separators, bubbles shaped by run, quotes, "seen"
// on a DM, the typing line and the task cards under messages; in a thread the
// root stands out above an "N replies" divider; the composer with its voice,
// sticker/GIF and reminder sends; and the sheets over it, one at a time
// (lib/conversation-sheets.ts). What each message action does to the server is
// use-message-actions.ts. The composer rides the keyboard frame by frame
// (react-native-keyboard-controller), a send, a long press and a reaction are
// felt (data/haptics.ts), new messages are read to a screen reader, and a
// conversation scrolled up shows "N new" to jump back down, where one's own
// send always lands too.
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import { deliveredToAllAt, furthestReadAt, isMessageSeenByPeer, seenByMembers } from "@uniwork/core/chat/read-receipt-utils";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { haptics } from "@/components/ui/haptics";
import { PersonAvatar } from "@/components/people/person-avatar";
import type { ChatApi } from "@/data/chat-api";
import { useCreateTask, useDeleteMessage, useLinkTask, useShareAsDocument, type SendInput } from "@/data/mutations/messages";
import { toast } from "@/data/stores/toast-store";
import { followUpsOptions, roomLinksOptions } from "@/data/queries/chat";
import { readDraft, useDraftStore } from "@/data/stores/draft-store";
import { draftKey } from "@/lib/drafts";
import { countNewSince } from "@/lib/arrivals";
import { chatRoutes } from "@/lib/chat-routes";
import { linkWindows, taskIdsByMessage as readTaskIds, type MessageTaskRef } from "@/lib/link-windows";
import { conversationSheetReducer, NO_SHEET } from "@/lib/conversation-sheets";
import { messagePreviewText } from "@/lib/message-display";
import { buildMessageRowModels, type MessageRowModel, type Receipt } from "@/lib/message-row-model";
import type { PendingFile } from "@/lib/send-pipeline";
import { messageView } from "@/lib/message-display";
import type { TimelineMessage, TimelineRow } from "@/lib/timeline-display";
import { layoutTimeline } from "@/lib/timeline-layout";
import { firstUnreadMessageId, type UnreadSnapshot } from "@/lib/unread-divider";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { Composer, type ComposerEdit, type ComposerReply } from "./composer";
import { ConversationCreateTaskSheet, taskDraftFromSources } from "./create-task-sheet";
import { ConnectionBanner } from "./connection-banner";
import { ConversationLoadError, ConversationSkeleton } from "./conversation-states";
import { EmojiSheet } from "./emoji-sheet";
import { ExpressionSheet } from "./expression-sheet";
import { ForwardSheet } from "./forward-sheet";
import { ImageViewer, type ViewerPhoto } from "./image-viewer";
import { JumpToLatest } from "./jump-to-latest";
import { LinkSheet, useOpenLink } from "./link-sheet";
import { MessageActionsSheet } from "./message-actions";
import type { MessageCardContext } from "./message-cards";
import { MessageCell, type MessageHandlers } from "./message-cell";
import { PinnedBar } from "./pinned-bar";
import { ReportSheet } from "./report-sheet";
import { ReminderSheet } from "./reminder-sheet";
import { ConversationTyping } from "./room-typing";
import { useArrivalAnnouncements } from "./use-arrival-announcements";
import { LiveRegion } from "@/components/ui/live-region";
import { useSendFailureFeedback } from "./use-send-failure-feedback";
import { ChatWall } from "./chat-wall";
import { NoteSheet, PollSheet, PostSheet } from "./compose-sheets";
import { DocumentPickSheet, LinkTaskSheet } from "./pick-sheets";
import { ConversationSelection } from "./selection-bar";
import { useMessageActions } from "./use-message-actions";
import { useStableHandlers } from "./use-stable-handlers";
import { TimelineList } from "./timeline-list";
import type { ChatWorkspace } from "./use-chat-workspace";
import type { useRoomContext } from "./use-room-context";

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
  /** The list shows its newest message. The screen owns it (a room marks read and trims its pages by it). */
  atLatest: boolean;
  onAtLatestChange: (atLatest: boolean) => void;
  /** Before a send: the room leaves a jumped-to page for the latest, where the message lands. */
  onSend?: () => void;
  /** Set while the room shows a page around an older message: the jump button goes back to the latest page. */
  onJumpToLatest?: () => void;
  /** Where the unread messages began when the room opened (lib/unread-divider.ts): their line, and the room opens on it. */
  unread?: UnreadSnapshot | null;
  /** The oldest message of the conversation is loaded: nothing older could be the first unread one. */
  historyComplete?: boolean;
}

export function Conversation(props: Props) {
  const { chat, roomId, threadRootId, room, messages } = props;
  const { t } = useTranslation();
  const [sheet, sheets] = useReducer(conversationSheetReducer, NO_SHEET);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const actionMessage = sheet.kind === "actions" ? sheet.message : null;
  // The composer's draft and the message it quotes outlive the screen (lib/drafts.ts).
  const composerDraftKey = draftKey(chat.userId, chat.wsId, roomId, threadRootId);
  const [reply, setReply] = useState<ComposerReply | null>(() => readDraft(composerDraftKey)?.reply ?? null);
  // A block, not `() => setReply(…)`: once the drafts are read from the device, the persisted store's set returns
  // its write's Promise, which React would take for the cleanup and call on leaving the room ("destroy is not a
  // function"), throwing the whole workspace into its error screen.
  useEffect(() => {
    useDraftStore.getState().setReply(composerDraftKey, reply);
  }, [composerDraftKey, reply]);
  const [edit, setEdit] = useState<ComposerEdit | null>(null);
  const openLink = useOpenLink();
  const { wsId, userId } = chat;
  const createTask = useCreateTask(wsId, roomId);
  const linkTask = useLinkTask(wsId, roomId);
  const shareDocument = useShareAsDocument(wsId, roomId);
  const removeMessage = useDeleteMessage(wsId, roomId, userId);
  const { colorScheme } = useColorScheme();

  // One pass over the messages per change: rows newest first (the inverted list's order), runs, albums and the
  // index quotes read from, an unchanged message's rows kept from last time (lib/timeline-layout.ts).
  const { rows, continued, albums, byId } = useMemo(() => layoutTimeline(messages), [messages]);
  // The viewer pages through every photo on screen, oldest first: gathered while it is open, not on every change.
  const { senderName } = room;
  const image = sheet.kind === "image" ? sheet.photo : null;
  const viewerOpen = image !== null;
  const photos: ViewerPhoto[] = useMemo(
    () =>
      viewerOpen
        ? messages
            .filter((m) => m.record && !m.pending && messageView(m.record) === "image")
            .map((m) => ({ id: m.id, record: m.record, sender: senderName(m), ts: m.ts }))
        : NO_PHOTOS,
    [viewerOpen, messages, senderName],
  );
  // Receipts per sent message (the design language board): a DM reads its peer's two cursors off the room,
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
  const seenByOf = (message: TimelineMessage | null) =>
    message?.record && receiptsOn ? seenByMembers(message.record, room.members, message.sender) : [];

  // Scrolled up: the newest message when the reader left, so the jump button counts what came after (the web's awaySinceId).
  const { atLatest } = props;
  const [awaySinceId, setAwaySinceId] = useState<string | null>(null);
  const [latestSignal, setLatestSignal] = useState(0);
  const newestId = useRef<string | null>(null);
  newestId.current = messages.at(-1)?.id ?? null;
  const { onAtLatestChange } = props;
  const atLatestChange = useCallback(
    (next: boolean) => {
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
  // "N tin chưa đọc" above the first message that came after the reader's pointer when the room opened.
  const historyComplete = props.historyComplete ?? false;
  const firstUnreadId = useMemo(
    () => firstUnreadMessageId(messages, userId, props.unread?.since ?? null, historyComplete),
    [messages, userId, props.unread?.since, historyComplete],
  );
  const unreadCount = props.unread?.count ?? 0;
  const unreadLine = useMemo(
    () =>
      firstUnreadId
        ? { id: firstUnreadId, label: unreadCount > 0 ? t("chat.unread_count_chip", { count: unreadCount }) : t("chat.new_messages") }
        : null,
    [firstUnreadId, unreadCount, t],
  );

  const followUps = useQuery(followUpsOptions(wsId)).data;
  const followUpOf = (messageId: string) => followUps?.find((f) => f.message_id === messageId && !f.completed_at) ?? null;
  const quoteText = useCallback((message: TimelineMessage) => (message.record ? messagePreviewText(message.record, t) : message.body), [t]);
  // The composer quotes a message or edits one, never both.
  const replyTo = (message: TimelineMessage) => {
    setEdit(null);
    setReply({ id: message.id, sender: room.senderName(message), text: quoteText(message) });
  };
  const editOf = (message: TimelineMessage) => {
    setReply(null);
    setEdit({ id: message.id, body: message.body });
  };
  // Every change to the server goes through the mutation layer, by way of use-message-actions.ts.
  const actions = useMessageActions({
    chat,
    roomId,
    followUpOf,
    senderName: room.senderName,
    sheets,
    composer: { reply: replyTo, edit: editOf },
  });
  const { votePoll, react } = actions;
  // A poll vote's notice scrolls to its poll as a quote does; stable, so the cards' context keeps its identity.
  const jumpTo = useStableHandlers({ onJumpToMessage: (messageId: string) => props.onQuoteJump(messageId) });

  const ctx: MessageCardContext = useMemo(
    () => ({
      wsId,
      orgSlug: chat.orgSlug,
      wsSlug: chat.wsSlug,
      roomId,
      userId,
      onOpenImage: (url, name, messageId) => sheets({ type: "open", sheet: { kind: "image", photo: { id: messageId ?? url, url, name } } }),
      onVotePoll: votePoll,
      onOpenLink: openLink,
      onLinkMenu: (url) => {
        haptics.longPress();
        sheets({ type: "open", sheet: { kind: "link", url } });
      },
      onJumpToMessage: jumpTo.onJumpToMessage,
      onCreateSummaryTask: (messageId, title) => {
        sheets({ type: "open", sheet: { kind: "createTask", messageId, title, description: "", count: 1 } });
      },
      selection: selected.size > 0 ? selected : undefined,
    }),
    [wsId, chat.orgSlug, chat.wsSlug, roomId, userId, votePoll, openLink, jumpTo, sheets, selected],
  );

  // The tasks made from the messages on screen, one request per window of lib/link-windows.ts (the web's
  // chat-message-links-context): a new message refetches the newest window, not everything shown. A window
  // whose key just changed keeps the cards its messages had until its answer comes (readTaskIds).
  const windows = useMemo(() => linkWindows(messages.flatMap((m) => (m.record ? [m.id] : []))), [messages]);
  const answers = useQueries({ queries: windows.map((ids) => roomLinksOptions(wsId, roomId, ids)), combine: windowAnswers });
  const previousTaskIds = useRef<ReadonlyMap<string, readonly MessageTaskRef[]>>(new Map());
  const taskIdsByMessage = useMemo(() => {
    const next = readTaskIds(windows, answers, previousTaskIds.current);
    previousTaskIds.current = next;
    return next;
  }, [windows, answers]);
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
    actions.send(input);
  };
  const send = (body: string, priority?: "important" | "urgent") =>
    enqueue({ body, replyToMessageId: takeReply(), threadRootId, ...(priority ? { priority } : {}) });
  const toggleSelected = (message: TimelineMessage) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
  const sendFile = (file: PendingFile) => enqueue({ body: "", file, replyToMessageId: takeReply() });
  // What VoiceOver / TalkBack hear when someone else's message arrives at the bottom.
  // iOS hears them queued; Android reads the line from the live region drawn below.
  const arrivalLine = useArrivalAnnouncements(roomId, messages, userId, (message) => ({
    sender: room.senderName(message),
    preview: quoteText(message),
  }));
  // A send of mine that fails while the room is open is felt and said.
  useSendFailureFeedback(messages);

  // Each row worked out once per change and kept as the same object while it draws the same.
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
  }, [
    rows,
    byId,
    userId,
    threadRootId,
    room.isGroup,
    continued,
    albums,
    room.senderName,
    quoteText,
    t,
    receiptOf,
    props.jumpTo?.id,
    taskIdsByMessage,
  ]);

  // One object of handlers for every cell, always running the latest closures.
  const handlers: MessageHandlers = useStableHandlers({
    onLongPress: (message: TimelineMessage) => {
      haptics.longPress();
      sheets({ type: "open", sheet: { kind: "actions", message } });
    },
    onPressQuote: (messageId: string) => props.onQuoteJump(messageId),
    onPressThread: (message: TimelineMessage) => router.push(chatRoutes.thread(chat, roomId, message.id)),
    onPressPending: (message: TimelineMessage) => sheets({ type: "open", sheet: { kind: "actions", message } }),
    onToggleReaction: (message: TimelineMessage, emoji: string) => react(message.id, emoji),
    onReply: replyTo,
    onToggleSelect: toggleSelected,
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
      <LiveRegion line={arrivalLine} testID="arrival-live-region" />
      <ConnectionBanner />
      {props.banner}
      {props.loading || props.onRetryLoad ? (
        <View className="flex-1 bg-chat-wall">
          {props.onRetryLoad ? <ConversationLoadError thread={Boolean(threadRootId)} onRetry={props.onRetryLoad} /> : <ConversationSkeleton />}
        </View>
      ) : (
        <View className="flex-1 bg-chat-wall">
          {!threadRootId ? <PinnedBar messages={messages} onJump={props.onQuoteJump} /> : null}
          <ChatWall room={room.room} scheme={colorScheme}>
            <TimelineList
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
              unread={unreadLine}
            />
            {!atLatest || props.onJumpToLatest ? <JumpToLatest count={newCount} onPress={jumpToLatest} /> : null}
          </ChatWall>
        </View>
      )}
      {selected.size > 0 ? (
        <ConversationSelection
          messages={messages}
          selected={selected}
          userId={userId}
          onReply={(message) => {
            setSelected(new Set());
            replyTo(message);
          }}
          onForward={(ids) => {
            const first = ids[0];
            if (!first) return;
            setSelected(new Set());
            sheets({ type: "open", sheet: { kind: "forward", messageId: first, messageIds: ids } });
          }}
          onCreateTask={(sources) => {
            const draft = taskDraftFromSources(sources);
            if (!draft) return;
            setSelected(new Set());
            sheets({ type: "open", sheet: { kind: "createTask", ...draft, count: sources.length } });
          }}
          onDelete={(ids) => {
            setSelected(new Set());
            void Promise.all(ids.map((id) => removeMessage.mutateAsync(id))).catch(() => toast.error(t("chat.message_list.delete_failed")));
          }}
          onClear={() => setSelected(new Set())}
        />
      ) : (
      <Composer
        draftKey={composerDraftKey}
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
          actions.saveEdit(messageId, body);
        }}
        onTyping={actions.signalTyping}
        onSendVoice={(clip) =>
          enqueue({
            body: "",
            file: { uri: clip.uri, name: "voice.m4a", mimeType: "audio/mp4" },
            voiceDurationMs: clip.durationMs,
            replyToMessageId: takeReply(),
          })
        }
        onOpenExpressions={() => sheets({ type: "open", sheet: { kind: "expressions" } })}
        onOpenReminder={() => sheets({ type: "open", sheet: { kind: "reminder" } })}
        onOpenPoll={
          !threadRootId && room.room?.kind !== "dm" && room.room?.member_permissions?.allow_create_polls !== false
            ? () => sheets({ type: "open", sheet: { kind: "poll" } })
            : undefined
        }
        onOpenNote={
          !threadRootId && room.room?.member_permissions?.allow_create_notes !== false
            ? () => sheets({ type: "open", sheet: { kind: "note" } })
            : undefined
        }
        onOpenPost={
          !threadRootId && room.room?.member_permissions?.allow_create_notes !== false
            ? () => sheets({ type: "open", sheet: { kind: "post" } })
            : undefined
        }
        onOpenDocuments={
          !threadRootId && room.room?.can_send_document === true ? () => sheets({ type: "open", sheet: { kind: "documents" } }) : undefined
        }
      />
      ) }
      <ExpressionSheet
        wsId={wsId}
        visible={sheet.kind === "expressions"}
        onClose={() => sheets({ type: "close", kind: "expressions" })}
        onPick={send}
      />
      <ReminderSheet
        visible={sheet.kind === "reminder"}
        onClose={() => sheets({ type: "close", kind: "reminder" })}
        onCreate={(input) =>
          enqueue({ body: "", reminder: { body: input.body.trim(), remindAt: input.remindAt.toISOString(), repeat: input.repeat } })
        }
      />
      <PollSheet
        visible={sheet.kind === "poll"}
        onClose={() => sheets({ type: "close", kind: "poll" })}
        onCreate={(input) => enqueue({ body: input.question, poll: input, replyToMessageId: takeReply() })}
      />
      <NoteSheet
        visible={sheet.kind === "note"}
        onClose={() => sheets({ type: "close", kind: "note" })}
        onCreate={(body) => enqueue({ body, note: { body }, replyToMessageId: takeReply() })}
      />
      <PostSheet
        visible={sheet.kind === "post"}
        onClose={() => sheets({ type: "close", kind: "post" })}
        onCreate={(input) => enqueue({ body: input.title, post: input, replyToMessageId: takeReply() })}
      />
      <DocumentPickSheet
        wsId={wsId}
        visible={sheet.kind === "documents"}
        onClose={() => sheets({ type: "close", kind: "documents" })}
        onPick={(document) => enqueue({ body: document.title, documentId: document.id, replyToMessageId: takeReply() })}
      />
      <ConversationCreateTaskSheet
        sheet={sheet}
        onClose={() => sheets({ type: "close", kind: "createTask" })}
        create={(input) => createTask.mutateAsync(input)}
      />
      <LinkTaskSheet
        wsId={wsId}
        message={sheet.kind === "linkTask" && sheet.message.record ? sheet.message.record : null}
        onClose={() => sheets({ type: "close", kind: "linkTask" })}
        onLink={(messageId, taskId) => void linkTask.mutateAsync({ messageId, taskId }).catch(() => toast.error(t("chat.link.link_error")))}
      />
      <MessageActionsSheet
        message={actionMessage}
        own={actionMessage?.sender === userId}
        senderName={actionMessage ? room.senderName(actionMessage) : undefined}
        seenBy={seenByOf(actionMessage)}
        avatar={
          actionMessage && room.isGroup && actionMessage.sender !== userId ? (
            <PersonAvatar name={room.senderName(actionMessage)} size={30} seed={actionMessage.sender} />
          ) : undefined
        }
        inThread={Boolean(threadRootId)}
        followUp={actionMessage ? followUpOf(actionMessage.id) : null}
        {...actions.sheet}
        onSelect={(message) => setSelected(new Set([message.id]))}
        onLinkTask={(message) => sheets({ type: "open", sheet: { kind: "linkTask", message } })}
        onShareAsDocument={(message) => void shareDocument.mutateAsync(message.id).catch(() => toast.error(t("common.error")))}
      />
      <ReportSheet
        wsId={wsId}
        target={sheet.kind === "report" ? { kind: "message", messageId: sheet.messageId, name: sheet.name } : null}
        blockUserId={sheet.kind === "report" ? sheet.senderId : undefined}
        onClose={() => sheets({ type: "close", kind: "report" })}
        // A block hides the DM from the one who blocked (ChatService.hideDMWithPeer): back to the list.
        onReported={(blocked) => blocked && room.room?.kind === "dm" && router.dismissAll()}
      />
      <EmojiSheet
        visible={sheet.kind === "emoji"}
        onClose={() => sheets({ type: "close", kind: "emoji" })}
        onPick={(emoji) => {
          if (sheet.kind === "emoji") react(sheet.message.id, emoji);
          sheets({ type: "close", kind: "emoji" });
        }}
      />
      <ForwardSheet
        chat={chat}
        messageId={sheet.kind === "forward" ? sheet.messageId : null}
        messageIds={sheet.kind === "forward" ? sheet.messageIds : undefined}
        onClose={() => sheets({ type: "close", kind: "forward" })}
      />
      <LinkSheet url={sheet.kind === "link" ? sheet.url : null} onClose={() => sheets({ type: "close", kind: "link" })} />
      <ImageViewer wsId={wsId} roomId={roomId} photos={photos} opened={image} onClose={() => sheets({ type: "close", kind: "image" })} />
    </KeyboardAvoidingView>
  );
}
