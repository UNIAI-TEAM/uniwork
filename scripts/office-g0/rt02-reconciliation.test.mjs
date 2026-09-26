import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..', '..');
const sourceRoot = process.env.OFFICE_G0_SOURCE_ROOT ? path.resolve(process.env.OFFICE_G0_SOURCE_ROOT) : root;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const bytesAt = (base, relative) => fs.readFileSync(path.join(base, relative));
const jsonAt = (base, relative) => JSON.parse(bytesAt(base, relative));
const map = jsonAt(root, 'docs/office/g0/module-runtime-map.json');
const register = jsonAt(root, 'docs/office/g0/evidence-register.json');
const actualSource = (file) => bytesAt(sourceRoot, file);

test('RT-02 evidence, document and register pins match the actual source bytes', () => {
  const reconciliation = map.rt02_reconciliation;
  const registered = register.rt02Reconciliation;
  assert.equal(reconciliation.status, 'bounded_evidence_present');
  assert.equal(reconciliation.register_status, 'six_canonical_faults_case_bound_real_engine_modeled_business');
  assert.equal(registered.map, 'docs/office/g0/module-runtime-map.json');
  assert.equal(registered.wholeDOC004Accepted, false);
  assert.equal(registered.businessBoundary, 'modeled');
  for (const [mapPin, registerPin] of [
    [reconciliation.real_engine_run, registered.adapterEvidence],
    [reconciliation.separate_six_fault_run, registered.faultEvidence],
  ]) {
    const bytes = actualSource(mapPin.artifact);
    assert.equal(registerPin.path, mapPin.artifact);
    assert.equal(mapPin.sha256.toLowerCase(), hash(bytes));
    assert.equal(registerPin.sha256.toLowerCase(), hash(bytes));
    assert.equal(mapPin.bytes, bytes.length);
    assert.equal(registerPin.bytes, bytes.length);
  }
  assert.deepEqual(registered.sourceDocs, reconciliation.source_docs);
  assert.equal(registered.sourceDocs.length, 3);
  for (const pin of registered.sourceDocs) {
    const bytes = actualSource(pin.path);
    assert.equal(pin.sha256, hash(bytes), pin.path);
    assert.equal(pin.bytes, bytes.length, pin.path);
  }
});

test('eleven loopback cases and six separate fault cases match their original records', () => {
  const { real_engine_run: first, separate_six_fault_run: second } = map.rt02_reconciliation;
  const adapter = JSON.parse(actualSource(first.artifact));
  const faults = JSON.parse(actualSource(second.artifact));
  assert.equal(adapter.evidence_kind, 'real_engine_evidence');
  assert.equal(adapter.contract_version, first.contract_version);
  assert.equal(adapter.oracle_digest, first.oracle_digest);
  assert.equal(adapter.node, first.runtime);
  assert.equal(adapter.platform, first.platform);
  assert.deepEqual([adapter.total, adapter.passed, adapter.failed, adapter.unavailable],
    [first.total, first.passed, first.failed, first.unavailable]);
  assert.deepEqual([first.total, first.passed, first.failed, first.unavailable], [11, 11, 0, 0]);
  assert.deepEqual(adapter.cases.map((entry) => entry.id), first.cases);
  assert.equal(new Set(first.cases).size, 11);

  assert.equal(faults.ok, true);
  assert.equal(faults.cases.length, 6);
  assert.equal(map.rt02_reconciliation.register_case_count, 6);
  assert.deepEqual(faults.cases.map((entry) => entry.id), second.canonical_cases);
  assert.equal(new Set(second.canonical_cases).size, 6);
  assert.equal(register.rt02Reconciliation.adapterEvidence.passed, 11);
  assert.equal(register.rt02Reconciliation.faultEvidence.passed, 6);
  for (const entry of faults.cases) {
    assert.equal(entry.pass, true, entry.id);
    assert.equal(entry.evidence_kind, 'real_adapter_with_modeled_business_boundary', entry.id);
    assert.ok(entry.transcript.length > 0, entry.id);
  }
});

test('six case-bound register rows reproduce the real-engine records without claiming product placement', () => {
  const second = map.rt02_reconciliation.separate_six_fault_run;
  const faults = JSON.parse(actualSource(second.artifact));
  const rows = register.rows.filter((row) => row.kind === 'doc004-fault');
  const gate = register.gates.find((entry) => entry.id === 'G0-DOC004-FAULT');
  assert.equal(rows.length, 7);
  assert.equal(gate.requiredCases.length, 7);
  assert.deepEqual(new Set(gate.rows), new Set(rows.map((row) => row.id)));
  assert.equal(new Set(rows.flatMap((row) => row.cases)).size, 7);
  for (const entry of faults.cases) {
    const row = rows.find((candidate) => candidate.cases?.[0] === entry.id);
    assert.ok(row, entry.id);
    assert.equal(row.cases.length, 1);
    assert.equal(row.status, 'PASS');
    assert.equal(row.result, 'pass');
    assert.equal(row.adapter, 'real');
    assert.equal(row.operationEvidence, 'real-adapter-operation');
    assert.equal(row.level, 'harness');
    assert.equal(row.platform.browser, 'none');
    assert.equal(row.artifacts.length, 1);
    const pin = row.artifacts[0];
    assert.equal(pin.ref, entry.id);
    const bytes = bytesAt(root, pin.path);
    assert.equal(hash(bytes), pin.sha256, entry.id);
    assert.equal(bytes.length, pin.bytes, entry.id);
    const excerpt = JSON.parse(bytes);
    assert.equal(excerpt.source_sha256, second.sha256);
    assert.equal(excerpt.source_case_count, 6);
    assert.equal(excerpt.business_boundary, 'modeled');
    assert.deepEqual(excerpt.case, entry);
  }
  // The existing malformed-result capture is checked by verify-evidence.mjs against its separate artifact root.
  assert.equal(rows.find((row) => row.cases[0] === 'malformed-result').status, 'PASS');
  // Harness-level fault rows never select a runtime: no operation in the map may cite one as its proof.
  const faultRowIds = new Set(rows.map((row) => row.id));
  for (const [format, entry] of Object.entries(map.formats)) {
    for (const op of entry.operations) {
      const cited = op.proving_evidence?.register_row;
      assert.ok(!cited || !faultRowIds.has(cited), format + '/' + op.operation + ' cites a harness fault row as runtime proof');
    }
  }
  assert.equal(map.source_layout_direction.verified_here, false);
  assert.equal(map.candidate_criterion_decisions['4.1'].decision, 'partial_correction_only');
  assert.equal(map.candidate_criterion_decisions['4.4'].decision, 'bounded_evidence_present_whole_criterion_open');
  assert.equal(map.candidate_criterion_decisions['4.7'].decision, 'handoff_contract_present_build_proof_open');
  // The user recorded G0 = GO (2026-09-25); the earlier NO-GO stays in decisionHistory. GO is not pilot acceptance.
  assert.equal(register.decision.value, 'GO');
  assert.ok(register.decisionHistory.some((entry) => entry.value === 'NO-GO'), 'the earlier NO-GO must stay in decisionHistory');
  assert.equal(register.pilot.ready, false);
});
