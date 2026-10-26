// What a UniChat release build asks of Android and runs in the background,
// resolved from this config and the native libraries it autolinks
// (scripts/android-manifest.mjs). Every line here is a Play Console App
// content declaration (docs/runbooks/unichat-mobile-release.md › Play Console
// App content): a new permission or foreground service changes this list in
// the same commit as the native change, together with store/listing.md and
// the runbook's declaration table.
//
// The resolver reads source manifests, and of the Maven libraries those
// modules pull in only the ones MAVEN_MANIFESTS holds (WorkManager), so it
// cannot see what the others add when Gradle merges (ShortcutBadger's
// launcher badge permissions, firebase-messaging's c2dm RECEIVE, androidx.core's
// DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION): the binary carries those too.
// android-permissions.json is the reviewed list of the binary's whole set;
// scripts/mobile-apk-scan.mjs holds the real APK and AAB to it, and the
// cases below hold this resolver's view to it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const report = (env: Record<string, string> = {}) =>
  JSON.parse(
    execFileSync(process.execPath, [path.join(__dirname, "scripts/android-manifest.mjs")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } }),
  ) as {
    application: Record<string, string>;
    permissions: string[];
    maxSdkVersion: Record<string, string>;
    removedPermissions: string[];
    services: { name: string; foregroundServiceType: string }[];
    removedServices: string[];
    messagingServices: { name: string; priority: number }[];
    queriedPackages: string[];
  };

// One introspection for every case below: `expo config` is the slow part.
let release: ReturnType<typeof report> | undefined;
const releaseReport = () => (release ??= report());

describe("the release build's Android manifest", () => {
  it("asks for these permissions itself and through the libraries it autolinks", { timeout: 120_000 }, () => {
    const manifest = releaseReport();
    expect(manifest.permissions).toEqual([
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.BLUETOOTH",
      "android.permission.BLUETOOTH_ADMIN",
      // Native calls (plugins/with-unichat-calls.js): Bluetooth audio on API 31+.
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.CAMERA",
      // expo-screen-capture registers its capture callback when it is created on Android 14+ (app.config.ts ›
      // blockedPermissions): a normal permission, no prompt; without it the app dies at launch.
      "android.permission.DETECT_SCREEN_CAPTURE",
      "android.permission.FOREGROUND_SERVICE",
      // The call's foreground service: phoneCall (with MANAGE_OWN_CALLS), microphone, camera.
      "android.permission.FOREGROUND_SERVICE_CAMERA",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
      "android.permission.INTERNET",
      "android.permission.MANAGE_OWN_CALLS",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.RECORD_AUDIO",
      // App lock (expo-local-authentication): normal permissions, no prompt.
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
      // The ringing screen over a locked phone (Play: calling apps only).
      "android.permission.USE_FULL_SCREEN_INTENT",
      "android.permission.VIBRATE",
      "android.permission.WAKE_LOCK",
    ]);
    // No permission is capped: BLUETOOTH and BLUETOOTH_ADMIN come uncapped from LiveKit (inert from Android 12, where
    // BLUETOOTH_CONNECT takes over), and the storage ones that expo-file-system and expo-image-picker cap at 32 are
    // removed outright below. A cap that appears or goes changes what Play reviews: it fails here.
    expect(manifest.maxSdkVersion).toEqual({});
    // A call never draws over other apps, UniChat reads no shared storage and no install referrer (app.config.ts ›
    // blockedPermissions).
    expect(manifest.removedPermissions).toEqual([
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      // installreferrer (a Maven dependency of expo-application): only getInstallReferrerAsync binds Play's referrer
      // service, and UniChat never calls it.
      "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
    ]);
    // Nothing leaves the phone in a backup or a device transfer, and no cleartext exception exists: Android 9+
    // refuses http:// by default, a release build only knows https:// servers (app.config.ts › serverUrl), and its
    // network security config (the TLS pins, plugins/with-tls-pins.js) refuses cleartext too.
    expect(manifest.application).toEqual({
      allowBackup: "false",
      dataExtractionRules: "@xml/unichat_data_extraction_rules",
      usesCleartextTraffic: "",
      networkSecurityConfig: "@xml/unichat_network_security_config",
    });

    // One foreground service, the call's own (modules/unichat-calls): phoneCall,
    // microphone and camera, each declared on Play. expo-audio's mediaPlayback
    // service is off (enableBackgroundPlayback: false) and WebRTC's
    // mediaProjection one is removed (plugins/with-removed-android-services.js).
    // expo-task-manager's job service runs the data-only call push in the
    // background; the headless task service tells the server about Decline. UniChatMessagingService is the app's
    // FCM service (a call push rings natively, everything else goes on to expo-notifications'), not a foreground one.
    // WorkManager's services (scripts/android-manifest.mjs › MAVEN_MANIFESTS) run the outbox's drain job
    // (modules/unichat-background); its SystemForegroundService has no type and never starts (no job asks for the
    // foreground), and the permissions WorkManager declares are all in the list above already.
    expect(manifest.services).toEqual([
      { name: "androidx.room.MultiInstanceInvalidationService", foregroundServiceType: "" },
      { name: "androidx.work.impl.background.systemalarm.SystemAlarmService", foregroundServiceType: "" },
      { name: "androidx.work.impl.background.systemjob.SystemJobService", foregroundServiceType: "" },
      { name: "androidx.work.impl.foreground.SystemForegroundService", foregroundServiceType: "" },
      { name: "com.google.android.gms.metadata.ModuleDependencies", foregroundServiceType: "" },
      { name: "expo.modules.notifications.service.ExpoFirebaseMessagingService", foregroundServiceType: "" },
      { name: "expo.modules.taskManager.TaskJobService", foregroundServiceType: "" },
      { name: "expo.modules.unichatcalls.CallActionTaskService", foregroundServiceType: "" },
      { name: "expo.modules.unichatcalls.CallService", foregroundServiceType: "phoneCall|microphone|camera" },
      { name: "expo.modules.unichatcalls.UniChatMessagingService", foregroundServiceType: "" },
    ]);
    // FCM hands a message to the MESSAGING_EVENT service with the highest priority: UniChat's, which takes a call
    // push natively (modules/unichat-calls › NativeCallPush.kt) and passes the rest to expo-notifications'. Were
    // expo-notifications' first, a killed app would ring only once JavaScript booted (review killed-app-ring).
    expect(manifest.messagingServices).toEqual([
      { name: "expo.modules.unichatcalls.UniChatMessagingService", priority: 1 },
      { name: "expo.modules.notifications.service.ExpoFirebaseMessagingService", priority: -1 },
    ]);
    // Named vendor apps only (their autostart screens, BackgroundDelivery.kt), never QUERY_ALL_PACKAGES.
    expect(manifest.queriedPackages).toEqual([
      "com.asus.mobilemanager",
      "com.coloros.safecenter",
      "com.huawei.systemmanager",
      "com.iqoo.secure",
      "com.miui.securitycenter",
      "com.oneplus.security",
      "com.oppo.safe",
      "com.vivo.permissionmanager",
    ]);
    expect(manifest.removedServices).toEqual(["com.oney.WebRTCModule.MediaProjectionService"]);
    expect(manifest.permissions.filter((name) => name.startsWith("android.permission.FOREGROUND_SERVICE_"))).toEqual([
      "android.permission.FOREGROUND_SERVICE_CAMERA",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
    ]);
  });
});

