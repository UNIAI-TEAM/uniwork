"use client";

import { create } from "zustand";
import * as auth from "../api/endpoints/auth";
import { getAccessToken, subscribe as subscribeToToken } from "../api/session";
import type { User } from "../types/user";

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
  logout: () => Promise<void>;
  /** Platform hook run after logout — the web app clears the query cache here. */
  setOnLogout: (cb: (() => void) | null) => void;
}

let initInFlight: Promise<void> | null = null;
let initialized = false;
let onLogout: (() => void) | null = null;

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
        const sess = await auth.refreshSession();
        // Login/register may finish while refresh is still in flight; do not downgrade.
        if (useAuthStore.getState().status === "authed") return;
        set(sess ? { user: sess.user, status: "authed" } : { user: null, status: "anon" });
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

  logout: async () => {
    await auth.logout();
    if (get().user !== null || get().status !== "anon") set({ user: null, status: "anon" });
    onLogout?.();
  },

  setOnLogout: (cb) => {
    onLogout = cb;
  },
}));

// A failed refresh inside the transport clears the token without telling
// anyone. Follow it here so the UI cannot keep rendering a stale session.
subscribeToToken(() => {
  if (getAccessToken() === null && useAuthStore.getState().status === "authed") {
    useAuthStore.setState({ user: null, status: "anon" });
  }
});

/** Test seam: drop module state so cases cannot leak into each other. */
export function resetAuthStoreForTests(): void {
  initInFlight = null;
  initialized = false;
  onLogout = null;
  useAuthStore.setState({ user: null, status: "loading" });
}
