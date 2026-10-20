// Ported from usf apps/mobile/data/auth-store.ts: the Zustand half of auth
// (user + loading) over the native session. The token lifecycle, the epoch
// and the Keychain are the session's; the store only asks it and loads /me.
import type { User } from "@uniwork/core/types/user";
import { create } from "zustand";
import { ApiError, api } from "../api";
import { queryClient } from "../query-client";
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
  /** overwrite the in-memory user after PATCH /me; the server response is the source of truth */
  setUser: (user: User) => void;
}

let inflight: Promise<User | null> | null = null;

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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,

  initialize: async () => {
    await session.restore();
    if (!(await session.getAccessToken())) {
      set({ isLoading: false });
      return;
    }
    set({ user: await loadUser(), isLoading: false });
  },

  login: async () => {
    await session.login();
    if (session.status() !== "signed-in") return;
    set({ user: await loadUser() });
  },

  adoptSession: async () => {
    if (get().user) return;
    set({ user: await loadUser() });
  },

  logout: async () => {
    // the session moves the epoch first, then clears the Keychain and revokes the device
    set({ user: null });
    await session.logout();
    // the next account on this device must not land in this one's workspace,
    // nor see its cached rooms, messages or unsent bubbles
    await useWorkspaceStore.getState().clear();
    queryClient.clear();
    useChatSendStore.getState().clear();
  },

  setUser: (user) => set({ user }),
}));
