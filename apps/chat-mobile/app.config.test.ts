// Ported from usf apps/mobile/app.config.test.ts, re-cut for the UniChat
// variants: identity, scheme, links and `extra` per UNICHAT_ENV.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigContext } from "expo/config";
import createConfig from "./app.config";

const build = () => createConfig({ config: {} } as ConfigContext);

afterEach(() => vi.unstubAllEnvs());

describe("app.config per UNICHAT_ENV", () => {
  it.each([
    [undefined, "UniChat (Dev)", "com.uniworkos.chat.dev", "uniworkchat-dev"],
    ["dev", "UniChat (Dev)", "com.uniworkos.chat.dev", "uniworkchat-dev"],
    ["nonsense", "UniChat (Dev)", "com.uniworkos.chat.dev", "uniworkchat-dev"],
    ["staging", "UniChat (Staging)", "com.uniworkos.chat.staging", "uniworkchat"],
    ["production", "UniChat", "com.uniworkos.chat", "uniworkchat"],
  ])("%s → name, ids, scheme and links", (env, name, appId, scheme) => {
    vi.stubEnv("UNICHAT_ENV", env);
    vi.stubEnv("EXPO_BUNDLE_IDENTIFIER_DEV", undefined);
    vi.stubEnv("EXPO_BUNDLE_IDENTIFIER_STAGING", undefined);
    vi.stubEnv("EXPO_BUNDLE_IDENTIFIER_PROD", undefined);

    const config = build();
    expect(config.name).toBe(name);
    expect(config.slug).toBe("uniwork-chat");
    expect(config.updates).toEqual({ enabled: false });
    expect(config.scheme).toBe(scheme);
    expect(config.ios).toMatchObject({
      bundleIdentifier: appId,
      associatedDomains: ["applinks:app.uniworkos.com"],
    });
    expect(config.android).toMatchObject({
      package: appId,
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host: "app.uniworkos.com" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    });
    expect(config.extra).toMatchObject({
      APP_ENV: env === "staging" || env === "production" ? env : "dev",
      authClientId: "uniwork-chat-mobile",
      deploymentId: "default",
    });
    expect(config.plugins).toEqual(
      expect.arrayContaining([
        "expo-router",
        "expo-secure-store",
        "expo-notifications",
        ["expo-build-properties", { ios: { enableSceneSupport: true } }],
      ]),
    );
  });

  it("defaults the urls to the local dev servers and takes UNICHAT_* overrides", () => {
    vi.stubEnv("UNICHAT_API_URL", undefined);
    vi.stubEnv("UNICHAT_APP_URL", undefined);
    expect(build().extra).toMatchObject({
      apiUrl: "http://localhost:8080",
      appUrl: "http://localhost:3000",
    });

    vi.stubEnv("UNICHAT_API_URL", "http://192.168.1.20:8080");
    vi.stubEnv("UNICHAT_APP_URL", "http://192.168.1.20:3000");
    expect(build().extra).toMatchObject({
      apiUrl: "http://192.168.1.20:8080",
      appUrl: "http://192.168.1.20:3000",
    });
  });

  it.each([
    ["dev", "com.example.chat.dev"],
    ["staging", "com.example.chat.staging"],
    ["production", "com.example.chat"],
  ])("preserves the signing override for %s on both platforms", (env, appId) => {
    vi.stubEnv("UNICHAT_ENV", env);
    vi.stubEnv("EXPO_BUNDLE_IDENTIFIER_DEV", "com.example.chat.dev");
    vi.stubEnv("EXPO_BUNDLE_IDENTIFIER_STAGING", "com.example.chat.staging");
    vi.stubEnv("EXPO_BUNDLE_IDENTIFIER_PROD", "com.example.chat");
    vi.stubEnv("EXPO_APPLE_TEAM_ID", "ABCDE12345");

    const config = build();
    expect(config.ios).toMatchObject({ bundleIdentifier: appId, appleTeamId: "ABCDE12345" });
    expect(config.android?.package).toBe(appId);
  });
});
