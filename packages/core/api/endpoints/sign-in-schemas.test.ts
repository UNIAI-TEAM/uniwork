import { describe, expect, it } from "vitest";
import {
  NO_AUTH_PROVIDERS,
  isSignInProvider,
  isStepUpAction,
  isStepUpProof,
  knownProofs,
  readAuthProviders,
  readAuthorizationUrl,
  readNativeSignIn,
  readSent,
  readSignInMethods,
  readSignInMethodsChange,
  readSignInTicket,
  readStepUpGrant,
} from "./sign-in-schemas";

const user = { id: "u1", email: "an@acme.vn", display_name: "An" };
const methods = {
  password: { set: true, changed_at: "2026-10-12T08:00:00Z" },
  google: { linked: true, email: "an@gmail.com", linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
};

describe("sign-in wire enums", () => {
  it("knows the providers, actions and proofs the server names, and nothing else", () => {
    expect(isSignInProvider("apple")).toBe(true);
    expect(isSignInProvider("microsoft")).toBe(false);
    expect(isStepUpAction("transfer_ownership")).toBe(true);
    expect(isStepUpAction("drop_tables")).toBe(false);
    expect(isStepUpProof("totp")).toBe(true);
    expect(isStepUpProof("sms")).toBe(false);
  });

  it("keeps the known proofs once each, in the server's order", () => {
    expect(knownProofs(["email_code", "sms", "password", "email_code"])).toEqual(["email_code", "password"]);
    expect(knownProofs("password")).toEqual([]);
  });
});

describe("readAuthProviders", () => {
  it("reads every flag and turns off only the one that drifted", () => {
    expect(readAuthProviders({ google: true, apple: false, apple_web: true, google_native: true })).toEqual({
      google: true,
      apple: false,
      apple_web: true,
      google_native: true,
    });
    expect(readAuthProviders({ google: 1, apple: true })).toEqual({ ...NO_AUTH_PROVIDERS, apple: true });
    expect(readAuthProviders(null)).toEqual(NO_AUTH_PROVIDERS);
  });
});

describe("readSignInTicket", () => {
  it("reads the pending sign-in with defaults for what is missing", () => {
    expect(readSignInTicket({ provider: "apple", kind: "unmatched", email: "x@privaterelay.appleid.com", private_relay: true })).toEqual({
      provider: "apple",
      kind: "unmatched",
      email: "x@privaterelay.appleid.com",
      name: "",
      private_relay: true,
    });
  });

  it("is null for a malformed answer or a provider this client cannot show", () => {
    expect(readSignInTicket({ kind: "unmatched" })).toBeNull();
    expect(readSignInTicket({ provider: "github", kind: "unmatched" })).toBeNull();
    expect(readSignInTicket({ provider: "google", kind: 4 })).toBeNull();
  });

  it("keeps a ticket whose display fields drifted, reading them as absent", () => {
    expect(readSignInTicket({ provider: "google", kind: "unmatched", email: 4, name: ["An"], private_relay: "no" })).toEqual({
      provider: "google",
      kind: "unmatched",
      email: "",
      name: "",
      private_relay: false,
    });
  });
});

describe("readNativeSignIn", () => {
  const E = "POST /api/v1/auth/native/password";
  const session = { access_token: "a", refresh_token: "r", deployment_id: "default" };
  const identity = { provider: "google", email: "an@gmail.com", name: "An", private_relay: false };

  it("reads each status into its branch", () => {
    expect(readNativeSignIn({ status: "signed_in", session, reclaimed: true, link_skipped: "" }, E)).toEqual({
      status: "signed_in",
      session,
      reclaimed: true,
      link_skipped: null,
    });
    expect(readNativeSignIn({ status: "signed_in", session, link_skipped: "sign_in_method_taken" }, E)).toMatchObject({
      reclaimed: false,
      link_skipped: "sign_in_method_taken",
    });
    expect(readNativeSignIn({ status: "mfa_required", mfa_token: "chal", reclaimed: false, link_skipped: "" }, E)).toEqual({
      status: "mfa_required",
      mfa_token: "chal",
    });
    expect(readNativeSignIn({ status: "identity_unmatched", ticket: "T", identity }, E)).toEqual({
      status: "identity_unmatched",
      ticket: "T",
      identity,
    });
    expect(readNativeSignIn({ status: "link_required", ticket: "T", identity: { provider: "apple" } }, E)).toEqual({
      status: "link_required",
      ticket: "T",
      identity: { provider: "apple", email: "", name: "", private_relay: false },
    });
  });

  it("never throws a session away over a drifted field it does not need", () => {
    const drifted = { session, reclaimed: "yes", link_skipped: 7, mfa_token: 5, ticket: [], identity: "x", extra: { deep: true } };
    expect(readNativeSignIn({ status: "signed_in", ...drifted }, E)).toEqual({
      status: "signed_in",
      session,
      reclaimed: false,
      link_skipped: null,
    });
    expect(readNativeSignIn({ status: "mfa_required", mfa_token: "chal", reclaimed: 1, identity: 2 }, E)).toEqual({
      status: "mfa_required",
      mfa_token: "chal",
    });
    // An identity's display fields are display: a drifted one reads as absent.
    expect(
      readNativeSignIn({ status: "identity_unmatched", ticket: "T", identity: { provider: "apple", email: 1, name: null, private_relay: "y" } }, E),
    ).toEqual({ status: "identity_unmatched", ticket: "T", identity: { provider: "apple", email: "", name: "", private_relay: false } });
  });

  it("decides null only on the fields a branch needs", () => {
    expect(readNativeSignIn({ status: 7, session }, E)).toBeNull();
    expect(readNativeSignIn({ status: "mfa_required", mfa_token: 5 }, E)).toBeNull();
    expect(readNativeSignIn({ status: "identity_unmatched", ticket: 9, identity }, E)).toBeNull();
    expect(readNativeSignIn({ status: "link_required", ticket: "T", identity: { ...identity, provider: 3 } }, E)).toBeNull();
    expect(readNativeSignIn({ status: "link_required", ticket: "T", identity: "google" }, E)).toBeNull();
  });

  it("is null when a status lacks what it needs, or the status is unknown (the doors fail closed)", () => {
    expect(readNativeSignIn({ status: "signed_in" }, E)).toBeNull();
    expect(readNativeSignIn({ status: "signed_in", session: "tokens" }, E)).toBeNull();
    expect(readNativeSignIn({ status: "signed_in", session: [] }, E)).toBeNull();
    expect(readNativeSignIn({ status: "mfa_required" }, E)).toBeNull();
    expect(readNativeSignIn({ status: "identity_unmatched", identity }, E)).toBeNull();
    expect(readNativeSignIn({ status: "link_required", ticket: "T" }, E)).toBeNull();
    expect(readNativeSignIn({ status: "identity_unmatched", ticket: "T", identity: { ...identity, provider: "github" } }, E)).toBeNull();
    expect(readNativeSignIn({ status: "welcome" }, E)).toBeNull();
    expect(readNativeSignIn({ session }, E)).toBeNull();
    expect(readNativeSignIn("signed_in", E)).toBeNull();
  });
});

describe("readSignInMethods", () => {
  const E = "GET /api/v1/me/sign-in-methods";

  it("reads the rows and keeps the known proofs only", () => {
    expect(readSignInMethods({ ...methods, proofs: ["password", "fingerprint", "email_code"] }, E)).toEqual(methods);
  });

  it("reads a missing row as not set or not linked", () => {
    expect(readSignInMethods({}, E)).toEqual({
      password: { set: false, changed_at: null },
      google: { linked: false, email: null, linked_at: null },
      apple: { linked: false, email: null, linked_at: null, private_relay: false },
      account_email_is_relay: false,
      proofs: [],
    });
  });

  it("is null when a row has the wrong type, so the screen says it could not load", () => {
    expect(readSignInMethods({ ...methods, password: "set" }, E)).toBeNull();
    expect(readSignInMethods({ ...methods, google: { linked: "yes" } }, E)).toBeNull();
    expect(readSignInMethods(null, E)).toBeNull();
  });
});

describe("readSignInMethodsChange", () => {
  const E = "PUT /api/v1/me/password";

  it("reads both halves", () => {
    const out = readSignInMethodsChange({ user, sign_in_methods: methods }, E);
    expect(out.user?.id).toBe("u1");
    expect(out.methods).toEqual(methods);
  });

  it("drops a half that does not parse, never inventing a user", () => {
    expect(readSignInMethodsChange({ user: { id: 1 }, sign_in_methods: methods }, E)).toEqual({ user: null, methods });
    expect(readSignInMethodsChange({ user, sign_in_methods: "x" }, E).methods).toBeNull();
    expect(readSignInMethodsChange("nope", E)).toEqual({ user: null, methods: null });
  });
});

describe("step-up, link start and sent answers", () => {
  it("reads a step-up grant, or null without a usable token", () => {
    expect(readStepUpGrant({ step_up_token: "su", expires_at: "2026-10-27T08:10:00Z", method: "password" })).toEqual({
      step_up_token: "su",
      expires_at: "2026-10-27T08:10:00Z",
      method: "password",
    });
    expect(readStepUpGrant({ step_up_token: "su" })).toEqual({ step_up_token: "su", expires_at: "", method: "" });
    expect(readStepUpGrant({ step_up_token: "" })).toBeNull();
    expect(readStepUpGrant({})).toBeNull();
  });

  it("reads an absolute http(s) authorization URL only", () => {
    const E = "POST /api/v1/me/sign-in-methods/google/link";
    expect(readAuthorizationUrl({ authorization_url: "https://api.test/api/v1/auth/google/start?intent=link" }, E)).toBe(
      "https://api.test/api/v1/auth/google/start?intent=link",
    );
    expect(readAuthorizationUrl({ authorization_url: "javascript:alert(1)" }, E)).toBeNull();
    expect(readAuthorizationUrl({ authorization_url: "/relative" }, E)).toBeNull();
    expect(readAuthorizationUrl({}, E)).toBeNull();
  });

  it("reads sent only from status sent", () => {
    expect(readSent({ status: "sent" }, "E")).toBe(true);
    expect(readSent({ status: "ok" }, "E")).toBe(false);
    expect(readSent(undefined, "E")).toBe(false);
  });
});
