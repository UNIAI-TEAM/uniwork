import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import en from "../i18n/locales/en.json";
import vi from "../i18n/locales/vi.json";
import {
  LINK_RESULTS,
  LOGIN_REDIRECT_ERRORS,
  linkSkippedKey,
  loginRedirectErrorKey,
  readLinkResult,
  readSignInFailure,
  retryPhrase,
  secondsUntil,
  type SignInContext,
} from "./sign-in-errors";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The string at a dotted key, plural forms included (i18next picks _one/_other for a count). */
function has(dict: unknown, key: string, plural = false): boolean {
  const parts = key.split(".");
  const last = parts.pop() ?? "";
  let node: unknown = dict;
  for (const part of parts) node = isObject(node) ? node[part] : undefined;
  if (!isObject(node)) return false;
  return plural ? typeof node[`${last}_one`] === "string" && typeof node[`${last}_other`] === "string" : typeof node[last] === "string";
}

const api = (code: string, status: number, fields?: Record<string, unknown>, retryAfterSeconds?: number) =>
  new ApiError(code, code, status, undefined, fields, undefined, retryAfterSeconds);

const CONTEXTS: SignInContext[] = ["sign_in", "second_factor", "register", "ticket", "claim", "step_up", "password", "methods"];
const CODES = [
  "network", "timeout", "internal", "server_error", "invalid_credentials", "second_factor_locked", "rate_limited",
  "provider_token_invalid", "apple_token_invalid", "google_not_configured", "apple_auth_unavailable", "apple_not_configured",
  "native_sign_in_unavailable", "sign_in_email_unverified", "sign_in_account_unverified", "sign_in_account_conflict",
  "apple_account_conflict", "conflict", "invalid_token", "unauthorized", "sign_in_ticket_missing", "sign_in_ticket_channel",
  "invalid_code", "sign_in_method_taken", "sign_in_method_movable", "sign_in_method_already_linked", "sign_in_method_last",
  "sign_in_method_relay_email", "email_unverified", "session_mismatch", "proof_required", "password_incorrect",
  "mfa_code_incorrect", "step_up_code_incorrect", "invalid_request", "something_new",
];

describe("every key the tables name exists in both locales", () => {
  it("for every code in every context, masked or not, and every retry phrase", () => {
    const missing: string[] = [];
    const check = (key: string, plural = false) => {
      if (!has(vi, key, plural)) missing.push(`vi ${key}`);
      if (!has(en, key, plural)) missing.push(`en ${key}`);
    };
    for (const context of CONTEXTS) {
      for (const code of CODES) {
        check(readSignInFailure(api(code, 400), context).key);
        check(readSignInFailure(api(code, 409, { masked_email: "a•••@x.vn" }), context).key);
      }
    }
    for (const code of LOGIN_REDIRECT_ERRORS) check(loginRedirectErrorKey(code)!);
    for (const result of LINK_RESULTS) {
      check(readLinkResult(new URLSearchParams({ sign_in_method: "google", result }))!.key);
      check(readLinkResult(new URLSearchParams({ sign_in_method: "google", result, masked_email: "a•••@x.vn" }))!.key);
    }
    check(linkSkippedKey("x")!);
    check(linkSkippedKey("x", "apple")!);
    check(retryPhrase(null).key);
    check(retryPhrase(5).key, true);
    check(retryPhrase(900).key, true);
    expect(missing).toEqual([]);
  });
});

