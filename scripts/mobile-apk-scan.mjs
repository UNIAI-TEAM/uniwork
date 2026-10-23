#!/usr/bin/env node
// A static security scan of the UniChat Android binary that ships (audit
// "Security & privacy", no-ci-binary-security-scan). android-manifest.test.ts
// pins what the source tree asks for; this reads the artifact itself, after
// Gradle merged every library's manifest and the bundler, R8 and the build's
// environment had their say, and fails on what only the artifact can show:
//
//   secrets   every file in the archive (dex, the Hermes bundle, native
//             libraries, assets, resources) searched for credentials that must
//             never ship: private keys, Sentry auth tokens, cloud and
//             third-party API keys, a Play service account, UniWork's own
//             tokens. A hit is printed as rule, file and a few characters,
//             never the value.
//   manifest  (an APK through `aapt2 dump xmltree`; an AAB's
//             base/manifest/AndroidManifest.xml, aapt2's protobuf XmlNode,
//             through parseProtoXml): the application is not debuggable or
//             testOnly, allows no backup and no cleartext, and no component
//             is reachable from other apps (exported, or an intent filter
//             without an `exported` attribute) without a permission guarding
//             it, unless the baseline names it with a reason.
//   permissions  (the same manifest) every <uses-permission> and
//             <uses-permission-sdk-23>, with its minSdkVersion and
//             maxSdkVersion, is in apps/chat-mobile/android-permissions.json,
//             the reviewed list (who adds it, why it stays, what Play asks).
//             Gradle merges in the permissions of every Maven library
//             (ShortcutBadger, firebase-messaging, androidx.core…), which
//             android-manifest.test.ts cannot see: a library update that adds
//             one fails here, and a listed one the binary stopped asking for
//             is reported so the list can drop it.
//   dex       (an APK or an AAB) the archive's dex files define every class in
//             REQUIRED_DEX_CLASSES: what native code or Android finds by name,
//             which R8 drops or renames when no keep rule covers it, and the
//             app dies at launch (0.3.0 (11) reached Play without WebRTC's
//             livekit.org.jni_zero.JniInit). An archive with no dex fails too.
//
// The baseline (apps/chat-mobile/apk-scan-baseline.json) is the reviewed
// exceptions, each with a reason; `{package}` in a name stands for the
// manifest's package. A finding outside it fails the run; a baseline entry
// nothing matched any more is reported so it can be dropped.
//
//   node scripts/mobile-apk-scan.mjs <app.apk|app.aab> [--baseline <file>] [--permissions <file>] [--aapt2 <path>]
//
// aapt2 (an APK only) is found from --aapt2, AAPT2, or the newest build-tools under
// ANDROID_HOME / ANDROID_SDK_ROOT (GitHub's Ubuntu runners have one). Runs in
// mobile-verify.yml › android-release on the CI release APK and in
// chat-mobile-production.yml on the EAS-built AAB before it is submitted.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = path.resolve(here, "../apps/chat-mobile/apk-scan-baseline.json");
const DEFAULT_PERMISSIONS = path.resolve(here, "../apps/chat-mobile/android-permissions.json");
/** Where an app bundle keeps the base module's manifest, in aapt2's protobuf XML. */
const BUNDLE_MANIFEST = "base/manifest/AndroidManifest.xml";

