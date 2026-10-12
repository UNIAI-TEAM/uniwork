// Sibling of scripts/office/acceptance-matrix.test.mjs for the G5/G6/G7 matrix
// (UNI-1376 / G7-01 item B). The g3g4 matrix is a different contract and is not
// touched here; this file owns the G5/G6/G7 rows, their markdown mirror and the
// evidence records they may not claim without.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const matrixPath = path.join(repoRoot, 'docs/office/g5g6g7/acceptance-rows.json');
const acceptancePath = path.join(repoRoot, 'docs/office/g5g6g7/acceptance.md');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const acceptanceDoc = fs.readFileSync(acceptancePath, 'utf8');

// Spec Section 9.1, one id per requirement. A new requirement is added here and
// in acceptance-rows.json together; the count below is the other half.
const requirementIds = [
  ...range('G5', 1, 8),
  ...range('G6', 1, 10),
  ...range('G7', 1, 5),
];
const oracleTypes = new Set(['receipt', 'object/part', 'extraction', 'render diff', 'deterministic score', 'security probe', 'manifest']);
const hosts = new Set(['web', 'desktop']);
const statuses = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);
// A result the runner can record. NOT_RUN and BLOCKED are results, not passes:
// a skip is the runner's own name for the same thing.
const evidenceResults = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'skip']);
const nonPassResults = new Set(['FAIL', 'BLOCKED', 'NOT_RUN', 'skip']);
const emptyArray = (value) => Array.isArray(value) && value.length === 0;

function range(prefix, from, to) {
  const ids = [];
  for (let i = from; i <= to; i += 1) ids.push(`${prefix}-A${String(i).padStart(2, '0')}`);
  return ids;
}

