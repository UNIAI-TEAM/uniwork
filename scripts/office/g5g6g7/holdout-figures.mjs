// Figure oracle for the G7-12 holdout adapter (UNI-1874 round f, USER option B, 2026-10-18).
//
// Principle: prose never earns credit, it can only fail an answer. A figure the reply states (in its prose or in
// report.numbers) must be traceable to one of
//   (a) a value-bearing leaf of a SUCCESSFUL data-read result of this turn, per call and with multiplicity;
//   (b) the result of a successful compute/aggregate call (its leaves are leaves of (a));
//   (c) a permitted derivation of operands that BOTH a read returned AND the reply shows: the sum or difference of two,
//       the ratio or percent of two, or the sum of all of them; never a product, never one value used twice.
// Two further sources are the user's own request and the values of APPLIED writes; both are listed in
// EXTRA_SOURCES so the lead can switch either off (the reference scan and the rescore state which one mattered).
//
// A quantity keeps its unit: a figure with a unit or magnitude marker (k, m, bn, tr, triệu, tỷ, nghìn, ngàn, %, a
// currency) matches only a source value with the same marker, or a percent derivation for %. A bare number never
// matches a marked value and a marked one never matches a bare value; there is no conversion and no unconditional
// x100 or /100. vi and en grouping and decimal styles are both read; a token ambiguous between styles matches when
// either reading is traceable. Spelled-out numbers are not tokenized and never earn credit (a known limit).
// Exempt from being a figure, and nothing else: cell or range addresses with real boundaries, line-start list
// markers, unambiguous written-month dates, and the digits inside a whole URL or email token.

import { UNIT_TOKENS } from './holdout-score.mjs';

export const EXTRA_SOURCES = { request: true, appliedWrites: true };
// The contract (USER option B, item 3) names a currency among the unit markers: a figure written with one matches only a
// source value written with the same one. `false` reads a currency word or sign as presentation and drops it from the
// quantity (the percent and magnitude markers stay); the rescore and the reference scan measure both settings.
export const UNIT_POLICY = { currencyIsMarker: true };

const foldAscii = (s) => String(s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd');

// Magnitude markers by written form; the spellings of one magnitude are one marker, different magnitudes never are.
const MAGNITUDE = new Map([
  ['k', 'k'], ['nghin', 'k'], ['ngan', 'k'],
  ['m', 'm'], ['tr', 'tr'], ['trieu', 'tr'],
  ['bn', 'bn'], ['ty', 'ty'], ['ti', 'ty'],
]);
const MAGNITUDE_WORDS = [...MAGNITUDE.keys(), 'nghìn', 'ngàn', 'triệu', 'tỷ', 'tỉ'].sort((a, b) => b.length - a.length);
const CURRENCY_FAMILY = new Map([
  ['dong', 'vnd'], ['vnd', 'vnd'], ['d', 'vnd'], ['₫', 'vnd'],
  ['usd', 'usd'], ['$', 'usd'], ['eur', 'eur'], ['€', 'eur'],
  ['yen', 'jpy'], ['jpy', 'jpy'], ['cny', 'cny'], ['nhan dan te', 'cny'],
]);
const currencyKey = (token) => CURRENCY_FAMILY.get(foldAscii(token).replace(/\s+/g, ' ').trim());
const CURRENCY_TOKENS = [...UNIT_TOKENS].sort((a, b) => b.length - a.length);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CURRENCY_ALT = CURRENCY_TOKENS.map(escapeRe).join('|');

const CANDIDATE_RE = /[-+−]?(?:\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d[\d.,]*\d|\d)/g;
const MAG_AFTER_RE = new RegExp(`^(?:(${MAGNITUDE_WORDS.join('|')})|[ \\t]+(${MAGNITUDE_WORDS.join('|')}))(?![\\p{L}\\d])`, 'iu');
const SUFFIX_UNIT_RE = new RegExp(`^[ \\t]*(?:(%)|(${CURRENCY_ALT})(?![\\p{L}]))`, 'iu');
const PREFIX_UNIT_RE = new RegExp(`(?:^|[^\\p{L}])(${CURRENCY_ALT})[ \\t]*$`, 'iu');

// ---------- number readings ----------

const exactDp = (text) => {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
};

/** The numeric readings of a digits-and-separators token: [{ n, dp }], empty when it reads as no number (1.2.3). */
export function readingsOf(token) {
  let s = String(token ?? '').trim().replace(/−/g, '-');
  let sign = 1;
  if (/^[-+]/.test(s)) { sign = s[0] === '-' ? -1 : 1; s = s.slice(1); }
  const spaced = /^\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?$/.test(s);
  s = s.replace(/[  ]/g, '');
  if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return [];
  const make = (text) => {
    const n = Number(text);
    return Number.isFinite(n) ? [{ n: sign * n, dp: exactDp(text) }] : [];
  };
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  const grouped = (parts) => parts.length > 1 && parts[0].length <= 3 && parts[0].length > 0 && parts.slice(1).every((p) => p.length === 3);
  if (hasDot && hasComma) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    const [intPart, fracPart, ...rest] = s.split(decimal);
    if (rest.length > 0 || fracPart === undefined || !grouped(intPart.split(group))) return [];
    return make(`${intPart.split(group).join('')}.${fracPart}`);
  }
  const sep = hasDot ? '.' : hasComma ? ',' : null;
  if (sep === null) return make(s);
  const parts = s.split(sep);
  if (parts.length > 2) return grouped(parts) ? make(parts.join('')) : [];
  const [a, b] = parts;
  const asDecimal = make(`${a}.${b}`);
  if (spaced) return asDecimal;
  if (b.length === 3 && a.length >= 1 && a.length <= 3 && !/^0/.test(a)) return [...make(`${a}${b}`), ...asDecimal];
  return asDecimal;
}

