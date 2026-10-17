// Ported from usf apps/mobile/app.config.ts: one dynamic config switched by the
// build environment, with per-variant bundle id overrides and appleTeamId.
//
// There is no .env (the pre-commit hook refuses one). The only build-time knobs
// are UNICHAT_ENV (dev | staging | production), UNICHAT_API_URL,
// UNICHAT_APP_URL and UNICHAT_EAS_PROJECT_ID; the app reads the result from
// `extra` via expo-constants and calls configureRuntime() at boot. Defaults are
// the dev values; staging and production have none (eas.json, runbook
// docs/runbooks/unichat-mobile-release.md).
import type { ConfigContext, ExpoConfig } from "expo/config";

type AppEnv = "dev" | "staging" | "production";

// Universal links verify against the production id only (the AASA and
// assetlinks web serves name it); dev and staging rely on the custom scheme.
const APP_LINK_HOST = "app.uniworkos.com";

// The EAS project (not a secret), written here by the first-time setup in
// docs/runbooks/unichat-mobile-release.md once the account exists (UNI-1838).
// Empty means no EAS: no update server, no push token, the embedded bundle is
// the app. UNICHAT_EAS_PROJECT_ID overrides it; "" turns EAS off for a build.
const EAS_PROJECT_ID = "";

function appEnv(): AppEnv {
  const value = process.env.UNICHAT_ENV;
  return value === "staging" || value === "production" ? value : "dev";
}

/** A release variant pointing at localhost is a broken store build: fail the build, not the phone. */
function serverUrl(name: "UNICHAT_API_URL" | "UNICHAT_APP_URL", env: AppEnv, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (env === "dev") return devDefault;
  throw new Error(`${name} is required when UNICHAT_ENV=${env}`);
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
  const easProjectId = (process.env.UNICHAT_EAS_PROJECT_ID ?? EAS_PROJECT_ID) || undefined;

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
    // An update only reaches binaries of the same `version`: a native change
    // bumps it, so an older OTA can never land on a newer native build.
    runtimeVersion: { policy: "appVersion" },
    // Downloaded in the background at launch, applied on the next cold start.
    // knip.json ignores expo-updates: knip loads the dev config, where updates are off.
    updates: easProjectId ? { url: `https://u.expo.dev/${easProjectId}` } : { enabled: false },
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
      // Chat attachments (M2a) pick from the library only. The microphone is left
      // at the plugin default, not blocked: voice recording lands in M3.
      [
        "expo-image-picker",
        { photosPermission: "UniChat mở thư viện ảnh để bạn gửi ảnh vào cuộc trò chuyện.", cameraPermission: false },
      ],
    ],
    extra: {
      APP_ENV: env,
      apiUrl: serverUrl("UNICHAT_API_URL", env, "http://localhost:8080"),
      appUrl: serverUrl("UNICHAT_APP_URL", env, "http://localhost:3000"),
      authClientId: "uniwork-chat-mobile",
      deploymentId: "default",
      // Absent without an EAS project: data/push.ts then skips registration.
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    },
  };
};
