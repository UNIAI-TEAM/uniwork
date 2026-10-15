// Shape checks of the G7-03a / G7-03b fault case list (UNI-1380). The runner
// (fault/run.mjs) reads docs/office/g5g6g7/fault/cases.json; these checks keep
// it honest against the cards and the acceptance matrix before any case runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
  for (const id of ids) assert.match(id, /^(FQ|FL)-\d{2}$/, `bad id ${id}`);
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
    assert.ok(c.expect.server && 'versionDelta' in c.expect.server, `${c.id}: expect.server.versionDelta missing`);
    assert.ok(Array.isArray(c.expect.client) && c.expect.client.length > 0, `${c.id}: expect.client missing`);
    assert.ok(Array.isArray(c.proxyRules), `${c.id}: proxyRules is not a list`);
    for (const name of ['intent-log.jsonl', 'server-versions.json', 'proxy-log.jsonl']) {
      assert.ok(c.artifacts.includes(name), `${c.id}: artifact ${name} missing`);
    }
    assert.match(c.status, /^(ready|pending \S.*)$/, `${c.id}: status ${c.status}`);
  }
});

test('pending rows name a dependency and ready rows have none', () => {
  for (const c of cases) {
    if (c.status === 'ready') assert.equal(c.dependency, 'none', `${c.id}: ready with dependency ${c.dependency}`);
    else {
      assert.ok(c.dependency && c.dependency !== 'none', `${c.id}: pending without a dependency`);
      assert.equal(c.status, `pending ${c.dependency}`, `${c.id}: status does not name its dependency`);
    }
  }
});

test('every G7-03b row is pending and notes the G5-D1 gate', () => {
  for (const c of cases.filter((x) => cardOf(x.id) === 'G7-03b')) {
    assert.notEqual(c.status, 'ready', `${c.id}: G7-03b rows wait on G5-05/G5-08c/G5-11`);
    assert.ok(['G5-05', 'G5-08c', 'G5-11'].includes(c.dependency), `${c.id}: dependency ${c.dependency}`);
    assert.equal(c.blockedGate, 'G5-D1', `${c.id}: BLOCKED(G5-D1) note missing`);
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
