import { describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", async () => (await import("./expo-crypto-mock")).expoCryptoMock());
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
const browser = vi.hoisted(() => ({ openAuthSessionAsync: vi.fn() }));
vi.mock("expo-web-browser", () => browser);
vi.mock("expo-constants", () => ({
  default: { expoConfig: { scheme: "uniworkchat-dev", extra: { authClientId: "uniwork-chat-mobile", deploymentId: "eu" } } },
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import { authConfig, openAuthBrowser, resolveAuthConfig, session } from "./flow";
import { MobileSession } from "./session";

describe("auth flow composition", () => {
  it("builds the session config from app.config.ts extra, the scheme and Platform.OS", () => {
    expect(authConfig).toEqual({
      scheme: "uniworkchat-dev",
      clientId: "uniwork-chat-mobile",
      deploymentId: "eu",
      redirectUri: "uniworkchat-dev://auth/callback",
      platform: "android",
      deviceLabel: "UniChat (Android)",
    });
    expect(session).toBeInstanceOf(MobileSession);
    expect(session.status()).toBe("signed-out");
  });

  it("falls back to the production scheme and default ids; the first of several schemes wins", () => {
    expect(resolveAuthConfig(null, "ios")).toMatchObject({
      scheme: "uniworkchat",
      clientId: "uniwork-chat-mobile",
      deploymentId: "default",
      redirectUri: "uniworkchat://auth/callback",
      deviceLabel: "UniChat (iOS)",
    });
    expect(resolveAuthConfig({ scheme: ["first", "second"], extra: { deploymentId: 7 } }, "ios")).toMatchObject({
      scheme: "first",
      deploymentId: "default",
    });
  });

  it("hands the authorization URL and redirect to the system auth session and returns the callback URL or null", async () => {
    browser.openAuthSessionAsync.mockResolvedValueOnce({ type: "success", url: "uniworkchat-dev://auth/callback?code=c&state=s" });
    expect(await openAuthBrowser("https://uniwork.example/authorize", "uniworkchat-dev://auth/callback")).toBe(
      "uniworkchat-dev://auth/callback?code=c&state=s",
    );
    expect(browser.openAuthSessionAsync).toHaveBeenCalledWith(
      "https://uniwork.example/authorize",
      "uniworkchat-dev://auth/callback",
    );
    browser.openAuthSessionAsync.mockResolvedValueOnce({ type: "dismiss" });
    expect(await openAuthBrowser("https://uniwork.example/authorize", "uniworkchat-dev://auth/callback")).toBeNull();
  });
});