/** Credentials that never belong in a phone app, by rule name. */
export const SECRET_RULES = [
  // The header with key material under it: a PEM parser's own "-----BEGIN PRIVATE KEY-----" constant is not a key.
  ["private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----\s*[A-Za-z0-9+/=]{20,}[\s\\n]+[A-Za-z0-9+/=]{20,}/g],
  ["sentry-auth-token", /\bsntry[su]_[A-Za-z0-9+/=_-]{32,}/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["google-service-account", /"type"\s*:\s*"service_account"/g],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["stripe-live-key", /\b[rs]k_live_[A-Za-z0-9]{20,}/g],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{32,}/g],
  ["openai-key", /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{40,}/g],
  ["uniwork-token", /\buwm_(?:at|rt)_[A-Za-z0-9_-]{16,}/g],
];

/**
 * Classes the shipped dex must define under their own name, each with the keep rule that holds it and who carries
 * that rule today: "ANDROID_KEEP_RULES" (apps/chat-mobile/app.config.ts) or a library's consumer rules. Every
 * `-keep class <pkg>.**` in ANDROID_KEEP_RULES has an entry here under that package and every entry kept by
 * ANDROID_KEEP_RULES names one of its rules (mobile-apk-scan.test.mjs), so the two lists cannot drift apart.
 * List only a name R8 keeps as it is (read it from a release dex): an obfuscated one (com.oney.WebRTCModule.q)
 * changes with every build. Each was read from 0.3.0 (11)'s native libraries, manifest or module config.
 */
export const REQUIRED_DEX_CLASSES = [
  // liblkjingle_peerconnection_so.so's JNI_OnLoad finds it and traps without it: every launch dies.
  { descriptor: "Llivekit/org/jni_zero/JniInit;", keep: "-keep class livekit.org.jni_zero.** { *; }", by: "ANDROID_KEEP_RULES" },
  // The same library registers its natives on it; the first call builds one.
  { descriptor: "Llivekit/org/webrtc/PeerConnectionFactory;", keep: "-keep class livekit.org.webrtc.** { *; }", by: "@livekit/react-native-webrtc consumer-rules" },
  // libNitroModules.so and libNitroMmkv.so bind these through fbjni; MMKV holds the app's storage, read at boot.
  { descriptor: "Lcom/margelo/nitro/core/HybridObject;", keep: "-keep class com.margelo.nitro.** { *; }", by: "ANDROID_KEEP_RULES" },
  { descriptor: "Lcom/margelo/nitro/mmkv/HybridMMKVPlatformContextSpec;", keep: "-keep class com.margelo.nitro.** { *; }", by: "ANDROID_KEEP_RULES" },
  // The call module, named by modules/unichat-calls/expo-module.config.json, and the service the manifest names as
  // the first stop of every FCM message.
  { descriptor: "Lexpo/modules/unichatcalls/UniChatCallsModule;", keep: "-keep class expo.modules.unichatcalls.** { *; }", by: "ANDROID_KEEP_RULES" },
  { descriptor: "Lexpo/modules/unichatcalls/UniChatMessagingService;", keep: "-keep class expo.modules.unichatcalls.** { *; }", by: "ANDROID_KEEP_RULES" },
];

/**
 * A dex file Android loads: classes.dex, classes2.dex… at an APK's root, or in an AAB module's dex/ (base/dex/). Only
 * the layout of the archive's own kind counts, so a stray assets/dex/classes.dex cannot stand in for the real code.
 */
export const isDexPath = (file, bundle = false) =>
  (bundle ? /^[^/]+\/dex\/classes(?:[2-9]|[1-9]\d+)?\.dex$/ : /^classes(?:[2-9]|[1-9]\d+)?\.dex$/).test(file);

/** The type descriptors of the classes one dex file defines (class_defs → type_ids → string_ids), not the ones it only references. */
export function dexClassDescriptors(bytes) {
  if (bytes.length < 0x70 || bytes.toString("latin1", 0, 4) !== "dex\n") throw new Error("no dex magic");
  const u32 = (at) => bytes.readUInt32LE(at);
  const [stringCount, stringIds, typeCount, typeIds, classCount, classDefs] = [u32(56), u32(60), u32(64), u32(68), u32(96), u32(100)];
  const defined = new Set();
  for (let i = 0; i < classCount; i++) {
    const type = u32(classDefs + i * 32);
    if (type >= typeCount) throw new Error(`class_def ${i} names type ${type} of ${typeCount}`);
    const string = u32(typeIds + type * 4);
    if (string >= stringCount) throw new Error(`type ${type} names string ${string} of ${stringCount}`);
    let at = u32(stringIds + string * 4);
    while (at < bytes.length && bytes[at] & 0x80) at++; // the uleb128 UTF-16 length
    at++;
    const end = bytes.indexOf(0, at);
    if (at > bytes.length || end === -1) throw new Error(`string ${string} runs past the end`);
    defined.add(bytes.toString("latin1", at, end));
  }
  return defined;
}

/** What the archive's dex files miss of `required`: nothing to read, an unreadable file, a class no file defines. */
export function dexFindings(dexFiles, required = REQUIRED_DEX_CLASSES) {
  if (dexFiles.length === 0) return [{ kind: "dex", rule: "no-dex", file: "classes*.dex", hint: "the archive has no dex file: a binary with no code is not the app" }];
  const findings = [];
  const defined = new Set();
  for (const { file, bytes } of dexFiles) {
    try {
      for (const descriptor of dexClassDescriptors(bytes)) defined.add(descriptor);
    } catch (error) {
      findings.push({ kind: "dex", rule: "dex-unreadable", file, hint: `${error.message}: its classes cannot be checked` });
    }
  }
  // A file that cannot be read may define what looks missing: say so once, not "R8 dropped it" for every class.
  if (findings.length > 0) return findings;
  const where = path.posix.join(path.posix.dirname(dexFiles[0].file), "classes*.dex");
  for (const { descriptor, keep, by } of required) {
    if (defined.has(descriptor)) continue;
    findings.push({
      kind: "dex",
      rule: "dex-class-missing",
      file: where,
      name: descriptor,
      hint:
        `${descriptor} is not defined in any of ${dexFiles.length} dex file(s), yet native code or Android finds it by name: R8 dropped or ` +
        `renamed it. Keep it with "${keep}" in ANDROID_KEEP_RULES (apps/chat-mobile/app.config.ts)` +
        (by === "ANDROID_KEEP_RULES" ? "" : `; ${by} carried that rule until now`),
    });
  }
  return findings;
}

/** The rule hits in one file's bytes: rule, file, offset and a hint that is never the value. */
export function scanBytes(file, bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("latin1") : String(bytes);
  const findings = [];
  for (const [rule, pattern] of SECRET_RULES) {
    for (const match of text.matchAll(pattern)) {
      findings.push({ kind: "secret", rule, file, offset: match.index, hint: `${match[0].slice(0, 6)}… (${match[0].length} chars)` });
    }
  }
  return findings;
}

/** `aapt2 dump xmltree` output as a tree of { tag, attrs, children }. */
export function parseXmlTree(text) {
  const root = { tag: "#root", attrs: {}, children: [], depth: -1 };
  const stack = [root];
  for (const line of text.split("\n")) {
    const match = /^(\s*)([NEA]): (.*)$/.exec(line);
    if (!match) continue;
    const [, indent, kind, rest] = match;
    const depth = indent.length;
    if (kind === "N") continue;
    while (stack.length > 1 && stack.at(-1).depth >= depth) stack.pop();
    const parent = stack.at(-1);
    if (kind === "E") {
      const node = { tag: rest.replace(/ \(line=\d+\)$/, ""), attrs: {}, children: [], depth };
      parent.children.push(node);
      stack.push(node);
      continue;
    }
    // A: <ns>:name(0x…)=value  |  A: name="value" (Raw: "value")
    const attr = /^(?:[^:]+:\/\/[^:]+:)?([A-Za-z_][\w-]*)(?:\(0x[0-9a-f]+\))?=(.*)$/.exec(rest);
    if (!attr) continue;
    const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(attr[2]);
    parent.attrs[attr[1]] = quoted ? quoted[1] : attr[2].trim();
  }
  return root;
}

/**
 * The fields of one protobuf message: { field, value } for a varint, { field, bytes } for a length-delimited one; the
 * fixed-width ones are skipped. Enough of the wire format for aapt2's XML messages, which hold nothing else.
 */
function protoFields(bytes) {
  const fields = [];
  let at = 0;
  const varint = () => {
    let value = 0;
    for (let scale = 1; ; scale *= 128) {
      if (at >= bytes.length) throw new Error("a protobuf varint runs past the end");
      if (scale > 2 ** 56) throw new Error("a protobuf varint is longer than 64 bits");
      const byte = bytes[at++];
      value += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) return value;
    }
  };
  const skip = (count) => {
    if (at + count > bytes.length) throw new Error("a protobuf field runs past the end");
    at += count;
  };
  while (at < bytes.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) fields.push({ field, value: varint() });
    else if (wire === 2) {
      const length = varint();
      const start = at;
      skip(length);
      fields.push({ field, bytes: bytes.subarray(start, at) });
    } else if (wire === 1) skip(8);
    else if (wire === 5) skip(4);
    else throw new Error(`protobuf wire type ${wire} is not one aapt2 writes`);
  }
  return fields;
}