describe("readSignInFailure", () => {
  it("reads a web ApiError: field errors speak under the input", () => {
    expect(readSignInFailure(api("invalid_credentials", 401))).toEqual({
      code: "invalid_credentials",
      status: 401,
      kind: "field",
      key: "auth.social.errors.invalid_credentials",
      values: {},
      retryAfterSeconds: null,
      retry: null,
      proofs: null,
      maskedEmail: null,
    });
    expect(readSignInFailure(api("password_incorrect", 403), "step_up")).toMatchObject({
      kind: "field",
      key: "settings.security.stepUp.errors.passwordIncorrect",
    });
  });

  it("reads the same code differently where it means something else", () => {
    expect(readSignInFailure(api("invalid_credentials", 401), "second_factor").key).toBe("auth.social.errors.second_factor_invalid");
    expect(readSignInFailure(api("sign_in_account_conflict", 409), "ticket").key).toBe("auth.continue.errors.conflict");
    expect(readSignInFailure(api("sign_in_account_conflict", 409), "sign_in").key).toBe("auth.social.errors.sign_in_conflict");
    expect(readSignInFailure(api("invalid_request", 400), "claim")).toMatchObject({ kind: "field", key: "auth.continue.errors.invalidEmail" });
    expect(readSignInFailure(api("invalid_request", 400), "password").key).toBe("settings.security.signInMethods.password.tooShort");
    expect(readSignInFailure(api("password_incorrect", 403), "password").key).toBe(
      "settings.security.signInMethods.password.currentIncorrect",
    );
    expect(readSignInFailure(api("google_not_configured", 503), "methods").key).toBe("settings.security.signInMethods.errors.notConfigured");
  });

  it("counts a wait down from Retry-After, the app's retryAfterMs, or fields.retry_after", () => {
    expect(readSignInFailure(api("second_factor_locked", 429, undefined, 900), "second_factor")).toMatchObject({
      kind: "wait",
      key: "auth.social.errors.second_factor_locked",
      retryAfterSeconds: 900,
      retry: { key: "auth.social.retry.minutes", count: 15 },
    });
    const transportError = Object.assign(new Error("uniwork request failed: rate_limited"), {
      code: "rate_limited",
      status: 429,
      retryAfterMs: 42_500,
    });
    expect(readSignInFailure(transportError, "claim")).toMatchObject({
      kind: "wait",
      key: "auth.continue.errors.tooManyCodes",
      retryAfterSeconds: 43,
      retry: { key: "auth.social.retry.seconds", count: 43 },
    });
    expect(readSignInFailure(api("rate_limited", 429, { retry_after: 30 }), "step_up")).toMatchObject({
      key: "settings.security.stepUp.errors.tooManyCodes",
      retryAfterSeconds: 30,
    });
    expect(readSignInFailure(api("rate_limited", 429))).toMatchObject({ retry: { key: "auth.social.retry.later" } });
  });

  it("opens the proof dialog on the server's proofs", () => {
    expect(readSignInFailure(api("proof_required", 403, { proofs: ["totp", "fingerprint"] }), "methods")).toMatchObject({
      kind: "step_up",
      key: "settings.security.stepUp.errors.proofRequired",
      proofs: ["totp"],
    });
    expect(readSignInFailure(api("proof_required", 403), "methods").proofs).toEqual([]);
  });

  it("names the masked holder of a taken or movable identity, and has a sentence without one", () => {
    expect(readSignInFailure(api("sign_in_method_movable", 409, { masked_email: "a•••@icloud.com" }), "ticket")).toMatchObject({
      kind: "move",
      key: "settings.security.signInMethods.errors.movable",
      values: { masked: "a•••@icloud.com" },
      maskedEmail: "a•••@icloud.com",
    });
    expect(readSignInFailure(api("sign_in_method_taken", 409), "methods")).toMatchObject({
      key: "settings.security.signInMethods.errors.takenUnknown",
      values: {},
    });
  });

  it("reads the app's bearer ApiError by the server's envelope", () => {
    const bearer = (status: number, error?: Record<string, unknown>, retryAfterSeconds?: number) =>
      Object.assign(new Error("request failed"), { status, body: error ? { error } : undefined, retryAfterSeconds });
    expect(readSignInFailure(bearer(403, { code: "proof_required", fields: { proofs: ["password", "email_code"] } }), "methods")).toMatchObject({
      code: "proof_required",
      status: 403,
      kind: "step_up",
      proofs: ["password", "email_code"],
    });
    expect(readSignInFailure(bearer(409, { code: "sign_in_method_movable", fields: { masked_email: "a•••@icloud.com" } }), "methods")).toMatchObject({
      kind: "move",
      key: "settings.security.signInMethods.errors.movable",
      maskedEmail: "a•••@icloud.com",
    });
    expect(readSignInFailure(bearer(403, { code: "password_incorrect" }), "step_up")).toMatchObject({ kind: "field" });
    expect(readSignInFailure(bearer(429, { code: "rate_limited", fields: { retry_after: 45 } }), "step_up")).toMatchObject({
      key: "settings.security.stepUp.errors.tooManyCodes",
      retryAfterSeconds: 45,
    });
    expect(readSignInFailure(bearer(429, { code: "second_factor_locked" }, 600), "step_up").retryAfterSeconds).toBe(600);
    // No HTTP answer (offline, timed out) is status 0 on the app.
    expect(readSignInFailure(bearer(0), "methods")).toMatchObject({ code: "network", status: null, key: "auth.social.errors.network" });
    // A body that is no envelope still falls back by status.
    expect(readSignInFailure(Object.assign(new Error("x"), { status: 502, body: "Bad Gateway" }), "methods").key).toBe(
      "auth.social.errors.server",
    );
  });

  it("reads a 401 by its context, whether the server named it unauthorized or the app's transport only inferred it", () => {
    const inferred = (code: string, status: number) =>
      Object.assign(new Error(`uniwork request failed: ${code}`), { code, status, fromServer: false });
    expect(readSignInFailure(inferred("unauthorized", 401), "sign_in")).toMatchObject({
      code: "unauthorized",
      kind: "field",
      key: "auth.social.errors.invalid_credentials",
    });
    expect(readSignInFailure(inferred("unauthorized", 401), "step_up").kind).toBe("session");
    expect(readSignInFailure(api("unauthorized", 401), "sign_in").kind).toBe("field");
    expect(readSignInFailure(api("unauthorized", 401), "methods").kind).toBe("session");
    // An inferred code never reads as the server's verdict of the same name.
    expect(readSignInFailure(inferred("invalid_request", 409), "register").key).toBe("auth.social.errors.generic");
    expect(readSignInFailure(inferred("rate_limited", 429), "claim").key).toBe("auth.social.errors.rate_limited");
    // Without a status the transport's own code is all there is.
    expect(readSignInFailure(Object.assign(new Error("x"), { code: "timeout", fromServer: false })).key).toBe("auth.social.errors.network");
    expect(
      readSignInFailure(Object.assign(new Error("x"), { code: "invalid_credentials", status: 401, fromServer: true }), "second_factor").key,
    ).toBe("auth.social.errors.second_factor_invalid");
  });

  it("a proof locked after too many wrong tries never speaks of two-factor to a signed-in command", () => {
    for (const context of ["password", "methods", "step_up"] as const) {
      expect(readSignInFailure(api("second_factor_locked", 429, undefined, 900), context)).toMatchObject({
        kind: "wait",
        key: "settings.security.stepUp.errors.locked",
        retry: { key: "auth.social.retry.minutes", count: 15 },
      });
    }
    expect(readSignInFailure(api("second_factor_locked", 429), "second_factor").key).toBe("auth.social.errors.second_factor_locked");
  });

  it("sends a gone ticket back to sign-in and an ended session to sign in again", () => {
    expect(readSignInFailure(api("sign_in_ticket_missing", 404), "ticket").kind).toBe("restart");
    expect(readSignInFailure(api("sign_in_ticket_channel", 400), "ticket").kind).toBe("restart");
    expect(readSignInFailure(api("invalid_token", 401), "methods").kind).toBe("session");
  });

  it("falls back by status for a code it does not know", () => {
    expect(readSignInFailure(api("brand_new", 429)).kind).toBe("wait");
    expect(readSignInFailure(api("brand_new", 502)).key).toBe("auth.social.errors.server");
    expect(readSignInFailure(api("brand_new", 401), "step_up").key).toBe("auth.social.errors.session_ended");
    expect(readSignInFailure(api("brand_new", 401), "sign_in").key).toBe("auth.social.errors.invalid_credentials");
    expect(readSignInFailure(api("brand_new", 418), "ticket")).toMatchObject({ kind: "form", key: "auth.continue.errors.generic" });
    expect(readSignInFailure(api("brand_new", 400), "methods").key).toBe("settings.security.signInMethods.errors.generic");
  });

  it("never throws: no answer is a network failure, anything else the generic sentence", () => {
    expect(readSignInFailure(new TypeError("Failed to fetch"))).toMatchObject({ code: "network", key: "auth.social.errors.network" });
    expect(readSignInFailure(new Error("boom"), "step_up")).toMatchObject({
      code: "unknown",
      status: null,
      key: "settings.security.stepUp.errors.generic",
    });
    expect(readSignInFailure(undefined)).toMatchObject({ code: "unknown", key: "auth.social.errors.generic" });
    expect(readSignInFailure("nope", "register").key).toBe("auth.social.errors.generic");
    expect(readSignInFailure({ code: "", status: "500", fields: [], retryAfterSeconds: -1, retryAfterMs: Number.NaN }).code).toBe("unknown");
  });
});

