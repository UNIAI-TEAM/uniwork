import { describe, expect, it } from "vitest";
import { signInFailureKey, unfinishedStepKey } from "./sign-in-failure";

describe("signInFailureKey", () => {
  it("says the browser could not open, whatever the error", () => {
    expect(signInFailureKey("browser", new Error("x"))).toBe("auth.desktop.unichat_login_failed");
    expect(signInFailureKey("browser", { code: "sign_in_account_conflict" })).toBe("auth.desktop.unichat_login_failed");
  });

  it("points an Apple sign-in whose address has another account to the browser", () => {
    expect(signInFailureKey("apple", { code: "sign_in_account_conflict" })).toBe("chat.mobile.login_apple_conflict");
  });

  it("says try again for anything else, a drifted error included", () => {
    for (const error of [{ code: "provider_token_invalid" }, { code: "network" }, new Error("sheet failed"), "text", null]) {
      expect(signInFailureKey("apple", error)).toBe("chat.mobile.login_apple_failed");
    }
  });
});

describe("unfinishedStepKey", () => {
  it("sends a second factor and a choice to the browser, and says nothing otherwise", () => {
    expect(unfinishedStepKey({ kind: "second_factor" })).toBe("chat.mobile.login_apple_mfa");
    expect(unfinishedStepKey({ kind: "choice" })).toBe("chat.mobile.login_apple_conflict");
    expect(unfinishedStepKey({ kind: "signed_in" })).toBeNull();
    expect(unfinishedStepKey({ kind: "dismissed" })).toBeNull();
  });
});
