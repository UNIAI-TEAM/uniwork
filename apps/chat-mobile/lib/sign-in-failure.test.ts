import { describe, expect, it } from "vitest";
import { signInFailureOf, startOf, unmatchedWhileLinking, verifyEmailFailureOf } from "./sign-in-failure";

/** The app's auth TransportError, as data/auth/transport.ts builds it (duck-typed: lib never imports data/). */
function transport(code: string, status?: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`uniwork request failed: ${code}`), { name: "TransportError", code, status, fromServer: status !== undefined, ...extra });
}

/** The app's bearer ApiError, which keeps the server's envelope as `body` (data/api.ts). */
function api(code: string, status: number) {
  return Object.assign(new Error("refused"), { name: "ApiError", status, body: { error: { code } } });
}

describe("signInFailureOf", () => {
  it("restarts a sign-in whose held step is gone, whatever screen it was on, through core's table", () => {
    for (const context of ["sign_in", "second_factor", "ticket", "claim"] as const) {
      expect(signInFailureOf(transport("sign_in_expired"), context)).toMatchObject({
        kind: "restart",
        key: "auth.continue.errors.expired",
        code: "sign_in_expired",
      });
    }
  });

  it("says the provider whose own sheet failed, never the server's words", () => {
    const sheet = Object.assign(new Error("sheet"), { code: "ERR_GOOGLE_SIGN_IN" });
    expect(signInFailureOf(sheet, "sign_in", "google")).toMatchObject({ key: "auth.social.errors.google_failed", kind: "form" });
    expect(signInFailureOf(new Error("apple"), "register", "apple")).toMatchObject({ key: "auth.social.errors.apple_failed" });
  });

  it("says a sheet that failed in Settings as the link that did not happen, naming its provider", () => {
    expect(signInFailureOf(new Error("no account"), "methods", "google")).toMatchObject({
      key: "settings.security.signInMethods.results.failed",
      code: "provider_sheet",
      provider: "google",
    });
  });

  it("says the browser did not open when opening it failed", () => {
    expect(signInFailureOf(new Error("no browser"), "sign_in", "browser")).toMatchObject({ key: "auth.desktop.unichat_login_failed" });
  });

  it("reads every answer of the server through core's table, a door's and the bearer client's alike", () => {
    expect(signInFailureOf(transport("invalid_credentials", 401), "sign_in")).toMatchObject({
      kind: "field",
      key: "auth.social.errors.invalid_credentials",
    });
    expect(signInFailureOf(transport("invalid_credentials", 401), "second_factor", "form")).toMatchObject({
      key: "auth.social.errors.second_factor_invalid",
    });
    expect(signInFailureOf(transport("second_factor_locked", 429, { retryAfterMs: 840_000 }), "second_factor")).toMatchObject({
      kind: "wait",
      retryAfterSeconds: 840,
    });
    // A refusal of the server after a provider's sheet answered is the server's, not the sheet's.
    expect(signInFailureOf(transport("sign_in_account_conflict", 409), "sign_in", "apple")).toMatchObject({
      key: "auth.social.errors.sign_in_conflict",
    });
    expect(signInFailureOf(api("sign_in_method_taken", 409), "ticket")).toMatchObject({ key: "settings.security.signInMethods.errors.takenUnknown" });
  });

  it("calls a fetch that never answered a network failure, even from a sheet's screen", () => {
    expect(signInFailureOf(new TypeError("Network request failed"), "sign_in", "google")).toMatchObject({ code: "network" });
  });

  it("reads a form's failure that named nothing as the screen's generic sentence", () => {
    expect(signInFailureOf(new Error("odd"), "register")).toMatchObject({ code: "unknown", key: "auth.social.errors.generic" });
  });
});

describe("unmatchedWhileLinking", () => {
  it("says the provider just tried has no account either, in the app's own words, naming it", () => {
    expect(unmatchedWhileLinking("apple")).toMatchObject({
      key: "mobile.sign_in.link_unmatched",
      provider: "apple",
      kind: "form",
      code: "identity_unmatched",
    });
    expect(unmatchedWhileLinking("google")).toMatchObject({ key: "mobile.sign_in.link_unmatched", provider: "google" });
  });
});

describe("startOf", () => {
  it("names the sheet or the browser a request opens, and a form for the rest", () => {
    expect(startOf({ method: "apple", intent: "sign_up" })).toBe("apple");
    expect(startOf({ method: "google" })).toBe("google");
    expect(startOf({ method: "browser", provider: "apple" })).toBe("browser");
    expect(startOf({ method: "password", email: "a@b.c", password: "x" })).toBe("form");
    expect(startOf({ method: "second_factor", code: "123456" })).toBe("form");
  });
});

describe("verifyEmailFailureOf", () => {
  it("says a wrong code and a code asked again too soon in the verify screen's words", () => {
    expect(verifyEmailFailureOf(api("invalid_code", 400))).toMatchObject({ kind: "field", key: "auth.verify.invalidCode" });
    expect(verifyEmailFailureOf(api("rate_limited", 429))).toMatchObject({ kind: "form", key: "auth.verify.resendTooSoon", retry: null });
  });

  it("reads anything else as any step that failed", () => {
    expect(verifyEmailFailureOf(api("internal", 500))).toMatchObject({ key: "auth.social.errors.server" });
    expect(verifyEmailFailureOf(null)).toMatchObject({ key: "auth.continue.errors.generic" });
  });
});
