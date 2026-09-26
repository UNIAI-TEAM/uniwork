#!/usr/bin/env node
// DOC-002 (UNI-666) - Q9 complexity fixtures: an expansion bomb and a deeply nested document.
//
// Both fixtures are negative/complexity inputs, not capability proof. Their
// job is to make the reader's handling observable and to pin it to the pinned
// engine's own declared limits (packages/docx-engine/src/zip-load.ts):
//   DOCX_ZIP_LIMITS = { maxParts: 10000, maxPartBytes: 512 MiB, maxTotalBytes: 1.5 GiB }
//
//   node scripts/office-g0/generate-expansion-fixtures.mjs --out <owned-directory> [--expansion-mib 600] [--depth 1500]
//
// Determinism: fixed ZIP order, fixed DOS epoch, no timestamps from the host.
// The bomb part is a real DEFLATE stream that expands to the declared size; the
// declared sizes in the central directory are the true ones, so this is a
// genuine expansion fixture and not a hand-edited size field.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MIB = 1024 * 1024;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

export const PARAMS = {
  expansionPartBytes: 600 * MIB,
  expansionFiller: 'EXPANSION-FIXTURE-FILLER-0123456789ABCDEF',
  depth: 1500,
  savedAt: '2026-09-25T00:00:00.000Z',
};

// Table-driven CRC-32 so a 600 MiB payload streams without a native dependency.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** Running CRC state (inverted), pushed chunk by chunk. */
function crc32Init() { return -1; }
function crc32Push(state, buf) {
  let c = state;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c;
}
function crc32Final(state) { return (state ^ -1) >>> 0; }

/** Stream a payload of exactly totalBytes through DEFLATE, chunk by chunk. */
function compressRepeating(pattern, totalBytes, level = 9) {
  return new Promise((resolve, reject) => {
    const deflate = zlib.createDeflateRaw({ level });
    const chunks = [];
    let crc = crc32Init();
    let written = 0;
    deflate.on('data', (chunk) => chunks.push(chunk));
    deflate.on('error', reject);
    deflate.on('end', () => resolve({ compressed: Buffer.concat(chunks), crc: crc32Final(crc), uncompressedBytes: written }));
    const patternBuf = Buffer.from(pattern, 'utf8');
    const chunkBytes = MIB;
    for (let offset = 0; offset < totalBytes; offset += chunkBytes) {
      const size = Math.min(chunkBytes, totalBytes - offset);
      const buf = Buffer.alloc(size);
      for (let p = 0; p < size; p += patternBuf.length) patternBuf.copy(buf, p);
      crc = crc32Push(crc, buf);
      written += size;
      deflate.write(buf);
    }
    deflate.end();
  });
}

function u16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value >>> 0); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; }
function crcOf(buf) { return crc32Final(crc32Push(crc32Init(), buf)); }

/**
 * Deterministic ZIP writer. `parts` is an array of { name, data } or
 * { name, compressed, crc, uncompressedBytes } entries written in the given
 * order with fixed DOS timestamps; no data descriptors are used.
 */
