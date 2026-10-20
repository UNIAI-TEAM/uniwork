// What the W2 FL rows need from the Linux runner VM (G7-03b, UNI-1382): a small
// tmpfs for FL-02, libfaketime for FL-05, and a keyring the runner can lock and
// unlock for FL-09. Each probe answers `{ok, ...}` or the EXACT runner line the
// row reports as BLOCKED, never a PASS: a VM without the tool is a precondition,
// not a product claim. Every system call goes through an injected `run`
// (child_process.spawnSync shaped) so the logic is unit-tested without a VM.

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, writeSync } from "node:fs";
import { join } from "node:path";

const sh = (run, command, args, options = {}) => {
  const res = run(command, args, { encoding: "utf8", timeout: 30_000, ...options });
  return { status: res.status, stdout: String(res.stdout ?? ""), stderr: String(res.stderr ?? ""), error: res.error ?? null };
};

// ---- FL-02: a small tmpfs as the app's userData -----------------------------------

/**
 * Whether this runner can mount a tmpfs: a non-interactive `sudo` that may run
 * `mount`. Returns `{ok:true}` or `{ok:false, line}` with the runner's own line.
 */
export function probeTmpfsMount({ run = spawnSync, platform = process.platform } = {}) {
  if (platform !== "linux") return { ok: false, line: `tmpfs mount needs Linux (platform ${platform})` };
  const sudo = sh(run, "sudo", ["-n", "true"]);
  if (sudo.error?.code === "ENOENT") return { ok: false, line: "sudo is not installed on the runner VM (needed for `mount -t tmpfs`)" };
  if (sudo.status !== 0) return { ok: false, line: `sudo -n true exited ${sudo.status}: ${firstLine(sudo.stderr) || "a password is required"}` };
  return { ok: true };
}

const firstLine = (text) => String(text).trim().split("\n")[0] ?? "";

/**
 * Mounts a `sizeMb` MiB tmpfs owned by the runner's user at `dir` (created if
 * missing). Returns `{ok:true}` or `{ok:false, line}`.
 */
export function mountTmpfs(dir, sizeMb, { run = spawnSync, uid = process.getuid?.() ?? 0, gid = process.getgid?.() ?? 0 } = {}) {
  mkdirSync(dir, { recursive: true });
  const res = sh(run, "sudo", ["-n", "mount", "-t", "tmpfs", "-o", `size=${sizeMb}m,uid=${uid},gid=${gid},mode=0700`, "tmpfs", dir]);
  if (res.status !== 0) return { ok: false, line: `mount -t tmpfs -o size=${sizeMb}m ${dir} exited ${res.status}: ${firstLine(res.stderr) || firstLine(res.stdout)}` };
  return { ok: true };
}

/** Whether `dir` is a mount point right now (`mountpoint -q`: 0 = a mount). */
export const isMountPoint = (dir, { run = spawnSync } = {}) => sh(run, "mountpoint", ["-q", dir]).status === 0;

/**
 * Unmounts what `mountTmpfs` mounted (lazy: a closing app may still hold a file)
 * and PROVES it (review r2 R2-11): the answer is the read-back, not the exit
 * code - a directory that is still a mount point afterwards is `{ok:false}`. A
 * directory that was never mounted (the mount itself failed) is clean already.
 */
export function unmountTmpfs(dir, { run = spawnSync } = {}) {
  if (!isMountPoint(dir, { run })) return { ok: true };
  const res = sh(run, "sudo", ["-n", "umount", "-l", dir]);
  if (!isMountPoint(dir, { run })) return { ok: true };
  return { ok: false, line: `umount -l ${dir} exited ${res.status}: ${firstLine(res.stderr) || "still a mount point"}; ${dir} is still a mount point` };
}

/** Free bytes a non-root user can still write on the filesystem of `dir`. */
export const freeBytes = (dir, { stat = statfsSync } = {}) => {
  const s = stat(dir);
  return Number(s.bavail) * Number(s.bsize);
};

