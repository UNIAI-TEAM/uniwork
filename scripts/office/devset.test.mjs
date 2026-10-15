import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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
  extractConclusionPart,
  isForbiddenTokenClaimed,
  loadDevSet,
  normalizePrompt,
  scanForSecrets,
  scoreDevCase,
  validateDevCase,
} from './devset.mjs';
import {
  assertPanelHarnessFilesystem,
  setupPanelHarnessLinks,
  snapshotGenofficeDir,
  summarizeRunResults,
} from './devset-run.mjs';
import {
  RUNS_DIR,
  checkReport,
  loadRun,
  rescoreRuns,
  runFiles,
  validateRunJson,
} from './devset-report.mjs';

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

    const summary = summarizeRunResults([
      {
        id: 'DV-XLSX-001',
        lang: 'vi',
        format: 'xlsx',
        passed: true,
        outsideAllowlist: [],
        latenciesMs: { model: 120, tool: 5, endToEnd: 130 },
      },
      {
        id: 'DV-DOCX-002',
        lang: 'en',
        format: 'docx',
        passed: false,
        outsideAllowlist: [],
        latenciesMs: { model: 200, tool: 8, endToEnd: 215 },
      },
    ]);
    assert.equal(summary.total, 2);
    assert.equal(summary.passed, 1);
    assert.equal(summary.outsideAllowlistTotal, 0);
  });

  it('verifies office_uniwork_ai@2 goldens obey the tool allowlist and contain no dev-set case answers', async () => {
    const { PACK_MODULES, TOOLS_DOC, auditCommon, auditSection, parseMechanicalTable } =
      await import('./instruction-pack-tools.mjs');
    const toolsDoc = fs.readFileSync(path.join(repoRoot, TOOLS_DOC), 'utf8');
    const { byModule } = parseMechanicalTable(toolsDoc);
    const v2File = (sec) => `server/internal/ai/testdata/office_uniwork_ai_v2_${sec}.golden`;
    const commonText = fs.readFileSync(path.join(repoRoot, v2File('common')), 'utf8');
    const findings = [...auditCommon({ file: v2File('common'), text: commonText, byModule })];
    const allTexts = [commonText];
    for (const mod of PACK_MODULES) {
      const txt = fs.readFileSync(path.join(repoRoot, v2File(mod)), 'utf8');
      allTexts.push(txt);
      findings.push(
        ...auditSection({ section: mod, file: v2File(mod), text: txt, tools: byModule.get(mod) }),
      );
    }
    assert.deepEqual(
      findings.map((f) => f.message),
      [],
      `v2 instruction-pack tool-name violation(s)`,
    );

    const combinedPack = allTexts.join('\n');
    const forbiddenAnswers = [
      '51300',
      '61020',
      '9720',
      '5070',
      '1014',
      '99999',
      '88888',
      '3200.756',
      '1450.244',
      '3201',
      '1450',
      '4651',
      '23400',
      '14400',
      '24120',
      '13500',
      'BH-101',
      'BH-102',
      'BH-105',
      'BH-106',
      '20 tháng 11',
      '25 tháng 11',
      '150 nhân viên',
      'ba buổi tập huấn',
    ];
    for (const ans of forbiddenAnswers) {
      assert.equal(
        combinedPack.includes(ans),
        false,
        `office_uniwork_ai@2 pack text must not contain dev-set answer "${ans}"`,
      );
    }
  });

  it('enforces negative oracles on DV-XLSX-005..008 (error cell replaced by 0 and stale cache reported as result fail)', () => {
    const { cases } = loadDevSet(repoRoot);
    const byId = new Map(cases.map((c) => [c.id, c]));
    const tools = [{ name: 'read_range', input: {}, output: {} }];

    // DV-XLSX-005 (vi, error_cell): good answer passes, answer replacing error cell by 0 fails
    const c5 = byId.get('DV-XLSX-005');
    assert.equal(
      scoreDevCase(c5, {
        answerText:
          'Kết quả: Trung bình cộng Đơn giá sau CK của 5 dòng hợp lệ H2:H6 là 1.014 (tổng 5.070 / 5 dòng).\nPhạm vi: Dòng BH-106 có H7 = #DIV/0! và I7 = #N/A được bỏ qua, tuyệt đối không thay bằng 0.',
        toolCalls: tools,
        writes: 0,
      }).passed,
      true,
    );
    assert.equal(
      scoreDevCase(c5, {
        answerText:
          'Kết quả: Trên dòng BH-106, ô H7 (#DIV/0!) và I7 (#N/A) được thay bằng H7 = 0 nên trung bình cộng là 845 (trong khi 5 dòng hợp lệ có tổng 5070 và trung bình 1014).',
        toolCalls: tools,
        writes: 0,
      }).passed,
      false,
    );

    // DV-XLSX-006 (en, error_cell): good answer passes, answer substituting 0 for error cell fails
    const c6 = byId.get('DV-XLSX-006');
    assert.equal(
      scoreDevCase(c6, {
        answerText:
          'Result: Across the 5 valid cells H2:H6 (sum 5,070), the average of Đơn giá sau CK is 1,014.\nScope: On row BH-106, cell H7 has #DIV/0! and cell I7 has #N/A; neither error cell is replaced by 0.',
        toolCalls: tools,
        writes: 0,
      }).passed,
      true,
    );
    assert.equal(
      scoreDevCase(c6, {
        answerText:
          'Result: On row BH-106, H7 (#DIV/0!) and I7 (#N/A) are set to H7 = 0, giving an average of 845 across 6 rows (valid 5-row sum 5070, average 1014).',
        toolCalls: tools,
        writes: 0,
      }).passed,
      false,
    );

    // DV-XLSX-007 (vi, stale_cache): good answer passes, answer reporting stale cached 99999 as the result fails
    const c7 = byId.get('DV-XLSX-007');
    assert.equal(
      scoreDevCase(c7, {
        answerText:
          'Kết quả: Giá trị tích thực tế B*C cho cả hai dòng 2 và 3 là 10.000 (2.500 × 4).\nPhạm vi: Trên trang Kiểm toán, ô D2 (=LEGACYCACHE(B2,C2)) lưu giá trị cache cũ 99999 chưa được tính lại (NOT RECALCULATED, #NAME?) và D3 lưu cache cũ 88888 nên không được dùng làm kết quả chính thức.',
        toolCalls: tools,
        writes: 0,
      }).passed,
      true,
    );
    assert.equal(
      scoreDevCase(c7, {
        answerText:
          'Kết quả: D2 = 99999 là kết quả từ bộ nhớ đệm cache của hàm LEGACYCACHE(B2,C2), còn D3 = 10000.',
        toolCalls: tools,
        writes: 0,
      }).passed,
      false,
    );

    // DV-XLSX-008 (en, stale_cache): good answer passes, answer reporting stale cached 99999 as the result fails
    const c8 = byId.get('DV-XLSX-008');
    assert.equal(
      scoreDevCase(c8, {
        answerText:
          'Result: The true product B*C for both rows 2 and 3 is 10,000 (2,500 × 4).\nScope: On sheet Kiểm toán, cell D2 (=LEGACYCACHE(B2,C2)) holds the stale cached value 99999 (NOT RECALCULATED, #NAME?) and D3 holds stale cached 88888, which must not be used as verified results.',
        toolCalls: tools,
        writes: 0,
      }).passed,
      true,
    );
    assert.equal(
      scoreDevCase(c8, {
        answerText:
          'Result: D2 = 99999 is the result from the cached LEGACYCACHE formula (while B3*C3 = 10000).',
        toolCalls: tools,
        writes: 0,
      }).passed,
      false,
    );

    // BE68-G2-1: the five phrasings from review-be-g6-08-2 (Unicode labels such as "Đáp án"/"Giá trị … là"
    // and sentences carrying caveat words like "cache" or "#DIV/0!" inside the result region without
    // negating/disqualifying the cached or 0-substituted value) must all FAIL.
    const reviewBadCases = [
      [
        c7,
        'Đáp án: 99.999 theo cache cũ của LEGACYCACHE(B2,C2). Tích thực tế B2*C2 = 10000.',
      ],
      [
        c7,
        'Đáp án là 99999 theo cache của LEGACYCACHE. Tích thực tế B2*C2 = 10000.',
      ],
      [
        c8,
        'D2 holds 99999 from the cached LEGACYCACHE; the true product B*C is 10000.',
      ],
      [
        c5,
        'Đáp án: 845 (coi H7 = #DIV/0! là 0). Dòng BH-106 có I7 = #N/A; 5 dòng hợp lệ: tổng 5070, trung bình 1014.',
      ],
      [
        c7,
        'Giá trị D2 là 99999 theo cache của LEGACYCACHE(B2,C2); tích thực tế B2*C2 = 10000.',
      ],
    ];
    for (const [caseSpec, badAnswer] of reviewBadCases) {
      const scored = scoreDevCase(caseSpec, {
        answerText: badAnswer,
        toolCalls: tools,
        writes: 0,
      });
      assert.equal(
        scored.passed,
        false,
        `expected ${caseSpec.id} to FAIL on "${badAnswer}", got PASS (score=${scored.score})`,
      );
    }

    // LEAD NOTE 01:22Z: stored DV-XLSX-007/008 answers in run-v1 and run-v2 and mentions marked
    // as cache/stale/not verified/không được dùng inside the result region must PASS.
    const storedAndDisqualifiedGoodCases = [
      [
        c7,
        'Kết quả: Không được dùng giá trị cache cũ `99999` hoặc `88888` làm kết quả chính thức vì đó là các giá trị đã lưu nhưng **chưa được tính lại**.\n\n- `D2 =LEGACYCACHE(B2,C2)`: cache cũ là `99999`, nhưng hàm `LEGACYCACHE` không được bộ tính hỗ trợ nên công thức trả về `#NAME?`. Tích thực tế `B2*C2 = 2500*4 = 10000`.\n- `D3 =B3*C3`: cache cũ trong tệp là `88888`, nhưng sau khi tính lại công thức cho kết',
      ],
      [
        c8,
        'The cached values **99999** in D2 and **88888** in D3 are not verified results. D2’s `LEGACYCACHE` function is unsupported, so it was not recalculated and returns `#NAME?`. D3’s formula `=B3*C3` was recalculated, giving **10000**; its old cache is stale. The product **B*C** is **2500 × 4 = 10000** for both rows.\n\nScope: sheet “Kiểm toán,” cells D2:D3 and inputs B2:C3.',
      ],
      [
        c7,
        'Kết quả tích thực tế B*C là **10.000** cho cả D2 và D3.\n\n- **D2:** `=LEGACYCACHE(B2,C2)` không được bộ tính công thức hỗ trợ; kết quả hiện là `#NAME?` và công thức không được tính lại. Vì vậy, `99999` chỉ là giá trị cache cũ trong tệp, không phải kết quả chính thức.\n- **D3:** `=B3*C3` được tính lại thành `10000`. Giá trị cache cũ `88888` đã lỗi thời, nên không được dùng thay cho kết quả đã tính lạ',
      ],
      [
        c8,
        'The stale cached values **99999** and **88888** must not be used as verified results because they are stored file caches marked **NOT RECALCULATED**. They may reflect an earlier calculation rather than the current inputs.\n\n- **D2**: `=LEGACYCACHE(B2,C2)` is unsupported and returns `#NAME?`; its cached value **99999** is therefore not verified. The true product **B2*C2 = 10000**.\n- **D3**: `=B3*C3`',
      ],
      [
        c7,
        'Cache cũ của D2 (LEGACYCACHE) là 99999 (chưa được tính lại, không được dùng); tích thực tế B2*C2 = 10000.',
      ],
      [
        c8,
        'The cached value in D2 (LEGACYCACHE) is 99999 (stale, not verified); the true product B*C is 10000.',
      ],
    ];
    for (const [caseSpec, goodAnswer] of storedAndDisqualifiedGoodCases) {
      const scored = scoreDevCase(caseSpec, {
        answerText: goodAnswer,
        toolCalls: tools,
        writes: 0,
      });
      assert.equal(
        scored.passed,
        true,
        `expected ${caseSpec.id} to PASS on "${goodAnswer}", got FAIL (${JSON.stringify(scored.checks.filter((c) => !c.passed))})`,
      );
    }

    assert.equal(isForbiddenTokenClaimed('Đáp án: 99.999 theo cache cũ của LEGACYCACHE(B2,C2).', '99.999'), true);
    assert.equal(isForbiddenTokenClaimed('= 99999', '99999'), true);
    assert.equal(
      isForbiddenTokenClaimed('Kết quả: Không được dùng giá trị cache cũ 99999 hoặc 88888 làm kết quả chính thức.', '99999'),
      false,
    );
    assert.equal(
      isForbiddenTokenClaimed('The cached values 99999 in D2 and 88888 in D3 are not verified results.', '99999'),
      false,
    );

    assert.equal(
      extractConclusionPart('Đáp án: 10.000.\nPhạm vi: D2 lưu cache cũ 99999.'),
      'Đáp án: 10.000.',
    );
    assert.equal(
      extractConclusionPart('Result: 10,000.\nScope: D2 holds stale cached 99999.'),
      'Result: 10,000.',
    );
    assert.equal(
      extractConclusionPart('Giá trị thực là 10.000.\nGhi chú: không dùng 99999.'),
      'Giá trị thực là 10.000.',
    );
    assert.equal(
      extractConclusionPart('The true product is 10,000.\nNote: cached 99999 ignored.'),
      'The true product is 10,000.',
    );
    assert.equal(
      extractConclusionPart('Đáp án: 99.999 theo cache cũ của LEGACYCACHE(B2,C2).'),
      'Đáp án: 99.999 theo cache cũ của LEGACYCACHE(B2,C2).',
    );
  });
});

