// Ported from usf apps/mobile/app.config.test.ts, re-cut for the UniChat
// variants: identity, scheme, links and `extra` per UNICHAT_ENV.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigContext } from "expo/config";
import createConfig, { ANDROID_KEEP_RULES } from "./app.config";

const build = (projectRoot?: string) => createConfig({ config: {}, projectRoot } as ConfigContext);

// A release variant refuses to build without its servers, so every case that
// is not about that names them.
const stubServers = () => {
  vi.stubEnv("UNICHAT_API_URL", "https://api.example");
  vi.stubEnv("UNICHAT_APP_URL", "https://app.example");
};

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
    vi.stubEnv("UNICHAT_EAS_PROJECT_ID", "");
    stubServers();

    const config = build();
    expect(config.name).toBe(name);
    expect(config.slug).toBe("uniwork-chat");
    // no EAS project: no update server to ask, the embedded bundle is the app
    expect(config.updates).toEqual({ enabled: false });
    // an update reaches only binaries with the same native fingerprint (OTA never crosses a native change)
    expect(config.runtimeVersion).toEqual({ policy: "fingerprint" });
    expect(config.version).toBe("0.3.0");
    // knip's expo plugin and NativeWind both read it; "automatic" follows the OS.
    expect(config.userInterfaceStyle).toBe("automatic");
    // no EAS account yet: push registration is skipped until the id exists
    expect(config.extra?.eas).toBeUndefined();
    expect(config.scheme).toBe(scheme);
    expect(config.ios).toMatchObject({
      bundleIdentifier: appId,
      associatedDomains: ["applinks:app.uniworkos.com"],
      config: { usesNonExemptEncryption: false },
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
        // The splash is held until the first screen knows where it goes (audit P0-3).
        [
          "expo-splash-screen",
          expect.objectContaining({ image: "./assets/adaptive-icon.png", backgroundColor: "#ffffff", dark: expect.objectContaining({ backgroundColor: "#111111" }) }),
        ],
        "expo-secure-store",
        "expo-notifications",
        [
          "expo-build-properties",
          {
            ios: { enableSceneSupport: true },
            android: { enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true, extraProguardRules: ANDROID_KEEP_RULES },
          },
        ],
        "@livekit/react-native-expo-plugin",
        // org, project and token stay in the build env: they must not move the fingerprint
        ["@sentry/react-native/expo", { url: "https://sentry.io/" }],
      ]),
    );
  });

  // Audit P2 i18n: the system knows UniChat speaks Vietnamese and English (the
  // per-app language picker of iOS and Android 13+), and Vietnamese is the base.
  it("declares Vietnamese and English to the OS, with Vietnamese as the development region", () => {
    const config = build();
    expect(config.plugins).toContainEqual(["expo-localization", { supportedLocales: ["vi", "en"] }]);
    expect(config.ios?.infoPlist?.CFBundleDevelopmentRegion).toBe("vi");
  });

  // M3: calls and voice messages use the camera and the microphone. A plugin
  // given `false` would remove the Android permission and the iOS prompt the
  // call needs, so every plugin that writes one carries the same string.
  it("asks for the camera and the microphone in Vietnamese and English and keeps call audio in the background", () => {
    const config = build();
    const options = (name: string) =>
      (config.plugins ?? []).find((p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === name)?.[1];
    const camera = "UniChat dùng camera khi bạn gọi video.";
    const microphone = "UniChat dùng micro khi bạn gọi điện và ghi tin thoại.";
    expect(options("@config-plugins/react-native-webrtc")).toEqual({ cameraPermission: camera, microphonePermission: microphone });
    expect(options("expo-image-picker")).toMatchObject({ photosPermission: expect.any(String), cameraPermission: camera, microphonePermission: microphone });
    // Background playback and recording off explicitly (store compliance S2): no
    // mediaPlayback or microphone foreground service from expo-audio to declare.
    expect(options("expo-audio")).toEqual({ microphonePermission: microphone, enableBackgroundPlayback: false, enableBackgroundRecording: false });
    expect(options("./plugins/with-removed-android-services")).toEqual({ services: ["com.oney.WebRTCModule.MediaProjectionService"] });
    expect(config.locales?.en).toEqual({ ios: expect.any(Object) });
    expect((config.locales?.en as { ios: Record<string, string> }).ios).toMatchObject({
      NSCameraUsageDescription: expect.stringContaining("camera"),
      NSMicrophoneUsageDescription: expect.stringContaining("microphone"),
      NSPhotoLibraryUsageDescription: expect.any(String),
    });
    expect(config.ios?.infoPlist?.UIBackgroundModes).toEqual(["audio"]);
  });

  // Audit (Security & privacy, no-masvs-baseline): unsent attachments sit in plain files under documents/outbox, and the
  // legacy storage permissions are for apps that read shared storage, which UniChat never does (the system pickers
  // hand it the files it needs).
  it("keeps the app's data out of Android backups and device transfers, and asks for no shared storage", () => {
    const config = build();
    expect(config.android?.allowBackup).toBe(false);
    expect(config.plugins).toContain("./plugins/with-android-backup-rules");
    expect(config.android?.blockedPermissions).toEqual([
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ]);
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
    stubServers();
    vi.stubEnv("EXPO_BUNDLE_IDENTIFIER_DEV", "com.example.chat.dev");
    vi.stubEnv("EXPO_BUNDLE_IDENTIFIER_STAGING", "com.example.chat.staging");
    vi.stubEnv("EXPO_BUNDLE_IDENTIFIER_PROD", "com.example.chat");
    vi.stubEnv("EXPO_APPLE_TEAM_ID", "ABCDE12345");

    const config = build();
    expect(config.ios).toMatchObject({ bundleIdentifier: appId, appleTeamId: "ABCDE12345" });
    expect(config.android?.package).toBe(appId);
  });
});