const isFilled = (value) => typeof value === 'string' && value.trim().length > 0;
const isDigest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function expectedMarkdownRow(row) {
  const host = Array.isArray(row.host) ? row.host.join(', ') : row.host;
  const fixtures = row.fixtures.map((fixture) => `${fixture.id} (${fixture.sha256})`).join('<br>');
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

/** Evidence records declared in the matrix plus the runner's ledger when it exists. */
function readEvidence(candidate) {
  const records = Array.isArray(candidate.evidence) ? [...candidate.evidence] : [];
  const ledgerPath = path.join(repoRoot, candidate.evidenceLedger ?? '');
  if (candidate.evidenceLedger && fs.existsSync(ledgerPath)) {
    for (const rawLine of fs.readFileSync(ledgerPath, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (line) records.push(JSON.parse(line));
    }
  }
  return records;
}

function validateMatrix(candidate, doc = acceptanceDoc) {
  assert.equal(candidate.schemaVersion, 1, 'schemaVersion must be 1');
  assert.equal(candidate.kind, 'uniwork-office-g5g6g7-acceptance-matrix', 'unexpected matrix kind');
  assert.ok(Array.isArray(candidate.rows) && candidate.rows.length > 0, 'rows are required');

  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, candidate.fixtureManifest), 'utf8'));
  assert.equal(manifest.kind, 'uniwork-office-g5g6g7-fixtures', 'unexpected fixture manifest kind');
  const fixtures = new Map(manifest.fixtures.map((fixture) => [fixture.id, fixture]));

  const evidence = readEvidence(candidate);
  const evidenceById = new Map(evidence.map((record) => [record.evidenceId, record]));

  const ids = new Set();
  const blockers = [];
  const byStatus = { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_RUN: 0 };
  for (const row of candidate.rows) {
    assert.ok(isFilled(row.id), 'row id must not be empty');
    assert.equal(ids.has(row.id), false, `duplicate row id: ${row.id}`);
    ids.add(row.id);
    assert.ok(isFilled(row.title), `${row.id} needs a title`);
    assert.ok(isFilled(row.owner), `${row.id} needs an owner`);
    assert.ok(row.oracle && typeof row.oracle === 'object', `${row.id} needs an oracle`);
    assert.ok(oracleTypes.has(row.oracle.type), `${row.id} has an unsupported oracle type ${row.oracle.type}`);
    assert.ok(isFilled(row.oracle.assertion), `${row.id} oracle assertion is required`);
    const rowHosts = Array.isArray(row.host) ? row.host : [row.host];
    assert.ok(rowHosts.length > 0, `${row.id} needs a host`);
    for (const host of rowHosts) assert.ok(hosts.has(host), `${row.id} has invalid host ${host}`);
    assert.ok(Array.isArray(row.fixtures) && row.fixtures.length > 0, `${row.id} needs fixture references`);
    for (const reference of row.fixtures) {
      assert.ok(isFilled(reference.id), `${row.id} fixture id is required`);
      const fixture = fixtures.get(reference.id);
      assert.ok(fixture, `${row.id} references unknown fixture ${reference.id}`);
      assert.equal(reference.sha256, fixture.sha256, `${row.id} fixture ${reference.id} hash drifted from the manifest`);
    }
    assert.ok(Array.isArray(row.negativeCases) && row.negativeCases.length >= 2, `${row.id} needs two negative cases`);
    assert.ok(row.negativeCases.every(isFilled), `${row.id} has an empty negative case`);
    assert.ok(Array.isArray(row.tasks) && row.tasks.length > 0, `${row.id} needs the plan tasks that assert it`);
    assert.ok(row.tasks.every(isFilled), `${row.id} has an empty task code`);
    assert.ok(statuses.has(row.status), `${row.id} has an unsupported status ${row.status}`);
    assert.ok(isFilled(row.reviewer), `${row.id} reviewer gate is required`);
    assert.ok(row.reviewer.includes('pending'), `${row.id} reviewer gate must remain pending`);
    assert.ok(Array.isArray(row.evidence), `${row.id} evidence must be a list of evidence ids`);
    for (const evidenceId of row.evidence) {
      assert.ok(isFilled(evidenceId), `${row.id} has an empty evidence id`);
      assert.ok(evidenceById.has(evidenceId), `${row.id} names evidence ${evidenceId} that no record declares`);
    }
    if (row.status === 'BLOCKED') {
      assert.ok(row.blocker && typeof row.blocker === 'object', `${row.id} blocked row needs a blocker`);
      assert.ok(isFilled(row.blocker.gate), `${row.id} blocked row needs blocker.gate`);
      assert.ok(isFilled(row.blocker.owner), `${row.id} blocked row needs blocker.owner`);
      assert.ok(isFilled(row.blocker.reason), `${row.id} blocked row needs blocker.reason`);
      blockers.push(row.id);
    } else {
      assert.equal(row.blocker, null, `${row.id} carries a blocker without being BLOCKED`);
    }
    if (row.status === 'PASS') {
      // A PASS needs a recorded run on this revision whose own result is PASS.
      assert.ok(row.evidence.length > 0, `${row.id} PASS row needs evidence`);
      // A skip, a BLOCKED or a NOT_RUN result is never a pass, whatever the row says.
      assert.equal(row.evidence.some((id) => nonPassResults.has(evidenceById.get(id)?.result)), false, `${row.id} counts a non-PASS result as PASS`);
      const passing = row.evidence.map((id) => evidenceById.get(id)).filter((record) => record?.result === 'PASS');
      assert.ok(passing.length > 0, `${row.id} PASS row needs an evidence record whose result is PASS`);
      // A PASS record must have run on one of the row's fixtures, on that
      // fixture's current hash — not on a fixture the row never names.
      for (const record of passing) {
        assert.equal(record.requirementId, row.id, `${row.id} PASS evidence ${record.evidenceId} names requirement ${record.requirementId}`);
        assert.ok(isFilled(record.artifact), `${row.id} PASS evidence ${record.evidenceId} needs an artifact`);
        const reference = row.fixtures.find((fixture) => fixture.id === record.fixtureId);
        assert.ok(reference, `${row.id} PASS evidence ${record.evidenceId} was run on another fixture`);
        assert.equal(record.fixtureSha256, reference.sha256, `${row.id} PASS evidence ${record.evidenceId} has a stale fixture hash`);
      }
      // Every fixture the row names needs its own PASS record: a row that runs
      // on two fixtures cannot pass on one of them.
      for (const reference of row.fixtures) {
        assert.ok(passing.some((record) => record.fixtureId === reference.id), `${row.id} PASS row has no PASS record for fixture ${reference.id}`);
      }
    }
    byStatus[row.status] += 1;
  }
  assert.deepEqual([...ids].sort(), [...requirementIds].sort(), 'rows must be exactly the spec Section 9.1 requirement ids');

  const counts = {
    G5: candidate.rows.filter((row) => row.id.startsWith('G5-')).length,
    G6: candidate.rows.filter((row) => row.id.startsWith('G6-')).length,
    G7: candidate.rows.filter((row) => row.id.startsWith('G7-')).length,
    total: candidate.rows.length,
  };
  assert.deepEqual(candidate.rowCounts, counts, 'rowCounts must reconcile with the rows');
  assert.deepEqual(counts, { G5: 8, G6: 10, G7: 5, total: 23 }, 'the spec Section 9.1 split must not change silently');
  // The committed slice carries no PASS row yet. The assertion is made against
  // the committed matrix, not the candidate: a candidate built in a test has to
  // be able to reach PASS (with a record per fixture) for the rule above to be
  // exercised at all.
  assert.ok(emptyArray(matrix.rows.filter((row) => row.status === 'PASS')), 'no row is PASS in this slice');
  assert.ok(blockers.length > 0, 'a row blocked by an open gate keeps its blocker instead of NOT_RUN');

  // acceptance.md repeats these rows cell for cell; the test fails on any drift.
  const markdownRows = parseMarkdownRows(doc);
  assert.equal(markdownRows.size, candidate.rows.length, 'acceptance.md must have one row per matrix row');
  for (const row of candidate.rows) {
    assert.ok(markdownRows.has(row.id), `acceptance.md is missing row ${row.id}`);
    assert.equal(markdownRows.get(row.id), expectedMarkdownRow(row), `acceptance.md row ${row.id} drifted from the JSON matrix`);
  }

  // The prose around the table is prose, but the numbers in it are the matrix's,
  // so the test recomputes them: a status change that the summary does not
  // follow is a regression (reviewer_fe F1).
  const perGroup = {};
  for (const row of matrix.rows) {
    const group = row.id.slice(0, 2);
    perGroup[group] ??= { NOT_RUN: 0, BLOCKED: 0, PASS: 0, FAIL: 0 };
    perGroup[group][row.status] += 1;
  }
  const counted = (statuses, counts) => statuses.filter((status) => counts[status] > 0).map((status) => `${counts[status]} ${status}`).join(', ');
  const groupRange = (group) => {
    const ids = requirementIds.filter((id) => id.startsWith(`${group}-`));
    return `${group} (${ids[0]}...${ids[ids.length - 1]})`;
  };
  for (const [group, statuses] of Object.entries(perGroup)) {
    const line = `| ${groupRange(group)} | ${matrix.rows.filter((row) => row.id.startsWith(`${group}-`)).length} | ${counted(['NOT_RUN', 'BLOCKED', 'PASS', 'FAIL'], statuses)} |`;
    assert.ok(doc.includes(line), `acceptance.md count table does not match the rows: expected ${line}`);
  }
  // The totals row names all three statuses plus the zeroes it wants to show.
  const totals = { NOT_RUN: 0, BLOCKED: 0, PASS: 0, FAIL: 0 };
  for (const row of matrix.rows) totals[row.status] += 1;
  const totalLine = `**${totals.NOT_RUN} NOT_RUN, ${totals.BLOCKED} BLOCKED, ${totals.PASS} PASS**`;
  assert.ok(doc.includes(totalLine), `acceptance.md totals row does not match the rows: expected ${totalLine}`);
  const blocked = matrix.rows.filter((row) => row.status === 'BLOCKED').map((row) => row.id);
  const gateSection = doc.split('## Gate đang mở')[1]?.split('\n## ')[0] ?? '';
  assert.deepEqual(
    [...new Set(gateSection.match(/G[567]-A\d\d/g) ?? [])].sort(),
    [...blocked].sort(),
    'the open-gate section must name exactly the BLOCKED rows',
  );
  const words = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười'];
  const blockedPhrase = `${words[blocked.length]} dòng bị chặn hôm nay`;
  assert.ok(doc.toLowerCase().includes(blockedPhrase), `the blocked count must read "${blockedPhrase}"`);

  // The group tables are subsections of the matrix section, not siblings of it
  // (reviewer_fe F3).
  for (const group of ['G5', 'G6', 'G7']) {
    assert.ok(doc.includes(`### Nghiệm thu ${group} `), `the ${group} table must be a ### subsection`);
  }
  assert.equal(/^## Nghiệm thu /m.test(doc), false, 'the group headings are subsections of the matrix table, not siblings');
  return true;
}

