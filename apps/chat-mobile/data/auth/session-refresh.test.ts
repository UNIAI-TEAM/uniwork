import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { currentSessionEpoch } from "../session-epoch";
import { createMemoryStorage, fail, fakeSession, resetFakeSessions, setup, stored } from "./fakes";
import { ACCESS_TOKEN_SKEW_MS, RATE_LIMIT_WAIT_CAP_MS, RECOVERY_MIN_MS } from "./session";
import { TransportError, type DesktopSession, type TransportErrorCode } from "./transport";

vi.mock("expo-crypto", async () => (await import("./expo-crypto-mock")).expoCryptoMock());

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  resetFakeSessions();
  vi.useFakeTimers({ now: new Date("2026-10-01T00:00:00Z") });
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
});

/** a restored session whose access token needs a refresh at once */
const expiring = () => setup(vi, { storage: createMemoryStorage(vi, stored({ expires_at: 0 })) });

describe("refresh", () => {
  it.each<[TransportErrorCode, boolean]>([
    ["refresh_reused", true],
    ["device_revoked", true],
    ["unauthorized", true],
    ["auth_code_invalid", true],
    ["network", false],
    ["timeout", false],
    ["server_error", false],
    ["malformed_response", false],
    ["wrong_deployment", false],
  ])("refresh failure %s -> stored session cleared: %s", async (code, cleared) => {
    const ctx = expiring();
    ctx.transport.refresh.mockImplementationOnce(fail(code));
    const epoch = currentSessionEpoch();
    await ctx.session.restore();
    if (cleared) {
      // a server verdict: signed out at once, no retry, the epoch moved
      expect(ctx.session.status()).toBe("signed-out");
      expect(ctx.storage.current()).toBeNull();
      expect(ctx.tokens).toEqual([null]);
      expect(currentSessionEpoch()).toBe(epoch + 1);
      expect(await ctx.session.getAccessToken()).toBeNull();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(ctx.transport.refresh).toHaveBeenCalledTimes(1);
    } else {
      expect(ctx.session.status()).toBe("server-unreachable");
      expect(ctx.storage.current()?.refresh_token).toBe("rt_stored");
      expect(ctx.tokens).toEqual([]);
      expect(currentSessionEpoch()).toBe(epoch);
    }
  });

  it("a bare 401 from a gateway (not the server's verdict) is transient, not a sign-out", async () => {
    const ctx = expiring();
    ctx.transport.refresh.mockImplementationOnce(() => Promise.reject(new TransportError("unauthorized", 401, false)));
    await ctx.session.restore();
    expect(ctx.session.status()).toBe("server-unreachable");
    expect(ctx.storage.current()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(RECOVERY_MIN_MS);
    expect(ctx.session.status()).toBe("signed-in");
  });

  it("server-unreachable retries with a 5 s doubling backoff and recovers", async () => {
    const ctx = expiring();
    ctx.transport.refresh.mockImplementation(fail("network"));
    await ctx.session.restore();
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RECOVERY_MIN_MS);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RECOVERY_MIN_MS);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RECOVERY_MIN_MS);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(3);
    // a manual refresh while a retry is already scheduled does not add a second timer
    expect(await ctx.session.refresh()).toBeNull();
    ctx.transport.refresh.mockImplementation(async () => fakeSession());
    await vi.advanceTimersByTimeAsync(4 * RECOVERY_MIN_MS);
    expect(ctx.session.status()).toBe("signed-in");
    expect(ctx.tokens).toEqual([expect.stringMatching(/^at_/)]);
  });

  it("the backoff is capped at 5 minutes", async () => {
    const ctx = expiring();
    ctx.transport.refresh.mockImplementation(fail("network"));
    await ctx.session.restore();
    for (let i = 0; i < 12; i += 1) await vi.advanceTimersByTimeAsync(300_000);
    const calls = ctx.transport.refresh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(calls + 1);
  });

  it("429 waits for Retry-After (capped at 60 s) and retries without signing out or touching the Keychain", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    ctx.storage.commit.mockClear();
    ctx.transport.refresh.mockImplementationOnce(fail("rate_limited", 2_000));
    const refreshing = ctx.session.refresh();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1);
    expect(ctx.storage.commit).not.toHaveBeenCalled();
    expect(ctx.storage.current()?.refresh_token).toBe("rt_1");
    await vi.advanceTimersByTimeAsync(1);
    expect(await refreshing).toBe("at_2");
    expect(ctx.tokens).toEqual(["at_1", "at_2"]);
    expect(ctx.session.status()).toBe("signed-in");

    ctx.transport.refresh.mockImplementationOnce(fail("rate_limited", 10 * 60_000));
    const capped = ctx.session.refresh();
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_WAIT_CAP_MS - 1);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(await capped).toBe("at_3");

    // no Retry-After: wait the minimum recovery delay
    ctx.transport.refresh.mockImplementationOnce(fail("rate_limited"));
    const bare = ctx.session.refresh();
    await vi.advanceTimersByTimeAsync(RECOVERY_MIN_MS);
    expect(await bare).toBe("at_4");
    expect(ctx.storage.current()?.refresh_token).toBe("rt_4");
  });

  it("a second 429 in a row is a transient failure (backoff), still not a sign-out", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    ctx.transport.refresh.mockImplementation(fail("rate_limited", 1_000));
    const refreshing = ctx.session.refresh();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await refreshing).toBeNull();
    expect(ctx.session.status()).toBe("server-unreachable");
    expect(ctx.storage.current()).not.toBeNull();
    expect(ctx.tokens).toEqual(["at_1"]);
    // the still-valid access token is handed out meanwhile
    expect(await ctx.session.getAccessToken()).toBe("at_1");
  });

  it("runs a single refresh for concurrent callers (api 401 and ws 4001 at once)", async () => {
    const ctx = setup(vi, { storage: createMemoryStorage(vi, stored()) });
    await ctx.session.restore();
    vi.setSystemTime(Date.now() + 900_000 - ACCESS_TOKEN_SKEW_MS);
    const [a, b, c] = await Promise.all([
      ctx.session.getAccessToken(),
      ctx.session.getAccessToken(),
      ctx.session.refresh(),
    ]);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1);
    expect(a).toBe("at_1");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("never refreshes proactively: a fresh token is handed out until the skew window", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    await vi.advanceTimersByTimeAsync(900_000 - ACCESS_TOKEN_SKEW_MS - 1);
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    expect(await ctx.session.getAccessToken()).toBe("at_1");
    await vi.advanceTimersByTimeAsync(1);
    expect(await ctx.session.getAccessToken()).toBe("at_2");
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1);
  });

  it("refresh() without a session is null and refresh() in server-unreachable retries at once", async () => {
    const ctx = setup(vi);
    expect(await ctx.session.refresh()).toBeNull();
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    await ctx.session.login();
    ctx.transport.refresh.mockImplementationOnce(fail("network"));
    expect(await ctx.session.refresh()).toBeNull();
    expect(ctx.session.status()).toBe("server-unreachable");
    // login() with a live but unreachable session recovers it instead of starting a new attempt
    await ctx.session.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(1);
    expect(ctx.session.status()).toBe("signed-in");
  });

  it("a refresh token that expired while running ends the session on the next refresh", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    vi.setSystemTime(Date.now() + 31 * 24 * 3600 * 1000);
    expect(await ctx.session.getAccessToken()).toBeNull();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    expect(ctx.tokens).toEqual(["at_1", null]);
  });

  it("a rotation that cannot be persisted ends the session rather than losing the new token", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    ctx.storage.commit.mockRejectedValueOnce(new Error("keychain"));
    ctx.transport.refresh.mockImplementationOnce(async () => fakeSession({ deviceSessionId: "dev_2" }));
    expect(await ctx.session.refresh()).toBeNull();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.tokens).toEqual(["at_1", null]);
    expect(ctx.storage.current()).toBeNull();
    // the rotated device session nobody holds is revoked with its fresh access token, no second refresh
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1);
    expect(ctx.transport.logout).toHaveBeenCalledWith({ deviceSessionId: "dev_2" }, "at_2");
  });

  it("a rotation refused by the Keychain because the stored token moved on ends the session", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    ctx.storage.commit.mockResolvedValueOnce(false);
    expect(await ctx.session.refresh()).toBeNull();
    expect(ctx.session.status()).toBe("signed-out");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("stale"));
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.transport.logout).toHaveBeenCalledWith({ deviceSessionId: "dev_1" }, "at_2");
  });

  it("a Keychain that will not clear after a server verdict still signs out in memory", async () => {
    const ctx = expiring();
    ctx.transport.refresh.mockImplementationOnce(fail("refresh_reused"));
    ctx.storage.clear.mockRejectedValueOnce(new Error("locked"));
    await ctx.session.restore();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.tokens).toEqual([null]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not cleared"));
  });
});

