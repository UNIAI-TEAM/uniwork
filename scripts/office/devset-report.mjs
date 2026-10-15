#!/usr/bin/env node
// G6-08 in-repo report tables, computed from the committed run JSONs (BE68-5).
//
//   node scripts/office/devset-report.mjs --check     fail when the report block drifts from the run files
//   node scripts/office/devset-report.mjs --write     rewrite the report block from the run files
//   node scripts/office/devset-report.mjs --print     print the block
//   node scripts/office/devset-report.mjs --rescore   re-score stored run JSONs offline with scoreDevCase (BE68-G2-1)
//
// The block lives between the markers devset-run-tables:begin / :end in
// docs/office/g5g6g7/g6-08-devset-report.md. Every number in it comes from
// docs/office/g5g6g7/devset/runs/run-v1-<sha>.json and run-v2-<sha>.json, so
// a table can never be edited by hand without --check failing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractConclusionPart, loadDevSet, scoreDevCase } from './devset.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const RUNS_DIR = 'docs/office/g5g6g7/devset/runs';
export const REPORT_PATH = 'docs/office/g5g6g7/g6-08-devset-report.md';
export const TABLES_BEGIN = '<!-- devset-run-tables:begin -->';
export const TABLES_END = '<!-- devset-run-tables:end -->';

const RUN_FILE_RE = /^run-v([12])-([0-9a-f]{7,40})\.json$/;

/** The two committed run files, v1 (baseline) and v2 (tuned), by file name. */
export function runFiles(rootDir = repoRoot) {
  const dir = path.join(rootDir, RUNS_DIR);
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const file of fs.readdirSync(dir).sort()) {
    const m = RUN_FILE_RE.exec(file);
    if (!m) continue;
    out[`v${m[1]}`] = { file, sha: m[2] };
  }
  return out;
}

export function loadRun(rootDir, file) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, RUNS_DIR, file), 'utf8'));
}

/** Schema of one run JSON; returns the list of problems (empty = valid). */
export function validateRunJson(run, file) {
  const problems = [];
  const need = (cond, msg) => {
    if (!cond) problems.push(`${file}: ${msg}`);
  };
  need(run && typeof run === 'object', 'not an object');
  if (!run || typeof run !== 'object') return problems;
  need(typeof run.date === 'string' && run.date.length > 0, 'date missing');
  need(typeof run.promptId === 'string' && run.promptId.startsWith('office_uniwork_ai@'), `promptId ${run.promptId}`);
  need(typeof run.resolvedModel === 'string' && run.resolvedModel.length > 0, 'resolvedModel missing');
  need(Number.isInteger(run.total), 'total missing');
  need(Number.isInteger(run.passed), 'passed missing');
  need(typeof run.accuracy === 'number', 'accuracy missing');
  need(Number.isInteger(run.outsideAllowlistTotal), 'outsideAllowlistTotal missing');
  for (const lang of ['vi', 'en']) {
    need(run.byLang?.[lang] && Number.isInteger(run.byLang[lang].passed), `byLang.${lang}.passed missing`);
  }
  for (const fmt of ['xlsx', 'docx']) {
    need(run.byFormat?.[fmt] && Number.isInteger(run.byFormat[fmt].passed), `byFormat.${fmt}.passed missing`);
  }
  for (const kind of ['model', 'tool', 'endToEnd']) {
    need(typeof run.latenciesMs?.[kind]?.p50 === 'number', `latenciesMs.${kind}.p50 missing`);
    need(typeof run.latenciesMs?.[kind]?.p95 === 'number', `latenciesMs.${kind}.p95 missing`);
  }
  need(Array.isArray(run.cases) && run.cases.length > 0, 'cases missing');
  for (const c of run.cases ?? []) {
    need(typeof c.id === 'string' && /^DV-(XLSX|DOCX)-\d{3}$/.test(c.id), `case id ${c.id}`);
    need(['vi', 'en'].includes(c.lang), `${c.id}: lang`);
    need(['xlsx', 'docx'].includes(c.format), `${c.id}: format`);
    need(typeof c.score === 'number', `${c.id}: score`);
    need(typeof c.passed === 'boolean', `${c.id}: passed`);
    need(typeof c.promptId === 'string' && c.promptId.startsWith('office_uniwork_ai@'), `${c.id}: promptId`);
    for (const kind of ['model', 'tool', 'endToEnd']) {
      need(typeof c.latenciesMs?.[kind] === 'number', `${c.id}: latenciesMs.${kind}`);
    }
    need(Array.isArray(c.toolCalls), `${c.id}: toolCalls`);
    need(Array.isArray(c.outsideAllowlist), `${c.id}: outsideAllowlist`);
  }
  if ('panelProofs' in run) {
    need(Array.isArray(run.panelProofs) && run.panelProofs.length === 4, 'panelProofs must hold 4 runs');
    for (const p of run.panelProofs ?? []) {
      need(p.facadeRouteCalled === true, `${p.caseId}: panel never reached the façade`);
      need(p.allAuthBearer === true, `${p.caseId}: panel call without a bearer frame token`);
      need(typeof p.score === 'number', `${p.caseId}: panel score`);
    }
  }
  return problems;
}

