#!/usr/bin/env node
/**
 * UNI-670 / DOC-006 - UniWork Office G0 evidence-register verifier (r2).
 *
 * Usage (from the repository root, Node 22):
 *
 *   node scripts/office-g0/verify-evidence.mjs --registry docs/office/g0/evidence-register.json --root . [--artifacts <dir>]... [--require-go] [--no-artifacts] [--json]
 *
 * Exit codes:
 *   0  the register is valid; with --require-go the G0 decision is GO
 *   1  the register is invalid, or --require-go was asked for and the G0
 *      decision is NO-GO
 *   2  usage error, unreadable register or unreadable artifact root
 *
 * Decisions are kept apart on purpose:
 *
 *   valid         the register is internally consistent: no duplicate ids, no
 *                 malformed or unknown status/level, no impossible platform
 *                 deferral, every required gate present with its rows,
 *                 provenance bound to the recorded baseline, structured
 *                 artifacts for every accepted row, and no contradicting row
 *                 (a retargeted format/kind/operation, a weakened required
 *                 floor, a shared or out-of-role artifact identity, a
 *                 mislabeled authorization claim). A coverage *shortfall* (a
 *                 missing assertion, case, artifact or browser) is a warning:
 *                 it keeps the register valid and the gate unsatisfied, so an
 *                 honest, complete NO-GO register is *valid*.
 *
 *   go            every required G0 gate is satisfied by accepted rows at or
 *                 above the gate level, operation evidence, required
 *                 assertions, the Orca embedded browser on Windows (the G0
 *                 browser decision of 2026-09-25) and every required case.
 *                 It never depends on the self-declared Q1-B counts.
 *
 *   q1bSatisfied  Q1-B pilot capability coverage (95/95 web and desktop).
 *   pilotReady    a separate human pilot decision; reported, never a G0 gate.
 *
 * reportStatus is COMPLETE when every required gate reached a terminal state
 * (satisfied / failed / deferred) and INCOMPLETE while any required gate is
 * still pending, so evidence completeness stays separate from go/no-go.
 *
 * Nothing here promotes a low evidence class to a higher one: a source read,
 * a generated fixture, a modeled authorization or a declared PASS can never
 * satisfy a browser, real-adapter or product-E2E requirement. The verifier
 * checks an attested test record; it cannot prove a human ran a command.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const SCHEMA_KIND = "uniwork-office-evidence-register";
export const SCHEMA_VERSION = 1;

/** Evidence levels, weakest first. A row may only claim a level its own
 *  operation evidence can actually reach (see classifyRow). */
export const LEVELS = [
  "source-read",
  "fixture-generation",
  "modeled",
  "harness",
  "engine-round-trip",
  "browser-real",
  "product-e2e",
];
export const LEVEL_ORDER = Object.fromEntries(LEVELS.map((name, index) => [name, index]));

export const STATUSES = ["PASS", "FAIL", "BLOCKED", "PENDING", "NOT_APPLICABLE"];
export const RESULTS = ["pass", "fail", "blocked"];
export const PROVIDES = [
  "source-inspection",
  "inventory",
  "fixture-generation",
  "modeled-statement",
  "contract-model",
  "engine-operation",
  "editor-cycle",
  "product-e2e",
  "independent-verification",
];
export const OPERATION_EVIDENCE = [
  "source-inspection",
  "fixture-generated-operation",
  "modeled-operation",
  "byte-verified-operation",
  "real-adapter-operation",
];
export const OPERATION_ORDER = Object.fromEntries(
  OPERATION_EVIDENCE.map((name, index) => [name, index]),
);
export const ADAPTER_KINDS = ["real", "model", "mock", "none"];
/** Adapter strength, weakest first. A real adapter satisfies a modeled floor;
 *  a modeled adapter never satisfies a real floor. */
export const ADAPTER_ORDER = { none: 0, mock: 1, model: 2, real: 3 };
export const UI_KINDS = ["real-editor", "launch", "none"];
export const BROWSER_FAMILIES = ["chrome", "edge", "chromium", "safari", "firefox", "orca"];
/** The Orca embedded browser (Chromium): the only browser a required G0
 *  core-cycle gate accepts, per the user decision of 2026-09-25 (g115). */
export const ORCA_EMBEDDED_BROWSER = "orca";
export const BROWSER_PLATFORMS = ["windows", "macos", "linux"];
/** QA-01 / UNI-671: only the approved real-device QA deferral is legitimate. */
export const DEFERRABLE_PLATFORMS = ["macos"];
export const REQUIRED_FORMATS = ["docx", "xlsx", "pptx", "pdf", "md", "html"];
export const REQUIRED_GATE_KINDS = [
  "core-cycle",
  "doc004-fault",
  "doc005-mandatory",
];
export const DECISIONS = ["GO", "NO-GO"];
export const PILOT_STATUSES = ["pending", "not-assessed", "blocked", "ready", "rejected"];
/** G0 browser decision of 2026-09-25 (g115): every required core-cycle gate
 *  is satisfied by a row run in the Orca embedded browser (Chromium) on
 *  Windows. This constant stays the authoritative coverage list; a register
 *  that still declares another scope only warns (gate-browser-scope-stale). */
export const REQUIRED_GATE_BROWSERS = [
  { os: "windows", browser: ORCA_EMBEDDED_BROWSER },
];
/** The installed-browser pairs that were required before the 2026-09-25
 *  decision and are now a recorded later-phase deferral (UNI-671). They are
 *  reported, never required, and never substitute for an Orca row. */
export const DEFERRED_GATE_BROWSERS = [
  { os: "windows", browser: "chrome" },
  { os: "windows", browser: "edge" },
  { os: "macos", browser: "safari" },
];
/** Browser-cycle contract strings a core row's protocolVersion may name: the
 *  real, readable-back contract the lab adapter implements (CONTRACT-v1
 *  section 2). An invented name or a version nobody implemented is not
 *  provenance and is reported as unknown-protocol-provenance. */
export const MANIFEST_FIXTURE_ID_PATTERN = /^F-[A-Z0-9][A-Z0-9-]*$/;
/** Accepted browser-cycle contract strings ... */
export const ACCEPTED_BROWSER_BRIDGE_CONTRACTS = ["uniwork-office-lab-bridge@1"];
/** Structured artifact roles distinguish a report from real cycle evidence. */
export const ARTIFACT_ROLES = [
  "report",
  "transcript",
  "immutable-input",
  "persisted-output",
  "reopened-output",
  "render-evidence",
  "extraction-evidence",
  "pre-edit-extraction",
  "post-edit-extraction",
  "pre-edit-render",
  "post-edit-render",
];
/** Roles that are the changed output or independent evidence of a cycle. */
export const CYCLE_OUTPUT_ROLES = ["persisted-output", "render-evidence", "extraction-evidence"];
export const INDEPENDENT_ROLES = [
  "extraction-evidence",
  "post-edit-extraction",
  "render-evidence",
  "post-edit-render",
];
export const MIN_REQUIRED_ARTIFACTS = 2;

/** Every accepted core cycle needs these roles: the immutable input and the
 *  persisted output. A report/transcript of the run and independent evidence
 *  (a render or an extraction) are also required, each as its own identity. */
export const REQUIRED_CORE_ROLES = ["immutable-input", "persisted-output"];
export const REQUIRED_CORE_REPORT_ROLES = ["report", "transcript"];
/** The ref every artifact of a core row must carry: fixture/format/operation. */
export function coreArtifactRef(fixture, format, operationId) {
  return String(fixture) + "/" + String(format) + "/" + String(operationId);
}

/** DOC-005 splits into two honest halves. These cases carry real durable local
 *  draft bytes and need a byte-verified store artifact plus a fresh-store
 *  recovery assertion. The remaining cases stay a labeled reference model for
 *  remote auth, version and commit semantics; G0 never claims a real product
 *  backend for them. */
export const DRAFT_PERSISTENCE_CASES = [
  "logout-restart-drafts",
  "account-b-cannot-read-or-send-a-draft",
  "a-loses-rights",
  "failed-commit-preserves-head",
];
/** Assertion a persistence case row must record as passed: the draft bytes were
 *  read back from a freshly opened store, not from the in-memory model. */
export const RECOVERY_ASSERTION_ID = "draft-recovered-from-fresh-store";
/** Explicit provenance for the cases that stay modeled. */
export const AUTH_MODE_MODELED = "modeled";

/** The strongest level a claim of this kind can support by itself. */
const MAX_LEVEL_FOR = {
  "source-inspection": "source-read",
  inventory: "source-read",
  "fixture-generation": "fixture-generation",
  "modeled-statement": "modeled",
  "contract-model": "harness",
  "independent-verification": "engine-round-trip",
  "engine-operation": "engine-round-trip",
  "editor-cycle": "browser-real",
  "product-e2e": "product-e2e",
};

export const USAGE = [
  "Usage: node scripts/office-g0/verify-evidence.mjs --registry <file> --root <dir> [...]",
  "         [--require-go] [--no-artifacts] [--json]",
  "",
  "  --registry <file>   evidence register JSON (required)",
  "  --root <dir>        repository root; its docs/office/g0/fixtures/manifest.json is read for fixture ids",
  "  --fixture-manifest  explicit fixture manifest to check row fixture ids against",
  "  --root <dir>        repository/artifact root an artifact path may resolve under",
  "                      (repeatable; required unless --no-artifacts)",
  "  --artifacts <dir>   alias of --root for a lab artifact root",
  "  --require-go        exit non-zero while the required gates are not satisfied",
  "  --no-artifacts      validate structure and gates only; skip artifact bytes",
  "  --json              machine-readable result on stdout",
].join(String.fromCharCode(10));

const NL = String.fromCharCode(10);
const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";
const isSha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
const isCommit = (value) => typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
const shaOf = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
export const sha256Of = shaOf;

/** Assertions that must all be present and passing for a required core gate.
 *  These come from the plan task 3 minimum table, not from prose matching. */
export const REQUIRED_ASSERTIONS = {
  docx: ["text-changed", "table-preserved", "image-preserved", "reopen-fresh-session"],
  xlsx: [
    "cell-value-changed",
    "formula-recalculated-numeric",
    "formula-expected-value",
    "sheet-structure-preserved",
    "reopen-fresh-session",
  ],
  pptx: [
    "text-changed",
    "image-changed",
    "shape-changed",
    "objects-preserved",
    "reopen-fresh-session",
  ],
  pdf: [
    "text-changed",
    "image-changed",
    "pre-edit-extraction",
    "post-edit-extraction",
    "pre-edit-render",
    "post-edit-render",
    "annotation-not-substituted",
    "page-structure-preserved",
  ],
  md: ["source-changed", "assets-resolve", "table-preserved-unrendered", "reopen-fresh-session"],
  html: [
    "source-changed",
    "assets-resolve",
    "preview-isolated",
    "session-read-refused",
    "reopen-fresh-session",
  ],
};
/** Canonical operation ids a required core gate will accept. A row retargeted
 *  to another operation or to a viewer/annotation operation does not qualify. */
export const REQUIRED_OPERATION_IDS = {
  docx: ["open-edit-text-save-reopen"],
  xlsx: ["open-edit-cell-recalculate-save-reopen"],
  pptx: ["edit-text-image-shape-save-reopen"],
  pdf: ["replace-text-and-image-save-reopen"],
  md: ["edit-source-save-reopen"],
  html: ["edit-source-save-reopen-isolated-preview"],
};
export const FORBIDDEN_OPERATION_MARKERS = [
  "viewer",
  "annotation",
  "view-only",
  "launch",
  "read-only",
  "preview-only",
];
export const EDIT_OPERATION_MARKERS = ["edit", "replace", "recalc", "recalculate", "insert", "modify"];

