// G8-19 (UNI-1414) row runner: the scaffold every cross-host row module
// (comments, anchors, inbox, deeplink, revoke, account, library) runs under.
// It gates on the harness start status, reads ports.env, runs the module under
// a watchdog, writes one artifact per (row, fixture) and maps the record to
// the exit code evidence.mjs expects: 0 PASS, 1 FAIL, 77 BLOCKED with a named
// blocker. Contract: scripts/office/g5g6g7/harness/g8-contract.md §8.
import { join } from "node:path";

import { BLOCKED_EXIT } from "../harness/lib.mjs";

export const ROW_EXIT = Object.freeze({ PASS: 0, FAIL: 1, BLOCKED: BLOCKED_EXIT });
export const DEFAULT_ROW_TIMEOUT_MS = 600_000;

// fx-xlsx-revenue-xyz: workbook sheetId 2 is "Doanh thu Q2"; the sheets reader
// names every file sheet `sheet-<sheetId>` and anchors by that stable id
// (fork apps/sheets/src/renderer/server-comments/anchor-store.ts:51-56,86-88).
export const B7_ANCHOR = Object.freeze({ format: "xlsx", v: 1, sheet: "sheet-2", range: "B7" });
export const B7_SHEET_NAME = "Doanh thu Q2";
export const WEB_FRAME_PIN_BLOCKER = "web frame pin 05fd209 lacks G8-12..15 (R1)";
export const WEB_FRAME_PIN_OWNER = "lead-f";

/** `<runDir>/reports/g7-qa/<row lower-case>/<fixture>.json`, e.g. reports/g7-qa/g8-a01/fx-docx-report-vi.json. */
export function rowArtifactPath(runDir, row, fixture) {
  if (!/^G8-A\d\d$/.test(String(row))) throw new Error(`row must look like G8-A01, got ${row}`);
  if (!/^[a-z0-9-]+$/.test(String(fixture))) throw new Error(`fixture must be a fixture id, got ${fixture}`);
  return join(runDir, "reports", "g7-qa", row.toLowerCase(), `${fixture}.json`);
}

/** PASS 0, FAIL 1, BLOCKED 77; anything else is 1. */
export function exitCodeFor(status) {
  return Object.hasOwn(ROW_EXIT, status) ? ROW_EXIT[status] : ROW_EXIT.FAIL;
}

/**
 * The row status from its steps: any FAIL -> FAIL; else any BLOCKED -> BLOCKED
 * with the blockers joined; else PASS; no steps -> FAIL.
 */
export function decideFromSteps(steps = {}) {
  const entries = Object.entries(steps ?? {});
  if (entries.length === 0) return { status: "FAIL", reason: "no steps ran" };
  const failed = entries.filter(([, s]) => s?.status !== "PASS" && s?.status !== "BLOCKED");
  if (failed.length > 0) {
    return { status: "FAIL", reason: failed.map(([name, s]) => `${name}: ${s?.reason || s?.status || "no status"}`).join("; ") };
  }
  const blocked = entries.filter(([, s]) => s.status === "BLOCKED");
  if (blocked.length > 0) {
    const blockers = [...new Set(blocked.map(([, s]) => s.blocker || ""))].filter(Boolean);
    const owners = [...new Set(blocked.map(([, s]) => s.owner || ""))].filter(Boolean);
    return {
      status: "BLOCKED",
      reason: blocked.map(([name, s]) => `${name}: ${s.blocker || "no blocker"}`).join("; "),
      blocker: blockers.join("; "),
      owner: owners.join(", "),
    };
  }
  return { status: "PASS", reason: "" };
}

/** `--row G8-Axx --fixture <id> --run-dir <dir> [--timeout-ms <ms>]`; --run-dir defaults to HARNESS_RUN_DIR. */
export function parseRowArgs(argv, env = process.env) {
  const out = { row: "", fixture: "", runDir: env.HARNESS_RUN_DIR || "", timeoutMs: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--row") out.row = next();
    else if (arg === "--fixture") out.fixture = next();
    else if (arg === "--run-dir") out.runDir = next();
    else if (arg === "--timeout-ms") out.timeoutMs = Number(next());
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!out.row || !out.fixture || !out.runDir) throw new Error("usage: --row G8-Axx --fixture <id> --run-dir <dir> [--timeout-ms <ms>]");
  return out;
}

/**
 * Runs one row module and returns its exit code (contract §8). STEP 1 stub:
 * the signature is final, the body lands with T1 STEP 2.
 */
export async function runRowModule(_opts, _fn) {
  throw new Error("runRowModule: not implemented yet (UNI-1414 T1 step 2)");
}
