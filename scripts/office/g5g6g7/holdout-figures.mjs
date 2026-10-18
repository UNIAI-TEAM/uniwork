// Figure oracle for the G7-12 holdout adapter (UNI-1874 round f, USER option B, 2026-10-18).
//
// Principle: prose never earns credit, it can only fail an answer. A figure the reply states (in its prose or in
// report.numbers) must be traceable to one of
//   (a) a value-bearing leaf of a SUCCESSFUL data-read result of this turn, per call and with multiplicity;
//   (b) the result of a successful compute/aggregate call (its leaves are leaves of (a));
//   (c) a permitted derivation of operands that BOTH a read returned AND the reply shows: the sum or difference of two,
//       the ratio or percent of two, or the sum of all of them; never a product, never one value used twice.
//   (d) the number of elements of a NAMED kind in ONE successful read result (slides, paragraphs, heading levels, rows,
//       sheets, pages, lines), or a named count field of that same result (slideCount, paragraphCount, lineCount,
//       pageCount), but only when the reply or report.items names that kind; never across reads, never an inferred kind.
//       The kind is named by a CLOSED phrase right beside the figure (or by the item's own anchor), never by a word further on, and a
//       modified kind ("changed paragraphs") names nothing. The level digit of a heading-level phrase is a LABEL, not a count (R21-1).
// The values of APPLIED writes are a further source, listed in EXTRA_SOURCES so the lead can switch it off. The user's own
// request is NOT a source (review-g712-20 G712-R20-2): a number copied from the question is never a figure. A PROSE figure that
// merely echoes a question number (same value and same unit or marker, `echoesQuestion`) is exempt from the trace: it cannot fail
// an answer, and it credits nothing (it is no source, no operand, no count and fills no numeric slot).
//
// A quantity keeps its unit: a figure with a unit or magnitude marker (k, m, bn, tr, triệu, tỷ, nghìn, ngàn, %, a
// currency) matches only a source value with the same marker, or a percent derivation for %. A bare number never
// matches a marked value and a marked one never matches a bare value; there is no conversion and no unconditional
// x100 or /100. vi and en grouping and decimal styles are both read; a token ambiguous between styles matches when
// either reading is traceable. One exception, for report.numbers ONLY: its figures are plain numbers by protocol (the
// footer says percentages in percent units), so a plain report number also traces to a "%" leaf or compute result of the
// same value; every other marker and a currency contradiction stay strict there, and prose stays strict (round h, H-1).
// Spelled-out numbers are not tokenized and never earn credit (a known limit).
// Exempt from being a figure, and nothing else: cell or range addresses with real boundaries, line-start list
// markers, unambiguous written-month dates, and the digits inside a whole URL or email token.
// A location ordinal is a further exemption of the PROSE trace, and nothing else (round j, J-1): a plain integer directly after a singular
// location noun (slide, page, sheet, trang, trang chiếu) that a successful read of this turn holds (`heldLocation`). It credits nothing:
// it names no count, is no operand and fills no numeric slot, and report.numbers has no such exemption.

import { UNIT_TOKENS } from './holdout-score.mjs';

