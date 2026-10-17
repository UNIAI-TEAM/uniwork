// Answer adapter v1 for the G7-12 holdout runner (UNI-1384): turns one ask (the model's reply, its tool trace and the
// backend's write count) into the answer shape holdout-score.mjs grades.
//
// The scorer wants named numbers, anchored items, a write count and a list of abstract operations; a model gives free
// text. The adapter closes that gap with rules that never read a case's expected outcome to the model:
//   - the reply carries one machine-readable line, UNIWORK_ANSWER <json>, whose format is the same for every case
//     (reportingFooter below); it never lists a slot, a kind or an anchor of a case, so it cannot hint at a refusal,
//     a clarification or a number;
//   - numbers: the figures the line reports are matched to the expected numeric items by value (tolerance and rounding
//     of the case); a figure that matches nothing is an extra and fails the ask under the default "strict" policy;
//   - cell/formula/heading/table_cell/count items: matched by kind, value AND the scorer's own anchor rule (identity for
//     cell/formula/table_cell), so a right value at another anchor fails (`--anchors strict`, the default); `--anchors
//     lenient` opts into value-first matching and counts every ask it rescued (`anchorLenient`), which makes a signed
//     verdict INCONCLUSIVE;
//   - an edit case (it expects writes) is scored from what the write tool was actually given: a cell the reply claims
//     is credited only when an applied write's arguments carry its value or cover its address (`writeBacked`), so a
//     claimed edit that was never proposed fails; items the arguments cannot prove stay self-reported and are counted;
//   - the prose and the reporting line are compared: a figure of the line that the prose never states is flagged per ask
//     (`proseFigureMismatch`), counted by the report, never a pass or a failure by itself;
//   - clarification / refusal / not_found / caveat items are observed behaviour: ask_clarification was called, the line
//     says refused / not_found, or it lists a caveat. They carry a neutral value, never the case's reference text;
//   - writes come from the backend (calls it let through), tools.used from the mapped operations of the calls, plus the
//     raw name of any tool that is not mapped or was dropped by the façade (the scorer fails a name outside the list);
//     `refuse` counts as used only when the case's allowlist has it (a refusal is a reply, not a call), and in a module
//     with no compute tool (everything but sheets) `compute` counts as used when the reply reported a figure.
// A reply without the line (or with an invalid one) reports nothing, so the scorer fails it closed; `reportStatus`
// keeps that protocol failure apart from a wrong answer.

import { anchorMatches, normalizeAnchor, splitAnchor, toNumber, valuesEqual } from './holdout-score.mjs';
import { WRITE_OPERATIONS, opsOfTool } from './holdout-backend.mjs';
import { cellProof, contentfulWrites, introducesNew, parseRangeText, percentFormatProof, presentInSource, valueInWrites } from './holdout-write-proof.mjs';

export const ANSWER_MARKER = 'UNIWORK_ANSWER';
const VALUE_KINDS = new Set(['cell', 'formula', 'heading', 'table_cell', 'count']);

export function reportingFooter() {
  return [
    '',
    '---',
    'Reporting contract for the evaluation harness. Answer the question normally first.',
    `End your reply with one last line, exactly: ${ANSWER_MARKER} <json>`,
    'where <json> is {"numbers":[],"items":[{"kind":"cell|formula|heading|table_cell|count","anchor":"","value":""}],"refused":false,"not_found":false,"caveats":[]}',
    '- numbers: only the final figures your reply gives as the answer, as plain numbers without units or thousands separators (percentages in percent units).',
    '- items: each cell, formula, heading, table cell or count your reply names as a result, with its location and exact value.',
    '- refused: true only if you decline the request.',
    '- not_found: true only if the requested fact is not in the document.',
    '- caveats: each limit or assumption your reply states.',
  ].join('\n');
}

