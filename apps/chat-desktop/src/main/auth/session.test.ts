import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createAuthCallbackRouter } from "./callback";
import {
  callback,
  createLockedCredentialStore,
  createMemoryCredentialStore,
  fail,
  fakeSession,
  lastState,
  resetFakeSessions,
  setup,
  shellConfig,
  signIn,
  stored,
} from "./fakes";
import { deviceLabel } from "./session";
import type { DesktopSession, TransportErrorCode } from "./transport";

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
  it("starts PKCE, opens the browser, exchanges the code and publishes the access token", async () => {
    const ctx = setup();
    await signIn(ctx);
    const start = ctx.transport.start.mock.calls[0]?.[0];
    expect(start).toMatchObject({
      clientId: "uniwork-chat-desktop",
      redirectUri: "uniworkchat://auth/callback",
      deviceLabel: deviceLabel(),
      platform: process.platform,
    });
    expect(start?.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const exchange = ctx.transport.exchange.mock.calls[0]?.[0];
    expect(exchange?.code).toBe("c1");
    expect(exchange?.codeVerifier).toMatch(/^[A-Za-z0-9._~-]{64}$/);
    expect(ctx.openBrowser).toHaveBeenCalledWith("https://uniwork.example/auth/desktop/authorize?attempt=1");
    expect(ctx.shell.status()).toBe("signed-in");
    expect(ctx.tokens).toEqual(["at_1"]);
    expect(await ctx.shell.getAccessToken()).toBe("at_1");
    expect(ctx.credentials.load()).toMatchObject({
      deploymentId: "default",
      apiOrigin: "https://uniwork.example",
      clientId: "uniwork-chat-desktop",
      accountId: "acc_1",
      refreshToken: "rt_1",
    });
    // signed in: another login() is a no-op
    await ctx.shell.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(1);
  });

  it("labels the device by platform", () => {
    expect(deviceLabel("darwin")).toBe("UniChat (macOS)");
    expect(deviceLabel("win32")).toBe("UniChat (Windows)");
    expect(deviceLabel("linux")).toBe("UniChat (Linux)");
  });

  it("a callback for another scheme is discarded and the attempt stays live", async () => {
    const ctx = setup();
    await ctx.shell.login();
    const state = lastState(ctx);
    await ctx.shell.completeCallback(`uniworkchat-dev://auth/callback?code=c&state=${state}`);
    expect(ctx.shell.status()).toBe("signing-in");
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
    await ctx.shell.completeCallback(callback(state));
    expect(ctx.shell.status()).toBe("signed-in");
  });

  it("a forged or malformed callback never cancels the live sign-in", async () => {
    const ctx = setup();
    await ctx.shell.login();
    const state = lastState(ctx);
    await ctx.shell.completeCallback("uniworkchat://auth/callback?code=c&state=forged");
    await ctx.shell.completeCallback(`${callback(state)}&x=1`);
    await ctx.shell.completeCallback("uniworkchat://auth/callback#code=c");
    expect(ctx.shell.status()).toBe("signing-in");
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining("state_mismatch"),
      expect.stringContaining("unexpected_query"),
      expect.stringContaining("malformed"),
    ]);
    // never the URL, code or state
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/callback\?|state=|code=/);
    await ctx.shell.completeCallback(callback(state));
    expect(ctx.transport.exchange).toHaveBeenCalledTimes(1);
    expect(ctx.shell.status()).toBe("signed-in");
  });

  it("a stray callback without an attempt changes nothing", async () => {
    const ctx = setup();
    await ctx.shell.completeCallback(callback("s"));
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
  });

  it("a callback for an expired attempt ends it without an exchange", async () => {
    const ctx = setup();
    await ctx.shell.login();
    const state = lastState(ctx);
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    await ctx.shell.completeCallback(callback(state));
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("login_timeout"));
  });

  it("times out after 10 minutes and ignores the late callback", async () => {
    const ctx = setup();
    await ctx.shell.login();
    const state = lastState(ctx);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(ctx.shell.status()).toBe("signed-out");
    await ctx.shell.completeCallback(callback(state));
    expect(ctx.transport.exchange).not.toHaveBeenCalled();
    expect(ctx.tokens).toEqual([]);
  });

  it.each<TransportErrorCode>(["auth_code_invalid", "rate_limited", "network", "wrong_deployment"])(
    "exchange failure %s returns to signed-out and a new login() starts fresh",
    async (code) => {
      const ctx = setup();
      ctx.transport.exchange.mockImplementationOnce(fail(code));
      await signIn(ctx);
      expect(ctx.shell.status()).toBe("signed-out");
      expect(ctx.credentials.load()).toBeNull();
      expect(ctx.tokens).toEqual([]);
      expect(await ctx.shell.getAccessToken()).toBeNull();
      await signIn(ctx);
      expect(ctx.shell.status()).toBe("signed-in");
      expect(ctx.transport.start).toHaveBeenCalledTimes(2);
    },
  );

  it("a start failure returns to signed-out and rejects login(); unknown errors are logged as such", async () => {
    const ctx = setup();
    ctx.transport.start.mockImplementationOnce(fail("network"));
    await expect(ctx.shell.login()).rejects.toMatchObject({ code: "network" });
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.openBrowser).not.toHaveBeenCalled();
    ctx.transport.start.mockRejectedValueOnce(new Error("boom"));
    await expect(ctx.shell.login()).rejects.toThrow("boom");
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("unknown"));
    await signIn(ctx);
    expect(ctx.shell.status()).toBe("signed-in");
  });

  it("a start() that answers after logout is dropped either way", async () => {
    const ctx = setup();
    let reject: (e: unknown) => void = () => undefined;
    ctx.transport.start.mockImplementationOnce(() => new Promise((_resolve, r) => (reject = r)));
    const rejected = ctx.shell.login();
    await ctx.shell.logout();
    reject(new Error("late"));
    await expect(rejected).rejects.toThrow("late");
    expect(warn).not.toHaveBeenCalled();

    let release: (v: { authorizationUrl: string }) => void = () => undefined;
    ctx.transport.start.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const resolved = ctx.shell.login();
    await ctx.shell.logout();
    release({ authorizationUrl: "https://uniwork.example/auth/desktop/authorize?attempt=2" });
    await resolved;
    expect(ctx.openBrowser).not.toHaveBeenCalled();
    expect(ctx.shell.status()).toBe("signed-out");
  });

  it("a browser that fails to open leaves the attempt live for the next click", async () => {
    const ctx = setup();
    ctx.openBrowser.mockRejectedValueOnce(new Error("no handler"));
    await expect(ctx.shell.login()).rejects.toThrow("no handler");
    expect(ctx.shell.status()).toBe("signing-in");
    await ctx.shell.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(1);
    expect(ctx.openBrowser).toHaveBeenCalledTimes(2);
    await ctx.shell.completeCallback(callback(lastState(ctx)));
    expect(ctx.shell.status()).toBe("signed-in");
  });

  it("a second Sign in click keeps the attempt the open browser tab belongs to", async () => {
    const ctx = setup();
    await ctx.shell.login();
    const first = lastState(ctx);
    await ctx.shell.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(1);
    expect(ctx.openBrowser).toHaveBeenCalledTimes(2);
    expect(ctx.openBrowser.mock.calls[1]?.[0]).toBe(ctx.openBrowser.mock.calls[0]?.[0]);
    await ctx.shell.completeCallback(callback(first, "c2"));
    expect(ctx.transport.exchange).toHaveBeenCalledTimes(1);
    expect(ctx.shell.status()).toBe("signed-in");
  });

  it("a click while start() is still in flight does not open a second attempt", async () => {
    const ctx = setup();
    let release: (v: { authorizationUrl: string }) => void = () => undefined;
    ctx.transport.start.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const firstClick = ctx.shell.login();
    await ctx.shell.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(1);
    expect(ctx.openBrowser).not.toHaveBeenCalled();
    release({ authorizationUrl: "https://uniwork.example/auth/desktop/authorize?attempt=1" });
    await firstClick;
    expect(ctx.openBrowser).toHaveBeenCalledTimes(1);
  });

  it("a click while the exchange is on the wire does not start a second attempt; the exchanged session is adopted", async () => {
    const ctx = setup();
    let release: (s: DesktopSession) => void = () => undefined;
    ctx.transport.exchange.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await ctx.shell.login();
    const completing = ctx.shell.completeCallback(callback(lastState(ctx)));
    await ctx.shell.login();
    expect(ctx.transport.start).toHaveBeenCalledTimes(1);
    release(fakeSession());
    await completing;
    expect(ctx.shell.status()).toBe("signed-in");
    expect(ctx.tokens).toEqual(["at_1"]);
    expect(ctx.credentials.load()?.refreshToken).toBe("rt_1");
  });

  it("refuses to sign in when the credential cannot be stored encrypted (Linux basic_text)", async () => {
    const credentials = createMemoryCredentialStore();
    credentials.canStore = () => false;
    const ctx = setup({ credentials });
    await expect(ctx.shell.login()).rejects.toMatchObject({ code: "keyring_unavailable" });
    expect(ctx.transport.start).not.toHaveBeenCalled();
    expect(ctx.shell.status()).toBe("signed-out");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("keyring_unavailable"));
  });

  it("a keystore that locks before the exchange is persisted ends the sign-in, never a half session", async () => {
    const ctx = setup({ credentials: createLockedCredentialStore() });
    await signIn(ctx);
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.tokens).toEqual([]);
    expect(await ctx.shell.getAccessToken()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("keystore_locked"));
    // the redeemed device session is revoked with the access token in hand, so nothing orphaned stays live
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.transport.logout).toHaveBeenCalledWith({ deviceSessionId: "dev_1" }, "at_1");
  });

  it("an exchange that lands after logout is dropped, whether it succeeds or fails", async () => {
    const ctx = setup();
    let release: (s: DesktopSession) => void = () => undefined;
    ctx.transport.exchange.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await ctx.shell.login();
    const completing = ctx.shell.completeCallback(callback(lastState(ctx)));
    await ctx.shell.logout();
    release(fakeSession());
    await completing;
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.credentials.load()).toBeNull();
    expect(ctx.tokens).toEqual([]);

    let reject: (e: unknown) => void = () => undefined;
    ctx.transport.exchange.mockImplementationOnce(() => new Promise((_resolve, r) => (reject = r)));
    await ctx.shell.login();
    const failing = ctx.shell.completeCallback(callback(lastState(ctx)));
    await ctx.shell.logout();
    reject(new Error("late"));
    await failing;
    expect(warn).not.toHaveBeenCalled();
    expect(ctx.shell.status()).toBe("signed-out");
  });

  it("a callback delivered by a second instance (Windows argv) completes the sign-in", async () => {
    const ctx = setup();
    const router = createAuthCallbackRouter(["C:\\UniChat\\UniChat.exe"], shellConfig.scheme);
    router.start((url) => void ctx.shell.completeCallback(url));
    await ctx.shell.login();
    expect(router.secondInstance(["C:\\UniChat\\UniChat.exe", callback(lastState(ctx), "c2")])).toBe(true);
    await vi.waitFor(() => expect(ctx.shell.status()).toBe("signed-in"));
    expect(ctx.transport.exchange.mock.calls[0]?.[0]).toMatchObject({ code: "c2" });
    expect(ctx.credentials.load()?.refreshToken).toMatch(/^rt_/);
  });

  it("onChange unsubscribes", async () => {
    const ctx = setup();
    ctx.unsubscribe();
    await signIn(ctx);
    expect(ctx.tokens).toEqual([]);
  });
});