const MAX_XML_DEPTH = 64;

/**
 * An app bundle's manifest (aapt2's XmlNode, frameworks/base/tools/aapt2/Resources.proto) as the tree parseXmlTree
 * builds from `aapt2 dump xmltree`: XmlNode.element (1) → XmlElement { name 3, attribute 4, child 5 } → XmlAttribute
 * { name 2, value 3 }. The value is the attribute as written ("true", "34", ".MainActivity"), which aapt2 keeps beside
 * the compiled item, so the manifest checks read both formats alike. Namespaces are dropped, as parseXmlTree drops them.
 */
export function parseProtoXml(bytes) {
  const root = { tag: "#root", attrs: {}, children: [], depth: -1 };
  const text = (fields, number) => fields.find((f) => f.field === number && f.bytes)?.bytes.toString("utf8") ?? "";
  const node = (nodeBytes, parent, depth) => {
    if (depth >= MAX_XML_DEPTH) throw new Error(`the manifest is nested deeper than ${MAX_XML_DEPTH} elements`);
    for (const { field, bytes: elementBytes } of protoFields(nodeBytes)) {
      if (field !== 1 || !elementBytes) continue;
      const fields = protoFields(elementBytes);
      const element = { tag: text(fields, 3), attrs: {}, children: [], depth };
      for (const attribute of fields.filter((f) => f.field === 4 && f.bytes)) {
        const attrFields = protoFields(attribute.bytes);
        const name = text(attrFields, 2);
        if (name) element.attrs[name] = text(attrFields, 3);
      }
      parent.children.push(element);
      for (const child of fields.filter((f) => f.field === 5 && f.bytes)) node(child.bytes, element, depth + 1);
    }
  };
  node(bytes, root, 0);
  return root;
}

