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

/** 'value' when the leaf is the wanted value (a percent string "10%" is 0.1), 'formula' for a formula string, else null. */
function judgeLeaf(leaf, value) {
  if (typeof leaf === 'string' && leaf.trim().startsWith('=')) return 'formula';
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
 * operation puts a formula at the cell: the harness cannot evaluate it, so the address is all it can prove) or null.
 * A value written at another cell, or another value at this cell, proves nothing.
 */
export function cellProof(writes, anchorBase, value, { sheetNames = [] } = {}) {
  let best = null;
  for (const { held, range, cell } of operationsCovering(writes, anchorBase, sheetNames)) {
    const candidates = [...held.scalars, ...held.arrays.map((m) => matrixAt(m, range, cell.r1, cell.c1))];
    for (const leaf of candidates) {
      const verdict = judgeLeaf(leaf, value);
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
