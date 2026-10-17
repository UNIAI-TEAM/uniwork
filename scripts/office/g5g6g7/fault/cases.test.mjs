// Shape checks of the G7-03a / G7-03b fault case list (UNI-1380). The runners
// (fault/server-cases.mjs for the FQ-01..FQ-13 server rows, fault/app-cases.mjs
// for the app rows) read docs/office/g5g6g7/fault/cases.json; these checks keep
// it honest against the cards and the acceptance matrix before any case runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateExpect } from './case-expect.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
const doc = read('docs/office/g5g6g7/fault/cases.json');
const matrix = read('docs/office/g5g6g7/acceptance-rows.json');
const cases = doc.cases;

// The AC rows each plan card names (plan G7-03a l.945-952, G7-03b l.970-975).
const CARD_AC = {
  'G7-03a': ['G5-A05', 'G5-A06', 'G5-A08', 'G6-A04', 'G7-A02'],
  'G7-03b': ['G5-A04', 'G5-A07'],
};
const cardOf = (id) => (id.startsWith('FQ-') ? 'G7-03a' : id.startsWith('FL-') ? 'G7-03b' : null);

test('case ids are unique and carry the card prefix', () => {
  const ids = cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate case id');
  // a card may split a row into letters (G7-03b: FL-04 -> FL-04a/04b/04c, contract v0.2)
  for (const id of ids) assert.match(id, /^(FQ|FL)-\d{2}[a-z]?$/, `bad id ${id}`);
});

test('the card AC lists in the file match the plan cards', () => {
  for (const [card, ac] of Object.entries(CARD_AC)) assert.deepEqual(doc.cards[card].ac, ac, card);
});

test('every AC a card lists appears in at least one of its rows', () => {
  for (const [card, acs] of Object.entries(CARD_AC)) {
    const covered = new Set(cases.filter((c) => cardOf(c.id) === card).flatMap((c) => c.ac));
    for (const ac of acs) assert.ok(covered.has(ac), `${card}: ${ac} has no row`);
  }
});

// The matrix §2 prose and cases.json `expect` describe one number twice: the first `versionDelta: <n>` of the row
// in the matrix must be the row's machine-readable `expect.server.versionDelta` (R1-2), so they cannot drift.
test('the version delta in the matrix row is the version delta in cases.json expect', () => {
  const matrixMd = fs.readFileSync(path.join(repoRoot, 'docs/office/g5g6g7/fault/matrix.md'), 'utf8');
  let checked = 0;
  for (const c of cases) {
    const delta = c.expect.server.versionDelta;
    if (!Number.isInteger(delta)) continue;
    const row = matrixMd.split(/\r?\n/).find((l) => l.startsWith(`| ${c.id} |`) || l.startsWith(`| ${c.id} (S) |`));
    assert.ok(row, `${c.id}: no row in matrix.md §2`);
    const stated = /versionDelta: (\d+)/.exec(row);
    assert.ok(stated, `${c.id}: the matrix row states no "versionDelta: <n>"`);
    assert.equal(Number(stated[1]), delta, `${c.id}: matrix says versionDelta ${stated[1]}, cases.json expect.server.versionDelta is ${delta}`);
    checked += 1;
  }
  assert.ok(checked >= 20, `only ${checked} rows compared`);
});

test('a row lists only AC rows of its own card', () => {
  for (const c of cases) {
    assert.ok(Array.isArray(c.ac) && c.ac.length > 0, `${c.id}: no ac`);
    for (const ac of c.ac) assert.ok(CARD_AC[cardOf(c.id)].includes(ac), `${c.id}: ${ac} is not on card ${cardOf(c.id)}`);
  }
});

