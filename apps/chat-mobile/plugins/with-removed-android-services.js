// Drops Android services a library declares but UniChat never starts, so the
// merged manifest (and the Play Console's foreground-service declaration)
// lists only what the app uses. Each entry becomes
//   <service android:name="…" tools:node="remove" />
// in the app manifest, which the manifest merger applies over the library's.
// Today: @livekit/react-native-webrtc's MediaProjectionService (screen
// sharing, foregroundServiceType="mediaProjection"); UniChat has no screen
// share. android-manifest.test.ts holds the final permission and service list.
const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const TOOLS = "http://schemas.android.com/tools";

/** @type {import("expo/config-plugins").ConfigPlugin<{ services: string[] }>} */
const withRemovedAndroidServices = (config, { services }) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$ = { ...manifest.$, "xmlns:tools": TOOLS };
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const kept = (application.service ?? []).filter((service) => !services.includes(service.$["android:name"]));
    application.service = [...kept, ...services.map((name) => ({ $: { "android:name": name, "tools:node": "remove" } }))];
    return mod;
  });

module.exports = withRemovedAndroidServices;
