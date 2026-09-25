// DOC-004 (UNI-668) - tests for the boundary contract harness.
//
// These tests are about the HARNESS and the CONTRACT, not about any engine. They
// pin that the mandatory case list cannot quietly shrink, that the limits are
// really finite safe integers rather than comment promises, that a checksum is
// recomputed from bytes by an independent implementation, that failing cases leave
// the current version and the input untouched, and that the runtime map cannot
// claim a runtime it has not proven.
//
//   node --test scripts/office-g0/engine-contract.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  LIMITS,
  FORMATS,
  OPERATIONS,
  JOB_STATES,
  TERMINAL_STATES,
  ERROR_CODES,
  FIDELITY_WARNING_CODES,
  BoundaryError,
  ContractViolation,
  WIRE_FORMAT,
  CONTRACT_VERSION,
  PROTOCOL_VERSION,
  validateEnvelope,
  payloadFingerprint,
  canonicalJson,
  sha256Bytes,
  createBoundary,
  createFakeObjectStore,
  createLedger,
  scanForLeaks,
  FAULT_CASES,
  REQUIRED_CASE_IDS,
  runAllCases,
  EVIDENCE_REGISTRY,
} from "./engine-contract.mjs";
import {
  ADAPTER_ERROR_MAP,
  ADAPTER_CLIENT_FAILURE,
  ADAPTER_FAULT_CASES,
  ADAPTER_TRANSPORT,
  REQUIRED_FIXTURES,
  classify,
  createAdapterClient,
  prepareLab,
  assertInside,
  runAdapterCase,
  adapterOracleDigest,
} from "./engine-contract-adapter.mjs";

// The adapter harness has its own shape: it talks to a REAL host over HTTP, but
// its pure helpers (classification, containment, lab preparation) are testable
// HERE without a host. The host-driving cases stay operator-booted; this file
// never opens a socket to a real engine.

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const runtimeMap = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "docs/office/g0/module-runtime-map.json"), "utf8"));

/** The canonical serialize envelope used across these tests. */
function baseSerializeEnvelope(overrides = {}) {
  const input = Buffer.from("fixture-docx-bytes", "utf8");
  return {
    request_id: "REQ-TEST-1",
    contract_version: CONTRACT_VERSION,
    protocol_version: PROTOCOL_VERSION,
    operation: "serialize",
    format: "docx",
    deadline_ms: 30000,
    idempotency_key: "IDEMP-TEST-1",
    client_engine_version: "genoffice@09485f88+uniwork-office.0",
    payload: {
      document_model_ref: "engine-session:test",
      input_bytes: input.toString("base64"),
      input_checksum: sha256Bytes(input),
      input_length: input.length,
      base_revision: 7,
      base_version_id: "01J8Z0V0000000000000000A",
    },
    ...overrides,
  };
}

// An INDEPENDENT sha256 so the module's checksum function is not verified against
// itself. If both shared a bug the negative control below would catch it.
function independentSha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

test("the mandatory case list cannot shrink or silently duplicate", () => {
  const ids = FAULT_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate case id");
  assert.deepEqual([...ids].sort(), [...REQUIRED_CASE_IDS].sort());
  assert.equal(REQUIRED_CASE_IDS.length, 33);
  for (const c of FAULT_CASES) {
    assert.ok(c.requirement.length > 0, c.id + " has no requirement text");
    assert.ok(c.expect && Object.keys(c.expect).length > 0, c.id + " has no literal oracle");
    assert.equal(typeof c.run, "function", c.id + " has no runner");
  }
});

test("every mandatory case matches its oracle", () => {
  const report = runAllCases();
  assert.equal(report.failed, 0, JSON.stringify(report.results.filter((r) => !r.pass), null, 2));
  assert.equal(report.passed, report.total);
  assert.equal(report.evidence_kind, "reference_test");
});

test("limits are finite, safe integers inside a sane envelope", () => {
  for (const [name, value] of Object.entries(LIMITS)) {
    assert.ok(Number.isSafeInteger(value), name + " must be a safe integer, got " + value);
    assert.ok(value > 0, name + " must be positive");
    assert.ok(Number.isFinite(value), name + " must be finite");
  }
  assert.ok(LIMITS.min_deadline_ms < LIMITS.max_deadline_ms);
  assert.ok(LIMITS.max_input_bytes > 0 && LIMITS.max_output_bytes >= LIMITS.max_input_bytes);
  // A hostile value a JSON body could carry must be rejected as a wire violation,
  // not accepted because "it is just a number".
  for (const bad of [Number.NaN, Infinity, -Infinity, 1.5, "10", null, undefined]) {
    const env = {
      request_id: "R", contract_version: CONTRACT_VERSION, protocol_version: PROTOCOL_VERSION,
      operation: "open", format: "docx", deadline_ms: bad,
      payload: { input_bytes: "", input_checksum: sha256Bytes(Buffer.alloc(0)), input_length: 0, base_revision: 0, base_version_id: "V" },
    };
    assert.throws(() => validateEnvelope(env), ContractViolation, "deadline " + String(bad) + " must be refused");
  }
});

test("checksum is recomputed from bytes by an independent implementation", () => {
  for (const sample of [Buffer.alloc(0), Buffer.from("a"), Buffer.from("UniWork Office - kiểm thử"), crypto.randomBytes(257)]) {
    assert.equal(sha256Bytes(sample), independentSha256(sample));
  }
  // Negative control: the module is not returning a constant.
  assert.notEqual(sha256Bytes(Buffer.from("a")), sha256Bytes(Buffer.from("b")));
  // And the commit path stores the checksum of the ACTUAL stored bytes.
  const b = createBoundary({ now: () => 0 });
  const env = baseSerializeEnvelope();
  const { job } = b.submit(env);
  b.run(job, { grant: b.grantFor(job) });
  const stored = b.store.get(job.output_key);
  assert.equal(job.output_checksum, independentSha256(stored));
  assert.equal(job.output_length, stored.length);
});

test("a failed case leaves the current version and the input untouched", () => {
  const b = createBoundary({ now: () => 0 });
  const before = b.record();
  const inputBytes = Buffer.from("fixture-docx-bytes", "utf8");
  const env = baseSerializeEnvelope();
  const { job } = b.submit(env, { behaviour: "bad_checksum" });
  b.run(job, { grant: b.grantFor(job) });
  const after = b.record();
  assert.equal(job.state, "failed");
  assert.equal(job.error.code, "engine_checksum_mismatch");
  assert.equal(after.current_revision, before.current_revision);
  assert.equal(after.current_version_id, before.current_version_id);
  assert.equal(after.versions.length, before.versions.length);
  assert.equal(after.objects.length, before.objects.length);
  // Nothing was stored, so there is no orphan row and no object key.
  assert.equal(b.book.get(job.job_id), null);
  assert.equal(job.output_key, null);
  assert.equal(b.docs.commits, 0);
  // The caller's input buffer is not what the boundary mutates.
  assert.equal(inputBytes.toString("utf8"), "fixture-docx-bytes");
  assert.equal(env.payload.input_checksum, sha256Bytes(inputBytes));
});

test("serialize declaration refusals make no ledger, storage or commit calls, including replay", () => {
  const output = Buffer.from("private serialized bytes");
  for (const [declaration, code] of [
    [{ declared_checksum: independentSha256(Buffer.from("different bytes")) }, "engine_checksum_mismatch"],
    [{ declared_checksum: independentSha256(output), declared_length: output.length + 1 }, "engine_result_invalid"],
  ]) {
    const b = createBoundary({ now: () => 0, engine: { run: () => ({ bytes: output, ...declaration }) } });
    const calls = { ledger: 0, put: 0, commit: 0 };
    for (const [target, method, counter] of [
      [b.book, "record", "ledger"], [b.store, "put", "put"], [b.docs, "commitVersion", "commit"],
    ]) {
      const original = target[method].bind(target);
      target[method] = (...args) => { calls[counter] += 1; return original(...args); };
    }
    const before = b.record();
    const env = baseSerializeEnvelope();
    const { job } = b.submit(env);
    const grant = b.grantFor(job);
    b.run(job, { grant });
    assert.equal(job.state, "failed");
    assert.equal(job.error.code, code);
    assert.deepEqual(calls, { ledger: 0, put: 0, commit: 0 });
    assert.equal(b.docs.currentRevision(), before.current_revision);
    assert.equal(b.docs.currentVersionId(), before.current_version_id);
    assert.deepEqual(b.record().objects, before.objects);
    assert.equal(b.book.get(job.job_id), null);
    assert.equal(job.output_key, null);
    assert.equal(b.grantRegistry.get(grant.grant_id).consumed, true);
    assert.equal(b.submit(env).job, job);
    assert.equal(b.run(job, { grant }), job);
    assert.deepEqual(calls, { ledger: 0, put: 0, commit: 0 });
  }
});

