// Ported from usf apps/mobile/data/auth-store.ts: the Zustand half of auth
// (user + loading) over the native session. The token lifecycle, the epoch
// and the Keychain are the session's; the store only asks it and loads /me.
import type { User } from "@uniwork/core/types/user";
import { create } from "zustand";
import { ApiError, api } from "../api";
import { useWorkspaceStore } from "../stores/workspace-store";
import { session } from "./flow";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  /** boot: restore the stored session, then /me */
  initialize: () => Promise<void>;
  /** the browser sign-in, then /me; resolves without a user when the person dismissed it */
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** overwrite the in-memory user after PATCH /me; the server response is the source of truth */
  setUser: (user: User) => void;
}

/**
 * Only a genuine 401 (after the api client's own refresh-and-retry) ends the
 * session; a network blip or 5xx keeps it so the next launch can retry.
 */
async function loadUser(): Promise<User | null> {
  try {
    return await api.getMe();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) await session.logout();
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
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

  logout: async () => {
    // the session moves the epoch first, then clears the Keychain and revokes the device
    set({ user: null });
    await session.logout();
    // the next account on this device must not land in this one's workspace
    await useWorkspaceStore.getState().clear();
  },

  setUser: (user) => set({ user }),
}));
