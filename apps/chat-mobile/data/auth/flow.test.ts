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
const apple = vi.hoisted(() => ({ isAvailableAsync: vi.fn(async () => true), signInAsync: vi.fn(), AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 } }));
vi.mock("expo-apple-authentication", () => apple);
const strict = vi.hoisted(() => ({ strictFetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>() }));
vi.mock("./strict-fetch", () => strict);
vi.mock("../build-info", () => ({ buildInfo: () => ({ version: "0.4.0", build: "17" }) }));
const google = vi.hoisted(() => ({ isAvailable: vi.fn(async () => false), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/modules/unichat-google-sign-in", () => ({ UniChatGoogleSignIn: google }));
const transportSpy = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("./transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transport")>();
  return {
    ...actual,
    createTransport: (...args: Parameters<typeof actual.createTransport>) => {
      transportSpy.calls.push(args);
      return actual.createTransport(...args);
    },
  };
});

import { configureRuntime } from "@uniwork/core/runtime-config";
import { i18n } from "@/lib/i18n/singleton";
import { systemUiOpen } from "../system-ui";
import { authConfig, nativeClient, nativeSignIn, openAuthBrowser, resolveAuthConfig, session, signInOffer } from "./flow";
import { MobileSession } from "./session";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

  it("sends the sign-in routes through the fetch that refuses a redirect natively", () => {
    expect(transportSpy.calls).toEqual([[{ deploymentId: "eu" }, { fetch: strict.strictFetch }]]);
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
    browser.openAuthSessionAsync.mockImplementationOnce(async () => {
      // The sheet is a system screen the app waits on: no critical update reloads under it.
      expect(systemUiOpen()).toBe(true);
      return { type: "success", url: "uniworkchat-dev://auth/callback?code=c&state=s" };
    });
    expect(await openAuthBrowser("https://uniwork.example/authorize", "uniworkchat-dev://auth/callback")).toBe(
      "uniworkchat-dev://auth/callback?code=c&state=s",
    );
    expect(browser.openAuthSessionAsync).toHaveBeenCalledWith(
      "https://uniwork.example/authorize",
      "uniworkchat-dev://auth/callback",
    );
    browser.openAuthSessionAsync.mockResolvedValueOnce({ type: "dismiss" });
    expect(await openAuthBrowser("https://uniwork.example/authorize", "uniworkchat-dev://auth/callback")).toBeNull();
    expect(systemUiOpen()).toBe(false);
  });

  it("says who the app is to every door of the sign-in screen, and sends them through the strict fetch", async () => {
    expect(nativeClient).toEqual({
      client_id: "uniwork-chat-mobile",
      deployment_id: "eu",
      device_label: "UniChat (Android)",
      platform: "android",
      build: "0.4.0 (17)",
      locale: "vi",
    });
    configureRuntime({ apiUrl: "https://uniwork.example", appUrl: "https://uniwork.example" });
    strict.strictFetch.mockResolvedValueOnce(json(200, { status: "mfa_required", mfa_token: "m" }));
    expect(await nativeSignIn.signInWithPassword({ email: "a@b.c", password: "pw" })).toEqual({ status: "mfa_required", mfa_token: "m" });
    const [url, init] = strict.strictFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://uniwork.example/api/v1/auth/native/password");
    expect(JSON.parse(String(init.body))).toEqual({ ...nativeClient, email: "a@b.c", password: "pw" });
  });

  it("says the app's language as each door is called, so the codes it mails are written in it", async () => {
    configureRuntime({ apiUrl: "https://uniwork.example", appUrl: "https://uniwork.example" });
    const sentLocale = () => {
      const [, init] = strict.strictFetch.mock.calls.at(-1) as [string, RequestInit];
      return (JSON.parse(String(init.body)) as { locale?: string }).locale;
    };
    strict.strictFetch.mockResolvedValueOnce(json(200, { status: "sent" }));
    await nativeSignIn.sendTicketEmailCode({ ticket: "T", nonce: "raw", email: "an@acme.vn" });
    expect(sentLocale()).toBe("vi");
    await i18n.changeLanguage("en");
    try {
      strict.strictFetch.mockResolvedValueOnce(json(200, { status: "sent" }));
      await nativeSignIn.sendTicketEmailCode({ ticket: "T", nonce: "raw", email: "an@acme.vn" });
      expect(sentLocale()).toBe("en");
    } finally {
      await i18n.changeLanguage("vi");
    }
  });

  it("sends Apple through the browser off the iPhone, without asking for Apple's sheet", async () => {
    strict.strictFetch.mockResolvedValueOnce(json(200, { google: true, apple: true, apple_web: true, google_native: true }));
    expect(await signInOffer()).toEqual({ apple: "browser", google: "browser" });
    // Google's sheet where the build and Google Play services can open it
    google.isAvailable.mockResolvedValueOnce(true);
    strict.strictFetch.mockResolvedValueOnce(json(200, { google: true, apple: true, apple_web: true, google_native: true }));
    expect(await signInOffer()).toEqual({ apple: "browser", google: "native" });
    expect(apple.isAvailableAsync).not.toHaveBeenCalled();
    expect(String(strict.strictFetch.mock.lastCall?.[0])).toMatch(/\/api\/v1\/auth\/providers$/);
  });

  it("offers nothing but email while the server cannot be asked", async () => {
    strict.strictFetch.mockRejectedValueOnce(new TypeError("Network request failed"));
    expect(await signInOffer()).toEqual({ apple: null, google: null });
    strict.strictFetch.mockResolvedValueOnce(json(503, { error: { code: "internal" } }));
    expect(await signInOffer()).toEqual({ apple: null, google: null });
  });
});