// ---------- quantities ----------

const MONTH_WORDS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|tháng';
const WRITTEN_MONTH_BEFORE_RE = new RegExp(`(?:^|[^\\p{L}])(?:ngày\\s+)?(?:${MONTH_WORDS})\\s*$`, 'iu');
const WRITTEN_MONTH_AFTER_RE = new RegExp(`^\\s*(?:${MONTH_WORDS})\\b`, 'iu');
const YEAR_AFTER_MONTH_RE = new RegExp(`(?:${MONTH_WORDS})\\s*(?:\\d{1,2}\\s*[,.]?\\s*)?(?:năm\\s*)?$`, 'iu');
const CELL_RE = String.raw`\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?`;
const ADDRESS_RUN_RE = new RegExp(`(?:'(?:[^']|'')+'|[A-Za-z_][\\w.]*)!${CELL_RE}|\\b${CELL_RE}\\b`, 'g');
const URL_OR_EMAIL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"')\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;

const maskIdentifiers = (text) => text.replace(URL_OR_EMAIL_RE, (m) => ' '.repeat(m.length));

function isAddressAt(text, start, end) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  ADDRESS_RUN_RE.lastIndex = 0;
  for (const match of line.matchAll(ADDRESS_RUN_RE)) {
    if (start - lineStart >= match.index && end - lineStart <= match.index + match[0].length) return true;
  }
  return false;
}

function isWrittenDateAt(text, start, end) {
  const token = text.slice(start, end);
  let i = start;
  while (i > 0 && !/\s/.test(text[i - 1])) i -= 1;
  let j = end;
  while (j < text.length && !/\s/.test(text[j])) j += 1;
  const before = text.slice(0, i);
  const after = text.slice(j);
  if (WRITTEN_MONTH_BEFORE_RE.test(before) || WRITTEN_MONTH_AFTER_RE.test(after)) return true;
  return /^\d{4}$/.test(token) && YEAR_AFTER_MONTH_RE.test(before);
}

function isListMarkerAt(text, start, end) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  return /^[ \t]*$/.test(text.slice(lineStart, start)) && /^[.)](?:\s|$)/.test(text.slice(end));
}

/**
 * Every quantity of a text as { raw, unit, readings, start, end }. Prose mode applies the four exemptions and nothing
 * else; source mode (tool results, the request) applies none.
 */
