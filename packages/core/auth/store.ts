"use client";

import { create } from "zustand";
import * as auth from "../api/endpoints/auth";
import { getAccessToken, setAccessToken, subscribe as subscribeToToken } from "../api/session";
import { releaseHeldEditLocks } from "../documents/edit-lock-registry";
import { endOfficeDraftSession } from "../office/draft-session-key";
import { setCurrentWorkspace } from "../platform/workspace-storage";
import type { User } from "../types/user";
import { syncSessionHint } from "./session-hint";
import { getSessionProvider, registerSessionProvider, type SessionProvider } from "./session-provider";

export type SessionStatus = "loading" | "authed" | "anon";

export interface AuthState {
  user: User | null;
  status: SessionStatus;
  /**
   * Resolve the session from the refresh cookie. Idempotent: React StrictMode
   * runs mount effects twice and several layouts may call it, but the refresh
   * endpoint rotates the cookie, so only one call may ever reach it.
   */
  initialize: () => Promise<void>;
  setUser: (user: User) => void;
  /**
   * Trade the refresh cookie for a new access token after the server ended
   * the current one (a realtime socket closed with "session ended"). A
   * refused refresh clears the token, which drops the store to anon.
   */
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
  /** Platform hook run after logout — the web app clears the query cache here. */
  setOnLogout: (cb: (() => void) | null) => void;
}

let initInFlight: Promise<void> | null = null;
let initialized = false;
let onLogout: (() => void) | null = null;
// The last signed-in user, kept across a token loss so a different person
// signing in afterwards still counts as a session switch.
let lastUserId: string | null = null;

/**
 * Sign-out and session switch end the Office draft-recovery session: the key
 * is forgotten and the encrypted drafts are deleted (CONTRACT C18). A token
 * loss alone does not: the same person may sign back in without a reload.
 */
function endDraftSession(): void {
  lastUserId = null;
  void endOfficeDraftSession();
}

/** Host-owned session: take its access token, then ask the server who it belongs to. */
async function providerSession(p: SessionProvider): Promise<{ user: User } | null> {
  const token = await p.getAccessToken();
  setAccessToken(token);
  const user = token ? await auth.me() : null;
  // The host may drop the token while /me is in flight; a user without a token is not a session.
  return user && getAccessToken() !== null ? { user } : null;
}

/** Drop to anon. Logout callback runs only for an explicit logout, not token loss. */
function clearSession(runLogoutCallback = true): void {
  const state = useAuthStore.getState();
  if (state.user === null && state.status === "anon") return;
  useAuthStore.setState({ user: null, status: "anon" });
  // Leave the workspace scope with the session: workspace-keyed persisted
  // state (chat outbox, views) must not keep reading and writing the previous
  // user's namespace until some layout sets a new one.
  setCurrentWorkspace(null, null);
  if (runLogoutCallback) {
    endDraftSession();
    onLogout?.();
  }
}

/**
 * The access token itself stays in api/session (memory only — never
 * localStorage, so a script injection cannot lift it); this store owns the
 * user and the session status. Server data is never mirrored here beyond the
 * user object the session endpoint returns.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: "loading",

  initialize: () => {
    if (initialized) return Promise.resolve();
    initInFlight ??= (async () => {
      try {
        const provider = getSessionProvider();
        const sess = provider ? await providerSession(provider) : await auth.refreshSession();
        // Login/register may finish while refresh is still in flight; do not downgrade.
        if (useAuthStore.getState().status === "authed") return;
        set(sess?.user ? { user: sess.user, status: "authed" } : { user: null, status: "anon" });
      } catch {
        if (useAuthStore.getState().status !== "authed") {
          set({ user: null, status: "anon" });
        }
      } finally {
        initialized = true;
        initInFlight = null;
      }
    })();
    return initInFlight;
  },

  setUser: (user) => {
    initialized = true;
    set({ user, status: "authed" });
  },

  refreshSession: async () => {
    await auth.refreshSession();
  },

  logout: async () => {
    // Release this tab's document edit locks while the token still works
    // (UNI-1645 edge 10): best effort, at most 1 s; the server releases them
    // on session.revoked anyway.
    await releaseHeldEditLocks(1_000);
    clearSession();
    const provider = getSessionProvider();
    if (provider) {
      try {
        await provider.logout();
      } finally {
        setAccessToken(null);
      }
    } else {
      await auth.logout();
    }
  },

  setOnLogout: (cb) => {
    onLogout = cb;
  },
}));

// The token a host-emitted upgrade is resolving through /me, so one token runs once.
let upgrading: string | null = null;

// A failed refresh inside the transport clears the token without telling
// anyone. Drop to anon so the UI cannot keep rendering a stale session, but
// do not run logout cleanup — drafts stay for the same person signing back in.
// The reverse only exists with a session provider: the host finishing its
// login hands a token to an already-anon store (initialize has latched), so
// ask /me who it belongs to. The cookie path never has a token arrive this way.
subscribeToToken(() => {
  const token = getAccessToken();
  const status = useAuthStore.getState().status;
  if (token === null) {
    if (status === "authed") clearSession(false);
    return;
  }
  if (status !== "anon" || !getSessionProvider() || upgrading === token) return;
  upgrading = token;
  void auth
    .me()
    .then((user) => {
      // Stale when the host changed or dropped the token meanwhile, or someone else signed the store in.
      if (user && getAccessToken() === token && useAuthStore.getState().status === "anon") {
        useAuthStore.setState({ user, status: "authed" });
      }
    })
    .catch(() => undefined)
    .finally(() => {
      if (upgrading === token) upgrading = null;
    });
});

useAuthStore.subscribe((state, prev) => {
  if (state.status !== prev.status) syncSessionHint(state.status);
  const userId = state.user?.id ?? null;
  if (userId === null) return;
  if (lastUserId !== null && lastUserId !== userId) endDraftSession();
  lastUserId = userId;
});

/** Test seam: drop module state so cases cannot leak into each other. */
export function resetAuthStoreForTests(): void {
  initInFlight = null;
  initialized = false;
  onLogout = null;
  lastUserId = null;
  upgrading = null;
  registerSessionProvider(null);
  useAuthStore.setState({ user: null, status: "loading" });
}
