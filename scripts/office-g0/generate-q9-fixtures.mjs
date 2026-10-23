#!/usr/bin/env node
// DOC-002 (UNI-666) - Q9 large-band fixtures that are really near 50 MiB on disk.
//
// The first generation of F-LARGE-DOCX/F-LARGE-XLSX repeated a filler paragraph
// and produced a 362 KB DOCX against a 46 MiB *content* target. Q9-A is a band
// of real files under 50 MiB, so these builders carry genuinely incompressible
// payloads and the script refuses to emit a file outside the band the fixture
// manifest declares (production.onDiskBandBytes).
//
//   node scripts/office-g0/generate-q9-fixtures.mjs \
//     --manifest docs/office/g0/fixtures/manifest.json --out <owned-directory>
//
// Determinism: seeded PRNG, fixed ZIP order and DOS epoch, no host timestamps.
// The lab record written beside the files has the same schema the shared lab
// uses, so the same record serves the verifier once the bytes are copied (or
// regenerated) into ../.uniwork-dev/office-g0/fixtures/large/.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { writeZip } from './generate-expansion-fixtures.mjs';

const MIB = 1024 * 1024;
const HARD_CAP_BYTES = 50 * MIB; // Q9-A: the band stays under 50 MiB on disk
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Deterministic xorshift32 so every run of a given size produces the same noise. */
function makePrng(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
}

