// G8-19 B1 (UNI-1414): a warm cloud VM can still run a `next dev` from an earlier
// round, which holds the Next dev lock; the new one then prints "Another next dev
// server is already running" and dies. start.sh stops such a leftover before it
// starts the D web — but only one that runs from THIS checkout's apps/web: another
// checkout or lane on the same VM keeps its own dev server.
//
// The scan reads /proc/<pid> directly (never pkill/killall/pgrep by image name):
// a process is a candidate when its command line holds a `next` argument and a
// `dev` argument, or when its title is `next-server ...` (Next rewrites the title
// of its server process, which hides the `dev` argument); it is ours when its cwd
// resolves, by realpath, to the same directory as this checkout's apps/web. A
// process whose cmdline or cwd cannot be read is skipped, never guessed at.
//
// CLI (start.sh): node stale-next.mjs --stop <webDir>   stops ours, one line per pid on stdout
//                 node stale-next.mjs --list <webDir>   prints "<pid> ours|other <cwd>" per next dev
// HARNESS_PROC_ROOT points the scan at another /proc-shaped directory (tests).
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const realOrResolved = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

function readCmdline(procRoot, pid) {
  try {
    return readFileSync(join(procRoot, pid, "cmdline"), "utf8").split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

function isNextDev(argv) {
  if (argv.length === 0) return false;
  if (argv.length === 1 && /^next-server\b/.test(argv[0])) return true;
  return argv.some((arg) => /(^|\/)next$/.test(arg) || arg.includes("/next/")) && argv.includes("dev");
}

/**
 * Every next dev process under `procRoot` whose cwd can be read, with whether that cwd is `webDir`.
 * @returns {{pid: number, cwd: string, ours: boolean}[]} in pid order
 */
export function findNextDev({ procRoot = "/proc", webDir, selfPid = process.pid }) {
  const want = realOrResolved(webDir);
  const found = [];
  let entries = [];
  try {
    entries = readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
  } catch {
    return found;
  }
  for (const name of entries.sort((a, b) => Number(a) - Number(b))) {
    const pid = Number(name);
    if (pid === selfPid) continue;
    const argv = readCmdline(procRoot, name);
    if (!argv || !isNextDev(argv)) continue;
    let cwd;
    try {
      cwd = realpathSync(join(procRoot, name, "cwd"));
    } catch {
      continue; // exited meanwhile, or not ours to read
    }
    found.push({ pid, cwd, ours: cwd === want });
  }
  return found;
}

// A process that is gone, or a zombie (dead, waiting for a reaper that may never come in a container).
function isAlive(procRoot, pid) {
  if (!existsSync(join(procRoot, String(pid)))) return false;
  try {
    const stat = readFileSync(join(procRoot, String(pid), "stat"), "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return existsSync(join(procRoot, String(pid)));
  }
}

const defaultSignal = (pid, sig) => process.kill(pid, sig);
const defaultSleep = (ms) => new Promise((done) => setTimeout(done, ms));

function send(signal, pid, sig) {
  try {
    signal(pid, sig);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error; // already gone is the goal
  }
}

/**
 * TERM every next dev of this checkout, wait up to `termWaitMs` for each to exit, then KILL what is left.
 * One `harness: stopped stale next dev pid N (cwd ...)` line per pid goes to `log`.
 * @returns {Promise<{pid: number, cwd: string, killed: boolean}[]>}
 */
export async function stopStaleNextDev({ procRoot = "/proc", webDir, signal = defaultSignal, log = console.log, sleep = defaultSleep, termWaitMs = 10000, pollMs = 200, selfPid = process.pid }) {
  const stale = findNextDev({ procRoot, webDir, selfPid }).filter((p) => p.ours);
  const stopped = [];
  for (const { pid, cwd } of stale) {
    send(signal, pid, "SIGTERM");
    let waited = 0;
    while (isAlive(procRoot, pid) && waited < termWaitMs) {
      await sleep(pollMs);
      waited += pollMs;
    }
    const killed = isAlive(procRoot, pid);
    if (killed) send(signal, pid, "SIGKILL");
    log(`harness: stopped stale next dev pid ${pid} (cwd ${cwd})`);
    stopped.push({ pid, cwd, killed });
  }
  return stopped;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [mode, webDir] = process.argv.slice(2);
  const procRoot = process.env.HARNESS_PROC_ROOT || "/proc";
  if ((mode === "--stop" || mode === "--list") && webDir) {
    if (mode === "--list") {
      for (const { pid, cwd, ours } of findNextDev({ procRoot, webDir })) console.log(`${pid} ${ours ? "ours" : "other"} ${cwd}`);
    } else {
      await stopStaleNextDev({ procRoot, webDir });
    }
  } else {
    console.error("usage: stale-next.mjs --stop <webDir> | --list <webDir>");
    process.exit(2);
  }
}
