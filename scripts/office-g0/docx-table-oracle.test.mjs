// UNI-667 node:test suite for the DOCX table-cycle oracle.
//
// Every case reads the REAL immutable G0 kitchen-sink fixture and repacks a
// package in memory (ZIP + OOXML) that carries exactly one authored edit, so the
// oracle is driven against genuine fixture bytes rather than a hand-written XML
// string. The positive case proves a surgical single-cell save passes; the
// negative cases prove the oracle REJECTS a save that changed the wrong cell,
// dropped the table, rewrote a neighbour, or never changed the file at all.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import {
  DocxTableOracleError,
  ORACLE_ID,
  assessDocxTableBytes,
  assessDocxTableFile,
  bodyParagraphTexts,
  cellAt,
  partNames,
  readTables,
  readZipParts,
  requiredPart,
  tableStructure,
  tableTextGrid,
  textOf,
  xmlSegments,
} from './docx-table-oracle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = (process.env.OFFICE_G0_FIXTURES_DIR || '').trim() || path.resolve(here, '..', '..', 'lab', 'fixtures');
const FIXTURE_PATH = path.join(fixturesDir, 'g0-kitchen-sink.docx');
const FIXTURE_SHA = '8b6de008b979174065aa43c58e17db5a3eb654b42eb61232c42945ecfa64dff9';
const FIXTURE_BYTES = 3415;
const DOCUMENT = 'word/document.xml';
const MARKER = 'A1-UNI667-TABLE-EDIT';
const TARGET = { tableIndex: 0, row: 0, col: 0 };
const NEIGHBOURS = [
  { tableIndex: 0, row: 0, col: 1 },
  { tableIndex: 0, row: 1, col: 0 },
  { tableIndex: 0, row: 1, col: 1 },
];
const RETAINED = ['第一章 概述', '普通段落,包含', '尾段。'];

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  return (~c) >>> 0;
}

/** Minimal deflated ZIP writer: enough to rebuild a fixture-shaped package. */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    const data = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

const fixtureBytes = () => fs.readFileSync(FIXTURE_PATH);

/** Rewrite one real fixture part and repack; nothing else about the package changes. */
function repacked(partName, replace) {
  const parts = readZipParts(fixtureBytes());
  const names = [...parts.keys()];
  const entries = names.map((name) => {
    const value = parts.get(name);
    if (name === partName) return [name, replace(value.toString('utf8'))];
    return [name, value];
  });
  return buildZip(entries);
}

/**
 * The surgical single-cell edit the renderer's own save path performs: the
 * target cell's paragraph keeps its structure and only its w:t text gains the
 * marker. The fixture's A1 cell is literally `<w:tc><w:p><w:r><w:t>A1</w:t>`.
 */
function patchedTargetCell(sourceXml) {
  const needle = '<w:t>A1</w:t>';
  const index = sourceXml.indexOf(needle);
  assert.notEqual(index, -1, 'the fixture document must still contain the A1 cell text');
  return sourceXml.slice(0, index) + '<w:t>A1 ' + MARKER + '</w:t>' + sourceXml.slice(index + needle.length);
}

function assessment(overrides = {}) {
  const fixture = fixtureBytes();
  const saved = repacked(DOCUMENT, patchedTargetCell);
  return assessDocxTableBytes({
    fixtureBytes: fixture,
    savedBytes: saved,
    identity: TARGET,
    newText: MARKER,
    neighbourIdentities: NEIGHBOURS,
    retainedParagraphTexts: RETAINED,
    ...overrides,
  });
}

/** Run one assessment and return the thrown code, or null when it did not throw. */
function codeOf(run) {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof DocxTableOracleError) return error.code;
    throw error;
  }
}

test('the pinned fixture is the independent source of the expected cell identity', () => {
  const bytes = fixtureBytes();
  assert.equal(bytes.length, FIXTURE_BYTES);
  assert.equal(assessDocxTableBytes({ fixtureBytes: bytes, savedBytes: bytes, identity: TARGET, newText: MARKER }).fixture.sha256, FIXTURE_SHA);
  const parts = readZipParts(bytes);
  assert.equal(requiredPart(parts, DOCUMENT).toString('utf8').includes(MARKER), false);
  assert.deepEqual(partNames(parts), [...parts.keys()].filter((name) => !name.endsWith('/')).sort());
});

test('the fixture grid identity is read from the OOXML, not from any editor', () => {
  const tables = readTables(requiredPart(readZipParts(fixtureBytes()), DOCUMENT).toString('utf8'));
  assert.equal(tables.length, 1);
  assert.deepEqual(tableTextGrid(tables[0]), [
    ['A1', 'B1'],
    ['A2', 'B2'],
  ]);
  assert.equal(tableStructure(tables), 'cc|cc');
  assert.equal(cellAt(tables, TARGET).paras[0], 'A1');
});