test("a malformed request is refused before a job exists, with the revision intact", () => {
  const b = createBoundary({ now: () => 0 });
  const before = b.record();
  const env = baseSerializeEnvelope();
  delete env.format;
  assert.throws(() => b.submit(env), ContractViolation);
  const after = b.record();
  assert.equal(after.job_count, before.job_count);
  assert.equal(after.current_revision, before.current_revision);
  assert.equal(after.objects.length, before.objects.length);
});

test("the fingerprint ignores request_id but tracks decisive payload changes", () => {
  const a = baseSerializeEnvelope();
  const b = { ...a, request_id: "A-DIFFERENT-REQUEST-ID" };
  assert.equal(payloadFingerprint(a), payloadFingerprint(b), "request_id must not change the fingerprint");
  const changed = baseSerializeEnvelope();
  changed.payload.input_bytes = Buffer.from("n", "utf8").toString("base64");
  changed.payload.input_checksum = sha256Bytes(Buffer.from("n", "utf8"));
  assert.notEqual(payloadFingerprint(a), payloadFingerprint(changed));
  // Key order must not change the fingerprint: canonicalJson sorts keys.
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(payloadFingerprint({ ...a }), payloadFingerprint(JSON.parse(JSON.stringify(a))));
});

test("cancel and complete linearize to exactly one winner", () => {
  const first = createBoundary({ now: () => 0 });
  const env = baseSerializeEnvelope();
  const a = first.submit(env);
  const cancelResult = first.cancel({ request_id: "C", contract_version: CONTRACT_VERSION, protocol_version: PROTOCOL_VERSION, operation: "cancel", format: "docx", deadline_ms: 1000, payload: { job_id: a.job.job_id } });
  const late = first.applyLateResult(a.job);
  assert.equal(cancelResult.linearized, true);
  assert.equal(cancelResult.already_committed, false);
  assert.equal(late.applied, false, "a cancelled job must discard a late result");
  assert.equal(first.docs.commits, 0);

  const second = createBoundary({ now: () => 0 });
  const c = second.submit(baseSerializeEnvelope());
  second.run(c.job, { grant: second.grantFor(c.job) });
  const afterComplete = second.cancel({ request_id: "C", contract_version: CONTRACT_VERSION, protocol_version: PROTOCOL_VERSION, operation: "cancel", format: "docx", deadline_ms: 1000, payload: { job_id: c.job.job_id } });
  assert.equal(afterComplete.linearized, false);
  assert.equal(afterComplete.already_committed, true);
  assert.equal(c.job.state, "completed");
  assert.equal(second.docs.commits, 1);
});

test("a restart turns a running job into crashed and cannot commit it", () => {
  const b = createBoundary({ now: () => 0 });
  const { job } = b.submit(baseSerializeEnvelope());
  job.state = "running";
  const reloaded = b.recoverJob(job.job_id);
  assert.equal(reloaded.state, "crashed");
  assert.equal(reloaded.error.code, "engine_crashed");
  assert.equal(b.docs.commits, 0);
  // A completed job is not re-run by a reload.
  const c = createBoundary({ now: () => 0 });
  const done = c.submit(baseSerializeEnvelope());
  c.run(done.job, { grant: c.grantFor(done.job) });
  const again = c.recoverJob(done.job.job_id);
  assert.equal(again.state, "completed");
  assert.equal(c.docs.commits, 1);
});

test("terminal states are immutable", () => {
  for (const state of TERMINAL_STATES) {
    const b = createBoundary({ now: () => 0 });
    const { job } = b.submit(baseSerializeEnvelope());
    b.settle(job, state);
    assert.throws(() => b.settle(job, state === "completed" ? "failed" : "completed"), BoundaryError);
    assert.equal(job.state, state);
  }
  // Sanity: every terminal state really is a job state.
  for (const s of TERMINAL_STATES) assert.ok(JOB_STATES.includes(s));
});

test("idempotency is keyed on the payload fingerprint, not the key alone", () => {
  const b = createBoundary({ now: () => 0 });
  const first = b.submit(baseSerializeEnvelope());
  assert.equal(first.replay, false);
  b.run(first.job, { grant: b.grantFor(first.job) });
  const same = b.submit(baseSerializeEnvelope());
  assert.equal(same.replay, true);
  assert.equal(b.docs.commits, 1, "a replay must not add a second version");
  const different = baseSerializeEnvelope();
  const otherBytes = Buffer.from("other", "utf8");
  different.payload.input_bytes = otherBytes.toString("base64");
  different.payload.input_checksum = sha256Bytes(otherBytes);
  different.payload.input_length = otherBytes.length;
  assert.throws(() => b.submit(different), (e) => e instanceof BoundaryError && e.code === "payload_fingerprint_mismatch");
});

test("an orphan delete failure is surfaced and retried, never swallowed", () => {
  const store = createFakeObjectStore({ deleteFails: true });
  const ledger = createLedger({ objectStore: store });
  store.put("k", Buffer.from("orphan-bytes"));
  ledger.record({ job_id: "J1", object_key: "k", object_state: "orphaned" });
  const report = ledger.reconcileOrphans();
  assert.equal(report.deleted, 0);
  assert.equal(report.failed, 1);
  assert.equal(report.errors[0].code, "object_missing");
  const row = ledger.get("J1");
  assert.equal(row.object_state, "orphaned", "a failed delete must not flip to deleted");
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, "object_missing");
  assert.ok(store.has("k"), "the object is still there; the ledger says so honestly");
});

test("every error code carries a status, a class, a kind and a retryable flag", () => {
  for (const [code, spec] of Object.entries(ERROR_CODES)) {
    assert.equal(typeof spec.status, "number", code);
    assert.ok(spec.status >= 400 && spec.status < 600, code + " status out of range");
    assert.equal(typeof spec.error_class, "string", code);
    assert.equal(typeof spec.kind, "string", code);
    assert.equal(typeof spec.retryable, "boolean", code);
  }
  // One class, one client path: the two conflict codes must share a class.
  assert.equal(ERROR_CODES.payload_fingerprint_mismatch.error_class, ERROR_CODES.in_flight.error_class);
  assert.equal(ERROR_CODES.payload_fingerprint_mismatch.error_class, "conflict");
  // A boundary error that is not in the table is a bug, not a new code.
  assert.throws(() => new BoundaryError("not_a_code"), /unknown boundary error code/);
});

test("wire fields on the frozen examples are snake_case", () => {
  assert.equal(WIRE_FORMAT, "snake_case");
  const envelope = baseSerializeEnvelope();
  const snake = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
  for (const key of Object.keys(envelope)) {
    assert.ok(snake.test(key), "envelope field is not snake_case: " + key);
  }
  for (const key of Object.keys(envelope.payload)) {
    assert.ok(snake.test(key), "payload field is not snake_case: " + key);
  }
  for (const code of FIDELITY_WARNING_CODES) assert.ok(snake.test(code), code);
  for (const code of Object.keys(ERROR_CODES)) assert.ok(snake.test(code), code);
  for (const op of OPERATIONS) assert.ok(snake.test(op), op);
});

test("no browser-facing projection leaks a path, a storage key or a credential", () => {
  const b = createBoundary({ now: () => 0 });
  const { job } = b.submit(baseSerializeEnvelope());
  b.run(job, { grant: b.grantFor(job) });
  const projection = b.browserProjection(job);
  assert.deepEqual(scanForLeaks(projection), []);
  // The scanner is not vacuous: an object WITH a path or a key is flagged.
  assert.ok(scanForLeaks({ object_key: "office/x" }).includes("storage_key_field"));
  assert.ok(scanForLeaks({ path: "/home/user/secret.docx" }).includes("posix_absolute_path"));
  assert.ok(scanForLeaks({ path: "C:\\\\Users\\\\x\\\\a.docx" }).includes("windows_absolute_path"));
  assert.ok(scanForLeaks({ authorization: "Bearer x" }).includes("credential_field"));
  // The committed object still exists: hiding the key from the client is not hiding the object from Go.
  assert.ok(b.store.has(job.output_key));
});

