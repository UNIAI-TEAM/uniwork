import { readNativeSignIn } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { describe, expect, it } from "vitest";
import { stepOf, type SecondFactorContext } from "./sign-in-step";

const context: SecondFactorContext = { method: "apple", email: null, provider: "apple" };
const ctx = { deploymentId: "default", context, nonce: "raw_nonce" };

const sessionBody = (overrides: Record<string, unknown> = {}) => ({
  account_id: "acc_1",
  device_session_id: "dev_1",
  session_id: "sess_1",
  deployment_id: "default",
  access_token: "at_1",
  token_type: "Bearer",
  expires_in: 900,
  refresh_token: "rt_1",
  refresh_expires_in: 2592000,
  ...overrides,
});

// What core reads off the wire, then the app: the two halves of every door's answer.
const answer = (raw: unknown) => readNativeSignIn(raw, "POST /api/v1/auth/native/apple");
const identity = { provider: "apple", email: "an@privaterelay.appleid.com", name: "", private_relay: true };

describe("a door's answer as a step", () => {
  it("reads a session through the app's strict parser, with its notices", () => {
    const step = stepOf(answer({ status: "signed_in", session: sessionBody(), reclaimed: true, link_skipped: "link_required" }), ctx);
    expect(step).toEqual({
      kind: "session",
      session: expect.objectContaining({ accessToken: "at_1", refreshToken: "rt_1", deploymentId: "default" }),
      reclaimed: true,
      linkSkipped: "link_required",
    });
  });

  it("fails closed on a session of another deployment or a token missing", () => {
    expect(() => stepOf(answer({ status: "signed_in", session: sessionBody({ deployment_id: "eu" }) }), ctx)).toThrow(
      expect.objectContaining({ code: "wrong_deployment" }),
    );
    expect(() => stepOf(answer({ status: "signed_in", session: sessionBody({ refresh_token: "" }) }), ctx)).toThrow(
      expect.objectContaining({ code: "malformed_response" }),
    );
  });

  it("keeps the second factor's challenge with what the first step knew", () => {
    expect(stepOf(answer({ status: "mfa_required", mfa_token: "mfa_1" }), ctx)).toEqual({ kind: "mfa", token: "mfa_1", context });
  });

  it.each([
    ["identity_unmatched", "unmatched"],
    ["link_required", "link_required"],
  ] as const)("keeps a %s ticket with the raw nonce that opens it", (status, ticketKind) => {
    expect(stepOf(answer({ status, ticket: "t_1", identity }), ctx)).toEqual({
      kind: "choice",
      ticket: "t_1",
      nonce: "raw_nonce",
      identity,
      ticketKind,
    });
  });

  it("fails closed on a ticket from a door that holds no nonce, and on an answer core could not read", () => {
    expect(() => stepOf(answer({ status: "identity_unmatched", ticket: "t_1", identity }), { deploymentId: "default", context })).toThrow(
      expect.objectContaining({ code: "malformed_response" }),
    );
    expect(() => stepOf(answer({ status: "welcome" }), ctx)).toThrow(expect.objectContaining({ code: "malformed_response" }));
    expect(() => stepOf(null, ctx)).toThrow(expect.objectContaining({ code: "malformed_response" }));
  });
});