const COMPONENTS = new Set(["activity", "activity-alias", "service", "receiver", "provider"]);
const findTag = (node, tag) => node.children.find((child) => child.tag === tag);

/** What the merged manifest lets other apps or a debugger reach. */
export function manifestFindings(tree) {
  const manifest = findTag(tree, "manifest");
  if (!manifest) return { packageName: "", findings: [{ kind: "manifest", rule: "no-manifest", file: "AndroidManifest.xml", hint: "aapt2 printed no <manifest>" }] };
  const packageName = manifest.attrs.package ?? "";
  const application = findTag(manifest, "application");
  const findings = [];
  const flag = (rule, hint) => findings.push({ kind: "manifest", rule, file: "AndroidManifest.xml", hint });
  if (!application) return { packageName, findings };
  const attrs = application.attrs;
  if (attrs.debuggable === "true" || attrs.debuggable === "0xffffffff") flag("debuggable", "<application android:debuggable=true>");
  if (attrs.testOnly === "true" || attrs.testOnly === "0xffffffff") flag("test-only", "<application android:testOnly=true>");
  if (attrs.allowBackup !== "false" && attrs.allowBackup !== "0x0") flag("allow-backup", `<application android:allowBackup=${attrs.allowBackup ?? "(default true)"}>`);
  if (attrs.usesCleartextTraffic === "true" || attrs.usesCleartextTraffic === "0xffffffff") flag("cleartext", "<application android:usesCleartextTraffic=true>");
  for (const node of application.children) {
    if (!COMPONENTS.has(node.tag)) continue;
    const declared = node.attrs.exported;
    const exported = declared === undefined ? node.children.some((child) => child.tag === "intent-filter") : declared === "true" || declared === "0xffffffff";
    if (!exported || node.attrs.permission) continue;
    const raw = node.attrs.name ?? "";
    const name = raw.startsWith(".") ? `${packageName}${raw}` : raw;
    findings.push({ kind: "manifest", rule: "exported-unprotected", file: "AndroidManifest.xml", name, hint: `<${node.tag} ${name}> is reachable from any app, with no permission` });
  }
  return { packageName, findings };
}

