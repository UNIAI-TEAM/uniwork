import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { currentSessionEpoch } from "../session-epoch";
import {
  callback,
  createMemoryStorage,
  fail,
  fakeSession,
  lastState,
  resetFakeSessions,
  setup,
  stored,
} from "./fakes";
import { deviceLabel } from "./session";
import type { DesktopSession, TransportErrorCode } from "./transport";

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

describe("sign-in", () => {
  it("starts PKCE, opens the system auth session, exchanges the code and publishes the access token", async () => {
    const ctx = setup(vi);
    await ctx.session.login();
    const start = ctx.transport.start.mock.calls[0]?.[0];
    expect(start).toMatchObject({
      clientId: "uniwork-chat-mobile",
      redirectUri: "uniworkchat://auth/callback",
      deviceLabel: "UniChat (iOS)",
      platform: "ios",
    });
    expect(start?.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const exchange = ctx.transport.exchange.mock.calls[0]?.[0];
    expect(exchange?.code).toBe("c1");
    expect(exchange?.codeVerifier).toMatch(/^[A-Za-z0-9._~-]{64}$/);
    expect(ctx.openBrowser).toHaveBeenCalledWith(
      "https://uniwork.example/auth/desktop/authorize?attempt=1",
      "uniworkchat://auth/callback",
    );
    expect(ctx.session.status()).toBe("signed-in");
    expect(ctx.tokens).toEqual(["at_1"]);
    expect(await ctx.session.getAccessToken()).toBe("at_1");
    expect(ctx.storage.current()).toEqual({
      access_token: "at_1",
      refresh_token: "rt_1",
      device_session_id: "dev_1",
      deployment_id: "default",
      expires_at: Date.now() + 900_000,
      refresh_expires_at: Date.now() + 30 * 24 * 3600_000,
    });
    // signed in: another login() is a no-op
    await ctx.session.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(1);
  });

  it("labels the device by OS", () => {
    expect(deviceLabel("ios")).toBe("UniChat (iOS)");
    expect(deviceLabel("android")).toBe("UniChat (Android)");
    expect(deviceLabel("web")).toBe("UniChat (web)");
  });

  it("a dismissed browser ends the attempt without an exchange; the next tap starts fresh", async () => {
    const ctx = setup(vi);
    ctx.openBrowser.mockResolvedValueOnce(null);
    await ctx.session.login();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("browser_dismissed"));
    await ctx.session.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(2);
    expect(ctx.session.status()).toBe("signed-in");
  });

  it.each([
    ["another scheme", (s: string) => `uniworkchat-dev://auth/callback?code=c&state=${s}`, "wrong_redirect"],
    ["a forged state", () => "uniworkchat://auth/callback?code=c&state=forged", "state_mismatch"],
    ["an extra query key", (s: string) => `${callback(s)}&x=1`, "unexpected_query"],
    ["a fragment", () => "uniworkchat://auth/callback#code=c", "malformed"],
  ])("a callback with %s is discarded without an exchange and never logged", async (_label, build, reason) => {
    const ctx = setup(vi);
    ctx.openBrowser.mockImplementationOnce(async () => build(lastState(ctx)));
    await ctx.session.login();
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(reason));
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/callback\?|state=|code=/);
    // the attempt stays live for a deep-link delivery of the real callback
    expect(ctx.session.status()).toBe("signing-in");
    await ctx.session.completeCallback(callback(lastState(ctx)));
    expect(ctx.session.status()).toBe("signed-in");
  });

  it("a stray callback without an attempt changes nothing", async () => {
    const ctx = setup(vi);
    await ctx.session.completeCallback(callback("s"));
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
  });

  it("a callback for an expired attempt ends it without an exchange", async () => {
    const ctx = setup(vi);
    ctx.openBrowser.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 10 * 60 * 1000);
      return callback(lastState(ctx));
    });
    await ctx.session.login();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("login_timeout"));
  });

  it.each<TransportErrorCode>(["auth_code_invalid", "rate_limited", "network", "wrong_deployment"])(
    "exchange failure %s returns to signed-out and a new login() starts fresh",
    async (code) => {
      const ctx = setup(vi);
      ctx.transport.exchange.mockImplementationOnce(fail(code));
      await ctx.session.login();
      expect(ctx.session.status()).toBe("signed-out");
      expect(ctx.storage.current()).toBeNull();
      expect(ctx.tokens).toEqual([]);
      expect(await ctx.session.getAccessToken()).toBeNull();
      await ctx.session.login();
      expect(ctx.session.status()).toBe("signed-in");
      expect(ctx.transport.start).toHaveBeenCalledTimes(2);
    },
  );

  it("a start failure returns to signed-out and rejects login(); unknown errors are logged as such", async () => {
    const ctx = setup(vi);
    ctx.transport.start.mockImplementationOnce(fail("network"));
    await expect(ctx.session.login()).rejects.toMatchObject({ code: "network" });
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.openBrowser).not.toHaveBeenCalled();
    ctx.transport.start.mockRejectedValueOnce(new Error("boom"));
    await expect(ctx.session.login()).rejects.toThrow("boom");
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("unknown"));
    await ctx.session.login();
    expect(ctx.session.status()).toBe("signed-in");
  });

  it("a start() that answers after logout is dropped either way", async () => {
    const ctx = setup(vi);
    let reject: (e: unknown) => void = () => undefined;
    ctx.transport.start.mockImplementationOnce(() => new Promise((_resolve, r) => (reject = r)));
    const rejected = ctx.session.login();
    await vi.advanceTimersByTimeAsync(0);
    await ctx.session.logout();
    reject(new Error("late"));
    await expect(rejected).rejects.toThrow("late");
    expect(warn).not.toHaveBeenCalled();

    let release: (v: { authorizationUrl: string }) => void = () => undefined;
    ctx.transport.start.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const resolved = ctx.session.login();
    await vi.advanceTimersByTimeAsync(0);
    await ctx.session.logout();
    release({ authorizationUrl: "https://uniwork.example/auth/desktop/authorize?attempt=2" });
    await resolved;
    expect(ctx.openBrowser).not.toHaveBeenCalled();
    expect(ctx.session.status()).toBe("signed-out");
  });

  it("a browser that fails to open ends the attempt and rejects; after logout it rejects silently", async () => {
    const ctx = setup(vi);
    ctx.openBrowser.mockRejectedValueOnce(new Error("no browser"));
    await expect(ctx.session.login()).rejects.toThrow("no browser");
    expect(ctx.session.status()).toBe("signed-out");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("browser_failed"));
    warn.mockClear();

    let reject: (e: unknown) => void = () => undefined;
    ctx.openBrowser.mockImplementationOnce(() => new Promise((_resolve, r) => (reject = r)));
    const pending = ctx.session.login();
    await vi.advanceTimersByTimeAsync(0);
    await ctx.session.logout();
    reject(new Error("late"));
    await expect(pending).rejects.toThrow("late");
    expect(warn).not.toHaveBeenCalled();
  });

  it("a browser that answers after logout is dropped", async () => {
    const ctx = setup(vi);
    let release: (url: string | null) => void = () => undefined;
    ctx.openBrowser.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const pending = ctx.session.login();
    await vi.advanceTimersByTimeAsync(0);
    const state = lastState(ctx);
    await ctx.session.logout();
    release(callback(state));
    await pending;
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
    expect(ctx.session.status()).toBe("signed-out");
  });

  it("a second tap while the browser is open or the exchange is on the wire does not start a second attempt", async () => {
    const ctx = setup(vi);
    let releaseBrowser: (url: string | null) => void = () => undefined;
    ctx.openBrowser.mockImplementationOnce(() => new Promise((resolve) => (releaseBrowser = resolve)));
    let releaseExchange: (s: DesktopSession) => void = () => undefined;
    ctx.transport.exchange.mockImplementationOnce(() => new Promise((resolve) => (releaseExchange = resolve)));
    const first = ctx.session.login();
    await vi.advanceTimersByTimeAsync(0);
    await ctx.session.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(1);
    releaseBrowser(callback(lastState(ctx)));
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.transport.exchange).toHaveBeenCalledTimes(1);
    await ctx.session.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(1);
    releaseExchange(fakeSession());
    await first;
    expect(ctx.session.status()).toBe("signed-in");
    expect(ctx.tokens).toEqual(["at_1"]);
  });

  it("a deep link that completes the attempt while the browser is still open wins; the browser's late answer is ignored", async () => {
    const ctx = setup(vi);
    let release: (url: string | null) => void = () => undefined;
    ctx.openBrowser.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const pending = ctx.session.login();
    await vi.advanceTimersByTimeAsync(0);
    await ctx.session.completeCallback(callback(lastState(ctx)));
    expect(ctx.session.status()).toBe("signed-in");
    release(null);
    await pending;
    expect(ctx.session.status()).toBe("signed-in");
    expect(ctx.transport.exchange).toHaveBeenCalledTimes(1);
  });

  it("a session the Keychain refuses to store is revoked, never adopted", async () => {
    const ctx = setup(vi);
    ctx.storage.commit.mockRejectedValueOnce(new Error("keychain"));
    await ctx.session.login();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.tokens).toEqual([]);
    expect(await ctx.session.getAccessToken()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("storage_failed"));
    // the redeemed device session is revoked with the access token in hand, so nothing orphaned stays live
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.transport.logout).toHaveBeenCalledWith({ deviceSessionId: "dev_1" }, "at_1");
  });

  it("an exchange that lands after logout is dropped, whether it succeeds or fails; the stored write is refused", async () => {
    const ctx = setup(vi);
    let release: (s: DesktopSession) => void = () => undefined;
    ctx.transport.exchange.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const completing = ctx.session.login();
    await vi.advanceTimersByTimeAsync(0);
    await ctx.session.logout();
    release(fakeSession());
    await completing;
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.storage.current()).toBeNull();
    expect(ctx.tokens).toEqual([]);

    let reject: (e: unknown) => void = () => undefined;
    ctx.transport.exchange.mockImplementationOnce(() => new Promise((_resolve, r) => (reject = r)));
    const failing = ctx.session.login();
    await vi.advanceTimersByTimeAsync(0);
    await ctx.session.logout();
    reject(new Error("late"));
    await failing;
    expect(warn).not.toHaveBeenCalled();
    expect(ctx.session.status()).toBe("signed-out");
  });

  it("a logout that starts while the exchanged session is being written refuses the write and revokes the device", async () => {
    // the storage's own epoch check fires inside its queue, after the session's pre-write check passed
    const epochChanged = vi.fn((at: number) => at !== currentSessionEpoch());
    const ctx = setup(vi, { epochChanged });
    const commit = ctx.storage.commit.getMockImplementation()!;
    ctx.storage.commit.mockImplementationOnce(async (next, expected) => {
      await ctx.session.logout();
      return commit(next, expected);
    });
    await ctx.session.login();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.storage.current()).toBeNull();
    expect(ctx.tokens).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.transport.logout).toHaveBeenCalledWith({ deviceSessionId: "dev_1" }, "at_1");
  });

  it("onChange unsubscribes", async () => {
    const ctx = setup(vi);
    ctx.unsubscribe();
    await ctx.session.login();
    expect(ctx.tokens).toEqual([]);
  });
});

