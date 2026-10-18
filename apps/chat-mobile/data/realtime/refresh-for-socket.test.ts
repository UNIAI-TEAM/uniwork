// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { socketTokenReaders } from "./refresh-for-socket";

function fakeSession(opts: { current: string | null; refreshed?: string | null; status?: string }) {
  return {
    getAccessToken: vi.fn(async () => opts.current),
    refresh: vi.fn(async () => opts.refreshed ?? null),
    status: () => opts.status ?? "signed-in",
  };
}

describe("socketTokenReaders", () => {
  it("hands the socket the current token and records it as the dialed one", async () => {
    const session = fakeSession({ current: "t1" });
    const readers = socketTokenReaders(session);
    await expect(readers.getToken()).resolves.toBe("t1");
    expect(session.getAccessToken).toHaveBeenCalledTimes(1);
  });

  it("after 4001 uses a token the api client already rotated without refreshing", async () => {
    const session = fakeSession({ current: "t1" });
    const readers = socketTokenReaders(session);
    await readers.getToken();
    session.getAccessToken.mockResolvedValueOnce("t2");
    await expect(readers.refreshSession()).resolves.toBe("t2");
    expect(session.refresh).not.toHaveBeenCalled();
  });

  it("refreshes when the current token is the one the socket died with", async () => {
    const session = fakeSession({ current: "t1", refreshed: "t2" });
    const readers = socketTokenReaders(session);
    await readers.getToken();
    await expect(readers.refreshSession()).resolves.toBe("t2");
    expect(session.refresh).toHaveBeenCalledTimes(1);
  });

  it("rejects a transient failure so the provider keeps the session", async () => {
    const session = fakeSession({ current: "t1", refreshed: null, status: "server-unreachable" });
    const readers = socketTokenReaders(session);
    await readers.getToken();
    await expect(readers.refreshSession()).rejects.toThrow("transient");
  });

  it("resolves null once the session is signed out", async () => {
    const session = fakeSession({ current: null, status: "signed-out" });
    const readers = socketTokenReaders(session);
    await expect(readers.refreshSession()).resolves.toBeNull();
  });
});
