import { NO_AUTH_PROVIDERS, type AuthProviders } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { describe, expect, it } from "vitest";
import { offersProvider, signInOfferOf } from "./sign-in-offer";

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