/** Incompressible RGB PNG: random scanlines, DEFLATE stored blocks (level 0). */
export function noisePng(side, seed) {
  const w = side, h = side;
  const raw = Buffer.alloc(h * (1 + w * 3));
  const rand = makePrng(seed);
  for (let y = 0; y < h; y += 1) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w * 3; x += 4) {
      const value = rand();
      raw[row + 1 + x] = value & 0xff;
      if (x + 1 < w * 3) raw[row + 2 + x] = (value >>> 8) & 0xff;
      if (x + 2 < w * 3) raw[row + 3 + x] = (value >>> 16) & 0xff;
      if (x + 3 < w * 3) raw[row + 4 + x] = (value >>> 24) & 0xff;
    }
  }
  const crcOf = (bytes) => { let c = zlib.crc32 ? zlib.crc32(bytes) : null; if (c === null) throw new Error('zlib.crc32 is unavailable'); return c >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crcOf(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const documentXml = (bodyXml) => DECL + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="' + NS_R + '"><w:body>' +
  bodyXml + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';

/** F-LARGE-DOCX: a real document whose embedded photo puts it in the Q9 band. */
export function buildQ9Docx(png) {
  const cx = 4140 * 9525, cy = 4140 * 9525;
  const imageParagraph = '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
    '<wp:docPr id="1" name="Q9 band photo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="1" name="q9-noise.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId6"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const paragraphs = [
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">Q9 band fixture: bao cao kem anh lon</w:t></w:r></w:p>',
    '<w:p><w:r><w:t xml:space="preserve">Q9 sentinel 141421: tai lieu that, anh nhieu (khong nen duoc) nam trong than file.</w:t></w:r></w:p>',
    imageParagraph,
    '<w:p><w:r><w:t xml:space="preserve">Q9 sentinel 173205: doan van sau anh de kiem tra sua nho.</w:t></w:r></w:p>',
  ].join('');
  const parts = [
    { name: '[Content_Types].xml', data: Buffer.from(DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>', 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(DECL + '<Relationships xmlns="' + NS_PKG + '">' +
      '<Relationship Id="rId1" Type="' + NS_R + '/officeDocument" Target="word/document.xml"/></Relationships>', 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(DECL + '<Relationships xmlns="' + NS_PKG + '">' +
      '<Relationship Id="rId6" Type="' + NS_R + '/image" Target="media/q9-noise.png"/></Relationships>', 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml(paragraphs), 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(DECL + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>', 'utf8') },
    { name: 'word/media/q9-noise.png', data: png },
  ];
  return writeZip(parts);
}

/** F-LARGE-XLSX: a data-heavy workbook whose random inline strings resist compression. */
export function buildQ9Xlsx(targetBytes, seed) {
  const rand = makePrng(seed);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const word = () => {
    let out = '';
    for (let i = 0; i < 36; i += 1) out += alphabet[rand() % alphabet.length];
    return out;
  };
  const rows = [];
  let approx = 0;
  let row = 2;
  const header = '<row r="1"><c r="A1" t="inlineStr" s="1"><is><t>Ma</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>Gia tri</t></is></c><c r="C1" t="inlineStr" s="1"><is><t>Ghi chu</t></is></c></row>';
  approx += header.length;
  while (approx < targetBytes && row <= 1000000) {
    const cells = '<c r="A' + row + '" t="inlineStr"><is><t>ROW' + row + '</t></is></c>' +
      '<c r="B' + row + '" t="inlineStr"><is><t>' + word() + '</t></is></c>' +
      '<c r="C' + row + '" t="inlineStr"><is><t>' + word() + word() + '</t></is></c>';
    const line = '<row r="' + row + '">' + cells + '</row>';
    rows.push(line);
    approx += line.length;
    row += 1;
  }
  const sheet = DECL + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + header + rows.join('') + '</sheetData></worksheet>';
  const parts = [
    { name: '[Content_Types].xml', data: Buffer.from(DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>', 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(DECL + '<Relationships xmlns="' + NS_PKG + '">' +
      '<Relationship Id="rId1" Type="' + NS_R + '/officeDocument" Target="xl/workbook.xml"/></Relationships>', 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(DECL + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheets><sheet name="DuLieu" sheetId="1" r:id="rId1" xmlns:r="' + NS_R + '"/></sheets></workbook>', 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(DECL + '<Relationships xmlns="' + NS_PKG + '">' +
      '<Relationship Id="rId1" Type="' + NS_R + '/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="' + NS_R + '/styles" Target="styles.xml"/></Relationships>', 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(DECL + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="0" applyFont="1"/></cellXfs></styleSheet>', 'utf8') },
  ];
  return writeZip(parts);
}

function bandOf(manifest, id) {
  const fixture = manifest.fixtures.find((f) => f.id === id);
  if (!fixture) throw new Error('manifest does not declare ' + id);
  const band = fixture.production && fixture.production.onDiskBandBytes;
  if (!band || !Number.isInteger(band.min) || !Number.isInteger(band.max)) throw new Error(id + ' has no production.onDiskBandBytes');
  if (band.max > HARD_CAP_BYTES) throw new Error(id + ' declares a band above the Q9-A cap of ' + HARD_CAP_BYTES + ' bytes');
  return band;
}

const inBand = (bytes, band) => bytes >= band.min && bytes <= band.max;

/** Square image side whose archive lands inside the band: monotonic in side. */
export function searchSide(band, build, startSide, limit = 80) {
  let side = startSide;
  let last = null;
  for (let step = 0; side > 256 && step < limit; step += 1) {
    const bytes = build(side);
    last = { side, bytes: bytes.length };
    if (inBand(bytes.length, band)) return { side, bytes, attempts: step + 1, last };
    side += bytes.length < band.min ? 1 : -1;
  }
  throw new Error('no image side landed in the declared band; last attempt ' + JSON.stringify(last));
}

export async function main(argv) {
  const value = (name, fallback) => { const i = argv.indexOf('--' + name); return i === -1 ? fallback : argv[i + 1]; };
  const manifestPath = value('manifest', path.join(import.meta.dirname, '..', '..', 'docs', 'office', 'g0', 'fixtures', 'manifest.json'));
  const out = value('out', null);
  if (!out) { process.stdout.write('usage: node generate-q9-fixtures.mjs --manifest <manifest.json> --out <directory>\n'); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const outDir = path.resolve(out);
  fs.mkdirSync(outDir, { recursive: true });

  const docxBand = bandOf(manifest, 'F-LARGE-DOCX');
  const search = searchSide(docxBand, (side) => buildQ9Docx(noisePng(side, 0x5eed1234)), Math.floor(Math.sqrt(docxBand.min / 3)));
  const docxBytes = buildQ9Docx(noisePng(search.side, 0x5eed1234));
  if (!inBand(docxBytes.length, docxBand)) throw new Error('F-LARGE-DOCX landed outside its band: ' + docxBytes.length);

  const xlsxBand = bandOf(manifest, 'F-LARGE-XLSX');
  let xlsxBytes = null;
  let contentTarget = Math.floor(xlsxBand.min * 1.45);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = buildQ9Xlsx(contentTarget, 0x1234abcd);
    if (inBand(candidate.length, xlsxBand)) { xlsxBytes = candidate; break; }
    contentTarget = Math.round(contentTarget * (xlsxBand.min / Math.max(1, candidate.length)));
  }
  if (!xlsxBytes) throw new Error('F-LARGE-XLSX never landed inside its band');

  const written = [];
  for (const [id, name, bytes] of [['F-LARGE-DOCX', 'large-document.docx', docxBytes], ['F-LARGE-XLSX', 'large-workbook.xlsx', xlsxBytes]]) {
    const target = path.join(outDir, name);
    if (fs.existsSync(target) && sha256(fs.readFileSync(target)) !== sha256(bytes)) throw new Error('refusing to overwrite different fixture bytes: ' + target);
    fs.writeFileSync(target, bytes);
    written.push({ id, name, bytes: bytes.length, sha256: sha256(bytes) });
  }

  const record = {
    schemaVersion: 1,
    kind: 'uniwork-office-lab-fixture-record',
    issue: 'UNI-666',
    note: 'Checksums for the Q9 large-band fixtures. They are generated into the lab and never committed, so their checksums live here rather than in docs/office/g0/fixtures/manifest.json.',
    generator: 'scripts/office-g0/generate-q9-fixtures.mjs',
    requestBytes: written[0].bytes,
    measuredOnDisk: true,
    fixtures: written.map((entry) => {
      const fixture = manifest.fixtures.find((f) => f.id === entry.id);
      return { id: entry.id, path: 'fixtures\\large\\' + entry.name, bytes: entry.bytes, sha256: entry.sha256, labPath: fixture.production.labPath, defaultBytes: fixture.production.defaultBytes, onDiskBandBytes: fixture.production.onDiskBandBytes };
    }),
  };
  const recordPath = path.join(outDir, 'lab-record.json');
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ written, record: recordPath, docxImageSide: search.side, docxSearchAttempts: search.attempts }, null, 2) + '\n');
  return written;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));