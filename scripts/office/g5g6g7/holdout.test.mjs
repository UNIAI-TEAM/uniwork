// Schema, provenance, scoring and leak contracts for the G7-02 holdout set (UNI-1377).
//
//   node --test scripts/office/g5g6g7/holdout.test.mjs
//
// The four case files are authored by three different workers (xlsx 40, docx 20, other 20, cross 20), so this test
// is the single place that holds the whole set to the shared contract (docs/office/g5g6g7/holdout/README.md):
// the case schema, the fixture hashes against the manifest, the ground-truth provenance of every number, the scorer
// being green on each reference answer and red on the mutations that matter, and the leak rule that no case text
// exists anywhere else in the repo.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { OPERATIONS, loadCases, referenceAnswerFor, score, validateCase } from './holdout-score.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CASES_DIR = path.join(repoRoot, 'docs/office/g5g6g7/holdout/cases');
const HOLDOUT_DIR = 'docs/office/g5g6g7/holdout';
const MANIFEST = 'docs/office/g5g6g7/fixtures/manifest.json';
const WRITE_OPERATIONS = ['write_range', 'edit_paragraph'];
// spec §9.2 counts: 40 XLSX, 20 DOCX, 5 each PPTX/PDF/Markdown/HTML, 20 cross-format (>= 100 total).
const EXPECTED = [
  { file: 'xlsx.json', prefix: 'HO-XLSX-', format: 'xlsx', count: 40 },
  { file: 'docx.json', prefix: 'HO-DOCX-', format: 'docx', count: 20 },
  { file: 'other.json', prefix: 'HO-PPTX-', format: 'pptx', count: 5 },
  { file: 'other.json', prefix: 'HO-PDF-', format: 'pdf', count: 5 },
  { file: 'other.json', prefix: 'HO-MD-', format: 'md', count: 5 },
  { file: 'other.json', prefix: 'HO-HTML-', format: 'html', count: 5 },
  { file: 'cross.json', prefix: 'HO-CROSS-', format: 'cross', count: 20 },
];
const CROSS_CATEGORIES = ['permission', 'stale', 'ambiguity', 'error', 'injection'];
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST), 'utf8'));
const fixtureById = new Map(manifest.fixtures.map((fixture) => [fixture.id, fixture]));
const oracleTextById = new Map(
  manifest.fixtures.map((fixture) => [fixture.id, fs.readFileSync(path.join(repoRoot, fixture.oracle), 'utf8')]),
);

/** Every case file must exist before the counts can be checked; the merged set is the only state that passes. */
function readCaseFiles() {
  const docs = {};
  for (const name of fs.readdirSync(CASES_DIR).sort()) {
    if (name.endsWith('.json')) docs[name] = JSON.parse(fs.readFileSync(path.join(CASES_DIR, name), 'utf8'));
  }
  return docs;
}
const docs = readCaseFiles();
const allCases = Object.values(docs).flatMap((doc) => doc.cases ?? []);
const casesByPrefix = (prefix) => allCases.filter((c) => c.id?.startsWith(prefix));

/** Numbers a reader can see in a sidecar, incl. Vietnamese grouped text ("22.060.000" -> 22060000). */
function numbersInText(text) {
  const found = new Set();
  for (const match of String(text).matchAll(/-?\d[\d.,]*/g)) {
    let s = match[0].replace(/[.,]$/, '');
    const hasDot = s.includes('.');
    const hasComma = s.includes(',');
    if (hasDot && hasComma) {
      const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      s = s.split(decimal === '.' ? ',' : '.').join('').replace(decimal, '.');
    } else if (hasComma) {
      const parts = s.split(',');
      s = parts.length === 2 && parts[1].length !== 3 ? parts.join('.') : parts.join('');
    } else if (hasDot) {
      const parts = s.split('.');
      s = parts.length > 2 || (parts.length === 2 && parts[1].length === 3) ? parts.join('') : s;
    }
    const n = Number(s);
    if (Number.isFinite(n)) found.add(n);
  }
  return found;
}

/** Simple derivations a case may legitimately use on sidecar numbers (differences, shares, averages, rounding). */
function derivableFrom(values) {
  const out = new Set(values);
  for (const a of values) {
    out.add(Math.round(a));
    out.add(Math.round(a * 100) / 100);
    for (const b of values) {
      out.add(a + b);
      out.add(a - b);
      if (b !== 0) {
        out.add(a / b);
        out.add((a / b) * 100);
        out.add(Math.round(a / b));
        out.add(Math.round((a / b) * 100));
        out.add(Math.round((a / b) * 100) / 100);
        out.add(Math.round((a / b) * 10000) / 10000);
      }
    }
  }
  return out;
}

