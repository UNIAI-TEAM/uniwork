#!/usr/bin/env node
/**
 * UNI-670 / DOC-006 - tests for the G0 evidence-register verifier (r2).
 *
 * Run from the repository root with Node 22:
 *
 *   node --test scripts/office-g0/verify-evidence.test.mjs
 *
 * The tests build real objects and write real bytes under a temp directory; they
 * do not assert copies of constants. They cover the properties that matter:
 *
 *   1. an honest, complete NO-GO register is valid and fails --require-go;
 *   2. a truly sufficient SYNTHETIC G0 fixture reaches go=true while pilot
 *      readiness stays pending;
 *   3. removing or mismatching any single requirement fails: a missing Orca
 *      embedded-browser row, a retargeted format or operation, a viewer/annotation
 *      PDF, an XLSX formula without a numeric recalc, a registry-as-output
 *      artifact, a missing/failed case, a model row posing as real adapter, a
 *      tampered artifact, a reversed deferral and a stale decision.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ACCEPTED_BROWSER_BRIDGE_CONTRACTS,
  AUTH_MODE_MODELED,
  DEFERRED_GATE_BROWSERS,
  DRAFT_PERSISTENCE_CASES,
  ORCA_EMBEDDED_BROWSER,
  RECOVERY_ASSERTION_ID,
  REQUIRED_ASSERTIONS,
  REQUIRED_FAULT_CASES,
  REQUIRED_FORMATS,
  REQUIRED_GATE_BROWSERS,
  REQUIRED_MANDATORY_CASES,
  formatReport,
  isContained,
  runCli,
  sha256Of,
  validateRegistry,
  verifyArtifacts,
} from "./verify-evidence.mjs";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "uniwork-evidence-"));

const writeArtifact = (dir, relative, bytes) => {
  const absolute = path.join(dir, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, bytes);
  return { role: "transcript", path: relative, sha256: sha256Of(bytes).toUpperCase(), bytes: bytes.length, ref: relative };
};

const writeBytes = (dir, relative, bytes, role, ref) => {
  const absolute = path.join(dir, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, bytes);
  return { role, path: relative, sha256: sha256Of(bytes).toUpperCase(), bytes: bytes.length, ref: ref ?? relative };
};

const codesOf = (result) => new Set(result.findings.map((entry) => entry.code));

const BASELINE = "97b4fa5946fc2ccb208d626de45a13dd0805d546";

/** The browser-cycle contract string a synthetic core row names (CONTRACT-v1
 *  section 2). A fixture value, never a claim that a real save carried it. */
const BROWSER_BRIDGE_CONTRACT = ACCEPTED_BROWSER_BRIDGE_CONTRACTS[0];
/** Fixture markers: zero values that cannot be mistaken for an observed
 *  Orca or Chromium version. */
const SYNTHETIC_ORCA_VERSION = "0.0.0-synthetic-orca";
const SYNTHETIC_BROWSER_VERSION = "0.0.0-synthetic-embedded-chromium";

/** Assertions every required assertion id of a format, marked passed. */
const assertionsFor = (format, override = {}) =>
  REQUIRED_ASSERTIONS[format].map((id) => ({ id, status: override[id] ?? "passed" }));

/** Core-row artifacts: an immutable input, a persisted output, an independent
 *  extraction, and a transcript, plus pre/post extraction and render for PDF.
 *  Each row runs its own cycle directory, so no file is shared between the
 *  Orca gate row and the legacy installed-browser row of the same format, and
 *  every ref is fixture/format/operation. */
const coreArtifacts = (dir, format, operationId, fixture, browser) => {
  const dirName = "cycles/" + format + "-" + browser;
  const ref = fixture + "/" + format + "/" + operationId;
  const base = [
    writeBytes(dir, dirName + "/in.bin", "input:" + format + ":" + browser, "immutable-input", ref),
    writeBytes(dir, dirName + "/out.bin", "output:" + format + ":" + operationId + ":" + browser, "persisted-output", ref),
    writeBytes(dir, dirName + "/extract.json", "extract:" + format + ":" + browser, "extraction-evidence", ref),
    writeBytes(dir, dirName + "/log.txt", "log:" + format + ":" + browser, "transcript", ref),
  ];
  if (format === "pdf") {
    base.push(writeBytes(dir, dirName + "/pre-extract.json", "pre:" + browser, "pre-edit-extraction", ref));
    base.push(writeBytes(dir, dirName + "/post-extract.json", "post:" + browser, "post-edit-extraction", ref));
    base.push(writeBytes(dir, dirName + "/pre-render.png", "pre-render:" + browser, "pre-edit-render", ref));
    base.push(writeBytes(dir, dirName + "/post-render.png", "post-render:" + browser, "post-edit-render", ref));
  }
  return base;
};

const coreCase = (format) => {
  const operationId = {
    docx: "open-edit-text-save-reopen",
    xlsx: "open-edit-cell-recalculate-save-reopen",
    pptx: "edit-text-image-shape-save-reopen",
    pdf: "replace-text-and-image-save-reopen",
    md: "edit-source-save-reopen",
    html: "edit-source-save-reopen-isolated-preview",
  }[format];
  return { format, operationId, fixture: "F-" + format.toUpperCase() + "-SYNTH" };
};

const coreRow = (dir, format, browser, browserVersion, extra = {}) => {
  const { operationId, fixture } = coreCase(format);
  return {
    id: "E-" + format.toUpperCase() + "-" + browser.toUpperCase(),
    kind: "core-cycle",
    capability: format + "-editor-cycle",
    format,
    operation: "synthetic already-attested cycle; not a real run",
    operationId,
    status: "PASS",
    result: "pass",
    level: "browser-real",
    provides: ["editor-cycle", "engine-operation"],
    operationEvidence: "byte-verified-operation",
    adapter: "real",
    uiKind: "real-editor",
    platform: {
      os: "windows",
      browser,
      browserVersion,
      ...(browser === ORCA_EMBEDDED_BROWSER
        ? { orcaVersion: SYNTHETIC_ORCA_VERSION, embeddedBrowser: ORCA_EMBEDDED_BROWSER }
        : {}),
    },
    runtime: { node: process.versions.node },
    engine: { name: "@genoffice/" + format + "/engine", version: "0.1.0-synthetic" },
    protocolVersion: BROWSER_BRIDGE_CONTRACT,
    fixture,
    source: { kind: "repo-commit", id: "uniwork-baseline", commit: BASELINE },
    command: "synthetic validator fixture only",
    cwd: "synthetic/test",
    expected: { result: "synthetic oracle", oracle: "synthetic oracle" },
    actual: "synthetic; not a real browser run",
    assertions: assertionsFor(format),
    cases: [],
    artifacts: coreArtifacts(dir, format, operationId, fixture, browser),
    ...extra,
  };
};

const contractRow = (dir, kind, caseIds, overrides = {}) => {
  const isFault = kind === "doc004-fault";
  const caseId = caseIds[0];
  // DOC-005 separates the durable local draft store from the modeled remote
  // authorization. A draft-persistence case carries a real store artifact plus
  // the fresh-store recovery assertion; an authorization-only case declares its
  // modeled provenance and carries no real-adapter claim.
  const isPersistence = kind === "doc005-mandatory" && DRAFT_PERSISTENCE_CASES.includes(caseId);
  const isAuthOnly = kind === "doc005-mandatory" && !isPersistence;
  const assertions = isPersistence
    ? [{ id: RECOVERY_ASSERTION_ID, status: "passed" }]
    : [];
  return {
    id: "E-" + kind.toUpperCase() + "-" + caseId.toUpperCase(),
    kind,
    capability: isFault ? "engine-contract-faults" : "login-sync-mandatory-cases",
    format: "n/a",
    operation: "synthetic contract case run; not a real run",
    operationId: isFault ? "fault-cases-real-adapter" : "mandatory-login-sync-cases",
    status: "PASS",
    result: "pass",
    level: "harness",
    provides: ["contract-model"],
    operationEvidence: isFault || isPersistence ? "real-adapter-operation" : "modeled-operation",
    adapter: isFault || isPersistence ? "real" : "model",
    uiKind: "none",
    platform: { os: "windows", browser: "none", browserVersion: null },
    runtime: { node: process.versions.node },
    engine: isPersistence ? { name: "local-draft-store", version: "0.1.0-synthetic" } : { name: null, version: null },
    protocolVersion: "synthetic-protocol-v1",
    fixture: null,
    authMode: isAuthOnly ? AUTH_MODE_MODELED : null,
    draftStore: isPersistence ? "reference-local-store" : null,
    source: isFault || isPersistence
      ? { kind: "repo-commit", id: "uni667-adapter", commit: "9".repeat(40) }
      : { kind: "repo-commit", id: "uni669-harness", commit: "8".repeat(40) },
    command: "synthetic validator fixture only",
    cwd: "synthetic/test",
    expected: { result: "synthetic oracle", oracle: "synthetic oracle" },
    actual: "synthetic; not a real harness run",
    assertions,
    cases: caseIds,
    artifacts: [
      writeBytes(dir, "contract/" + caseId + ".log", "transcript:" + caseId, "transcript", caseId),
      writeBytes(dir, "contract/" + caseId + ".json", "state:" + caseId, "persisted-output", caseId),
    ],
    ...overrides,
  };
};

/** A minimal, sufficient SYNTHETIC G0 register. Every required assertion and
 *  case is present and passed; every format carries the required Orca
 *  embedded-browser row plus a legacy installed-Chrome non-required row. This
 *  is a fixture, not a claim that any real cycle ran. */
