"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "./chat-messages";
import { replyPreviewLabel } from "./chat-reply-quote";

/**
 * The one place the timeline speaks. The list itself is silent (a virtual
 * list mounting rows on scroll would otherwise read them out), and this
 * region says only what just arrived at the bottom from someone else —
 * never history loading above, the first page of a room, or a reaction
 * count changing on a message already there.
 */
export function NativeChatLiveRegion({
  roomId,
  messages,
  currentUserId,
  senderLabelOf,
}: {
  roomId: string;
  messages: ChatMessage[];
  currentUserId: string;
  senderLabelOf: (message: ChatMessage) => string;
}) {
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState("");
  const lastSeenRef = useRef<{ roomId: string; lastId: string | null } | null>(null);

  const lastId = messages[messages.length - 1]?.id ?? null;

  useEffect(() => {
    const previous = lastSeenRef.current;
    lastSeenRef.current = { roomId, lastId };
    // A new room, or its first page arriving: nothing is "new" yet.
    if (!previous || previous.roomId !== roomId || !previous.lastId || !lastId || previous.lastId === lastId) {
      if (previous?.roomId !== roomId) setAnnouncement("");
      return;
    }
    const previousIndex = messages.findIndex((message) => message.id === previous.lastId);
    // The old last message is gone (a jump elsewhere replaced the window): not an arrival.
    if (previousIndex < 0) return;
    const arrived = messages
      .slice(previousIndex + 1)
      .filter((message) => message.sender !== currentUserId && !message.deliveryStatus);
    const latest = arrived[arrived.length - 1];
    if (!latest) return;
    const preview = replyPreviewLabel(latest, {
      voice: t("chat.voice_message"),
      file: t("chat.file_untitled"),
      media: { sticker: t("chat.media_sticker"), gif: t("chat.media_gif"), image: t("chat.media_image") },
    });
    setAnnouncement(t("chat.message_list.live_new_message", { sender: senderLabelOf(latest), preview }));
  }, [currentUserId, lastId, messages, roomId, senderLabelOf, t]);

  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  );
}