test('a surgical single-cell save passes every declared check', () => {
  const result = assessment();
  assert.equal(result.oracle, ORACLE_ID);
  assert.equal(result.pass, true, JSON.stringify(result.checks));
  assert.equal(result.targetText, 'A1 ' + MARKER);
  assert.deepEqual(result.neighbourDiffs, []);
  assert.deepEqual(result.namedNeighbourDiffs, []);
  assert.deepEqual(Object.values(result.checks), Object.values(result.checks).map(() => true));
  assert.deepEqual(result.mediaParts, ['word/media/image1.png']);
});

test('the oracle rejects a save that changed a different cell instead of the target', () => {
  const source = requiredPart(readZipParts(fixtureBytes()), DOCUMENT).toString('utf8');
  const wrongNeedle = '<w:t>B1</w:t>';
  const index = source.indexOf(wrongNeedle);
  assert.notEqual(index, -1);
  const saved = repacked(
    DOCUMENT,
    (xml) => xml.slice(0, index) + '<w:t>B1 ' + MARKER + '</w:t>' + xml.slice(index + wrongNeedle.length),
  );
  const result = assessDocxTableBytes({
    fixtureBytes: fixtureBytes(),
    savedBytes: saved,
    identity: TARGET,
    newText: MARKER,
    neighbourIdentities: NEIGHBOURS,
    retainedParagraphTexts: RETAINED,
  });
  assert.equal(result.pass, false, 'a wrong-cell save must never pass');
  assert.equal(result.checks.targetHasNewText, false);
  assert.equal(result.checks.neighboursUnchanged, false);
  assert.equal(result.checks.namedNeighboursUnchanged, false);
  assert.equal(result.checks.targetIsNotTheAuthoredText, false);
  assert.equal(result.neighbourDiffs.length, 1);
  assert.equal(result.neighbourDiffs[0].after, 'B1 ' + MARKER);
});

test('the oracle rejects a saved package whose table is missing', () => {
  const saved = repacked(DOCUMENT, (xml) => {
    const seg = xmlSegments(xml, 'w:tbl')[0];
    assert.ok(seg, 'the fixture must contain a top-level table');
    return xml.slice(0, seg.start) + xml.slice(seg.end);
  });
  assert.equal(
    codeOf(() =>
      assessDocxTableBytes({
        fixtureBytes: fixtureBytes(),
        savedBytes: saved,
        identity: TARGET,
        newText: MARKER,
        neighbourIdentities: NEIGHBOURS,
      }),
    ),
    'table_missing',
  );
  const rowGone = repacked(DOCUMENT, (xml) => {
    const tbl = xmlSegments(xml, 'w:tbl')[0];
    const table = xml.slice(tbl.start, tbl.end);
    const row = xmlSegments(table, 'w:tr')[1];
    return xml.slice(0, tbl.start + row.start) + xml.slice(tbl.start + row.end);
  });
  assert.equal(
    codeOf(() =>
      assessDocxTableBytes({ fixtureBytes: fixtureBytes(), savedBytes: rowGone, identity: { tableIndex: 0, row: 1, col: 0 }, newText: MARKER }),
    ),
    'table_row_missing',
  );
});

test('the oracle rejects a stale saved file that is byte-identical to the fixture', () => {
  const bytes = fixtureBytes();
  const result = assessDocxTableBytes({
    fixtureBytes: bytes,
    savedBytes: Buffer.from(bytes),
    identity: TARGET,
    newText: MARKER,
    neighbourIdentities: NEIGHBOURS,
    retainedParagraphTexts: RETAINED,
  });
  assert.equal(result.pass, false, 'an unmodified file is not an edited save');
  assert.equal(result.checks.savedDiffersFromFixtureBytes, false);
  assert.equal(result.checks.savedDiffersFromFixtureHash, false);
  assert.equal(result.checks.targetHasNewText, false);
  assert.equal(result.checks.targetIsNotTheAuthoredText, false);
  assert.equal(result.fixture.sha256, result.saved.sha256);
});

test('the oracle rejects a save that rewrote a neighbour while the target looks right', () => {
  const saved = repacked(DOCUMENT, (xml) => {
    const withTarget = patchedTargetCell(xml);
    const needle = '<w:t>B2</w:t>';
    const index = withTarget.indexOf(needle);
    return withTarget.slice(0, index) + '<w:t>B2-REWRITTEN</w:t>' + withTarget.slice(index + needle.length);
  });
  const result = assessDocxTableBytes({
    fixtureBytes: fixtureBytes(),
    savedBytes: saved,
    identity: TARGET,
    newText: MARKER,
    neighbourIdentities: NEIGHBOURS,
    retainedParagraphTexts: RETAINED,
  });
  assert.equal(result.checks.targetHasNewText, true);
  assert.equal(result.checks.neighboursUnchanged, false);
  assert.equal(result.pass, false);
});

