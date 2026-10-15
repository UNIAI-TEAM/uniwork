// harness/stale-next.mjs (G8-19 B1, UNI-1414): start.sh stops a next dev left over
// from an earlier round on a warm VM, but only one that runs from THIS checkout's
// apps/web. The scan reads a /proc-shaped directory, so these tests build a fake
// one: <root>/<pid>/cmdline (NUL-separated) and <root>/<pid>/cwd (a symlink).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findNextDev, stopStaleNextDev } from "./stale-next.mjs";

const CLI = fileURLToPath(new URL("./stale-next.mjs", import.meta.url));
const TMP = [];
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "stale-next-test-"));
  TMP.push(dir);
  return dir;
}
after(() => {
  for (const dir of TMP) rmSync(dir, { recursive: true, force: true });
});

/** One fake process. `cwd: null` leaves no cwd link (a process that exited or is not ours to read). */
function addProc(procRoot, pid, { argv, cwd, state }) {
  const dir = join(procRoot, String(pid));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cmdline"), `${argv.join("\0")}\0`);
  if (cwd) symlinkSync(cwd, join(dir, "cwd"));
  if (state) writeFileSync(join(dir, "stat"), `${pid} (next-server) ${state} 1 1 1\n`);
}

function world() {
  const root = tmp();
  const procRoot = join(root, "proc");
  const mine = join(root, "checkout-a", "apps", "web");
  const other = join(root, "checkout-b", "apps", "web");
  mkdirSync(procRoot);
  mkdirSync(mine, { recursive: true });
  mkdirSync(other, { recursive: true });
  return { root, procRoot, mine, other };
}

const NEXT_DEV = ["node", "/x/node_modules/.bin/next", "dev", "--port", "3000"];

test("findNextDev lists next dev processes and marks the ones whose cwd is this checkout's apps/web", () => {
  const w = world();
  addProc(w.procRoot, 101, { argv: NEXT_DEV, cwd: w.mine });
  addProc(w.procRoot, 102, { argv: NEXT_DEV, cwd: w.other });
  // a symlinked spelling of the same directory still counts (realpath compare)
  const alias = join(w.root, "alias-web");
  symlinkSync(w.mine, alias);
  addProc(w.procRoot, 103, { argv: ["node", "/x/next/dist/bin/next", "dev"], cwd: alias });
  addProc(w.procRoot, 104, { argv: ["node", "server.js"], cwd: w.mine });
  addProc(w.procRoot, 105, { argv: ["node", "/x/next", "build"], cwd: w.mine });
  addProc(w.procRoot, 106, { argv: ["pnpm", "--filter", "@uniwork/web", "dev"], cwd: w.mine });
  const found = findNextDev({ procRoot: w.procRoot, webDir: w.mine });
  assert.deepEqual(found.map((p) => [p.pid, p.ours]), [[101, true], [102, false], [103, true]]);
  assert.equal(found[0].cwd, w.mine);
});

test("findNextDev skips a candidate with a missing or unreadable cwd, and a non-numeric /proc entry", () => {
  const w = world();
  addProc(w.procRoot, 201, { argv: NEXT_DEV, cwd: null });
  addProc(w.procRoot, 202, { argv: NEXT_DEV, cwd: join(w.root, "gone") }); // dangling link
  mkdirSync(join(w.procRoot, "self"));
  mkdirSync(join(w.procRoot, "301"), { recursive: true }); // no cmdline at all
  addProc(w.procRoot, 203, { argv: NEXT_DEV, cwd: w.mine });
  assert.deepEqual(findNextDev({ procRoot: w.procRoot, webDir: w.mine }).map((p) => p.pid), [203]);
});

test("findNextDev never lists the caller's own pid", () => {
  const w = world();
  addProc(w.procRoot, 401, { argv: NEXT_DEV, cwd: w.mine });
  assert.deepEqual(findNextDev({ procRoot: w.procRoot, webDir: w.mine, selfPid: 401 }), []);
});

test("a retitled next-server (its cmdline is the process title) in this checkout is a candidate too", () => {
  const w = world();
  addProc(w.procRoot, 501, { argv: ["next-server (v15.1.0)"], cwd: w.mine });
  assert.deepEqual(findNextDev({ procRoot: w.procRoot, webDir: w.mine }).map((p) => [p.pid, p.ours]), [[501, true]]);
});

/** A fake signal sender over the fake /proc: TERM removes the process unless `ignoreTerm` lists it. */
function fakeSignals(procRoot, { ignoreTerm = [] } = {}) {
  const sent = [];
  const signal = (pid, sig) => {
    sent.push([pid, sig]);
    if (sig === "SIGKILL" || (sig === "SIGTERM" && !ignoreTerm.includes(pid))) rmSync(join(procRoot, String(pid)), { recursive: true, force: true });
  };
  return { sent, signal };
}

