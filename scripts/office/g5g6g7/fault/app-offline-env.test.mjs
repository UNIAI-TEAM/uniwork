// G7-03b (UNI-1382) W2: what the FL rows need from the runner VM. Every system
// call goes through an injected `run`, so the BLOCKED lines, the mount arguments,
// the fill and the keyring control channel are tested without a VM.
// Run: node --test scripts/office/g5g6g7/fault/app-offline-env.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { revokeOrgOfflineLeases } from "./app-tenant.mjs";
import {
  FAKETIME_CANDIDATES, REAL_VM, faketimeEnv, fillToLeave, findFaketime, freeBytes, keyringControl, mountTmpfs, probeTmpfsMount, releaseFill, sparseFill, unmountTmpfs,
} from "./app-offline-env.mjs";

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-env-"));
  return { dir, clean: () => rmSync(dir, { recursive: true, force: true }) };
};

// ---- FL-02: tmpfs ------------------------------------------------------------------

test("the tmpfs probe names the exact runner line when it cannot mount", () => {
  assert.match(probeTmpfsMount({ platform: "win32" }).line, /needs Linux/);
  assert.match(probeTmpfsMount({ platform: "linux", run: () => ({ status: null, error: Object.assign(new Error("x"), { code: "ENOENT" }) }) }).line, /sudo is not installed/);
  assert.match(probeTmpfsMount({ platform: "linux", run: () => ({ status: 1, stderr: "sudo: a password is required\n" }) }).line, /sudo -n true exited 1: sudo: a password is required/);
  assert.deepEqual(probeTmpfsMount({ platform: "linux", run: () => ({ status: 0 }) }), { ok: true });
});

test("mountTmpfs mounts a size-capped, user-owned, private tmpfs through sudo -n, and reports the mount line on failure", () => {
  const { dir, clean } = scratch();
  try {
    const calls = [];
    const ok = mountTmpfs(join(dir, "userdata"), 512, { uid: 1000, gid: 1001, run: (cmd, args) => { calls.push([cmd, ...args]); return { status: 0 }; } });
    assert.deepEqual(ok, { ok: true });
    assert.deepEqual(calls[0], ["sudo", "-n", "mount", "-t", "tmpfs", "-o", "size=512m,uid=1000,gid=1001,mode=0700", "tmpfs", join(dir, "userdata")]);
    assert.ok(existsSync(join(dir, "userdata")), "the mount point is created first");
    const failed = mountTmpfs(join(dir, "again"), 512, { run: () => ({ status: 32, stderr: "mount: permission denied\n" }) });
    assert.equal(failed.ok, false);
    assert.match(failed.line, /mount -t tmpfs -o size=512m .* exited 32: mount: permission denied/);
    assert.deepEqual(unmountTmpfs(join(dir, "userdata"), { run: () => ({ status: 0 }) }), { ok: true });
    assert.match(unmountTmpfs("x", { run: () => ({ status: 32, stderr: "busy\n" }) }).line, /umount -l x exited 32: busy/);
  } finally {
    clean();
  }
});

test("fillToLeave writes real bytes until only leaveBytes are free, and releaseFill frees them", () => {
  const { dir, clean } = scratch();
  try {
    // a stub filesystem: 3 MiB free, every byte written is one byte less
    let written = 0;
    const total = 3 * 1024 * 1024;
    const stat = (path) => {
      const file = join(path, ".fl02-filler");
      written = existsSync(file) ? statSync(file).size : 0;
      return { bavail: total - written, bsize: 1 };
    };
    const fill = fillToLeave(dir, 1024, { stat });
    assert.equal(fill.freeBefore, total);
    assert.equal(fill.freeAfter, 1024, "exactly leaveBytes remain");
    assert.equal(freeBytes(dir, { stat }), 1024);
    releaseFill(fill.path);
    assert.equal(existsSync(fill.path), false);
    assert.equal(freeBytes(dir, { stat }), total);
  } finally {
    clean();
  }
});

test("sparseFill makes one sparse file of budget - leave bytes in the library scope, without writing them", () => {
  const { dir, clean } = scratch();
  try {
    const budget = 64 * 1024 * 1024;
    const fill = sparseFill(join(dir, "scope"), budget, 4096);
    assert.equal(fill.apparentBytes, budget - 4096);
    assert.equal(statSync(fill.path).size, budget - 4096, "the apparent size is what the store's budget counts");
    releaseFill(fill.path);
    assert.equal(existsSync(fill.path), false);
  } finally {
    clean();
  }
});

// ---- FL-05: libfaketime ------------------------------------------------------------

test("findFaketime answers the library path, or the install line naming every place it looked", () => {
  assert.equal(findFaketime({ platform: "linux", exists: (p) => p === FAKETIME_CANDIDATES[2] }).path, FAKETIME_CANDIDATES[2]);
  const missing = findFaketime({ platform: "linux", exists: () => false });
  assert.match(missing.line, /libfaketime is not installed on the runner VM \(apt-get install -y libfaketime\)/);
  for (const candidate of FAKETIME_CANDIDATES) assert.ok(missing.line.includes(candidate));
  assert.match(findFaketime({ platform: "darwin" }).line, /needs Linux/);
});

test("faketimeEnv moves the wall clock back N minutes and leaves the monotonic clock alone", () => {
  assert.deepEqual(faketimeEnv("/usr/lib/faketime/libfaketime.so.1", 10), {
    LD_PRELOAD: "/usr/lib/faketime/libfaketime.so.1",
    FAKETIME: "-10m",
    FAKETIME_DONT_FAKE_MONOTONIC: "1",
    FAKETIME_NO_CACHE: "1",
  });
});

