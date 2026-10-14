// Sibling of scripts/office/acceptance-matrix.test.mjs for the G5/G6/G7 matrix
// (UNI-1376 / G7-01 item B), extended with the G8 collaboration rows (UNI-1331,
// plan section 5.7). The g3g4 matrix is a different contract and is not
// touched here; this file owns the G5/G6/G7/G8 rows, their markdown mirror and the
// evidence records they may not claim without.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const matrixPath = path.join(repoRoot, 'docs/office/g5g6g7/acceptance-rows.json');
const acceptancePath = path.join(repoRoot, 'docs/office/g5g6g7/acceptance.md');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const acceptanceDoc = fs.readFileSync(acceptancePath, 'utf8');

// A PASS record has to point at an artifact that exists, so the tests write real
// scratch artifacts outside the checkout and reference them by absolute path.
const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-matrix-test-'));
test.after(() => fs.rmSync(artifactDir, { recursive: true, force: true }));
const writeArtifact = (name) => {
  const file = path.join(artifactDir, name);
  fs.writeFileSync(file, `$ check ${name}\n\nexit 0\n`);
  return file;
};

// Spec Section 9.1, one id per requirement, plus the G8 addendum rows (plan
// section 5.7 acceptance table) and the folder rows of epic E6 (UNI-1425, plan
// section 5.8: FD-A01..FD-A12 = AC-01..AC-12). A new requirement is added here and in
// acceptance-rows.json together; the count below is the other half.
const requirementIds = [
  ...range('G5', 1, 8),
  ...range('G6', 1, 10),
  ...range('G7', 1, 5),
  ...range('G8', 1, 10),
  ...range('FD', 1, 12),
];
const oracleTypes = new Set(['receipt', 'object/part', 'extraction', 'render diff', 'deterministic score', 'security probe', 'manifest']);
const hosts = new Set(['web', 'desktop']);
const statuses = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);
// The exact result vocabulary of the runner (evidence.mjs RESULTS). A hand-written
// line that says "skipped", "SKIP" or "" is not a result at all and fails, rather
// than sliding past a PASS row as neither a pass nor a non-pass (R1-08).
const evidenceResults = new Set(['PASS', 'FAIL', 'BLOCKED']);

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

/**
 * The revision this matrix is reviewed on: HEAD of this checkout. A PASS record
 * has to name it, so a record from an older revision cannot back a PASS row.
 */
function reviewedRevision() {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  if (head.status !== 0) throw new Error(`cannot resolve the reviewed revision: ${head.stderr?.trim()}`);
  return head.stdout.trim();
}

/**
 * The ledger is read only when the caller names it (OFFICE_EVIDENCE_LEDGER, or
 * the explicit argument). The default path is gitignored, so reading it
 * implicitly would validate records that were run on another revision — or on no
 * revision at all, on a checkout that never ran the cloud round (R1-04).
 */
function ledgerPathFor(env = process.env, explicit = env.OFFICE_EVIDENCE_LEDGER) {
  const named = explicit?.trim();
  if (!named) return null;
  return path.isAbsolute(named) ? named : path.join(repoRoot, named);
}

/**
 * Evidence records the matrix declares, plus the ledger when a caller names one.
 * A ledger that is named and absent is a misconfiguration (a typo, the wrong
 * worktree, a run that never happened), so it throws instead of validating the
 * declared records alone and passing green (N5).
 */
