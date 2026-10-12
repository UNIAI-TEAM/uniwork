import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32 } from './fixtures-lib/zip.mjs';
import { FIXTURE_DIR, MANIFEST_PATH, checkDisk, generateAll } from './make-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REQUIRED_IDS = [
  'fx-xlsx-revenue-xyz',
  'fx-docx-report-vi',
  'fx-pptx-deck-vi',
  'fx-pdf-invoice-vi',
  'fx-md-notes-vi',
  'fx-html-page-vi',
];
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel));
const manifest = JSON.parse(read(MANIFEST_PATH).toString('utf8'));

/** Reads a STORE-only zip (what the generator writes): [{name, crc, data, time, date}] from the central directory. */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const time = buf.readUInt16LE(at + 12);
    const date = buf.readUInt16LE(at + 14);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    entries.push({ name, method, time, date, crc, data: buf.subarray(dataStart, dataStart + size) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test('two generations are byte-identical (fixtures, oracles, manifest)', () => {
  const a = generateAll();
  const b = generateAll();
  assert.equal(a.manifestText, b.manifestText);
  assert.equal(a.fixtures.length, b.fixtures.length);
  a.fixtures.forEach((fixture, i) => {
    assert.ok(fixture.bytes.equals(b.fixtures[i].bytes), `${fixture.path} differs between runs`);
    assert.equal(fixture.oracleText, b.fixtures[i].oracleText, `${fixture.oraclePath} differs between runs`);
  });
});

test('committed files equal the generator output, with no unexpected files', () => {
  assert.deepEqual(checkDisk(generateAll()), []);
});

test('manifest lists the six required formats and matches the files byte for byte', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'uniwork-office-g5g6g7-fixtures');
  const ids = manifest.fixtures.map((f) => f.id);
  for (const id of REQUIRED_IDS) assert.ok(ids.includes(id), `manifest lacks ${id}`);
  assert.equal(new Set(ids).size, ids.length, 'duplicate fixture id');
  assert.deepEqual(
    new Set(manifest.fixtures.map((f) => f.format)),
    new Set(['xlsx', 'docx', 'pptx', 'pdf', 'md', 'html']),
  );
  for (const entry of manifest.fixtures) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.equal(entry.synthetic, true);
    assert.ok(entry.path.startsWith(`${FIXTURE_DIR}/`));
    assert.ok(entry.description.length > 0);
    assert.ok(Array.isArray(entry.features) && entry.features.length > 0, `${entry.id} lists no features`);
    const bytes = read(entry.path);
    assert.equal(sha256(bytes), entry.sha256, `${entry.path} hash differs from the manifest`);
    assert.equal(bytes.length, entry.bytes, `${entry.path} size differs from the manifest`);
    const oracleBytes = read(entry.oracle);
    const oracle = JSON.parse(oracleBytes.toString('utf8'));
    assert.equal(oracle.fixtureId, entry.id);
    assert.equal(oracle.fixtureSha256, entry.sha256);
    // The sidecar is committed too, so AC-3's hash listing has to cover it.
    assert.match(entry.oracleSha256, /^[0-9a-f]{64}$/, `${entry.id} has no oracleSha256`);
    assert.equal(sha256(oracleBytes), entry.oracleSha256, `${entry.oracle} hash differs from the manifest`);
  }
});

test('--list prints the sha256 of every committed fixture AND its oracle sidecar', () => {
  const listed = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/office/g5g6g7/make-fixtures.mjs'), '--list'], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const lines = listed.stdout.split('\n').filter(Boolean).map((line) => line.split('  '));
  assert.equal(lines.length, manifest.fixtures.length * 2, 'every fixture and its sidecar is listed');
  for (const entry of manifest.fixtures) {
    assert.ok(lines.some(([hash, file]) => hash === entry.sha256 && file === entry.path), `${entry.path} is not listed`);
    assert.ok(lines.some(([hash, file]) => hash === entry.oracleSha256 && file === entry.oracle), `${entry.oracle} is not listed`);
    // What is printed is what is on disk, so a reader can diff it against sha256sum.
    assert.equal(sha256(read(entry.path)), entry.sha256);
    assert.equal(sha256(read(entry.oracle)), entry.oracleSha256);
  }
  assert.equal(new Set(lines.map(([, file]) => file)).size, lines.length, 'no path is listed twice');
});

test('OOXML fixtures are valid STORE zips with fixed metadata and sorted entries', () => {
  for (const entry of manifest.fixtures.filter((f) => ['xlsx', 'docx', 'pptx'].includes(f.format))) {
    const entries = readZip(read(entry.path));
    const names = entries.map((e) => e.name);
    assert.equal(names[0], '[Content_Types].xml');
    assert.deepEqual(names.slice(1), [...names.slice(1)].sort());
    assert.equal(new Set(names).size, names.length);
    for (const e of entries) {
      assert.equal(e.method, 0);
      assert.equal(e.time, 0);
      assert.equal(e.date, ((2026 - 1980) << 9) | (1 << 5) | 1);
      assert.equal(crc32(e.data), e.crc, `${e.name} crc`);
    }
    assert.ok(!names.some((n) => n.includes('comments')), `${entry.id} carries comments`);
  }
});