const numericAssertions = (caseDoc) => [
  ...caseDoc.expected.numeric.map((item) => ({ label: `numeric ${item.name}`, value: item.value })),
  ...caseDoc.expected.structural
    .filter((item) => typeof item.value === 'number')
    .map((item) => ({ label: `structural ${item.kind}@${item.anchor}`, value: item.value })),
];

test('case files are present and carry the §9.2 shape and counts (always on, no skip)', () => {
  for (const expected of EXPECTED) {
    assert.ok(docs[expected.file], `${expected.file} is missing from ${HOLDOUT_DIR}/cases`);
    assert.equal(docs[expected.file].schemaVersion, 1, `${expected.file} schemaVersion`);
    assert.equal(docs[expected.file].kind, 'uniwork-office-g7-holdout', `${expected.file} kind`);
    assert.ok(Array.isArray(docs[expected.file].cases), `${expected.file} cases`);
  }
  for (const expected of EXPECTED) {
    const inFile = docs[expected.file].cases.filter((c) => c.id?.startsWith(expected.prefix));
    assert.equal(inFile.length, expected.count, `${expected.file}: expected ${expected.count} ${expected.prefix} cases`);
    for (const caseDoc of inFile) assert.equal(caseDoc.format, expected.format, `${caseDoc.id} format`);
  }
  assert.ok(allCases.length >= 100, `the suite needs at least 100 cases, has ${allCases.length}`);
  const ids = allCases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'case ids must be unique');
  assert.equal(new Set(allCases.map((c) => c.query.vi)).size, allCases.length, 'query.vi must be unique');
  assert.equal(new Set(allCases.map((c) => c.query.en)).size, allCases.length, 'query.en must be unique');
  assert.equal(new Set(allCases.map((c) => c.referenceAnswer.text)).size, allCases.length, 'referenceAnswer.text must be unique');
  for (const caseDoc of allCases) assert.notEqual(caseDoc.query.vi, caseDoc.query.en, `${caseDoc.id}: vi and en differ`);
  const categories = new Set(allCases.map((c) => c.category));
  for (const category of ['compute', 'lookup', 'structure', 'edit', 'ambiguity', 'error', 'permission', 'stale', 'injection']) {
    assert.ok(categories.has(category), `the suite needs at least one ${category} case`);
  }
  for (const category of CROSS_CATEGORIES) {
    assert.ok(casesByPrefix('HO-CROSS-').some((c) => c.category === category), `cross.json needs a ${category} case`);
  }
});

test('every case satisfies the shared contract schema', () => {
  const problems = allCases.flatMap((caseDoc) => validateCase(caseDoc));
  assert.deepEqual(problems, []);
});

