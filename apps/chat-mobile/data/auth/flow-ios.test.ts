// The same composition root on an iPhone: Sign in with Apple is wired (ADR 0041), and offered when the system has it
// and the server takes it.
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

import { appleSignInOffered, loginWithApple, session } from "./flow";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("auth flow composition on iOS", () => {
  it("offers Sign in with Apple only when the iPhone has it and the server takes it", async () => {
    configureRuntime({ apiUrl: "https://uniwork.example", appUrl: "https://uniwork.example" });
    strict.strictFetch.mockResolvedValueOnce(json(200, { google: true, apple: true }));
    expect(await appleSignInOffered()).toBe(true);
    strict.strictFetch.mockResolvedValueOnce(json(200, { google: true, apple: false }));
    expect(await appleSignInOffered()).toBe(false);
    apple.isAvailableAsync.mockResolvedValueOnce(false);
    strict.strictFetch.mockResolvedValueOnce(json(200, { apple: true }));
    expect(await appleSignInOffered()).toBe(false);
  });

  it("wires Apple's sheet into the session: closing it leaves nobody signed in", async () => {
    apple.signInAsync.mockRejectedValueOnce(Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" }));
    await loginWithApple();
    expect(apple.signInAsync).toHaveBeenCalledOnce();
    expect(session.status()).toBe("signed-out");
  });
});