describe("restore", () => {
  it("adopts a stored session whose access token is still fresh without a network call", async () => {
    const ctx = setup(vi, { storage: createMemoryStorage(vi, stored()) });
    await ctx.session.restore();
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    expect(ctx.session.status()).toBe("signed-in");
    expect(ctx.tokens).toEqual(["at_stored"]);
    expect(await ctx.session.getAccessToken()).toBe("at_stored");
  });

  it("refreshes a stored session whose access token is near expiry; the rotated refresh token is persisted before the token is published", async () => {
    const ctx = setup(vi, { storage: createMemoryStorage(vi, stored({ expires_at: Date.now() + 30_000 })) });
    const order: string[] = [];
    const commit = ctx.storage.commit.getMockImplementation()!;
    ctx.storage.commit.mockImplementation(async (next, expected) => {
      order.push(`save:${next.refresh_token}`);
      return commit(next, expected);
    });
    ctx.session.onChange((t) => order.push(`token:${t}`));
    await ctx.session.restore();
    expect(ctx.transport.refresh).toHaveBeenCalledWith({ deviceSessionId: "dev_1", refreshToken: "rt_stored" });
    expect(ctx.storage.commit.mock.calls[0]?.[1]).toEqual({ epoch: currentSessionEpoch(), previousRefreshToken: "rt_stored" });
    expect(ctx.session.status()).toBe("signed-in");
    expect(order).toEqual(["save:rt_1", "token:at_1"]);
    expect(await ctx.session.getAccessToken()).toBe("at_1");
  });

  it("shows refreshing while the restore is on the wire, and a tap meanwhile does not open a sign-in", async () => {
    const ctx = setup(vi, { storage: createMemoryStorage(vi, stored({ expires_at: 0 })) });
    ctx.transport.refresh.mockImplementationOnce(() => new Promise(() => undefined));
    void ctx.session.restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.session.status()).toBe("refreshing");
    await ctx.session.login();
    expect(ctx.transport.start).not.toHaveBeenCalled();
  });

  it("a session bound to another deployment is never used", async () => {
    const ctx = setup(vi, { storage: createMemoryStorage(vi, stored({ deployment_id: "acme" })) });
    await ctx.session.restore();
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    expect(ctx.session.status()).toBe("signed-out");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("another deployment"));
  });

  it("no stored session, or a Keychain that will not open, reads as signed out", async () => {
    const none = setup(vi);
    await none.session.restore();
    expect(none.session.status()).toBe("signed-out");
    const locked = setup(vi);
    locked.storage.load.mockRejectedValueOnce(new Error("locked"));
    await locked.session.restore();
    expect(locked.session.status()).toBe("signed-out");
    expect(locked.transport.refresh).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unreadable"));
  });

  it("an expired refresh token is cleared without a network call", async () => {
    const ctx = setup(vi, { storage: createMemoryStorage(vi, stored({ expires_at: 0, refresh_expires_at: Date.now() - 1 })) });
    await ctx.session.restore();
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    expect(ctx.storage.current()).toBeNull();
    expect(ctx.tokens).toEqual([null]);
  });
});
