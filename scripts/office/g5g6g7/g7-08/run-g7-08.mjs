#!/usr/bin/env node
// G7-08 (UNI-1385) W2 CLI runner for the per-format AI matrix on web.
// Expands runs with expandMatrixRuns, runs one row at a time, tracks token budget (<100k output tokens),
// and records one evidence line per (row, provider, host) through scripts/office/g5g6g7/evidence.mjs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEvidence } from '../evidence.mjs';
import { isMainModule } from '../harness/lib.mjs';
import { VERDICT, blockedVerdict } from './oracles.mjs';
import {
  DEFAULT_REPO_ROOT,
  HOSTS,
  MATRIX_ROWS,
  PROVIDERS,
  ROW_EXIT,
  expandMatrixRuns,
  getRowById,
} from './rows.mjs';
import { REAL_AI_BLOCKER, runWebMatrixRow } from './web-driver.mjs';
import { InterruptedAiTurnError } from './wire-observe.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 100_000;
export const DEFAULT_OUTPUT_TOKEN_GUARD = 90_000;
export const DEFAULT_FORK_SHA = 'c9181fa';

export function primaryRequirementForRow(rowOrEntry) {
  const acs = rowOrEntry?.acs ?? [];
  const format = rowOrEntry?.format ?? '';
  const operation = rowOrEntry?.operation ?? '';
  if (acs.includes('G6-A05')) return 'G6-A05';
  if (format === 'xlsx' && operation === 'edit') return 'G6-A04';
  if (format === 'xlsx' || format === 'docx') return 'G6-A03';
  return 'G6-A06';
}

export function parseRunArgs(argv = process.argv.slice(2), env = process.env) {
  let rowsArg = 'all';
  let providersArg = 'uniwork,byok';
  let host = 'web';
  let runDir = env.HARNESS_RUN_DIR || '';
  let dryRun = false;
  let verifyResult = '';
  let maxOutputTokens = Number(env.G708_MAX_OUTPUT_TOKENS || DEFAULT_OUTPUT_TOKEN_BUDGET);
  let guardOutputTokens = Number(env.G708_GUARD_OUTPUT_TOKENS || DEFAULT_OUTPUT_TOKEN_GUARD);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--rows') {
      rowsArg = String(argv[++i] ?? '').trim();
    } else if (arg === '--providers') {
      providersArg = String(argv[++i] ?? '').trim();
    } else if (arg === '--host') {
      host = String(argv[++i] ?? '').trim();
    } else if (arg === '--run-dir') {
      runDir = String(argv[++i] ?? '').trim();
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--verify-result') {
      verifyResult = String(argv[++i] ?? '').trim();
    } else if (arg === '--budget-output-tokens') {
      maxOutputTokens = Number(argv[++i]);
      guardOutputTokens = Math.min(guardOutputTokens, maxOutputTokens);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (verifyResult) {
    return { verifyResult: resolve(verifyResult) };
  }

  if (!HOSTS.includes(host)) {
    throw new Error(`--host must be one of ${HOSTS.join(', ')}, got "${host}"`);
  }
  if (host === 'desktop') {
    return {
      host: 'desktop',
      rows: [],
      providers: [],
      runDir: runDir ? resolve(runDir) : '',
      dryRun,
      maxOutputTokens,
      guardOutputTokens,
    };
  }

  if (!runDir) {
    throw new Error('--run-dir <dir> is required');
  }
  const providers = providersArg
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (providers.length === 0 || !providers.every((p) => PROVIDERS.includes(p))) {
    throw new Error(`--providers must be a comma-separated subset of ${PROVIDERS.join(',')}, got "${providersArg}"`);
  }

  let rows;
  if (rowsArg === 'all') {
    rows = [...MATRIX_ROWS];
  } else {
    const ids = rowsArg
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    if (ids.length === 0) throw new Error('--rows must specify row IDs or "all"');
    rows = ids.map((id) => {
      const found = getRowById(id);
      if (!found) throw new Error(`unknown row id: "${id}"`);
      return found;
    });
  }

  return {
    rows,
    providers,
    host,
    runDir: resolve(runDir),
    dryRun,
    maxOutputTokens,
    guardOutputTokens,
  };
}