const PERMISSION_TAGS = new Set(["uses-permission", "uses-permission-sdk-23"]);

/**
 * What the merged manifest asks Android for: { name, tag? (only for uses-permission-sdk-23), minSdkVersion?,
 * maxSdkVersion? }. A <permission> the app declares for itself is not a request and is left out.
 */
export function manifestPermissions(tree) {
  const manifest = findTag(tree, "manifest");
  if (!manifest) return [];
  return manifest.children
    .filter((child) => PERMISSION_TAGS.has(child.tag))
    .map((child) => {
      const bound = (attr) => (child.attrs[attr] === undefined ? {} : { [attr]: Number(child.attrs[attr]) });
      return {
        name: child.attrs.name ?? "",
        ...(child.tag === "uses-permission" ? {} : { tag: child.tag }),
        ...bound("minSdkVersion"),
        ...bound("maxSdkVersion"),
      };
    });
}

const describePermission = (entry) => `<${entry.tag ?? "uses-permission"} ${entry.name}>`;
const sdkBounds = (entry) =>
  ["minSdkVersion", "maxSdkVersion"]
    .filter((bound) => entry[bound] !== undefined)
    .map((bound) => `${bound}=${entry[bound]}`)
    .join(" ") || "no bounds";

/**
 * The permissions the binary asks for against the reviewed list ({ permissions: [{ name, tag?, minSdkVersion?,
 * maxSdkVersion?, from, reason, play }] }, `{package}` standing for the manifest's package): one it does not list, or
 * lists under other API bounds, is a finding; one it lists that the binary does not ask for is `missing`.
 */
export function permissionFindings(declared, allowlist, packageName) {
  const listed = (allowlist.permissions ?? []).map((entry) => ({ ...entry, name: String(entry.name ?? "").replaceAll("{package}", packageName) }));
  const same = (a, b) => a.name === b.name && (a.tag ?? "uses-permission") === (b.tag ?? "uses-permission");
  const findings = [];
  for (const permission of declared) {
    const entry = listed.find((candidate) => same(candidate, permission));
    const flag = (rule, hint) => findings.push({ kind: "permission", rule, file: "AndroidManifest.xml", name: permission.name, hint });
    if (!entry) {
      flag(
        "permission-unlisted",
        `${describePermission(permission)} is not in android-permissions.json (${sdkBounds(permission)}): a library or a plugin added it. ` +
          "Block it in app.config.ts › blockedPermissions, or list it with who adds it, why it stays and what Play asks of it",
      );
    } else if (sdkBounds(entry) !== sdkBounds(permission)) {
      flag(
        "permission-sdk-changed",
        `${describePermission(permission)} is asked for with ${sdkBounds(permission)}; android-permissions.json lists it with ${sdkBounds(entry)}: ` +
          "the Android versions it reaches changed, and so may what Play reviews",
      );
    }
  }
  const missing = listed.filter((entry) => !declared.some((permission) => same(entry, permission)));
  return { findings, missing };
}

