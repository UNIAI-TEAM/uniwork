// A chat message push read into the cache while UniChat is closed (review "no-background-sync-from-push"). On
// Android every Expo push reaches the background notification task (calls/call-wiring.ts › runCallPushTask), the
// visible ones included; for a chat message the task reads that room's newest page and its workspace's rooms list
// into the cache and saves it to the encrypted store before it ends, so the notification tapped later — offline
// included — opens on the message instead of a cold room. A running app does the same from its notification
// listener (use-account-sync.ts › hydrateFromPush) and on leaving the front (refreshStaleTimelines), so an app on
// screen is left to those. Where no screen booted, the task boots the runtime, opens the store and restores the
// session and the person's kept copy first, as a Reply from the notification does (chat-notification-actions.ts).
//
// Best effort and bounded: after PUSH_PREFETCH_BUDGET_MS the task lets go, keeping what landed, so a slow network
// never holds a headless runtime awake; a failure is a breadcrumb and never reaches the task. A phone signed out
// reads nothing. iOS runs no task for a visible push of a closed app (that needs content-available and a background
// task of its own), so there the cache is read on the tap, as before.
import { AppState } from "react-native";
import { chatPushTarget } from "@/lib/chat-notification";
import { session } from "../auth/flow";
import { readLastUser } from "../auth/last-user";
import { bootRuntime } from "../boot";
import { queryClient } from "../query-client";
import {
  accountCacheInstalled,
  accountCacheUser,
  createDevicePersister,
  installAccountCache,
  restoreAccountCache,
  saveAccountCacheNow,
} from "../query-persister";
import { bestEffort } from "../report";
import { deviceStoreInstalled, installDeviceStore, openDeviceStore } from "../storage/device-store";
import { openNativeDeviceStore } from "../storage/native-device-store";
import { hydrateRoom } from "../timeline-refresh";

/** How long the task may read before it lets go: two GETs on a fair network take well under it. */
export const PUSH_PREFETCH_BUDGET_MS = 15_000;

export interface PushPrefetchEnv {
  /** UniChat is on screen: its notification listener reads the push. */
  inFront: () => boolean;
  /** The signed-in person's cache ready to read into (a headless runtime set up first); false when nobody is signed in. */
  prepare: () => Promise<boolean>;
  /** The room's newest page and its workspace's list. */
  read: (workspaceId: string, roomId: string) => Promise<void>;
  /** What memory holds, saved to disk now. */
  save: () => Promise<void>;
  budgetMs: number;
}

export type PushPrefetchOutcome = "prefetched" | "in-app" | "not-chat" | "signed-out" | "timeout" | "failed";

/** Reads the room a chat message push names into the cache and saves it; anything else is left alone. Never throws. */
export async function prefetchChatPush(data: unknown, env: PushPrefetchEnv): Promise<PushPrefetchOutcome> {
  const target = chatPushTarget(data);
  if (!target) return "not-chat";
  if (env.inFront()) return "in-app";
  const work = (async (): Promise<PushPrefetchOutcome> => {
    if (!(await env.prepare())) return "signed-out";
    await env.read(target.workspaceId, target.roomId);
    return "prefetched";
  })().catch((error: unknown): PushPrefetchOutcome => {
    bestEffort("push", "chat push not read into the cache", "breadcrumb")(error);
    return "failed";
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<PushPrefetchOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), env.budgetMs);
  });
  const outcome = await Promise.race([work, budget]);
  clearTimeout(timer);
  // What landed before a timeout or a failure is worth keeping too; a phone signed out has no copy to write.
  if (outcome !== "signed-out") await env.save();
  return outcome;
}

/** The app's env: a running app has all of it; a headless task boots, opens the encrypted store and restores the copy. */
export const appPushPrefetchEnv: PushPrefetchEnv = {
  inFront: () => AppState.currentState === "active",
  async prepare() {
    bootRuntime();
    if (!deviceStoreInstalled()) installDeviceStore(openNativeDeviceStore);
    if (!accountCacheInstalled()) installAccountCache({ queryClient, persister: createDevicePersister(openDeviceStore) });
    if (session.status() === "signed-out" && !(await session.restore())) return false;
    const user = await readLastUser();
    if (!user) return false;
    if (accountCacheUser() !== user.id) await restoreAccountCache(user.id);
    return true;
  },
  read: (workspaceId, roomId) => hydrateRoom(queryClient, workspaceId, roomId),
  save: saveAccountCacheNow,
  budgetMs: PUSH_PREFETCH_BUDGET_MS,
};