test("the engine can be injected, which is the seam task 4.4 wires", () => {
  const calls = [];
  const engine = {
    run(request) {
      calls.push({ format: request.envelope.format, jobId: request.jobId });
      return { bytes: Buffer.from("adapter-output", "utf8"), warnings: [{ code: "fonts_substituted" }] };
    },
  };
  const b = createBoundary({ now: () => 0, engine });
  const { job } = b.submit(baseSerializeEnvelope());
  b.run(job, { grant: b.grantFor(job) });
  assert.equal(job.state, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].format, "docx");
  assert.deepEqual(job.warnings, [{ code: "fonts_substituted" }]);
  // Injecting a real engine is exactly what would replace this fake; the model
  // tests still do NOT prove the real engine works. Task 4.4 has since driven the
  // real DOC-003 host through the adapter harness, so the registry entry now
  // POINTS at that run - a pointer is not a pass, and it promotes none of the
  // cases in THIS file.
  const real = EVIDENCE_REGISTRY.real_engine_evidence;
  assert.equal(real.status, "present");
  assert.equal(real.runner, "scripts/office-g0/engine-contract-adapter.mjs");
  assert.equal(real.transport, "loopback-http-post");
  assert.equal(real.upstream_pin, "09485f884dc845cf3bf27fb7edfe489f9d457aad");
  assert.match(real.what_it_proves, /real DOC-003 engine host/);
  assert.match(real.what_it_does_not_prove, /browser rendering/);
  assert.match(real.note, /POINTER, not a pass/);
});

test("the runtime map cannot claim a proven runtime it has not earned", () => {
  assert.equal(runtimeMap.wire_format, "snake_case");
  assert.equal(runtimeMap.product.technical_slug, "uniwork-office");
  assert.equal(runtimeMap.upstream.pinned_commit, "09485f884dc845cf3bf27fb7edfe489f9d457aad");
  assert.equal(runtimeMap.upstream.package_lock_sha256, "DE782E49A1006FAC7287A41C748C696EFD9FB3C3038EAE893EF82DFCA57F9FE5");
  assert.equal(runtimeMap.runtime_selection_verdict.chosen, false);
  for (const format of FORMATS) {
    const entry = runtimeMap.formats[format];
    assert.ok(entry, "runtime map is missing format " + format);
    assert.ok(entry.operations.length >= 3, format + " has too few operations");
    for (const op of entry.operations) {
      assert.ok(["proven", "source_read", "pending"].includes(op.evidence_level), format + "/" + op.operation + " has an unknown evidence level");
    }
  }
  // Exactly one proven row in the whole map, and it must be the PDF text-edit probe.
  const proven = [];
  for (const format of FORMATS) {
    for (const op of runtimeMap.formats[format].operations) {
      if (op.evidence_level === "proven") proven.push(format + "/" + op.operation);
    }
  }
  assert.deepEqual(proven, ["pdf/edit_text"]);
  // Every format summary must agree with its own operation list.
  for (const format of FORMATS) {
    const summary = runtimeMap.format_summary[format];
    const counts = { proven: 0, source_read: 0, pending: 0 };
    for (const op of runtimeMap.formats[format].operations) counts[op.evidence_level] += 1;
    assert.equal(summary.proven, counts.proven, format + " summary proven count drifted");
    assert.equal(summary.source_read, counts.source_read, format + " summary source_read count drifted");
    assert.equal(summary.pending, counts.pending, format + " summary pending count drifted");
    assert.equal(summary.runtime_chosen, false, format + " must not claim a chosen runtime");
  }
});

test("proposed namespaces are marked as new G0 outputs, not deployed resources", () => {
  assert.equal(runtimeMap.packaging_and_namespace.proposed_g0_output, true);
  for (const [, entry] of Object.entries(runtimeMap.packaging_and_namespace)) {
    if (entry && typeof entry === "object" && "evidence_level" in entry) {
      assert.equal(entry.evidence_level, "pending", "a namespace surface must stay pending until a real build exists");
    }
  }
  assert.match(runtimeMap.packaging_and_namespace.theme_rule, /chrome/);
  assert.match(runtimeMap.packaging_and_namespace.theme_rule, /never change authored document bytes/);
});

test("documentation references the runtime map and the harness by real paths", () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/office/g0/engine-contract.md"), "utf8");
  for (const needed of ["module-runtime-map.json", "engine-contract.mjs", "engine-contract.test.mjs", "UniWork Office", "uniwork-office", "DELETE"]) {
    assert.ok(doc.includes(needed), "engine-contract.md is missing " + needed);
  }
  assert.ok(fs.existsSync(path.join(REPO_ROOT, "scripts/office-g0/engine-contract.mjs")));
  assert.ok(fs.existsSync(path.join(REPO_ROOT, "scripts/office-g0/engine-contract.test.mjs")));
  assert.ok(fs.existsSync(path.join(REPO_ROOT, "docs/office/g0/module-runtime-map.json")));
});

test("the doc opening points at the real adapter without denying it, and never cites a volatile file digest", () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/office/g0/engine-contract.md"), "utf8");
  // (a) the header must name the task-4.4 adapter, not only the two model files.
  const header = doc.slice(0, doc.indexOf("---"));
  assert.ok(header.includes("engine-contract-adapter.mjs"), "the header must name the task-4.4 adapter harness");
  // (b) the old blanket denial must be gone: a bare "khong noi adapter that" claim contradicts
  //     section 12.3 and misleads a reader who stops at the title block.
  assert.ok(!doc.includes("không nối adapter thật"), "the opening must not deny the real adapter unqualified");
  assert.ok(/loopback/.test(doc), "the adapter pointer must be qualified as loopback, not product wiring");
  // (c) section 12.3 cites the STABLE oracle digest, never the volatile evidence-file digest.
  const stable = EVIDENCE_REGISTRY.real_engine_evidence.case_oracle_digest;
  assert.ok(doc.includes(stable), "section 12.3 must cite the registry's stable case_oracle_digest");
  assert.ok(!/4BA9BBD2/i.test(doc), "the doc must not cite the volatile adapter-evidence file digest");
  // (d) the doc must document the convert/export unsupported-operation runtime case.
  const tableStart = doc.indexOf("### 12.1");
  const tableEnd = doc.indexOf("### 12.2", tableStart);
  const table = doc.slice(tableStart, tableEnd === -1 ? undefined : tableEnd);
  assert.ok(table.includes("convert-export-unsupported-at-g0"), "the doc must document the convert/export runtime case");
  assert.ok(/unsupported_operation/.test(table), "the convert/export case must pin unsupported_operation");
  // (e) section 3 must name both r2b-enforced grant refusals, not only document/operation/base.
  // The grant SHAPE block also names these fields, so require the RULE: org/ws must lead
  // to grant_scope on one line, and the ceiling must lead to upload_bounds on one line.
  const sec3 = doc.slice(doc.indexOf("## 3."), doc.indexOf("## 4."));
  assert.ok(/\`organization_id\`[^\n]*\`workspace_id\`[^\n]*grant_scope/.test(sec3),
    "section 3 must state the grant org/workspace vs job refusal -> grant_scope");
  assert.ok(/\`max_output_bytes\`[^\n]*upload_bounds/.test(sec3),
    "section 3 must state the grant max_output_bytes ceiling -> upload_bounds");
  // (f) section 1.1 must not claim the runtime map has zero proven rows.
  assert.ok(!doc.includes("không thao tác nào có proof"),
    "section 1.1 must not deny the map's single proven row");
  assert.ok(/runtime_chosen/.test(doc), "the honesty section must reference runtime_chosen");
});

test("the doc's mandatory-case table names every script case, and adds no case the script lacks", () => {
  // The doc table and FAULT_CASES are two spellings of ONE list; a doc row that
  // names no case, or a case with no row, is a documentation drift bug.
  const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/office/g0/engine-contract.md"), "utf8");
  const tableStart = doc.indexOf("### 12.1");
  assert.ok(tableStart !== -1, "the doc must keep its 12.1 case table");
  const tableEnd = doc.indexOf("### 12.2", tableStart);
  const table = doc.slice(tableStart, tableEnd === -1 ? undefined : tableEnd);
  // Read the case id from the SECOND cell of each table row, so prose and the
  // oracle column cannot be mistaken for case ids.
  const documented = new Set();
  for (const line of table.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const cells = line.split("|");
    if (cells.length < 4) continue;
    const match = /`([a-z][a-z0-9-]+)`/.exec(cells[2] ?? "");
    if (match) documented.add(match[1]);
  }
  assert.equal(documented.size, REQUIRED_CASE_IDS.length, "the doc table must have exactly one row per case");
  for (const id of REQUIRED_CASE_IDS) {
    assert.ok(documented.has(id), "the doc table is missing case " + id);
  }
  const ids = new Set(REQUIRED_CASE_IDS);
  for (const token of documented) {
    assert.ok(ids.has(token), "the doc table names a case that does not exist: " + token);
  }
});

test("the doc's fingerprint fence matches the fields the code actually hashes", () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/office/g0/engine-contract.md"), "utf8");
  const start = doc.indexOf("fingerprint = sha256(json_canonical({");
  assert.ok(start !== -1, "the doc must keep its fingerprint fence");
  const fence = doc.slice(start, doc.indexOf("```", start));
  // The deadline exclusion is stated in the paragraph NEXT to the fence, so read
  // the whole section: the fence lists hashed keys, the prose states the rule.
  const sectionEnd = doc.indexOf("### 7.2", start);
  const section = doc.slice(start, sectionEnd === -1 ? undefined : sectionEnd);
  const envelope = baseSerializeEnvelope();
  const fingerprintInputs = { checksum: sha256Bytes(Buffer.from("fixture-docx-bytes", "utf8")), length: 20 };
  const withDeadline = payloadFingerprint(envelope, { inputs: fingerprintInputs });
  // deadline_ms is deliberately OUTSIDE the fingerprint; the doc must say so.
  assert.ok(section.includes("deadline_ms"), "the section must mention deadline_ms so the exclusion is stated");
  assert.ok(!/engine_version,\s*deadline_ms/.test(fence), "the fence must not list deadline_ms as a hashed key");
  const movedDeadline = structuredClone(envelope);
  movedDeadline.deadline_ms = envelope.deadline_ms + 1000;
  assert.equal(payloadFingerprint(movedDeadline, { inputs: fingerprintInputs }), withDeadline);
  // Every field the code hashes must be named in the fence.
  for (const field of ["contract_version", "protocol_version", "operation", "format", "input_checksum", "input_length", "base_revision", "base_version_id", "document_model_ref", "source_version_id", "engine_version"]) {
    assert.ok(fence.includes(field), "the fence omits a hashed field: " + field);
  }
});



