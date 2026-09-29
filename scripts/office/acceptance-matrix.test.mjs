import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const matrixPath = path.join(repoRoot, 'docs/office/g3g4/capability-rows.json');
const fixturePath = path.join(repoRoot, 'docs/office/g0/fixtures/manifest.json');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const fixtureManifest = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const fixtures = new Map(fixtureManifest.fixtures.map((fixture) => [fixture.id, fixture]));
const oracleTypes = new Set(['object/part', 'extraction', 'render diff', 'receipt']);
const hosts = new Set(['web', 'desktop']);

function validateMatrix(candidate) {
  assert.equal(candidate.schemaVersion, 1, 'schemaVersion must be 1');
  assert.equal(candidate.kind, 'uniwork-office-g3g4-acceptance-matrix', 'unexpected matrix kind');
  assert.equal(candidate.inventory.revision, '09485f884dc845cf3bf27fb7edfe489f9d457aad', 'inventory revision drifted');
  assert.equal(candidate.inventory.rowsFound, 95, 'inventory row count must come from the pinned source');
  assert.equal(candidate.inventory.q1BRowsFound, 72, 'Q1-B count must come from mustPort=true');
  assert.ok(Array.isArray(candidate.rows) && candidate.rows.length > 0, 'rows are required');

  const ids = new Set();
  for (const row of candidate.rows) {
    assert.equal(typeof row.id, 'string', 'row id must be a string');
    assert.ok(row.id.length > 0, 'row id must not be empty');
    assert.equal(ids.has(row.id), false, `duplicate row id: ${row.id}`);
    ids.add(row.id);
    assert.equal(typeof row.owner, 'string', `${row.id} needs an owner`);
    assert.ok(row.owner.trim().length > 0, `${row.id} owner must not be empty`);
    assert.equal(typeof row.ownerTask, 'string', `${row.id} needs ownerTask`);
    assert.ok(row.ownerTask.trim().length > 0, `${row.id} ownerTask must not be empty`);
    assert.ok(row.oracle && typeof row.oracle === 'object', `${row.id} needs an oracle`);
    assert.ok(oracleTypes.has(row.oracle.type), `${row.id} has an unsupported oracle type`);
    assert.equal(typeof row.oracle.assertion, 'string', `${row.id} oracle assertion is required`);
    assert.ok(row.oracle.assertion.trim().length > 0, `${row.id} oracle assertion must not be empty`);
    const rowHosts = Array.isArray(row.host) ? row.host : [row.host];
    assert.ok(rowHosts.length > 0, `${row.id} needs a host`);
    for (const host of rowHosts) assert.ok(hosts.has(host), `${row.id} has invalid host ${host}`);
    assert.ok(Array.isArray(row.fixtures) && row.fixtures.length > 0, `${row.id} needs fixture references`);
    for (const reference of row.fixtures) {
      assert.equal(typeof reference.id, 'string', `${row.id} fixture id is required`);
      const fixture = fixtures.get(reference.id);
      assert.ok(fixture, `${row.id} references unknown fixture ${reference.id}`);
      assert.ok(Object.hasOwn(reference, 'sha256'), `${row.id} fixture ${reference.id} needs sha256`);
      assert.equal(reference.sha256, fixture.sha256, `${row.id} fixture ${reference.id} hash drifted`);
    }
    assert.ok(Array.isArray(row.negativeCases) && row.negativeCases.length >= 2, `${row.id} needs two negative cases`);
    assert.ok(row.negativeCases.every((negative) => typeof negative === 'string' && negative.trim().length > 0), `${row.id} has an empty negative case`);
    assert.equal(row.status, 'not_run', `${row.id} must remain not_run in the matrix slice`);
    assert.equal(typeof row.reviewer, 'string', `${row.id} reviewer gate is required`);
    assert.ok(row.reviewer.includes('pending'), `${row.id} reviewer gate must remain pending`);
  }

  const counts = candidate.rowCounts;
  assert.equal(counts.g3Acceptance, 12, 'G3 acceptance count must be 12');
  assert.equal(counts.g4Acceptance, 16, 'G4 acceptance count must be 16');
  assert.equal(counts.q1BCapabilities, candidate.inventory.q1BRowsFound, 'Q1-B rows must reconcile with inventory');
  assert.equal(counts.saveError, 14, '§7.2 save/error rows must all be represented');
  assert.equal(counts.baseline, 5, 'G1/G2 open-limit imports must remain represented');
  assert.equal(counts.handoff, 1, 'H4 must be a separate open row');
  assert.equal(counts.total, candidate.rows.length, 'row count metadata must match data');
  assert.ok(candidate.rows.some((row) => row.reviewer === 'pending G3-D3'), 'G3-D3 reviewer must remain pending');
  assert.ok(candidate.rows.some((row) => row.id === 'H4-SIX-FORMAT' && row.status === 'not_run'), 'H4 open row is required');
  return true;
}

test('acceptance matrix has reconciled inventory and row shape', () => {
  assert.equal(validateMatrix(matrix), true);
});

test('acceptance matrix negative case rejects a row without owner/oracle', () => {
  const invalid = structuredClone(matrix);
  delete invalid.rows[0].owner;
  assert.throws(() => validateMatrix(invalid), /needs an owner/);
  invalid.rows[0].owner = matrix.rows[0].owner;
  invalid.rows[0].oracle.type = 'unknown';
  assert.throws(() => validateMatrix(invalid), /unsupported oracle type/);
});