export function writeZip(parts) {
  const localChunks = [];
  const central = [];
  let offset = 0;
  for (const part of parts) {
    const nameBytes = Buffer.from(part.name, 'utf8');
    const payload = part.compressed ?? zlib.deflateRawSync(part.data, { level: 9 });
    const uncompressedBytes = part.uncompressedBytes ?? part.data.length;
    const crc = part.compressed ? part.crc : crcOf(part.data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(payload.length), u32(uncompressedBytes), u16(nameBytes.length), u16(0), nameBytes,
    ]);
    localChunks.push(local, payload);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(payload.length), u32(uncompressedBytes), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]));
    offset += local.length + payload.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(parts.length), u16(parts.length),
    u32(centralBuf.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

export const DOCX_MIN_PARTS = (extraParts) => ({
  '[Content_Types].xml': DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="bin" ContentType="application/octet-stream"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>',
  '_rels/.rels': DECL + '<Relationships xmlns="' + NS_PKG + '">' +
    '<Relationship Id="rId1" Type="' + NS_R + '/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/_rels/document.xml.rels': DECL + '<Relationships xmlns="' + NS_PKG + '">' +
    (extraParts || []).map((rel, index) => '<Relationship Id="rId' + (index + 2) + '" Type="' + NS_R + '/' + rel.type + '" Target="' + rel.target + '"/>').join('') +
    '</Relationships>',
});

const documentXml = (bodyXml) => DECL + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
  bodyXml + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';

const para = (text) => '<w:p><w:r><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>';

/** F-DOCX-EXPANSION: one part that really expands past the per-part limit. */
export async function buildExpansionDocx(params = PARAMS) {
  const payload = await compressRepeating(params.expansionFiller, params.expansionPartBytes, 9);
  const documentPart = Buffer.from(documentXml(para('Expansion fixture sentinel 271828')), 'utf8');
  const extra = DOCX_MIN_PARTS([{ type: 'image', target: 'media/expansion.bin' }]);
  const parts = [
    { name: '[Content_Types].xml', data: Buffer.from(extra['[Content_Types].xml'], 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(extra['_rels/.rels'], 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(extra['word/_rels/document.xml.rels'], 'utf8') },
    { name: 'word/document.xml', data: documentPart },
    { name: 'word/media/expansion.bin', compressed: payload.compressed, crc: payload.crc, uncompressedBytes: payload.uncompressedBytes },
  ];
  const bytes = writeZip(parts);
  return { bytes, complexity: { parts: parts.length, uncompressedBytes: payload.uncompressedBytes, archiveBytes: bytes.length, expansionRatio: Number((payload.uncompressedBytes / bytes.length).toFixed(2)), largestPartBytes: payload.uncompressedBytes } };
}

/** F-DOCX-DEEP-NEST: legal OOXML nested far past any hand-written document. */
export function buildDeepNestDocx(params = PARAMS) {
  const open = '<w:sdt><w:sdtPr><w:tag w:val="depth"/></w:sdtPr><w:sdtContent>';
  const close = '</w:sdtContent></w:sdt>';
  const body = open.repeat(params.depth) + para('Deep nesting fixture sentinel 161803') + close.repeat(params.depth);
  const documentPart = Buffer.from(documentXml(body), 'utf8');
  const extra = DOCX_MIN_PARTS([]);
  const parts = [
    { name: '[Content_Types].xml', data: Buffer.from(extra['[Content_Types].xml'], 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(extra['_rels/.rels'], 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(extra['word/_rels/document.xml.rels'], 'utf8') },
    { name: 'word/document.xml', data: documentPart },
  ];
  const bytes = writeZip(parts);
  return { bytes, complexity: { parts: parts.length, uncompressedBytes: documentPart.length, archiveBytes: bytes.length, expansionRatio: Number((documentPart.length / bytes.length).toFixed(2)), xmlDepth: params.depth * 2 } };
}

export async function main(argv) {
  const args = argv.slice();
  const out = (() => { const i = args.indexOf('--out'); return i === -1 ? null : path.resolve(args[i + 1]); })();
  const expansionMib = (() => { const i = args.indexOf('--expansion-mib'); return i === -1 ? 600 : Number(args[i + 1]); })();
  const depth = (() => { const i = args.indexOf('--depth'); return i === -1 ? 1500 : Number(args[i + 1]); })();
  if (!out) { process.stdout.write('usage: node generate-expansion-fixtures.mjs --out <directory> [--expansion-mib 600] [--depth 1500]\n'); process.exit(2); }
  const params = { ...PARAMS, expansionPartBytes: expansionMib * MIB, depth };
  const expansion = await buildExpansionDocx(params);
  const deepNest = buildDeepNestDocx(params);
  fs.mkdirSync(out, { recursive: true });
  const written = [];
  for (const [name, result] of [['docx-expansion-bomb.docx', expansion], ['docx-deep-nest.docx', deepNest]]) {
    const target = path.join(out, name);
    if (fs.existsSync(target) && sha256(fs.readFileSync(target)) !== sha256(result.bytes)) throw new Error('Refusing to overwrite different fixture bytes: ' + target);
    fs.writeFileSync(target, result.bytes);
    written.push({ name, bytes: result.bytes.length, sha256: sha256(result.bytes), complexity: result.complexity });
  }
  const receiptPath = path.join(out, 'docx-expansion.receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify({
    fixtures: written,
    zipLimits: { maxParts: 10000, maxPartBytes: 512 * MIB, maxTotalBytes: 1.5 * 1024 * MIB, source: 'packages/docx-engine/src/zip-load.ts DOCX_ZIP_LIMITS at the pinned commit' },
    generator: 'scripts/office-g0/generate-expansion-fixtures.mjs',
    params: { expansionPartBytes: params.expansionPartBytes, depth: params.depth, fillerLength: params.expansionFiller.length },
  }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ written, receipt: receiptPath }, null, 2) + '\n');
  return written;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));