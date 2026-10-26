#!/usr/bin/env node
// Release health of UniChat mobile, read from Sentry (and Play's vitals) and acted on, every hour from
// .github/workflows/chat-mobile-release-health.yml. Runbook: docs/runbooks/unichat-mobile-release.md › Sức khoẻ bản
// phát hành.
//
// Sentry names each running copy (apps/chat-mobile/lib/build-info.ts › sentryRelease):
//   <appId>@<version>+<build>.<os>               the store build's own bundle (build: version code / build number)
//   <appId>@<version>+<build>.<os>.ota.<id>      an OTA on it (the platform's update id)
// (names from before the OS was added, `+<build>[.ota.<id>]`, are Android: no iOS build had shipped.) So a bad OTA
// and a bad binary are told apart, and so are the two platforms, whose build counters EAS keeps apart.
//
// A release is stopped when, over the last 24 hours, any of these holds (thresholds: THRESHOLDS, the counts
// overridable from the environment so a pilot of ten phones can be gated):
//   - crash-free sessions < 98 % over ≥ 50 sessions (severe), or < 99.5 % over ≥ 200;
//   - at least 3 people crashed and crash-free users < 99.5 % (a cohort too small for 200 sessions a day);
//   - a new crash: an unhandled issue first seen in this release, hit by at least 2 people;
//   - an OTA that at least 2 phones could not launch (data/release/launch-health.ts reports it);
//   - Android only: Play's user-perceived crash rate > 1.09 % or ANR rate > 0.47 % for the version code (the latest
//     complete day; scripts/mobile-play-vitals.mjs), with at least as many people behind it as the crashed-users rule.
// How it is stopped, by platform:
//   - an OTA still rolling out: `eas update:revert-update-rollout --group` (phones go back to the update before it);
//   - an Android store build: its staged rollout halted on the first of production, beta, alpha that has it;
//   - an iOS store build: its App Store phased release paused (scripts/mobile-asc-release.mjs);
//   - an OTA at 100 %, or a store build in no rollout: a person runs "UniChat mobile rollback" or fixes forward.
// The run is red when it stopped something this hour or a person has to act. A release that was stopped earlier —
// halted, paused, or an OTA a newer update has replaced — is reported but not red: its crash rate stays down for a
// day while the phones that have it keep it, and an hourly red run for a done deed would teach people to ignore it.
//
//   node scripts/mobile-release-health.mjs [--dry-run] [--app production|staging] [--channel <c>]...
//     env: SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_URL (optional),
//          PLAY_SERVICE_ACCOUNT_JSON (optional: no Play halt or vitals without it),
//          ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY, ASC_APP_ID (optional: no App Store pause without them),
//          EAS_UPDATE_PRIVATE_KEY_PATH (the signing key a revert publishes with),
//          UNICHAT_HEALTH_* (THRESHOLD_ENV)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { STATES, ascToken, setPhasedRelease } from "./mobile-asc-release.mjs";
import { accessToken, haltOnTracks } from "./mobile-play-release.mjs";
import { REPORTING_SCOPE, playVitals, vitalsReasons } from "./mobile-play-vitals.mjs";
import { launchFailures, newCrashesIn, sentryClient, sessionsByRelease } from "./mobile-sentry-api.mjs";

/**
 * The two variants the stores carry: bundle id, Sentry environment, OTA channels, and whether their store builds go
 * out in stages a machine can stop (and on which Play tracks).
 */
export const APPS = {
  production: { appId: "com.uniworkos.chat", environment: "production", channels: ["production"], staged: true, playTracks: ["production", "beta", "alpha"] },
  // The staging app ships to testers only (Play internal testing, TestFlight): its OTAs are reverted; its store builds
  // have no staged rollout to stop, so they are listed for a person, without turning the run red every hour.
  staging: { appId: "com.uniworkos.chat.staging", environment: "staging", channels: ["internal", "preview"], staged: false, playTracks: [] },
};

export const THRESHOLDS = {
  floor: 0.995,
  minSessions: 200,
  severeFloor: 0.98,
  severeMinSessions: 50,
  minCrashedUsers: 3,
  newCrashMinUsers: 2,
  launchFailureMinUsers: 2,
  vitalsMinUsers: 20,
};

/** The counts a repository variable may change (a pilot needs smaller ones); the floors are the runbook's. */
export const THRESHOLD_ENV = {
  minSessions: "UNICHAT_HEALTH_MIN_SESSIONS",
  severeMinSessions: "UNICHAT_HEALTH_SEVERE_MIN_SESSIONS",
  minCrashedUsers: "UNICHAT_HEALTH_MIN_CRASHED_USERS",
  newCrashMinUsers: "UNICHAT_HEALTH_NEW_CRASH_MIN_USERS",
  launchFailureMinUsers: "UNICHAT_HEALTH_LAUNCH_FAILURE_MIN_USERS",
  vitalsMinUsers: "UNICHAT_HEALTH_VITALS_MIN_USERS",
};

