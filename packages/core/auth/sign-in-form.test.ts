import { describe, expect, it } from "vitest";
import { CODE_LENGTH, DISPLAY_NAME_MAX, codeDigits, displayNameError, emailError, passwordError } from "./sign-in-form";

describe("emailError", () => {
  it("asks for an address, then for one that looks like an address", () => {
    expect(emailError("  ")).toEqual({ key: "auth.emailRequired" });
    expect(emailError("an@example")).toEqual({ key: "auth.emailInvalid" });
    expect(emailError("an @example.com")).toEqual({ key: "auth.emailInvalid" });
    expect(emailError(" an@example.com ")).toBeNull();
  });
});

describe("passwordError", () => {
  it("only requires a password to sign in with, and a long enough one to create", () => {
    expect(passwordError("")).toEqual({ key: "auth.passwordRequired" });
    expect(passwordError("short")).toBeNull();
    expect(passwordError("", true)).toEqual({ key: "auth.passwordRequired" });
    expect(passwordError("1234567", true)).toEqual({ key: "settings.security.signInMethods.password.tooShort" });
    expect(passwordError("12345678", true)).toBeNull();
  });
});

describe("displayNameError", () => {
  it("asks for a name, counts characters rather than bytes, and stops at the server's ceiling", () => {
    expect(displayNameError("   ")).toEqual({ key: "auth.continue.create.displayNameRequired" });
    expect(displayNameError("Đặng Thị Ánh".repeat(1))).toBeNull();
    expect(displayNameError("ệ".repeat(DISPLAY_NAME_MAX))).toBeNull();
    expect(displayNameError("ệ".repeat(DISPLAY_NAME_MAX + 1))).toEqual({
      key: "auth.continue.create.displayNameTooLong",
      values: { max: DISPLAY_NAME_MAX },
    });
  });
});

describe("codeDigits", () => {
  it("keeps the digits of what was typed or pasted, at most six", () => {
    expect(codeDigits("12 34-56")).toBe("123456");
    expect(codeDigits("1234567")).toHaveLength(CODE_LENGTH);
    expect(codeDigits("abc")).toBe("");
  });
});