/** Canonical contract case lists from the plan task 4.4 / task 5 tables. */
export const REQUIRED_FAULT_CASES = [
  "type-version-mismatch",
  "malformed-result",
  "checksum-mismatch",
  "timeout",
  "cancel-complete-race",
  "crash-restart",
  "metadata-access-engine-down",
];
export const REQUIRED_MANDATORY_CASES = [
  "same-base-saves",
  "retry-same-payload",
  "same-key-different-payload",
  "lost-commit-reply",
  "failed-commit-preserves-head",
  "logout-restart-drafts",
  "account-b-cannot-read-or-send-a-draft",
  "a-loses-rights",
  "a-base-changed",
  "quota-exhaustion",
  "revoke-during-upload-commit",
  "work-product-copy-rights",
  "tombstone",
  "expired-cursor",
  "client-engine-mismatch",
  "expired-reused-token",
  "expired-reused-code",
];
export const FORBIDDEN_ASSERTION_IDS = ["annotation", "viewer", "view-only", "viewer-only", "launch", "preview-only"];
export const REQUIRED_CASES_FOR_KIND = {
  "doc004-fault": REQUIRED_FAULT_CASES,
  "doc005-mandatory": REQUIRED_MANDATORY_CASES,
};
/** Canonical floors for required gate kinds, owned by the verifier; a register
 *  cannot lower them by declaring a weaker value or omitting the field. */
export const CANONICAL_GATE_LEVELS = {
  "core-cycle": "browser-real",
  "doc004-fault": "harness",
  "doc005-mandatory": "harness",
};
export const CANONICAL_GATE_ADAPTERS = {
  "core-cycle": "real",
  "doc004-fault": "real",
  "doc005-mandatory": "model",
};
export const CANONICAL_GATE_OPERATION_EVIDENCE = {
  "core-cycle": "byte-verified-operation",
  "doc004-fault": "real-adapter-operation",
  "doc005-mandatory": "modeled-operation",
};
export const CANONICAL_GATE_PROVIDES = {
  "core-cycle": ["editor-cycle"],
  "doc004-fault": ["contract-model"],
  "doc005-mandatory": ["contract-model"],
};

/**
 * Return { allowed, reason, evidenceLevel, browserCycle } for a row's own
 * claimed evidence class. allowed: false means the row contradicts itself:
 * it claims a level its operation evidence, adapter, browser or UI kind
 * cannot reach, so no gate may count it.
 */
export function classifyRow(row) {
  const declaredLevel = LEVELS.includes(row?.level) ? row.level : null;
  const provides = Array.isArray(row?.provides)
    ? row.provides.filter((entry) => PROVIDES.includes(entry))
    : [];
  const operationEvidence = OPERATION_EVIDENCE.includes(row?.operationEvidence)
    ? row.operationEvidence
    : null;
  const adapter = row?.adapter;
  const uiKind = row?.uiKind;
  const platform = isPlainObject(row?.platform) ? row.platform : {};
  const claimsBrowserCycle =
    provides.includes("editor-cycle") ||
    provides.includes("product-e2e") ||
    row?.kind === "core-cycle" ||
    row?.kind === "product-e2e" ||
    declaredLevel === "browser-real" ||
    declaredLevel === "product-e2e";

  if (claimsBrowserCycle) {
    if (declaredLevel === null || LEVEL_ORDER[declaredLevel] < LEVEL_ORDER["browser-real"]) {
      return { allowed: false, reason: "browser-cycle-requires-browser-real-level", browserCycle: true };
    }
    if (adapter !== "real") {
      return { allowed: false, reason: "browser-cycle-requires-real-adapter", browserCycle: true };
    }
    if (operationEvidence !== "byte-verified-operation") {
      return { allowed: false, reason: "browser-cycle-requires-byte-verified-operation", browserCycle: true };
    }
    if (!UI_KINDS.includes(uiKind)) {
      return { allowed: false, reason: "browser-cycle-requires-ui-kind", browserCycle: true };
    }
    if (uiKind !== "real-editor") {
      return { allowed: false, reason: "browser-launch-is-not-an-editor-cycle", browserCycle: true };
    }
    if (!BROWSER_PLATFORMS.includes(platform.os)) {
      return { allowed: false, reason: "browser-cycle-requires-real-os", browserCycle: true };
    }
    if (!BROWSER_FAMILIES.includes(platform.browser)) {
      return { allowed: false, reason: "browser-cycle-requires-real-browser-family", browserCycle: true };
    }
    if (!isNonEmptyString(platform.browserVersion)) {
      return { allowed: false, reason: "browser-cycle-requires-browser-version", browserCycle: true };
    }
    // The embedded Chromium version alone does not identify the Orca
    // application that ran the cycle (G0 decision of 2026-09-25).
    if (platform.browser === ORCA_EMBEDDED_BROWSER && !isNonEmptyString(platform.orcaVersion)) {
      return { allowed: false, reason: "orca-cycle-requires-orca-version", browserCycle: true };
    }
    if (!isNonEmptyString(row?.runtime?.node) && !isNonEmptyString(row?.runtime?.electron)) {
      return { allowed: false, reason: "browser-cycle-requires-runtime-provenance", browserCycle: true };
    }
    return { allowed: true, reason: null, evidenceLevel: declaredLevel, browserCycle: true };
  }

  if (provides.includes("engine-operation")) {
    if (declaredLevel === null || LEVEL_ORDER[declaredLevel] < LEVEL_ORDER["engine-round-trip"]) {
      return { allowed: false, reason: "engine-operation-requires-engine-round-trip", browserCycle: false };
    }
    if (adapter !== "real") {
      return { allowed: false, reason: "engine-operation-requires-real-adapter", browserCycle: false };
    }
    if (operationEvidence === null || OPERATION_ORDER[operationEvidence] < OPERATION_ORDER["fixture-generated-operation"]) {
      return { allowed: false, reason: "engine-operation-requires-operation-evidence", browserCycle: false };
    }
    if (!isNonEmptyString(row?.engine?.name) || !isNonEmptyString(row?.engine?.version)) {
      return { allowed: false, reason: "engine-operation-requires-engine-provenance", browserCycle: false };
    }
    return { allowed: true, reason: null, evidenceLevel: declaredLevel, browserCycle: false };
  }

  const caps = provides.map((entry) => LEVEL_ORDER[MAX_LEVEL_FOR[entry]]);
  const maxLevel = caps.length ? Math.max(...caps) : LEVEL_ORDER["source-read"];
  if (declaredLevel === null) {
    return { allowed: false, reason: "row-requires-known-level", browserCycle: false };
  }
  if (LEVEL_ORDER[declaredLevel] > maxLevel) {
    return { allowed: false, reason: "level-exceeds-evidence", browserCycle: false };
  }
  return { allowed: true, reason: null, evidenceLevel: declaredLevel, browserCycle: false };
}
/** Normalise and check containment without touching the file system. */
export function isContained(root, candidate, options = {}) {
  const caseInsensitive =
    typeof options.caseInsensitive === "boolean"
      ? options.caseInsensitive
      : process.platform === "win32";
  let resolvedRoot = path.resolve(root);
  let resolvedCandidate = path.resolve(candidate);
  if (caseInsensitive) {
    resolvedRoot = resolvedRoot.toLowerCase();
    resolvedCandidate = resolvedCandidate.toLowerCase();
  }
  if (resolvedCandidate === resolvedRoot) return true;
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  return resolvedCandidate.startsWith(prefix);
}

/**
 * Resolve an artifact path against explicitly supplied roots.
 * Rejects absolute paths, traversal outside every root, and junction/symlink
 * escapes (realpath is compared against the root's realpath).
 */
export function resolveArtifactPath(roots, artifactPath) {
  const raw = String(artifactPath ?? "").trim();
  if (raw === "") {
    return { ok: false, code: "artifact-path-invalid", message: "artifact path is empty" };
  }
  const normalised = raw.split("\\").join("/");
  if (normalised.startsWith("/") || /^[a-zA-Z]:/.test(normalised)) {
    return {
      ok: false,
      code: "artifact-path-absolute",
      message: "artifact path must be relative to an artifact root: " + raw,
    };
  }
  let sawEscape = false;
  let sawMissing = false;
  for (const root of roots) {
    const candidate = path.resolve(root.real, normalised);
    let realCandidate;
    try {
      realCandidate = fs.realpathSync(candidate);
    } catch {
      sawMissing = true;
      continue;
    }
    if (!isContained(root.real, realCandidate)) {
      sawEscape = true;
      continue;
    }
    return { ok: true, code: null, message: null, root: root.given, absolute: realCandidate };
  }
  if (sawEscape) {
    return {
      ok: false,
      code: "artifact-path-escapes-root",
      message:
        "artifact path resolves outside every supplied root (traversal or junction/symlink escape): " + raw,
    };
  }
  if (sawMissing) {
    return {
      ok: false,
      code: "artifact-missing",
      message: "artifact not found under any supplied root: " + raw,
    };
  }
  return { ok: false, code: "artifact-root-missing", message: "no artifact root could be resolved for: " + raw };
}

/**
 * Every accepted row's artifacts, normalised. The structured shape is the
 * only accepted one; acceptance requires a role, a path, byte size and hash.
 */
export function rowArtifacts(row) {
  const list = Array.isArray(row?.artifacts) ? row.artifacts : [];
  return list
    .filter((entry) => isPlainObject(entry) && isNonEmptyString(entry.path))
    .map((entry) => ({
      role: isNonEmptyString(entry.role) ? entry.role : null,
      path: entry.path,
      sha256: isSha256(entry.sha256) ? entry.sha256 : null,
      bytes: Number.isInteger(entry.bytes) ? entry.bytes : null,
      ref: isNonEmptyString(entry.ref) ? entry.ref : null,
    }));
}

/** Structured artifact coverage of a row, by role. */
export function artifactCoverage(row) {
  const artifacts = rowArtifacts(row);
  const roles = new Set(artifacts.map((entry) => entry.role));
  const outputs = artifacts.filter((entry) => CYCLE_OUTPUT_ROLES.includes(entry.role));
  const independent = artifacts.filter((entry) => INDEPENDENT_ROLES.includes(entry.role));
  const byRole = (role) => artifacts.filter((entry) => entry.role === role);
  const paths = artifacts.map((entry) => entry.path.split("\\").join("/").toLowerCase());
  return {
    count: artifacts.length,
    roles,
    outputs,
    independent,
    artifacts,
    byRole,
    paths,
    hasPersistedOutput: roles.has("persisted-output"),
    hasIndependent: independent.length > 0,
    hasTranscript: roles.has("transcript") || roles.has("report"),
    allRefs: artifacts.length > 0 && artifacts.every((entry) => isNonEmptyString(entry.ref)),
    distinctPaths: new Set(paths).size === paths.length,
  };
}

/** Which required assertions a row covers, and whether they all passed. */
export function assertionCoverage(row, format) {
  const required = Array.isArray(REQUIRED_ASSERTIONS[format]) ? REQUIRED_ASSERTIONS[format] : [];
  const map = new Map();
  const raw = Array.isArray(row?.assertions) ? row.assertions : [];
  for (const entry of raw) {
    if (isPlainObject(entry) && isNonEmptyString(entry.id)) map.set(entry.id, entry);
  }
  const missing = required.filter((id) => !map.has(id));
  const failed = required.filter((id) => map.has(id) && map.get(id).status !== "passed");
  const forbidden = FORBIDDEN_ASSERTION_IDS.filter((id) => map.has(id));
  return {
    required,
    missing,
    failed,
    forbidden,
    ok: missing.length === 0 && failed.length === 0 && forbidden.length === 0,
  };
}

/** Operation-id coverage for a required core gate. */
export function operationCoverage(row, format) {
  const required = Array.isArray(REQUIRED_OPERATION_IDS[format]) ? REQUIRED_OPERATION_IDS[format] : [];
  const operationId = isNonEmptyString(row?.operationId) ? row.operationId.toLowerCase() : "";
  if (operationId === "") return { ok: false, required, reason: "row-gate-operation-missing" };
  if (FORBIDDEN_OPERATION_MARKERS.some((marker) => operationId.includes(marker))) {
    return { ok: false, required, reason: "row-gate-operation-viewer" };
  }
  if (required.includes(operationId)) return { ok: true, required, reason: null };
  return { ok: false, required, reason: "row-gate-operation-mismatch" };
}

/**
 * Byte-check every accepted row's structured artifact. Acceptance is withdrawn
 * for any row whose artifact is absent, tampered with, out of role, outside the
 * supplied roots, or is the registry JSON itself (a hash of the register is not
 * cycle evidence).
 */