const pct = (passed, total) => `${(100 * (passed / total)).toFixed(1).replace('.', ',')}%`;

/** Vietnamese thousands grouping on the integer part only: 10633.5 -> 10.633,5 */
function viNumber(n) {
  const [int, frac] = String(n).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return frac ? `${grouped},${frac}` : grouped;
}
const dec1 = (n) => viNumber(Math.round(n * 10) / 10);

function delta(v1, v2) {
  if (typeof v1 !== 'number' || typeof v2 !== 'number') return '—';
  const d = Math.round((v2 - v1) * 10) / 10;
  return d === 0 ? '—' : `${d > 0 ? '+' : ''}${viNumber(d)}`;
}

function panelRows(run) {
  return (run.panelProofs ?? [])
    .map(
      (p) =>
        `| \`${p.caseId}\` | \`${p.module}\` | \`${p.lang}\` | ${p.facadeCallsCount} | ${
          p.allAuthBearer ? 'Có' : 'Không'
        } | ${p.toolCalls.length > 0 ? p.toolCalls.map((t) => `\`${t}\``).join(', ') : '—'} | ${dec1(p.score)} | ${
          p.passed ? 'PASS' : 'FAIL'
        } | ${dec1(p.endToEndMs)} |`,
    )
    .join('\n');
}

/** The report block, computed only from the two run JSONs. */
export function renderTables(v1, v2) {
  const v1Sha = v1.serverSha || 'unknown';
  const v2Sha = v2.serverSha || 'unknown';
  const caseIds = v2.cases.map((c) => c.id);
  const v1ById = new Map(v1.cases.map((c) => [c.id, c]));
  const rows = caseIds
    .map((id) => {
      const a = v1ById.get(id);
      const b = v2.cases.find((c) => c.id === id);
      const toolText = b.toolCalls.length > 0 ? b.toolCalls.map((t) => `\`${t}\``).join(', ') : '—';
      const lat = `${dec1(b.latenciesMs.model)} / ${dec1(b.latenciesMs.tool)} / ${dec1(b.latenciesMs.endToEnd)}`;
      return `| \`${id}\` | \`${b.lang}\` | \`${b.format}\` | \`${b.category}\` | ${toolText} | ${b.outsideAllowlist.length} | ${dec1(a.score)} | ${
        a.passed ? 'PASS' : 'FAIL'
      } | ${dec1(b.score)} | ${b.passed ? 'PASS' : 'FAIL'} | ${lat} |`;
    })
    .join('\n');

  const lines = [];
  lines.push(`- **@1**: \`${v1.promptId}\` dựng từ server ở commit \`${v1Sha}\`, mô hình phân giải \`${v1.resolvedModel}\`, ngày \`${v1.date}\` (tệp \`${v1.fileName}\`).`);
  lines.push(`- **@2**: \`${v2.promptId}\` dựng từ server ở commit \`${v2Sha}\`, mô hình phân giải \`${v2.resolvedModel}\`, ngày \`${v2.date}\` (tệp \`${v2.fileName}\`).`);
  lines.push('');
  lines.push('### Độ chính xác');
  lines.push('');
  lines.push('| Chỉ số | `@1` | `@2` | Thay đổi |');
  lines.push('| --- | ---: | ---: | ---: |');
  lines.push(`| Số ca đạt / tổng | ${v1.passed} / ${v1.total} | **${v2.passed} / ${v2.total}** | ${v2.passed - v1.passed >= 0 ? '+' : ''}${v2.passed - v1.passed} ca |`);
  lines.push(`| Độ chính xác tổng | ${pct(v1.passed, v1.total)} | **${pct(v2.passed, v2.total)}** | ${delta(100 * v1.passed / v1.total, 100 * v2.passed / v2.total)} điểm % |`);
  lines.push(`| Tiếng Việt (\`vi\`) | ${v1.byLang.vi.passed} / ${v1.byLang.vi.total} (${pct(v1.byLang.vi.passed, v1.byLang.vi.total)}) | **${v2.byLang.vi.passed} / ${v2.byLang.vi.total} (${pct(v2.byLang.vi.passed, v2.byLang.vi.total)})** | ${delta(100 * v1.byLang.vi.passed / v1.byLang.vi.total, 100 * v2.byLang.vi.passed / v2.byLang.vi.total)} điểm % |`);
  lines.push(`| Tiếng Anh (\`en\`) | ${v1.byLang.en.passed} / ${v1.byLang.en.total} (${pct(v1.byLang.en.passed, v1.byLang.en.total)}) | **${v2.byLang.en.passed} / ${v2.byLang.en.total} (${pct(v2.byLang.en.passed, v2.byLang.en.total)})** | ${delta(100 * v1.byLang.en.passed / v1.byLang.en.total, 100 * v2.byLang.en.passed / v2.byLang.en.total)} điểm % |`);
  lines.push(`| Bảng tính (\`xlsx\`) | ${v1.byFormat.xlsx.passed} / ${v1.byFormat.xlsx.total} (${pct(v1.byFormat.xlsx.passed, v1.byFormat.xlsx.total)}) | **${v2.byFormat.xlsx.passed} / ${v2.byFormat.xlsx.total} (${pct(v2.byFormat.xlsx.passed, v2.byFormat.xlsx.total)})** | ${delta(100 * v1.byFormat.xlsx.passed / v1.byFormat.xlsx.total, 100 * v2.byFormat.xlsx.passed / v2.byFormat.xlsx.total)} điểm % |`);
  lines.push(`| Tài liệu chữ (\`docx\`) | ${v1.byFormat.docx.passed} / ${v1.byFormat.docx.total} (${pct(v1.byFormat.docx.passed, v1.byFormat.docx.total)}) | **${v2.byFormat.docx.passed} / ${v2.byFormat.docx.total} (${pct(v2.byFormat.docx.passed, v2.byFormat.docx.total)})** | ${delta(100 * v1.byFormat.docx.passed / v1.byFormat.docx.total, 100 * v2.byFormat.docx.passed / v2.byFormat.docx.total)} điểm % |`);
  lines.push(`| Lệnh gọi ngoài allowlist | ${v1.outsideAllowlistTotal} | **${v2.outsideAllowlistTotal}** | — |`);
  lines.push('');
  lines.push('### Độ trễ (p50 / p95, ms)');
  lines.push('');
  lines.push('| Thành phần | `@1` p50 | `@1` p95 | `@2` p50 | `@2` p95 |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const kind of ['model', 'tool', 'endToEnd']) {
    lines.push(
      `| ${kind} | ${dec1(v1.latenciesMs[kind].p50)} | ${dec1(v1.latenciesMs[kind].p95)} | **${dec1(v2.latenciesMs[kind].p50)}** | **${dec1(v2.latenciesMs[kind].p95)}** |`,
    );
  }
  lines.push('');
  lines.push('### Từng ca');
  lines.push('');
  lines.push('| Mã ca | Ngôn ngữ | Định dạng | Nhóm | Công cụ đã gọi (`@2`) | Ngoài allowlist | Điểm `@1` | `@1` | Điểm `@2` | `@2` | Độ trễ `@2` model / tool / e2e (ms) |');
  lines.push('| --- | --- | --- | --- | --- | ---: | ---: | --- | ---: | --- | ---: |');
  lines.push(rows);
  lines.push('');
  lines.push('### Chạy qua giao diện bảng điều khiển (Playwright, prompt của chính ca)');
  lines.push('');
  lines.push('| Ca | Phân hệ | Ngôn ngữ | Số vòng gọi façade | Bearer `frame_token` | Công cụ đã gọi | Điểm | Kết quả | Đầu-cuối (ms) |');
  lines.push('| --- | --- | --- | ---: | --- | --- | ---: | --- | ---: |');
  lines.push(panelRows(v2));
  return lines.join('\n');
}