function readEvidence(candidate, env = process.env, explicit = env.OFFICE_EVIDENCE_LEDGER) {
  const records = Array.isArray(candidate.evidence) ? [...candidate.evidence] : [];
  const ledgerPath = ledgerPathFor(env, explicit);
  if (ledgerPath) {
    if (!fs.existsSync(ledgerPath)) throw new Error(`the evidence ledger ${ledgerPath} is named but does not exist`);
    for (const rawLine of fs.readFileSync(ledgerPath, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (line) records.push(JSON.parse(line));
    }
  }
  return records;
}

/** An artifact path from the ledger is repo-relative unless it is absolute. */
function artifactExists(artifact) {
  if (!isFilled(artifact)) return false;
  return fs.existsSync(path.isAbsolute(artifact) ? artifact : path.join(repoRoot, artifact));
}

const gateMarker = '## Gate đang mở';
const countWords = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười'];

/**
 * The numbers acceptance.md repeats in prose, recomputed from a candidate: the
 * per-group count lines, the totals row, the BLOCKED ids and the blocked-count
 * phrase.
 */
function summarize(candidate) {
  const perGroup = {};
  const totals = { NOT_RUN: 0, BLOCKED: 0, PASS: 0, FAIL: 0 };
  for (const row of candidate.rows) {
    const group = row.id.slice(0, 2);
    perGroup[group] ??= { NOT_RUN: 0, BLOCKED: 0, PASS: 0, FAIL: 0 };
    perGroup[group][row.status] += 1;
    totals[row.status] += 1;
  }
  const counted = (counts) => ['NOT_RUN', 'BLOCKED', 'PASS', 'FAIL'].filter((status) => counts[status] > 0).map((status) => `${counts[status]} ${status}`).join(', ');
  const groupRange = (group) => {
    const ids = requirementIds.filter((id) => id.startsWith(`${group}-`));
    return `${group} (${ids[0]}...${ids[ids.length - 1]})`;
  };
  const groupLines = Object.entries(perGroup).map(([group, counts]) => ({
    group,
    line: `| ${groupRange(group)} | ${candidate.rows.filter((row) => row.id.startsWith(`${group}-`)).length} | ${counted(counts)} |`,
  }));
  // The totals row names all three statuses plus the zeroes it wants to show.
  const totalLine = `**${totals.NOT_RUN} NOT_RUN, ${totals.BLOCKED} BLOCKED, ${totals.PASS} PASS**`;
  const blocked = candidate.rows.filter((row) => row.status === 'BLOCKED').map((row) => row.id);
  return { groupLines, totalLine, blocked, blockedPhrase: `${countWords[blocked.length]} dòng bị chặn hôm nay` };
}

/**
 * acceptance.md rewritten to mirror a candidate: its rows, count lines, totals
 * row and open-gate section (which carries the blocked-count word). The self-tests build their
 * cases from a synthetic matrix and this doc, so no case depends on which rows
 * the committed matrix has moved to PASS.
 */
function mirrorDoc(candidate, doc = acceptanceDoc) {
  const summary = summarize(candidate);
  let out = doc;
  for (const row of candidate.rows) out = out.replace(new RegExp(`^\\| ${row.id} \\|.*$`, 'm'), () => expectedMarkdownRow(row));
  for (const { group, line } of summary.groupLines) out = out.replace(new RegExp(`^\\| ${group} \\(.*$`, 'm'), () => line);
  out = out.replace(/\*\*\d+ NOT_RUN, \d+ BLOCKED, \d+ PASS\*\*/, () => summary.totalLine);
  // The blocked-count phrase and the BLOCKED ids both live in the open-gate
  // section, so the section is rewritten whole.
  const [head, tail] = out.split(gateMarker);
  const end = tail.indexOf('\n## ');
  const phrase = summary.blockedPhrase;
  const section = `\n\n${phrase[0].toUpperCase()}${phrase.slice(1)}:\n\n- ${summary.blocked.join(', ')}\n`;
  return `${head}${gateMarker}${section}${end === -1 ? '' : tail.slice(end)}`;
}

/**
 * A matrix the self-tests own: the committed rows with every status set by the
 * test (all NOT_RUN, the last row BLOCKED), no evidence, and a doc mirrored from
 * it. A row that legitimately becomes PASS in the committed matrix changes
 * nothing here.
 */
function syntheticBase() {
  const base = structuredClone(matrix);
  base.evidence = [];
  const last = base.rows.length - 1;
  base.rows.forEach((row, index) => {
    row.evidence = [];
    row.status = index === last ? 'BLOCKED' : 'NOT_RUN';
    row.blocker = index === last ? { gate: 'G7-D2', owner: 'QA', reason: 'synthetic blocker for the self-tests' } : null;
  });
  const sampleIndex = base.rows.findIndex((row, index) => index !== last && row.fixtures.length > 1);
  assert.ok(sampleIndex >= 0, 'the self-tests need a multi-fixture row that is not the last row');
  return { base, doc: mirrorDoc(base), sampleIndex };
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
    assert.ok(isFilled(row.evidenceRequired), `${row.id} needs a non-empty evidenceRequired (what proves it)`);
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
      // R1-08: the vocabulary is exactly PASS | FAIL | BLOCKED. "skipped",
      // "SKIP", "not_run" and "" are not results and fail here.
      assert.ok(
        evidenceResults.has(evidenceById.get(evidenceId).result),
        `${row.id} evidence ${evidenceId} has an unsupported result ${JSON.stringify(evidenceById.get(evidenceId).result)}`,
      );
    }
    if (row.status === 'BLOCKED') {
      assert.ok(row.blocker && typeof row.blocker === 'object', `${row.id} blocked row needs a blocker`);
      assert.ok(isFilled(row.blocker.gate), `${row.id} blocked row needs blocker.gate`);
      assert.ok(isFilled(row.blocker.owner), `${row.id} blocked row needs blocker.owner`);
      assert.ok(isFilled(row.blocker.reason), `${row.id} blocked row needs blocker.reason`);
    } else {
      assert.equal(row.blocker, null, `${row.id} carries a blocker without being BLOCKED`);
    }
    if (row.status === 'PASS') {
      // A PASS needs a recorded run on this revision whose own result is PASS.
      assert.ok(row.evidence.length > 0, `${row.id} PASS row needs evidence`);
      // No record beside a PASS may carry anything but PASS, whatever the row says.
      assert.equal(row.evidence.some((id) => evidenceById.get(id)?.result !== 'PASS'), false, `${row.id} counts a non-PASS result as PASS`);
      const passing = row.evidence.map((id) => evidenceById.get(id)).filter((record) => record?.result === 'PASS');
      assert.ok(passing.length > 0, `${row.id} PASS row needs an evidence record whose result is PASS`);
      // A PASS record must have run on one of the row's fixtures, on that
      // fixture's current hash — not on a fixture the row never names.
      for (const record of passing) {
        assert.equal(record.requirementId, row.id, `${row.id} PASS evidence ${record.evidenceId} names requirement ${record.requirementId}`);
        assert.ok(isFilled(record.artifact), `${row.id} PASS evidence ${record.evidenceId} needs an artifact`);
        // R1-05: the artifact has to be on disk, not just named, and the run has
        // to have exited 0 — the runner's own verify rules, enforced here too so
        // the repo gate catches them without the cloud round.
        assert.ok(artifactExists(record.artifact), `${row.id} PASS evidence ${record.evidenceId} artifact ${record.artifact} is not on disk`);
        assert.equal(record.exitCode, 0, `${row.id} PASS evidence ${record.evidenceId} has exit code ${record.exitCode}`);
        // R1-04: the run must be on the revision under review.
        assert.equal(record.dSha, reviewedRevision(), `${row.id} PASS evidence ${record.evidenceId} was run on ${record.dSha}, not on the reviewed revision`);
        const reference = row.fixtures.find((fixture) => fixture.id === record.fixtureId);
        assert.ok(reference, `${row.id} PASS evidence ${record.evidenceId} was run on another fixture`);
        assert.equal(record.fixtureSha256, reference.sha256, `${row.id} PASS evidence ${record.evidenceId} has a stale fixture hash`);
        assert.ok(isDigest(record.fixtureSha256), `${row.id} PASS evidence ${record.evidenceId} needs a fixture digest`);
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
    G8: candidate.rows.filter((row) => row.id.startsWith('G8-')).length,
    FD: candidate.rows.filter((row) => row.id.startsWith('FD-')).length,
    total: candidate.rows.length,
  };
  assert.deepEqual(candidate.rowCounts, counts, 'rowCounts must reconcile with the rows');
  assert.deepEqual(counts, { G5: 8, G6: 10, G7: 5, G8: 10, FD: 12, total: 45 }, 'the spec Section 9.1 split plus the G8 and E6 folder rows must not change silently');
  // R1-14: today's slice is not frozen here. A row that legitimately becomes PASS,
  // or a gate that closes and leaves no BLOCKED row, must not fail a correct
  // matrix; the rows' own rules and the prose count table are what is pinned.

  // acceptance.md repeats these rows cell for cell; the test fails on any drift.
  const markdownRows = parseMarkdownRows(doc);
  assert.equal(markdownRows.size, candidate.rows.length, 'acceptance.md must have one row per matrix row');
  for (const row of candidate.rows) {
    assert.ok(markdownRows.has(row.id), `acceptance.md is missing row ${row.id}`);
    assert.equal(markdownRows.get(row.id), expectedMarkdownRow(row), `acceptance.md row ${row.id} drifted from the JSON matrix`);
  }

  // The prose around the table is prose, but the numbers in it are the
  // candidate's, so the test recomputes them from the candidate it was handed: a
  // status change that the summary does not follow is a regression (reviewer_fe
  // F1, N6).
  const summary = summarize(candidate);
  for (const { line } of summary.groupLines) {
    assert.ok(doc.includes(line), `acceptance.md count table does not match the rows: expected ${line}`);
  }
  assert.ok(doc.includes(summary.totalLine), `acceptance.md totals row does not match the rows: expected ${summary.totalLine}`);
  const gateSection = doc.split(gateMarker)[1]?.split('\n## ')[0] ?? '';
  assert.deepEqual(
    [...new Set(gateSection.match(/(?:G[5678]|FD)-A\d\d/g) ?? [])].sort(),
    [...summary.blocked].sort(),
    'the open-gate section must name exactly the BLOCKED rows',
  );
  assert.ok(doc.toLowerCase().includes(summary.blockedPhrase), `the blocked count must read "${summary.blockedPhrase}"`);

  // The group tables are subsections of the matrix section, not siblings of it
  // (reviewer_fe F3).
  for (const group of ['G5', 'G6', 'G7', 'G8', 'FD']) {
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

// A PASS candidate for one row of the synthetic base: one PASS record per fixture
// the row names, each on a real scratch artifact and on the reviewed revision.
function passCandidate(base, sampleIndex, { fixtureCount } = {}) {
  const candidate = structuredClone(base);
  const row = candidate.rows[sampleIndex];
  const references = row.fixtures.slice(0, fixtureCount ?? row.fixtures.length);
  const records = references.map((reference, index) => ({
    evidenceId: `ev-${row.id.toLowerCase()}-${index}`,
    requirementId: row.id,
    fixtureId: reference.id,
    fixtureSha256: reference.sha256,
    result: 'PASS',
    artifact: writeArtifact(`${row.id}-${index}.log`),
    exitCode: 0,
    dSha: reviewedRevision(),
  }));
  row.status = 'PASS';
  candidate.evidence.push(...records);
  row.evidence.push(...records.map((record) => record.evidenceId));
  return candidate;
}

test('a PASS row that runs on several fixtures needs one PASS record per fixture', () => {
  const { base, sampleIndex } = syntheticBase();
  const id = base.rows[sampleIndex].id;
  const complete = passCandidate(base, sampleIndex);
  const markdown = mirrorDoc(complete);
  assert.equal(validateMatrix(complete, markdown), true, 'one PASS record per fixture validates');

  // Drop one fixture's record: the row can no longer claim PASS.
  const short = structuredClone(complete);
  short.rows.find((candidate) => candidate.id === id).evidence.pop();
  assert.throws(() => validateMatrix(short, markdown), /has no PASS record for fixture/, 'a fixture without its own PASS record is rejected');

  // A record on a fixture the row does not name is not one of its runs.
  const foreign = structuredClone(complete);
  foreign.evidence[0].fixtureId = 'fx-not-named-by-this-row';
  assert.throws(() => validateMatrix(foreign, markdown), /was run on another fixture/, 'a PASS record on a foreign fixture is rejected');
});

test('the summary numbers are checked against the candidate, not the committed matrix (N6)', () => {
  const { base, doc, sampleIndex } = syntheticBase();
  const complete = passCandidate(base, sampleIndex);
  const row = complete.rows[sampleIndex];
  assert.equal(validateMatrix(base, doc), true, 'the synthetic base validates against its own doc');

  // The candidate moves a row to PASS and the row line follows, but the count
  // table still says everything is NOT_RUN: the cross-check has to catch it.
  const rowOnly = doc.replace(new RegExp(`^\\| ${row.id} \\|.*$`, 'm'), () => expectedMarkdownRow(row));
  assert.throws(() => validateMatrix(complete, rowOnly), /count table does not match/, 'a status change the count table does not follow is caught');

  // The count lines follow, the totals row does not.
  const staleTotals = mirrorDoc(complete).replace(/\*\*\d+ NOT_RUN, \d+ BLOCKED, \d+ PASS\*\*/, () => summarize(base).totalLine);
  assert.throws(() => validateMatrix(complete, staleTotals), /totals row does not match/, 'a status change the totals row does not follow is caught');

  // A NOT_RUN row that turns BLOCKED changes the blocked-count word and the
  // open-gate section.
  const blockedCandidate = structuredClone(base);
  const flipped = blockedCandidate.rows[sampleIndex];
  flipped.status = 'BLOCKED';
  flipped.blocker = { gate: 'G5-D1', owner: 'QA', reason: 'synthetic' };
  const mirrored = mirrorDoc(blockedCandidate);
  assert.equal(validateMatrix(blockedCandidate, mirrored), true, 'a doc mirrored from the candidate validates');
  const staleWord = mirrored.replace(/hai dòng bị chặn hôm nay/i, () => summarize(base).blockedPhrase);
  assert.throws(() => validateMatrix(blockedCandidate, staleWord), /blocked count must read/, 'a BLOCKED row the count word does not follow is caught');
  const staleGate = mirrored.replace(`- ${flipped.id}, `, '- ');
  assert.throws(() => validateMatrix(blockedCandidate, staleGate), /open-gate section must name exactly/, 'a BLOCKED row the gate section does not name is caught');
});

test('the ledger is read only when the caller names it, and only its own records', () => {
  // R1-04: the default ledger path is gitignored, so it is never read implicitly.
  assert.equal(ledgerPathFor({}), null, 'no env var, no ledger');
  assert.equal(ledgerPathFor({ OFFICE_EVIDENCE_LEDGER: 'x.jsonl' }), path.join(repoRoot, 'x.jsonl'));
  assert.equal(ledgerPathFor({ OFFICE_EVIDENCE_LEDGER: '/tmp/x.jsonl' }), '/tmp/x.jsonl');
  assert.equal(ledgerPathFor({}, 'y.jsonl'), path.join(repoRoot, 'y.jsonl'), 'an explicit argument names a ledger too');
  const { base } = syntheticBase();
  base.evidence.push({ evidenceId: 'ev-declared', result: 'PASS' });
  assert.equal(readEvidence(base, {}).length, 1, 'without an env var only the declared records are read');
  const ledger = path.join(artifactDir, 'ledger.jsonl');
  fs.writeFileSync(ledger, `${JSON.stringify({ evidenceId: 'ev-from-ledger', result: 'PASS' })}\n`);
  assert.equal(readEvidence(base, { OFFICE_EVIDENCE_LEDGER: ledger }).length, 2);
  assert.equal(readEvidence(base, {}, ledger).length, 2, 'an explicit ledger argument is read too');
  fs.rmSync(ledger);
});

test('a ledger that is named and does not exist is an error, not a green gate (N5)', () => {
  const { base } = syntheticBase();
  const missing = path.join(artifactDir, 'no-such-ledger.jsonl');
  assert.throws(() => readEvidence(base, { OFFICE_EVIDENCE_LEDGER: missing }), /named but does not exist/, 'a missing ledger named by the environment throws');
  assert.throws(() => readEvidence(base, {}, missing), /named but does not exist/, 'a missing ledger named by an argument throws');
  assert.throws(() => readEvidence(base, { OFFICE_EVIDENCE_LEDGER: 'no-such-dir/ledger.jsonl' }), /named but does not exist/, 'a repo-relative typo throws');
  // The gate itself reads the process environment, so it fails too.
  const previous = process.env.OFFICE_EVIDENCE_LEDGER;
  process.env.OFFICE_EVIDENCE_LEDGER = missing;
  try {
    assert.throws(() => validateMatrix(matrix), /named but does not exist/, 'the matrix gate does not pass over a missing ledger');
  } finally {
    if (previous === undefined) delete process.env.OFFICE_EVIDENCE_LEDGER;
    else process.env.OFFICE_EVIDENCE_LEDGER = previous;
  }
});

test('acceptance matrix rejects candidate regressions', () => {
  const { base, doc: baseDoc, sampleIndex } = syntheticBase();
  const passRow = (candidate) => passCandidate(candidate, sampleIndex, { fixtureCount: 1 });
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
    { name: 'PASS naming evidence that no record declares', mutate: (c) => { c.rows[sampleIndex].evidence.push('ev-missing'); }, build: passRow, expected: /that no record declares/ },
    { name: 'PASS whose evidence has no artifact', mutate: (c) => { c.evidence[0].artifact = ''; }, build: passRow, expected: /needs an artifact/ },
    { name: 'PASS whose evidence was run on another fixture', mutate: (c) => { c.evidence[0].fixtureId = 'fx-not-named-by-this-row'; }, build: passRow, expected: /was run on another fixture/ },
    { name: 'PASS on a two-fixture row with a record for only one', mutate: () => {}, build: passRow, expected: /has no PASS record for fixture/ },
    { name: 'PASS whose evidence has a missing artifact', mutate: (c) => { c.evidence[0].artifact = path.join(os.tmpdir(), 'no-such-artifact.log'); }, build: passRow, expected: /is not on disk/ },
    { name: 'PASS whose evidence exited non-zero', mutate: (c) => { c.evidence[0].exitCode = 1; }, build: passRow, expected: /has exit code 1/ },
    { name: 'PASS whose evidence ran on another revision', mutate: (c) => { c.evidence[0].dSha = '0'.repeat(40); }, build: passRow, expected: /was run on .*, not on the reviewed revision/ },
    { name: 'PASS whose evidence has an unknown result vocabulary', mutate: (c) => { c.evidence[0].result = 'skipped'; }, build: passRow, expected: /unsupported result "skipped"/ },
    { name: 'PASS whose evidence has an empty result', mutate: (c) => { c.evidence[0].result = ''; }, build: passRow, expected: /unsupported result ""/ },
    { name: 'row without evidenceRequired', mutate: (c) => { c.rows[0].evidenceRequired = ''; }, expected: /needs a non-empty evidenceRequired/ },
    // The synthetic base has 44 NOT_RUN rows and one BLOCKED row (the last, FD-A12),
    // so these drifts name its own numbers, not the committed matrix's.
    { name: 'markdown count table drift', doc: (doc) => doc.replace('| 11 NOT_RUN, 1 BLOCKED |', '| 10 NOT_RUN, 2 BLOCKED |'), expected: /count table does not match/ },
    { name: 'markdown totals row drift', doc: (doc) => doc.replace('**44 NOT_RUN, 1 BLOCKED, 0 PASS**', '**43 NOT_RUN, 2 BLOCKED, 0 PASS**'), expected: /totals row does not match/ },
    { name: 'markdown blocked count word drift', doc: (doc) => doc.replace(/một dòng bị chặn hôm nay/i, 'Hai dòng bị chặn hôm nay'), expected: /blocked count must read/ },
    { name: 'open-gate section naming a row that is not BLOCKED', doc: (doc) => doc.replace('hôm nay:\n\n- ', 'hôm nay:\n\n- G5-A01, '), expected: /open-gate section must name exactly/ },
    { name: 'markdown group heading promoted back to a sibling', doc: (doc) => doc.replace('### Nghiệm thu G6', '## Nghiệm thu G6'), expected: /must be a ### subsection/ },
    { name: 'PASS whose evidence has a stale fixture hash', mutate: (c) => { c.evidence[0].fixtureSha256 = '0'.repeat(64); }, build: passRow, expected: /stale fixture hash/ },
    { name: 'skip result is not in the result vocabulary', mutate: (c) => { c.evidence[0].result = 'skip'; }, build: passRow, expected: /unsupported result "skip"/ },
    { name: 'NOT_RUN result is not in the result vocabulary', mutate: (c) => { c.evidence[0].result = 'NOT_RUN'; }, build: passRow, expected: /unsupported result "NOT_RUN"/ },
    { name: 'BLOCKED result counted as PASS', mutate: (c) => { c.evidence[0].result = 'BLOCKED'; }, build: passRow, expected: /counts a non-PASS result as PASS/ },
    { name: 'markdown mirror drift', doc: (doc) => doc.replace('| NOT_RUN |', '| BLOCKED |'), expected: /drifted from the JSON matrix/ },
    { name: 'markdown mirror missing a row', doc: (doc) => doc.replace(/\n\| G5-A02 \|[^\n]*/, ''), expected: /acceptance.md must have one row per matrix row/ },
  ];
  // Control: the unmutated synthetic base and a one-fixture PASS candidate of a
  // multi-fixture row differ only in the cases below, so a case that throws does
  // so for the stated reason and not because the base is broken.
  assert.equal(validateMatrix(structuredClone(base), baseDoc), true, 'the synthetic base validates');
  for (const { name, mutate = () => {}, build = (c) => c, doc, expected } of regressions) {
    const candidate = build(structuredClone(base));
    mutate(candidate);
    const markdown = doc ? doc(baseDoc) : baseDoc;
    assert.throws(() => validateMatrix(candidate, markdown), expected, `matrix validation accepted a regression: ${name}`);
  }
});
