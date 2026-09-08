import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { getAccessToken, setAccessToken } from "../session";
import {
  authProviders,
  completeOnboarding,
  deleteAccount,
  forgotPassword,
  listSessions,
  login,
  logout,
  me,
  mfaConfirm,
  mfaDisable,
  mfaSetup,
  patchMe,
  patchOnboarding,
  registerUser,
  resendVerification,
  resetPassword,
  revokeOtherSessions,
  revokeSession,
  verifyEmail,
  verifyMfa,
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
    expect(sess && "user" in sess ? sess.user.id : null).toBe("u1");
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
    expect(sess && "access_token" in sess ? sess.access_token : null).toBe("tok-9");
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

  describe("identity hardening (F-01)", () => {
    it("login returns the MFA challenge without storing a token", async () => {
      setAccessToken(null);
      vi.mocked(fetch).mockResolvedValueOnce(json({ mfa_required: true, mfa_token: "chal" }));
      const out = await login("a@b.c", "pw");
      expect(out).toEqual({ mfa_required: true, mfa_token: "chal" });
      expect(getAccessToken()).toBeNull();
    });

    it("verifyMfa stores the token and sends the cookie-only shape when no token is held", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ user, access_token: "tok-2" }));
      const sess = await verifyMfa(null, "123456");
      expect(sess?.access_token).toBe("tok-2");
      expect(getAccessToken()).toBe("tok-2");
      const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
      expect(body).toEqual({ mfa_token: "", code: "123456" });
    });

    it("verifyMfa degrades to null on a malformed response", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ nope: 1 }));
      expect(await verifyMfa("chal", "123456")).toBeNull();
      expect(getAccessToken()).toBeNull();
    });

    it("mfaSetup / mfaConfirm / mfaDisable degrade instead of throwing", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ secret: "S", otpauth_url: "otpauth://x" }));
      expect(await mfaSetup()).toEqual({ secret: "S", otpauth_url: "otpauth://x" });
      vi.mocked(fetch).mockResolvedValueOnce(json({ secret: 1 }));
      expect(await mfaSetup()).toBeNull();

      vi.mocked(fetch).mockResolvedValueOnce(json({ recovery_codes: ["a-b", "c-d"] }));
      expect(await mfaConfirm("123456")).toEqual(["a-b", "c-d"]);
      vi.mocked(fetch).mockResolvedValueOnce(json({ recovery_codes: "oops" }));
      expect(await mfaConfirm("123456")).toEqual([]);

      vi.mocked(fetch).mockResolvedValueOnce(json({ user: { ...user, mfa_enabled_at: null } }));
      expect((await mfaDisable("123456"))?.mfa_enabled_at).toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json({ user: 42 }));
      expect(await mfaDisable("123456")).toBeNull();
    });

    it("sessions list degrades to [] and revocations hit the right paths", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ sessions: [{ id: "s1", current: true }] }));
      const list = await listSessions();
      expect(list).toEqual([{ id: "s1", user_agent: "", ip: "", created_at: "", last_seen_at: "", current: true }]);
      vi.mocked(fetch).mockResolvedValueOnce(json({ sessions: "drift" }));
      expect(await listSessions()).toEqual([]);

      vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
      await revokeSession("s 1");
      expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toContain("/api/v1/me/sessions/s%201");
      expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
      vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
      await revokeOtherSessions();
      expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toContain("/api/v1/me/sessions/revoke-others");
    });

    it("deleteAccount drops the token", async () => {
      setAccessToken("tok-3");
      vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
      await deleteAccount({ password: "pw" });
      expect(getAccessToken()).toBeNull();
    });
  });
});