export function verifyArtifacts(registry, options = {}) {
  const findings = [];
  const rows = Array.isArray(registry?.rows) ? registry.rows : [];
  const given = Array.isArray(options.roots) ? options.roots.filter((entry) => isNonEmptyString(entry)) : [];
  const registryPath = isNonEmptyString(options.registryPath)
    ? options.registryPath.split("\\").join("/")
    : null;
  if (given.length === 0) {
    findings.push({
      severity: "error",
      code: "no-artifact-roots",
      message: "at least one --root/--artifacts path is required to verify artifact bytes",
    });
    return { findings, checked: 0, roots: [] };
  }
  const roots = [];
  for (const root of given) {
    try {
      roots.push({ given: root, real: fs.realpathSync(path.resolve(root)) });
    } catch {
      findings.push({ severity: "error", code: "root-missing", message: "artifact root does not exist: " + root });
    }
  }
    if (roots.length === 0) return { findings, checked: 0, roots: [] };

  let checked = 0;
  const identityByRow = new Map();
  for (const row of rows) {
    if (row?.status !== "PASS") continue;
    const rowId = isNonEmptyString(row?.id) ? row.id : "(row without id)";
    const artifacts = rowArtifacts(row);
    if (artifacts.length === 0) {
      findings.push({
        severity: "error",
        code: "artifact-missing",
        rowId,
        message: "accepted row " + rowId + " declares no structured artifacts",
      });
      continue;
    }
    for (const artifact of artifacts) {
      const normalised = artifact.path.split("\\").join("/");
      const isRegistryItself =
        (registryPath !== null && normalised === registryPath) ||
        normalised === "evidence-register.json" ||
        normalised.endsWith("/evidence-register.json");
      if (isRegistryItself) {
        findings.push({
          severity: "error",
          code: "artifact-is-registry",
          rowId,
          message:
            "accepted row " + rowId + " points an artifact at the registry JSON; a hash of the register is not cycle evidence",
        });
        continue;
      }
      if (!ARTIFACT_ROLES.includes(artifact.role)) {
        findings.push({
          severity: "error",
          code: "artifact-role-invalid",
          rowId,
          message:
            "accepted row " + rowId + " artifact " + artifact.path + " needs a valid role; expected one of " + ARTIFACT_ROLES.join(", "),
        });
        continue;
      }
      const resolved = resolveArtifactPath(roots, artifact.path);
      if (!resolved.ok) {
        findings.push({ severity: "error", code: resolved.code, rowId, message: resolved.message });
        continue;
      }
      checked += 1;
      // Record the resolved identity so an unrelated row cannot re-name the
      // same on-disk file under another spelling and still pass exclusivity.
      if (!identityByRow.has(rowId)) identityByRow.set(rowId, []);
      identityByRow.get(rowId).push(resolved.absolute.split("\\").join("/").toLowerCase());
      let bytes;
      try {
        bytes = fs.readFileSync(resolved.absolute);
      } catch (error) {
        findings.push({
          severity: "error",
          code: "artifact-unreadable",
          rowId,
          message: "accepted row " + rowId + " artifact is unreadable: " + error.message,
        });
        continue;
      }
      if (artifact.sha256 === null) {
        findings.push({
          severity: "error",
          code: "artifact-checksum-missing",
          rowId,
          message: "accepted row " + rowId + " must record a sha256 checksum for " + artifact.path,
        });
      } else {
        const actual = shaOf(bytes);
        if (actual.toUpperCase() !== artifact.sha256.toUpperCase()) {
          findings.push({
            severity: "error",
            code: "artifact-checksum-mismatch",
            rowId,
            message: "artifact checksum mismatch for " + rowId + " (" + artifact.path + "): recorded " + artifact.sha256 + ", actual " + actual,
          });
        }
      }
      if (artifact.bytes !== null && artifact.bytes !== bytes.length) {
        findings.push({
          severity: "error",
          code: "artifact-size-mismatch",
          rowId,
          message: "artifact size mismatch for " + rowId + " (" + artifact.path + "): recorded " + artifact.bytes + ", actual " + bytes.length,
        });
      }
    }
  }
  return { findings, checked, roots: roots.map((root) => root.given), identityByRow };
}

/**
 * Validate the whole register. options.artifactFindings feeds the byte-check
 * results back in so a gate can never be satisfied by an accepted row whose
 * artifact failed verification.
 */
