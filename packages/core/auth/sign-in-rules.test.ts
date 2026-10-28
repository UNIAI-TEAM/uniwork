import { describe, expect, it } from "vitest";
import type { SignInMethods } from "../api/endpoints/sign-in-schemas";
import {
  APPLE_RELAY_DOMAIN,
  emailDisplay,
  isAppleRelayEmail,
  maskEmail,
  maskedEmailOf,
  urlMaskedEmailOf,
  remainingAfterUnlink,
  signInMethodKinds,
  unlinkVerdict,
} from "./sign-in-rules";

const methods = (over: Partial<SignInMethods> = {}): SignInMethods => ({
  password: { set: false, changed_at: null },
  google: { linked: false, email: null, linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: [],
  ...over,
});
const linked = { linked: true, email: "an@gmail.com", linked_at: null };

describe("signInMethodKinds / remainingAfterUnlink", () => {
  it("lists the ways in, and what is left once one provider goes", () => {
    const all = methods({ password: { set: true, changed_at: null }, google: linked, apple: { ...linked, private_relay: false } });
    expect(signInMethodKinds(all)).toEqual(["password", "google", "apple"]);
    expect(remainingAfterUnlink(all, "google")).toEqual(["password", "apple"]);
    expect(signInMethodKinds(methods())).toEqual([]);
  });
});

describe("unlinkVerdict", () => {
  it("allows unlinking while another way in remains", () => {
    expect(unlinkVerdict(methods({ password: { set: true, changed_at: null }, google: linked }), "google")).toEqual({ allowed: true });
    expect(unlinkVerdict(methods({ google: linked, apple: { ...linked, private_relay: false } }), "apple")).toEqual({ allowed: true });
  });

  it("never removes the last way in", () => {
    expect(unlinkVerdict(methods({ google: linked }), "google")).toEqual({
      allowed: false,
      reason: "last",
      key: "settings.security.signInMethods.reasons.last",
    });
  });

  it("keeps Apple on an account whose own address is Apple's relay", () => {
    const relay = methods({ password: { set: true, changed_at: null }, apple: { ...linked, private_relay: true }, account_email_is_relay: true });
    expect(unlinkVerdict(relay, "apple")).toEqual({ allowed: false, reason: "relay", key: "settings.security.signInMethods.reasons.relay" });
  });

  it("has nothing to say about a provider that is not linked", () => {
    expect(unlinkVerdict(methods(), "apple")).toEqual({ allowed: false, reason: "not_linked", key: null });
  });
});

describe("relay addresses", () => {
  it("knows Apple's relay domain exactly, after the last @", () => {
    expect(isAppleRelayEmail(`q7x2@${APPLE_RELAY_DOMAIN}`)).toBe(true);
    expect(isAppleRelayEmail("Q7X2@PrivateRelay.AppleID.com ")).toBe(true);
    expect(isAppleRelayEmail("an@privaterelay.appleid.com.evil.vn")).toBe(false);
    expect(isAppleRelayEmail("@privaterelay.appleid.com")).toBe(false);
    expect(isAppleRelayEmail("an@icloud.com")).toBe(false);
    expect(isAppleRelayEmail(null)).toBe(false);
    expect(isAppleRelayEmail(undefined)).toBe(false);
  });

  it("shows a relay as Apple's hidden email, by domain or by the server's flag", () => {
    expect(emailDisplay("q7x2@privaterelay.appleid.com")).toEqual({ kind: "relay", email: "q7x2@privaterelay.appleid.com" });
    expect(emailDisplay("x@icloud.com", { privateRelay: true })).toEqual({ kind: "relay", email: "x@icloud.com" });
    expect(emailDisplay(" an@acme.vn ")).toEqual({ kind: "address", email: "an@acme.vn" });
    expect(emailDisplay("  ")).toEqual({ kind: "none" });
    expect(emailDisplay(null)).toEqual({ kind: "none" });
  });
});

describe("masked addresses", () => {
  it("masks as the server does: the first character, •••, the domain", () => {
    expect(maskEmail("an@icloud.com")).toBe("a•••@icloud.com");
    expect(maskEmail("Đức@acme.vn")).toBe("Đ•••@acme.vn");
    expect(maskEmail("😀x@acme.vn")).toBe("😀•••@acme.vn");
    expect(maskEmail("noatsign")).toBe("•••");
    expect(maskEmail("@acme.vn")).toBe("•••");
    expect(maskEmail("an@")).toBe("•••");
  });

  it("reads only a plausible masked address", () => {
    expect(maskedEmailOf(" a•••@icloud.com ")).toBe("a•••@icloud.com");
    expect(maskedEmailOf("•••")).toBeNull();
    expect(maskedEmailOf("a•••@x.vn <script>")).toBeNull();
    expect(maskedEmailOf(`a@${"x".repeat(260)}`)).toBeNull();
    expect(maskedEmailOf("")).toBeNull();
    expect(maskedEmailOf(42)).toBeNull();
  });

  it("takes from a URL only the shape the server masks with", () => {
    expect(urlMaskedEmailOf(maskEmail("an@icloud.com"))).toBe("a•••@icloud.com");
    expect(urlMaskedEmailOf(maskEmail("😀x@acme.vn"))).toBe("😀•••@acme.vn");
    // A crafted link names an address of its choosing; it is not shown.
    expect(urlMaskedEmailOf("it-support@uniwork-help.example")).toBeNull();
    expect(urlMaskedEmailOf("ab•••@acme.vn")).toBeNull();
    expect(urlMaskedEmailOf("a•••@acme.vn@evil.example")).toBeNull();
    expect(urlMaskedEmailOf("•••")).toBeNull();
  });
});
