#!/usr/bin/env node
/* global process, fetch, AbortSignal */
// App-layer fault cases runner for G7-03a (UNI-1380, WI-4): every `layer: "app"`
// row of docs/office/g5g6g7/fault/cases.json. Ready rows run against the fork
// app this runner launches itself, pointed at the fault proxy (the harness's own
// app keeps talking to the D server directly and is left alone); pending rows
// are reported BLOCKED with their dependency and run nothing.
//
//   bash scripts/office/g5g6g7/harness/start.sh                 # D server + web + fork build
//   dbus-run-session -- bash scripts/office/g5g6g7/fault/app-keyring.sh \
//     node scripts/office/g5g6g7/fault/app-cases.mjs [--case FQ-22] [--run-dir <dir>]
//
// Per run (one per exit of a multi-exit row): a fresh document, a fresh userData
// dir, a fresh app signed in as the app's account, the row's proxy rules, the
// fork's intent trace (UNIWORK_SYNC_TRACE_FILE). Artifacts under
// <run dir>/fault/<case>/[<n>/]: intent-log.jsonl (the trace mapped to the matrix §4
// schema), app-trace.jsonl (the trace as the fork wrote it), server-versions.before.json,
// server-versions.json, proxy-log.jsonl, result.json; one evidence line per AC.
// Exit 0 every ready row PASS, 1 any FAIL, 77 nothing PASS-able ran (BLOCKED).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvidence } from "../evidence.mjs";
import { loadPlaywright } from "../g7-06/capture/playwright.mjs";
import { DEFAULT_FORK_SHA, harnessPaths, isMainModule, readStartStatus, startGate } from "../harness/lib.mjs";
import { QUEUE_DRIVERS } from "./app-case-drivers.mjs";
import { BLOCKED_DRIVERS, EXTRA_EXITS } from "./app-case-drivers-blocked.mjs";
import {
  BLOCKED_EXIT_CODE, appTraceArtifacts, blockedCase, caseResult, envFileValue, expandExits, failEvidenceLines, filterTrace, parseProxyLog,
  parseTraceText, predictedFor, runEvidenceOf, runExitCode, runResult, selectAppCases,
} from "./app-cases-lib.mjs";
import { AppBlocked, closeApp, hasStoredSession, launchApp, signIn, waitFor, waitSignedIn } from "./app-session.mjs";
import {
  causeSuffix, clearSyncWrite, createFileDocument, enrollTotp, freshToken, grantPlatformAdmin, login, seedAppTenant, setSyncWrite,
} from "./app-tenant.mjs";
import { caseExpect } from "./case-expect.mjs";
import { EMPTY_SERVER_VERSIONS, collectServerVersions } from "./collect.mjs";
import { startFaultProxy } from "./proxy.mjs";
import { validateRules } from "./rules.mjs";
import { DEFAULT_CASES_PATH, REPO_ROOT, loadFaultCases, renderCaseRules } from "./server-cases-lib.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const FIXTURES_MANIFEST = resolve(REPO_ROOT, "docs", "office", "g5g6g7", "fixtures", "manifest.json");
const DRIVERS = { ...QUEUE_DRIVERS, ...BLOCKED_DRIVERS };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseAppCasesArgs(argv = [], env = process.env) {
  const out = { caseId: null, runDir: resolve(env.HARNESS_RUN_DIR?.trim() || join(REPO_ROOT, ".harness-run")), casesPath: DEFAULT_CASES_PATH, verifyResult: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, null];
    const value = () => (inline !== null ? inline : String(argv[++i] ?? "")).trim();
    if (flag === "--case") out.caseId = value() || null;
    else if (flag === "--run-dir") out.runDir = resolve(value());
    else if (flag === "--cases-file") out.casesPath = resolve(value());
    else if (flag === "--verify-result") out.verifyResult = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0 && !line.startsWith("#")) out[line.slice(0, at).trim()] = envFileValue(text, line.slice(0, at).trim());
  }
  return out;
}

