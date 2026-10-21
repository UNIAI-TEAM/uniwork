import { describe, expect, it } from "vitest";
import { deleteAccountFailure, deleteProofBody, deleteProofMode } from "./account-deletion";

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
});

describe("deleteAccountFailure (core deleteAccountProofRefused parity)", () => {
  it.each(["password_incorrect", "mfa_code_incorrect", "email_confirmation_mismatch", "invalid_credentials"])("%s is a refused proof", (code) => {
    expect(deleteAccountFailure(refusal(code))).toBe("proof_refused");
  });

  it("names an owner who must hand over the organization first", () => {
    expect(deleteAccountFailure(refusal("owner_must_transfer", 409))).toBe("owner_must_transfer");
  });

  it("tells the rate limit and no connection apart from any other failure", () => {
    expect(deleteAccountFailure({ status: 429, body: { error: { code: "rate_limited" } } })).toBe("rate_limited");
    expect(deleteAccountFailure({ status: 0 })).toBe("offline");
    expect(deleteAccountFailure({ status: 500, body: "oops" })).toBe("failed");
    expect(deleteAccountFailure(new Error("boom"))).toBe("failed");
    expect(deleteAccountFailure(null)).toBe("failed");
  });
});
