import { describe, expect, it } from "vitest";
import type { StepUpGrant } from "../api/endpoints/sign-in-schemas";
import {
  APP_PROOFS,
  STEP_UP_WINDOW_MS,
  WEB_PROOFS,
  holdStepUp,
  linkAction,
  proofChoice,
  stepUpServes,
  stepUpTokenFor,
  unlinkAction,
} from "./step-up";

const NOW = Date.parse("2026-10-27T08:00:00Z");
const grant = (over: Partial<StepUpGrant> = {}): StepUpGrant => ({
  step_up_token: "su",
  expires_at: "2026-10-27T08:10:00Z",
  method: "password",
  ...over,
});
const ctx = { userId: "u1", action: "unlink_google" as const, now: NOW };

describe("holdStepUp", () => {
  it("holds a password-bought token for every command, ending a margin before the server does", () => {
    const held = holdStepUp(grant(), ctx);
    expect(held).toEqual({ token: "su", method: "password", action: null, userId: "u1", expiresAtMs: NOW + STEP_UP_WINDOW_MS - 30_000 });
  });

  it("holds a code-bought token for the one action its mail named", () => {
    expect(holdStepUp(grant({ method: "email_code" }), ctx).action).toBe("unlink_google");
  });

  it("reads a proof it does not know as narrowly as a code", () => {
    const held = holdStepUp(grant({ method: "passkey" as StepUpGrant["method"] }), ctx);
    expect(held.method).toBeNull();
    expect(held.action).toBe("unlink_google");
  });

  it("counts the server's expiry from now only when it reads as a plausible remaining life", () => {
    expect(holdStepUp(grant({ expires_at: "2026-10-27T08:04:00Z" }), ctx).expiresAtMs).toBe(NOW + 4 * 60_000 - 30_000);
    // A clock ahead of the server: the token already "expired" — keep the full window instead.
    expect(holdStepUp(grant({ expires_at: "2026-10-27T07:50:00Z" }), ctx).expiresAtMs).toBe(NOW + STEP_UP_WINDOW_MS - 30_000);
    // A clock behind: never past ten minutes.
    expect(holdStepUp(grant({ expires_at: "2026-10-27T08:30:00Z" }), ctx).expiresAtMs).toBe(NOW + STEP_UP_WINDOW_MS - 30_000);
    expect(holdStepUp(grant({ expires_at: "" }), ctx).expiresAtMs).toBe(NOW + STEP_UP_WINDOW_MS - 30_000);
  });
});

describe("stepUpServes / stepUpTokenFor", () => {
  const any = holdStepUp(grant(), ctx);
  const code = holdStepUp(grant({ method: "email_code" }), { ...ctx, action: "set_password" });

  it("serves every command with a password, a second factor or a provider token", () => {
    for (const action of ["delete_account", "link_apple", "enable_mfa"] as const) {
      expect(stepUpTokenFor(any, { action, userId: "u1", now: NOW })).toBe("su");
    }
  });

  it("serves a code-bought token only to its action's commands (both password actions ride PUT /me/password)", () => {
    expect(stepUpServes(code, { action: "set_password", userId: "u1", now: NOW })).toBe(true);
    expect(stepUpServes(code, { action: "change_password", userId: "u1", now: NOW })).toBe(true);
    expect(stepUpServes(code, { action: "delete_account", userId: "u1", now: NOW })).toBe(false);
    expect(stepUpTokenFor(code, { action: "transfer_ownership", userId: "u1", now: NOW })).toBeNull();
  });

  it("never serves another account, no account, after its end, or when there is none", () => {
    expect(stepUpServes(any, { action: "delete_account", userId: "u2", now: NOW })).toBe(false);
    expect(stepUpServes(any, { action: "delete_account", userId: null, now: NOW })).toBe(false);
    expect(stepUpServes(any, { action: "delete_account", userId: "u1", now: any.expiresAtMs })).toBe(false);
    expect(stepUpServes(null, { action: "delete_account", userId: "u1", now: NOW })).toBe(false);
    expect(stepUpTokenFor(null, { action: "delete_account", userId: "u1", now: NOW })).toBeNull();
  });
});

describe("link and unlink actions", () => {
  it("names the action of each provider", () => {
    expect(linkAction("google")).toBe("link_google");
    expect(linkAction("apple")).toBe("link_apple");
    expect(unlinkAction("google")).toBe("unlink_google");
    expect(unlinkAction("apple")).toBe("unlink_apple");
  });
});

describe("proofChoice", () => {
  const base = { mfaEnabled: false, hasPassword: true, supported: WEB_PROOFS };

  it("asks only for the second factor when it is on, whatever else is listed", () => {
    expect(proofChoice({ ...base, proofs: ["totp"] })).toEqual({ first: "totp", others: [] });
    expect(proofChoice({ ...base, proofs: ["password", "email_code"], mfaEnabled: true })).toEqual({ first: "totp", others: [] });
    expect(proofChoice({ ...base, proofs: ["totp"], supported: ["password"] })).toEqual({ first: null, others: [] });
  });

  it("offers the password first, then a mailed code", () => {
    expect(proofChoice({ ...base, proofs: ["email_code", "password"] })).toEqual({ first: "password", others: ["email_code"] });
  });

  it("puts a provider sheet before the mailed code on the app, and leaves it out on the web", () => {
    const proofs = ["email_code", "apple", "google"];
    expect(proofChoice({ ...base, hasPassword: false, proofs, supported: APP_PROOFS })).toEqual({
      first: "apple",
      others: ["google", "email_code"],
    });
    expect(proofChoice({ ...base, hasPassword: false, proofs })).toEqual({ first: "email_code", others: [] });
  });

  it("offers nothing this client cannot present", () => {
    expect(proofChoice({ ...base, proofs: ["apple"], hasPassword: false })).toEqual({ first: null, others: [] });
  });

  it("falls back on the account's own state when the list is empty or unreadable", () => {
    expect(proofChoice({ ...base, proofs: [] })).toEqual({ first: "password", others: ["email_code"] });
    expect(proofChoice({ ...base, proofs: ["sms"], hasPassword: false })).toEqual({ first: "email_code", others: [] });
    expect(proofChoice({ ...base, proofs: [], mfaEnabled: true })).toEqual({ first: "totp", others: [] });
  });
});
