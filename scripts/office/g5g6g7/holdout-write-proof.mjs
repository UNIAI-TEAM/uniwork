// What the arguments of an applied write prove about an edit (G7-12, UNI-1384). The answer adapter calls these to decide
// whether a cell, a heading or a table cell that the model REPORTS as edited is backed by what the write tool was given.
//
// A write argument is whatever object the model sent; the shape of a real tool is not fixed here, so the helpers read it
// structurally: an "operation object" is any object of the arguments, its address is a range string it holds directly,
// its values are the scalars and arrays it holds directly (nested objects are operations of their own). An address and a
// value count together only inside ONE operation object, never from unrelated parts of the arguments (G712-17).

import { toNumber } from './holdout-score.mjs';

// Keys that describe or switch a call but never carry what is written: ignored when looking for content.
const CONTROL_KEYS = new Set(['dryRun', 'dry_run', 'note', 'reason', 'explanation', 'comment']);
const SHEET_KEYS = ['sheet', 'sheetId', 'sheetName', 'sheet_name', 'sheet_id'];
const NUMBER_TOKEN_RE = /\d[\d.,]*\d|\d/g;

const isScalar = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const colNumber = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const norm = (text) => String(text ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** A cell or range string, optionally sheet-qualified, as { sheet, c1, r1, c2, r2 }; null when the text is not one. */
export function parseRangeText(text) {
  if (typeof text !== 'string') return null;
  const bang = text.lastIndexOf('!');
  const sheet = bang >= 0 ? text.slice(0, bang).trim().replace(/^'(.*)'$/, '$1') : null;
  const m = /^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/.exec(text.slice(bang + 1).replace(/\$/g, '').trim().toUpperCase());
  if (!m) return null;
  const c1 = colNumber(m[1]);
  const r1 = Number(m[2]);
  const c2 = m[3] ? colNumber(m[3]) : c1;
  const r2 = m[4] ? Number(m[4]) : r1;
  return { sheet, c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1: Math.min(r1, r2), r2: Math.max(r1, r2) };
}

/** Every leaf (string or finite number) of the arguments outside the control keys. */
function leaves(node, out = []) {
  if (Array.isArray(node)) node.forEach((el) => leaves(el, out));
  else if (node !== null && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) if (!CONTROL_KEYS.has(key)) leaves(child, out);
  } else if ((typeof node === 'string' && node.trim() !== '') || (typeof node === 'number' && Number.isFinite(node))) out.push(node);
  return out;
}

/** Does a write carry anything to write (a text or a number outside the control keys)? `{}`, `{ dryRun: false }` and a note alone do not. */
export const hasContent = (args) => leaves(args).length > 0;

/** The applied writes of a write log that carry content. */
export const contentfulWrites = (writeLog) => (writeLog ?? []).filter((w) => w.applied && hasContent(w.args));

/** Does the text of the writes carry the value? Numbers compare as numbers (so "22.060.000" and 22060000 agree), text as folded text. */
export function valueInWrites(writes, value) {
  const all = writes.flatMap((w) => leaves(w.args ?? {}));
  const wanted = toNumber(value);
  if (wanted !== null) {
    const numbers = all.flatMap((leaf) => (typeof leaf === 'number' ? [leaf] : (leaf.match(NUMBER_TOKEN_RE) ?? []).map(toNumber)));
    return numbers.some((n) => n !== null && Math.abs(n - wanted) < 1e-9);
  }
  const needle = norm(value);
  return needle !== '' && all.some((leaf) => norm(leaf).includes(needle));
}

/** Operation objects of the arguments, each with the sheet it inherits from an enclosing object. */
function* operations(node, sheet = null) {
  if (Array.isArray(node)) { for (const el of node) yield* operations(el, sheet); return; }
  if (node === null || typeof node !== 'object') return;
  const own = SHEET_KEYS.map((k) => node[k]).find((v) => typeof v === 'string' && v.trim() !== '') ?? sheet;
  yield { node, sheet: own };
  for (const [key, child] of Object.entries(node)) if (!CONTROL_KEYS.has(key) && child !== null && typeof child === 'object') yield* operations(child, own);
}