test('acceptance matrix reconciles its requirement ids, fixtures, markdown mirror and evidence', () => {
  assert.equal(validateMatrix(matrix), true);
});

test('acceptance.md says the requirements are an interpretation, not the verbatim spec', () => {
  assert.ok(acceptanceDoc.includes('diễn giải từ spec §9.1'), 'the requirements are an interpretation and must say so');
  assert.equal(acceptanceDoc.includes('nguyên văn'), false, 'the rows are English rewrites, not the verbatim Vietnamese spec text');
  assert.ok(acceptanceDoc.includes('test đi kèm'), 'the sibling test is the accompanying test');
  assert.equal(acceptanceDoc.includes('test anh em'), false, '"test anh em" is a calque of "sibling test"');
});

test('a PASS row that runs on several fixtures needs one PASS record per fixture', () => {
  // G5-A01 names two fixtures, so a single record can never carry its PASS.
  const target = matrix.rows.find((candidate) => candidate.fixtures.length > 1);
  const id = target.id;
  const evidenceIds = target.fixtures.map((_, index) => `ev-${id.toLowerCase()}-${index}`);
  const recordFor = (reference, index) => ({
    evidenceId: evidenceIds[index],
    requirementId: id,
    fixtureId: reference.id,
    fixtureSha256: reference.sha256,
    result: 'PASS',
    artifact: `test-results/office-g5g6g7-evidence/${id}-${index}.json`,
  });
  const complete = structuredClone(matrix);
  complete.evidence.push(...target.fixtures.map(recordFor));
  const completeRow = complete.rows.find((candidate) => candidate.id === id);
  completeRow.status = 'PASS';
  completeRow.evidence.push(...evidenceIds);
  const markdown = acceptanceDoc.replace(new RegExp(`^\\| ${id} \\|.*$`, 'm'), expectedMarkdownRow(completeRow));
  assert.equal(validateMatrix(complete, markdown), true, 'one PASS record per fixture validates');

  // Drop one fixture's record: the row can no longer claim PASS.
  const short = structuredClone(complete);
  short.rows.find((candidate) => candidate.id === id).evidence.pop();
  assert.throws(() => validateMatrix(short, markdown), /has no PASS record for fixture/, 'a fixture without its own PASS record is rejected');

  // A record on a fixture the row does not name is not one of its runs.
  const foreign = structuredClone(complete);
  foreign.evidence.find((record) => record.evidenceId === evidenceIds[0]).fixtureId = 'fx-html-page-vi';
  assert.throws(() => validateMatrix(foreign, markdown), /was run on another fixture/, 'a PASS record on a foreign fixture is rejected');
});

