"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { listChatRoomLinkPreviews, type ChatLinkPreview } from "../api/endpoints/chat-link-previews";
import { useAuthStore } from "../auth/store";
import { chatKeys } from "./chat-keys";
import { isPendingChatMessageId } from "./pending-message-id";

/** Matches the server batch cap for GET .../rooms/{id}/link-previews. */
const ROOM_LINK_PREVIEWS_BATCH = 200;
/** The server reads the first http(s) link of a text body (ADR 0035). */
const LINK_PATTERN = /\bhttps?:\/\//;
/** A sticker or GIF body is a picture, not a link with a card. */
const MEDIA_BODY_PATTERN = /^!\[[^\]]*\]\(https?:\/\/[^)\s]+\)$/;

const NO_PREVIEWS: ReadonlyMap<string, ChatLinkPreview> = new Map();

/**
 * The ids, oldest first and at most one batch (the newest), of the messages
 * that may carry a link card: on the server, with a link in a text body.
 */
export function linkPreviewCandidateIds(messages: readonly { id: string; body: string }[]): string[] {
  const ids = new Set<string>();
  for (const m of messages) {
    const body = m.body.trim();
    if (!isPendingChatMessageId(m.id) && LINK_PATTERN.test(body) && !MEDIA_BODY_PATTERN.test(body)) ids.add(m.id);
  }
  return [...ids].sort().slice(-ROOM_LINK_PREVIEWS_BATCH);
}

/**
 * Link cards for a room timeline, by message id, in one request for every
 * message with a link. A new link or `chat.message.preview_ready` asks again;
 * the cards already shown stay while it does.
 */
export function useChatRoomLinkPreviews(
  workspaceId: string,
  roomId: string,
  messages: readonly { id: string; body: string }[],
): ReadonlyMap<string, ChatLinkPreview> {
  const authReady = useAuthStore((s) => s.status === "authed");
  const fingerprint = linkPreviewCandidateIds(messages).join(",");
  const { data } = useQuery({
    queryKey: chatKeys.roomLinkPreviews(workspaceId, roomId, fingerprint),
    queryFn: () => listChatRoomLinkPreviews(workspaceId, roomId, fingerprint.split(",")),
    enabled: authReady && !!workspaceId && !!roomId && fingerprint !== "",
    placeholderData: keepPreviousData,
  });
  return useMemo(
    () => (data?.length ? new Map(data.map((p) => [p.message_id, p])) : NO_PREVIEWS),
    [data],
  );
}
