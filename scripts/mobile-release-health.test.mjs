import { test } from "node:test";
import assert from "node:assert/strict";
import { APPS, THRESHOLDS, collect, enforce, judge, locateUpdate, main, parseRelease, reasonsOf, thresholdsFrom } from "./mobile-release-health.mjs";

const OTA = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const APP = APPS.production;
const record = (over) => ({ release: "r", version: "0.3.0", build: "12", os: "android", updateId: null, sessions: 0, crashFree: null, users: 0, crashFreeUsers: null, newCrashes: [], launchFailureUsers: 0, vitals: null, ...over });

test("a Sentry release names the build, its platform, and the OTA when one runs", () => {
  assert.deepEqual(parseRelease("com.uniworkos.chat@0.3.0+12.android"), { version: "0.3.0", build: "12", os: "android", updateId: null });
  assert.deepEqual(parseRelease(`com.uniworkos.chat@0.3.0+5.ios.ota.${OTA.toUpperCase()}`), { version: "0.3.0", build: "5", os: "ios", updateId: OTA });
  // Names from before the platform was in them are Android: no iOS build had shipped.
  assert.deepEqual(parseRelease(`com.uniworkos.chat@0.3.0+12.ota.${OTA}`), { version: "0.3.0", build: "12", os: "android", updateId: OTA });
  assert.equal(parseRelease("com.uniworkos.chat.staging@0.3.0+12.android"), null, "the staging app is not production's to stop");
  assert.deepEqual(parseRelease("com.uniworkos.chat.staging@0.3.0+12.android", APPS.staging.appId)?.build, "12");
  assert.equal(parseRelease("unichat@0.3.0+ios"), null);
});

test("the counts come from the environment so a pilot can be gated, and a bad value is refused", () => {
  assert.deepEqual(thresholdsFrom({}), THRESHOLDS);
  assert.equal(thresholdsFrom({ UNICHAT_HEALTH_MIN_SESSIONS: "40", UNICHAT_HEALTH_NEW_CRASH_MIN_USERS: "" }).minSessions, 40);
  assert.equal(thresholdsFrom({ UNICHAT_HEALTH_NEW_CRASH_MIN_USERS: "" }).newCrashMinUsers, THRESHOLDS.newCrashMinUsers);
  assert.throws(() => thresholdsFrom({ UNICHAT_HEALTH_MIN_CRASHED_USERS: "0" }), /UNICHAT_HEALTH_MIN_CRASHED_USERS must be a whole number/);
  assert.throws(() => thresholdsFrom({ UNICHAT_HEALTH_VITALS_MIN_USERS: "2.5" }), /whole number/);
});

test("the runbook's floor: 99.5 % over 200 sessions, or 98 % over 50 for a severe one", () => {
  const t = THRESHOLDS;
  assert.equal(judge(record({ sessions: 200, crashFree: 0.995 }), t).verdict, "ok");
  assert.deepEqual(judge(record({ sessions: 200, crashFree: 0.994 }), t).reasons, ["crash-free 99.40 % over 200 sessions (< 99.50 %)"]);
  assert.equal(judge(record({ sessions: 199, crashFree: 0.99 }), t).verdict, "watch", "too few sessions to judge a mild drop");
  assert.match(judge(record({ sessions: 50, crashFree: 0.97 }), t).reasons[0], /severe/);
  assert.equal(judge(record({ sessions: 49, crashFree: 0.5 }), t).verdict, "watch");
  assert.equal(judge(record({ sessions: 300 }), t).verdict, "watch", "no rate, nothing to judge");
});