function buildSyntheticGoFixture(dir) {
  const coreRows = [];
  for (const format of REQUIRED_FORMATS) {
    // The gate row: the Orca embedded browser on Windows (decision of
    // 2026-09-25), carrying the Orca application version, the embedded
    // Chromium version and the contract string the lab adapter implements.
    coreRows.push(coreRow(dir, format, ORCA_EMBEDDED_BROWSER, SYNTHETIC_BROWSER_VERSION));
    // A legacy installed-Chrome row of the same format, referenced by the same
    // gate: it is an accepted row in its own right, but it cannot satisfy the
    // required Orca browser pair, which is what the cases below pin.
    coreRows.push(coreRow(dir, format, "chrome", "0.0.0-synthetic-chrome"));
  }
  const faultRows = REQUIRED_FAULT_CASES.map((caseId) => contractRow(dir, "doc004-fault", [caseId]));
  const mandRows = REQUIRED_MANDATORY_CASES.map((caseId) => contractRow(dir, "doc005-mandatory", [caseId]));
  const gates = REQUIRED_FORMATS.map((format) => ({
    id: "G0-CORE-" + format.toUpperCase(),
    kind: "core-cycle",
    format,
    required: true,
    level: "browser-real",
    provides: ["editor-cycle"],
    operationEvidence: "byte-verified-operation",
    adapter: "real",
    rows: ["E-" + format.toUpperCase() + "-ORCA", "E-" + format.toUpperCase() + "-CHROME"],
    requiredBrowsers: [{ os: "windows", browser: ORCA_EMBEDDED_BROWSER }],
  }));
  gates.push({
    id: "G0-DOC004-FAULT",
    kind: "doc004-fault",
    format: "n/a",
    required: true,
    level: "harness",
    provides: ["contract-model"],
    operationEvidence: "real-adapter-operation",
    adapter: "real",
    rows: faultRows.map((row) => row.id),
    requiredCases: [...REQUIRED_FAULT_CASES],
  });
  gates.push({
    id: "G0-DOC005-MANDATORY",
    kind: "doc005-mandatory",
    format: "n/a",
    required: true,
    level: "harness",
    provides: ["contract-model"],
    operationEvidence: "modeled-operation",
    adapter: "model",
    rows: mandRows.map((row) => row.id),
    requiredCases: [...REQUIRED_MANDATORY_CASES],
  });
  gates.push({ id: "G0-PILOT-INVENTORY", kind: "pilot-inventory", format: "n/a", required: false, level: "source-read", provides: ["inventory"], operationEvidence: "source-inspection", adapter: "none", rows: [] });
  return {
    schemaVersion: 1,
    kind: "uniwork-office-evidence-register",
    issue: "UNI-670",
    baseline: {
      repoCommit: BASELINE,
      tree: "b49b777acdcd642c223fb5657e664476b292dba7",
      lockfile: { path: "pnpm-lock.yaml", sha256: "9a82bfaefe238f9f03654d006af2be2822f94e262a693a3879e95a25fbc220e2" },
      runtime: { node: process.versions.node, packageManager: "pnpm@10.28.2" },
    },
    sources: [
      { id: "uniwork-baseline", kind: "repo-commit", commit: BASELINE },
      { id: "uni667-adapter", kind: "repo-commit", commit: "9".repeat(40), allowNonBaseline: true, reason: "synthetic adapter source" },
      { id: "uni669-harness", kind: "repo-commit", commit: "8".repeat(40), allowNonBaseline: true, reason: "synthetic harness source" },
    ],
    deferrals: [
      { platform: "macos", reason: "QA-01 real Mac check deferred", issue: "UNI-671" },
      { platform: "safari", reason: "WebKit is not a Safari substitute", issue: "UNI-671" },
    ],
    browserDeferrals: [
      { browser: "chrome", os: "windows", reason: "synthetic fixture: installed Chrome is not required at G0", issue: "UNI-671", phase: "later phase" },
      { browser: "edge", os: "windows", reason: "synthetic fixture: installed Edge is not required at G0", issue: "UNI-671", phase: "later phase" },
      { browser: "safari", os: "macos", reason: "synthetic fixture: macOS/Safari stays a deferred real-device check", issue: "UNI-671", phase: "later phase" },
    ],
    rows: [...coreRows, ...faultRows, ...mandRows],
    gates,
    q1b: { required: true, capabilityTotal: 95, verifiedOnWeb: 0, verifiedOnDesktop: 0 },
    pilot: { ready: false, status: "not-assessed", basis: "synthetic fixture; pilot not assessed" },
    decision: { value: "GO", decidedBy: "synthetic fixture" },
  };
}

const check = (registry, dir) => {
  const artifacts = verifyArtifacts(registry, { roots: [dir] });
  const result = validateRegistry(registry, {
    artifactFindings: artifacts.findings,
    artifactIdentities: artifacts.identityByRow,
  });
  result.artifactsChecked = artifacts.checked;
  return result;
};

test("synthetic fixture: a sufficient G0 register reaches go=true while pilot stays pending", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const result = check(registry, dir);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.go, true, JSON.stringify(result.noGoReasons, null, 2));
  assert.equal(result.q1bSatisfied, false, "Q1-B counts must not be required for G0 go");
  assert.equal(result.pilotReady, false, "pilot readiness stays pending");
  assert.equal(result.counts.gatesSatisfied, result.counts.gatesRequired);
  assert.equal(result.coreCoverage.every((entry) => entry.matched), true);
});

test("synthetic fixture: a Chrome-only core row set cannot satisfy the Orca browser pair", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  registry.rows = registry.rows.filter((row) => !(row.kind === "core-cycle" && row.platform.browser === ORCA_EMBEDDED_BROWSER));
  for (const gate of registry.gates) {
    if (gate.kind === "core-cycle") gate.rows = gate.rows.filter((id) => !id.endsWith("-ORCA"));
  }
  const result = check(registry, dir);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.go, false);
  assert.equal(result.coreCoverage.every((entry) => !entry.matched), true, JSON.stringify(result.coreCoverage));
  assert.ok(codesOf(result).has("missing-required-browser"), JSON.stringify([...codesOf(result)]));
});

test("synthetic fixture: a macOS/Safari-only core set does not satisfy a Windows gate", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  for (const row of registry.rows) {
    if (row.kind === "core-cycle") {
      row.platform = { os: "macos", browser: "safari", browserVersion: "17.0" };
    }
  }
  const result = check(registry, dir);
  assert.equal(result.go, false);
  assert.equal(result.gates.filter((gate) => gate.kind === "core-cycle").every((gate) => gate.state !== "satisfied"), true);
});

test("synthetic fixture: a retargeted format or operation is reported and does not satisfy the gate", () => {
  const dir = tempDir();
  const retargetFormat = buildSyntheticGoFixture(dir);
  for (const row of retargetFormat.rows) {
    if (row.kind === "core-cycle") row.format = "docx";
  }
  const formatResult = check(retargetFormat, dir);
  assert.equal(formatResult.go, false);
  assert.ok(codesOf(formatResult).has("row-gate-format-mismatch"), JSON.stringify([...codesOf(formatResult)]));

  const retargetOp = buildSyntheticGoFixture(dir);
  for (const row of retargetOp.rows) {
    if (row.kind === "core-cycle" && row.format === "pdf") row.operationId = "open-edit-text-save-reopen";
  }
  const opResult = check(retargetOp, dir);
  assert.equal(opResult.go, false);
  assert.ok(codesOf(opResult).has("row-gate-operation-mismatch"), JSON.stringify([...codesOf(opResult)]));
});

test("synthetic fixture: a viewer/annotation PDF does not qualify", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  for (const row of registry.rows) {
    if (row.kind === "core-cycle" && row.format === "pdf") {
      row.operationId = "open-viewer-annotation";
      row.assertions = [{ id: "annotation", status: "passed" }];
    }
  }
  const result = check(registry, dir);
  assert.equal(result.go, false);
  const codes = codesOf(result);
  assert.ok(codes.has("row-gate-operation-mismatch") || codes.has("missing-required-assertion"), JSON.stringify([...codes]));
});

test("synthetic fixture: XLSX without a numeric recalc assertion fails", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  for (const row of registry.rows) {
    if (row.kind === "core-cycle" && row.format === "xlsx") {
      row.assertions = assertionsFor("xlsx", { "formula-recalculated-numeric": "failed" });
    }
  }
  const result = check(registry, dir);
  assert.equal(result.go, false);
  assert.ok(codesOf(result).has("missing-required-assertion"), JSON.stringify([...codesOf(result)]));
});

test("synthetic fixture: the registry JSON cannot be a cycle output artifact", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  fs.writeFileSync(path.join(dir, "evidence-register.json"), JSON.stringify(registry));
  const bytes = fs.readFileSync(path.join(dir, "evidence-register.json"));
  for (const row of registry.rows) {
    if (row.kind === "core-cycle") {
      row.artifacts[0] = {
        role: "persisted-output",
        path: "evidence-register.json",
        sha256: sha256Of(bytes).toUpperCase(),
        bytes: bytes.length,
        ref: row.format,
      };
    }
  }
  const artifacts = verifyArtifacts(registry, { roots: [dir] });
  const result = validateRegistry(registry, { artifactFindings: artifacts.findings });
  assert.equal(result.valid, false);
  assert.ok(codesOf(result).has("artifact-is-registry"), JSON.stringify([...codesOf(result)]));
});

