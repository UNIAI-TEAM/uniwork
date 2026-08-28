import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { getAccessToken, setAccessToken } from "../session";
import {
  authProviders,
  completeOnboarding,
  forgotPassword,
  login,
  logout,
  me,
  patchMe,
  patchOnboarding,
  registerUser,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "./auth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const user = { id: "u1", email: "a@b.c", display_name: "A" };

describe("auth endpoints", () => {
  beforeEach(() => {
    setAccessToken(null);
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("login stores the access token on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user, access_token: "tok-1" }));
    const sess = await login("a@b.c", "pw");
    expect(sess?.user.id).toBe("u1");
    expect(getAccessToken()).toBe("tok-1");
  });

  it("login returns null and leaves no token on a malformed response", async () => {
    // The one drift that cannot be smoothed over: without a token there is
    // no session, so the caller must see failure rather than half-auth.
    vi.mocked(fetch).mockResolvedValueOnce(json({ user, token: "wrong-key" }));
    await expect(login("a@b.c", "pw")).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it("registerUser posts display_name and stores the token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user, access_token: "tok-2" }));
    await registerUser("a@b.c", "pw", "A");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.c", password: "pw", display_name: "A" });
    expect(getAccessToken()).toBe("tok-2");
  });

  it("logout clears the token even when the server call fails", async () => {
    setAccessToken("tok");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await logout();
    expect(getAccessToken()).toBeNull();
  });

  it("me / patchOnboarding / completeOnboarding return the user or null", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ user }))
      .mockResolvedValueOnce(json({ user: { id: 1 } }))
      .mockResolvedValueOnce(json({ user }))
      .mockResolvedValueOnce(json({ nope: true }));
    expect((await me())?.id).toBe("u1");
    await expect(me()).resolves.toBeNull();
    expect((await patchOnboarding({ role: "pm" }))?.id).toBe("u1");
    await expect(completeOnboarding("workspace", "ws1")).resolves.toBeNull();
  });

  it("patchMe returns user or null on malformed response", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ user: { ...user, display_name: "B" } }))
      .mockResolvedValueOnce(json({ nope: true }));
    expect((await patchMe({ display_name: "B" }))?.display_name).toBe("B");
    await expect(patchMe({ display_name: "B" })).resolves.toBeNull();
  });

  it("patchMe sends locale alone", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user: { ...user, locale: "en" } }));
    const u = await patchMe({ locale: "en" });
    expect(u?.locale).toBe("en");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({ locale: "en" });
  });

  it("forgotPassword posts the email and resolves on 200", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await expect(forgotPassword("a@b.c")).resolves.toBeUndefined();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/auth/password/forgot");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "a@b.c" });
  });

  it("resetPassword stores the token on success and returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user, access_token: "tok-9" }));
    const sess = await resetPassword("tok", "newpassword1");
    expect(sess?.access_token).toBe("tok-9");
    expect(getAccessToken()).toBe("tok-9");
    vi.mocked(fetch).mockResolvedValueOnce(json({ user }));
    await expect(resetPassword("tok", "newpassword1")).resolves.toBeNull();
  });
});

describe("email verification and providers", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("verifyEmail posts the code and returns the verified user", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user: { ...user, email_verified_at: "2026-08-27T00:00:00Z" } }));
    const u = await verifyEmail("123456");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/me/email/verify");
    expect(JSON.parse(init!.body as string)).toEqual({ code: "123456" });
    expect(u?.email_verified_at).toBe("2026-08-27T00:00:00Z");
  });

  it("verifyEmail returns null on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user: { id: 1 } }));
    await expect(verifyEmail("123456")).resolves.toBeNull();
  });

  it("resendVerification resolves on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(resendVerification()).resolves.toBeUndefined();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/me/email/resend");
  });

  it("authProviders reads google and falls back to every provider off", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ google: true })).mockResolvedValueOnce(json({ google: "yes" }));
    expect(await authProviders()).toEqual({ google: true });
    expect(await authProviders()).toEqual({ google: false });
  });
});
