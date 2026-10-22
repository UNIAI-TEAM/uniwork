#!/usr/bin/env node
// Release health of UniChat mobile in production, read from Sentry and acted
// on (audit "rollout-gating-manual"): the runbook's rule — widen only at
// crash-free sessions ≥ 99.5 % over ≥ 200 sessions, stop below it — as code,
// run every hour by .github/workflows/chat-mobile-release-health.yml.
//
// Sentry names each running copy (lib/build-info.ts › sentryRelease):
//   com.uniworkos.chat@<version>+<version code>               the store build's own bundle
//   com.uniworkos.chat@<version>+<version code>.ota.<id>      an OTA on it (the Android update's id)
// so a bad OTA and a bad binary are told apart. Over the last 24 hours, a
// release with at least MIN_SESSIONS sessions under CRASH_FREE_FLOOR — or a
// severe one, SEVERE_MIN_SESSIONS under SEVERE_FLOOR — is stopped:
//   - an OTA still rolling out: `eas update:revert-update-rollout --group`
//     (phones go back to the update before it);
//   - a store build: Play's staged rollout halted for that version code
//     (scripts/mobile-play-release.mjs; phones that have it keep it).
// What cannot be undone by a machine (an OTA already at 100 %, a build not in
// a rollout) is reported for a person (runbook › Khắc phục). The run exits 1
// whenever a release is unhealthy, so the people watching the workflow hear of
// it even when the stop succeeded.
//
//   node scripts/mobile-release-health.mjs [--dry-run] [--channel production]
//     env: SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_URL (optional),
//          PLAY_SERVICE_ACCOUNT_JSON (optional: no Play halt without it),
//          EAS_UPDATE_PRIVATE_KEY_PATH (the signing key a revert publishes with)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { accessToken, halt } from "./mobile-play-release.mjs";

export const APP_ID = "com.uniworkos.chat";
export const CRASH_FREE_FLOOR = 0.995;
export const MIN_SESSIONS = 200;
export const SEVERE_FLOOR = 0.98;
export const SEVERE_MIN_SESSIONS = 50;

const RELEASE = /^com\.uniworkos\.chat@(\d+\.\d+\.\d+)\+(\d+)(?:\.ota\.([0-9A-Za-z-]+))?$/;

/** What a Sentry release name says about the running copy; null for anything not the production app's. */
export function parseRelease(name) {
  const match = RELEASE.exec(name);
  if (!match) return null;
  return { version: match[1], versionCode: match[2], updateId: match[3] ?? null };
}

/** One release's verdict: halt below the floor with enough sessions, watch while there are too few, else ok. */
export function verdict(sessions, crashFree) {
  if (crashFree === null || crashFree === undefined || !(sessions > 0)) return "watch";
  if (sessions >= SEVERE_MIN_SESSIONS && crashFree < SEVERE_FLOOR) return "halt";
  if (sessions < MIN_SESSIONS) return "watch";
  return crashFree < CRASH_FREE_FLOOR ? "halt" : "ok";
}

/** Sentry's per-release session totals → the production app's releases with their verdicts. */
export function assess(groups) {
  return (groups ?? [])
    .map((group) => {
      const name = group?.by?.release;
      const parsed = typeof name === "string" ? parseRelease(name) : null;
      if (!parsed) return null;
      const sessions = Number(group.totals?.["sum(session)"] ?? 0);
      const raw = group.totals?.["crash_free_rate(session)"];
      const crashFree = typeof raw === "number" ? raw : null;
      return { release: name, ...parsed, sessions, crashFree, verdict: verdict(sessions, crashFree) };
    })
    .filter(Boolean)
    .sort((a, b) => b.sessions - a.sessions);
}

/** GET the last 24 hours of production sessions, grouped by release. */
export async function fetchSessionGroups({ org, token, url = "https://sentry.io", fetchImpl }) {
  const query = new URLSearchParams([
    ["field", "sum(session)"],
    ["field", "crash_free_rate(session)"],
    ["groupBy", "release"],
    ["environment", "production"],
    ["statsPeriod", "24h"],
    ["interval", "1d"],
    ["project", "-1"],
    ["per_page", "100"],
  ]);
  const response = await fetchImpl(`${url}/api/0/organizations/${encodeURIComponent(org)}/sessions/?${query}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Sentry answered ${response.status} for the session totals: check SENTRY_AUTH_TOKEN (org:read) and SENTRY_ORG`);
  return (await response.json()).groups ?? [];
}

/**
 * The update group an Android update belongs to, among the groups still rolling out on `channel`; null when the
 * update is not in a rollout (already at 100 %, or replaced). `eas` runs eas-cli and returns its stdout.
 */