describe("restore", () => {
  it("restores by refreshing; the rotated refresh token is persisted before the token is published", async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) });
    const order: string[] = [];
    const save = ctx.credentials.save.bind(ctx.credentials);
    ctx.credentials.save = (c) => {
      order.push(`save:${c.refreshToken}`);
      save(c);
    };
    ctx.shell.onChange((t) => order.push(`token:${t}`));
    await ctx.shell.restore();
    expect(ctx.transport.refresh).toHaveBeenCalledWith({ deviceSessionId: "dev_1", refreshToken: "rt_stored" });
    expect(ctx.shell.status()).toBe("signed-in");
    expect(order).toEqual(["save:rt_1", "token:at_1"]);
    expect(await ctx.shell.getAccessToken()).toBe("at_1");
  });

  it("shows refreshing while the restore is on the wire", async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored()) });
    ctx.transport.refresh.mockImplementationOnce(() => new Promise(() => undefined));
    void ctx.shell.restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.shell.status()).toBe("refreshing");
    // a click during the restore does not open a second sign-in
    await ctx.shell.login();
    expect(ctx.transport.start).not.toHaveBeenCalled();
  });

  it("a credential bound to another deployment is never used", async () => {
    for (const other of [{ apiOrigin: "https://other.example" }, { deploymentId: "acme" }, { clientId: "x" }]) {
      const ctx = setup({ credentials: createMemoryCredentialStore(stored(other)) });
      await ctx.shell.restore();
      expect(ctx.transport.refresh).not.toHaveBeenCalled();
      expect(ctx.shell.status()).toBe("signed-out");
    }
  });

  it("no stored credential, or a keystore that will not open, reads as signed out", async () => {
    const none = setup();
    await none.shell.restore();
    expect(none.shell.status()).toBe("signed-out");
    const locked = setup({ credentials: createLockedCredentialStore() });
    await locked.shell.restore();
    expect(locked.shell.status()).toBe("signed-out");
    expect(locked.transport.refresh).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("keystore_locked"));
  });

  it("an expired refresh token is cleared without a network call", async () => {
    const ctx = setup({ credentials: createMemoryCredentialStore(stored({ refreshExpiresAt: Date.now() - 1 })) });
    await ctx.shell.restore();
    expect(ctx.shell.status()).toBe("signed-out");
    expect(ctx.transport.refresh).not.toHaveBeenCalled();
    expect(ctx.credentials.load()).toBeNull();
    expect(ctx.tokens).toEqual([null]);
  });
});