test("synthetic fixture: a missing or failed required case cannot hide behind a bundle PASS", () => {
  const dir = tempDir();
  const missing = buildSyntheticGoFixture(dir);
  const removedCase = REQUIRED_MANDATORY_CASES[0];
  missing.rows = missing.rows.filter((row) => !(row.kind === "doc005-mandatory" && row.cases.includes(removedCase)));
  for (const gate of missing.gates) {
    if (gate.kind === "doc005-mandatory") gate.rows = gate.rows.filter((id) => id !== "E-DOC005-MANDATORY-" + removedCase.toUpperCase());
  }
  const missingResult = check(missing, dir);
  assert.equal(missingResult.go, false);
  assert.ok(codesOf(missingResult).has("missing-required-case"), JSON.stringify([...codesOf(missingResult)]));

  const failed = buildSyntheticGoFixture(dir);
  for (const row of failed.rows) {
    if (row.kind === "doc004-fault") row.status = "BLOCKED";
  }
  const failedResult = check(failed, dir);
  assert.equal(failedResult.go, false);
});

test("synthetic fixture: a model row cannot pose as the real DOC-004 adapter", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  for (const row of registry.rows) {
    if (row.kind === "doc004-fault") {
      row.adapter = "model";
      row.operationEvidence = "modeled-operation";
    }
  }
  const result = check(registry, dir);
  assert.equal(result.go, false);
  const codes = codesOf(result);
  assert.ok(codes.has("gate-row-unsatisfied") || codes.has("missing-required-case"), JSON.stringify([...codes]));
});

test("synthetic fixture: a tampered artifact is rejected", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const intact = check(registry, dir);
  assert.equal(intact.valid, true, JSON.stringify(intact.errors, null, 2));
  const docxRow = registry.rows.find((row) => row.id === "E-DOCX-ORCA");
  const output = docxRow.artifacts.find((entry) => entry.role === "persisted-output");
  fs.writeFileSync(path.join(dir, output.path), "tampered bytes");
  const tampered = check(registry, dir);
  assert.equal(tampered.valid, false);
  assert.ok(codesOf(tampered).has("artifact-checksum-mismatch"), JSON.stringify([...codesOf(tampered)]));
});

test("an honest pending register is valid, INCOMPLETE and NO-GO, with Q1-B reported separately", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  for (const row of registry.rows) {
    row.status = "PENDING";
    row.reason = "not run yet";
    row.actual = null;
    row.artifacts = [];
    row.assertions = [];
    row.cases = [];
  }
  registry.decision.value = "NO-GO";
  const result = validateRegistry(registry, { requireGo: true });
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.go, false);
  assert.equal(result.reportStatus, "INCOMPLETE");
  const reasons = new Set(result.noGoReasons.map((reason) => reason.code));
  assert.ok(reasons.has("gate-pending"));
  assert.ok(reasons.has("q1b-coverage-incomplete-reported"));
  assert.ok(reasons.has("pilot-readiness-pending"));
});

test("a complete honest NO-GO register is valid and still fails --require-go", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  for (const row of registry.rows) {
    row.status = "BLOCKED";
    row.reason = "blocked by missing evidence";
    row.actual = null;
    row.artifacts = [];
    row.assertions = [];
    row.cases = [];
  }
  registry.decision.value = "NO-GO";
  const result = validateRegistry(registry, { requireGo: true });
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.reportStatus, "COMPLETE");
  assert.equal(result.go, false);
});

test("reversed macOS/Safari deferrals stay valid", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  registry.deferrals = [
    { platform: "safari", reason: "WebKit is not a Safari substitute", issue: "UNI-671" },
    { platform: "macos", reason: "QA-01 real Mac check deferred", issue: "UNI-671" },
  ];
  const result = validateRegistry(registry, {});
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
});

test("a stale decision is reported in findings, counts and text", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  registry.decision.value = "NO-GO";
  const result = check(registry, dir);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.go, true);
  assert.ok(result.warnings.some((entry) => entry.code === "stale-decision"), JSON.stringify(result.warnings));
  assert.ok(result.counts.warnings >= 1);
  assert.match(formatReport(result, "registry.json"), /stale-decision/);
});

test("an unknown status, level, duplicate id or gate row is rejected", () => {
  const duplicate = buildSyntheticGoFixture(tempDir());
  duplicate.rows[1].id = duplicate.rows[0].id;
  assert.ok(codesOf(validateRegistry(duplicate, {})).has("duplicate-row-id"));

  const unknownStatus = buildSyntheticGoFixture(tempDir());
  unknownStatus.rows[0].status = "MAYBE";
  assert.ok(codesOf(validateRegistry(unknownStatus, {})).has("unknown-status"));

  const unknownLevel = buildSyntheticGoFixture(tempDir());
  unknownLevel.rows[0].level = "vibes";
  assert.ok(codesOf(validateRegistry(unknownLevel, {})).has("unknown-level"));

  const unknownRow = buildSyntheticGoFixture(tempDir());
  unknownRow.gates[0].rows = ["NOPE"];
  assert.ok(codesOf(validateRegistry(unknownRow, {})).has("unknown-gate-row"));
});

test("a gate must enumerate the canonical cases and reject unknown ones", () => {
  const short = buildSyntheticGoFixture(tempDir());
  for (const gate of short.gates) {
    if (gate.kind === "doc005-mandatory") gate.requiredCases = ["same-base-saves"];
  }
  assert.ok(codesOf(validateRegistry(short, {})).has("required-cases-incomplete"));

  const invented = buildSyntheticGoFixture(tempDir());
  for (const gate of invented.gates) {
    if (gate.kind === "doc004-fault") gate.requiredCases = [...REQUIRED_FAULT_CASES, "invented-case"];
  }
  assert.ok(codesOf(validateRegistry(invented, {})).has("unknown-required-case"));
});

test("a required gate cannot demand product E2E at G0", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  registry.gates[0].level = "product-e2e";
  registry.gates[0].provides = ["product-e2e"];
  const result = validateRegistry(registry, {});
  assert.equal(result.valid, false);
  assert.ok(codesOf(result).has("g0-scope-violation"));
});

test("pilot readiness cannot be declared ready without a ready status and basis", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  registry.pilot = { ready: true, status: "pending" };
  const result = validateRegistry(registry, {});
  assert.equal(result.valid, false);
  assert.ok(codesOf(result).has("pilot-ready-without-basis"));
});

test("unknown and conflicting provenance are rejected", () => {
  const unknown = buildSyntheticGoFixture(tempDir());
  unknown.rows[0].source = { kind: "repo-commit", id: "invented", commit: "a".repeat(40) };
  assert.ok(codesOf(validateRegistry(unknown, {})).has("unknown-provenance"));

  const conflicting = buildSyntheticGoFixture(tempDir());
  conflicting.rows[0].source = { kind: "repo-commit", id: "uniwork-baseline", commit: "b".repeat(40) };
  const result = validateRegistry(conflicting, {});
  assert.equal(result.valid, false);
  assert.ok(codesOf(result).has("conflicting-provenance"));
});

test("a browser launch cannot satisfy an editor cycle", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  registry.rows[0].uiKind = "launch";
  const result = validateRegistry(registry, {});
  assert.equal(result.valid, false);
  const finding = result.findings.find((entry) => entry.code === "level-exceeds-evidence");
  assert.ok(finding);
  assert.match(finding.message, /browser-launch-is-not-an-editor-cycle/);
});

test("only the approved macOS/Safari deferral is possible", () => {
  const bad = buildSyntheticGoFixture(tempDir());
  bad.deferrals.push({ platform: "windows", reason: "not today", issue: "UNI-671" });
  const result = validateRegistry(bad, {});
  assert.equal(result.valid, false);
  assert.ok(codesOf(result).has("impossible-platform-deferral"));
});

test("isContained refuses a sibling directory that shares a name prefix", () => {
  assert.equal(isContained("/tmp/root", "/tmp/root/inside/file.txt", { caseInsensitive: false }), true);
  assert.equal(isContained("/tmp/root", "/tmp/root", { caseInsensitive: false }), true);
  assert.equal(isContained("/tmp/root", "/tmp/root-evil/file.txt", { caseInsensitive: false }), false);
  assert.equal(isContained("/tmp/root", "/tmp/other/file.txt", { caseInsensitive: false }), false);
});

test("an absent artifact withdraws acceptance", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  registry.rows[0].artifacts[0].path = "cycles/missing.bin";
  const artifacts = verifyArtifacts(registry, { roots: [dir] });
  assert.ok(artifacts.findings.some((entry) => entry.code === "artifact-missing"));
  const result = validateRegistry(registry, { artifactFindings: artifacts.findings });
  assert.equal(result.rows.find((entry) => entry.id === registry.rows[0].id).accepted, false);
});

test("an absolute path and a traversal escape are refused", () => {
  const root = tempDir();
  const outside = tempDir();
  const registry = buildSyntheticGoFixture(root);
  const escaped = writeArtifact(outside, "out.bin", "outside the root");
  registry.rows[0].artifacts[0] = { ...registry.rows[0].artifacts[0], path: escaped.path, sha256: escaped.sha256, bytes: escaped.bytes };
  registry.rows[0].artifacts[0].path = path.join(outside, "out.bin");
  assert.ok(verifyArtifacts(registry, { roots: [root] }).findings.some((entry) => entry.code === "artifact-path-absolute"));

  registry.rows[0].artifacts[0].path = path.join("..", path.basename(outside), "out.bin");
  const traversal = verifyArtifacts(registry, { roots: [root] });
  assert.ok(
    traversal.findings.some((entry) => entry.code === "artifact-path-escapes-root" || entry.code === "artifact-missing"),
    JSON.stringify(traversal.findings),
  );
});

