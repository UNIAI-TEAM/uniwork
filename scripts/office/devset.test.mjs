import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEVSET_CASES_PATH,
  DEVSET_DIR,
  DEVSET_FIXTURES_DIR,
  DEVSET_MANIFEST_PATH,
  DEVSET_README_PATH,
  buildDevFixtures,
  loadDevSet,
  normalizePrompt,
  scanForSecrets,
  scoreDevCase,
  validateDevCase,
} from './devset.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOLDOUT_CASES_DIR = path.join(repoRoot, 'docs/office/g5g6g7/holdout/cases');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function collectHoldoutNormalizedPrompts() {
  const map = new Map();
  const files = fs
    .readdirSync(HOLDOUT_CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(HOLDOUT_CASES_DIR, file), 'utf8'));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw.cases) ? raw.cases : [];
    for (const item of list) {
      const id = item.id || file;
      const candidates = [
        item.query,
        item.prompt,
        item.query?.vi,
        item.query?.en,
        item.query_vi,
        item.query_en,
        item.prompts?.vi,
        item.prompts?.en,
      ].filter((v) => typeof v === 'string' && v.trim().length > 0);
      for (const text of candidates) {
        const norm = normalizePrompt(text);
        if (norm) map.set(norm, `${file}#${id}`);
      }
    }
  }
  return map;
}

describe('G6-08 synthetic dev set & guard', () => {
  it('has a Vietnamese README.md with > **Trạng thái:** header', () => {
    const readmePath = path.join(repoRoot, DEVSET_README_PATH);
    assert.ok(fs.existsSync(readmePath), `missing ${DEVSET_README_PATH}`);
    const readme = fs.readFileSync(readmePath, 'utf8');
    assert.match(readme, /^> \*\*Trạng thái:\*\*/m);
    assert.match(readme, /docs\/office\/g5g6g7\/holdout\//);
  });

  it('has deterministic synthetic XLSX and DOCX fixtures matching manifest.json', () => {
    assert.ok(fs.existsSync(path.join(repoRoot, DEVSET_FIXTURES_DIR)));
    const generated = buildDevFixtures();
    const diskManifest = fs.readFileSync(path.join(repoRoot, DEVSET_MANIFEST_PATH), 'utf8');
    assert.equal(diskManifest, generated.manifestText, 'manifest.json out of sync with devset.mjs');
    for (const f of generated.fixtures) {
      const diskBytes = fs.readFileSync(path.join(repoRoot, f.path));
      assert.equal(sha256(diskBytes), f.sha256, `${f.path} sha256 mismatch`);
      const diskOracle = fs.readFileSync(path.join(repoRoot, f.oraclePath), 'utf8');
      assert.equal(diskOracle, f.oracleText, `${f.oraclePath} oracle text mismatch`);
    }
  });

  it('validates devset cases.json schema, categories, secret scan, and holdout prompt disjointness', () => {
    assert.ok(fs.existsSync(path.join(repoRoot, DEVSET_CASES_PATH)), `missing ${DEVSET_CASES_PATH}`);
    const { manifest, cases, byModule, REQUIRED_CATEGORIES } = loadDevSet(repoRoot);
    assert.ok(
      cases.length >= 16 && cases.length <= 24,
      `expected 16..24 cases in ${DEVSET_CASES_PATH}, got ${cases.length}`,
    );

    const fixtureMap = new Map(manifest.fixtures.map((f) => [f.id, f]));
    const holdoutPrompts = collectHoldoutNormalizedPrompts();
    assert.ok(holdoutPrompts.size > 0, 'expected non-empty holdout prompts set');

    const errors = [];
    const seenIds = new Set();
    const pairLangs = new Map();
    const categories = new Set();
    const formats = new Set();

    for (const c of cases) {
      if (seenIds.has(c.id)) {
        errors.push(`duplicate case id ${c.id}`);
      }
      seenIds.add(c.id);
      errors.push(...validateDevCase(c, byModule, fixtureMap));
      categories.add(c.category);
      formats.add(c.format);

      if (c.pairId) {
        if (!pairLangs.has(c.pairId)) pairLangs.set(c.pairId, new Set());
        pairLangs.get(c.pairId).add(c.lang);
      }

      const norm = normalizePrompt(c.prompt);
      if (holdoutPrompts.has(norm)) {
        errors.push(
          `case ${c.id} prompt (${c.lang}) equals holdout prompt in ${holdoutPrompts.get(norm)}`,
        );
      }
    }

    for (const [pairId, langs] of pairLangs.entries()) {
      if (!langs.has('vi') || !langs.has('en')) {
        errors.push(`pairId ${pairId} must include both vi and en cases (got ${[...langs].join(',')})`);
      }
    }

    for (const reqCat of REQUIRED_CATEGORIES) {
      if (!categories.has(reqCat)) {
        errors.push(`missing required category "${reqCat}"`);
      }
    }
    if (!formats.has('xlsx') || !formats.has('docx')) {
      errors.push('devset must include both xlsx and docx formats');
    }

    // Secret scan across all text files in docs/office/g5g6g7/devset
    const devsetAbs = path.join(repoRoot, DEVSET_DIR);
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(?:json|md|txt)$/i.test(entry.name)) {
          const rel = path.relative(repoRoot, full);
          const content = fs.readFileSync(full, 'utf8');
          errors.push(...scanForSecrets(content, rel));
        }
      }
    };
    walk(devsetAbs);

    assert.deepEqual(errors, [], `dev set validation failed:\n${errors.join('\n')}`);
  });

  it('detects secret-looking values (IPv4, http(s)://host:port, sk-... key prefix)', () => {
    assert.deepEqual(scanForSecrets('normal Vietnamese text 1.250,5 đồng', 'clean'), []);
    const fakeIp = ['198', '51', '100', '42'].join('.');
    const fakeUrl = `${'http://example-upstream.internal'}:${'8080'}/${'v1'}`;
    const fakeKey = `${'sk'}-${'proj1234567890abcdefghijklmnop'}`;
    assert.ok(
      scanForSecrets(`connect to ${fakeIp} now`, 'ip').some((s) => s.includes('IPv4')),
    );
    assert.ok(
      scanForSecrets(`endpoint ${fakeUrl}`, 'url').some((s) =>
        s.includes('host:port'),
      ),
    );
    assert.ok(
      scanForSecrets(`token ${fakeKey}`, 'key').some((s) =>
        s.includes('key-like'),
      ),
    );
  });

  it('normalizes prompts consistently and scores oracle criteria deterministically', () => {
    assert.equal(normalizePrompt('  Tính   TỔNG: (X * Y) - Z?! '), 'tinh tong x y z');
    const { cases } = loadDevSet(repoRoot);
    const sample = cases[0];
    const passRes = scoreDevCase(sample, {
      answerText:
        'Trên trang Bán hàng T1, tổng dòng hiển thị là 51.300, dòng ẩn BH-105 là 9.720 và tổng toàn bộ là 61.020.',
      toolCalls: [{ name: 'read_range', input: {}, output: {} }],
      writes: 0,
    });
    assert.equal(passRes.passed, true);

    const failAllowlist = scoreDevCase(sample, {
      answerText: '51300 61020 9720 BH-105',
      toolCalls: [
        { name: 'read_range', input: {}, output: {} },
        { name: 'nonexistent_tool', input: {}, output: {} },
      ],
      writes: 0,
    });
    assert.equal(failAllowlist.passed, false);
  });
});
