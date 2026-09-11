"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { chatKeys } from "./hooks";
import { deliverChatTextMessage, flushChatSendOutbox } from "./deliver-chat-text-message";
import { usePendingChatMessagesStore } from "./pending-messages-store";
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

/** Drain persisted pending text sends when the browser or WS connection recovers. */
export function useChatSendOutboxFlush(workspaceId: string, senderId: string): void {
  const qc = useQueryClient();
  const flushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (!workspaceId || !senderId || flushingRef.current) return;
    const pending = useChatSendOutboxStore.getState().listForWorkspace(workspaceId);
    if (pending.length === 0) return;

    flushingRef.current = true;
    try {
      await flushChatSendOutbox(workspaceId, senderId, (payload) =>
        deliverChatTextMessage(workspaceId, payload),
      );
      for (const entry of pending) {
        void qc.invalidateQueries({
          queryKey: chatKeys.roomMessages(workspaceId, entry.roomId),
        });
      }
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    } finally {
      flushingRef.current = false;
    }
  }, [qc, senderId, workspaceId]);

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

export function useChatSendOutboxCount(workspaceId: string): number {
  return useChatSendOutboxStore((state) => state.countForWorkspace(workspaceId));
}
