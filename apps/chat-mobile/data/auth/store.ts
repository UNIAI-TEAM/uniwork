// Ported from usf apps/mobile/data/auth-store.ts: the Zustand half of auth
// (user + loading) over the native session. The token lifecycle, the epoch
// and the Keychain are the session's; the store only asks it and loads /me.
//
// A cold start is offline-first: the stored credential, the last
// signed-in person, the workspace and the unsent messages are read together;
// with a credential and a stored person the inbox opens at once, on the cached
// rooms, and /me revalidates behind it. Only a server verdict signs out (the
// session's onChange(null), the api layer's onUnauthorized): offline, a 5xx or
// a timeout keep the person in.
import type { User } from "@uniwork/core/types/user";
import { create } from "zustand";
import { ApiError, api } from "../api";
import { chatSendDeps, clearChatOutbox } from "../chat-send";
import { clearPendingOps, pendingOpsDeps } from "../pending-ops";
import { wipeDeviceTraces, wipeSessionTraces } from "../local-wipe";
import { firstLaunchOfInstall } from "../install-marker";
import { forgetPushToken, unregisterPushToken } from "../push";
import { workspaceListOptions } from "../queries/workspaces";
import { queryClient } from "../query-client";
import { dropAccountCache, restoreAccountCache } from "../query-persister";
import { clearAccountCache } from "../remote-config";
import { bestEffort, setReportUser } from "../report";
import { currentSessionEpoch } from "../session-epoch";
import { hydrateChatSendStore, useChatSendStore } from "../stores/chat-send-store";
import { hydrateDraftStore, useDraftStore } from "../stores/draft-store";
import { hydratePendingOpsStore, usePendingOpsStore } from "../stores/pending-ops-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { openDeviceStore } from "../storage/device-store";
import { session } from "./flow";
import { forgetLastUser, readLastUser, rememberUser } from "./last-user";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  /** boot: restore the stored session, then /me */
  initialize: () => Promise<void>;
  /** the browser sign-in, then /me; resolves without a user when the person dismissed it */
  login: () => Promise<void>;
  /** a session adopted outside login() (a deep-link callback after a dismissed browser): /me, once, no restore */
  adoptSession: () => Promise<void>;
  logout: () => Promise<void>;
  /**
   * After POST /me/delete: the server already ended every session and push
   * subscription of the account, so nothing is asked of it; everything the
   * account left on this phone is wiped (data/local-wipe.ts).
   */
  accountDeleted: () => Promise<void>;
  /** overwrite the in-memory user after PATCH /me; the server response is the source of truth */
  setUser: (user: User) => void;
}

let inflight: Promise<User | null> | null = null;

/** The push unsubscribe may hold a sign-out up this long, no longer (offline, a slow server). */
export const PUSH_UNREGISTER_BUDGET_MS = 3_000;

/**
 * Every sign-out drops this phone's push subscription first, while a live
 * session can still authorize the call (otherwise push kept arriving after a
 * sign-out). A sign-out the server made (the session is already over) cannot
 * call; the server skips an ended device session's subscription itself.
 */
async function dropPushSubscription(): Promise<void> {
  if (session.status() === "signed-out") {
    forgetPushToken();
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, PUSH_UNREGISTER_BUDGET_MS);
  });
  await Promise.race([unregisterPushToken(api).catch(bestEffort("auth", "push not unregistered", "report")), budget]);
  clearTimeout(timer);
}

/** Crash reports name the signed-in person by opaque id only. */
function adoptUser(user: User | null): User | null {
  setReportUser(user?.id ?? null);
  return user;
}

/**
 * One /me at a time: login() and the session's onChange may ask together.
 * A 401 ends the session only when the session already ended it (a server
 * verdict on refresh); a 401 the api layer let through while the server is
 * unreachable, a network blip or a 5xx keep it for the next attempt.
 */
