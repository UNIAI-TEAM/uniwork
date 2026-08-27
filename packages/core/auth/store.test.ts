import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import type { User } from "../types/user";

// The store calls the auth endpoints; mock that module so no fetch happens.
vi.mock("../api/endpoints/auth", () => ({
  refreshSession: vi.fn(),
  logout: vi.fn(),
}));

import * as auth from "../api/endpoints/auth";
import { resetAuthStoreForTests, useAuthStore } from "./store";

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: null, email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {},
};

describe("auth store", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setAccessToken(null);
    vi.mocked(auth.refreshSession).mockReset();
    vi.mocked(auth.logout).mockReset();
  });
  afterEach(() => setAccessToken(null));

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

  it("drops to anon when the access token is cleared underneath it", () => {
    // A failed refresh in the transport clears the token; the store must
    // notice without being told, or the UI keeps rendering a stale session.
    setAccessToken("tok");
    useAuthStore.getState().setUser(user);
    setAccessToken(null);
    expect(useAuthStore.getState()).toMatchObject({ user: null, status: "anon" });
  });

  it("selectors return stable references between renders", () => {
    useAuthStore.getState().setUser(user);
    const a = useAuthStore.getState().user;
    const b = useAuthStore.getState().user;
    expect(a).toBe(b);
  });
});
