import { describe, expect, it } from "vitest";
import { DELETE_ACCOUNT_HANDLED_CODES, deleteAccountFailure, deleteFailureKey } from "./account-deletion";

const refusal = (code: string, status = 403) => ({ status, body: { error: { code, message: "x" } } });

describe("deleteAccountFailure", () => {
  it("names an owner who must hand over the organization first", () => {
    expect(deleteAccountFailure(refusal("owner_must_transfer", 409))).toBe("owner_must_transfer");
  });

  it("declares what the sheets answer themselves: the owner's step, and a proof asked again", () => {
    expect([...DELETE_ACCOUNT_HANDLED_CODES]).toEqual(["owner_must_transfer", "proof_required"]);
  });

  it("tells the rate limit and no connection apart from any other failure", () => {
    expect(deleteAccountFailure({ status: 429, body: { error: { code: "rate_limited" } } })).toBe("rate_limited");
    expect(deleteAccountFailure({ status: 0 })).toBe("offline");
    expect(deleteAccountFailure({ status: 500, body: "oops" })).toBe("failed");
    expect(deleteAccountFailure(new Error("boom"))).toBe("failed");
    expect(deleteAccountFailure(null)).toBe("failed");
  });
});

describe("deleteFailureKey", () => {
  it("words the rate limit, no connection and a proof refused again, and anything else as a failure to try later", () => {
    expect(deleteFailureKey("rate_limited")).toBe("mobile.account.rate_limited");
    expect(deleteFailureKey("offline")).toBe("mobile.account.offline");
    expect(deleteFailureKey("proof_required")).toBe("settings.security.stepUp.errors.proofRequired");
    expect(deleteFailureKey("failed")).toBe("settings.security.delete.failed");
    expect(deleteFailureKey("member_gone")).toBe("settings.security.delete.failed");
  });
});
