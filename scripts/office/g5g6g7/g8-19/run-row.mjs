// G8-19 (UNI-1414) row runner: the scaffold every cross-host row module
// (comments, anchors, inbox, deeplink, revoke, account, library) runs under.
// It gates on the harness start status, reads ports.env, runs the module under
// a watchdog, writes one artifact per (row, fixture) and maps the record to
// the exit code evidence.mjs expects: 0 PASS, 1 FAIL, 77 BLOCKED with a named
// blocker. Contract: scripts/office/g5g6g7/harness/g8-contract.md §8.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redact } from "../harness/api-contract.mjs";
import { createApi } from "../harness/api.mjs";
import { parseEnvFile, readRedactedAppLogTail, redactSignInError } from "../harness/app-steps.mjs";
import { BLOCKED_EXIT, harnessPaths, readStartStatus, startGate } from "../harness/lib.mjs";
import { seedWorld } from "../harness/world.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../../..");

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
 * with the blockers joined; else PASS; no steps -> FAIL. A NOT_JUDGED step whose
 * `cascadeFrom` names a failing step adds no reason; any other NOT_JUDGED is a FAIL.
 */
export function decideFromSteps(steps = {}) {
  const entries = Object.entries(steps ?? {});
  if (entries.length === 0) return { status: "FAIL", reason: "no steps ran" };
  const failing = (s) => s?.status !== "PASS" && s?.status !== "BLOCKED" && s?.status !== "NOT_JUDGED";
  // NOT_JUDGED: an earlier failing check removed this one's precondition; it adds no reason of its own,
  // and one whose named source did not fail is a FAIL (never PASS or BLOCKED)
  const cascaded = (s) => s?.status === "NOT_JUDGED" && Boolean(s.cascadeFrom && steps[s.cascadeFrom]) && failing(steps[s.cascadeFrom]);
  const failed = entries.filter(([, s]) => failing(s) || (s?.status === "NOT_JUDGED" && !cascaded(s)));
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

const safe = (text) => redactSignInError(redact(String(text ?? "")));

function writeArtifact(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Runs one row module and returns its exit code (contract §8): the start
 * gate, ports.env, `fn(ctx)` under the watchdog, the artifact at
 * rowArtifactPath(), and the 0 / 1 / 77 mapping. `worldFactory` (tests)
 * replaces seedWorld for ctx.getWorld().
 */
export async function runRowModule(
  { row, fixture, runDir, module = "", timeoutMs = null, repoRoot = DEFAULT_REPO_ROOT, worldFactory = null, env = process.env },
  fn,
) {
  const artifactPath = rowArtifactPath(runDir, row, fixture);
  rmSync(artifactPath, { force: true });
  const startedAt = new Date().toISOString();
  const record = { row, fixture, module, status: "FAIL", exitCode: 1, reason: "", blocker: "", owner: "", steps: {}, details: {}, log: [] };
  const finish = (outcome) => {
    let { status, reason = "", blocker = "", owner = "" } = outcome;
    if (status === "BLOCKED" && !String(blocker).trim()) {
      status = "FAIL";
      reason = `BLOCKED without a named blocker${reason ? `: ${reason}` : ""}`;
    }
    if (!Object.hasOwn(ROW_EXIT, status)) {
      reason = `unknown status ${status}${reason ? `: ${reason}` : ""}`;
      status = "FAIL";
    }
    Object.assign(record, { status, reason: safe(reason), blocker: safe(blocker), owner: String(owner ?? ""), exitCode: exitCodeFor(status) });
    record.startedAt = startedAt;
    record.finishedAt = new Date().toISOString();
    record.appLogTail = status === "PASS" ? [] : readRedactedAppLogTail(runDir);
    writeArtifact(artifactPath, record);
    return record.exitCode;
  };

  const paths = harnessPaths(runDir);
  const portsText = existsSync(paths.envFile) ? readFileSync(paths.envFile, "utf8") : "";
  const portsEnv = parseEnvFile(portsText);
  record.forkSha = env.OFFICE_FORK_SHA || portsEnv.OFFICE_FORK_SHA || "";

  const gate = startGate(readStartStatus(runDir));
  if (gate.gate !== "proceed") {
    return gate.gate === "blocked"
      ? finish({ status: "BLOCKED", reason: gate.reason, blocker: gate.reason, owner: "g7-qa" })
      : finish({ status: "FAIL", reason: gate.reason });
  }
  if (!portsText) return finish({ status: "FAIL", reason: `no ports.env in ${runDir} (run scripts/office/g5g6g7/harness/start.sh first)` });
  if (!portsEnv.API_ORIGIN) return finish({ status: "FAIL", reason: `API_ORIGIN missing from ${paths.envFile}` });

  let currentStep = "";
  let worldPromise = null;
  const ctx = {
    row,
    fixture,
    runDir,
    repoRoot,
    portsEnv,
    apiOrigin: portsEnv.API_ORIGIN,
    webOrigin: portsEnv.WEB_ORIGIN ?? "",
    api: createApi({ apiOrigin: portsEnv.API_ORIGIN }),
    getWorld() {
      worldPromise ??= Promise.resolve(
        worldFactory ? worldFactory({ runDir, apiOrigin: portsEnv.API_ORIGIN }) : seedWorld({ runDir, apiOrigin: portsEnv.API_ORIGIN, repoRoot }),
      ).then((world) => {
        if (world?.users?.M?.multiOrg) record.details.multiOrg = world.users.M.multiOrg;
        return world;
      });
      return worldPromise;
    },
    async step(name, stepFn) {
      currentStep = name;
      const began = Date.now();
      let result;
      try {
        const out = await stepFn();
        result = { status: "PASS", ...(out && typeof out === "object" ? out : {}) };
      } catch (err) {
        result = { status: "FAIL", reason: err instanceof Error ? err.message : String(err) };
        if (err?.appStepTimeout) result.details = { appStepTimeout: { call: err.appStepTimeout.call, elapsedMs: err.appStepTimeout.elapsedMs } };
      }
      if (record.steps[name]?.reason === "row watchdog") return record.steps[name];
      for (const key of ["reason", "blocker"]) if (result[key] !== undefined) result[key] = safe(result[key]);
      record.steps[name] = { ...result, elapsedMs: Date.now() - began };
      currentStep = "";
      return record.steps[name];
    },
    block(blocker, owner = "") {
      return { status: "BLOCKED", blocker, owner };
    },
    log(message) {
      record.log.push(safe(message));
    },
  };

  const limitMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : Number(env.G819_ROW_TIMEOUT_MS) > 0 ? Number(env.G819_ROW_TIMEOUT_MS) : DEFAULT_ROW_TIMEOUT_MS;
  let timer = null;
  const watchdog = new Promise((resolveWatchdog) => {
    timer = setTimeout(() => resolveWatchdog({ watchdog: true }), limitMs);
  });
  let outcome;
  try {
    outcome = await Promise.race([Promise.resolve().then(() => fn(ctx)).then((value) => ({ value })), watchdog]);
  } catch (err) {
    clearTimeout(timer);
    return finish({ status: "FAIL", reason: err instanceof Error ? err.message : String(err) });
  }
  clearTimeout(timer);
  if (outcome.watchdog) {
    if (currentStep) record.steps[currentStep] = { ...(record.steps[currentStep] ?? {}), status: "FAIL", reason: "row watchdog" };
    return finish({ status: "FAIL", reason: "row watchdog" });
  }
  const value = outcome.value && typeof outcome.value === "object" ? outcome.value : {};
  if (value.details && typeof value.details === "object") Object.assign(record.details, value.details);
  if (value.steps && typeof value.steps === "object") Object.assign(record.steps, value.steps);
  if (value.status) return finish(value);
  return finish(decideFromSteps(record.steps));
}

/**
 * The CLI of a row module: `node g8-19/<module>.mjs --row G8-Axx --fixture <id> --run-dir <dir>`.
 * Runs `fn` through runRowModule, prints one status line (never a secret), and
 * with G819_WRITE_EVIDENCE=1 outside evidence.mjs appends the evidence line itself.
 * Resolves the exit code; the module's entry point passes it to process.exit.
 */
export async function rowMain(module, fn, { argv = process.argv.slice(2), env = process.env } = {}) {
  const startedAt = new Date().toISOString();
  const args = parseRowArgs(argv, env);
  const exitCode = await runRowModule({ ...args, module, env }, fn);
  const artifact = rowArtifactPath(args.runDir, args.row, args.fixture);
  const record = JSON.parse(readFileSync(artifact, "utf8"));
  console.log(`${args.row} ${args.fixture} ${record.status}${record.reason ? `: ${record.reason}` : ""} (${artifact})`);
  if (env.G819_WRITE_EVIDENCE === "1" && !env.OFFICE_EVIDENCE_ID) {
    const { evidenceLine, fixtureSha256Of, harnessEvidenceId, ledgerIdentity } = await import("../harness/lib.mjs");
    const command = `node scripts/office/g5g6g7/g8-19/${module}.mjs ${argv.join(" ")}`;
    const line = evidenceLine({
      evidenceId: harnessEvidenceId(args.row),
      ...(await ledgerIdentity(env)),
      requirementId: args.row,
      fixtureId: args.fixture,
      fixtureSha256: await fixtureSha256Of(args.fixture),
      fSha: record.forkSha,
      platform: `${process.platform}-${process.arch}`,
      build: `node ${process.versions.node}`,
      command,
      argv: [...process.argv],
      exitCode,
      result: record.status,
      artifact,
      checker: `harness:g8-19/${module}.mjs`,
      blocker: record.status === "BLOCKED" ? record.blocker : "",
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    const { appendFileSync } = await import("node:fs");
    appendFileSync(harnessPaths(args.runDir).evidenceFile, `${JSON.stringify(line)}\n`);
  }
  return exitCode;
}
