import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import type { User } from "../types/user";

vi.mock("../api/endpoints/auth", () => ({
  refreshSession: vi.fn(),
  logout: vi.fn(),
}));

import * as auth from "../api/endpoints/auth";
import { useKnownSession } from "./hooks";
import { hasSessionHint } from "./session-hint";
import { resetAuthStoreForTests, useAuthStore } from "./store";

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

beforeEach(() => {
  localStorage.clear();
  resetAuthStoreForTests();
  setAccessToken(null);
  vi.mocked(auth.refreshSession).mockReset();
  vi.mocked(auth.logout).mockReset();
});
afterEach(() => {
  setAccessToken(null);
});

describe("session hint", () => {
  it("is set once the browser holds a session", () => {
    expect(hasSessionHint()).toBe(false);
    useAuthStore.getState().setUser(user);
    expect(hasSessionHint()).toBe(true);
  });

  it("is cleared by logout", async () => {
    useAuthStore.getState().setUser(user);
    await useAuthStore.getState().logout();
    expect(hasSessionHint()).toBe(false);
  });

  it("is cleared when the session is lost underneath the store", () => {
    setAccessToken("tok");
    useAuthStore.getState().setUser(user);
    setAccessToken(null);
    expect(hasSessionHint()).toBe(false);
  });

  it("is cleared when the start-up refresh finds no session", async () => {
    localStorage.setItem("uniwork_session_hint", "1");
    vi.mocked(auth.refreshSession).mockResolvedValueOnce(null);
    await useAuthStore.getState().initialize();
    expect(hasSessionHint()).toBe(false);
  });
});

describe("useKnownSession", () => {
  it("never asks the server when this browser was not signed in", async () => {
    const { result } = renderHook(() => useKnownSession());
    await Promise.resolve();
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(result.current.status).toBe("loading");
  });

  it("resolves the session when this browser was signed in last time", async () => {
    localStorage.setItem("uniwork_session_hint", "1");
    vi.mocked(auth.refreshSession).mockResolvedValueOnce({ user, access_token: "tok" });
    const { result } = renderHook(() => useKnownSession());
    await waitFor(() => expect(result.current.status).toBe("authed"));
    expect(result.current.user?.id).toBe("u1");
  });
});
