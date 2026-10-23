import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { deleteAccountProofRefused } from "./errors";

describe("deleteAccountProofRefused", () => {
  it("reads each refused proof by its own code", () => {
    expect(deleteAccountProofRefused(new ApiError("x", "password_incorrect", 403))).toBe(true);
    expect(deleteAccountProofRefused(new ApiError("x", "mfa_code_incorrect", 403))).toBe(true);
    expect(deleteAccountProofRefused(new ApiError("x", "email_confirmation_mismatch", 400))).toBe(true);
  });

  it("still reads the 401 an older server answered", () => {
    expect(deleteAccountProofRefused(new ApiError("x", "invalid_credentials", 401))).toBe(true);
  });

  it("is false for any other failure", () => {
    expect(deleteAccountProofRefused(new ApiError("x", "owner_must_transfer", 409))).toBe(false);
    expect(deleteAccountProofRefused(new ApiError("x", "invalid_code", 400))).toBe(false);
    expect(deleteAccountProofRefused(new Error("x"))).toBe(false);
    expect(deleteAccountProofRefused(undefined)).toBe(false);
  });
});