// Audit "thresholds-unreachable-at-pilot-scale": a 5 % stage of a pilot never reaches 50 sessions a day, so a cohort
// is also judged on how many people crashed and on crashes that are new in the release.
test("a small cohort is stopped by people crashing and by a new crash, not only by a rate", () => {
  const t = THRESHOLDS;
  assert.deepEqual(reasonsOf(record({ sessions: 30, users: 12, crashFreeUsers: 0.75 }), t), ["3 of 12 people crashed"]);
  assert.deepEqual(reasonsOf(record({ sessions: 30, users: 12, crashFreeUsers: 0.84 }), t), [], "two people is not yet a pattern");
  assert.deepEqual(reasonsOf(record({ sessions: 5000, users: 1000, crashFreeUsers: 0.997 }), t), [], "3 of 1000 is a healthy rate");
  const fresh = [{ shortId: "UNICHAT-1F", users: 2, permalink: "https://sentry.io/i/1" }, { shortId: "UNICHAT-1G", users: 1, permalink: null }];
  assert.deepEqual(reasonsOf(record({ sessions: 8, newCrashes: fresh }), t), ["new crash UNICHAT-1F hit 2 people (https://sentry.io/i/1)"]);
  assert.deepEqual(reasonsOf(record({ newCrashes: [{ shortId: "X", users: 4, permalink: null }] }), t), ["new crash X hit 4 people"]);
  assert.deepEqual(reasonsOf(record({ updateId: OTA, launchFailureUsers: 2 }), t), ["2 phones could not launch this update"]);
  const vitals = { crashRate: 0.002, anrRate: 0.006, users: 600, day: "2026-10-21" };
  assert.deepEqual(reasonsOf(record({ vitals }), t), ["Play vitals: user-perceived ANR rate 0.60 % over 600 users (4 people) on 2026-10-21"]);
  // One ANR among 40 users is 2.5 %, but one person: the vitals bar is the crashed-users rule's count.
  assert.deepEqual(reasonsOf(record({ vitals: { ...vitals, anrRate: 1 / 40, users: 40 } }), t), []);
  assert.equal(reasonsOf(record({ vitals: { ...vitals, anrRate: 1 / 40, users: 40 } }), { ...t, minCrashedUsers: 1 }).length, 1);
});

test("collect joins launch failures and Play's vitals to the releases Sentry has, and adds the ones it has not", () => {
  const sessions = [
    { release: `com.uniworkos.chat@0.3.0+12.android.ota.${OTA}`, sessions: 40, crashFree: 1, users: 10, crashFreeUsers: 1 },
    { release: "com.uniworkos.chat@0.3.0+12.android", sessions: 10, crashFree: 1, users: 3, crashFreeUsers: 1 },
    { release: "com.uniworkos.chat.staging@0.3.0+40.android", sessions: 900, crashFree: 0.5, users: 9, crashFreeUsers: 0.5 },
    { release: null, sessions: 1, crashFree: 1, users: 1, crashFreeUsers: 1 },
  ];
  const failures = [
    { updateId: OTA, os: "android", users: 2, shortId: "A" },
    { updateId: "ffff", os: "ios", users: 3, shortId: "B" },
  ];
  const vitals = new Map([
    ["12", { crashRate: 0.02, anrRate: null, users: 30, day: "2026-10-21" }],
    ["11", { crashRate: 0.001, anrRate: 0.001, users: 300, day: "2026-10-21" }],
  ]);
  const records = collect(sessions, { appId: APP.appId, failures, vitals });
  assert.deepEqual(
    records.map((r) => [r.release, r.os, r.updateId, r.launchFailureUsers, r.vitals?.crashRate ?? null]),
    [
      [`com.uniworkos.chat@0.3.0+12.android.ota.${OTA}`, "android", OTA, 2, null],
      ["com.uniworkos.chat@0.3.0+12.android", "android", null, 0, 0.02],
      ["com.uniworkos.chat update ffff (ios)", "ios", "ffff", 3, null],
      ["com.uniworkos.chat version code 11 (Play)", "android", null, 0, 0.001],
    ],
  );
  assert.deepEqual(collect([], { appId: APP.appId }), []);
});

/** A stand-in eas-cli: the groups on each branch (newest first) and each group's updates; records every call. */
function fakeEas(branches) {
  const calls = [];
  const eas = (args) => {
    calls.push(args);
    if (args[0] === "update:list") {
      const groups = branches[args[2]] ?? [];
      return JSON.stringify({ currentPage: groups.map(({ id, rollout, runtime = "fp1" }) => ({ group: id, rolloutPercentage: rollout, runtimeVersion: runtime })) });
    }
    if (args[0] === "update:view") return JSON.stringify(Object.values(branches).flat().find((g) => g.id === args[1]).updates.map((id) => ({ id })));
    if (args[0] === "update:revert-update-rollout") return "";
    throw new Error(`unexpected eas ${args.join(" ")}`);
  };
  return { eas, calls };
}

test("an update is found on its channel by platform, with whether a newer group for its runtime replaced it", () => {
  const { eas, calls } = fakeEas({
    production: [
      { id: "g-new", rollout: undefined, runtime: "fp2", updates: ["n"] },
      { id: "g-bad", rollout: 10, updates: [OTA.toUpperCase()] },
      { id: "g-old", rollout: undefined, updates: ["o"] },
    ],
  });
  assert.deepEqual(locateUpdate(OTA, ["production"], "ios", eas), { channel: "production", group: "g-bad", rolloutPercentage: 10, supersededBy: null });
  assert.deepEqual(calls[0], ["update:list", "--branch", "production", "--platform", "ios", "--limit", "25", "--json", "--non-interactive"]);
  assert.equal(locateUpdate("o", ["production"], "android", eas).supersededBy, "g-bad", "a newer group on the same runtime replaces it");
  assert.equal(locateUpdate("missing", ["internal", "production"], "android", eas), null);
});