export function validateRegistry(registry, options = {}) {
  const requireGo = Boolean(options.requireGo);
  const extraFindings = Array.isArray(options.artifactFindings) ? options.artifactFindings : [];
  const fixtureIdList = Array.isArray(options.fixtureIds) ? options.fixtureIds : null;
  const fixtureIds = fixtureIdList === null ? null : new Set(fixtureIdList.map((id) => String(id)));
  if (options.fixtureManifestFinding) extraFindings.unshift(options.fixtureManifestFinding);
  const resolvedIdentities =
    options.artifactIdentities instanceof Map ? options.artifactIdentities : new Map();
  const findings = [];
  const add = (severity, code, message, extra = {}) => {
    findings.push({ severity, code, message, ...extra });
  };
  const blockedByArtifact = new Set(
    extraFindings.filter((entry) => entry.severity === "error" && entry.rowId).map((entry) => entry.rowId),
  );

  if (!isPlainObject(registry)) {
    findings.push({ severity: "error", code: "invalid-registry", message: "registry root is not an object" });
    return finish(findings, [], [], null, requireGo);
  }
  if (registry.schemaVersion !== SCHEMA_VERSION) {
    add("error", "schema-version", "registry.schemaVersion must be " + SCHEMA_VERSION);
  }
  if (registry.kind !== SCHEMA_KIND) {
    add("error", "registry-kind", 'registry.kind must be "' + SCHEMA_KIND + '"');
  }
  if (registry.issue !== "UNI-670") {
    add("warning", "registry-issue", "registry.issue should name the DOC-006 issue UNI-670");
  }

  const baseline = registry.baseline;
  if (!isPlainObject(baseline)) {
    add("error", "missing-baseline", "registry.baseline is required to bind evidence to a source revision");
  } else {
    if (!isCommit(baseline.repoCommit)) {
      add("error", "baseline-provenance", "baseline.repoCommit must be a 40-hex commit");
    }
    if (!isCommit(baseline.tree)) {
      add("error", "baseline-provenance", "baseline.tree must be a 40-hex tree");
    }
    if (!isPlainObject(baseline.lockfile) || !isSha256(baseline.lockfile.sha256)) {
      add("error", "baseline-provenance", "baseline.lockfile.sha256 must be a sha256 checksum");
    }
    if (
      !isPlainObject(baseline.runtime) ||
      !isNonEmptyString(baseline.runtime.node) ||
      !isNonEmptyString(baseline.runtime.packageManager)
    ) {
      add("error", "baseline-provenance", "baseline.runtime must record the node runtime and package manager");
    }
  }

  const sources = Array.isArray(registry.sources) ? registry.sources : [];
  const sourcesById = new Map();
  sources.forEach((source, index) => {
    const at = "sources[" + index + "]";
    if (!isPlainObject(source) || !isNonEmptyString(source.id)) {
      add("error", "source-invalid", at + " needs a non-empty id");
      return;
    }
    if (sourcesById.has(source.id)) {
      add("error", "duplicate-source-id", at + ': duplicate source id "' + source.id + '"');
      return;
    }
    if (source.pending === true) {
      add("warning", "source-pending", at + ': source "' + source.id + '" has no recorded commit yet');
    } else if (!isCommit(source.commit)) {
      add("error", "source-invalid", at + ': source "' + source.id + '" needs a 40-hex commit');
      return;
    }
    sourcesById.set(source.id, source);
  });

  // --- deferrals (collected first, validated order-independently) ----------
  const deferrals = Array.isArray(registry.deferrals) ? registry.deferrals : [];
  const declaredPlatforms = new Set();
  deferrals.forEach((deferral) => {
    if (isPlainObject(deferral) && isNonEmptyString(deferral.platform)) {
      declaredPlatforms.add(deferral.platform.toLowerCase());
    }
  });
  const validDeferrals = [];
  deferrals.forEach((deferral, index) => {
    const at = "deferrals[" + index + "]";
    if (!isPlainObject(deferral) || !isNonEmptyString(deferral.platform)) {
      add("error", "deferral-invalid", at + " needs a platform");
      return;
    }
    const platform = deferral.platform.toLowerCase();
    const approvedByMac = platform === "safari" && declaredPlatforms.has("macos");
    if (!DEFERRABLE_PLATFORMS.includes(platform) && !approvedByMac) {
      add(
        "error",
        "impossible-platform-deferral",
        at + ': platform "' + deferral.platform + '" cannot be deferred at G0; only the ' + DEFERRABLE_PLATFORMS.join(", ") + " real-device deferral approved under QA-01 / UNI-671 is legitimate",
      );
      return;
    }
    if (!isNonEmptyString(deferral.reason)) {
      add("error", "deferral-invalid", at + " needs a reason");
      return;
    }
    if (!isNonEmptyString(deferral.issue)) {
      add("warning", "deferral-invalid", at + " should name the tracking issue that holds the deferred work");
    }
    validDeferrals.push({ platform, reason: deferral.reason, issue: deferral.issue ?? null });
  });
  const deferredPlatforms = new Set(
    validDeferrals.flatMap((entry) => (entry.platform === "macos" ? ["macos", "safari"] : [entry.platform])),
  );

  // --- browser deferrals (G0 decision of 2026-09-25) -----------------------
  // Installed Windows Chrome/Edge and macOS/Safari are not required at G0;
  // they are recorded here as a later-phase deferral. The block is validated
  // order-independently, and it may never defer a browser family a required
  // core gate still demands. The platform deferral rules above are unchanged.
  const browserDeferrals = Array.isArray(registry.browserDeferrals) ? registry.browserDeferrals : [];
  const deferredGatePairs = new Set(DEFERRED_GATE_BROWSERS.map((pair) => pair.os + "/" + pair.browser));
  const requiredGateFamilies = new Set(REQUIRED_GATE_BROWSERS.map((pair) => pair.browser));
  const validBrowserDeferrals = [];
  browserDeferrals.forEach((entry, index) => {
    const at = "browserDeferrals[" + index + "]";
    if (
      !isPlainObject(entry) ||
      !isNonEmptyString(entry.browser) ||
      !isNonEmptyString(entry.os) ||
      !isNonEmptyString(entry.reason) ||
      !isNonEmptyString(entry.issue) ||
      !isNonEmptyString(entry.phase)
    ) {
      add("error", "browser-deferral-invalid", at + " needs browser, os, reason, issue and phase");
      return;
    }
    const browser = entry.browser.toLowerCase();
    const os = entry.os.toLowerCase();
    if (!BROWSER_FAMILIES.includes(browser)) {
      add("error", "browser-deferral-invalid", at + ': unknown browser family "' + entry.browser + '"; expected one of ' + BROWSER_FAMILIES.join(", "));
      return;
    }
    if (!BROWSER_PLATFORMS.includes(os)) {
      add("error", "browser-deferral-invalid", at + ': unknown platform "' + entry.os + '"; expected one of ' + BROWSER_PLATFORMS.join(", "));
      return;
    }
    if (requiredGateFamilies.has(browser)) {
      add(
        "error",
        "browser-deferral-contradiction",
        at + ': browser "' + entry.browser + '" is still required by a core gate (' + REQUIRED_GATE_BROWSERS.map((pair) => pair.os + "/" + pair.browser).join(", ") + "); the verifier constant stays authoritative and a required gate is never deferred",
      );
      return;
    }
    const pairKey = os + "/" + browser;
    if (!deferredGatePairs.has(pairKey)) {
      add(
        "warning",
        "browser-deferral-unused",
        at + ': no gate defers "' + pairKey + '"; the recorded deferral is unused by the G0 browser scope (' + [...deferredGatePairs].join(", ") + ")",
      );
    }
    validBrowserDeferrals.push({ browser, os, reason: entry.reason, issue: entry.issue, phase: entry.phase });
  });
  const deferredBrowsers = {
    decision: "2026-09-25",
    rule: "the Orca embedded browser (Chromium) on Windows is the only browser a required G0 core-cycle gate accepts",
    requiredGateBrowsers: REQUIRED_GATE_BROWSERS.map((pair) => ({ os: pair.os, browser: pair.browser })),
    deferredGateBrowsers: DEFERRED_GATE_BROWSERS.map((pair) => ({ os: pair.os, browser: pair.browser })),
    declared: validBrowserDeferrals,
  };

  // --- fixture rebinds (CONTRACT-v1.1) --------------------------------------
  // A rebind records that a required core gate moves to a fixture which can actually meet its
  // required assertions; the retired fixture may stay as the row's supportingFixture. A row whose
  // PRIMARY fixture is the retired side is excluded from gate satisfaction (see baseAllowed).
  const declaredRebinds = Array.isArray(registry.fixtureRebinds) ? registry.fixtureRebinds : [];
  const rebinds = [];
  const seenRebindFrom = new Set();
  declaredRebinds.forEach((entry, index) => {
    const at = 'fixtureRebinds[' + index + ']';
    const valid = isPlainObject(entry) &&
      isNonEmptyString(entry.format) &&
      isNonEmptyString(entry.from) && MANIFEST_FIXTURE_ID_PATTERN.test(entry.from) &&
      isNonEmptyString(entry.to) && MANIFEST_FIXTURE_ID_PATTERN.test(entry.to) &&
      entry.from !== entry.to &&
      isNonEmptyString(entry.reason);
    if (!valid) {
      add('error', 'fixture-rebind-invalid', at + ' needs { format, from, to, reason } with two distinct manifest fixture ids');
      return;
    }
    const key = entry.format + '|' + entry.from;
    if (seenRebindFrom.has(key)) {
      add('error', 'fixture-rebind-invalid', at + ' repeats the rebind of ' + entry.from + ' for ' + entry.format);
      return;
    }
    if (fixtureIds !== null) {
      for (const field of ["from", "to"]) {
        if (!fixtureIds.has(entry[field])) {
          add("error", "unknown-fixture-id", at + "." + field + " names fixture id " + entry[field] + ", which the fixture manifest does not contain");
        }
      }
    }
    seenRebindFrom.add(key);
    rebinds.push({ format: entry.format, from: entry.from, to: entry.to, row: entry.row ?? null, gate: entry.gate ?? null, reason: entry.reason });
  });
  const retiredFixtureFor = (format, fixtureId) => {
    if (!isNonEmptyString(format) || !isNonEmptyString(fixtureId)) return null;
    return rebinds.find((entry) => entry.format === format && entry.from === fixtureId) ?? null;
  };

  // --- rows ----------------------------------------------------------------
  const rows = Array.isArray(registry.rows) ? registry.rows : [];
  const rowRecords = [];
  const rowsById = new Map();
  rows.forEach((row, index) => {
    const at = "rows[" + index + "]";
    const record = {
      id: isNonEmptyString(row?.id) ? row.id : null,
      at,
      raw: row,
      kind: row?.kind ?? null,
      format: isNonEmptyString(row?.format) ? row.format : null,
      operation: isNonEmptyString(row?.operation) ? row.operation : null,
      operationId: isNonEmptyString(row?.operationId) ? row.operationId : null,
      status: row?.status ?? null,
      level: row?.level ?? null,
      evidenceLevel: null,
      provides: Array.isArray(row?.provides) ? row.provides : [],
      operationEvidence: row?.operationEvidence ?? null,
      adapter: row?.adapter ?? null,
      uiKind: row?.uiKind ?? null,
      platformOs: isPlainObject(row?.platform) ? (row.platform.os ?? null) : null,
      platformBrowser: isPlainObject(row?.platform) ? (row.platform.browser ?? null) : null,
      engineName: isPlainObject(row?.engine) ? (row.engine.name ?? null) : null,
      engineVersion: isPlainObject(row?.engine) ? (row.engine.version ?? null) : null,
      protocolVersion: row?.protocolVersion ?? null,
      cases: Array.isArray(row?.cases) ? row.cases.filter((entry) => isNonEmptyString(entry)) : [],
      fixture: isNonEmptyString(row?.fixture) ? row.fixture : null,
      supportingFixture: isNonEmptyString(row?.supportingFixture) ? row.supportingFixture : null,
      authMode: isNonEmptyString(row?.authMode) ? row.authMode : null,
      draftStore: isNonEmptyString(row?.draftStore) ? row.draftStore : null,
      assertionMap: new Map(
        (Array.isArray(row?.assertions) ? row.assertions : [])
          .filter((entry) => isPlainObject(entry) && isNonEmptyString(entry.id))
          .map((entry) => [entry.id, entry]),
      ),
      accepted: false,
      browserCycle: false,
      errors: 0,
    };
    rowRecords.push(record);

    const rowAdd = (code, message) => {
      record.errors += 1;
      add("error", code, at + ": " + message, { rowId: record.id });
    };

    if (!record.id) {
      rowAdd("row-invalid", "row needs a non-empty id");
    } else if (rowsById.has(record.id)) {
      rowAdd("duplicate-row-id", 'duplicate row id "' + record.id + '"');
    } else {
      rowsById.set(record.id, record);
    }
    if (!isNonEmptyString(row?.kind)) rowAdd("row-invalid", "row needs a kind");
    if (!isNonEmptyString(row?.operation)) rowAdd("row-invalid", "row needs an operation label");
    if (!isNonEmptyString(row?.format)) rowAdd("row-invalid", "row needs a format (or n/a)");
    if (!isNonEmptyString(row?.operationId)) rowAdd("row-invalid", "row needs an operationId bound to its gate");
    if (!STATUSES.includes(record.status)) {
      rowAdd("unknown-status", "unknown status " + JSON.stringify(row?.status) + "; expected one of " + STATUSES.join(", "));
    }
    if (!LEVELS.includes(record.level)) {
      rowAdd("unknown-level", "unknown level " + JSON.stringify(row?.level) + "; expected one of " + LEVELS.join(", "));
    }
    if (record.provides.length === 0) {
      rowAdd("row-invalid", "row needs at least one provides entry");
    } else {
      const unknown = record.provides.filter((entry) => !PROVIDES.includes(entry));
      if (unknown.length) rowAdd("row-invalid", "unknown provides entries: " + unknown.join(", "));
    }
    if (!isPlainObject(row?.expected) || !isNonEmptyString(row.expected.result) || !isNonEmptyString(row.expected.oracle)) {
      rowAdd("row-invalid", "row needs expected.result and expected.oracle before any run");
    }
    if (!isPlainObject(row?.platform) || !isNonEmptyString(row.platform.os)) {
      rowAdd("row-invalid", "row needs platform.os");
    }

    if (record.status === "PASS") {
      const classification = classifyRow(row);
      if (!classification.allowed) {
        rowAdd("level-exceeds-evidence", "claimed evidence cannot reach the declared level (" + classification.reason + ")");
      }
      record.evidenceLevel = classification.evidenceLevel ?? record.level;
      record.browserCycle = classification.browserCycle;
    } else {
      record.evidenceLevel = record.level;
      record.browserCycle = false;
    }

    // CONTRACT-v1.2/r3: when the fixture manifest is available, a required core row must name an id it
    // contains - F-PPTX-STANDARD vs F-PPTX-STD was exactly the silent case this catches. A non-core row
    // that names a lane fixture keeps only a warning, so historical scoped rows stay valid.
    if (fixtureIds !== null) {
      const check = (value, field) => {
        if (!isNonEmptyString(value) || fixtureIds.has(value)) return;
        const detail = field + " names fixture id " + value + ", which the fixture manifest does not contain";
        if (record.kind === "core-cycle") rowAdd("unknown-fixture-id", detail);
        else add("warning", "unknown-fixture-id", at + ": " + detail, { rowId: record.id });
      };
      check(record.fixture, "fixture");
      check(record.supportingFixture, "supportingFixture");
    }

    // CONTRACT-v1.1: an optional supportingFixture is context only - a manifest id, distinct from
    // the row's primary fixture, and never the artifact-ref identity.
    if (row?.supportingFixture !== undefined && row?.supportingFixture !== null) {
      if (!isNonEmptyString(row.supportingFixture) || !MANIFEST_FIXTURE_ID_PATTERN.test(row.supportingFixture)) {
        rowAdd('supporting-fixture-invalid', 'supportingFixture must be a manifest fixture id (F-...)');
      } else if (row.supportingFixture === record.fixture) {
        rowAdd('supporting-fixture-invalid', 'supportingFixture must differ from the row primary fixture');
      }
    }

    // provenance
    const source = row?.source;
    if (!isPlainObject(source) || !isNonEmptyString(source.id) || !isNonEmptyString(source.kind)) {
      rowAdd("unknown-provenance", "row needs source {kind, id, commit}");
    } else {
      const entry = sourcesById.get(source.id);
      if (!entry) {
        rowAdd("unknown-provenance", 'source id "' + source.id + '" is not declared in registry.sources');
      } else if (entry.pending === true) {
        rowAdd("unknown-provenance", 'source id "' + source.id + '" has no recorded commit');
      } else if (source.kind !== entry.kind || source.commit !== entry.commit) {
        rowAdd(
          "conflicting-provenance",
          "row source (" + source.kind + " @ " + source.commit + ") conflicts with registry.sources entry (" + entry.kind + " @ " + entry.commit + ")",
        );
      } else if (
        isPlainObject(baseline) &&
        isCommit(baseline.repoCommit) &&
        source.commit !== baseline.repoCommit &&
        entry.allowNonBaseline !== true
      ) {
        rowAdd(
          "conflicting-provenance",
          "row source commit " + source.commit + " differs from baseline.repoCommit " + baseline.repoCommit + " and the source is not marked allowNonBaseline",
        );
      } else if (
        isPlainObject(baseline) &&
        source.commit !== baseline.repoCommit &&
        entry.allowNonBaseline === true &&
        !isNonEmptyString(entry.reason)
      ) {
        rowAdd("conflicting-provenance", 'source "' + source.id + '" allows a non-baseline commit without a recorded reason');
      }
    }

    // status-specific evidence
    if (record.status === "PASS") {
      if (row?.result !== "pass") rowAdd("pass-without-pass-result", 'a PASS row must record result "pass"');
      if (!isNonEmptyString(row?.command)) rowAdd("pass-without-command", "a PASS row must record the exact command");
      if (!isNonEmptyString(row?.cwd)) rowAdd("pass-without-command", "a PASS row must record the command working directory");
      if (!isNonEmptyString(row?.actual)) rowAdd("pass-without-observation", "a PASS row must record the observed actual result");
      if (rowArtifacts(row).length === 0) {
        rowAdd("pass-without-artifact", "a PASS row must record at least one structured artifact");
      }
      if (row?.operationEvidence === null || row?.operationEvidence === undefined) {
        rowAdd("pass-without-operation-evidence", "a PASS row must declare its operation evidence");
      }
      if (!Array.isArray(row?.assertions)) {
        rowAdd("pass-without-assertions", "a PASS row must record its assertion results");
      }
    } else if (record.status === "FAIL") {
      if (row?.result !== "fail") rowAdd("fail-without-fail-result", 'a FAIL row must record result "fail"');
      if (!isNonEmptyString(row?.command)) rowAdd("fail-without-command", "a FAIL row must record the exact command");
      if (!isNonEmptyString(row?.actual)) rowAdd("fail-without-observation", "a FAIL row must record the observed actual result");
    } else if (record.status === "PENDING" || record.status === "BLOCKED") {
      if (!isNonEmptyString(row?.reason) && !isNonEmptyString(row?.pendingReason)) {
        rowAdd("missing-pending-reason", record.status + " rows must record a reason");
      }
    } else if (record.status === "NOT_APPLICABLE" && !isNonEmptyString(row?.reason)) {
      rowAdd("missing-pending-reason", "NOT_APPLICABLE rows must record a reason");
    }

    // runtime / engine / protocol provenance for the stronger claims
    if (record.status === "PASS") {
      if (
        record.evidenceLevel &&
        LEVEL_ORDER[record.evidenceLevel] >= LEVEL_ORDER["engine-round-trip"] &&
        (!isNonEmptyString(record.engineName) || !isNonEmptyString(record.engineVersion))
      ) {
        rowAdd("missing-engine-provenance", "rows at engine-round-trip or above must record engine name and version");
      }
      if (
        record.provides.includes("contract-model") &&
        !isNonEmptyString(record.protocolVersion)
      ) {
        rowAdd("missing-protocol-provenance", "contract rows must record the engine/adapter protocol version");
      }
      // A required core-cycle row must name the browser-cycle contract string
      // it actually traversed (CONTRACT-v1 section 2): an empty value is
      // missing provenance, an invented name or an unimplemented version is
      // unknown provenance. The rule is scoped to kind "core-cycle", so a
      // scoped non-gate row that records protocolVersion null (the accepted
      // E-*-SCOPED-* rows) keeps validating exactly as it does today.
      if (record.kind === "core-cycle") {
        if (!isNonEmptyString(record.protocolVersion)) {
          rowAdd(
            "missing-protocol-provenance",
            "a core-cycle PASS row must record the browser-cycle protocolVersion it traversed (accepted: " +
              ACCEPTED_BROWSER_BRIDGE_CONTRACTS.join(", ") + ")",
          );
        } else if (!ACCEPTED_BROWSER_BRIDGE_CONTRACTS.includes(record.protocolVersion)) {
          rowAdd(
            "unknown-protocol-provenance",
            'core-cycle row "' + record.id + '" records protocolVersion "' + record.protocolVersion +
              '", which is not an implemented browser-cycle contract string (accepted: ' +
              ACCEPTED_BROWSER_BRIDGE_CONTRACTS.join(", ") + ")",
          );
        }
      }
      if (
        (record.provides.includes("engine-operation") || record.browserCycle) &&
        (rowArtifacts(row).length === 0 || rowArtifacts(row).some((entry) => entry.sha256 === null || entry.bytes === null))
      ) {
        rowAdd(
          "pass-without-byte-evidence",
          "a PASS row claiming an engine operation or editor cycle must record structured artifacts with byte size and sha256 checksum",
        );
      }
    }

    // DOC-005 keeps two honest halves on one contract gate: the draft cases run
    // against a real durable local store, the authorization cases stay an
    // explicitly labeled model. A PASS row that claims a draft-persistence case
    // must therefore carry real store evidence; a PASS row claiming an
    // authorization-only case must declare the modeled provenance explicitly.
    if (record.status === "PASS" && record.kind === "doc005-mandatory") {
      const persistenceCases = record.cases.filter((entry) => DRAFT_PERSISTENCE_CASES.includes(entry));
      const authOnlyCases = record.cases.filter((entry) => !DRAFT_PERSISTENCE_CASES.includes(entry));
      if (persistenceCases.length > 0) {
        const coverage = artifactCoverage(row);
        if (
          !coverage.hasPersistedOutput ||
          !coverage.artifacts.every((entry) => entry.sha256 !== null && entry.bytes !== null)
        ) {
          rowAdd(
            "persistence-without-store-artifact",
            "a draft-persistence case needs a real persisted-output artifact with byte size and sha256, not a modeled statement",
          );
        }
        const recovery = record.assertionMap.get(RECOVERY_ASSERTION_ID);
        if (!recovery || recovery.status !== "passed") {
          rowAdd(
            "persistence-without-recovery-assertion",
            'a draft-persistence case must record "' + RECOVERY_ASSERTION_ID + '" as passed: the draft bytes were read from a freshly opened store',
          );
        }
      }
      if (authOnlyCases.length > 0 && record.authMode !== AUTH_MODE_MODELED) {
        rowAdd(
          "auth-provenance-unlabeled",
          'an authorization-only DOC-005 case must declare authMode "' + AUTH_MODE_MODELED + '"; G0 does not claim real product authorization',
        );
      }
      if (record.authMode === AUTH_MODE_MODELED && record.adapter === "real" && record.cases.some((entry) => authOnlyCases.includes(entry))) {
        rowAdd(
          "auth-case-claims-real-adapter",
          "an authorization-only case must not claim a real adapter; the reference harness models product auth",
        );
      }
    }

    const scopedPptx = record.kind === "scoped-browser-cycle" && record.format === "pptx";
    const scopedXlsx = record.kind === "scoped-browser-cycle" && record.format === "xlsx";
    const scopedChecksum = record.kind === "scoped-reference-checksum";
    // Native Orca evidence retains its host identity even if a row is retargeted.
    if (record.status === "PASS" && (scopedXlsx || row.nativeCycle?.host === "orca")) {
      const cycle = row.nativeCycle;
      if (!scopedXlsx || cycle?.host !== "orca" || row.platform?.os !== "windows" ||
          row.platform?.browser !== "chromium" || !isNonEmptyString(row.runtime?.electron) ||
          record.adapter !== "real" || record.operationEvidence !== "byte-verified-operation" ||
          record.operationId !== "edit-input-recalculate-save-distinct-reopen") {
        rowAdd("scoped-xlsx-provenance", "native XLSX evidence must remain a scoped Windows Orca/Electron input cycle, not installed-browser or modeled evidence");
      }
      const required = ["cell-value-changed", "formula-recalculated-numeric", "formula-expected-value", "reopen-fresh-session"];
      if (required.some((id) => record.assertionMap.get(id)?.status !== "passed")) {
        rowAdd("scoped-xlsx-assertion", "native input acceptance requires the input edit, numeric formula result and distinct reopen assertions");
      }
      const artifacts = rowArtifacts(row);
      const binds = (pin, role) => {
        const matches = artifacts.filter((a) => a.role === role);
        return matches.length === 1 && isNonEmptyString(pin?.path) && isSha256(pin?.sha256) &&
          Number.isInteger(pin?.bytes) && pin.bytes > 0 && matches[0].path === pin.path &&
          matches[0].sha256?.toLowerCase() === pin.sha256.toLowerCase() && matches[0].bytes === pin.bytes;
      };
      const sameOutput = isSha256(cycle?.saved?.sha256) && isSha256(cycle?.reopened?.sha256) &&
        cycle.saved.sha256.toLowerCase() === cycle.reopened.sha256.toLowerCase() &&
        cycle.saved.bytes === cycle.reopened.bytes;
      const identifiers = ["profileId", "originalPageId", "reopenedPageId", "originalViewId", "reopenedViewId"];
      if (!cycle || identifiers.some((field) => !isNonEmptyString(cycle[field])) ||
          cycle.originalPageId === cycle.reopenedPageId || cycle.originalViewId === cycle.reopenedViewId ||
          !isCommit(cycle.sourcePin) || cycle.sourcePin !== row.source?.commit ||
          !isSha256(cycle.rendererManifestSha256) || !isSha256(cycle.sidecarSha256) ||
          !binds(cycle.input, "immutable-input") || !binds(cycle.saved, "persisted-output") ||
          !binds(cycle.reopened, "reopened-output") || !sameOutput) {
        rowAdd("scoped-xlsx-identity", "native XLSX requires bound input/saved/reopened byte pins, equal saved/reopened bytes, source/build pins and distinct original/reopened page and view identities");
      }
    }
    if (record.status === "PASS" && scopedChecksum) {
      if (record.adapter !== "model" || record.operationEvidence !== "modeled-operation" ||
          row.authMode !== "modeled" || row.storeMode !== "modeled" || row.commitMode !== "modeled" ||
          row.faultMode !== "controlled-declaration-tamper") {
        rowAdd("scoped-checksum-provenance", "checksum reference evidence must label modeled auth/store/commit and controlled declaration tamper");
      }
      const required = ["genuine-output-accepted-once", "checksum-refused-before-storage", "zero-store-puts", "zero-version-commits", "zero-ledger-rows", "revision-pointer-unchanged"];
      if (required.some((id) => record.assertionMap.get(id)?.status !== "passed")) {
        rowAdd("scoped-checksum-assertion", "zero-put acceptance requires its positive control and all reference-boundary refusal assertions");
      }
    }
    // Non-gate acceptances still bind their input, output and independent
    // evidence. A reopened file is separate from the saved output and report.
    if (record.status === "PASS" && (scopedPptx || scopedXlsx || scopedChecksum)) {
      const coverage = artifactCoverage(row);
      const requiredRoles = ["immutable-input", "persisted-output", "extraction-evidence"];
      if (scopedPptx || scopedXlsx) requiredRoles.push("reopened-output", "render-evidence");
      const missing = requiredRoles.filter((role) => !coverage.roles.has(role));
      if (!coverage.hasTranscript) missing.push("report/transcript");
      if (missing.length) {
        const code = scopedPptx ? "scoped-pptx-artifact-missing" : scopedXlsx ? "scoped-xlsx-artifact-missing" : "scoped-checksum-artifact-missing";
        rowAdd(code, "scoped evidence needs " + missing.join(", "));
      }
      const expectedRef = coreArtifactRef(record.fixture, record.format, record.operationId);
      if (!record.fixture || !coverage.artifacts.every((artifact) => artifact.ref === expectedRef)) {
        rowAdd("artifact-ref-unbound", 'scoped artifacts must carry ref "' + expectedRef + '"');
      }
    }

    record.accepted = record.status === "PASS" && record.errors === 0 && !blockedByArtifact.has(record.id);
  });

  // --- gates ---------------------------------------------------------------
  const gates = Array.isArray(registry.gates) ? registry.gates : [];
  const gateResults = [];
  // H4 execution identity: one artifact file belongs to one accepted row. Two
  // browser rows (or two formats) may not attest the same persisted output,
  // transcript or independent evidence file. Identical bytes in two distinct
  // files stay legitimate; only the identity is unique.
  const artifactOwner = new Map();
  const artifactUsers = new Map();
  // The identity of an artifact is its resolved realpath when byte checks ran,
  // so one on-disk file spelled two ways still has one owner. Without byte
  // checks (--no-artifacts) the lexical path is the only identity available.
  const identityKey = (record, artifact, index) => {
    const resolved = resolvedIdentities.get(record.id);
    if (Array.isArray(resolved) && index < resolved.length) return resolved[index];
    return artifact.path.split("\\").join("/").toLowerCase();
  };
  for (const record of rowRecords) {
    if (!record.accepted) continue;
    rowArtifacts(record.raw).forEach((artifact, index) => {
      const key = identityKey(record, artifact, index);
      if (!artifactOwner.has(key)) artifactOwner.set(key, record.id);
      if (!artifactUsers.has(key)) artifactUsers.set(key, new Set());
      artifactUsers.get(key).add(record.id);
    });
  }
  const identityExclusive = (record) =>
    rowArtifacts(record.raw).every(
      (artifact, index) => artifactOwner.get(identityKey(record, artifact, index)) === record.id,
    );
  for (const record of rowRecords) {
    const scoped = (record.kind === "scoped-browser-cycle" && ["pptx", "xlsx"].includes(record.format)) || record.kind === "scoped-reference-checksum";
    if (!record.accepted || !scoped) continue;
    const keys = rowArtifacts(record.raw).map((artifact, index) => identityKey(record, artifact, index));
    if (new Set(keys).size !== keys.length || keys.some((key) => artifactUsers.get(key).size > 1)) {
      record.accepted = false;
      record.errors += 1;
      add("error", "artifact-identity-shared", 'scoped row "' + record.id + '" must use distinct artifact identities within the row and across accepted rows', { rowId: record.id });
    }
  }
  const identityShareReported = new Set();
  const usedGateIds = new Set();
  gates.forEach((gate, index) => {
    const at = "gates[" + index + "]";
    const id = isNonEmptyString(gate?.id) ? gate.id : null;
    const gateAdd = (code, message) => add("error", code, at + ": " + message);
    // A coverage shortfall (not enough browsers/assertions/artifacts/cases yet)
    // keeps the register valid and the gate unsatisfied; a contradiction such as
    // a retargeted row stays an error.
    const gateWarn = (code, message, extra = {}) => add("warning", code, at + ": " + message, extra);
    if (!id) gateAdd("gate-invalid", "gate needs a non-empty id");
    else if (usedGateIds.has(id)) gateAdd("duplicate-gate-id", 'duplicate gate id "' + id + '"');
    else usedGateIds.add(id);
    const kind = isNonEmptyString(gate?.kind) ? gate.kind : null;
    if (!kind) gateAdd("gate-invalid", "gate needs a kind");    const required = gate?.required !== false;
    const gateFormat = isNonEmptyString(gate?.format) ? gate.format : "n/a";
    let level = LEVELS.includes(gate?.level) ? gate.level : "browser-real";
    const canonicalLevel = required ? (CANONICAL_GATE_LEVELS[kind] ?? null) : null;
    const canonicalAdapter = required ? (CANONICAL_GATE_ADAPTERS[kind] ?? null) : null;
    const canonicalOp = required ? (CANONICAL_GATE_OPERATION_EVIDENCE[kind] ?? null) : null;
    if (canonicalLevel !== null && LEVEL_ORDER[level] < LEVEL_ORDER[canonicalLevel]) {
      if (LEVELS.includes(gate?.level)) {
        gateAdd(
          "gate-floor-downgrade",
          'required gate "' + id + '" cannot lower its evidence-level floor to "' + level + '"; kind "' + kind + '" stays at "' + canonicalLevel +
          '"',
        );
      }
      level = canonicalLevel;
    }
    const declaredAdapter = isNonEmptyString(gate?.adapter) ? gate.adapter : null;
    let adapterRequired = canonicalAdapter ?? (declaredAdapter === null || declaredAdapter === "none" ? "real" : declaredAdapter);
    if (canonicalAdapter !== null && declaredAdapter !== null) {
      const weakerAdapter =
        canonicalAdapter === "model"
          ? declaredAdapter !== "model" && declaredAdapter !== "real"
          : declaredAdapter !== "real";
      if (weakerAdapter) {
        gateAdd(
          "gate-floor-downgrade",
          'required gate "' + id + '" cannot lower its adapter floor to "' + declaredAdapter + '"; kind "' + kind + '" stays at "' +
          canonicalAdapter + '"',
        );
      } else {
        adapterRequired = declaredAdapter;
      }
    }
    let opRequired = OPERATION_EVIDENCE.includes(gate?.operationEvidence)
      ? gate.operationEvidence
      : kind === "doc004-fault" || kind === "doc005-mandatory" || kind === "adapter-contract"
        ? "modeled-operation"
        : "byte-verified-operation";
    if (canonicalOp !== null) {
      if (OPERATION_EVIDENCE.includes(gate?.operationEvidence) && OPERATION_ORDER[opRequired] < OPERATION_ORDER[canonicalOp]) {
        gateAdd(
          "gate-floor-downgrade",
          'required gate "' + id + '" cannot lower its operation-evidence floor to "' + opRequired + '"; kind "' + kind + '" stays at "' +
          canonicalOp + '"',
        );
      }
      if (OPERATION_ORDER[opRequired] < OPERATION_ORDER[canonicalOp]) opRequired = canonicalOp;
    }
    const coreGate = kind === "core-cycle";
    // The verifier constant stays the authoritative coverage list: a required
    // core gate whose declared requiredBrowsers disagree (a register written
    // before the 2026-09-25 decision) is a warning, never an error, so this
    // patched verifier still validates the unpatched canonical register.
    if (required && coreGate && Array.isArray(gate?.requiredBrowsers) && gate.requiredBrowsers.length > 0) {
      const declaredPairs = gate.requiredBrowsers
        .filter((entry) => isPlainObject(entry) && isNonEmptyString(entry.os) && isNonEmptyString(entry.browser))
        .map((entry) => entry.os.toLowerCase() + "/" + entry.browser.toLowerCase())
        .sort();
      const canonicalPairs = REQUIRED_GATE_BROWSERS.map((pair) => pair.os + "/" + pair.browser).sort();
      const stale =
        declaredPairs.length !== canonicalPairs.length ||
        declaredPairs.some((pair, pairIndex) => pair !== canonicalPairs[pairIndex]);
      if (stale) {
        gateWarn(
          "gate-browser-scope-stale",
          'gate "' + id + '" declares requiredBrowsers [' + declaredPairs.join(", ") +
            "] but the verifier's canonical core-cycle browser scope is [" + canonicalPairs.join(", ") +
            "]; the declared list is stale and never authoritative - coverage is checked against the verifier constant",
        );
      }
    }
    const provides = Array.isArray(gate?.provides) ? gate.provides : [];
    const requiredAssertions = coreGate ? (REQUIRED_ASSERTIONS[gateFormat] ?? []) : [];
    const declaredCases = Array.isArray(gate?.requiredCases)
      ? gate.requiredCases.filter((entry) => isNonEmptyString(entry))
      : [];    const canonicalCases = REQUIRED_CASES_FOR_KIND[kind] ?? [];
    const expectedCases = declaredCases.length > 0 ? declaredCases : canonicalCases;

    if (required && (LEVEL_ORDER[level] >= LEVEL_ORDER["product-e2e"] || provides.includes("product-e2e"))) {
      gateAdd("g0-scope-violation", 'required gate "' + id + '" demands product-E2E evidence; G7 product E2E is out of G0 scope');
    }
    for (const entry of provides) {
      if (!PROVIDES.includes(entry)) {
        gateAdd("gate-invalid", 'gate "' + id + '" declares unknown provides entry "' + entry + '"');
      }
    }
    if (required && canonicalCases.length > 0) {
      const missingDeclared = canonicalCases.filter((entry) => !declaredCases.includes(entry));
      if (missingDeclared.length > 0) {
        gateAdd("required-cases-incomplete", 'gate "' + id + '" must enumerate every canonical case; missing: ' + missingDeclared.join(", "));
      }
      const unknownDeclared = declaredCases.filter((entry) => !canonicalCases.includes(entry));
      if (unknownDeclared.length > 0) {
        gateAdd("unknown-required-case", 'gate "' + id + '" lists case ids outside the canonical list: ' + unknownDeclared.join(", "));
      }
    }

    const ids = Array.isArray(gate?.rows) ? gate.rows : [];
    if (required && ids.length === 0) gateAdd("missing-gate-rows", 'gate "' + id + '" lists no evidence rows');
    const unknownRows = ids.filter((entry) => !rowsById.has(entry));
    if (unknownRows.length) {
      gateAdd("unknown-gate-row", 'gate "' + id + '" references unknown row ids: ' + unknownRows.join(", "));
    }    const candidates = ids.map((entry) => rowsById.get(entry)).filter(Boolean);
    const passCandidates = candidates.filter((record) => record.status === "PASS");
    if (required && coreGate) {
      // Core-cycle floors stay canonical even when the register declares less.
      const sample = passCandidates.map((record) => classifyRow(record.raw)).find((entry) => entry.allowed);
      if (sample && LEVEL_ORDER[sample.evidenceLevel] > LEVEL_ORDER[level]) level = sample.evidenceLevel;
      if (LEVEL_ORDER[level] < LEVEL_ORDER["browser-real"]) level = "browser-real";
    }
    const requiredProvides = required ? (CANONICAL_GATE_PROVIDES[kind] ?? []) : [];
    const effectiveProvides = [...new Set([...provides, ...requiredProvides])];
    const coverageCache = new Map();
    const coverageOf = (record) => {
      if (!coverageCache.has(record)) {
        coverageCache.set(record, {
          assertion: coreGate ? assertionCoverage(record.raw, gateFormat) : null,
          artifact: coreGate ? artifactCoverage(record.raw) : null,
          operation: coreGate ? operationCoverage(record.raw, gateFormat) : null,
        });
      }
      return coverageCache.get(record);
    };

    const baseAllowed = (record) =>
      record.accepted &&
      // CONTRACT-v1.1: a row whose primary fixture is the retired side of a rebind for its format
      // cannot satisfy this gate - it is reported as a warning and the gate stays unsatisfied.
      coreGate && retiredFixtureFor(gateFormat, record.fixture) ? false :

      // CONTRACT-v1.1: a row whose primary fixture is the retired side of a rebind for its
      // format cannot satisfy this gate: the warning explains it and the gate stays unsatisfied.
      (coreGate && retiredFixtureFor(gateFormat, record.fixture) ? false : true) &&
      record.evidenceLevel &&
      LEVEL_ORDER[record.evidenceLevel] >= LEVEL_ORDER[level] &&      effectiveProvides.every((entry) => record.provides.includes(entry)) &&
      OPERATION_ORDER[record.operationEvidence] >= OPERATION_ORDER[opRequired] &&
      adapterAllowedFor(record) &&
      (!gate?.platform || record.platformOs === gate.platform) &&
      // A row that reuses another accepted row's artifact file is not a
      // gate-satisfying execution: one file belongs to one row, so it cannot
      // keep a gate satisfied while the shared identity is reported as an error.
      identityExclusive(record);
    const kindAllowed = (record) => kind === null || record.kind === kind;
    const formatAllowed = (record) => !coreGate || record.format === gateFormat;
    // A stronger adapter than the gate floor is allowed; a weaker one is not.
    // A required gate still requires an adapter at all (adapterRequired null
    // only appears on an optional gate).
    const adapterAllowedFor = (record) =>
      adapterRequired === null ||
      (ADAPTER_ORDER[record.adapter] !== undefined &&
        ADAPTER_ORDER[record.adapter] >= ADAPTER_ORDER[adapterRequired]);
    const operationAllowed = (record) => !coreGate || coverageOf(record).operation.ok;
    const assertionAllowed = (record) => !coreGate || coverageOf(record).assertion.ok;
    const artifactAllowed = (record) => {
      if (!coreGate) return true;
      const cov = coverageOf(record).artifact;
      if (cov.count < MIN_REQUIRED_ARTIFACTS) return false;
      if (!cov.hasPersistedOutput) return false;
      if (!cov.hasIndependent) return false;
      if (!cov.allRefs) return false;
      // H4: identity binding. A cycle row names its own fixture and every
      // artifact ref must be exactly fixture/format/operationId, so another
      // format's or fixture's bytes cannot close this gate.
      if (!isNonEmptyString(record.fixture)) return false;
      const expectedRef = coreArtifactRef(record.fixture, record.format, record.operationId);
      if (!cov.artifacts.every((entry) => entry.ref === expectedRef)) return false;
      // An immutable input, the persisted output and the independent evidence
      // are separate artifact identities: one file never stands in for two
      // roles. Byte equality between roles stays allowed (an edit may preserve
      // a render), only the identity must differ.
      for (const role of REQUIRED_CORE_ROLES) if (!cov.roles.has(role)) return false;
      if (!REQUIRED_CORE_REPORT_ROLES.some((role) => cov.roles.has(role))) return false;
      if (!cov.distinctPaths) return false;
      if (!identityExclusive(record)) return false;
      if (gateFormat === "pdf") {
        for (const role of ["pre-edit-extraction", "post-edit-extraction", "pre-edit-render", "post-edit-render"]) {
          if (!cov.roles.has(role)) return false;
        }
      }
      return true;
    };
    const provenanceAllowed = (record) =>
      !coreGate ||
      (isNonEmptyString(record.engineName) && isNonEmptyString(record.engineVersion) && isNonEmptyString(record.protocolVersion));

    const satisfiedBy = candidates.filter(
      (record) => baseAllowed(record) && kindAllowed(record) && formatAllowed(record) && operationAllowed(record) && assertionAllowed(record) && artifactAllowed(record) && provenanceAllowed(record),
    );

    // H4 execution identity applies to every gate: one artifact file belongs to
    // one accepted row, so two core-cycle, DOC-004 or DOC-005 rows may not
    // attest the same input, output, transcript or report file. Identical bytes
    // in two distinct files stay legitimate; only the identity is unique.
    for (const record of candidates) {
      if (!record.accepted || identityShareReported.has(record.id)) continue;
      if (identityExclusive(record)) continue;
      identityShareReported.add(record.id);
      gateAdd(
        "artifact-identity-shared",
        'row "' + record.id + '" reuses an artifact file already owned by another accepted row; each execution binds its own evidence file',
      );
    }

    for (const record of passCandidates) {
      if (satisfiedBy.includes(record)) continue;
      if (!baseAllowed(record)) {
        gateAdd(
          "gate-row-unsatisfied",
          'gate "' + id + '" has accepted row "' + record.id + '" that does not meet the gate evidence level, provides, operation evidence, adapter or platform',
        );
        continue;
      }
      if (!kindAllowed(record)) {
        gateAdd("row-gate-kind-mismatch", 'gate "' + id + '" requires kind "' + kind + '" but row "' + record.id + '" is "' + record.kind + '"');
      }
      if (!formatAllowed(record)) {
        gateAdd("row-gate-format-mismatch", 'gate "' + id + '" covers format "' + gateFormat + '" but row "' + record.id + '" declares "' + record.format + '"');
      }
      if (!operationAllowed(record)) {
        const op = coverageOf(record).operation;
        gateAdd("row-gate-operation-mismatch", 'row "' + record.id + '" operation id does not match the required edit operation for gate "' + id + '" (' + op.reason + ")");
      }
      if (!assertionAllowed(record)) {
        const cov = coverageOf(record).assertion;
        gateWarn(
          "missing-required-assertion",
          'row "' + record.id + '" is missing or failing required assertions for ' + gateFormat + ": " +
            (cov.missing.length ? "missing " + cov.missing.join(", ") + "; " : "") +
            (cov.failed.length ? "failing " + cov.failed.join(", ") + "; " : "") +
            (cov.forbidden.length ? "viewer/annotation assertion " + cov.forbidden.join(", ") : ""),
        );
      }
      if (!artifactAllowed(record)) {
        gateWarn(
          "missing-required-artifact",
          'row "' + record.id + '" lacks the structured artifacts for gate "' + id + '" (a persisted output plus independent render/extraction evidence bound by ref' + (gateFormat === "pdf" ? ", including pre/post extraction and render" : "") + ")",
        );
        const cov = coverageOf(record).artifact;
        if (coreGate && isNonEmptyString(record.fixture)) {
          const expectedRef = coreArtifactRef(record.fixture, record.format, record.operationId);
          if (!cov.artifacts.every((entry) => entry.ref === expectedRef)) {
            gateAdd(
              "artifact-ref-unbound",
              'row "' + record.id + '" artifacts must all carry ref "' + expectedRef + '" (fixture/format/operation); another fixture or format identity does not bind here',
            );
          }
        }
      }
      if (!provenanceAllowed(record)) {
        gateAdd("missing-core-provenance", 'row "' + record.id + '" must record engine name, engine version and protocol version to satisfy core-cycle gate "' + id + '"');
      }
    }    // One canonical case per accepted contract row: a case is covered only by an
    // accepted row that names just that case and binds its artifacts to it.
    const caseBound = (record, caseId) => {
      const artifacts = rowArtifacts(record.raw);
      return record.cases.length === 1 && artifacts.length > 0 && artifacts.every((entry) => entry.ref === caseId);
    };
    const casesCovered = new Map();
    for (const caseId of expectedCases) {
      const matching = candidates.filter((record) => record.cases.includes(caseId));
      const acceptedMatch = matching.filter((record) => caseBound(record, caseId) && satisfiedBy.includes(record));
      casesCovered.set(caseId, {
        matched: acceptedMatch.length > 0,
        failed: matching.some((record) => record.status === "FAIL"),
        seen: matching.length > 0,
      });
    }
    if (canonicalCases.length > 0) {
      for (const caseId of expectedCases) {
        const entry = casesCovered.get(caseId);
        if (passCandidates.length > 0 && !entry.matched) {
          gateWarn(
            "missing-required-case",
            'gate "' + id + '" has an accepted bundle row but required case "' + caseId + '" has no individually accepted, case-bound row',
          );
        }
      }
      for (const record of passCandidates) {
        if (record.cases.length === 0) {
          gateAdd("case-row-missing-cases", 'row "' + record.id + '" claims gate "' + id + '" without naming any required case');
        } else if (record.cases.length > 1) {
          gateAdd(
            "bundle-case-row",
            'row "' + record.id + '" attests ' + record.cases.length + ' canonical cases in one bundle; each required case needs its own accepted, case-bound row',
          );
        }
      }
    }
    const casesComplete = expectedCases.length === 0 || expectedCases.every((caseId) => casesCovered.get(caseId)?.matched === true);
    const casesFailed = expectedCases.some((caseId) => casesCovered.get(caseId)?.failed === true);

    // H6: a DOC-005 mandatory gate carries two different evidence classes. Its
    // draft-persistence cases are satisfied only by a row with a real store
    // artifact and a fresh-store recovery assertion; its authorization-only
    // cases must declare their modeled provenance. A model-only row set cannot
    // satisfy the persistence half, and a real-adapter claim on an auth-only
    // case is rejected. Both requirements still need an individually bound row
    // per case (caseBound above).
    let doc005PersistenceComplete = true;
    let doc005PersistenceCovered = 0;
    let doc005PersistenceRequired = 0;
    if (kind === "doc005-mandatory" && required) {
      for (const caseId of DRAFT_PERSISTENCE_CASES) {
        if (!expectedCases.includes(caseId)) continue;
        doc005PersistenceRequired += 1;
        const bound = candidates.filter(
          (record) =>
            caseBound(record, caseId) &&
            satisfiedBy.includes(record),
        );
        if (bound.length > 0) {
          doc005PersistenceCovered += 1;
        } else {
          doc005PersistenceComplete = false;
          if (passCandidates.length > 0) {
            gateWarn(
              "missing-persistence-case",
              'DOC-005 persistence case "' + caseId + '" has no accepted, case-bound row carrying a real draft-store artifact and the "' +
                RECOVERY_ASSERTION_ID + '" assertion; a modeled row cannot satisfy it',
            );
          }
        }
      }
    }

    if (coreGate) {
      for (const record of passCandidates) {
        const retired = retiredFixtureFor(gateFormat, record.fixture);
        if (retired) {
          gateWarn('core-row-uses-retired-fixture',
            'row "' + record.id + '" names the retired fixture ' + retired.from + ' for ' + gateFormat +
            '; this gate is rebound to ' + retired.to + ' (the retired fixture may stay as supportingFixture, and the row cannot satisfy the gate)');
        }
      }
    }
    const browserCoverage = (coreGate ? REQUIRED_GATE_BROWSERS : []).map((pair) => ({
      os: pair.os,
      browser: pair.browser,
      matched: satisfiedBy.some((record) => record.platformOs === pair.os && record.platformBrowser === pair.browser),
    }));
    const browsersComplete = browserCoverage.every((entry) => entry.matched);
    if (coreGate && passCandidates.length > 0 && !browsersComplete) {
      const missing = browserCoverage.filter((entry) => !entry.matched).map((entry) => entry.os + "/" + entry.browser);
      gateWarn(
        "missing-required-browser",
        'gate "' + id + '" needs an accepted row run in the Orca embedded browser on Windows for its own format; installed Windows Chrome/Edge and macOS/Safari never substitute; missing ' + missing.join(", "),
      );
    }

    const gateSatisfied =
      satisfiedBy.length > 0 && (!coreGate || browsersComplete) && casesComplete && doc005PersistenceComplete;
    let state;
    if (gateSatisfied) state = "satisfied";
    else if (gate?.platform && deferredPlatforms.has(String(gate.platform).toLowerCase())) state = "deferred";
    else if (casesFailed || candidates.some((record) => record.status === "FAIL")) state = "failed";
    else if (
      candidates.length > 0 &&
      !gate?.platform &&
      candidates.every((record) => record.platformOs && deferredPlatforms.has(record.platformOs))
    ) {
      state = "deferred";
    } else if (candidates.some((record) => record.status === "BLOCKED")) state = "blocked";
    else state = "pending";

    gateResults.push({
      id: id ?? "gate[" + index + "]",
      kind,
      format: gateFormat,
      required,
      level,
      platform: gate?.platform ?? null,
      adapter: adapterRequired,
      operationEvidence: opRequired,
      state,
      rowIds: ids,
      satisfiedBy: satisfiedBy.map((record) => record.id),
      requiredAssertions,
      requiredCases: canonicalCases,
      casesCovered: canonicalCases.filter((caseId) => casesCovered.get(caseId)?.matched === true).length,
      casesRequired: canonicalCases.length,
      persistenceCasesCovered: doc005PersistenceCovered,
      persistenceCasesRequired: doc005PersistenceRequired,
      browsers: browserCoverage,
    });
  });

  const coreGateResults = gateResults.filter((gate) => gate.kind === "core-cycle" && gate.required);
  const coreCoverage = [];
  for (const format of REQUIRED_FORMATS) {
    const gate = coreGateResults.find((entry) => entry.format === format);
    for (const pair of REQUIRED_GATE_BROWSERS) {
      const matched = Boolean(gate?.browsers?.some((entry) => entry.os === pair.os && entry.browser === pair.browser && entry.matched));
      coreCoverage.push({ format, os: pair.os, browser: pair.browser, matched });
    }
  }

  for (const kind of REQUIRED_GATE_KINDS) {
    if (!gateResults.some((gate) => gate.kind === kind && gate.required)) {
      add("error", "missing-required-gate-kind", 'required gate kind "' + kind + '" is absent');
    }
  }
  for (const format of REQUIRED_FORMATS) {
    if (!gateResults.some((gate) => gate.kind === "core-cycle" && gate.format === format && gate.required)) {
      add("error", "missing-core-format", 'no required core-cycle gate covers format "' + format + '"');
    }
  }

  // --- Q1-B coverage, pilot readiness and declared decision ----------------
  const q1b = registry.q1b;
  let q1bSatisfied = false;
  if (!isPlainObject(q1b)) {
    add("error", "missing-q1b", "registry.q1b is required: Q1-B pilot coverage stays a pilot requirement");
  } else {
    if (q1b.required !== true) {
      add("warning", "q1b-required", "registry.q1b.required should be true (Q1-B is a confirmed pilot requirement)");
    }
    for (const key of ["capabilityTotal", "verifiedOnWeb", "verifiedOnDesktop"]) {
      if (!Number.isInteger(q1b[key]) || q1b[key] < 0) {
        add("error", "q1b-coverage", "registry.q1b." + key + " must be a non-negative integer");
      } else if (Number.isInteger(q1b.capabilityTotal) && q1b[key] > q1b.capabilityTotal) {
        add("error", "q1b-coverage", "registry.q1b." + key + " exceeds capabilityTotal");
      }
    }
    q1bSatisfied =
      q1b.capabilityTotal > 0 &&
      q1b.verifiedOnWeb === q1b.capabilityTotal &&
      q1b.verifiedOnDesktop === q1b.capabilityTotal;
  }

  // Pilot readiness is a separate, human decision; counts alone never imply it.
  const pilot = registry.pilot;
  if (isPlainObject(pilot)) {
    if (isNonEmptyString(pilot.status) && !PILOT_STATUSES.includes(pilot.status)) {
      add("error", "pilot-status-invalid", "registry.pilot.status must be one of " + PILOT_STATUSES.join(", "));
    }
    if (pilot.ready === true && pilot.status !== "ready") {
      add(
        "error",
        "pilot-ready-without-basis",
        'registry.pilot.ready is true while status is "' + (pilot.status ?? "(none)") + '"; pilot readiness needs an explicit ready decision',
      );
    }
    if (pilot.ready === true && !isNonEmptyString(pilot.basis)) {
      add("error", "pilot-ready-without-basis", "registry.pilot.ready is true without a recorded basis");
    }
  }

  const decision = registry.decision;
  if (isPlainObject(decision) && !DECISIONS.includes(decision.value)) {
    add("error", "decision-invalid", "registry.decision.value must be one of " + DECISIONS.join(", "));
  }

  findings.push(...extraFindings);
  return finish(findings, rowRecords, gateResults, q1b, requireGo, q1bSatisfied, decision, pilot, coreCoverage, deferredBrowsers, rebinds);
}

