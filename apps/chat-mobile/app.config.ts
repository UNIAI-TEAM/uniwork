// Ported from usf apps/mobile/app.config.ts: one dynamic config switched by the
// build environment, with per-variant bundle id overrides and appleTeamId.
//
// There is no .env (the pre-commit hook refuses one). The only build-time knobs
// are UNICHAT_ENV (dev | staging | production), UNICHAT_API_URL and
// UNICHAT_APP_URL; the app reads the result from `extra` via expo-constants
// and calls configureRuntime() at boot. Defaults are the dev values.
import type { ConfigContext, ExpoConfig } from "expo/config";

type AppEnv = "dev" | "staging" | "production";

// Universal links verify against the production id only (the AASA and
// assetlinks web serves name it); dev and staging rely on the custom scheme.
const APP_LINK_HOST = "app.uniworkos.com";

function appEnv(): AppEnv {
  const value = process.env.UNICHAT_ENV;
  return value === "staging" || value === "production" ? value : "dev";
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const env = appEnv();
  const isProd = env === "production";
  const isStaging = env === "staging";
  // Each variant reads only its own override: an Apple ID can sign only the
  // bundle prefixes it owns, so a contributor off the team swaps in theirs
  // without collapsing dev / staging / prod onto one id.
  const appId = isProd
    ? (process.env.EXPO_BUNDLE_IDENTIFIER_PROD ?? "com.uniworkos.chat")
    : isStaging
      ? (process.env.EXPO_BUNDLE_IDENTIFIER_STAGING ?? "com.uniworkos.chat.staging")
      : (process.env.EXPO_BUNDLE_IDENTIFIER_DEV ?? "com.uniworkos.chat.dev");

  return {
    ...config,
    name: isProd ? "UniChat" : isStaging ? "UniChat (Staging)" : "UniChat (Dev)",
    slug: "uniwork-chat",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    // The server allowlists both redirects for client uniwork-chat-mobile
    // (.env.example › DESKTOP_AUTH_CLIENTS); dev gets its own so a dev build
    // and a store build can live on one phone.
    scheme: env === "dev" ? "uniworkchat-dev" : "uniworkchat",
    // Built by `pnpm brand:build` from packages/ui/brand/svg/unichat-icon*.svg.
    icon: "./assets/icon.png",
    // No expo-updates until EAS/OTA lands in M4 (ADR 0011 §6).
    updates: { enabled: false },
    ios: {
      supportsTablet: false,
      // Pins DEVELOPMENT_TEAM on every prebuild; unset, `expo run:ios` picks the
      // first signing identity it finds and never revisits the choice.
      appleTeamId: process.env.EXPO_APPLE_TEAM_ID,
      bundleIdentifier: appId,
      associatedDomains: [`applinks:${APP_LINK_HOST}`],
    },
    android: {
      package: appId,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundImage: "./assets/adaptive-icon-background.png",
      },
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host: APP_LINK_HOST }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-localization",
      "expo-web-browser",
      "expo-notifications",
      // SDK 57's scene runtime is required for Xcode 27 builds.
      ["expo-build-properties", { ios: { enableSceneSupport: true } }],
    ],
    extra: {
      APP_ENV: env,
      apiUrl: process.env.UNICHAT_API_URL ?? "http://localhost:8080",
      appUrl: process.env.UNICHAT_APP_URL ?? "http://localhost:3000",
      authClientId: "uniwork-chat-mobile",
      deploymentId: "default",
      // `eas.projectId` arrives with the EAS account (M4); without it data/push.ts
      // skips registration, so the key is deliberately absent for now.
    },
  };
};
