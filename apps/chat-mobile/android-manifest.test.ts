// What a UniChat release build asks of Android and runs in the background,
// resolved from this config and the native libraries it links
// (scripts/android-manifest.mjs). Every line here is a Play Console App
// content declaration (docs/runbooks/unichat-mobile-release.md › Play Console
// App content): a new permission or foreground service changes this list in
// the same commit as the native change, together with store/listing.md and
// the runbook's declaration table.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const report = () =>
  JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "scripts/android-manifest.mjs")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as {
    permissions: string[];
    removedPermissions: string[];
    services: { name: string; foregroundServiceType: string }[];
    removedServices: string[];
  };

describe("the release build's Android manifest", () => {
  it("asks for these permissions and no others", { timeout: 120_000 }, () => {
    const manifest = report();
    expect(manifest.permissions).toEqual([
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.BLUETOOTH",
      "android.permission.BLUETOOTH_ADMIN",
      "android.permission.CAMERA",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.INTERNET",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.RECORD_AUDIO",
      "android.permission.VIBRATE",
      "android.permission.WAKE_LOCK",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ]);
    // A call never draws over other apps (app.config.ts › blockedPermissions).
    expect(manifest.removedPermissions).toEqual(["android.permission.SYSTEM_ALERT_WINDOW"]);

    // No foreground service type at all: expo-audio's mediaPlayback service is
    // off (enableBackgroundPlayback: false) and WebRTC's mediaProjection one is
    // removed (plugins/with-removed-android-services.js).
    expect(manifest.services).toEqual([
      { name: "com.google.android.gms.metadata.ModuleDependencies", foregroundServiceType: "" },
      { name: "expo.modules.notifications.service.ExpoFirebaseMessagingService", foregroundServiceType: "" },
    ]);
    expect(manifest.removedServices).toEqual(["com.oney.WebRTCModule.MediaProjectionService"]);
    expect(manifest.permissions.filter((name) => name.startsWith("android.permission.FOREGROUND_SERVICE_"))).toEqual([]);
  });
});
