// The drain of a task (drain.ts holds the policy): Android's job, iOS's scheduled one, which may run where no screen
// booted. It boots the runtime, opens the encrypted store, seeds the kept server switches (a switch turned off must
// hold here too), restores the session, reads the person's queues, and asks NetInfo again (a runtime thawed in the
// background can hold the answer from before the network came back), as a Reply from a notification does
// (chat-notification-actions.ts › appChatActionEnv). In the running app each of those finds its work done.
import NetInfo from "@react-native-community/netinfo";
import { onlineManager } from "@tanstack/react-query";
import { isOnlineState } from "@/lib/reachability";
import { session } from "../auth/flow";
import { readLastUser } from "../auth/last-user";
import { bootRuntime } from "../boot";
import { queryClient } from "../query-client";
import { restoreRemoteConfig } from "../remote-config";
import { bestEffort } from "../report";
import { deviceStoreInstalled, installDeviceStore, openDeviceStore } from "../storage/device-store";
import { openNativeDeviceStore } from "../storage/native-device-store";
import { hydrateChatSendStore, useChatSendStore } from "../stores/chat-send-store";
import { hydratePendingOpsStore, usePendingOpsStore } from "../stores/pending-ops-store";
import { DRAIN_BUDGET_MS, type DrainEnv } from "./drain";
import { backgroundSendOn, deliverNow, owesNow } from "./drain-env";

/** The signed-in person with their queues read and the runtime ready to send for them; null when nobody is. */
async function readyForQueues(): Promise<string | null> {
  bootRuntime();
  if (!deviceStoreInstalled()) installDeviceStore(openNativeDeviceStore);
  await restoreRemoteConfig(queryClient, openDeviceStore).catch(bestEffort("remote-config", "kept answer not read", "breadcrumb"));
  if (session.status() === "signed-out" && !(await session.restore())) return null;
  const user = await readLastUser();
  if (!user) return null;
  if (!useChatSendStore.persist.hasHydrated()) await hydrateChatSendStore();
  if (!usePendingOpsStore.persist.hasHydrated()) await hydratePendingOpsStore();
  onlineManager.setOnline(isOnlineState(await NetInfo.refresh()));
  return user.id;
}

export const taskDrainEnv: DrainEnv = {
  prepare: readyForQueues,
  enabled: backgroundSendOn,
  deliver: deliverNow,
  owes: owesNow,
  budgetMs: DRAIN_BUDGET_MS,
};