describe("retry phrases", () => {
  it("speaks seconds under a minute and a half, minutes above", () => {
    expect(retryPhrase(0)).toEqual({ key: "auth.social.retry.later" });
    expect(retryPhrase(1)).toEqual({ key: "auth.social.retry.seconds", count: 1 });
    expect(retryPhrase(89.2)).toEqual({ key: "auth.social.retry.seconds", count: 90 });
    expect(retryPhrase(90)).toEqual({ key: "auth.social.retry.minutes", count: 2 });
  });

  it("counts whole seconds down, never below zero", () => {
    expect(secondsUntil(10_500, 0)).toBe(11);
    expect(secondsUntil(0, 5_000)).toBe(0);
  });
});

describe("the /login ?error= codes", () => {
  it("map to their sentence; an unknown code is ignored", () => {
    expect(loginRedirectErrorKey("apple_denied")).toBe("auth.social.errors.apple_denied");
    expect(loginRedirectErrorKey("google_unverified")).toBe("auth.social.errors.google_unverified");
    expect(loginRedirectErrorKey("teapot")).toBeNull();
    expect(loginRedirectErrorKey(null)).toBeNull();
  });
});

describe("linkSkippedKey", () => {
  it("says so only when something was skipped, naming the provider when known", () => {
    expect(linkSkippedKey(undefined)).toBeNull();
    expect(linkSkippedKey("")).toBeNull();
    expect(linkSkippedKey("sign_in_method_taken")).toBe("auth.social.linkSkipped.generic");
    expect(linkSkippedKey("link_required", "apple")).toBe("auth.social.linkSkipped.withProvider");
  });
});

describe("readLinkResult", () => {
  const q = (params: Record<string, string>) => readLinkResult(new URLSearchParams(params));

  it("reads a link from Settings coming back", () => {
    expect(q({ sign_in_method: "apple", result: "linked" })).toEqual({
      provider: "apple",
      result: "linked",
      tone: "success",
      key: "settings.security.signInMethods.results.linked",
      values: {},
      maskedEmail: null,
    });
    expect(q({ sign_in_method: "google", result: "movable", masked_email: "a•••@gmail.com" })).toMatchObject({
      tone: "confirm",
      key: "settings.security.signInMethods.results.movable",
      values: { masked: "a•••@gmail.com" },
    });
    expect(q({ sign_in_method: "google", result: "taken" })).toMatchObject({
      tone: "error",
      key: "settings.security.signInMethods.results.takenUnknown",
    });
  });

  it("reads an unknown result as failed, and nothing when the page did not come back from a link", () => {
    expect(q({ sign_in_method: "google", result: "exploded" })).toMatchObject({ result: "failed", tone: "error" });
    expect(q({ sign_in_method: "github", result: "linked" })).toBeNull();
    expect(q({ sign_in_method: "google" })).toBeNull();
    expect(q({})).toBeNull();
  });
});