/** What one operation object holds directly: its addresses, its other scalars and its arrays (matrices of values). */
function holdings(node) {
  const ranges = [];
  const scalars = [];
  const arrays = [];
  for (const [key, value] of Object.entries(node)) {
    if (CONTROL_KEYS.has(key) || SHEET_KEYS.includes(key)) continue;
    if (isScalar(value)) { const range = parseRangeText(value); if (range) ranges.push(range); else scalars.push(value); }
    else if (Array.isArray(value)) arrays.push(value);
  }
  return { ranges, scalars, arrays };
}

function sameSheet(wanted, have, sheetNames) {
  if (!have) return true;
  if (norm(have) === norm(wanted)) return true;
  const byIndex = /^sheet-(\d+)$/i.exec(String(have).trim());
  return Boolean(byIndex) && norm(sheetNames[Number(byIndex[1]) - 1]) === norm(wanted);
}

/** The matrix entry for a cell of the range: a 2D grid by row and column, a column or row list, else row-major. */
function matrixAt(matrix, range, row, col) {
  const ro = row - range.r1;
  const co = col - range.c1;
  if (matrix.length > 0 && matrix.every(Array.isArray)) return matrix[ro]?.[co];
  const width = range.c2 - range.c1 + 1;
  if (width === 1) return matrix[ro];
  if (range.r1 === range.r2) return matrix[co];
  return matrix[ro * width + co];
}

/** A formula as compared (G712-25): case, spaces, absolute-reference `$` and the leading `=` do not matter. */
export const normalizeFormula = (text) => String(text ?? '').toLowerCase().replace(/[\s$]+/g, '').replace(/^=+/, '');

/**
 * 'value' when the leaf is the wanted value (a percent string "10%" is 0.1), 'formula' for a formula string, else null.
 * With `expectFormula` (the item expects a formula) a formula leaf counts only when it equals the expected one (G712-25, G712-27).
 */
function judgeLeaf(leaf, value, expectFormula) {
  if (expectFormula && typeof leaf === 'string') {
    // The expectation decides the branch (G712-27): a case may spell its formula with or without the leading `=`. A leaf equal to the
    // expected formula is the formula whatever its `=` when the case spells it without one; when the case spells it with one, a text
    // leaf lacking `=` is no formula write. A leaf with `=` that is not the expected formula never credits.
    const sameFormula = normalizeFormula(leaf) === normalizeFormula(value);
    if (leaf.trim().startsWith('=')) return sameFormula ? 'formula' : null;
    if (sameFormula && !String(value).trim().startsWith('=')) return 'formula';
  } else if (typeof leaf === 'string' && leaf.trim().startsWith('=')) return 'formula';
  if (leaf === null || leaf === undefined || typeof leaf === 'object') return null;
  const wanted = toNumber(value);
  if (wanted !== null) {
    const n = toNumber(leaf);
    if (n === null) return null;
    const pct = typeof leaf === 'string' && leaf.trim().endsWith('%');
    return Math.abs((pct ? n / 100 : n) - wanted) < 1e-9 ? 'value' : null;
  }
  return norm(leaf) === norm(value) ? 'value' : null;
}

/** Operation objects whose address covers the cell (on the right sheet), with the range that covers it. */
function* operationsCovering(writes, anchorBase, sheetNames) {
  const at = anchorBase.includes('!') ? anchorBase.slice(anchorBase.lastIndexOf('!') + 1) : anchorBase;
  const wantedSheet = anchorBase.includes('!') ? anchorBase.slice(0, anchorBase.lastIndexOf('!')) : '';
  const cell = parseRangeText(at);
  if (!cell) return;
  for (const write of writes) {
    for (const { node, sheet } of operations(write.args ?? {})) {
      const held = holdings(node);
      for (const range of held.ranges) {
        const covers = cell.c1 >= range.c1 && cell.c1 <= range.c2 && cell.r1 >= range.r1 && cell.r1 <= range.r2;
        if (covers && (wantedSheet === '' || sameSheet(wantedSheet, range.sheet ?? sheet, sheetNames))) yield { held, range, cell };
      }
    }
  }
}

/**
 * Does ONE applied write operation carry both the address of the cell and the value for it? Returns 'value', 'formula' (the
 * operation puts a formula at the cell: the harness cannot evaluate it, so it compares the formula text when `expectFormula`) or null.
 * A value written at another cell, or another value at this cell, proves nothing.
 */
