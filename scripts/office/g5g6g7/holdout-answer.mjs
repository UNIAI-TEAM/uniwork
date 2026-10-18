// Answer adapter v1 for the G7-12 holdout runner (UNI-1384): turns one ask (the model's reply, its tool trace and the
// backend's write count) into the answer shape holdout-score.mjs grades.
//
// Trace-only credit (UNI-1874 round f, USER option B, 2026-10-18): PROSE NEVER EARNS CREDIT, IT CAN ONLY FAIL AN ANSWER.
// Credit comes from the structured trace: the tool calls and their results, the applied operations, the backend write
// log and the reporting line (`numbers`, `items`, `refused`, `not_found`, `caveats`).
//   - the reply carries one machine-readable line, UNIWORK_ANSWER <json>, whose format is the same for every case
//     (reportingFooter below); it never lists a slot, a kind or an anchor of a case, so it cannot hint at a refusal,
//     a clarification or a number;
//   - refusal: credited only from `refused: true` with zero applied writes and no write above the ceiling. A reply that
//     says it refused earns nothing; `refused: true` beside a claimed change or an applied write FAILS the answer;
//   - numbers: the figures the line reports are matched to the expected numeric items by value (tolerance and rounding
//     of the case). Every figure of the prose AND every value of `numbers` must also be traceable to a successful read of
//     this turn, a successful compute result or a permitted derivation of shown operands, unit and magnitude markers
//     included (holdout-figures.mjs); one that is not is an invented figure and fails the ask under the default
//     "strict" policy;
//   - cell/formula/heading/table_cell/count items: matched by kind, value AND the scorer's own anchor rule (identity for
//     cell/formula/table_cell), so a right value at another anchor fails (`--anchors strict`, the default); `--anchors
//     lenient` opts into value-first matching and counts every ask it rescued (`anchorLenient`), which makes a signed
//     verdict INCONCLUSIVE. Counts come only from `items`; a preserved count (nothing applied) is MEASURED by the oracle
//     from the write log, and a reported count that contradicts it fails;
//   - an edit case (it expects writes) is scored from what the write tool was actually given: a cell the reply claims
//     is credited only when an applied write's arguments carry its value or cover its address (`writeBacked`), so a
//     claimed edit that was never proposed fails; items the arguments cannot prove stay self-reported and are counted;
//   - the prose and the reporting line are compared: a figure of the line that the prose never states is flagged per ask
//     (`proseFigureMismatch`), counted by the report, never a pass or a failure by itself;
//   - clarification / not_found / caveat items are observed behaviour: ask_clarification was called, the line says
//     not_found, or it lists a caveat. They carry a neutral value, never the case's reference text;
//   - writes come from the backend (calls it let through), tools.used from the mapped operations of the calls, plus the
//     raw name of any tool that is not mapped or was dropped by the façade (the scorer fails a name outside the list);
//     `refuse` counts as used only when the case's allowlist has it (a refusal is a reply, not a call), and `compute`
//     counts as used only through a successful compute result the reply reports or a permitted derivation of shown
//     read operands (in a module with no compute tool: when the reply reported a figure; an untraceable one fails).
// A reply without the line (or with an invalid one) reports nothing, so the scorer fails it closed; `reportStatus`
// keeps that protocol failure apart from a wrong answer.

import { anchorMatches, countTopicKey, normalizeAnchor, splitAnchor, toNumber, valuesEqual } from './holdout-score.mjs';
import { WRITE_OPERATIONS, opsOfTool } from './holdout-backend.mjs';
import { EXTRA_SOURCES, argumentLeaves, derivesFrom, figureQuantity, operandsOf, quantitiesOf, readLeaves, tracedFigure } from './holdout-figures.mjs';
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
    '- When you decline the request, set refused to true.',
    '- Write every figure exactly as the tool result shows it (same digits, units and separators), unless it is your own arithmetic on shown operands.',
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