describe("logout", () => {
  it("moves the epoch first, publishes null, clears the Keychain and revokes the device", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    const epoch = currentSessionEpoch();
    await ctx.session.logout();
    expect(currentSessionEpoch()).toBe(epoch + 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.transport.logout).toHaveBeenCalledWith({ deviceSessionId: "dev_1" }, "at_1");
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.storage.current()).toBeNull();
    expect(ctx.tokens).toEqual(["at_1", null]);
    expect(await ctx.session.getAccessToken()).toBeNull();
  });

  it("clears and reports signed-out before the server round trip; an expired access token is refreshed for the revoke", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    vi.setSystemTime(Date.now() + 900_000);
    ctx.transport.refresh.mockImplementation(() => new Promise(() => undefined));
    await ctx.session.logout();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.tokens.at(-1)).toBeNull();
    expect(ctx.storage.current()).toBeNull();
    expect(ctx.transport.refresh).toHaveBeenCalled();
  });

  it("still clears when the server is unreachable", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    ctx.transport.logout.mockImplementation(fail("network"));
    await ctx.session.logout();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.storage.current()).toBeNull();
  });

  it("drops a refresh response that lands after logout", async () => {
    const ctx = expiring();
    let release: (s: DesktopSession) => void = () => undefined;
    ctx.transport.refresh.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const restoring = ctx.session.restore();
    await vi.advanceTimersByTimeAsync(0);
    await ctx.session.logout();
    release(fakeSession());
    await restoring;
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.storage.current()).toBeNull();
    expect(ctx.storage.commit).not.toHaveBeenCalled();
    expect(ctx.tokens).toEqual([null]);
  });

  it("drops a refresh failure that lands after logout", async () => {
    const ctx = expiring();
    let reject: (e: unknown) => void = () => undefined;
    ctx.transport.refresh.mockImplementationOnce(() => new Promise((_resolve, r) => (reject = r)));
    const restoring = ctx.session.restore();
    await vi.advanceTimersByTimeAsync(0);
    await ctx.session.logout();
    reject(new TransportError("refresh_reused", 401, true));
    await restoring;
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.tokens).toEqual([null]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a logout that starts while the rotated session is being written refuses the write and revokes the new device", async () => {
    const epochChanged = vi.fn((at: number) => at !== currentSessionEpoch());
    const ctx = setup(vi, { epochChanged });
    await ctx.session.login();
    const commit = ctx.storage.commit.getMockImplementation()!;
    ctx.storage.commit.mockImplementationOnce(async (next, expected) => {
      await ctx.session.logout();
      return commit(next, expected);
    });
    ctx.transport.refresh.mockImplementationOnce(async () => fakeSession({ deviceSessionId: "dev_2" }));
    expect(await ctx.session.refresh()).toBeNull();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.storage.current()).toBeNull();
    expect(ctx.tokens).toEqual(["at_1", null]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.transport.logout).toHaveBeenCalledWith({ deviceSessionId: "dev_1" }, "at_1");
    expect(ctx.transport.logout).toHaveBeenCalledWith({ deviceSessionId: "dev_2" }, "at_2");
  });

  it("a Keychain that will not clear still resolves logout() signed out", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    ctx.storage.clear.mockRejectedValueOnce(new Error("locked"));
    await ctx.session.logout();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.tokens).toEqual(["at_1", null]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not cleared"));
  });

  it("a hung refresh of the previous account is never handed to the next one, and its late end does not break single-flight", async () => {
    const ctx = expiring();
    let releaseA: (s: DesktopSession) => void = () => undefined;
    ctx.transport.refresh.mockImplementationOnce(() => new Promise((resolve) => (releaseA = resolve)));
    void ctx.session.restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.session.status()).toBe("refreshing");
    await ctx.session.logout();
    await ctx.session.login();
    expect(ctx.session.status()).toBe("signed-in");
    vi.setSystemTime(Date.now() + 900_000);
    let releaseB: (s: DesktopSession) => void = () => undefined;
    ctx.transport.refresh.mockImplementationOnce(() => new Promise((resolve) => (releaseB = resolve)));
    const b1 = ctx.session.refresh();
    await vi.advanceTimersByTimeAsync(0);
    // A's hung refresh, A's revoke-time refresh, B's refresh
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(3);
    releaseA(fakeSession());
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.session.refresh()).toBe(b1);
    releaseB(fakeSession({ accessToken: "at_b" }));
    expect(await b1).toBe("at_b");
    expect(ctx.session.status()).toBe("signed-in");
  });

  it("logout during a sign-in cancels the attempt; logout when signed out is a no-op", async () => {
    const ctx = setup(vi);
    let release: (url: string | null) => void = () => undefined;
    ctx.openBrowser.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const pending = ctx.session.login();
    await vi.advanceTimersByTimeAsync(0);
    await ctx.session.logout();
    expect(ctx.session.status()).toBe("signed-out");
    release(null);
    await pending;
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
    expect(ctx.transport.logout).not.toHaveBeenCalled();
    expect(ctx.tokens).toEqual([]);
  });
});
