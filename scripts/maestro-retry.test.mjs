import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// scripts/maestro-retry.sh: one retry for a device run, never a silent one.
const script = path.join(import.meta.dirname, "maestro-retry.sh");

/** Runs the script with a fake `maestro` that fails its first `failures` calls. */
function run(failures, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-retry-"));
  try {
    const count = path.join(dir, "count");
    fs.writeFileSync(count, "0");
    fs.writeFileSync(
      path.join(dir, "maestro"),
      `#!/bin/sh\nn=$(($(cat "${count}") + 1))\necho "$n" > "${count}"\necho "maestro $*"\n[ "$n" -gt ${failures} ]\n`,
      { mode: 0o755 },
    );
    const summary = path.join(dir, "summary");
    const result = spawnSync("bash", [script, "test", "flows/smoke-launch.yaml"], {
      env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: summary, ...env },
      encoding: "utf8",
    });
    return {
      status: result.status,
      out: result.stdout,
      calls: Number(fs.readFileSync(count, "utf8")),
      summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "",
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
