import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const matrixPath = path.join(repoRoot, 'docs/office/g3g4/capability-rows.json');
const acceptancePath = path.join(repoRoot, 'docs/office/g3g4/acceptance.md');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const acceptanceDoc = fs.readFileSync(acceptancePath, 'utf8');

const placeholderAssertion =
  'The acceptance condition in the referenced G3/G4 specification must be recorded with an artifact before any status can change.';
const oracleTypes = new Set(['object/part', 'extraction', 'render diff', 'receipt']);
const hosts = new Set(['web', 'desktop']);
const kindCounts = { acceptance: 28, capability: 72, save_error: 14, baseline: 5, handoff: 1 };
const acceptanceScopes = { G3: 12, G4: 16 };

const isFilled = (value) => typeof value === 'string' && value.trim().length > 0;

function expectedMarkdownRow(row) {
  const host = Array.isArray(row.host) ? row.host.join(', ') : row.host;
  const fixtures = row.fixtures
    .map((fixture) => `${fixture.id} (${fixture.sha256 ?? 'null (manifest intentionally has no committed hash; see lab-record.md)'})`)
    .join('<br>');
  return `| ${row.id} | ${row.owner} | ${host} | ${row.oracle.type}: ${row.oracle.assertion} | ${fixtures} | ${row.negativeCases.join('<br>')} | ${row.status} | ${row.reviewer} |`;
}

function parseMarkdownRows(markdown) {
  const rows = new Map();
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith('| ')) continue;
    const cells = line.replace(/^\| /, '').replace(/ \|$/, '').split(' | ');
    if (cells.length !== 8) continue;
    if (cells[0] === 'ID' || /^-+$/.test(cells[0])) continue;
    assert.equal(rows.has(cells[0]), false, `acceptance.md repeats row ${cells[0]}`);
    rows.set(cells[0], line);
  }
  return rows;
}

