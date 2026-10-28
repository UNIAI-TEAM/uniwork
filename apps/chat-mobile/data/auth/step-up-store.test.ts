import type { StepUpGrant, StepUpProof } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { STEP_UP_WINDOW_MS } from "@uniwork/core/auth/step-up";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetStepUp, holdStepUp, proofsFor, stepUpToken } from "./step-up-store";

const NOW = Date.parse("2026-10-28T09:00:00Z");
const grant = (method: StepUpProof): StepUpGrant => ({ step_up_token: `su_${method}`, expires_at: new Date(NOW + STEP_UP_WINDOW_MS).toISOString(), method });

beforeEach(() => forgetStepUp());

describe("the step-up token on the phone", () => {
  it("serves every command of the account that bought it with a password, until its deadline", () => {
    holdStepUp(grant("password"), { userId: "u1", action: "unlink_google", now: NOW });
    expect(stepUpToken("unlink_google", "u1", NOW)).toBe("su_password");
    expect(stepUpToken("delete_account", "u1", NOW)).toBe("su_password");
    expect(stepUpToken("delete_account", "u1", NOW + STEP_UP_WINDOW_MS)).toBeNull();
  });

  it("never serves another account, nor nobody", () => {
    holdStepUp(grant("password"), { userId: "u1", action: "set_password", now: NOW });
    expect(stepUpToken("set_password", "u2", NOW)).toBeNull();
    expect(stepUpToken("set_password", null, NOW)).toBeNull();
  });

  it("serves a mailed code's token for its own action only", () => {
    holdStepUp(grant("email_code"), { userId: "u1", action: "link_apple", now: NOW });
    expect(stepUpToken("link_apple", "u1", NOW)).toBe("su_email_code");
    expect(stepUpToken("unlink_apple", "u1", NOW)).toBeNull();
  });

  it("reads the clock itself when no time is given, and is gone once forgotten", () => {
    holdStepUp(grant("totp"), { userId: "u1", action: "enable_mfa" });
    expect(stepUpToken("enable_mfa", "u1")).toBe("su_totp");
    forgetStepUp();
    expect(stepUpToken("enable_mfa", "u1")).toBeNull();
  });

  it("opens the proof sheet on what the server takes and this phone can present", () => {
    expect(proofsFor({ proofs: ["password", "apple", "email_code"], mfaEnabled: false, hasPassword: true, offer: { apple: "browser", google: null } })).toEqual({
      first: "password",
      others: ["email_code"],
    });
    expect(proofsFor({ proofs: ["apple", "email_code"], mfaEnabled: false, hasPassword: false, offer: { apple: "native", google: null } })).toEqual({
      first: "apple",
      others: ["email_code"],
    });
    expect(proofsFor({ proofs: [], mfaEnabled: true, hasPassword: true, offer: undefined })).toEqual({ first: "totp", others: [] });
  });
});