test("input bytes are measured at submit: a lying digest, a lying length, and non-canonical base64 never reach the ledger", () => {
  const b = createBoundary({ now: () => 0 });
  const before = b.record();
  const lyingDigest = baseSerializeEnvelope();
  lyingDigest.payload.input_checksum = sha256Bytes(Buffer.from("other", "utf8"));
  assert.throws(() => b.submit(lyingDigest), (e) => e instanceof BoundaryError && e.code === "upload_checksum_mismatch");
  const lyingLength = baseSerializeEnvelope({ request_id: "REQ-TEST-LEN" });
  lyingLength.payload.input_length = lyingLength.payload.input_length + 1;
  assert.throws(() => b.submit(lyingLength), (e) => e instanceof BoundaryError && e.code === "upload_checksum_mismatch");
  const smuggled = baseSerializeEnvelope({ request_id: "REQ-TEST-B64" });
  smuggled.payload.input_bytes = "AAAA*";
  assert.throws(() => b.submit(smuggled), ContractViolation);
  const after = b.record();
  assert.equal(after.job_count, before.job_count);
  assert.equal(after.current_revision, before.current_revision);
  assert.equal(after.objects.length, before.objects.length);  // The fingerprint uses the MEASURED digest when the boundary supplies it.
  const env = baseSerializeEnvelope();
  env.payload.input_checksum = sha256Bytes(Buffer.from("other", "utf8"));
  const measured = { checksum: sha256Bytes(Buffer.from("fixture-docx-bytes", "utf8")), length:
  env.payload.input_length };
  assert.notEqual(payloadFingerprint(env, { inputs: measured }), payloadFingerprint(env));
});

test("run enforces the accepted deadline from the trusted clock", () => {
  let now = 0;
  const b = createBoundary({ now: () => now });
  const { job } = b.submit(baseSerializeEnvelope({ deadline_ms: 10 }));
  assert.equal(job.accepted_at, 0);
  assert.equal(job.deadline_ms, 10);
  // Exactly at accepted_at + deadline_ms the job is already late.
  now = 10;
  const late = b.run(job, { grant: b.grantFor(job) });
  assert.equal(late.state, "timed_out");
  assert.equal(late.error.code, "engine_timeout");
  assert.equal(b.docs.commits, 0);
  assert.equal(b.store.objects.size, 0);
  assert.equal(b.grantRegistry.get(job.grant.grant_id).consumed, false, "the unused grant must not be consumed");
  // A replay returns the ORIGINAL job and cannot extend the accepted window.
  now = 0;
  const replay = b.submit(baseSerializeEnvelope({ deadline_ms: 10 }));
  assert.equal(replay.replay, true);
  assert.equal(replay.job, job);
  assert.equal(replay.job.state, "timed_out");
  assert.equal(replay.job.accepted_at, 0);
});

test("one millisecond inside the accepted deadline still runs", () => {
  let now = 0;
  const b = createBoundary({ now: () => now });
  const { job } = b.submit(baseSerializeEnvelope());
  now = 29999;
  b.run(job, { grant: b.grantFor(job) });
  assert.equal(job.state, "completed");
  assert.equal(b.docs.commits, 1);
});

test("a caller job object is not execution authority", () => {
  const calls = [];
  const engine = { run(request) { calls.push(request.jobId); return { bytes: Buffer.from("ok"), warnings: [] }; } };
  const b = createBoundary({ now: () => 0, engine });
  const { job } = b.submit(baseSerializeEnvelope());
  const grant = b.grantFor(job);
  // (1) Unknown job_id: not_found.
  assert.throws(() => b.run({ ...job, job_id: "JOB00000000000000000000099" }, { grant }),
    (e) => e instanceof BoundaryError && e.code === "not_found");
  // (2) Shallow copy with a replaced envelope must not run unaccepted bytes.
  const copy = { ...job, envelope: structuredClone(job.envelope) };
  copy.envelope.payload.input_bytes = Buffer.from("UNACCEPTED").toString("base64");
  assert.throws(() => b.run(copy, { grant }),
    (e) => e instanceof BoundaryError && e.code === "payload_fingerprint_mismatch");
  // (3) In-place mutation of the registered job's own execution fields.
  const acceptedEnvelope = job.envelope;
  job.operation = "capability";
  assert.throws(() => b.run(job, { grant }),
    (e) => e instanceof BoundaryError && e.code === "payload_fingerprint_mismatch");
  job.operation = "serialize";
  job.envelope = structuredClone(copy.envelope);
  assert.throws(() => b.run(job, { grant }),
    (e) => e instanceof BoundaryError && e.code === "payload_fingerprint_mismatch");
  job.envelope = acceptedEnvelope;
  // Zero unaccepted engine calls, grant use, object writes or commits.
  assert.deepEqual(calls, []);
  assert.equal(b.docs.commits, 0);
  assert.equal(b.store.objects.size, 0);
  assert.equal(b.grantRegistry.get(grant.grant_id).consumed, false);
  assert.equal(job.state, "accepted");
  // The genuine registered job still runs once its fields are the accepted ones.
  b.run(job, { grant });
  assert.equal(job.state, "completed");
  assert.deepEqual(calls, [job.job_id]);
  assert.equal(b.docs.commits, 1);
});

test("the mandatory read-grant scope case reports the public refusal", () => {
  const report = runAllCases();
  const observed = report.results.find((r) => r.id === "grant-scope-exceeded");
  assert.ok(observed, "grant-scope-exceeded must exist");
  assert.equal(observed.pass, true, JSON.stringify(observed.mismatches));
  assert.equal(observed.observed.code, "grant_scope");
  assert.equal(observed.observed.commits, 0);
});

test("an implicit run propagates the accepted actor to grant authorization", () => {
  const b = createBoundary({ now: () => 0 });
  const { job } = b.submit(baseSerializeEnvelope());
  // No actorId: the registered owner is the effective actor, so the grant this job
  // minted authorizes it and the run completes with exactly one commit.
  const done = b.run(job, { grant: b.grantFor(job) });
  assert.equal(done.state, "completed");
  assert.equal(b.docs.commits, 1);
  // A read grant on an implicit run still reaches the PUBLIC scope refusal, not an
  // actor error: grant_scope, not grant_actor_mismatch.
  const c = createBoundary({ now: () => 0 });
  const readJob = c.submit(baseSerializeEnvelope({ request_id: "REQ-ACTOR-SCOPE", idempotency_key: "IDEMP-ACTOR-SCOPE" })).job;
  c.run(readJob, { grant: c.readGrantFor(readJob) });
  assert.equal(readJob.error.code, "grant_scope");
  assert.equal(c.docs.commits, 0);
  // An explicit FOREIGN actor is still refused before any effect.
  const d = createBoundary({ now: () => 0 });
  const foreign = d.submit(baseSerializeEnvelope({ request_id: "REQ-ACTOR-FOREIGN", idempotency_key: "IDEMP-ACTOR-FOREIGN" })).job;
  const grant = d.grantFor(foreign);
  assert.throws(() => d.run(foreign, { actorId: "ACTOR-B", grant }),
    (e) => e instanceof BoundaryError && e.code === "grant_actor_mismatch");
  assert.equal(d.docs.commits, 0);
  assert.equal(d.grantRegistry.get(grant.grant_id).consumed, false);
  assert.equal(foreign.state, "accepted");
});