export const EXTRA_SOURCES = { request: false, appliedWrites: true };
// Currency (lead answer Q1, 2026-10-18): a currency word or sign is PRESENTATION on an amount, not a unit. With
// `currencyIsMarker: false` (the default) it is dropped from the unit, so "1.234.000 đồng" matches a bare cell 1234000, and
// it is kept on the quantity as `currency`. `currencyMustNotContradict` then fails a figure whose currency is not one the
// source itself shows (read text, number format, header, document text): "USD60" against a VND document. When the source
// shows no currency anywhere any label passes (documented residual). Percent and magnitude markers stay strict markers.
// `currencyIsMarker: true` is the literal contract reading (a currency is a unit); the rescore measures both.
export const UNIT_POLICY = { currencyIsMarker: false, currencyMustNotContradict: true };

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
    let currency = null;
    const mag = MAG_AFTER_RE.exec(source.slice(end));
    if (mag) {
      markers.push(MAGNITUDE.get(foldAscii(mag[1] ?? mag[2])));
      end += mag[0].length;
    }
    const suffix = SUFFIX_UNIT_RE.exec(source.slice(end));
    if (suffix) {
      if (suffix[1]) markers.push('%');
      else if (UNIT_POLICY.currencyIsMarker) markers.push(currencyKey(suffix[2]));
      else currency = currencyKey(suffix[2]) ?? null;
      end += suffix[0].length;
    } else {
      const prefix = PREFIX_UNIT_RE.exec(source.slice(0, start));
      // A currency word between two quantities belongs to the one before it when that one already took it as a suffix.
      if (prefix && currencyKey(prefix[1]) && start - (prefix[0].length - prefix[0].trimEnd().length) - prefix[1].length >= consumedTo) {
        if (UNIT_POLICY.currencyIsMarker) markers.push(currencyKey(prefix[1]));
        else currency = currencyKey(prefix[1]);
      }
    }
    const unit = markers.length > 0 ? markers.join('+') : null;
    consumedTo = end;
    if (prose && unit === null && currency === null) {
      if (isAddressAt(source, start, end) || isListMarkerAt(source, start, end) || isWrittenDateAt(source, start, end)) continue;
    }
    out.push({ raw: source.slice(start, end), unit, currency, readings: readingsOf(digits), start, end });
  }
  return out;
}