test('every row has a layer, an expectation, artifacts and a status', () => {
  for (const c of cases) {
    assert.ok(['server', 'app'].includes(c.layer), `${c.id}: layer ${c.layer}`);
    assert.equal(c.serverOnly, c.layer === 'server', `${c.id}: serverOnly disagrees with layer`);
    assert.ok(c.expect && typeof c.expect === 'object' && Object.keys(c.expect).length > 0, `${c.id}: no expect`);
    assert.deepEqual(validateExpect(c), [], `${c.id}: expect is not the documented machine-readable shape (matrix §6)`);
    assert.ok(Array.isArray(c.expect.notes.client) && c.expect.notes.client.length > 0, `${c.id}: expect.notes.client missing`);
    assert.ok(Array.isArray(c.proxyRules), `${c.id}: proxyRules is not a list`);
    for (const name of ['intent-log.jsonl', 'server-versions.json', 'proxy-log.jsonl']) {
      assert.ok(c.artifacts.includes(name), `${c.id}: artifact ${name} missing`);
    }
    // an app row keeps the fork's trace beside its mapped intent log (matrix §4); a server row has no trace
    assert.equal(c.artifacts.includes('app-trace.jsonl'), c.layer === 'app', `${c.id}: app-trace.jsonl belongs to app rows only`);
    // `ready` | `pending <dep>` | `SUPERSEDED` (with its reason) | `BLOCKED(<owner>)` (with its reason), G7-03b v0.2
    assert.match(c.status, /^(ready|pending \S.*|SUPERSEDED|BLOCKED\([^)]+\))$/, `${c.id}: status ${c.status}`);
    if (c.status === 'SUPERSEDED') assert.ok(c.supersededReason, `${c.id}: a SUPERSEDED row carries no supersededReason`);
    if (/^BLOCKED\(/.test(c.status)) assert.ok(c.blockedReason, `${c.id}: a BLOCKED row carries no blockedReason`);
  }
});

test('pending rows name a dependency and ready rows have none', () => {
  for (const c of cases) {
    if (c.status === 'ready') assert.equal(c.dependency, 'none', `${c.id}: ready with dependency ${c.dependency}`);
    else if (c.status === 'SUPERSEDED' || /^BLOCKED\(/.test(c.status)) assert.equal(c.dependency, 'none', `${c.id}: ${c.status} with dependency ${c.dependency}`);
    else {
      assert.ok(c.dependency && c.dependency !== 'none', `${c.id}: pending without a dependency`);
      assert.equal(c.status, `pending ${c.dependency}`, `${c.id}: status does not name its dependency`);
    }
  }
});

test('the G7-03b rows carry no G5-D1 gate: ready, W2-pending, SUPERSEDED or BLOCKED(owner)', () => {
  for (const c of cases.filter((x) => cardOf(x.id) === 'G7-03b')) {
    assert.equal(c.blockedGate, undefined, `${c.id}: the G5-D1 gate was dropped (Advisor offline-ui_local:39)`);
    assert.ok(['ready', 'pending W2', 'SUPERSEDED', 'BLOCKED(G5-08d)'].includes(c.status), `${c.id}: status ${c.status}`);
    // a runnable FL row depends on nothing; the W2 ones name W2; the retired ones depend on nothing
    assert.equal(c.dependency, c.status === 'pending W2' ? 'W2' : 'none', `${c.id}: dependency ${c.dependency} vs status ${c.status}`);
    // a row that never runs is never counted as a PASS: the runner reports it BLOCKED (app-cases-lib.mjs selectAppCases)
    if (c.status !== 'ready') assert.ok(!c.driver, `${c.id}: a non-ready row names a driver`);
  }
});

test('a row runs on a fixture every one of its AC rows declares', () => {
  // evidence.mjs refuses (BLOCKED) a run on a fixture the AC row does not name.
  const rows = new Map(matrix.rows.map((r) => [r.id, r]));
  for (const c of cases) {
    for (const ac of c.ac) {
      const row = rows.get(ac);
      assert.ok(row, `${c.id}: ${ac} is not in acceptance-rows.json`);
      assert.ok(row.fixtures.some((f) => f.id === c.fixture), `${c.id}: ${ac} does not declare ${c.fixture}`);
    }
  }
});

test('proxy rules follow the proxy contract', () => {
  const actions = ['delay', 'drop_request', 'drop_response_after_forward', 'status', 'reset', 'hold'];
  for (const c of cases) {
    const ids = c.proxyRules.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `${c.id}: duplicate rule id`);
    for (const r of c.proxyRules) {
      assert.ok(r.id && r.match && typeof r.match.path === 'string', `${c.id}: rule without id/match.path`);
      assert.doesNotThrow(() => new RegExp(r.match.path), `${c.id}/${r.id}: path is not a regex`);
      assert.ok(actions.includes(r.action?.type), `${c.id}/${r.id}: action ${r.action?.type}`);
      if (r.match.nth !== undefined) assert.ok(Number.isInteger(r.match.nth) && r.match.nth >= 1, `${c.id}/${r.id}: nth`);
    }
  }
});