test("accepted metadata is private: a mutated handle cannot change output, identity or warnings", () => {
  const calls = [];
  const engine = { run(request) { calls.push(request.warnings); return { bytes: Buffer.from("ok"), warnings:
  [] }; } };
  const b = createBoundary({ now: () => 0, engine });
  const callerWarnings = [{ code: "fonts_substituted" }];
  const { job } = b.submit(baseSerializeEnvelope({ declared_warnings: callerWarnings }));
  const grant = b.grantFor(job);
  // A later mutation of the CALLER's array must not reach engine input: the accepted
  // warnings are an independent frozen copy taken at submit.
  callerWarnings.push({ code: "injected_by_caller" });
  const acceptedWarnings = job.declared_warnings;
  const acceptedInput = job.accepted_input;
  const restore = () => {
    job.format = "docx";
    job.organization_id = "ORG-1";
    job.workspace_id = "WS-1";
    job.declared_warnings = acceptedWarnings;
    job.accepted_input = acceptedInput;
  };
  const drifts = [
    () => { job.format = "pdf"; },
    () => { job.organization_id = "ORG-9"; },
    () => { job.workspace_id = "WS-9"; },
    () => { job.declared_warnings = [{ code: "engine_warning_drift" }]; },
    () => { job.accepted_input = { checksum: sha256Bytes(Buffer.from("x")), length: 1 }; },
  ];
  for (const drift of drifts) {
    drift();
    assert.throws(() => b.run(job, { grant }),
      (e) => e instanceof BoundaryError && e.code === "payload_fingerprint_mismatch");
    restore();
  }
  // Zero engine calls, object writes, commits or grant uses for drifted handles.
  assert.deepEqual(calls, []);
  assert.equal(b.docs.commits, 0);
  assert.equal(b.store.objects.size, 0);
  assert.equal(b.grantRegistry.get(grant.grant_id).consumed, false);
  assert.equal(job.state, "accepted");
  // The genuine handle still runs; the engine sees ONLY the accepted warnings and
  // the committed object keeps the accepted DOCX identity.
  b.run(job, { grant });
  assert.equal(job.state, "completed");
  assert.deepEqual(calls, [[{ code: "fonts_substituted" }]]);
  assert.equal(job.output_key, "office/jobs/" + job.job_id + "/docx.out");
  assert.equal(b.docs.commits, 1);
});

test("serialize consumes the accepted model content, not a reference label", () => {
  const b = createBoundary({ now: () => 0 });
  const openEnvelope = (key, text) => {
    const bytes = Buffer.from(text, "utf8");
    return baseSerializeEnvelope({
      operation: "open", request_id: "REQ-OPEN-" + key, idempotency_key: "IDEMP-OPEN-" + key,
      payload: { input_bytes: bytes.toString("base64"), input_checksum: sha256Bytes(bytes), input_length:
      bytes.length,
      base_revision: b.docs.currentRevision(), base_version_id: b.docs.currentVersionId() },
    });
  };
  const serializeEnvelope = (key, ref) => baseSerializeEnvelope({
    operation: "serialize", request_id: "REQ-SER-" + key, idempotency_key: "IDEMP-SER-" + key,
    payload: { document_model_ref: ref, base_revision: b.docs.currentRevision(), base_version_id:
    b.docs.currentVersionId() },
  });

  const docA = "DOC-A-content";
  const docB = "DOC-B-different-content";
  const openA = b.submit(openEnvelope("A", docA)).job;
  b.run(openA, { grant: b.grantFor(openA) });                 // valid implicit owner
  const openB = b.submit(openEnvelope("B", docB)).job;
  b.run(openB, { grant: b.grantFor(openB) });                 // valid implicit owner
  const refA = openA.document_model_ref;
  const refB = openB.document_model_ref;
  assert.notEqual(refA, refB);

  const serA = b.submit(serializeEnvelope("A", refA)).job;
  b.run(serA, { grant: b.grantFor(serA) });
  assert.equal(serA.state, "completed");
  const serB = b.submit(serializeEnvelope("B", refB)).job;
  b.run(serB, { grant: b.grantFor(serB) });
  assert.equal(serB.state, "completed");

  const bytesA = Buffer.from(b.store.get(serA.output_key));
  const bytesB = Buffer.from(b.store.get(serB.output_key));
  // The serialized payload CORRESPONDS to the opened payload, not to the label.
  assert.equal(bytesA.toString("utf8"), "engine-output:" + docA);
  assert.equal(bytesB.toString("utf8"), "engine-output:" + docB);
  assert.notEqual(bytesA.toString("utf8"), bytesB.toString("utf8"));
  assert.ok(!bytesA.toString("utf8").includes(refA), "a reference label must not become content");
  assert.equal(serA.output_checksum, sha256Bytes(bytesA));
  assert.equal(serA.output_length, bytesA.length);
  assert.equal(b.docs.commits, 2);
});

test("a model handle replaced, rescoped or mutated in place after acceptance cannot change committed bytes", () => {
  const bytesOf = (t) => Buffer.from(t, "utf8");
  const build = () => {
    const b = createBoundary({ now: () => 0 });
    const openEnvelope = (key, text) => baseSerializeEnvelope({
      operation: "open", request_id: "REQ-O-" + key, idempotency_key: "IDEMP-O-" + key,
      payload: { input_bytes: bytesOf(text).toString("base64"), input_checksum: sha256Bytes(bytesOf(text)),
      input_length: bytesOf(text).length, base_revision: b.docs.currentRevision(), base_version_id:
      b.docs.currentVersionId() },
    });
    const serializeEnvelope = (key, ref) => baseSerializeEnvelope({
      operation: "serialize", request_id: "REQ-S-" + key, idempotency_key: "IDEMP-S-" + key,
      payload: { document_model_ref: ref, base_revision: b.docs.currentRevision(), base_version_id:
      b.docs.currentVersionId() },
    });
    const openA = b.submit(openEnvelope("A", "ALPHA")).job;
    b.run(openA, { grant: b.grantFor(openA) });
    const openB = b.submit(openEnvelope("B", "BRAVO")).job;
    b.run(openB, { grant: b.grantFor(openB) });
    const accepted = b.submit(serializeEnvelope("A", openA.document_model_ref)).job;
    return { b, openA, openB, accepted, grant: b.grantFor(accepted) };
  };

  const tampers = [
    // (1) Swap in ANOTHER document's opened model record.
    (s) => s.b.modelRegistry.set(s.openA.document_model_ref,
    { ...s.b.modelRegistry.get(s.openB.document_model_ref) }),
    // (2) Replace the content under the same reference (new digest field).
    (s) => s.b.modelRegistry.set(s.openA.document_model_ref, { ...s.b.modelRegistry.get(s.openA.document_model_ref),
      content_bytes: bytesOf("TAMPERED"), content_checksum: sha256Bytes(bytesOf("TAMPERED")) }),
    // (3) Mutate the SAME Buffer in place: stored digest/length are now stale.
    (s) => { const rec = s.b.modelRegistry.get(s.openA.document_model_ref); rec.content_bytes[0] =
    rec.content_bytes[0] ^ 0xff; },
    // (4) Rescope the record to another document.
    (s) => s.b.modelRegistry.set(s.openA.document_model_ref, { ...s.b.modelRegistry.get(s.openA.document_model_ref),
      document_id: "DOC-2" }),
  ];
  const expected = ["payload_fingerprint_mismatch", "payload_fingerprint_mismatch",
  "payload_fingerprint_mismatch", "not_found"];
  for (let i = 0; i < tampers.length; i++) {
    const s = build();
    tampers[i](s);
    const commitsBefore = s.b.docs.commits;
    const result = s.b.run(s.accepted, { grant: s.grant });
    assert.equal(result.state, "failed");
    assert.equal(result.error.code, expected[i]);
    // Refused inside the guarded path: no consume, no object write, no commit.
    assert.equal(s.b.grantRegistry.get(s.grant.grant_id).consumed, false);
    assert.equal(s.b.docs.commits, commitsBefore);
    assert.equal(s.b.store.objects.size, 0);
  }

  // Intact: the genuine handle commits the accepted content, once.
  const ok = build();
  ok.b.run(ok.accepted, { grant: ok.grant });
  assert.equal(ok.accepted.state, "completed");
  assert.equal(ok.b.store.get(ok.accepted.output_key).toString("utf8"), "engine-output:ALPHA");
  assert.equal(ok.b.docs.commits, 1);
});

