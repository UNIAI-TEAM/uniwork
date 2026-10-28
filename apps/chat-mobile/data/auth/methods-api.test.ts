// The bearer binding of core's sign-in methods factory: what reaches data/api.ts, and what the app holds of it.
import { STEP_UP_WINDOW_MS } from "@uniwork/core/auth/step-up";
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>());
vi.mock("../api", () => ({ api: { request } }));
vi.mock("./flow", () => ({ nativeClient: { client_id: "uniwork-chat-mobile", deployment_id: "default", platform: "ios" } }));

import { linkPendingTicket, signInMethodsApi, stepUp } from "./methods-api";
import { forgetPendingSignIn, holdStep, usePendingSignIn } from "./pending-sign-in";
import { forgetStepUp, holdStepUp, stepUpToken } from "./step-up-store";

const NOW = Date.now();
const body = (call = 0) => JSON.parse(String(request.mock.calls[call]?.[1]?.body)) as Record<string, unknown>;
const identity = { provider: "google" as const, email: "an@gmail.com", name: "An", private_relay: false };
const methods = {
  password: { set: true, changed_at: null },
  google: { linked: true, email: "an@gmail.com", linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
};

beforeEach(() => {
  request.mockReset();
  forgetStepUp();
  forgetPendingSignIn();
});

describe("sign-in methods over the bearer client", () => {
  it("reads the methods through core's schema, a drifted answer included", async () => {
    request.mockResolvedValueOnce(methods);
    expect(await signInMethodsApi.getSignInMethods()).toMatchObject({ password: { set: true }, proofs: ["password", "email_code"] });
    expect(request.mock.calls[0]?.[0]).toBe("/api/v1/me/sign-in-methods");
    request.mockResolvedValueOnce({ password: "yes" });
    expect(await signInMethodsApi.getSignInMethods()).toBeNull();
  });

  it("serialises a command's body for the bearer client", async () => {
    request.mockResolvedValueOnce({ user: null, sign_in_methods: methods });
    await signInMethodsApi.unlink("google", "su_1");
    expect(request.mock.calls[0]?.[0]).toBe("/api/v1/me/sign-in-methods/google/unlink");
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(body()).toEqual({ step_up_token: "su_1" });
  });
});

describe("stepUp", () => {
  it("holds the token a proof bought for the account in", async () => {
    request.mockResolvedValueOnce({ step_up_token: "su_1", expires_at: new Date(NOW + STEP_UP_WINDOW_MS).toISOString(), method: "password" });
    expect(await stepUp({ kind: "password", password: "pw" }, "unlink_google", "u1")).toBe(true);
    expect(request.mock.calls[0]?.[0]).toBe("/api/v1/me/step-up");
    expect(body()).toEqual({ password: "pw" });
    expect(stepUpToken("unlink_google", "u1")).toBe("su_1");
  });

  it("holds nothing when the answer carries no usable token", async () => {
    request.mockResolvedValueOnce({ expires_at: "x" });
    expect(await stepUp({ kind: "email_code", code: "123456" }, "link_google", "u1")).toBe(false);
    expect(body()).toEqual({ code: "123456", action: "link_google" });
    expect(stepUpToken("link_google", "u1")).toBeNull();
  });
});

describe("linkPendingTicket", () => {
  it("links the held identity with the app's client, the held link token, and spends the ticket", async () => {
    holdStep({ kind: "choice", ticket: "t_1", nonce: "n_1", identity, ticketKind: "link_required" }, NOW);
    holdStepUp({ step_up_token: "su_1", expires_at: "", method: "password" }, { userId: "u1", action: "link_google" });
    request.mockResolvedValueOnce({ user: null, sign_in_methods: methods });
    expect(await linkPendingTicket({ userId: "u1", move: true })).toMatchObject({ user: null, methods: { google: { linked: true } } });
    expect(request.mock.calls[0]?.[0]).toBe("/api/v1/auth/native/sign-in-ticket/link");
    expect(body()).toEqual({
      client_id: "uniwork-chat-mobile",
      deployment_id: "default",
      platform: "ios",
      ticket: "t_1",
      nonce: "n_1",
      move: true,
      step_up_token: "su_1",
    });
    expect(usePendingSignIn.getState().choice).toBeNull();
  });

  it("sends no token it does not hold, and keeps the ticket when the server refuses", async () => {
    holdStep({ kind: "choice", ticket: "t_1", nonce: "n_1", identity, ticketKind: "unmatched" }, NOW);
    request.mockRejectedValueOnce(Object.assign(new Error("403"), { status: 403, body: { error: { code: "proof_required" } } }));
    await expect(linkPendingTicket({ userId: "u1" })).rejects.toMatchObject({ status: 403 });
    expect(body()).not.toHaveProperty("step_up_token");
    expect(usePendingSignIn.getState().choice).not.toBeNull();
  });

  it("says the sign-in expired, without asking the server, once the ticket is gone", async () => {
    await expect(linkPendingTicket({ userId: "u1" })).rejects.toMatchObject({ code: "sign_in_expired" });
    expect(request).not.toHaveBeenCalled();
  });
});
