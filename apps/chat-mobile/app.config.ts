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

// What iOS shows when UniChat first asks for the photos, the camera and the microphone.
const USAGE_VI = {
  NSPhotoLibraryUsageDescription: "UniChat mở thư viện ảnh để bạn gửi ảnh vào cuộc trò chuyện.",
  NSCameraUsageDescription: "UniChat dùng camera khi bạn gọi video.",
  NSMicrophoneUsageDescription: "UniChat dùng micro khi bạn gọi điện và ghi tin thoại.",
};
const USAGE_EN: typeof USAGE_VI = {
  NSPhotoLibraryUsageDescription: "UniChat opens your photo library so you can send photos to a conversation.",
  NSCameraUsageDescription: "UniChat uses the camera for video calls.",
  NSMicrophoneUsageDescription: "UniChat uses the microphone for calls and voice messages.",
};

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

const INTER = [400, 500, 600, 700, 800] as const;
const JAKARTA = [400, 500, 600, 700, 800] as const;
const WEIGHT_NAME: Record<number, string> = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold" };
const fontFile = (pkg: string, file: string, weight: number) => `node_modules/@expo-google-fonts/${pkg}/${weight}${WEIGHT_NAME[weight]}/${file}_${weight}${WEIGHT_NAME[weight]}.ttf`;
const FONT_FAMILIES = [
  { fontFamily: "Inter", fontDefinitions: INTER.map((weight) => ({ path: fontFile("inter", "Inter", weight), weight })) },
  { fontFamily: "Plus Jakarta Sans", fontDefinitions: JAKARTA.map((weight) => ({ path: fontFile("plus-jakarta-sans", "PlusJakartaSans", weight), weight })) },
];
const FONT_FILES = FONT_FAMILIES.flatMap((family) => family.fontDefinitions.map((definition) => definition.path));

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
    version: "0.2.0",
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
      // A call keeps its audio when the person switches app or locks the phone.
      infoPlist: { UIBackgroundModes: ["audio"] },
    },
    android: {
      package: appId,
      // The WebRTC plugin asks to draw over other apps; a call never does, and Play reviews it.
      blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW"],
      // An EAS file variable (docs/evidence/unichat/release-accounts.md): without
      // Firebase, getExpoPushTokenAsync throws on Android and push never registers.
      ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
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
    // The permission prompts in English for an English phone; the plugins below
    // write the Vietnamese ones into Info.plist as the base strings.
    locales: { en: USAGE_EN },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-localization",
      "expo-web-browser",
      "expo-notifications",
      // R4b (UNI-1916): the canvas types in Inter (body) and Plus Jakarta Sans
      // (titles, names). Embedded natively so `fontFamily` + `fontWeight`
      // resolve on both platforms without a runtime load.
      ["expo-font", { ios: { fonts: FONT_FILES }, android: { fonts: FONT_FAMILIES } }],
      // SDK 57's scene runtime is required for Xcode 27 builds.
      ["expo-build-properties", { ios: { enableSceneSupport: true } }],
      // Every plugin that writes a usage string gets the same one: the last to
      // run wins. A `false` here would also block the Android permission the
      // video call needs.
      [
        "expo-image-picker",
        { photosPermission: USAGE_VI.NSPhotoLibraryUsageDescription, cameraPermission: USAGE_VI.NSCameraUsageDescription, microphonePermission: USAGE_VI.NSMicrophoneUsageDescription },
      ],
      // Voice messages (M3); background playback adds UIBackgroundModes: audio,
      // which also keeps a call's audio going when the app leaves the screen.
      ["expo-audio", { microphonePermission: USAGE_VI.NSMicrophoneUsageDescription }],
      // Calls (M3): LiveKit's native setup, then WebRTC's permissions.
      "@livekit/react-native-expo-plugin",
      [
        "@config-plugins/react-native-webrtc",
        { cameraPermission: USAGE_VI.NSCameraUsageDescription, microphonePermission: USAGE_VI.NSMicrophoneUsageDescription },
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