export function cellProof(writes, anchorBase, value, { sheetNames = [], expectFormula = false } = {}) {
  let best = null;
  for (const { held, range, cell } of operationsCovering(writes, anchorBase, sheetNames)) {
    const candidates = [...held.scalars, ...held.arrays.map((m) => matrixAt(m, range, cell.r1, cell.c1))];
    for (const leaf of candidates) {
      const verdict = judgeLeaf(leaf, value, expectFormula);
      if (verdict === 'value') return 'value';
      if (verdict === 'formula') best = 'formula';
    }
  }
  return best;
}

/** Does an applied operation that covers the cell name a percent format (a `%` or the word percent in a scalar beside the address)? */
export function percentFormatProof(writes, anchorBase, { sheetNames = [] } = {}) {
  for (const { held } of operationsCovering(writes, anchorBase, sheetNames)) {
    if (held.scalars.some((s) => typeof s === 'string' && /%|percent/i.test(s))) return true;
  }
  return false;
}

// ---- what an edit keeps and what it introduces (G712-16) ----

// Keys that say WHERE or HOW a write acts, not what it writes: their values are never content.
const LOCATOR_KEY_RE = /^(sheet\w*|selection|anchor|selector|range|address|cell|target|path|type|op|operation|kind|action|mode|id)$|(index|page|slide|row|col|column|line|offset|position|start|end)$/i;

const TAG_RE = /<[^>]*>/g;
const MARKDOWN_LEAD_RE = /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;

/** The ways one line of a document may be written as a unit (raw, without tags, without a markdown marker, one markdown table cell). */
function unitVariants(line) {
  const raw = norm(line);
  const plain = norm(line.replace(TAG_RE, ' '));
  const out = new Set([raw, plain, norm(line.replace(MARKDOWN_LEAD_RE, ''))]);
  if (line.includes('|')) for (const cell of line.split('|')) out.add(norm(cell));
  out.delete('');
  return out;
}

const sourceUnits = (sourceText) => new Set(String(sourceText ?? '').split('\n').flatMap((line) => [...unitVariants(line)]));
const sourceNumbers = (sourceText) => (String(sourceText ?? '').match(NUMBER_TOKEN_RE) ?? []).map(toNumber).filter((n) => n !== null);

/**
 * Is the value already part of the document as it was opened? A number is when the text carries that number (grouping and
 * percent aside); a text is only when it equals a whole line, markdown cell or tag-free element of the document, so a
 * heading or cell that an edit shortens or extends is never mistaken for one the edit left alone.
 */
export function presentInSource(sourceText, value) {
  const wanted = toNumber(value);
  if (wanted !== null) return sourceNumbers(sourceText).some((n) => Math.abs(n - wanted) < 1e-9);
  const needle = norm(value);
  return needle !== '' && sourceUnits(sourceText).has(needle);
}

/** Content leaves of one write (outside control, sheet and locator keys, and cell addresses), each as { text } or { number }. */
function contentLeaves(node, key = '', out = []) {
  if (Array.isArray(node)) node.forEach((el) => contentLeaves(el, key, out));
  else if (node !== null && typeof node === 'object') {
    for (const [k, child] of Object.entries(node)) if (!CONTROL_KEYS.has(k)) contentLeaves(child, k, out);
  } else if (!LOCATOR_KEY_RE.test(key)) {
    if (typeof node === 'string' && node.trim() !== '' && parseRangeText(node) === null) out.push({ text: node });
    else if (typeof node === 'number' && Number.isFinite(node)) out.push({ number: node });
  }
  return out;
}

/** Does the write put anything into the document that it did not already hold (a text that is no existing line, a number the document lacks)? */
export function introducesNew(args, sourceText) {
  // A configuration operation (review-g712-16 A2) changes the document without introducing any text: a page setup or a
  // freeze is a real edit even though every leaf it carries is a locator or a setting, so it is never "what the
  // document already held". The structural proof of the case decides whether the operation is the expected one.
  if (configOps(args ?? {}).length > 0) return true;
  const units = sourceUnits(sourceText);
  const numbers = sourceNumbers(sourceText);
  return contentLeaves(args ?? {}).some((leaf) => ('text' in leaf ? !units.has(norm(leaf.text)) : !numbers.some((n) => Math.abs(n - leaf.number) < 1e-9)));
}

