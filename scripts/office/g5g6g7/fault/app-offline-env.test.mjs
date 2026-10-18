// G7-03b (UNI-1382) W2: what the FL rows need from the runner VM. Every system
// call goes through an injected `run`, so the BLOCKED lines, the mount arguments,
// the fill and the keyring control channel are tested without a VM.
// Run: node --test scripts/office/g5g6g7/fault/app-offline-env.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { revokeOrgOfflineLeases } from "./app-tenant.mjs";
import {
  FAKETIME_CANDIDATES, REAL_VM, faketimeEnv, fillToLeave, findFaketime, freeBytes, keyringControl, mountTmpfs, probeTmpfsMount, releaseFill, scopeUsageBytes, sparseFill, unmountTmpfs,
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
    // the answer of an unmount is the READ-BACK (R2-11): mounted before, not a mount point after = ok
    let mounted = true;
    const run = (cmd, args) => {
      if (cmd === "mountpoint") return { status: mounted ? 0 : 1 };
      mounted = false;
      return { status: 0 };
    };
    assert.deepEqual(unmountTmpfs(join(dir, "userdata"), { run }), { ok: true });
    // a umount that "succeeds" but leaves the mount point is a failure
    const stuck = unmountTmpfs("x", { run: (cmd) => (cmd === "mountpoint" ? { status: 0 } : { status: 32, stderr: "busy\n" }) });
    assert.equal(stuck.ok, false);
    assert.match(stuck.line, /umount -l x exited 32: busy; x is still a mount point/);
    // a umount that exits non-zero but whose read-back shows the mount gone is clean
    let gone = false;
    assert.deepEqual(unmountTmpfs("x", { run: (cmd) => { if (cmd === "mountpoint") { const was = gone; gone = true; return { status: was ? 1 : 0 }; } return { status: 1, stderr: "x" }; } }), { ok: true });
    // a directory that was never mounted (the mount itself failed) needs nothing
    assert.deepEqual(unmountTmpfs("never", { run: (cmd) => (cmd === "mountpoint" ? { status: 1 } : { status: 99 }) }), { ok: true });
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
    assert.deepEqual(releaseFill(fill.path), { ok: true });
    assert.equal(existsSync(fill.path), false);
    assert.equal(freeBytes(dir, { stat }), total);
  } finally {
    clean();
  }
});

test("sparseFill sizes one sparse file from the scope's MEASURED usage so the scope sits leave bytes under the budget", () => {
  const { dir, clean } = scratch();
  try {
    const budget = 64 * 1024 * 1024;
    const scope = join(dir, "scope");
    mkdirSync(join(scope, "offline-library"), { recursive: true });
    writeFileSync(join(scope, "offline-library", "a.rec"), Buffer.alloc(3000));
    assert.equal(scopeUsageBytes(scope), 3000);
    const fill = sparseFill(scope, budget, 4096);
    assert.equal(fill.usedBefore, 3000);
    assert.equal(fill.apparentBytes, budget - 4096 - 3000);
    assert.equal(statSync(fill.path).size, budget - 4096 - 3000, "the apparent size is what the store's budget counts");
    assert.equal(fill.scopeBytes, budget - 4096, "the scope sits exactly leaveBytes under the budget");
    assert.deepEqual(releaseFill(fill.path), { ok: true });
    assert.equal(existsSync(fill.path), false);
  } finally {
    clean();
  }
});

test("R2-11: the filler path is handed to the caller BEFORE the first byte, and a fill that throws removes its own partial file", () => {
  const { dir, clean } = scratch();
  try {
    const seen = [];
    let writes = 0;
    // a stub filesystem whose free space is large; the very first write fails with ENOSPC after the file exists
    const stat = () => ({ bavail: 8 * 1024 * 1024, bsize: 1 });
    assert.throws(
      () => fillToLeave(dir, 1024, { stat, onPath: (path) => { seen.push([path, existsSync(path)]); writes += 1; mkdirSync(dir, { recursive: true }); writeFileSync(path, "partial"); /* a half-created filler */ throw new Error("ENOSPC"); } }),
      /ENOSPC/,
    );
    assert.equal(writes, 1);
    assert.equal(seen[0][1], false, "the caller owns the path before it exists");
    // a throw from the write loop itself: simulate with an unwritable directory target
    assert.throws(() => fillToLeave(join(dir, "missing", "deeper"), 1024, { stat, onPath: (path) => seen.push([path, false]) }));
    assert.equal(existsSync(join(dir, "missing", "deeper", ".fl02-filler")), false, "no partial filler is left");
    assert.equal(seen.at(-1)[0], join(dir, "missing", "deeper", ".fl02-filler"), "the path was still reported first");
    // sparseFill: the same ownership
    const owned = [];
    assert.throws(() => sparseFill(join(dir, "file-not-dir"), 1024, 0, { onPath: (path) => { owned.push(path); throw new Error("boom"); } }), /boom/);
    assert.equal(owned.length, 1);
  } finally {
    clean();
  }
});

