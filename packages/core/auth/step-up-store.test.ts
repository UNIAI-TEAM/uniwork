import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import type { User } from "../types/user";
import {
  forgetStepUp,
  forgetStepUpIfRefused,
  hasStepUp,
  rememberStepUp,
  stepUpToken,
  withTransferProof,
} from "./step-up-store";
import { resetAuthStoreForTests, useAuthStore } from "./store";

const NOW = Date.parse("2026-10-27T08:00:00Z");
const user = (id: string): User => ({
  id,
  email: `${id}@acme.vn`,
  display_name: id,
  onboarded_at: null,
  email_verified_at: "2026-10-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
});
const grant = { step_up_token: "su", expires_at: "2026-10-27T08:10:00Z", method: "password" as const };

describe("the web's step-up token", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    useAuthStore.getState().setUser(user("u1"));
  });
  afterEach(() => {
    forgetStepUp();
    resetAuthStoreForTests();
  });

  it("keeps a token for the signed-in account and hands it to the commands it serves", () => {
    expect(stepUpToken("unlink_google", NOW)).toBeNull();
    rememberStepUp(grant, "unlink_google", NOW);
    expect(stepUpToken("unlink_google", NOW)).toBe("su");
    expect(hasStepUp("delete_account", NOW)).toBe(true);
    expect(hasStepUp("delete_account", NOW + 10 * 60_000)).toBe(false);
  });

  it("keeps a code-bought token for its action only", () => {
    rememberStepUp({ ...grant, method: "email_code" }, "delete_account", NOW);
    expect(hasStepUp("delete_account", NOW)).toBe(true);
    expect(hasStepUp("transfer_ownership", NOW)).toBe(false);
  });

  it("keeps nothing when no one is signed in", () => {
    resetAuthStoreForTests();
    rememberStepUp(grant, "set_password", NOW);
    expect(stepUpToken("set_password", NOW)).toBeNull();
  });

  it("drops the token when the account changes or the session ends", () => {
    rememberStepUp(grant, "set_password", NOW);
    useAuthStore.getState().setUser({ ...user("u1"), display_name: "renamed" });
    expect(stepUpToken("set_password", NOW)).toBe("su");
    useAuthStore.getState().setUser(user("u2"));
    expect(stepUpToken("set_password", NOW)).toBeNull();

    rememberStepUp(grant, "set_password", NOW);
    useAuthStore.setState({ user: null, status: "anon" });
    useAuthStore.getState().setUser(user("u2"));
    expect(stepUpToken("set_password", NOW)).toBeNull();
  });

  it("drops the token once the server refused it with proof_required, not for other refusals", () => {
    rememberStepUp(grant, "set_password", NOW);
    forgetStepUpIfRefused(new ApiError("", "password_incorrect", 403));
    expect(stepUpToken("set_password", NOW)).toBe("su");
    forgetStepUpIfRefused(new ApiError("", "proof_required", 403));
    expect(stepUpToken("set_password", NOW)).toBeNull();
    forgetStepUp();
  });

  it("proves the invitation switch's transfers with the held token, leaving the other steps and given tokens alone", () => {
    const leave = { organization_id: "o1", action: "leave" as const };
    const transfer = { organization_id: "o2", action: "transfer" as const, transfer_to_user_id: "u9" };
    expect(withTransferProof(undefined)).toBeUndefined();
    expect(withTransferProof([leave, transfer])).toEqual([leave, transfer]);
    rememberStepUp(grant, "transfer_ownership");
    expect(withTransferProof([leave, transfer])).toEqual([leave, { ...transfer, step_up_token: "su" }]);
    expect(withTransferProof([{ ...transfer, step_up_token: "own" }])).toEqual([{ ...transfer, step_up_token: "own" }]);
    expect(withTransferProof([leave])).toEqual([leave]);
  });
});
