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
import { cellProof, configOpProof, contentfulWrites, introducesNew, parseRangeText, percentFormatProof, presentInSource, valueInWrites } from './holdout-write-proof.mjs';

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

// A cell or range address inside one word of the reply ("Sheet!A1", "A1:G7", "$B$2", and a label like "Q1"), a date
// ("2026-10-17", "17/10/2026") and a section/list locator word ("slide 3", "dòng 7", "mục 2"). Digits that belong to
// one of these are not quantity claims (review-g712-16 A7).
const ADDRESS_WORD_RE = /[A-Za-z]{1,3}\$?\d+/;
const DATE_WORD_RE = /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/;
const LOCATOR_WORD_RE = /(?:slide|page|trang|row|line|hàng|dòng|ô|cell|section|mục|chương|quý|quarter|step|bước|khu vực|table|bảng|biểu đồ|chart|phần|item)\s*$/i;
const QUOTE_CHARS = /["“”„«»]/g;

/** The word (whitespace-delimited run) that holds the token at [start, end). */
function wordAround(text, start, end) {
  let i = start;
  while (i > 0 && !/\s/.test(text[i - 1])) i -= 1;
  let j = end;
  while (j < text.length && !/\s/.test(text[j])) j += 1;
  return { word: text.slice(i, j), before: text.slice(0, i), after: text.slice(j) };
}

/**
 * The numbers the reply states in prose that are quantity claims (review-g712-16 A7). A prose figure is a claim like a
 * reported number, so it must be reported or traceable; only tokens that are clearly not quantities are exempt: a
 * cell/range address or a label like "Q1", a date (and a year inside one), a locator/ordinal of a list or section
 * marker, and digits that belong to quoted document text.
 */
export function proseQuantityTokens(text) {
  const out = [];
  for (const match of String(text).matchAll(NUMBER_TOKEN_RE)) {
    const tok = match[0];
    const { word, before, after } = wordAround(String(text), match.index, match.index + tok.length);
    if (ADDRESS_WORD_RE.test(word) || DATE_WORD_RE.test(word)) continue;
    if (LOCATOR_WORD_RE.test(before.trimEnd())) continue;
    // A list marker: the token starts a line and is followed by "." or ")" ("1. Bắc", "2) Nam").
    if (/^[.)]/.test(after) && /\n\s*$/.test(before)) continue;
    // Inside quoted document text: an odd number of quote characters before it opens a quotation that this digit sits in.
    if (((before.match(QUOTE_CHARS) ?? []).length % 2) === 1) continue;
    out.push(tok);
  }
  return out;
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
  // Refusal prose (review-g712-16 A6): a bare permission/scope term ("another organization", "read-only", "viewer
  // role", "not supported") is not a refusal on its own — an answer may mention it incidentally. The reply must tie a
  // negation to the requested action (first person or impersonal), e.g. "I could not edit", "cannot write",
  // "is not allowed", "không ghi được". This is the narrowed requirement the round-b fix left open. A Vietnamese verb
  // ends in a non-ASCII letter, so the boundary after a verb is a letter lookahead, never \b.
  const refusalProse =
    parsed.status === 'ok' &&
    /(?:cannot|can['’]t|can not|could not|couldn['’]t|unable to|will not|won['’]t|did not|didn['’]t|do not|does not|don['’]t|is not|are not|was not|were not|not able to)\s+(?:[a-z]+\s+){0,3}(?:edit|write|modify|update|change|apply|save|delete|remove|insert|replace|overwrite|set|format|freeze|perform|execute|complete|proceed|access|open|read|allow|permit|support|create|add|design|translate|rename|move|fetch|load|download|connect|call)\b|(?:is|are|was|were|has|have|had)\s+not\s+(?:allowed|permitted|supported|possible|available)|(?:not|never)\s+(?:allowed|permitted|supported|possible)|(?:không thể|chưa thể|không|chưa|chẳng)\s+(?:[\p{L}]+\s+){0,4}(?:chỉnh sửa|sửa|ghi đè|ghi|thay thế|thay đổi|thay|cập nhật|áp dụng|thực hiện|lưu|xóa|thêm|chèn|định dạng|cố định|truy cập|mở|đọc|lấy|tải|kết nối|gọi|chạy|dùng|đặt|tạo|thiết kế|dịch|đổi|hỗ trợ|cho phép|xuất|in)(?!\p{L})/iu.test(parsed.text);
  const refused = !forbiddenWrite && (report.refused === true || refusalProse);
  if (refused && caseDoc.tools.allowed.includes('refuse')) used.add('refuse');
  const hasComputeTool = ask.modules.includes('sheets');
  // A4: compute credit needs operands a READ in this turn returned AND the answer shows. An orientation call
  // (read_sheet_list/read_document) or an unrelated item is not operand evidence, and neither is a figure that no read
  // returned. `figures` and `items` are read here, before the numeric matching below.
  const readCallNames = ask.calls.filter((c) => {
    const ops = opsOfTool(ask.modules, c.name) ?? [];
    return ops.some((op) => !WRITE_OPERATIONS.has(op) && op !== 'ask_clarification');
  });
  const hasReadCall = readCallNames.length > 0;
  const readEvidenceText = readCallNames.length > 0 ? `${sourceText}\n${String(ask.toolResultsText ?? '')}` : '';
  const readPool = (readEvidenceText.match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber).filter((x) => x !== null);
  const nearPool = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const figuresNow = (Array.isArray(report.numbers) ? report.numbers : []).map(toNumber).filter((n) => n !== null);
  const shownNow = [
    ...(parsed.text.match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber),
    ...items.flatMap((it) => (String(it.value ?? '').match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber)),
  ].filter((x) => x !== null);
  const operandsShown = shownNow.filter((s) => readPool.some((p) => nearPool(p, s) || nearPool(p * 100, s) || nearPool(p / 100, s)));
  // A single operand shown is not arithmetic; two, or a reported figure traceable to a read (which covers a
  // multi-operand sum), are. The orientation-only case reads no numbers, so its pool is empty.
  const showsOperands = operandsShown.length >= 2 || figuresNow.some((f) => isTraceableFigure(f, readPool, shownNow));
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
  // The turn's data: the document as opened, the tool results, and the user's own question. A figure the user supplied
  // ("set D5 to 45.000.000", "does it exceed 18.000.000?") is not invented when the reply repeats it, so the question
  // is part of the pool; a forecast the reply makes up is in none of the three.
  const queryText = [caseDoc.query?.vi, caseDoc.query?.en].filter((s) => typeof s === 'string').join('\n');
  const turnText = `${sourceText}\n${String(ask.toolResultsText ?? '')}\n${queryText}`;
  const hasTurnContext = turnText.trim() !== '';
  const pool = hasTurnContext
    ? (turnText.match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber).filter((x) => x !== null)
    : [];
  const shownNumbers = [
    ...(parsed.text.match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber),
    ...items.flatMap((it) => (String(it.value ?? '').match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber)),
  ].filter((x) => x !== null);
  // A7: a figure the reply states in prose is a claim too. One that is neither a reported number nor traceable (the
  // same isTraceableFigure rules) joins the extras, so it fails numeric_unexpected. Locators, dates and quoted digits
  // are not quantities and are skipped by proseQuantityTokens; a reported figure and one already in `extras` are not
  // added twice.
  const reportedNumbers = figures.map(toNumber).filter((n) => n !== null);
  const extraNumbers = extras.map(toNumber).filter((n) => n !== null);
  const inList = (n, list) => list.some((m) => Math.abs(n - m) <= 1e-9 * Math.max(1, Math.abs(n), Math.abs(m)));
  const proseExtras = proseQuantityTokens(parsed.text)
    .map(tokenToNumber)
    .filter((n) => n !== null && !inList(n, reportedNumbers) && !inList(n, extraNumbers));
  const strictExtras =
    numbers === 'strict'
      ? [
          ...extras.filter((value) => caseDoc.expected.forbidExtraNumbers === true || !hasTurnContext || !allExpectedNumericMatched || !isTraceableFigure(value, pool, shownNumbers)),
          ...proseExtras.filter((value) => caseDoc.expected.forbidExtraNumbers === true || !hasTurnContext || !allExpectedNumericMatched || !isTraceableFigure(value, pool, shownNumbers)),
        ]
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
    if (expected.kind === 'config_op') {
      // A2: a configuration edit is proven from the APPLIED propose_operations arguments — the operation type, the
      // target sheet and the requested settings — never from newly introduced text or a self-reported count. The reply
      // need not name it (there is no value a reply could carry that the arguments do not already say), so the adapter
      // synthesises the item from the arguments, as it does for a preserved count. The value is the OBSERVED canonical
      // `sheet|key=value,…`, so the scorer's own value comparison decides whether the settings are the expected ones.
      const observed = editCase ? configOpProof(applied, expected.anchor, String(expected.value), ask.sheetNames ?? []) : null;
      if (observed !== null) {
        writeBacked += 1;
        structural.push({ kind: 'config_op', anchor: expected.anchor, value: observed });
      } else {
        writeUnbacked += 1;
      }
    } else if (VALUE_KINDS.has(expected.kind)) {
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
        // A9: the fact credit applies only when the case is not an edit, no write happened, and the answer reports no
        // conflicting value for that count — a count the reply states with a different value is never replaced by the
        // oracle's, and an edit-category case with a zero-write ceiling is not a preserved invariant either. The
        // pre-existing structure exclusion stays: there the count IS the requested answer, not a preserved invariant.
        const conflictingCount = same.some((it) => atAnchor(it));
        if (
          !editCase &&
          (ask.writes ?? 0) === 0 &&
          parsed.status === 'ok' &&
          expected.kind === 'count' &&
          caseDoc.category !== 'edit' &&
          caseDoc.category !== 'structure' &&
          !conflictingCount &&
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
  // The model's own unmatched items stay in the answer so the scorer's leak check still reads them (R17-1). A claimed
  // configuration operation is the one kind that may NEVER satisfy a structural check — only the APPLIED arguments
  // above prove a configuration edit — so the claim is kept under a distinct kind that no expectation names.
  for (const it of items) if (!taken.has(it)) {
    const kind = String(it.kind);
    structural.push({ kind: kind === 'config_op' ? 'config_op_claim' : kind, anchor: String(it.anchor ?? ''), value: it.value });
  }
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
