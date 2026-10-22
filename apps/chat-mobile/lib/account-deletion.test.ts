import { describe, expect, it } from "vitest";
import { DELETE_ACCOUNT_HANDLED_CODES, closeConfirmed, deleteAccountFailure, deleteProofBody, deleteProofMode, ownedOrganization } from "./account-deletion";

const refusal = (code: string, status = 403) => ({ status, body: { error: { code, message: "x" } } });

describe("deleteProofMode (delete-account-dialog.tsx parity)", () => {
  it("asks for the password, else the two-factor code, else the typed email", () => {
    expect(deleteProofMode({ has_password: true, mfa_enabled_at: "2026-10-01T00:00:00Z" })).toBe("password");
    expect(deleteProofMode({ has_password: false, mfa_enabled_at: "2026-10-01T00:00:00Z" })).toBe("code");
    expect(deleteProofMode({ has_password: false, mfa_enabled_at: null })).toBe("email");
    expect(deleteProofMode(null)).toBe("email");
    expect(deleteProofMode(undefined)).toBe("email");
  });
});

describe("deleteProofBody", () => {
  it("sends the password as typed and trims a code or an address", () => {
    expect(deleteProofBody("password", " pass word ")).toEqual({ password: " pass word " });
    expect(deleteProofBody("code", " 123456 ")).toEqual({ code: "123456" });
    expect(deleteProofBody("email", " an@acme.vn ")).toEqual({ email_confirmation: "an@acme.vn" });
  });

  it("adds the organization to close, trimmed, and nothing for a blank one", () => {
    expect(deleteProofBody("password", "pw", " mot-minh ")).toEqual({ password: "pw", close_organization: "mot-minh" });
    expect(deleteProofBody("code", "123456", "mot-minh")).toEqual({ code: "123456", close_organization: "mot-minh" });
    expect(deleteProofBody("email", "an@acme.vn", "  ")).toEqual({ email_confirmation: "an@acme.vn" });
  });
});

describe("deleteAccountFailure (core deleteAccountProofRefused parity)", () => {
  it.each(["password_incorrect", "mfa_code_incorrect", "email_confirmation_mismatch", "invalid_credentials"])("%s is a refused proof", (code) => {
    expect(deleteAccountFailure(refusal(code))).toBe("proof_refused");
  });

  it("declares every code it explains as handled, and only those", () => {
    for (const code of DELETE_ACCOUNT_HANDLED_CODES) expect(deleteAccountFailure(refusal(code)), code).not.toBe("failed");
  });

  it("names an owner who must hand over the organization first", () => {
    expect(deleteAccountFailure(refusal("owner_must_transfer", 409))).toBe("owner_must_transfer");
  });

  it("tells a mistyped organization and one that gained a member apart", () => {
    expect(deleteAccountFailure(refusal("close_confirm_mismatch", 400))).toBe("close_mismatch");
    expect(deleteAccountFailure(refusal("organization_has_members", 409))).toBe("organization_has_members");
  });

  it("tells the rate limit and no connection apart from any other failure", () => {
    expect(deleteAccountFailure({ status: 429, body: { error: { code: "rate_limited" } } })).toBe("rate_limited");
    expect(deleteAccountFailure({ status: 0 })).toBe("offline");
    expect(deleteAccountFailure({ status: 500, body: "oops" })).toBe("failed");
    expect(deleteAccountFailure(new Error("boom"))).toBe("failed");
    expect(deleteAccountFailure(null)).toBe("failed");
  });
});

describe("ownedOrganization (owner_must_transfer's fields)", () => {
  const owner = (fields: unknown) => ({ status: 409, body: { error: { code: "owner_must_transfer", fields } } });

  it("reads the organization and whether the owner may close it", () => {
    expect(ownedOrganization(owner({ organization_name: "Một mình", organization_slug: "mot-minh", can_close: true }))).toEqual({
      name: "Một mình",
      slug: "mot-minh",
      canClose: true,
    });
    expect(ownedOrganization(owner({ organization_name: "Acme", organization_slug: "acme", can_close: false }))?.canClose).toBe(false);
    // A drifted can_close is no close; a missing name reads as the slug.
    expect(ownedOrganization(owner({ organization_slug: "acme", can_close: "yes" }))).toEqual({ name: "acme", slug: "acme", canClose: false });
  });

  it("is null for an older server's bare refusal, a drifted slug, or another failure", () => {
    expect(ownedOrganization(refusal("owner_must_transfer", 409))).toBeNull();
    expect(ownedOrganization(owner({ organization_slug: 7 }))).toBeNull();
    expect(ownedOrganization(owner({ organization_slug: "" }))).toBeNull();
    expect(ownedOrganization(refusal("password_incorrect"))).toBeNull();
  });
});

describe("closeConfirmed", () => {
  it("accepts the slug typed in any case with stray spaces, and nothing else", () => {
    const organization = { name: "Một mình", slug: "mot-minh", canClose: true };
    expect(closeConfirmed(" Mot-Minh ", organization)).toBe(true);
    expect(closeConfirmed("Một mình", organization)).toBe(false);
    expect(closeConfirmed("", organization)).toBe(false);
  });
});
