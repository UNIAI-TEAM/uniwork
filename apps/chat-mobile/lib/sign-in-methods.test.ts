import type { SignInMethods } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { describe, expect, it } from "vitest";
import { confirmsWithSecondFactor, methodRows } from "./sign-in-methods";

const methods = (over: Partial<SignInMethods> = {}): SignInMethods => ({
  password: { set: true, changed_at: "2026-10-12T08:00:00Z" },
  google: { linked: false, email: null, linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
  ...over,
});

describe("methodRows", () => {
  it("shows the password, then each provider this phone can link, with how it links", () => {
    const rows = methodRows(methods(), { google: "native", apple: "browser" });
    expect(rows.map((row) => row.kind)).toEqual(["password", "google", "apple"]);
    expect(rows[0]).toEqual({ kind: "password", set: true, changedAt: "2026-10-12T08:00:00Z", email: { kind: "none" } });
    expect(rows[1]).toMatchObject({ kind: "google", linked: false, link: "native", email: { kind: "none" } });
    expect(rows[2]).toMatchObject({ kind: "apple", link: "web" });
  });

  it("hides a provider neither linked nor offered, and keeps a linked one whatever the phone offers", () => {
    const linked = methods({ apple: { linked: true, email: "a@icloud.com", linked_at: null, private_relay: false } });
    expect(methodRows(methods(), undefined).map((row) => row.kind)).toEqual(["password"]);
    const rows = methodRows(linked, { google: null, apple: null });
    expect(rows.map((row) => row.kind)).toEqual(["password", "apple"]);
    expect(rows[1]).toMatchObject({ linked: true, link: null, email: { kind: "address", email: "a@icloud.com" }, unlink: { allowed: true }, remaining: ["password"] });
  });

  it("names a relay address and keeps Apple on a relay account; never the last way in", () => {
    const relay = methods({
      password: { set: false, changed_at: null },
      apple: { linked: true, email: "x@privaterelay.appleid.com", linked_at: "2026-10-01T00:00:00Z", private_relay: true },
      account_email_is_relay: true,
    });
    const [, apple] = methodRows(relay, { google: null, apple: "native" });
    expect(apple).toMatchObject({ email: { kind: "relay" }, unlink: { allowed: false, reason: "relay" }, linkedAt: "2026-10-01T00:00:00Z" });
    const last = methods({ password: { set: false, changed_at: null }, google: { linked: true, email: "an@gmail.com", linked_at: null } });
    expect(methodRows(last, { google: "native", apple: null })[1]).toMatchObject({ unlink: { allowed: false, reason: "last" }, remaining: [] });
  });
});

describe("the password row", () => {
  it("names the address it signs in with, and Apple's hidden one without spelling it", () => {
    expect(methodRows(methods(), undefined, "an@congty.vn")[0]).toMatchObject({ email: { kind: "address", email: "an@congty.vn" } });
    const relay = methods({ account_email_is_relay: true });
    expect(methodRows(relay, undefined, "q7@privaterelay.appleid.com")[0]).toMatchObject({ email: { kind: "relay" } });
  });
});

describe("confirmsWithSecondFactor", () => {
  it("follows the server's list, and the account's own state while there is none", () => {
    expect(confirmsWithSecondFactor(methods({ proofs: ["totp"] }), false)).toBe(true);
    expect(confirmsWithSecondFactor(methods(), true)).toBe(false);
    expect(confirmsWithSecondFactor(methods({ proofs: [] }), true)).toBe(true);
    expect(confirmsWithSecondFactor(null, false)).toBe(false);
  });
});
