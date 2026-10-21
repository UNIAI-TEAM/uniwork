// Ported from usf apps/mobile/data/auth-store.ts: the Zustand half of auth
// (user + loading) over the native session. The token lifecycle, the epoch
// and the Keychain are the session's; the store only asks it and loads /me.
import type { User } from "@uniwork/core/types/user";
import { create } from "zustand";
import { ApiError, api } from "../api";
import { wipeDeviceTraces } from "../local-wipe";
import { forgetPushToken, unregisterPushToken } from "../push";
import { workspaceListOptions } from "../queries/workspaces";
import { queryClient } from "../query-client";
import { clearAccountCache } from "../remote-config";
import { setReportUser } from "../report";
import { useChatSendStore } from "../stores/chat-send-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { session } from "./flow";

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
 * session can still authorize the call (audit P2: push kept arriving after a
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
  await Promise.race([unregisterPushToken(api).catch(() => undefined), budget]);
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
  inflight ??= api
    .getMe()
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
  await useWorkspaceStore.getState().clear();
  clearAccountCache(queryClient);
  useChatSendStore.getState().clear();
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,

  initialize: async () => {
    await session.restore();
    if (!(await session.getAccessToken())) {
      set({ isLoading: false });
      return;
    }
    set({ user: adoptUser(await loadUser()), isLoading: false });
  },

  login: async () => {
    await session.login();
    if (session.status() !== "signed-in") return;
    set({ user: adoptUser(await loadUser()) });
  },

  adoptSession: async () => {
    if (get().user) return;
    set({ user: adoptUser(await loadUser()) });
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

  setUser: (user) => set({ user }),
}));
