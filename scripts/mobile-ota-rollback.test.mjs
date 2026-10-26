import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, checkInputs, main, plan } from "./mobile-ota-rollback.mjs";

const REASON = "UNI-2053: crash on opening a room";
const base = { channel: "production", platform: "android", reason: REASON };
/** `eas update:list --json` groups, newest first. */
const groups = [
  { group: "g4", runtimeVersion: "fp2", rolloutPercentage: 10 },
  { group: "g3", runtimeVersion: "fp1" },
  { group: "g2", runtimeVersion: "fp1", isRollBackToEmbedded: true },
  { group: "g1", runtimeVersion: "fp1" },
  { group: "g0", runtimeVersion: "fp0" },
];

test("the inputs are checked before eas is asked anything", () => {
  assert.deepEqual(ACTIONS, ["revert-rollout", "republish-previous", "roll-back-to-embedded"]);
  assert.equal(checkInputs({ action: "revert-rollout", ...base }), `rollback: ${REASON}`);
  assert.throws(() => checkInputs({ ...base, action: "delete" }), /--action is one of/);
  assert.throws(() => checkInputs({ ...base, action: "revert-rollout", channel: "nightly" }), /--channel is one of/);
  assert.throws(() => checkInputs({ ...base, action: "revert-rollout", platform: "web" }), /--platform is android or ios/);
  assert.throws(() => checkInputs({ ...base, action: "revert-rollout", reason: " short " }), /at least 10 characters/);
  assert.throws(() => checkInputs({ ...base, action: "revert-rollout", reason: undefined }), /at least 10 characters/);
  assert.equal(checkInputs({ ...base, action: "revert-rollout", reason: "x".repeat(300) }).length, 200);
});

test("revert-rollout reverts the rolling group, named or the newest one", () => {
  assert.deepEqual(plan({ action: "revert-rollout", ...base }, groups), {
    argv: ["update:revert-update-rollout", "--group", "g4", "--message", `rollback: ${REASON}`, "--non-interactive"],
    says: "revert the 10 % rollout of group g4 on production",
  });
  assert.throws(() => plan({ action: "revert-rollout", ...base, group: "g3" }, groups), /no android update is rolling out on production as group g3/);
  assert.throws(() => plan({ action: "revert-rollout", ...base }, groups.slice(1)), /no android update is rolling out on production: use republish-previous/);
  assert.throws(() => plan({ action: "revert-rollout", ...base, group: "g9" }, groups), /group g9 is not among the newest android updates/);
});

test("republish-previous publishes the update before the bad one on its runtime, skipping rollbacks", () => {
  assert.deepEqual(plan({ action: "republish-previous", ...base, group: "g3" }, groups), {
    argv: ["update:republish", "--group", "g1", "--platform", "android", "--message", `rollback: ${REASON}`, "--non-interactive"],
    says: "publish group g1 again on production, over g3 (runtime fp1)",
  });
  assert.throws(() => plan({ action: "republish-previous", ...base }, groups), /g4 is still rolling out \(10 %\): use revert-rollout/);
  assert.throws(() => plan({ action: "republish-previous", ...base, group: "g1" }, groups), /g1 is already replaced by g3/);
  assert.throws(() => plan({ action: "republish-previous", ...base, group: "g0" }, groups), /no earlier android update for runtime fp0 on production: use roll-back-to-embedded/);
  assert.throws(() => plan({ action: "republish-previous", ...base }, []), /no android update on production to roll back/);
});

test("roll-back-to-embedded names the runtime: given, the named group's, or the newest group's", () => {
  const argv = (runtime) => ["update:roll-back-to-embedded", "--branch", "production", "--runtime-version", runtime, "--platform", "android", "--message", `rollback: ${REASON}`, "--non-interactive"];
  assert.deepEqual(plan({ action: "roll-back-to-embedded", ...base, runtimeVersion: "fpX" }, groups).argv, argv("fpX"));
  assert.deepEqual(plan({ action: "roll-back-to-embedded", ...base, group: "g0" }, groups).argv, argv("fp0"));
  assert.match(plan({ action: "roll-back-to-embedded", ...base }, groups).says, /android phones of runtime fp2 on production back to the bundle/);
  assert.throws(() => plan({ action: "roll-back-to-embedded", ...base }, []), /pass --runtime-version/);
});

test("the command lists the channel, signs the move with the CI key, and writes the summary", async () => {
  const calls = [];
  const eas = (args) => {
    calls.push(args);
    return args[0] === "update:list" ? JSON.stringify({ currentPage: groups }) : "published";
  };
  const out = [];
  const written = [];
  const io = { eas, log: (l) => out.push(l), summary: (t) => written.push(t) };
  const argv = ["--action", "republish-previous", "--channel", "production", "--platform", "ios", "--group", "g3", "--reason", REASON];
  const done = await main(argv, { env: { EAS_UPDATE_PRIVATE_KEY_PATH: "/tmp/k.pem" }, ...io });
  assert.deepEqual(calls[0], ["update:list", "--branch", "production", "--platform", "ios", "--limit", "50", "--json", "--non-interactive"]);
  assert.deepEqual(calls[1], [...done.argv]);
  assert.deepEqual(done.argv.slice(-2), ["--private-key-path", "/tmp/k.pem"]);
  assert.equal(out[0], "published");
  assert.match(written[0], /^### UniChat OTA rollback \(republish-previous, production, ios\)\n\n- did: publish group g1 again/);

  calls.length = 0;
  const dry = await main([...argv, "--dry-run"], { env: {}, ...io });
  assert.equal(calls.length, 1, "a dry run only lists");
  assert.equal(dry.argv.includes("--private-key-path"), false);
  assert.match(written.at(-1), /- would: publish group g1 again/);

  await assert.rejects(main(argv, { env: {}, ...io }), /EAS_UPDATE_PRIVATE_KEY_PATH is not set/);
  await assert.rejects(main(["--action", "revert-rollout", "--channel", "production"], { env: {}, ...io }), /--platform is android or ios/);
  await assert.rejects(main(["--force"], { env: {}, ...io }), /unknown argument --force/);
  const empty = (args) => (args[0] === "update:list" ? "{}" : "");
  await assert.rejects(main([...argv.slice(0, 6), "--reason", REASON, "--dry-run"], { env: {}, eas: empty, log: () => undefined, summary: () => undefined }), /no ios update on production/);
});
