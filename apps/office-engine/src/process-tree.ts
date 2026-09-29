// Process-tree ownership. A worker is started as the leader of its own
// process group (POSIX) so the whole tree - the worker and anything a native
// handler spawned - goes with one signal; on Windows taskkill /T walks the
// parent links.
//
// On Linux (the container) three more things hold the tree together:
//   * /proc is read for every thread's children, which lets the supervisor
//     measure CPU (including reaped children) and memory of native
//     descendants the worker itself cannot see;
//   * every worker carries a job tag in its environment (JOB_TAG_ENV), which
//     descendants inherit. killTree also kills every process whose
//     environment carries the tag, so a descendant that called setsid() and
//     was re-parented to init after the worker exited still dies with its job;
//   * under the per-slot uid sandbox (sandbox.ts) the uid itself is the
//     boundary: killTree also kills every process whose status carries the
//     slot uid. That sweep stays reliable where the tag cannot - the environ
//     of a different-uid process is ptrace-gated, and a hostile descendant
//     could exec with a scrubbed environment; it cannot escape its uid.
// Windows (dev hosts only) has no such sweeps: a descendant that breaks
// away from the worker's job object can outlive it there. The image is Linux.

import { spawnSync, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export const JOB_TAG_ENV = "UW_OFFICE_JOB_TAG";

const hasProc = process.platform === "linux";
const CLOCK_TICKS = 100;
const PAGE_SIZE = 4096;

function childrenOf(pid: number): number[] {
  const out: number[] = [];
  let tasks: string[];
  try {
    tasks = readdirSync("/proc/" + pid + "/task");
  } catch {
    return out;
  }
  for (const tid of tasks) {
    try {
      for (const s of readFileSync("/proc/" + pid + "/task/" + tid + "/children", "utf8").split(/\s+/)) {
        if (s !== "") out.push(Number(s));
      }
    } catch {
      // The thread exited while we read it.
    }
  }
  return out;
}

/** Every live descendant of pid (Linux only; empty elsewhere). */
function descendants(pid: number): number[] {
  if (!hasProc) return [];
  const out: number[] = [];
  const pending = [pid];
  while (pending.length > 0) {
    const current = pending.pop() as number;
    for (const child of childrenOf(current)) {
      out.push(child);
      pending.push(child);
    }
  }
  return out;
}

/** Processes whose environment carries this job tag (Linux only). */
function tagged(tag: string): number[] {
  if (!hasProc || tag === "") return [];
  const needle = JOB_TAG_ENV + "=" + tag + "\0";
  const out: number[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    try {
      if (readFileSync("/proc/" + name + "/environ", "latin1").includes(needle)) out.push(Number(name));
    } catch {
      // Gone, or not ours to read.
    }
  }
  return out;
}

/** Processes whose status shows this real/effective/saved/fs uid (Linux only).
 * The sandbox makes the uid itself the job boundary - one live slot, one uid -
 * so this sweep catches descendants that environ can no longer see: other-uids'
 * environ is ptrace-gated, and a hostile handler could exec a scrubbed env.
 * Matching all four Uid fields also catches a setuid binary the worker ran:
 * its real uid stays the slot uid, which is exactly what should be killed. */
export function ownedBy(uid: number | undefined): number[] {
  if (!hasProc || uid === undefined) return [];
  const needle = "Uid:";
  const out: number[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    try {
      const status = readFileSync("/proc/" + name + "/status", "utf8");
      const line = status.split("\n").find((l) => l.startsWith(needle));
      if (line && line.slice(needle.length).trim().split(/\s+/).some((f) => Number(f) === uid)) {
        out.push(Number(name));
      }
    } catch {
      // Gone while we read it.
    }
  }
  return out;
}

export interface TreeUsage {
  rssBytes: number;
  cpuMs: number;
}

/** CPU and RSS of the job's processes from /proc; null off Linux. CPU counts
 * each process's own time plus its reaped children's (cutime/cstime), so a
 * handler that runs many short-lived children cannot hide their CPU. */
export function treeUsage(pid: number, tag = "", uid?: number): TreeUsage | null {
  if (!hasProc) return null;
  let rssBytes = 0;
  let cpuMs = 0;
  for (const p of new Set([pid, ...descendants(pid), ...tagged(tag), ...ownedBy(uid)])) {
    try {
      const stat = readFileSync("/proc/" + p + "/stat", "utf8");
      // Fields after the ")" of the command name start at field 3 (state):
      // utime 14, stime 15, cutime 16, cstime 17 -> indexes 11..14 here.
      const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const ticks = Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14]);
      cpuMs += (ticks * 1000) / CLOCK_TICKS;
      const statm = readFileSync("/proc/" + p + "/statm", "utf8").split(" ");
      rssBytes += Number(statm[1]) * PAGE_SIZE;
    } catch {
      // The process exited while we read it.
    }
  }
  return { rssBytes, cpuMs };
}

/** Kill the worker, every descendant, every process carrying the job tag and
 * every process running under the job's slot uid. Safe to call more than once. */
export function killTree(child: ChildProcess, tag = "", uid?: number): void {
  const pid = child.pid;
  if (pid !== undefined) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      const tree = descendants(pid);
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Group already gone.
      }
      for (const p of tree) signal(p);
    }
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }
  for (const p of tagged(tag)) signal(p);
  for (const p of ownedBy(uid)) signal(p);
}

function signal(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** True while a process with this pid exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
