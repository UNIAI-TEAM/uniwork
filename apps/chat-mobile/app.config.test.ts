// Ported from usf apps/mobile/app.config.test.ts, re-cut for the UniChat
// variants: identity, scheme, links and `extra` per UNICHAT_ENV.
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigContext } from "expo/config";
import { createRequire } from "node:module";
import createConfig, { ANDROID_KEEP_RULES, googleSignInClients, iosCallsBuilt, tlsPinning, type TlsPins } from "./app.config";

const build = (projectRoot?: string) => createConfig({ config: {}, projectRoot } as ConfigContext);

// A release variant refuses to build without its servers, so every case that
// is not about that names them.
const stubServers = () => {
  vi.stubEnv("UNICHAT_API_URL", "https://api.example");
  vi.stubEnv("UNICHAT_APP_URL", "https://app.example");
};
// On the EAS builder a release variant's servers must be hosts tls-pins.json pins.
const stubPinnedServers = () => {
  vi.stubEnv("UNICHAT_API_URL", "https://uniworkos.com");
  vi.stubEnv("UNICHAT_APP_URL", "https://uniworkos.com");
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
    expect(config.version).toBe("0.4.0");
    // One version everywhere (audit "store-assets-and-calibration-incomplete"): package.json said 0.1.0 for months.
    expect(JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version).toBe(config.version);
    // knip's expo plugin and NativeWind both read it; "automatic" follows the OS.
    expect(config.userInterfaceStyle).toBe("automatic");
    // no EAS account yet: push registration is skipped until the id exists
    expect(config.extra?.eas).toBeUndefined();
    expect(config.scheme).toBe(scheme);
    expect(config.ios).toMatchObject({
      bundleIdentifier: appId,
      // Password AutoFill offers the web's saved passwords in the app's sign-in (spec §5.1).
      associatedDomains: ["applinks:app.uniworkos.com", "webcredentials:app.uniworkos.com"],
      config: { usesNonExemptEncryption: false },
      // Mentions and missed calls break through Focus (server push_expo.go › timeSensitiveChannels).
      entitlements: { "com.apple.developer.usernotifications.time-sensitive": true },
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
        // Sign in with Apple's entitlement (com.apple.developer.applesignin) on the iOS binary (ADR 0041).
        "expo-apple-authentication",
        // A one-colour status-bar glyph with the brand's accent; the call notifications use the same drawable.
        ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#0044E3" }],
        [
          "expo-build-properties",
          {
            ios: { enableSceneSupport: true },
            android: {
              // Pinned: Play's target-API requirement reads it; the CI matrix runs this API (chat-mobile-verify.yml).
              compileSdkVersion: 36,
              targetSdkVersion: 36,
              enableMinifyInReleaseBuilds: true,
              enableShrinkResourcesInReleaseBuilds: true,
              extraProguardRules: ANDROID_KEEP_RULES,
              // Only a dev build talks to plain http (a laptop on the LAN, the PR's hermetic server through adb reverse).
              ...(env === "staging" || env === "production" ? {} : { usesCleartextTraffic: true }),
            },
          },
        ],
        "@livekit/react-native-expo-plugin",
        // The outbox's scheduled drain on iOS: its BGTask identifier and the processing mode.
        "expo-background-task",
        // org, project and token stay in the build env: they must not move the fingerprint
        ["@sentry/react-native/expo", { url: "https://sentry.io/" }],
      ]),
    );
  });

  // Audit "android-notification-icon": Android draws a notification's small icon and the themed (Material You)
  // launcher icon from the alpha channel only; the full-colour icon turns into a blank tile there.
  it("gives Android a one-colour notification glyph and a monochrome launcher layer", () => {
    const config = build();
    expect(config.android?.adaptiveIcon).toEqual({
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundImage: "./assets/adaptive-icon-background.png",
      monochromeImage: "./assets/adaptive-icon-monochrome.png",
    });
    for (const file of ["assets/notification-icon.png", "assets/adaptive-icon-monochrome.png"]) {
      expect(fs.existsSync(path.join(__dirname, file)), file).toBe(true);
    }
  });

  // Audit P2 i18n: the system knows UniChat speaks Vietnamese and English (the
  // per-app language picker of iOS and Android 13+), and Vietnamese is the base.
  it("declares Vietnamese and English to the OS, with Vietnamese as the development region", () => {
    const config = build();
    expect(config.plugins).toContainEqual(["expo-localization", { supportedLocales: ["vi", "en"], supportsRTL: false }]);
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
      NSFaceIDUsageDescription: expect.stringContaining("Face ID"),
    });
    expect(options("expo-local-authentication")).toEqual({ faceIDPermission: "UniChat dùng Face ID để mở khoá ứng dụng khi bạn bật Khoá UniChat." });
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
      // expo-screen-capture's screenshot listener before Android 14, which UniChat does not use.
      "android.permission.READ_MEDIA_IMAGES",
      // installreferrer, through expo-application: UniChat never asks how it was installed.
      "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
    ]);
    // Blocking it killed the app at launch on Android 14+: the module registers its capture callback when created.
    expect(config.android?.blockedPermissions).not.toContain("android.permission.DETECT_SCREEN_CAPTURE");
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

