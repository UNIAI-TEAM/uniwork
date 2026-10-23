// Ported from usf apps/mobile/app.config.ts: one dynamic config switched by the
// build environment, with per-variant bundle id overrides and appleTeamId.
//
// There is no .env (the pre-commit hook refuses one). The only build-time knobs
// are UNICHAT_ENV (dev | staging | production), UNICHAT_API_URL,
// UNICHAT_APP_URL, UNICHAT_EAS_PROJECT_ID, SENTRY_DSN, UNICHAT_IOS_CALLS and, for an OTA only, UNICHAT_CRITICAL_UPDATE; the app reads the result from
// `extra` via expo-constants and calls configureRuntime() at boot. Defaults are
// the dev values; staging and production have none (eas.json, runbook
// docs/runbooks/unichat-mobile-release.md).
import fs from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

type AppEnv = "dev" | "staging" | "production";

// Universal links verify against the production id only (the AASA and
// assetlinks web serves name it); dev and staging rely on the custom scheme.
const APP_LINK_HOST = "app.uniworkos.com";

/**
 * R8 keep rules for what no library rule covers (expo-build-properties › extraProguardRules). WebRTC's
 * JNI_OnLoad looks up livekit.org.jni_zero.JniInit by name and traps when it is gone, killing the app at launch
 * on every ABI: @livekit/react-native-webrtc 144.2.0's consumer-rules keep the unprefixed org.jni_zero, which
 * the relocated android-prefixed artifact does not have, and that artifact ships no rules of its own.
 */
export const ANDROID_KEEP_RULES = [
  "-keep class com.margelo.nitro.** { *; }",
  "-keep class expo.modules.unichatcalls.** { *; }",
  "-keep class livekit.org.jni_zero.** { *; }",
].join("\n");

// The EAS project (not a secret), written here by the first-time setup in
// docs/runbooks/unichat-mobile-release.md once the account exists (UNI-1838).
// Empty means no EAS: no update server, no push token, the embedded bundle is
// the app. UNICHAT_EAS_PROJECT_ID overrides it; "" turns EAS off for a build.
const EAS_PROJECT_ID = "916177c9-255d-40c2-b93f-c39e85a73255";

// EAS Update code signing (docs/runbooks/unichat-mobile-release.md › Ký OTA):
// the public certificate is committed here (generated 2026-10-22, valid ten
// years); the private key never is (CI reads it from a secret). Every binary
// that embeds the certificate accepts only updates signed with that key.
// A store binary without it would run any JavaScript the Expo account or a
// leaked EXPO_TOKEN publishes, with the Keychain session in reach, and no
// update could take that back: the EAS builder refuses to make a staging or
// production one (audit "ota-unsigned-first-binary": the Play internal build
// reaches testers too). eas-cli's first local read and dev builds go on.
const CODE_SIGNING_CERTIFICATE = "./certs/eas-update-certificate.pem";

