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
 */
function run(failures, env = {}, { logcat = false, adb = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-retry-"));
  try {
    const count = path.join(dir, "count");
    const sequence = path.join(dir, "sequence");
    fs.writeFileSync(count, "0");
    fs.writeFileSync(
      path.join(dir, "maestro"),
      `#!/bin/sh\nn=$(($(cat "${count}") + 1))\necho "$n" > "${count}"\necho "maestro" >> "${sequence}"\necho "maestro $*"\n[ "$n" -gt ${failures} ]\n`,
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
    const result = spawnSync("bash", [script, "test", "flows/smoke-launch.yaml"], {
      env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: summary, ...(logcat ? { MAESTRO_LOGCAT: log } : {}), ...env },
      encoding: "utf8",
    });
    return {
      status: result.status,
      out: result.stdout,
      calls: Number(fs.readFileSync(count, "utf8")),
      summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "",
      logcat: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : null,
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

// An emulator whose adbd dropped (\`device offline\`) stayed offline for the retry ten seconds later, so both attempts failed
// on a dead transport (UNI-2142, #437). With MAESTRO_ADB_RECOVER set, an attempt first reconnects an emulator adb does
// not call "device" and waits for it to finish booting; a healthy one costs one get-state.
test("MAESTRO_ADB_RECOVER reconnects an offline emulator before an attempt, and leaves a healthy one alone", () => {
  // get-state answers "offline" until reconnect has run, then "device"; the boot is complete.
  const offlineUntilReconnect = (dir) =>
    [
      `case "$1" in`,
      `  get-state) [ -f "${dir}/reconnected" ] && echo device || echo offline ;;`,
      `  reconnect) touch "${dir}/reconnected" ;;`,
      `  shell) echo 1 ;;`,
      `esac`,
    ].join("\n");
  const recovered = run(0, { MAESTRO_ADB_RECOVER: "1" }, { adb: offlineUntilReconnect });
  assert.equal(recovered.status, 0);
  assert.deepEqual(recovered.adb, ["adb get-state", "adb reconnect offline", "adb get-state", "adb shell getprop sys.boot_completed"]);
  assert.match(recovered.out, /::warning::adb reports the emulator offline before attempt 1; reconnecting/);

  const healthy = run(1, { MAESTRO_ADB_RECOVER: "1" }, { adb: () => `[ "$1" = get-state ] && echo device` });
  assert.equal(healthy.status, 0);
  assert.deepEqual(healthy.adb, ["adb get-state", "adb get-state"], "one get-state per attempt, nothing more");

  assert.deepEqual(run(1).adb, [], "without MAESTRO_ADB_RECOVER nothing calls adb");
});
