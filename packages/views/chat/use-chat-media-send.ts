"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, errorCode } from "@uniwork/core/api";
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import { CHAT_FILE_MAX_LABEL, isChatFileTooLarge } from "./chat-file-accept";

type EnsureRoomResult = { room_id?: string } | null | undefined;

export function useChatMediaSend({
  activeRoomId,
  targetKind,
  replyToId,
  ensureRoom,
  sendVoiceMessage,
  sendFileMessage,
  clearReply,
}: {
  activeRoomId: string | null;
  targetKind: "workspace" | "dm" | "group" | "channel";
  replyToId?: string;
  ensureRoom: { mutateAsync: () => Promise<EnsureRoomResult> };
  sendVoiceMessage: {
    mutateAsync: (input: {
      roomId: string;
      file: Blob;
      duration_ms: number;
      client_msg_id: string;
      reply_to_message_id?: string;
    }) => Promise<unknown>;
  };
  sendFileMessage: {
    mutateAsync: (input: {
      roomId: string;
      file: Blob;
      filename: string;
      client_msg_id: string;
      reply_to_message_id?: string;
    }) => Promise<unknown>;
  };
  clearReply: () => void;
}) {
  const { t } = useTranslation();

  const resolveRoomId = useCallback(async () => {
    let roomId = activeRoomId;
    if (!roomId && targetKind === "workspace") {
      const room = await ensureRoom.mutateAsync();
      roomId = room?.room_id ?? null;
    }
    return roomId;
  }, [activeRoomId, ensureRoom, targetKind]);

  const handleSendVoice = useCallback(
    async ({ blob, durationMs }: { blob: Blob; durationMs: number }) => {
      const roomId = await resolveRoomId();
      if (!roomId) throw new Error(t("chat.room_load_failed"));
      await sendVoiceMessage.mutateAsync({
        roomId,
        file: blob,
        duration_ms: durationMs,
        client_msg_id: newChatClientMsgId(),
        reply_to_message_id: replyToId,
      });
      clearReply();
    },
    [clearReply, replyToId, resolveRoomId, sendVoiceMessage, t],
  );

  const handleSendFile = useCallback(
    async (file: File) => {
      const roomId = await resolveRoomId();
      if (!roomId) {
        toast.error(t("chat.room_load_failed"));
        return;
      }
      if (isChatFileTooLarge(file)) {
        toast.error(t("chat.file_too_large", { max: CHAT_FILE_MAX_LABEL }));
        return;
      }
      try {
        await sendFileMessage.mutateAsync({
          roomId,
          file,
          filename: file.name,
          client_msg_id: newChatClientMsgId(),
          reply_to_message_id: replyToId,
        });
        clearReply();
      } catch (err) {
        const tooLarge = errorCode(err) === "too_large" || (err instanceof ApiError && err.status === 413);
        toast.error(tooLarge ? t("chat.file_too_large", { max: CHAT_FILE_MAX_LABEL }) : t("chat.file_upload_failed"));
      }
    },
    [clearReply, replyToId, resolveRoomId, sendFileMessage, t],
  );

  return { handleSendVoice, handleSendFile };
}