// ---- FL-09: the keyring control channel -------------------------------------------

test("keyringControl without the wrapper's channel is BLOCKED with the exact way to start it", () => {
  const result = keyringControl("lock", { env: {} });
  assert.equal(result.ok, false);
  assert.match(result.line, /APP_KEYRING_CTL is not set: run the runner as `APP_KEYRING_CONTROL=1 dbus-run-session -- bash .*app-keyring\.sh/);
  assert.throws(() => keyringControl("explode", { env: {} }), /unknown keyring action/);
});

test("keyringControl sends one command line to <ctl>.in and reads one answer from <ctl>.out", () => {
  const calls = [];
  const run = (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: "ok\n" }; };
  assert.deepEqual(keyringControl("unlock", { env: { APP_KEYRING_CTL: "/run/ctl" }, run }), { ok: true });
  assert.equal(calls[0][0], "bash");
  assert.deepEqual(calls[0].slice(-2), ["/run/ctl", "unlock"], "the channel path is $0 and the action is $1: nothing is spliced into the script");
  assert.match(calls[0][2], /\$0\.in/);
  assert.match(calls[0][2], /\$0\.out/);
  const refused = keyringControl("lock", { env: { APP_KEYRING_CTL: "/run/ctl" }, run: () => ({ status: 0, stdout: "fail: the collection is still unlocked after Lock\n" }) });
  assert.equal(refused.ok, false);
  assert.match(refused.line, /answered lock with: fail: the collection is still unlocked/);
  const timeout = keyringControl("lock", { env: { APP_KEYRING_CTL: "/run/ctl" }, run: () => ({ status: 1, stderr: "" }) });
  assert.match(timeout.line, /did not answer lock \(exit 1\)/);
});

test("REAL_VM.keyring.available names the BLOCKED line while the wrapper's channel is missing", () => {
  const saved = process.env.APP_KEYRING_CTL;
  delete process.env.APP_KEYRING_CTL;
  try {
    assert.match(REAL_VM.keyring.available(), /APP_KEYRING_CTL is not set/);
    process.env.APP_KEYRING_CTL = "/run/ctl";
    assert.equal(REAL_VM.keyring.available(), null);
  } finally {
    if (saved === undefined) delete process.env.APP_KEYRING_CTL;
    else process.env.APP_KEYRING_CTL = saved;
  }
});

test("app-keyring.sh: control mode is additive, off by default, keeps the password in a variable and parses as bash", () => {
  const path = new URL("./app-keyring.sh", import.meta.url);
  const script = readFileSync(path, "utf8");
  assert.match(script, /APP_KEYRING_CONTROL:-\}" = 1/, "control mode is opt-in");
  // the password never reaches an env export, a print or a file
  assert.doesNotMatch(script, /export[^\n]*_PASSWORD|echo[^\n]*_PASSWORD/);
  const uses = script.split("\n").filter((line) => /printf[^\n]*_PASSWORD/.test(line));
  assert.ok(uses.length >= 2, "the password is only ever piped into the keyring daemon");
  for (const line of uses) assert.match(line, /_PASSWORD" \| /, `the password goes into a pipe: ${line.trim()}`);
  assert.match(script, /unset KEYRING_PASSWORD/);
  assert.match(script, /mkfifo "\$WORK\/ctl\.in" "\$WORK\/ctl\.out"/);
  assert.match(script, /export APP_KEYRING_CTL="\$WORK\/ctl"/);
  const syntax = spawnSync("bash", ["-n", path.pathname.replace(/^\/([A-Za-z]:)/, "$1")], { encoding: "utf8" });
  if (syntax.error?.code === "ENOENT") return;
  assert.equal(syntax.status, 0, syntax.stderr);
});

// ---- FL-06: the revoke on D ---------------------------------------------------------

test("revokeOrgOfflineLeases runs uniwork-admin revoke-offline-leases for the run's org, or names why it could not", () => {
  const calls = [];
  const run = (cmd, args, options) => { calls.push({ cmd, args, cwd: options.cwd, db: options.env.DATABASE_URL }); return { status: 0 }; };
  assert.equal(revokeOrgOfflineLeases({ repoRoot: "/repo", databaseUrl: "postgres://u:p@h/db", orgId: "01JORG" }, { run }), null);
  assert.deepEqual(calls[0].args.slice(0, 5), ["run", "./cmd/uniwork-admin", "revoke-offline-leases", "--org-id", "01JORG"]);
  assert.equal(calls[0].cwd, "/repo/server");
  assert.match(revokeOrgOfflineLeases({ repoRoot: "/repo", databaseUrl: "", orgId: "x" }, { run }), /no DATABASE_URL/);
  assert.match(revokeOrgOfflineLeases({ repoRoot: "/repo", databaseUrl: "u", orgId: "x" }, { run: () => ({ status: null, error: Object.assign(new Error("x"), { code: "ENOENT" }) }) }), /go is not on PATH/);
  const failed = revokeOrgOfflineLeases({ repoRoot: "/repo", databaseUrl: "u", orgId: "x" }, { run: () => ({ status: 1, stderr: "uniwork-admin: no organization x postgres://user:secret@h/db\n" }) });
  assert.match(failed, /exited 1: uniwork-admin: no organization x/);
  assert.doesNotMatch(failed, /secret/, "a database URL never reaches a verdict line");
});