test("runCli returns 0 for a valid NO-GO report but 1 under --require-go", async () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  registry.decision.value = "NO-GO";
  for (const row of registry.rows) {
    row.status = "PENDING";
    row.reason = "not run yet";
    row.actual = null;
    row.artifacts = [];
    row.assertions = [];
    row.cases = [];
  }
  const registryPath = path.join(dir, "registry.json");
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  let out = "";
  const io = { stdout: (chunk) => (out += chunk), stderr: (chunk) => (out += chunk) };

  const relaxed = await runCli(["--registry", registryPath, "--root", dir], io);
  assert.equal(relaxed, 0, out);
  assert.match(out, /NO-GO/);
  assert.match(out, /INCOMPLETE/);

  out = "";
  const strict = await runCli(["--registry", registryPath, "--root", dir, "--require-go"], io);
  assert.equal(strict, 1, "a NO-GO register must fail --require-go");

  out = "";
  const jsonRun = await runCli(["--registry", registryPath, "--root", dir, "--json"], io);
  assert.equal(jsonRun, 0, out);
  const parsed = JSON.parse(out);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.go, false);
  assert.equal(parsed.pilotReady, false);
});

test("runCli returns 1 for an invalid register and 2 for a bad invocation", async () => {
  const dir = tempDir();
  const registryPath = path.join(dir, "registry.json");
  const registry = buildSyntheticGoFixture(dir);
  registry.rows[0].status = "MAYBE";
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  let out = "";
  const io = { stdout: (chunk) => (out += chunk), stderr: (chunk) => (out += chunk) };

  assert.equal(await runCli(["--registry", registryPath, "--no-artifacts"], io), 1);
  assert.equal(await runCli(["--root", dir, "--no-artifacts"], io), 2);
  assert.equal(await runCli(["--registry", path.join(dir, "nope.json"), "--no-artifacts"], io), 2);
});

test("the shipped register validates as GO on attributable core rows while the recorded decision stays human-owned", () => {
  const registryPath = path.resolve("docs/office/g0/evidence-register.json");
  if (!fs.existsSync(registryPath)) return;
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const result = validateRegistry(registry, { requireGo: true });
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  // Integrated by the Advisor (g118): the six accepted core-cycle rows satisfy every required gate, so the
  // verifier computes GO. The recorded decision is human-owned ("pending human acceptance") and stays as it
  // was until a person records it; the verifier reports that as a stale-decision warning, never as GO text.
  assert.equal(result.go, true);
  assert.equal(result.pilotReady, false);
  assert.equal(result.counts.gatesRequired, 8);
  assert.equal(result.counts.gatesSatisfied, 8);
  if (registry.decision.value !== "GO") {
    assert.ok(
      result.warnings.some((entry) => entry.code === "stale-decision"),
      "a non-GO recorded decision over satisfied gates must be reported as stale",
    );
  }
  assert.equal(result.counts.rows, registry.rows.length);
  assert.deepEqual(
    result.gates
      .filter((gate) => gate.kind === "core-cycle")
      .map((gate) => gate.format)
      .sort(),
    [...REQUIRED_FORMATS].sort(),
  );

  // Every core-cycle row is a real Orca embedded-browser cycle: PASS, byte-verified, with the immutable
  // input and the durable reopened bytes, and it is the row its format gate is satisfied by. The launch
  // probe row stays pending.
  for (const row of registry.rows) {
    if (row.kind === "environment-probe") {
      assert.equal(row.status, "PENDING", row.id + " must stay pending until a real launch probe lands");
      assert.deepEqual(row.artifacts ?? [], [], row.id + " must not carry artifacts while pending");
    }
    if (row.kind === "core-cycle") {
      assert.equal(row.status, "PASS", row.id + " is an accepted core cycle");
      assert.ok((row.artifacts ?? []).some((art) => art.role === "immutable-input"), row.id + " must carry its immutable input");
      assert.ok((row.artifacts ?? []).some((art) => art.role === "persisted-output"), row.id + " must carry its durable reopened bytes");
      const gate = result.gates.find((entry) => entry.kind === "core-cycle" && entry.format === row.format);
      assert.ok(gate && gate.state === "satisfied" && (gate.satisfiedBy ?? []).includes(row.id), row.id + " must satisfy its format gate");
    }
  }

  // The accepted scoped DOCX/PDF/PPTX cycles are recorded as NON-GATE rows. This is
  // the honesty invariant of the reconciliation: they carry real platform-scoped
  // evidence, but no required gate may reference them, so no gate can be closed
  // by lane acceptance and the Windows-browser coverage stays at 0 of 12.
  const scopedRows = registry.rows.filter((row) => row.kind === "scoped-browser-cycle");
  assert.ok(scopedRows.length > 0, "the register must record the accepted scoped cycles");
  assert.equal(scopedRows.filter((row) => row.format === "pptx").length, 2);
  const gateRowIds = new Set(registry.gates.flatMap((gate) => gate.rows ?? []));
  for (const row of scopedRows) {
    assert.equal(row.status, "PASS", row.id + " is an accepted scoped cycle");
    assert.equal(row.level, "browser-real", row.id + " must stay at the browser-real level");
    assert.equal(row.adapter, "real", row.id + " must attest a real adapter");
    assert.equal(row.operationEvidence, "byte-verified-operation", row.id + " must be byte-verified");
    assert.equal(row.uiKind, "real-editor", row.id + " must be a real editor cycle");
    assert.equal(row.platform.os, "windows", row.id + " is a Windows lane result");
    assert.ok(
      (row.artifacts ?? []).length > 0 &&
        (row.artifacts ?? []).every((art) => art.sha256 && Number.isInteger(art.bytes) && art.bytes > 0),
      row.id + " must record byte size and sha256 for every artifact",
    );
    // A scoped cycle claims a persisted reopen, so it must carry the durable
    // bytes it reopened (persisted-output) and the immutable input it started
    // from. Byte size alone must never stand in for that evidence.
    assert.ok(
      (row.artifacts ?? []).some((art) => art.role === "persisted-output"),
      row.id + " must carry the durable reopened bytes as a persisted-output artifact",
    );
    assert.ok(
      (row.artifacts ?? []).some((art) => art.role === "immutable-input"),
      row.id + " must carry the immutable input it started from",
    );
    // A scoped row closes no gate and must never be promoted into one.
    assert.equal(gateRowIds.has(row.id), false, row.id + " must not be referenced by any required gate");
    // No honest versioned browser-path protocol exists, so none is claimed.
    assert.equal(row.protocolVersion, null, row.id + " must not claim a protocol version it did not traverse");
  }
  // The embedded-Chromium PDF row must never be relabelled as a missing
  // installed-browser run: it declares the embedded family and records the limit.
  const pdfScoped = scopedRows.find((row) => row.format === "pdf");
  assert.ok(pdfScoped, "the scoped PDF cycle must be recorded");
  assert.equal(pdfScoped.platform.browser, "chromium", "the scoped PDF row stays embedded Chromium");
  assert.match(
    (pdfScoped.limitations ?? []).join(" "),
    /embedded Chromium only/i,
    "the scoped PDF row must state that embedded Chromium is not the installed-browser matrix",
  );
  assert.match(
    (pdfScoped.limitations ?? []).join(" "),
    /image-changed is not evidenced/i,
    "the scoped PDF row must record the missing image-change evidence",
  );
  // Coverage comes from the core-cycle rows only: every required Windows pair is matched, and no scoped
  // row is referenced by any gate (checked above), so a scoped row never moves coverage.
  assert.ok(
    result.coreCoverage.length > 0 && result.coreCoverage.every((entry) => entry.matched === true),
    "every required Windows core-browser pair must be matched by a core-cycle row",
  );

  // Every PASS row must be attributable: DOC-004 PASS rows carry a real-adapter
  // artifact; DOC-005 PASS rows are either a draft-persistence row with real
  // durable bytes and the fresh-store recovery assertion, or an authorization
  // row that declares the modeled provenance explicitly.
  for (const row of registry.rows) {
    if (row.status !== "PASS") continue;
    assert.ok(row.kind !== "environment-probe", row.id + " must not pass before a real launch probe");
    assert.ok((row.artifacts ?? []).length > 0, row.id + " must carry at least one artifact");
    assert.ok(
      (row.artifacts ?? []).every((art) => art.sha256 && Number.isInteger(art.bytes) && art.bytes > 0),
      row.id + " must record byte size and sha256 for every artifact",
    );
    if (row.kind === "doc004-fault") {
      assert.equal(row.adapter, "real", row.id + " must attest on the real adapter");
      assert.equal(row.operationEvidence, "real-adapter-operation", row.id + " must record a real-adapter operation");
    }
    if (row.kind === "doc005-mandatory") {
      const persistence = (row.cases ?? []).some((entry) => DRAFT_PERSISTENCE_CASES.includes(entry));
      if (persistence) {
        assert.ok(
          (row.artifacts ?? []).some((art) => art.role === "persisted-output"),
          row.id + " must carry the durable draft bytes as a persisted-output artifact",
        );
        assert.equal(
          (row.assertions ?? []).find((entry) => entry.id === RECOVERY_ASSERTION_ID)?.status,
          "passed",
          row.id + " must record a passed fresh-store recovery assertion",
        );
      } else {
        assert.equal(row.authMode, AUTH_MODE_MODELED, row.id + " must declare the modeled auth provenance");
        assert.equal(row.adapter, "model", row.id + " is authorization-only and must not claim a real adapter");
      }
    }
  }
});

test("synthetic fixture: a gate and its rows cannot lower the DOC-004 canonical adapter floor", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  const gate = registry.gates.find((entry) => entry.kind === "doc004-fault");
  gate.adapter = "model";
  gate.operationEvidence = "modeled-operation";
  for (const row of registry.rows) {
    if (row.kind !== "doc004-fault") continue;
    row.adapter = "model";
    row.operationEvidence = "modeled-operation";
  }
  const result = validateRegistry(registry, {});
  const codes = codesOf(result);
  assert.equal(result.valid, false, JSON.stringify(result.errors, null, 2));
  assert.equal(result.go, false);
  assert.ok(codes.has("gate-floor-downgrade"), JSON.stringify([...codes]));
  assert.notEqual(result.gates.find((entry) => entry.kind === "doc004-fault").state, "satisfied");
});

