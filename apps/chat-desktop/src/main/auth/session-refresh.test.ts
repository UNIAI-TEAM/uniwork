import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { CredentialStoreError } from "./credentials";
import {
  callback,
  createMemoryCredentialStore,
  fail,
  fakeSession,
  lastState,
  resetFakeSessions,
  setup,
  signIn,
  stored,
} from "./fakes";
import { ACCESS_TOKEN_SKEW_MS, RATE_LIMIT_WAIT_CAP_MS, RECOVERY_MIN_MS } from "./session";
import { TransportError, type DesktopSession, type TransportErrorCode } from "./transport";

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
  ])("refresh failure %s -> credential cleared: %s", async (code, cleared) => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) });
    ctx.transport.refresh.mockImplementationOnce(fail(code));
    await ctx.shell.restore();
    if (cleared) {
      expect(ctx.shell.status()).toBe("signed-out");
      expect(ctx.credentials.load()).toBeNull();
      expect(ctx.tokens).toEqual([null]);
      expect(await ctx.shell.getAccessToken()).toBeNull();
    } else {
      expect(ctx.shell.status()).toBe("server-unreachable");
      expect(ctx.credentials.load()?.refreshToken).toBe("rt_stored");
      expect(ctx.tokens).toEqual([]);
    }
  });

  it("a bare 401 from a gateway (not the server's verdict) is transient, not a sign-out", async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) });
    ctx.transport.refresh.mockImplementationOnce(() => Promise.reject(new TransportError("unauthorized", 401, false)));
    await ctx.shell.restore();
    expect(ctx.shell.status()).toBe("server-unreachable");
    expect(ctx.credentials.load()).not.toBeNull();
  });

  it("server-unreachable retries with a 5 s doubling backoff and recovers", async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) });
    ctx.transport.refresh.mockImplementation(fail("network"));
    await ctx.shell.restore();
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RECOVERY_MIN_MS);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RECOVERY_MIN_MS);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RECOVERY_MIN_MS);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(3);
    // a manual refresh while a retry is already scheduled does not add a second timer
    expect(await ctx.shell.refresh()).toBeNull();
    ctx.transport.refresh.mockImplementation(async () => fakeSession());
    await vi.advanceTimersByTimeAsync(4 * RECOVERY_MIN_MS);
    expect(ctx.shell.status()).toBe("signed-in");
    expect(ctx.tokens).toEqual([expect.stringMatching(/^at_/)]);
  });

  it("the backoff is capped at 5 minutes", async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) });
    ctx.transport.refresh.mockImplementation(fail("network"));
    await ctx.shell.restore();
    for (let i = 0; i < 12; i += 1) await vi.advanceTimersByTimeAsync(300_000);
    const calls = ctx.transport.refresh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(calls + 1);
  });

  it("429 waits for Retry-After (capped at 60 s) and retries without signing out", async () => {
    const ctx = setup();
    await signIn(ctx);
    ctx.transport.refresh.mockImplementationOnce(fail("rate_limited", 2_000));
    const refreshing = ctx.shell.refresh();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await refreshing).toBe("at_2");
    expect(ctx.tokens).toEqual(["at_1", "at_2"]);
    expect(ctx.shell.status()).toBe("signed-in");

    ctx.transport.refresh.mockImplementationOnce(fail("rate_limited", 10 * 60_000));
    const capped = ctx.shell.refresh();
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_WAIT_CAP_MS - 1);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(await capped).toBe("at_3");

    // no Retry-After: wait the minimum recovery delay
    ctx.transport.refresh.mockImplementationOnce(fail("rate_limited"));
    const bare = ctx.shell.refresh();
    await vi.advanceTimersByTimeAsync(RECOVERY_MIN_MS);
    expect(await bare).toBe("at_4");
    expect(ctx.credentials.load()?.refreshToken).toBe("rt_4");
  });

  it("a second 429 in a row is a transient failure (backoff), still not a sign-out", async () => {
    const ctx = setup();
    await signIn(ctx);
    ctx.transport.refresh.mockImplementation(fail("rate_limited", 1_000));
    const refreshing = ctx.shell.refresh();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await refreshing).toBeNull();
    expect(ctx.shell.status()).toBe("server-unreachable");
    expect(ctx.credentials.load()).not.toBeNull();
    expect(ctx.tokens).toEqual(["at_1"]);
    // the still-valid access token is handed out meanwhile
    expect(await ctx.shell.getAccessToken()).toBe("at_1");
  });

  it("runs a single refresh for concurrent callers", async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) });
    await ctx.shell.restore();
    ctx.transport.refresh.mockClear();
    vi.setSystemTime(Date.now() + 900_000 - ACCESS_TOKEN_SKEW_MS);
    const [a, b, c] = await Promise.all([
      ctx.shell.getAccessToken(),
      ctx.shell.getAccessToken(),
      ctx.shell.refresh(),
    ]);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1);
    expect(a).toBe("at_2");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("refreshes proactively at 80% of the access token lifetime", async () => {
    const ctx = setup();
    await signIn(ctx);
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(719_999);
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.transport.refresh).toHaveBeenCalledTimes(1);
    expect(ctx.shell.status()).toBe("signed-in");
    expect(ctx.tokens).toEqual(["at_1", "at_2"]);
    expect(ctx.credentials.load()?.refreshToken).toBe("rt_2");
  });

  it("a very long-lived access token still gets a bounded timer", async () => {
    const ctx = setup();
    ctx.transport.exchange.mockImplementationOnce(async () => fakeSession({ expiresIn: 2 ** 31 }));
    await signIn(ctx);
    expect(ctx.shell.status()).toBe("signed-in");
  });

  it("refresh() without a session is null and refresh() in server-unreachable retries at once", async () => {
    const ctx = setup();
    expect(await ctx.shell.refresh()).toBeNull();
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    await signIn(ctx);
    ctx.transport.refresh.mockImplementationOnce(fail("network"));
    expect(await ctx.shell.refresh()).toBeNull();
    expect(ctx.shell.status()).toBe("server-unreachable");
    // login() with a live but unreachable session recovers it instead of starting a new attempt
    await ctx.shell.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(1);
    expect(ctx.shell.status()).toBe("signed-in");
  });

  it("a refresh token that expired while running ends the session on the next refresh", async () => {
    const ctx = setup();
    await signIn(ctx);
    vi.setSystemTime(Date.now() + 31 * 24 * 3600 * 1000);
    expect(await ctx.shell.getAccessToken()).toBeNull();
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    expect(ctx.tokens).toEqual(["at_1", null]);
  });

  it("a rotation that cannot be persisted ends the session rather than losing the new token", async () => {
    const ctx = setup();
    await signIn(ctx);
    ctx.credentials.save = () => {
      throw new CredentialStoreError("io");
    };
    expect(await ctx.shell.refresh()).toBeNull();
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.tokens).toEqual(["at_1", null]);
    expect(ctx.credentials.load()).toBeNull();
  });
});