// Unambiguous currency spellings only: the bare letter "d" and a "$" inside a cell address are not currency evidence.
const SOURCE_CURRENCY_RE = /(?<![\p{L}\d])(vnđ|vnd|đồng|dong|usd|eur|jpy|cny|yên|nhân dân tệ)(?![\p{L}\d])|₫|€|(?<![\p{L}\d$])\$(?=[\d\s"\]\-]|$)|(?<=\d)\$(?![\p{L}\d])/giu;

/** The currency families a source text shows anywhere (cells, number formats, headers, document text). */
export function currenciesIn(text) {
  const found = new Set();
  const plain = String(text ?? '').replace(/\s*\[formula\s*=[^\]]*\]/gi, '');
  for (const m of plain.matchAll(SOURCE_CURRENCY_RE)) {
    const key = currencyKey(m[1] ?? m[0]);
    if (key) found.add(key);
  }
  return found;
}

/** A JSON number is a bare quantity. */
export const quantityOfNumber = (n) => ({ raw: String(n), unit: null, currency: null, readings: Number.isFinite(n) ? [{ n, dp: exactDp(String(n)) }] : [] });

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
 *
 * PARITY LIMIT (review-g712-19 R19-7), stated plainly: this extractor reads the STRUCTURED JSON that the holdout backend
 * (`holdout-backend.mjs`, `createBackend`) returns as a stand-in for each tool: `rows[].cells.*`, `cells.*`, `hits[].value`,
 * aggregate `sum|average|min|max` (also under `groups`, an object keyed by group name), `blocks[].{preview,text,rows}`,
 * `slides[].texts`, `pages[].lines`, `lines`, `text`, `frontmatter`. The real frame returns TEXT: each tool of the frame
 * answers with a `ToolExecution.output` string (a read-range table, a formatted aggregate sentence). The frame tools live in
 * `/home/ubuntu/projects/uniwork-office/apps/sheets/src/renderer/ai/tools.ts` (`read_range` output built near line 879 with
 * `formatCellScalar` at line 771, `aggregate_range` output `formatRangeAggregate` at line 946, `read_cells` near line 1054,
 * `find_cells` near line 1132) and in the sibling files `apps/docs`, `apps/pdf`, `apps/markdown` and `apps/html` under
 * `src/renderer/ai/tools.ts` (no `ai/tools.ts` was found under apps/slides at this commit). No text parser exists here: a frame-shaped text
 * envelope would supply no operand, and parity with the frame is NOT claimed. Failed results (an `error` field, ok:false,
 * partial, a failed status) and spreadsheet error values supply nothing.
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

// ---------- trace (d): the number of elements of a named kind in ONE successful read ----------

// ONE table of kind names (vi and en). A name is matched as a whole phrase, so a modified kind ("changed paragraphs",
// "table rows") has no kind here and earns nothing. "dòng" is a row or a line: either reading may trace.
const COUNT_LEAD = '(?:(?:the |a )?(?:total |tong )?(?:number of|count of|no of|so luong|so)\\s+|(?:total|tong so|tong)\\s+)?';
const COUNT_TAIL = '(?:\\s+(?:count|total|number))?';
const KIND_WORDS = [
  ['slides', 'slides?|trang chieu'],
  ['paragraphs', 'paragraphs?|doan van|doan'],
  ['rows', 'rows?|hang|dong'],
  ['sheets', 'sheets?|sheet names?|trang tinh|bang tinh'],
  ['pages', 'pages?|trang'],
  ['lines', 'lines?|dong'],
].map(([kind, words]) => ({ kind, re: new RegExp(`^${COUNT_LEAD}(?:${words})${COUNT_TAIL}$`) }));
// A heading level is named as "heading 2" / "headings level 2" / "level 2 headings" / "h2 headings"; "section" and "mục" name a
// heading level only beside an explicit level word ("level 2 sections", "mục cấp 2"), never a bare "section 2" or "mục 2".
const HEADING_WORDS = 'headings?|tieu de';
const SECTION_WORDS = 'sections?|muc';
const HEADING_RES = [
  new RegExp(`^${COUNT_LEAD}(?:${HEADING_WORDS})(?: level| lvl| cap)? ([1-6])${COUNT_TAIL}$`),
  new RegExp(`^${COUNT_LEAD}(?:level|lvl|cap) ([1-6]) (?:${HEADING_WORDS}|${SECTION_WORDS})${COUNT_TAIL}$`),
  new RegExp(`^${COUNT_LEAD}(?:${SECTION_WORDS}) (?:level|lvl|cap) ([1-6])${COUNT_TAIL}$`),
  new RegExp(`^${COUNT_LEAD}h ([1-6]) (?:${HEADING_WORDS})${COUNT_TAIL}$`),
];

const countPhrase = (name) => foldAscii(
  String(name ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2'),
).replace(/[_\-./:,]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The kinds a name stands for: ['slides'], ['heading_level_2'], ['rows', 'lines'] for "dòng", [] for no kind. */
export function kindsOfName(name) {
  const phrase = countPhrase(name);
  if (phrase === '') return [];
  const kinds = KIND_WORDS.filter(({ re }) => re.test(phrase)).map(({ kind }) => kind);
  for (const re of HEADING_RES) {
    const level = re.exec(phrase)?.[1];
    if (level) kinds.push(`heading_level_${level}`);
  }
  return kinds;
}

const isCount = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const HEADING_STYLE_RE = /^(?:heading|tieu de)([1-6])$/;
const HTML_HEADING_RE = /<h([1-6])[\s>]/i;
const MD_HEADING_RE = /^ {0,3}(#{1,6})[ \t]+\S/;

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The text of a line outside HTML comments (`state.comment` carries an open comment to the next line). */
function outsideComments(line, state) {
  let out = '';
  let rest = line;
  for (;;) {
    if (state.comment) {
      const end = rest.indexOf('-->');
      if (end < 0) return out;
      rest = rest.slice(end + 3);
      state.comment = false;
    }
    const start = rest.indexOf('<!--');
    if (start < 0) return out + rest;
    out += rest.slice(0, start);
    rest = rest.slice(start + 4);
    state.comment = true;
  }
}

/**
 * The heading counts per level (index 1..6) of the lines of a markdown or html read. A fenced code block is no heading
 * source: it opens at a run of three or more backticks or tildes and closes only at a run of the same mark at least as long
 * (R21-4). HTML comments and inline code hold no heading either.
 */
function headingLevelsOfLines(lines) {
  const levels = new Array(7).fill(0);
  let fence = null;
  const state = { comment: false };
  for (const line of lines) {
    if (typeof line !== 'string') continue;
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence.mark && f[1].length >= fence.len && f[2].trim() === '') fence = null;
      continue;
    }
    if (!state.comment && f && !(f[1][0] === '`' && f[2].includes('`'))) { fence = { mark: f[1][0], len: f[1].length }; continue; }
    const visible = outsideComments(line, state);
    const level = MD_HEADING_RE.exec(visible)?.[1].length ?? Number(HTML_HEADING_RE.exec(visible.replace(/`[^`]*`/g, ' '))?.[1] ?? 0);
    if (level > 0) levels[level] += 1;
  }
  return levels;
}

/**
 * The traceable counts of ONE tool result: [{ kind, n }], from the length of an element array and from a named count
 * field of the same result. A failed result gives none. Counts are never added across results.
 */
export function countsOf(text) {
  let root;
  try {
    root = JSON.parse(String(text));
  } catch {
    return [];
  }
  if (!root || typeof root !== 'object' || Array.isArray(root) || isFailedResultPayload(root)) return [];
  const out = [];
  const add = (kind, n) => { if (isCount(n)) out.push({ kind, n }); };
  const arrays = (kind, key) => { if (Array.isArray(root[key])) add(kind, root[key].length); };
  add('slides', root.slideCount);
  arrays('slides', 'slides');
  add('paragraphs', root.paragraphCount);
  arrays('paragraphs', 'blocks');
  arrays('rows', 'rows');
  add('sheets', root.sheetCount);
  arrays('sheets', 'sheets');
  arrays('sheets', 'sheetNames');
  add('pages', root.pageCount);
  arrays('pages', 'pages');
  add('lines', root.lineCount);
  arrays('lines', 'lines');
  if (Array.isArray(root.blocks)) {
    const levels = new Array(7).fill(0);
    for (const b of root.blocks) {
      const level = b && typeof b === 'object' ? Number(HEADING_STYLE_RE.exec(foldAscii(b.style ?? '').replace(/[\s_-]+/g, ''))?.[1] ?? 0) : 0;
      if (level > 0) levels[level] += 1;
    }
    levels.forEach((n, level) => { if (level > 0 && n > 0) add(`heading_level_${level}`, n); });
  }
  if (Array.isArray(root.lines)) headingLevelsOfLines(root.lines).forEach((n, level) => { if (level > 0 && n > 0) add(`heading_level_${level}`, n); });
  return out;
}

/** The sheet names ONE successful result lists: `sheetName`, `sheetNames`, `sheets[].name`. A failed result lists none. */
export function sheetNamesOf(text) {
  let root;
  try {
    root = JSON.parse(String(text));
  } catch {
    return [];
  }
  if (!root || typeof root !== 'object' || Array.isArray(root) || isFailedResultPayload(root)) return [];
  const names = [root.sheetName, ...(Array.isArray(root.sheetNames) ? root.sheetNames : []), ...(Array.isArray(root.sheets) ? root.sheets.map((s) => s?.name) : [])];
  return names.filter((n) => typeof n === 'string' && n !== '');
}

// The location nouns of the reply, in ONE table (round j, J-1): an integer right after one is a LOCATION ("slide 3",
// "trang 2"), the place a value was read, not a figure. The vi "trang" is a page or a slide, "trang chiếu" a slide.
const LOCATION_KINDS = new Map([['slide', ['slides']], ['page', ['pages']], ['sheet', ['sheets']], ['trang', ['pages', 'slides']], ['trang chieu', ['slides']]]);
const LOCATION_RE = /(?<![\p{L}\d])(trang\s+chieu|trang|slide|page|sheet)(?:\s*#|\s+no\.?|\s+so)?\s*$/u;

/**
 * The kinds ('slides', 'pages', 'sheets') whose element a prose figure is the ORDINAL of, or null: a plain integer
 * directly after a singular location noun, with nothing between but "#", "no." or "số". The plural is a kind name
 * ("slides: 3"), never a location.
 */
export function locationKindsOf(text, q) {
  if (q.unit || q.currency || !/^\d+$/.test(q.raw) || q.readings.length !== 1 || q.readings[0].n < 1) return null;
  const m = LOCATION_RE.exec(foldAscii(String(text ?? '').slice(Math.max(0, q.start - 40), q.start)));
  return m ? LOCATION_KINDS.get(m[1].replace(/\s+/g, ' ')) : null;
}

/**
 * Does a successful read of this turn hold the location? A slide or page index is at most the count of that kind in ONE
 * result (slideCount, pageCount, the array length); a sheet index is at most the sheet count, or a sheet is named that
 * way. Nothing else holds a location, and a held location is exempt from the trace only: it credits nothing (J-1).
 */
export function heldLocation(kinds, q, ctx) {
  if (!kinds || !Array.isArray(ctx.counts)) return false;
  const index = q.readings[0].n;
  if (ctx.counts.some((c) => kinds.includes(c.kind) && c.n >= index)) return true;
  return kinds.includes('sheets') && ctx.sheetNames instanceof Set && ctx.sheetNames.has(q.raw);
}

const SENTENCE_END_RE = /[.!?;\n]/;
const CONNECTORS = new Set(['is', 'are', 'was', 'were', 'be', 'la', 'co', 'gom', 'bang', 'of', 'only', 'total', 'in']);
// Words that may stand right before a kind phrase without modifying it ("the slides", "number of sheets"); any other word
// before it makes a modified kind ("changed paragraphs"), which names nothing.
const KIND_LEAD_OK = new Set([...CONNECTORS, 'the', 'a', 'an', 'there', 'this', 'that', 'these', 'those', 'number', 'count', 'so', 'luong', 'tong', 'and', 'va', 'with', 'has', 'have']);
const wordsOf = (text) => foldAscii(text).match(/[\p{L}\d]+/gu) ?? [];

/**
 * The kinds a reply names right beside one of its figures: "3 slides", "4 level 2 headings", "slides: 3", "number of sheets is 3".
 * The kind is a closed phrase that starts right after the figure, or ends right before it (past a connector); no window
 * slides onto a later content word, and a modified kind ("3 changed paragraphs") names nothing (R21-2).
 */
export function kindsNear(text, q) {
  const source = String(text ?? '');
  const tail = source.slice(q.end, q.end + 80);
  const after = wordsOf(tail.slice(0, (SENTENCE_END_RE.exec(tail) ?? { index: tail.length }).index));
  for (let len = 1; len <= 4; len += 1) {
    const kinds = kindsOfName(after.slice(0, len).join(' '));
    if (kinds.length > 0) return kinds;
  }
  const head = source.slice(Math.max(0, q.start - 80), q.start);
  const before = wordsOf(head.split(/[.!?;\n]/).at(-1));
  while (before.length > 0 && CONNECTORS.has(before.at(-1))) before.pop();
  for (let len = 1; len <= 4; len += 1) {
    const kinds = kindsOfName(before.slice(-len).join(' '));
    const lead = before.at(-len - 1);
    if (kinds.length > 0 && (lead === undefined || KIND_LEAD_OK.has(lead))) return kinds;
  }
  return [];
}

const headingLevelOf = (kind) => Number(/^heading_level_(\d)$/.exec(kind)?.[1] ?? 0);

/**
 * The heading-level kind a prose figure is the LABEL digit of ("level 2 headings", "headings level 2", "h2 headings"), or
 * null: the figure sits inside a closed heading-level phrase whose level is its own value. A label is no count of anything.
 * A bare "section 2" / "mục 2" is a label too, but only when a report.items anchor already names that heading level (`namedKinds`).
 */
export function labelKindOf(text, q, namedKinds = null) {
  if (q.unit || q.currency) return null;
  const level = q.readings.length === 1 && q.readings[0].dp === 0 ? q.readings[0].n : 0;
  if (!(level >= 1 && level <= 6)) return null;
  const sentence = (s) => s.split(/[.!?;\n]/).at(-1);
  const before = wordsOf(sentence(String(text ?? '').slice(Math.max(0, q.start - 80), q.start)));
  const after = wordsOf(String(text ?? '').slice(q.end, q.end + 80).split(/[.!?;\n]/)[0]);
  const digit = String(level);
  for (let b = 0; b <= 3; b += 1) {
    for (let a = 0; a <= 3; a += 1) {
      const phrase = [...before.slice(before.length - b), digit, ...after.slice(0, a)].join(' ');
      if (kindsOfName(phrase).includes(`heading_level_${level}`)) return `heading_level_${level}`;
    }
  }
  return /^(?:sections?|muc)$/.test(before.at(-1) ?? '') && namedKinds?.has(`heading_level_${level}`) ? `heading_level_${level}` : null;
}

/** Is a figure of value `n` the count of one of `kinds` in ONE successful read of this turn? */
export const backedCount = (kinds, n, ctx) => Array.isArray(ctx.counts) && ctx.counts.some((c) => kinds.includes(c.kind) && nearEq(c.n, n));

// The label digit of a heading-level phrase in prose, when the read really holds headings of that level (c.n > 0). It is a
// label, never a count: only a prose figure carries `labelKind` (report.numbers and the items-only fill never do).
const labelTraced = (claim, ctx) => Boolean(claim.labelKind) && claim.fromReport !== true && Array.isArray(ctx.counts)
  && claim.readings.some((r) => r.dp === 0 && r.n === headingLevelOf(claim.labelKind))
  && ctx.counts.some((c) => c.kind === claim.labelKind && c.n > 0);

/**
 * Does the figure equal the count of a kind in ONE successful read that the reply (items or prose) names? The level digit
 * of a named heading-level phrase in prose is that kind's own label: it traces when the read holds headings of that level.
 */
export function tracedByCount(claim, ctx) {
  if (claim.unit !== null && claim.unit !== undefined) return false;
  if (claim.currency || !Array.isArray(ctx.counts)) return false;
  const named = (kind, n) => ctx.namedKinds?.has(kind) || ctx.proseKinds?.get(n)?.has(kind);
  return labelTraced(claim, ctx) || ctx.counts.some((c) => claim.readings.some((r) => r.dp === 0 && nearEq(r.n, c.n) && named(c.kind, c.n)));
}

/** A figure of report.numbers that the prose writes in percent units is a percent figure (`pctFromProse`), not a bare one. */
export function withProsePercent(q, proseQs) {
  if (!q || q.unit !== null || q.readings.length === 0 || q.currency) return q;
  const same = (p) => p.readings.some((rp) => q.readings.some((rq) => nearEq(rp.n, rq.n)));
  const inPercent = proseQs.some((p) => p.unit === '%' && same(p));
  return inPercent && !proseQs.some((p) => p.unit === null && !p.currency && same(p)) ? { ...q, pctFromProse: true } : q;
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
    if (values.length >= 2) {
      out.push({ n: values.reduce((a, b) => a + b, 0), unit: u, kind: 'sum' });
      out.push({ n: values.reduce((a, b) => a + b, 0) / values.length, unit: u, kind: 'average' });
    }
    // The signed sum over ALL shown operands (each + or -), only for 3..6 operands; never a subset of them.
    if (values.length >= 3 && values.length <= 6) {
      for (let mask = 1; mask < 2 ** values.length; mask += 1) {
        out.push({ n: values.reduce((acc, v, i) => acc + (mask & (1 << i) ? -v : v), 0), unit: u, kind: 'sum' });
      }
    }
    for (let i = 0; i < values.length; i += 1) {
      for (let j = i + 1; j < values.length; j += 1) {
        const a = values[i];
        const b = values[j];
        out.push({ n: a + b, unit: u, kind: 'sum' }, { n: a - b, unit: u, kind: 'sum' }, { n: b - a, unit: u, kind: 'sum' });
        if (b !== 0) out.push({ n: a / b, unit: null, kind: 'ratio' }, { n: (a / b) * 100, unit: null, kind: 'percent' });
        if (a !== 0) out.push({ n: b / a, unit: null, kind: 'ratio' }, { n: (b / a) * 100, unit: null, kind: 'percent' });
        // Percent change, in percent units only: ((b - a) / a) * 100 of two shown operands, either order. A claim must
        // be written in percent units to match it (R20-3); derivesFrom enforces that through kind 'pchange'.
        if (a !== 0) out.push({ n: ((b - a) / a) * 100, unit: null, kind: 'pchange' });
        if (b !== 0) out.push({ n: ((a - b) / b) * 100, unit: null, kind: 'pchange' });
      }
    }
  }
  // The product of two shown operands: bare x bare, or a marked amount x a bare count; two marked amounts never multiply.
  for (let i = 0; i < operands.length; i += 1) {
    for (let j = i + 1; j < operands.length; j += 1) {
      const a = operands[i];
      const b = operands[j];
      if (a.unit !== null && b.unit !== null) continue;
      out.push({ n: a.n * b.n, unit: a.unit ?? b.unit ?? null, kind: 'product' });
    }
  }
  return out;
}

/** Does the claim equal a permitted derivation of the operands (no direct read involved)? */
export function derivesFrom(claim, operands, { ignoreUnit = false } = {}) {
  if (claim.readings.length === 0) return false;
  return derivationCandidates(operands).some((cand) => {
    // A percent change is a percent figure: a bare claim never matches it, unless it is the plain number of report.numbers
    // for a figure the prose writes in percent units (`pctFromProse`, set by withProsePercent).
    const inPercent = claim.unit === '%' || claim.pctFromProse === true;
    const unitFits = ignoreUnit
      ? true
      : claim.unit === '%'
        ? cand.kind === 'percent' || cand.kind === 'pchange' || cand.unit === '%'
        : cand.kind === 'pchange' ? inPercent : cand.unit === (claim.unit ?? null);
    return unitFits && readingMatches(claim, cand.n);
  });
}

/**
 * Traces one claim { unit, readings }. ctx = { reads: [{ q, compute }], extra: [{ q, tag }], operands, counts, namedKinds, proseKinds, countMarked: Map(value -> [kinds of each marking item]) }.
 * Returns { by: 'read' | 'compute' | 'derived' | 'count' | 'request' | 'write' | null, unitOnly }: `unitOnly` marks an
 * untraceable figure that would trace if its unit were ignored (reported, never credited).
 */
export function traceClaim(claim, ctx, { ignoreUnit = false } = {}) {
  // A plain figure that report.items marks as a count traces ONLY as the count its own item states, backed by a successful read
  // (never as a text leaf that happens to hold the same integer, review-g712-20 L1G), and only when EVERY marking item of that
  // value is backed (R21-3). A figure with a unit or currency (a percent leaf) never takes this path.
  if (labelTraced(claim, ctx)) return { by: 'count' };
  if (claim.readings.length > 0 && !claim.unit && !claim.currency && ctx.countMarked instanceof Map) {
    const marked = claim.readings.find((r) => ctx.countMarked.has(r.n));
    if (marked) return ctx.countMarked.get(marked.n).every((kinds) => backedCount(kinds, marked.n, ctx)) ? { by: 'count' } : { by: null };
  }
  if (claim.readings.length === 0) {
    const raw = claim.raw.trim();
    const hit = ctx.reads.find((r) => r.q.raw.trim() === raw && (ignoreUnit || sameUnit(r.q.unit, claim.unit)));
    return hit ? { by: hit.compute ? 'compute' : 'read' } : { by: null };
  }
  // report.numbers is plain numbers by protocol (footer: percentages in percent units), so a plain report number carries no
  // unit and may trace to a read leaf or compute result shown with exactly "%" (not to an applied-write value, R21-5). No other
  // marker relaxes (round h, H-1).
  const percentLeafOk = claim.fromReport === true && !claim.unit && !claim.currency;
  const unitOk = (u) => ignoreUnit || sameUnit(u, claim.unit);
  const readUnitOk = (u) => unitOk(u) || (percentLeafOk && u === '%');
  const reads = ctx.reads.filter((r) => readUnitOk(r.q.unit) && r.q.readings.some((rv) => readingMatches(claim, rv.n)));
  if (reads.length > 0) return { by: reads.some((r) => r.compute) ? 'compute' : 'read' };
  const extra = ctx.extra.find((e) => unitOk(e.q.unit) && e.q.readings.some((rv) => readingMatches(claim, rv.n)));
  if (extra) return { by: extra.tag };
  if (derivesFrom(claim, ctx.operands, { ignoreUnit })) return { by: 'derived' };
  return tracedByCount(claim, ctx) ? { by: 'count' } : { by: null };
}

/**
 * Is a PROSE figure an echo of the question: the same value AND the same unit, marker and currency as a number the question
 * states (USER 2026-10-18, round i)? An echo never fails an answer and never credits anything: the question is no figure
 * source (EXTRA_SOURCES.request stays false), and the exemption is applied only to prose, never to report.numbers.
 */
export function echoesQuestion(q, questionQs) {
  if (!q || q.readings.length === 0) return false;
  return questionQs.some((w) => sameUnit(w.unit, q.unit) && (w.currency ?? null) === (q.currency ?? null)
    && w.readings.some((wr) => q.readings.some((r) => nearEq(wr.n, r.n))));
}

/**
 * The prose figures that only repeat what the question already states, by occurrence: for every value and unit or marker the
 * question writes N times (the busiest of its texts, so a vi and an en wording of one question are not two mentions), the first
 * N matching prose figures are the echo and no more. They are no shown operand of a derivation (round k, R22-1); a further
 * mention of the same value is the answer's own and stays one. Returns the indexes into `proseQs`.
 */
export function echoOccurrences(proseQs, questionTexts) {
  const keyOf = (q, r) => `${q.unit ?? ''}|${q.currency ?? ''}|${r.n}`;
  const budget = new Map();
  for (const text of questionTexts) {
    const own = new Map();
    for (const w of quantitiesOf(String(text ?? ''), { prose: true })) {
      for (const r of w.readings) own.set(keyOf(w, r), (own.get(keyOf(w, r)) ?? 0) + 1);
    }
    for (const [k, n] of own) budget.set(k, Math.max(budget.get(k) ?? 0, n));
  }
  const echoes = new Set();
  proseQs.forEach((q, i) => {
    const key = q.readings.map((r) => keyOf(q, r)).find((k) => (budget.get(k) ?? 0) > 0);
    if (key === undefined) return;
    budget.set(key, budget.get(key) - 1);
    echoes.add(i);
  });
  return echoes;
}

/** Traceable-or-not with the loss reason: { by, unitOnly }. */
export function tracedFigure(claim, ctx) {
  const strict = traceClaim(claim, ctx);
  if (strict.by && contradictsSourceCurrency(claim, ctx)) return { by: null, unitOnly: true, currency: true };
  if (strict.by) return strict;
  return { by: null, unitOnly: traceClaim(claim, ctx, { ignoreUnit: true }).by !== null };
}

/** A currency written on a figure that is not one the source shows; false when the source shows none (documented residual). */
function contradictsSourceCurrency(claim, ctx) {
  if (UNIT_POLICY.currencyIsMarker || !UNIT_POLICY.currencyMustNotContradict) return false;
  const shown = ctx.sourceCurrencies;
  return Boolean(claim.currency) && shown instanceof Set && shown.size > 0 && !shown.has(claim.currency);
}