test("synthetic fixture: adapter none on a required contract gate is illegal", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  registry.gates.find((entry) => entry.kind === "doc004-fault").adapter = "none";
  const result = validateRegistry(registry, {});
  assert.equal(result.valid, false);
  assert.equal(result.go, false);
  assert.ok(codesOf(result).has("gate-floor-downgrade"), JSON.stringify([...codesOf(result)]));
});

test("synthetic fixture: an omitted operation-evidence floor cannot be lowered by rows", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  const gate = registry.gates.find((entry) => entry.kind === "doc004-fault");
  delete gate.operationEvidence;
  for (const row of registry.rows) {
    if (row.kind !== "doc004-fault") continue;
    row.operationEvidence = "modeled-operation";
  }
  const result = validateRegistry(registry, {});
  assert.equal(result.go, false);
  assert.notEqual(result.gates.find((entry) => entry.kind === "doc004-fault").state, "satisfied");
});

test("synthetic fixture: one DOC-004 row cannot bundle every canonical case", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  const gate = registry.gates.find((entry) => entry.kind === "doc004-fault");
  const kept = registry.rows.find((row) => row.kind === "doc004-fault");
  kept.cases = [...REQUIRED_FAULT_CASES];
  registry.rows = registry.rows.filter((row) => row.kind !== "doc004-fault" || row === kept);
  gate.rows = [kept.id];
  const result = validateRegistry(registry, {});
  const codes = codesOf(result);
  assert.equal(result.valid, false, JSON.stringify(result.errors, null, 2));
  assert.equal(result.go, false);
  assert.ok(codes.has("bundle-case-row"), JSON.stringify([...codes]));
  assert.ok(codes.has("missing-required-case"), JSON.stringify([...codes]));
});

test("synthetic fixture: one DOC-005 row cannot bundle every canonical case", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  const gate = registry.gates.find((entry) => entry.kind === "doc005-mandatory");
  const kept = registry.rows.find((row) => row.kind === "doc005-mandatory");
  kept.cases = [...REQUIRED_MANDATORY_CASES];
  registry.rows = registry.rows.filter((row) => row.kind !== "doc005-mandatory" || row === kept);
  gate.rows = [kept.id];
  const result = validateRegistry(registry, {});
  const codes = codesOf(result);
  assert.equal(result.valid, false, JSON.stringify(result.errors, null, 2));
  assert.equal(result.go, false);
  assert.ok(codes.has("bundle-case-row"), JSON.stringify([...codes]));
});

test("synthetic fixture: a canonical case needs a row bound to that case's artifacts", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  const row = registry.rows.find((entry) => entry.kind === "doc004-fault");
  for (const artifact of row.artifacts) artifact.ref = "unrelated-fixture/other-operation";
  const result = validateRegistry(registry, {});
  assert.equal(result.go, false);
  assert.ok(codesOf(result).has("missing-required-case"), JSON.stringify([...codesOf(result)]));
});

test("synthetic fixture: individually bound case rows keep the contract gates satisfied", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const result = check(registry, dir);
  for (const kind of ["doc004-fault", "doc005-mandatory"]) {
    const gate = result.gates.find((entry) => entry.kind === kind);
    assert.equal(gate.state, "satisfied", kind);
    assert.equal(gate.casesCovered, gate.casesRequired, kind);
  }
  assert.equal(result.go, true, JSON.stringify(result.noGoReasons, null, 2));
});

test("H4: a core row whose artifact refs name another fixture does not satisfy its gate", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const docx = registry.rows.find((row) => row.id === "E-DOCX-ORCA");
  for (const artifact of docx.artifacts) artifact.ref = "UNRELATED-FIXTURE/OTHER-OP";
  const result = check(registry, dir);
  assert.equal(result.go, false);
  const codes = codesOf(result);
  assert.ok(codes.has("artifact-ref-unbound"), JSON.stringify([...codes]));
  assert.notEqual(result.gates.find((gate) => gate.format === "docx").state, "satisfied");
});

test("H4: a DOCX row cannot close its gate on XLSX cycle bytes", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const xlsx = registry.rows.find((row) => row.id === "E-XLSX-ORCA");
  for (const row of registry.rows) {
    if (row.id === "E-DOCX-ORCA") row.artifacts = structuredClone(xlsx.artifacts);
  }
  const result = check(registry, dir);
  assert.equal(result.go, false);
  const codes = codesOf(result);
  assert.ok(
    codes.has("artifact-ref-unbound") || codes.has("artifact-identity-shared"),
    JSON.stringify([...codes]),
  );
});

test("H4: two browser rows may not attest one set of cycle files", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const gateRow = registry.rows.find((row) => row.id === "E-DOCX-ORCA");
  const legacyRow = registry.rows.find((row) => row.id === "E-DOCX-CHROME");
  legacyRow.artifacts = structuredClone(gateRow.artifacts);
  const result = check(registry, dir);
  assert.equal(result.go, false);
  assert.ok(codesOf(result).has("artifact-identity-shared"), JSON.stringify([...codesOf(result)]));
});

test("H4: two independent deterministic runs with identical bytes in their own files still pass", () => {
  // Main direction: do NOT require a different persisted-output SHA256 between
  // two rows. Two deterministic runs may publish identical bytes legitimately.
  // Only the artifact identity must differ, not the hash.
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const gateRow = registry.rows.find((row) => row.id === "E-DOCX-ORCA");
  const legacyRow = registry.rows.find((row) => row.id === "E-DOCX-CHROME");
  const gateOutput = gateRow.artifacts.find((entry) => entry.role === "persisted-output");
  const legacyOutput = legacyRow.artifacts.find((entry) => entry.role === "persisted-output");
  // Both rows keep their own paths; write the same byte content into both.
  fs.writeFileSync(path.join(dir, legacyOutput.path), fs.readFileSync(path.join(dir, gateOutput.path)));
  const legacyBytes = fs.readFileSync(path.join(dir, legacyOutput.path));
  legacyOutput.sha256 = sha256Of(legacyBytes).toUpperCase();
  legacyOutput.bytes = legacyBytes.length;
  assert.equal(legacyOutput.sha256, gateOutput.sha256, "the two runs really do publish identical bytes");
  const result = check(registry, dir);
  assert.equal(result.go, true, JSON.stringify(result.noGoReasons, null, 2));
});

test("H4: two rows may not reach one on-disk file through different path spellings", () => {
  // R4 review R1: artifact exclusivity keys the resolved realpath, not the
  // literal path string, so an alias cannot recreate a shared-file identity.
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const gateRow = registry.rows.find((row) => row.id === "E-DOCX-ORCA");
  const legacyRow = registry.rows.find((row) => row.id === "E-DOCX-CHROME");
  legacyRow.artifacts = gateRow.artifacts.map((artifact) => ({
    ...artifact,
    path: artifact.path.split("\\").join("/").replace("cycles/", "cycles/./"),
  }));
  const result = check(registry, dir);
  assert.equal(result.go, false);
  assert.ok(codesOf(result).has("artifact-identity-shared"), JSON.stringify([...codesOf(result)]));
});

test("H4: a core row without an immutable input, report or independent evidence does not satisfy", () => {
  for (const drop of ["immutable-input", "transcript", "extraction-evidence"]) {
    const dir = tempDir();
    const registry = buildSyntheticGoFixture(dir);
    const docx = registry.rows.find((row) => row.id === "E-DOCX-ORCA");
    docx.artifacts = docx.artifacts.filter((entry) => entry.role !== drop);
    const result = check(registry, dir);
    assert.equal(result.go, false, drop);
    assert.ok(codesOf(result).has("missing-required-artifact"), drop + " " + JSON.stringify([...codesOf(result)]));
  }
});

test("H6: DOC-005 cannot pass with model-only draft persistence", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  // Relabel every persistence case back to the reference model, as the old
  // fixture did: real draft-store evidence gone.
  for (const row of registry.rows) {
    if (row.kind !== "doc005-mandatory") continue;
    if (!DRAFT_PERSISTENCE_CASES.includes(row.cases[0])) continue;
    row.adapter = "model";
    row.operationEvidence = "modeled-operation";
    row.assertions = [];
    row.authMode = AUTH_MODE_MODELED;
  }
  const result = check(registry, dir);
  assert.equal(result.go, false);
  const codes = codesOf(result);
  assert.ok(codes.has("missing-persistence-case"), JSON.stringify([...codes]));
  assert.equal(result.gates.find((gate) => gate.kind === "doc005-mandatory").state, "pending");
});

test("H4: two accepted contract rows may not attest one on-disk artifact file", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const source = registry.rows.find(
    (entry) => entry.kind === "doc005-mandatory" && !DRAFT_PERSISTENCE_CASES.includes(entry.cases[0]),
  );
  const target = registry.rows.find(
    (entry) => entry.kind === "doc005-mandatory" && entry.id !== source.id && !DRAFT_PERSISTENCE_CASES.includes(entry.cases[0]),
  );
  target.artifacts = source.artifacts;
  const result = check(registry, dir);
  assert.equal(result.valid, false, JSON.stringify(result.errors, null, 2));
  assert.ok(
    codesOf(result).has("artifact-identity-shared"),
    JSON.stringify([...codesOf(result)]),
  );
});

test("H6: a persistence case without the fresh-store recovery assertion is rejected", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const row = registry.rows.find(
    (entry) => entry.kind === "doc005-mandatory" && DRAFT_PERSISTENCE_CASES.includes(entry.cases[0]),
  );
  row.assertions = [];
  const result = check(registry, dir);
  assert.equal(result.go, false);
  assert.ok(
    codesOf(result).has("persistence-without-recovery-assertion"),
    JSON.stringify([...codesOf(result)]),
  );
});