export function createBudgetTracker({
  maxOutputTokens = DEFAULT_OUTPUT_TOKEN_BUDGET,
  guardOutputTokens = DEFAULT_OUTPUT_TOKEN_GUARD,
} = {}) {
  let totalModelCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let missingUsageCalls = 0;
  let missingObservationCalls = 0;
  const perRun = [];

  return {
    canStartNextRun() {
      // G708-R2-7 / G708-R3-1: a turn whose model call was not observed, or whose response
      // reported no usage, left the running total unknown - fail closed.
      if (missingObservationCalls > 0) {
        return {
          allowed: false,
          verdict: blockedVerdict('missing_model_call_observation', { missingObservationCalls }),
        };
      }
      if (missingUsageCalls > 0) {
        return {
          allowed: false,
          verdict: blockedVerdict('missing_usage_on_model_call', { missingUsageCalls, outputTokens: totalOutputTokens }),
        };
      }
      if (totalOutputTokens >= guardOutputTokens || totalOutputTokens >= maxOutputTokens) {
        return {
          allowed: false,
          verdict: blockedVerdict('budget_exhausted_output_tokens', {
            outputTokens: totalOutputTokens,
            guardOutputTokens,
            maxOutputTokens,
          }),
        };
      }
      return { allowed: true };
    },
    recordRun(runId, usage = {}) {
      const entry = {
        runId,
        modelCalls: Number(usage?.modelCalls ?? 0) || 0,
        inputTokens: Number(usage?.inputTokens ?? 0) || 0,
        outputTokens: Number(usage?.outputTokens ?? 0) || 0,
        missingUsageCalls: Number(usage?.missingUsageCalls ?? 0) || 0,
        missingObservationCalls: Number(usage?.missingObservationCalls ?? 0) || 0,
        // w2p: UniWork refusals the turn ended with or passed; they spend nothing.
        refusals: Array.isArray(usage?.refusals) ? usage.refusals.map((r) => ({ ...r })) : [],
      };
      missingUsageCalls += entry.missingUsageCalls;
      missingObservationCalls += entry.missingObservationCalls;
      totalModelCalls += entry.modelCalls;
      totalInputTokens += entry.inputTokens;
      totalOutputTokens += entry.outputTokens;
      perRun.push(entry);
      return entry;
    },
    summary() {
      return {
        modelCalls: totalModelCalls,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        missingUsageCalls,
        missingObservationCalls,
        maxOutputTokens,
        guardOutputTokens,
        perRun: [...perRun],
      };
    },
  };
}

export function verifyRecordedRunResult(resultFile, stdout = process.stdout) {
  if (!resultFile || !existsSync(resultFile)) {
    stdout.write(`skip: missing result file ${resultFile}\n`);
    return ROW_EXIT.BLOCKED;
  }
  const data = JSON.parse(readFileSync(resultFile, 'utf8'));
  stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  if (data.status === VERDICT.PASS) return ROW_EXIT.PASS;
  if (data.status === VERDICT.BLOCKED) {
    stdout.write(`skip: ${data.reason || data.blocker || 'blocked'}\n`);
    return ROW_EXIT.BLOCKED;
  }
  return ROW_EXIT.FAIL;
}