describe("logout", () => {
  it("revokes the device, then clears local credentials and publishes null", async () => {
    const ctx = setup();
    await signIn(ctx);
    await ctx.shell.logout();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.transport.logout).toHaveBeenCalledWith({ deviceSessionId: "dev_1" }, "at_1");
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.credentials.load()).toBeNull();
    expect(ctx.tokens).toEqual(["at_1", null]);
    expect(await ctx.shell.getAccessToken()).toBeNull();
    // the proactive refresh timer is gone with the session
    await vi.advanceTimersByTimeAsync(720_000);
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
  });

  it("clears and reports signed-out before the server round trip", async () => {
    const ctx = setup();
    await signIn(ctx);
    vi.setSystemTime(Date.now() + 900_000);
    ctx.transport.refresh.mockImplementation(() => new Promise(() => undefined));
    await ctx.shell.logout();
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.tokens.at(-1)).toBeNull();
    expect(ctx.credentials.load()).toBeNull();
    // the device revoke still goes out (refresh first: the access token expired)
    expect(ctx.transport.refresh).toHaveBeenCalled();
  });

  it("still clears when the server is unreachable", async () => {
    const ctx = setup();
    await signIn(ctx);
    ctx.transport.logout.mockImplementation(fail("network"));
    await ctx.shell.logout();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.credentials.load()).toBeNull();
  });

  it("drops a refresh response that lands after logout", async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) });
    let release: (s: DesktopSession) => void = () => undefined;
    ctx.transport.refresh.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const restoring = ctx.shell.restore();
    await ctx.shell.logout();
    release(fakeSession());
    await restoring;
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.credentials.load()).toBeNull();
    expect(ctx.tokens).toEqual([null]);
  });

  it("drops a refresh failure that lands after logout", async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) });
    let reject: (e: unknown) => void = () => undefined;
    ctx.transport.refresh.mockImplementationOnce(() => new Promise((_resolve, r) => (reject = r)));
    const restoring = ctx.shell.restore();
    await ctx.shell.logout();
    reject(new TransportError("network"));
    await restoring;
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.tokens).toEqual([null]);
  });

  it("logout during a sign-in cancels the attempt; logout when signed out is a no-op", async () => {
    const ctx = setup();
    await ctx.shell.login();
    const state = lastState(ctx);
    await ctx.shell.logout();
    expect(ctx.shell.status()).toBe("signed-out");
    await ctx.shell.completeCallback(callback(state));
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
    expect(ctx.transport.logout).not.toHaveBeenCalled();
    expect(ctx.tokens).toEqual([]);
  });
});