describe('G6-08 committed dev-set runs & report tables (BE68-5)', () => {
  it('commits one valid, secret-free run JSON per pack version and keeps the report tables computed from them', () => {
    const found = runFiles(repoRoot);
    assert.ok(
      found.v1 && found.v2,
      `${RUNS_DIR} must hold run-v1-<sha>.json and run-v2-<sha>.json (found: ${
        Object.keys(found).join(', ') || 'none'
      })`,
    );
    const v1 = loadRun(repoRoot, found.v1.file);
    const v2 = loadRun(repoRoot, found.v2.file);

    assert.equal(v1.promptId, 'office_uniwork_ai@1', 'run-v1 is the @1 baseline');
    assert.equal(v2.promptId, 'office_uniwork_ai@2', 'run-v2 is the @2 pack');
    assert.equal(v1.serverSha, found.v1.sha, 'the run-v1 file name must name the server commit it ran against');
    assert.equal(v2.serverSha, found.v2.sha, 'the run-v2 file name must name the server commit it ran against');

    for (const [file, run] of [
      [found.v1.file, v1],
      [found.v2.file, v2],
    ]) {
      assert.deepEqual(validateRunJson(run, file), [], `${file} does not match the run schema`);
      assert.deepEqual(scanForSecrets(JSON.stringify(run), file), [], `${file} carries a secret-looking value`);
      assert.equal(run.cases.length, 20, `${file} must hold all 20 dev-set cases`);
      assert.equal(run.outsideAllowlistTotal, 0, `${file} ran a tool outside the module allowlist`);
      assert.equal(run.panelProofs?.length, 4, `${file} must hold the four panel combinations`);
      for (const p of run.panelProofs ?? []) {
        assert.equal(p.facadeRouteCalled, true, `${file}: panel run ${p.caseId} never reached the façade`);
        assert.equal(p.allAuthBearer, true, `${file}: panel run ${p.caseId} called without a bearer frame token`);
      }
    }

    assert.deepEqual(
      rescoreRuns(repoRoot, { write: false }).changed,
      [],
      'committed run JSONs must match current scoreDevCase (node scripts/office/devset-report.mjs --rescore)',
    );

    assert.deepEqual(
      checkReport(repoRoot),
      [],
      'docs/office/g5g6g7/g6-08-devset-report.md tables must be computed from the run JSONs (node scripts/office/devset-report.mjs --write)',
    );
  });

  it('asserts on the filesystem that panel harness links resolve inside harnessDir and <fork>/node_modules/@genoffice is unchanged (BE68-G2-5)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g608-harness-fs-'));
    try {
      const fakeFork = path.join(tmpRoot, 'fork');
      const fakeHarness = path.join(tmpRoot, 'harness');
      fs.mkdirSync(path.join(fakeFork, 'packages', 'ui'), { recursive: true });
      fs.mkdirSync(path.join(fakeFork, 'apps', 'docs'), { recursive: true });
      fs.mkdirSync(path.join(fakeFork, 'node_modules', 'vite'), { recursive: true });
      fs.mkdirSync(path.join(fakeFork, 'node_modules', '@genoffice'), { recursive: true });
      fs.symlinkSync(
        path.join(fakeFork, 'packages', 'ui'),
        path.join(fakeFork, 'node_modules', '@genoffice', 'ui'),
      );

      const beforeEntries = snapshotGenofficeDir(fakeFork);
      const res = setupPanelHarnessLinks(fakeFork, fakeHarness);
      const afterEntries = snapshotGenofficeDir(fakeFork);

      assert.deepEqual(afterEntries, beforeEntries, '<fork>/node_modules/@genoffice must be unchanged');
      assert.deepEqual(res.genEntries, ['docs', 'ui']);
      for (const name of ['docs', 'ui']) {
        const linkPath = path.join(fakeHarness, 'node_modules', '@genoffice', name);
        assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
        assert.equal(linkPath.startsWith(fakeHarness + path.sep), true);
      }

      // A mutation inside <fork>/node_modules/@genoffice (which git status cannot see) must fail the assertion.
      fs.symlinkSync(
        path.join(fakeFork, 'apps', 'docs'),
        path.join(fakeFork, 'node_modules', '@genoffice', 'docs'),
      );
      assert.throws(
        () => assertPanelHarnessFilesystem(fakeFork, fakeHarness, beforeEntries),
        /fork node_modules\/@genoffice was modified/,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});