export function quantitiesOf(text, { prose = false } = {}) {
  const original = String(text ?? '');
  const source = prose ? maskIdentifiers(original) : original;
  const out = [];
  let consumedTo = 0;
  for (const match of source.matchAll(CANDIDATE_RE)) {
    let start = match.index;
    let digits = match[0];
    if (/^[-+−]/.test(digits)) {
      const prev = start > 0 ? source[start - 1] : '';
      if (prev && /[0-9\p{L}/.\-−:]/u.test(prev)) {
        digits = digits.slice(1);
        start += 1;
      }
    }
    let end = match.index + match[0].length;
    const markers = [];
    const mag = MAG_AFTER_RE.exec(source.slice(end));
    if (mag) {
      markers.push(MAGNITUDE.get(foldAscii(mag[1] ?? mag[2])));
      end += mag[0].length;
    }
    const suffix = SUFFIX_UNIT_RE.exec(source.slice(end));
    if (suffix) {
      if (suffix[1]) markers.push('%');
      else if (UNIT_POLICY.currencyIsMarker) markers.push(currencyKey(suffix[2]));
      end += suffix[0].length;
    } else {
      const prefix = PREFIX_UNIT_RE.exec(source.slice(0, start));
      // A currency word between two quantities belongs to the one before it when that one already took it as a suffix.
      if (prefix && currencyKey(prefix[1]) && start - (prefix[0].length - prefix[0].trimEnd().length) - prefix[1].length >= consumedTo && UNIT_POLICY.currencyIsMarker) markers.push(currencyKey(prefix[1]));
    }
    const unit = markers.length > 0 ? markers.join('+') : null;
    consumedTo = end;
    if (prose && unit === null) {
      if (isAddressAt(source, start, end) || isListMarkerAt(source, start, end) || isWrittenDateAt(source, start, end)) continue;
    }
    out.push({ raw: source.slice(start, end), unit, readings: readingsOf(digits), start, end });
  }
  return out;
}

/** A JSON number is a bare quantity. */
export const quantityOfNumber = (n) => ({ raw: String(n), unit: null, readings: Number.isFinite(n) ? [{ n, dp: exactDp(String(n)) }] : [] });

/** A figure of report.numbers: a JSON number is bare; a string carries whatever unit it is written with. */
export function figureQuantity(value) {
  if (typeof value === 'number') return quantityOfNumber(value);
  if (typeof value !== 'string') return null;
  const found = quantitiesOf(value);
  return found.length === 1 && found[0].raw.trim() === value.trim() ? found[0] : null;
}

// ---------- read-result leaves ----------

const AGGREGATE_VALUE_KEYS = ['sum', 'average', 'min', 'max'];
const cleanCellString = (s) => String(s ?? '').replace(/\s*\[formula\s*=[^\]]*\]/gi, '');

export function isFailedResultPayload(root) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return false;
  if (Boolean(root.error) || Boolean(root.err) || Boolean(root.denied) || root.ok === false || root.partial === true) return true;
  return typeof root.status === 'string' && /^(?:error|failed|denied|refused|partial|incomplete)$/i.test(root.status.trim());
}

/**
 * The value-bearing leaves of one tool result, each a quantity: cell values, aggregate values, document text and
 * table cells. Never envelope keys, addresses, row or column metadata, counts of rows, or the text of a failed result.
 * (The field list is documented at readLeaves' callers; the holdout backend returns structured stand-ins.)
 */