// The dev variant may talk plain http (a laptop on the LAN; the PR's hermetic server, mobile-verify.yml › android-e2e).
// That changes the binary's network posture, so it must never be what a tester or a store gets: every EAS profile but
// the development client resolves to staging or production, and those builds keep Android's no-cleartext default.
describe("plain http is a dev build's only", () => {
  type Profile = { extends?: string; env?: Record<string, string>; developmentClient?: boolean };
  const profiles = (JSON.parse(fs.readFileSync(path.join(__dirname, "eas.json"), "utf8")) as { build: Record<string, Profile> }).build;
  const envOf = (name: string): Record<string, string> => {
    const profile = profiles[name] ?? {};
    return { ...(profile.extends ? envOf(profile.extends) : {}), ...profile.env };
  };
  const cleartextOf = () => {
    const plugin = build().plugins?.find((p) => Array.isArray(p) && p[0] === "expo-build-properties") as [string, { android: Record<string, unknown> }];
    return plugin[1].android.usesCleartextTraffic;
  };

  it.each(Object.keys(profiles).filter((name) => name !== "base"))("EAS profile %s", (name) => {
    const env = envOf(name).UNICHAT_ENV;
    if (profiles[name]?.developmentClient) {
      expect(env).toBe("dev");
      return;
    }
    expect(["staging", "production"]).toContain(env);
    vi.stubEnv("UNICHAT_ENV", env);
    stubServers();
    expect(cleartextOf()).toBeUndefined();
  });

  it("is allowed for the dev variant", () => {
    vi.stubEnv("UNICHAT_ENV", "dev");
    expect(cleartextOf()).toBe(true);
  });
});