test('the oracle rejects a save that dropped the image, its relationships or the table shape', () => {
  const mediaGone = repacked(DOCUMENT, patchedTargetCell);
  const withoutMedia = readZipParts(mediaGone);
  const saved = buildZip([...withoutMedia].filter(([name]) => name !== 'word/media/image1.png'));
  const result = assessDocxTableBytes({
    fixtureBytes: fixtureBytes(),
    savedBytes: saved,
    identity: TARGET,
    newText: MARKER,
    neighbourIdentities: NEIGHBOURS,
    retainedParagraphTexts: RETAINED,
  });
  assert.equal(result.checks.targetHasNewText, true);
  assert.equal(result.checks.mediaByteEqual, false);
  assert.equal(result.pass, false);

  const relsRewritten = repacked('word/_rels/document.xml.rels', (xml) => xml.replace('rId10', 'rId99'));
  const relsResult = assessDocxTableBytes({
    fixtureBytes: fixtureBytes(),
    savedBytes: relsRewritten,
    identity: TARGET,
    newText: MARKER,
    neighbourIdentities: NEIGHBOURS,
    retainedParagraphTexts: RETAINED,
  });
  assert.equal(relsResult.checks.relationshipsByteEqual, false);
  assert.equal(relsResult.pass, false);
});

test('the oracle names a malformed or unreadable package instead of passing it', () => {
  assert.equal(codeOf(() => readZipParts(Buffer.from('not a package'))), 'package_has_no_eocd');
  assert.equal(codeOf(() => assessDocxTableBytes({ fixtureBytes: 'x', savedBytes: 'y', identity: TARGET, newText: MARKER })), 'bytes_required');
  assert.equal(
    codeOf(() => assessDocxTableBytes({ fixtureBytes: fixtureBytes(), savedBytes: fixtureBytes(), identity: TARGET, newText: '' })),
    'new_text_required',
  );
  assert.equal(
    codeOf(() =>
      assessDocxTableFile({ fixturePath: FIXTURE_PATH, savedPath: path.join(fixturesDir, 'does-not-exist.docx'), identity: TARGET, newText: MARKER }),
    ),
    'file_read_failed',
  );
});

test('the file wrapper agrees with the byte assessment on the real fixture path', () => {
  const saved = repacked(DOCUMENT, patchedTargetCell);
  const savedPath = path.join(fs.mkdtempSync(path.join(process.env.TEMP || '.', 'uni667-')), 'saved.docx');
  fs.writeFileSync(savedPath, saved);
  const result = assessDocxTableFile({
    fixturePath: FIXTURE_PATH,
    savedPath,
    identity: TARGET,
    newText: MARKER,
    neighbourIdentities: NEIGHBOURS,
    retainedParagraphTexts: RETAINED,
  });
  assert.equal(result.pass, true, JSON.stringify(result.checks));
  assert.equal(result.fixture.sha256, FIXTURE_SHA);
  fs.rmSync(path.dirname(savedPath), { recursive: true, force: true });
});

test('retained prose must survive as TOP-LEVEL body text, not as any document.xml substring', () => {
  const xml = requiredPart(readZipParts(fixtureBytes()), DOCUMENT).toString('utf8');
  const heading = bodyParagraphTexts(xml).find((paragraph) => paragraph.length > 0);
  assert.ok(heading, 'the fixture must carry at least one authored top-level paragraph');

  // The retained text the real cycle pins is genuinely body prose.
  assert.ok(bodyParagraphTexts(xml).includes(heading));

  // A string that exists ONLY inside a table cell is not a retained paragraph,
  // even though a raw includes() over word/document.xml would find it.
  const cellOnly = assessDocxTableBytes({
    fixtureBytes: fixtureBytes(),
    savedBytes: repacked(DOCUMENT, patchedTargetCell),
    identity: TARGET,
    newText: MARKER,
    neighbourIdentities: NEIGHBOURS,
    retainedParagraphTexts: ['A1'],
  });
  assert.equal(cellOnly.checks.targetHasNewText, true, 'the cell edit itself is intact');
  assert.equal(cellOnly.paragraphRetention[0].fixtureHas, false, 'A1 is a table cell, not body prose');
  assert.equal(cellOnly.checks.retainedParagraphsPresent, false);
  assert.equal(cellOnly.pass, false, 'a cell-only substring must never count as retained prose');

  // Deleting the authored heading paragraph fails even though nothing else moved.
  const withoutHeading = repacked(DOCUMENT, (source) => {
    const seg = xmlSegments(source, 'w:p').find((candidate) => textOf(source.slice(candidate.start, candidate.end)) === heading);
    assert.ok(seg, 'the authored heading paragraph must be present before deletion');
    return source.slice(0, seg.start) + source.slice(seg.end);
  });
  const dropped = assessDocxTableBytes({
    fixtureBytes: fixtureBytes(),
    savedBytes: withoutHeading,
    identity: TARGET,
    newText: MARKER,
    neighbourIdentities: NEIGHBOURS,
    retainedParagraphTexts: [heading],
  });
  assert.equal(dropped.paragraphRetention[0].fixtureHas, true);
  assert.equal(dropped.paragraphRetention[0].savedHas, false);
  assert.equal(dropped.pass, false, 'a dropped body paragraph must fail retention');
});