/**
 * Finalise the result. Consistency findings (including the stale-decision
 * warning) are appended before errors/warnings/counts are derived, so the
 * published JSON, counts and text report all agree.
 */
function finish(findings, rowRecords, gateResults, q1b, requireGo, q1bSatisfied = false, decision = null, pilot = null, coreCoverage = [], deferredBrowsers = null, fixtureRebinds = []) {
  const requiredGates = gateResults.filter((gate) => gate.required);
  const errorsBefore = findings.filter((entry) => entry.severity === "error");
  const valid = errorsBefore.length === 0;
  // G0 go depends only on valid required G0 gates; never on declared counts.
  const go = valid && requiredGates.length > 0 && requiredGates.every((gate) => gate.state === "satisfied");
  const reportStatus =
    requiredGates.length > 0 && requiredGates.every((gate) => gate.state !== "pending") ? "COMPLETE" : "INCOMPLETE";

  const noGoReasons = [];
  for (const gate of requiredGates) {
    if (gate.state === "satisfied") continue;
    noGoReasons.push({
      code: "gate-" + gate.state,
      message:
        'required gate "' + gate.id + '" (' + gate.kind + (gate.format && gate.format !== "n/a" ? " " + gate.format : "") + ") is " + gate.state + " at level " + gate.level + "; rows: " + gate.rowIds.join(", "),
    });
  }
  for (const error of errorsBefore) noGoReasons.push({ code: error.code, message: error.message });
  // Q1-B and pilot coverage are reported separately and never gate G0 go.
  if (!q1bSatisfied && isPlainObject(q1b)) {
    noGoReasons.push({
      code: "q1b-coverage-incomplete-reported",
      message:
        "Q1-B pilot coverage incomplete (reported, not a G0 gate): " +
        (q1b.verifiedOnWeb ?? "?") + "/" + (q1b.capabilityTotal ?? "?") + " verified on web, " +
        (q1b.verifiedOnDesktop ?? "?") + "/" + (q1b.capabilityTotal ?? "?") + " on desktop",
    });
  }
  const pilotReady = isPlainObject(pilot) ? pilot.ready === true : false;
  if (isPlainObject(pilot) && !pilotReady) {
    noGoReasons.push({
      code: "pilot-readiness-pending",
      message:
        "pilot readiness is " + (pilot.status ?? "not-assessed") +
        " (reported, not a G0 gate); full pilot acceptance also needs deferred Mac QA, product integration and the advanced port",
    });
  }

  if (isPlainObject(decision) && DECISIONS.includes(decision.value)) {
    if (decision.value === "GO" && !go) {
      findings.push({ severity: "warning", code: "stale-decision", message: "registry.decision records GO while the verified gates are not satisfied" });
    }
    if (decision.value === "NO-GO" && go) {
      findings.push({ severity: "warning", code: "stale-decision", message: "registry.decision records NO-GO while every required gate is now satisfied" });
    }
  }

  const errors = findings.filter((entry) => entry.severity === "error");
  const warnings = findings.filter((entry) => entry.severity === "warning");
  const counts = {
    rows: rowRecords.length,
    accepted: rowRecords.filter((record) => record.accepted).length,
    pending: rowRecords.filter((record) => record.status === "PENDING").length,
    failed: rowRecords.filter((record) => record.status === "FAIL").length,
    blocked: rowRecords.filter((record) => record.status === "BLOCKED").length,
    notApplicable: rowRecords.filter((record) => record.status === "NOT_APPLICABLE").length,
    gates: gateResults.length,
    gatesRequired: requiredGates.length,
    gatesSatisfied: requiredGates.filter((gate) => gate.state === "satisfied").length,
    gatesPending: requiredGates.filter((gate) => gate.state === "pending").length,
    gatesFailed: requiredGates.filter((gate) => gate.state === "failed").length,
    gatesDeferred: requiredGates.filter((gate) => gate.state === "deferred").length,
    gatesBlocked: requiredGates.filter((gate) => gate.state === "blocked").length,
    errors: errors.length,
    warnings: warnings.length,
  };

  return {
    valid,
    go,
    noGo: !go,
    reportStatus,
    requireGo: Boolean(requireGo),
    q1bSatisfied,
    pilotReady,
    pilot: isPlainObject(pilot) ? pilot : null,
    counts,
    gates: gateResults,
    coreCoverage,
    deferredBrowsers,
    fixtureRebinds,
    rows: rowRecords.map((record) => ({
      id: record.id,
      status: record.status,
      format: record.format,
      level: record.level,
      evidenceLevel: record.evidenceLevel,
      provides: record.provides,
      operationId: record.operationId,
      accepted: record.accepted,
    })),
    q1b: isPlainObject(q1b) ? q1b : null,
    noGoReasons,
    findings,
    errors,
    warnings,
  };
}

