// Process-tree ownership. A worker is started as the leader of its own
// process group (POSIX) so the whole tree - the worker and anything a native
// handler spawned - goes with one signal; on Windows taskkill /T walks the
// parent links. On Linux the tree is also read from /proc, which catches a
// descendant that moved to its own session and lets the supervisor measure
// CPU and memory of native children the worker cannot see.

import { spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";

const hasProc = process.platform === "linux";
const CLOCK_TICKS = 100;
const PAGE_SIZE = 4096;

function childrenOf(pid: number): number[] {
  try {
    const tasks = readFileSync("/proc/" + pid + "/task/" + pid + "/children", "utf8");
    return tasks
      .split(/\s+/)
      .filter((s) => s !== "")
      .map(Number);
  } catch {
    return [];
  }
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

export interface TreeUsage {
  rssBytes: number;
  cpuMs: number;
}

/** CPU and RSS of pid and its descendants from /proc; null off Linux. */
export function treeUsage(pid: number): TreeUsage | null {
  if (!hasProc) return null;
  let rssBytes = 0;
  let cpuMs = 0;
  for (const p of [pid, ...descendants(pid)]) {
    try {
      const stat = readFileSync("/proc/" + p + "/stat", "utf8");
      // Fields after the ")" of the command name: state is field 3, utime 14, stime 15.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      cpuMs += ((Number(fields[11]) + Number(fields[12])) * 1000) / CLOCK_TICKS;
      const statm = readFileSync("/proc/" + p + "/statm", "utf8").split(" ");
      rssBytes += Number(statm[1]) * PAGE_SIZE;
    } catch {
      // The process exited while we read it.
    }
  }
  return { rssBytes, cpuMs };
}

/** Kill the worker and every descendant. Safe to call more than once. */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    const tree = descendants(pid);
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Group already gone.
    }
    for (const p of tree) {
      try {
        process.kill(p, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  try {
    child.kill("SIGKILL");
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