const halt = (over) => judge(record({ sessions: 500, crashFree: 0.99, ...over }), THRESHOLDS);

test("an unhealthy OTA still rolling out is reverted; one replaced since is not red; one fully out needs a person", async () => {
  const bad = halt({ release: `rel-ota`, updateId: OTA });
  const rolling = fakeEas({ production: [{ id: "g-bad", rollout: 10, updates: [OTA] }] });
  const reverted = await enforce([bad], { app: APP, channels: ["production"], dryRun: false, eas: rolling.eas, keyPath: "/tmp/k.pem" });
  assert.equal(reverted.red, true);
  assert.match(reverted.lines[0], /rollout reverted.*group g-bad on production/);
  assert.deepEqual(rolling.calls.at(-1), [
    "update:revert-update-rollout", "--group", "g-bad", "--message", "release-health: crash-free 99.00 % over 500 sessions (< 99.50 %)", "--non-interactive", "--private-key-path", "/tmp/k.pem",
  ]);
  const unsigned = fakeEas({ production: [{ id: "g-bad", rollout: 10, updates: [OTA] }] });
  await enforce([bad], { app: APP, channels: ["production"], dryRun: false, eas: unsigned.eas });
  assert.equal(unsigned.calls.at(-1).includes("--private-key-path"), false);

  const dry = await enforce([bad], { app: APP, channels: ["production"], dryRun: true, eas: rolling.eas });
  assert.match(dry.lines[0], /dry run.*would revert rollout group g-bad/);

  // The revert (or a fix) is a newer group on the branch: the next hours report it without a red run.
  const replaced = fakeEas({ production: [{ id: "g-revert", rollout: undefined, updates: ["r"] }, { id: "g-bad", rollout: 10, updates: [OTA] }] });
  const quiet = await enforce([bad], { app: APP, channels: ["production"], dryRun: false, eas: replaced.eas });
  assert.deepEqual(quiet, { lines: ["- stopped earlier — rel-ota: crash-free 99.00 % over 500 sessions (< 99.50 %); group g-bad is replaced by g-revert on production"], red: false });

  const full = fakeEas({ production: [{ id: "g-bad", rollout: 100, updates: [OTA] }] });
  const person = await enforce([bad], { app: APP, channels: ["production"], dryRun: false, eas: full.eas });
  assert.match(person.lines[0], /needs a person.*out to every phone on production: run "UniChat mobile rollback"/);
  assert.equal(person.red, true);
  const gone = await enforce([bad], { app: APP, channels: ["production"], dryRun: false, eas: fakeEas({}).eas });
  assert.match(gone.lines[0], /needs a person.*not found on production/);
});