function codeSigning(projectRoot: string, env: AppEnv): Pick<NonNullable<ExpoConfig["updates"]>, "codeSigningCertificate" | "codeSigningMetadata"> {
  if (!fs.existsSync(path.resolve(projectRoot, CODE_SIGNING_CERTIFICATE))) {
    if (env !== "dev" && process.env.EAS_BUILD === "true") {
      throw new Error(`${CODE_SIGNING_CERTIFICATE.slice(2)} is required for a ${env} build: a store binary without it accepts unsigned updates (runbook › Ký OTA)`);
    }
    return {};
  }
  return { codeSigningCertificate: CODE_SIGNING_CERTIFICATE, codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" } };
}

/**
 * Calls on iPhone are a capability of the binary, not of a server switch (Apple 2.5.4 and 2.3.1, audit
 * "ios-dormant-calls-bg-audio"): the `audio` background mode is declared only by a build that can place a call a
 * reviewer can try, and a binary built without it never shows calling, whatever unichat_mobile_calls_ios says
 * (data/remote-config.ts › setBuildLacks). UNICHAT_IOS_CALLS=1 turns it on, and only once the call module ships its iOS
 * half (CallKit and PushKit, docs/adr/drafts/0038): asked for before that, the config refuses to build.
 */
export function iosCallsBuilt(projectRoot: string): boolean {
  if (process.env.UNICHAT_IOS_CALLS !== "1") return false;
  const moduleConfig = JSON.parse(fs.readFileSync(path.resolve(projectRoot, "modules/unichat-calls/expo-module.config.json"), "utf8")) as { platforms?: string[] };
  if (!moduleConfig.platforms?.includes("ios")) {
    throw new Error("UNICHAT_IOS_CALLS=1 needs modules/unichat-calls to ship its iOS half (CallKit, PushKit): an iPhone build cannot declare calls it cannot make");
  }
  return true;
}

// What iOS shows when UniChat first asks for the photos, the camera and the microphone.
// store/listing.md › Quyền quotes them for review (store-listing.test.ts holds the two equal).
export const USAGE_VI = {
  NSPhotoLibraryUsageDescription: "UniChat mở thư viện ảnh để bạn gửi ảnh vào cuộc trò chuyện.",
  NSCameraUsageDescription: "UniChat dùng camera khi bạn gọi video.",
  NSMicrophoneUsageDescription: "UniChat dùng micro khi bạn gọi điện và ghi tin thoại.",
  NSFaceIDUsageDescription: "UniChat dùng Face ID để mở khoá ứng dụng khi bạn bật Khoá UniChat.",
};
export const USAGE_EN: typeof USAGE_VI = {
  NSPhotoLibraryUsageDescription: "UniChat opens your photo library so you can send photos to a conversation.",
  NSCameraUsageDescription: "UniChat uses the camera for video calls.",
  NSMicrophoneUsageDescription: "UniChat uses the microphone for calls and voice messages.",
  NSFaceIDUsageDescription: "UniChat uses Face ID to unlock the app when you turn on Lock UniChat.",
};

const collected = (type: string, linked: boolean, purpose: "AppFunctionality" | "Analytics") => ({
  NSPrivacyCollectedDataType: `NSPrivacyCollectedDataType${type}`,
  NSPrivacyCollectedDataTypeLinked: linked,
  NSPrivacyCollectedDataTypeTracking: false,
  NSPrivacyCollectedDataTypePurposes: [`NSPrivacyCollectedDataTypePurpose${purpose}`],
});

/**
 * The app's own privacy manifest (PrivacyInfo.xcprivacy, App Store Connect refuses an upload without the reasons:
 * ITMS-91053). Collected data mirrors App Privacy in store/listing.md › Quyền riêng tư row for row
 * (store-listing.test.ts fails when they differ); no tracking, no tracking domain. Required-reason APIs: what the
 * app and the libraries that ship no manifest of their own (React Native's core, MMKV, LiveKit) touch —
 * UserDefaults for the app's own settings (CA92.1), file timestamps of the app's container (C617.1) and of the
 * files the person picks to send (3B52.1), elapsed time since boot for timers and performance marks (35F9.1),
 * free space before an attachment is copied into the outbox (E174.1). Expo modules and Sentry ship theirs; Xcode
 * aggregates all of them into the archive's report (runbook › iOS privacy manifest).
 */
export const IOS_PRIVACY_MANIFEST = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [] as string[],
  NSPrivacyAccessedAPITypes: [
    { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
    { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1", "3B52.1"] },
    { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime", NSPrivacyAccessedAPITypeReasons: ["35F9.1"] },
    { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace", NSPrivacyAccessedAPITypeReasons: ["E174.1"] },
  ],
  NSPrivacyCollectedDataTypes: [
    collected("Name", true, "AppFunctionality"),
    collected("EmailAddress", true, "AppFunctionality"),
    collected("EmailsOrTextMessages", true, "AppFunctionality"),
    collected("PhotosorVideos", true, "AppFunctionality"),
    collected("AudioData", true, "AppFunctionality"),
    collected("OtherUserContent", true, "AppFunctionality"),
    collected("DeviceID", true, "AppFunctionality"),
    collected("CrashData", true, "AppFunctionality"),
    collected("PerformanceData", true, "AppFunctionality"),
    collected("UserID", true, "AppFunctionality"),
    collected("ProductInteraction", false, "Analytics"),
  ],
};

function appEnv(): AppEnv {
  const value = process.env.UNICHAT_ENV;
  return value === "staging" || value === "production" ? value : "dev";
}

/**
 * A release variant pointing at localhost is a broken store build: fail the build, not the phone.
 * Only on the EAS builder, though: eas-cli first reads this file locally with just the profile env,
 * to find the project id, and loads the EAS environment holding the URLs only after that.
 * A release variant talks to its servers over TLS only (the socket's wss:// is derived from the
 * API's URL, lib/runtime-extra.ts): any other scheme fails wherever the config is read.
 */
function serverUrl(name: "UNICHAT_API_URL" | "UNICHAT_APP_URL", env: AppEnv, devDefault: string): string {
  const value = process.env[name];
  if (value && env !== "dev" && !value.startsWith("https://")) throw new Error(`${name} must be an https:// URL when UNICHAT_ENV=${env}`);
  if (value) return value;
  if (env === "dev") return devDefault;
  if (process.env.EAS_BUILD !== "true") return "";
  throw new Error(`${name} is required when UNICHAT_ENV=${env}`);
}

/** A base64 SHA-256 of a SubjectPublicKeyInfo: 32 bytes, 44 characters with padding. */
const SPKI_PIN = /^[A-Za-z0-9+/]{43}=$/;
/** A bare DNS hostname: no scheme, port, path or wildcard. */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * TLS pinning of UniChat's own servers (plugins/with-tls-pins.js), from the build's environment:
 * UNICHAT_TLS_PINS (comma-separated base64 SPKI SHA-256, at least two: the current CA key and a backup)
 * and UNICHAT_TLS_PIN_EXPIRES (YYYY-MM-DD, after which Android stops enforcing them). The API and web
 * hosts are pinned, plus any UNICHAT_TLS_PIN_HOSTS names (comma-separated hostnames: the LiveKit
 * signalling host, which carries a call's join token; its chain must end in one of the pins). Unset, nothing is
 * pinned. Half a configuration, one pin, a malformed pin or a past date is a broken build, not a phone
 * that cannot reach its server: the config refuses it. Never for dev, whose server is plain http on a LAN.
 */
export function tlsPinning(env: AppEnv, hosts: string[], now: Date = new Date()): { domains: string[]; pins: string[]; expiration: string } | null {
  const pins: string[] = String(process.env.UNICHAT_TLS_PINS ?? "")
    .split(",")
    .map((pin: string) => pin.trim())
    .filter(Boolean);
  const expiration = String(process.env.UNICHAT_TLS_PIN_EXPIRES ?? "").trim();
  const extraHosts: string[] = String(process.env.UNICHAT_TLS_PIN_HOSTS ?? "")
    .split(",")
    .map((host: string) => host.trim())
    .filter(Boolean);
  if (pins.length === 0 && !expiration && extraHosts.length === 0) return null;
  if (env === "dev") throw new Error("UNICHAT_TLS_PINS is for staging and production builds only");
  if (pins.length < 2) throw new Error("UNICHAT_TLS_PINS needs at least two pins: the current CA key and a backup");
  const bad = pins.find((pin: string) => !SPKI_PIN.test(pin));
  if (bad) throw new Error(`UNICHAT_TLS_PINS has a value that is not a base64 SHA-256: ${bad}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration) || Number.isNaN(Date.parse(expiration))) throw new Error("UNICHAT_TLS_PIN_EXPIRES must be a date like 2027-10-01");
  if (Date.parse(expiration) <= now.getTime()) throw new Error("UNICHAT_TLS_PIN_EXPIRES is in the past: Android would not enforce the pins");
  const badHost = extraHosts.find((host: string) => !HOSTNAME.test(host));
  if (badHost) throw new Error(`UNICHAT_TLS_PIN_HOSTS has a value that is not a bare hostname: ${badHost}`);
  const domains: string[] = [...new Set([...hosts, ...extraHosts.map((host: string) => host.toLowerCase())].filter(Boolean))];
  if (domains.length === 0) throw new Error("UNICHAT_TLS_PINS needs UNICHAT_API_URL and UNICHAT_APP_URL to name the hosts to pin");
  return { domains, pins: [...new Set(pins)], expiration };
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

// lib/theme.ts › background: hsl(0 0% 100%) and hsl(0 0% 6.7%).
const SPLASH_BACKGROUND = { light: "#ffffff", dark: "#111111" } as const;

const INTER = [400, 500, 600, 700, 800] as const;
const JAKARTA = [400, 500, 600, 700, 800] as const;
const WEIGHT_NAME: Record<number, string> = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold" };
const fontFile = (pkg: string, file: string, weight: number) => `node_modules/@expo-google-fonts/${pkg}/${weight}${WEIGHT_NAME[weight]}/${file}_${weight}${WEIGHT_NAME[weight]}.ttf`;
const FONT_FAMILIES = [
  { fontFamily: "Inter", fontDefinitions: INTER.map((weight) => ({ path: fontFile("inter", "Inter", weight), weight })) },
  { fontFamily: "Plus Jakarta Sans", fontDefinitions: JAKARTA.map((weight) => ({ path: fontFile("plus-jakarta-sans", "PlusJakartaSans", weight), weight })) },
];
const FONT_FILES = FONT_FAMILIES.flatMap((family) => family.fontDefinitions.map((definition) => definition.path));

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
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
  // Read first: a missing or cleartext server is the first thing a broken release build is told.
  const apiUrl = serverUrl("UNICHAT_API_URL", env, "http://localhost:8080");
  const appUrl = serverUrl("UNICHAT_APP_URL", env, "http://localhost:3000");
  const pinning = tlsPinning(env, [hostOf(apiUrl), hostOf(appUrl)]);
  const easProjectId = (process.env.UNICHAT_EAS_PROJECT_ID ?? EAS_PROJECT_ID) || undefined;
  // Crash reporting stays off without it (data/sentry.ts); a DSN is not a secret, it only routes events.
  const sentryDsn = process.env.SENTRY_DSN?.trim() || undefined;
  // CI's measured builds only (mobile-verify.yml, chat-mobile-verify.yml): the app logs its startup marks for
  // scripts/mobile-perf.mjs. Off in every store build; `extra` is outside the fingerprint, so no new runtime.
  const perfMarks = process.env.UNICHAT_PERF_MARKS === "1";
  // An OTA published as critical (chat-mobile-update.yml › critical): phones apply it on their next trip to the
  // background instead of the next cold start (data/updates-controller.ts). Only that workflow sets it; `extra` is
  // outside the fingerprint, so the update still reaches the binaries it was built for.
  const criticalUpdate = process.env.UNICHAT_CRITICAL_UPDATE === "1";
  const iosCalls = iosCallsBuilt(projectRoot ?? process.cwd());

  return {
    ...config,
    name: isProd ? "UniChat" : isStaging ? "UniChat (Staging)" : "UniChat (Dev)",
    // The EAS project belongs to the organization, not to whoever is signed in to eas-cli.
    owner: "uniai-team",
    slug: "uniwork-chat",
    // The store version. 0.3.1: 0.3.0 shipped (TestFlight build 4, Play internal
    // 11), and the R8 keep rule for WebRTC and the iOS autolinking exclusion
    // change the binary again.
    version: "0.3.1",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    // The server allowlists both redirects for client uniwork-chat-mobile
    // (.env.example › DESKTOP_AUTH_CLIENTS); dev gets its own so a dev build
    // and a store build can live on one phone.
    scheme: env === "dev" ? "uniworkchat-dev" : "uniworkchat",
    // Built by `pnpm brand:build` from packages/ui/brand/svg/unichat-icon*.svg.
    icon: "./assets/icon.png",
    // An update only reaches binaries with the same native fingerprint (native
    // packages, plugins, this config; fingerprint.config.js says what is left
    // out): a native change can no longer ship as an OTA because someone forgot
    // to bump `version` (audit R2).
    runtimeVersion: { policy: "fingerprint" },
    // Downloaded in the background at launch, applied on the next cold start.
    // knip.json ignores expo-updates: knip loads the dev config, where updates are off.
    updates: easProjectId
      ? { url: `https://u.expo.dev/${easProjectId}`, ...codeSigning(projectRoot ?? process.cwd(), env) }
      : { enabled: false },
    ios: {
      supportsTablet: false,
      // Pins DEVELOPMENT_TEAM on every prebuild; unset, `expo run:ios` picks the
      // first signing identity it finds and never revisits the choice.
      appleTeamId: process.env.EXPO_APPLE_TEAM_ID,
      bundleIdentifier: appId,
      associatedDomains: [`applinks:${APP_LINK_HOST}`],
      // Mentions and missed calls arrive "time-sensitive" (server notification/push_expo.go), which iOS lets through
      // Focus only with this capability; EAS turns it on for the App ID when it signs.
      entitlements: { "com.apple.developer.usernotifications.time-sensitive": true },
      // HTTPS, WSS and WebRTC only: exempt encryption, so TestFlight does not hold every build on the export question.
      config: { usesNonExemptEncryption: false },
      // A call keeps its audio when the person switches app or locks the phone, in a build that has calls
      // (iosCallsBuilt); without them the binary declares no background mode a reviewer could not exercise.
      // Vietnamese is the base language (the usage strings below are written in it; `locales.en` translates them).
      infoPlist: { ...(iosCalls ? { UIBackgroundModes: ["audio"] } : {}), CFBundleDevelopmentRegion: "vi" },
      privacyManifests: IOS_PRIVACY_MANIFEST,
    },
    android: {
      package: appId,
      // The WebRTC plugin asks to draw over other apps; a call never does, and Play reviews it. expo-file-system,
      // expo-image and expo-image-picker ask for shared storage (up to API 32): UniChat reads only its own files and
      // what the system pickers hand it, so it asks for none (audit "no-masvs-baseline").
      // expo-screen-capture adds READ_MEDIA_IMAGES for its screenshot listener before Android 14, which UniChat does
      // not use (it only blocks capture): Play reviews READ_MEDIA_IMAGES as a photo permission. Its
      // DETECT_SCREEN_CAPTURE stays: on Android 14+ the module registers its ScreenCaptureCallback when it is created,
      // and without that install-time permission the registration throws while the bundle loads and the app dies at
      // launch (CI's API 35 emulator, 2026-10-23). It is a normal permission: no prompt, nothing for Play to review.
      blockedPermissions: [
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_IMAGES",
      ],
      // No cloud backup of the app's files: unsent attachments sit in plain files under documents/outbox, and a
      // restored session store cannot open on another phone anyway (its Keystore key never leaves this one).
      // plugins/with-android-backup-rules.js closes the Android 12+ device-to-device transfer too.
      allowBackup: false,
      // An EAS file variable (docs/evidence/unichat/release-accounts.md): without
      // Firebase, getExpoPushTokenAsync throws on Android and push never registers.
      ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundImage: "./assets/adaptive-icon-background.png",
        // Android 13+ themed icons (Material You) tint this one-colour layer instead of showing the full-colour icon.
        monochromeImage: "./assets/adaptive-icon-monochrome.png",
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
    // write the Vietnamese ones into Info.plist as the base strings. Under `ios`:
    // top-level keys also land in Android's values-b+en/strings.xml, which has no
    // base string to translate, and lintVitalRelease fails the release build.
    locales: { en: { ios: USAGE_EN } },
    plugins: [
      "expo-router",
      // The splash stays up while a cold start reads the session, the workspace and the cached rooms
      // (app/_layout.tsx › useSplashUntilReady): the mark on the app's background, light and dark.
      [
        "expo-splash-screen",
        {
          image: "./assets/adaptive-icon.png",
          imageWidth: 240,
          resizeMode: "contain",
          backgroundColor: SPLASH_BACKGROUND.light,
          dark: { image: "./assets/adaptive-icon.png", backgroundColor: SPLASH_BACKGROUND.dark },
        },
      ],
      "expo-secure-store",
      // The languages the app speaks: iOS's CFBundleLocalizations and Android 13's
      // locales_config.xml, so each system's per-app language setting offers exactly these. Both are written left to
      // right, and a phone in Arabic or Hebrew reads the app in English: supportsRTL false keeps React Native from
      // mirroring that English layout (I18nManager.allowRTL(false) before the first render; unset, Android allows it).
      // Layout uses logical start/end spacing (eslint.config.mjs › directionSyntax), so a right-to-left language
      // later is this switch plus its translation.
      ["expo-localization", { supportedLocales: ["vi", "en"], supportsRTL: false }],
      "expo-web-browser",
      // Android draws a notification's small icon from its alpha channel only: a one-colour glyph (built by
      // `pnpm brand:build`), tinted with the brand blue. The plugin writes it as the `notification_icon` drawable,
      // which the call notifications look up too (modules/unichat-calls › CallNotifications.smallIcon).
      ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#0044E3" }],
      // R4b (UNI-1916): the canvas types in Inter (body) and Plus Jakarta Sans
      // (titles, names). Embedded natively so `fontFamily` + `fontWeight`
      // resolve on both platforms without a runtime load.
      ["expo-font", { ios: { fonts: FONT_FILES }, android: { fonts: FONT_FAMILIES } }],
      // SDK 57's scene runtime is required for Xcode 27 builds. Android release builds go through R8 and
      // resource shrinking (audit P3 Perf: less dex to load at a cold start, a smaller download): the
      // libraries bring their own keep rules (React Native's @DoNotStrip, LiveKit/WebRTC's consumer-rules,
      // Reanimated's); what is bound by JNI or by name without a working rule is kept here (Nitro, which MMKV
      // runs on, the app's call module, and WebRTC's jni_zero, whose upstream rule names the wrong package).
      // scripts/mobile-apk-scan.mjs checks the minified dex still holds the classes native code looks up; only a
      // device proves the rest: android-smoke boots the minified APK, the nightly signs in, chats and joins a call.
      [
        "expo-build-properties",
        {
          ios: { enableSceneSupport: true },
          android: {
            // Pinned, not inherited from React Native's defaults (audit "target-sdk-implicit-untested"): Play's
            // target-API deadline is checked against this, and android-matrix runs API 36 (phone and tablet).
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            extraProguardRules: ANDROID_KEEP_RULES,
            // A dev build's servers are plain http: a laptop on the LAN, or the PR's hermetic server the emulator
            // reaches through adb reverse (mobile-verify.yml › android-e2e builds a Release APK of this variant).
            // Staging and production keep Android's default (no cleartext) and their fingerprint.
            ...(env === "dev" ? { usesCleartextTraffic: true } : {}),
          },
        },
      ],
      // Every plugin that writes a usage string gets the same one: the last to
      // run wins. A `false` here would also block the Android permission the
      // video call needs.
      [
        "expo-image-picker",
        { photosPermission: USAGE_VI.NSPhotoLibraryUsageDescription, cameraPermission: USAGE_VI.NSCameraUsageDescription, microphonePermission: USAGE_VI.NSMicrophoneUsageDescription },
      ],
      // Voice messages (M3). Background playback and recording are off on
      // purpose (store compliance S2): a voice note stops when the app leaves
      // the screen, so Android gets no mediaPlayback / microphone foreground
      // service from expo-audio and Play has nothing of it to declare. A call
      // keeps its audio through UIBackgroundModes: audio (ios.infoPlist above, iPhone builds with calls only)
      // and the calls' own service, not through expo-audio.
      ["expo-audio", { microphonePermission: USAGE_VI.NSMicrophoneUsageDescription, enableBackgroundPlayback: false, enableBackgroundRecording: false }],
      // App lock (Settings › Privacy & security): Face ID's usage string; Android's biometric permissions are normal ones.
      ["expo-local-authentication", { faceIDPermission: USAGE_VI.NSFaceIDUsageDescription }],
      // Calls (M3): LiveKit's native setup, then WebRTC's permissions.
      "@livekit/react-native-expo-plugin",
      [
        "@config-plugins/react-native-webrtc",
        { cameraPermission: USAGE_VI.NSCameraUsageDescription, microphonePermission: USAGE_VI.NSMicrophoneUsageDescription },
      ],
      // WebRTC's screen-sharing service: UniChat shares no screen (store compliance S2).
      ["./plugins/with-removed-android-services", { services: ["com.oney.WebRTCModule.MediaProjectionService"] }],
      // Android 12+ copies app data to a new phone even with allowBackup off: nothing of UniChat's goes either way.
      "./plugins/with-android-backup-rules",
      // TLS pinning of the API and web hosts, only when the build's environment names the pins (tlsPinning).
      ...(pinning ? [["./plugins/with-tls-pins", pinning] as [string, typeof pinning]] : []),
      // Native calls on Android (docs/adr/drafts/0038, modules/unichat-calls): the
      // ringing screen's full-screen intent, the call's foreground service
      // (phoneCall, microphone, camera), Bluetooth audio and the Decline / Hang up actions.
      ["./plugins/with-unichat-calls", { iosCalls }],
      // Crash reporting: uploads source maps and native symbols from the EAS
      // build. Organization, project and token come from the build's
      // environment (SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN), never from
      // here, so the fingerprint does not change with them; eas.json sets
      // SENTRY_ALLOW_FAILURE so a build without them still succeeds.
      ["@sentry/react-native/expo", { url: "https://sentry.io/" }],
    ],
    extra: {
      APP_ENV: env,
      apiUrl,
      appUrl,
      authClientId: "uniwork-chat-mobile",
      deploymentId: "default",
      // Absent without an EAS project: data/push.ts then skips registration.
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
      // Absent without SENTRY_DSN: data/sentry.ts then starts nothing.
      ...(sentryDsn ? { sentryDsn } : {}),
      ...(perfMarks ? { perfMarks: true } : {}),
      ...(criticalUpdate ? { criticalUpdate: true } : {}),
      // Read at boot (lib/runtime-extra.ts › lackingFlags): an iPhone binary without it keeps calling off.
      ...(iosCalls ? { iosCalls: true } : {}),
    },
  };
};
