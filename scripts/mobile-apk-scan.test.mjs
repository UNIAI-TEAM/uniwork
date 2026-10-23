// scripts/mobile-apk-scan.mjs: the static scan of the shipped UniChat Android binary.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fakeDex, protoXml } from "./mobile-apk-scan.fixture.mjs";
import {
  REQUIRED_DEX_CLASSES,
  compare,
  dexClassDescriptors,
  dexFindings,
  isDexPath,
  manifestFindings,
  manifestPermissions,
  parseProtoXml,
  parseXmlTree,
  permissionFindings,
  scanBytes,
} from "./mobile-apk-scan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED = REQUIRED_DEX_CLASSES.map((entry) => entry.descriptor);
const JNI_INIT = "Llivekit/org/jni_zero/JniInit;";

// `aapt2 dump xmltree --file AndroidManifest.xml` of an APK linked from a test manifest (build-tools 36).
const XMLTREE = `N: android=http://schemas.android.com/apk/res/android (line=1)
  E: manifest (line=1)
    A: http://schemas.android.com/apk/res/android:compileSdkVersion(0x01010572)=36
    A: package="com.uniworkos.chat" (Raw: "com.uniworkos.chat")
      E: uses-permission (line=2)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.INTERNET" (Raw: "android.permission.INTERNET")
      E: uses-permission (line=2)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.DETECT_SCREEN_CAPTURE" (Raw: "android.permission.DETECT_SCREEN_CAPTURE")
        A: http://schemas.android.com/apk/res/android:minSdkVersion(0x0101020c)=34
      E: uses-permission (line=2)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.READ_EXTERNAL_STORAGE" (Raw: "android.permission.READ_EXTERNAL_STORAGE")
        A: http://schemas.android.com/apk/res/android:maxSdkVersion(0x01010271)=32
      E: uses-permission-sdk-23 (line=2)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.ACCESS_COARSE_LOCATION" (Raw: "android.permission.ACCESS_COARSE_LOCATION")
      E: permission (line=2)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.uniworkos.chat.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" (Raw: "com.uniworkos.chat.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
        A: http://schemas.android.com/apk/res/android:protectionLevel(0x01010009)=0x00000002
      E: uses-permission (line=2)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.uniworkos.chat.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" (Raw: "com.uniworkos.chat.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
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

/** An app bundle's base/manifest/AndroidManifest.xml under `dir`: a locked-down application asking for `permissions`. */
function writeBundleManifest(dir, permissions) {
  fs.mkdirSync(path.join(dir, "base", "manifest"), { recursive: true });
  const manifest = {
    tag: "manifest",
    attrs: { package: "com.uniworkos.chat" },
    children: [...permissions.map((name) => ({ tag: "uses-permission", attrs: { "android:name": name } })), { tag: "application", attrs: { "android:allowBackup": "false" } }],
  };
  fs.writeFileSync(path.join(dir, "base", "manifest", "AndroidManifest.xml"), protoXml(manifest));
}

test("finds credentials and prints only a hint of them", () => {
  // The jwt.io sample key, split so secret scanners do not read the fixture as a key.
  const key = ["-----BEGIN RSA " + "PRIVATE KEY-----", "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun", "VTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxK"].join("\n"); // gitleaks:allow (public jwt.io sample, test fixture)
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

// The same manifest as XMLTREE, as an app bundle carries it.
const PROTO_MANIFEST = {
  tag: "manifest",
  attrs: { "android:compileSdkVersion": "36", package: "com.uniworkos.chat" },
  children: [
    { tag: "uses-permission", attrs: { "android:name": "android.permission.INTERNET" } },
    { tag: "uses-permission", attrs: { "android:name": "android.permission.DETECT_SCREEN_CAPTURE", "android:minSdkVersion": "34" } },
    { tag: "uses-permission", attrs: { "android:name": "android.permission.READ_EXTERNAL_STORAGE", "android:maxSdkVersion": "32" } },
    { tag: "uses-permission-sdk-23", attrs: { "android:name": "android.permission.ACCESS_COARSE_LOCATION" } },
    { tag: "permission", attrs: { "android:name": "com.uniworkos.chat.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION", "android:protectionLevel": "signature" } },
    { tag: "uses-permission", attrs: { "android:name": "com.uniworkos.chat.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" } },
    {
      tag: "application",
      attrs: { "android:debuggable": "true", "android:allowBackup": "false", "android:usesCleartextTraffic": "false" },
      children: [
        { tag: "activity", attrs: { "android:name": ".MainActivity", "android:exported": "true" }, children: [{ tag: "intent-filter", children: [{ tag: "action", attrs: { "android:name": "android.intent.action.MAIN" } }] }] },
        { tag: "activity", attrs: { "android:name": "com.evil.Leaky", "android:exported": "true" } },
        { tag: "service", attrs: { "android:name": "com.x.Hidden", "android:exported": "false" } },
        { tag: "receiver", attrs: { "android:name": "androidx.profileinstaller.ProfileInstallReceiver", "android:permission": "android.permission.DUMP", "android:exported": "true" } },
        { tag: "provider", attrs: { "android:name": "com.x.Prov", "android:exported": "true" } },
        { tag: "receiver", attrs: { "android:name": "com.x.Implicit" }, children: [{ tag: "intent-filter", children: [{ tag: "action", attrs: { "android:name": "com.x.PING" } }] }] },
      ],
    },
  ],
};

const XMLTREE_PERMISSIONS = [
  { name: "android.permission.INTERNET" },
  { name: "android.permission.DETECT_SCREEN_CAPTURE", minSdkVersion: 34 },
  { name: "android.permission.READ_EXTERNAL_STORAGE", maxSdkVersion: 32 },
  { name: "android.permission.ACCESS_COARSE_LOCATION", tag: "uses-permission-sdk-23" },
  { name: "com.uniworkos.chat.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" },
];

test("lists the permissions the merged manifest asks for, with their API bounds, and not the ones it declares", () => {
  assert.deepEqual(manifestPermissions(parseXmlTree(XMLTREE)), XMLTREE_PERMISSIONS);
  assert.deepEqual(manifestPermissions(parseXmlTree("")), []);
});

test("reads an app bundle's protobuf manifest into the tree aapt2's xmltree gives for an APK", () => {
  const tree = parseProtoXml(protoXml(PROTO_MANIFEST));
  assert.deepEqual(manifestPermissions(tree), XMLTREE_PERMISSIONS);
  const proto = manifestFindings(tree);
  const apk = manifestFindings(parseXmlTree(XMLTREE));
  assert.equal(proto.packageName, "com.uniworkos.chat");
  assert.deepEqual(proto.findings, apk.findings);
  assert.throws(() => parseProtoXml(Buffer.from([0x0a, 0x7f, 0x01])), /runs past the end/);
  assert.throws(() => parseProtoXml(Buffer.from([0x0b])), /wire type 3/);
  // A manifest nested past any real one is refused, not followed until the stack runs out.
  let deep = { tag: "x" };
  for (let i = 0; i < 100; i++) deep = { tag: "x", children: [deep] };
  assert.throws(() => parseProtoXml(protoXml(deep)), /nested deeper than 64/);
});

test("a permission outside the reviewed list fails, one asked for under other API bounds fails, one no longer asked for is reported", () => {
  const allowlist = {
    permissions: [
      { name: "android.permission.INTERNET", reason: "r" },
      { name: "android.permission.DETECT_SCREEN_CAPTURE", minSdkVersion: 34, reason: "r" },
      { name: "android.permission.READ_EXTERNAL_STORAGE", reason: "r" },
      { name: "{package}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION", reason: "r" },
      { name: "android.permission.ACCESS_COARSE_LOCATION", reason: "r" },
      { name: "android.permission.CAMERA", reason: "r" },
    ],
  };
  const { findings, missing } = permissionFindings(XMLTREE_PERMISSIONS, allowlist, "com.uniworkos.chat");
  assert.deepEqual(
    findings.map((f) => [f.rule, f.name]),
    [
      ["permission-sdk-changed", "android.permission.READ_EXTERNAL_STORAGE"],
      // The sdk-23 element is another element: only an entry with that tag lists it.
      ["permission-unlisted", "android.permission.ACCESS_COARSE_LOCATION"],
    ],
  );
  assert.match(findings[0].hint, /maxSdkVersion=32.*android-permissions\.json lists it with no bounds/);
  assert.match(findings[1].hint, /<uses-permission-sdk-23 android\.permission\.ACCESS_COARSE_LOCATION> is not in android-permissions\.json/);
  assert.deepEqual(missing.map((entry) => entry.name), ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.CAMERA"]);
  assert.deepEqual(permissionFindings([], {}, "a"), { findings: [], missing: [] });
});

test("the app's reviewed permissions say who adds each one, why it stays and what Play asks of it", () => {
  const allowlist = JSON.parse(fs.readFileSync(path.join(here, "../apps/chat-mobile/android-permissions.json"), "utf8"));
  const keys = allowlist.permissions.map((entry) => `${entry.tag ?? "uses-permission"} ${entry.name}`);
  assert.equal(new Set(keys).size, keys.length, "one entry per permission element");
  for (const entry of allowlist.permissions) {
    assert.match(entry.name, /^(?:[a-z][\w]*\.)+[A-Z][A-Z0-9_]*$|^\{package\}\.[A-Z][A-Z0-9_]*$/, entry.name);
    assert.ok(String(entry.from ?? "").length >= 5, `${entry.name}: from`);
    assert.ok(String(entry.reason ?? "").length >= 30, `${entry.name}: reason`);
    assert.ok(String(entry.play ?? "").length >= 10, `${entry.name}: play`);
    for (const bound of ["minSdkVersion", "maxSdkVersion"]) if (bound in entry) assert.ok(Number.isInteger(entry[bound]), `${entry.name}: ${bound}`);
  }
  // Blocking it killed the app at launch on Android 14+ (app.config.ts › blockedPermissions).
  assert.ok(allowlist.permissions.some((entry) => entry.name === "android.permission.DETECT_SCREEN_CAPTURE" && entry.minSdkVersion === 34));
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

test("reads the classes a dex file defines, not the ones it only references", () => {
  const dex = fakeDex(["Lcom/a/Kept;", "Lcom/a/b;"], [JNI_INIT, "Ljava/lang/Object;"]);
  assert.deepEqual([...dexClassDescriptors(dex)].sort(), ["Lcom/a/Kept;", "Lcom/a/b;"]);
  assert.deepEqual([...dexClassDescriptors(fakeDex([]))], []);
  assert.throws(() => dexClassDescriptors(Buffer.from("PK\u0003\u0004")), /no dex magic/);
  const broken = fakeDex(["Lcom/a/Kept;"]);
  broken.writeUInt32LE(7, 0x70 + 8); // the class_def names a type id past the table
  assert.throws(() => dexClassDescriptors(broken), /names type 7 of 1/);
});

test("a dex file sits at an APK's root or under an AAB module's dex/", () => {
  for (const file of ["classes.dex", "classes2.dex", "classes12.dex"]) assert.ok(isDexPath(file), file);
  for (const file of ["assets/classes.dex", "assets/dex/classes.dex", "lib/dex/classes.dex", "classes1.dex", "classes.dex.prof", "lib/classes.dex", "base/dex/classes.dex"]) {
    assert.ok(!isDexPath(file), `apk: ${file}`);
  }
  for (const file of ["base/dex/classes.dex", "base/dex/classes3.dex", "calls/dex/classes2.dex"]) assert.ok(isDexPath(file, true), file);
  for (const file of ["classes.dex", "base/assets/x/classes.dex", "base/dex/other.dex", "base/dex/classes1.dex", "base/root/dex/classes.dex"]) {
    assert.ok(!isDexPath(file, true), `aab: ${file}`);
  }
});

test("every class found by name must be defined in some dex file; a miss names the class and the keep rule", () => {
  const split = [
    { file: "base/dex/classes.dex", bytes: fakeDex(REQUIRED.slice(0, 2)) },
    { file: "base/dex/classes2.dex", bytes: fakeDex(REQUIRED.slice(2)) },
  ];
  assert.deepEqual(dexFindings(split), [], "multidex: the classes may sit in any file");

  // 0.3.0 (11): R8 removed JniInit; another class still names it, which is not a definition.
  const lost = dexFindings([{ file: "classes.dex", bytes: fakeDex(REQUIRED.filter((d) => d !== JNI_INIT), [JNI_INIT]) }]);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].rule, "dex-class-missing");
  assert.equal(lost[0].file, "classes*.dex");
  assert.equal(lost[0].name, JNI_INIT);
  assert.match(lost[0].hint, /Llivekit\/org\/jni_zero\/JniInit; is not defined in any of 1 dex file\(s\)/);
  assert.match(lost[0].hint, /Keep it with "-keep class livekit\.org\.jni_zero\.\*\* \{ \*; \}" in ANDROID_KEEP_RULES \(apps\/chat-mobile\/app\.config\.ts\)$/);

  const library = dexFindings([{ file: "classes.dex", bytes: fakeDex(["Lcom/x/A;"]) }], [{ descriptor: "Lcom/x/B;", keep: "-keep class com.x.** { *; }", by: "x's consumer-rules" }]);
  assert.match(library[0].hint, /; x's consumer-rules carried that rule until now$/);

  assert.deepEqual(dexFindings([]).map((f) => f.rule), ["no-dex"], "a binary with no code is wrong");
  const unreadable = dexFindings([{ file: "classes.dex", bytes: Buffer.from("not a dex file at all") }, { file: "classes2.dex", bytes: fakeDex(REQUIRED) }]);
  assert.deepEqual(unreadable.map((f) => [f.rule, f.file]), [["dex-unreadable", "classes.dex"]]);
  const onlyUnreadable = dexFindings([{ file: "classes.dex", bytes: Buffer.from("not a dex file at all") }]);
  assert.deepEqual(onlyUnreadable.map((f) => f.rule), ["dex-unreadable"], "an unreadable file is the finding, not six classes R8 never touched");
});

test("the required classes and ANDROID_KEEP_RULES (apps/chat-mobile/app.config.ts) name each other", () => {
  const config = fs.readFileSync(path.join(here, "../apps/chat-mobile/app.config.ts"), "utf8");
  const block = /export const ANDROID_KEEP_RULES = \[([^\]]*)\]\.join/.exec(config);
  assert.ok(block, "ANDROID_KEEP_RULES is an array literal of strings joined by newlines");
  const rules = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(rules.length > 0);
  const rest = block[1].replace(/"[^"]*"/g, "").replace(/\/\/[^\n]*/g, "").replace(/[\s,]/g, "");
  assert.equal(rest, "", "ANDROID_KEEP_RULES holds only double-quoted strings: a spread or another quote would hide a rule from this check");
  for (const rule of rules) {
    const pkg = /^-keep class ([\w.]+)\.\*\* \{ \*; \}$/.exec(rule);
    assert.ok(pkg, `${rule}: REQUIRED_DEX_CLASSES only knows "-keep class <package>.** { *; }"; teach it the new shape`);
    assert.ok(
      REQUIRED_DEX_CLASSES.some((entry) => entry.keep === rule && entry.by === "ANDROID_KEEP_RULES"),
      `${rule} keeps something native code finds by name: list one such class under ${pkg[1]} in scripts/mobile-apk-scan.mjs › REQUIRED_DEX_CLASSES`,
    );
  }
  for (const { descriptor, keep, by } of REQUIRED_DEX_CLASSES) {
    const pkg = /^-keep class ([\w.]+)\.\*\* \{ \*; \}$/.exec(keep);
    assert.ok(pkg && descriptor.startsWith(`L${pkg[1].replaceAll(".", "/")}/`) && descriptor.endsWith(";"), `${descriptor} sits under ${keep}`);
    if (by === "ANDROID_KEEP_RULES") assert.ok(rules.includes(keep), `${descriptor}: ${keep} is not in ANDROID_KEEP_RULES any more`);
    else assert.ok(!rules.includes(keep) && by.length >= 10, `${descriptor}: say which library's rules keep it, or mark it ANDROID_KEEP_RULES`);
  }
  assert.ok(REQUIRED.includes(JNI_INIT) && REQUIRED.includes("Llivekit/org/webrtc/PeerConnectionFactory;"));
  assert.equal(new Set(REQUIRED).size, REQUIRED.length);
});