function loadFixtures() {
  const manifest = JSON.parse(readFileSync(FIXTURES_MANIFEST, "utf8"));
  return new Map((manifest.fixtures ?? []).map((f) => [f.id, { ...f, bytes: readFileSync(resolve(REPO_ROOT, f.path)) }]));
}

const kindOf = (fixture) => (/\.xlsx$/i.test(fixture.path) ? "xlsx" : "docx");
const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** The precondition every app row needs; a reason string means BLOCKED for all of them. */
async function preconditions({ runDir, ports, playwright }) {
  const gate = startGate(readStartStatus(runDir));
  if (gate.gate === "blocked") return gate.reason;
  if (!ports.API_ORIGIN) return `no API_ORIGIN in ${harnessPaths(runDir).envFile} (run start.sh first)`;
  if (!ports.ELECTRON_BIN || !ports.SHELL_APP_DIR) return "the harness run did not build the fork app (no ELECTRON_BIN/SHELL_APP_DIR in ports.env; run start.sh without --skip-app)";
  if (!playwright) return "Playwright is not installed (the e2e workspace's @playwright/test)";
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) return "no D-Bus session: run under `dbus-run-session -- bash scripts/office/g5g6g7/fault/app-keyring.sh node …` (the app keeps its session in the OS keyring)";
  try {
    const res = await fetch(`${ports.API_ORIGIN}/healthz`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return `the D server answered ${res.status} on /healthz`;
  } catch {
    return `no D server on ${ports.API_ORIGIN}`;
  }
  return null;
}

function emitEvidence(row, caseDir, runDir, forkSha, env = process.env) {
  if (env.OFFICE_EVIDENCE_ID) return;
  const outDir = env.OFFICE_EVIDENCE_OUT?.trim() ? resolve(env.OFFICE_EVIDENCE_OUT.trim()) : runDir;
  for (const ac of row.ac ?? []) {
    try {
      runEvidence({
        requirementId: ac,
        fixtureId: row.fixture,
        checker: `fault:${row.id}`,
        command: [process.execPath, THIS_FILE, "--case", row.id, "--run-dir", runDir, "--verify-result"],
        outDir,
        artifact: join(caseDir, `evidence-${ac.toLowerCase()}.log`),
        env: { ...env, OFFICE_FORK_SHA: env.OFFICE_FORK_SHA?.trim() || forkSha || DEFAULT_FORK_SHA },
      });
    } catch {
      // a ledger error must not stop the remaining cases
    }
  }
}