test("copied jobs and expired grants stay rejected before consume or commit on a model serialize", () => {
  const b = createBoundary({ now: () => 0 });
  const bytes = Buffer.from("OPENED", "utf8");
  const openEnv = baseSerializeEnvelope({ operation: "open", request_id: "REQ-OPEN-X", idempotency_key: "IDEMP-OPEN-X",
    payload: { input_bytes: bytes.toString("base64"), input_checksum: sha256Bytes(bytes), input_length: bytes.length,
    base_revision: b.docs.currentRevision(), base_version_id: b.docs.currentVersionId() } });
  const opened = b.submit(openEnv).job;
  b.run(opened, { grant: b.grantFor(opened) });

  const ser = b.submit(baseSerializeEnvelope({ operation: "serialize", request_id: "REQ-SER-X", idempotency_key:
  "IDEMP-SER-X",
    payload: { document_model_ref: opened.document_model_ref, base_revision: b.docs.currentRevision(),
    base_version_id:
    b.docs.currentVersionId() } })).job;
  const grant = b.grantFor(ser);
  const copy = { ...ser, envelope: structuredClone(ser.envelope) };
  assert.throws(() => b.run(copy, { grant }),
    (e) => e instanceof BoundaryError && e.code === "payload_fingerprint_mismatch");
  assert.equal(b.grantRegistry.get(grant.grant_id).consumed, false);
  assert.equal(b.docs.commits, 0);
  assert.equal(b.store.objects.size, 0);
  assert.equal(ser.state, "accepted");

  let now = 0;
  const c = createBoundary({ now: () => now });
  const openedC = c.submit(openEnv).job;
  c.run(openedC, { grant: c.grantFor(openedC) });
  const serC = c.submit(baseSerializeEnvelope({ operation: "serialize", request_id: "REQ-SER-Y", idempotency_key:
  "IDEMP-SER-Y",
    payload: { document_model_ref: openedC.document_model_ref, base_revision: c.docs.currentRevision(),
    base_version_id:
    c.docs.currentVersionId() } })).job;
  const grantC = c.grantFor(serC);
  c.grantRegistry.set(grantC.grant_id, { ...c.grantRegistry.get(grantC.grant_id), expires_at: 0 });
  now = 1;
  c.run(serC, { grant: grantC });
  assert.equal(serC.state, "failed");
  assert.equal(serC.error.code, "grant_expired");
  assert.equal(c.grantRegistry.get(grantC.grant_id).consumed, false);
  assert.equal(c.docs.commits, 0);
});

test("an injected engine edit result is what a later serialize commits", () => {
  const calls = [];
  const engine = {
    run(request) {
      calls.push(request.envelope.operation);
      if (request.envelope.operation === "edit") return { bytes: Buffer.from("EDITED"), warnings: [] };
      const fromModel = request.model ? Buffer.from(request.model.content_bytes) : null;
      const fromPayload = typeof request.envelope.payload.input_bytes === "string"
        ? Buffer.from(request.envelope.payload.input_bytes, "base64") : null;
      return { bytes: Buffer.from(fromModel ?? fromPayload ?? Buffer.alloc(0)), warnings: [] };
    },
  };
  const b = createBoundary({ now: () => 0, engine });
  const envelope = (operation, payload) => ({
    request_id: "REQ-" + operation, contract_version: CONTRACT_VERSION, protocol_version: PROTOCOL_VERSION,
    format: "docx", deadline_ms: 30000, client_engine_version: "genoffice@09485f88+uniwork-office.0",
    operation, idempotency_key: "KEY-" + operation,
    payload: { ...payload, base_revision: b.docs.currentRevision(), base_version_id: b.docs.currentVersionId() },
  });
  const original = Buffer.from("ORIGINAL");
  const open = b.submit(envelope("open", { input_bytes: original.toString("base64"),
    input_checksum: sha256Bytes(original), input_length: original.length })).job;
  b.run(open, { grant: b.grantFor(open) });
  const edit = b.submit(envelope("edit", { document_model_ref: open.document_model_ref,
    edits: [{ op: "set_text", target: { block_index: 0 }, text: "EDITED" }] })).job;
  b.run(edit, { grant: b.grantFor(edit) });
  const serialized = b.submit(envelope("serialize", { document_model_ref: edit.document_model_ref })).job;
  const grant = b.grantFor(serialized);
  b.run(serialized, { grant });
  const committed = b.store.get(serialized.output_key).toString("utf8");
  assert.deepEqual(calls, ["open", "edit", "serialize"]);
  assert.equal(open.state, "completed");
  assert.equal(edit.state, "completed");
  assert.equal(serialized.state, "completed");
  assert.equal(b.docs.commits, 1);
  assert.equal(committed, "EDITED");
  assert.equal(b.grantRegistry.get(grant.grant_id).consumed, true);
  // The pre-repair defect: open registered the upload, edit copied it through, and
  // serialize committed ORIGINAL while every job state still read completed.
  assert.notEqual(committed, "ORIGINAL");
});

test("the default fake engine commits the edit transform, not the opened upload", () => {
  const b = createBoundary({ now: () => 0 });
  const upload = Buffer.from("UPLOAD-BYTES", "utf8");
  const open = b.submit(baseSerializeEnvelope({ operation: "open", request_id: "REQ-FAKE-OPEN", idempotency_key: "IDEMP-FAKE-OPEN",
    payload: { input_bytes: upload.toString("base64"), input_checksum: sha256Bytes(upload), input_length: upload.length,
    base_revision: b.docs.currentRevision(), base_version_id: b.docs.currentVersionId() } })).job;
  b.run(open, { grant: b.grantFor(open) });
  const edit = b.submit(baseSerializeEnvelope({ operation: "edit", request_id: "REQ-FAKE-EDIT", idempotency_key: "IDEMP-FAKE-EDIT",
    payload: { document_model_ref: open.document_model_ref,
    edits: [{ op: "set_text", target: { block_index: 0 }, text: "EDITED-TEXT" }],
    base_revision: b.docs.currentRevision(), base_version_id: b.docs.currentVersionId() } })).job;
  b.run(edit, { grant: b.grantFor(edit) });
  const serialized = b.submit(baseSerializeEnvelope({ operation: "serialize", request_id: "REQ-FAKE-SER", idempotency_key: "IDEMP-FAKE-SER",
    payload: { document_model_ref: edit.document_model_ref, base_revision: b.docs.currentRevision(),
    base_version_id: b.docs.currentVersionId() } })).job;
  b.run(serialized, { grant: b.grantFor(serialized) });
  const committed = b.store.get(serialized.output_key).toString("utf8");
  assert.equal(serialized.state, "completed");
  assert.equal(b.docs.commits, 1);
  // serialize prefixes the EDIT result: not the opened upload, not the ref label.
  assert.equal(committed, "engine-output:EDITED-TEXT");
  assert.ok(!committed.includes("UPLOAD-BYTES"));
  assert.ok(!committed.includes(edit.document_model_ref));
});

test("open registers the produced model bytes, never a reference label", () => {
  const b = createBoundary({ now: () => 0 });
  const upload = Buffer.from("OPEN-PRODUCED", "utf8");
  const open = b.submit(baseSerializeEnvelope({ operation: "open", request_id: "REQ-OPEN-PROD", idempotency_key: "IDEMP-OPEN-PROD",
    payload: { input_bytes: upload.toString("base64"), input_checksum: sha256Bytes(upload), input_length: upload.length,
    base_revision: b.docs.currentRevision(), base_version_id: b.docs.currentVersionId() } })).job;
  b.run(open, { grant: b.grantFor(open) });
  const record = b.modelRegistry.get(open.document_model_ref);
  assert.ok(record, "open must register a session model record");
  // The fake-open rule produces the decoded upload; the record is never the ref.
  assert.equal(Buffer.from(record.content_bytes).toString("utf8"), "OPEN-PRODUCED");
  assert.equal(record.content_checksum, sha256Bytes(Buffer.from("OPEN-PRODUCED")));
  assert.equal(record.content_length, Buffer.from("OPEN-PRODUCED").length);
  assert.notEqual(Buffer.from(record.content_bytes).toString("utf8"), open.document_model_ref);
});