export function rollingOutGroupOf(updateId, channel, eas) {
  const list = JSON.parse(eas(["update:list", "--branch", channel, "--platform", "android", "--limit", "25", "--json", "--non-interactive"]));
  const rolling = (list.currentPage ?? []).filter((group) => typeof group.rolloutPercentage === "number" && group.rolloutPercentage < 100);
  for (const group of rolling) {
    const updates = JSON.parse(eas(["update:view", group.group, "--json"]));
    if (updates.some((update) => update.id === updateId)) return group.group;
  }
  return null;
}

const pct = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(2)} %`);

/** Acts on every unhealthy release; returns the report lines and whether any release was unhealthy. */
export async function enforce(releases, { channel, dryRun, eas, play, keyPath }) {
  const lines = [];
  let unhealthy = false;
  for (const r of releases) {
    const what = `${r.release}: crash-free ${pct(r.crashFree)} over ${r.sessions} sessions`;
    if (r.verdict !== "halt") {
      lines.push(`- ${r.verdict === "ok" ? "ok" : "watching"} — ${what}`);
      continue;
    }
    unhealthy = true;
    const message = `release-health: ${pct(r.crashFree)} crash-free over ${r.sessions} sessions`;
    try {
      if (r.updateId) {
        const group = rollingOutGroupOf(r.updateId, channel, eas);
        if (!group) {
          lines.push(`- **unhealthy, needs a person** — ${what}; the OTA is not in a rollout any more: republish the previous update or roll back to embedded (runbook › Khắc phục)`);
        } else if (dryRun) {
          lines.push(`- **unhealthy (dry run)** — ${what}; would revert rollout group ${group}`);
        } else {
          eas(["update:revert-update-rollout", "--group", group, "--message", message, "--non-interactive", ...(keyPath ? ["--private-key-path", keyPath] : [])]);
          lines.push(`- **unhealthy, rollout reverted** — ${what}; group ${group}`);
        }
      } else if (!play) {
        lines.push(`- **unhealthy, needs a person** — ${what}; no PLAY_SERVICE_ACCOUNT_JSON to halt version code ${r.versionCode} on Play`);
      } else if (dryRun) {
        lines.push(`- **unhealthy (dry run)** — ${what}; would halt version code ${r.versionCode} on production`);
      } else {
        await play(r.versionCode);
        lines.push(`- **unhealthy, Play rollout halted** — ${what}; version code ${r.versionCode}`);
      }
    } catch (error) {
      lines.push(`- **unhealthy, stopping it failed** — ${what}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (releases.length === 0) lines.push("- no production sessions in the last 24 hours");
  return { lines, unhealthy };
}

export async function main(argv, { env = process.env, fetchImpl = fetch, eas, log = console.log, summary = (text) => env.GITHUB_STEP_SUMMARY && fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text) } = {}) {
  const dryRun = argv.includes("--dry-run");
  const at = argv.indexOf("--channel");
  const channel = at >= 0 && argv[at + 1] ? argv[at + 1] : "production";
  const missing = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG"].filter((name) => !env[name]);
  if (missing.length) {
    log(`::error::${missing.join(" and ")} not set: release health cannot be read (runbook › Sức khoẻ bản phát hành)`);
    return 1;
  }
  const groups = await fetchSessionGroups({ org: env.SENTRY_ORG, token: env.SENTRY_AUTH_TOKEN, url: env.SENTRY_URL || undefined, fetchImpl });
  const releases = assess(groups);
  const play = env.PLAY_SERVICE_ACCOUNT_JSON
    ? async (versionCode) => halt({ packageName: APP_ID, versionCode, track: "production", token: await accessToken(env.PLAY_SERVICE_ACCOUNT_JSON, fetchImpl), fetchImpl })
    : null;
  const { lines, unhealthy } = await enforce(releases, { channel, dryRun, eas, play, keyPath: env.EAS_UPDATE_PRIVATE_KEY_PATH });
  const text = `### UniChat release health (${channel}, last 24 h)\n\nFloor: ${pct(CRASH_FREE_FLOOR)} crash-free over ≥ ${MIN_SESSIONS} sessions (${pct(SEVERE_FLOOR)} over ≥ ${SEVERE_MIN_SESSIONS}).\n\n${lines.join("\n")}\n`;
  summary(text);
  log(text);
  if (unhealthy) log("::error::a production release is under the crash-free floor (see the summary)");
  return unhealthy ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const cwd = path.resolve(import.meta.dirname, "../apps/chat-mobile");
  const eas = (args) => execFileSync("eas", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  main(process.argv.slice(2), { eas }).then(
    (code) => process.exit(code),
    (error) => {
      console.log(`::error::${error instanceof Error ? error.message : error}`);
      process.exit(1);
    },
  );
}
