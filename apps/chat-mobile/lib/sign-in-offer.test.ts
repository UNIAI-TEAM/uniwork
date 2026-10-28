import { NO_AUTH_PROVIDERS, type AuthProviders } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { describe, expect, it } from "vitest";
import { appProofs, offersProvider, providerOrder, providerRequest, signInOfferOf } from "./sign-in-offer";

const all: AuthProviders = { google: true, apple: true, apple_web: true, google_native: true };
const offer = (os: string, providers: Partial<AuthProviders>, device: { apple?: boolean; google?: boolean } = {}) =>
  signInOfferOf({ os, providers: { ...NO_AUTH_PROVIDERS, ...providers }, appleNative: device.apple ?? true, googleNative: device.google ?? true });

describe("the ways in besides email", () => {
  it("opens both sheets on an iPhone whose server takes them", () => {
    expect(offer("ios", all)).toEqual({ apple: "native", google: "native" });
  });

  it("sends Apple through the browser on Android, and Google there too without Play services", () => {
    expect(offer("android", all)).toEqual({ apple: "browser", google: "native" });
    expect(offer("android", all, { google: false })).toEqual({ apple: "browser", google: "browser" });
  });

  it("falls back to the browser when this server or this phone cannot take the sheet", () => {
    expect(offer("ios", { ...all, apple: false, google_native: false })).toEqual({ apple: "browser", google: "browser" });
    expect(offer("ios", all, { apple: false, google: false })).toEqual({ apple: "browser", google: "browser" });
  });

  it("hides a provider the server offers nowhere, and every one when it cannot be asked", () => {
    expect(offer("ios", { apple: true })).toEqual({ apple: "native", google: null });
    expect(offer("android", { apple: true, google_native: true }, { google: false })).toEqual({ apple: null, google: null });
    expect(offer("ios", NO_AUTH_PROVIDERS)).toEqual({ apple: null, google: null });
  });

  it("says whether there is anything but email to offer", () => {
    expect(offersProvider(undefined)).toBe(false);
    expect(offersProvider({ apple: null, google: null })).toBe(false);
    expect(offersProvider({ apple: null, google: "browser" })).toBe(true);
    expect(offersProvider({ apple: "native", google: null })).toBe(true);
  });
});

describe("the proofs this phone can present", () => {
  it("offers a provider's fresh token only where its sheet opens here", () => {
    expect(appProofs({ apple: "native", google: "native" })).toEqual(["totp", "password", "apple", "google", "email_code"]);
    expect(appProofs({ apple: "browser", google: "native" })).toEqual(["totp", "password", "google", "email_code"]);
    expect(appProofs(undefined)).toEqual(["totp", "password", "email_code"]);
  });
});

describe("the provider buttons", () => {
  it("put Apple first on an iPhone and Google first elsewhere", () => {
    expect(providerOrder("ios")).toEqual(["apple", "google"]);
    expect(providerOrder("android")).toEqual(["google", "apple"]);
  });

  it("start the provider's sheet, or the browser with the provider hint, or nothing when not offered", () => {
    const mixed = { apple: "browser", google: "native" } as const;
    expect(providerRequest("google", mixed)).toEqual({ method: "google" });
    expect(providerRequest("google", mixed, "sign_up")).toEqual({ method: "google", intent: "sign_up" });
    // The register screen's button keeps its intent through the browser: the web starts the provider to sign up.
    expect(providerRequest("apple", mixed, "sign_up")).toEqual({ method: "browser", provider: "apple", intent: "sign_up" });
    expect(providerRequest("apple", mixed)).toEqual({ method: "browser", provider: "apple" });
    expect(providerRequest("apple", { apple: null, google: null })).toBeNull();
    expect(providerRequest("apple", undefined)).toBeNull();
  });
});