test("the fingerprint prefers the MEASURED digest and length over the declared pair", () => {
  // Both spellings are present, so this pins the branch rather than a single
  // fallback: a caller who declares one length while sending bytes of another
  // must not be able to steer the fingerprint with the declared value.
  const env = baseSerializeEnvelope();
  env.payload.input_checksum = sha256Bytes(Buffer.from("declared-not-sent", "utf8"));
  env.payload.input_length = 4242;
  const measured = { checksum: sha256Bytes(Buffer.from("fixture-docx-bytes", "utf8")), length: Buffer.from("fixture-docx-bytes").length };
  const measuredFingerprint = payloadFingerprint(env, { inputs: measured });
  // The measured pair decides; the declared pair cannot reproduce it.
  assert.notEqual(measuredFingerprint, payloadFingerprint(env));
  assert.equal(measuredFingerprint, payloadFingerprint(env, { inputs: { ...measured } }));
  // Two envelopes that differ ONLY in the declared fields fingerprint the same
  // once the measured bytes are supplied: declared values are presentation.
  const twin = structuredClone(env);
  twin.payload.input_checksum = sha256Bytes(Buffer.from("also-declared-not-sent", "utf8"));
  twin.payload.input_length = 7;
  assert.equal(payloadFingerprint(twin, { inputs: measured }), measuredFingerprint);
  // Without a measured pair the declared values are the only thing available, so
  // the same two envelopes fingerprint DIFFERENTLY - that difference is what the
  // boundary removes by always measuring first.
  assert.notEqual(payloadFingerprint(twin), payloadFingerprint(env));
});

// ---------------------------------------------------------------------------
// Adapter harness (task 4.4): the parts that do NOT need a live host.
// ---------------------------------------------------------------------------

test("classify maps an unreachable host to a retryable engine failure, never a success", () => {
  const unreachable = classify({ reachable: false, transport_error: "ECONNREFUSED", transport_status: null, parsed: null, parse_error: null });
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.mapped_code, "engine_crashed");
  assert.equal(unreachable.mapped_class, "engine");
  assert.equal(unreachable.retryable, true);
  // A client-side timeout is a DIFFERENT engine code, and is still retryable.
  const timedOut = classify({ reachable: false, transport_error: "client_timeout", transport_status: null, parsed: null, parse_error: null });
  assert.equal(timedOut.mapped_code, "engine_timeout");
  assert.equal(timedOut.retryable, true);
  // A transport error nobody mapped degrades to the unreachable default, not a pass.
  const unknownTransport = classify({ reachable: false, transport_error: "EHOSTDOWN", transport_status: null, parsed: null, parse_error: null });
  assert.equal(unknownTransport.adapter_code, "EHOSTDOWN");
  assert.equal(unknownTransport.mapped_code, "engine_crashed");
});

test("classify reads a refusal from the envelope code, and a 200 with ok:false is still a refusal", () => {
  const refused = classify({ reachable: true, transport_status: 405, parsed: { ok: false, code: "method_not_allowed" }, parse_error: null });
  assert.equal(refused.ok, false);
  assert.equal(refused.adapter_code, "method_not_allowed");
  assert.equal(refused.mapped_class, "contract_violation");
  assert.equal(refused.field_path, "transport.method");
  assert.equal(refused.retryable, false);
  // HTTP 200 is not success by itself: the envelope must say ok:true.
  const contradictory = classify({ reachable: true, transport_status: 200, parsed: { ok: false, code: "no_session" }, parse_error: null });
  assert.equal(contradictory.ok, false);
  assert.equal(contradictory.mapped_code, "not_found");
  const success = classify({ reachable: true, transport_status: 200, parsed: { ok: true, result: { pong: true } }, parse_error: null });
  assert.equal(success.ok, true);
  assert.deepEqual(success.result, { pong: true });
  assert.equal(success.mapped_code, null);
  assert.equal(success.retryable, null);
});

test("an unparseable or unmapped error is a caller fault, never waved through", () => {
  const notJson = classify({ reachable: true, transport_status: 400, parsed: null, parse_error: "Unexpected token" });
  assert.equal(notJson.adapter_code, "bad_json");
  assert.equal(notJson.mapped_class, "contract_violation");
  assert.equal(notJson.field_path, "transport.body");
  // Empty 200 body: no envelope, no parse error - still not a success.
  const empty = classify({ reachable: true, transport_status: 200, parsed: null, parse_error: null });
  assert.equal(empty.ok, false);
  assert.equal(empty.adapter_code, "unparsed_error");
  assert.equal(empty.field_path, "transport.unmapped_code");
  // A code the map does not know must NOT be treated as covered by the contract.
  const unmapped = classify({ reachable: true, transport_status: 500, parsed: { ok: false, code: "brand_new_adapter_code" }, parse_error: null });
  assert.equal(unmapped.mapped_code, null);
  assert.equal(unmapped.field_path, "transport.unmapped_code");
});

test("the adapter error map is complete, typed, and uses the contract vocabulary", () => {
  const classes = new Set(["contract_violation", "missing", "incompatible", "engine"]);
  for (const [adapterCode, mapped] of Object.entries(ADAPTER_ERROR_MAP)) {
    assert.ok(classes.has(mapped.error_class), adapterCode + " has an unknown error_class " + mapped.error_class);
    assert.equal(typeof mapped.retryable, "boolean", adapterCode + " must declare retryable");
    if (mapped.code !== null) {
      assert.ok(ERROR_CODES[mapped.code], adapterCode + " maps to a code outside ERROR_CODES: " + mapped.code);
    } else {
      assert.ok(mapped.field_path !== null, adapterCode + " maps to no contract code, so it must name a field path");
    }
    if (mapped.field_path !== null) {
      assert.match(mapped.field_path, /^transport\./, adapterCode + " field_path must be a transport path");
    }
  }
  for (const [name, mapped] of Object.entries(ADAPTER_CLIENT_FAILURE)) {
    assert.ok(ERROR_CODES[mapped.code], name + " maps to a code outside ERROR_CODES: " + mapped.code);
  }
  assert.equal(ADAPTER_TRANSPORT, "loopback-http-post");
});

test("every adapter code a fault case expects is in the error map", () => {
  assert.ok(ADAPTER_FAULT_CASES.length >= 10, "the real-adapter case list must keep its breadth");
  const ids = ADAPTER_FAULT_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate adapter case id");
  for (const c of ADAPTER_FAULT_CASES) {
    assert.ok(c.requirement.length > 0, c.id + " has no requirement text");
    assert.ok(c.expect && Object.keys(c.expect).length > 0, c.id + " has no literal oracle");
    assert.equal(typeof c.run, "function", c.id + " has no runner");
    for (const key of ["adapter_code", "refused_adapter_code"]) {
      if (typeof c.expect[key] === "string") {
        assert.ok(ADAPTER_ERROR_MAP[c.expect[key]], c.id + " expects unmapped adapter code " + c.expect[key]);
      }
    }
  }
  assert.deepEqual(REQUIRED_FIXTURES, ["g0-kitchen-sink.docx", "g0-text.pdf", "g0-slides.pptx"]);
});

test("assertInside refuses a sibling-prefix escape and a traversal, and never writes first", () => {
  const root = path.join(REPO_ROOT, ".office-g0-lab-root-probe");
  const inside = assertInside(root, path.join(root, "out", "x.docx"));
  assert.equal(inside, path.resolve(root, "out", "x.docx"));
  assert.equal(assertInside(root, root), path.resolve(root), "the root itself is allowed");
  assert.throws(() => assertInside(root, path.join(root, "..", "escaped")), /refusing to write outside/);
  // A SIBLING whose name merely starts with the root name is not inside it.
  assert.throws(() => assertInside(root, root + "-other" + path.sep + "x"), /refusing to write outside/);
  assert.throws(() => assertInside(root, path.resolve(root, "..", "..", "package.json")), /refusing to write outside/);
});

