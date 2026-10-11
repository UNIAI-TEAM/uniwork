import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { resetAuthStoreForTests, setSessionUser } from "../auth";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { User } from "../types/user";
import * as auth from "../api/endpoints/auth";
import { WSProvider } from "./provider";

vi.mock("../api/endpoints/auth", () => ({ refreshSession: vi.fn(async () => null), logout: vi.fn() }));

const sockets = vi.hoisted(
  () =>
    [] as {
      options: { resumed?: boolean; onSessionEnded?: () => void } | undefined;
      connected: boolean;
    }[],
);

vi.mock("../api/ws-client", () => ({
  WSClient: class {
    private entry: (typeof sockets)[number];
    constructor(_url: string, options?: { resumed?: boolean; onSessionEnded?: () => void }) {
      this.entry = { options, connected: false };
      sockets.push(this.entry);
    }
    setAuth() {}
    connect() {}
    disconnect() {}
    hasEverConnected() {
      return this.entry.connected;
    }
  },
}));

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

describe("WSProvider", () => {
  afterEach(() => {
    sockets.length = 0;
    setAccessToken(null);
    resetAuthStoreForTests();
    resetRuntimeConfig();
  });

  // H5: a token rotation rebuilt the socket without the refetch a reconnect
  // runs, so events sent in the gap were lost silently.
  it("treats the socket rebuilt for a rotated token as a reconnect", () => {
    configureRuntime({ wsUrl: "ws://api.test" });
    setSessionUser(user);
    setAccessToken("t1");
    const { unmount } = render(<WSProvider workspaceSlug="acme/main">{null}</WSProvider>);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.options?.resumed).toBe(false);

    sockets[0]!.connected = true;
    act(() => {
      setAccessToken("t2");
    });

    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.options?.resumed).toBe(true);
    unmount();
  });

  // H11: the server closes a socket whose token expired or whose session was
  // revoked; the provider refreshes, and the new token rebuilds the socket.
  it("refreshes the session when the server ends the socket's session", () => {
    configureRuntime({ wsUrl: "ws://api.test" });
    setSessionUser(user);
    setAccessToken("t1");
    const { unmount } = render(<WSProvider workspaceSlug="acme/main">{null}</WSProvider>);

    sockets[0]?.options?.onSessionEnded?.();

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    unmount();
  });
});