describe("EAS project and release servers", () => {
  it.each(["dev", "staging", "production"])("%s: the EAS project id turns on updates and push", (env) => {
    vi.stubEnv("UNICHAT_ENV", env);
    vi.stubEnv("UNICHAT_EAS_PROJECT_ID", "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e");
    stubServers();

    const config = build();
    expect(config.updates).toEqual({ url: "https://u.expo.dev/0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e" });
    expect(config.runtimeVersion).toEqual({ policy: "fingerprint" });
    expect(config.extra?.eas).toEqual({ projectId: "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e" });
  });

  // Owner action: generate the certificate (runbook › Ký OTA). Until the file
  // exists a dev or staging binary's updates are unsigned; from the first binary
  // that embeds it, the phone accepts only updates signed with its key.
  it("signs updates once the code-signing certificate is committed, and not before", () => {
    vi.stubEnv("UNICHAT_EAS_PROJECT_ID", "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unichat-config-"));
    try {
      expect(build(root).updates).not.toHaveProperty("codeSigningCertificate");
      fs.mkdirSync(path.join(root, "certs"));
      fs.writeFileSync(path.join(root, "certs/eas-update-certificate.pem"), "-----BEGIN CERTIFICATE-----\n");
      expect(build(root).updates).toEqual({
        url: "https://u.expo.dev/0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e",
        codeSigningCertificate: "./certs/eas-update-certificate.pem",
        codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // Audit (Security & privacy, ota-unsigned, P1): the first production binary went out accepting unsigned bundles, so
  // whoever held the Expo account or EXPO_TOKEN could ship JavaScript that reads the Keychain session. A store binary
  // without the certificate can never be fixed by an update: the build itself refuses.
  it("refuses a production store build that would accept unsigned updates", () => {
    vi.stubEnv("UNICHAT_ENV", "production");
    vi.stubEnv("UNICHAT_EAS_PROJECT_ID", "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e");
    stubServers();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unichat-config-"));
    try {
      vi.stubEnv("EAS_BUILD", "true");
      expect(() => build(root)).toThrow("certs/eas-update-certificate.pem");
      // eas-cli's first local read (to find the project id), and a staging build, still go through.
      vi.stubEnv("EAS_BUILD", undefined);
      expect(build(root).updates).toEqual({ url: "https://u.expo.dev/0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e" });
      vi.stubEnv("EAS_BUILD", "true");
      vi.stubEnv("UNICHAT_ENV", "staging");
      expect(build(root).updates).not.toHaveProperty("codeSigningCertificate");
      // Without an EAS project there is no update server to trust.
      vi.stubEnv("UNICHAT_ENV", "production");
      vi.stubEnv("UNICHAT_EAS_PROJECT_ID", "");
      expect(build(root).updates).toEqual({ enabled: false });
      vi.stubEnv("UNICHAT_EAS_PROJECT_ID", "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e");
      fs.mkdirSync(path.join(root, "certs"));
      fs.writeFileSync(path.join(root, "certs/eas-update-certificate.pem"), "-----BEGIN CERTIFICATE-----\n");
      expect(build(root).updates).toMatchObject({ codeSigningCertificate: "./certs/eas-update-certificate.pem" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // Audit (Security & privacy, https-not-asserted): a release build talks to its servers over TLS only, and the socket
  // URL derived from the API's is wss:// then (lib/runtime-extra.ts).
  it.each([
    ["staging", "UNICHAT_API_URL", "http://api.example"],
    ["production", "UNICHAT_APP_URL", "http://app.example"],
    ["production", "UNICHAT_API_URL", "ftp://api.example"],
  ])("%s refuses %s that is not https (%s), on the builder or not", (env, name, value) => {
    vi.stubEnv("UNICHAT_ENV", env);
    stubServers();
    vi.stubEnv(name, value);
    vi.stubEnv("EAS_BUILD", undefined);
    expect(build).toThrow(`${name} must be an https:// URL`);
    vi.stubEnv("EAS_BUILD", "true");
    expect(build).toThrow(`${name} must be an https:// URL`);
  });

  it("carries the Sentry DSN of the build environment, and nothing without one", () => {
    vi.stubEnv("SENTRY_DSN", " https://k@o1.ingest.sentry.io/1 ");
    expect(build().extra?.sentryDsn).toBe("https://k@o1.ingest.sentry.io/1");
    vi.stubEnv("SENTRY_DSN", "");
    expect(build().extra).not.toHaveProperty("sentryDsn");
    vi.stubEnv("SENTRY_DSN", undefined);
    expect(build().extra).not.toHaveProperty("sentryDsn");
  });

  it("asks for startup marks only in a build CI measures (UNICHAT_PERF_MARKS=1)", () => {
    vi.stubEnv("UNICHAT_PERF_MARKS", "1");
    expect(build().extra?.perfMarks).toBe(true);
    vi.stubEnv("UNICHAT_PERF_MARKS", "true");
    expect(build().extra).not.toHaveProperty("perfMarks");
    vi.stubEnv("UNICHAT_PERF_MARKS", undefined);
    expect(build().extra).not.toHaveProperty("perfMarks");
  });

  it("hands the Firebase file of the EAS environment to Android, which needs it for an Expo push token", () => {
    vi.stubEnv("GOOGLE_SERVICES_JSON", "/eas/tmp/google-services.json");
    expect(build().android?.googleServicesFile).toBe("/eas/tmp/google-services.json");
    vi.stubEnv("GOOGLE_SERVICES_JSON", undefined);
    expect(build().android).not.toHaveProperty("googleServicesFile");
  });

  it("an empty override turns EAS off", () => {
    vi.stubEnv("UNICHAT_EAS_PROJECT_ID", "");
    const config = build();
    expect(config.updates).toEqual({ enabled: false });
    expect(config.extra?.eas).toBeUndefined();
  });

  it.each([
    ["staging", "UNICHAT_API_URL"],
    ["staging", "UNICHAT_APP_URL"],
    ["production", "UNICHAT_API_URL"],
    ["production", "UNICHAT_APP_URL"],
  ])("%s refuses to build without %s instead of shipping localhost", (env, missing) => {
    vi.stubEnv("UNICHAT_ENV", env);
    vi.stubEnv("EAS_BUILD", "true");
    stubServers();
    vi.stubEnv(missing, undefined);
    expect(build).toThrow(missing);
  });

  // eas-cli reads the config once with only the profile env, to find the
  // project id, before it loads the EAS environment that holds the URLs.
  it("lets eas-cli read a release variant without its servers off the EAS builder", () => {
    vi.stubEnv("UNICHAT_ENV", "production");
    vi.stubEnv("EAS_BUILD", undefined);
    vi.stubEnv("UNICHAT_API_URL", undefined);
    vi.stubEnv("UNICHAT_APP_URL", undefined);
    expect(build().extra).toMatchObject({ apiUrl: "", appUrl: "", eas: { projectId: expect.any(String) } });
  });
});

describe("fingerprint.config.js", () => {
  // extra (URLs, DSN, project id) is read by JavaScript from the update's own
  // manifest; hashing it would make an update published without one value
  // match no phone. The default skip (package.json scripts) stays beside it.
  it("leaves `extra` out of the runtime fingerprint and keeps the default skip", async () => {
    const { SourceSkips } = await import("expo/fingerprint");
    const { default: fingerprint } = (await import("./fingerprint.config.js")) as { default: { sourceSkips: number } };
    expect(fingerprint.sourceSkips & SourceSkips.ExpoConfigExtraSection).toBe(SourceSkips.ExpoConfigExtraSection);
    expect(fingerprint.sourceSkips & SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun).not.toBe(0);
    expect(fingerprint.sourceSkips & SourceSkips.ExpoConfigVersions).toBe(0);
  });
});
