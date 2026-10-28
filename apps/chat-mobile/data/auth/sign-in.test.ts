// The ways into the app (sign-in.ts) over a real MobileSession (fakes.ts) and a stand-in for core's door factory:
// what each door sends, what it leaves waiting, and what a session from it spends.
import type { NativeSignInApi } from "@uniwork/core/api/endpoints/sign-in-native-api";
import type { NativeSignInResult } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileSession } from "./session";

vi.mock("expo-crypto", async () => (await import("./expo-crypto-mock")).expoCryptoMock());
const appleSheet = vi.hoisted(() => ({ isAvailableAsync: vi.fn(), signInAsync: vi.fn(), AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 } }));
vi.mock("expo-apple-authentication", () => appleSheet);

type Door = (input: Record<string, unknown>) => Promise<NativeSignInResult | null>;
const flow = vi.hoisted(() => ({
  session: null as MobileSession | null,
  api: {
    signInWithPassword: vi.fn<Door>(),
    verifySecondFactor: vi.fn<Door>(),
    signInWithApple: vi.fn<Door>(),
    register: vi.fn<Door>(),
    createFromTicket: vi.fn<Door>(),
    verifyTicketEmailCode: vi.fn<Door>(),
    sendTicketEmailCode: vi.fn<(input: Record<string, unknown>) => Promise<boolean>>(async () => true),
  },
}));
vi.mock("./flow", () => ({
  authConfig: { deploymentId: "default" },
  get session() {
    return flow.session;
  },
  nativeSignIn: flow.api as unknown as NativeSignInApi,
}));

import { setup } from "./fakes";
import { CHOICE_TTL_MS, SECOND_FACTOR_TTL_MS, forgetPendingSignIn, holdStep, pendingTicket, usePendingSignIn } from "./pending-sign-in";
import { forgetSignIn, runSignIn, sendClaimCode } from "./sign-in";

const sessionBody = {
  account_id: "acc_1",
  device_session_id: "dev_1",
  session_id: "sess_1",
  deployment_id: "default",
  access_token: "at_1",
  token_type: "Bearer",
  expires_in: 900,
  refresh_token: "rt_1",
  refresh_expires_in: 2592000,
};
const signedIn = (extra: Partial<{ reclaimed: boolean; link_skipped: string | null }> = {}): NativeSignInResult => ({
  status: "signed_in",
  session: sessionBody,
  reclaimed: false,
  link_skipped: null,
  ...extra,
});
const mfaRequired: NativeSignInResult = { status: "mfa_required", mfa_token: "mfa_1" };
const identity = { provider: "apple" as const, email: "an@privaterelay.appleid.com", name: "", private_relay: true };
const unmatched: NativeSignInResult = { status: "identity_unmatched", ticket: "t_1", identity };
const appleCredential = {
  identityToken: "apple.id.token",
  authorizationCode: "code_1",
  fullName: { givenName: "An", familyName: "Nguyễn" },
  email: "an@privaterelay.appleid.com",
};

const NOW = Date.parse("2026-10-28T09:00:00Z");
let ctx: ReturnType<typeof setup>;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.clearAllMocks();
  forgetPendingSignIn();
  ctx = setup(vi);
  flow.session = ctx.session;
});
afterEach(() => vi.useRealTimers());

/** the choice screen's ticket, as an Apple sign-in that matched no account leaves it */
const holdChoice = () => holdStep({ kind: "choice", ticket: "t_1", nonce: "n_1", identity, ticketKind: "unmatched" }, NOW);

