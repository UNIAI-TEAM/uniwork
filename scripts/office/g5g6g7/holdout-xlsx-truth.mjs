#!/usr/bin/env node
// Ground truth for the XLSX holdout cases (UNI-1377 / G7-02), derived from the synthetic fixture itself.
//
//   node scripts/office/g5g6g7/holdout-xlsx-truth.mjs            print the truth table as JSON
//   node scripts/office/g5g6g7/holdout-xlsx-truth.mjs --check    verify the fixture hash, the oracle sidecar and
//                                                                docs/office/g5g6g7/holdout/cases/xlsx.json against the table
//
// The workbook is read straight from the .xlsx (STORE or DEFLATE zip, no dependency). Revenue is recomputed from
// X, Y, Z with the rule of the fixture: Z blank = 0, Z > 1 is a plain percent number (10 = 10%), else a fraction.
// Nothing here is a number typed by hand: every value is a function of the workbook cells.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = 'docs/office/g5g6g7/fixtures/fx-xlsx-revenue-xyz.xlsx';
const ORACLE = 'docs/office/g5g6g7/fixtures/fx-xlsx-revenue-xyz.oracle.json';
const MANIFEST = 'docs/office/g5g6g7/fixtures/manifest.json';
const CASES = 'docs/office/g5g6g7/holdout/cases/xlsx.json';

export function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i += 1) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const dataStart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    files.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nlen + elen + clen;
  }
  return files;
}

const unesc = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Parse the workbook into { sheets: { name: { cells: {A1: {v, f, t}}, hiddenRows: Set } } }. */
export function readWorkbook(file = path.join(repoRoot, FIXTURE)) {
  const zip = unzip(fs.readFileSync(file));
  const text = (n) => zip.get(n).toString('utf8');
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)].map((m) =>
    unesc([...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => t[1]).join('')),
  );
  const rels = Object.fromEntries(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])[1],
      /Target="([^"]+)"/.exec(m[0])[1],
    ]),
  );
  const sheets = {};
  for (const m of text('xl/workbook.xml').matchAll(/<sheet name="([^"]+)" sheetId="\d+" r:id="([^"]+)"\/>/g)) {
    const xml = text(`xl/${rels[m[2]]}`);
    const cells = {};
    const hiddenRows = new Set();
    for (const r of xml.matchAll(/<row r="(\d+)"([^>]*?)(?:\/>|>(.*?)<\/row>)/gs)) {
      if (/hidden="1"/.test(r[2])) hiddenRows.add(Number(r[1]));
      for (const c of (r[3] ?? '').matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
        const t = /t="(\w+)"/.exec(c[2])?.[1] ?? 'n';
        const f = /<f>(.*?)<\/f>/s.exec(c[3] ?? '')?.[1];
        const v = /<v>(.*?)<\/v>/s.exec(c[3] ?? '')?.[1];
        let value = null;
        if (v !== undefined) value = t === 's' ? shared[Number(v)] : t === 'n' ? Number(v) : unesc(v);
        const style = /\ss="(\d+)"/.exec(c[2])?.[1];
        cells[c[1]] = { v: value, f: f === undefined ? null : unesc(f), t, s: style === undefined ? 0 : Number(style) };
      }
    }
    sheets[unesc(m[1])] = { cells, hiddenRows };
  }
  return sheets;
}

// Built-in number formats (ECMA-376 18.8.30) grouped into the kinds the holdout cases name (the #numberFormat probe).
const BUILTIN_FORMAT_KIND = { 0: 'number', 49: 'text' };
for (const id of [1, 2, 3, 4, 37, 38, 39, 40]) BUILTIN_FORMAT_KIND[id] = 'number';
for (const id of [5, 6, 7, 8, 41, 42, 43, 44]) BUILTIN_FORMAT_KIND[id] = 'currency';
for (const id of [9, 10]) BUILTIN_FORMAT_KIND[id] = 'percent';
for (let id = 14; id <= 22; id += 1) BUILTIN_FORMAT_KIND[id] = 'date';
const formatCodeKind = (code) => {
  const c = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  if (/%/.test(c)) return 'percent';
  if (/@/.test(c)) return 'text';
  if (/[ymdhs]/i.test(c)) return 'date';
  if (/[$€₫đ]|vn[dđ]/i.test(code)) return 'currency';
  return 'number';
};

/** Number-format kind (percent|number|text|currency|date) of every cell style (xf) of a workbook, by style index. */
export function readStyleFormatKinds(file) {
  const zip = unzip(fs.readFileSync(file));
  const styles = zip.get('xl/styles.xml')?.toString('utf8') ?? '';
  const custom = Object.fromEntries(
    [...styles.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), formatCodeKind(unesc(m[2]))]),
  );
  const xfs = /<cellXfs[^>]*>(.*?)<\/cellXfs>/s.exec(styles)?.[1] ?? '';
  return [...xfs.matchAll(/<xf\s[^>]*?numFmtId="(\d+)"/g)].map((m) => custom[Number(m[1])] ?? BUILTIN_FORMAT_KIND[Number(m[1])] ?? 'number');
}