test("scans an archive end to end and fails on a credential the baseline does not name", { skip: spawnSync("zip", ["-v"]).status !== 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apk-scan-test-"));
  try {
    fs.mkdirSync(path.join(dir, "base", "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "base", "assets", "index.android.bundle"), `var a = 1; var token = "ghp_${"z".repeat(36)}";`);
    fs.mkdirSync(path.join(dir, "base", "dex"));
    fs.writeFileSync(path.join(dir, "base", "dex", "classes.dex"), fakeDex(REQUIRED));
    writeBundleManifest(dir, ["android.permission.INTERNET"]);
    execFileSync("zip", ["-qr", "app.aab", "base"], { cwd: dir });
    const baseline = path.join(dir, "baseline.json");
    fs.writeFileSync(baseline, JSON.stringify({ exported: [], secrets: [] }));
    const permissions = path.join(dir, "android-permissions.json");
    fs.writeFileSync(permissions, JSON.stringify({ permissions: [{ name: "android.permission.INTERNET" }] }));
    const scanArgs = [path.join(here, "mobile-apk-scan.mjs"), path.join(dir, "app.aab"), "--baseline", baseline, "--permissions", permissions];
    const run = spawnSync(process.execPath, scanArgs, { encoding: "utf8" });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /::error::github-token in base\/assets\/index\.android\.bundle at \d+: ghp_zz…/);
    assert.ok(!run.stdout.includes("z".repeat(10)), "the log never carries the value");

    fs.writeFileSync(baseline, JSON.stringify({ exported: [], secrets: [{ rule: "github-token", file: "base/assets/index.android.bundle", reason: "fixture" }] }));
    const excused = spawnSync(process.execPath, scanArgs, { encoding: "utf8" });
    assert.equal(excused.status, 0, excused.stdout + excused.stderr);
    assert.match(excused.stdout, /permissions: 1 asked for \(base\/manifest\/AndroidManifest\.xml\), every one reviewed/);
    assert.match(excused.stdout, /dex: 1 file\(s\) define all \d+ class\(es\) found by name/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fails an archive whose dex lost a class found by name, or that has no dex at all", { skip: spawnSync("zip", ["-v"]).status !== 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apk-scan-test-"));
  try {
    const baseline = path.join(dir, "baseline.json");
    fs.writeFileSync(baseline, JSON.stringify({ exported: [], secrets: [] }));
    const scan = () => spawnSync(process.execPath, [path.join(here, "mobile-apk-scan.mjs"), path.join(dir, "app.aab"), "--baseline", baseline], { encoding: "utf8" });
    fs.mkdirSync(path.join(dir, "base", "dex"), { recursive: true });
    fs.writeFileSync(path.join(dir, "base", "dex", "classes.dex"), fakeDex(REQUIRED.filter((d) => d !== JNI_INIT)));
    fs.writeFileSync(path.join(dir, "base", "dex", "classes2.dex"), fakeDex(["Lcom/a/Other;"], [JNI_INIT]));
    execFileSync("zip", ["-qr", "app.aab", "base"], { cwd: dir });
    const lost = scan();
    assert.equal(lost.status, 1, lost.stdout + lost.stderr);
    assert.match(lost.stdout, /::error::dex-class-missing in base\/dex\/classes\*\.dex: Llivekit\/org\/jni_zero\/JniInit; is not defined in any of 2 dex file\(s\).*"-keep class livekit\.org\.jni_zero\.\*\* \{ \*; \}"/);

    fs.rmSync(path.join(dir, "app.aab"));
    fs.rmSync(path.join(dir, "base", "dex"), { recursive: true });
    fs.mkdirSync(path.join(dir, "base", "assets"));
    fs.writeFileSync(path.join(dir, "base", "assets", "index.android.bundle"), "var a = 1;");
    execFileSync("zip", ["-qr", "app.aab", "base"], { cwd: dir });
    const empty = scan();
    assert.equal(empty.status, 1, empty.stdout + empty.stderr);
    assert.match(empty.stdout, /::error::no-dex in classes\*\.dex: the archive has no dex file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fails an app bundle that asks for a permission the reviewed list does not name, or that has no manifest", { skip: spawnSync("zip", ["-v"]).status !== 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apk-scan-test-"));
  try {
    fs.mkdirSync(path.join(dir, "base", "dex"), { recursive: true });
    fs.writeFileSync(path.join(dir, "base", "dex", "classes.dex"), fakeDex(REQUIRED));
    writeBundleManifest(dir, ["android.permission.INTERNET", "android.permission.READ_CONTACTS"]);
    execFileSync("zip", ["-qr", "app.aab", "base"], { cwd: dir });
    const baseline = path.join(dir, "baseline.json");
    fs.writeFileSync(baseline, JSON.stringify({ exported: [], secrets: [] }));
    const permissions = path.join(dir, "android-permissions.json");
    fs.writeFileSync(permissions, JSON.stringify({ permissions: [{ name: "android.permission.INTERNET" }, { name: "android.permission.CAMERA" }] }));
    const scan = () => spawnSync(process.execPath, [path.join(here, "mobile-apk-scan.mjs"), path.join(dir, "app.aab"), "--baseline", baseline, "--permissions", permissions], { encoding: "utf8" });
    const added = scan();
    assert.equal(added.status, 1, added.stdout + added.stderr);
    assert.match(added.stdout, /::error::permission-unlisted in AndroidManifest\.xml: <uses-permission android\.permission\.READ_CONTACTS> is not in android-permissions\.json/);
    assert.match(added.stdout, /::notice::android-permissions\.json lists <uses-permission android\.permission\.CAMERA>, which the binary no longer asks for: drop it/);

    fs.rmSync(path.join(dir, "app.aab"));
    fs.rmSync(path.join(dir, "base", "manifest"), { recursive: true });
    execFileSync("zip", ["-qr", "app.aab", "base"], { cwd: dir });
    const none = scan();
    assert.equal(none.status, 1, none.stdout + none.stderr);
    assert.match(none.stdout, /::error::no-manifest in base\/manifest\/AndroidManifest\.xml: an app bundle without its base module's manifest/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to run without an archive", () => {
  const run = spawnSync(process.execPath, [path.join(here, "mobile-apk-scan.mjs")], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /usage/);
});