export function formatReport(result, registryPath = "") {
  const lines = [];
  lines.push("evidence register: " + registryPath);
  lines.push(
    "valid: " + (result.valid ? "yes" : "no") + " | report: " + result.reportStatus + " | G0 decision: " + (result.go ? "GO" : "NO-GO"),
  );
  lines.push(
    "rows: " + result.counts.rows + " (accepted " + result.counts.accepted + ", pending " + result.counts.pending + ", failed " + result.counts.failed + ", blocked " + result.counts.blocked + ")",
  );
  lines.push(
    "gates: " + result.counts.gatesRequired + " required (satisfied " + result.counts.gatesSatisfied + ", pending " + result.counts.gatesPending + ", failed " + result.counts.gatesFailed + ", deferred " + result.counts.gatesDeferred + ")",
  );
  if (result.q1b) {
    lines.push(
      "q1b (pilot, reported): " + result.q1b.verifiedOnWeb + "/" + result.q1b.capabilityTotal + " on web, " + result.q1b.verifiedOnDesktop + "/" + result.q1b.capabilityTotal + " on desktop; q1bSatisfied=" + result.q1bSatisfied,
    );
  }
  lines.push("pilot readiness: " + (result.pilotReady ? "ready" : "not ready") + " (separate from G0)");
  if (Array.isArray(result.fixtureRebinds) && result.fixtureRebinds.length) {
    lines.push("fixture rebinds: " + result.fixtureRebinds.map((entry) => entry.format + " " + entry.from + " -> " + entry.to).join(", "));
  }
  if (Array.isArray(result.coreCoverage) && result.coreCoverage.length) {
    const missing = result.coreCoverage.filter((entry) => !entry.matched);
    lines.push("core windows coverage: " + (result.coreCoverage.length - missing.length) + "/" + result.coreCoverage.length + " Windows browser/format pairs satisfied");
  }
  if (isPlainObject(result.deferredBrowsers)) {
    lines.push(
      "core browser scope: " + result.deferredBrowsers.requiredGateBrowsers.map((entry) => entry.browser + "/" + entry.os).join(", ") +
        " only, by the G0 decision of " + result.deferredBrowsers.decision + " (" +
        result.deferredBrowsers.rule + "); deferred installed browsers: " +
        result.deferredBrowsers.deferredGateBrowsers.map((entry) => entry.browser + "/" + entry.os).join(", "),
    );
  }
  if (typeof result.artifactsChecked === "number") {
    lines.push("artifacts: " + result.artifactsChecked + " byte-checked");
  }
  if (result.noGoReasons.length) {
    lines.push("blocking and reported reasons:");
    for (const reason of result.noGoReasons) lines.push("  - [" + reason.code + "] " + reason.message);
  }
  if (result.errors.length) {
    lines.push("errors:");
    for (const error of result.errors) lines.push("  - [" + error.code + "] " + error.message);
  }
  if (result.warnings.length) {
    lines.push("warnings:");
    for (const warning of result.warnings) lines.push("  - [" + warning.code + "] " + warning.message);
  }
  lines.push(result.valid ? "register is valid." : "register is INVALID.");
  return lines.join(NL) + NL;
}
export function parseArgs(argv) {
  const options = { registry: null, roots: [], requireGo: false, checkArtifacts: true, json: false, repositoryRoot: null, fixtureManifest: null };
  const errors = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--registry") options.registry = argv[(index += 1)];
    else if (arg === "--root") {
      options.repositoryRoot = argv[(index += 1)];
      options.roots.push(options.repositoryRoot);
    } else if (arg === "--artifacts") options.roots.push(argv[(index += 1)]);
    else if (arg === "--fixture-manifest") options.fixtureManifest = argv[(index += 1)];
    else if (arg.startsWith("--fixture-manifest=")) options.fixtureManifest = arg.slice("--fixture-manifest=".length);
    else if (arg.startsWith("--registry=")) options.registry = arg.slice("--registry=".length);
    else if (arg.startsWith("--root=")) options.roots.push(arg.slice("--root=".length));
    else if (arg === "--require-go") options.requireGo = true;
    else if (arg === "--no-artifacts") options.checkArtifacts = false;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else errors.push("unknown argument: " + arg);
  }
  if (!options.help && !isNonEmptyString(options.registry)) errors.push("--registry <file> is required");
  if (options.roots.some((entry) => !isNonEmptyString(entry))) errors.push("--root/--artifacts needs a path");
  if (options.fixtureManifest !== null && !isNonEmptyString(options.fixtureManifest)) errors.push("--fixture-manifest needs a path");
  return { options, errors };
}

