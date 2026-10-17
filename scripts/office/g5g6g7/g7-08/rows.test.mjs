import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAll } from '../make-fixtures.mjs';
import {
  ACCEPTANCE_REL,
  BOUND_DOCUMENT_FORBIDDEN_TOOLS,
  CAPABILITY_ROWS,
  DEFAULT_REPO_ROOT,
  EXPECTED_FIXTURE_SHAS,
  FORMATS,
  FORMAT_FEATURE_FLAGS,
  HITL_ROWS,
  HOSTS,
  MATRIX_ROWS,
  PDF_FILE_LEVEL_PAGE_TOOLS,
  PROVIDERS,
  expandMatrixRuns,
  getRowById,
  verifyRowFixtures,
} from './rows.mjs';

test('row table defines all 13 capability rows and 1 hitl row from proposal §2', () => {
  const capabilityIds = CAPABILITY_ROWS.map((r) => r.id);
  assert.deepEqual(capabilityIds, [
    'X-R1',
    'X-R2',
    'X-E1',
    'D-R1',
    'D-E1',
    'P-R1',
    'P-E1',
    'F-R1',
    'F-E1',
    'M-R1',
    'M-E1',
    'H-R1',
    'H-E1',
  ]);
  assert.deepEqual(
    HITL_ROWS.map((r) => r.id),
    ['D-W1'],
  );
  assert.equal(MATRIX_ROWS.length, 14);
  for (const fmt of FORMATS) {
    assert.ok(FORMAT_FEATURE_FLAGS[fmt]?.startsWith('office_ai_uniwork_'));
  }
  assert.equal(PDF_FILE_LEVEL_PAGE_TOOLS.length, 8);
  assert.equal(BOUND_DOCUMENT_FORBIDDEN_TOOLS.length, 9);
  assert.ok(BOUND_DOCUMENT_FORBIDDEN_TOOLS.includes('create_document'));
});

test('every row carries format, operation, verified fixture sha256, Vietnamese prompt, tools, missingByHost and ACs', () => {
  const generated = generateAll();
  const byId = new Map(generated.fixtures.map((f) => [f.spec.id, f.sha256]));

  for (const row of MATRIX_ROWS) {
    assert.equal(getRowById(row.id), row);
    assert.ok(FORMATS.includes(row.format), `${row.id} format`);
    assert.ok(row.operation === 'read' || row.operation === 'edit', `${row.id} operation`);
    assert.equal(row.fixtureSha256, EXPECTED_FIXTURE_SHAS[row.fixtureId]);
    assert.equal(row.fixtureSha256, byId.get(row.fixtureId), `${row.id} sha256 matches generated fixture`);
    assert.ok(typeof row.prompt === 'string' && row.prompt.trim().length > 20, `${row.id} prompt`);
    assert.ok(/[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(row.prompt), `${row.id} Vietnamese prompt`);
    if (row.operation === 'edit') {
      assert.ok(row.target && typeof row.target === 'object', `${row.id} edit row must specify target`);
    }
    if (row.mode === 'automated') {
      assert.ok(Array.isArray(row.expectedTools) && row.expectedTools.length > 0, `${row.id} expectedTools`);
      assert.ok(Array.isArray(row.primaryTools) && row.primaryTools.length > 0, `${row.id} primaryTools`);
    }
    assert.ok(Array.isArray(row.forbiddenTools) && row.forbiddenTools.includes('create_document'), `${row.id} forbiddenTools`);
    assert.ok(Array.isArray(row.missingByHost?.web), `${row.id} missingByHost.web`);
    assert.ok(Array.isArray(row.missingByHost?.desktop), `${row.id} missingByHost.desktop`);
    for (const host of HOSTS) {
      for (const gap of row.missingByHost[host]) {
        assert.ok(gap.gap.startsWith('missing: '), `${row.id} ${host} gap prefix`);
        assert.match(gap.source, /^docs\/office\/g5g6g7\/genoffice-tools\.md:\d+/);
      }
    }
    assert.ok(Array.isArray(row.acs) && row.acs.length > 0, `${row.id} ACs`);
    assert.ok(row.toolsSource.length > 0);
  }
  assert.equal(getRowById('NO-SUCH-ROW'), null);
});

test('verifyRowFixtures passes on the canonical table and rejects unknown fixtures or wrong sha256', () => {
  assert.equal(verifyRowFixtures({ rows: MATRIX_ROWS, repoRoot: DEFAULT_REPO_ROOT }), true);
  assert.ok(ACCEPTANCE_REL.endsWith('acceptance.md'));

  assert.throws(
    () => verifyRowFixtures({ rows: [] }),
    /non-empty array/,
  );
  assert.throws(
    () =>
      verifyRowFixtures({
        rows: [{ ...MATRIX_ROWS[0], fixtureId: 'fx-nonexistent' }],
      }),
    /not in manifest\.json/,
  );
  assert.throws(
    () =>
      verifyRowFixtures({
        rows: [{ ...MATRIX_ROWS[0], fixtureSha256: '0'.repeat(64) }],
      }),
    /sha256 mismatch/,
  );
});

test('expandMatrixRuns produces 52 automated row-runs + 2 hitl Word runs with web runs ordered first', () => {
  const runs = expandMatrixRuns();
  const automated = runs.filter((r) => r.mode === 'automated');
  const hitl = runs.filter((r) => r.mode === 'hitl');

  assert.equal(automated.length, 52);
  assert.equal(hitl.length, 2);
  assert.equal(runs.length, 54);

  const runIds = runs.map((r) => r.runId);
  assert.equal(new Set(runIds).size, 54, 'unique runIds');

  // First 26 automated runs are web, next 26 are desktop (Advisor decision: web rows first).
  assert.ok(automated.slice(0, 26).every((r) => r.host === 'web'));
  assert.ok(automated.slice(26, 52).every((r) => r.host === 'desktop'));

  for (const provider of PROVIDERS) {
    for (const host of HOSTS) {
      const slice = automated.filter((r) => r.provider === provider && r.host === host);
      assert.equal(slice.length, 13);
    }
  }

  assert.deepEqual(
    hitl.map((r) => r.runId),
    ['D-W1:hitl:web', 'D-W1:hitl:desktop'],
  );

  const fe1Web = automated.find((r) => r.runId === 'F-E1:uniwork:web');
  const fe1Desktop = automated.find((r) => r.runId === 'F-E1:uniwork:desktop');
  assert.equal(fe1Web.knownMissing.length, 1);
  assert.equal(fe1Web.knownMissing[0].owner, 'G6-05/G6-03a');
  assert.equal(fe1Desktop.knownMissing.length, 0);
});
