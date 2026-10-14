// Tiny TrueType reader + glyph-preserving subsetter for the PDF fixture. Glyph ids are kept (unused glyphs are
// emptied), so composite glyphs (Vietnamese diacritics) need no renumbering and the PDF can use Identity-H directly.

const u16 = (b, o) => b.readUInt16BE(o);
const i16 = (b, o) => b.readInt16BE(o);
const u32 = (b, o) => b.readUInt32BE(o);

export function readTtf(buf) {
  const tables = {};
  const numTables = u16(buf, 4);
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    tables[buf.toString('latin1', rec, rec + 4)] = { offset: u32(buf, rec + 8), length: u32(buf, rec + 12) };
  }
  const head = tables.head.offset;
  const font = {
    buf,
    tables,
    unitsPerEm: u16(buf, head + 18),
    locaFormat: i16(buf, head + 50),
    numGlyphs: u16(buf, tables.maxp.offset + 4),
    numHMetrics: u16(buf, tables.hhea.offset + 34),
    ascent: i16(buf, tables.hhea.offset + 4),
    descent: i16(buf, tables.hhea.offset + 6),
    cmap: new Map(),
  };
  readCmap(font);
  return font;
}

function readCmap(font) {
  const { buf } = font;
  const base = font.tables.cmap.offset;
  const count = u16(buf, base + 2);
  let best = null;
  for (let i = 0; i < count; i += 1) {
    const platform = u16(buf, base + 4 + i * 8);
    const encoding = u16(buf, base + 6 + i * 8);
    const offset = base + u32(buf, base + 8 + i * 8);
    const format = u16(buf, offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (unicode && (format === 12 || (format === 4 && !best))) best = { offset, format };
    if (best?.format === 12) break;
  }
  if (!best) throw new Error('font has no usable unicode cmap');
  const { offset, format } = best;
  if (format === 12) {
    const groups = u32(buf, offset + 12);
    for (let g = 0; g < groups; g += 1) {
      const at = offset + 16 + g * 12;
      const start = u32(buf, at);
      const end = u32(buf, at + 4);
      const startGid = u32(buf, at + 8);
      for (let c = start; c <= end; c += 1) font.cmap.set(c, startGid + (c - start));
    }
    return;
  }
  const segX2 = u16(buf, offset + 6);
  const endCodes = offset + 14;
  const startCodes = endCodes + segX2 + 2;
  const deltas = startCodes + segX2;
  const rangeOffsets = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s += 1) {
    const end = u16(buf, endCodes + s * 2);
    const start = u16(buf, startCodes + s * 2);
    const delta = i16(buf, deltas + s * 2);
    const ro = u16(buf, rangeOffsets + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c += 1) {
      let gid;
      if (ro === 0) gid = (c + delta) & 0xffff;
      else {
        const at = rangeOffsets + s * 2 + ro + (c - start) * 2;
        gid = u16(buf, at);
        if (gid !== 0) gid = (gid + delta) & 0xffff;
      }
      if (gid) font.cmap.set(c, gid);
    }
  }
}

const glyphBounds = (font, gid) => {
  const { buf, tables, locaFormat } = font;
  const loca = tables.loca.offset;
  const read = (i) => (locaFormat === 0 ? u16(buf, loca + i * 2) * 2 : u32(buf, loca + i * 4));
  return [tables.glyf.offset + read(gid), tables.glyf.offset + read(gid + 1)];
};

export function glyphWidth(font, gid) {
  const index = Math.min(gid, font.numHMetrics - 1);
  return u16(font.buf, font.tables.hmtx.offset + index * 4);
}

function componentsOf(font, gid) {
  const [start, end] = glyphBounds(font, gid);
  if (end <= start || i16(font.buf, start) >= 0) return [];
  const out = [];
  let at = start + 10;
  for (;;) {
    const flags = u16(font.buf, at);
    out.push(u16(font.buf, at + 2));
    at += 4 + (flags & 1 ? 4 : 2);
    if (flags & 0x8) at += 2;
    else if (flags & 0x40) at += 4;
    else if (flags & 0x80) at += 8;
    if (!(flags & 0x20)) break;
  }
  return out;
}

function checksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) sum = (sum + (buf.readUInt32BE(i) >>> 0)) >>> 0;
  return sum;
}

const pad4 = (buf) => (buf.length % 4 === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]));

/** Returns the subset font file keeping only the glyphs for `gids` (plus gid 0 and composite components). */
export function subsetTtf(font, gids) {
  const keep = new Set([0]);
  const queue = [...gids];
  while (queue.length) {
    const gid = queue.pop();
    if (keep.has(gid)) continue;
    keep.add(gid);
    queue.push(...componentsOf(font, gid));
  }
  const glyphChunks = [];
  const loca = Buffer.alloc((font.numGlyphs + 1) * 4);
  let size = 0;
  for (let gid = 0; gid < font.numGlyphs; gid += 1) {
    loca.writeUInt32BE(size, gid * 4);
    if (keep.has(gid)) {
      const [start, end] = glyphBounds(font, gid);
      const chunk = pad4(font.buf.subarray(start, end));
      glyphChunks.push(chunk);
      size += chunk.length;
    }
  }
  loca.writeUInt32BE(size, font.numGlyphs * 4);
  const slice = (tag) => {
    const t = font.tables[tag];
    return Buffer.from(font.buf.subarray(t.offset, t.offset + t.length));
  };
  const head = slice('head');
  head.writeUInt32BE(0, 8); // checkSumAdjustment, patched below
  head.writeInt16BE(1, 50); // long loca
  const out = {
    head,
    hhea: slice('hhea'),
    maxp: slice('maxp'),
    hmtx: slice('hmtx'),
    loca,
    glyf: Buffer.concat(glyphChunks),
  };
  for (const tag of ['cvt ', 'fpgm', 'prep']) if (font.tables[tag]) out[tag] = slice(tag);
  const tags = Object.keys(out).sort();
  const headerLen = 12 + tags.length * 16;
  const dir = Buffer.alloc(headerLen);
  dir.writeUInt32BE(0x00010000, 0);
  dir.writeUInt16BE(tags.length, 4);
  const pow = 2 ** Math.floor(Math.log2(tags.length));
  dir.writeUInt16BE(pow * 16, 6);
  dir.writeUInt16BE(Math.log2(pow), 8);
  dir.writeUInt16BE(tags.length * 16 - pow * 16, 10);
  let offset = headerLen;
  const bodies = [];
  tags.forEach((tag, i) => {
    const data = out[tag];
    const padded = pad4(data);
    const rec = 12 + i * 16;
    dir.write(tag, rec, 'latin1');
    dir.writeUInt32BE(checksum(padded), rec + 4);
    dir.writeUInt32BE(offset, rec + 8);
    dir.writeUInt32BE(data.length, rec + 12);
    bodies.push(padded);
    offset += padded.length;
  });
  const file = Buffer.concat([dir, ...bodies]);
  const headRec = 12 + tags.indexOf('head') * 16;
  const headOffset = dir.readUInt32BE(headRec + 8);
  file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, headOffset + 8);
  return file;
}
