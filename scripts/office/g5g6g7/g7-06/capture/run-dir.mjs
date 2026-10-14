/* global process */
// Reads the G7-01 harness run (start.sh -> ports.env) and decides whether the
// stack is there to capture from. The layout and the start gate come from
// harness/lib.mjs, so a rename or a new start state cannot split this reader
// from the writer.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harnessPaths, readStartStatus, startGate } from "../../harness/lib.mjs";
import { REPO_ROOT } from "./playwright.mjs";

export function defaultRunDir(env = process.env) {
  return env.HARNESS_RUN_DIR || join(REPO_ROOT, ".harness-run");
}

/** ports.env as an object, or null when the run has none. */
export function readPorts(runDir) {
  const file = harnessPaths(runDir).envFile;
  if (!existsSync(file)) return null;
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

/**
 * `{gate:"proceed", ports}`, `{gate:"blocked", reason}` (no run, or start.sh itself
 * reported a missing precondition) or `{gate:"fail", reason}` (start.sh failed or
 * never finished: a harness bug, never "the VM cannot do it").
 */
export function readRun(runDir) {
  const ports = readPorts(runDir);
  if (!ports) return { gate: "blocked", reason: `no harness run at ${runDir} (missing ports.env); run start.sh first` };
  const start = startGate(readStartStatus(runDir));
  if (start.gate !== "proceed") return { gate: start.gate, reason: start.reason };
  return { gate: "proceed", ports };
}
