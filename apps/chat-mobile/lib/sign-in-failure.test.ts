import { describe, expect, it } from "vitest";
import { signInFailureKey } from "./sign-in-failure";

describe("signInFailureKey", () => {
  it("says the browser could not open, whatever the error", () => {
    expect(signInFailureKey("browser", new Error("x"))).toBe("auth.desktop.unichat_login_failed");
    expect(signInFailureKey("browser", { code: "mfa_required" })).toBe("auth.desktop.unichat_login_failed");
  });

  it("points an Apple sign-in the server refused to the browser when that is the way forward", () => {
    expect(signInFailureKey("apple", { code: "apple_account_conflict" })).toBe("chat.mobile.login_apple_conflict");
    expect(signInFailureKey("apple", { code: "mfa_required" })).toBe("chat.mobile.login_apple_mfa");
  });

  it("says try again for anything else, a drifted error included", () => {
    for (const error of [{ code: "apple_token_invalid" }, { code: "network" }, new Error("sheet failed"), "text", null]) {
      expect(signInFailureKey("apple", error)).toBe("chat.mobile.login_apple_failed");
    }
  });
});