test("H6: an authorization-only case must declare its modeled provenance", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const authRow = registry.rows.find(
    (entry) => entry.kind === "doc005-mandatory" && !DRAFT_PERSISTENCE_CASES.includes(entry.cases[0]),
  );
  delete authRow.authMode;
  const result = check(registry, dir);
  assert.equal(result.go, false);
  assert.ok(codesOf(result).has("auth-provenance-unlabeled"), JSON.stringify([...codesOf(result)]));
});

test("H6: an authorization-only case cannot claim a real adapter", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const authRow = registry.rows.find(
    (entry) => entry.kind === "doc005-mandatory" && !DRAFT_PERSISTENCE_CASES.includes(entry.cases[0]),
  );
  authRow.adapter = "real";
  authRow.operationEvidence = "real-adapter-operation";
  const result = check(registry, dir);
  assert.equal(result.go, false);
  const codes = codesOf(result);
  assert.ok(
    codes.has("auth-case-claims-real-adapter") || codes.has("gate-row-unsatisfied"),
    JSON.stringify([...codes]),
  );
});

function scopedPptxFixture(dir) {
  const registry = buildSyntheticGoFixture(dir);
  const template = registry.rows.find((row) => row.id === "E-PPTX-CHROME");
  const scoped = ["chrome", "edge"].map((browser) => {
    const row = structuredClone(template);
    row.id = "SCOPED-PPTX-" + browser.toUpperCase();
    row.kind = "scoped-browser-cycle";
    row.fixture = "image-fixture-" + browser;
    row.operationId = "replace-existing-picture-save-reopen";
    row.operation = "replace one existing picture, save and independently reopen";
    row.protocolVersion = null;
    row.platform.browser = browser;
    row.assertions = ["image-changed", "reopen-fresh-session"].map((id) => ({ id, status: "passed" }));
    const ref = `${row.fixture}/pptx/${row.operationId}`;
    row.artifacts = ["immutable-input", "persisted-output", "reopened-output", "render-evidence", "extraction-evidence", "report"].map((role) =>
      writeBytes(dir, `scoped/${browser}/${role}.bin`, Buffer.from(`${browser}:${role}:test-bytes`), role, ref),
    );
    return row;
  });
  registry.rows.push(...scoped);
  for (const row of registry.rows) {
    if (row.format !== "pptx" || row.kind !== "core-cycle") continue;
    row.status = "PENDING";
    row.reason = "full text/image/shape cycle is still missing";
    row.artifacts = [];
    row.actual = null;
  }
  registry.decision.value = "NO-GO";
  return { registry, scoped };
}

test("scoped PPTX: accepted image evidence remains valid and cannot fill the full core gate", () => {
  const dir = tempDir();
  const { registry } = scopedPptxFixture(dir);
  const result = check(registry, dir);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.go, false);
  assert.equal(result.reportStatus, "INCOMPLETE");
  assert.equal(result.gates.find((gate) => gate.format === "pptx").state, "pending");
  assert.ok(result.coreCoverage.filter((entry) => entry.format === "pptx").every((entry) => !entry.matched));
});

test("scoped PPTX: promotion cannot bypass kind, operation, assertion and protocol requirements", () => {
  for (const relabelKind of [false, true]) {
    const dir = tempDir();
    const { registry, scoped } = scopedPptxFixture(dir);
    registry.gates.find((gate) => gate.format === "pptx").rows = scoped.map((row) => row.id);
    if (relabelKind) for (const row of scoped) row.kind = "core-cycle";
    const result = check(registry, dir);
    assert.equal(result.valid, false);
    assert.equal(result.go, false);
    const codes = codesOf(result);
    if (!relabelKind) {
      assert.ok(codes.has("row-gate-kind-mismatch"));
      assert.ok(codes.has("row-gate-operation-mismatch"));
      assert.ok(codes.has("missing-required-assertion"));
      assert.ok(codes.has("missing-core-provenance"));
    } else {
      // Promotion is refused even earlier now: a relabeled scoped row still
      // records protocolVersion null, so the core-cycle protocol-provenance
      // rule withdraws its acceptance before the gate-level operation and
      // assertion mismatches can be reported.
      assert.ok(codes.has("missing-protocol-provenance"), JSON.stringify([...codes]));
      assert.equal(
        result.rows.filter((entry) => entry.id.startsWith("SCOPED-PPTX-")).every((entry) => entry.accepted === false),
        true,
      );
    }
  }
});

test("scoped PPTX: each input, saved, reopened, render, extraction and report role is required without a gate", () => {
  for (const role of ["immutable-input", "persisted-output", "reopened-output", "render-evidence", "extraction-evidence", "report"]) {
    const dir = tempDir();
    const { registry, scoped } = scopedPptxFixture(dir);
    scoped[0].artifacts = scoped[0].artifacts.filter((a) => a.role !== role);
    const result = check(registry, dir);
    assert.equal(result.valid, false, role);
    assert.ok(codesOf(result).has("scoped-pptx-artifact-missing"), role);
  }
});

test("scoped PPTX: swapped artifact paths or cross-browser refs are refused", () => {
  for (const mutation of ["path", "ref", "whole-artifact"]) {
    const dir = tempDir();
    const { registry, scoped: [chrome, edge] } = scopedPptxFixture(dir);
    const a = chrome.artifacts.find((item) => item.role === "persisted-output");
    const b = edge.artifacts.find((item) => item.role === "persisted-output");
    if (mutation === "path") [a.path, b.path] = [b.path, a.path];
    if (mutation === "ref") a.ref = b.ref;
    if (mutation === "whole-artifact") chrome.artifacts[1] = structuredClone(b);
    const result = check(registry, dir);
    assert.equal(result.valid, false, mutation);
    assert.ok(codesOf(result).has(mutation === "path" ? "artifact-checksum-mismatch" : "artifact-ref-unbound"), mutation);
  }
});

test("scoped PPTX: shared identities and aliases are refused within or across nongate rows", () => {
  for (const mutation of ["within", "across", "alias"]) {
    const dir = tempDir();
    const { registry, scoped: [chrome, edge] } = scopedPptxFixture(dir);
    if (mutation === "across") {
      edge.artifacts = chrome.artifacts.map((a) => ({ ...a, ref: edge.artifacts[0].ref }));
    } else {
      const saved = chrome.artifacts.find((a) => a.role === "persisted-output");
      const reopened = chrome.artifacts.find((a) => a.role === "reopened-output");
      Object.assign(reopened, saved, { role: "reopened-output" });
      if (mutation === "alias") reopened.path = reopened.path.replace("scoped/", "scoped/./");
    }
    const result = check(registry, dir);
    assert.equal(result.valid, false, mutation);
    assert.ok(codesOf(result).has("artifact-identity-shared"), mutation);
  }
});

test("scoped PPTX: missing files, unknown roles and source/browser downgrades are refused", () => {
  for (const [mutation, expected] of [["missing", "artifact-missing"], ["role", "artifact-role-invalid"], ["source", "conflicting-provenance"], ["adapter", "level-exceeds-evidence"], ["launch", "level-exceeds-evidence"]]) {
    const dir = tempDir();
    const { registry, scoped: [row] } = scopedPptxFixture(dir);
    if (mutation === "missing") row.artifacts[0].path = "absent.pptx";
    if (mutation === "role") row.artifacts[0].role = "made-up-role";
    if (mutation === "source") row.source.commit = "a".repeat(40);
    if (mutation === "adapter") row.adapter = "model";
    if (mutation === "launch") row.uiKind = "launch";
    const result = check(registry, dir);
    assert.equal(result.valid, false, mutation);
    assert.ok(codesOf(result).has(expected), mutation);
  }
});

test("scoped PPTX: distinct saved and reopened files may hold identical bytes", () => {
  const dir = tempDir();
  const { registry, scoped } = scopedPptxFixture(dir);
  for (const row of scoped) {
    const saved = row.artifacts.find((a) => a.role === "persisted-output");
    const reopened = row.artifacts.find((a) => a.role === "reopened-output");
    fs.copyFileSync(path.join(dir, saved.path), path.join(dir, reopened.path));
    reopened.sha256 = saved.sha256;
    reopened.bytes = saved.bytes;
  }
  assert.equal(check(registry, dir).valid, true);
});

test("scoped PPTX: actual CLI returns INCOMPLETE/NO-GO and require-go exits 1", async () => {
  const dir = tempDir();
  const { registry } = scopedPptxFixture(dir);
  const file = path.join(dir, "registry.json");
  fs.writeFileSync(file, JSON.stringify(registry));
  for (const requireGo of [false, true]) {
    let output = "";
    const code = await runCli(["--registry", file, "--root", dir, "--json", ...(requireGo ? ["--require-go"] : [])], {
      stdout: (chunk) => { output += chunk; }, stderr: () => {},
    });
    assert.equal(code, requireGo ? 1 : 0);
    const result = JSON.parse(output);
    assert.equal(result.valid, true);
    assert.equal(result.go, false);
    assert.equal(result.reportStatus, "INCOMPLETE");
  }
});

function scopedChecksumFixture(dir) {
  const registry = buildSyntheticGoFixture(dir);
  const row = structuredClone(registry.rows.find((r) => r.kind === "doc004-fault"));
  Object.assign(row, {
    id: "SCOPED-CHECKSUM", kind: "scoped-reference-checksum", format: "docx",
    fixture: "checksum-reference", operationId: "declared-checksum-refusal-before-storage",
    level: "harness", adapter: "model", operationEvidence: "modeled-operation",
    authMode: "modeled", storeMode: "modeled", commitMode: "modeled", faultMode: "controlled-declaration-tamper",
    assertions: ["genuine-output-accepted-once", "checksum-refused-before-storage", "zero-store-puts", "zero-version-commits", "zero-ledger-rows", "revision-pointer-unchanged"].map((id) => ({ id, status: "passed" })),
  });
  row.artifacts = ["immutable-input", "persisted-output", "extraction-evidence", "report"].map((role) =>
    writeBytes(dir, `checksum/${role}.bin`, Buffer.from("checksum " + role), role, `${row.fixture}/docx/${row.operationId}`),
  );
  registry.rows.push(row);
  return { registry, row };
}