test('XLSX carries every trait the spec requires', () => {
  const entries = new Map(readZip(read(`${FIXTURE_DIR}/fx-xlsx-revenue-xyz.xlsx`)).map((e) => [e.name, e.data.toString('utf8')]));
  const workbook = entries.get('xl/workbook.xml');
  for (const sheet of ['Doanh thu Q1', 'Doanh thu Q2', 'Tổng hợp', 'Ghi chú']) assert.ok(workbook.includes(`name="${sheet}"`));
  const q1 = entries.get('xl/worksheets/sheet1.xml');
  const q2 = entries.get('xl/worksheets/sheet2.xml');
  const summary = entries.get('xl/worksheets/sheet3.xml');
  assert.match(q1, /<row r="6" hidden="1">/);
  assert.match(q2, /<row r="6" hidden="1">/);
  assert.match(q1, /<c r="F4"><v>10<\/v><\/c>/, 'Z stored as the plain number 10');
  assert.match(q1, /<c r="F2" s="3"><v>0\.1<\/v><\/c>/, 'Z stored as 10% (percent format)');
  assert.match(q1, /<c r="F5" s="0"\/>|<c r="F5"\/>/, 'blank Z cell');
  assert.match(q1, /<f>SUM\(G2:G7\)<\/f><v>22060000<\/v>/);
  assert.match(q1, /SUBTOTAL\(109,G2:G7\)<\/f><v>18660000<\/v>/);
  assert.match(q2, /t="e"><f>G5\/D5<\/f><v>#DIV\/0!<\/v>/);
  assert.match(q2, /t="e"><f>VLOOKUP\(A2[^<]*<\/f><v>#N\/A<\/v>/);
  assert.match(summary, /t="e"><f>#REF!<\/f><v>#REF!<\/v>/);
  assert.ok(entries.get('xl/sharedStrings.xml').includes('Doanh thu (đồng)'));
  const oracle = JSON.parse(read(`${FIXTURE_DIR}/fx-xlsx-revenue-xyz.oracle.json`).toString('utf8'));
  assert.equal(oracle.sheets['Doanh thu Q1'].totals.withHiddenRows.revenue, 22060000);
  assert.equal(oracle.sheets['Doanh thu Q1'].totals.withoutHiddenRows.revenue, 18660000);
  assert.deepEqual(oracle.errorCells.map((c) => c.error), ['#DIV/0!', '#N/A', '#REF!']);
});

test('the XLSX oracle documents the share basis of Tổng hợp column E and the Z > 1 rule', () => {
  const oracle = JSON.parse(read(`${FIXTURE_DIR}/fx-xlsx-revenue-xyz.oracle.json`).toString('utf8'));
  const share = oracle.sheets['Tổng hợp'].shareColumn;
  assert.equal(share.column, 'E');
  assert.equal(share.basis, 'Q1+Q2', 'column E shares over Q1+Q2, unlike the Q1-only share in the text formats');
  assert.equal(share.denominator, oracle.sheets['Tổng hợp'].grandTotals.q1 + oracle.sheets['Tổng hợp'].grandTotals.q2);
  // Q1+Q2 total of the first region over the grand total = 49,7% (the figure the reviewer recomputed).
  assert.deepEqual(share.rows.map((r) => r.shareText), ['49,7%', '27,7%', '22,6%']);
  assert.deepEqual(share.rows.map((r) => r.cell), ['E2', 'E3', 'E4']);
  assert.ok(share.rows.every((r) => Math.abs(r.share - r.total / share.denominator) < 1e-12));
  assert.equal(share.totalCell, 'E5');
  assert.match(share.formula, /\$D\$5/, 'column E divides the row total by the grand total');
  // The E column is a share, so it must not be confused with the raw totals column D.
  assert.equal(share.rows[0].total, oracle.sheets['Tổng hợp'].regions[0].total);
  // F10: the Z > 1 threshold is stated, so a future Z of exactly 1 is a known trap.
  assert.match(oracle.zRuleNote, /Z>1/, 'the oracle states the discount rule it encodes');
  assert.match(oracle.zRuleNote, /exactly 1/);
  assert.match(oracle.shareBasisNote, /Q1\+Q2/);
});

test('PDF has a text layer, one page and embedded fonts; MD/HTML carry their markers', () => {
  const pdf = read(`${FIXTURE_DIR}/fx-pdf-invoice-vi.pdf`);
  assert.equal(pdf.toString('latin1', 0, 8), '%PDF-1.7');
  const text = pdf.toString('latin1');
  assert.match(text, /\/Count 1 /);
  assert.match(text, /\/FontFile2 /);
  assert.match(text, /\/ToUnicode /);
  assert.ok(!text.includes('/Encrypt'));
  const md = read(`${FIXTURE_DIR}/fx-md-notes-vi.md`).toString('utf8');
  assert.match(md, /^# .+\n/);
  assert.match(md, /\| --- \| ---: \| ---: \|/);
  assert.match(md, /```excel\n/);
  assert.ok(!md.includes('\r'));
  const html = read(`${FIXTURE_DIR}/fx-html-page-vi.html`).toString('utf8');
  assert.match(html, /<html lang="vi">/);
  assert.match(html, /<table>/);
  assert.ok(!/<script|https?:\/\//.test(html));
});