export function emitRunEvidence({
  runEntry,
  resultFile,
  runDir,
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  evidenceFn = runEvidence,
} = {}) {
  if (env.OFFICE_EVIDENCE_ID) return null;
  const outDir = env.OFFICE_EVIDENCE_OUT?.trim() ? resolve(env.OFFICE_EVIDENCE_OUT.trim()) : runDir;
  const requirementId = primaryRequirementForRow(runEntry);
  const artifactPath = join(runDir, 'g7-08', 'artifacts', `${runEntry.rowId}-${runEntry.provider}-${runEntry.host}.log`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  return evidenceFn({
    requirementId,
    fixtureId: runEntry.fixtureId,
    checker: `g7-08:${runEntry.runId}`,
    command: [process.execPath, THIS_FILE, '--verify-result', resultFile],
    outDir,
    artifact: artifactPath,
    cwd: repoRoot,
    env: {
      ...env,
      OFFICE_FORK_SHA: env.OFFICE_FORK_SHA?.trim() || DEFAULT_FORK_SHA,
    },
  });
}

export async function runG708Matrix(
  args,
  {
    rowRunner = runWebMatrixRow,
    evidenceFn = runEvidence,
    repoRoot = DEFAULT_REPO_ROOT,
    env = process.env,
    log = (line) => console.log(line),
  } = {},
) {
  const budget = createBudgetTracker({
    maxOutputTokens: args.maxOutputTokens,
    guardOutputTokens: args.guardOutputTokens,
  });

  if (args.host === 'desktop') {
    const w3 = blockedVerdict('W3', { host: 'desktop', reason: 'desktop_host_deferred_to_w3' });
    log(`BLOCKED: ${w3.reason} (desktop host is W3)`);
    return {
      status: w3.status,
      exitCode: w3.exitCode,
      reason: w3.reason,
      runs: [],
      evidenceRecords: [],
      usage: budget.summary(),
    };
  }

  if (!args.dryRun && env.HARNESS_ALLOW_REAL_AI_UPSTREAM !== '1') {
    const blocked = blockedVerdict(REAL_AI_BLOCKER, { owner: 'G6' });
    log(`BLOCKED: ${blocked.reason}`);
    return {
      status: blocked.status,
      exitCode: blocked.exitCode,
      reason: blocked.reason,
      runs: [],
      evidenceRecords: [],
      usage: budget.summary(),
    };
  }

  const expanded = expandMatrixRuns({
    rows: args.rows,
    providers: args.providers,
    hosts: [args.host],
  }).filter((entry) => entry.host === args.host && (entry.mode === 'automated' || args.rows.some((r) => r.id === entry.rowId && args.rows.length < MATRIX_ROWS.length)));

  const resultsDir = join(args.runDir, 'g7-08');
  mkdirSync(resultsDir, { recursive: true });

  const runResults = [];
  const evidenceRecords = [];

  for (const runEntry of expanded) {
    const check = budget.canStartNextRun();
    let outcome;
    if (!check.allowed) {
      // R3-1: the stopped row records what the run had observed so far, unknown usage included -
      // a stop that hid its own missing count would read as a clean zero.
      const totals = budget.summary();
      outcome = {
        ...check.verdict,
        usage: {
          modelCalls: totals.modelCalls,
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          missingUsageCalls: totals.missingUsageCalls,
          missingObservationCalls: totals.missingObservationCalls,
        },
      };
    } else {
      try {
        outcome = await rowRunner(runEntry, {
          runDir: args.runDir,
          repoRoot,
          dryRun: args.dryRun,
          env,
        });
      } catch (err) {
        // R3-3 + R4-3: a row runner that threw left that turn's spend unknown, so the matrix
        // stops instead of starting the next row on a trusted zero. The driver classifies what
        // its observer saw and either rethrows `InterruptedAiTurnError` or, when no frame AI
        // POST was observed at all, RETURNS `row_runner_threw`; so a plain throw that reaches
        // here is an unclassified unknown, never a 0-call crash.
        if (err instanceof InterruptedAiTurnError) {
          outcome = {
            ...blockedVerdict('missing_usage_on_model_call', { detail: err.message }),
            usage: err.usage,
          };
        } else {
          outcome = {
            ...blockedVerdict('missing_usage_on_model_call', {
              detail: err instanceof Error ? err.message : String(err),
            }),
            usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, missingUsageCalls: 1, missingObservationCalls: 0 },
          };
        }
      }
    }

    // A row that never ran records what the run had already observed (its reason names the unknown),
    // and does not re-add those totals to the budget.
    const rowUsage = check.allowed
      ? budget.recordRun(runEntry.runId, outcome?.usage)
      : { ...outcome.usage };
    const record = {
      runId: runEntry.runId,
      rowId: runEntry.rowId,
      format: runEntry.format,
      module: runEntry.module,
      operation: runEntry.operation,
      provider: runEntry.provider,
      host: runEntry.host,
      fixtureId: runEntry.fixtureId,
      fixtureSha256: runEntry.fixtureSha256,
      dryRun: Boolean(args.dryRun),
      status: outcome.status,
      exitCode: outcome.exitCode,
      reason: outcome.reason ?? '',
      blocker: outcome.blocker ?? null,
      owner: outcome.owner ?? null,
      preconditions: outcome.preconditions ?? null,
      screenshotPath: outcome.screenshotPath ?? null,
      details: outcome.details ?? {},
      verdicts: outcome.verdicts ?? {},
      usage: rowUsage,
      refusals: rowUsage.refusals ?? [],
    };

    const resultFile = join(resultsDir, `${runEntry.rowId}-${runEntry.provider}-${runEntry.host}.json`);
    writeFileSync(resultFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    runResults.push(record);

    log(
      `[G7-08 row] ${runEntry.runId} status=${record.status} reason=${record.reason} modelCalls=${rowUsage.modelCalls} inputTokens=${rowUsage.inputTokens} outputTokens=${rowUsage.outputTokens}`,
    );

    const evRecord = emitRunEvidence({
      runEntry,
      resultFile,
      runDir: args.runDir,
      repoRoot,
      env,
      evidenceFn,
    });
    if (evRecord) evidenceRecords.push(evRecord);
  }

  const totalUsage = budget.summary();
  log(
    `[G7-08 usage total] modelCalls=${totalUsage.modelCalls} inputTokens=${totalUsage.inputTokens} outputTokens=${totalUsage.outputTokens}`,
  );

  let status = VERDICT.PASS;
  let exitCode = ROW_EXIT.PASS;
  if (runResults.some((r) => r.status === VERDICT.FAIL)) {
    status = VERDICT.FAIL;
    exitCode = ROW_EXIT.FAIL;
  } else if (runResults.some((r) => r.status === VERDICT.BLOCKED)) {
    status = VERDICT.BLOCKED;
    exitCode = ROW_EXIT.BLOCKED;
  }

  return {
    status,
    exitCode,
    runs: runResults,
    evidenceRecords,
    usage: totalUsage,
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let parsed;
  try {
    parsed = parseRunArgs(argv, env);
  } catch (err) {
    console.error(`run-g7-08.mjs: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  if (parsed.verifyResult) {
    return verifyRecordedRunResult(parsed.verifyResult);
  }
  const outcome = await runG708Matrix(parsed, { env });
  return outcome.exitCode;
}

if (isMainModule({ moduleUrl: import.meta.url })) {
  main().then(
    (code) => {
      process.exitCode = code;
      setTimeout(() => process.exit(code), 500).unref();
    },
    (err) => {
      console.error(`run-g7-08.mjs: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