export function readLeaves(text) {
  const out = [];
  const push = (v) => {
    if (typeof v === 'number') { if (Number.isFinite(v)) out.push(quantityOfNumber(v)); return; }
    // A spreadsheet error value (#REF!, #DIV/0!, #ERR60) is the absence of a value, never an operand.
    if (typeof v === 'string' && !/^\s*#[A-Za-z0-9/!?_.]*\s*$/.test(v)) out.push(...quantitiesOf(cleanCellString(v)));
  };
  let root;
  try {
    root = JSON.parse(String(text));
  } catch {
    return [];
  }
  if (isFailedResultPayload(root)) return [];
  if (Array.isArray(root)) { root.forEach(push); return out; }
  if (!root || typeof root !== 'object') { push(root); return out; }
  for (const key of AGGREGATE_VALUE_KEYS) if (root[key] !== undefined) push(root[key]);
  if (root.value !== undefined) push(root.value);
  if (typeof root.text === 'string') push(root.text);
  if (root.cells && typeof root.cells === 'object') Object.values(root.cells).forEach(push);
  if (Array.isArray(root.texts)) root.texts.forEach(push);
  if (Array.isArray(root.rows)) {
    for (const row of root.rows) {
      if (Array.isArray(row)) row.forEach(push);
      else if (row && typeof row === 'object') {
        if (row.cells && typeof row.cells === 'object') Object.values(row.cells).forEach(push);
      } else push(row);
    }
  }
  if (Array.isArray(root.hits)) {
    for (const hit of root.hits) {
      if (hit && typeof hit === 'object') {
        if (hit.value !== undefined) push(hit.value);
        if (typeof hit.line === 'string') push(hit.line);
      }
    }
  }
  if (root.groups && typeof root.groups === 'object') {
    for (const grp of Array.isArray(root.groups) ? root.groups : Object.values(root.groups)) {
      if (grp && typeof grp === 'object') for (const key of AGGREGATE_VALUE_KEYS) if (grp[key] !== undefined) push(grp[key]);
    }
  }
  if (Array.isArray(root.blocks)) {
    for (const blk of root.blocks) {
      if (blk && typeof blk === 'object') {
        if (typeof blk.preview === 'string') push(blk.preview);
        if (typeof blk.text === 'string') push(blk.text);
        if (Array.isArray(blk.rows)) blk.rows.flat(2).forEach(push);
      }
    }
  }
  if (Array.isArray(root.slides)) {
    for (const slide of root.slides) if (slide && typeof slide === 'object' && Array.isArray(slide.texts)) slide.texts.forEach(push);
  }
  if (Array.isArray(root.lines)) root.lines.forEach(push);
  if (Array.isArray(root.frontmatter)) root.frontmatter.forEach(push);
  if (Array.isArray(root.pages)) {
    for (const pg of root.pages) if (pg && typeof pg === 'object' && Array.isArray(pg.lines)) pg.lines.forEach(push);
  }
  return out;
}

/** Every number or string of an applied write's arguments, as source quantities. */
export function argumentLeaves(args) {
  const out = [];
  const walk = (node) => {
    if (typeof node === 'number') { if (Number.isFinite(node)) out.push(quantityOfNumber(node)); } else if (typeof node === 'string') out.push(...quantitiesOf(node));
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(args);
  return out;
}

// ---------- matching ----------

const sameUnit = (a, b) => (a ?? null) === (b ?? null);
const nearEq = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Equal to the target exactly, or after rounding the target to the precision the reply shows for the figure. */
function matchesShown(n, dp, target) {
  if (!Number.isFinite(target)) return false;
  if (nearEq(n, target)) return true;
  if (dp === 0 && Number.isInteger(target)) return false;
  const factor = 10 ** dp;
  return nearEq(n, Math.round(target * factor) / factor) || nearEq(n, Number(target.toFixed(dp)));
}

const readingMatches = (claim, value) => claim.readings.some((r) => matchesShown(r.n, r.dp, value));

const sharesReading = (a, b) => a.readings.some((ra) => b.readings.some((rb) => nearEq(ra.n, rb.n)));

/**
 * The operands of a derivation: leaves of the reads that the reply shows, paired one to one with a shown occurrence
 * of the same value and unit. A value shown twice is two operands only when the reads returned it twice; one returned
 * value is never reused as two. `shown` lists quantity lists (prose, items, report.numbers): an operand counts as
 * often as the busiest of them shows it, so one mention in two places is still one mention.
 */
export function operandsOf(leaves, shownLists) {
  const keyOf = (q) => `${q.unit ?? ''}|${q.readings.map((r) => r.n).join('/')}`;
  const shown = [];
  const byKey = new Map();
  for (const list of shownLists) {
    const counts = new Map();
    for (const q of list) {
      if (q.readings.length === 0) continue;
      counts.set(keyOf(q), (counts.get(keyOf(q)) ?? 0) + 1);
      if (!byKey.has(keyOf(q))) byKey.set(keyOf(q), q);
    }
    for (const [k, n] of counts) shown.push({ k, n });
  }
  const need = new Map();
  for (const { k, n } of shown) need.set(k, Math.max(need.get(k) ?? 0, n));
  const pool = [];
  for (const [k, n] of need) for (let i = 0; i < n; i += 1) pool.push(byKey.get(k));
  const operands = [];
  const used = new Set();
  for (const leaf of leaves) {
    const at = pool.findIndex((q, i) => !used.has(i) && sameUnit(q.unit, leaf.unit) && sharesReading(q, leaf));
    if (at < 0) continue;
    used.add(at);
    const shared = pool[at].readings.find((r) => leaf.readings.some((rl) => nearEq(r.n, rl.n)));
    operands.push({ n: shared.n, unit: leaf.unit });
  }
  return operands;
}

/** Candidates of the permitted derivations: { n, unit } with unit null for a bare ratio or percent. */
function derivationCandidates(operands) {
  const out = [];
  const byUnit = new Map();
  for (const op of operands) byUnit.set(op.unit ?? '', [...(byUnit.get(op.unit ?? '') ?? []), op.n]);
  for (const [unit, values] of byUnit) {
    const u = unit === '' ? null : unit;
    if (values.length >= 2) out.push({ n: values.reduce((a, b) => a + b, 0), unit: u, kind: 'sum' });
    for (let i = 0; i < values.length; i += 1) {
      for (let j = i + 1; j < values.length; j += 1) {
        const a = values[i];
        const b = values[j];
        out.push({ n: a + b, unit: u, kind: 'sum' }, { n: a - b, unit: u, kind: 'sum' }, { n: b - a, unit: u, kind: 'sum' });
        if (b !== 0) out.push({ n: a / b, unit: null, kind: 'ratio' }, { n: (a / b) * 100, unit: null, kind: 'percent' });
        if (a !== 0) out.push({ n: b / a, unit: null, kind: 'ratio' }, { n: (b / a) * 100, unit: null, kind: 'percent' });
      }
    }
  }
  return out;
}

/** Does the claim equal a permitted derivation of the operands (no direct read involved)? */
export function derivesFrom(claim, operands, { ignoreUnit = false } = {}) {
  if (claim.readings.length === 0) return false;
  return derivationCandidates(operands).some((cand) => {
    const unitFits = ignoreUnit || (claim.unit === '%' ? cand.kind === 'percent' || cand.unit === '%' : cand.unit === (claim.unit ?? null));
    return unitFits && readingMatches(claim, cand.n);
  });
}

/**
 * Traces one claim { unit, readings }. ctx = { reads: [{ q, compute }], extra: [{ q, tag }], operands }.
 * Returns { by: 'read' | 'compute' | 'derived' | 'request' | 'write' | null, unitOnly }: `unitOnly` marks an
 * untraceable figure that would trace if its unit were ignored (reported, never credited).
 */
export function traceClaim(claim, ctx, { ignoreUnit = false } = {}) {
  if (claim.readings.length === 0) {
    const raw = claim.raw.trim();
    const hit = ctx.reads.find((r) => r.q.raw.trim() === raw && (ignoreUnit || sameUnit(r.q.unit, claim.unit)));
    return hit ? { by: hit.compute ? 'compute' : 'read' } : { by: null };
  }
  const unitOk = (u) => ignoreUnit || sameUnit(u, claim.unit);
  const reads = ctx.reads.filter((r) => unitOk(r.q.unit) && r.q.readings.some((rv) => readingMatches(claim, rv.n)));
  if (reads.length > 0) return { by: reads.some((r) => r.compute) ? 'compute' : 'read' };
  const extra = ctx.extra.find((e) => unitOk(e.q.unit) && e.q.readings.some((rv) => readingMatches(claim, rv.n)));
  if (extra) return { by: extra.tag };
  return derivesFrom(claim, ctx.operands, { ignoreUnit }) ? { by: 'derived' } : { by: null };
}

/** Traceable-or-not with the loss reason: { by, unitOnly }. */
export function tracedFigure(claim, ctx) {
  const strict = traceClaim(claim, ctx);
  if (strict.by) return strict;
  return { by: null, unitOnly: traceClaim(claim, ctx, { ignoreUnit: true }).by !== null };
}