function validateMatrix(candidate) {
  assert.equal(candidate.schemaVersion, 1, 'schemaVersion must be 1');
  assert.equal(candidate.kind, 'uniwork-office-g3g4-acceptance-matrix', 'unexpected matrix kind');
  assert.equal(candidate.inventory.revision, '09485f884dc845cf3bf27fb7edfe489f9d457aad', 'inventory revision drifted');
  assert.ok(Array.isArray(candidate.rows) && candidate.rows.length > 0, 'rows are required');
  assert.ok(Array.isArray(candidate.genericNegativeCases), 'genericNegativeCases are required');

  // AC-1: counts come from the pinned inventory file, not from the matrix's own metadata.
  const inventory = JSON.parse(fs.readFileSync(path.join(repoRoot, candidate.inventory.capabilityPath), 'utf8'));
  const inventoryRows = inventory.rows;
  const mustPortIds = inventoryRows.filter((row) => row.mustPort === true).map((row) => row.id);
  assert.equal(inventoryRows.length, 95, 'inventory row count must be 95');
  assert.equal(mustPortIds.length, 72, 'inventory mustPort count must be 72');
  assert.equal(candidate.inventory.rowsFound, inventoryRows.length, 'rowsFound must come from the pinned inventory');
  assert.equal(candidate.inventory.q1BRowsFound, mustPortIds.length, 'q1BRowsFound must come from mustPort=true');
  assert.equal(candidate.inventory.excludedRows, inventoryRows.length - mustPortIds.length, 'excludedRows must reconcile with the inventory');

  const fixtureManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, candidate.fixtureManifest), 'utf8'));
  const fixtures = new Map(fixtureManifest.fixtures.map((fixture) => [fixture.id, fixture]));

  const generic = candidate.genericNegativeCases;
  assert.equal(new Set(generic).size, generic.length, 'genericNegativeCases must not repeat');
  const usedNegatives = new Set(candidate.rows.flatMap((row) => row.negativeCases));
  for (const shared of generic) assert.ok(usedNegatives.has(shared), `generic negative is unused: ${shared}`);

  const ids = new Set();
  const capabilityIds = new Set();
  const acceptanceAssertions = new Set();
  for (const row of candidate.rows) {
    assert.ok(isFilled(row.id), 'row id must not be empty');
    assert.equal(ids.has(row.id), false, `duplicate row id: ${row.id}`);
    ids.add(row.id);
    assert.ok(isFilled(row.owner), `${row.id} needs an owner`);
    assert.ok(isFilled(row.ownerTask), `${row.id} needs ownerTask`);
    assert.ok(row.oracle && typeof row.oracle === 'object', `${row.id} needs an oracle`);
    assert.ok(oracleTypes.has(row.oracle.type), `${row.id} has an unsupported oracle type`);
    assert.ok(isFilled(row.oracle.assertion), `${row.id} oracle assertion is required`);
    assert.notEqual(row.oracle.assertion, placeholderAssertion, `${row.id} oracle assertion is still the placeholder`);
    const rowHosts = Array.isArray(row.host) ? row.host : [row.host];
    assert.ok(rowHosts.length > 0, `${row.id} needs a host`);
    for (const host of rowHosts) assert.ok(hosts.has(host), `${row.id} has invalid host ${host}`);
    assert.ok(Array.isArray(row.fixtures) && row.fixtures.length > 0, `${row.id} needs fixture references`);
    for (const reference of row.fixtures) {
      assert.ok(isFilled(reference.id), `${row.id} fixture id is required`);
      const fixture = fixtures.get(reference.id);
      assert.ok(fixture, `${row.id} references unknown fixture ${reference.id}`);
      assert.ok(Object.hasOwn(reference, 'sha256'), `${row.id} fixture ${reference.id} needs sha256`);
      assert.equal(reference.sha256, fixture.sha256, `${row.id} fixture ${reference.id} hash drifted`);
    }
    assert.ok(Array.isArray(row.negativeCases) && row.negativeCases.length >= 2, `${row.id} needs two negative cases`);
    assert.ok(row.negativeCases.every(isFilled), `${row.id} has an empty negative case`);
    assert.ok(row.negativeCases.some((negative) => !generic.includes(negative)), `${row.id} needs at least one row-specific negative case`);
    assert.notEqual(row.status, 'pass', `${row.id} must not be marked pass in this slice`);
    assert.ok(['not_run', 'blocked'].includes(row.status), `${row.id} has an unsupported status ${row.status}`);
    if (row.status === 'blocked') {
      assert.ok(isFilled(row.blockedOwner), `${row.id} blocked row needs blockedOwner`);
      assert.ok(isFilled(row.evidencePath), `${row.id} blocked row needs evidencePath`);
    }
    assert.ok(isFilled(row.reviewer), `${row.id} reviewer gate is required`);
    assert.ok(row.reviewer.includes('pending'), `${row.id} reviewer gate must remain pending`);
    assert.ok(isFilled(row.source) || isFilled(row.baselineSource), `${row.id} needs a source`);
    if (row.kind === 'capability') {
      assert.ok(isFilled(row.capabilityId), `${row.id} needs a capabilityId`);
      assert.equal(capabilityIds.has(row.capabilityId), false, `duplicate capabilityId: ${row.capabilityId}`);
      capabilityIds.add(row.capabilityId);
    }
    if (row.kind === 'acceptance') {
      assert.equal(acceptanceAssertions.has(row.oracle.assertion), false, `${row.id} duplicates another acceptance assertion`);
      acceptanceAssertions.add(row.oracle.assertion);
    }
  }
  assert.deepEqual([...capabilityIds].sort(), [...mustPortIds].sort(), 'CAP capabilityId set must equal the mustPort inventory ids');

  // AC-1: rowCounts are recomputed from the rows and the fixed section sizes, never trusted as metadata.
  const counts = {
    g3Acceptance: candidate.rows.filter((row) => row.kind === 'acceptance' && row.scope === 'G3').length,
    g4Acceptance: candidate.rows.filter((row) => row.kind === 'acceptance' && row.scope === 'G4').length,
    q1BCapabilities: candidate.rows.filter((row) => row.kind === 'capability').length,
    saveError: candidate.rows.filter((row) => row.kind === 'save_error').length,
    baseline: candidate.rows.filter((row) => row.kind === 'baseline').length,
    handoff: candidate.rows.filter((row) => row.kind === 'handoff').length,
    total: candidate.rows.length,
  };
  assert.deepEqual(candidate.rowCounts, counts, 'rowCounts must reconcile with the rows by kind');
  assert.equal(counts.g3Acceptance, acceptanceScopes.G3, 'G3 acceptance count must be 12');
  assert.equal(counts.g4Acceptance, acceptanceScopes.G4, 'G4 acceptance count must be 16');
  assert.equal(counts.q1BCapabilities, mustPortIds.length, 'Q1-B rows must reconcile with mustPort');
  assert.equal(counts.saveError, 14, 'Section 7.2 save/error rows must all be represented');
  assert.equal(counts.baseline, 5, 'G1/G2 open-limit imports must remain represented');
  assert.equal(counts.handoff, 1, 'H4 must be a separate open row');
  for (const [kind, expected] of Object.entries(kindCounts)) {
    assert.equal(candidate.rows.filter((row) => row.kind === kind).length, expected, `${kind} rows must be ${expected}`);
  }

  assert.ok(candidate.rows.some((row) => row.reviewer === 'pending G3-D3'), 'G3-D3 reviewer must remain pending');
  assert.ok(candidate.rows.some((row) => row.id === 'H4-SIX-FORMAT' && row.status === 'not_run'), 'H4 open row is required');

  // acceptance.md rows are generated from this JSON; the test fails on any drift.
  const markdownRows = parseMarkdownRows(acceptanceDoc);
  assert.equal(markdownRows.size, candidate.rows.length, 'acceptance.md must have one row per matrix row');
  for (const row of candidate.rows) {
    assert.ok(markdownRows.has(row.id), `acceptance.md is missing row ${row.id}`);
    assert.equal(markdownRows.get(row.id), expectedMarkdownRow(row), `acceptance.md row ${row.id} drifted from the JSON matrix`);
  }
  return true;
}

