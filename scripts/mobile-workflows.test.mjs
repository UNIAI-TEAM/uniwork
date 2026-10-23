import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { MOBILE_PATHS } from "./mobile-native-scope.mjs";
import { ABI } from "./mobile-ftl-devices.mjs";
import { JOBS as GATE_JOBS } from "./mobile-verify-gate.mjs";
import { REQUIRED_DEX_CLASSES } from "./mobile-apk-scan.mjs";
import { fakeDex, protoXml } from "./mobile-apk-scan.fixture.mjs";

// The release path of UniChat mobile (docs/runbooks/unichat-mobile-release.md,
// ADR 0043): what the four workflows promise, held so an edit cannot quietly
// drop it.
const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, ".github/workflows", f), "utf8");
const EXACT = /^"?\d+\.\d+\.\d+"?$/;
const envPin = (wf, name) => wf.match(new RegExp(`^\\s+${name}:\\s*(\\S+)\\s*$`, "m"))?.[1];

test("the release runs every PR check on the tagged SHA before EAS, Android only, with a pinned eas-cli", () => {
  const wf = read("chat-mobile-release.yml");
  assert.match(wf, /^ {2}verify:\n {4}uses: \.\/\.github\/workflows\/mobile-verify\.yml$/m, "a verify job that calls mobile-verify.yml");
  assert.match(wf, /^ {2}build:\n {4}needs: verify$/m, "build waits for verify");
  // A re-pushed tag has a real `before` SHA: without this the scope job could skip the native build.
  assert.match(wf, /^ {4}uses: \.\/\.github\/workflows\/mobile-verify\.yml\n {4}with:\n {6}force_native: true$/m, "the release forces the native build");
  assert.match(envPin(wf, "EAS_CLI_VERSION") ?? "", EXACT, "EAS_CLI_VERSION is an exact version");
  assert.match(wf, /eas-version: \$\{\{ env\.EAS_CLI_VERSION \}\}/);
  assert.doesNotMatch(wf, /eas-version: latest/);
  // Android only until the Apple account exists (UNI-1838): then this assertion moves with it.
  assert.match(wf, /eas build --platform android /);
  assert.doesNotMatch(wf, /--platform all/);
});

test("mobile-verify can be called and builds the release only through its jobs", () => {
  const wf = read("mobile-verify.yml");
  assert.match(wf, /^ {2}workflow_call:$/m);
  for (const job of ["scope", "checks", "doctor-bundle", "android-release", "android-smoke", "ios-release", "gate"]) assert.match(wf, new RegExp(`^ {2}${job}:$`, "m"), `job ${job}`);
  assert.match(envPin(wf, "EXPO_DOCTOR_VERSION") ?? "", EXACT, "EXPO_DOCTOR_VERSION is an exact version");
  assert.match(wf, /node scripts\/mobile-bundle-budget\.mjs/);
  // Audit bundle-size-growth: the summary names the packages behind the totals, per platform.
  for (const platform of ["android", "ios"]) {
    assert.match(wf, new RegExp(`node scripts/mobile-bundle-composition\\.mjs "\\$RUNNER_TEMP/export" --platform ${platform}`));
  }
  assert.match(wf, /\.\/gradlew :app:assembleRelease/);
  // Audit "native-module-untested": the calls module's Kotlin is unit-tested in the same Gradle run.
  assert.match(jobsOf(wf).jobs.get("android-release") ?? "", /\.\/gradlew :app:assembleRelease :unichat-calls:testReleaseUnitTest /);
  const calls = path.join(root, "apps/chat-mobile/modules/unichat-calls/android/src");
  // Review P2: the service, the action receiver, the lock screen and the ringer have JVM tests too.
  for (const file of ["CallLaunchTokens", "PendingActions", "CallNotifications", "CallService", "CallActionReceiver", "CallLockScreen", "CallRinger"]) {
    assert.ok(fs.existsSync(path.join(calls, `test/java/expo/modules/unichatcalls/${file}Test.kt`)), `${file}Test.kt`);
  }
  // And the incoming call as System UI draws it: built with the release, run on the smoke's emulator.
  assert.ok(fs.existsSync(path.join(calls, "androidTest/java/expo/modules/unichatcalls/IncomingCallNotificationTest.kt")));
  assert.match(jobsOf(wf).jobs.get("android-release") ?? "", /:unichat-calls:assembleDebugAndroidTest /);
  const smoke = jobsOf(wf).jobs.get("android-smoke") ?? "";
  assert.match(smoke, /name: unichat-calls-androidtest/);
  assert.match(smoke, /adb shell am instrument -w expo\.modules\.unichatcalls\.test\/androidx\.test\.runner\.AndroidJUnitRunner \| tee "([^"]+)"\n\s+grep -q '\^OK \(' "\1"/, "the run fails unless the instrumentation says OK");
  assert.match(wf, /maestro-retry\.sh test flows\/smoke-launch\.yaml/, "the cold-start smoke runs the release APK");
  // Audit "ios-never-built": every native PR compiles iOS too, for the simulator, without an Apple account.
  const ios = jobsOf(wf).jobs.get("ios-release") ?? "";
  assert.match(ios, /^ {4}runs-on: macos-/m, "iOS builds on macOS");
  assert.match(ios, /expo prebuild -p ios/);
  assert.match(ios, /-configuration Release -sdk iphonesimulator/);
  assert.match(ios, /CODE_SIGN_IDENTITY=- /, "ad-hoc signed: no Apple account");
  assert.match(ios, /maestro-retry\.sh --device "\$UDID" test flows\/smoke-launch\.yaml/, "and boots to sign-in on a simulator");
  // Audit UX "no-ios-a11y-verification": the same sign-in check at the largest Dynamic Type, in dark mode.
  assert.match(
    ios,
    /content_size accessibility-extra-extra-extra-large\n\s+xcrun simctl ui "\$UDID" appearance dark\n\s+\$\{\{ github\.workspace \}\}\/scripts\/maestro-retry\.sh --device "\$UDID" test flows\/a11y-large-text-dark\.yaml/,
    "the simulator runs the sign-in at the largest Dynamic Type in dark mode",
  );
  // Accessibility on the device: the largest font scale and dark mode, the flow, then the audit, blocking.
  assert.match(
    wf,
    /font_scale 2\.0\n\s+adb shell cmd uimode night yes\n\s+cd apps\/chat-mobile\/maestro && \$\{\{ github\.workspace \}\}\/scripts\/maestro-retry\.sh test flows\/a11y-large-text-dark\.yaml\n\s+node scripts\/mobile-a11y-audit\.mjs --package com\.uniworkos\.chat --out /,
    "the smoke runs the sign-in at the largest text in dark mode and audits it",
  );
  assert.match(wf, /scripts\/mobile-a11y-audit\.test\.mjs/, "the contract step runs the audit's own test");
  assert.match(envPin(wf, "MAESTRO_VERSION") ?? "", EXACT, "MAESTRO_VERSION is an exact version");
  // Audit "missed: no static analysis of the native Kotlin": pinned, checksummed, on every mobile PR.
  assert.match(envPin(wf, "KTLINT_VERSION") ?? "", EXACT, "KTLINT_VERSION is an exact version");
  assert.match(envPin(wf, "KTLINT_SHA256") ?? "", /^[0-9a-f]{64}$/, "the ktlint binary is checked against its checksum");
  const checks = jobsOf(wf).jobs.get("checks") ?? "";
  assert.match(checks, /sha256sum -c -\n[^\n]*\n\s+"\$RUNNER_TEMP\/ktlint" "apps\/chat-mobile\/modules\/\*\*\/\*\.kt"$/m, "ktlint runs over the modules' Kotlin");
  assert.match(fs.readFileSync(path.join(root, ".editorconfig"), "utf8"), /^\[\*\.\{kt,kts\}\]\nktlint_code_style = android_studio$/m, "ktlint's style is the repo's");
  assert.match(wf, /scripts\/mobile-workflows\.test\.mjs/, "the contract step runs this test");
  assert.match(wf, /scripts\/mobile-knip\.test\.mjs/, "the contract step runs the knip exception test");
  // Dead code and dependency drift block on every PR, not only in a local make check.
  assert.match(wf, /run: pnpm knip --workspace apps\/chat-mobile$/m, "knip runs over the app");
  assert.match(wf, /EXPO_OFFLINE: "1"\n\s+run: pnpm exec expo install --check$/m, "native module versions are checked against the installed SDK");
  assert.match(wf, /scripts\/mobile-lockfiles\.test\.mjs/, "the contract step rejects a foreign lockfile");
  assert.match(wf, /scripts\/mobile-easignore\.test\.mjs/, "the contract step holds .easignore to the .gitignore files");
  assert.match(wf, /scripts\/mobile-verify-gate\.test\.mjs/, "the contract step runs the gate's own test");
  assert.match(wf, /scripts\/maestro-retry\.test\.mjs/, "the contract step runs the device-retry test");
  assert.match(wf, /scripts\/branch-protection\.test\.mjs/, "the contract step holds the required checks to the workflows");
  assert.match(wf, /scripts\/mobile-coverage-floor\.test\.mjs/, "the contract step holds the component coverage floor");
  // Audit "Security & privacy", no-ci-binary-security-scan: the release APK is scanned where it is built.
  assert.match(jobsOf(wf).jobs.get("android-release") ?? "", /run: node scripts\/mobile-apk-scan\.mjs apps\/chat-mobile\/android\/app\/build\/outputs\/apk\/release\/app-release\.apk$/m, "android-release scans its APK");
  assert.match(wf, /scripts\/mobile-apk-scan\.test\.mjs/, "the contract step runs the scan's own test");
  assert.doesNotMatch(wf, /secrets\./, "the PR checks read no secret");
});

