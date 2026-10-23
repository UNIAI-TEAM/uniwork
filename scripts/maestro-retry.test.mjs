import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// scripts/maestro-retry.sh: one retry for a device run, never a silent one.
const script = path.join(import.meta.dirname, "maestro-retry.sh");

/**
 * Runs the script with a fake `maestro` that fails its first `failures` calls, and a fake `adb` whose log is one line.
 * `logcat: true` points MAESTRO_LOGCAT at a file in the run's directory and returns what was written there.
 * Fake `pkill`, `pgrep` (nothing left running) and `xcrun` record their calls in `sequence`, between the maestro runs.
 *
 * `outcomes` (e.g. ["drop", "fail", "pass"]) replaces `failures`: each maestro call writes a session into
 * MAESTRO_TESTS_DIR as Maestro writes ~/.maestro/tests/<timestamp>, whose maestro.log carries what a dropped adb
 * transport ("drop", the #437 log) or an app assertion ("fail") leaves there, and fails; "pass" writes nothing.
 * `attemptLogs: true` points MAESTRO_ATTEMPT_LOGS at a directory and returns its files and their contents.
 */
function run(failures, env = {}, { logcat = false, adb = null, outcomes = null, attemptLogs = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-retry-"));
  try {
    const count = path.join(dir, "count");
    const sequence = path.join(dir, "sequence");
    const tests = path.join(dir, "tests");
    fs.writeFileSync(count, "0");
    const verdict = outcomes
      ? [
          `outcome=$(sed -n "\${n}p" "${path.join(dir, "outcomes")}")`,
          `[ "$outcome" = pass ] && exit 0`,
          `session="${tests}/2026-10-23_18160$n/Sign-in"`,
          `mkdir -p "$session/logs"`,
          `if [ "$outcome" = drop ]; then`,
          `  line="[ERROR] maestro.orchestra.Orchestra.executeCommands: [Command execution] CommandFailed: Command failed (host:transport:emulator-5554): device offline"`,
          `  echo "I adbd    : host-17: offline" > "$session/logs/device-logcat.txt"`,
          `else`,
          `  line="[ERROR] maestro.orchestra.Orchestra.executeCommands: [Command execution] Assertion is false: id: sign-in is visible"`,
          `  echo "E ReactNativeJS: TypeError: boom" > "$session/logs/device-logcat.txt"`,
          `fi`,
          `printf '%s\\n' "Input text maestro-1700000000-pw" "$line" > "$session/logs/maestro.log"`,
          `echo "I ime: typed maestro-1700000000-pw" >> "$session/logs/device-logcat.txt"`,
          `cp "$session/logs/maestro.log" "${tests}/2026-10-23_18160$n/maestro.log"`,
          `exit 1`,
        ].join("\n")
      : `[ "$n" -gt ${failures} ]`;
    if (outcomes) fs.writeFileSync(path.join(dir, "outcomes"), `${outcomes.join("\n")}\n`);
    fs.writeFileSync(
      path.join(dir, "maestro"),
      `#!/bin/sh\nn=$(($(cat "${count}") + 1))\necho "$n" > "${count}"\necho "maestro" >> "${sequence}"\necho "maestro $*"\n${verdict}\n`,
      { mode: 0o755 },
    );
    for (const [tool, status] of [["pkill", 0], ["pgrep", 1], ["xcrun", 0]]) {
      fs.writeFileSync(path.join(dir, tool), `#!/bin/sh\necho "${tool} $*" >> "${sequence}"\nexit ${status}\n`, { mode: 0o755 });
    }
    fs.writeFileSync(
      path.join(dir, "adb"),
      adb
        ? `#!/bin/sh\necho "adb $*" >> "${path.join(dir, "adb-calls")}"\n${adb(dir)}\n`
        : `#!/bin/sh\necho "adb $*" >> "${path.join(dir, "adb-calls")}"\necho "adb $* | E ReactNativeJS: TypeError: boom"\n`,
      { mode: 0o755 },
    );
    const summary = path.join(dir, "summary");
    const log = path.join(dir, "logcat.txt");
    const kept = path.join(dir, "attempts");
    const result = spawnSync("bash", [script, "test", "flows/smoke-launch.yaml"], {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_STEP_SUMMARY: summary,
        MAESTRO_TESTS_DIR: tests,
        MAESTRO_ADB_SETTLE: "0",
        ...(logcat ? { MAESTRO_LOGCAT: log } : {}),
        ...(attemptLogs ? { MAESTRO_ATTEMPT_LOGS: kept } : {}),
        ...env,
      },
      encoding: "utf8",
    });
    const files = (root) =>
      fs.existsSync(root)
        ? Object.fromEntries(
            fs
              .readdirSync(root, { recursive: true })
              .filter((f) => fs.statSync(path.join(root, f)).isFile())
              .sort()
              .map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]),
          )
        : null;
    return {
      status: result.status,
      out: result.stdout,
      calls: Number(fs.readFileSync(count, "utf8")),
      summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "",
      logcat: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : null,
      attempts: files(kept),
      adb: fs.existsSync(path.join(dir, "adb-calls")) ? fs.readFileSync(path.join(dir, "adb-calls"), "utf8").trim().split("\n") : [],
      sequence: fs.existsSync(sequence) ? fs.readFileSync(sequence, "utf8").trim().split("\n") : [],
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("a run that passes runs once and says nothing", () => {
  const r = run(0);
  assert.equal(r.status, 0);
  assert.equal(r.calls, 1);
  assert.match(r.out, /maestro test flows\/smoke-launch\.yaml/, "the arguments reach maestro as given");
  assert.doesNotMatch(r.out, /::warning/);
  assert.equal(r.summary, "");
});

test("a run that passes on the retry passes, as a flaky-run warning and a summary line", () => {
  const r = run(1);
  assert.equal(r.status, 0);
  assert.equal(r.calls, 2);
  assert.match(r.out, /::warning title=Flaky device run::maestro test flows\/smoke-launch\.yaml failed, then passed on attempt 2 of 2/);
  assert.match(r.summary, /^- flaky: `maestro test flows\/smoke-launch\.yaml` passed on attempt 2 of 2$/m);
});

test("a run that fails twice fails, and MAESTRO_ATTEMPTS=1 turns the retry off", () => {
  const twice = run(2);
  assert.equal(twice.status, 1);
  assert.equal(twice.calls, 2);
  assert.match(twice.out, /::error title=Device run failed::maestro test flows\/smoke-launch\.yaml failed 2 time\(s\)/);
  const once = run(1, { MAESTRO_ATTEMPTS: "1" });
  assert.equal(once.status, 1);
  assert.equal(once.calls, 1);
});

// CI's Android flow showed the workspace's error screen and nothing else: the JavaScript error was only in logcat,
// and the emulator was gone by the time a later step could ask for it.
test("a run that fails for good dumps the device log where MAESTRO_LOGCAT says, and only then", () => {
  const failed = run(2, {}, { logcat: true });
  assert.equal(failed.status, 1);
  assert.match(failed.logcat ?? "", /^--- adb logcat -d after: maestro test flows\/smoke-launch\.yaml$/m);
  assert.match(failed.logcat ?? "", /^adb logcat -d -v threadtime \| E ReactNativeJS: TypeError: boom$/m);
  assert.equal(run(1, {}, { logcat: true }).logcat, null, "a pass on the retry dumps nothing");
  assert.equal(run(2).logcat, null, "without MAESTRO_LOGCAT (iOS) nothing calls adb");
});

// Review P2: the retry reruns a flow from its first command. A flow that turns airplane mode on and fails before it
// turns it off again would leave the emulator offline, so the retry's clean launch and browser sign-in could never
// pass: one flake became a hard red. Every such flow starts by turning it off, before it launches the app.
const flows = path.join(import.meta.dirname, "..", "apps", "chat-mobile", "maestro", "flows");
const commandsOf = (text) => (text.split(/^---$/m)[1] ?? "").split("\n").filter((line) => /^- \S/.test(line)).map((line) => line.slice(2).trim());

test("MAESTRO_ADB_REVERSE maps its ports again before every attempt, and without it nothing calls adb", () => {
  const twice = run(1, { MAESTRO_ADB_REVERSE: "3000 8080" });
  assert.equal(twice.status, 0);
  assert.deepEqual(twice.adb, ["adb reverse tcp:3000 tcp:3000", "adb reverse tcp:8080 tcp:8080", "adb reverse tcp:3000 tcp:3000", "adb reverse tcp:8080 tcp:8080"]);
  assert.deepEqual(run(0).adb, []);
});

// CI's iOS smoke timed out waiting for Maestro's XCTest driver on both attempts (run 39961695475): the first attempt's
// xcodebuild was never stopped, so the retry started a second runner for the same bundle beside it.
test("MAESTRO_IOS_UDID stops the last attempt's driver before every retry, and only then", () => {
  const udid = "582B068E-0000-4000-8000-000000000000";
  const spawn = `xcodebuild test-without-building .*-destination id=${udid}`;
  const cleared = [`pkill -f ${spawn}`, `pgrep -f ${spawn}`, `xcrun simctl terminate ${udid} dev.mobile.maestro-driver-iosUITests.xctrunner`, `xcrun simctl bootstatus ${udid} -b`];
  const retried = run(1, { MAESTRO_IOS_UDID: udid });
  assert.equal(retried.status, 0);
  assert.deepEqual(retried.sequence, ["maestro", ...cleared, "maestro"], "cleared between the attempts, not before the first");
  assert.deepEqual(run(2, { MAESTRO_IOS_UDID: udid }).sequence, ["maestro", ...cleared, "maestro"], "nothing after the last attempt");
  assert.deepEqual(run(0, { MAESTRO_IOS_UDID: udid }).sequence, ["maestro"], "a pass on the first attempt touches nothing");
  const android = run(1, { MAESTRO_ADB_REVERSE: "3000" });
  assert.deepEqual(android.sequence, ["maestro", "maestro"], "without MAESTRO_IOS_UDID (Android) nothing calls pkill or xcrun");
  assert.deepEqual(android.adb, ["adb reverse tcp:3000 tcp:3000", "adb reverse tcp:3000 tcp:3000"]);
});

test("every flow that turns airplane mode on starts online, so a retry is not born offline", () => {
  const offline = fs.readdirSync(flows).filter((f) => f.endsWith(".yaml") && /^\s*- setAirplaneMode: enabled$/m.test(fs.readFileSync(path.join(flows, f), "utf8")));
  assert.ok(offline.includes("offline-send-relaunch.yaml") && offline.includes("upgrade-before.yaml"), "the scan finds the offline flows");
  for (const file of offline) {
    const commands = commandsOf(fs.readFileSync(path.join(flows, file), "utf8"));
    const launch = commands.findIndex((c) => c.startsWith("launchApp"));
    assert.ok(launch > 0, `${file} launches the app`);
    assert.ok(commands.slice(0, launch).includes("setAirplaneMode: disabled"), `${file} turns airplane mode off before launchApp`);
  }
});

test("the PR gate's offline flow also leaves the emulator online for the flow after it", () => {
  const text = fs.readFileSync(path.join(flows, "offline-send-relaunch.yaml"), "utf8");
  const header = text.split(/^---$/m)[0];
  assert.match(header, /^onFlowComplete:\n {2}- setAirplaneMode: disabled$/m);
});


// UNI-2142: the emulator's adb connection drops for 0.3–0.5 s in the first seconds of a Maestro session (adbd: "host-17:
// offline", then a new host connection), Maestro 2.11.0's next shell call meets "device offline" and the flow fails on
// "Launch app" (mobile-dev-inc/maestro#3451). By the time anything can ask, the transport is back, so `adb get-state`
// read "device" and the old check never acted, while the retry hit the same window again (#434, #437). The failed
// session's own log says it was the transport: that run gets a fresh adb server and does not spend an app attempt.
const healthyAdb = () => [`case "$1" in`, `  get-state) echo device ;;`, `  shell) echo 1 ;;`, `esac`].join("\n");
const reset = ["adb kill-server", "adb start-server", "adb get-state", "adb shell getprop sys.boot_completed"];

test("MAESTRO_ADB_RECOVER restarts adb after a run its log shows lost the transport, and reruns it as an infra retry", () => {
  const r = run(0, { MAESTRO_ADB_RECOVER: "1" }, { adb: healthyAdb, outcomes: ["drop", "pass"] });
  assert.equal(r.status, 0);
  assert.equal(r.calls, 2);
  assert.deepEqual(r.adb, reset, "nothing before the first attempt, a fresh server and a booted emulator before the rerun");
  assert.match(r.out, /::warning title=adb transport dropped::maestro test flows\/smoke-launch\.yaml lost the emulator's adb transport \(device offline\) on attempt 1 of 2; restarting the adb server and running it again \(infra retry 1 of 2\)/);
  assert.doesNotMatch(r.out, /Flaky device run/, "a dropped transport is not the app's flake");
  assert.match(r.summary, /^- adb transport dropped: `maestro test flows\/smoke-launch\.yaml` on attempt 1; adb server restarted$/m);
});

test("a dropped transport spends its own budget, so the app keeps both of its attempts", () => {
  const r = run(0, { MAESTRO_ADB_RECOVER: "1" }, { adb: healthyAdb, outcomes: ["drop", "drop", "fail", "pass"] });
  assert.equal(r.status, 0);
  assert.equal(r.calls, 4);
  assert.deepEqual(r.adb, [...reset, ...reset], "a reset after each drop, none after the app's own failure");
  assert.match(r.out, /::warning title=Flaky device run::maestro test flows\/smoke-launch\.yaml failed, then passed on attempt 2 of 2/);
});

test("past MAESTRO_ADB_DROPS a drop is an ordinary failed attempt, and the error names the transport", () => {
  const r = run(0, { MAESTRO_ADB_RECOVER: "1", MAESTRO_ADB_DROPS: "1" }, { adb: healthyAdb, outcomes: ["drop", "drop", "drop", "pass"] });
  assert.equal(r.status, 1);
  assert.equal(r.calls, 3, "one infra retry, then the two app attempts");
  assert.deepEqual(r.adb, reset);
  assert.match(r.out, /::error title=Device run failed::maestro test flows\/smoke-launch\.yaml failed 2 time\(s\); the emulator's adb transport dropped on 3 run\(s\)/);
});

test("an app failure is not a drop, and without MAESTRO_ADB_RECOVER a drop is not either", () => {
  const app = run(0, { MAESTRO_ADB_RECOVER: "1" }, { adb: healthyAdb, outcomes: ["fail", "fail"] });
  assert.equal(app.status, 1);
  assert.equal(app.calls, 2);
  assert.deepEqual(app.adb, [], "no adb restart for an assertion");
  assert.doesNotMatch(app.out, /adb transport dropped/);
  assert.match(app.out, /::error title=Device run failed::maestro test flows\/smoke-launch\.yaml failed 2 time\(s\)$/m);

  const off = run(0, {}, { adb: healthyAdb, outcomes: ["drop", "drop", "pass"] });
  assert.equal(off.status, 1);
  assert.equal(off.calls, 2);
  assert.deepEqual(off.adb, [], "without MAESTRO_ADB_RECOVER (iOS) nothing calls adb");
});

test("after an adb restart MAESTRO_ADB_REVERSE maps its ports again, and an emulator not back in time is a warning", () => {
  const r = run(0, { MAESTRO_ADB_RECOVER: "1", MAESTRO_ADB_REVERSE: "3000" }, { adb: healthyAdb, outcomes: ["drop", "pass"] });
  assert.equal(r.status, 0);
  assert.deepEqual(r.adb, ["adb reverse tcp:3000 tcp:3000", ...reset, "adb reverse tcp:3000 tcp:3000"], "kill-server drops the mappings");

  const gone = run(0, { MAESTRO_ADB_RECOVER: "1", MAESTRO_ADB_WAIT: "0" }, { adb: () => `[ "$1" = get-state ] && echo offline`, outcomes: ["drop", "pass"] });
  assert.equal(gone.status, 0);
  assert.match(gone.out, /::warning::the emulator was not back after restarting the adb server, before the rerun of attempt 1/);
});

// maestro-e2e keeps screenshots only, since Maestro's log holds the typed password, and Maestro clears logcat at every
// flow start: a drop on the hermetic job could not be confirmed from its artifact. Each failed run's own logs are kept.
test("MAESTRO_ATTEMPT_LOGS keeps every failed run's maestro.log and device log, without the password's lines", () => {
  const r = run(0, { MAESTRO_ADB_RECOVER: "1", MAESTRO_TEST_PASSWORD: "maestro-1700000000-pw" }, { adb: healthyAdb, outcomes: ["drop", "fail", "pass"], attemptLogs: true });
  assert.equal(r.status, 0);
  const attempts = r.attempts ?? {};
  assert.deepEqual(Object.keys(attempts), [
    "smoke-launch-run1/2026-10-23_181601/Sign-in/logs/device-logcat.txt",
    "smoke-launch-run1/2026-10-23_181601/Sign-in/logs/maestro.log",
    "smoke-launch-run1/2026-10-23_181601/maestro.log",
    "smoke-launch-run2/2026-10-23_181602/Sign-in/logs/device-logcat.txt",
    "smoke-launch-run2/2026-10-23_181602/Sign-in/logs/maestro.log",
    "smoke-launch-run2/2026-10-23_181602/maestro.log",
  ], "the passing run keeps nothing");
  for (const [file, text] of Object.entries(attempts)) assert.doesNotMatch(text, /maestro-1700000000-pw/, file);
  assert.match(attempts["smoke-launch-run1/2026-10-23_181601/maestro.log"], /device offline/);
  assert.match(attempts["smoke-launch-run1/2026-10-23_181601/Sign-in/logs/device-logcat.txt"], /adbd {4}: host-17: offline/);
  assert.equal(run(0, {}, { outcomes: ["fail", "pass"] }).attempts, null, "without MAESTRO_ATTEMPT_LOGS nothing is kept");
});