test('fixtures[] hash the manifest, the fixtures exist and their oracle sidecars agree', () => {
  for (const caseDoc of allCases) {
    for (const fixture of caseDoc.fixtures) {
      const entry = fixtureById.get(fixture.id);
      assert.ok(entry, `${caseDoc.id}: unknown fixture ${fixture.id}`);
      assert.equal(fixture.sha256, entry.sha256, `${caseDoc.id}: ${fixture.id} sha256 must be the manifest hash`);
      assert.equal(fixture.version, 'v1', `${caseDoc.id}: ${fixture.id} version`);
      const bytes = fs.readFileSync(path.join(repoRoot, entry.path));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${entry.path} drifted`);
    }
    const hosts = new Set(caseDoc.host);
    for (const host of hosts) assert.ok(['web', 'desktop'].includes(host), `${caseDoc.id}: host ${host}`);
  }
});

test('ground truth comes from the fixture oracle sidecars or a committed derivation', () => {
  const unexplained = [];
  for (const caseDoc of allCases) {
    const sidecar = new Set();
    for (const fixture of caseDoc.fixtures) {
      for (const value of numbersInText(oracleTextById.get(fixture.id))) sidecar.add(value);
    }
    const derivable = derivableFrom([...sidecar]);
    const source = caseDoc.oracle.source;
    const sourceNumbers = numbersInText(source);
    const derivedByScript = /\.mjs#/.test(source);
    for (const assertion of numericAssertions(caseDoc)) {
      const ok = derivable.has(assertion.value) || sourceNumbers.has(assertion.value) || derivedByScript;
      if (!ok) unexplained.push(`${caseDoc.id}: ${assertion.label} = ${assertion.value} is in no oracle sidecar or derivation`);
    }
    if (!/oracle\.json|\.mjs|spec |lane brief|role = |fixture/i.test(source)) {
      unexplained.push(`${caseDoc.id}: oracle.source names no fixture, sidecar or committed derivation`);
    }
  }
  assert.deepEqual(unexplained, []);
});

test('the committed XLSX truth script agrees with xlsx.json (every number recomputed from the workbook)', () => {
  const out = execFileSync(process.execPath, [path.join(repoRoot, 'scripts/office/g5g6g7/holdout-xlsx-truth.mjs'), '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.match(out, /OK/, `holdout-xlsx-truth --check said: ${out}`);
});

test('the scorer passes every reference answer and never fails one', () => {
  const failures = [];
  for (const caseDoc of allCases) {
    const result = score(caseDoc, referenceAnswerFor(caseDoc));
    if (result.status === 'fail') {
      failures.push(`${caseDoc.id}: ${result.checks.filter((c) => c.status === 'fail').map((c) => `${c.id} (${c.detail})`).join('; ')}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('a deterministic case with no caveat must be a plain PASS, not needs_reviewer', () => {
  const wrong = [];
  for (const caseDoc of allCases) {
    const caveats = caseDoc.expected.structural.some((item) => item.kind === 'caveat');
    if (caseDoc.oracle.type === 'deterministic' && !caveats) {
      const result = score(caseDoc, referenceAnswerFor(caseDoc));
      if (result.status !== 'pass') wrong.push(`${caseDoc.id}: ${result.status}`);
    }
    // A caveat or a rubric oracle is exactly what sends a case to a reviewer; an LLM judge never PASSes by itself.
    if (caveats || caseDoc.oracle.type === 'rubric') {
      const result = score(caseDoc, referenceAnswerFor(caseDoc));
      assert.notEqual(result.status, 'pass', `${caseDoc.id}: caveat/rubric cases must not pass on the scorer alone`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('the scorer is red on a wrong number, an extra write, a missing tool and a tool outside the allowlist', () => {
  for (const caseDoc of allCases) {
    const reference = referenceAnswerFor(caseDoc);
    const firstNumber = Object.keys(reference.numeric)[0];
    if (firstNumber !== undefined) {
      const answer = structuredClone(reference);
      answer.numeric[firstNumber] += 1;
      assert.equal(score(caseDoc, answer).status, 'fail', `${caseDoc.id}: a wrong ${firstNumber} must fail`);
    }
    const extraWrite = structuredClone(reference);
    extraWrite.writes = (extraWrite.writes ?? 0) + 1;
    assert.equal(score(caseDoc, extraWrite).status, 'fail', `${caseDoc.id}: a write above expected.writes must fail`);

    const missingTool = structuredClone(reference);
    missingTool.tools.used = [];
    if (caseDoc.tools.required.length > 0) {
      assert.equal(score(caseDoc, missingTool).status, 'fail', `${caseDoc.id}: skipping a required tool must fail`);
    }
    const strayTool = structuredClone(reference);
    strayTool.tools.used = [...reference.tools.used, ...OPERATIONS.filter((op) => !caseDoc.tools.allowed.includes(op)).slice(0, 1)];
    assert.equal(score(caseDoc, strayTool).status, 'fail', `${caseDoc.id}: a tool outside allowed must fail (spec 9.2: zero cases)`);
  }
});

test('the scorer is red when the reply echoes an injected token', () => {
  const injectionCases = allCases.filter((c) => c.expected.mustNotContain.length > 0);
  assert.ok(injectionCases.length >= 6, `expected injection/mustNotContain cases, found ${injectionCases.length}`);
  for (const caseDoc of injectionCases) {
    const answer = structuredClone(referenceAnswerFor(caseDoc));
    answer.text = `${answer.text} ${caseDoc.expected.mustNotContain[0]}`;
    assert.equal(score(caseDoc, answer).status, 'fail', `${caseDoc.id}: echoing ${caseDoc.expected.mustNotContain[0]} must fail`);
  }
});

test('the scorer is red on a missing structural fact and on an unknown operation', () => {
  for (const caseDoc of allCases.filter((c) => c.expected.structural.length > 0)) {
    const answer = structuredClone(referenceAnswerFor(caseDoc));
    answer.structural = answer.structural.slice(1);
    assert.equal(score(caseDoc, answer).status, 'fail', `${caseDoc.id}: dropping a structural item must fail`);
  }
  const caseDoc = allCases[0];
  const answer = structuredClone(referenceAnswerFor(caseDoc));
  answer.tools.used = ['summon_tool'];
  assert.equal(score(caseDoc, answer).status, 'fail', `${caseDoc.id}: an unknown operation must fail`);
});

test('a malformed case fails the scorer instead of scoring it', () => {
  const numericCase = allCases.find((c) => c.expected.numeric.length > 0);
  const broken = structuredClone(numericCase);
  broken.expected.numeric[0].rounding = '5dp';
  assert.equal(score(broken, referenceAnswerFor(broken)).status, 'fail');
  const brokenFixture = structuredClone(numericCase);
  brokenFixture.fixtures[0].sha256 = 'x'.repeat(64);
  assert.equal(score(brokenFixture, referenceAnswerFor(brokenFixture)).status, 'fail');
});

test('quality bar: each category carries the assertion the spec demands', () => {
  const problems = [];
  for (const caseDoc of allCases) {
    const { category, expected, role, format, tools } = caseDoc;
    const writes = expected.writes;
    const caveats = expected.structural.filter((item) => item.kind === 'caveat');
    const errorNamed = expected.structural.some(
      (item) =>
        item.kind === 'not_found' ||
        item.kind === 'refusal' ||
        (typeof item.value === 'string' && /^#(DIV\/0!|N\/A|REF!|VALUE!|NAME\?|NULL!)/.test(item.value)),
    );
    if (category === 'ambiguity') {
      if (!expected.structural.some((item) => item.kind === 'clarification')) problems.push(`${caseDoc.id}: ambiguity needs a clarification`);
      if (!tools.required.includes('ask_clarification')) problems.push(`${caseDoc.id}: ambiguity must require ask_clarification`);
      if (writes !== 0) problems.push(`${caseDoc.id}: ambiguity must not write`);
    }
    if (category === 'error' && !errorNamed) problems.push(`${caseDoc.id}: an error case must name the error, not answer a number`);
    if (category === 'permission') {
      if (writes !== 0) problems.push(`${caseDoc.id}: a permission case must not write`);
      if (!expected.structural.some((item) => item.kind === 'refusal') && role !== 'viewer') {
        problems.push(`${caseDoc.id}: a permission case needs a refusal or the viewer role`);
      }
    }
    if (category === 'stale') {
      if (caseDoc.setup?.serverVersionAhead !== true) problems.push(`${caseDoc.id}: a stale case needs setup.serverVersionAhead`);
      if (caveats.length === 0) problems.push(`${caseDoc.id}: a stale case must state which copy it read`);
    }
    if (category === 'injection') {
      // The marker is the strongest handle, but a case that quotes the injected text while refusing is legitimate
      // (HO-XLSX-040): zero writes plus the allowlist and a graded document fact carry it instead.
      const gradedFact =
        expected.numeric.length > 0 ||
        expected.structural.some((item) => ['cell', 'table_cell', 'formula', 'count'].includes(item.kind));
      const safetyHandle =
        expected.mustNotContain.length > 0 ||
        expected.structural.some((item) => item.kind === 'refusal' || item.kind === 'not_found') ||
        caveats.length > 0 ||
        gradedFact;
      if (!safetyHandle) problems.push(`${caseDoc.id}: an injection case needs a marker, a refusal or a graded fact`);
      if (writes !== 0) problems.push(`${caseDoc.id}: an injection case must not write`);
      if (!caseDoc.setup?.overlay && !caseDoc.setup?.history) {
        problems.push(`${caseDoc.id}: an injection case needs setup.overlay or setup.history`);
      }
    }
    if (expected.numeric.length === 0 && expected.structural.length === 0) problems.push(`${caseDoc.id}: no expected output`);
    if (writes > 0 && !tools.required.some((op) => WRITE_OPERATIONS.includes(op))) {
      problems.push(`${caseDoc.id}: a writing case must require a write operation`);
    }
    if (writes > 0 && tools.allowed.some((op) => WRITE_OPERATIONS.includes(op)) === false) {
      problems.push(`${caseDoc.id}: a writing case must allow the write operation it uses`);
    }
    if (role === 'viewer' && tools.allowed.some((op) => WRITE_OPERATIONS.includes(op))) {
      problems.push(`${caseDoc.id}: a viewer case cannot allow a write operation`);
    }
    if (format === 'pdf' && tools.allowed.some((op) => WRITE_OPERATIONS.includes(op))) {
      problems.push(`${caseDoc.id}: pdf cases are read-only (amendment 2)`);
    }
    for (const item of caveats) {
      if (!/^(version|hiddenRows|hidden_rows|rounding|Z|X\/Y\/Z|H5|I2|consistency|targetRange|Ghi chú!A8|Tổng hợp!A6)$/.test(item.anchor)) {
        problems.push(`${caseDoc.id}: unexpected caveat anchor ${item.anchor}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('setup is accepted and validated: overlay, history, selection, serverVersionAhead', () => {
  const withOverlay = allCases.filter((c) => c.setup?.overlay);
  const withHistory = allCases.filter((c) => c.setup?.history);
  const withSelection = allCases.filter((c) => typeof c.setup?.selection === 'string');
  const withAhead = allCases.filter((c) => c.setup?.serverVersionAhead === true);
  assert.ok(withOverlay.length >= 4, 'the set needs overlay cases');
  assert.ok(withHistory.length >= 1, 'the set needs a history-replay case (amendment 3)');
  assert.ok(withSelection.length >= 1, 'the set needs a selection anchor case');
  assert.ok(withAhead.length >= 2, 'the set needs stale-version cases');
  for (const caseDoc of withOverlay) {
    for (const entry of caseDoc.setup.overlay) {
      assert.ok(caseDoc.fixtures.some((f) => f.id === entry.fixtureId), `${caseDoc.id}: overlay fixtureId`);
      assert.ok(entry.value.trim().length > 0, `${caseDoc.id}: overlay value`);
      if (entry.op === 'set_cell') assert.ok(entry.sheet && entry.cell, `${caseDoc.id}: set_cell needs sheet and cell`);
      else assert.ok(entry.anchor, `${caseDoc.id}: ${entry.op} needs an anchor`);
    }
  }
  for (const caseDoc of withHistory) {
    for (const turn of caseDoc.setup.history) {
      assert.ok(['user', 'assistant', 'tool'].includes(turn.role), `${caseDoc.id}: history role`);
      assert.ok(turn.text.trim().length > 0, `${caseDoc.id}: history text`);
    }
  }
  // A selection anchor is opaque to the scorer: any non-empty string passes, null marks the ambiguity cases.
  for (const caseDoc of allCases) {
    if (caseDoc.setup && 'selection' in caseDoc.setup) {
      assert.ok(caseDoc.setup.selection === null || caseDoc.setup.selection.trim().length > 0, `${caseDoc.id}: selection`);
    }
  }
});

test('case text stays inside the holdout directory (spec §9.2: answers never reach a prompt or the dev set)', () => {
  const patterns = new Set();
  const fixtureText = [...oracleTextById.values()].join('\n');
  for (const caseDoc of allCases) {
    patterns.add(caseDoc.query.vi);
    patterns.add(caseDoc.query.en);
    patterns.add(caseDoc.referenceAnswer.text);
    for (const item of caseDoc.expected.structural) {
      // A structural value may legitimately quote the document (a heading, a cell text); the fixture owns that string.
      if (typeof item.value === 'string' && item.value.length > 20 && !fixtureText.includes(item.value)) patterns.add(item.value);
    }
  }
  const list = [...patterns];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdout-leak-'));
  const patternFile = path.join(dir, 'patterns.txt');
  fs.writeFileSync(patternFile, `${list.join('\n')}\n`, 'utf8');
  try {
    const out = execFileSync(
      'git',
      ['grep', '-F', '-I', '-l', '-f', patternFile, '--', '.', `:(exclude)${HOLDOUT_DIR}/**`],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.fail(`case text leaked outside ${HOLDOUT_DIR}: ${out.trim().split('\n').join(', ')}`);
  } catch (error) {
    if (error.status === 1) return; // git grep exits 1 when nothing matched: no leak.
    if (error.status === undefined || error.status === null) throw error;
    throw new Error(`git grep failed (exit ${error.status}): ${error.stderr ?? error.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadCases reads the directory and refuses a foreign document', () => {
  const { cases } = loadCases(CASES_DIR);
  assert.equal(cases.length, allCases.length);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdout-load-'));
  try {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, kind: 'something-else', cases: [] }), 'utf8');
    assert.throws(() => loadCases(dir), /holdout/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
