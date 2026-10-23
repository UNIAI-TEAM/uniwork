// MobileSession.loginWith: a sign-in that issues the session without the browser (Sign in with Apple, ADR 0041).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage, fail, fakeSession, resetFakeSessions, setup, stored } from "./fakes";
import { TransportError, type DesktopSession } from "./transport";

vi.mock("expo-crypto", async () => (await import("./expo-crypto-mock")).expoCryptoMock());

beforeEach(() => {
  resetFakeSessions();
  vi.useFakeTimers({ now: new Date("2026-10-01T00:00:00Z") });
});
afterEach(() => vi.useRealTimers());

const issuer = (answer: () => Promise<DesktopSession | null>) => vi.fn<(stale: () => boolean) => Promise<DesktopSession | null>>(answer);

describe("a sign-in that issues the session itself", () => {
  it("adopts what the server issued: the Keychain first, then the token", async () => {
    const ctx = setup(vi);
    await ctx.session.loginWith(issuer(async () => fakeSession()));
    expect(ctx.session.status()).toBe("signed-in");
    expect(ctx.tokens).toEqual(["at_1"]);
    expect(ctx.storage.current()?.refresh_token).toBe("rt_1");
    expect(ctx.transport.start).not.toHaveBeenCalled();
  });

  it("a closed sheet leaves nobody signed in, and a second tap starts again", async () => {
    const ctx = setup(vi);
    await ctx.session.loginWith(issuer(async () => null));
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.tokens).toEqual([]);
    await ctx.session.loginWith(issuer(async () => fakeSession()));
    expect(ctx.session.status()).toBe("signed-in");
  });

  it("rejects with the server's verdict, for the screen to explain, and is ready for another try", async () => {
    const ctx = setup(vi);
    await expect(ctx.session.loginWith(issuer(fail("apple_account_conflict")))).rejects.toMatchObject({
      code: "apple_account_conflict",
      fromServer: true,
    });
    expect(ctx.session.status()).toBe("signed-out");
    await expect(ctx.session.loginWith(issuer(() => Promise.reject(new Error("ASAuthorizationError 1000"))))).rejects.toThrow("1000");
    expect(ctx.session.status()).toBe("signed-out");
    expect(ctx.tokens).toEqual([]);
  });

  it("tells the issuer when a sign-out moved on, and drops what comes back after it", async () => {
    const ctx = setup(vi);
    let staleSeen: boolean | null = null;
    await ctx.session.loginWith(async (stale) => {
      await ctx.session.logout();
      staleSeen = stale();
      return fakeSession();
    });
    expect(staleSeen).toBe(true);
    expect(ctx.tokens).toEqual([]);
    expect(ctx.storage.current()).toBeNull();
    // a failure after the sign-out still rejects, and changes no state
    await expect(
      ctx.session.loginWith(async () => {
        await ctx.session.logout();
        throw new TransportError("network");
      }),
    ).rejects.toMatchObject({ code: "network" });
    expect(ctx.session.status()).toBe("signed-out");
  });

  it("a session the Keychain refuses is revoked, not orphaned", async () => {
    const storage = createMemoryStorage(vi);
    storage.commit.mockRejectedValueOnce(new Error("keychain"));
    const ctx = setup(vi, { storage });
    await ctx.session.loginWith(issuer(async () => fakeSession()));
    expect(ctx.session.status()).toBe("signed-out");
    await vi.runAllTimersAsync();
    expect(ctx.transport.logout).toHaveBeenCalledOnce();
  });

  it("does nothing while signed in, and recovers a live session instead of shadowing it", async () => {
    const ctx = setup(vi);
    const first = issuer(async () => fakeSession());
    await ctx.session.loginWith(first);
    await ctx.session.loginWith(first);
    expect(first).toHaveBeenCalledOnce();

    const live = setup(vi, { storage: createMemoryStorage(vi, stored({ expires_at: Date.now() - 1 })) });
    live.transport.refresh.mockImplementationOnce(fail("network"));
    await live.session.restore();
    expect(live.session.status()).toBe("server-unreachable");
    const shadow = issuer(async () => fakeSession());
    await live.session.loginWith(shadow);
    expect(shadow).not.toHaveBeenCalled();
    expect(live.transport.refresh).toHaveBeenCalledTimes(2);
  });
});