test("an unhealthy Android build is halted where it rolls out, once; an iOS build's phased release is paused", async () => {
  const android = halt({ release: "rel-a", build: "12" });
  const ios = halt({ release: "rel-i", build: "5", os: "ios", version: "0.3.1" });
  const ok = judge(record({ release: "rel-ok", sessions: 5000, crashFree: 0.999, users: 900 }), THRESHOLDS);
  const halted = [];
  const paused = [];
  const play = async (build) => (halted.push(build), { track: "beta", alreadyHalted: false });
  const appStore = async (version) => (paused.push(version), { alreadyInState: false });
  const first = await enforce([ok, android, ios], { app: APP, channels: ["production"], dryRun: false, play, appStore });
  assert.deepEqual([halted, paused], [["12"], ["0.3.1"]]);
  assert.deepEqual(first.lines, [
    "- ok — rel-ok: crash-free 99.90 % over 5000 sessions, 900 people",
    "- **unhealthy, Play rollout halted** — rel-a: crash-free 99.00 % over 500 sessions (< 99.50 %); version code 12 on beta",
    "- **unhealthy, App Store phased release paused** — rel-i: crash-free 99.00 % over 500 sessions (< 99.50 %); version 0.3.1",
  ]);
  assert.equal(first.red, true);

  // Audit miss "release-health red every hour on an already-halted release": a stop made earlier is not red again.
  const later = await enforce([android, ios], { app: APP, channels: ["production"], dryRun: false, play: async () => ({ track: "production", alreadyHalted: true }), appStore: async () => ({ alreadyInState: true }) });
  assert.equal(later.red, false);
  assert.match(later.lines[0], /stopped earlier.*already halted on production/);
  assert.match(later.lines[1], /stopped earlier.*phased release of 0\.3\.1 is already paused/);
  const internal = await enforce([android], { app: APP, channels: ["production"], dryRun: false, play: async () => null });
  assert.deepEqual(internal.red, false);
  assert.match(internal.lines[0], /watching.*in no rollout on production, beta, alpha/);

  const keyless = await enforce([android, ios], { app: APP, channels: ["production"], dryRun: false, play: null, appStore: null });
  assert.match(keyless.lines[0], /no PLAY_SERVICE_ACCOUNT_JSON to halt version code 12/);
  assert.match(keyless.lines[1], /no App Store Connect key \(ASC_\*\) to pause the phased release of 0\.3\.1/);
  const dry = await enforce([android, ios], { app: APP, channels: ["production"], dryRun: true, play: async () => assert.fail("dry run"), appStore: async () => assert.fail("dry run") });
  assert.match(dry.lines[0], /would halt version code 12 on production \/ beta \/ alpha/);
  assert.match(dry.lines[1], /would pause the App Store phased release of 0\.3\.1/);
  const failing = await enforce([android], { app: APP, channels: ["production"], dryRun: false, play: async () => Promise.reject(new Error("Play 500")) });
  assert.match(failing.lines[0], /stopping it failed.*Play 500/);
  assert.equal(failing.red, true);
  const failingText = await enforce([android], { app: APP, channels: ["production"], dryRun: false, play: async () => Promise.reject("plain") });
  assert.match(failingText.lines[0], /stopping it failed.*plain/);
  assert.deepEqual(await enforce([], { app: APP, channels: [] }), { lines: ["- no production sessions in the last 24 hours"], red: false });
});

test("a tester build has nothing a machine can stop: it is listed, and only its OTAs are reverted", async () => {
  const build = halt({ release: "rel-s", build: "40" });
  const iosBuild = halt({ release: "rel-si", build: "7", os: "ios" });
  const result = await enforce([build, iosBuild], { app: APPS.staging, channels: ["internal"], dryRun: false, play: async () => assert.fail("no Play halt for testers") });
  assert.equal(result.red, false);
  assert.match(result.lines[0], /fix forward.*Play internal testing/);
  assert.match(result.lines[1], /fix forward.*TestFlight/);
});

/** A Sentry with one organization's sessions, issues and issue tags; records every URL. */
function fakeSentry({ groups = [], fresh = {}, failures = [], status = 200 } = {}) {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push({ url, auth: init?.headers?.authorization });
    const reply = (body) => ({ ok: status === 200, status, json: async () => body });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/sessions/")) return reply({ groups });
    if (parsed.pathname.endsWith("/issues/")) {
      const query = parsed.searchParams.get("query");
      if (query === "has:failed_update_id") return reply(failures.map((f, i) => ({ id: String(100 + i), shortId: `F-${i}`, userCount: f.users })));
      const release = query.match(/firstRelease:"([^"]+)"/)[1];
      return reply(fresh[release] ?? []);
    }
    const tag = parsed.pathname.match(/\/issues\/(\d+)\/tags\/(\w+)\/$/);
    if (tag) {
      const failure = failures[Number(tag[1]) - 100];
      return reply({ topValues: [{ value: tag[2] === "os" ? failure.os : failure.updateId }] });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, urls };
}

const sessionGroup = (release, sessions, crashFree, users = 10, crashFreeUsers = 1) => ({
  by: { release },
  totals: { "sum(session)": sessions, "crash_free_rate(session)": crashFree, "count_unique(user)": users, "crash_free_rate(user)": crashFreeUsers },
});

