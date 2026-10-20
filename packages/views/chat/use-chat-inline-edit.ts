"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditChatMessage } from "@uniwork/core/chat";
import { chatErrorMessage } from "./chat-error-message";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import {
  deserializeMessageBodyToComposerDraft,
  mentionCandidatesFromBody,
  serializeComposerDraftToMessageBody,
} from "./chat-mention-utils";
import type { ChatMessage } from "./chat-messages";
import type { NameContextEntry } from "./native-chat-message-mapping";

/**
 * "Sửa" puts one composer into edit mode for the message: the composer shows
 * the edit bar and saves through here. A failed save keeps edit mode, with
 * the text, and says why; a save that changed nothing sends no request (no
 * "Đã sửa" mark). Switching rooms leaves edit mode.
 */
export function useChatInlineEdit({
  workspaceId,
  roomId,
  nameContext,
}: {
  workspaceId: string;
  roomId: string | null;
  nameContext: NameContextEntry[];
}) {
  const { t } = useTranslation();
  const editMessage = useEditChatMessage(workspaceId);
  const [message, setMessage] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);
  const start = useCallback((next: ChatMessage) => {
    setError(null);
    setMessage(next);
  }, []);

  useEffect(cancel, [roomId, cancel]);

  const save = async (draft: string) => {
    const body = draft.trim();
    if (!message || !roomId || !body) return;
    if (body === deserializeMessageBodyToComposerDraft(message.body).trim()) {
      cancel();
      return;
    }
    const candidates: ChatMentionCandidate[] = [
      ...mentionCandidatesFromBody(message.body),
      ...nameContext.map((entry) => ({ kind: "member" as const, userId: entry.user_id, label: entry.display_name })),
    ];
    setError(null);
    try {
      await editMessage.mutateAsync({
        roomId,
        messageId: message.id,
        body: serializeComposerDraftToMessageBody(body, candidates, t("chat.mention_all")),
      });
      setMessage(null);
    } catch (err) {
      setError(chatErrorMessage(err, t, t("chat.message_list.edit_failed")));
    }
  };

  return {
    /** The message being edited, or null when the composer writes a new one. */
    message,
    start,
    cancel,
    save,
    saving: editMessage.isPending,
    error,
  };
}
