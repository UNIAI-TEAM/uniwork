"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { chatKeys } from "./hooks";
import {
  type ChatOutboxDelivery,
  type ChatTextSendPayload,
  deliverChatOutboxEntry,
  deliverChatTextMessage,
  flushChatSendOutbox,
} from "./deliver-chat-text-message";
import { applyChatMessageResponse } from "./realtime-cache";
import { useChatSendOutboxStore } from "./send-outbox-store";
import { useOptionalWS, useWSReconnect } from "../realtime";

function useBrowserOnline(callback: () => void): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => callback();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [callback]);
}

/** Sends one stored text message and puts the server's copy in the room cache. */
function useDeliverChatText(workspaceId: string) {
  const qc = useQueryClient();
  return useCallback(
    async (payload: ChatTextSendPayload) => {
      const message = await deliverChatTextMessage(workspaceId, payload);
      applyChatMessageResponse(qc, workspaceId, payload.roomId, message, true);
    },
    [qc, workspaceId],
  );
}

/**
 * Drain persisted pending text sends when the browser or WS connection recovers.
 * `onDropped` hears how many the server refused for good; pass a stable callback.
 */
export function useChatSendOutboxFlush(
  workspaceId: string,
  senderId: string,
  onDropped?: (count: number) => void,
): void {
  const qc = useQueryClient();
  const deliver = useDeliverChatText(workspaceId);
  const flushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (!workspaceId || !senderId || flushingRef.current) return;
    const pending = useChatSendOutboxStore.getState().listForWorkspace(workspaceId, senderId);
    if (pending.length === 0) return;

    flushingRef.current = true;
    try {
      const { dropped } = await flushChatSendOutbox(workspaceId, senderId, deliver);
      if (dropped > 0) onDropped?.(dropped);
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    } finally {
      flushingRef.current = false;
    }
  }, [qc, deliver, senderId, workspaceId, onDropped]);

  const flushVoid = useCallback(() => {
    void flush();
  }, [flush]);
  useBrowserOnline(flushVoid);
  useWSReconnect(flushVoid);

  const ws = useOptionalWS();
  useEffect(() => {
    if (!ws?.client) return;
    return ws.client.onConnectionStateChange((state) => {
      if (state === "connected") void flush();
    });
  }, [flush, ws?.client]);
}

/**
 * "Thử lại" on a failed bubble: the same entry, the same client_msg_id, down
 * the path the reconnect flush uses. Null when there is nothing to send (it
 * landed meanwhile, or is already on its way).
 */
export function useRetryChatSend(workspaceId: string): (clientMsgId: string) => Promise<ChatOutboxDelivery | null> {
  const qc = useQueryClient();
  const deliver = useDeliverChatText(workspaceId);
  return useCallback(
    async (clientMsgId: string) => {
      const entry = useChatSendOutboxStore
        .getState()
        .entries.find((item) => item.client_msg_id === clientMsgId && item.workspaceId === workspaceId);
      if (!entry) return null;
      const result = await deliverChatOutboxEntry(entry, deliver);
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
      return result;
    },
    [qc, deliver, workspaceId],
  );
}

export function useChatSendOutboxCount(workspaceId: string, senderId: string): number {
  return useChatSendOutboxStore((state) => state.countForWorkspace(workspaceId, senderId));
}
