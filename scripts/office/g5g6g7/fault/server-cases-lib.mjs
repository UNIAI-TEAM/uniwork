// Pure logic of the G7-03a server-layer fault cases (UNI-1380): row selection, rule rendering, intent-log
// entries and result aggregation. The case drivers are server-case-drivers.mjs.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripQuery, validateRules } from "./rules.mjs";

const THIS_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
export const REPO_ROOT = resolve(THIS_DIR, "..", "..", "..", "..");
export const DEFAULT_CASES_PATH = resolve(REPO_ROOT, "docs", "office", "g5g6g7", "fault", "cases.json");
export const BLOCKED_EXIT_CODE = 77;

export function loadFaultCases(casesPath = DEFAULT_CASES_PATH) {
  return JSON.parse(readFileSync(casesPath, "utf8"));
}

export function selectServerCases(casesDoc, { caseId } = {}) {
  const allCases = Array.isArray(casesDoc?.cases) ? casesDoc.cases : [];
  const serverReady = allCases.filter((row) => row.layer === "server" && row.status === "ready");
  if (!caseId) return serverReady;
  const target = String(caseId).trim();
  const match = serverReady.find((row) => row.id === target);
  if (!match) throw new Error(`unknown or non-ready server fault case "${target}"`);
  return [match];
}

function escapeRegexLiteral(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveExitLookup(caseRow, { exit, exitIndex } = {}) {
  const chosen = exit ?? (Array.isArray(caseRow?.exits) ? caseRow.exits[exitIndex ?? 0] : null);
  const lookup = chosen?.lookup;
  if (!lookup || !Number.isInteger(lookup.code) || typeof lookup.errorCode !== "string" || !lookup.errorCode) {
    throw new Error(`case ${caseRow?.id ?? "(unknown)"} rule requires per-exit lookup { code, errorCode }`);
  }
  return lookup;
}

export function renderCaseRules(caseRow, { documentId, exit, exitIndex } = {}) {
  const rawRules = Array.isArray(caseRow?.proxyRules) ? caseRow.proxyRules : [];
  const rendered = rawRules.map((rule) => {
    const rawMatch = rule?.match ?? {};
    let pathPattern = String(rawMatch.path ?? "");
    if (documentId) {
      const escapedDocId = escapeRegexLiteral(documentId);
      pathPattern = pathPattern.replaceAll("<id>", escapedDocId).replaceAll("<documentId>", escapedDocId);
    }
    const match = {
      ...(rawMatch.method ? { method: String(rawMatch.method).toUpperCase() } : {}),
      path: pathPattern,
      ...(rawMatch.nth !== undefined && rawMatch.nth !== null ? { nth: rawMatch.nth } : {}),
    };
    const rawAction = rule?.action ?? {};
    let action;
    if (rawAction.type === "status" && rawAction.code === "per-exit") {
      const lookup = resolveExitLookup(caseRow, { exit, exitIndex });
      action = {
        type: "status",
        code: lookup.code,
        body: { error: { code: lookup.errorCode, ...(lookup.fields ? { fields: lookup.fields } : {}) } },
      };
    } else {
      action = {
        type: rawAction.type,
        ...(rawAction.ms !== undefined ? { ms: rawAction.ms } : {}),
        ...(rawAction.code !== undefined ? { code: rawAction.code } : {}),
        ...(rawAction.body !== undefined ? { body: structuredClone(rawAction.body) } : {}),
        ...(rawAction.until !== undefined ? { until: rawAction.until } : {}),
        ...(rawAction.patch !== undefined ? { patch: structuredClone(rawAction.patch) } : {}),
      };
    }
    return {
      id: rule.id,
      match,
      action,
      ...(rule.once !== undefined ? { once: Boolean(rule.once) } : {}),
    };
  });
  validateRules(rendered);
  return rendered;
}

export function computeKeyTag(rawKey, salt = "fault-driver-salt") {
  if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) return null;
  return crypto.createHmac("sha256", salt).update(rawKey.trim()).digest("hex").slice(0, 12);
}

export function buildIntentLogEntry({
  caseId,
  step,
  intent = "intent-1",
  keyTag = null,
  attempt = 1,
  from = null,
  to = null,
  event = step,
  status = null,
  outcome = null,
  reason = null,
  http = null,
  note = null,
  ts = new Date().toISOString(),
}) {
  return {
    ts,
    case: caseId,
    source: "driver",
    step,
    intent,
    keyTag: keyTag ?? null,
    attempt,
    from,
    to,
    event,
    status,
    outcome,
    reason,
    http: http
      ? {
          method: String(http.method || "GET").toUpperCase(),
          path: stripQuery(http.path || "/"),
          status: http.status ?? null,
          code: http.code ?? null,
        }
      : null,
    note,
  };
}

export function assertion(name, expected, actual, ok) {
  return { name, expected, actual, ok: Boolean(ok) };
}

export function evaluateCaseResult({ caseId, ac = [], assertions = [], blockedReason = null }) {
  if (blockedReason) {
    return { case: caseId, ac: [...ac], result: "BLOCKED", blocker: String(blockedReason), assertions };
  }
  const allOk = assertions.length > 0 && assertions.every((item) => item.ok === true);
  return { case: caseId, ac: [...ac], result: allOk ? "PASS" : "FAIL", assertions };
}

export function aggregateExitCode(caseResults = []) {
  if (!Array.isArray(caseResults) || caseResults.length === 0) return BLOCKED_EXIT_CODE;
  const statuses = caseResults.map((item) => item?.result);
  if (statuses.includes("FAIL")) return 1;
  if (statuses.every((s) => s === "PASS")) return 0;
  return BLOCKED_EXIT_CODE;
}
