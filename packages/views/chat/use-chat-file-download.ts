"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "./chat-messages";
import { toastChatError } from "./chat-error-message";
import { useFreshChatMediaUrl } from "./use-chat-media-url";

/**
 * Downloads a file message straight from storage: the signed download URL
 * carries Content-Disposition: attachment with the file's name, so the browser
 * saves it even though the anchor's own download attribute is ignored
 * cross-origin. The message is picked at click time, so one hook serves every
 * photo of an album viewer.
 */
export function useChatFileDownload(workspaceId: string, roomId: string) {
  const { t } = useTranslation();
  const freshUrl = useFreshChatMediaUrl(workspaceId, roomId);
  const [busy, setBusy] = useState(false);
  const download = async (message: ChatMessage) => {
    if (busy) return;
    setBusy(true);
    try {
      const url = await freshUrl(
        message.id,
        { url: message.file?.download_url, expiresAt: message.file?.url_expires_at },
        (fresh) => fresh.file?.download_url,
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = message.file?.filename || "file";
      anchor.rel = "noopener";
      anchor.click();
    } catch (err) {
      toastChatError(err, t, t("chat.file_download_failed"));
    } finally {
      setBusy(false);
    }
  };
  return { busy, download: (message: ChatMessage) => void download(message) };
}