function scopedXlsxFixture(dir) {
  const registry = buildSyntheticGoFixture(dir);
  const row = coreRow(dir, "xlsx", "chromium", "synthetic-electron");
  Object.assign(row, {
    id: "SCOPED-XLSX-ORCA", kind: "scoped-browser-cycle",
    fixture: "xlsx-native-input", operationId: "edit-input-recalculate-save-distinct-reopen",
    protocolVersion: null, runtime: { node: process.versions.node, electron: "synthetic" },
    assertions: ["cell-value-changed", "formula-recalculated-numeric", "formula-expected-value", "reopen-fresh-session"].map((id) => ({ id, status: "passed" })),
  });
  row.artifacts = ["immutable-input", "persisted-output", "reopened-output", "render-evidence", "extraction-evidence", "report"].map((role) =>
    writeBytes(dir, `native-xlsx/${role}.bin`, Buffer.from(role === "reopened-output" ? "persisted-output" : role), role, `${row.fixture}/xlsx/${row.operationId}`),
  );
  row.nativeCycle = {
    host: "orca", profileId: "native-profile", originalPageId: "page-original", reopenedPageId: "page-reopened",
    originalViewId: "view-original", reopenedViewId: "view-reopened",
    sourcePin: BASELINE, rendererManifestSha256: "a".repeat(64), sidecarSha256: "b".repeat(64),
    input: { ...row.artifacts[0] }, saved: { ...row.artifacts[1] }, reopened: { ...row.artifacts[2] },
  };
  registry.rows.push(row);
  for (const core of registry.rows.filter((r) => r.kind === "core-cycle" && r.format === "xlsx")) {
    core.status = "PENDING";
    core.reason = "installed Windows Chrome and Edge cycles remain missing";
    core.artifacts = [];
  }
  registry.decision.value = "NO-GO";
  return { registry, row };
}

test("scoped XLSX: missing independently reopened bytes cannot be accepted", () => {
  const dir = tempDir();
  const { registry, row } = scopedXlsxFixture(dir);
  row.artifacts = row.artifacts.filter((a) => a.role !== "reopened-output");
  const result = check(registry, dir);
  assert.equal(result.valid, false);
  assert.ok(codesOf(result).has("scoped-xlsx-artifact-missing"));
});

test("scoped XLSX: native input cycle is accepted without satisfying a core gate", () => {
  const dir = tempDir();
  const { registry } = scopedXlsxFixture(dir);
  const result = check(registry, dir);
  assert.equal(result.valid, true, JSON.stringify(result.findings));
  assert.equal(result.go, false);
  assert.equal(result.reportStatus, "INCOMPLETE");
  assert.equal(result.gates.find((g) => g.format === "xlsx").state, "pending");
});

test("scoped XLSX: every input/output/reopen/render/extraction/report role is required", () => {
  for (const role of ["immutable-input", "persisted-output", "reopened-output", "render-evidence", "extraction-evidence", "report"]) {
    const dir = tempDir();
    const { registry, row } = scopedXlsxFixture(dir);
    row.artifacts = row.artifacts.filter((a) => a.role !== role);
    const result = check(registry, dir);
    assert.equal(result.valid, false, role);
    assert.ok(codesOf(result).has("scoped-xlsx-artifact-missing"), role);
  }
});

test("scoped XLSX: refs and within/across-row artifact identities remain exclusive", () => {
  for (const mutation of ["ref", "alias", "across"]) {
    const dir = tempDir();
    const { registry, row } = scopedXlsxFixture(dir);
    if (mutation === "ref") row.artifacts[0].ref = "another/fixture/operation";
    if (mutation === "alias") row.artifacts.push({ ...row.artifacts[0], role: "report", path: row.artifacts[0].path.replace("native-xlsx/", "native-xlsx/./") });
    if (mutation === "across") registry.rows.unshift({ ...structuredClone(row), id: "OTHER-NATIVE-ROW" });
    const result = check(registry, dir);
    assert.equal(result.valid, false, mutation);
    assert.ok(codesOf(result).has(mutation === "ref" ? "artifact-ref-unbound" : "artifact-identity-shared"), mutation);
  }
});

test("scoped XLSX: output identity pins and distinct page/view provenance are mandatory", () => {
  for (const mutation of ["missing", "page", "view", "profile", "input", "saved", "reopened", "renderer", "sidecar", "source", "duplicate-output", "unequal-output"]) {
    const dir = tempDir();
    const { registry, row } = scopedXlsxFixture(dir);
    if (mutation === "missing") delete row.nativeCycle;
    if (mutation === "page") row.nativeCycle.reopenedPageId = row.nativeCycle.originalPageId;
    if (mutation === "view") row.nativeCycle.reopenedViewId = row.nativeCycle.originalViewId;
    if (mutation === "profile") delete row.nativeCycle.profileId;
    if (["input", "saved", "reopened"].includes(mutation)) row.nativeCycle[mutation].sha256 = "c".repeat(64);
    if (mutation === "renderer") row.nativeCycle.rendererManifestSha256 = "unrecorded";
    if (mutation === "sidecar") delete row.nativeCycle.sidecarSha256;
    if (mutation === "source") row.nativeCycle.sourcePin = "c".repeat(40);
    if (mutation === "duplicate-output") row.artifacts.push(writeBytes(dir, "native-xlsx/another-output.bin", "other", "persisted-output", row.artifacts[0].ref));
    if (mutation === "unequal-output") {
      const a = row.artifacts.find((a) => a.role === "reopened-output");
      Object.assign(a, writeBytes(dir, a.path, "different reopened bytes", a.role, a.ref));
      row.nativeCycle.reopened = { ...a };
    }
    const result = check(registry, dir);
    assert.equal(result.valid, false, mutation);
    assert.ok(codesOf(result).has("scoped-xlsx-identity"), mutation);
  }
});

test("scoped XLSX: Orca cannot be relabeled as installed browser, modeled or core evidence", () => {
  for (const mutation of ["chrome", "edge", "safari", "electron", "host", "adapter", "kind", "operation", "assertion", "gate"]) {
    const dir = tempDir();
    const { registry, row } = scopedXlsxFixture(dir);
    if (["chrome", "edge", "safari"].includes(mutation)) row.platform.browser = mutation;
    if (mutation === "electron") delete row.runtime.electron;
    if (mutation === "host") row.nativeCycle.host = "installed-browser";
    if (mutation === "adapter") row.adapter = "model";
    if (mutation === "kind") row.kind = "core-cycle";
    if (mutation === "operation") row.operationId = "open-edit-cell-recalculate-save-reopen";
    if (mutation === "assertion") row.assertions[0].status = "failed";
    if (mutation === "gate") registry.gates.find((g) => g.format === "xlsx").rows = [row.id];
    const result = check(registry, dir);
    assert.equal(result.valid, false, mutation);
    assert.equal(result.go, false, mutation);
    assert.notEqual(result.gates.find((g) => g.format === "xlsx").state, "satisfied", mutation);
  }
});

test("scoped checksum: accepted reference evidence cannot replace a canonical real-adapter fault row", () => {
  const dir = tempDir();
  const { registry, row } = scopedChecksumFixture(dir);
  assert.equal(check(registry, dir).valid, true);
  registry.gates.find((g) => g.kind === "doc004-fault").rows = [row.id];
  const result = check(registry, dir);
  assert.equal(result.go, false);
  assert.equal(result.valid, false);
  assert.notEqual(result.gates.find((g) => g.kind === "doc004-fault").state, "satisfied");
});

test("scoped checksum: store/auth/commit and controlled fault must remain labeled", () => {
  for (const field of ["authMode", "storeMode", "commitMode", "faultMode", "adapter", "operationEvidence"]) {
    const dir = tempDir();
    const { registry, row } = scopedChecksumFixture(dir);
    row[field] = "real";
    const result = check(registry, dir);
    assert.equal(result.valid, false, field);
    assert.ok(codesOf(result).has("scoped-checksum-provenance"), field);
  }
});

test("scoped checksum: zero-put acceptance requires the positive control and refusal assertions", () => {
  const dir = tempDir();
  const { registry, row } = scopedChecksumFixture(dir);
  row.assertions.find((a) => a.id === "zero-store-puts").status = "failed";
  const result = check(registry, dir);
  assert.equal(result.valid, false);
  assert.ok(codesOf(result).has("scoped-checksum-assertion"));
});

test("scoped checksum: absent, retargeted and shared artifacts are refused without a gate", () => {
  for (const mutation of ["missing-role", "ref", "within-alias", "across", "checksum", "source"]) {
    const dir = tempDir();
    const { registry, row } = scopedChecksumFixture(dir);
    if (mutation === "missing-role") row.artifacts = row.artifacts.filter((a) => a.role !== "persisted-output");
    if (mutation === "ref") row.artifacts[0].ref = "historical/checksum";
    if (mutation === "within-alias") row.artifacts[1] = { ...row.artifacts[0], role: "persisted-output", path: row.artifacts[0].path.replace("checksum/", "checksum/./") };
    if (mutation === "across") registry.rows.push({ ...structuredClone(row), id: "SCOPED-CHECKSUM-COPY" });
    if (mutation === "checksum") row.artifacts[0].sha256 = "b".repeat(64);
    if (mutation === "source") row.source.commit = "a".repeat(40);
    const result = check(registry, dir);
    const expected = { "missing-role": "scoped-checksum-artifact-missing", ref: "artifact-ref-unbound", "within-alias": "artifact-identity-shared", across: "artifact-identity-shared", checksum: "artifact-checksum-mismatch", source: "conflicting-provenance" }[mutation];
    assert.equal(result.valid, false, mutation);
    assert.ok(codesOf(result).has(expected), mutation);
  }
});

