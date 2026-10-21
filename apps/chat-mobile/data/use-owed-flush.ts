// When the phone pays what it owes (owed.ts): as soon as a signed-in session
// is ready (the messages kept from the last run), on NetInfo's offline →
// online edge without waiting for any socket, and on every return to the
// front. Mounted once for the signed-in app (app/(app)/_layout.tsx), so the
// outbox goes from the workspace picker too; a workspace's socket reconnect
// adds its own flush (realtime/use-chat-realtime.ts).
import NetInfo from "@react-native-community/netinfo";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";
import { flushOwed } from "./owed";

/** `userId` is null until the session and the queues are read (auth store's isLoading). */
export function useOwedFlush(userId: string | null): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const flush = () => void flushOwed(qc, userId);
    flush();
    let wasOnline = onlineManager.isOnline();
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true;
      if (online && !wasOnline) flush();
      wasOnline = online;
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") flush();
    });
    return () => {
      unsubscribeNet();
      appState.remove();
    };
  }, [qc, userId]);
}