// ---- configuration operations (review-g712-16 A2) ----

// The product's discriminator keys of a propose_operations operation (workbook-dsl.ts: `op`); the harness and the
// frame also accept `type`, so both are read.
const OP_TYPE_KEYS = ['op', 'type', 'operation', 'kind', 'action'];
// A cell write names an address; a configuration operation never does. An operation with one of these is a cell write,
// so it is proven by cellProof (its address and value), not as a configuration.
const ADDRESS_KEYS = ['address', 'range', 'cell', 'anchor', 'target', 'values'];

const opTypeOf = (node) => OP_TYPE_KEYS.map((k) => node[k]).find((v) => typeof v === 'string' && v.trim() !== '') ?? null;

/** The scalar settings of one operation object: its own entries besides the control, sheet and type keys. */
function opSettings(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (CONTROL_KEYS.has(key) || SHEET_KEYS.includes(key) || OP_TYPE_KEYS.includes(key)) continue;
    if (isScalar(value)) out.push({ key, value });
  }
  return out;
}

/** The sheet an operation names, resolved to the workbook's own name when it names a `sheet-N` index. */
function resolveSheetName(have, sheetNames) {
  if (!have) return null;
  const byIndex = /^sheet-(\d+)$/i.exec(String(have).trim());
  if (byIndex && sheetNames[Number(byIndex[1]) - 1]) return sheetNames[Number(byIndex[1]) - 1];
  return String(have).trim();
}

/** Every configuration operation of one write's arguments: a typed operation object carrying at least one setting. */
export function configOps(args) {
  const out = [];
  for (const { node } of operations(args ?? {})) {
    const type = opTypeOf(node);
    if (!type) continue;
    if (ADDRESS_KEYS.some((k) => node[k] !== undefined)) continue;
    const settings = opSettings(node);
    if (settings.length === 0) continue;
    const sheet = SHEET_KEYS.map((k) => node[k]).find((v) => typeof v === 'string' && v.trim() !== '') ?? null;
    out.push({ type, sheet, settings });
  }
  return out;
}

/** Parses a `config_op` expectation `sheet|key=value,key=value` into { sheet, keys } (the keys in their written order). */
function parseConfigSpec(text) {
  const s = String(text ?? '');
  const bar = s.indexOf('|');
  if (bar <= 0) return null;
  const sheet = s.slice(0, bar).trim();
  const keys = s.slice(bar + 1).split(',').map((part) => part.split('=')[0].trim()).filter(Boolean);
  return sheet && keys.length > 0 ? { sheet, keys } : null;
}

/** `<sheet>|<key>=<observed>,…` for the keys the expectation names, or null when the operation carries no such setting. */
function canonicalConfig(sheet, keys, op) {
  const parts = [];
  for (const key of keys) {
    const hit = op.settings.find((s) => norm(s.key) === norm(key));
    if (!hit) return null;
    parts.push(`${key}=${hit.value}`);
  }
  return `${sheet}|${parts.join(',')}`;
}

/**
 * Proves a configuration edit (review-g712-16 A2) from the APPLIED propose_operations arguments: an operation of the
 * expected type on the expected sheet, carrying every setting the expectation names. Returns the observed canonical
 * `sheet|key=value,…` — the observed values, never the expected ones, so the scorer's own value comparison still
 * decides whether they are the expected settings — or null when no applied operation is this configuration.
 */
export function configOpProof(writes, type, expectedSpec, sheetNames = []) {
  const spec = parseConfigSpec(expectedSpec);
  if (!spec) return null;
  for (const write of writes) {
    for (const op of configOps(write.args ?? {})) {
      if (norm(op.type) !== norm(type)) continue;
      if (!op.sheet || !sameSheet(spec.sheet, op.sheet, sheetNames)) continue;
      const canonical = canonicalConfig(resolveSheetName(op.sheet, sheetNames), spec.keys, op);
      if (canonical !== null) return canonical;
    }
  }
  return null;
}