export function extractTablesBlock(reportText) {
  const i = reportText.indexOf(TABLES_BEGIN);
  const j = reportText.indexOf(TABLES_END);
  if (i < 0 || j < 0 || j < i) return null;
  return reportText.slice(i + TABLES_BEGIN.length, j).trim();
}

/** Problems (empty = the report block matches the run files). */
export function checkReport(rootDir = repoRoot) {
  const problems = [];
  const found = runFiles(rootDir);
  if (!found.v1 || !found.v2) {
    return [`${RUNS_DIR} must hold run-v1-<sha>.json and run-v2-<sha>.json, found ${Object.keys(found).join(', ') || 'none'}`];
  }
  const v1 = { ...loadRun(rootDir, found.v1.file), fileName: found.v1.file };
  const v2 = { ...loadRun(rootDir, found.v2.file), fileName: found.v2.file };
  problems.push(...validateRunJson(v1, found.v1.file), ...validateRunJson(v2, found.v2.file));
  const reportPath = path.join(rootDir, REPORT_PATH);
  if (!fs.existsSync(reportPath)) {
    problems.push(`missing ${REPORT_PATH}`);
    return problems;
  }
  const report = fs.readFileSync(reportPath, 'utf8');
  const block = extractTablesBlock(report);
  if (block === null) {
    problems.push(`${REPORT_PATH} has no ${TABLES_BEGIN} … ${TABLES_END} block`);
    return problems;
  }
  const want = renderTables(v1, v2);
  if (block !== want.trim()) {
    problems.push(`${REPORT_PATH} tables drifted from ${RUNS_DIR} (run devset-report.mjs --write)`);
  }
  return problems;
}