/** Splits a reply into its visible text and the parsed reporting line: { text, status: ok|missing|invalid, report }. */
export function parseReport(reply) {
  const text = String(reply ?? '');
  const at = text.lastIndexOf(ANSWER_MARKER);
  if (at < 0) return { text: text.trim(), status: 'missing', report: null };
  const visible = text.slice(0, at).replace(/`+\s*$/, '').trim();
  const rest = text.slice(at + ANSWER_MARKER.length);
  const open = rest.indexOf('{');
  const close = rest.lastIndexOf('}');
  if (open < 0 || close < open) return { text: visible, status: 'invalid', report: null };
  try {
    const report = JSON.parse(rest.slice(open, close + 1));
    if (report === null || typeof report !== 'object' || Array.isArray(report)) throw new Error('not an object');
    return { text: visible, status: 'ok', report };
  } catch {
    return { text: visible, status: 'invalid', report: null };
  }
}

const roundTo = (value, rounding) => {
  if (rounding === '0dp') return Math.round(value);
  if (rounding === '2dp') return Math.round(value * 100) / 100;
  return value;
};

const sameValue = (a, b, kind = null) => valuesEqual(b, a, kind);
const norm = (anchor) => normalizeAnchor(anchor ?? '');

/** Matches the reported figures to the expected numeric items; returns { numeric, extras }. */
function matchNumbers(expected, figures) {
  const free = figures.map((value, i) => ({ value, i, n: toNumber(value) })).filter((f) => f.n !== null);
  const numeric = {};
  for (const item of expected) {
    const within = (f) => Math.abs(roundTo(f.n, item.rounding) - item.value) <= item.tolerance + 1e-9;
    let pick = free.find(within);
    if (!pick && free.length > 0) pick = [...free].sort((a, b) => Math.abs(a.n - item.value) - Math.abs(b.n - item.value))[0];
    if (!pick) continue;
    free.splice(free.indexOf(pick), 1);
    numeric[item.name] = pick.value;
  }
  return { numeric, extras: free.map((f) => f.value) };
}

const NUMBER_TOKEN_RE = /\d[\d.,]*\d|\d/g;

function tokenToNumber(tok) {
  if (/^[-+]?0\.\d+$/.test(String(tok).trim())) return Number(tok);
  return toNumber(tok);
}

function shownDecimalPlaces(value, n) {
  const raw = typeof value === 'string' ? value.trim().replace(/%$/, '') : String(n);
  const dot = raw.indexOf('.');
  if (dot < 0 || /[eE]/.test(raw)) return 0;
  return Math.min(10, Math.max(0, raw.length - dot - 1));
}

function matchesExactOrShownRounding(n, dp, target) {
  if (!Number.isFinite(target)) return false;
  const relTol = 1e-9 * Math.max(1, Math.abs(target));
  if (Math.abs(n - target) <= relTol) return true;
  if (dp === 0 && Number.isInteger(target)) return false;
  const factor = 10 ** dp;
  const rounded = Math.round(target * factor) / factor;
  const fixed = Number(target.toFixed(dp));
  return Math.abs(n - rounded) <= relTol || Math.abs(n - fixed) <= relTol;
}

/**
 * Checks whether an extra reported figure is traceable to the open document or tool results of the turn (DS-5):
 *   1. Exact equality (1e-9 relative), percent scaling (x100 / /100), or rounding to the precision the answer shows
 *      against a number in the turn's tool-result payloads or document text;
 *   2. Pairwise arithmetic (sum, difference, ratio, percent - no product) over two pool numbers that both appear
 *      in the answer text or items ("operands shown"), within exact-or-shown-rounding tolerance.
 * An invented number outside the pool and its shown-operand derivations returns false and fails numeric_unexpected.
 */
export function isTraceableFigure(value, pool, shownNumbers = []) {
  const n = toNumber(value);
  if (n === null) return false;
  const dp = shownDecimalPlaces(value, n);
  for (const p of pool) {
    if (!Number.isFinite(p)) continue;
    if (
      matchesExactOrShownRounding(n, dp, p) ||
      matchesExactOrShownRounding(n, dp, p * 100) ||
      matchesExactOrShownRounding(n, dp, p / 100)
    ) {
      return true;
    }
  }
  const isShownInAnswer = (p) =>
    shownNumbers.some((s) => {
      const sdp = shownDecimalPlaces(s, s);
      return (
        matchesExactOrShownRounding(s, sdp, p) ||
        matchesExactOrShownRounding(s, sdp, p * 100) ||
        matchesExactOrShownRounding(s, sdp, p / 100)
      );
    });
  const shownPool = [...new Set(pool.filter((p) => Number.isFinite(p) && isShownInAnswer(p)))];
  for (let i = 0; i < shownPool.length; i += 1) {
    const a = shownPool[i];
    for (let j = i + 1; j < shownPool.length; j += 1) {
      const b = shownPool[j];
      const candidates = [a + b, a - b, b - a];
      if (b !== 0) candidates.push(a / b, (a / b) * 100);
      if (a !== 0) candidates.push(b / a, (b / a) * 100);
      if (candidates.some((target) => matchesExactOrShownRounding(n, dp, target))) return true;
    }
  }
  return false;
}

/** Figures of the line that the prose never states (compared as numbers, so "31.337.000" and 31337000 agree). */
function proseFigureMismatch(text, figures) {
  const prose = (String(text).match(NUMBER_TOKEN_RE) ?? []).map(toNumber).filter((n) => n !== null);
  if (prose.length === 0) return [];
  const states = (f) => prose.some((p) => Math.abs(p - f) <= 1e-6 * Math.max(1, Math.abs(f)) || Math.abs(Math.round(p * 100) / 100 - f) < 1e-9 || Math.abs(p - Math.round(f)) < 1e-9);
  return figures.map(toNumber).filter((f) => f !== null && !states(f)).map(String);
}

/**
 * What the write arguments say about one reported item of an edit case (G712-16):
 *   { status: 'backed', via: 'value' | 'formula' | 'format' }  an applied write carries the value the edit introduces
 *       (a cell: ONE operation with its address and its value, G712-17; a formula at the cell only for an item that expects a formula, G712-23; a heading, table cell or pdf cell: the value in the arguments);
 *   { status: 'unbacked' }  the edit introduces the value but no applied write carries it: the item fails;
 *   { status: 'self', why: 'preserved' | 'count' | 'probe' }  the arguments cannot say: a value the document already held
 *       (an untouched heading or total, a blank left alone), a count, or a format probe other than percent. Counted and labelled.
 */
function editProof(expected, applied, sheetNames, sourceText) {
  const backed = (via) => ({ status: 'backed', via });
  const unbacked = { status: 'unbacked' };
  if (expected.kind === 'count') return { status: 'self', why: 'count' };
  const value = String(expected.value ?? '').trim();
  if (value === '') return { status: 'self', why: 'preserved' };
  const { base, probe } = splitAnchor(expected.anchor);
  if (probe) {
    if (probe === 'numberFormat' && norm(value) === 'percent') return percentFormatProof(applied, base, { sheetNames }) ? backed('format') : unbacked;
    return { status: 'self', why: 'probe' };
  }
  if (expected.kind === 'cell' || expected.kind === 'formula') {
    if (parseRangeText(base.slice(base.lastIndexOf('!') + 1)) !== null) {
      const proof = cellProof(applied, base, value, { sheetNames, expectFormula: expected.kind === 'formula' });
      // A formula at the cell backs only an item whose expectation IS a formula, and only when it equals the expected formula
      // after normalising case, spaces, `$` and the leading `=` (G712-23, G712-25); the harness cannot evaluate formulas.
      if (proof === 'formula') return expected.kind === 'formula' ? backed('formula') : unbacked;
      return proof ? backed(proof) : unbacked;
    }
    return valueInWrites(applied, value) ? backed('value') : unbacked;
  }
  if (presentInSource(sourceText, value)) return { status: 'self', why: 'preserved' };
  return valueInWrites(applied, value) ? backed('value') : unbacked;
}

/**
 * deriveAnswer(caseDoc, ask) -> { answer, adapter }.
 * ask = { reply, calls: [{name}], writes, writeLog: [{name, applied, args}], dropped: [name], modules: [module of every fixture],
 *   sheetNames: [sheet names of the open workbook, in order], sourceText: the text of the documents as opened }
 */
export function deriveAnswer(caseDoc, ask, { numbers = 'strict', computeByReply = true, anchors = 'strict' } = {}) {
  const parsed = parseReport(ask.reply);
  const report = parsed.report ?? {};
  const used = new Set();
  // An edit case needs an APPLIED write that carries content and introduces something the document did not hold, from a tool
  // that serves a required write operation: a dry run, a refused write, `{}` and a write of what is already there are none.
  const editCase = caseDoc.expected.writes > 0;
  const writeOps = caseDoc.tools.required.filter((op) => WRITE_OPERATIONS.has(op));
  const sourceText = ask.sourceText ?? '';
  const writeLog = ask.writeLog ?? [];
  const editWrites = contentfulWrites(writeLog).filter((w) => (opsOfTool(ask.modules, w.name) ?? []).some((op) => writeOps.includes(op)) && introducesNew(w.args, sourceText));
  for (const call of ask.calls) {
    const ops = opsOfTool(ask.modules, call.name);
    if (!ops) { used.add(call.name); continue; }
    const callDenied =
      Boolean(call.denied) ||
      (((ask.denied ?? []).some((d) => d.name === call.name) ||
        writeLog.some((w) => w.name === call.name && w.applied === false)) &&
        !writeLog.some((w) => w.name === call.name && w.applied));
    // A tool that serves several operations counts under those the case allows; outside all of them it counts as is.
    const inside = ops.filter((op) => caseDoc.tools.allowed.includes(op));
    for (const op of inside.length > 0 ? inside : ops) {
      if (WRITE_OPERATIONS.has(op) && callDenied) continue;
      // Any call counts for the allowlist; a required write operation counts as used only through an applied edit.
      const unproven = editCase && writeOps.includes(op) && !editWrites.some((w) => w.name === call.name);
      if (!unproven || !caseDoc.tools.allowed.includes(op)) used.add(op);
    }
  }
  for (const name of ask.dropped ?? []) used.add(name);
  const figures = Array.isArray(report.numbers) ? report.numbers : [];
  const items = (Array.isArray(report.items) ? report.items : []).filter((it) => it && typeof it === 'object');
  const forbiddenWrite = ask.writes > caseDoc.expected.writes;
  const refusalProse =
    parsed.status === 'ok' &&
    /(?:not supported|unsupported|read-only|view-only|viewer mode|viewer role|permission denied|insufficient permission|access revoked|revoked access|version conflict|newer version|stale version|conflict detected|decline|refuse|not allowed|not permitted|unauthorized|forbidden|outside the current document|another organization|cross-organization|không hỗ trợ|chưa hỗ trợ|không được phép|không có quyền|quyền xem|chỉ đọc|chỉ-đọc|từ chối|thu hồi quyền|quyền truy cập đã bị thu hồi|xung đột phiên bản|phiên bản mới hơn|đã được cập nhật bởi|ngoài phạm vi|tài liệu khác|tổ chức khác|không sửa được|không ghi được|chưa sửa|chưa áp dụng|không áp dụng|(?:cannot|can['’]t|can not|could not|couldn['’]t|unable to|will not|won['’]t|did not|do not)\s+(?:[a-z]+\s+){0,2}(?:edit|write|modify|update|change|apply|save|delete|remove|insert|replace|overwrite|set|format|freeze|perform|execute|complete|proceed|access|open|read)\b|(?:không thể|chưa thể|không|chưa)\s+(?:chỉnh sửa|sửa|ghi|cập nhật|thay đổi|áp dụng|thực hiện|lưu|xóa|thêm|chèn|thay thế|ghi đè|định dạng|cố định|truy cập|mở|đọc)\b)/i.test(parsed.text);
  const refused = !forbiddenWrite && (report.refused === true || refusalProse);
  if (refused && caseDoc.tools.allowed.includes('refuse')) used.add('refuse');
  const hasComputeTool = ask.modules.includes('sheets');
  const hasReadCall = ask.calls.some((c) => (opsOfTool(ask.modules, c.name) ?? []).some((op) => !WRITE_OPERATIONS.has(op) && op !== 'ask_clarification'));
  const showsOperands = items.length > 0 || (parsed.text.match(NUMBER_TOKEN_RE) ?? []).length >= 2;
  if (
    computeByReply &&
    figures.length > 0 &&
    caseDoc.tools.allowed.includes('compute') &&
    (!hasComputeTool || (hasReadCall && showsOperands))
  ) {
    used.add('compute');
  }
  const { numeric, extras } = matchNumbers(caseDoc.expected.numeric, figures);
  const allExpectedNumericMatched = caseDoc.expected.numeric.every((item) => {
    const actual = toNumber(numeric[item.name]);
    return actual !== null && Math.abs(roundTo(actual, item.rounding) - item.value) <= item.tolerance + 1e-9;
  });
  const hasTurnContext = Boolean(sourceText.trim() || String(ask.toolResultsText ?? '').trim());
  const pool = hasTurnContext
    ? [
        ...(sourceText.match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber),
        ...(String(ask.toolResultsText ?? '').match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber),
      ].filter((x) => x !== null)
    : [];
  const shownNumbers = [
    ...(parsed.text.match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber),
    ...items.flatMap((it) => (String(it.value ?? '').match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber)),
  ].filter((x) => x !== null);
  const strictExtras =
    numbers === 'strict'
      ? extras.filter((value) => caseDoc.expected.forbidExtraNumbers === true || !hasTurnContext || !allExpectedNumericMatched || !isTraceableFigure(value, pool, shownNumbers))
      : [];
  strictExtras.forEach((value, i) => { numeric[`extra_figure_${i + 1}`] = value; });
  const applied = writeLog.filter((w) => w.applied);
  const taken = new Set();
  const structural = [];
  const lenientAt = [];
  let writeBacked = 0;
  let writeUnbacked = 0;
  let writeSelfReported = 0;
  let writeSelfPreserved = 0;
  let writeFormula = 0;
  const asked = ask.calls.some((c) => c.name === 'ask_clarification');
  const caveats = Array.isArray(report.caveats) && report.caveats.some((c) => typeof c === 'string' && c.trim());
  for (const expected of caseDoc.expected.structural) {
    if (VALUE_KINDS.has(expected.kind)) {
      const same = items.filter((it) => it.kind === expected.kind && !taken.has(it));
      const proof = editCase ? editProof(expected, applied, ask.sheetNames ?? [], sourceText) : null;
      const atAnchor = (it) => anchorMatches(expected.kind, expected.anchor, String(it.anchor ?? ''), String(it.value ?? ''), expected.value);
      let pick = same.find((it) => sameValue(it.value, expected.value, expected.kind) && atAnchor(it));
      if (!pick && expected.kind === 'cell') {
        const freeValueItems = items.filter((it) => VALUE_KINDS.has(it.kind) && !taken.has(it));
        pick = freeValueItems.find((it) => sameValue(it.value, expected.value, 'cell') && atAnchor(it));
      }
      let lenient = false;
      if (!pick && anchors === 'lenient') {
        pick = same.find((it) => sameValue(it.value, expected.value, expected.kind)) ?? same.find((it) => norm(it.anchor) === norm(expected.anchor));
        lenient = Boolean(pick);
      }
      if (pick && proof) {
        if (proof.status === 'self') { writeSelfReported += 1; if (proof.why === 'preserved') writeSelfPreserved += 1; }
        else if (proof.status === 'unbacked') { writeUnbacked += 1; taken.add(pick); pick = undefined; lenient = false; } else { writeBacked += 1; if (proof.via === 'formula') writeFormula += 1; }
      }
      if (!pick) {
        // DS-3 (docs/office/g5g6g7/holdout/README.md §Cách chấm & §Chấm ca sửa đổi): when the turn made no write (writes = 0)
        // on a zero-write case, preserved count invariants hold by fact; when writes happened, keep today's proof rules.
        if (
          !editCase &&
          (ask.writes ?? 0) === 0 &&
          parsed.status === 'ok' &&
          expected.kind === 'count' &&
          caseDoc.category !== 'structure' &&
          /^(?:tables|paragraphs|slides|code_blocks|task_items|changed_paragraphs|changed_text_shapes|changed_text_runs|changedcells|overwrittencells)$/i.test(norm(expected.anchor))
        ) {
          structural.push({ kind: expected.kind, anchor: expected.anchor, value: String(expected.value) });
        }
        continue;
      }
      taken.add(pick);
      if (lenient) lenientAt.push(expected.kind);
      structural.push({ kind: expected.kind, anchor: expected.anchor, value: pick.value });
    } else if (
      (expected.kind === 'clarification' && asked) ||
      (expected.kind === 'refusal' && refused) ||
      (expected.kind === 'not_found' && report.not_found === true) ||
      (expected.kind === 'caveat' && caveats)
    ) {
      structural.push({ kind: expected.kind, anchor: expected.anchor, value: 'observed' });
    }
  }
  // The model's own unmatched items stay in the answer so the scorer's leak check still reads them.
  for (const it of items) if (!taken.has(it)) structural.push({ kind: String(it.kind), anchor: String(it.anchor ?? ''), value: it.value });
  const mismatch = proseFigureMismatch(parsed.text, figures);

  return {
    answer: { numeric, structural, writes: ask.writes, tools: { used: [...used] }, text: parsed.text },
    adapter: {
      reportStatus: parsed.status,
      figures: figures.length,
      extraFigures: extras.length,
      items: items.length,
      anchorLenient: lenientAt.length,
      writeBacked,
      writeUnbacked,
      writeSelfReported,
      writeSelfPreserved,
      writeFormula,
      appliedWrites: applied.length,
      editWrites: editWrites.length,
      noAppliedWrite: editCase && editWrites.length === 0,
      proseFigureMismatch: mismatch.length,
      refused: report.refused === true,
      notFound: report.not_found === true,
    },
  };
}
