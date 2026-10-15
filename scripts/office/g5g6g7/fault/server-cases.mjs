#!/usr/bin/env node
/* global process, Buffer, fetch, FormData, Blob */
// Server-layer fault cases runner for G7-03a (UNI-1380): runs FQ-01..FQ-13
// against the D server through the fault proxy (`./proxy.mjs`).

import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvidence } from "../evidence.mjs";
import { DEFAULT_FORK_SHA, harnessPaths, isMainModule, readStartStatus, startGate } from "../harness/lib.mjs";
import { collectServerVersions, writeServerVersions } from "./collect.mjs";
import { startFaultProxy } from "./proxy.mjs";
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
    const conversationId = res.headers.get("x-uniwork-conversation-id") || "";
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

async function registerAndVerifyUser(apiOrigin, tag) {
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const credential = `FaultPass!${suffix}`;
  const addr = `fault-${tag}-${suffix}@uniwork.test`;
  const reg = await httpJson(apiOrigin, "/api/v1/auth/register", {
    method: "POST",
    headers: { "user-agent": `UniWork-Fault-${tag}/1.0` },
    body: { email: addr, password: credential, display_name: `Fault ${tag}` },
  });
  if (reg.status !== 201) throw new Error(`register ${tag} failed: status ${reg.status}`);
  const token = reg.body?.access_token;
  const userId = reg.body?.user?.id;
  const ver = await httpJson(apiOrigin, "/api/v1/me/email/verify", { method: "POST", token, body: { code: "000000" } });
  if (ver.status !== 200) throw new Error(`verify ${tag} failed: status ${ver.status}`);
  const onb = await httpJson(apiOrigin, "/api/v1/me/onboarding/complete", { method: "POST", token, body: {} });
  if (onb.status !== 200) throw new Error(`onboarding ${tag} failed: status ${onb.status}`);
  return { userId, token, addr, credential };
}

async function seedFaultTenant(apiOrigin) {
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
  const primary = await registerAndVerifyUser(apiOrigin, "deviceA");
  const loginB = await httpJson(apiOrigin, "/api/v1/auth/login", {
    method: "POST",
    headers: { "user-agent": "UniWork-Fault-deviceB/1.0" },
    body: { email: primary.addr, password: primary.credential },
  });
  if (loginB.status !== 200) throw new Error(`login deviceB failed: status ${loginB.status}`);
  const orgRes = await httpJson(apiOrigin, "/api/v1/orgs", {
    method: "POST",
    token: primary.token,
    body: { name: `Fault Org ${suffix}`, slug: `fault-org-${suffix}` },
  });
  if (orgRes.status !== 201) throw new Error(`create org failed: status ${orgRes.status}`);
  const orgId = orgRes.body?.organization?.id;
  const wsRes = await httpJson(apiOrigin, `/api/v1/orgs/${orgId}/workspaces`, {
    method: "POST",
    token: primary.token,
    body: { name: `Fault WS ${suffix}`, slug: `fault-ws-${suffix}` },
  });
  if (wsRes.status !== 201) throw new Error(`create workspace failed: status ${wsRes.status}`);
  const workspaceId = wsRes.body?.workspace?.id;
  const memberB = await registerAndVerifyUser(apiOrigin, "memberB");

  async function ensureMemberBInWorkspace() {
    const invRes = await httpJson(apiOrigin, `/api/v1/workspaces/${workspaceId}/invitations`, {
      method: "POST",
      token: primary.token,
      body: { emails: [memberB.addr], role: "member" },
    });
    if (invRes.status !== 200) throw new Error(`invite memberB failed: status ${invRes.status}`);
    const myInvs = await httpJson(apiOrigin, "/api/v1/me/invitations", { method: "GET", token: memberB.token });
    const pending = (myInvs.body?.invitations ?? []).find((item) => item.workspace?.id === workspaceId);
    if (pending?.token) {
      const acc = await httpJson(apiOrigin, `/api/v1/invitations/${pending.token}/accept`, {
        method: "POST",
        token: memberB.token,
        body: {},
      });
      if (acc.status !== 200) throw new Error(`accept invite failed: status ${acc.status}`);
    }
  }
  await ensureMemberBInWorkspace();

  return {
    orgId,
    workspaceId,
    tokens: { deviceA: primary.token, deviceB: loginB.body?.access_token, owner: primary.token, memberB: memberB.token },
    users: { deviceA: primary.userId, memberB: memberB.userId },
    ensureMemberBInWorkspace,
  };
}

