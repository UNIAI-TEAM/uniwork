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
// - UniChatMessagingService: the app's FCM service, expo-notifications' own
//   with a call push taken first, natively (NativeCallPush.kt). FCM delivers
//   to the MESSAGING_EVENT service with the highest priority; expo-notifications
//   declares its own at -1, this one is 1.
// - <queries> for the vendor apps that hold the autostart switch
//   (BackgroundDelivery.kt): without them Android 11+ may hide those screens
//   from UniChat, and Settings would open the app's page instead.
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

/** Above expo-notifications' ExpoFirebaseMessagingService (-1), so FCM hands a message to this one. */
const MESSAGING_PRIORITY = "1";

const TOOLS = "http://schemas.android.com/tools";

/**
 * tools:ignore="Instantiatable": the class does extend Service (ExpoFirebaseMessagingService → FirebaseMessagingService),
 * but expo-notifications takes firebase-messaging as an `implementation` dependency, so the app's lint classpath cannot
 * see the chain and lintVitalRelease failed the first EAS release build (aa6009fc) on a false "must extend Service".
 * The Kotlin compiler is the check that it is one: the class would not compile otherwise.
 */
const MESSAGING_SERVICE = {
  $: { "android:name": `${PACKAGE}.UniChatMessagingService`, "android:exported": "false", "tools:ignore": "Instantiatable" },
  "intent-filter": [{ $: { "android:priority": MESSAGING_PRIORITY }, action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }] }],
};

/** The vendor apps whose autostart screens BackgroundDelivery.kt opens (Xiaomi, Oppo, vivo, Huawei, OnePlus, Asus). */
const AUTOSTART_PACKAGES = [
  "com.miui.securitycenter",
  "com.coloros.safecenter",
  "com.oppo.safe",
  "com.vivo.permissionmanager",
  "com.iqoo.secure",
  "com.huawei.systemmanager",
  "com.oneplus.security",
  "com.asus.mobilemanager",
];

/**
 * iOS: no `fetch` (expo-task-manager adds it; UniChat does no background fetch), and no `audio` unless the build has
 * calls (app.config.ts › iosCallsBuilt): a library plugin that adds it for its own feature (expo-audio's background
 * playback) must not leave the binary declaring a mode the reviewer cannot exercise. An emptied list is removed.
 * @type {import("expo/config-plugins").ConfigPlugin<{ iosCalls?: boolean } | void>}
 */
const withUniChatCalls = (config, options) => {
  const iosCalls = options?.iosCalls === true;
  config = withInfoPlist(config, (mod) => {
    const modes = mod.modResults.UIBackgroundModes;
    if (!Array.isArray(modes)) return mod;
    const kept = modes.filter((mode) => mode !== "fetch" && (iosCalls || mode !== "audio"));
    if (kept.length > 0) mod.modResults.UIBackgroundModes = kept;
    else delete mod.modResults.UIBackgroundModes;
    return mod;
  });
  config = AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    for (const [tag, entries] of Object.entries(COMPONENTS)) {
      const nodes = entries.map((entry) => ({ $: entry }));
      if (tag === "service") nodes.push(MESSAGING_SERVICE);
      const names = new Set(nodes.map((node) => node.$["android:name"]));
      const kept = (application[tag] ?? []).filter((node) => !names.has(node.$["android:name"]));
      application[tag] = [...kept, ...nodes];
    }
    const manifest = mod.modResults.manifest;
    manifest.$ = { ...manifest.$, "xmlns:tools": TOOLS };
    const queries = manifest.queries?.[0] ?? {};
    const listed = new Set((queries.package ?? []).map((node) => node.$["android:name"]));
    queries.package = [...(queries.package ?? []), ...AUTOSTART_PACKAGES.filter((name) => !listed.has(name)).map((name) => ({ $: { "android:name": name } }))];
    manifest.queries = [queries, ...(manifest.queries ?? []).slice(1)];
    return mod;
  });
};

module.exports = withUniChatCalls;
module.exports.MESSAGING_SERVICE = MESSAGING_SERVICE;
module.exports.AUTOSTART_PACKAGES = AUTOSTART_PACKAGES;