test("the nightly pins Maestro, fails a scheduled run without its settings, and builds the production AAB", () => {
  const wf = read("chat-mobile-verify.yml");
  assert.match(envPin(wf, "MAESTRO_VERSION") ?? "", EXACT, "MAESTRO_VERSION is an exact version");
  assert.doesNotMatch(wf, /get\.maestro\.mobile\.dev"? \| bash/, "no unversioned installer script");
  assert.match(wf, /releases\/download\/cli-\$MAESTRO_VERSION\/maestro\.zip/);
  const gate = wf.split(/^ {2}ios:$/m)[0];
  assert.match(gate, /::error::The Maestro flows cannot run/);
  assert.match(gate, /exit 1/);
  assert.doesNotMatch(gate, /::notice::Maestro skipped/);
  assert.match(wf, /^ {2}android-production:$/m);
  // The iOS build no longer waits on the Maestro settings; only its simulator and flows do.
  const ios = jobsOf(wf).jobs.get("ios") ?? "";
  assert.match(ios, /^ {4}if: \$\{\{ !cancelled\(\) \}\}$/m, "the nightly iOS build runs without the Maestro settings");
  assert.match(ios, /- name: Build for the simulator\n(?! {8}if:)/, "the build step itself is unconditional");
  const steps = ["Boot a simulator and install the app", "Sign in, read and send", "Push opens the room", "Join a call", "Long-press menu at the largest Dynamic Type, in dark mode"];
  for (const step of steps) {
    assert.match(ios, new RegExp(`- name: ${step}\\n {8}if: needs\\.gate\\.outputs\\.ready == 'true'`), `${step} waits for the gate`);
  }
  assert.match(wf, /\.\/gradlew :app:bundleRelease/);
  // The golden chat flow again at the largest text in dark mode, and the room audited (as warnings: its pills
  // reach their target through hit slop, which a dump cannot see).
  assert.match(wf, /font_scale 2\.0\n\s+adb shell cmd uimode night yes\n\s+cd apps\/chat-mobile\/maestro && \$\{\{ github\.workspace \}\}\/scripts\/maestro-retry\.sh test flows\/chat-read-send\.yaml\n\s+node scripts\/mobile-a11y-audit\.mjs/);
  // Audit UX "long-press-menu-overflows": the menu at font scale 2.0 in a 360 x 640 dp window keeps its reactions on
  // screen and scrolls to Delete, the window and the text size put back after; the simulator checks it at AX5.
  assert.match(
    wf,
    /mobile-a11y-audit\.mjs [^\n]*\n\s+adb shell wm size 720x1280\n\s+adb shell wm density 320\n\s+cd apps\/chat-mobile\/maestro && [^\n]*test flows\/message-menu-large-text\.yaml\n\s+adb shell wm size reset\n\s+adb shell wm density reset\n\s+adb shell settings put system font_scale 1\.0/,
    "the long-press menu runs at the largest text on a 360 x 640 dp window",
  );
  assert.match(ios, /content_size accessibility-extra-extra-extra-large\n\s+xcrun simctl ui "\$UDID" appearance dark\n\s+[^\n]*test flows\/message-menu-large-text\.yaml/);
});

// The OTA path (audit R3): from CI, after every PR check on the SHA, staged by
// a rollout share, signed once the certificate exists, its maps in Sentry.
test("an OTA update is verified first, staged, signed when the app carries a certificate, and fails loudly without a token", () => {
  const wf = read("chat-mobile-update.yml");
  assert.match(wf, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(wf, /^ {2}(push|pull_request|schedule):/m, "a person decides when an update ships");
  assert.match(wf, /^ {2}verify:\n {4}uses: \.\/\.github\/workflows\/mobile-verify\.yml$/m, "a verify job that calls mobile-verify.yml");
  assert.match(wf, /^ {2}publish:\n {4}needs: verify$/m, "publish waits for verify");
  assert.match(envPin(wf, "EAS_CLI_VERSION") ?? "", EXACT, "EAS_CLI_VERSION is an exact version");
  assert.equal(envPin(wf, "EAS_CLI_VERSION"), envPin(read("chat-mobile-release.yml"), "EAS_CLI_VERSION"), "the same eas-cli as the store release");
  assert.match(wf, /eas-version: \$\{\{ env\.EAS_CLI_VERSION \}\}/);
  for (const input of ["channel", "rollout_percentage", "message"]) assert.match(wf, new RegExp(`^ {6}${input}:$`, "m"), `input ${input}`);
  // Inputs reach the shell through env, never interpolated into a script.
  assert.doesNotMatch(wf.split(/^jobs:$/m)[1] ?? "", /run: [^\n]*\$\{\{ inputs\./);
  assert.match(wf, /eas update --platform android --channel "\$CHANNEL" --environment "\$EAS_ENVIRONMENT"/);
  assert.match(wf, /--rollout-percentage "\$ROLLOUT"/);
  assert.match(wf, /certs\/eas-update-certificate\.pem/);
  assert.match(wf, /--private-key-path/);
  // Audit "ota-unsigned-first-binary": no update is published unsigned, on any channel (the step is run below).
  assert.doesNotMatch(wf, /this staging update is unsigned/, "no unsigned staging path");
  assert.match(wf, /::error::EXPO_TOKEN is not set[^\n]*\n\s+exit 1/, "a dispatched publish without a token fails");
  assert.match(wf, /sentry-expo-upload-sourcemaps dist/);
});

// Every store binary embeds the certificate (app.config.ts refuses a staging or production one without it), so the
// signing step never lets an update out unsigned: no certificate, or a certificate without its key, is red.
test("the OTA signing step refuses every unsigned update and hands eas the key it was given", () => {
  const marker = /^ {6}- id: signing$/m;
  for (const channel of ["staging", "production"]) {
    const bare = runStep("chat-mobile-update.yml", marker, { UNICHAT_ENV: channel, EAS_UPDATE_PRIVATE_KEY: "" });
    assert.notEqual(bare.status, 0, `${channel}: no certificate fails`);
    assert.match(bare.stdout, /::error::No code-signing certificate/);
  }
  const certified = (key) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-cert-"));
    try {
      fs.mkdirSync(path.join(dir, "certs"));
      fs.writeFileSync(path.join(dir, "certs/eas-update-certificate.pem"), "-----BEGIN CERTIFICATE-----\n");
      const script = `cd ${JSON.stringify(dir)} && ` + stepScript("chat-mobile-update.yml", marker);
      return runScript(script, { UNICHAT_ENV: "staging", EAS_UPDATE_PRIVATE_KEY: key });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  assert.notEqual(certified("").status, 0, "a certificate without its key fails");
  const signed = certified("-----BEGIN PRIVATE KEY-----");
  assert.equal(signed.status, 0);
  assert.match(signed.outputs.args ?? "", /^--private-key-path \S+eas-update-private-key\.pem$/);
});

// Audit "missed: a release tag goes green while building nothing": no token is a red run, and the header no longer
// says the tag is the OTA runtime (the fingerprint decides).
test("a store release without its EAS token is red, and the release header names the fingerprint", () => {
  const wf = read("chat-mobile-release.yml");
  assert.doesNotMatch(wf, /ready=false|::notice::EXPO_TOKEN/, "no green path without a token");
  const gate = runStep("chat-mobile-release.yml", "- name: The EAS token is set", { EXPO_TOKEN: "" });
  assert.notEqual(gate.status, 0);
  assert.match(gate.stdout, /::error::EXPO_TOKEN is not set/);
  assert.equal(runStep("chat-mobile-release.yml", "- name: The EAS token is set", { EXPO_TOKEN: "t" }).status, 0);
  const header = wf.split(/^on:$/m)[0].replace(/\n# ?/g, " ");
  assert.doesNotMatch(header, /is also the runtimeVersion/, "the tag is the store version, not the runtime");
  assert.match(header, /fingerprint/);
});

// A critical OTA (data/updates-controller.ts) is applied early by the phones: only a person publishing one says so,
// through the update workflow's input. No store binary or other workflow marks itself critical.
test("only the OTA workflow can mark an update critical, from its input", () => {
  const wf = read("chat-mobile-update.yml");
  assert.match(wf, /^ {6}critical:\n {8}description: [^\n]+\n {8}type: boolean\n {8}default: false$/m);
  assert.match(wf, /UNICHAT_CRITICAL_UPDATE: \$\{\{ inputs\.critical && '1' \|\| '' \}\}/);
  for (const file of WORKFLOWS.filter((f) => f !== "chat-mobile-update.yml")) assert.doesNotMatch(read(file), /UNICHAT_CRITICAL_UPDATE/, file);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "apps/chat-mobile/eas.json"), "utf8"), /UNICHAT_CRITICAL_UPDATE/);
});

// Audit "no-production-pipeline-binary-promotion": the production app is built once, from a tag on main, after every
// PR check; that binary goes to the production app's internal track, and only promotions by version code move it on.
test("the production build is verified, built from a main tag once, proved in Sentry, and submitted by build id", () => {
  const wf = read("chat-mobile-production.yml");
  assert.match(wf, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(wf, /^ {2}(push|pull_request|schedule):/m, "a person starts a production build");
  assert.match(wf, /^ {2}verify:\n {4}uses: \.\/\.github\/workflows\/mobile-verify\.yml\n {4}with:\n {6}force_native: true$/m);
  assert.match(wf, /^ {2}build:\n {4}needs: verify$/m);
  assert.match(wf, /^ {4}environment: chat-mobile-production$/m);
  assert.equal(envPin(wf, "EAS_CLI_VERSION"), envPin(read("chat-mobile-release.yml"), "EAS_CLI_VERSION"), "the same eas-cli as the internal release");
  assert.match(wf, /refs\/tags\/chat-mobile-v\*\) ;;/, "dispatched on a release tag only");
  assert.match(wf, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main; then/, "from main only");
  assert.doesNotMatch(wf, /origin\/develop/);
  assert.match(wf, /scripts\/mobile-release-notes\.mjs check "\$version"/, "the version has its What's new");
  assert.match(wf, /eas build --platform android --profile production --non-interactive --wait --json/);
  // The binary built is the binary submitted: by its EAS build id, to the production app's internal track.
  assert.match(wf, /eas submit --platform android --profile production-internal --id "\$BUILD_ID" --non-interactive --wait/);
  assert.doesNotMatch(wf, /--auto-submit/, "no second build behind a submit");
  const eas = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/eas.json"), "utf8"));
  assert.deepEqual(eas.submit["production-internal"], { android: { track: "internal" } });
  // The Gradle upload names the release <appId>@<versionName>+<versionCode>; the messages name it.
  assert.match(wf, /RELEASE: com\.uniworkos\.chat@\$\{\{ steps\.version\.outputs\.version \}\}\+\$\{\{ steps\.build\.outputs\.version_code \}\}/);
  assert.match(wf, /if: steps\.crash\.outputs\.verify == 'true'/);
  assert.match(wf, /::error::EXPO_TOKEN is not set[^\n]*\n\s+exit 1/);
  assert.doesNotMatch(wf.split(/^jobs:$/m)[1] ?? "", /run: [^\n]*\$\{\{ inputs\./, "inputs reach the shell through env");
});

// UNI-2142: the artifact-bundle upload creates no Sentry release, so 0.3.1 (12) failed a release lookup after an
// upload that worked. The proof is Sentry resolving the debug ID of the bundle in the AAB that is then submitted.
test("the production build proves its JS source map in Sentry by the debug ID of the scanned AAB, unless waived", () => {
  const wf = read("chat-mobile-production.yml");
  assert.doesNotMatch(wf, /\/releases\//, "no lookup of a release object the upload never creates");
  const order = ["- name: Security scan of the built bundle", "- id: symbols", "- name: Submit this binary"].map((step) => wf.indexOf(step));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), "download and scan, then the Sentry proof, then submit");
  const step = wf.split("- id: symbols")[1].split(/^ {6}- /m)[0];
  for (const name of ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_URL"]) assert.match(step, new RegExp(`^ {10}${name}: \\$\\{\\{ (secrets|vars)\\.${name} \\}\\}$`, "m"), name);
  assert.match(wf, /DEBUG_ID: \$\{\{ steps\.symbols\.outputs\.debug_id \}\}/, "the summary names the debug ID");
  const bin = nodeStub();
  try {
    const run = (env) => runStep("chat-mobile-production.yml", /^ {6}- id: symbols$/m, { GITHUB_WORKSPACE: "/ws", RELEASE: "com.uniworkos.chat@0.3.1+12", ...env }, bin);
    const proved = run({ NODE_EXIT: "0" });
    assert.equal(proved.status, 0);
    assert.match(proved.stdout, /node \/ws\/scripts\/mobile-sentry-symbols\.mjs \S+\/app\.aab --release com\.uniworkos\.chat@0\.3\.1\+12/);
    assert.notEqual(run({ NODE_EXIT: "1" }).status, 0, "no source map: not submitted");
    const waived = run({ NODE_EXIT: "1", ALLOW_NO_CRASH_REPORTING: "true" });
    assert.equal(waived.status, 0);
    assert.match(waived.stdout, /::warning::submitting com\.uniworkos\.chat@0\.3\.1\+12 without its source map proved in Sentry: allow_missing_crash_reporting waives it/);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

// Audit "Security & privacy", no-ci-binary-security-scan: the AAB that would be submitted is scanned first.
test("the production AAB is scanned for credentials, its manifest and its permissions before it is submitted", () => {
  const wf = read("chat-mobile-production.yml");
  const order = ["- id: build", "- name: Security scan of the built bundle", "- name: Submit this binary"].map((step) => wf.indexOf(step));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), "build, then scan, then submit");
  const marker = /^ {6}- name: Security scan of the built bundle$/m;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-aab-"));
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "curl"), '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done\ncp "$FAKE_AAB" "$out"\n', { mode: 0o755 });
    const reviewed = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/android-permissions.json"), "utf8")).permissions;
    const bundleManifest = {
      tag: "manifest",
      attrs: { package: "com.uniworkos.chat" },
      children: [
        ...reviewed.map((entry) => ({
          tag: entry.tag ?? "uses-permission",
          attrs: {
            "android:name": entry.name.replace("{package}", "com.uniworkos.chat"),
            ...(entry.minSdkVersion ? { "android:minSdkVersion": String(entry.minSdkVersion) } : {}),
            ...(entry.maxSdkVersion ? { "android:maxSdkVersion": String(entry.maxSdkVersion) } : {}),
          },
        })),
        // The TLS pin-set every release binary carries (scripts/mobile-apk-scan.mjs › unpinned).
        { tag: "application", attrs: { "android:allowBackup": "false", "android:networkSecurityConfig": "" } },
      ],
    };
    const aab = (name, bundle) => {
      const src = path.join(dir, name);
      fs.mkdirSync(path.join(src, "base", "assets"), { recursive: true });
      fs.writeFileSync(path.join(src, "base", "assets", "index.android.bundle"), bundle);
      fs.mkdirSync(path.join(src, "base", "dex"));
      fs.writeFileSync(path.join(src, "base", "dex", "classes.dex"), fakeDex(REQUIRED_DEX_CLASSES.map((entry) => entry.descriptor)));
      // A manifest that asks for exactly the reviewed permissions (apps/chat-mobile/android-permissions.json).
      fs.mkdirSync(path.join(src, "base", "manifest"));
      fs.writeFileSync(path.join(src, "base", "manifest", "AndroidManifest.xml"), protoXml(bundleManifest));
      execFileSync("zip", ["-qr", "../" + name + ".aab", "base"], { cwd: src });
      return path.join(dir, `${name}.aab`);
    };
    const temp = path.join(dir, "temp");
    fs.mkdirSync(temp);
    const run = (build, fake) => {
      fs.writeFileSync(path.join(temp, "build.json"), JSON.stringify([build]));
      return runStep("chat-mobile-production.yml", marker, { RUNNER_TEMP: temp, GITHUB_WORKSPACE: root, FAKE_AAB: fake ?? "" }, bin);
    };
    const withUrl = { id: "b1", artifacts: { buildUrl: "https://expo.dev/artifacts/eas/b1.aab" } };
    assert.equal(run(withUrl, aab("clean", "var a = 1;")).status, 0);
    const leaked = run(withUrl, aab("leaked", `var t = "sntrys_${"x".repeat(40)}";`));
    assert.notEqual(leaked.status, 0);
    assert.match(leaked.stdout, /::error::sentry-auth-token in base\/assets\/index\.android\.bundle/);
    const none = run({ id: "b1", artifacts: {} });
    assert.notEqual(none.status, 0);
    assert.match(none.stdout, /::error::eas build reported no artifact to scan/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a production build without crash reporting is refused unless waived, and the waiver skips only the proof", () => {
  const marker = /^ {6}- id: crash$/m;
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-eas-"));
  try {
    fs.writeFileSync(path.join(bin, "eas"), '#!/bin/sh\nprintf "%s" "$FAKE_CONFIG"\n', { mode: 0o755 });
    const servers = { apiUrl: "https://api.test", appUrl: "https://app.test" };
    const run = (extra, env) => runStep("chat-mobile-production.yml", marker, { FAKE_CONFIG: JSON.stringify({ extra }), ...env }, bin);
    const ready = run({ APP_ENV: "production", ...servers, sentryDsn: "https://k@sentry.test/1" }, { SENTRY_UPLOAD_READY: "true" });
    assert.equal(ready.status, 0);
    assert.equal(ready.outputs.verify, "true", "then the Sentry release is checked");
    const blind = run({ APP_ENV: "production", ...servers }, { SENTRY_UPLOAD_READY: "false" });
    assert.notEqual(blind.status, 0);
    assert.match(blind.stdout, /::error::no SENTRY_DSN[\s\S]*::error::no SENTRY_AUTH_TOKEN/);
    const waived = run({ APP_ENV: "production", ...servers }, { SENTRY_UPLOAD_READY: "false", ALLOW_NO_CRASH_REPORTING: "true" });
    assert.equal(waived.status, 0);
    assert.equal(waived.outputs.verify, "false");
    assert.notEqual(run({ APP_ENV: "staging", ...servers, sentryDsn: "https://k@sentry.test/1" }, { SENTRY_UPLOAD_READY: "true" }).status, 0, "only the production variant");
    assert.notEqual(run({ APP_ENV: "production", apiUrl: "https://api.test" }, { SENTRY_UPLOAD_READY: "true" }).status, 0, "with its servers");
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
  const tag = (ref) => runStep("chat-mobile-production.yml", "- name: Dispatched on a release tag", { REF: ref }).status;
  assert.equal(tag("refs/tags/chat-mobile-v0.3.0"), 0);
  assert.notEqual(tag("refs/heads/main"), 0);
});

test("promotion moves a version code through scripts/mobile-play-release.mjs, behind the production environment", () => {
  const wf = read("chat-mobile-promote.yml");
  assert.match(wf, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(wf, /^ {2}(push|pull_request|schedule):/m);
  assert.match(wf, /^ {4}environment: chat-mobile-production$/m);
  assert.match(wf, /node scripts\/mobile-play-release\.mjs halt --package com\.uniworkos\.chat --version-code "\$VERSION_CODE" --track "\$TO"/);
  assert.match(wf, /args=\(promote --package com\.uniworkos\.chat --version-code "\$VERSION_CODE" --from "\$FROM" --to "\$TO" --status "\$STATUS" --notes-version "\$VERSION"\)/);
  assert.match(wf, /if \[ "\$STATUS" = "inProgress" \]; then args\+=\(--rollout "\$ROLLOUT"\); fi/, "a rollout only for a staged release");
  assert.doesNotMatch(wf.split(/^jobs:$/m)[1] ?? "", /run: [^\n]*\$\{\{ inputs\./, "inputs reach the shell through env");
  assert.doesNotMatch(wf, /eas build|eas submit/, "promotion never builds or uploads a binary");
  // iOS: the same workflow paces the App Store phased release (audit "ios-no-release-path").
  assert.match(wf, /options: \[android, ios\]/);
  const ios = (env) => runStep("chat-mobile-promote.yml", "- name: Pace the phased release on the App Store", env);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asc-"));
  fs.mkdirSync(path.join(bin, "scripts"));
  fs.writeFileSync(path.join(bin, "node"), `#!/bin/sh\necho "node $*"\n`, { mode: 0o755 });
  const said = (env) => runScript(stepScript("chat-mobile-promote.yml", "- name: Pace the phased release on the App Store"), { ASC_APP_ID: "64", VERSION: "0.3.1", ...env }, bin);
  assert.match(said({ ACTION: "halt", STATUS: "draft" }).stdout, /node scripts\/mobile-asc-release\.mjs pause --app-id 64 --version 0\.3\.1/);
  assert.match(said({ ACTION: "promote", STATUS: "inProgress" }).stdout, /mobile-asc-release\.mjs resume/);
  assert.match(said({ ACTION: "promote", STATUS: "completed" }).stdout, /mobile-asc-release\.mjs complete/);
  assert.notEqual(said({ ACTION: "promote", STATUS: "draft" }).status, 0);
  assert.match(ios({ ACTION: "halt", STATUS: "draft", ASC_APP_ID: "", VERSION: "0.3.1" }).stdout, /::error::ios needs the App Store version and the ASC_APP_ID variable/);
  fs.rmSync(bin, { recursive: true, force: true });
});

// Audit "rollout-gating-manual": the runbook's floor runs every hour once production has users, and a switched-on
// job that cannot read Sentry is red rather than quietly green.
test("release health runs hourly once switched on, needs its settings, and acts only through the script", () => {
  const wf = read("chat-mobile-release-health.yml");
  assert.match(wf, /^ {2}schedule:\n {4}- cron: "\d+ \* \* \* \*"$/m, "hourly");
  assert.match(wf, /^ {4}if: \$\{\{ github\.event_name == 'workflow_dispatch' \|\| vars\.UNICHAT_RELEASE_HEALTH == 'on' \}\}$/m);
  assert.match(wf, /^ {4}environment: chat-mobile-release-health$/m);
  assert.match(wf, /^ {6}dry_run:\n {8}description: [^\n]+\n {8}type: boolean\n {8}default: true$/m, "a dispatched run reports only unless told otherwise");
  assert.equal(envPin(wf, "EAS_CLI_VERSION"), envPin(read("chat-mobile-release.yml"), "EAS_CLI_VERSION"));
  assert.match(wf, /rm -f "\$RUNNER_TEMP\/eas-update-private-key\.pem"/);
  const settings = (env) => runStep("chat-mobile-release-health.yml", "- name: Settings", env);
  assert.equal(settings({ EXPO_TOKEN: "t", SENTRY_AUTH_TOKEN: "s", SENTRY_ORG: "o" }).status, 0);
  const missing = settings({ EXPO_TOKEN: "t", SENTRY_AUTH_TOKEN: "", SENTRY_ORG: "" });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout, /::error::release health is on but the chat-mobile-release-health environment lacks: SENTRY_AUTH_TOKEN SENTRY_ORG/);
  // Every pilot count the script reads reaches it from a repository variable of the same name.
  for (const name of ["UNICHAT_HEALTH_MIN_SESSIONS", "UNICHAT_HEALTH_NEW_CRASH_MIN_USERS", "UNICHAT_HEALTH_LAUNCH_FAILURE_MIN_USERS", "UNICHAT_HEALTH_VITALS_MIN_USERS"]) {
    assert.match(wf, new RegExp(`^ {10}${name}: \\$\\{\\{ vars\\.${name} \\}\\}$`, "m"), name);
  }
});

// Audit "alerting-not-as-code": the alert rules are checked every hour and applied only when someone asks.
test("release health checks the Sentry alert rules as code every run, and applies them only when dispatched to", () => {
  const step = (env) => runStep("chat-mobile-release-health.yml", "- name: Sentry alert rules as code", env, nodeStub());
  const set = { SENTRY_PROJECT: "unichat-mobile", SENTRY_ALERT_TEAM: "mobile" };
  const checked = step({ ...set, SYNC_ALERTS: "false" });
  assert.equal(checked.status, 0);
  assert.match(checked.stdout, /node scripts\/mobile-sentry-alerts\.mjs check/);
  const applied = step({ ...set, SYNC_ALERTS: "true" });
  assert.match(applied.stdout, /node scripts\/mobile-sentry-alerts\.mjs apply/);
  assert.equal(step({ ...set, SYNC_ALERTS: "false", NODE_EXIT: "1" }).status, 0, "a failed check is a warning");
  assert.notEqual(step({ ...set, SYNC_ALERTS: "true", NODE_EXIT: "1" }).status, 0, "a failed apply is red");
  assert.equal(step({ SENTRY_PROJECT: "", SENTRY_ALERT_TEAM: "", SYNC_ALERTS: "false" }).status, 0, "unset: a warning");
  assert.notEqual(step({ SENTRY_PROJECT: "", SENTRY_ALERT_TEAM: "", SYNC_ALERTS: "true" }).status, 0, "an apply that cannot run is red");
  assert.match(read("chat-mobile-release-health.yml"), /^ {6}sync_alerts:\n {8}description: [^\n]+\n {8}type: boolean\n {8}default: false$/m);
});

/** A directory with a `node` that echoes its arguments and exits with $NODE_EXIT. */
function nodeStub() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "node-stub-"));
  fs.writeFileSync(path.join(bin, "node"), '#!/bin/sh\necho "node $*"\nexit "${NODE_EXIT:-0}"\n', { mode: 0o755 });
  return bin;
}

// Audit "health-gate-platform-blind" and the verifier's miss on tester builds: both variants are read every hour, and
// one red variant does not stop the other from being read.
test("release health reads production and staging every hour, each through the script, and is red when either is", () => {
  const script = stepScript("chat-mobile-release-health.yml", "- name: Read release health and stop what must stop");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "health-step-"));
  const log = path.join(dir, "calls");
  fs.mkdirSync(path.join(dir, "scripts"));
  // A stand-in script: records its arguments and variant, red for production only.
  fs.writeFileSync(
    path.join(dir, "scripts/mobile-release-health.mjs"),
    `require("fs").appendFileSync(${JSON.stringify(log)}, process.env.UNICHAT_ENV + " " + process.argv.slice(2).join(" ") + "\\n"); process.exit(process.argv.includes("production") ? 1 : 0);`,
  );
  fs.renameSync(path.join(dir, "scripts/mobile-release-health.mjs"), path.join(dir, "scripts/mobile-release-health.cjs"));
  const run = (env) => {
    fs.writeFileSync(log, "");
    let status = 0;
    try {
      execFileSync("bash", ["-c", script.replace("scripts/mobile-release-health.mjs", "scripts/mobile-release-health.cjs")], { cwd: dir, env: { PATH: process.env.PATH, RUNNER_TEMP: dir, ...env }, stdio: "ignore" });
    } catch (error) {
      status = error.status;
    }
    return { status, calls: fs.readFileSync(log, "utf8").trim().split("\n") };
  };
  const dry = run({ DRY_RUN: "true", EAS_UPDATE_PRIVATE_KEY: "" });
  assert.equal(dry.status, 1, "red because production was");
  assert.deepEqual(dry.calls, ["production --app production --dry-run", "staging --app staging --dry-run"]);
  assert.deepEqual(run({ DRY_RUN: "false", EAS_UPDATE_PRIVATE_KEY: "k" }).calls, ["production --app production", "staging --app staging"]);
  assert.ok(fs.existsSync(path.join(dir, "eas-update-private-key.pem")), "the revert key is written for the script");
  fs.rmSync(dir, { recursive: true, force: true });
});

// Audit "no-ci-rollback": a fully rolled-out OTA is rolled back from CI, signed with the key CI holds.
test("the rollback workflow is dispatched by hand, signs with the update environment's key, and acts only through the script", () => {
  const wf = read("chat-mobile-rollback.yml");
  assert.match(wf, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(wf, /^ {2}(push|pull_request|schedule):/m);
  assert.match(wf, /^ {4}environment: chat-mobile-update$/m, "the environment that holds the signing key and its reviewers");
  assert.match(wf, /^ {2}group: chat-mobile-update-\$\{\{ inputs\.channel \}\}$/m, "never races a publish on the same channel");
  assert.match(read("chat-mobile-update.yml"), /^ {2}group: chat-mobile-update-\$\{\{ inputs\.channel \}\}$/m);
  assert.equal(envPin(wf, "EAS_CLI_VERSION"), envPin(read("chat-mobile-release.yml"), "EAS_CLI_VERSION"));
  assert.match(wf, /options: \[revert-rollout, republish-previous, roll-back-to-embedded\]/);
  assert.match(wf, /node \.\.\/\.\.\/scripts\/mobile-ota-rollback\.mjs "\$\{args\[@\]\}"/);
  assert.match(wf, /rm -f "\$RUNNER_TEMP\/eas-update-private-key\.pem"/);
  assert.doesNotMatch(wf.split(/^jobs:$/m)[1] ?? "", /run: [^\n]*\$\{\{ inputs\./, "inputs reach the shell through env");
  assert.doesNotMatch(wf, /eas update --|eas build|eas submit/, "a rollback never publishes new code");
  const settings = (env) => runStep("chat-mobile-rollback.yml", "- name: Settings", env);
  assert.equal(settings({ EXPO_TOKEN: "t", EAS_UPDATE_PRIVATE_KEY: "k" }).status, 0);
  const missing = settings({ EXPO_TOKEN: "t", EAS_UPDATE_PRIVATE_KEY: "" });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout, /lacks: EAS_UPDATE_PRIVATE_KEY/);
  const runbook = fs.readFileSync(path.join(root, "docs/runbooks/unichat-mobile-release.md"), "utf8");
  const fix = runbook.split("## Khắc phục")[1]?.split("## Leo thang")[0] ?? "";
  assert.match(fix, /UniChat mobile rollback/, "the runbook's fix points at the workflow, not a laptop");
});

// The push filter is the scope script's list, and a pull request is never
// filtered: the gate job is a required check, and a workflow a path filter keeps
// from starting leaves its required check pending for ever. An edit to any of
// the four workflows (or to knip.json, which scripts/mobile-knip.test.mjs reads)
// must reach this test.
test("mobile-verify runs on every pull request, and on a push that touches what the app reads", () => {
  const wf = read("mobile-verify.yml");
  const block = (event) => wf.match(new RegExp(`^ {2}${event}:\\n([\\s\\S]*?)(?=^ {2}\\S)`, "m"))?.[1] ?? "";
  assert.doesNotMatch(block("pull_request"), /paths/, "no path filter on pull_request");
  const pushPaths = [...block("push").matchAll(/^ {6}- "([^"]+)"$/gm)].map((m) => m[1]);
  assert.deepEqual(pushPaths, MOBILE_PATHS, "the push filter is scripts/mobile-native-scope.mjs › MOBILE_PATHS");
  for (const file of WORKFLOWS) assert.ok(MOBILE_PATHS.includes(`.github/workflows/${file}`), `MOBILE_PATHS lists ${file}`);
  assert.ok(MOBILE_PATHS.includes("knip.json"), "MOBILE_PATHS lists knip.json");
});

// Audit P0 "no-branch-protection": a skipped job reports success to branch
// protection, so the gate (the one required check) must see every job, run
// whatever they did, and know when each one is needed.
test("the gate needs every job, always runs, and each job runs exactly when the gate expects it", () => {
  const { jobs } = jobsOf(read("mobile-verify.yml"));
  const gate = jobs.get("gate") ?? "";
  assert.match(gate, /^ {4}name: UniChat mobile gate$/m);
  assert.match(gate, /^ {4}if: always\(\)$/m);
  const needs = gate.match(/^ {4}needs: \[([^\]]+)\]$/m)?.[1].split(",").map((j) => j.trim()) ?? [];
  assert.deepEqual(needs.sort(), [...jobs.keys()].filter((j) => j !== "gate").sort(), "the gate needs every other job");
  assert.deepEqual(Object.keys(GATE_JOBS).sort(), needs.sort(), "scripts/mobile-verify-gate.mjs knows every job");
  assert.match(gate, /NEEDS: \$\{\{ toJSON\(needs\) \}\}\n\s+run: node scripts\/mobile-verify-gate\.mjs$/m);
  for (const [job, when] of Object.entries(GATE_JOBS)) {
    const text = jobs.get(job) ?? "";
    const condition = text.match(/^ {4}if: (.+)$/m)?.[1];
    if (when === "always") assert.equal(condition, undefined, `${job} always runs`);
    else if (job === "android-smoke") assert.match(text, /^ {4}needs: android-release$/m, "the smoke runs when the APK was built");
    else assert.equal(condition, `needs.scope.outputs.${when} == 'true'`, `${job} runs when the change is ${when}`);
  }
});

// Audit "nightly-never-scheduled": no signed-in device flow gated a merge. android-e2e starts the stack itself, so a
// PR proves sign-in, send/receive, the outbox across a kill and a second account's message after a background, with
// nothing but what the workflow brings.
test("every PR that needs the signed-in flows runs them against a server it starts, reading no secret", () => {
  const { jobs } = jobsOf(read("mobile-verify.yml"));
  const job = jobs.get("android-e2e") ?? "";
  // Review P2: not only native: a change to the flows, the seed or the server code they go through needs them too.
  assert.match(job, /^ {4}if: needs\.scope\.outputs\.e2e == 'true'$/m);
  assert.match(jobs.get("scope") ?? "", /^ {6}e2e: \$\{\{ steps\.decide\.outputs\.e2e \}\}$/m, "the scope job outputs e2e");
  assert.match(job, /^ {6}postgres:$/m, "Postgres as a service container");
  assert.match(job, /^ {6}redis:$/m, "Redis as a service container");
  assert.doesNotMatch(job, /secrets\./, "a PR job reads no secret");
  assert.match(job, /UNICHAT_ENV: dev$/m, "the variant that may talk plain http");
  // The API by the emulator's host address (airplane mode cuts it); the web pages through adb reverse (a secure context).
  assert.match(job, /UNICHAT_API_URL: http:\/\/10\.0\.2\.2:8080$/m);
  assert.match(job, /adb reverse tcp:3000 tcp:3000/);
  assert.match(job, /DEV_VERIFICATION_CODE: "123456"/);
  assert.match(job, /uniwork-chat-mobile=[^\n]*uniworkchat-dev:\/\/auth\/callback/, "the server accepts the dev build's redirect");
  assert.match(job, /run: node scripts\/mobile-e2e-seed\.mjs --api http:\/\/localhost:8080 --app http:\/\/localhost:3000 --github-env "\$GITHUB_ENV"/);
  assert.match(job, /MAESTRO_APP_SCHEME: uniworkchat-dev$/m);
  for (const flow of ["chat-read-send", "offline-send-relaunch", "background-resume"]) {
    assert.match(job, new RegExp(`maestro-retry\\.sh test flows/${flow}\\.yaml`), `${flow} runs on every PR`);
  }
  // Screenshots and server logs only: Maestro's own log holds the typed password.
  assert.match(job, /~\/\.maestro\/tests\/\*\*\/\*\.png/);
  // A flow that dies into an error screen says why: the device log of a failed flow, taken before the emulator goes
  // (scripts/maestro-retry.sh › MAESTRO_LOGCAT), in a buffer big enough for both attempts, without the password's
  // lines, its JavaScript lines in the job log, and both files in the artifact.
  assert.match(job, /^ {10}MAESTRO_LOGCAT: \$\{\{ runner\.temp \}\}\/logcat\.txt$/m);
  assert.match(job, /^ {12}adb logcat -G 16M\b/m);
  assert.match(job, /grep -vF -- "\$MAESTRO_TEST_PASSWORD" "\$log"/);
  assert.match(job, /ReactNativeJS\|ReactNative\|AndroidRuntime/);
  assert.match(job, /^ {12}\$\{\{ runner\.temp \}\}\/logcat\.txt$/m);
  assert.match(job, /^ {12}\$\{\{ runner\.temp \}\}\/logcat-js\.txt$/m);
  const logStep = job.indexOf("name: The device log of a failed flow");
  assert.ok(logStep > 0 && logStep < job.indexOf("name: maestro-e2e"), "the log is cut down before the artifact is uploaded");
});

test("mobile-verify declares the force_native input the release passes", () => {
  const wf = read("mobile-verify.yml");
  assert.match(wf, /^ {2}workflow_call:\n {4}inputs:\n(?: {6}#.*\n)* {6}force_native:\n(?: {8}\S.*\n)*? {8}type: boolean\n/m);
});

// Review P2: the Android-only callers neither wait for nor fail on the macOS build,
// and no iOS build takes whatever Xcode the runner image happens to have.
test("the Android-only callers leave iOS out, and every iOS build uses the pinned Xcode", () => {
  const wf = read("mobile-verify.yml");
  assert.match(wf, /^ {6}ios:\n {8}description: [^\n]+\n {8}type: boolean\n {8}default: false$/m, "an ios input, off by default");
  assert.match(wf, /^ {6}ios: \$\{\{ steps\.decide\.outputs\.ios \}\}$/m, "the scope job outputs ios");
  assert.match(wf, /WANT_IOS: \$\{\{ inputs\.ios \}\}/);
  for (const caller of ["chat-mobile-release.yml", "chat-mobile-update.yml"]) {
    const verify = jobsOf(read(caller)).jobs.get("verify") ?? "";
    assert.doesNotMatch(verify, /^ {6}ios: true$/m, `${caller} ships Android only (UNI-1838): no iOS build in its way`);
  }
  for (const [file, job] of [["mobile-verify.yml", "ios-release"], ["chat-mobile-verify.yml", "ios"]]) {
    const text = read(file);
    assert.match(envPin(text, "XCODE_VERSION") ?? "", /^"\d+\.\d+"$/, `${file} pins XCODE_VERSION to MAJOR.MINOR`);
    assert.match(jobsOf(text).jobs.get(job) ?? "", /run: scripts\/select-xcode\.sh "\$XCODE_VERSION"$/m, `${file} › ${job} selects the pinned Xcode`);
    assert.doesNotMatch(text, /Xcode_\*\.app \| sort -V \| tail -1/, `${file} never takes the newest Xcode on the image`);
  }
  assert.equal(envPin(wf, "XCODE_VERSION"), envPin(read("chat-mobile-verify.yml"), "XCODE_VERSION"), "one Xcode for the PR and the nightly");
});

// The iOS smoke went red on both attempts with "iOS driver not ready in time" (runs 39961695475, 39944349493): the
// first launch of Maestro's XCTest driver on a fresh simulator took 161 s and 176 s, past Maestro's 120 s default,
// and the retry started a second runner beside the first one's leftover xcodebuild.
test("every iOS job gives Maestro's driver five minutes to start, and the retry clears a timed-out one", () => {
  for (const [file, job] of [["mobile-verify.yml", "ios-release"], ["chat-mobile-verify.yml", "ios"], ["chat-mobile-store-screenshots.yml", "ios"]]) {
    const text = jobsOf(read(file)).jobs.get(job) ?? "";
    assert.ok(Number(envPin(text, "MAESTRO_DRIVER_STARTUP_TIMEOUT")?.replaceAll('"', "")) >= 300_000, `${file} › ${job} sets MAESTRO_DRIVER_STARTUP_TIMEOUT to 5 min or more`);
    if (/maestro-retry\.sh --device "\$UDID"/.test(text)) {
      assert.match(text, /\{ echo "UDID=\$udid"; echo "MAESTRO_IOS_UDID=\$udid"; \} >> "\$GITHUB_ENV"/, `${file} › ${job} hands the retry its simulator`);
    }
  }
});

// Runs the scope job's decide step as written in the workflow, with `node` stubbed
// to say what the diff would say (native=false), so only the forcing rules decide.
function decide(env) {
  const wf = read("mobile-verify.yml");
  const step = wf.split(/^ {6}- id: decide$/m)[1]?.split(/^ {6}- /m)[0] ?? "";
  const script = step.split(/^ {8}run: \|\n/m)[1]?.split("\n").filter((l) => l === "" || l.startsWith("          ")).map((l) => l.slice(10)).join("\n");
  assert.ok(script, "the decide step has a run block");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-scope-"));
  try {
    fs.writeFileSync(path.join(dir, "node"), "#!/bin/sh\necho native=false\n", { mode: 0o755 });
    const out = path.join(dir, "out");
    fs.writeFileSync(out, "");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("bash", ["-c", script], {
      cwd: root,
      env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: out, GITHUB_SHA: head, PUSH_BEFORE: head, PR_BASE: "", FORCE_NATIVE: "", WANT_IOS: "", REF: "refs/heads/main", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return fs.readFileSync(out, "utf8").trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the scope job builds natively when the release calls it, even for a re-pushed tag with a known base", () => {
  // A plain push with a known base defers to the diff, and iOS follows the native answer.
  assert.equal(decide({ EVENT: "push" }), "ios=false");
  // Review P2: the callers ship Android only, so a forced build leaves iOS out unless asked.
  const android = "mobile=true\nnative=true\ne2e=true\nios=false";
  const all = "mobile=true\nnative=true\ne2e=true\nios=true";
  assert.equal(decide({ EVENT: "push", FORCE_NATIVE: "true" }), android);
  assert.equal(decide({ EVENT: "push", FORCE_NATIVE: "true", WANT_IOS: "true" }), all);
  assert.equal(decide({ EVENT: "push", REF: "refs/tags/chat-mobile-v1.2.3" }), android);
  assert.equal(decide({ EVENT: "push", FORCE_NATIVE: "false" }), "ios=false");
  assert.equal(decide({ EVENT: "pull_request", PR_BASE: "HEAD" }), "ios=false");
  assert.equal(decide({ EVENT: "workflow_dispatch" }), all);
});

const WORKFLOWS = [
  "mobile-verify.yml",
  "chat-mobile-release.yml",
  "chat-mobile-verify.yml",
  "chat-mobile-update.yml",
  "chat-mobile-production.yml",
  "chat-mobile-promote.yml",
  "chat-mobile-release-health.yml",
  "chat-mobile-rollback.yml",
  "chat-mobile-device-farm.yml",
  "chat-mobile-store-screenshots.yml",
];

/** The workflow-level env block and each job's text, by job id. */
function jobsOf(wf) {
  const env = wf.match(/^env:\n([\s\S]*?)(?=^\S)/m)?.[1] ?? "";
  const body = wf.split(/^jobs:$/m)[1] ?? "";
  const jobs = new Map();
  const parts = body.split(/^ {2}([\w-]+):$/m);
  for (let i = 1; i < parts.length; i += 2) jobs.set(parts[i], parts[i + 1]);
  return { env, jobs };
}

// The @sentry/react-native/expo plugin wires sentry-cli into the Gradle release
// build and the Xcode bundle phase; without org, project and token it exits
// non-zero and fails the build. A Release build on a runner (no EAS profile,
// so no SENTRY_ALLOW_FAILURE) must turn the upload off.
test("every job that prebuilds and builds a Release binary on the runner turns the Sentry upload off", () => {
  let checked = 0;
  for (const file of WORKFLOWS) {
    const { env, jobs } = jobsOf(read(file));
    for (const [id, job] of jobs) {
      if (!/expo prebuild/.test(job) || !/assembleRelease|bundleRelease|-configuration Release/.test(job)) continue;
      checked += 1;
      assert.match(`${env}\n${job}`, /^\s+SENTRY_DISABLE_AUTO_UPLOAD: "true"$/m, `${file} › ${id} builds a Release binary with the Sentry upload on`);
    }
  }
  assert.ok(checked >= 4, `found ${checked} native Release jobs, expected the PR, nightly iOS/Android and production ones`);
});

/** The `run: |` block of the step after `marker` in a workflow, as the runner's shell gets it. */
function stepScript(file, marker) {
  const wf = read(file);
  const step = wf.split(marker)[1]?.split(/^ {6}- /m)[0] ?? "";
  const script = step.split(/^ {8}run: \|\n/m)[1]?.split("\n").filter((l) => l === "" || l.startsWith("          ")).map((l) => l.slice(10)).join("\n");
  assert.ok(script, `${file}: the step has a run block`);
  return script;
}

/** Runs a step's script in a scratch directory, with `extraPath` first on PATH; its status, output and outputs. */
function runScript(script, env, extraPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-step-"));
  try {
    const out = path.join(dir, "out");
    fs.writeFileSync(out, "");
    const result = { status: 0, stdout: "", stderr: "" };
    try {
      result.stdout = execFileSync("bash", ["-c", script], {
        cwd: dir,
        env: { PATH: `${extraPath ?? dir}:${process.env.PATH}`, GITHUB_OUTPUT: out, RUNNER_TEMP: dir, ...env },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      Object.assign(result, { status: error.status, stdout: String(error.stdout), stderr: String(error.stderr) });
    }
    return { ...result, outputs: Object.fromEntries(fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("="))) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs one `run: |` step of a workflow as written, with `extraPath` first on PATH. */
function runStep(file, marker, env, extraPath) {
  return runScript(stepScript(file, marker), env, extraPath);
}

// eas update does not apply a build profile's env (only --environment), so the
// workflow itself must say which variant it builds: without UNICHAT_ENV the
// update is the dev config (dev package, dev scheme, a fingerprint no store
// binary has) and reaches no phone while the run stays green.
test("an OTA update is built as the variant of the store binaries on its channel", () => {
  const eas = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/eas.json"), "utf8"));
  const wf = read("chat-mobile-update.yml");
  const channels = wf.match(/options: \[([^\]]+)\]/)?.[1].split(",").map((c) => c.trim()) ?? [];
  assert.deepEqual(channels, ["internal", "preview", "production"]);
  for (const channel of channels) {
    const { status, outputs } = runStep("chat-mobile-update.yml", /^ {6}- id: target$/m, { CHANNEL: channel });
    assert.equal(status, 0, `target step for ${channel}`);
    const profiles = Object.values(eas.build).filter((p) => p.channel === channel);
    assert.ok(profiles.length > 0, `an eas.json build profile publishes channel ${channel}`);
    for (const profile of profiles) {
      assert.equal(outputs.environment, profile.environment, `${channel}: the EAS environment of its build profile`);
      assert.equal(outputs.app_env, profile.env.UNICHAT_ENV, `${channel}: the UNICHAT_ENV of its build profile`);
    }
  }
  assert.notEqual(runStep("chat-mobile-update.yml", /^ {6}- id: target$/m, { CHANNEL: "nightly" }).status, 0, "an unknown channel fails");
  // Every step that evaluates the app config gets the variant.
  for (const step of ["- name: The update is the channel's variant, with its servers", "- id: runtime", "- id: publish"]) {
    const block = wf.split(step)[1]?.split(/^ {6}- /m)[0] ?? "";
    assert.match(block, /^ {10}UNICHAT_ENV: \$\{\{ steps\.target\.outputs\.app_env \}\}$/m, `${step} sets UNICHAT_ENV`);
  }
});

test("the OTA config check fails an update built as the wrong variant or without servers", () => {
  const marker = "- name: The update is the channel's variant, with its servers";
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-eas-"));
  try {
    // A stand-in eas-cli: `eas env:exec <env> <cmd>` prints the config in $FAKE_CONFIG.
    fs.writeFileSync(path.join(bin, "eas"), '#!/bin/sh\nprintf "%s" "$FAKE_CONFIG"\n', { mode: 0o755 });
    const check = (extra) => runStep("chat-mobile-update.yml", marker, { EAS_ENVIRONMENT: "preview", UNICHAT_ENV: "staging", FAKE_CONFIG: `Loaded env\n${JSON.stringify({ extra })}` }, bin);
    const servers = { apiUrl: "https://api.test", appUrl: "https://app.test" };
    assert.equal(check({ APP_ENV: "staging", ...servers, sentryDsn: "https://k@sentry.test/1" }).status, 0, "the right variant passes");
    const dev = check({ APP_ENV: "dev", ...servers });
    assert.notEqual(dev.status, 0, "the dev config fails");
    assert.match(dev.stderr + dev.stdout, /::error::.*dev.*staging/);
    assert.notEqual(check({ APP_ENV: "staging", apiUrl: "https://api.test" }).status, 0, "a missing server URL fails");
    assert.match(check({ APP_ENV: "staging", ...servers }).stdout, /::notice::no SENTRY_DSN/);
    // Audit "observability-optional-in-prod": production is not published blind, unless someone says so.
    const prod = (extra, env) =>
      runStep("chat-mobile-update.yml", marker, { EAS_ENVIRONMENT: "production", UNICHAT_ENV: "production", FAKE_CONFIG: JSON.stringify({ extra }), ...env }, bin);
    const full = { APP_ENV: "production", ...servers, sentryDsn: "https://k@sentry.test/1" };
    assert.equal(prod(full, { SENTRY_UPLOAD_READY: "true" }).status, 0, "crash reporting and source maps: published");
    const noDsn = prod({ ...full, sentryDsn: undefined }, { SENTRY_UPLOAD_READY: "true" });
    assert.notEqual(noDsn.status, 0, "no DSN on production is red");
    assert.match(noDsn.stdout, /::error::no SENTRY_DSN/);
    const noMaps = prod(full, { SENTRY_UPLOAD_READY: "false" });
    assert.notEqual(noMaps.status, 0, "no source-map upload settings on production is red");
    assert.match(noMaps.stdout, /::error::no SENTRY_AUTH_TOKEN/);
    const waived = prod({ ...full, sentryDsn: undefined }, { SENTRY_UPLOAD_READY: "false", ALLOW_NO_CRASH_REPORTING: "true" });
    assert.equal(waived.status, 0, "the waiver publishes");
    assert.match(waived.stdout, /::notice::no SENTRY_DSN/);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

// The store release runs from a tag; an OTA is dispatched on main or develop. One
// environment limited to chat-mobile-v* tags would refuse every OTA run.
test("the OTA publishes from its own branch-limited environment, the store release from the tag one", () => {
  assert.match(read("chat-mobile-update.yml"), /^ {4}environment: chat-mobile-update$/m);
  assert.match(read("chat-mobile-release.yml"), /^ {4}environment: chat-mobile-release$/m);
  const runbook = fs.readFileSync(path.join(root, "docs/runbooks/unichat-mobile-release.md"), "utf8");
  assert.match(runbook, /`chat-mobile-update`[^\n]*`main`[^\n]*`develop`/, "the runbook limits chat-mobile-update to main and develop");
});

// Audit P2 Release: a store release reaches a slice of phones first and widens
// only on Sentry's crash-free sessions. While the production app on Play has
// no public release, Play takes drafts only, so the stage is set by hand from
// the runbook; once it is live, the submit profile carries it.
test("a production store release is staged and promoted on crash-free sessions", () => {
  const eas = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/eas.json"), "utf8"));
  const android = eas.submit?.production?.android ?? {};
  assert.equal(android.track, "production");
  if (android.releaseStatus === "inProgress") {
    assert.ok(android.rollout > 0 && android.rollout <= 0.1, `rollout ${android.rollout} is a first stage of at most 10 %`);
  } else {
    assert.equal(android.releaseStatus, "draft", "a production submit is a draft (staged by hand) or an inProgress rollout");
    assert.equal(android.rollout, undefined, "Play ignores a rollout on a draft");
  }
  const runbook = fs.readFileSync(path.join(root, "docs/runbooks/unichat-mobile-release.md"), "utf8");
  const section = runbook.split("**Phát hành production theo giai đoạn")[1]?.split(/\n\*\*|\n## /)[0] ?? "";
  assert.ok(section, "the runbook has the staged production section");
  assert.match(section, /99\.5 %/, "promotion is gated on crash-free sessions");
  assert.match(section, /Halt rollout/, "the halt procedure");
  assert.match(section, /"releaseStatus": "inProgress", "rollout": 0\.05/, "the switch to a submitted first stage once Play is live");
  assert.match(section, /Phased release/, "the iOS counterpart");
});

// Audit P1 Perf: the app is measured on a device, and the measured build is the only one that logs its marks.
test("the smoke and the nightly time the app on the emulator against perf-budget.json; no store build logs the marks", () => {
  const verify = jobsOf(read("mobile-verify.yml")).jobs;
  assert.match(verify.get("android-release") ?? "", /^\s+UNICHAT_PERF_MARKS: "1"$/m, "the PR's release APK logs its startup marks");
  const smoke = verify.get("android-smoke") ?? "";
  assert.match(smoke, /mobile-perf\.mjs apk /, "the smoke measures the APK");
  // Ten, not five (UNI-2142): a launch on the fresh emulator varies by ~28 %, and the PR's gate is the median.
  assert.match(smoke, /mobile-perf\.mjs startup --package com\.uniworkos\.chat --mark first-screen --runs 10 /, "and ten cold starts to the first screen");
  assert.match(smoke, /mobile-perf\.mjs check /, "and holds them to the budget");
  assert.match(smoke, /name: unichat-perf-android\n/, "and keeps the numbers for `tighten`");

  // iOS (audit perf-budgets-unmeasured): the simulator build is timed too, against its own profile.
  const ios = verify.get("ios-release") ?? "";
  assert.match(ios, /^\s+UNICHAT_PERF_MARKS: "1"$/m, "the simulator build writes its startup marks");
  assert.match(ios, /mobile-perf\.mjs ios-startup --udid "\$UDID" --bundle com\.uniworkos\.chat --mark first-screen --runs 5/);
  assert.match(ios, /mobile-perf\.mjs check --profile ios-simulator /);
  assert.match(ios, /name: unichat-perf-ios-simulator\n/);

  const nightly = jobsOf(read("chat-mobile-verify.yml")).jobs.get("android") ?? "";
  assert.match(nightly, /^\s+UNICHAT_PERF_MARKS: "1"$/m, "the nightly's APK logs its startup marks");
  assert.match(nightly, /mobile-perf\.mjs startup --package "\$APP_ID" --mark inbox/, "cold starts to the inbox, signed in");
  assert.match(nightly, /dumpsys gfxinfo "\$APP_ID" reset\n[^\n]*perf-scroll-room\.yaml\n[^\n]*mobile-perf\.mjs frames/, "frames counted over the scroll alone");
  assert.match(nightly, /mobile-perf\.mjs check "\$RUNNER_TEMP\/perf\/inbox\.json" "\$RUNNER_TEMP\/perf\/scroll\.json"\n[^\n]*maestro-retry\.sh test flows\/perf-jump-quote\.yaml\n/, "a quote's jump lands, after the frames are counted");
  assert.ok(fs.existsSync(path.join(root, "apps/chat-mobile/maestro/flows/perf-jump-quote.yaml")), "the jump flow exists");
  assert.match(nightly, /name: unichat-perf-android-nightly\n/);

  // Store binaries and OTA updates never carry the flag.
  const production = jobsOf(read("chat-mobile-verify.yml")).jobs.get("android-production") ?? "";
  for (const [where, text] of [
    ["chat-mobile-release.yml", read("chat-mobile-release.yml")],
    ["chat-mobile-update.yml", read("chat-mobile-update.yml")],
    ["chat-mobile-verify.yml › android-production", production],
    ["eas.json", fs.readFileSync(path.join(root, "apps/chat-mobile/eas.json"), "utf8")],
  ]) {
    assert.doesNotMatch(text, /UNICHAT_PERF_MARKS/, `${where} must not log the startup marks`);
  }
});

// Audit "doc-drift": the nightly's header said mobile-verify built arm64 while it built x86_64.
test("the nightly's description of the PR builds names the ABI mobile-verify really builds", () => {
  const abi = read("mobile-verify.yml").match(/:app:assembleRelease [^\n]*-PreactNativeArchitectures=(\S+)/)?.[1];
  assert.ok(abi, "mobile-verify pins one ABI for the PR build");
  const header = read("chat-mobile-verify.yml").split(/^on:$/m)[0].replace(/\n# ?/g, " ");
  assert.match(header, new RegExp(`an ${abi} Android release build`), `the nightly header says ${abi}`);
  assert.doesNotMatch(header, /arm64/, "no stale ABI claim");
});

// Audit "missed: no flake handling": one retry per device run, through the
// script that reports a pass on the retry as a flaky run, never silently.
test("every Maestro run in the mobile workflows goes through scripts/maestro-retry.sh", () => {
  let runs = 0;
  for (const file of ["mobile-verify.yml", "chat-mobile-verify.yml"]) {
    const wf = read(file);
    assert.doesNotMatch(wf, /(?<![\/\w.-])maestro (?:test|--device)/, `${file}: a bare maestro run has no retry and no flake report`);
    runs += [...wf.matchAll(/\$\{\{ github\.workspace \}\}\/scripts\/maestro-retry\.sh (?:test|--device)/g)].length;
  }
  assert.ok(runs >= 13, `found ${runs} wrapped runs`);
});

// Audit "Security & privacy", no-pinning-or-attestation: the pins no OTA can change are checked against the live
// chains every day and on every PR that touches them or the hosts the deploy names (runbook unichat-tls-pins).
test("the TLS pins are checked against the live chains daily and on every PR that touches them, reading no secret", () => {
  const wf = read("chat-mobile-tls-pins.yml");
  assert.match(wf, /^ {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \*"$/m, "daily");
  assert.match(wf, /^ {2}workflow_dispatch:$/m);
  const paths = [...(wf.match(/^ {2}pull_request:\n {4}paths:\n((?: {6}- .+\n)+)/m)?.[1] ?? "").matchAll(/- (\S+)/g)].map((m) => m[1]);
  for (const file of ["apps/chat-mobile/tls-pins.json", "apps/chat-mobile/certs/tls-pins/**", "apps/chat-mobile/plugins/with-tls-pins.js", "scripts/mobile-tls-pins.mjs", "deploy/app/env/uniwork-be.env", ".github/workflows/chat-mobile-tls-pins.yml"]) {
    assert.ok(paths.includes(file), `a PR touching ${file} runs the check`);
  }
  assert.match(wf, /run: node --test scripts\/mobile-tls-pins\.test\.mjs\n/, "the contract on the committed pins");
  assert.match(wf, /run: node scripts\/mobile-tls-pins\.mjs$/m, "the live check, failing the job on a missing pin");
  assert.match(wf, /- uses: actions\/checkout@v4\n {8}with:\n {10}fetch-depth: 0\n/, "every chat-mobile-v* tag: the pin-sets of the binaries in the field are checked too");
  assert.ok(paths.includes("deploy/**/*.yaml") && paths.includes("deploy/**/*.yml"), "a PR that changes a cert-manager issuer runs the issuer contract");
  assert.doesNotMatch(wf, /secrets\.|vars\./, "a fork's PR can run it");
  assert.doesNotMatch(wf, /continue-on-error/, "a missing pin is red");
});

// A contract test that no workflow runs holds nothing: every mobile one is in the checks job's step.
test("the mobile contract step runs every mobile contract test in scripts/", () => {
  const step = read("mobile-verify.yml").match(/- name: Mobile repo contracts\n\s+run: node --test ([^\n]+)/)?.[1].split(/\s+/) ?? [];
  const tests = fs
    .readdirSync(path.join(root, "scripts"))
    .filter((f) => /^(mobile-.*|branch-protection|maestro-retry)\.test\.mjs$/.test(f))
    .map((f) => `scripts/${f}`);
  assert.deepEqual(tests.filter((t) => !step.includes(t)), [], "add these to the Mobile repo contracts step");
});

// Audit P1 "eas-path-unexercised": EAS's own archive and install path runs each night, not
// only on a release tag, without moving the store's version code.
test("the nightly builds with eas build --local, fails a scheduled run without its token, and never bumps a store build", () => {
  const wf = read("chat-mobile-verify.yml");
  assert.equal(envPin(wf, "EAS_CLI_VERSION"), envPin(read("chat-mobile-release.yml"), "EAS_CLI_VERSION"), "the same eas-cli as the store release");
  const job = jobsOf(wf).jobs.get("eas-local") ?? "";
  assert.match(job, /^ {4}environment: chat-mobile-nightly$/m, "its own environment: the OTA one wants reviewers");
  assert.match(job, /eas build --local --platform android --profile "\$PROFILE" --non-interactive/);
  // Review P2: the production profile's config (the OTA certificate check, its EAS environment) is built by EAS
  // each night, not first on a release tag.
  const profiles = [...job.matchAll(/- \{ profile: ([\w-]+), artifact: [\w.-]+ \}/g)].map((m) => m[1]);
  assert.deepEqual(profiles, ["preview", "production-check"]);
  assert.match(job, /fail-fast: false/, "one red profile does not hide the other");
  assert.match(job, /::error::EXPO_TOKEN is not set[^\n]*\n\s+exit 1/, "a night without the token is red");
  assert.match(job, /WANTED: \$\{\{ github\.event_name == 'schedule' \|\| inputs\.eas_local \}\}/);
  const eas = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/eas.json"), "utf8"));
  assert.notEqual(eas.build.preview.autoIncrement, true, "the preview profile does not move the remote version code");
  assert.equal(eas.build.preview.distribution, "internal");
  // production-check is production with only autoIncrement turned off: anything else would test another build.
  assert.deepEqual(eas.build["production-check"], { extends: "production", autoIncrement: false });
  assert.equal(eas.build.production.autoIncrement, true, "the store profile still bumps the version code");
  // It is never released: no workflow submits or publishes it.
  for (const file of WORKFLOWS.filter((f) => f !== "chat-mobile-verify.yml")) assert.doesNotMatch(read(file), /production-check/, file);
});

// Audit "no-visual-or-matrix": the oldest supported Android, middle releases and a low-RAM device.
// Audit "native-call-push-untested" and the missed upgrade path: the nightly proves, on a device, the real FCM push, an
// incoming call answered from the background and from a killed process, background resume, and an in-place upgrade.
test("the nightly rings, pushes and resumes with a second account, and upgrades over last night's build", () => {
  const { jobs } = jobsOf(read("chat-mobile-verify.yml"));
  const android = jobs.get("android") ?? "";
  assert.match(android, /GOOGLE_SERVICES_TEXT: \$\{\{ secrets\.UNICHAT_GOOGLE_SERVICES_JSON \}\}/, "the APK carries the staging Firebase file");
  assert.match(android, /name: unichat-staging-apk\n/, "and is kept for the two jobs below and for tomorrow's upgrade");
  assert.ok(android.indexOf("name: unichat-staging-apk") < android.indexOf("Run the flows on an emulator"), "kept before the flows can fail");

  const twoParty = jobs.get("android-two-party") ?? "";
  assert.match(twoParty, /^ {4}needs: \[gate, android\]$/m);
  assert.match(twoParty, /::error::The calls and real-push flows cannot run, not set:/, "a night without the second account is red");
  for (const flow of ["-e PUSH_FROM_PEER=true flows/push-open-room", "-e APP_STATE=background flows/call-answer-incoming", "-e APP_STATE=killed flows/call-answer-incoming", "flows/background-resume"]) {
    assert.match(twoParty, new RegExp(`maestro-retry\\.sh test ${flow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.yaml`), flow);
  }
  assert.match(twoParty, /target: google_apis/, "Play services, so FCM delivers");

  const upgrade = jobs.get("android-upgrade") ?? "";
  assert.match(upgrade, /^ {6}actions: read$/m, "reads last night's artifact");
  assert.match(upgrade, /gh run download "\$previous"[^\n]*-n unichat-staging-apk/);
  assert.match(upgrade, /upgrade-before\.yaml\n\s+adb install -r "[^"]*\/after\/app-release\.apk"\n[^\n]*upgrade-after\.yaml/, "installed over, not after an uninstall");
  for (const flow of ["upgrade-before", "upgrade-after"]) {
    assert.ok(fs.existsSync(path.join(root, `apps/chat-mobile/maestro/flows/${flow}.yaml`)), flow);
  }
});

test("the nightly runs the cold-start smoke on an Android matrix and keeps screenshots of each leg", () => {
  const { jobs } = jobsOf(read("chat-mobile-verify.yml"));
  const matrix = jobs.get("android-matrix") ?? "";
  const legs = [...matrix.matchAll(/- \{ api: (\d+), target: \w+, ram: (\d+), label: [\w-]+(?:, perf: ([\w-]+))? \}/g)].map((m) => ({
    api: Number(m[1]),
    ram: Number(m[2]),
    perf: m[3],
  }));
  assert.ok(legs.some((l) => l.api === 24), "React Native's minSdk 24");
  assert.ok(legs.some((l) => l.api >= 35 && l.ram <= 2048), "a 2 GB device on the newest API");
  // Audit perf-budgets-unmeasured: the low-end leg is timed and held to its own ceilings.
  assert.equal(legs.find((l) => l.ram <= 2048)?.perf, "android-2gb", "the 2 GB leg is measured");
  assert.match(matrix, /mobile-perf\.mjs startup --package com\.uniworkos\.chat --mark first-screen --runs 5/);
  assert.match(matrix, /mobile-perf\.mjs check --profile "\$\{\{ matrix\.perf \}\}"/);
  assert.match(jobs.get("android-matrix-build") ?? "", /^\s+UNICHAT_PERF_MARKS: "1"$/m, "the matrix APK logs its startup marks");
  assert.ok(legs.length >= 4);
  assert.match(matrix, /fail-fast: false/, "one red leg does not hide the others");
  assert.match(matrix, /maestro-retry\.sh test flows\/smoke-launch\.yaml\n\s+adb exec-out screencap -p > /);
  assert.match(matrix, /name: unichat-screens-\$\{\{ matrix\.label \}\}/);
  assert.match(jobs.get("android-matrix-build") ?? "", /:app:assembleRelease --no-daemon -PreactNativeArchitectures=x86_64/);
});

// scripts/select-xcode.sh, on a fake /Applications: the pinned release or its newest patch, never a beta,
// a release candidate or another minor, and red when the image lacks it.
test("select-xcode picks the pinned Xcode release and nothing else", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "select-xcode-"));
  const select = (apps, version) => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
    for (const app of apps) fs.mkdirSync(path.join(dir, `Xcode_${app}.app`));
    try {
      const out = execFileSync("bash", [path.join(root, "scripts/select-xcode.sh"), version], {
        env: { ...process.env, XCODE_APPS_DIR: dir, XCODE_SELECT_DRY_RUN: "1" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return path.basename(out.trim());
    } catch (error) {
      return `exit ${error.status}: ${String(error.stdout).trim()}`;
    }
  };
  try {
    assert.equal(select(["26.4", "27.0", "27.1", "28.0_beta"], "27.0"), "Xcode_27.0.app", "not the newest on the image");
    assert.equal(select(["27.0", "27.0.1", "27.0.10", "27.01"], "27.0"), "Xcode_27.0.10.app", "the newest patch of the pinned release");
    assert.match(select(["27.0_beta", "27.0_RC", "27.1"], "27.0"), /^exit 1: ::error::Xcode 27\.0 is not on this runner image\. It has: .*Xcode_27\.1\.app/);
    assert.match(select(["27.0"], "latest"), /^exit 2: /, "a version, not a word");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Nothing local runs a workflow or a flow: a YAML slip (an unquoted `a ? b : c` reads as a nested mapping) would show
// only on a runner, after the build. Every mobile workflow and every Maestro file parses here.
test("every mobile workflow and every Maestro flow is valid YAML", () => {
  const maestro = path.join(root, "apps/chat-mobile/maestro");
  const files = [
    ...fs.readdirSync(path.join(root, ".github/workflows")).filter((f) => /^(mobile-|chat-mobile-)/.test(f)).map((f) => path.join(root, ".github/workflows", f)),
    ...["flows", "subflows"].flatMap((dir) => fs.readdirSync(path.join(maestro, dir)).map((f) => path.join(maestro, dir, f))),
  ];
  assert.ok(files.length > 15);
  for (const file of files) {
    const errors = parseAllDocuments(fs.readFileSync(file, "utf8")).flatMap((doc) => doc.errors.map(String));
    assert.deepEqual(errors, [], path.relative(root, file));
  }
});

// Audit "Testing & quality gates", missed P2: a web PR that edits a core string left UniChat's generated copy stale and
// turned the required mobile gate red after the merge (develop, three pushes on 2026-10-22). The commit is stopped
// where the string changes, at every GATE_LEVEL, before any of the level-dependent steps.
test("a commit that changes a core string cannot leave UniChat's locales stale", () => {
  const hook = fs.readFileSync(path.join(root, ".githooks/pre-commit"), "utf8");
  const step = hook.split("# --- UniChat mobile's copy of the web's strings")[1]?.split("# --- ")[0] ?? "";
  assert.match(step, /packages\/core\/i18n\/locales\//, "watches the core locales");
  assert.match(step, /apps\/chat-mobile\/locales\//, "and the generated copy");
  assert.match(step, /node apps\/chat-mobile\/scripts\/sync-i18n\.mjs --check/);
  assert.match(step, /fail=1/);
  assert.ok(hook.indexOf("UniChat mobile's copy") < hook.indexOf('if [ "$GATE_LEVEL" = fast ]'), "outside the GATE_LEVEL switch");
});

// Audit "no-real-device-farm": real phones of the makers the first market buys, weekly, picked from Test Lab's own
// catalogue; a week without the project is red, not silently skipped.
test("the device farm runs weekly on real OEM phones it picks itself, and fails without its project", () => {
  const wf = read("chat-mobile-device-farm.yml");
  assert.match(wf, /^ {2}schedule:\n {4}- cron: "[^"]+"/m);
  assert.match(wf, /::error::The device farm cannot run, not set:/);
  assert.match(wf, /node scripts\/mobile-ftl-devices\.mjs "\$RUNNER_TEMP\/models\.json"/, "phones from the catalogue, not hard-coded ids");
  assert.match(wf, /--type robo\s*\\\n\s+--app apps\/chat-mobile\/android\/app\/build\/outputs\/apk\/release\/app-release\.apk/);
  assert.match(wf, /--type instrumentation\s*\\\n\s+--app "\$test_apk" --test "\$test_apk"/, "the calls module's shade test on each maker");
  // The one ABI built is the one the phone picker requires of every phone it takes.
  assert.match(wf, new RegExp(`-PreactNativeArchitectures=${ABI}(?![\\w,-])`), "real phones are arm64, and the picker takes only those");
  assert.match(wf, /SENTRY_DISABLE_AUTO_UPLOAD: "true"/);
});
