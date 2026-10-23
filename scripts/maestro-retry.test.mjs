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
 */
function run(failures, env = {}, { logcat = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-retry-"));
  try {
    const count = path.join(dir, "count");
    fs.writeFileSync(count, "0");
    fs.writeFileSync(
      path.join(dir, "maestro"),
      `#!/bin/sh\nn=$(($(cat "${count}") + 1))\necho "$n" > "${count}"\necho "maestro $*"\n[ "$n" -gt ${failures} ]\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(dir, "adb"), '#!/bin/sh\necho "adb $* | E ReactNativeJS: TypeError: boom"\n', { mode: 0o755 });
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