/** Findings split into the ones the baseline does not excuse and the baseline entries nothing matched. */
export function compare(findings, baseline, packageName) {
  const expand = (value) => String(value ?? "").replaceAll("{package}", packageName);
  const exported = (baseline.exported ?? []).map((entry) => ({ ...entry, name: expand(entry.name), used: false }));
  const secrets = (baseline.secrets ?? []).map((entry) => ({ ...entry, used: false }));
  const fresh = [];
  for (const finding of findings) {
    const excuse =
      finding.rule === "exported-unprotected"
        ? exported.find((entry) => entry.name === finding.name)
        : finding.kind === "secret"
          ? secrets.find((entry) => entry.rule === finding.rule && entry.file === finding.file)
          : undefined;
    if (excuse) excuse.used = true;
    else fresh.push(finding);
  }
  const stale = [...exported, ...secrets].filter((entry) => !entry.used).map(({ used: _used, ...entry }) => entry);
  return { fresh, stale };
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function findAapt2(explicit) {
  if (explicit) return explicit;
  if (process.env.AAPT2) return process.env.AAPT2;
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const tools = path.join(sdk, "build-tools");
  if (!fs.existsSync(tools)) return null;
  const versions = fs.readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const version of versions.reverse()) {
    const candidate = path.join(tools, version, "aapt2");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function main(argv) {
  const args = [...argv];
  const take = (flag) => {
    const at = args.indexOf(flag);
    if (at === -1) return undefined;
    const [, value] = args.splice(at, 2);
    return value;
  };
  const baselinePath = take("--baseline") ?? DEFAULT_BASELINE;
  const permissionsPath = take("--permissions") ?? DEFAULT_PERMISSIONS;
  const aapt2Flag = take("--aapt2");
  const [archive] = args;
  if (!archive || !fs.existsSync(archive)) {
    console.error("usage: node scripts/mobile-apk-scan.mjs <app.apk|app.aab> [--baseline <file>] [--permissions <file>] [--aapt2 <path>]");
    return 2;
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const allowlist = JSON.parse(fs.readFileSync(permissionsPath, "utf8"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "apk-scan-"));
  try {
    execFileSync("unzip", ["-qq", "-o", archive, "-d", out], { stdio: ["ignore", "ignore", "inherit"] });
    const findings = [];
    const dexFiles = [];
    for (const file of walk(out)) {
      const name = path.relative(out, file).split(path.sep).join("/");
      const bytes = fs.readFileSync(file);
      findings.push(...scanBytes(name, bytes));
      if (isDexPath(name, archive.endsWith(".aab"))) dexFiles.push({ file: name, bytes });
    }
    const dex = dexFindings(dexFiles.sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true })));
    findings.push(...dex);
    if (dex.length === 0) console.log(`dex: ${dexFiles.length} file(s) define all ${REQUIRED_DEX_CLASSES.length} class(es) found by name`);
    let tree = null;
    let manifestFile = "AndroidManifest.xml";
    if (archive.endsWith(".apk")) {
      const aapt2 = findAapt2(aapt2Flag);
      if (!aapt2) {
        console.error("::error::aapt2 not found: pass --aapt2, set AAPT2 or ANDROID_HOME");
        return 2;
      }
      tree = parseXmlTree(execFileSync(aapt2, ["dump", "xmltree", "--file", "AndroidManifest.xml", archive], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    } else {
      manifestFile = BUNDLE_MANIFEST;
      const file = path.join(out, ...BUNDLE_MANIFEST.split("/"));
      if (fs.existsSync(file)) tree = parseProtoXml(fs.readFileSync(file));
      else findings.push({ kind: "manifest", rule: "no-manifest", file: BUNDLE_MANIFEST, hint: "an app bundle without its base module's manifest is not one Play can install" });
    }
    let packageName = "";
    let missing = [];
    if (tree) {
      const manifest = manifestFindings(tree);
      packageName = manifest.packageName;
      findings.push(...manifest.findings);
      const declared = manifestPermissions(tree);
      const permissions = permissionFindings(declared, allowlist, packageName);
      findings.push(...permissions.findings);
      missing = permissions.missing;
      if (permissions.findings.length === 0) console.log(`permissions: ${declared.length} asked for (${manifestFile}), every one reviewed in ${path.basename(permissionsPath)}`);
    }
    const { fresh, stale } = compare(findings, baseline, packageName);
    for (const entry of stale) console.log(`::notice::apk-scan-baseline.json excuses ${entry.name ?? `${entry.rule} in ${entry.file}`}, which no longer appears: drop it`);
    for (const entry of missing) console.log(`::notice::${path.basename(permissionsPath)} lists ${describePermission(entry)}, which the binary no longer asks for: drop it`);
    for (const finding of fresh) console.log(`::error::${finding.rule} in ${finding.file}${finding.offset !== undefined ? ` at ${finding.offset}` : ""}: ${finding.hint}`);
    console.log(`apk-scan: ${findings.length} finding(s), ${fresh.length} not in the baseline (${path.basename(archive)})`);
    return fresh.length === 0 ? 0 : 1;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