// A Maven library's manifest is merged by Gradle but out of the script's reach: MAVEN_MANIFESTS holds the linked
// ones by version, read from each runtime dependency a linked build.gradle names.
describe("Maven libraries' manifests", () => {
  type ManifestScript = { MAVEN_MANIFESTS: Record<string, unknown>; mavenLibraries: (gradle: string, file?: string) => string[] };
  const script = () => import("./scripts/android-manifest.mjs") as Promise<ManifestScript>;

  it("reads runtime dependencies only, a -ktx artifact as its base, and stops on a version it has no entry for", async () => {
    const { mavenLibraries } = await script();
    const gradle = (line: string) => `dependencies {\n  ${line}\n  testImplementation 'androidx.work:work-testing:9.9.9'\n}\n`;
    expect(mavenLibraries(gradle("implementation 'androidx.work:work-runtime-ktx:2.9.1'"))).toEqual(["androidx.work:work-runtime:2.9.1"]);
    expect(mavenLibraries(gradle('api("androidx.work:work-runtime:2.9.1")'))).toEqual(["androidx.work:work-runtime:2.9.1"]);
    expect(mavenLibraries(gradle("compileOnly 'androidx.work:work-runtime:3.0.0'"))).toEqual([]);
    expect(mavenLibraries(gradle("implementation 'androidx.core:core:1.17.0'"))).toEqual([]);
    expect(() => mavenLibraries(gradle("implementation 'androidx.work:work-runtime-ktx:2.10.0'"), "x/build.gradle")).toThrow(
      "x/build.gradle links androidx.work:work-runtime:2.10.0",
    );
  });

  it("the outbox module and expo-background-task link the one WorkManager the table knows", async () => {
    const { MAVEN_MANIFESTS, mavenLibraries } = await script();
    const background = createRequire(path.join(__dirname, "package.json")).resolve("expo-background-task/package.json");
    for (const file of [path.join(__dirname, "modules/unichat-background/android/build.gradle"), path.join(path.dirname(background), "android/build.gradle")]) {
      const linked = mavenLibraries(fs.readFileSync(file, "utf8"), file);
      expect(linked).toEqual(["androidx.work:work-runtime:2.9.1"]);
      expect(MAVEN_MANIFESTS).toHaveProperty([linked[0]!]);
    }
  });
});