test("prepareLab copies only the DOC-003 fixtures it finds, and refuses a lab outside its root", () => {
  const sandbox = fs.mkdtempSync(path.join(REPO_ROOT, ".office-g0-lab-test-"));
  try {
    const allowedRoot = path.join(sandbox, "allowed");
    const fixturesDir = path.join(sandbox, "spike-fixtures");
    fs.mkdirSync(fixturesDir, { recursive: true });
    // Two of the three required fixtures exist, so the report is honest about the gap.
    fs.writeFileSync(path.join(fixturesDir, "g0-kitchen-sink.docx"), Buffer.from("docx-fixture-bytes", "utf8"));
    fs.writeFileSync(path.join(fixturesDir, "g0-text.pdf"), Buffer.from("pdf-fixture-bytes", "utf8"));

    // A lab outside the root is refused BEFORE any directory or copy happens.
    assert.throws(() => prepareLab({ labDir: path.join(sandbox, "outside-lab"), fixturesDir, allowedRoot: path.join(sandbox, "allowed") }),
      /refusing to write outside/);
    assert.equal(fs.existsSync(path.join(sandbox, "outside-lab")), false, "a refused lab must not be created");

    const prepared = prepareLab({ labDir: path.join(allowedRoot, "lab"), fixturesDir, allowedRoot });
    assert.deepEqual(prepared.placed.map((p) => p.name), ["g0-kitchen-sink.docx", "g0-text.pdf"]);
    for (const placed of prepared.placed) {
      assert.equal(placed.sha256, sha256Bytes(fs.readFileSync(path.join(prepared.fixturesDir, placed.name))));
      assert.equal(placed.bytes, fs.statSync(path.join(prepared.fixturesDir, placed.name)).size);
    }
    // The spike fixture dir is left untouched: this harness is read-only on it.
    assert.equal(fs.readdirSync(fixturesDir).length, 2);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("runAdapterCase compares only the oracle keys and records real_engine_evidence", () => {
  // A synthetic case against a stub client pins the comparison + evidence label
  // without touching a socket. The live cases stay operator-booted.
  const caseUnder = {
    id: "synthetic",
    requirement: "a stub proves the comparison contract",
    expect: { reachable: true, ok: true, value: 3 },
    run: async () => ({ reachable: true, ok: true, value: 3, extra: "ignored" }),
  };
  const mismatching = {
    id: "synthetic-bad",
    requirement: "a mismatch is reported with the offending keys",
    expect: { ok: true, value: 4 },
    run: async () => ({ ok: true, value: 3 }),
  };
  const throwing = {
    id: "synthetic-throw",
    requirement: "a harness error fails the case rather than crashing the run",
    expect: { ok: true },
    run: async () => { throw new Error("boom"); },
  };
  return Promise.all([runAdapterCase(caseUnder, {}, {}), runAdapterCase(mismatching, {}, {}), runAdapterCase(throwing, {}, {})])
    .then(([pass, mismatch, boom]) => {
      assert.equal(pass.pass, true);
      assert.deepEqual(pass.mismatches, []);
      assert.equal(pass.evidence_kind, "real_engine_evidence");
      assert.equal(mismatch.pass, false);
      assert.deepEqual(mismatch.mismatches, ["value"]);
      assert.equal(boom.pass, false);
      assert.deepEqual(boom.mismatches, ["harness_error"]);
      assert.match(boom.observed.harness_error, /boom/);
    });
});

// ---------------------------------------------------------------------------
// r2a review repairs: H1 (submit must not clobber the trusted model map),
// M3 (grant max_output_bytes ceiling), M4 (grant org/ws vs job), M2 (stable
// adapter oracle digest).
// ---------------------------------------------------------------------------

test("H1: a grantless byte-carrying submit cannot replace an established session model", () => {
  const b = createBoundary({ now: () => 0 });
  const victim = Buffer.from("VICTIM-OPEN", "utf8");
  const open = b.submit(baseSerializeEnvelope({ operation: "open", request_id: "REQ-H1-OPEN", idempotency_key: "IDEMP-H1-OPEN",
    payload: { input_bytes: victim.toString("base64"), input_checksum: sha256Bytes(victim), input_length: victim.length,
    base_revision: b.docs.currentRevision(), base_version_id: b.docs.currentVersionId() } })).job;
  b.run(open, { grant: b.grantFor(open) });
  const ref = open.document_model_ref;
  const before = Buffer.from(b.modelRegistry.get(ref).content_bytes).toString("utf8");
  assert.equal(before, "VICTIM-OPEN");
  // A SERIALIZE naming that ref AND carrying its own bytes is self-contained; it
  // must not write the shared trusted map at submit.
  const clobber = Buffer.from("CLOBBER", "utf8");
  const attack = b.submit(baseSerializeEnvelope({ operation: "serialize", request_id: "REQ-H1-CLOB", idempotency_key: "IDEMP-H1-CLOB",
    payload: { document_model_ref: ref, input_bytes: clobber.toString("base64"), input_checksum: sha256Bytes(clobber),
    input_length: clobber.length, base_revision: b.docs.currentRevision(), base_version_id: b.docs.currentVersionId() } })).job;
  const after = Buffer.from(b.modelRegistry.get(ref).content_bytes).toString("utf8");
  assert.equal(after, before, "submit must not overwrite a trusted session model");
  // The attack job still runs on ITS OWN accepted bytes - self-contained, not the ref.
  b.run(attack, { grant: b.grantFor(attack) });
  assert.equal(attack.state, "completed");
  assert.equal(Buffer.from(b.store.get(attack.output_key)).toString("utf8"), "engine-output:CLOBBER");
  // The victim model is still intact for a later truthful serialize.
  assert.equal(Buffer.from(b.modelRegistry.get(ref).content_bytes).toString("utf8"), before);
});

test("H1: only run registers a trusted model, and only under a server-minted ref", () => {
  const b = createBoundary({ now: () => 0 });
  const victim = Buffer.from("OPEN-BYTES", "utf8");
  const open = b.submit(baseSerializeEnvelope({ operation: "open", request_id: "REQ-H1B-OPEN", idempotency_key: "IDEMP-H1B-OPEN",
    payload: { input_bytes: victim.toString("base64"), input_checksum: sha256Bytes(victim), input_length: victim.length,
    base_revision: b.docs.currentRevision(), base_version_id: b.docs.currentVersionId() } })).job;
  // Nothing is registered before run: submit is not authority.
  assert.equal(b.modelRegistry.size, 0, "submit must not establish trusted model state");
  assert.equal(open.document_model_ref, undefined);
  b.run(open, { grant: b.grantFor(open) });
  // run mints the ref from the job id, never from caller text.
  assert.equal(open.document_model_ref, "engine-session:" + open.job_id);
  assert.ok(b.modelRegistry.has(open.document_model_ref));
});

test("M3: a grant max_output_bytes ceiling refuses an over-size result before any commit", () => {
  const b = createBoundary({ now: () => 0 });
  const job = b.submit(baseSerializeEnvelope()).job;
  const grant = b.grantFor(job);
  const ceiling = 1;
  b.grantRegistry.set(grant.grant_id, { ...b.grantRegistry.get(grant.grant_id), max_output_bytes: ceiling });
  grant.max_output_bytes = ceiling;
  b.run(job, { grant });
  assert.equal(job.state, "failed");
  assert.equal(job.error.code, "upload_bounds");
  assert.equal(job.error.kind, "byte_bound");
  assert.equal(b.docs.commits, 0);
  assert.equal(b.store.objects.size, 0, "no object may be written past the ceiling");
  // The default LIMITS ceiling still completes.
  const ok = createBoundary({ now: () => 0 });
  const okJob = ok.submit(baseSerializeEnvelope({ request_id: "REQ-M3-OK", idempotency_key: "IDEMP-M3-OK" })).job;
  ok.run(okJob, { grant: ok.grantFor(okJob) });
  assert.equal(okJob.state, "completed");
  assert.equal(ok.docs.commits, 1);
});

test("M4: a grant whose organization or workspace differs from the job is refused", () => {
  const forge = (field) => {
    const b = createBoundary({ now: () => 0 });
    const job = b.submit(baseSerializeEnvelope()).job;
    const grant = b.grantFor(job);
    const rewritten = { ...b.grantRegistry.get(grant.grant_id), [field]: field === "organization_id" ? "ORG-OTHER" : "WS-OTHER" };
    b.grantRegistry.set(grant.grant_id, rewritten);
    b.run(job, { grant: rewritten });
    return { b, job };
  };
  for (const field of ["organization_id", "workspace_id"]) {
    const { b, job } = forge(field);
    assert.equal(job.state, "failed", field + " drift must refuse");
    assert.equal(job.error.code, "grant_scope");
    assert.equal(b.docs.commits, 0);
    assert.equal(b.grantRegistry.get(job.grant.grant_id).consumed, false, "a scope refusal must not burn the grant");
  }
  // A matching grant still completes exactly once.
  const good = createBoundary({ now: () => 0 });
  const goodJob = good.submit(baseSerializeEnvelope()).job;
  good.run(goodJob, { grant: good.grantFor(goodJob) });
  assert.equal(goodJob.state, "completed");
  assert.equal(good.docs.commits, 1);
});

test("M2: the registry pins a STABLE adapter oracle digest, not the volatile evidence file", () => {
  const registry = EVIDENCE_REGISTRY.real_engine_evidence;
  assert.match(registry.case_oracle_digest, /^[0-9a-f]{64}$/);
  // The digest is a pure function of the case oracles, so recomputing it here the
  // same way the adapter does must reproduce it.
  const recomputed = sha256Bytes(Buffer.from(canonicalJson(
    ADAPTER_FAULT_CASES.map((c) => ({ id: c.id, expect: c.expect }))), "utf8"));
  assert.equal(registry.case_oracle_digest, recomputed);
  // The evidence FILE is intentionally NOT pinned: its bytes move with generated_at.
  assert.equal(registry.file_digest, undefined);
});
