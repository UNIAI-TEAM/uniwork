#!/usr/bin/env node
/* global process, fetch, FormData, Blob */
// Server-layer fault cases runner for G7-03a (UNI-1380): runs FQ-01..FQ-13
// against the D server through the fault proxy (`./proxy.mjs`).

import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvidence } from "../evidence.mjs";
import { DEFAULT_FORK_SHA, harnessPaths, isMainModule, readStartStatus, startGate } from "../harness/lib.mjs";
import { EMPTY_SERVER_VERSIONS, collectServerVersions, writeServerVersions } from "./collect.mjs";
import { startFaultProxy } from "./proxy.mjs";
import { CONVERSATION_HEADER, createWireContext } from "./server-cases-wire.mjs";
import { readVerificationCode, seedFaultTenant } from "./server-cases-setup.mjs";
import {
  BLOCKED_EXIT_CODE, DEFAULT_CASES_PATH, REPO_ROOT, aggregateExitCode, assertion, buildIntentLogEntry,
  computeKeyTag, evaluateCaseResult, loadFaultCases, renderCaseRules, runServerCaseDriver, selectServerCases,
} from "./server-cases-lib.mjs";

export const DEFAULT_RUN_DIR = ".harness-run";
export {
  BLOCKED_EXIT_CODE, DEFAULT_CASES_PATH, aggregateExitCode, assertion, buildIntentLogEntry,
  computeKeyTag, evaluateCaseResult, loadFaultCases, renderCaseRules, runServerCaseDriver, selectServerCases,
};

const THIS_FILE = fileURLToPath(import.meta.url);
const FIXTURES_MANIFEST_PATH = resolve(REPO_ROOT, "docs", "office", "g5g6g7", "fixtures", "manifest.json");
const sleep = (ms) => new Promise((resolveTimer) => setTimeout(resolveTimer, ms));

export function parseServerCasesArgs(argv = [], env = process.env) {
  let caseId = null;
  let runDir = env.HARNESS_RUN_DIR?.trim() || DEFAULT_RUN_DIR;
  let casesPath = DEFAULT_CASES_PATH;
  let verifyResult = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--case") caseId = String(argv[++i] ?? "").trim();
    else if (arg.startsWith("--case=")) caseId = arg.slice("--case=".length).trim();
    else if (arg === "--run-dir") runDir = String(argv[++i] ?? "").trim();
    else if (arg.startsWith("--run-dir=")) runDir = arg.slice("--run-dir=".length).trim();
    else if (arg === "--cases-file") casesPath = resolve(String(argv[++i] ?? "").trim());
    else if (arg.startsWith("--cases-file=")) casesPath = resolve(arg.slice("--cases-file=".length).trim());
    else if (arg === "--verify-result") verifyResult = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return { caseId: caseId || null, runDir: resolve(runDir), casesPath, verifyResult };
}

