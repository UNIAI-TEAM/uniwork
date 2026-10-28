import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { getAccessToken, setAccessToken } from "../session";
import { getSignInMethods, sendStepUpEmailCode, setPassword, startLink, stepUp, unlink } from "./sign-in-methods";
import {
  createFromSignInTicket,
  discardSignInTicket,
  getSignInTicket,
  linkSignInTicket,
  sendSignInEmailClaim,
  verifySignInEmailClaim,
} from "./sign-in-ticket";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (code: string, status: number) => json({ error: { code, message: code } }, status);

const user = { id: "u1", email: "an@acme.vn", display_name: "An" };
const methods = {
  password: { set: false, changed_at: null },
  google: { linked: true, email: "an@gmail.com", linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["email_code"],
};

const call = (i = -1) => {
  const [url, init] = vi.mocked(fetch).mock.calls.at(i)!;
  return { url: String(url), method: init?.method, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown) };
};

describe("the choice screen's endpoints (web ticket)", () => {
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

  it("reads the pending sign-in; no ticket is null, a malformed one is null, anything else throws", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ provider: "google", kind: "unmatched", email: "an@gmail.com", name: "An", private_relay: false }))
      .mockResolvedValueOnce(refusal("sign_in_ticket_missing", 404))
      .mockResolvedValueOnce(json({ provider: 1 }))
      .mockResolvedValueOnce(refusal("internal", 500));
    await expect(getSignInTicket()).resolves.toMatchObject({ provider: "google", kind: "unmatched" });
    expect(call(0)).toEqual({ url: "http://api.test/api/v1/auth/sign-in-ticket", method: "GET", body: undefined });
    await expect(getSignInTicket()).resolves.toBeNull();
    await expect(getSignInTicket()).resolves.toBeNull();
    await expect(getSignInTicket()).rejects.toMatchObject({ status: 500 });
  });

  it("creates the account (a JSON body even without a name) and stores the session", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user, access_token: "tok" })).mockResolvedValueOnce(json({ user, access_token: "tok2" }));
    await expect(createFromSignInTicket()).resolves.toMatchObject({ access_token: "tok" });
    expect(call(0)).toEqual({ url: "http://api.test/api/v1/auth/sign-in-ticket/create", method: "POST", body: {} });
    expect(getAccessToken()).toBe("tok");
    await createFromSignInTicket("An");
    expect(call(1).body).toEqual({ display_name: "An" });
  });

  it("create and claim-email verify fail loudly: a malformed session is null and leaves no token", async () => {
    setAccessToken("old");
    vi.mocked(fetch).mockResolvedValueOnce(json({ user, token: "wrong-key" })).mockResolvedValueOnce(json({ nope: 1 }));
    await expect(createFromSignInTicket()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
    await expect(verifySignInEmailClaim({ email: "an@acme.vn", code: "482913" })).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it("mails the claim code and verifies it, answering the second factor still owed when there is one", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ status: "sent" }))
      .mockResolvedValueOnce(json({ status: "queued" }))
      .mockResolvedValueOnce(json({ mfa_required: true, mfa_token: "chal" }))
      .mockResolvedValueOnce(json({ user, access_token: "tok", reclaimed: true }));
    await expect(sendSignInEmailClaim("an@acme.vn")).resolves.toBe(true);
    expect(call(0)).toEqual({
      url: "http://api.test/api/v1/auth/sign-in-ticket/claim-email",
      method: "POST",
      body: { email: "an@acme.vn" },
    });
    await expect(sendSignInEmailClaim("an@acme.vn")).resolves.toBe(false);
    await expect(verifySignInEmailClaim({ email: "an@acme.vn", code: "482913" })).resolves.toEqual({
      mfa_required: true,
      mfa_token: "chal",
    });
    expect(call(2).body).toEqual({ email: "an@acme.vn", code: "482913" });
    expect(getAccessToken()).toBeNull();
    await expect(verifySignInEmailClaim({ email: "an@acme.vn", code: "482913", displayName: "An" })).resolves.toMatchObject({
      reclaimed: true,
    });
    expect(call(3).body).toEqual({ email: "an@acme.vn", code: "482913", display_name: "An" });
    expect(getAccessToken()).toBe("tok");
  });

  it("discards with a DELETE", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await discardSignInTicket();
    expect(call()).toEqual({ url: "http://api.test/api/v1/auth/sign-in-ticket", method: "DELETE", body: undefined });
  });

  it("links the pending identity, sending only what was asked, and degrades on drift", async () => {
    setAccessToken("bearer");
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ user, sign_in_methods: methods }))
      .mockResolvedValueOnce(json({ user: 1, sign_in_methods: 2 }));
    const out = await linkSignInTicket({});
    expect(out.user?.id).toBe("u1");
    expect(out.methods?.google.linked).toBe(true);
    expect(call(0)).toEqual({ url: "http://api.test/api/v1/auth/sign-in-ticket/link", method: "POST", body: {} });
    await expect(linkSignInTicket({ move: true, stepUpToken: "su" })).resolves.toEqual({ user: null, methods: null });
    expect(call(1).body).toEqual({ move: true, step_up_token: "su" });
  });

  it("refreshes an expired bearer once, since the transport never does under /auth/", async () => {
    setAccessToken("stale");
    vi.mocked(fetch)
      .mockResolvedValueOnce(refusal("unauthorized", 401))
      .mockResolvedValueOnce(json({ user, access_token: "fresh" }))
      .mockResolvedValueOnce(json({ user, sign_in_methods: methods }));
    await expect(linkSignInTicket({})).resolves.toMatchObject({ user: { id: "u1" } });
    expect(call(1).url).toBe("http://api.test/api/v1/auth/refresh");
    expect(getAccessToken()).toBe("fresh");
  });

  it("stays refused when the session ended or the refusal is not a 401", async () => {
    setAccessToken("stale");
    vi.mocked(fetch).mockResolvedValueOnce(refusal("invalid_token", 401)).mockResolvedValueOnce(refusal("unauthorized", 401));
    await expect(linkSignInTicket({})).rejects.toMatchObject({ code: "invalid_token" });
    setAccessToken("bearer");
    vi.mocked(fetch).mockResolvedValueOnce(refusal("proof_required", 403));
    await expect(linkSignInTicket({})).rejects.toMatchObject({ code: "proof_required" });
  });
});

describe("the web's step-up and sign-in method endpoints", () => {
  beforeEach(() => {
    setAccessToken("bearer");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("degrade instead of throwing on a malformed response", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ password: 1 }))
      .mockResolvedValueOnce(json({ step_up_token: 5 }))
      .mockResolvedValueOnce(json({ status: 9 }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ authorization_url: "ftp://x" }))
      .mockResolvedValueOnce(json(null));
    await expect(getSignInMethods()).resolves.toBeNull();
    await expect(stepUp({ kind: "password", password: "pw" }, "set_password")).resolves.toBeNull();
    await expect(sendStepUpEmailCode("set_password")).resolves.toBe(false);
    await expect(setPassword({ new_password: "new-password-2026", step_up_token: "su" })).resolves.toEqual({ user: null, methods: null });
    await expect(startLink("google", { stepUpToken: "su" })).resolves.toBeNull();
    await expect(unlink("google", "su")).resolves.toEqual({ user: null, methods: null });
  });

  it("reach the server through the web transport with the bearer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(methods));
    await expect(getSignInMethods()).resolves.toEqual(methods);
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/me/sign-in-methods");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer bearer");
  });
});