function writeCaseFiles(caseDir, { intentLog = [], beforeVersions = null, afterVersions = null, proxyLogRaw = "", caseResult }) {
  mkdirSync(caseDir, { recursive: true });
  const intentLines = intentLog.map((entry) => JSON.stringify(entry)).join("\n");
  writeFileSync(join(caseDir, "intent-log.jsonl"), intentLines ? `${intentLines}\n` : "", "utf8");
  if (beforeVersions) {
    writeFileSync(join(caseDir, "server-versions.before.json"), `${JSON.stringify(beforeVersions, null, 2)}\n`, "utf8");
  }
  const finalVersions = afterVersions ?? beforeVersions ?? { document_id: null, versions: [], next_cursor: null };
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
    const tenant = await seedFaultTenant(apiOrigin);
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

        const makeVariantBytes = (label) => Buffer.concat([fx.bytes, Buffer.from(`\n<!-- ${row.id}:${label} -->`)]);
        const ctx = {
          document: doc,
          beforeCount: beforeVersions.versions.length,
          sleep,
          newKey: (prefix) => `${prefix}-${row.id}-${crypto.randomUUID()}`,
          keyTag: (rawKey) => computeKeyTag(rawKey, driverSalt),
          uploadViaProxy: (actor, docId, { idempotencyKey, label = "v" }) =>
            httpMultipartFile(proxy.origin, `/api/v1/documents/${docId}/uploads`, {
              token: tenant.tokens[actor],
              fileBytes: makeVariantBytes(label),
              filename: basename(fx.path),
              mime: fx.mime,
              headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
            }),
          uploadDirect: (actor, docId, { idempotencyKey, label = "v" }) =>
            httpMultipartFile(apiOrigin, `/api/v1/documents/${docId}/uploads`, {
              token: tenant.tokens[actor],
              fileBytes: makeVariantBytes(label),
              filename: basename(fx.path),
              mime: fx.mime,
              headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
            }),
          commitViaProxy: (actor, docId, { idempotencyKey, uploadId, baseRevision, signal }) =>
            httpJson(proxy.origin, `/api/v1/documents/${docId}/versions/commit`, {
              method: "POST",
              token: tenant.tokens[actor],
              headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
              body: { upload_id: uploadId, base_revision: Number(baseRevision) },
              signal,
            }),
          lookupViaProxy: (actor, docId, { idempotencyKey }) =>
            httpJson(proxy.origin, `/api/v1/documents/${docId}/versions/commit`, {
              method: "GET",
              token: tenant.tokens[actor],
              headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
            }),
          getDocumentViaProxy: (actor, docId) =>
            httpJson(proxy.origin, `/api/v1/documents/${docId}`, { method: "GET", token: tenant.tokens[actor] }),
          uploadAndCommitDirect: async (actor, docId, { baseRevision, label = "direct" }) => {
            const up = await ctx.uploadDirect(actor, docId, { idempotencyKey: ctx.newKey("up-direct"), label });
            return httpJson(apiOrigin, `/api/v1/documents/${docId}/versions/commit`, {
              method: "POST",
              token: tenant.tokens[actor],
              headers: { "Idempotency-Key": ctx.newKey("commit-direct") },
              body: { upload_id: up.body?.upload_id, base_revision: Number(baseRevision) },
            });
          },
          seedFailedIntentDirect: async (actor, docId) => {
            const kA = ctx.newKey("seed-intent");
            const up = await ctx.uploadDirect(actor, docId, { idempotencyKey: ctx.newKey("up-seed"), label: "seed" });
            await httpJson(apiOrigin, `/api/v1/documents/${docId}/versions/commit`, {
              method: "POST",
              token: tenant.tokens[actor],
              headers: { "Idempotency-Key": kA },
              body: { upload_id: up.body?.upload_id, base_revision: 999999 },
            });
            return kA;
          },
          aiTurnViaProxy: (actor, docId, { prompt, conversationId = "" }) =>
            httpJson(proxy.origin, `/api/v1/documents/${docId}/ai/uniwork/chat/completions`, {
              method: "POST",
              token: tenant.tokens[actor],
              headers: conversationId ? { "X-Uniwork-Conversation-Id": conversationId } : {},
              body: { messages: [{ role: "user", content: prompt }] },
            }),
          removeWorkspaceMemberDirect: (actor) =>
            httpJson(apiOrigin, `/api/v1/workspaces/${tenant.workspaceId}/members/${tenant.users[actor]}`, {
              method: "DELETE",
              token: tenant.tokens.owner,
            }),
          archiveDocumentDirect: (docId) =>
            httpJson(apiOrigin, `/api/v1/documents/${docId}/archive`, { method: "POST", token: tenant.tokens.owner }),
          restoreAndMoveDocumentDirect: async (docId) => {
            await httpJson(apiOrigin, `/api/v1/documents/${docId}/restore`, { method: "POST", token: tenant.tokens.owner });
            const cur = await httpJson(apiOrigin, `/api/v1/documents/${docId}`, { method: "GET", token: tenant.tokens.owner });
            const folder = await httpJson(apiOrigin, `/api/v1/workspaces/${tenant.workspaceId}/documents`, {
              method: "POST",
              token: tenant.tokens.owner,
              body: { title: `Folder ${row.id} ${Date.now()}`, kind: "folder" },
            });
            const moved = await httpJson(apiOrigin, `/api/v1/documents/${docId}/move`, {
              method: "POST",
              token: tenant.tokens.owner,
              body: { parent_id: folder.body?.document?.id, revision: String(cur.body?.document?.revision ?? doc.revision) },
            });
            return { revision: moved.body?.document?.revision ?? null };
          },
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