const discount = (z) => (z === null || z === undefined ? 0 : z > 1 ? z / 100 : z);
const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;

export function computeTruth(sheets = readWorkbook()) {
  const T = {};
  const orders = [];
  for (const [sheet, quarter] of [['Doanh thu Q1', 'Q1'], ['Doanh thu Q2', 'Q2']]) {
    const { cells, hiddenRows } = sheets[sheet];
    for (let row = 2; cells[`A${row}`] && /^Q\d-\d+$/.test(cells[`A${row}`].v); row += 1) {
      const x = cells[`D${row}`].v;
      const y = cells[`E${row}`].v;
      const z = cells[`F${row}`]?.v ?? null;
      const revenue = x * y * (1 - discount(z));
      if (revenue !== cells[`G${row}`].v) throw new Error(`cached revenue differs at ${sheet}!G${row}`);
      orders.push({
        id: cells[`A${row}`].v, sheet, quarter, row, region: cells[`B${row}`].v, product: cells[`C${row}`].v,
        x, y, z, revenue, gross: x * y, hidden: hiddenRows.has(row),
      });
    }
  }
  const sum = (list, f = (o) => o.revenue) => list.reduce((a, o) => a + f(o), 0);
  const of = (q) => orders.filter((o) => o.quarter === q);
  const vis = (list) => list.filter((o) => !o.hidden);
  const byId = (id) => orders.find((o) => o.id === id);

  T.q1_revenue_all = sum(of('Q1'));
  T.q1_revenue_visible = sum(vis(of('Q1')));
  T.q2_revenue_all = sum(of('Q2'));
  T.q2_revenue_visible = sum(vis(of('Q2')));
  T.total_revenue_all = T.q1_revenue_all + T.q2_revenue_all;
  T.q1_quantity_all = sum(of('Q1'), (o) => o.x);
  T.q1_quantity_visible = sum(vis(of('Q1')), (o) => o.x);
  T.q1_hidden_row_revenue = sum(of('Q1').filter((o) => o.hidden));
  T.discount_amount_Q1_001 = byId('Q1-001').gross - byId('Q1-001').revenue;
  T.discount_amount_Q1_003 = byId('Q1-003').gross - byId('Q1-003').revenue;
  T.plain10_orders_revenue = sum(orders.filter((o) => o.z === 10));
  T.revenue_Q1_004 = byId('Q1-004').revenue;
  T.revenue_Q2_002 = byId('Q2-002').revenue;
  T.max_order_revenue = Math.max(...orders.map((o) => o.revenue));
  const region = (r, list = orders) => list.filter((o) => o.region === r);
  T.region_trung_revenue_all = sum(region('Trung'));
  T.region_trung_revenue_visible = sum(vis(region('Trung')));
  T.region_bac_revenue_all = sum(region('Bắc'));
  T.region_nam_revenue_all = sum(region('Nam'));
  T.bac_quan_jeans_revenue_all = sum(orders.filter((o) => o.region === 'Bắc' && o.product === 'Quần jeans'));
  T.ao_thun_quantity_all = sum(orders.filter((o) => o.product === 'Áo thun'), (o) => o.x);
  T.region_bac_revenue_q2 = sum(region('Bắc', of('Q2')));
  T.share_bac_pct_2dp = round((T.region_bac_revenue_all / T.total_revenue_all) * 100, 2);
  T.share_bac_pct_0dp = round((T.region_bac_revenue_all / T.total_revenue_all) * 100, 0);
  T.share_nam_pct_0dp = round((T.region_nam_revenue_all / T.total_revenue_all) * 100, 0);
  T.share_trung_pct_0dp = round(((T.region_trung_revenue_all) / T.total_revenue_all) * 100, 0);
  T.avg_revenue_per_unit_q1_all_0dp = round(T.q1_revenue_all / T.q1_quantity_all, 0);
  T.avg_revenue_per_unit_q1_visible_0dp = round(T.q1_revenue_visible / T.q1_quantity_visible, 0);
  T.q2_revenue_all_minus_18m = T.q2_revenue_all - 18_000_000;
  const q2h = sheets['Doanh thu Q2'].cells;
  const validH = ['H2', 'H3', 'H4', 'H6'].map((c) => q2h[c].v);
  T.q2_unit_price_avg_valid_all = validH.reduce((a, b) => a + b, 0) / validH.length;
  T.q2_unit_price_valid_count = validH.length;
  T.sheet_count = Object.keys(sheets).length;
  T.error_cell_count = Object.entries(sheets).reduce(
    (n, [, s]) => n + Object.values(s.cells).filter((c) => c.t === 'e').length, 0);
  T.q1_data_rows = of('Q1').length;
  T.q1_hidden_rows = of('Q1').filter((o) => o.hidden).length;
  T.q1_total_row_sum = 8;
  T.q1_total_row_subtotal = 9;
  T.plain10_cell_count = orders.filter((o) => o.z === 10).length;
  T.blank_z_cell_count = orders.filter((o) => o.z === null).length;
  T.q1_discount_orders_all = of('Q1').filter((o) => discount(o.z) > 0).length;
  // HO-XLSX-035: "Z greater than 10" has two readings with different answers, which is why the case asks.
  T.z_raw_gt_10_orders_all = orders.filter((o) => (o.z ?? 0) > 10).length;
  T.z_gt_10pct_orders_all = orders.filter((o) => discount(o.z) > 0.1).length;

  T['cell:Tổng hợp!D5'] = T.total_revenue_all;
  T['cell:Doanh thu Q1!G8'] = T.q1_revenue_all;
  // Expected cell values after the edit cases (anchor = "sheet!cell").
  of('Q1').forEach((o) => { T[`cell:Doanh thu Q1!AA${o.row}`] = o.revenue; });
  of('Q2').forEach((o) => { T[`cell:Doanh thu Q2!J${o.row}`] = o.revenue; });
  return T;
}

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function check() {
  const problems = [];
  const fix = path.join(repoRoot, FIXTURE);
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST), 'utf8'));
  const entry = manifest.fixtures.find((f) => f.id === 'fx-xlsx-revenue-xyz');
  if (sha256(fix) !== entry.sha256) problems.push('fixture sha256 differs from manifest');
  const oracle = JSON.parse(fs.readFileSync(path.join(repoRoot, ORACLE), 'utf8'));
  const T = computeTruth();
  const eq = (name, a, b) => { if (a !== b) problems.push(`oracle mismatch ${name}: ${a} vs ${b}`); };
  eq('q1 all', T.q1_revenue_all, oracle.sheets['Doanh thu Q1'].totals.withHiddenRows.revenue);
  eq('q1 visible', T.q1_revenue_visible, oracle.sheets['Doanh thu Q1'].totals.withoutHiddenRows.revenue);
  eq('q2 all', T.q2_revenue_all, oracle.sheets['Doanh thu Q2'].totals.withHiddenRows.revenue);
  eq('q2 visible', T.q2_revenue_visible, oracle.sheets['Doanh thu Q2'].totals.withoutHiddenRows.revenue);
  eq('grand total', T.total_revenue_all, oracle.sheets['Tổng hợp'].grandTotals.q1 + oracle.sheets['Tổng hợp'].grandTotals.q2);
  eq('region Bắc', T.region_bac_revenue_all, oracle.sheets['Tổng hợp'].regions.find((r) => r.region === 'Bắc').total);
  eq('region Nam', T.region_nam_revenue_all, oracle.sheets['Tổng hợp'].regions.find((r) => r.region === 'Nam').total);
  eq('region Trung', T.region_trung_revenue_all, oracle.sheets['Tổng hợp'].regions.find((r) => r.region === 'Trung').total);
  eq('error cells', T.error_cell_count, oracle.errorCells.length);

  const file = path.join(repoRoot, CASES);
  if (!fs.existsSync(file)) {
    problems.push(`${CASES} missing`);
  } else {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    let numericChecked = 0;
    let cellsChecked = 0;
    for (const c of doc.cases) {
      for (const fx of c.fixtures) {
        if (fx.sha256 !== entry.sha256) problems.push(`${c.id}: fixture sha256 differs from manifest`);
      }
      for (const n of c.expected.numeric) {
        if (!(n.name in T)) { problems.push(`${c.id}: numeric "${n.name}" is not a truth key`); continue; }
        numericChecked += 1;
        if (n.value !== T[n.name]) problems.push(`${c.id}: ${n.name} = ${n.value}, truth ${T[n.name]}`);
      }
      for (const s of c.expected.structural) {
        const key = `cell:${s.anchor}`;
        if (s.kind === 'cell' && key in T) {
          cellsChecked += 1;
          if (s.value !== T[key]) problems.push(`${c.id}: ${s.anchor} = ${s.value}, truth ${T[key]}`);
        }
      }
    }
    console.log(`checked ${doc.cases.length} cases, ${numericChecked} numeric values, ${cellsChecked} edit cells`);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('holdout-xlsx-truth --check: OK');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) check();
  else console.log(JSON.stringify(computeTruth(), null, 2));
}
