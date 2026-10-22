// scripts/mobile-apk-scan.mjs: the static scan of the shipped UniChat Android binary.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compare, manifestFindings, parseXmlTree, scanBytes } from "./mobile-apk-scan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// `aapt2 dump xmltree --file AndroidManifest.xml` of an APK linked from a test manifest (build-tools 36).
const XMLTREE = `N: android=http://schemas.android.com/apk/res/android (line=1)
  E: manifest (line=1)
    A: http://schemas.android.com/apk/res/android:compileSdkVersion(0x01010572)=36
    A: package="com.uniworkos.chat" (Raw: "com.uniworkos.chat")
      E: uses-permission (line=2)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.INTERNET" (Raw: "android.permission.INTERNET")
      E: application (line=3)
        A: http://schemas.android.com/apk/res/android:debuggable(0x0101000f)=true
        A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false
        A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=false
          E: activity (line=4)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)=".MainActivity" (Raw: ".MainActivity")
            A: http://schemas.android.com/apk/res/android:exported(0x01010010)=true
              E: intent-filter (line=5)
                  E: action (line=5)
                    A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.action.MAIN" (Raw: "android.intent.action.MAIN")
          E: activity (line=7)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.evil.Leaky" (Raw: "com.evil.Leaky")
            A: http://schemas.android.com/apk/res/android:exported(0x01010010)=true
          E: service (line=8)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.x.Hidden" (Raw: "com.x.Hidden")
            A: http://schemas.android.com/apk/res/android:exported(0x01010010)=false
          E: receiver (line=9)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="androidx.profileinstaller.ProfileInstallReceiver" (Raw: "androidx.profileinstaller.ProfileInstallReceiver")
            A: http://schemas.android.com/apk/res/android:permission(0x01010006)="android.permission.DUMP" (Raw: "android.permission.DUMP")
            A: http://schemas.android.com/apk/res/android:exported(0x01010010)=true
          E: provider (line=10)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.x.Prov" (Raw: "com.x.Prov")
            A: http://schemas.android.com/apk/res/android:exported(0x01010010)=true
          E: receiver (line=11)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.x.Implicit" (Raw: "com.x.Implicit")
              E: intent-filter (line=12)
                  E: action (line=12)
                    A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.x.PING" (Raw: "com.x.PING")
`;

test("finds credentials and prints only a hint of them", () => {
  const key = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun", "VTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxK"].join("\n");
  const sentry = `sntrys_${"eyJpYXQiOjE3MDAwMDAwMDAsInVybCI6Imh0dHBzOi8vc2VudHJ5LmlvIn0".repeat(2)}`;
  const text = [
    key,
    sentry,
    "ghp_" + "a".repeat(36),
    "AKIA" + "ABCDEFGHIJKLMNOP",
    '{"type": "service_account", "project_id": "x"}',
    "xoxb-1234567890-abcdef",
    "sk_live_" + "a".repeat(24),
    "sk-ant-api03-" + "b".repeat(40),
    "sk-proj-" + "c".repeat(48),
    "uwm_at_" + "d".repeat(24),
  ].join("\n");
  const findings = scanBytes("assets/index.android.bundle", Buffer.from(text, "latin1"));
  assert.deepEqual(
    findings.map((f) => f.rule),
    ["private-key", "sentry-auth-token", "github-token", "aws-access-key", "google-service-account", "slack-token", "stripe-live-key", "anthropic-key", "openai-key", "uniwork-token"],
  );
  for (const finding of findings) {
    assert.equal(finding.file, "assets/index.android.bundle");
    assert.match(finding.hint, /^.{1,6}… \(\d+ chars\)$/);
  }
  assert.ok(!findings.some((f) => f.hint.includes("a".repeat(10))), "a hint never carries the value");
});

test("leaves what only looks like a credential: a PEM parser's header, a public Firebase key, words", () => {
  const text = [
    'const HEADER = "-----BEGIN PRIVATE KEY-----"; const FOOTER = "-----END PRIVATE KEY-----";',
    '"current_key": "AIzaSyD-public-firebase-key-restricted-to-the-app"',
    "task-1234567890123456789012345678901234567890123",
    "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "AKIAlowercase",
  ].join("\n");
  assert.deepEqual(scanBytes("classes.dex", text), []);
});

