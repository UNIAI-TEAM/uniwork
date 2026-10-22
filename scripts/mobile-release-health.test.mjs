import { test } from "node:test";
import assert from "node:assert/strict";
import { CRASH_FREE_FLOOR, MIN_SESSIONS, assess, enforce, main, parseRelease, rollingOutGroupOf, verdict } from "./mobile-release-health.mjs";

const OTA = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const group = (release, sessions, crashFree) => ({ by: { release }, totals: { "sum(session)": sessions, "crash_free_rate(session)": crashFree } });

test("a Sentry release names the build, and the OTA when one runs", () => {
  assert.deepEqual(parseRelease("com.uniworkos.chat@0.3.0+12"), { version: "0.3.0", versionCode: "12", updateId: null });
  assert.deepEqual(parseRelease(`com.uniworkos.chat@0.3.0+12.ota.${OTA}`), { version: "0.3.0", versionCode: "12", updateId: OTA });
  // The staging app and anything unnamed are not production's to stop.
  assert.equal(parseRelease("com.uniworkos.chat.staging@0.3.0+12"), null);
  assert.equal(parseRelease("unichat@0.3.0"), null);
});

test("the runbook's floor: 99.5 % over 200 sessions, or 98 % over 50 for a severe one", () => {
  assert.equal(CRASH_FREE_FLOOR, 0.995);
  assert.equal(MIN_SESSIONS, 200);
  assert.equal(verdict(200, 0.995), "ok");
  assert.equal(verdict(200, 0.994), "halt");
  assert.equal(verdict(199, 0.99), "watch", "too few sessions to judge a mild drop");
  assert.equal(verdict(50, 0.97), "halt", "a severe drop needs fewer");
  assert.equal(verdict(49, 0.5), "watch");
  assert.equal(verdict(0, null), "watch");
  assert.equal(verdict(300, null), "watch");
});

test("assess keeps the production app's releases, biggest first", () => {
  const releases = assess([
    group("com.uniworkos.chat@0.3.0+12", 120, 1),
    group(`com.uniworkos.chat@0.3.0+12.ota.${OTA}`, 900, 0.97),
    group("com.uniworkos.chat.staging@0.3.0+40", 900, 0.5),
    { by: {}, totals: {} },
    group("com.uniworkos.chat@0.3.0+11", 400, "bad"),
  ]);
  assert.deepEqual(
    releases.map((r) => [r.release, r.verdict]),
    [
      [`com.uniworkos.chat@0.3.0+12.ota.${OTA}`, "halt"],
      ["com.uniworkos.chat@0.3.0+11", "watch"],
      ["com.uniworkos.chat@0.3.0+12", "watch"],
    ],
  );
  assert.deepEqual(assess(undefined), []);
});

/** A stand-in eas-cli: the rollouts on the branch and each group's updates; records every call. */
function fakeEas(groups) {
  const calls = [];
  const eas = (args) => {
    calls.push(args);
    if (args[0] === "update:list") return JSON.stringify({ currentPage: groups.map(({ id, rollout }) => ({ group: id, rolloutPercentage: rollout })) });
    if (args[0] === "update:view") return JSON.stringify(groups.find((g) => g.id === args[1]).updates.map((id) => ({ id, platform: "android" })));
    if (args[0] === "update:revert-update-rollout") return "";
    throw new Error(`unexpected eas ${args.join(" ")}`);
  };
  return { eas, calls };
}

test("an unhealthy OTA still rolling out is reverted by its group; one fully out is left to a person", async () => {
  const { eas, calls } = fakeEas([
    { id: "g-full", rollout: undefined, updates: ["other"] },
    { id: "g-other", rollout: 20, updates: ["someone-else"] },
    { id: "g-bad", rollout: 10, updates: [OTA, "ios-id"] },
  ]);
  assert.equal(rollingOutGroupOf(OTA, "production", eas), "g-bad");
  assert.deepEqual(calls[0], ["update:list", "--branch", "production", "--platform", "android", "--limit", "25", "--json", "--non-interactive"]);
  assert.equal(calls.filter((c) => c[0] === "update:view").length, 2, "only the groups still rolling out are opened");

  const bad = assess([group(`com.uniworkos.chat@0.3.0+12.ota.${OTA}`, 500, 0.99)]);
  const reverted = await enforce(bad, { channel: "production", dryRun: false, eas, play: null, keyPath: "/tmp/k.pem" });
  assert.equal(reverted.unhealthy, true);
  assert.match(reverted.lines[0], /rollout reverted.*group g-bad/);
  assert.deepEqual(calls.at(-1), ["update:revert-update-rollout", "--group", "g-bad", "--message", "release-health: 99.00 % crash-free over 500 sessions", "--non-interactive", "--private-key-path", "/tmp/k.pem"]);

  const dry = await enforce(bad, { channel: "production", dryRun: true, eas, play: null });
  assert.match(dry.lines[0], /dry run.*would revert rollout group g-bad/);
  assert.notEqual(calls.at(-1)[0], "update:revert-update-rollout");

  const done = fakeEas([{ id: "g-bad", rollout: 100, updates: [OTA] }]);
  const person = await enforce(bad, { channel: "production", dryRun: false, eas: done.eas, play: null });
  assert.match(person.lines[0], /needs a person.*not in a rollout any more/);
  assert.ok(!done.calls.some((c) => c[0] === "update:revert-update-rollout"));
});

