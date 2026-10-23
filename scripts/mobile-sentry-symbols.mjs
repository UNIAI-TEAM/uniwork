#!/usr/bin/env node
// Proves that Sentry holds the source map of the JS bundle inside one Android binary, by that bundle's debug ID
// (chat-mobile-production.yml, before the binary is submitted; runbook docs/runbooks/unichat-mobile-release.md ›
// Phát hành production theo giai đoạn).
//
// Why a debug ID and not the release: with @sentry/react-native 7 / sentry-cli 2 the Gradle task
// (sentry.gradle › `sentry-cli react-native gradle`) uploads the bundle and its map as an *artifact bundle*, keyed
// by debug ID and associated with release + dist. That creates no Release object (Sentry makes one when the first
// event of that release arrives), so `GET /organizations/{org}/releases/{release}/` answers 404 after an upload that
// worked: 0.3.1 (12) failed there while its EAS log said "Uploaded files to Sentry … Upload type: artifact bundle".
//
// Metro (metro.config.js › getSentryExpoConfig) puts the debug ID into the bundle as a string literal,
// `_sentryDebugIdIdentifier="sentry-dbid-<uuid>"`, which survives Hermes compilation into the bytecode string
// table; a plain-JS bundle also ends with a `//# debugId=<uuid>` comment, which Hermes drops. The SDK reports that
// ID with every JS crash and Sentry finds the map by it, so asking Sentry for the ID read from the binary itself is
// the question "will this binary's JS crashes be readable", tied to the exact build. The lookup is the one Sentry's
// symbolicator uses: GET /api/0/projects/{org}/{project}/artifact-lookup/?debug_id=<uuid> — 200 with a list (empty
// when nothing matches), readable with project:read, project:releases or org:ci.
//
// What this does not prove: the R8 mapping and the native (NDK) symbols. The Sentry Android Gradle plugin that
// uploads those is not enabled (app.config.ts › @sentry/react-native/expo has no experimental_android), so a
// crash in Kotlin/Java shows obfuscated frames in Sentry; Play keeps both in the AAB's BUNDLE-METADATA for its own
// vitals.
//
//   node scripts/mobile-sentry-symbols.mjs <app.aab|app.apk|index.android.bundle> --release <name>
//        [--attempts 6] [--delay-ms 10000]
//
// Reads SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT and SENTRY_URL (default https://sentry.io). Writes
// `debug_id=<uuid>` to GITHUB_OUTPUT when it is set. Exit 0 when Sentry has the map, 1 otherwise, each failure as
// one ::error:: line saying which of the three it was: the binary has no debug ID, the token or project is wrong,
// or the map is not there.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** Where the JS bundle sits: an AAB's base module first, then an APK's root. */
const BUNDLE_ENTRIES = ["base/assets/index.android.bundle", "assets/index.android.bundle"];
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
// The snippet's ID is the one the SDK reports with an event, so it wins; the comment covers a bundle built without it.
const SNIPPET = new RegExp(`sentry-dbid-(${UUID})`);
const COMMENT = new RegExp(`//# debugId=(${UUID})`);

/** The Sentry debug ID a JS bundle (text or Hermes bytecode) carries, lower case, or null. */
export function debugIdOf(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("latin1") : String(bytes);
  const id = text.match(SNIPPET)?.[1] ?? text.match(COMMENT)?.[1];
  return id ? id.toLowerCase() : null;
}

class Failure extends Error {}

