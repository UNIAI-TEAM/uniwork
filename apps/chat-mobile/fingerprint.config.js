// @expo/fingerprint's settings for `runtimeVersion: { policy: "fingerprint" }`
// (app.config.ts). The fingerprint decides which binaries an update may land
// on, so it must hash what the native app is made of and nothing else.
//
// `extra` is left out: it holds the server URLs, the Sentry DSN and the EAS
// project id, which JavaScript reads at run time from the update's own
// manifest. Hashing them would split one native build into a runtime per
// environment value, and an update published from CI (where a value can be
// missing or rotated) would silently match no phone. The publishing workflow
// checks those values instead (.github/workflows/chat-mobile-update.yml).
const { SourceSkips } = require("expo/fingerprint");

/** @type {import("expo/fingerprint").Config} */
module.exports = {
  // Replaces the default skip set, so the default (package.json scripts that
  // run no native step) is kept beside it.
  sourceSkips: SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun | SourceSkips.ExpoConfigExtraSection,
  // The local modules' JVM unit tests (Robolectric, mobile-verify › android-release) never
  // reach a binary: adding or changing one must not split the runtime.
  ignorePaths: ["modules/*/android/src/test/**"],
};