export async function runCli(argv, io = {}) {
  const write = io.stdout ?? ((chunk) => process.stdout.write(chunk));
  const writeErr = io.stderr ?? ((chunk) => process.stderr.write(chunk));
  const { options, errors } = parseArgs(argv);
  if (options.help) {
    write(USAGE + NL);
    return 0;
  }
  if (errors.length) {
    writeErr("verify-evidence: " + errors.join("; ") + NL + USAGE + NL);
    return 2;
  }
  if (options.checkArtifacts && options.roots.length === 0) {
    writeErr("verify-evidence: --root or --artifacts is required unless --no-artifacts is used" + NL);
    return 2;
  }
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(path.resolve(options.registry), "utf8"));
  } catch (error) {
    writeErr("verify-evidence: cannot read registry " + options.registry + ": " + error.message + NL);
    return 2;
  }

  // The fixture manifest is authoritative for which fixture ids exist: a row (or a rebind) that names an
  // id the manifest does not have is an error, not a silent pass. Without a readable manifest the check
  // is reported as one warning rather than skipped quietly.
  const manifestPath = options.fixtureManifest ?? path.join(options.repositoryRoot ?? ".", "docs", "office", "g0", "fixtures", "manifest.json");
  let fixtureIds = null;
  let fixtureManifestFinding = null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const ids = Array.isArray(manifest.fixtures) ? manifest.fixtures.map((entry) => entry?.id).filter((id) => isNonEmptyString(id)) : [];
    if (ids.length === 0) throw new Error("no fixture ids in " + manifestPath);
    fixtureIds = ids;
  } catch (error) {
    fixtureManifestFinding = {
      severity: "warning",
      code: "fixture-manifest-unreadable",
      message: "the fixture manifest could not be read (" + manifestPath + ": " + String(error.message ?? error) + "), so row fixture ids were not checked against it",
    };
    fixtureIds = null;
  }
  const structural = validateRegistry(registry, { requireGo: options.requireGo, fixtureIds, fixtureManifestFinding });
  let artifactFindings = [];
  let artifactsChecked = 0;
  let artifactIdentities = new Map();
  if (options.checkArtifacts && structural.valid) {
    const artifacts = verifyArtifacts(registry, { roots: options.roots, registryPath: options.registry });
    artifactFindings = artifacts.findings;
    artifactsChecked = artifacts.checked;
    artifactIdentities = artifacts.identityByRow ?? new Map();
  }
  const result = validateRegistry(registry, {
    requireGo: options.requireGo,
    fixtureIds,
    fixtureManifestFinding,
    artifactFindings,
    artifactIdentities,
  });
  result.artifactsChecked = artifactsChecked;

  if (options.json) {
    write(
      JSON.stringify(
        {
          registry: options.registry,
          valid: result.valid,
          go: result.go,
          reportStatus: result.reportStatus,
          q1bSatisfied: result.q1bSatisfied,
          pilotReady: result.pilotReady,
          counts: result.counts,
          q1b: result.q1b,
          pilot: result.pilot,
          gates: result.gates,
          coreCoverage: result.coreCoverage,
          deferredBrowsers: result.deferredBrowsers,
          noGoReasons: result.noGoReasons,
          errors: result.errors,
          warnings: result.warnings,
        },
        null,
        2,
      ) + NL
    );
  } else {
    write(formatReport(result, options.registry));
  }

  if (!result.valid) return 1;
  if (options.requireGo && !result.go) return 1;
  return 0;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write("verify-evidence: unexpected failure: " + (error?.stack ?? error) + NL);
      process.exit(2);
    },
  );
}
