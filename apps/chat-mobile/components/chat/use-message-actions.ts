// What a conversation does to its messages: every server command it sends
// (through the mutation layer, data/mutations/messages.ts) and what each
// long-press action does, with the failure each one says. Conversation draws;
// this hook acts, so a new message action touches one unit.
import { deserializeMessageBodyToComposerDraft } from "@uniwork/core/chat/chat-mention-utils";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { haptics } from "@/components/ui/haptics";
import type { ChatFollowUp } from "@/data/chat-api-schemas";
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
} from "@/data/mutations/messages";
import { toast } from "@/data/stores/toast-store";
import { chatRoutes } from "@/lib/chat-routes";
import type { ConversationSheetAction } from "@/lib/conversation-sheets";
import type { TimelineMessage } from "@/lib/timeline-display";
import { taskDraftFromSources } from "./create-task-sheet";
import type { ChatWorkspace } from "./use-chat-workspace";

type FollowUpCommand = "create" | "complete" | "convert" | "remove";

interface Options {
  chat: ChatWorkspace;
  roomId: string;
  /** The person's open follow-up on a message, if any. */
  followUpOf: (messageId: string) => ChatFollowUp | null;
  senderName: (message: TimelineMessage) => string;
  sheets: (action: ConversationSheetAction) => void;
  /** Quote a message in the composer, or load it there to edit. */
  composer: { reply: (message: TimelineMessage) => void; edit: (message: TimelineMessage) => void };
}

export function useMessageActions({ chat, roomId, followUpOf, senderName, sheets, composer }: Options) {
  const { t } = useTranslation();
  const { wsId, userId } = chat;
  const send = useSendMessage(wsId, roomId, userId).mutate;
  const retrySend = useRetrySend().mutate;
  const discardSend = useDiscardSend();
  const editMessage = useEditMessage(wsId, roomId, userId).mutateAsync;
  const deleteMessage = useDeleteMessage(wsId, roomId, userId).mutateAsync;
  const togglePin = useTogglePin(wsId, roomId).mutateAsync;
  const toggleReaction = useReact(wsId, roomId, userId).mutateAsync;
  const vote = useVotePoll(wsId, roomId, userId).mutateAsync;
  const followUpCommand = useFollowUp(wsId).mutateAsync;
  const createTask = useCreateTask(wsId, roomId).mutateAsync;
  const signalTyping = useSignalTyping(wsId, roomId);
  const failed = useCallback(() => toast.error(t("common.error")), [t]);

  const react = (messageId: string, emoji: string) => {
    haptics.reaction();
    void toggleReaction({ messageId, emoji }).catch(() => toast.error(t("chat.message_list.react_failed")));
  };

  const votePoll = useCallback(
    (messageId: string, optionId: string) =>
      void vote({ messageId, optionId }).catch(() => toast.error(t("chat.message_list.poll_vote_failed"))),
    [vote, t],
  );

  const followUp = (message: TimelineMessage, command: FollowUpCommand) => {
    const open = followUpOf(message.id);
    let run: Promise<unknown>;
    if (command === "create") run = followUpCommand({ command: "create", id: message.id });
    else if (!open) run = Promise.resolve();
    else if (command === "convert") run = createTask({ followUpId: open.id });
    else run = followUpCommand({ command, id: open.id });
    void run.catch(() => toast.error(t(command === "convert" ? "chat.follow_up.convert_failed" : "chat.follow_up.update_failed")));
  };

  const confirmDelete = (message: TimelineMessage) =>
    Alert.alert(t("chat.message_list.delete_confirm_title"), t("chat.message_list.delete_confirm_description"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("chat.action_delete"),
        style: "destructive",
        onPress: () => void deleteMessage(message.id).catch(() => toast.error(t("chat.message_list.delete_failed"))),
      },
    ]);

  return {
    send,
    signalTyping,
    react,
    votePoll,
    saveEdit: (messageId: string, body: string) =>
      void editMessage({ messageId, body }).catch(() => toast.error(t("chat.message_list.edit_failed"))),
    /** The long-press menu's handlers (components/chat/message-actions.tsx). */
    sheet: {
      onClose: () => sheets({ type: "close", kind: "actions" }),
      onReact: (message: TimelineMessage, emoji: string) => react(message.id, emoji),
      onReply: composer.reply,
      onThread: (message: TimelineMessage) => router.push(chatRoutes.thread(chat, roomId, message.id)),
      onCopy: (message: TimelineMessage) => void Clipboard.setStringAsync(deserializeMessageBodyToComposerDraft(message.body)).catch(failed),
      onEdit: composer.edit,
      onDelete: confirmDelete,
      onFollowUp: followUp,
      onCreateTask: (message: TimelineMessage) => {
        const draft = taskDraftFromSources([{ id: message.id, body: message.record?.body ?? message.body, sentAt: message.ts }]);
        if (!draft) return;
        sheets({ type: "open", sheet: { kind: "createTask", ...draft, count: 1 } });
      },
      onRetry: (message: TimelineMessage) => {
        if (message.pending) retrySend(message.pending);
      },
      onDiscard: (message: TimelineMessage) => {
        if (message.pending) discardSend(message.pending.clientMsgId);
      },
      onMoreReactions: (message: TimelineMessage) => sheets({ type: "open", sheet: { kind: "emoji", message } }),
      onPin: (message: TimelineMessage) => void togglePin(message.id).catch(failed),
      onForward: (message: TimelineMessage) => sheets({ type: "open", sheet: { kind: "forward", messageId: message.id } }),
      onReport: (message: TimelineMessage) =>
        sheets({ type: "open", sheet: { kind: "report", messageId: message.id, senderId: message.sender, name: senderName(message) } }),
    },
  };
}