function recomputeRunAggregates(run) {
  const cases = run.cases ?? [];
  const total = cases.length;
  const passed = cases.filter((c) => c.passed).length;
  run.total = total;
  run.passed = passed;
  run.accuracy = total > 0 ? Number((passed / total).toFixed(4)) : 0;
  for (const lang of ['vi', 'en']) {
    const sub = cases.filter((c) => c.lang === lang);
    const subPassed = sub.filter((c) => c.passed).length;
    run.byLang[lang] = {
      total: sub.length,
      passed: subPassed,
      accuracy: sub.length > 0 ? Number((subPassed / sub.length).toFixed(4)) : 0,
    };
  }
  for (const fmt of ['xlsx', 'docx']) {
    const sub = cases.filter((c) => c.format === fmt);
    const subPassed = sub.filter((c) => c.passed).length;
    run.byFormat[fmt] = {
      total: sub.length,
      passed: subPassed,
      accuracy: sub.length > 0 ? Number((subPassed / sub.length).toFixed(4)) : 0,
    };
  }
}

/**
 * Offline re-scorer for committed run JSONs (BE68-G2-1).
 * Re-evaluates scoreDevCase against stored answerExcerpt on cases that carry
 * negative oracles (mustNotContainTokens) or complete un-truncated text, and
 * lists any case whose stored answerExcerpt was truncated at 400 chars without
 * guessing missing text.
 */
