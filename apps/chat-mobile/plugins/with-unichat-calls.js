// Declares what modules/unichat-calls needs in the app's Android manifest
// (docs/adr/drafts/0038), here rather than in the module's own manifest so
// scripts/android-manifest.mjs and android-manifest.test.ts see it:
//
// - USE_FULL_SCREEN_INTENT: the ringing screen over a locked phone. Play
//   grants it by default only to calling apps; Android 14+ lets the person
//   revoke it (the app then rings as a heads-up notification).
// - FOREGROUND_SERVICE_PHONE_CALL + MANAGE_OWN_CALLS: the call's foreground
//   service of type phoneCall (Android 14 starts one only for an app that
//   manages its own calls or is the dialer); _MICROPHONE and _CAMERA for the
//   types added once those permissions are granted.
// - BLUETOOTH_CONNECT: a Bluetooth headset as the call's audio (API 31+;
//   asked at call start, data/calls/call-native-sync.ts).
// - The service (CallService), the Decline / Hang up receiver and the
//   headless JavaScript task service that tells the server.
//
// iOS: expo-task-manager (the Android data-only call push runs as one of its
// tasks) adds the "fetch" background mode through Expo's automatic plugin.
// UniChat never fetches in the background, and App Review asks about a mode
// an app does not use, so it is taken out again; "audio" stays for calls.
const { AndroidConfig, withAndroidManifest, withInfoPlist } = require("expo/config-plugins");

const PACKAGE = "expo.modules.unichatcalls";

const PERMISSIONS = [
  "android.permission.USE_FULL_SCREEN_INTENT",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  "android.permission.FOREGROUND_SERVICE_CAMERA",
  "android.permission.MANAGE_OWN_CALLS",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.VIBRATE",
  "android.permission.WAKE_LOCK",
];

const COMPONENTS = {
  service: [
    { "android:name": `${PACKAGE}.CallService`, "android:exported": "false", "android:foregroundServiceType": "phoneCall|microphone|camera" },
    { "android:name": `${PACKAGE}.CallActionTaskService`, "android:exported": "false" },
  ],
  receiver: [{ "android:name": `${PACKAGE}.CallActionReceiver`, "android:exported": "false" }],
};

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withUniChatCalls = (config) => {
  config = withInfoPlist(config, (mod) => {
    const modes = mod.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) mod.modResults.UIBackgroundModes = modes.filter((mode) => mode !== "fetch");
    return mod;
  });
  config = AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    for (const [tag, entries] of Object.entries(COMPONENTS)) {
      const names = new Set(entries.map((entry) => entry["android:name"]));
      const kept = (application[tag] ?? []).filter((node) => !names.has(node.$["android:name"]));
      application[tag] = [...kept, ...entries.map((entry) => ({ $: entry }))];
    }
    return mod;
  });
};

module.exports = withUniChatCalls;