test("stopStaleNextDev stops only this checkout's next dev, leaves the other checkout and non-next processes, one line per pid", async () => {
  const w = world();
  addProc(w.procRoot, 601, { argv: NEXT_DEV, cwd: w.mine });
  addProc(w.procRoot, 602, { argv: NEXT_DEV, cwd: w.other });
  addProc(w.procRoot, 603, { argv: ["node", "server.js"], cwd: w.mine });
  addProc(w.procRoot, 604, { argv: NEXT_DEV, cwd: null });
  const { sent, signal } = fakeSignals(w.procRoot);
  const lines = [];
  const stopped = await stopStaleNextDev({ procRoot: w.procRoot, webDir: w.mine, signal, log: (line) => lines.push(line), sleep: async () => {} });
  assert.deepEqual(sent, [[601, "SIGTERM"]]);
  assert.deepEqual(stopped, [{ pid: 601, cwd: w.mine, killed: false }]);
  assert.deepEqual(lines, [`harness: stopped stale next dev pid 601 (cwd ${w.mine})`]);
  for (const pid of [602, 603, 604]) assert.ok(existsSync(join(w.procRoot, String(pid))), `pid ${pid} must be untouched`);
});

test("a next dev that ignores TERM is KILLed after the bounded wait, and the wait is bounded", async () => {
  const w = world();
  addProc(w.procRoot, 701, { argv: NEXT_DEV, cwd: w.mine });
  const { sent, signal } = fakeSignals(w.procRoot, { ignoreTerm: [701] });
  let slept = 0;
  const lines = [];
  const stopped = await stopStaleNextDev({
    procRoot: w.procRoot,
    webDir: w.mine,
    signal,
    log: (line) => lines.push(line),
    termWaitMs: 1000,
    pollMs: 100,
    sleep: async (ms) => {
      slept += ms;
    },
  });
  assert.deepEqual(sent, [[701, "SIGTERM"], [701, "SIGKILL"]]);
  assert.ok(slept >= 900 && slept <= 1100, `waited ${slept} ms`);
  assert.deepEqual(stopped, [{ pid: 701, cwd: w.mine, killed: true }]);
  assert.match(lines[0], /^harness: stopped stale next dev pid 701 \(cwd .*\)$/);
});

test("a zombie (state Z) counts as gone, so a reaped-late next dev is not KILLed for nothing", async () => {
  const w = world();
  addProc(w.procRoot, 801, { argv: NEXT_DEV, cwd: w.mine, state: "S" });
  const sent = [];
  const signal = (pid, sig) => {
    sent.push([pid, sig]);
    writeFileSync(join(w.procRoot, String(pid), "stat"), `${pid} (next-server) Z 1 1 1\n`);
  };
  await stopStaleNextDev({ procRoot: w.procRoot, webDir: w.mine, signal, log: () => {}, sleep: async () => {} });
  assert.deepEqual(sent, [[801, "SIGTERM"]]);
});

test("a signal that fails because the process just exited is not an error", async () => {
  const w = world();
  addProc(w.procRoot, 901, { argv: NEXT_DEV, cwd: w.mine });
  const signal = (pid) => {
    rmSync(join(w.procRoot, String(pid)), { recursive: true, force: true });
    const error = new Error("ESRCH");
    error.code = "ESRCH";
    throw error;
  };
  const stopped = await stopStaleNextDev({ procRoot: w.procRoot, webDir: w.mine, signal, log: () => {}, sleep: async () => {} });
  assert.equal(stopped.length, 1);
});

test("the CLI: --stop prints the stopped line on stdout, --list names every next dev with whose it is, an unknown mode exits 2", () => {
  const w = world();
  addProc(w.procRoot, 1001, { argv: NEXT_DEV, cwd: w.mine });
  addProc(w.procRoot, 1002, { argv: NEXT_DEV, cwd: w.other });
  const env = { ...process.env, HARNESS_PROC_ROOT: w.procRoot };
  const list = spawnSync(process.execPath, [CLI, "--list", w.mine], { env, encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(list.stdout.trim().split("\n"), [`1001 ours ${w.mine}`, `1002 other ${w.other}`]);
  // --stop signals real pids, so a fake /proc may only hold pids that do not exist: nothing to stop here
  const empty = world();
  const stop = spawnSync(process.execPath, [CLI, "--stop", empty.mine], { env: { ...process.env, HARNESS_PROC_ROOT: empty.procRoot }, encoding: "utf8" });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stdout, "");
  assert.equal(spawnSync(process.execPath, [CLI, "--nope"], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync(process.execPath, [CLI, "--stop"], { encoding: "utf8" }).status, 2);
});