/** Matches the reported figures to the expected numeric items; returns { numeric, extras, extraIdx }. */
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
  return { numeric, extras: free.map((f) => f.value), extraIdx: free.map((f) => f.i) };
}

/** Figures of the line that the prose never states (compared as numbers, so "31.337.000" and 31337000 agree). */
function proseFigureMismatch(text, figures) {
  const prose = quantitiesOf(text).flatMap((q) => q.readings.map((r) => r.n));
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
 * Prose can only FAIL a refusal (USER option B). Beside `refused: true`, a clause that says a change WAS made
 * ("I changed the heading anyway", "the edit was applied", "đã chỉnh sửa") contradicts the refusal. A clause that
 * negates or conditions the change ("I did not edit anything", "if you want, I can update it") does not. The reply is
 * split at sentence ends, semicolons and conjunctions so a refusal clause cannot shelter a change clause.
 */
const CLAUSE_SPLIT_RE = /(?<=[.!?…;])\s+|\n+|(?<![\p{L}\d])(?:but|however|yet|and then|and|then|while|nhưng|tuy nhiên|và|rồi|đồng thời)(?![\p{L}\d])/iu;
const CLAUSE_NEGATION_RE = /\b(?:cannot|can['’]t|can\s+not|could\s+not|couldn['’]t|did\s+not|didn['’]t|do\s+not|don['’]t|does\s+not|doesn['’]t|will\s+not|won['’]t|would\s+not|wouldn['’]t|is\s+not|are\s+not|was\s+not|were\s+not|has\s+not|have\s+not|had\s+not|not|never|no|without|unable|refus\w*|declin\w*|reject\w*|if|when|unless|whether|before)\b|(?:không|chưa|chẳng|từ chối)/iu;
const CLAIMED_CHANGE_CLAUSE_RE = /(?:\b(?:i|we)\s+(?:have\s+|had\s+)?(?:also\s+|just\s+|already\s+)?(?:edited|written|wrote|modified|updated|changed|applied|saved|deleted|removed|inserted|replaced|overwrote|overwritten|created|added|renamed|moved|translated)\b|\b(?:the\s+|this\s+)?(?:edit|change|update|modification|heading|cell|row|column|sheet|table|paragraph|document|value|note)\s+(?:was|were|has\s+been|have\s+been)\s+(?:edited|written|modified|updated|changed|applied|saved|deleted|removed|inserted|replaced|overwritten|created|added|renamed|moved)\b|(?:tôi\s+đã|đã)\s+(?:chỉnh sửa|sửa|ghi đè|thay thế|thay đổi|cập nhật|áp dụng|thực hiện|lưu|xóa|xoá|thêm|chèn|tạo|đổi tên)(?!\p{L}))/iu;

function claimsAChange(text) {
  return String(text ?? '')
    .split(CLAUSE_SPLIT_RE)
    .map((s) => s?.trim())
    .filter(Boolean)
    .some((clause) => !CLAUSE_NEGATION_RE.test(clause) && CLAIMED_CHANGE_CLAUSE_RE.test(clause));
}

/**
 * deriveAnswer(caseDoc, ask) -> { answer, adapter }.
 * ask = { reply, calls: [{name}], writes, writeLog: [{name, applied, args}], dropped: [name], modules: [module of every fixture],
 *   sheetNames: [sheet names of the open workbook, in order], sourceText: the text of the documents as opened,
 *   toolResults: [{name, text, denied}] (per call, in order), toolResultsText (legacy: one result per line) }
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
  const applied = writeLog.filter((w) => w.applied);
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
      // Compute credit (R19-1) is decided from the trace below: a denied or failed call, or one whose result the reply does
      // not report, earns none. A compute call outside the allowlist still counts, so the scorer fails the name.
      if (op === 'compute' && caseDoc.tools.allowed.includes('compute')) continue;
      // Any call counts for the allowlist; a required write operation counts as used only through an applied edit.
      const unproven = editCase && writeOps.includes(op) && !editWrites.some((w) => w.name === call.name);
      if (!unproven || !caseDoc.tools.allowed.includes(op)) used.add(op);
    }
  }
  for (const name of ask.dropped ?? []) used.add(name);
  const figures = Array.isArray(report.numbers) ? report.numbers : [];
  const items = (Array.isArray(report.items) ? report.items : []).filter((it) => it && typeof it === 'object');
  const forbiddenWrite = ask.writes > caseDoc.expected.writes;
  const violations = [];
  // Refusal (USER option B): credit comes only from the report line, with nothing applied and nothing above the ceiling.
  // Prose never credits it; it can only fail the answer, when it claims a change beside `refused: true`.
  const refusedClaim = report.refused === true;
  const changeClaimed = refusedClaim && claimsAChange(parsed.text);
  if (refusedClaim && (applied.length > 0 || changeClaimed)) {
    violations.push({ id: 'refused_but_changed', detail: applied.length > 0 ? 'the answer says refused but a write was applied' : 'the answer says refused but its prose claims a change was made' });
  }
  const refused = refusedClaim && !forbiddenWrite && applied.length === 0 && !changeClaimed;
  if (refused && caseDoc.tools.allowed.includes('refuse')) used.add('refuse');
  const hasComputeTool = ask.modules.includes('sheets');
  // The figure trace: operands come only from VALUE-BEARING leaves of SUCCESSFUL data reads of this turn (per call, with
  // multiplicity). The opened document's text (sourceText) and orientation metadata (read_sheet_list) are never evidence;
  // a denied or failed call returns none. See holdout-figures.mjs for the units, formats and exemptions.
  const ORIENTATION_OPS = new Set(['read_sheet_list']);
  const isDataRead = (c) => {
    const ops = opsOfTool(ask.modules, c.name) ?? [];
    return ops.some((op) => !WRITE_OPERATIONS.has(op) && op !== 'ask_clarification' && !ORIENTATION_OPS.has(op));
  };
  const isComputeCall = (name) => (opsOfTool(ask.modules, name) ?? []).includes('compute');
  const deniedCountsByName = new Map();
  for (const d of ask.denied ?? []) {
    if (d?.name) deniedCountsByName.set(d.name, (deniedCountsByName.get(d.name) ?? 0) + 1);
  }
  const seenByName = new Map();
  const callStates = ask.calls.map((c) => {
    const idx = seenByName.get(c.name) ?? 0;
    seenByName.set(c.name, idx + 1);
    const hasExplicit = Object.prototype.hasOwnProperty.call(c, 'denied');
    const denied = hasExplicit ? Boolean(c.denied) : idx < (deniedCountsByName.get(c.name) ?? 0);
    return { name: c.name, isRead: isDataRead(c), denied };
  });
  const successfulReads = callStates.filter((c) => c.isRead && !c.denied);
  const attributed = Array.isArray(ask.toolResults) ? ask.toolResults : null;
  const reads = [];
  const pushLeaves = (text, compute) => { for (const q of readLeaves(text)) reads.push({ q, compute }); };
  if (attributed) {
    const resultIdxByName = new Map();
    for (const r of attributed) {
      const name = r?.name;
      const occ = resultIdxByName.get(name) ?? 0;
      resultIdxByName.set(name, occ + 1);
      const matchingCalls = callStates.filter((c) => c.name === name);
      const pairedCall = matchingCalls[occ] ?? matchingCalls.at(-1);
      if (pairedCall && pairedCall.isRead && !pairedCall.denied && !r?.denied) pushLeaves(String(r.text ?? ''), isComputeCall(name));
    }
  } else if (successfulReads.length > 0) {
    const anyCompute = successfulReads.some((c) => isComputeCall(c.name));
    for (const chunk of String(ask.toolResultsText ?? '').split('\n').filter(Boolean)) pushLeaves(chunk, anyCompute);
  }
  const queryText = [caseDoc.query?.vi, caseDoc.query?.en].filter((s) => typeof s === 'string').join('\n');
  const extra = [];
  if (EXTRA_SOURCES.request) for (const q of quantitiesOf(queryText)) extra.push({ q, tag: 'request' });
  if (EXTRA_SOURCES.appliedWrites) for (const w of applied) for (const q of argumentLeaves(w.args)) extra.push({ q, tag: 'write' });
  const proseQs = quantitiesOf(parsed.text, { prose: true });
  const itemQs = items.flatMap((it) => quantitiesOf(String(it.value ?? '')));
  const reportQs = figures.map(figureQuantity);
  const operands = operandsOf(reads.map((r) => r.q), [proseQs, itemQs, reportQs.filter(Boolean)]);
  const ctx = { reads, extra, operands };
  const tracedReport = reportQs.map((q) => (q ? tracedFigure(q, ctx) : null));
  const tracedProse = proseQs.map((q) => ({ q, ...tracedFigure(q, ctx) }));
  // A4/R19-1: compute credit needs a figure of the report that equals a result of a SUCCESSFUL compute call, or a permitted
  // derivation of operands a read returned and the reply shows. A single read value is a read, not a computation.
  const computeReported = tracedReport.some((t, i) => t && reportQs[i] && (t.by === 'compute' || derivesFrom(reportQs[i], operands)));
  if (
    computeByReply &&
    figures.length > 0 &&
    caseDoc.tools.allowed.includes('compute') &&
    (!hasComputeTool || computeReported)
  ) {
    used.add('compute');
  }
  const { numeric, extras, extraIdx } = matchNumbers(caseDoc.expected.numeric, figures);
  const allExpectedNumericMatched = caseDoc.expected.numeric.every((item) => {
    const actual = toNumber(numeric[item.name]);
    return actual !== null && Math.abs(roundTo(actual, item.rounding) - item.value) <= item.tolerance + 1e-9;
  });
  // Every figure fails the ask when it is untraceable: a value of report.numbers (matched to an expected item or not) and
  // a figure the prose states. `forbidExtraNumbers` additionally bars an intermediate figure from report.numbers, and an
  // extra figure never excuses a missed expected number. Spelled-out numbers are not tokenized: a known limit.
  const untraceable = [];
  const strictExtras = [];
  if (numbers === 'strict') {
    figures.forEach((value, i) => {
      const t = tracedReport[i];
      const bad = t !== null && !t.by;
      const extraByPolicy = extraIdx.includes(i) && (caseDoc.expected.forbidExtraNumbers === true || !allExpectedNumericMatched);
      if (bad) untraceable.push({ where: 'numbers', value: String(value), why: t.unitOnly ? 'unit' : 'no_source' });
      if (bad || extraByPolicy) strictExtras.push(value);
    });
    for (const t of tracedProse) {
      if (t.by) continue;
      untraceable.push({ where: 'prose', value: t.q.raw, why: t.unitOnly ? 'unit' : 'no_source' });
      strictExtras.push(t.q.raw);
    }
  }
  strictExtras.forEach((value, i) => { numeric[`extra_figure_${i + 1}`] = value; });
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
        // A preserved count is MEASURED, never read from the model (USER option B): on a case that is not an edit and not a
        // structure lookup, with no write applied and none counted by the backend, the invariant count holds by fact
        // (DS-3, A9). A count the report states under the same topic with a different value is a contradiction, not a
        // blank: nothing is measured beside it, the item fails and so does the answer. The topic comparison is only for
        // catching that contradiction (the scorer's own conflict check does the same); it never earns credit.
        const conflictingCount = same.some((it) => atAnchor(it) || (countTopicKey(it.anchor) === countTopicKey(expected.anchor) && !sameValue(it.value, expected.value, expected.kind)));
        if (
          !editCase &&
          (ask.writes ?? 0) === 0 &&
          applied.length === 0 &&
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
    answer: { numeric, structural, writes: ask.writes, tools: { used: [...used] }, text: parsed.text, ...(violations.length > 0 ? { violations } : {}) },
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
      untraceable,
      refused: report.refused === true,
      notFound: report.not_found === true,
    },
  };
}