function readPortsEnv(runDir) {
  const { envFile } = harnessPaths(runDir);
  if (!existsSync(envFile)) return {};
  const out = {};
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

function loadFixtureMap() {
  const manifest = JSON.parse(readFileSync(FIXTURES_MANIFEST_PATH, "utf8"));
  const map = new Map();
  for (const item of manifest.fixtures ?? []) {
    const absPath = resolve(REPO_ROOT, item.path);
    map.set(item.id, { ...item, absPath, bytes: readFileSync(absPath) });
  }
  return map;
}

function parseJsonOrRaw(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function httpJson(origin, path, { method = "GET", token, headers = {}, body, signal } = {}) {
  const reqHeaders = { accept: "application/json", ...headers };
  if (token) reqHeaders.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    reqHeaders["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  try {
    const res = await fetch(`${origin}${path}`, { method, headers: reqHeaders, body: payload, signal });
    const parsed = parseJsonOrRaw(await res.text());
    const conversationId = res.headers.get(CONVERSATION_HEADER) || "";
    return { ok: res.ok, status: res.status, body: parsed, conversationId, dropped: false, aborted: false };
  } catch (error) {
    const isAbort = error?.name === "AbortError" || Boolean(signal?.aborted);
    return { ok: false, status: isAbort ? "aborted" : "dropped", body: null, conversationId: "", dropped: true, aborted: isAbort };
  }
}

async function httpMultipartFile(origin, path, { token, fileBytes, filename, mime, fields = {}, headers = {} }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) form.set(k, String(v));
  }
  form.set("file", new Blob([fileBytes], { type: mime || "application/octet-stream" }), filename);
  const reqHeaders = { accept: "application/json", ...headers };
  if (token) reqHeaders.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${origin}${path}`, { method: "POST", headers: reqHeaders, body: form });
    return { ok: res.ok, status: res.status, body: parseJsonOrRaw(await res.text()), dropped: false };
  } catch {
    return { ok: false, status: "dropped", body: null, dropped: true };
  }
}

function writeCaseFiles(caseDir, { intentLog = [], beforeVersions = null, afterVersions = null, proxyLogRaw = "", caseResult }) {
  mkdirSync(caseDir, { recursive: true });
  const intentLines = intentLog.map((entry) => JSON.stringify(entry)).join("\n");
  writeFileSync(join(caseDir, "intent-log.jsonl"), intentLines ? `${intentLines}\n` : "", "utf8");
  if (beforeVersions) {
    writeFileSync(join(caseDir, "server-versions.before.json"), `${JSON.stringify(beforeVersions, null, 2)}\n`, "utf8");
  }
  const finalVersions = afterVersions ?? beforeVersions ?? EMPTY_SERVER_VERSIONS;
  writeFileSync(join(caseDir, "server-versions.json"), `${JSON.stringify(finalVersions, null, 2)}\n`, "utf8");
  writeFileSync(join(caseDir, "proxy-log.jsonl"), proxyLogRaw, "utf8");
  const serializedResult = `${JSON.stringify(caseResult, null, 2)}\n`;
  writeFileSync(join(caseDir, "result.json"), serializedResult, "utf8");
  writeFileSync(join(caseDir, "case-result.json"), serializedResult, "utf8");
}

function emitCaseEvidence(caseRow, caseDir, runDir, forkSha, env = process.env) {
  if (env.OFFICE_EVIDENCE_ID) return;
  const outDir = env.OFFICE_EVIDENCE_OUT?.trim() ? resolve(env.OFFICE_EVIDENCE_OUT.trim()) : runDir;
  for (const ac of caseRow.ac ?? []) {
    try {
      runEvidence({
        requirementId: ac,
        fixtureId: caseRow.fixture,
        checker: `fault:${caseRow.id}`,
        command: [process.execPath, THIS_FILE, "--case", caseRow.id, "--run-dir", runDir, "--verify-result"],
        outDir,
        artifact: join(caseDir, `evidence-${ac.toLowerCase()}.log`),
        env: { ...env, OFFICE_FORK_SHA: env.OFFICE_FORK_SHA?.trim() || forkSha || DEFAULT_FORK_SHA },
      });
    } catch {
      // Evidence ledger errors must not abort remaining cases.
    }
  }
}

function verifyRecordedCaseResult({ caseId, runDir }) {
  const resultFile = join(runDir, "fault", String(caseId || ""), "result.json");
  if (!existsSync(resultFile)) {
    process.stdout.write(`skip: missing result.json for ${caseId}\n`);
    return BLOCKED_EXIT_CODE;
  }
  const data = JSON.parse(readFileSync(resultFile, "utf8"));
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  if (data.result === "PASS") return 0;
  if (data.result === "BLOCKED") return BLOCKED_EXIT_CODE;
  return 1;
}

export async function runSelectedServerCases({ caseId = null, runDir, casesPath = DEFAULT_CASES_PATH, env = process.env } = {}) {
  const casesDoc = loadFaultCases(casesPath);
  const selected = selectServerCases(casesDoc, { caseId });
  const portsEnv = readPortsEnv(runDir);
  const apiOrigin = env.API_ORIGIN?.trim() || portsEnv.API_ORIGIN || "";
  const forkSha = env.OFFICE_FORK_SHA?.trim() || portsEnv.OFFICE_FORK_SHA || DEFAULT_FORK_SHA;
  const gate = startGate(readStartStatus(runDir));

  let preconditionBlocker = null;
  if (!apiOrigin) {
    preconditionBlocker = gate.reason || `missing API_ORIGIN in ${harnessPaths(runDir).envFile}`;
  } else {
    const health = await httpJson(apiOrigin, "/healthz");
    if (!health.ok) preconditionBlocker = `server /healthz unreachable at ${apiOrigin} (${health.status})`;
  }

  if (preconditionBlocker) {
    const blockedResults = [];
    for (const row of selected) {
      const caseDir = join(runDir, "fault", row.id);
      const caseResult = evaluateCaseResult({
        caseId: row.id,
        ac: row.ac,
        assertions: [assertion("harness_up", "up", preconditionBlocker, false)],
        blockedReason: preconditionBlocker,
      });
      writeCaseFiles(caseDir, { caseResult });
      emitCaseEvidence(row, caseDir, runDir, forkSha, env);
      blockedResults.push(caseResult);
    }
    return { results: blockedResults, exitCode: aggregateExitCode(blockedResults) };
  }

  const fixtures = loadFixtureMap();
  const proxy = await startFaultProxy({
    target: apiOrigin,
    port: 0,
    logFile: join(runDir, "logs", "fault-server-proxy.jsonl"),
  });
  const driverSalt = crypto.randomBytes(16).toString("hex");

  try {
    const tenant = await seedFaultTenant({
      http: httpJson,
      apiOrigin,
      verificationCode: readVerificationCode(runDir, env),
    });
    const results = [];
    for (const row of selected) {
      const caseDir = join(runDir, "fault", row.id);
      try {
        await tenant.ensureMemberBInWorkspace();
        const fx = fixtures.get(row.fixture);
        if (!fx) throw new Error(`missing fixture ${row.fixture}`);
        const created = await httpMultipartFile(apiOrigin, `/api/v1/workspaces/${tenant.workspaceId}/documents/files`, {
          token: tenant.tokens.owner,
          fileBytes: fx.bytes,
          filename: basename(fx.path),
          mime: fx.mime,
          fields: { title: `${row.id} ${basename(fx.path)}` },
        });
        if (created.status !== 201 || !created.body?.document?.id) {
          throw new Error(`create document for ${row.id} failed: status ${created.status}`);
        }
        const doc = created.body.document;
        const beforeVersions = await collectServerVersions({ apiOrigin, token: tenant.tokens.owner, documentId: doc.id });

        await httpJson(proxy.origin, "/__fault/rules", { method: "DELETE" });
        await httpJson(proxy.origin, "/__fault/log", { method: "DELETE" });
        const renderedRules = renderCaseRules(row, { documentId: doc.id });
        if (renderedRules.length > 0) {
          await httpJson(proxy.origin, "/__fault/rules", { method: "POST", body: renderedRules });
        }

        const newKey = (prefix) => `${prefix}-${row.id}-${crypto.randomUUID()}`;
        const wire = createWireContext({
          http: httpJson,
          multipart: httpMultipartFile,
          apiOrigin,
          proxyOrigin: proxy.origin,
          tenant,
          doc,
          caseId: row.id,
          fixture: { bytes: fx.bytes, mime: fx.mime, filename: basename(fx.path) },
          newKey,
        });
        const ctx = {
          document: doc,
          beforeCount: beforeVersions.versions.length,
          sleep,
          newKey,
          keyTag: (rawKey) => computeKeyTag(rawKey, driverSalt),
          ...wire,
          waitForRuleHeld: async (ruleId, timeoutMs = 4000) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
              const rulesRes = await httpJson(proxy.origin, "/__fault/rules");
              const found = (rulesRes.body ?? []).find((r) => r.id === ruleId);
              if ((found?.held ?? 0) >= 1) {
                await sleep(25);
                return found;
              }
              await sleep(15);
            }
            return null;
          },
          releaseRule: async (ruleId) => {
            const rel = await httpJson(proxy.origin, `/__fault/release/${encodeURIComponent(ruleId)}`, { method: "POST" });
            return rel.body;
          },
          waitForProxyLogCount: async (predicate, minCount, timeoutMs = 4000) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
              const res = await fetch(`${proxy.origin}/__fault/log`);
              const raw = await res.text();
              const entries = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
              if (entries.filter(predicate).length >= minCount) return entries;
              await sleep(20);
            }
            return [];
          },
          collectVersions: (docId) => collectServerVersions({ apiOrigin, token: tenant.tokens.owner, documentId: docId }),
          collectCaseEnd: async (docId) => {
            const { payload: afterVersions } = await writeServerVersions({
              apiOrigin,
              token: tenant.tokens.owner,
              documentId: docId,
              outDir: caseDir,
            });
            const logRes = await fetch(`${proxy.origin}/__fault/log`);
            const proxyLogRaw = await logRes.text();
            const proxyLog = proxyLogRaw
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => JSON.parse(line));
            return {
              afterVersions,
              versionDelta: afterVersions.versions.length - beforeVersions.versions.length,
              proxyLog,
              proxyLogRaw,
            };
          },
        };

        const outcome = await runServerCaseDriver(row, ctx);
        const caseResult = evaluateCaseResult({ caseId: row.id, ac: row.ac, assertions: outcome.assertions });
        writeCaseFiles(caseDir, {
          intentLog: outcome.intentLog,
          beforeVersions,
          afterVersions: outcome.afterVersions,
          proxyLogRaw: outcome.proxyLogRaw,
          caseResult,
        });
        emitCaseEvidence(row, caseDir, runDir, forkSha, env);
        results.push(caseResult);
      } catch (error) {
        const caseResult = evaluateCaseResult({
          caseId: row.id,
          ac: row.ac,
          assertions: [assertion("case_execution", "no unhandled exception", error.message, false)],
        });
        writeCaseFiles(caseDir, { caseResult });
        emitCaseEvidence(row, caseDir, runDir, forkSha, env);
        results.push(caseResult);
      }
    }
    return { results, exitCode: aggregateExitCode(results) };
  } finally {
    await proxy.close();
  }
}

if (isMainModule({ moduleUrl: import.meta.url })) {
  (async () => {
    const args = parseServerCasesArgs(process.argv.slice(2), process.env);
    if (args.verifyResult) process.exit(verifyRecordedCaseResult(args));
    const { results, exitCode } = await runSelectedServerCases(args);
    for (const r of results) process.stdout.write(`${r.case} (${r.ac.join(",")}): ${r.result}\n`);
    process.exit(exitCode);
  })().catch((error) => {
    process.stderr.write(`server-cases.mjs: ${error.message}\n`);
    process.exit(1);
  });
}