test('acceptance matrix reconciles its inventory, rows, and markdown tables', () => {
  assert.equal(validateMatrix(matrix), true);
});

test('acceptance matrix rejects candidate regressions', () => {
  const regressions = [
    { name: 'row without an owner', mutate: (c) => delete c.rows[0].owner, expected: /needs an owner/ },
    { name: 'unsupported oracle type', mutate: (c) => { c.rows[0].oracle.type = 'unknown'; }, expected: /unsupported oracle type/ },
    { name: 'fixture hash drift', mutate: (c) => { c.rows[0].fixtures[0].sha256 = '0'.repeat(64); }, expected: /hash drifted/ },
    { name: 'unknown fixture reference', mutate: (c) => { c.rows[0].fixtures[0].id = 'F-NOT-IN-MANIFEST'; }, expected: /unknown fixture/ },
    { name: 'duplicate row id', mutate: (c) => { c.rows.push(structuredClone(c.rows[0])); }, expected: /duplicate row id/ },
    { name: 'row marked pass', mutate: (c) => { c.rows[0].status = 'pass'; }, expected: /must not be marked pass/ },
    { name: 'dropped pending reviewer gate', mutate: (c) => { c.rows[0].reviewer = 'devin swe-2'; }, expected: /must remain pending/ },
    { name: 'all negatives from the shared generic set', mutate: (c) => { const row = c.rows.find((r) => r.kind === 'save_error'); row.negativeCases = c.genericNegativeCases.slice(3, 5); }, expected: /row-specific negative/ },
    { name: 'placeholder oracle assertion', mutate: (c) => { c.rows[0].oracle.assertion = placeholderAssertion; }, expected: /placeholder/ },
    { name: 'blocked row without owner/evidence path', mutate: (c) => { c.rows[0].status = 'blocked'; }, expected: /blocked row needs blockedOwner/ },
    { name: 'rowCounts drift', mutate: (c) => { c.rowCounts.total += 1; }, expected: /rowCounts must reconcile/ },
    { name: 'duplicate capabilityId', mutate: (c) => { const caps = c.rows.filter((r) => r.kind === 'capability'); caps[1].capabilityId = caps[0].capabilityId; }, expected: /duplicate capabilityId/ },
    { name: 'capability row outside the mustPort set', mutate: (c) => { c.rows.find((r) => r.kind === 'capability').capabilityId = 'not-a-mustport-row'; }, expected: /must equal the mustPort/ },
    { name: 'inventory rowsFound drift', mutate: (c) => { c.inventory.rowsFound = 94; }, expected: /rowsFound must come from the pinned inventory/ },
  ];
  for (const { name, mutate, expected } of regressions) {
    const candidate = structuredClone(matrix);
    mutate(candidate);
    assert.throws(() => validateMatrix(candidate), expected, `matrix validation accepted a regression: ${name}`);
  }
});