/** The JS bundle's bytes: the file itself, or its entry in an AAB/APK (both are zips). */
function readBundle(file) {
  const head = Buffer.alloc(4);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, head, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head.toString("latin1") !== "PK\x03\x04") return { bytes: fs.readFileSync(file), entry: file };
  for (const entry of BUNDLE_ENTRIES) {
    try {
      const bytes = execFileSync("unzip", ["-p", file, entry], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] });
      if (bytes.length > 0) return { bytes, entry: `${file}!${entry}` };
    } catch {
      // unzip exits 11 when the entry is absent: try the next layout.
    }
  }
  throw new Failure(`${file} has no JS bundle (${BUNDLE_ENTRIES.join(" or ")}): nothing to look up in Sentry`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks Sentry for the artifact bundle that holds `debugId`. Resolves to the matching entries; throws a Failure for
 * an answer that is not about the upload (a refused token, an unknown project), and an Error for one worth retrying.
 */
async function lookup({ base, org, project, token, debugId, fetchImpl }) {
  const url = `${base}/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/artifact-lookup/?debug_id=${debugId}`;
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) {
    throw new Failure(
      `Sentry refused SENTRY_AUTH_TOKEN (HTTP ${response.status}) for project ${org}/${project}: the token in this GitHub environment is wrong, expired or lacks project:releases (or project:read / org:ci). This says nothing about the upload; fix the token and re-run`,
    );
  }
  if (response.status === 404) {
    throw new Failure(`Sentry has no project ${org}/${project} (HTTP 404): check the SENTRY_ORG and SENTRY_PROJECT variables. This says nothing about the upload`);
  }
  if (!response.ok) throw new Error(`Sentry answered HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error("Sentry answered with something other than a list");
  // Only a bundle found by its debug ID. When the debug ID matches nothing, Sentry falls back to the newest bundles
  // of the (here empty) release and answers them with `resolved_with: "release"`; legacy release files come back as
  // "release-old". Neither holds this binary's map, so an entry without `resolved_with: "debug-id"` is not proof.
  return body.filter((item) => item?.type === "bundle" && item.resolved_with === "debug-id");
}

function option(argv, name, fallback) {
  const at = argv.lastIndexOf(name); // the last one wins, as in most CLIs
  return at === -1 ? fallback : argv[at + 1];
}

/** The command: returns the exit code and prints GitHub annotations; `env`, `fetchImpl` and `log` are injectable. */
export async function main(argv, { env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const file = argv.find((arg, i) => !arg.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  const release = option(argv, "--release", "");
  const attempts = Math.max(1, Number(option(argv, "--attempts", "6")) || 1);
  const delayMs = Math.max(0, Number(option(argv, "--delay-ms", "10000")) || 0);
  if (!file || !release) {
    log("usage: node scripts/mobile-sentry-symbols.mjs <app.aab|app.apk|index.android.bundle> --release <name> [--attempts n] [--delay-ms ms]");
    return 2;
  }
  const { SENTRY_AUTH_TOKEN: token, SENTRY_ORG: org, SENTRY_PROJECT: project } = env;
  const base = (env.SENTRY_URL || "https://sentry.io").replace(/\/+$/, "");
  try {
    if (!token || !org || !project) throw new Failure("SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT must all be set to ask Sentry");
    const { bytes, entry } = readBundle(file);
    const debugId = debugIdOf(bytes);
    if (!debugId) {
      throw new Failure(
        `the JS bundle of release ${release} (${entry}) carries no Sentry debug ID (no "sentry-dbid-<uuid>" literal, no "//# debugId=" comment): it was not built through getSentryExpoConfig (apps/chat-mobile/metro.config.js), so Sentry cannot tie its crashes to any source map`,
      );
    }
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `debug_id=${debugId}\n`);
    log(`release ${release}: JS bundle debug ID ${debugId} (${entry})`);
    let last = "";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const found = await lookup({ base, org, project, token, debugId, fetchImpl });
        if (found.length > 0) {
          log(`Sentry ${org}/${project} has the source map for debug ID ${debugId} (${found.map((item) => item.id).join(", ")}): the JS crashes of ${release} will be readable`);
          return 0;
        }
        last = "no artifact bundle";
      } catch (error) {
        if (error instanceof Failure) throw error;
        last = error instanceof Error ? error.message : String(error);
      }
      if (attempt < attempts) await sleep(delayMs);
    }
    if (last === "no artifact bundle") {
      throw new Failure(
        `Sentry ${org}/${project} has no artifact bundle with debug ID ${debugId}, the JS bundle of release ${release}: its source map did not upload, so its JS crashes would be unreadable. Read the EAS build log's "Sentry-CLI" upload step and SENTRY_AUTH_TOKEN in the EAS production environment, then build again`,
      );
    }
    throw new Failure(`could not ask Sentry about debug ID ${debugId} of release ${release} after ${attempts} attempts (${last})`);
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    log(`::error::${error.message}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
