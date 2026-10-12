// Minimal deterministic ZIP writer: STORE only (no compressor, so the bytes never depend on a zlib version),
// fixed DOS timestamp, fixed attributes, entry order exactly as given by the caller.

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {{name: string, data: Buffer|string}[]} entries */
export function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Entry order: [Content_Types].xml first (OOXML convention), the rest sorted by name. */
export function ooxmlEntries(parts) {
  const names = Object.keys(parts).sort((a, b) => {
    if (a === '[Content_Types].xml') return -1;
    if (b === '[Content_Types].xml') return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return names.map((name) => ({ name, data: parts[name] }));
}

export const xmlEscape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const CORE_CREATED = '2026-01-01T00:00:00Z';

export function coreProps(title) {
  return (
    XML_DECL +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlEscape(title)}</dc:title><dc:creator>UniWork synthetic fixtures</dc:creator>` +
    '<cp:lastModifiedBy>UniWork synthetic fixtures</cp:lastModifiedBy>' +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${CORE_CREATED}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${CORE_CREATED}</dcterms:modified></cp:coreProperties>`
  );
}

export function appProps(application) {
  return (
    XML_DECL +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    `<Application>${xmlEscape(application)}</Application></Properties>`
  );
}

const PKG_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const REL_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function relsXml(rels) {
  return (
    XML_DECL +
    `<Relationships xmlns="${PKG_RELS_NS}">` +
    rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('') +
    '</Relationships>'
  );
}

export const ROOT_RELS = (mainType, mainTarget) =>
  relsXml([
    ['rId1', `${REL_DOC}/${mainType}`, mainTarget],
    ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ['rId3', `${REL_DOC}/extended-properties`, 'docProps/app.xml'],
  ]);

export function contentTypes(overrides) {
  return (
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('') +
    '</Types>'
  );
}

export const CT_CORE = 'application/vnd.openxmlformats-package.core-properties+xml';
export const CT_APP = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';
