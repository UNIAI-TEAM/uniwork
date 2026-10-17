import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentSlug, getCurrentWsId, setCurrentWorkspace } from "../platform/workspace-storage";
import type { User } from "../types/user";

// The store calls the auth endpoints; mock that module so no fetch happens.
vi.mock("../api/endpoints/auth", () => ({
  refreshSession: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
}));

// Spy on the draft-session end while keeping the real key holder behind it.
vi.mock("../office/draft-session-key", async (importOriginal) => {
  const real = await importOriginal<typeof import("../office/draft-session-key")>();
  return { ...real, endOfficeDraftSession: vi.fn(real.endOfficeDraftSession) };
});

import * as auth from "../api/endpoints/auth";
import { endOfficeDraftSession, getOfficeDraftKey } from "../office/draft-session-key";
import { getAccessToken, setAccessToken } from "../api/session";
import { registerSessionProvider } from "./session-provider";
import { resetAuthStoreForTests, useAuthStore } from "./store";

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: null, email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

describe("auth store", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setAccessToken(null);
    vi.mocked(auth.refreshSession).mockReset();
    vi.mocked(auth.logout).mockReset();
    vi.mocked(endOfficeDraftSession).mockClear();
    vi.stubGlobal("indexedDB", { deleteDatabase: vi.fn(() => ({})) });
  });
  afterEach(() => {
    setAccessToken(null);
    setCurrentWorkspace(null, null);
    vi.unstubAllGlobals();
  });

  it("starts loading and becomes authed when the refresh cookie yields a session", async () => {
    vi.mocked(auth.refreshSession).mockResolvedValueOnce({ user, access_token: "tok" });
    expect(useAuthStore.getState().status).toBe("loading");
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user, status: "authed" });
  });

  it("becomes anon when there is no session to refresh", async () => {
    vi.mocked(auth.refreshSession).mockResolvedValueOnce(null);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user: null, status: "anon" });
  });

  it("initialize is idempotent — StrictMode mounts effects twice", async () => {
    vi.mocked(auth.refreshSession).mockResolvedValue({ user, access_token: "tok" });
    await Promise.all([useAuthStore.getState().initialize(), useAuthStore.getState().initialize()]);
    await useAuthStore.getState().initialize();
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("setUser updates the user in place and keeps authed", () => {
    useAuthStore.getState().setUser(user);
    expect(useAuthStore.getState().status).toBe("authed");
    useAuthStore.getState().setUser({ ...user, onboarded_at: "2026-08-25T00:00:00Z" });
    expect(useAuthStore.getState().user?.onboarded_at).toBe("2026-08-25T00:00:00Z");
  });

  it("logout clears the user, calls the endpoint and runs the registered callback", async () => {
    const onLogout = vi.fn();
    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setOnLogout(onLogout);
    await useAuthStore.getState().logout();
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ user: null, status: "anon" });
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("logout clears the workspace scope so the next user starts outside any workspace", async () => {
    setAccessToken("tok");
    useAuthStore.getState().setUser(user);
    setCurrentWorkspace("acme/team", "ws1");
    await useAuthStore.getState().logout();
    expect(getCurrentSlug()).toBeNull();
    expect(getCurrentWsId()).toBeNull();
  });

  it("losing the session clears the workspace scope too", () => {
    setAccessToken("tok");
    useAuthStore.getState().setUser(user);
    setCurrentWorkspace("acme/team", "ws1");
    setAccessToken(null);
    expect(getCurrentSlug()).toBeNull();
  });

  it("drops to anon when the access token is cleared underneath it", () => {
    // A failed refresh in the transport clears the token; the store must
    // notice without being told, or the UI keeps rendering a stale session.
    setAccessToken("tok");
    useAuthStore.getState().setUser(user);
    setAccessToken(null);
    expect(useAuthStore.getState()).toMatchObject({ user: null, status: "anon" });
  });

  it("does not run logout cleanup when the token is cleared without calling logout", () => {
    const onLogout = vi.fn();
    useAuthStore.getState().setOnLogout(onLogout);
    setAccessToken("tok");
    useAuthStore.getState().setUser(user);
    setAccessToken(null);
    expect(useAuthStore.getState()).toMatchObject({ user: null, status: "anon" });
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("does not downgrade authed session when a stale refresh completes", async () => {
    let resolveRefresh: (value: null) => void = () => undefined;
    vi.mocked(auth.refreshSession).mockReturnValueOnce(
      new Promise<null>((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    const initPromise = useAuthStore.getState().initialize();
    useAuthStore.getState().setUser(user);
    resolveRefresh(null);
    await initPromise;
    expect(useAuthStore.getState()).toMatchObject({ user, status: "authed" });
  });

  it("logout ends the Office draft session: drafts deleted, a new key afterwards", async () => {
    useAuthStore.getState().setUser(user);
    const before = await getOfficeDraftKey(user.id);
    await useAuthStore.getState().logout();
    expect(endOfficeDraftSession).toHaveBeenCalledTimes(1);
    expect(indexedDB.deleteDatabase).toHaveBeenCalledWith("uniwork-office-frame-drafts");
    // The removed web editors' drafts database is not the frame's; sign-out leaves it alone.
    expect(indexedDB.deleteDatabase).toHaveBeenCalledTimes(1);
    expect(indexedDB.deleteDatabase).not.toHaveBeenCalledWith("uniwork-office-drafts");
    expect(await getOfficeDraftKey(user.id)).not.toBe(before);
  });

  it("a different user signing in ends the previous Office draft session", () => {
    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setUser({ ...user, display_name: "A2" });
    expect(endOfficeDraftSession).not.toHaveBeenCalled();
    useAuthStore.getState().setUser({ ...user, id: "u2" });
    expect(endOfficeDraftSession).toHaveBeenCalledTimes(1);
  });

  it("a token loss keeps the drafts for the same person, but not for the next one", () => {
    setAccessToken("tok");
    useAuthStore.getState().setUser(user);
    setAccessToken(null);
    expect(endOfficeDraftSession).not.toHaveBeenCalled();
    useAuthStore.getState().setUser(user);
    expect(endOfficeDraftSession).not.toHaveBeenCalled();
    setAccessToken("tok");
    setAccessToken(null);
    useAuthStore.getState().setUser({ ...user, id: "u2" });
    expect(endOfficeDraftSession).toHaveBeenCalledTimes(1);
  });

  it("selectors return stable references between renders", () => {
    useAuthStore.getState().setUser(user);
    const a = useAuthStore.getState().user;
    const b = useAuthStore.getState().user;
    expect(a).toBe(b);
  });
});

describe("auth store with a session provider", () => {
  const provider = (token: string | null) => ({
    login: vi.fn(async () => undefined),
    getAccessToken: vi.fn(async () => token),
    refresh: vi.fn(async () => token),
    logout: vi.fn(async () => undefined),
    onChange: vi.fn((_cb: (token: string | null) => void) => () => undefined),
  });

  beforeEach(() => {
    resetAuthStoreForTests();
    setAccessToken(null);
    vi.mocked(auth.refreshSession).mockReset();
    vi.mocked(auth.logout).mockReset();
    vi.mocked(auth.me).mockReset();
    vi.stubGlobal("indexedDB", { deleteDatabase: vi.fn(() => ({})) });
  });
  afterEach(() => {
    registerSessionProvider(null);
    setAccessToken(null);
    setCurrentWorkspace(null, null);
    vi.unstubAllGlobals();
  });

  it("initialize takes the host's token and loads the user from /me, not the refresh cookie", async () => {
    const p = provider("t");
    registerSessionProvider(p);
    vi.mocked(auth.me).mockResolvedValueOnce(user);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user, status: "authed" });
    expect(getAccessToken()).toBe("t");
    expect(auth.me).toHaveBeenCalledTimes(1);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it("initialize is anon when the host has no token, without calling /me", async () => {
    registerSessionProvider(provider(null));
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user: null, status: "anon" });
    expect(auth.me).not.toHaveBeenCalled();
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it("initialize is anon when the host drops the token while /me is in flight", async () => {
    const p = provider("t");
    registerSessionProvider(p);
    vi.mocked(auth.me).mockImplementationOnce(async () => {
      setAccessToken(null);
      return user;
    });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user: null, status: "anon" });
  });

  it("a token the host emits after anon upgrades the store to authed through /me", async () => {
    let emit: ((token: string | null) => void) | undefined;
    const p = provider(null);
    p.onChange.mockImplementation((cb) => {
      emit = cb;
      return () => undefined;
    });
    registerSessionProvider(p);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().status).toBe("anon");
    vi.mocked(auth.me).mockResolvedValueOnce(user);
    emit?.("t");
    await vi.waitFor(() => expect(useAuthStore.getState()).toMatchObject({ user, status: "authed" }));
    expect(auth.me).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe("t");
  });

  it("a stale /me answer is dropped when the host ends the session before it lands", async () => {
    let emit: ((token: string | null) => void) | undefined;
    const p = provider(null);
    p.onChange.mockImplementation((cb) => {
      emit = cb;
      return () => undefined;
    });
    registerSessionProvider(p);
    await useAuthStore.getState().initialize();
    vi.mocked(auth.me).mockImplementationOnce(async () => {
      emit?.(null);
      return user;
    });
    emit?.("t");
    await vi.waitFor(() => expect(auth.me).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(useAuthStore.getState()).toMatchObject({ user: null, status: "anon" });
  });

  it("a token set while anon without a provider changes nothing (cookie path)", async () => {
    vi.mocked(auth.refreshSession).mockResolvedValueOnce(null);
    await useAuthStore.getState().initialize();
    setAccessToken("x");
    await Promise.resolve();
    expect(auth.me).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ user: null, status: "anon" });
  });

  it("logout drops the token even when the host's logout rejects", async () => {
    const p = provider("t");
    p.logout.mockRejectedValueOnce(new Error("ipc"));
    registerSessionProvider(p);
    setAccessToken("t");
    useAuthStore.getState().setUser(user);
    await expect(useAuthStore.getState().logout()).rejects.toThrow("ipc");
    expect(getAccessToken()).toBeNull();
  });

  it("logout hands the session back to the host and drops the token", async () => {
    const p = provider("t");
    registerSessionProvider(p);
    setAccessToken("t");
    useAuthStore.getState().setUser(user);
    await useAuthStore.getState().logout();
    expect(p.logout).toHaveBeenCalledTimes(1);
    expect(auth.logout).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ user: null, status: "anon" });
  });
});