describe("email and password", () => {
  it("signs in, with what the screen says once, and drops a second step left from before", async () => {
    holdStep({ kind: "mfa", token: "old", context: { method: "apple", email: null, provider: "apple" } }, NOW);
    flow.api.signInWithPassword.mockResolvedValueOnce(signedIn({ reclaimed: true }));
    expect(await runSignIn({ method: "password", email: "  an@example.com ", password: " pw with spaces " })).toEqual({
      kind: "signed_in",
      reclaimed: true,
      linkSkipped: null,
    });
    expect(flow.api.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: "an@example.com", password: " pw with spaces " });
    expect(ctx.session.status()).toBe("signed-in");
    expect(ctx.tokens).toEqual(["at_1"]);
    expect(usePendingSignIn.getState().secondFactor).toBeNull();
  });

  it("stops at the second factor, holding the challenge with whose sign-in it is", async () => {
    flow.api.signInWithPassword.mockResolvedValueOnce(mfaRequired);
    expect(await runSignIn({ method: "password", email: "an@example.com", password: "pw" })).toEqual({ kind: "second_factor" });
    expect(ctx.session.status()).toBe("signed-out");
    expect(usePendingSignIn.getState().secondFactor).toEqual({
      context: { method: "password", email: "an@example.com", provider: null },
      expiresAtMs: NOW + SECOND_FACTOR_TTL_MS,
    });
  });

  it("keeps the choice screen's ticket, to link the identity into the account the person signed in to", async () => {
    holdChoice();
    flow.api.signInWithPassword.mockResolvedValueOnce(signedIn());
    await runSignIn({ method: "password", email: "an@example.com", password: "pw" });
    expect(pendingTicket(NOW)).toEqual({ ticket: "t_1", nonce: "n_1" });
  });

  it("rejects with the door's verdict and lets nobody in", async () => {
    flow.api.signInWithPassword.mockRejectedValueOnce(Object.assign(new Error("401"), { code: "invalid_credentials" }));
    await expect(runSignIn({ method: "password", email: "an@example.com", password: "wrong" })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(ctx.session.status()).toBe("signed-out");
  });

  it("fails closed on an answer core could not read", async () => {
    flow.api.signInWithPassword.mockResolvedValueOnce(null);
    await expect(runSignIn({ method: "password", email: "an@example.com", password: "pw" })).rejects.toMatchObject({ code: "malformed_response" });
    expect(ctx.tokens).toEqual([]);
  });
});

describe("the second factor", () => {
  it("sends the held challenge with the code, and a session spends the challenge", async () => {
    holdStep({ kind: "mfa", token: "mfa_1", context: { method: "password", email: "an@example.com", provider: null } }, NOW);
    holdChoice();
    flow.api.verifySecondFactor.mockResolvedValueOnce(signedIn({ link_skipped: "sign_in_method_taken" }));
    expect(await runSignIn({ method: "second_factor", code: " 123 456 " })).toEqual({ kind: "signed_in", reclaimed: false, linkSkipped: "sign_in_method_taken" });
    expect(flow.api.verifySecondFactor).toHaveBeenCalledExactlyOnceWith({ mfaToken: "mfa_1", code: "123 456" });
    expect(usePendingSignIn.getState().secondFactor).toBeNull();
    // the password's second factor spends no ticket
    expect(pendingTicket(NOW)).not.toBeNull();
  });

  it("says the sign-in expired, without asking the server, once the challenge is gone", async () => {
    await expect(runSignIn({ method: "second_factor", code: "123456" })).rejects.toMatchObject({ code: "sign_in_expired", fromServer: false });
    holdStep({ kind: "mfa", token: "mfa_1", context: { method: "password", email: null, provider: null } }, NOW);
    vi.setSystemTime(NOW + SECOND_FACTOR_TTL_MS);
    await expect(runSignIn({ method: "second_factor", code: "123456" })).rejects.toMatchObject({ code: "sign_in_expired" });
    expect(flow.api.verifySecondFactor).not.toHaveBeenCalled();
    expect(ctx.session.status()).toBe("signed-out");
  });
});