test("an unhealthy store build is halted on Play when the key is there, and reported when it is not", async () => {
  const bad = assess([group("com.uniworkos.chat@0.3.0+12", 300, 0.99), group("com.uniworkos.chat@0.3.0+11", 5000, 0.999)]);
  const halted = [];
  const result = await enforce(bad, { channel: "production", dryRun: false, eas: () => "", play: async (code) => void halted.push(code) });
  assert.deepEqual(halted, ["12"]);
  assert.deepEqual(result.lines, [
    "- ok — com.uniworkos.chat@0.3.0+11: crash-free 99.90 % over 5000 sessions",
    "- **unhealthy, Play rollout halted** — com.uniworkos.chat@0.3.0+12: crash-free 99.00 % over 300 sessions; version code 12",
  ]);
  assert.match((await enforce(bad, { channel: "production", dryRun: false, play: null })).lines[1], /no PLAY_SERVICE_ACCOUNT_JSON/);
  assert.match((await enforce(bad, { channel: "production", dryRun: true, play: async () => assert.fail("dry run") })).lines[1], /would halt version code 12/);
  const failing = await enforce(bad, { channel: "production", dryRun: false, play: async () => Promise.reject(new Error("no rolling-out release")) });
  assert.match(failing.lines[1], /stopping it failed.*no rolling-out release/);
  const nothing = await enforce([], { channel: "production" });
  assert.deepEqual(nothing, { lines: ["- no production sessions in the last 24 hours"], unhealthy: false });
});

test("the command reads Sentry, writes the summary, and is red only when a release is unhealthy", async () => {
  const requests = [];
  const sentry = (groups, status = 200) => async (url, init) => {
    requests.push({ url, auth: init.headers.authorization });
    return { ok: status === 200, status, json: async () => ({ groups }) };
  };
  const env = { SENTRY_AUTH_TOKEN: "sntrys", SENTRY_ORG: "uniai team" };
  const out = [];
  const written = [];
  const healthy = await main(["--channel", "production"], { env, fetchImpl: sentry([group("com.uniworkos.chat@0.3.0+12", 400, 1)]), log: (l) => out.push(l), summary: (t) => written.push(t) });
  assert.equal(healthy, 0);
  assert.match(requests[0].url, /^https:\/\/sentry\.io\/api\/0\/organizations\/uniai%20team\/sessions\/\?field=sum%28session%29&field=crash_free_rate%28session%29&groupBy=release&environment=production&statsPeriod=24h/);
  assert.equal(requests[0].auth, "Bearer sntrys");
  assert.match(written[0], /^### UniChat release health \(production, last 24 h\)/);
  assert.match(written[0], /- ok — com\.uniworkos\.chat@0\.3\.0\+12/);

  const sick = await main(["--dry-run"], { env: { ...env, SENTRY_URL: "https://sentry.example" }, fetchImpl: sentry([group("com.uniworkos.chat@0.3.0+12", 400, 0.9)]), log: (l) => out.push(l), summary: () => undefined });
  assert.equal(sick, 1);
  assert.match(requests.at(-1).url, /^https:\/\/sentry\.example\//);
  assert.match(out.at(-1), /::error::a production release is under the crash-free floor/);

  await assert.rejects(main([], { env, fetchImpl: sentry([], 403), log: () => undefined, summary: () => undefined }), /Sentry answered 403/);
  const unset = [];
  assert.equal(await main([], { env: { SENTRY_ORG: "x" }, log: (l) => unset.push(l), summary: () => undefined }), 1);
  assert.match(unset[0], /::error::SENTRY_AUTH_TOKEN not set/);
});