function loadUser(): Promise<User | null> {
  const epoch = currentSessionEpoch();
  inflight ??= api
    .getMe()
    .then((user) => {
      if (user) void rememberUser(user, epoch);
      return user;
    })
    .catch(async (error: unknown) => {
      if (error instanceof ApiError && error.status === 401 && session.status() === "signed-out") await session.logout();
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The session moves the epoch first, then clears the Keychain and revokes the
 * device (a revoke the server refuses is dropped). The next account on this
 * device must not land in this one's workspace, nor see its cached rooms,
 * messages or unsent bubbles (the remote config stays under the update gate
 * and is asked again).
 */
async function endAccountSession(): Promise<void> {
  await session.logout();
  await forgetAccountLocally();
}

/**
 * Everything an account left on this phone besides its session: workspace, stored person, cached rooms, queues and
 * their files, drafts, and the cached photos, tray notifications and badge (data/local-wipe.ts › wipeSessionTraces).
 */
async function forgetAccountLocally(): Promise<void> {
  await Promise.all([useWorkspaceStore.getState().clear(), forgetLastUser(), dropAccountCache(), wipeSessionTraces()]);
  clearAccountCache(queryClient, openDeviceStore);
  clearChatOutbox(chatSendDeps);
  clearPendingOps(pendingOpsDeps);
  useDraftStore.getState().clearAll();
}

/** Something of the last person is still on this phone: who they were, what they queued, or what they left unsent. */
function leftTraces(lastUser: User | null): boolean {
  return (
    lastUser !== null ||
    useChatSendStore.getState().entries.length > 0 ||
    usePendingOpsStore.getState().ops.length > 0 ||
    Object.keys(useDraftStore.getState().drafts).length > 0
  );
}

/** What the device kept across the last run: the unsent messages, the queued reads, reactions and votes, and the drafts. */
async function hydrateDeviceState(): Promise<void> {
  await Promise.all([hydrateChatSendStore(), hydratePendingOpsStore(), hydrateDraftStore()]);
}

let adopting: Promise<void> | null = null;

/**
 * A sign-in's /me, and that person's cached rooms before the first screen.
 * login() and the session's onChange (adoptSession) both ask on every
 * interactive sign-in: they share one adoption.
 */
function adoptLoadedUser(set: (partial: Partial<AuthState>) => void): Promise<void> {
  adopting ??= (async () => {
    const user = await loadUser();
    if (user) await restoreAccountCache(user.id);
    set({ user: adoptUser(user) });
  })().finally(() => {
    adopting = null;
  });
  return adopting;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,

  initialize: async () => {
    // iOS keeps Keychain items when the app is deleted: on the first launch of a new install, the previous install's
    // session and person are discarded (its device revoked in the background), never resumed.
    if (await firstLaunchOfInstall()) await Promise.all([session.discardStored(), forgetLastUser()]);
    const [hasCredential, lastUser] = await Promise.all([
      session.restore({ awaitRefresh: false }),
      readLastUser(),
      useWorkspaceStore.getState().restore(),
      hydrateDeviceState(),
    ]);
    // A refresh that the server refused while the rest was read ended the session already (its onChange(null)
    // found nobody to sign out): what the last person left here goes as on a sign-out, so the next account
    // never sees, or posts as itself, their unsent messages.
    if (!hasCredential || session.status() === "signed-out") {
      if (leftTraces(lastUser)) await forgetAccountLocally();
      set({ isLoading: false });
      return;
    }
    if (lastUser) {
      await restoreAccountCache(lastUser.id);
      set({ user: adoptUser(lastUser), isLoading: false });
      // Behind the inbox: a fresh profile replaces the stored one; no answer keeps it.
      void loadUser().then((user) => {
        if (user && get().user?.id === user.id) set({ user: adoptUser(user) });
      });
      return;
    }
    // No stored person yet (the first start of this build): /me decides, as before.
    const user = await loadUser();
    if (user) await restoreAccountCache(user.id);
    else if (session.status() === "signed-out" && leftTraces(null)) await forgetAccountLocally();
    set({ user: adoptUser(user), isLoading: false });
  },

  login: async () => {
    await session.login();
    if (session.status() !== "signed-in") return;
    await adoptLoadedUser(set);
  },

  adoptSession: async () => {
    if (get().user) return;
    await adoptLoadedUser(set);
  },

  logout: async () => {
    set({ user: null });
    setReportUser(null);
    await dropPushSubscription();
    await endAccountSession();
  },

  accountDeleted: async () => {
    // Read before the cache goes: the workspaces whose pins this phone keeps.
    const workspaceIds = (queryClient.getQueryData(workspaceListOptions().queryKey) ?? []).map((w) => w.id);
    set({ user: null });
    setReportUser(null);
    forgetPushToken();
    await endAccountSession();
    await wipeDeviceTraces(workspaceIds);
  },

  setUser: (user) => {
    set({ user });
    void rememberUser(user, currentSessionEpoch());
  },
}));
