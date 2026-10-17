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

import { UNIT_TOKENS, anchorMatches, countTopicKey, normalizeAnchor, splitAnchor, toNumber, valuesEqual } from './holdout-score.mjs';
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
//
// R17-4 (review-g712-17): the address exemption needs real address or range tokens with boundaries — a sheet name may
// be quoted and hold spaces, the column letters and row digits must be whole, and the cell may be `$`-absolute. A
// currency- or unit-prefixed amount ("VND987654321", "$987654321", "987654321VND") is a QUANTITY, never an address,
// even though the letters of the unit look like column letters; so is any other letter-led run.
const CELL_RE = String.raw`\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?`;
// A real address or range: a sheet-qualified cell ("Sheet!A1", "Doanh thu Q1!G8:G8", "'Q1 2026'!A1") or a bare one
// ("A1", "A1:B2"). The sheet name may be quoted and hold spaces, or be an unquoted run without spaces.
const ADDRESS_RUN_RE = new RegExp(`(?:'(?:[^']|'')+'|[A-Za-z_][\\w.]*)!${CELL_RE}|\\b${CELL_RE}\\b`, 'g');
const PERIOD_LABEL_RE = /^(?:q[1-4]|[qk]uý\s*[1-4]|quý\s+[ivx]+|kỳ\s*\d+|tháng\s*\d{1,2}|năm\s*\d{4}|h[1-4]|sheet\s*\d+)$/i;
// An identifier word: a URL ("http://host:8443/v1"), an email or handle ("ops@example.com"), a key-shaped token
// ("sk-abcdefgh12345678"), or an opaque alphanumeric token ("abcdefghijklmnop1234"). Its digits are a host, a port or
// a secret, never an amount the reply states. A unit-suffixed amount is NOT an identifier (R17-4), so it is tested first.
const UNIT_SUFFIX_RE = new RegExp(`^[0-9.,]+\\s*(?:${UNIT_TOKENS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'iu');
const IDENTIFIER_WORD_RE = /:\/\/|@|^[A-Za-z]{2,}[-_][A-Za-z0-9_-]{6,}$|^[A-Za-z0-9]{8,}$/;
const NUMBER_PREFIXED_UNIT_RE = new RegExp(`^(?:${UNIT_TOKENS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'iu');
const DATE_WORD_RE = /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/;
// Written-month dates, English and Vietnamese (R17-5): "October 17, 2026", "17 October 2026",
// "17 tháng 10 năm 2026", "ngày 17 tháng 10, 2026". The month word is what makes it a date; a bare "17" stays a claim.
const MONTH_WORDS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|tháng';
const WRITTEN_MONTH_BEFORE_RE = new RegExp(`(?:^|[^\\p{L}])(?:ngày\\s+)?(?:${MONTH_WORDS})\\s*$`, 'iu');
const WRITTEN_MONTH_AFTER_RE = new RegExp(`^\\s*(?:${MONTH_WORDS})\\b`, 'iu');
const YEAR_AFTER_MONTH_RE = new RegExp(`(?:${MONTH_WORDS})\\s*(?:\\d{1,2}\\s*[,.]?\\s*)?$`, 'iu');
const LOCATOR_WORD_RE = /(?:slide|page|trang|row|line|hàng|dòng|ô|cell|section|mục|chương|quý|quarter|step|bước|khu vực|table|bảng|biểu đồ|chart|phần|item|tháng|năm|ngày)\s*$/i;
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
 * Is the token at [start, end) of `text` an address, a range or a period label rather than a quantity (R17-4)? The
 * whole line is scanned for real address runs, so a number inside one ("Sheet!A1", "A1:B2", "Doanh thu Q1!G8:G8",
 * "'Q1 2026'!A1") is exempt with its boundaries, and a "Q1"/"quý 1" period label is exempt on its own.
 */
function isAddressToken(text, start, end) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const offset = start - lineStart;
  ADDRESS_RUN_RE.lastIndex = 0;
  for (const match of line.matchAll(ADDRESS_RUN_RE)) {
    if (offset >= match.index && end - lineStart <= match.index + match[0].length) return true;
  }
  const { word } = wordAround(text, start, end);
  const bare = word.replace(/[^0-9A-Za-zÀ-ỹ\s]/g, '').trim();
  return PERIOD_LABEL_RE.test(bare);
}

/**
 * Is the token at [start, end) part of a written-month date (R17-5)? The month word is what makes it a date: the token
 * directly follows a written month ("October 17", "tháng 10"), directly precedes one ("17 October"), or is the year
 * that closes a written date ("October 17, 2026", "17 October 2026"). A bare number next to no month word stays a claim.
 */
function isWrittenDateToken(text, start, end) {
  const token = text.slice(start, end);
  const { before, after } = wordAround(text, start, end);
  if (WRITTEN_MONTH_BEFORE_RE.test(before) || WRITTEN_MONTH_AFTER_RE.test(after)) return true;
  return /^\d{4}$/.test(token) && YEAR_AFTER_MONTH_RE.test(before);
}

/**
 * The numbers the reply states in prose that are quantity claims (review-g712-16 A7). A prose figure is a claim like a
 * reported number, so it must be reported or traceable; only tokens that are clearly not quantities are exempt: a
 * cell/range address with real boundaries or a period label like "Q1" (R17-4), a numeric or written-month date
 * (R17-5), a locator word before it, a list marker that starts a line ("1. ", "3) "), and digits inside quoted
 * document text. A currency- or unit-prefixed amount is a quantity, not an address.
 */
export function proseQuantityTokens(text) {
  const out = [];
  const source = String(text);
  for (const match of source.matchAll(NUMBER_TOKEN_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    const { word, before, after } = wordAround(source, start, end);
    // R17-4: a unit- or currency-prefixed run ("VND987654321", "$987654321", "987654321VND") is a QUANTITY. It is
    // never an address, even though the unit's letters would read as column letters to the address pattern.
    if (NUMBER_PREFIXED_UNIT_RE.test(word)) { out.push(match[0]); continue; }
    // An identifier's digits (a URL host or port, an email, a key) are not an amount the reply states.
    const bareWord = word.replace(/[),.;:"'“”]+$/, '');
    if (!UNIT_SUFFIX_RE.test(bareWord) && IDENTIFIER_WORD_RE.test(bareWord) && /[A-Za-z]/.test(bareWord)) continue;
    if (isAddressToken(source, start, end) || DATE_WORD_RE.test(word) || isWrittenDateToken(source, start, end)) continue;
    if (LOCATOR_WORD_RE.test(before.trimEnd())) continue;
    // A list marker (R17-5): the token starts a line (the first line counts too) and the rest of its word is only the
    // marker punctuation ("1. Bắc", "3) Nam", "2. "). The digits of such an ordinal are not a quantity.
    if (/(?:^|\n)[ \t]*$/.test(before) && /^[.)]+$/.test(word.slice(match[0].length))) continue;
    // Inside quoted document text: an odd number of quote characters before it opens a quotation that this digit sits in.
    if (((before.match(QUOTE_CHARS) ?? []).length % 2) === 1) continue;
    out.push(match[0]);
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

/**
 * The numbers one data read's result carries. A tool result is JSON, so it is read structurally when it parses: the
 * leaves are the values the read returned, and a JSON array "[60,83]" is two numbers, not one grouped "60,83" (the
 * prose tokenizer reads a comma as a grouping separator). A chunk that does not parse falls back to the prose tokens.
 */
function numbersOfToolResults(text) {
  const out = [];
  const walk = (node) => {
    if (typeof node === 'number') { if (Number.isFinite(node)) out.push(node); return; }
    if (typeof node === 'string') {
      for (const token of node.match(NUMBER_TOKEN_RE) ?? []) { const n = tokenToNumber(token); if (n !== null) out.push(n); }
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node !== null && typeof node === 'object') Object.values(node).forEach(walk);
  };
  try {
    walk(JSON.parse(String(text)));
    return out;
  } catch {
    return (String(text).match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber).filter((x) => x !== null);
  }
}

/**
 * Is the reported figure the permitted derivation of the operands the answer shows (R17-3)? Permitted: the sum of ALL
 * shown operands, or a sum, difference, ratio or percent of two of them. The product is not permitted, a single
 * operand is a direct read (not a computation), and a figure that equals one operand alone is a read too. Rounding is
 * allowed only to the precision the answer shows for that figure.
 */
export function isPermittedDerivation(value, operands) {
  const target = toNumber(value);
  if (target === null || operands.length < 2) return false;
  const dp = shownDecimalPlaces(value, target);
  const matches = (candidate) => matchesExactOrShownRounding(target, dp, candidate);
  // A figure equal to one operand alone is a direct read, not arithmetic.
  if (operands.some((op) => matches(op))) return false;
  const all = operands.reduce((a, b) => a + b, 0);
  if (matches(all)) return true;
  for (let i = 0; i < operands.length; i += 1) {
    for (let j = i + 1; j < operands.length; j += 1) {
      const a = operands[i];
      const b = operands[j];
      const candidates = [a + b, a - b, b - a];
      if (b !== 0) candidates.push(a / b, (a / b) * 100);
      if (a !== 0) candidates.push(b / a, (b / a) * 100);
      if (candidates.some(matches)) return true;
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
 * Refusal prose (review-g712-16 A6, narrowed by review-g712-17 R17-6/R17-7). A refusal is an OUTCOME of the requested
 * action, in one of four forms: a negative modal on a change verb ("I could not edit", "cannot write"); an impersonal
 * not-allowed / not-permitted on the change ("editing this document is not permitted"); an explicit decline/refusal of
 * the request ("I declined the requested edit", "I refuse to make this change", "từ chối yêu cầu chỉnh sửa"); or a
 * passive statement that the change was not applied ("the requested edit was not applied", "chưa áp dụng thay đổi").
 * A generic negation about the document's content ("this design is not supported in the chart legend", "the legend
 * does not allow that colour", "the value cannot be negative") names no change and is not a refusal: `support`,
 * `allow`, `permit`, `possible` and `available` are therefore not refusal verbs and no standalone "not allowed" branch
 * exists. The explicit and passive forms additionally need a change term in the same sentence, so a negation about
 * something else in the reply cannot borrow the vocabulary. A Vietnamese verb ends in a non-ASCII letter, so the
 * boundary after a verb is a letter lookahead, never \b.
 */
const CHANGE_VERB = 'edit|write|modify|update|change|apply|save|delete|remove|insert|replace|overwrite|freeze|perform|execute|create|add|rename|move|translate|design';
const CHANGE_NOUN = `(?:${CHANGE_VERB}|request|instruction|yêu cầu|chỉnh sửa|thay đổi|cập nhật|áp dụng|thực hiện|sửa|ghi|xóa|thêm|tạo|lưu)`;
const NEG_MODAL = "cannot|can['’]t|can not|could not|couldn['’]t|unable to|will not|won['’]t|did not|didn['’]t|do not|does not|don['’]t|is not|are not|was not|were not|not able to";
const REFUSAL_MODAL_RE = new RegExp(`(?:${NEG_MODAL})\\s+(?:[a-z]+\\s+){0,3}(?:${CHANGE_VERB})\\b`, 'i');
const REFUSAL_IMPERSONAL_RE = /(?:is|are|was|were|has|have|had)\s+not\s+(?:allowed|permitted)\b/i;
const REFUSAL_EXPLICIT_RE = /(?:declin(?:e|ed|es|ing)|refus(?:e|ed|es|ing)|reject(?:ed|s|ing)?|turned\s+down|từ chối|không đồng ý)/iu;
const REFUSAL_PASSIVE_RE = /(?:was|were|has|have|had|is|are|been)\s+(?:not|never)\s+(?:been\s+)?(?:applied|made|performed|executed|carried\s+out|done|saved|written|changed|completed|created|deleted)\b/i;
const REFUSAL_VI_NEGATED_RE = /(?:không thể|chưa thể|không|chưa|chẳng)\s+(?:[\p{L}]+\s+){0,4}(?:chỉnh sửa|sửa|ghi đè|ghi|thay thế|thay đổi|cập nhật|áp dụng|thực hiện|lưu|xóa|thêm|chèn|tạo)(?!\p{L})/iu;
const REFUSAL_VI_EXPLICIT_RE = /(?:từ chối|không đồng ý)/u;

/** Sentences of the visible reply: a refusal's explicit or passive form must tie to a change in its own sentence. */
function refusalSentences(text) {
  return String(text ?? '').split(/(?<=[.!?…])\s+|\n+/u).filter(Boolean);
}

function refusalProseOf(text) {
  if (REFUSAL_MODAL_RE.test(text) || REFUSAL_IMPERSONAL_RE.test(text) || REFUSAL_VI_NEGATED_RE.test(text)) return true;
  return refusalSentences(text).some(
    (sentence) =>
      (REFUSAL_EXPLICIT_RE.test(sentence) || REFUSAL_PASSIVE_RE.test(sentence) || REFUSAL_VI_EXPLICIT_RE.test(sentence)) &&
      new RegExp(CHANGE_NOUN, 'i').test(sentence),
  );
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
  // Refusal prose (review-g712-16 A6, narrowed by review-g712-17 R17-6/R17-7): see refusalProseOf above. The reply must
  // state the OUTCOME of the requested action; a generic negation about document content is no refusal.
  const refusalProse = parsed.status === 'ok' && refusalProseOf(parsed.text);
  const refused = !forbiddenWrite && (report.refused === true || refusalProse);
  if (refused && caseDoc.tools.allowed.includes('refuse')) used.add('refuse');
  const hasComputeTool = ask.modules.includes('sheets');
  // A4 (review-g712-16) + R17-2/R17-3 (review-g712-17): compute credit needs the reported result to EQUAL a permitted
  // derivation of operands that BOTH a successful data read in this turn returned AND the answer shows. The operand
  // pool is the numbers of the tool results of the data reads only: orientation metadata (get_workbook_context ->
  // read_sheet_list) and the opened document's text (sourceText) are never operand evidence. Direct traceability alone
  // (one operand, or a figure equal to a pool number) is a read, not a computation. `figures` and `items` are read
  // here, before the numeric matching below.
  const ORIENTATION_OPS = new Set(['read_sheet_list']);
  const isDataRead = (c) => {
    const ops = opsOfTool(ask.modules, c.name) ?? [];
    return ops.some((op) => !WRITE_OPERATIONS.has(op) && op !== 'ask_clarification' && !ORIENTATION_OPS.has(op));
  };
  const readCallNames = ask.calls.filter(isDataRead).map((c) => c.name);
  const deniedNames = new Set([
    ...(ask.denied ?? []).map((d) => d.name),
    ...ask.calls.filter((c) => c.denied).map((c) => c.name),
  ]);
  const dataReadNames = new Set(readCallNames.filter((name) => !deniedNames.has(name)));
  const attributed = Array.isArray(ask.toolResults) ? ask.toolResults : null;
  const readEvidenceChunks = attributed
    ? attributed.filter((r) => dataReadNames.has(r?.name) && !deniedNames.has(r?.name)).map((r) => String(r.text ?? ''))
    : (dataReadNames.size > 0 ? String(ask.toolResultsText ?? '').split('\n') : []);
  const readPool = readEvidenceChunks.flatMap(numbersOfToolResults);
  const nearPool = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const figuresNow = (Array.isArray(report.numbers) ? report.numbers : []).map(toNumber).filter((n) => n !== null);
  const shownNow = [
    ...(parsed.text.match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber),
    ...items.flatMap((it) => (String(it.value ?? '').match(NUMBER_TOKEN_RE) ?? []).map(tokenToNumber)),
  ].filter((x) => x !== null);
  // The operands: numbers the answer shows (prose or an item value) that a data read returned, percent scaling aside.
  const operandsShown = [...new Set(shownNow.filter((s) => readPool.some((p) => nearPool(p, s) || nearPool(p * 100, s) || nearPool(p / 100, s))))];
  const showsOperands = figuresNow.some((f) => isPermittedDerivation(f, operandsShown));
  if (
    computeByReply &&
    figures.length > 0 &&
    caseDoc.tools.allowed.includes('compute') &&
    (!hasComputeTool || (dataReadNames.size > 0 && showsOperands))
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
  // `forbidExtraNumbers` bars intermediate figures from the REPORTED numbers; a figure the prose states is a claim
  // only when it is untraceable (README: "mọi số bịa không truy nguyên được vẫn bị đánh trượt"), so repeating a
  // tool-read operand in prose is never an invented figure (R17-5 boundary: a list marker's digits, a date, an address).
  const strictExtras =
    numbers === 'strict'
      ? [
          ...extras.filter((value) => caseDoc.expected.forbidExtraNumbers === true || !hasTurnContext || !allExpectedNumericMatched || !isTraceableFigure(value, pool, shownNumbers)),
          ...proseExtras.filter((value) => !hasTurnContext || !allExpectedNumericMatched || !isTraceableFigure(value, pool, shownNumbers)),
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
        // A9 (review-g712-16) + R17-9 (review-g712-17): a count the reply states with a different value is never
        // replaced by the oracle's. The conflict is found by TOPIC, not by value equality: "changed paragraphs" and
        // "changed_paragraphs" name the same count, so a wrong value under either is a conflict and no synthetic
        // oracle count may appear beside it.
        const conflictingCount = same.some((it) => atAnchor(it) || (countTopicKey(it.anchor) === countTopicKey(expected.anchor) && !sameValue(it.value, expected.value, expected.kind)));
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
