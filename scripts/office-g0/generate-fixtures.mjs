#!/usr/bin/env node
// DOC-002 (UNI-666) - manifest-driven fixture generator.
//
// Reads docs/office/g0/fixtures/manifest.json and produces every fixture whose
// production.method is 'generated' or 'lab-large'. Copied, upstream-generator and
// pending fixtures are skipped: the first two already exist with recorded
// provenance, and pending entries name why they cannot be produced yet.
//
//   node scripts/office-g0/generate-fixtures.mjs --deps-dir <trial>/node_modules
//   node scripts/office-g0/generate-fixtures.mjs --deps-dir <deps> --update-checksums
//   node scripts/office-g0/generate-fixtures.mjs --deps-dir <deps> --only F-DOCX-VI
//   node scripts/office-g0/generate-fixtures.mjs --deps-dir <deps> --large 46000000
//
// --update-checksums rewrites sha256 and bytes for every fixture the run produced,
// so the regenerate-then-record loop stays two commands instead of transcription.
// Fixtures are deterministic: fixed ids, fixed compression level, no timestamps.
//
// This script installs nothing. jszip and pdf-lib are resolved from --deps-dir,
// which is normally the trial copy's node_modules.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { REPO_ROOT, resolveLabRoot, resolveFixtureRoot } from './paths.mjs';

const MANIFEST_PATH = path.join(REPO_ROOT, 'docs/office/g0/fixtures/manifest.json');
const FILE_ROOT = resolveFixtureRoot();
const LAB_ROOT = resolveLabRoot();