// ---------------------------------------------------------------------------
// Orca embedded-browser gate rule (user decision of 2026-09-25, g115): the
// constant scope, the per-row rule, the protocol provenance a core row needs,
// the legacy scoped rows that stay valid and the browser deferral block.
// ---------------------------------------------------------------------------

test("orca rule: a core row in the Orca embedded browser satisfies the gate browser coverage", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const orca = registry.rows.find((row) => row.id === "E-DOCX-ORCA");
  assert.equal(orca.platform.os, "windows");
  assert.equal(orca.platform.browser, ORCA_EMBEDDED_BROWSER);
  assert.ok(orca.platform.orcaVersion, "an Orca row must record the Orca application version");
  assert.ok(orca.platform.browserVersion, "an Orca row must record the embedded Chromium version");
  assert.equal(orca.protocolVersion, ACCEPTED_BROWSER_BRIDGE_CONTRACTS[0]);
  assert.deepEqual(REQUIRED_GATE_BROWSERS, [{ os: "windows", browser: ORCA_EMBEDDED_BROWSER }]);
  assert.deepEqual(
    DEFERRED_GATE_BROWSERS.map((pair) => pair.os + "/" + pair.browser),
    ["windows/chrome", "windows/edge", "macos/safari"],
  );

  const result = check(registry, dir);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.go, true, JSON.stringify(result.noGoReasons, null, 2));
  assert.equal(result.coreCoverage.length, REQUIRED_FORMATS.length);
  assert.equal(
    result.coreCoverage.every((entry) => entry.os === "windows" && entry.browser === ORCA_EMBEDDED_BROWSER && entry.matched),
    true,
    JSON.stringify(result.coreCoverage),
  );
  assert.equal(result.deferredBrowsers.requiredGateBrowsers[0].browser, ORCA_EMBEDDED_BROWSER);
  assert.equal(result.deferredBrowsers.deferredGateBrowsers.length, DEFERRED_GATE_BROWSERS.length);
  const report = formatReport(result, "registry.json");
  assert.match(report, /core browser scope:/);
  assert.match(report, /orca\/windows/);
  assert.match(report, /chrome\/windows/);
});

test("orca rule: a core row without an Orca application version cannot satisfy the gate", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const orca = registry.rows.find((row) => row.id === "E-DOCX-ORCA");
  delete orca.platform.orcaVersion;
  const result = check(registry, dir);
  assert.equal(result.valid, false, JSON.stringify(result.findings));
  assert.equal(result.go, false);
  const finding = result.findings.find((entry) => entry.code === "level-exceeds-evidence" && entry.rowId === "E-DOCX-ORCA");
  assert.ok(finding, JSON.stringify(result.findings));
  assert.match(finding.message, /orca-cycle-requires-orca-version/);
  assert.notEqual(result.gates.find((gate) => gate.format === "docx").state, "satisfied");
});

test("orca rule: an empty, invented or unimplemented protocol string is an error", () => {
  for (const [value, expected] of [
    ["", "missing-protocol-provenance"],
    ["uniwork-office-lab-bridge@2", "unknown-protocol-provenance"],
    ["invented-bridge@1", "unknown-protocol-provenance"],
  ]) {
    const dir = tempDir();
    const registry = buildSyntheticGoFixture(dir);
    const orca = registry.rows.find((row) => row.id === "E-DOCX-ORCA");
    orca.protocolVersion = value;
    const result = check(registry, dir);
    assert.equal(result.valid, false, value);
    assert.equal(result.go, false, value);
    assert.ok(codesOf(result).has(expected), value + " " + JSON.stringify([...codesOf(result)]));
    assert.notEqual(result.gates.find((gate) => gate.format === "docx").state, "satisfied", value);
  }
});

test("orca rule: a legacy scoped Chrome/Edge row still validates unchanged and closes no gate", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  const legacy = ["chrome", "edge"].map((browser) => {
    const fixture = "legacy-fixture-" + browser;
    const operationId = "edit-cell-save-reopen";
    return {
      id: "E-DOCX-TABLE-SCOPED-" + browser.toUpperCase(),
      kind: "scoped-browser-cycle",
      capability: "docx-table-cycle",
      format: "docx",
      operation: "synthetic legacy scoped cycle; not a real run",
      operationId,
      status: "PASS",
      result: "pass",
      level: "browser-real",
      provides: ["editor-cycle", "engine-operation"],
      operationEvidence: "byte-verified-operation",
      adapter: "real",
      uiKind: "real-editor",
      platform: { os: "windows", browser, browserVersion: "0.0.0-synthetic" },
      runtime: { node: process.versions.node },
      engine: { name: "@genoffice/docs/engine", version: "0.1.0-synthetic" },
      protocolVersion: null,
      fixture,
      source: { kind: "repo-commit", id: "uniwork-baseline", commit: BASELINE },
      command: "synthetic validator fixture only",
      cwd: "synthetic/test",
      expected: { result: "synthetic oracle", oracle: "synthetic oracle" },
      actual: "synthetic; not a real browser run",
      assertions: assertionsFor("docx"),
      cases: [],
      artifacts: ["immutable-input", "persisted-output", "extraction-evidence", "report"].map((role) =>
        writeBytes(dir, "legacy/" + browser + "/" + role + ".bin", Buffer.from(browser + ":" + role), role, fixture + "/docx/" + operationId),
      ),
    };
  });
  registry.rows.push(...legacy);
  const gateRowIds = new Set(registry.gates.flatMap((gate) => gate.rows ?? []));
  for (const row of legacy) assert.equal(gateRowIds.has(row.id), false, row.id + " must stay a non-gate row");

  const result = check(registry, dir);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.go, true, JSON.stringify(result.noGoReasons, null, 2));
  assert.equal(result.rows.find((entry) => entry.id === "E-DOCX-TABLE-SCOPED-CHROME").accepted, true);
  assert.equal(result.rows.find((entry) => entry.id === "E-DOCX-TABLE-SCOPED-EDGE").accepted, true);
  assert.equal(result.coreCoverage.every((entry) => entry.browser === ORCA_EMBEDDED_BROWSER), true);
});

test("browser deferrals: a malformed entry is an error and an unused deferral only warns", () => {
  const malformed = buildSyntheticGoFixture(tempDir());
  malformed.browserDeferrals.push({ browser: "chrome", os: "windows", reason: "no issue and no phase recorded" });
  const malformedResult = validateRegistry(malformed, {});
  assert.equal(malformedResult.valid, false);
  assert.ok(codesOf(malformedResult).has("browser-deferral-invalid"), JSON.stringify([...codesOf(malformedResult)]));

  const unknownFamily = buildSyntheticGoFixture(tempDir());
  unknownFamily.browserDeferrals.push({ browser: "netscape", os: "windows", reason: "invented family", issue: "UNI-671", phase: "later phase" });
  const unknownResult = validateRegistry(unknownFamily, {});
  assert.equal(unknownResult.valid, false);
  assert.ok(codesOf(unknownResult).has("browser-deferral-invalid"));

  const unused = buildSyntheticGoFixture(tempDir());
  unused.browserDeferrals = [{ browser: "firefox", os: "linux", reason: "not a G0 pair", issue: "UNI-671", phase: "later phase" }];
  const unusedResult = validateRegistry(unused, {});
  assert.equal(unusedResult.valid, true, JSON.stringify(unusedResult.errors, null, 2));
  assert.ok(codesOf(unusedResult).has("browser-deferral-unused"), JSON.stringify([...codesOf(unusedResult)]));
});

test("browser deferrals: a gate that still demands a deferred browser is an error", () => {
  const registry = buildSyntheticGoFixture(tempDir());
  registry.browserDeferrals.push({ browser: ORCA_EMBEDDED_BROWSER, os: "windows", reason: "pretending the required browser is deferred", issue: "UNI-671", phase: "later phase" });
  const result = validateRegistry(registry, {});
  assert.equal(result.valid, false);
  assert.equal(result.go, false);
  assert.ok(codesOf(result).has("browser-deferral-contradiction"), JSON.stringify([...codesOf(result)]));

  const legacy = buildSyntheticGoFixture(tempDir());
  legacy.browserDeferrals = [{ browser: "chrome", os: "windows", reason: "installed Chrome is deferred at G0", issue: "UNI-671", phase: "later phase" }];
  const legacyResult = validateRegistry(legacy, {});
  assert.equal(legacyResult.valid, true, JSON.stringify(legacyResult.errors, null, 2));
});

test("register scope agreement: a stale declared requiredBrowsers list only warns", () => {
  const dir = tempDir();
  const registry = buildSyntheticGoFixture(dir);
  for (const gate of registry.gates) {
    if (gate.kind !== "core-cycle") continue;
    gate.requiredBrowsers = DEFERRED_GATE_BROWSERS.filter((pair) => pair.os === "windows").map((pair) => ({ ...pair }));
  }
  const result = check(registry, dir);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.go, true, JSON.stringify(result.noGoReasons, null, 2));
  assert.equal(result.warnings.filter((entry) => entry.code === "gate-browser-scope-stale").length, REQUIRED_FORMATS.length);
  assert.equal(result.coreCoverage.every((entry) => entry.browser === ORCA_EMBEDDED_BROWSER && entry.matched), true);
  assert.match(formatReport(result, "registry.json"), /gate-browser-scope-stale/);
});
