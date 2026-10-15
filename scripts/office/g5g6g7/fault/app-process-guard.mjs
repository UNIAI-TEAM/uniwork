// Process and harness guards of the G7-03a app-layer fault runner (UNI-1380,
// WI-4; FIX-6). Pure parts only, so the tests need no Electron or server.
//
// Two rules:
//   * a crash signals only the process tree of the Electron this runner
//     launched: the root must still be a direct child of the runner (Playwright
//     spawns it from this process), and no pid of the harness (the run's pids
//     file: server, web, app, handoff, each its own group via setsid), of the
//     runner itself or of the runner's process group is ever a target;
//   * the harness D server is checked before and after each case; once it is
//     down the case is BLOCKED with the reason, and no further app row runs, so
//     a server killed by someone else reads as one BLOCKED line instead of a
//     column of ECONNREFUSED FAILs (r6/r7: an outside `stop.sh` sent SIGTERM to
//     every recorded group mid-run).

import { descendantPids } from "./app-cases-lib.mjs";

/** `ps -eo pid=,ppid=,pgid=` text -> Map pid -> {pid, ppid, pgid} (pgid null when the column is absent). */
export function parsePsTable(psText) {
  const rows = new Map();
  for (const line of String(psText ?? "").split(/\r?\n/)) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    rows.set(pid, { pid, ppid, pgid: Number.isInteger(pgid) ? pgid : null });
  }
  return rows;
}

/** The pids a harness pids file records (`<name> <pid> <port>` lines; stop.sh's format). */
export function harnessPidsFromFile(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const pid = Number(line.trim().split(/\s+/)[1]);
    if (Number.isInteger(pid) && pid > 1) out.push(pid);
  }
  return out;
}

const isPid = (pid) => Number.isInteger(pid) && pid > 1;

/**
 * The pids a crash may SIGKILL, deepest first, the root last; [] when the root
 * is not provably this runner's own child. `protectedPids` are the harness's
 * recorded pids, which are also their process groups (setsid).
 */
export function crashTargets(psText, { root, runnerPid, protectedPids = [] }) {
  const table = parsePsTable(psText);
  const rootRow = table.get(Number(root));
  if (!isPid(Number(root)) || !isPid(runnerPid) || Number(root) === runnerPid) return [];
  // gone, or a reused pid that some other parent owns now: never ours to kill
  if (!rootRow || rootRow.ppid !== runnerPid) return [];
  const runnerPgid = table.get(runnerPid)?.pgid ?? null;
  const fenced = new Set([1, runnerPid, ...protectedPids.filter(isPid)]);
  const groupFenced = new Set([...fenced, ...(runnerPgid !== null ? [runnerPgid] : [])]);
  const allowed = (pid) => {
    const row = table.get(pid);
    return isPid(pid) && !fenced.has(pid) && !(row?.pgid !== null && row?.pgid !== undefined && groupFenced.has(row.pgid));
  };
  if (!allowed(rootRow.pid)) return [];
  const tree = descendantPids(psText, rootRow.pid).filter(allowed);
  return [...tree.reverse(), rootRow.pid];
}

/** The negative pid that signals the group of a child this runner spawned detached, or null when the pid is unusable. */
export function ownGroupTarget(pid) {
  return isPid(pid) ? -pid : null;
}

/** The last `shutting down ... signal=<sig>` line of server.log: `{ts, signal}` or null. */
export function serverShutdownOf(serverLogText) {
  let found = null;
  for (const line of String(serverLogText ?? "").split(/\r?\n/)) {
    if (!/\bshutting down\b/.test(line)) continue;
    const ts = line.trim().split(/\s+/)[0] ?? null;
    const signal = /\bsignal=(\S+)/.exec(line)?.[1] ?? null;
    found = { ts, signal };
  }
  return found;
}

/**
 * The guard's verdict on one /healthz probe: null when the server is up, else
 * the BLOCKED reason `harness server down (killed at <ts>?) ...` with what the
 * run dir says about who took it down.
 */
export function harnessDownReason({ ok, status = null, error = null, serverLogText = "", pidFilePresent = true }) {
  if (ok) return null;
  const shutdown = serverShutdownOf(serverLogText);
  const probe = status !== null ? `/healthz answered ${status}` : `/healthz: ${error ?? "no answer"}`;
  const details = [
    probe,
    ...(shutdown?.signal ? [`server.log: shutting down signal=${shutdown.signal}`] : []),
    ...(pidFilePresent ? [] : ["the run's pids file is gone (harness stop.sh ran)"]),
  ];
  return `harness server down (killed at ${shutdown?.ts ?? "unknown"}?): ${details.join("; ")}`;
}

/**
 * A case result after the post-case probe: unchanged while the server is up,
 * and a PASS of every exit stays (its assertions held against a live server);
 * otherwise BLOCKED with the reason, since a failure can no longer be told from
 * the kill. `complete` is false when the row stopped before its last exit.
 */
export function guardCaseResult(result, downReason, { complete = true } = {}) {
  if (!downReason || result.result === "BLOCKED" || (result.result === "PASS" && complete)) return result;
  // a predicted FAIL tag does not belong on a BLOCKED row, at the case level or on any exit (review r2b FIX-6-2)
  const { predicted, ...rest } = result;
  const exits = Array.isArray(result.exits) ? result.exits.map(({ predicted: exitPredicted, ...exit }) => exit) : null;
  return { ...rest, ...(exits ? { exits } : {}), result: "BLOCKED", blocker: result.blocker ? `${downReason}; ${result.blocker}` : downReason, resultBeforeBlock: result.result };
}