describe("Apple's sheet", () => {
  it("sends the identity token, the raw nonce, the first consent's code and name, and the intent", async () => {
    appleSheet.signInAsync.mockResolvedValueOnce(appleCredential);
    flow.api.signInWithApple.mockResolvedValueOnce(signedIn());
    expect(await runSignIn({ method: "apple", intent: "sign_up" })).toMatchObject({ kind: "signed_in" });
    const [sent] = flow.api.signInWithApple.mock.calls[0] as [Record<string, unknown>];
    expect(sent).toEqual({
      identityToken: "apple.id.token",
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      authorizationCode: "code_1",
      givenName: "An",
      familyName: "Nguyễn",
      intent: "sign_up",
    });
  });

  it("leaves out what Apple did not share on a later sign-in", async () => {
    appleSheet.signInAsync.mockResolvedValueOnce({ identityToken: "t", authorizationCode: null, fullName: null, email: null });
    flow.api.signInWithApple.mockResolvedValueOnce(signedIn());
    await runSignIn({ method: "apple" });
    expect(flow.api.signInWithApple.mock.calls[0]?.[0]).toEqual({
      identityToken: "t",
      nonce: expect.any(String),
      authorizationCode: undefined,
      givenName: undefined,
      familyName: undefined,
      intent: undefined,
    });
  });

  it("holds a ticket for the choice screen with the raw nonce the sheet was given", async () => {
    appleSheet.signInAsync.mockResolvedValueOnce(appleCredential);
    flow.api.signInWithApple.mockResolvedValueOnce(unmatched);
    expect(await runSignIn({ method: "apple" })).toEqual({ kind: "choice" });
    const [sent] = flow.api.signInWithApple.mock.calls[0] as [{ nonce: string }];
    expect(pendingTicket(NOW)).toEqual({ ticket: "t_1", nonce: sent.nonce });
    expect(usePendingSignIn.getState().choice).toEqual({ identity, ticketKind: "unmatched", expiresAtMs: NOW + CHOICE_TTL_MS });
  });

  it("names the address Apple shared and the provider a second factor may link", async () => {
    appleSheet.signInAsync.mockResolvedValueOnce(appleCredential);
    flow.api.signInWithApple.mockResolvedValueOnce(mfaRequired);
    expect(await runSignIn({ method: "apple" })).toEqual({ kind: "second_factor" });
    expect(usePendingSignIn.getState().secondFactor?.context).toEqual({ method: "apple", email: "an@privaterelay.appleid.com", provider: "apple" });
  });

  it("asks the server nothing when the sheet is closed, or when a sign-out moved on while it was up", async () => {
    appleSheet.signInAsync.mockRejectedValueOnce(Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" }));
    expect(await runSignIn({ method: "apple" })).toEqual({ kind: "dismissed" });
    appleSheet.signInAsync.mockImplementationOnce(async () => {
      await ctx.session.logout();
      return appleCredential;
    });
    expect(await runSignIn({ method: "apple" })).toEqual({ kind: "dismissed" });
    expect(flow.api.signInWithApple).not.toHaveBeenCalled();
  });
});

describe("a new account by email", () => {
  it("sends the name and the address trimmed, the password as typed", async () => {
    flow.api.register.mockResolvedValueOnce(signedIn());
    expect(await runSignIn({ method: "register", email: " an@example.com", password: " pw ", displayName: " An " })).toMatchObject({ kind: "signed_in" });
    expect(flow.api.register).toHaveBeenCalledExactlyOnceWith({ email: "an@example.com", password: " pw ", displayName: "An" });
  });
});

describe("the choice screen", () => {
  it("opens a new account with the held ticket, which the session spends", async () => {
    holdChoice();
    flow.api.createFromTicket.mockResolvedValueOnce(signedIn());
    expect(await runSignIn({ method: "ticket", displayName: "  An Nguyễn " })).toMatchObject({ kind: "signed_in" });
    expect(flow.api.createFromTicket).toHaveBeenCalledExactlyOnceWith({ ticket: "t_1", nonce: "n_1", displayName: "An Nguyễn" });
    expect(usePendingSignIn.getState().choice).toBeNull();
  });

  it("sends no display name the person left blank", async () => {
    holdChoice();
    flow.api.createFromTicket.mockResolvedValueOnce(signedIn());
    await runSignIn({ method: "ticket", displayName: "   " });
    expect(flow.api.createFromTicket.mock.calls[0]?.[0]).toEqual({ ticket: "t_1", nonce: "n_1", displayName: undefined });
  });

  it("mails a code to another address for the held ticket, and checks it", async () => {
    holdChoice();
    expect(await sendClaimCode(" an@company.vn ")).toBe(true);
    expect(flow.api.sendTicketEmailCode).toHaveBeenCalledExactlyOnceWith({ ticket: "t_1", nonce: "n_1", email: "an@company.vn" });
    flow.api.verifyTicketEmailCode.mockResolvedValueOnce(signedIn());
    expect(await runSignIn({ method: "email_claim", email: "an@company.vn", code: " 654321 ", displayName: "" })).toMatchObject({ kind: "signed_in" });
    expect(flow.api.verifyTicketEmailCode).toHaveBeenCalledExactlyOnceWith({
      ticket: "t_1",
      nonce: "n_1",
      email: "an@company.vn",
      code: "654321",
      displayName: undefined,
    });
    expect(usePendingSignIn.getState().choice).toBeNull();
  });

  it("goes on to the second factor of the address's account, linking the identity once it passes", async () => {
    holdChoice();
    flow.api.verifyTicketEmailCode.mockResolvedValueOnce(mfaRequired);
    expect(await runSignIn({ method: "email_claim", email: "an@company.vn", code: "654321" })).toEqual({ kind: "second_factor" });
    expect(usePendingSignIn.getState().secondFactor?.context).toEqual({ method: "email_claim", email: "an@company.vn", provider: "apple" });
    flow.api.verifySecondFactor.mockResolvedValueOnce(signedIn());
    await runSignIn({ method: "second_factor", code: "123456" });
    // the challenge carried the link: the ticket is spent with it
    expect(usePendingSignIn.getState()).toEqual({ choice: null, secondFactor: null });
  });

  it("names the identity's address for a new account's second factor", async () => {
    holdChoice();
    flow.api.createFromTicket.mockResolvedValueOnce(mfaRequired);
    await runSignIn({ method: "ticket" });
    expect(usePendingSignIn.getState().secondFactor?.context).toEqual({ method: "ticket", email: identity.email, provider: "apple" });
  });

  it("says the sign-in expired, without asking the server, once the ticket is gone", async () => {
    await expect(runSignIn({ method: "ticket" })).rejects.toMatchObject({ code: "sign_in_expired" });
    await expect(sendClaimCode("an@company.vn")).rejects.toMatchObject({ code: "sign_in_expired" });
    holdChoice();
    vi.setSystemTime(NOW + CHOICE_TTL_MS);
    await expect(runSignIn({ method: "email_claim", email: "an@company.vn", code: "654321" })).rejects.toMatchObject({ code: "sign_in_expired" });
    expect(flow.api.createFromTicket).not.toHaveBeenCalled();
    expect(flow.api.verifyTicketEmailCode).not.toHaveBeenCalled();
    expect(flow.api.sendTicketEmailCode).not.toHaveBeenCalled();
  });

  it("names no provider when the choice is gone by the time its second factor is asked", async () => {
    holdChoice();
    flow.api.createFromTicket.mockImplementationOnce(async () => {
      forgetPendingSignIn();
      return mfaRequired;
    });
    await runSignIn({ method: "ticket" });
    expect(usePendingSignIn.getState().secondFactor?.context).toEqual({ method: "ticket", email: null, provider: null });
  });
});

describe("the browser", () => {
  it("hands the provider button to the web sign-in page and spends a second step left waiting", async () => {
    holdStep({ kind: "mfa", token: "mfa_1", context: { method: "password", email: null, provider: null } }, NOW);
    expect(await runSignIn({ method: "browser", provider: "apple" })).toEqual({ kind: "signed_in", reclaimed: false, linkSkipped: null });
    expect(ctx.transport.start.mock.calls[0]?.[0]).toMatchObject({ provider: "apple" });
    expect(usePendingSignIn.getState().secondFactor).toBeNull();
  });

  it("asks for no provider unless one was tapped, and reads a closed browser as nothing", async () => {
    ctx.openBrowser.mockResolvedValueOnce(null);
    expect(await runSignIn({ method: "browser" })).toEqual({ kind: "dismissed" });
    expect(ctx.transport.start.mock.calls[0]?.[0]).not.toHaveProperty("provider");
  });
});

describe("a session already there", () => {
  it("is not shadowed by a second sign-in, and reads as signed in", async () => {
    await runSignIn({ method: "browser" });
    expect(await runSignIn({ method: "password", email: "an@example.com", password: "pw" })).toEqual({ kind: "signed_in", reclaimed: false, linkSkipped: null });
    expect(flow.api.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("a sign-out", () => {
  it("forgets everything a sign-in left waiting", () => {
    holdChoice();
    holdStep({ kind: "mfa", token: "mfa_1", context: { method: "password", email: null, provider: null } }, NOW);
    forgetSignIn();
    expect(usePendingSignIn.getState()).toEqual({ choice: null, secondFactor: null });
    expect(pendingTicket(NOW)).toBeNull();
  });
});