/**
 * Fills `dir`'s filesystem until `leaveBytes` are free, with one real file
 * (`.fl02-filler`): the tmpfs is then really full for the app's next write, which
 * is the ENOSPC the row needs. Returns `{path, freeBefore, freeAfter}`.
 *
 * The caller owns the file BEFORE it exists (review r2 R2-11): `onPath` is told
 * the path before the first byte is written, and a fill that throws removes its
 * own partial file, so no path of a half-written filler is ever lost.
 */
export function fillToLeave(dir, leaveBytes, { stat = statfsSync, onPath = () => {} } = {}) {
  const path = join(dir, ".fl02-filler");
  onPath(path);
  const freeBefore = freeBytes(dir, { stat });
  const toWrite = Math.max(0, freeBefore - leaveBytes);
  let fd;
  try {
    fd = openSync(path, "w");
    const chunk = Buffer.alloc(1024 * 1024, 0x2e);
    let left = toWrite;
    while (left > 0) {
      const n = Math.min(left, chunk.length);
      writeSync(fd, chunk, 0, n);
      left -= n;
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    fd = undefined;
    rmSync(path, { force: true });
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return { path, freeBefore, freeAfter: freeBytes(dir, { stat }) };
}

/**
 * Frees what a fill took (the row's "free space, then retry") and PROVES it
 * (review r2 R2-11): `{ok:true}` only when the file is gone afterwards.
 */
export function releaseFill(path) {
  try {
    rmSync(path, { force: true });
  } catch (error) {
    return { ok: false, line: `removing the filler ${path} failed: ${error?.message ?? error}` };
  }
  return existsSync(path) ? { ok: false, line: `the filler ${path} is still there after its removal` } : { ok: true };
}

/** The apparent bytes of every file under `dir` (what the library layer's budget counts: files by size). */
export function scopeUsageBytes(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    total += stat.isDirectory() ? scopeUsageBytes(full) : stat.size;
  }
  return total;
}

/**
 * The fallback when the VM cannot mount: a SPARSE file in the library's scope
 * directory so the fork's own layer budget (store/layer.ts: encrypted bytes
 * across the account scope, files by size) is crossed and the next record write
 * answers `store_full` - the contract's fallback. No root, no real disk used.
 * `scopeDir` is `<userData>/uniwork-sync/library/store/<deployment>/<account>`.
 *
 * The filler is sized from the MEASURED usage of the scope (review r2 R2-4): it
 * takes the headroom down to `leaveBytes`, so the scope sits `leaveBytes` under
 * the budget and any write bigger than that crosses it. `onPath` owns the file
 * before it exists and a failed fill removes its own partial file (R2-11).
 * Returns `{path, apparentBytes, usedBefore, scopeBytes}`.
 */
export function sparseFill(scopeDir, budgetBytes, leaveBytes, { onPath = () => {} } = {}) {
  mkdirSync(scopeDir, { recursive: true });
  const path = join(scopeDir, ".fl02-sparse-filler");
  onPath(path);
  const usedBefore = scopeUsageBytes(scopeDir);
  const apparentBytes = Math.max(0, budgetBytes - leaveBytes - usedBefore);
  let fd;
  try {
    fd = openSync(path, "w");
    ftruncateSync(fd, apparentBytes);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    fd = undefined;
    rmSync(path, { force: true });
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return { path, apparentBytes, usedBefore, scopeBytes: scopeUsageBytes(scopeDir) };
}

// ---- FL-05: libfaketime around Electron ---------------------------------------------

export const FAKETIME_CANDIDATES = Object.freeze([
  "/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1",
  "/usr/lib/aarch64-linux-gnu/faketime/libfaketime.so.1",
  "/usr/lib/faketime/libfaketime.so.1",
  "/usr/local/lib/faketime/libfaketime.so.1",
]);

/** The libfaketime shared object, or `{line}` naming where it looked (BLOCKED, with the install line). */
export function findFaketime({ exists = existsSync, platform = process.platform } = {}) {
  if (platform !== "linux") return { line: `libfaketime needs Linux (platform ${platform})` };
  const path = FAKETIME_CANDIDATES.find((candidate) => exists(candidate));
  if (path) return { path };
  return { line: `libfaketime is not installed on the runner VM (apt-get install -y libfaketime); looked in ${FAKETIME_CANDIDATES.join(", ")}` };
}

/**
 * The env that puts one Electron process `minutes` behind the real wall clock.
 * The monotonic clock is left alone (`FAKETIME_DONT_FAKE_MONOTONIC`): the lease
 * check compares the WALL clock with the latest wall clock it saw, and a skewed
 * monotonic clock would only add a second, unrelated fault.
 */
export const faketimeEnv = (libraryPath, minutes) => ({
  LD_PRELOAD: libraryPath,
  FAKETIME: `-${minutes}m`,
  FAKETIME_DONT_FAKE_MONOTONIC: "1",
  FAKETIME_NO_CACHE: "1",
});

// ---- FL-09: the keyring control channel of app-keyring.sh ---------------------------

/**
 * Asks the keyring wrapper (`APP_KEYRING_CONTROL=1 … app-keyring.sh`, which owns
 * the daemon and its password) to `lock` or `unlock` it. `APP_KEYRING_CTL` is the
 * control path the wrapper exports; without it the VM was not started in control
 * mode and the row is BLOCKED with the exact line. Returns `{ok:true}` or
 * `{ok:false, line}`.
 */
export function keyringControl(action, { env = process.env, run = spawnSync } = {}) {
  if (action !== "lock" && action !== "unlock") throw new Error(`unknown keyring action "${action}"`);
  const ctl = env.APP_KEYRING_CTL;
  if (!ctl) return { ok: false, line: "APP_KEYRING_CTL is not set: run the runner as `APP_KEYRING_CONTROL=1 dbus-run-session -- bash scripts/office/g5g6g7/fault/app-keyring.sh node …/app-cases.mjs`" };
  // the wrapper reads one command per line from <ctl>.in and answers one line on <ctl>.out
  const res = sh(run, "bash", ["-c", 'printf "%s\\n" "$1" > "$0.in" && read -r -t 30 reply < "$0.out" && printf "%s" "$reply"', ctl, action], { timeout: 45_000 });
  if (res.status !== 0) return { ok: false, line: `the keyring control channel did not answer ${action} (exit ${res.status}): ${firstLine(res.stderr)}` };
  const reply = res.stdout.trim();
  return reply === "ok" ? { ok: true } : { ok: false, line: `the keyring wrapper answered ${action} with: ${reply || "(nothing)"}` };
}

/**
 * The unlock prompts the wrapper's stub (`app-keyring-prompter.py`, INJECTED) has
 * answered so far with a cancel, read from the file the wrapper exports as
 * `APP_KEYRING_PROMPTER_LOG` (one JSON line per event). A fact about the harness,
 * never a claim about the prompt UI: `{available:false}` without the file.
 */
export function keyringPrompts({ env = process.env, read = readFileSync } = {}) {
  const file = env.APP_KEYRING_PROMPTER_LOG;
  if (!file) return { available: false, answered: 0 };
  let text = "";
  try {
    text = String(read(file, "utf8"));
  } catch {
    return { available: false, answered: 0 };
  }
  const events = text.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  });
  return { available: true, answered: events.filter((event) => event?.event === "prompt").length };
}

/** null while the wrapper's control channel and its prompt stub are there, else the BLOCKED line */
function keyringAvailable(env = process.env) {
  if (!env.APP_KEYRING_CTL) return keyringControl("lock", { env, run: () => ({ status: 1 }) }).line;
  // without the stub the second launch would sit in the Secret Service call until the launch timed out
  if (!env.APP_KEYRING_PROMPTER_LOG) return "APP_KEYRING_PROMPTER_LOG is not set: the keyring wrapper did not start its unlock-prompt stub (app-keyring.sh control mode, python3-gi)";
  return null;
}

/**
 * The runner VM as the W2 drivers see it (`ctx.vm`): the real probes and helpers
 * above. A test passes fakes with the same names, so no driver shells out itself.
 */
export const REAL_VM = Object.freeze({
  probeTmpfsMount,
  mountTmpfs,
  unmountTmpfs,
  fillToLeave,
  releaseFill,
  sparseFill,
  findFaketime,
  faketimeEnv,
  keyring: Object.freeze({
    available: () => keyringAvailable(),
    prompts: () => keyringPrompts(),
    lock: () => keyringControl("lock"),
    unlock: () => keyringControl("unlock"),
  }),
});