export function rescoreRuns(rootDir = repoRoot, { write = false } = {}) {
  const found = runFiles(rootDir);
  if (!found.v1 || !found.v2) {
    throw new Error(`need run-v1/run-v2 files in ${RUNS_DIR}`);
  }
  const { cases } = loadDevSet(rootDir);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const changed = [];
  const truncated = [];

  for (const [, info] of [
    ['v1', found.v1],
    ['v2', found.v2],
  ]) {
    const run = loadRun(rootDir, info.file);
    let fileChanged = false;

    for (const rc of run.cases ?? []) {
      const spec = byId.get(rc.id);
      if (!spec) continue;
      const excerpt = String(rc.answerExcerpt ?? '');
      const isTruncated = excerpt.length >= 400;
      const hasNegativeOracle = (spec.oracle.mustNotContainTokens ?? []).length > 0;
      const region = extractConclusionPart(excerpt);
      const hasScopeMarkerInExcerpt = region.length < excerpt.trim().length;

      if (isTruncated) {
        truncated.push({
          file: info.file,
          id: rc.id,
          hasNegativeOracle,
          hasScopeMarkerInExcerpt,
          note: hasNegativeOracle
            ? hasScopeMarkerInExcerpt
              ? 'scope marker present inside 400-char excerpt; result region before Scope is complete and not truncated'
              : 'answerExcerpt truncated at 400 chars before scope marker; 400-char result-region prefix already triggers forbid_token failure (passed=false), tail after char 400 not stored'
            : 'answerExcerpt truncated at 400 chars (case has no mustNotContainTokens checks)',
        });
      }

      if (hasNegativeOracle || (!isTruncated && !spec.oracle.paragraphEdit)) {
        const rescored = scoreDevCase(spec, {
          answerText: excerpt,
          toolCalls: (rc.toolCalls ?? []).map((name) => ({ name })),
          writes: rc.writes,
        });
        const newPassed = rescored.passed && (rc.outsideAllowlist ?? []).length === 0;
        const diffChecks = rc.checks
          .map((oldCheck, idx) => {
            const nextCheck = rescored.checks[idx];
            if (!nextCheck || oldCheck.passed === nextCheck.passed) return null;
            return `${oldCheck.id}:${oldCheck.passed}->${nextCheck.passed}`;
          })
          .filter(Boolean);

        if (diffChecks.length > 0 || rc.score !== rescored.score || rc.passed !== newPassed) {
          changed.push({
            file: info.file,
            id: rc.id,
            beforeScore: rc.score,
            afterScore: rescored.score,
            beforePassed: rc.passed,
            afterPassed: newPassed,
            diffChecks,
          });
          rc.checks = rescored.checks;
          rc.score = rescored.score;
          rc.passed = newPassed;
          fileChanged = true;
        }
      }
    }

    if (fileChanged) {
      recomputeRunAggregates(run);
      if (write) {
        fs.writeFileSync(path.join(rootDir, RUNS_DIR, info.file), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
      }
    }
  }

  return { changed, truncated };
}

function writeReportBlock(rootDir = repoRoot) {
  const found = runFiles(rootDir);
  if (!found.v1 || !found.v2) throw new Error(`need run-v1/run-v2 files in ${RUNS_DIR}`);
  const v1 = { ...loadRun(rootDir, found.v1.file), fileName: found.v1.file };
  const v2 = { ...loadRun(rootDir, found.v2.file), fileName: found.v2.file };
  const reportPath = path.join(rootDir, REPORT_PATH);
  const report = fs.readFileSync(reportPath, 'utf8');
  const i = report.indexOf(TABLES_BEGIN);
  const j = report.indexOf(TABLES_END);
  if (i < 0 || j < 0 || j < i) throw new Error(`${REPORT_PATH} has no tables block`);
  const next = `${report.slice(0, i + TABLES_BEGIN.length)}\n${renderTables(v1, v2)}\n${report.slice(j)}`;
  fs.writeFileSync(reportPath, next, 'utf8');
  return reportPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--rescore')) {
    const { changed, truncated } = rescoreRuns(repoRoot, { write: true });
    process.stdout.write(`rescored runs in ${RUNS_DIR}: ${changed.length} case(s) changed\n`);
    for (const c of changed) {
      process.stdout.write(
        `  CHANGED ${c.file} ${c.id}: passed ${c.beforePassed}->${c.afterPassed}, score ${c.beforeScore}->${c.afterScore} [${c.diffChecks.join(', ')}]\n`,
      );
    }
    for (const t of truncated) {
      process.stdout.write(`  TRUNCATED ${t.file} ${t.id}: ${t.note}\n`);
    }
  } else if (argv.includes('--check')) {
    const problems = checkReport(repoRoot);
    if (problems.length > 0) {
      process.stderr.write(`devset report check failed:\n${problems.join('\n')}\n`);
      process.exit(1);
    }
    process.stdout.write(`devset report block matches ${RUNS_DIR}\n`);
  } else if (argv.includes('--write')) {
    process.stdout.write(`rewrote ${writeReportBlock(repoRoot)}\n`);
  } else if (argv.includes('--print')) {
    const found = runFiles(repoRoot);
    const v1 = loadRun(repoRoot, found.v1.file);
    const v2 = loadRun(repoRoot, found.v2.file);
    process.stdout.write(`${renderTables(v1, v2)}\n`);
  } else {
    process.stderr.write('usage: node scripts/office/devset-report.mjs --check|--write|--print|--rescore\n');
    process.exit(2);
  }
}