type Reviewed = { name: string; from?: string; tag?: string; minSdkVersion?: number; maxSdkVersion?: number };
const reviewed = (JSON.parse(fs.readFileSync(path.join(__dirname, "android-permissions.json"), "utf8")) as { permissions: Reviewed[] }).permissions;

describe("android-permissions.json, the binary's reviewed permissions", () => {
  it("lists every permission this config and its autolinked libraries ask for, under the same cap", { timeout: 120_000 }, () => {
    const manifest = releaseReport();
    const listed = new Map(reviewed.map((entry) => [entry.name, entry]));
    expect(manifest.permissions.filter((name) => !listed.has(name)), "add each with from, reason and play").toEqual([]);
    for (const name of manifest.permissions) {
      expect(listed.get(name)?.maxSdkVersion, name).toBe(manifest.maxSdkVersion[name] === undefined ? undefined : Number(manifest.maxSdkVersion[name]));
    }
  });

  it("lists none that app.config.ts blocks", { timeout: 120_000 }, () => {
    const blocked = new Set(releaseReport().removedPermissions);
    expect(reviewed.filter((entry) => blocked.has(entry.name)).map((entry) => entry.name)).toEqual([]);
  });

  // A Maven library the resolver reads (MAVEN_MANIFESTS) is one of its permissions' sources: their `from` names it, so
  // dropping the module that links it is seen to leave each permission to the others, or to nobody.
  it("names each Maven library the resolver reads among its permissions' sources", async () => {
    const { MAVEN_MANIFESTS } = (await import("./scripts/android-manifest.mjs")) as { MAVEN_MANIFESTS: Record<string, { permissions: string[] }> };
    const from = new Map(reviewed.map((entry) => [entry.name, entry.from ?? ""]));
    const unnamed = Object.entries(MAVEN_MANIFESTS).flatMap(([library, { permissions }]) => {
      const artifact = library.split(":").slice(0, 2).join(":");
      return permissions.filter((name) => !from.get(name)?.includes(artifact)).map((name) => `${name} ← ${artifact}`);
    });
    expect(unnamed).toEqual([]);
  });
});

// store/listing.md › "Quyền và chuỗi xin quyền" answers review for every android.permission the release build carries
// (the resolver's and the reviewed list's, which has the Maven libraries' too): a row of its table, or the paragraph of
// normal permissions under it. A permission the binary gains without a word there, or a name the listing keeps after
// the binary dropped it (a removed one may stay, struck through), fails.
describe("the store listing's permission section", () => {
  const listing = fs.readFileSync(path.join(__dirname, "store/listing.md"), "utf8");
  const section = listing.slice(listing.indexOf("## Quyền và chuỗi xin quyền"), listing.indexOf("## Tài khoản demo"));
  const named = new Set([...section.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]!));
  const short = (name: string) => name.replace(/^android\.permission\./, "");

  const androidReviewed = reviewed.map((entry) => entry.name).filter((name) => name.startsWith("android.permission."));

  it("names every permission of the release manifest", { timeout: 120_000 }, () => {
    const missing = [...new Set([...releaseReport().permissions, ...androidReviewed])].map(short).filter((name) => !named.has(name));
    expect(missing, "add a row or a word in store/listing.md › Quyền").toEqual([]);
  });

  it("names no permission the release manifest neither asks for nor removes", { timeout: 120_000 }, () => {
    const manifest = releaseReport();
    const known = new Set([...manifest.permissions, ...androidReviewed, ...manifest.removedPermissions].map(short));
    expect([...named].filter((name) => !known.has(name))).toEqual([]);
  });
});

describe("TLS pinning in the release manifest", () => {
  // plugins/with-tls-pins.js, on for every staging and production build (app.config.ts › tlsPinning, tls-pins.json).
  it("points the release app at its network security config", { timeout: 120_000 }, () => {
    const manifest = releaseReport();
    expect(manifest.application.networkSecurityConfig).toBe("@xml/unichat_network_security_config");
    expect(manifest.application.allowBackup).toBe("false");
  });
});

describe("plugins/with-android-backup-rules.js", () => {
  const rules = createRequire(__filename)("./plugins/with-android-backup-rules.js") as { DATA_EXTRACTION_RULES: string; RULES_NAME: string };

  it("excludes every storage domain from cloud backup and from device-to-device transfer", () => {
    expect(rules.RULES_NAME).toBe("unichat_data_extraction_rules");
    const domains = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"];
    for (const section of ["cloud-backup", "device-transfer"]) {
      const body = rules.DATA_EXTRACTION_RULES.split(`<${section}>`)[1]?.split(`</${section}>`)[0] ?? "";
      expect([...body.matchAll(/<exclude domain="([a-z_]+)" path="\." \/>/g)].map((m) => m[1])).toEqual(domains);
      expect(body).not.toContain("<include");
    }
  });
});