test("the command reads Sentry, writes the summary, and is red only when something must stop", async () => {
  const env = { SENTRY_AUTH_TOKEN: "sntrys", SENTRY_ORG: "uniai team" };
  const out = [];
  const written = [];
  const io = { log: (l) => out.push(l), summary: (t) => written.push(t) };
  const healthy = fakeSentry({ groups: [sessionGroup("com.uniworkos.chat@0.3.0+12.android", 400, 1), sessionGroup("other.app@1.0.0+1", 5, 0)] });
  assert.equal(await main([], { env, fetchImpl: healthy.fetchImpl, ...io }), 0);
  const sessionsUrl = healthy.urls[0].url;
  assert.match(sessionsUrl, /^https:\/\/sentry\.io\/api\/0\/organizations\/uniai%20team\/sessions\/\?field=sum%28session%29&field=crash_free_rate%28session%29&field=count_unique%28user%29&field=crash_free_rate%28user%29&groupBy=release&environment=production&statsPeriod=24h/);
  assert.equal(healthy.urls[0].auth, "Bearer sntrys");
  assert.ok(healthy.urls.some(({ url }) => decodeURIComponent(url).includes('firstRelease:"com.uniworkos.chat@0.3.0+12.android"')), "new crashes are asked of each release");
  assert.ok(!healthy.urls.some(({ url }) => decodeURIComponent(url).includes("other.app")), "another app's release is not");
  assert.match(written[0], /^### UniChat release health \(production: production, last 24 h\)/);
  assert.match(written[0], /- ok — com\.uniworkos\.chat@0\.3\.0\+12\.android/);

  // A pilot: eight sessions, a new crash two people hit. The rate cannot judge it; the new crash does.
  const pilot = fakeSentry({
    groups: [sessionGroup("com.uniworkos.chat.staging@0.3.0+40.android", 8, 0.75, 4, 0.5)],
    fresh: { "com.uniworkos.chat.staging@0.3.0+40.android": [{ id: "9", shortId: "UNICHAT-STG-1", userCount: 2, permalink: "https://sentry.example/i/9" }] },
    failures: [{ updateId: OTA, os: "iOS 18.1", users: 2 }],
  });
  const { eas } = fakeEas({ internal: [{ id: "g-ios", rollout: 20, updates: [OTA] }] });
  const code = await main(["--app", "staging", "--channel", "internal", "--dry-run"], { env: { ...env, SENTRY_URL: "https://sentry.example/" }, fetchImpl: pilot.fetchImpl, eas, ...io });
  assert.equal(code, 1);
  assert.match(pilot.urls[0].url, /^https:\/\/sentry\.example\/api\/0\/organizations\/.*environment=staging/);
  assert.match(written.at(-1), /new crash UNICHAT-STG-1 hit 2 people/);
  assert.match(written.at(-1), /com\.uniworkos\.chat\.staging update .* \(ios\): 2 phones could not launch this update; would revert rollout group g-ios on internal/);
  assert.match(out.at(-1), /::error::a staging release of UniChat must stop/);

  await assert.rejects(main([], { env, fetchImpl: fakeSentry({ status: 403 }).fetchImpl, ...io }), /Sentry answered 403 for \/sessions\//);
  await assert.rejects(main(["--app", "beta"], { env, ...io }), /--app is production or staging/);
  await assert.rejects(main(["--rollout"], { env, ...io }), /unknown argument --rollout/);
  await assert.rejects(main([], { env: { ...env, UNICHAT_HEALTH_MIN_SESSIONS: "x" }, fetchImpl: healthy.fetchImpl, ...io }), /must be a whole number/);
  const unset = [];
  assert.equal(await main([], { env: { SENTRY_ORG: "x" }, log: (l) => unset.push(l), summary: () => undefined }), 1);
  assert.match(unset[0], /::error::SENTRY_AUTH_TOKEN not set/);
});

test("with the Play and App Store keys, the command reads Play's vitals and stops builds in each store", async () => {
  const env = {
    SENTRY_AUTH_TOKEN: "s",
    SENTRY_ORG: "o",
    PLAY_SERVICE_ACCOUNT_JSON: "{}",
    ASC_KEY_ID: "k",
    ASC_ISSUER_ID: "i",
    ASC_PRIVATE_KEY: "not a key",
    ASC_APP_ID: "6400000000",
  };
  const sentry = fakeSentry({ groups: [sessionGroup("com.uniworkos.chat@0.3.1+5.ios", 400, 0.9)] });
  const out = [];
  const written = [];
  // The service account JSON is empty: the token request fails, so vitals are a warning and the Play halt an error
  // line; the App Store key is not a key, so the pause fails the same way. None of it hides the verdict.
  const code = await main([], { env, fetchImpl: sentry.fetchImpl, log: (l) => out.push(l), summary: (t) => written.push(t) });
  assert.equal(code, 1);
  assert.ok(out.some((l) => /::warning::Play vitals not read \(PLAY_SERVICE_ACCOUNT_JSON has no client_email/.test(l)));
  assert.match(written[0], /stopping it failed.*not an App Store Connect API key/);
});
