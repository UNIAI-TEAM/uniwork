// The body of a conversation, shared by a room and a thread: the message list
// with day separators, quotes, "Đã xem" on a DM and the typing line; the
// composer; and the long-press sheet with what each action does to the
// server and the cache (send queue, reactions, edit, delete, copy, thread).
import { useQueryClient } from "@tanstack/react-query";
import { latestSeenOwnMessageIndex } from "@uniwork/core/chat/read-receipt-utils";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, KeyboardAvoidingView, View } from "react-native";
import { Text } from "@/components/ui/text";
import { deleteMessage, editMessage, toggleReaction } from "@/data/chat-actions";
import { chatApi } from "@/data/chat-api";
import { chatSendDeps, deliverPendingSend, discardPendingSend, sendChatMessage } from "@/data/chat-send";
import { chatRoutes } from "@/lib/chat-routes";
import { deserializeMessageBodyToComposerDraft } from "@/lib/mentions";
import { messagePreviewText } from "@/lib/message-display";
import type { PendingFile } from "@/lib/send-pipeline";
import { buildTimelineRows, type TimelineMessage, type TimelineRow } from "@/lib/timeline-display";
import { Composer, type ComposerEdit, type ComposerReply } from "./composer";
import { ImageViewer } from "./image-viewer";
import { MessageActionsSheet } from "./message-actions";
import type { MessageCardContext } from "./message-cards";
import { MessageList } from "./message-list";
import { MessageRow } from "./message-row";
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
  const [image, setImage] = useState<{ url: string; name: string } | null>(null);
  const { wsId, userId } = chat;

  const rows = useMemo(() => buildTimelineRows(messages), [messages]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  // A DM's single "Seen", on the latest own message the peer has read.
  const seenId = useMemo(() => {
    if (room.room?.kind !== "dm") return null;
    const index = latestSeenOwnMessageIndex(messages, userId, room.room.peer_last_read_at);
    return index >= 0 ? (messages[index]?.id ?? null) : null;
  }, [messages, room.room, userId]);

  const ctx: MessageCardContext = useMemo(
    () => ({ wsId, orgSlug: chat.orgSlug, wsSlug: chat.wsSlug, roomId, userId, onOpenImage: (url, name) => setImage({ url, name }) }),
    [wsId, chat.orgSlug, chat.wsSlug, roomId, userId],
  );

  const failed = useCallback(() => Alert.alert(t("common.error")), [t]);
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
    const own = message.sender === userId;
    const quotedId = message.replyToEventId;
    const quoted = quotedId ? byId.get(quotedId) : undefined;
    return (
      <MessageRow
        message={message}
        own={own}
        compactTop={row.compactTop}
        senderName={room.senderName(message)}
        showSender={room.isGroup && !own && row.showAvatar}
        quote={quotedId ? (quoted ? quoteOf(quoted) : { id: quotedId, sender: t("chat.action_reply"), text: "…" }) : null}
        seen={message.id === seenId}
        highlighted={message.id === props.jumpTo?.id}
        showThread={!threadRootId}
        ctx={ctx}
        onLongPress={setActionMessage}
        onPressQuote={props.onQuoteJump}
        onPressThread={(m) => router.push(chatRoutes.thread(chat, roomId, m.id))}
        onPressPending={setActionMessage}
        onToggleReaction={(m, emoji) => void toggleReaction(qc, wsId, roomId, m.id, emoji).catch(() => Alert.alert(t("chat.message_list.react_failed")))}
      />
    );
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background">
      {props.header}
      {props.banner}
      {props.loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator accessibilityLabel={t("common.loading")} />
        </View>
      ) : (
        <View className="flex-1">
          <MessageList
            rows={rows}
            renderMessage={renderMessage}
            onLoadOlder={props.onLoadOlder}
            loadingOlder={props.loadingOlder}
            jumpTo={props.jumpTo}
            onAtLatestChange={props.onAtLatestChange}
            bottom={room.typingLabel ? <Text className="px-4 pt-1 text-xs italic text-muted-foreground">{room.typingLabel}</Text> : null}
          />
        </View>
      )}
      <Composer
        candidates={room.candidates}
        canSend={room.canSend}
        allowAttachments={!threadRootId}
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
      />
      <MessageActionsSheet
        message={actionMessage}
        own={actionMessage?.sender === userId}
        inThread={Boolean(threadRootId)}
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
        onRetry={(m) => m.pending && void deliverPendingSend(qc, m.pending, chatSendDeps)}
        onDiscard={(m) => m.pending && discardPendingSend(m.pending.clientMsgId)}
      />
      <ImageViewer image={image} onClose={() => setImage(null)} />
    </KeyboardAvoidingView>
  );
}