export function thresholdsFrom(env) {
  const out = { ...THRESHOLDS };
  for (const [key, name] of Object.entries(THRESHOLD_ENV)) {
    const raw = env[name];
    if (raw === undefined || raw === "") continue;
    if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a whole number ≥ 1, got ${raw}`);
    out[key] = Number(raw);
  }
  return out;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a Sentry release name says about the running copy; null for anything not this app's store build. */
export function parseRelease(name, appId = APPS.production.appId) {
  const match = new RegExp(`^${escape(appId)}@(\\d+\\.\\d+\\.\\d+)\\+(\\d+)(?:\\.(android|ios))?(?:\\.ota\\.([0-9A-Za-z-]+))?$`).exec(name);
  if (!match) return null;
  return { version: match[1], build: match[2], os: match[3] ?? "android", updateId: match[4]?.toLowerCase() ?? null };
}

const pct = (value) => (value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(2)} %`);

/** Why a release must stop (none when it may go on), from its numbers and what was found about it. */
export function reasonsOf(r, t) {
  const reasons = [];
  if (r.crashFree !== null && r.sessions >= t.severeMinSessions && r.crashFree < t.severeFloor) {
    reasons.push(`crash-free ${pct(r.crashFree)} over ${r.sessions} sessions (severe: < ${pct(t.severeFloor)})`);
  } else if (r.crashFree !== null && r.sessions >= t.minSessions && r.crashFree < t.floor) {
    reasons.push(`crash-free ${pct(r.crashFree)} over ${r.sessions} sessions (< ${pct(t.floor)})`);
  }
  const crashedUsers = r.crashFreeUsers === null ? 0 : Math.round(r.users * (1 - r.crashFreeUsers));
  if (crashedUsers >= t.minCrashedUsers && r.crashFreeUsers < t.floor) reasons.push(`${crashedUsers} of ${r.users} people crashed`);
  for (const issue of r.newCrashes) {
    if (issue.users >= t.newCrashMinUsers) reasons.push(`new crash ${issue.shortId} hit ${issue.users} people${issue.permalink ? ` (${issue.permalink})` : ""}`);
  }
  if (r.launchFailureUsers >= t.launchFailureMinUsers) reasons.push(`${r.launchFailureUsers} phones could not launch this update`);
  reasons.push(...vitalsReasons(r.vitals, { minUsers: t.vitalsMinUsers, minAffected: t.minCrashedUsers }));
  return reasons;
}

/** A release's verdict: halt with reasons; else ok once it has the sessions to be judged on its rate, watch before. */
export function judge(r, t) {
  const reasons = reasonsOf(r, t);
  if (reasons.length) return { ...r, verdict: "halt", reasons };
  return { ...r, verdict: r.sessions >= t.minSessions && r.crashFree !== null ? "ok" : "watch", reasons };
}

const emptyRecord = (fields) => ({ sessions: 0, crashFree: null, users: 0, crashFreeUsers: null, newCrashes: [], launchFailureUsers: 0, vitals: null, ...fields });

/**
 * This app's releases from Sentry's session totals, with the launch failures (an update that never launched has no
 * sessions of its own) and Play's vitals (a version code Sentry may not see) joined in; unjudged.
 */
export function collect(sessionGroups, { appId, failures = [], vitals = new Map() }) {
  const records = [];
  for (const group of sessionGroups) {
    const parsed = group.release ? parseRelease(group.release, appId) : null;
    if (parsed) records.push(emptyRecord({ ...group, ...parsed }));
  }
  for (const failure of failures) {
    const known = records.find((r) => r.updateId === failure.updateId);
    if (known) known.launchFailureUsers += failure.users;
    else records.push(emptyRecord({ release: `${appId} update ${failure.updateId} (${failure.os})`, version: null, build: null, os: failure.os, updateId: failure.updateId, launchFailureUsers: failure.users }));
  }
  for (const [code, value] of vitals) {
    const binary = records.find((r) => r.os === "android" && r.updateId === null && r.build === code);
    if (binary) binary.vitals = value;
    else records.push(emptyRecord({ release: `${appId} version code ${code} (Play)`, version: null, build: code, os: "android", updateId: null, vitals: value }));
  }
  return records;
}

/**
 * Where an update is on the given channels (EAS branches of the same name), among the newest groups for its
 * platform: `{ channel, group, rolloutPercentage, supersededBy }`, or null when none holds it. `supersededBy` is a
 * newer group for the same runtime: phones on that runtime take it instead, so the update is done with.
 */
export function locateUpdate(updateId, channels, platform, eas) {
  for (const channel of channels) {
    const list = JSON.parse(eas(["update:list", "--branch", channel, "--platform", platform, "--limit", "25", "--json", "--non-interactive"])).currentPage ?? [];
    for (const [index, group] of list.entries()) {
      const updates = JSON.parse(eas(["update:view", group.group, "--json"]));
      if (!updates.some((update) => String(update.id).toLowerCase() === updateId)) continue;
      const newer = list.slice(0, index).find((other) => other.runtimeVersion === group.runtimeVersion);
      return { channel, group: group.group, rolloutPercentage: group.rolloutPercentage, supersededBy: newer?.group ?? null };
    }
  }
  return null;
}

/** Stops one unhealthy OTA; returns `{ line, red }`. */
function stopUpdate(r, what, { channels, dryRun, eas, keyPath, message }) {
  const where = locateUpdate(r.updateId, channels, r.os, eas);
  if (!where) return { line: `**unhealthy, needs a person** — ${what}; not found on ${channels.join(", ")}`, red: true };
  if (where.supersededBy) return { line: `stopped earlier — ${what}; group ${where.group} is replaced by ${where.supersededBy} on ${where.channel}`, red: false };
  const rolling = typeof where.rolloutPercentage === "number" && where.rolloutPercentage < 100;
  if (!rolling) {
    return {
      line: `**unhealthy, needs a person** — ${what}; group ${where.group} is out to every phone on ${where.channel}: run "UniChat mobile rollback" (republish-previous or roll-back-to-embedded)`,
      red: true,
    };
  }
  if (dryRun) return { line: `**unhealthy (dry run)** — ${what}; would revert rollout group ${where.group} on ${where.channel}`, red: true };
  eas(["update:revert-update-rollout", "--group", where.group, "--message", message, "--non-interactive", ...(keyPath ? ["--private-key-path", keyPath] : [])]);
  return { line: `**unhealthy, rollout reverted** — ${what}; group ${where.group} on ${where.channel}`, red: true };
}

/** Stops one unhealthy store build in its platform's store; returns `{ line, red }`. */
async function stopBinary(r, what, { app, dryRun, play, appStore }) {
  if (!app.staged) return { line: `**unhealthy, fix forward** — ${what}; a tester build (${r.os === "ios" ? "TestFlight" : "Play internal testing"}) has no staged rollout to stop`, red: false };
  if (r.os === "ios") {
    if (!appStore) return { line: `**unhealthy, needs a person** — ${what}; no App Store Connect key (ASC_*) to pause the phased release of ${r.version}`, red: true };
    if (dryRun) return { line: `**unhealthy (dry run)** — ${what}; would pause the App Store phased release of ${r.version}`, red: true };
    const paused = await appStore(r.version);
    if (paused.alreadyInState) return { line: `stopped earlier — ${what}; the phased release of ${r.version} is already paused`, red: false };
    return { line: `**unhealthy, App Store phased release paused** — ${what}; version ${r.version}`, red: true };
  }
  if (!play) return { line: `**unhealthy, needs a person** — ${what}; no PLAY_SERVICE_ACCOUNT_JSON to halt version code ${r.build}`, red: true };
  if (dryRun) return { line: `**unhealthy (dry run)** — ${what}; would halt version code ${r.build} on ${app.playTracks.join(" / ")}`, red: true };
  const found = await play(r.build);
  if (!found) return { line: `watching — ${what}; version code ${r.build} is in no rollout on ${app.playTracks.join(", ")} (internal testing only)`, red: false };
  if (found.alreadyHalted) return { line: `stopped earlier — ${what}; version code ${r.build} is already halted on ${found.track}`, red: false };
  return { line: `**unhealthy, Play rollout halted** — ${what}; version code ${r.build} on ${found.track}`, red: true };
}

/** Acts on every release that must stop; returns the report lines and whether the run is red. */
export async function enforce(releases, { app, channels, dryRun, eas, play, appStore, keyPath }) {
  const lines = [];
  let red = false;
  for (const r of releases) {
    const numbers = `crash-free ${pct(r.crashFree)} over ${r.sessions} sessions, ${r.users} people`;
    if (r.verdict !== "halt") {
      lines.push(`- ${r.verdict === "ok" ? "ok" : "watching"} — ${r.release}: ${numbers}`);
      continue;
    }
    const what = `${r.release}: ${r.reasons.join("; ")}`;
    const message = `release-health: ${r.reasons[0]}`.slice(0, 200);
    try {
      const outcome = r.updateId ? stopUpdate(r, what, { channels, dryRun, eas, keyPath, message }) : await stopBinary(r, what, { app, dryRun, play, appStore });
      lines.push(`- ${outcome.line}`);
      red ||= outcome.red;
    } catch (error) {
      lines.push(`- **unhealthy, stopping it failed** — ${what}: ${error instanceof Error ? error.message : error}`);
      red = true;
    }
  }
  if (releases.length === 0) lines.push(`- no ${app.environment} sessions in the last 24 hours`);
  return { lines, red };
}

function parseArgs(argv) {
  const options = { dryRun: false, app: "production", channels: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") options.dryRun = true;
    else if (argv[i] === "--app" && argv[i + 1]) options.app = argv[++i];
    else if (argv[i] === "--channel" && argv[i + 1]) options.channels.push(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!APPS[options.app]) throw new Error(`--app is ${Object.keys(APPS).join(" or ")}, got ${options.app}`);
  return options;
}

/** Sentry's answers for one app: sessions, new crashes of each release with sessions, and launch failures. */
async function readSentry(client, app) {
  const sessions = (await sessionsByRelease(client, app.environment)).filter((g) => g.release && parseRelease(g.release, app.appId));
  const failures = await launchFailures(client, app.environment);
  const newCrashes = new Map();
  for (const group of sessions) newCrashes.set(group.release, await newCrashesIn(client, group.release, app.environment));
  return { sessions, failures, newCrashes };
}

export async function main(argv, { env = process.env, fetchImpl = fetch, eas, log = console.log, summary = (text) => env.GITHUB_STEP_SUMMARY && fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text) } = {}) {
  const options = parseArgs(argv);
  const app = APPS[options.app];
  const channels = options.channels.length ? options.channels : app.channels;
  const missing = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG"].filter((name) => !env[name]);
  if (missing.length) {
    log(`::error::${missing.join(" and ")} not set: release health cannot be read (runbook › Sức khoẻ bản phát hành)`);
    return 1;
  }
  const t = thresholdsFrom(env);
  const client = sentryClient({ org: env.SENTRY_ORG, token: env.SENTRY_AUTH_TOKEN, url: env.SENTRY_URL || undefined, fetchImpl });
  const { sessions, failures, newCrashes } = await readSentry(client, app);
  const notes = [];
  let vitals = new Map();
  if (env.PLAY_SERVICE_ACCOUNT_JSON && app.staged) {
    try {
      const token = await accessToken(env.PLAY_SERVICE_ACCOUNT_JSON, fetchImpl, Date.now(), REPORTING_SCOPE);
      vitals = await playVitals({ packageName: app.appId, token, fetchImpl });
    } catch (error) {
      notes.push(`::warning::Play vitals not read (${error instanceof Error ? error.message : error}): the service account needs "View app quality information"`);
    }
  }
  const records = collect(sessions, { appId: app.appId, failures, vitals });
  for (const r of records) r.newCrashes = newCrashes.get(r.release) ?? [];
  const releases = records.map((r) => judge(r, t)).sort((a, b) => b.sessions - a.sessions);
  const play = env.PLAY_SERVICE_ACCOUNT_JSON
    ? async (build) => haltOnTracks({ packageName: app.appId, versionCode: build, tracks: app.playTracks, token: await accessToken(env.PLAY_SERVICE_ACCOUNT_JSON, fetchImpl), fetchImpl })
    : null;
  const ascReady = env.ASC_KEY_ID && env.ASC_ISSUER_ID && env.ASC_PRIVATE_KEY && env.ASC_APP_ID;
  const appStore = ascReady
    ? async (version) =>
        setPhasedRelease({
          appId: env.ASC_APP_ID,
          version,
          state: STATES.pause,
          token: ascToken({ keyId: env.ASC_KEY_ID, issuerId: env.ASC_ISSUER_ID, privateKey: env.ASC_PRIVATE_KEY }),
          fetchImpl,
        })
    : null;
  const { lines, red } = await enforce(releases, { app, channels, dryRun: options.dryRun, eas, play, appStore, keyPath: env.EAS_UPDATE_PRIVATE_KEY_PATH });
  const rules =
    `Stop at: crash-free < ${pct(t.floor)} over ≥ ${t.minSessions} sessions (< ${pct(t.severeFloor)} over ≥ ${t.severeMinSessions}); ` +
    `≥ ${t.minCrashedUsers} people crashed; a new crash hitting ≥ ${t.newCrashMinUsers} people; ≥ ${t.launchFailureMinUsers} phones unable to launch an OTA; ` +
    `Play vitals over Google's bad-behaviour thresholds (≥ ${t.vitalsMinUsers} users, ≥ ${t.minCrashedUsers} of them affected).`;
  const text = `### UniChat release health (${options.app}: ${channels.join(", ")}, last 24 h)\n\n${rules}\n\n${lines.join("\n")}\n`;
  summary(text);
  log(text);
  for (const note of notes) log(note);
  if (red) log(`::error::a ${options.app} release of UniChat must stop or was stopped this hour (see the summary)`);
  return red ? 1 : 0;
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
