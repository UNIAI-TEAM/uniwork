// What the signed-in app keeps in step with the server whatever screen is
// open (mounted once in app/(app)/_layout.tsx, so the workspace picker too):
//   - what the phone owes (owed.ts: the outbox and the queued reads,
//     reactions and votes of every workspace) as soon as the session and the
//     queues are read, on NetInfo's offline → online edge without waiting for
//     any socket, on every return to the front, and as the app leaves it: a
//     message written just before a switch goes while JavaScript still runs
//     (Android until the process is frozen, iOS its few seconds; the socket's
//     25 s grace keeps the path warm). A workspace's socket reconnect adds its
//     own flush (realtime/use-chat-realtime.ts). Nothing drains the outbox
//     while the app stays away: iOS needs a custom module for
//     beginBackgroundTask, and an OS-scheduled periodic task
//     (expo-background-task: WorkManager, BGProcessingTask) runs at 15 minutes
//     at best and adds WorkManager's own manifest entries, which
//     scripts/android-manifest.mjs does not see (it reads linked packages, not
//     Maven libraries), so the Play declarations could not be checked here;
//   - the offline copy (timeline-refresh.ts): the recent rooms whose cached
//     timeline is behind are read once as the app leaves the front, and a push
//     about a room, received in front or tapped, reads that room's newest page.
import NetInfo from "@react-native-community/netinfo";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState } from "react-native";
import { authConfig } from "./auth/flow";
import { flushOwed } from "./owed";
import { bestEffort } from "./report";
import { hydrateFromPush, refreshStaleTimelines } from "./timeline-refresh";

/** `userId` is null until the session and the queues are read (auth store's isLoading). */
export function useAccountSync(userId: string | null): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const flush = () => void flushOwed(qc, userId);
    const hydrate = (data: unknown) =>
      void hydrateFromPush(qc, data, { appUrl: runtimeConfig().appUrl, scheme: authConfig.scheme }).catch(bestEffort("push", "push not read into the cache", "report"));
    flush();
    let wasOnline = onlineManager.isOnline();
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true;
      if (online && !wasOnline) flush();
      wasOnline = online;
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") flush();
      if (state !== "background") return;
      flush();
      if (onlineManager.isOnline()) void refreshStaleTimelines(qc).catch(bestEffort("offline-cache", "stale rooms not refreshed", "report"));
    });
    const received = Notifications.addNotificationReceivedListener((notification) => hydrate(notification.request.content.data));
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => hydrate(response.notification.request.content.data));
    return () => {
      unsubscribeNet();
      appState.remove();
      received.remove();
      tapped.remove();
    };
  }, [qc, userId]);
}