function parseArgs(argv) {
  const out = { depsDir: null, updateChecksums: false, only: [], large: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--deps-dir') out.depsDir = argv[++i];
    else if (a === '--update-checksums') out.updateChecksums = true;
    else if (a === '--only') out.only.push(argv[++i]);
    else if (a === '--large') out.large = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write('usage: node scripts/office-g0/generate-fixtures.mjs --deps-dir <dir> [--only F-ID] [--update-checksums] [--large BYTES]\n');
  process.exit(0);
}
if (!args.depsDir) {
  process.stderr.write('generate-fixtures: --deps-dir is required (point it at the trial copy node_modules)\n');
  process.exit(2);
}
const depsDir = path.resolve(args.depsDir);
const requireFromDeps = createRequire(path.join(depsDir, 'noop.js'));
const JSZip = requireFromDeps('jszip');
const { PDFDocument, StandardFonts, rgb } = requireFromDeps('pdf-lib');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
// Deterministic ZIP inputs. JSZip stamps `new Date()` on every added file and on
// every auto-created parent folder (lib/object.js: `o.date = o.date || new Date()`),
// so two runs minutes apart produced different bytes and hashes. A fixed DOS
// epoch plus a pinned platform makes a rebuild byte-identical; DOS date fields
// are written from getUTC*, so the value does not depend on the host timezone.
const ZIP_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
const ZIP_OPTS = {
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
  platform: 'DOS',
};

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Vietnamese sample content covering all five tone marks, d/D and the u o a e combinations. */
const VI = {
  title: 'Báo cáo tổng hợp năm 2026',
  org: 'Công ty Cổ phần UniWork Việt Nam',
  body: 'Tài liệu kiểm thử tiếng Việt: dấu huyền, sắc, hỏi, ngã, nặng; chữ Đ và đ; tổ hợp ư, ơ, ă, â, ê, ô.',
  labels: ['Doanh thu', 'Chi phí', 'Lợi nhuận', 'Tăng trưởng'],
  tableHeaders: ['Hạng mục', 'Quý I', 'Quý II'],
  notes: 'Ghi chú trình bày cho buổi họp tuần.',
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Deterministic 8x8 RGB PNG, hand-encoded so no canvas or randomness is involved. */
function tinyPng() {
  const w = 8, h = 8;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y += 1) {
    const row = y * (1 + w * 3);
    for (let x = 0; x < w; x += 1) {
      const p = row + 1 + x * 3;
      raw[p] = (x * 32) & 0xff;
      raw[p + 1] = (y * 32) & 0xff;
      raw[p + 2] = 64;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Builds a deterministic ZIP.
 *
 * Part order is explicit rather than whatever `Object.entries` happens to
 * produce: the `first` names in the given order, then the remaining parts sorted
 * by code unit (the default String sort is locale-independent, unlike
 * localeCompare). Every file and every parent directory carries ZIP_DATE instead
 * of the wall clock, and compression comes from ZIP_OPTS with per-part `stored`
 * overrides - the ODF mimetype must stay first and uncompressed.
 */
async function writeZip(files, { first = [], stored = [] } = {}) {
  const names = Object.keys(files);
  const firstNames = first.filter((name) => names.includes(name));
  const restNames = names.filter((name) => !first.includes(name)).sort();
  const dirs = new Set();
  for (const name of restNames) {
    const segments = name.split('/');
    for (let i = 1; i < segments.length; i += 1) dirs.add(segments.slice(0, i).join('/') + '/');
  }
  const partOptions = (name) =>
    stored.includes(name)
      ? { date: ZIP_DATE, createFolders: false, compression: 'STORE' }
      : { date: ZIP_DATE, createFolders: false };
  const zip = new JSZip();
  // `first` parts lead so the ODF mimetype stays entry 0; directories follow,
  // then the remaining parts in code-unit order.
  for (const name of firstNames) zip.file(name, files[name], partOptions(name));
  const sortedDirs = [...dirs].sort();
  for (const dir of sortedDirs) zip.folder(dir);
  for (const name of restNames) zip.file(name, files[name], partOptions(name));
  // `zip.folder()` cannot take a date, so the created directory entries are
  // re-stamped with the same fixed date as the files.
  for (const dir of sortedDirs) zip.files[dir].date = ZIP_DATE;
  return zip.generateAsync(ZIP_OPTS);
}

// DOCX builders
// ---------------------------------------------------------------------------

const W_CONTENT_TYPES = DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
  '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
  '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '</Types>';

const W_ROOT_RELS = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>';

const W_DOC_RELS = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' +
  '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' +
  '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
  '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
  '</Relationships>';

// The same document relationships without the image part. A package whose media
// is absent must not declare a relationship to word/media/image1.png, or a
// reader follows a dangling target: the empty DOCX did exactly that.
const W_DOC_RELS_NO_IMAGE = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' +
  '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' +
  '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
  '</Relationships>';

const W_THEME = DECL + '<a:theme xmlns:a="' + NS_A + '" name="UniWork Office Fixture Theme">' +
  '<a:themeElements><a:clrScheme name="Office">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="EEF3FA"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="F26522"/></a:accent1><a:accent2><a:srgbClr val="2E74B5"/></a:accent2>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
  '</a:clrScheme>' +
  '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
  '</a:fmtScheme></a:themeElements></a:theme>';

const W_STYLES = DECL + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/></w:rPr></w:style>' +
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>' +
  '<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="auto"/><w:left w:val="single" w:sz="4" w:color="auto"/>' +
  '<w:bottom w:val="single" w:sz="4" w:color="auto"/><w:right w:val="single" w:sz="4" w:color="auto"/>' +
  '<w:insideH w:val="single" w:sz="4" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:color="auto"/></w:tblBorders></w:tblPr></w:style>' +
  '</w:styles>';

const W_NUMBERING = DECL + '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
  '<w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const W_FOOTNOTES = DECL + '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
  '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
  '<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>' +
  '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>1</w:t></w:r>' +
  '<w:r><w:t xml:space="preserve"> Ghi chú cuối trang kiểm thử tiếng Việt.</w:t></w:r></w:p></w:footnote>' +
  '</w:footnotes>';

const W_COMMENTS = DECL + '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:comment w:id="1" w:author="UniWork Office Fixture" w:initials="UO" w:date="2026-09-16T00:00:00Z">' +
  '<w:p><w:r><w:t>Nhận xét kiểm thử: cần bổ sung số liệu quý III.</w:t></w:r></w:p></w:comment>' +
  '</w:comments>';

const W_CORE = DECL + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  '<dc:title>' + VI.title + '</dc:title><dc:creator>UniWork Office G0</dc:creator>' +
  '<cp:lastModifiedBy>UniWork Office G0</cp:lastModifiedBy>' +
  '<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-16T00:00:00Z</dcterms:created>' +
  '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-16T00:00:00Z</dcterms:modified>' +
  '</cp:coreProperties>';

function wPara(text, opts) {
  const o = opts || {};
  const style = o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '';
  const numPr = o.numId ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + o.numId + '"/></w:numPr>' : '';
  const keep = o.keepNext ? '<w:keepNext/>' : '';
  const rPr = o.bold ? '<w:b/>' : '';
  const fn = o.footnote ? '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' : '';
  return '<w:p><w:pPr>' + style + numPr + keep + '</w:pPr>' +
    '<w:r><w:rPr>' + rPr + '</w:rPr><w:t xml:space="preserve">' + text + '</w:t></w:r>' + fn + '</w:p>';
}

function wTable(rows) {
  const tblPr = '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr>';
  const grid = '<w:tblGrid>' + rows[0].map(() => '<w:gridCol w:w="3000"/>').join('') + '</w:tblGrid>';
  const body = rows.map((cells, rowIndex) => {
    const tcs = cells.map((cell) => '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>' + wPara(cell, { bold: rowIndex === 0 }) + '</w:tc>').join('');
    return '<w:tr>' + (rowIndex === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + tcs + '</w:tr>';
  }).join('');
  return '<w:tbl>' + tblPr + grid + body + '</w:tbl>';
}

function wImagePara(relId, id, cx, cy) {
  return '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
    '<wp:docPr id="' + id + '" name="Fixture image ' + id + '"/>' +
    '<a:graphic xmlns:a="' + NS_A + '"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="fixture.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p>';
}

function wSectPr(cols) {
  const body = '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
  const col = cols && cols > 1 ? '<w:cols w:num="' + cols + '" w:space="708"/>' : '';
  return '<w:sectPr>' + body + col + '<w:docGrid w:linePitch="360"/></w:sectPr>';
}

function wDocument(bodyXml, sectPr) {
  return DECL + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="' + NS_R + '"><w:body>' + bodyXml + (sectPr || wSectPr()) + '</w:body></w:document>';
}

async function buildDocx(ctx) {
  const hasImage = ctx.image !== false;
  const parts = {};
  const paras = [];
  // `empty` is a real blank document: exactly one empty paragraph and no
  // generated payload, matching upstream's `<w:p/>` blank template. An empty
  // w:p is genuinely empty; wPara('') would emit an empty w:t.
  if (ctx.empty === true) {
    paras.push('<w:p/>');
  } else {
    paras.push(wPara(VI.title, { style: 'Heading1' }));
    paras.push(wPara(VI.org));
    paras.push(wPara(VI.body, { footnote: ctx.footnote === true }));
  }
  if (ctx.headings) {
    paras.push(wPara('1. Bảng số liệu', { style: 'Heading2' }));
  }
  if (ctx.table) {
    paras.push(wTable([
      VI.tableHeaders,
      [VI.labels[0], '1.250.000.000', '1.410.000.000'],
      [VI.labels[1], '780.000.000', '820.000.000'],
      [VI.labels[2], '470.000.000', '590.000.000'],
    ]));
  }
  if (ctx.longTable) {
    const rows = [VI.tableHeaders];
    for (let i = 1; i <= 60; i += 1) rows.push(['Mục ' + i, String(i * 10), String(i * 12)]);
    paras.push(wTable(rows));
  }
  if (ctx.numberedList) {
    paras.push(wPara('Bước một: thu thập số liệu', { numId: 1 }));
    paras.push(wPara('Bước hai: đối chiếu chứng từ', { numId: 1 }));
    paras.push(wPara('Bước ba: ký duyệt', { numId: 1 }));
  }
  if (hasImage) paras.push(wImagePara('rId6', 1, 731520, 731520));
  if (ctx.longText) {
    const block = VI.body + ' ' + VI.body + ' ';
    for (let i = 0; i < 120; i += 1) paras.push(wPara(block));
  }
  parts['[Content_Types].xml'] = W_CONTENT_TYPES;
  parts['_rels/.rels'] = W_ROOT_RELS;
  parts['word/_rels/document.xml.rels'] = hasImage ? W_DOC_RELS : W_DOC_RELS_NO_IMAGE;
  parts['word/document.xml'] = wDocument(paras.join(''), wSectPr(ctx.columns));
  parts['word/styles.xml'] = W_STYLES;
  parts['word/numbering.xml'] = W_NUMBERING;
  parts['word/footnotes.xml'] = W_FOOTNOTES;
  parts['word/comments.xml'] = W_COMMENTS;
  parts['word/theme/theme1.xml'] = W_THEME;
  parts['docProps/core.xml'] = W_CORE;
  if (hasImage) parts['word/media/image1.png'] = tinyPng();
  return writeZip(parts);
}

// XLSX builders
// ---------------------------------------------------------------------------

const NS_S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const X_CONTENT_TYPES = (sheetCount, opts) => {
  const o = opts || {};
  let overrides = '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
  for (let i = 1; i <= sheetCount; i += 1) {
    overrides += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }
  overrides += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  overrides += '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>';
  if (o.chart) overrides += '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>';
  if (o.vba) overrides += '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>';
  if (o.customXml) overrides += '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>';
  return DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/>' +
    overrides + '</Types>';
};

/** Package-level relationships. Office stores customXml here, not under xl/. */
function xRootRels(opts) {
  const o = opts || {};
  let rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>';
  if (o.customXml) rels += '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>';
  return DECL + '<Relationships xmlns="' + NS_PKG + '">' + rels + '</Relationships>';
}

function xWorkbook(sheetNames, definedNames) {
  const sheets = sheetNames.map((name, i) => '<sheet name="' + name + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('');
  const dn = definedNames && definedNames.length
    ? '<definedNames>' + definedNames.map((d) => '<definedName name="' + d.name + '">' + d.ref + '</definedName>').join('') + '</definedNames>'
    : '';
  return DECL + '<workbook xmlns="' + NS_S + '" xmlns:r="' + NS_R + '"><sheets>' + sheets + '</sheets>' + dn + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
}

function xWorkbookRels(sheetCount, opts) {
  const o = opts || {};
  let rels = '';
  for (let i = 1; i <= sheetCount; i += 1) {
    rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + i + '.xml"/>';
  }
  let next = sheetCount;
  const add = (type, target) => { next += 1; rels += '<Relationship Id="rId' + next + '" Type="' + type + '" Target="' + target + '"/>'; };
  add('http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', 'styles.xml');
  add('http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings', 'sharedStrings.xml');
  if (o.chart) add('http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart', 'charts/chart1.xml');
  if (o.vba) add('http://schemas.microsoft.com/office/2006/relationships/vbaProject', 'vbaProject.bin');
  return DECL + '<Relationships xmlns="' + NS_PKG + '">' + rels + '</Relationships>';
}

const X_STYLES = DECL + '<styleSheet xmlns="' + NS_S + '">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF26522"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function xSharedStrings(values) {
  const uniq = [];
  for (const v of values) if (!uniq.includes(v)) uniq.push(v);
  const items = uniq.map((v) => '<si><t xml:space="preserve">' + v + '</t></si>').join('');
  return { xml: DECL + '<sst xmlns="' + NS_S + '" count="' + values.length + '" uniqueCount="' + uniq.length + '">' + items + '</sst>', index: uniq };
}

function xCell(ref, opts) {
  const o = opts || {};
  const style = o.style ? ' s="' + o.style + '"' : '';
  if (o.formula !== undefined) {
    return '<c r="' + ref + '"' + style + (o.cached !== undefined ? ' t="n"' : '') + '><f>' + o.formula + '</f>' +
      (o.cached !== undefined ? '<v>' + o.cached + '</v>' : '') + '</c>';
  }
  if (o.sharedIndex !== undefined) return '<c r="' + ref + '"' + style + ' t="s"><v>' + o.sharedIndex + '</v></c>';
  if (o.number !== undefined) return '<c r="' + ref + '"' + style + '><v>' + o.number + '</v></c>';
  return '<c r="' + ref + '"' + style + '/>';
}

function xSheet(rows, opts) {
  const o = opts || {};
  // A null row is emitted as an empty self-closing row, which is a real shape an edit must preserve.
  const rowsXml = rows.map((cells, r) => (cells === null
    ? '<row r="' + (r + 1) + '"/>'
    : '<row r="' + (r + 1) + '">' + cells.join('') + '</row>')).join('');
  const dvList = o.dataValidations || (o.dataValidation ? [o.dataValidation] : []);
  const cfList = o.conditionalFormattings || (o.conditionalFormatting ? [o.conditionalFormatting] : []);
  const dv = dvList.length
    ? '<dataValidations count="' + dvList.length + '">' + dvList.map((d) => '<dataValidation type="list" allowBlank="1" showInputMessage="1" sqref="' + d.sqref + '">' +
      '<formula1>' + d.formula1 + '</formula1></dataValidation>').join('') + '</dataValidations>'
    : '';
  const cf = cfList.map((c) => '<conditionalFormatting sqref="' + c.sqref + '"><cfRule type="cellIs" dxfId="' + (c.dxfId || 0) + '" priority="' +
    (c.priority || 1) + '" operator="' + (c.operator || 'greaterThan') + '">' +
    '<formula>' + c.formula + '</formula></cfRule></conditionalFormatting>').join('');
  // sheetProtection precedes protectedRanges in the CT_Worksheet sequence, so the allowed ranges follow it.
  const protect = o.protection
    ? '<sheetProtection sheet="1" password="CC1A" objects="1" scenarios="1"/>' +
      (o.protection.ranges || []).map((ra) => '<protectedRanges><protectedRange name="' + ra.name + '" sqref="' + ra.sqref + '"/></protectedRanges>').join('')
    : '';
  return DECL + '<worksheet xmlns="' + NS_S + '" xmlns:r="' + NS_R + '"><sheetData>' + rowsXml + '</sheetData>' +
    dv + cf + protect + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
}

function xChartXml() {
  const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
  return DECL + '<c:chartSpace xmlns:c="' + NS_C + '" xmlns:a="' + NS_A + '"><c:chart>' +
    '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Doanh thu theo quý</a:t></a:r></a:p></c:rich></c:tx></c:title>' +
    '<c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>' +
    '<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Data!$B$1</c:f></c:strRef></c:tx>' +
    '<c:cat><c:numRef><c:f>Data!$A$2:$A$4</c:f></c:numRef></c:cat>' +
    '<c:val><c:numRef><c:f>Data!$B$2:$B$4</c:f></c:numRef></c:val></c:ser>' +
    '<c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/></c:catAx>' +
    '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/></c:valAx></c:plotArea>' +
    '<c:plotVisOnly val="1"/></c:chart></c:chartSpace>';
}

/** A deterministic non-executable payload standing in for a VBA project part. */
function vbaPayload() {
  const bytes = Buffer.alloc(4096);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31) & 0xff;
  bytes.write('UniWorkG0FixtureMacro', 0, 'latin1');
  return bytes;
}

async function buildXlsx(ctx) {
  const shared = [];
  const si = (v) => { if (!shared.includes(v)) shared.push(v); return shared.indexOf(v); };
  const sheets = [];
  const defined = [];

  const header = VI.tableHeaders.map((h, i) => xCell(String.fromCharCode(65 + i) + '1', { sharedIndex: si(h), style: 2 }));
  const dataRows = VI.labels.map((label, i) => {
    const r = i + 2;
    return [
      xCell('A' + r, { sharedIndex: si(label) }),
      xCell('B' + r, { number: 1250000000 + i * 160000000 }),
      xCell('C' + r, { number: 780000000 + i * 40000000 }),
    ];
  });
  if (ctx.formulas !== false) {
    dataRows.push([
      xCell('A5', { sharedIndex: si(VI.labels[2]) }),
      xCell('B5', { formula: 'SUM(B2:B4)', cached: 4908000000 }),
      xCell('C5', { formula: 'SUM(C2:C4)', cached: 5408000000 }),
    ]);
  }
  // A sparse sheet keeps a missing row and a self-closing row, the two shapes a targeted edit must not normalise away.
  const mainRows = ctx.sparse
    ? [header, dataRows[0], null, [], dataRows[2]]
    : [header].concat(dataRows);
  const mainSheetOpts = {
    dataValidation: { sqref: 'A2:A4', formula1: '"Doanh thu,Chi phí,Lợi nhuận,Tăng trưởng"' },
    conditionalFormatting: { sqref: 'B2:B4', dxfId: 0, formula: '1000000000' },
  };
  if (ctx.kitchen) {
    mainSheetOpts.dataValidations = [
      { sqref: 'A2:A4', formula1: '"Doanh thu,Chi phí,Lợi nhuận,Tăng trưởng"' },
      { sqref: 'C2:C4', formula1: '"Quý I,Quý II"' },
    ];
    mainSheetOpts.conditionalFormattings = [
      { sqref: 'B2:B4', dxfId: 0, formula: '1000000000', priority: 1 },
      { sqref: 'C2:C4', dxfId: 0, formula: '700000000', priority: 2, operator: 'lessThan' },
    ];
  }
  if (ctx.protection && !ctx.multiSheet) mainSheetOpts.protection = { ranges: [{ name: 'VungNhapLieu', sqref: 'A2:A4' }] };
  sheets.push(xSheet(mainRows, mainSheetOpts));

  if (ctx.multiSheet) {
    const satelliteRows = [
      [xCell('A1', { sharedIndex: si('Chỉ tiêu'), style: 2 }), xCell('B1', { sharedIndex: si('Giá trị'), style: 2 })],
      [xCell('A2', { sharedIndex: si('Tổng doanh thu') }), xCell('B2', { formula: "SUM(Data!B2:B4)", cached: 4908000000 })],
    ];
    if (ctx.kitchen) satelliteRows.push([xCell('A3', { sharedIndex: si('Số kỳ') }), xCell('B3', { formula: 'COUNTA(Data!A2:A4)', cached: 3 })]);
    // Protected sheets keep the protection element on the satellite sheet so an edit there is refused, with an allowed range on Data.
    sheets.push(xSheet(satelliteRows, ctx.protection
      ? { protection: { ranges: [{ name: 'VungChoPhep', sqref: 'A1:B1' }] } }
      : {}));
    defined.push({ name: 'TongDoanhThu', ref: 'PhuLuc!$B$2' });
    if (ctx.kitchen) defined.push({ name: 'ChiTieu', ref: 'PhuLuc!$A$2' });
  }

  const names = ctx.multiSheet ? ['Data', 'PhuLuc'] : ['Data'];
  const parts = {};
  parts['[Content_Types].xml'] = X_CONTENT_TYPES(names.length, { chart: !!ctx.chart, vba: !!ctx.vba, customXml: !!ctx.customXml });
  parts['_rels/.rels'] = xRootRels({ customXml: !!ctx.customXml });
  parts['xl/workbook.xml'] = xWorkbook(names, defined);
  parts['xl/_rels/workbook.xml.rels'] = xWorkbookRels(names.length, { chart: !!ctx.chart, vba: !!ctx.vba });
  names.forEach((_, i) => { parts['xl/worksheets/sheet' + (i + 1) + '.xml'] = sheets[i]; });
  parts['xl/styles.xml'] = X_STYLES;
  if (ctx.chart) {
    parts['xl/charts/chart1.xml'] = xChartXml();
    parts['xl/drawings/drawing1.xml'] = DECL + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="' + NS_A + '"/>';
  }
  if (ctx.vba) parts['xl/vbaProject.bin'] = vbaPayload();
  if (ctx.customXml) {
    // A customXml part is never edited by a cell edit; it is the preservation signal F-XLSX-BASIC exists for.
    parts['customXml/item1.xml'] = DECL + '<UniWorkFixture xmlns="urn:uniwork:office:g0"><marker>giu-nguyen-khi-sua</marker></UniWorkFixture>';
    parts['customXml/itemProps1.xml'] = DECL + '<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{6F1B1A0E-0000-4000-8000-000000000001}"><ds:schemaRefs/></ds:datastoreItem>';
  }
  const sst = xSharedStrings(shared);
  parts['xl/sharedStrings.xml'] = sst.xml;
  return writeZip(parts);
}

// ---------------------------------------------------------------------------
// PPTX builders
// ---------------------------------------------------------------------------

const NS_PPT = 'http://schemas.openxmlformats.org/presentationml/2006/main';

function pContentTypes(slideCount, opts) {
  const o = opts || {};
  let overrides = '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>';
  for (let i = 1; i <= slideCount; i += 1) {
    overrides += '<Override PartName="/ppt/slides/slide' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
  }
  overrides += '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>';
  overrides += '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>';
  overrides += '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>';
  overrides += '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>';
  if (o.notes) overrides += '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>';
  return DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    overrides + '</Types>';
}

const P_ROOT_RELS = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>';

function pPresentation(slideCount) {
  const ids = [];
  for (let i = 1; i <= slideCount; i += 1) ids.push('<p:sldId id="' + (255 + i) + '" r:id="rId' + (i + 1) + '"/>');
  return DECL + '<p:presentation xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_PPT + '">' +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    '<p:sldIdLst>' + ids.join('') + '</p:sldIdLst>' +
    '<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>' +
    '<p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
}

function pPresentationRels(slideCount) {
  let rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>';
  for (let i = 1; i <= slideCount; i += 1) {
    rels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + i + '.xml"/>';
  }
  return DECL + '<Relationships xmlns="' + NS_PKG + '">' + rels + '</Relationships>';
}

function pTextBody(text, opts) {
  const o = opts || {};
  const sz = o.size || 2400;
  const bold = o.bold ? ' b="1"' : '';
  const lines = String(text).split('\n').map((line) =>
    '<a:p><a:r><a:rPr lang="vi-VN" sz="' + sz + '"' + bold + '/><a:t>' + line + '</a:t></a:r></a:p>').join('');
  return '<p:txBody><a:bodyPr' + (o.wrap ? ' wrap="square"' : '') + '/><a:lstStyle/>' + lines + '</p:txBody>';
}

function pSlide(shapes, opts) {
  const o = opts || {};
  const clr = o.notesRef ? '<p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr>' : '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>';
  return DECL + '<p:sld xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_PPT + '">' +
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    shapes.join('') + '</p:spTree></p:cSld>' + clr + '</p:sld>';
}

function pShape(id, name, text, x, y, cx, cy, opts) {
  const o = opts || {};
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="' + (o.geom || 'rect') + '"><a:avLst/></a:prstGeom>' +
    (o.fill ? '<a:solidFill><a:srgbClr val="' + o.fill + '"/></a:solidFill>' : '') + '</p:spPr>' +
    pTextBody(text, { size: o.size, bold: o.bold, wrap: true }) + '</p:sp>';
}

function pPicture(id, reqId, cx, cy) {
  return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="Fixture image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="' + reqId + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    '<p:spPr><a:xfrm><a:off x="5000000" y="800000"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
}

function pTableShape(id, rows) {
  const gridCols = rows[0].map(() => '<a:gridCol w="3000000"/>').join('');
  const trs = rows.map((cells, r) => '<a:tr h="370840">' + cells.map((c) =>
    '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="vi-VN" sz="1400"' + (r === 0 ? ' b="1"' : '') + '/><a:t>' + c + '</a:t></a:r></a:p></a:txBody>' +
    '<a:tcPr/></a:tc>').join('') + '</a:tr>').join('');
  return '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + id + '" name="Fixture table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
    '<p:xfrm><a:off x="800000" y="3600000"/><a:ext cx="7000000" cy="1600000"/></p:xfrm>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
    '<a:tbl><a:tblPr firstRow="1"/><a:tblGrid>' + gridCols + '</a:tblGrid>' + trs + '</a:tbl>' +
    '</a:graphicData></a:graphic></p:graphicFrame>';
}

const P_MASTER = DECL + '<p:sldMaster xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_PPT + '">' +
  '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
  '</p:spTree></p:cSld>' +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
  '<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';

const P_MASTER_RELS = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
  '</Relationships>';

const P_LAYOUT = DECL + '<p:sldLayout xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_PPT + '" type="blank" preserve="1">' +
  '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const P_LAYOUT_RELS = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
  '</Relationships>';

const P_CORE = DECL + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  '<dc:title>' + VI.title + '</dc:title><dc:creator>UniWork Office G0</dc:creator>' +
  '<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-16T00:00:00Z</dcterms:created>' +
  '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-16T00:00:00Z</dcterms:modified></cp:coreProperties>';

function pNotesSlide(text) {
  return DECL + '<p:notes xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_PPT + '">' +
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    pShape(2, 'Notes Placeholder', text, 685800, 4400550, 5486400, 3600450, {}) +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
}

const P_NOTES_RELS = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide1.xml"/>' +
  '</Relationships>';

async function buildPptx(ctx) {
  const slide1 = pSlide([
    pShape(2, 'Title', VI.title, 685800, 685800, 7772400, 1470025, { size: 4000, bold: true }),
    pShape(3, 'Subtitle', VI.org, 685800, 2400000, 7772400, 900000, { size: 2000 }),
  ], {});
  const slide2 = pSlide([
    pShape(2, 'Body', VI.body, 685800, 685800, 7772400, 2000000, { size: 1800 }),
    pTableShape(3, [VI.tableHeaders, [VI.labels[0], '1.250.000.000', '1.410.000.000'], [VI.labels[1], '780.000.000', '820.000.000']]),
  ], {});
  const slide3 = pSlide([
    pPicture(3, 'rId2', 731520, 731520),
    pShape(2, 'Image caption', 'Hinh minh hoa: ' + VI.labels[3], 685800, 5000000, 7772400, 700000, { size: 1600 }),
  ], {});
  const slide4 = pSlide([
    pShape(2, 'Unicode', 'CJK: 中文测试 한글 テスト · emoji: 🌏📊✅ · RTL: العربية · ký tự đặc biệt: — “ ” €', 685800, 685800, 7772400, 2200000, { size: 1800 }),
  ], {});
  const tableSlideA = pSlide([
    pShape(2, 'Table title', 'Bảng doanh thu theo quý', 685800, 685800, 7772400, 900000, { size: 2400, bold: true }),
    pTableShape(3, [VI.tableHeaders, [VI.labels[0], '1.250.000.000', '1.410.000.000'], [VI.labels[1], '780.000.000', '820.000.000']]),
  ], {});
  const tableSlideB = pSlide([
    pShape(2, 'Table title 2', 'Bảng chi phí theo quý', 685800, 685800, 7772400, 900000, { size: 2400, bold: true }),
    pTableShape(3, [VI.tableHeaders, [VI.labels[2], '470.000.000', '590.000.000'], [VI.labels[3], '+12%', '+8%']]),
  ], {});

  const slideList = ctx.set === 'table'
    ? [tableSlideA, tableSlideB]
    : ctx.unicodeOnly ? [slide4] : ctx.slides === 1 ? [slide1] : [slide1, slide2, slide3, slide4];
  const parts = {};
  parts['[Content_Types].xml'] = pContentTypes(slideList.length, { notes: !!ctx.notes });
  parts['_rels/.rels'] = P_ROOT_RELS;
  parts['ppt/presentation.xml'] = pPresentation(slideList.length);
  parts['ppt/_rels/presentation.xml.rels'] = pPresentationRels(slideList.length);
  slideList.forEach((xml, i) => {
    const imageSlide = i === 2 || ctx.unicodeOnly;
    parts['ppt/slides/slide' + (i + 1) + '.xml'] = xml;
    parts['ppt/slides/_rels/slide' + (i + 1) + '.xml.rels'] = DECL + '<Relationships xmlns="' + NS_PKG + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
      (ctx.notes && i === 0 ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>' : '') +
      (imageSlide ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' : '') +
      '</Relationships>';
  });
  parts['ppt/slideMasters/slideMaster1.xml'] = P_MASTER;
  parts['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = P_MASTER_RELS;
  parts['ppt/slideLayouts/slideLayout1.xml'] = P_LAYOUT;
  parts['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = P_LAYOUT_RELS;
  parts['ppt/theme/theme1.xml'] = W_THEME.replace(/wordprocessingml/g, 'presentationml');
  parts['docProps/core.xml'] = P_CORE;
  parts['ppt/media/image1.png'] = tinyPng();
  if (ctx.notes) {
    parts['ppt/notesSlides/notesSlide1.xml'] = pNotesSlide(VI.notes);
    parts['ppt/notesSlides/_rels/notesSlide1.xml.rels'] = P_NOTES_RELS;
  }
  return writeZip(parts);
}



// ---------------------------------------------------------------------------
// PDF, Markdown and HTML builders
// ---------------------------------------------------------------------------

const VI_MD = [
  '---',
  'title: ' + VI.title,
  'author: UniWork Office G0',
  'tags: [kiem-thu, tieng-viet, g0]',
  '---',
  '',
  '# ' + VI.title,
  '',
  VI.body,
  '',
  '## Bang so lieu',
  '',
  '| ' + VI.tableHeaders.join(' | ') + ' |',
  '| --- | --- | --- |',
  '| ' + VI.labels[0] + ' | 1.250.000.000 | 1.410.000.000 |',
  '| ' + VI.labels[1] + ' | 780.000.000 | 820.000.000 |',
  '| ' + VI.labels[2] + ' | 470.000.000 | 590.000.000 |',
  '',
  '## Cong thuc va so do',
  '',
  'Cong thuc tinh lai: $E = mc^2$ va khoi inline `SUM(B2:B4)`.',
  '',
  '\u0060\u0060\u0060mermaid',
  'graph LR',
  '  A[Thu thap] --> B[Doi chieu]',
  '  B --> C[Ky duyet]',
  '\u0060\u0060\u0060',
  '',
  '\u0060\u0060\u0060js',
  'const tong = [1, 2, 3].reduce((a, b) => a + b, 0);',
  'console.log("Tong:", tong);',
  '\u0060\u0060\u0060',
  '',
  '## Lien ket tai nguyen',
  '',
  '![Anh minh hoa](assets/fixture-image.png)',
  '',
  'Lien ket tuong doi: [chi tiet](assets/notes.txt)',
  '',
  '> Ghi chu trich dan: noi dung giu nguyen khi luu.',
  '',
  '- Muc mot',
  '- Muc hai',
  '  - Muc hai phan cap',
  '',
  'Ket thuc tai lieu. Tieng Viet co dau: ' + VI.body,
  '',
].join('\n');

const HH_VI = [
  '<!DOCTYPE html>',
  '<html lang="vi">',
  '<head>',
  '<meta charset="utf-8"/>',
  '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
  '<title>' + VI.title + '</title>',
  '<style>',
  '  body { font-family: "Segoe UI", system-ui, sans-serif; color: #1f2328; background: #ffffff; }',
  '  h1 { color: #f26522; }',
  '  table { border-collapse: collapse; }',
  '  td, th { border: 1px solid #d0d7de; padding: 6px 10px; }',
  '</style>',
  '</head>',
  '<body>',
  '  <h1>' + VI.title + '</h1>',
  '  <p>' + VI.body + '</p>',
  '  <table>',
  '    <thead><tr>' + VI.tableHeaders.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead>',
  '    <tbody>',
  '      <tr><td>' + VI.labels[0] + '</td><td>1.250.000.000</td><td>1.410.000.000</td></tr>',
  '      <tr><td>' + VI.labels[1] + '</td><td>780.000.000</td><td>820.000.000</td></tr>',
  '    </tbody>',
  '  </table>',
  '  <p><img src="assets/fixture-image.png" alt="Anh minh hoa" width="64" height="64"/></p>',
  '  <p><a href="assets/notes.txt">Tai nguyen tuong doi</a></p>',
  '</body>',
  '</html>',
  '',
].join('\n');

/** HTML whose script must not reach the host session or escape its origin. */
const HH_SCRIPT = [
  '<!DOCTYPE html>',
  '<html lang="vi">',
  '<head><meta charset="utf-8"/><title>Kiem thu cach ly</title></head>',
  '<body>',
  '  <h1>Kiem thu cach ly preview</h1>',
  '  <p id="ket-qua">chua chay</p>',
  '<script>',
  '  try {',
  "    var host = window.parent !== window ? 'co-parent' : 'khong-parent';",
  "    var top = window.top;",
  "    var cookie = document.cookie;",
  "    var hasil = 'host=' + host + ';cookie=' + (cookie ? 'co' : 'khong');",
  "    document.getElementById('ket-qua').textContent = hasil;",
  '  } catch (e) {',
  "    document.getElementById('ket-qua').textContent = 'loi: ' + e.name;",
  '  }',
  '</script>',
  '</body>',
  '</html>',
  '',
].join('\n');

const MN_VI = '# ' + VI.title + '\n\n' + VI.body + '\n\n- Muc mot\n- Muc hai\n';

/** The same Vietnamese document without the math and mermaid blocks, so the plain and kitchen-sink cases stay distinguishable. */
const MD_VI = [
  '---',
  'title: ' + VI.title,
  'author: UniWork Office G0',
  '---',
  '',
  '# ' + VI.title,
  '',
  VI.body,
  '',
  '## Bang so lieu',
  '',
  '| ' + VI.tableHeaders.join(' | ') + ' |',
  '| --- | --- | --- |',
  '| ' + VI.labels[0] + ' | 1.250.000.000 | 1.410.000.000 |',
  '| ' + VI.labels[1] + ' | 780.000.000 | 820.000.000 |',
  '',
  '## Lien ket tai nguyen',
  '',
  '![Anh minh hoa](assets/fixture-image.png)',
  '',
  'Lien ket tuong doi: [chi tiet](assets/notes.txt)',
  '',
  '> Ghi chu trich dan: noi dung giu nguyen khi luu.',
  '',
  '- Muc mot',
  '- Muc hai',
  '  - Muc hai phan cap',
  '',
].join('\n');

/** Asset-focused Markdown: two relative references and one fenced block, nothing else that could mask an unresolved asset. */
const MD_ASSET = [
  '# ' + VI.title,
  '',
  'Anh tuong doi: ![Anh minh hoa](assets/fixture-image.png)',
  '',
  'Tep dinh kem: [ghi chu](assets/notes.txt)',
  '',
  '```text',
  'anh va tep phai giai theo duong dan tuong doi cua tai lieu.',
  '```',
  '',
  'Ket thuc.',
  '',
].join('\n');

/** A page with no external reference at all: no image, no stylesheet, no script. */
const HH_SINGLE = [
  '<!DOCTYPE html>',
  '<html lang="vi">',
  '<head>',
  '<meta charset="utf-8"/>',
  '<title>' + VI.title + '</title>',
  '<style>',
  '  body { font-family: system-ui, sans-serif; color: #1f2328; background: #ffffff; }',
  '  h1 { color: #f26522; }',
  '</style>',
  '</head>',
  '<body>',
  '  <h1>' + VI.title + '</h1>',
  '  <p>' + VI.body + '</p>',
  '  <ul><li>Muc mot</li><li>Muc hai</li></ul>',
  '</body>',
  '</html>',
  '',
].join('\n');

/** The same page with a relative stylesheet and a relative image, both of which must resolve beside the document. */
const HH_ASSET = [
  '<!DOCTYPE html>',
  '<html lang="vi">',
  '<head>',
  '<meta charset="utf-8"/>',
  '<title>' + VI.title + '</title>',
  '<link rel="stylesheet" href="assets/site.css"/>',
  '</head>',
  '<body>',
  '  <h1>' + VI.title + '</h1>',
  '  <p>' + VI.body + '</p>',
  '  <p><img src="assets/fixture-image.png" alt="Anh minh hoa" width="64" height="64"/></p>',
  '  <p><a href="assets/notes.txt">Tai nguyen tuong doi</a></p>',
  '</body>',
  '</html>',
  '',
].join('\n');

async function buildPdf(kind) {
  const doc = await PDFDocument.create();
  doc.setTitle(VI.title);
  doc.setAuthor('UniWork Office G0');
  doc.setSubject('Fixture kiểm thử tiếng Việt');
  doc.setCreationDate(new Date('2026-09-16T00:00:00Z'));
  doc.setModificationDate(new Date('2026-09-16T00:00:00Z'));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ascii = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

  if (kind === 'image') {
    const png = await doc.embedPng(tinyPng());
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(png, { x: 72, y: 641.89, width: 96, height: 96 });
    page.drawText(ascii('Fixture: anh nhu mot doi tuong noi dung'), { x: 72, y: 600, size: 14, font });
  } else if (kind === 'table') {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(ascii(VI.title), { x: 72, y: 770, size: 16, font: bold });
    const rows = [VI.tableHeaders, [VI.labels[0], '1.250.000.000', '1.410.000.000'], [VI.labels[1], '780.000.000', '820.000.000']];
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        page.drawText(ascii(cell), { x: 72 + c * 150, y: 730 - r * 22, size: 11, font: r === 0 ? bold : font });
      });
    });
  } else if (kind === 'scan') {
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(await doc.embedPng(tinyPng()), { x: 0, y: 0, width: 595.28, height: 841.89 });
  } else {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(ascii(VI.title), { x: 72, y: 780, size: 18, font: bold, color: rgb(0.95, 0.4, 0.13) });
    const lines = [
      ascii(VI.body),
      ascii('Doan van thu hai: noi dung phai sua duoc trong lop chu co san.'),
      ascii('So lieu: 1.250.000.000 VND; 780.000.000 VND; 470.000.000 VND.'),
      ascii('Ky tu: "trich dan", (ngoac), [vuong], {nhon}, -gach- "%" "&" "<" ">".'),
    ];
    lines.forEach((line, i) => {
      page.drawText(line, { x: 72, y: 740 - i * 20, size: 11, font });
    });
    page.drawText(ascii('Trang 1/2'), { x: 72, y: 60, size: 9, font });
    const page2 = doc.addPage([595.28, 841.89]);
    page2.drawText(ascii('Trang hai: bang va hinh'), { x: 72, y: 780, size: 14, font: bold });
    page2.drawImage(await doc.embedPng(tinyPng()), { x: 72, y: 660, width: 72, height: 72 });
    page2.drawText(ascii('Trang 2/2'), { x: 72, y: 60, size: 9, font });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}



// ---------------------------------------------------------------------------
// Large-band fixture (Q9: mostly under 50 MiB)
// ---------------------------------------------------------------------------

const MIB = 1024 * 1024;

/**
 * Builds a DOCX whose uncompressed content approaches the requested byte size.
 * The point is the near-50 MiB band from Q9: the entry must be described and
 * measured, not "a big file we happened to have".
 */
async function buildLargeDocx(targetBytes) {
  const paras = [];
  const filler = VI.body + ' ' + VI.body + ' ' + VI.body;
  let approx = 0;
  let index = 0;
  while (approx < targetBytes) {
    const p = wPara(String(index + 1) + '. ' + filler);
    approx += Buffer.byteLength(p, 'utf8');
    paras.push(p);
    index += 1;
  }
  const parts = {
    '[Content_Types].xml': W_CONTENT_TYPES,
    '_rels/.rels': W_ROOT_RELS,
    'word/_rels/document.xml.rels': W_DOC_RELS,
    'word/document.xml': wDocument(paras.join(''), wSectPr()),
    'word/styles.xml': W_STYLES,
    'word/numbering.xml': W_NUMBERING,
    'word/footnotes.xml': W_FOOTNOTES,
    'word/comments.xml': W_COMMENTS,
    'word/theme/theme1.xml': W_THEME,
    'docProps/core.xml': W_CORE,
  };
  return writeZip(parts);
}

async function buildLargeXlsx(targetBytes) {
  const rowTarget = Math.max(1, Math.floor(targetBytes / 90));
  const rows = [[xCell('A1', { sharedIndex: 0, style: 2 }), xCell('B1', { sharedIndex: 1, style: 2 }), xCell('C1', { sharedIndex: 2, style: 2 })]];
  for (let r = 2; r <= rowTarget; r += 1) {
    rows.push([
      xCell('A' + r, { sharedIndex: 3 }),
      xCell('B' + r, { number: r * 1000 }),
      xCell('C' + r, { formula: 'B' + r + '*2', cached: r * 2000 }),
    ]);
  }
  const sheet = xSheet(rows, {});
  const sst = xSharedStrings([VI.tableHeaders[0], VI.tableHeaders[1], VI.tableHeaders[2], VI.labels[0]]);
  return writeZip({
    '[Content_Types].xml': X_CONTENT_TYPES(1, { chart: false, vba: false }),
    '_rels/.rels': xRootRels({}),
    'xl/workbook.xml': xWorkbook(['Data'], []),
    'xl/_rels/workbook.xml.rels': xWorkbookRels(1, {}),
    'xl/worksheets/sheet1.xml': sheet,
    'xl/styles.xml': X_STYLES,
    'xl/sharedStrings.xml': sst.xml,
  });
}



// ---------------------------------------------------------------------------
// Fixture registry: fixture id -> builder + target path
// ---------------------------------------------------------------------------

const ASSET_PNG_REL = 'assets/fixture-image.png';
const ASSET_TXT_REL = 'assets/notes.txt';

/** Builders keyed by fixture id. Every entry writes its own file(s). */
const BUILDERS = {
  'F-DOCX-VI': { kind: 'file', build: (ctx) => buildDocx(Object.assign({ table: true, headings: true, footnote: true }, ctx)) },
  'F-DOCX-KITCHEN': { kind: 'file', build: (ctx) => buildDocx(Object.assign({ table: true, longTable: false, numberedList: true, headings: true, footnote: true, longText: true }, ctx)) },
  'F-DOCX-TABLE-IMG': { kind: 'file', build: (ctx) => buildDocx(Object.assign({ table: true, image: true }, ctx)) },
  'F-DOCX-LONGTABLE': { kind: 'file', build: (ctx) => buildDocx(Object.assign({ longTable: true, headings: true }, ctx)) },
  'F-DOCX-FOOTNOTES': { kind: 'file', build: (ctx) => buildDocx(Object.assign({ footnote: true }, ctx)) },
  'F-DOCX-2COL': { kind: 'file', build: (ctx) => buildDocx(Object.assign({ columns: 2, longText: true }, ctx)) },
  'F-DOCX-EMPTY': { kind: 'file', build: async () => buildDocx({ empty: true, image: false, table: false }) },
  'F-DOCX-THEME': { kind: 'file', build: (ctx) => buildDocx(Object.assign({ table: true, longText: true }, ctx)) },
  'F-DOCX-CHART': { kind: 'pending', reason: 'chart parts need the upstream docx-engine builder; a hand-written chart part would be a snapshot of this script, not of the engine' },
  'F-DOCX-WATERMARK': { kind: 'pending', reason: 'watermark needs header/parity parts that the upstream docx-engine builder owns; generating it here would not exercise the engine' },
  'F-DOCX-TOC': { kind: 'pending', reason: 'a TOC requires field results matched to heading pagination; only a real editor run can produce a meaningful expected result' },
  'F-DOCX-EQUATION': { kind: 'pending', reason: 'OMML equations are produced by packages/docx-engine math builders; the fixture must be generated by the engine, not re-implemented' },
  'F-DOCX-REVISIONS': { kind: 'pending', reason: 'tracked changes need w:ins/w:del trees the docs editor produces; a hand-written tree would not round-trip' },
  'F-DOCX-NUMBERED-LIST': { kind: 'file', build: (ctx) => buildDocx(Object.assign({ numberedList: true }, ctx)) },
  'F-DOCX-EMBEDDED-FONT': { kind: 'pending', reason: 'an embedded obfuscated font requires a licensed source font; the licence must be settled before this fixture ships' },
  'F-DOCX-PROTECTED': { kind: 'pending', reason: 'the protection hash must come from packages/docx-engine protection.ts so the editor accepts the password' },
  'F-DOCX-PWD-STANDARD': { kind: 'copied' },
  'F-DOCX-PWD-AGILE': { kind: 'copied' },
  'F-DOCX-PWD-AGILE-PLAIN': { kind: 'copied' },
  'F-DOCX-FR-JUSTIFY': { kind: 'copied' },
  'F-DOCX-SIMPLE': { kind: 'copied' },
  'F-DOCX-CAPTABLE-FLOAT': { kind: 'copied' },
  'F-XLSX-VI': { kind: 'file', build: (ctx) => buildXlsx(Object.assign({ multiSheet: true, chart: true }, ctx)) },
  'F-XLSX-KITCHEN': { kind: 'file', build: () => buildXlsx({ multiSheet: true, chart: true, kitchen: true }) },
  'F-XLSX-BASIC': { kind: 'file', build: () => buildXlsx({ multiSheet: false, chart: false, customXml: true }) },
  'F-XLSX-EDIT': { kind: 'file', build: () => buildXlsx({ multiSheet: false, chart: false, formulas: false, sparse: true }) },
  'F-XLSX-SHEETS': { kind: 'file', build: () => buildXlsx({ multiSheet: true, chart: false }) },
  'F-XLSX-STRUCT': { kind: 'file', build: () => buildXlsx({ multiSheet: true, chart: true, protection: true }) },
  'F-XLSX-CHART': { kind: 'file', build: () => buildXlsx({ multiSheet: false, chart: true }) },
  'F-XLSX-MACRO': { kind: 'file', build: () => buildXlsx({ multiSheet: false, chart: false, vba: true }) },
  'F-XLSX-PIVOT': { kind: 'pending', reason: 'a pivot table needs a pivotCache definition plus its records part; the xlsx-gateway pivot builder owns that shape' },
  'F-XLSX-PROTECTED': { kind: 'file', build: () => buildXlsx({ multiSheet: false, chart: false, protection: true }) },
  'F-LEGACY-XLS': { kind: 'pending', reason: 'a BIFF8 .xls cannot be written by this generator; the fixture must come from an upstream or licensed source and be recorded as copied' },
  'F-LEGACY-DOC': { kind: 'copied' },
  'F-LEGACY-PPT': { kind: 'copied' },
  'F-PPTX-STD': { kind: 'copied' },
  'F-PPTX-UNICODE': { kind: 'file', build: () => buildPptx({ unicodeOnly: true }) },
  'F-PPTX-VI': { kind: 'file', build: () => buildPptx({ slides: 4 }) },
  'F-PPTX-NOTES': { kind: 'file', build: () => buildPptx({ slides: 1, notes: true }) },
  'F-PPTX-TABLE': { kind: 'file', build: () => buildPptx({ set: 'table' }) },
  'F-PPTX-CHART': { kind: 'pending', reason: 'a PPTX chart requires an embedded workbook part and chart XML from packages/pptx-engine chart builders' },
  'F-PPTX-ANIM': { kind: 'pending', reason: 'animation timing trees are produced by packages/pptx-engine animation.ts and must round-trip through it' },
  'F-PPTX-EMBEDDED-FONT': { kind: 'pending', reason: 'embedded fonts carry licence obligations that must be settled before shipping the fixture' },
  'F-PDF-TEXT': { kind: 'file', build: () => buildPdf('text') },
  'F-PDF-IMAGE': { kind: 'file', build: () => buildPdf('image') },
  'F-PDF-TABLE': { kind: 'file', build: () => buildPdf('table') },
  'F-PDF-SCAN': { kind: 'file', build: () => buildPdf('scan') },
  'F-PDF-PWD4SP': { kind: 'copied' },
  'F-PDF-CERT': { kind: 'copied' },
  'F-PDF-CORRUPT': { kind: 'copied' },
  'F-PDF-FORM': { kind: 'pending', reason: 'AcroForm fields need a real Widget annotation tree; the pdf-lib form API would produce a form the app never sees from Word or a scanner' },
  'F-MD-VI': { kind: 'file', build: async () => Buffer.from(MD_VI, 'utf8'), assets: true },
  'F-MD-FULL': { kind: 'file', build: async () => Buffer.from(VI_MD, 'utf8'), assets: true },
  'F-MD-FRONTMATTER': { kind: 'file', build: async () => Buffer.from(VI_MD.split('\n').slice(0, 6).join('\n') + '\n' + MN_VI, 'utf8') },
  'F-MD-ASSET': { kind: 'file', build: async () => Buffer.from(MD_ASSET, 'utf8'), assets: true },
  'F-HTML-VI': { kind: 'file', build: async () => Buffer.from(HH_VI, 'utf8'), assets: true },
  'F-HTML-ASSET': { kind: 'file', build: async () => Buffer.from(HH_ASSET, 'utf8'), assets: true },
  'F-HTML-SINGLE': { kind: 'file', build: async () => Buffer.from(HH_SINGLE, 'utf8') },
  'F-HTML-SCRIPT': { kind: 'file', build: async () => Buffer.from(HH_SCRIPT, 'utf8') },
  'F-UNSUPPORTED-ODT': { kind: 'file', build: () => buildOdf('odt') },
  'F-UNSUPPORTED-ODS': { kind: 'file', build: () => buildOdf('ods') },
  'F-UNSUPPORTED-XLSB': { kind: 'file', build: async () => Buffer.from('PK\u0003\u0004 (not a real package; xlsb must be rejected)', 'latin1') },
  'F-UNSUPPORTED-RTF': { kind: 'file', build: async () => buildRtf() },
  'F-IMG-SMALL': { kind: 'asset-only', build: async () => tinyPng() },
  'F-LARGE-DOCX': { kind: 'lab-large', build: (ctx) => buildLargeDocx(ctx.bytes || 46 * MIB) },
  'F-LARGE-XLSX': { kind: 'lab-large', build: (ctx) => buildLargeXlsx(ctx.bytes || 46 * MIB) },
};



// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function labPathFor(fixture) {
  return path.resolve(LAB_ROOT, fixture.production?.labPath || path.join('fixtures', 'large', path.basename(fixture.path)));
}

/** Refuses any produced path that escapes the fixture tree or the lab tree. */
function assertInside(target, root, label) {
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(label + ' escapes its root: ' + target);
  }
}

const results = [];
const manifestById = new Map(manifest.fixtures.map((f) => [f.id, f]));

/**
 * The only production methods this generator may write. Any other recorded
 * method - `copied`, `pending`, or a future `upstream-generator` - is emitted by
 * something else (a pinned upstream blob, an upstream builder, or nothing at
 * all), so this script must never build over it.
 */
const PRODUCIBLE_METHODS = ['generated', 'lab-large'];

async function produce(fixture) {
  // The recorded production method is authoritative, ahead of the builder table.
  // `production.method` is preferred and `generation.method` is the field this
  // manifest actually carries, so both readings resolve to one value.
  const method = fixture.production?.method ?? fixture.generation?.method ?? null;
  if (!PRODUCIBLE_METHODS.includes(method)) {
    return {
      id: fixture.id,
      action: 'skipped',
      why: 'production method ' + String(method) + ' is not produced by this generator; its bytes and checksums come from the recorded source',
    };
  }
  const entry = BUILDERS[fixture.id] || { kind: 'pending', reason: 'no builder registered for this fixture id' };
  if (entry.kind === 'copied') return { id: fixture.id, action: 'skipped', why: 'copied from upstream; see provenance in the manifest' };
  if (entry.kind === 'pending') return { id: fixture.id, action: 'skipped', why: 'pending: ' + entry.reason };

  const buf = await entry.build({ bytes: args.large || undefined });
  const target = entry.kind === 'lab-large' ? labPathFor(fixture) : path.join(FILE_ROOT, fixture.path);
  const root = entry.kind === 'lab-large' ? LAB_ROOT : FILE_ROOT;
  assertInside(target, root, fixture.id);
  if (/[\\/]ee[\\/]|\.\.\//.test(fixture.path)) {
    throw new Error(fixture.id + ': refusing a path that mentions ee/ or parent traversal: ' + fixture.path);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);

  if (entry.assets) {
    const dir = path.dirname(target);
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, ASSET_PNG_REL), tinyPng());
    fs.writeFileSync(path.join(dir, ASSET_TXT_REL), 'Tai nguyen tuong doi cho fixture Markdown va HTML.\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'assets/site.css'), 'body { color: #1f2328; background: #ffffff; }\n', 'utf8');
  }
  if (entry.kind === 'asset-only') {
    const assetPath = path.join(FILE_ROOT, 'assets', path.basename(fixture.path));
    assertInside(assetPath, FILE_ROOT, fixture.id);
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, buf);
  }
  return { id: fixture.id, action: 'produced', path: entry.kind === 'lab-large' ? path.relative(LAB_ROOT, target) : fixture.path, bytes: buf.length, sha256: sha256(buf) };
}

const targets = manifest.fixtures.filter((f) => {
  if (args.only.length && !args.only.includes(f.id)) return false;
  const entry = BUILDERS[f.id];
  if (!entry) return false;
  if (entry.kind === 'lab-large' && !args.large) return false;
  return true;
});

for (const fixture of targets) {
  results.push(await produce(fixture));
}

if (args.updateChecksums) {
  let updated = 0;
  const labRecords = [];
  for (const r of results) {
    if (r.action !== 'produced') continue;
    const f = manifestById.get(r.id);
    if (!f) continue;
    // Belt and braces under H4: a copied or upstream-generated entry is never
    // reblessed even if a later bug produced a file for it. This is the guard
    // whose absence let the copied kitchen fixture's hash be rewritten to the
    // generated bytes.
    const method = f.production?.method ?? f.generation?.method ?? null;
    if (!PRODUCIBLE_METHODS.includes(method)) continue;
    if (method === 'lab-large') {
      // Lab files stay out of Git, so their checksum must not enter the committed
      // manifest; it is recorded beside the file instead.
      labRecords.push({ id: r.id, path: r.path, bytes: r.bytes, sha256: r.sha256, labPath: f.production.labPath, defaultBytes: f.production.defaultBytes });
      continue;
    }
    if (f.sha256 !== r.sha256 || f.bytes !== r.bytes) updated += 1;
    f.sha256 = r.sha256;
    f.bytes = r.bytes;
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  process.stdout.write('manifest updated: ' + updated + ' entr' + (updated === 1 ? 'y' : 'ies') + ' changed\n');
  if (labRecords.length) {
    const recordPath = path.join(LAB_ROOT, 'fixtures', 'large', 'lab-record.json');
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, JSON.stringify({
      schemaVersion: 1,
      kind: 'uniwork-office-lab-fixture-record',
      issue: 'UNI-666',
      note: 'Checksums for the Q9 large-band fixtures. They are generated into the lab and never committed, so their checksums live here rather than in docs/office/g0/fixtures/manifest.json.',
      generator: 'scripts/office-g0/generate-fixtures.mjs',
      requestBytes: args.large || null,
      fixtures: labRecords,
    }, null, 2) + '\n', 'utf8');
    process.stdout.write('lab record updated: ' + labRecords.length + ' fixture(s) -> ' + recordPath + '\n');
  }
}

for (const r of results) {
  if (r.action === 'produced') {
    process.stdout.write('produced ' + r.id + ' -> ' + r.path + ' (' + r.bytes + ' bytes, sha256 ' + r.sha256.slice(0, 16) + '...)\n');
  } else {
    process.stdout.write('skipped  ' + r.id + ' (' + r.why + ')\n');
  }
}

const produced = results.filter((r) => r.action === 'produced').length;
const skipped = results.length - produced;
process.stdout.write('\n' + produced + ' produced, ' + skipped + ' skipped, ' + manifest.fixtures.length + ' declared in the manifest\n');


/** Minimal but genuine ODF package; the mimetype entry is stored uncompressed, as the spec requires. */
async function buildOdf(kind) {
  const NS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  const NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const NS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const mime = kind === 'ods'
    ? 'application/vnd.oasis.opendocument.spreadsheet'
    : 'application/vnd.oasis.opendocument.text';
  const manifestXml = DECL + '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
    '<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="' + mime + '"/>' +
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
    '</manifest:manifest>';
  const bodyXml = kind === 'ods'
    ? '<office:spreadsheet><table:table table:name="Data">'
      + '<table:table-row><table:table-cell office:value-type="string"><text:p>' + VI.tableHeaders[0] + '</text:p></table:table-cell>'
      + '<table:table-cell office:value-type="float" office:value="1250000000"><text:p>1.250.000.000</text:p></table:table-cell></table:table-row>'
      + '</table:table></office:spreadsheet>'
    : '<office:text><text:h text:outline-level="1">' + VI.title + '</text:h>'
      + '<text:p>' + VI.body + '</text:p></office:text>';
  const contentXml = DECL + '<office:document-content xmlns:office="' + NS_OFFICE + '" xmlns:text="' + NS_TEXT + '" '
    + 'xmlns:table="' + NS_TABLE + '" office:version="1.3"><office:body>' + bodyXml + '</office:body></office:document-content>';
  // Routed through the same deterministic writer as every other package:
  // `mimetype` is pinned first and stored uncompressed (ODF 1.3 requires it at
  // entry 0 with method STORE), the remaining parts follow in code-unit order,
  // and all entries share the fixed ZIP_DATE.
  return writeZip(
    { mimetype: mime, 'META-INF/manifest.xml': manifestXml, 'content.xml': contentXml },
    { first: ['mimetype'], stored: ['mimetype'] },
  );
}

/** A real RTF 1.5 document; \\u escapes carry the Vietnamese characters. */
function buildRtf() {
  const esc = (s) => Array.from(s).map((ch) => {
    const code = ch.codePointAt(0);
    return code < 128 ? ch : '\\u' + code + '?';
  }).join('');
  const lines = [
    '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}',
    '\\f0\\fs24 ' + esc(VI.title) + '\\par',
    esc(VI.org) + '\\par',
    esc(VI.body) + '\\par',
    '}',
  ];
  return Buffer.from(lines.join('\n'), 'latin1');
}