function verifyRecorded({ caseId, runDir }) {
  const file = join(runDir, "fault", String(caseId ?? ""), "result.json");
  if (!existsSync(file)) {
    process.stdout.write(`BLOCKED: no result.json for ${caseId}\n`);
    return BLOCKED_EXIT_CODE;
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n${join(runDir, "fault", caseId)}\n`);
  return data.result === "PASS" ? 0 : data.result === "BLOCKED" ? BLOCKED_EXIT_CODE : 1;
}

function finishCase(row, result, caseDir, runDir, forkSha) {
  mkdirSync(caseDir, { recursive: true });
  writeJson(join(caseDir, "result.json"), result);
  writeJson(join(caseDir, "case-result.json"), result);
  emitEvidence(row, caseDir, runDir, forkSha);
  return result;
}

async function runOne({ row, run, runs, caseDir, shared }) {
  const { ports, proxy, tenant, fixtures, playwright, databaseUrl, runDir } = shared;
  const fixture = fixtures.get(row.fixture);
  const runDirOut = runs > 1 ? join(caseDir, String(run.index)) : caseDir;
  const appDir = join(runDir, "fault", ".app", `${row.id}-${run.index}`);
  const traceFile = join(appDir, "trace.jsonl");
  mkdirSync(runDirOut, { recursive: true });
  mkdirSync(appDir, { recursive: true });
  const sessions = [];
  const docs = new Map();
  await fetch(`${proxy.origin}/__fault/rules`, { method: "DELETE" });
  await fetch(`${proxy.origin}/__fault/log`, { method: "DELETE" });
  const readTrace = (docId) => {
    const raw = existsSync(traceFile) ? readFileSync(traceFile, "utf8") : "";
    return filterTrace(parseTraceText(raw).lines, docId);
  };
  const proxyLogRaw = async () => (await fetch(`${proxy.origin}/__fault/log`)).text();
  const ownerToken = () => freshToken(tenant.apiOrigin, tenant.owner);
  const ctx = {
    row, run, tenant, fixture, kind: kindOf(fixture),
    // the run's expectation: the row's `expect` in cases.json with this exit's `expect` over it (review r1 R1-2)
    expect: caseExpect(row, run.exit), marker: `G703A${row.id.replace("-", "")}X${run.index}`,
    databaseUrl, sleep, waitFor, sha256File,
    now: () => new Date().toISOString(),
    newDocument: async () => {
      const doc = await createFileDocument(tenant, fixture, `${row.id} run ${run.index}`);
      docs.set(doc.id, await collectServerVersions({ apiOrigin: tenant.apiOrigin, token: await ownerToken(), documentId: doc.id }));
      return doc;
    },
    launch: async ({ stuckAfterMs, recheckMs, requireSignIn = true } = {}) => {
      const session = await launchApp({
        playwright, ports, proxyOrigin: proxy.origin, userDataDir: join(appDir, "userdata"), traceFile,
        stuckAfterMs, recheckMs, logFile: join(appDir, "app.log"),
      });
      sessions.push(session);
      if (!requireSignIn) return session;
      // a stored session is refreshed at launch; a fresh userData signs in at once
      if (!hasStoredSession(session.userDataDir) || !(await waitSignedIn(session, 30_000))) await signIn(session, tenant.apiOrigin, tenant.app);
      return session;
    },
    waitSignedIn: (session) => waitSignedIn(session),
    caseRules: (ids) => {
      const missing = ids.filter((id) => !row.proxyRules.some((r) => r.id === id));
      if (missing.length) throw new Error(`${row.id} has no proxy rule ${missing.join(", ")} in cases.json`);
      return renderCaseRules({ ...row, proxyRules: row.proxyRules.filter((r) => ids.includes(r.id)) }, { exit: run.exit ?? undefined });
    },
    ruleOf: (rule) => validateRules([rule])[0],
    setRules: async (rules) => {
      await fetch(`${proxy.origin}/__fault/rules`, { method: rules.length ? "POST" : "DELETE", headers: { "content-type": "application/json" }, body: rules.length ? JSON.stringify(rules) : undefined });
    },
    clearRules: () => fetch(`${proxy.origin}/__fault/rules`, { method: "DELETE" }),
    release: (id) => fetch(`${proxy.origin}/__fault/release/${encodeURIComponent(id)}`, { method: "POST" }),
    waitHeld: (id, timeoutMs) => waitFor(async () => {
      const rules = await (await fetch(`${proxy.origin}/__fault/rules`)).json();
      return (rules ?? []).find((r) => r.id === id && (r.held ?? 0) >= 1) ?? null;
    }, timeoutMs, 100),
    proxyLog: async () => parseProxyLog(await proxyLogRaw()),
    waitLog: (predicate, timeoutMs) => waitFor(async () => {
      const log = parseProxyLog(await proxyLogRaw());
      return predicate(log) ? log : null;
    }, timeoutMs, 200),
    trace: readTrace,
    waitState: (docId, states, { since = null, from = null, timeout = 60_000 } = {}) => {
      const wanted = states === null ? null : [].concat(states);
      return waitFor(async () => readTrace(docId).find((l) => (!since || String(l.ts) >= since)
        && (!wanted || wanted.includes(l.to)) && (!from || l.from === from)) ?? null, timeout, 500);
    },
    versionDelta: async (docId) => {
      const after = await collectServerVersions({ apiOrigin: tenant.apiOrigin, token: await ownerToken(), documentId: docId });
      return after.versions.length - (docs.get(docId)?.versions.length ?? 0);
    },
    newestVersion: async (docId) => {
      const after = await collectServerVersions({ apiOrigin: tenant.apiOrigin, token: await ownerToken(), documentId: docId });
      return [...after.versions].sort((a, b) => Number(b.version) - Number(a.version))[0] ?? null;
    },
    ensureAdmin: () => shared.ensureAdmin(),
    setSyncWrite: (enabled) => setSyncWrite(tenant, enabled),
    clearSyncWrite: () => clearSyncWrite(tenant),
  };
  let outcome;
  try {
    outcome = await DRIVERS[row.id](ctx);
  } catch (error) {
    outcome = error instanceof AppBlocked
      ? { documentId: null, assertions: [], blocker: error.message }
      : { documentId: null, assertions: [{ name: "run_execution", expected: "no unhandled error", actual: `${error.message}${causeSuffix(error)}`, ok: false }] };
  } finally {
    for (const session of sessions) await closeApp(session).catch(() => {});
    await fetch(`${proxy.origin}/__fault/rules`, { method: "DELETE" }).catch(() => {});
  }
  const docId = outcome.documentId ?? [...docs.keys()][0] ?? null;
  const traceLines = docId ? readTrace(docId) : [];
  const proxyRaw = await proxyLogRaw().catch(() => "");
  const proxyEntries = parseProxyLog(proxyRaw);
  const evidence = runEvidenceOf(traceLines, proxyEntries, docId);
  const result = runResult({ label: run.label, assertions: outcome.assertions, blocker: outcome.blocker, predicted: predictedFor(row, run), evidence });
  for (const [name, text] of Object.entries(appTraceArtifacts({ caseId: row.id, traceLines, log: proxyEntries, documentId: docId }))) {
    writeFileSync(join(runDirOut, name), text);
  }
  writeFileSync(join(runDirOut, "proxy-log.jsonl"), proxyRaw);
  if (docId) {
    writeJson(join(runDirOut, "server-versions.before.json"), docs.get(docId) ?? null);
    writeJson(join(runDirOut, "server-versions.json"),
      await collectServerVersions({ apiOrigin: tenant.apiOrigin, token: await ownerToken(), documentId: docId }).catch((e) => ({ ...EMPTY_SERVER_VERSIONS, documentId: docId, document_id: docId, error: e.message })));
  } else writeJson(join(runDirOut, "server-versions.json"), EMPTY_SERVER_VERSIONS);
  if (runs > 1) writeJson(join(runDirOut, "result.json"), { case: row.id, exit: run.index, ...result });
  return result;
}

export async function runAppCases({ caseId = null, runDir, casesPath = DEFAULT_CASES_PATH } = {}) {
  const { runnable, blocked } = selectAppCases(loadFaultCases(casesPath), { caseId });
  const ports = readEnvFile(harnessPaths(runDir).envFile);
  const serverEnv = readEnvFile(join(runDir, "server.env"));
  const forkSha = process.env.OFFICE_FORK_SHA?.trim() || ports.OFFICE_FORK_SHA || DEFAULT_FORK_SHA;
  const blockedResults = blocked.map(({ row, reason }) => finishCase(row, blockedCase(row, reason), join(runDir, "fault", row.id), runDir, forkSha));
  if (runnable.length === 0) return { results: [], blockedResults, exitCode: runExitCode([]) };

  // a harness that failed to start is a FAIL here too, never "no stack, so BLOCKED" (harness README)
  const gate = startGate(readStartStatus(runDir));
  if (gate.gate === "fail") {
    const failed = runResult({ assertions: [{ name: "harness_started", expected: "start.sh up", actual: gate.reason, ok: false }] });
    const results = runnable.map((row) => finishCase(row, caseResult(row, [failed]), join(runDir, "fault", row.id), runDir, forkSha));
    return { results, blockedResults, exitCode: runExitCode(results) };
  }
  const playwright = loadPlaywright();
  const blocker = await preconditions({ runDir, ports, playwright });
  if (blocker) {
    const results = runnable.map((row) => finishCase(row, blockedCase(row, blocker), join(runDir, "fault", row.id), runDir, forkSha));
    return { results, blockedResults, exitCode: runExitCode(results) };
  }
  const proxy = await startFaultProxy({ target: ports.API_ORIGIN, port: 0, logFile: join(runDir, "logs", "fault-app-proxy.jsonl") });
  try {
    const tenant = await seedAppTenant(ports.API_ORIGIN, { verificationCode: serverEnv.DEV_VERIFICATION_CODE || "123456" });
    let admin;
    const shared = {
      ports, proxy, tenant, playwright, runDir, fixtures: loadFixtures(), databaseUrl: serverEnv.DATABASE_URL || "",
      ensureAdmin: async () => {
        if (admin === undefined) {
          admin = grantPlatformAdmin({ repoRoot: REPO_ROOT, databaseUrl: serverEnv.DATABASE_URL, email: tenant.owner.email });
          // a platform role without MFA is refused every admin route (403
          // mfa_required): enrol TOTP through the product's own API, then sign in
          // again with the second factor
          if (!admin) {
            try {
              await enrollTotp(ports.API_ORIGIN, tenant.owner);
              await login(ports.API_ORIGIN, tenant.owner);
            } catch (error) {
              admin = `platform admin MFA enrolment: ${error.message}`;
            }
          }
        }
        return admin;
      },
    };
    const results = [];
    for (const row of runnable) {
      const caseDir = join(runDir, "fault", row.id);
      const runs = [...expandExits(row), ...(EXTRA_EXITS[row.id] ?? []).map((exit, i) => ({ index: (row.exits?.length ?? 0) + i + 1, label: exit.exit, exit }))];
      const runResults = [];
      for (const run of runs) {
        process.stdout.write(`${row.id}${runs.length > 1 ? ` [${run.index}/${runs.length}] ${run.label}` : ""}: running\n`);
        runResults.push(await runOne({ row, run, runs: runs.length, caseDir, shared }));
      }
      const result = finishCase(row, caseResult(row, runResults), caseDir, runDir, forkSha);
      process.stdout.write(`${row.id}: ${result.result}${result.predicted ? ` (predicted ${result.predicted})` : ""}\n`);
      // a FAIL is read from the log: its full trace and sync requests, not a truncated dump
      for (const run of runResults) for (const text of failEvidenceLines(row.id, run)) process.stdout.write(`${text}\n`);
      results.push(result);
    }
    return { results, blockedResults, exitCode: runExitCode(results) };
  } finally {
    await proxy.close();
  }
}

if (isMainModule({ moduleUrl: import.meta.url })) {
  (async () => {
    const args = parseAppCasesArgs(process.argv.slice(2));
    if (args.verifyResult) process.exit(verifyRecorded(args));
    const { results, blockedResults, exitCode } = await runAppCases(args);
    for (const r of [...results, ...blockedResults]) {
      process.stdout.write(`${r.case} (${r.ac.join(",")}): ${r.result}${r.predicted ? ` predicted ${r.predicted}` : ""}${r.blocker ? ` — ${r.blocker}` : ""}\n`);
    }
    process.stdout.write(`${join(args.runDir, "fault")}\n`);
    process.exit(exitCode);
  })().catch((error) => {
    process.stderr.write(`app-cases.mjs: ${error.message}\n`);
    process.exit(1);
  });
}