test("reads aapt2's xmltree and flags a debuggable app and every component reachable without a permission", () => {
  const { packageName, findings } = manifestFindings(parseXmlTree(XMLTREE));
  assert.equal(packageName, "com.uniworkos.chat");
  assert.deepEqual(
    findings.map((f) => [f.rule, f.name]),
    [
      ["debuggable", undefined],
      ["exported-unprotected", "com.uniworkos.chat.MainActivity"],
      ["exported-unprotected", "com.evil.Leaky"],
      ["exported-unprotected", "com.x.Prov"],
      // No `exported` attribute and an intent filter: reachable, as on Android before 12.
      ["exported-unprotected", "com.x.Implicit"],
    ],
  );
});

test("flags backup, cleartext and testOnly, and a dump without a manifest", () => {
  const tree = parseXmlTree(`  E: manifest (line=1)
    A: package="a.b" (Raw: "a.b")
      E: application (line=2)
        A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=true
        A: http://schemas.android.com/apk/res/android:testOnly(0x01010272)=0xffffffff
`);
  assert.deepEqual(
    manifestFindings(tree).findings.map((f) => f.rule),
    ["test-only", "allow-backup", "cleartext"],
  );
  assert.deepEqual(manifestFindings(parseXmlTree("")).findings.map((f) => f.rule), ["no-manifest"]);
  assert.deepEqual(manifestFindings(parseXmlTree('  E: manifest (line=1)\n    A: package="a.b" (Raw: "a.b")\n')).findings, []);
});

test("the baseline excuses what it names, for this package, and reports what it names in vain", () => {
  const { packageName, findings } = manifestFindings(parseXmlTree(XMLTREE));
  const secret = { kind: "secret", rule: "aws-access-key", file: "res/raw/x", hint: "AKIA…" };
  const baseline = {
    exported: [
      { name: "{package}.MainActivity", reason: "launcher" },
      { name: "com.gone.Activity", reason: "was there" },
    ],
    secrets: [{ rule: "aws-access-key", file: "res/raw/x", reason: "test fixture" }],
  };
  const { fresh, stale } = compare([...findings, secret], baseline, packageName);
  assert.deepEqual(
    fresh.map((f) => f.name ?? f.rule),
    ["debuggable", "com.evil.Leaky", "com.x.Prov", "com.x.Implicit"],
  );
  assert.deepEqual(stale, [{ name: "com.gone.Activity", reason: "was there" }]);
  assert.deepEqual(compare([], {}, "a").fresh, []);
});

test("the app's baseline names a reason for every exception", () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(here, "../apps/chat-mobile/apk-scan-baseline.json"), "utf8"));
  for (const entry of [...baseline.exported, ...baseline.secrets]) assert.ok(String(entry.reason ?? "").length >= 20, JSON.stringify(entry));
});

test("scans an archive end to end and fails on a credential the baseline does not name", { skip: spawnSync("zip", ["-v"]).status !== 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apk-scan-test-"));
  try {
    fs.mkdirSync(path.join(dir, "base", "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "base", "assets", "index.android.bundle"), `var a = 1; var token = "ghp_${"z".repeat(36)}";`);
    execFileSync("zip", ["-qr", "app.aab", "base"], { cwd: dir });
    const baseline = path.join(dir, "baseline.json");
    fs.writeFileSync(baseline, JSON.stringify({ exported: [], secrets: [] }));
    const run = spawnSync(process.execPath, [path.join(here, "mobile-apk-scan.mjs"), path.join(dir, "app.aab"), "--baseline", baseline], { encoding: "utf8" });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /::error::github-token in base\/assets\/index\.android\.bundle at \d+: ghp_zz…/);
    assert.ok(!run.stdout.includes("z".repeat(10)), "the log never carries the value");

    fs.writeFileSync(baseline, JSON.stringify({ exported: [], secrets: [{ rule: "github-token", file: "base/assets/index.android.bundle", reason: "fixture" }] }));
    const excused = spawnSync(process.execPath, [path.join(here, "mobile-apk-scan.mjs"), path.join(dir, "app.aab"), "--baseline", baseline], { encoding: "utf8" });
    assert.equal(excused.status, 0, excused.stdout + excused.stderr);
    assert.match(excused.stdout, /only the secret scan ran/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to run without an archive", () => {
  const run = spawnSync(process.execPath, [path.join(here, "mobile-apk-scan.mjs")], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /usage/);
});