test("R2-11: releaseFill answers the READ-BACK: gone = ok, a path it cannot remove = a named failure", () => {
  const { dir, clean } = scratch();
  try {
    const file = join(dir, "filler");
    writeFileSync(file, "x");
    assert.deepEqual(releaseFill(file), { ok: true });
    assert.deepEqual(releaseFill(file), { ok: true }, "an already removed filler is clean");
    // a directory where the filler should be cannot be removed by a non-recursive rm
    const stuck = join(dir, "stuck");
    mkdirSync(stuck);
    writeFileSync(join(stuck, "inner"), "x");
    const failed = releaseFill(stuck);
    assert.equal(failed.ok, false);
    assert.match(failed.line, /filler/);
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
  // the script goes in on stdin: a PATH `bash` that is WSL cannot read a Windows drive path, but it parses a pipe on every host
  const syntax = spawnSync("bash", ["-n"], { encoding: "utf8", input: script });
  if (syntax.error?.code === "ENOENT") return;
  assert.equal(syntax.status, 0, syntax.stderr);
});

// ---- FL-06: the revoke on D ---------------------------------------------------------

test("revokeOrgOfflineLeases runs uniwork-admin revoke-offline-leases for the run's org, or names why it could not", () => {
  const calls = [];
  const run = (cmd, args, options) => { calls.push({ cmd, args, cwd: options.cwd, db: options.env.DATABASE_URL }); return { status: 0 }; };
  const ok = revokeOrgOfflineLeases({ repoRoot: "/repo", databaseUrl: "postgres://u:p@h/db", orgId: "01JORG" }, { run: (cmd, args, options) => ({ ...run(cmd, args, options), stdout: "01JORG offline policy epoch now 3, 2 live lease(s) revoked\n" }) });
  assert.equal(ok.failure, null);
  // the CLI's own stdout line, parsed: the org it hit, the epoch and how many leases it revoked (R2-9)
  assert.deepEqual(ok.evidence, { line: "01JORG offline policy epoch now 3, 2 live lease(s) revoked", orgId: "01JORG", epoch: 3, revoked: 2 });
  assert.deepEqual(revokeOrgOfflineLeases({ repoRoot: "/repo", databaseUrl: "u", orgId: "x" }, { run: () => ({ status: 0, stdout: "garbage\n" }) }).evidence, { line: "garbage", orgId: null, epoch: null, revoked: null });
  assert.deepEqual(calls[0].args.slice(0, 5), ["run", "./cmd/uniwork-admin", "revoke-offline-leases", "--org-id", "01JORG"]);
  assert.equal(calls[0].cwd, "/repo/server");
  assert.match(revokeOrgOfflineLeases({ repoRoot: "/repo", databaseUrl: "", orgId: "x" }, { run }).failure, /no DATABASE_URL/);
  assert.match(revokeOrgOfflineLeases({ repoRoot: "/repo", databaseUrl: "u", orgId: "x" }, { run: () => ({ status: null, error: Object.assign(new Error("x"), { code: "ENOENT" }) }) }).failure, /go is not on PATH/);
  const failed = revokeOrgOfflineLeases({ repoRoot: "/repo", databaseUrl: "u", orgId: "x" }, { run: () => ({ status: 1, stderr: "uniwork-admin: no organization x postgres://user:secret@h/db\n" }) }).failure;
  assert.match(failed, /exited 1: uniwork-admin: no organization x/);
  assert.doesNotMatch(failed, /secret/, "a database URL never reaches a verdict line");
});
