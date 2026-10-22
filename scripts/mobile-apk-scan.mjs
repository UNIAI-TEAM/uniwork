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
//   manifest  (an APK; an AAB's manifest is protobuf and is skipped) through
//             `aapt2 dump xmltree`: the application is not debuggable or
//             testOnly, allows no backup and no cleartext, and no component
//             is reachable from other apps (exported, or an intent filter
//             without an `exported` attribute) without a permission guarding
//             it, unless the baseline names it with a reason.
//
// The baseline (apps/chat-mobile/apk-scan-baseline.json) is the reviewed
// exceptions, each with a reason; `{package}` in a name stands for the
// manifest's package. A finding outside it fails the run; a baseline entry
// nothing matched any more is reported so it can be dropped.
//
//   node scripts/mobile-apk-scan.mjs <app.apk|app.aab> [--baseline <file>] [--aapt2 <path>]
//
// aapt2 is found from --aapt2, AAPT2, or the newest build-tools under
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
  const aapt2Flag = take("--aapt2");
  const [archive] = args;
  if (!archive || !fs.existsSync(archive)) {
    console.error("usage: node scripts/mobile-apk-scan.mjs <app.apk|app.aab> [--baseline <file>] [--aapt2 <path>]");
    return 2;
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "apk-scan-"));
  try {
    execFileSync("unzip", ["-qq", "-o", archive, "-d", out], { stdio: ["ignore", "ignore", "inherit"] });
    const findings = [];
    for (const file of walk(out)) findings.push(...scanBytes(path.relative(out, file), fs.readFileSync(file)));
    let packageName = "";
    if (archive.endsWith(".apk")) {
      const aapt2 = findAapt2(aapt2Flag);
      if (!aapt2) {
        console.error("::error::aapt2 not found: pass --aapt2, set AAPT2 or ANDROID_HOME");
        return 2;
      }
      const tree = parseXmlTree(execFileSync(aapt2, ["dump", "xmltree", "--file", "AndroidManifest.xml", archive], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
      const manifest = manifestFindings(tree);
      packageName = manifest.packageName;
      findings.push(...manifest.findings);
    } else {
      console.log("::notice::an app bundle's manifest is protobuf: only the secret scan ran (the CI release APK covers the manifest)");
    }
    const { fresh, stale } = compare(findings, baseline, packageName);
    for (const entry of stale) console.log(`::notice::apk-scan-baseline.json excuses ${entry.name ?? `${entry.rule} in ${entry.file}`}, which no longer appears: drop it`);
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
