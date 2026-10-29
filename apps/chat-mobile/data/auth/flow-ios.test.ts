// The same composition root on an iPhone: Apple's sheet is offered when the system has it and the server takes it
// (ADR 0041, 0049), and the browser's Apple stands in when either does not.
import { configureRuntime } from "@uniwork/core/runtime-config";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", async () => (await import("./expo-crypto-mock")).expoCryptoMock());
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "uniworkchat", extra: {} } } }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const apple = vi.hoisted(() => ({ isAvailableAsync: vi.fn(async () => true), signInAsync: vi.fn(), AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 } }));
vi.mock("expo-apple-authentication", () => apple);
const strict = vi.hoisted(() => ({ strictFetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>() }));
vi.mock("./strict-fetch", () => strict);
vi.mock("../build-info", () => ({ buildInfo: () => ({ version: "0.4.0", build: "" }) }));
vi.mock("@/modules/unichat-google-sign-in", () => ({ UniChatGoogleSignIn: null }));

import { nativeClient, signInOffer } from "./flow";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("auth flow composition on iOS", () => {
  it("offers Apple's sheet only when the iPhone has it and the server takes it", async () => {
    configureRuntime({ apiUrl: "https://uniwork.example", appUrl: "https://uniwork.example" });
    strict.strictFetch.mockResolvedValueOnce(json(200, { google: true, apple: true, apple_web: true }));
    expect(await signInOffer()).toEqual({ apple: "native", google: "browser" });
    strict.strictFetch.mockResolvedValueOnce(json(200, { google: true, apple: false, apple_web: true }));
    expect(await signInOffer()).toEqual({ apple: "browser", google: "browser" });
    apple.isAvailableAsync.mockResolvedValueOnce(false);
    strict.strictFetch.mockResolvedValueOnce(json(200, { apple: true }));
    expect(await signInOffer()).toEqual({ apple: null, google: null });
  });

  it("names the build by its version alone when the platform gives no build number", () => {
    expect(nativeClient).toMatchObject({ platform: "ios", device_label: "UniChat (iOS)", build: "0.4.0" });
  });
});
