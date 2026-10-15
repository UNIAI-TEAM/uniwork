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

import { anchorMatches, splitAnchor, toNumber } from './holdout-score.mjs';
import { opsOfTool } from './holdout-backend.mjs';
import { cellProof } from './holdout-write-proof.mjs';

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

const sameValue = (a, b) => {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x !== null && y !== null) return Math.abs(x - y) < 1e-9;
  return String(a).trim() === String(b).trim();
};
const norm = (anchor) => String(anchor ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

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

/** Figures of the line that the prose never states (compared as numbers, so "31.337.000" and 31337000 agree). */
function proseFigureMismatch(text, figures) {
  const prose = (String(text).match(NUMBER_TOKEN_RE) ?? []).map(toNumber).filter((n) => n !== null);
  if (prose.length === 0) return [];
  const states = (f) => prose.some((p) => Math.abs(p - f) <= 1e-6 * Math.max(1, Math.abs(f)) || Math.abs(Math.round(p * 100) / 100 - f) < 1e-9 || Math.abs(p - Math.round(f)) < 1e-9);
  return figures.map(toNumber).filter((f) => f !== null && !states(f)).map(String);
}

/**
 * Can the arguments of the applied writes prove this expected cell? Returns 'value' or 'formula' for a provable item (a cell
 * with a plain location and a non-empty value in a case that expects a write), false when they cannot show it, or null when
 * the arguments cannot say (a blank, a format probe, a count, a heading...), in which case the item stays self-reported.
 * The value must be written AT the cell: one applied operation carries both its address and its value (G712-17).
 */
function writeBacks(caseDoc, expected, applied, sheetNames) {
  if (caseDoc.expected.writes <= 0 || !caseDoc.tools.required.includes('write_range')) return null;
  if (expected.kind !== 'cell' || splitAnchor(expected.anchor).probe) return null;
  const value = String(expected.value ?? '').trim();
  if (value === '') return null;
  const cell = splitAnchor(expected.anchor).base;
  return cellProof(applied, cell, value, { sheetNames }) ?? false;
}

/**
 * deriveAnswer(caseDoc, ask) -> { answer, adapter }.
 * ask = { reply, calls: [{name}], writes, writeLog: [{name, applied, args}], dropped: [name], modules: [module of every fixture],
 *   sheetNames: [sheet names of the open workbook, in order] }
 */
export function deriveAnswer(caseDoc, ask, { numbers = 'strict', computeByReply = true, anchors = 'strict' } = {}) {
  const parsed = parseReport(ask.reply);
  const report = parsed.report ?? {};
  const used = new Set();
  for (const call of ask.calls) {
    const ops = opsOfTool(ask.modules, call.name);
    if (!ops) { used.add(call.name); continue; }
    // A tool that serves several operations counts under those the case allows; outside all of them it counts as is.
    const inside = ops.filter((op) => caseDoc.tools.allowed.includes(op));
    (inside.length > 0 ? inside : ops).forEach((op) => used.add(op));
  }
  for (const name of ask.dropped ?? []) used.add(name);
  const figures = Array.isArray(report.numbers) ? report.numbers : [];
  if (report.refused === true && caseDoc.tools.allowed.includes('refuse')) used.add('refuse');
  const hasComputeTool = ask.modules.includes('sheets');
  if (computeByReply && !hasComputeTool && figures.length > 0 && caseDoc.tools.allowed.includes('compute')) used.add('compute');
  const { numeric, extras } = matchNumbers(caseDoc.expected.numeric, figures);
  const strictExtras = numbers === 'strict' ? extras : [];
  strictExtras.forEach((value, i) => { numeric[`extra_figure_${i + 1}`] = value; });

  const items = (Array.isArray(report.items) ? report.items : []).filter((it) => it && typeof it === 'object');
  const applied = (ask.writeLog ?? []).filter((w) => w.applied);
  const taken = new Set();
  const structural = [];
  const lenientAt = [];
  let writeBacked = 0;
  let writeUnbacked = 0;
  let writeSelfReported = 0;
  let writeFormula = 0;
  const asked = ask.calls.some((c) => c.name === 'ask_clarification');
  const caveats = Array.isArray(report.caveats) && report.caveats.some((c) => typeof c === 'string' && c.trim());
  for (const expected of caseDoc.expected.structural) {
    if (VALUE_KINDS.has(expected.kind)) {
      const same = items.filter((it) => it.kind === expected.kind && !taken.has(it));
      const proof = writeBacks(caseDoc, expected, applied, ask.sheetNames ?? []);
      const atAnchor = (it) => anchorMatches(expected.kind, expected.anchor, String(it.anchor ?? ''));
      let pick = same.find((it) => sameValue(it.value, expected.value) && atAnchor(it));
      let lenient = false;
      if (!pick && anchors === 'lenient') {
        pick = same.find((it) => sameValue(it.value, expected.value)) ?? same.find((it) => norm(it.anchor) === norm(expected.anchor));
        lenient = Boolean(pick);
      }
      if (pick && caseDoc.expected.writes > 0) {
        if (proof === null) writeSelfReported += 1;
        else if (proof === false) { writeUnbacked += 1; taken.add(pick); pick = undefined; lenient = false; } else { writeBacked += 1; if (proof === 'formula') writeFormula += 1; }
      }
      if (!pick) continue;
      taken.add(pick);
      if (lenient) lenientAt.push(expected.kind);
      structural.push({ kind: expected.kind, anchor: expected.anchor, value: pick.value });
    } else if (
      (expected.kind === 'clarification' && asked) ||
      (expected.kind === 'refusal' && report.refused === true) ||
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
      writeFormula,
      proseFigureMismatch: mismatch.length,
      refused: report.refused === true,
      notFound: report.not_found === true,
    },
  };
}