describe("EAS project and release servers", () => {
  it.each(["dev", "staging", "production"])("%s: the EAS project id turns on updates and push", (env) => {
    vi.stubEnv("UNICHAT_ENV", env);
    vi.stubEnv("UNICHAT_EAS_PROJECT_ID", "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e");
    stubServers();

    // The app's own root: its committed certificate signs every variant's updates.
    const config = build();
    expect(config.updates).toEqual({
      url: "https://u.expo.dev/0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e",
      codeSigningCertificate: "./certs/eas-update-certificate.pem",
      codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
    });
    expect(config.runtimeVersion).toEqual({ policy: "fingerprint" });
    expect(config.extra?.eas).toEqual({ projectId: "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e" });
  });

  // The rule on a bare project root: without the file a dev binary's updates are unsigned; from the first
  // binary that embeds it, the phone accepts only updates signed with its key.
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
    stubPinnedServers();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unichat-config-"));
    fs.copyFileSync(path.join(__dirname, "tls-pins.json"), path.join(root, "tls-pins.json"));
    try {
      vi.stubEnv("EAS_BUILD", "true");
      expect(() => build(root)).toThrow("certs/eas-update-certificate.pem is required for a production build");
      // The staging binaries reach people too (Play internal, the pilot APK): the same refusal.
      vi.stubEnv("UNICHAT_ENV", "staging");
      expect(() => build(root)).toThrow("certs/eas-update-certificate.pem is required for a staging build");
      // eas-cli's first local read (to find the project id), and a dev client build, still go through.
      vi.stubEnv("EAS_BUILD", undefined);
      vi.stubEnv("UNICHAT_ENV", "production");
      expect(build(root).updates).toEqual({ url: "https://u.expo.dev/0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e" });
      vi.stubEnv("EAS_BUILD", "true");
      vi.stubEnv("UNICHAT_ENV", "dev");
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

  // Audit (Release, ota-unsigned-first-binary, P1): the certificate is in the repo, so every store binary from here on
  // is signed. It must stay a real code-signing certificate with years left: one that expires (or is swapped for a
  // stub) turns every later update into one the phones refuse, and rotating it is a native change (a store build).
  it("carries a real EAS Update code-signing certificate, and every release build embeds it", () => {
    const cert = new X509Certificate(fs.readFileSync(path.join(import.meta.dirname, "certs/eas-update-certificate.pem")));
    expect(cert.subject).toBe("CN=UniChat");
    expect(cert.keyUsage).toContain("1.3.6.1.5.5.7.3.3");
    expect(cert.publicKey.asymmetricKeyType).toBe("rsa");
    expect(cert.publicKey.asymmetricKeyDetails?.modulusLength).toBeGreaterThanOrEqual(2048);
    const twoYears = Date.now() + 2 * 365 * 24 * 60 * 60 * 1000;
    expect(Date.parse(cert.validTo), "rotate the certificate (runbook › Ký OTA) with a store build before it runs out").toBeGreaterThan(twoYears);
    expect(cert.verify(cert.publicKey), "self-signed by its own key, as expo-updates generates it").toBe(true);
    vi.stubEnv("UNICHAT_EAS_PROJECT_ID", "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e");
    vi.stubEnv("EAS_BUILD", "true");
    stubPinnedServers();
    for (const env of ["staging", "production"]) {
      vi.stubEnv("UNICHAT_ENV", env);
      expect(build(import.meta.dirname).updates).toMatchObject({ codeSigningCertificate: "./certs/eas-update-certificate.pem", codeSigningMetadata: { keyid: "main" } });
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

  // Audit "ota-apply-latency": the OTA workflow's critical input reaches the update's manifest (data/updates-controller.ts),
  // inside `extra`, which the fingerprint leaves out: marking an update critical does not move it to another runtime.
  it("marks an update critical only when the OTA workflow says so (UNICHAT_CRITICAL_UPDATE=1)", () => {
    vi.stubEnv("UNICHAT_CRITICAL_UPDATE", "1");
    expect(build().extra?.criticalUpdate).toBe(true);
    vi.stubEnv("UNICHAT_CRITICAL_UPDATE", "true");
    expect(build().extra).not.toHaveProperty("criticalUpdate");
    vi.stubEnv("UNICHAT_CRITICAL_UPDATE", undefined);
    expect(build().extra).not.toHaveProperty("criticalUpdate");
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

// ADR 0049 §8: the app opens Google's own sheet only with the client ids a build is given; without them it writes
// nothing and the app signs in with Google through the browser.
describe("Sign in with Google's clients", () => {
  const IOS = "1234567890-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";
  const WEB = "1234567890-zyxwvutsrqponmlkjihgfedcba543210.apps.googleusercontent.com";
  const plugin = createRequire(__filename)("./plugins/with-google-sign-in.js") as {
    iosInfoPlist: (plist: Record<string, unknown>, o: { iosClientId?: string; webClientId?: string }) => Record<string, unknown>;
    podfile: (contents: string) => string;
    reversedClientId: (id: string) => string;
    SERVER_CLIENT_ID: string;
  };
  const googlePlugin = (config: ReturnType<typeof build>) =>
    (config.plugins ?? []).find((p): p is [string, Record<string, string>] => Array.isArray(p) && p[0] === "./plugins/with-google-sign-in")?.[1];
  const stubClients = (ios: string | undefined, web: string | undefined) => {
    vi.stubEnv("UNICHAT_GOOGLE_IOS_CLIENT_ID", ios);
    vi.stubEnv("UNICHAT_GOOGLE_WEB_CLIENT_ID", web);
  };

  it("runs on every build, with no client when none is set, and passes the ones set, trimmed", () => {
    stubClients(undefined, "  ");
    expect(googleSignInClients()).toBeNull();
    expect(googlePlugin(build())).toEqual({});
    stubClients(` ${IOS} `, WEB);
    expect(googlePlugin(build())).toEqual({ iosClientId: IOS, webClientId: WEB });
    stubClients(undefined, WEB);
    expect(googlePlugin(build())).toEqual({ webClientId: WEB });
    stubClients(IOS, undefined);
    expect(googleSignInClients()).toEqual({ iosClientId: IOS });
  });

  it("gives iOS the two clients and registers the reversed iOS client as a URL scheme, once", () => {
    const scheme = "com.googleusercontent.apps.1234567890-abcdefghijklmnopqrstuvwxyz012345";
    expect(plugin.reversedClientId(IOS)).toBe(scheme);
    const plist = plugin.iosInfoPlist({ CFBundleURLTypes: [{ CFBundleURLSchemes: ["uniworkchat"] }] }, { iosClientId: IOS, webClientId: WEB });
    expect(plist).toMatchObject({ GIDClientID: IOS, GIDServerClientID: WEB });
    const schemes = (p: Record<string, unknown>) => (p.CFBundleURLTypes as { CFBundleURLSchemes: string[] }[]).flatMap((t) => t.CFBundleURLSchemes);
    expect(schemes(plist)).toEqual(["uniworkchat", scheme]);
    expect(schemes(plugin.iosInfoPlist(plist, { iosClientId: IOS }))).toEqual(["uniworkchat", scheme]);
    expect(plugin.iosInfoPlist({ a: 1 }, { webClientId: WEB })).toEqual({ a: 1 });
  });

  it("gives AppCheckCore's dependencies module maps once, after use_expo_modules!, client or not", () => {
    const template = ["target 'UniChat' do", "  use_expo_modules!", "", "  config = use_native_modules!(config_command)", "end", ""].join("\n");
    const podfile = plugin.podfile(template);
    expect(podfile.split("\n").slice(1, 6)).toEqual([
      "  use_expo_modules!",
      "  # plugins/with-google-sign-in.js: module maps for AppCheckCore's dependencies (GoogleSignIn)",
      "  pod 'GoogleUtilities/Environment', :modular_headers => true",
      "  pod 'GoogleUtilities/UserDefaults', :modular_headers => true",
      "  pod 'RecaptchaInterop', :modular_headers => true",
    ]);
    expect(podfile.split("\n").slice(6)).toEqual(template.split("\n").slice(2));
    expect(plugin.podfile(podfile)).toBe(podfile);
    expect(() => plugin.podfile("target 'UniChat' do\nend\n")).toThrow(/use_expo_modules!/);
    const podspec = fs.readFileSync(path.join(__dirname, "modules/unichat-google-sign-in/ios/UniChatGoogleSignIn.podspec"), "utf8");
    expect(podspec).toContain("s.dependency 'GoogleSignIn', '~> 9.0'");
  });

  it("names the meta-data the Android module reads", () => {
    const kotlin = fs.readFileSync(
      path.join(__dirname, "modules/unichat-google-sign-in/android/src/main/java/expo/modules/unichatgooglesignin/UniChatGoogleSignInModule.kt"),
      "utf8",
    );
    expect(kotlin).toContain(`const val SERVER_CLIENT_ID = "${plugin.SERVER_CLIENT_ID}"`);
  });

  it("refuses a value that is not a Google client id", () => {
    const withGoogle = createRequire(__filename)("./plugins/with-google-sign-in.js") as (config: object, o: object) => object;
    expect(() => withGoogle({}, { iosClientId: "my-ios-client" })).toThrow(/UNICHAT_GOOGLE_IOS_CLIENT_ID/);
    expect(() => withGoogle({}, { webClientId: "https://accounts.google.com" })).toThrow(/UNICHAT_GOOGLE_WEB_CLIENT_ID/);
  });
});

// Audit (Security & privacy, no-pinning-or-attestation): every staging and production build pins the CA keys committed in
// tls-pins.json, and refuses any half of it that would leave phones unable to reach their server.
describe("TLS pinning", () => {
  const PIN_A = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
  const PIN_B = "YLh1dUR9y6Kja30RrAn7JKnbQG/uEtLMkBgFF2Fuihg=";
  const plugin = createRequire(__filename)("./plugins/with-tls-pins.js") as {
    networkSecurityConfig: (o: { domains: string[]; pins: string[]; expiration: string }) => string;
    pinnedDomains: (o: { domains: string[]; pins: string[] }) => Record<string, unknown>;
    CONFIG_NAME: string;
  };
  const pinsPlugin = (config: ReturnType<typeof build>) =>
    (config.plugins ?? []).find((p): p is [string, { domains: string[]; pins: string[]; expiration: string }] => Array.isArray(p) && p[0] === "./plugins/with-tls-pins")?.[1];
  const committed = JSON.parse(fs.readFileSync(path.join(__dirname, "tls-pins.json"), "utf8")) as TlsPins;
  const file = (over: Partial<TlsPins> = {}): TlsPins => ({
    expires: "2099-01-01",
    pins: [
      { sha256: PIN_A, ca: "Root A", operator: "CA One", certificate: "a.pem" },
      { sha256: PIN_B, ca: "Root B", operator: "CA Two", certificate: "b.pem" },
    ],
    hosts: { staging: ["staging.example"], production: ["api.example", "livekit.example:7880"] },
    ...over,
  });
  const NOW = new Date("2026-10-23T00:00:00Z");

  it("pins every staging and production build with the committed file, and never a dev build", () => {
    vi.stubEnv("UNICHAT_ENV", "dev");
    expect(pinsPlugin(build())).toBeUndefined();
    for (const env of ["staging", "production"] as const) {
      vi.stubEnv("UNICHAT_ENV", env);
      stubServers();
      expect(pinsPlugin(build())).toEqual({
        domains: committed.hosts[env]!.map((host) => host.replace(/:\d+$/, "")),
        pins: committed.pins.map((pin) => pin.sha256),
        expiration: committed.expires,
      });
    }
  });

  // The fingerprint is the native runtime OTAs are matched to: the pins come from the committed file only, never
  // from a URL of the build's environment, so the OTA workflow and the EAS builder compute the same one.
  it("takes the pinned hosts from the file, not from the servers' URLs", () => {
    vi.stubEnv("UNICHAT_ENV", "production");
    vi.stubEnv("UNICHAT_API_URL", "https://elsewhere.example");
    vi.stubEnv("UNICHAT_APP_URL", "https://elsewhere.example");
    expect(pinsPlugin(build())?.domains).toEqual(committed.hosts.production!.map((host) => host.replace(/:\d+$/, "")));
  });

  it("strips the port, lowercases and de-duplicates the hosts, and keeps the pins in order", () => {
    const pinning = tlsPinning("production", [], file({ hosts: { production: ["API.example", "livekit.example:7880", "api.example:443"] } }), NOW, false);
    expect(pinning).toEqual({ domains: ["api.example", "livekit.example"], pins: [PIN_A, PIN_B], expiration: "2099-01-01" });
    expect(tlsPinning("dev", [], file(), NOW, false)).toBeNull();
  });

  it.each([
    ["one pin, no backup", file({ pins: file().pins.slice(0, 1) }), "at least two pins"],
    ["a value that is not a SHA-256", file({ pins: [...file().pins, { sha256: "not-a-pin", ca: "X", operator: "CA Three", certificate: "x.pem" }] }), "not a base64 SHA-256"],
    ["every pin from one CA operator", file({ pins: file().pins.map((pin) => ({ ...pin, operator: "CA One" })) }), "two CA operators"],
    ["no expiry", file({ expires: "" }), "must be a date"],
    ["an expiry that is no date", file({ expires: "2099-13-45" }), "must be a date"],
    ["no host for the variant", file({ hosts: { staging: ["staging.example"] } }), "no hosts for production"],
    ["a host with a scheme", file({ hosts: { production: ["wss://livekit.example"] } }), "not a hostname"],
    ["a wildcard host", file({ hosts: { production: ["*.example"] } }), "not a hostname"],
    ["a host with a bad port", file({ hosts: { production: ["api.example:99999"] } }), "not a hostname"],
  ])("refuses %s, wherever the config is read", (_label, pins, message) => {
    expect(() => tlsPinning("production", [], pins, NOW, false)).toThrow(message);
  });

  // An expired pin-set or an unpinned server is a broken store binary, refused on the EAS builder; everywhere else
  // (CI's placeholder builds, the OTA workflow's fingerprint, these tests) the config still reads, and the scheduled
  // check (scripts/mobile-tls-pins.mjs) is what turns red.
  it("refuses, on the EAS builder only, an expired pin-set and a server host the file does not pin", () => {
    const expired = file({ expires: "2026-10-01" });
    expect(() => tlsPinning("production", [], expired, NOW, true)).toThrow("in the past");
    expect(tlsPinning("production", [], expired, NOW, false)?.expiration).toBe("2026-10-01");
    expect(() => tlsPinning("production", ["api.example", "app.example"], file(), NOW, true)).toThrow("app.example is not pinned");
    expect(() => tlsPinning("staging", ["API.example"], file(), NOW, true)).toThrow("hosts.staging");
    expect(tlsPinning("production", ["API.example", "", "livekit.example"], file(), NOW, true)?.domains).toEqual(["api.example", "livekit.example"]);
    expect(tlsPinning("production", ["app.example"], file(), NOW, false)?.domains).toEqual(["api.example", "livekit.example"]);
  });

  it("writes an Android pin-set with its expiry and refuses cleartext, and iOS pinned CA identities", () => {
    const options = { domains: ["api.uniworkos.com"], pins: [PIN_A, PIN_B], expiration: "2099-01-01" };
    const xml = plugin.networkSecurityConfig(options);
    expect(plugin.CONFIG_NAME).toBe("unichat_network_security_config");
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(xml).toContain('<domain includeSubdomains="false">api.uniworkos.com</domain>');
    expect(xml).toContain('<pin-set expiration="2099-01-01">');
    expect([...xml.matchAll(/<pin digest="SHA-256">([^<]+)<\/pin>/g)].map((m) => m[1])).toEqual([PIN_A, PIN_B]);
    expect(plugin.networkSecurityConfig({ ...options, domains: ['a"<b>&'] })).toContain("a&quot;&lt;b&gt;&amp;");
    expect(plugin.pinnedDomains(options)).toEqual({
      "api.uniworkos.com": { NSIncludesSubdomains: false, NSPinnedCAIdentities: [{ "SPKI-SHA256-BASE64": PIN_A }, { "SPKI-SHA256-BASE64": PIN_B }] },
    });
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

  // The local modules' Robolectric and instrumented tests never ship; a new test must not make every
  // installed binary miss the next OTA. Checked with `expo-updates runtimeversion:resolve`: the hash
  // with and without src/test (and src/androidTest) is the same under these patterns.
  it("leaves the local modules' JVM unit and instrumented tests out of the runtime fingerprint", async () => {
    const { default: fingerprint } = (await import("./fingerprint.config.js")) as { default: { ignorePaths?: string[] } };
    expect(fingerprint.ignorePaths).toEqual(expect.arrayContaining(["modules/*/android/src/test/**", "modules/*/android/src/androidTest/**"]));
  });

  // EAS PR #404 build 1dba0b89 stopped on "Runtime version mismatch": on the builder the fingerprint
  // hashed the prebuilt android/ dir and the GOOGLE_SERVICES_JSON secret file, which no local or CI
  // computation can see. Both are named so the two sides agree.
  it("leaves the generated native dirs and EAS file secrets out of the runtime fingerprint", async () => {
    const { default: fingerprint } = (await import("./fingerprint.config.js")) as { default: { ignorePaths?: string[] } };
    expect(fingerprint.ignorePaths).toEqual(expect.arrayContaining(["android/**/*", "ios/**/*", "**/eas-environment-secrets/**"]));
  });
});

// Audit "ios-dormant-calls-bg-audio" (Apple 2.5.4, 2.3.1): an iPhone binary declares no background audio or VoIP a
// reviewer could not exercise, and no server switch can turn calling on in a binary reviewed without it. Calls on
// iPhone (CallKit and PushKit, docs/adr/0038) are a build made with UNICHAT_IOS_CALLS=1.
describe("calls on iPhone are a build capability", () => {
  const withModule = (platforms: string[]) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unichat-ios-calls-"));
    fs.mkdirSync(path.join(root, "modules/unichat-calls"), { recursive: true });
    fs.writeFileSync(path.join(root, "modules/unichat-calls/expo-module.config.json"), JSON.stringify({ platforms }));
    return root;
  };

  it("declares no background mode and tells the app nothing without UNICHAT_IOS_CALLS", () => {
    vi.stubEnv("UNICHAT_IOS_CALLS", undefined);
    const config = build();
    expect(config.ios?.infoPlist).toEqual({ CFBundleDevelopmentRegion: "vi" });
    expect(config.extra?.iosCalls).toBeUndefined();
    expect(config.plugins).toContainEqual(["./plugins/with-unichat-calls", { iosCalls: false }]);
  });

  it("refuses UNICHAT_IOS_CALLS=1 where the call module has no iOS half", () => {
    vi.stubEnv("UNICHAT_IOS_CALLS", "1");
    expect(() => build(withModule(["android"]))).toThrow(/CallKit/);
    expect(() => iosCallsBuilt(withModule(["android"]))).toThrow(/CallKit/);
  });

  it("allows it now that the call module ships its iOS half", () => {
    vi.stubEnv("UNICHAT_IOS_CALLS", "1");
    expect(iosCallsBuilt(__dirname)).toBe(true);
  });

  it("declares background audio and VoIP and tells the app once the module ships iOS", () => {
    vi.stubEnv("UNICHAT_IOS_CALLS", "1");
    for (const config of [build(withModule(["android", "ios"])), build()]) {
      expect(config.ios?.infoPlist?.UIBackgroundModes).toEqual(["audio", "voip"]);
      expect(config.extra?.iosCalls).toBe(true);
      expect(config.plugins).toContainEqual(["./plugins/with-unichat-calls", { iosCalls: true }]);
    }
  });

  it("is set by no EAS profile", () => {
    const eas = JSON.parse(fs.readFileSync(path.join(__dirname, "eas.json"), "utf8")) as { build: Record<string, { env?: Record<string, string> }> };
    for (const profile of Object.values(eas.build)) expect(profile.env?.UNICHAT_IOS_CALLS).toBeUndefined();
  });

  // The Info.plist expo prebuild writes, after every plugin (expo-audio, expo-task-manager and expo-notifications
  // each add a mode for features UniChat keeps off): only `processing`, for the outbox's scheduled drain
  // (expo-background-task's BGProcessingTask, data/outbox-drain/background-send.ts), with the one task identifier it
  // registers at launch (an identifier missing here makes iOS refuse the registration and stop the app).
  it("leaves the release Info.plist with the outbox's processing mode only", { timeout: 120_000 }, () => {
    const out = execFileSync(process.execPath, [createRequire(__filename).resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, UNICHAT_ENV: "production", UNICHAT_API_URL: "https://api.example.invalid", UNICHAT_APP_URL: "https://app.example.invalid", UNICHAT_IOS_CALLS: "", EAS_BUILD: "", EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1" },
    });
    const plist = (JSON.parse(out) as { ios: { infoPlist: Record<string, unknown> } }).ios.infoPlist;
    expect(plist.UIBackgroundModes).toEqual(["processing"]);
    expect(plist.BGTaskSchedulerPermittedIdentifiers).toEqual(["com.expo.modules.backgroundtask.processing"]);
  });

  // The same Info.plist of a build with calls: PushKit's `voip` and the call's `audio` beside `processing`, nothing
  // else (ios/CallCenter.swift starts only where `voip` is declared).
  it("leaves the release Info.plist of a build with calls with voip and audio added", { timeout: 120_000 }, () => {
    const out = execFileSync(process.execPath, [createRequire(__filename).resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, UNICHAT_ENV: "production", UNICHAT_API_URL: "https://api.example.invalid", UNICHAT_APP_URL: "https://app.example.invalid", UNICHAT_IOS_CALLS: "1", EAS_BUILD: "", EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1" },
    });
    const plist = (JSON.parse(out) as { ios: { infoPlist: { UIBackgroundModes: string[] } } }).ios.infoPlist;
    expect([...plist.UIBackgroundModes].sort()).toEqual(["audio", "processing", "voip"]);
  });
});

// Audit "target-sdk-implicit-untested": the target API was React Native's default, and no emulator ran it.
// R8 is on for every release build: a class native code finds by name and no library rule keeps is gone from the
// dex, and the app dies at launch (0.3.0 (11) lost WebRTC's livekit.org.jni_zero.JniInit this way).
describe("R8 keep rules", () => {
  it("keep what native code finds by name: Nitro, the app's modules and WebRTC's relocated jni_zero", () => {
    expect(ANDROID_KEEP_RULES.split("\n")).toEqual(
      expect.arrayContaining([
        "-keep class com.margelo.nitro.** { *; }",
        "-keep class expo.modules.unichatcalls.** { *; }",
        "-keep class expo.modules.unichatbackground.** { *; }",
        "-keep class livekit.org.jni_zero.** { *; }",
      ]),
    );
  });
});

describe("the Android API the app targets", () => {
  it("is pinned, and the CI matrix runs it on a phone and on a tablet in landscape", () => {
    const plugin = build().plugins?.find((p) => Array.isArray(p) && p[0] === "expo-build-properties") as [string, { android: Record<string, unknown> }];
    const target = plugin[1].android.targetSdkVersion;
    expect(plugin[1].android.compileSdkVersion).toBe(target);
    const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/chat-mobile-verify.yml"), "utf8");
    expect(workflow).toContain(`{ api: ${String(target)}, target: google_apis, ram: 3072, label: api${String(target)} }`);
    expect(workflow).toMatch(new RegExp(`\\{ api: ${String(target)}, [^}]*profile: pixel_tablet, landscape: true \\}`));
  });
});

// Review finding: UNICHAT_IOS_CALLS shipped without a line in .env.example, so whoever set
// FF_UNICHAT_MOBILE_CALLS_IOS read that the flag alone turns iPhone calling on. Every variable the
// config reads is listed in the mobile build-time block, except EAS_BUILD, which the EAS builder sets.
describe("the build variables app.config.ts reads", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.config.ts"), "utf8");
  const example = fs.readFileSync(path.join(__dirname, "../../.env.example"), "utf8");
  const block = example.slice(example.indexOf("# ==================== UniChat mobile (build-time)"));
  const mobileBlock = block.slice(0, block.indexOf("\n# ====", 1));
  const read = new Set([
    ...[...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]!),
    // serverUrl reads its two by name (process.env[name]).
    ...[...source.matchAll(/name: ("UNICHAT_[A-Z_]+")(?: \| ("UNICHAT_[A-Z_]+"))*/g)].flatMap((match) => match.slice(1).filter(Boolean).map((n) => JSON.parse(n!) as string)),
  ]);
  read.delete("EAS_BUILD");

  it("finds the variables it is about", () => {
    expect([...read]).toEqual(expect.arrayContaining(["UNICHAT_ENV", "UNICHAT_API_URL", "UNICHAT_APP_URL", "UNICHAT_IOS_CALLS", "SENTRY_DSN"]));
  });

  it.each([...read].sort())("%s is listed in .env.example's mobile build-time block", (name) => {
    expect(mobileBlock).toMatch(new RegExp(`^#\\s?${name}=`, "m"));
  });

  it("says the iPhone calls flag does nothing on a binary built without UNICHAT_IOS_CALLS", () => {
    const flag = example.slice(example.indexOf("FF_UNICHAT_MOBILE_CALLS_IOS"), example.indexOf("FF_UNICHAT_MOBILE_TIMELINE_RECYCLED"));
    expect(flag).toContain("UNICHAT_IOS_CALLS=1");
  });
});