test('acceptance matrix rejects candidate regressions', () => {
  const passRow = () => {
    const candidate = structuredClone(matrix);
    const row = candidate.rows[0];
    row.status = 'PASS';
    const record = {
      evidenceId: 'ev-tmp-0001',
      requirementId: row.id,
      fixtureId: row.fixtures[0].id,
      fixtureSha256: row.fixtures[0].sha256,
      result: 'PASS',
      artifact: 'test-results/office-g5g6g7-evidence/tmp.json',
    };
    candidate.evidence.push(record);
    row.evidence.push(record.evidenceId);
    return candidate;
  };
  const regressions = [
    { name: 'row without an owner', mutate: (c) => delete c.rows[0].owner, expected: /needs an owner/ },
    { name: 'row without a title', mutate: (c) => delete c.rows[0].title, expected: /needs a title/ },
    { name: 'unsupported oracle type', mutate: (c) => { c.rows[0].oracle.type = 'vibes'; }, expected: /unsupported oracle type/ },
    { name: 'unsupported status', mutate: (c) => { c.rows[0].status = 'pending'; }, expected: /unsupported status/ },
    { name: 'fixture hash drift', mutate: (c) => { c.rows[0].fixtures[0].sha256 = '0'.repeat(64); }, expected: /hash drifted from the manifest/ },
    { name: 'unknown fixture reference', mutate: (c) => { c.rows[0].fixtures[0].id = 'fx-not-in-manifest'; }, expected: /unknown fixture/ },
    { name: 'duplicate row id', mutate: (c) => { c.rows.push(structuredClone(c.rows[0])); }, expected: /duplicate row id/ },
    { name: 'dropped requirement id', mutate: (c) => { c.rows.pop(); }, expected: /exactly the spec Section 9.1 requirement ids/ },
    { name: 'row without tasks', mutate: (c) => { c.rows[0].tasks = []; }, expected: /needs the plan tasks/ },
    { name: 'dropped pending reviewer gate', mutate: (c) => { c.rows[0].reviewer = 'reviewer_be'; }, expected: /must remain pending/ },
    { name: 'BLOCKED row without a blocker', mutate: (c) => { c.rows.find((r) => r.status === 'BLOCKED').blocker = null; }, expected: /needs a blocker/ },
    { name: 'BLOCKED row with an empty blocker reason', mutate: (c) => { c.rows.find((r) => r.status === 'BLOCKED').blocker.reason = ''; }, expected: /needs blocker.reason/ },
    { name: 'NOT_RUN row carrying a blocker', mutate: (c) => { c.rows.find((r) => r.status === 'NOT_RUN').blocker = { gate: 'G5-D1', owner: 'x', reason: 'y' }; }, expected: /carries a blocker without being BLOCKED/ },
    { name: 'rowCounts drift', mutate: (c) => { c.rowCounts.total += 1; }, expected: /rowCounts must reconcile/ },
    { name: 'PASS without evidence', mutate: (c) => { c.rows[0].status = 'PASS'; }, expected: /PASS row needs evidence/ },
    { name: 'PASS naming evidence that no record declares', mutate: (c) => { const r = passRow(); r.rows[0].evidence.push('ev-missing'); return r; }, expected: /that no record declares/ },
    { name: 'PASS whose evidence has no artifact', mutate: (c) => { c.evidence[0].artifact = ''; return c; }, build: passRow, expected: /needs an artifact/ },
    { name: 'PASS whose evidence was run on another fixture', mutate: (c) => { c.evidence[0].fixtureId = 'fx-html-page-vi'; return c; }, build: passRow, expected: /was run on another fixture/ },
    { name: 'PASS on a two-fixture row with a record for only one', mutate: () => 'no change to the json', build: passRow, expected: /has no PASS record for fixture/ },
    { name: 'markdown count table drift', mutate: () => 'no change to the json', doc: (doc) => doc.replace('| 3 NOT_RUN, 2 BLOCKED |', '| 2 NOT_RUN, 3 BLOCKED |'), expected: /count table does not match/ },
    { name: 'markdown totals row drift', mutate: () => 'no change to the json', doc: (doc) => doc.replace('**19 NOT_RUN, 4 BLOCKED, 0 PASS**', '**18 NOT_RUN, 5 BLOCKED, 0 PASS**'), expected: /totals row does not match/ },
    { name: 'markdown blocked count word drift', mutate: () => 'no change to the json', doc: (doc) => doc.replace('Bốn dòng bị chặn hôm nay', 'Năm dòng bị chặn hôm nay'), expected: /blocked count must read/ },
    { name: 'markdown group heading promoted back to a sibling', mutate: () => 'no change to the json', doc: (doc) => doc.replace('### Nghiệm thu G6', '## Nghiệm thu G6'), expected: /must be a ### subsection/ },
    { name: 'PASS whose evidence has a stale fixture hash', mutate: (c) => { c.evidence[0].fixtureSha256 = '0'.repeat(64); return c; }, build: passRow, expected: /stale fixture hash/ },
    { name: 'skip result counted as PASS', mutate: (c) => { c.evidence[0].result = 'skip'; return c; }, build: passRow, expected: /counts a non-PASS result as PASS/ },
    { name: 'NOT_RUN result counted as PASS', mutate: (c) => { c.evidence[0].result = 'NOT_RUN'; return c; }, build: passRow, expected: /counts a non-PASS result as PASS/ },
    { name: 'BLOCKED result counted as PASS', mutate: (c) => { c.evidence[0].result = 'BLOCKED'; return c; }, build: passRow, expected: /counts a non-PASS result as PASS/ },
    { name: 'markdown mirror drift', mutate: () => 'no change to the json', build: (c) => c, doc: (doc) => doc.replace('| NOT_RUN |', '| BLOCKED |'), expected: /drifted from the JSON matrix/ },
    { name: 'markdown mirror missing a row', mutate: () => 'no change to the json', build: (c) => c, doc: (doc) => doc.replace(/\n\| G5-A02 \|[^\n]*/, ''), expected: /acceptance.md must have one row per matrix row/ },
  ];
  for (const { name, mutate, build = (c) => c, doc, expected } of regressions) {
    const candidate = build(structuredClone(matrix));
    const result = mutate(candidate);
    // A mutate may return a replacement candidate (the PASS cases build one);
    // `delete` and string returns are not candidates, so they keep the clone.
    const target = result && typeof result === 'object' ? result : candidate;
    const markdown = doc ? doc(acceptanceDoc) : acceptanceDoc;
    assert.throws(() => validateMatrix(target, markdown), expected, `matrix validation accepted a regression: ${name}`);
  }
});
