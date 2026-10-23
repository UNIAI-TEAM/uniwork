import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtVi } from './data.mjs';
import { glyphWidth, readTtf, subsetTtf } from './ttf.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const FONT_DIR = path.join(repoRoot, 'packages/office-engine/assets/fonts');

const PAGE = { w: 595, h: 842 };

class PdfFont {
  constructor(resource, psName, file) {
    this.resource = resource;
    this.psName = psName;
    this.font = readTtf(fs.readFileSync(path.join(FONT_DIR, file)));
    this.used = new Map(); // gid -> unicode code point
  }
  gidOf(ch) {
    const gid = this.font.cmap.get(ch.codePointAt(0));
    if (!gid) throw new Error(`font ${this.psName} has no glyph for U+${ch.codePointAt(0).toString(16)}`);
    this.used.set(gid, ch.codePointAt(0));
    return gid;
  }
  width(text, size) {
    let total = 0;
    for (const ch of text) total += glyphWidth(this.font, this.gidOf(ch));
    return (total * size) / this.font.unitsPerEm;
  }
  hex(text) {
    return [...text].map((ch) => this.gidOf(ch).toString(16).padStart(4, '0')).join('');
  }
}

const num = (n) => String(Math.round(n * 100) / 100);
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

function toUnicodeCMap(font) {
  const entries = [...font.used].sort((a, b) => a[0] - b[0]);
  const chunks = [];
  for (let i = 0; i < entries.length; i += 100) {
    const slice = entries.slice(i, i + 100);
    chunks.push(`${slice.length} beginbfchar\n${slice.map(([gid, cp]) => `<${hex4(gid)}> <${hex4(cp)}>`).join('\n')}\nendbfchar`);
  }
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    `${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`
  );
}

function invoiceContent() {
  const items = [
    { name: 'Áo thun cổ tròn', qty: 10, price: 50000 },
    { name: 'Quần jeans nam', qty: 5, price: 120000 },
    { name: 'Mũ lưỡi trai', qty: 20, price: 20000 },
  ].map((it) => ({ ...it, amount: it.qty * it.price }));
  const subtotal = items.reduce((a, it) => a + it.amount, 0);
  const vat = Math.round(subtotal * 0.1);
  return {
    title: 'HÓA ĐƠN BÁN HÀNG',
    number: 'HD-2026-0001',
    date: '01/10/2026',
    seller: 'Công ty TNHH Mẫu An Bình',
    taxCode: '0000000000',
    buyer: 'Công ty Cổ phần Thử Nghiệm Hà Nội',
    header: ['STT', 'Tên hàng hóa', 'Số lượng', 'Đơn giá (đồng)', 'Thành tiền (đồng)'],
    items,
    subtotal,
    vatRate: 10,
    vat,
    total: subtotal + vat,
    inWords: 'Một triệu sáu trăm năm mươi nghìn đồng.',
  };
}

export function buildPdf() {
  const inv = invoiceContent();
  const regular = new PdfFont('F1', 'NotoSans-Regular', 'NotoSans-Regular.ttf');
  const bold = new PdfFont('F2', 'NotoSans-Bold', 'NotoSans-Bold.ttf');
  const ops = [];
  const textLines = [];
  const text = (font, size, x, y, value, align = 'left') => {
    const px = align === 'right' ? x - font.width(value, size) : x;
    ops.push(`BT /${font.resource} ${size} Tf 1 0 0 1 ${num(px)} ${num(y)} Tm <${font.hex(value)}> Tj ET`);
    textLines.push(value);
  };
  const rule = (y, x1 = 50, x2 = 545, w = 0.5) => ops.push(`${w} w ${x1} ${y} m ${x2} ${y} l S`);

  text(bold, 20, 50, 780, inv.title);
  text(regular, 11, 50, 750, `Số hóa đơn: ${inv.number}`);
  text(regular, 11, 545, 750, `Ngày lập: ${inv.date}`, 'right');
  text(regular, 11, 50, 722, `Đơn vị bán: ${inv.seller}`);
  text(regular, 11, 50, 704, `Mã số thuế: ${inv.taxCode}`);
  text(regular, 11, 50, 678, `Người mua: ${inv.buyer}`);
  text(regular, 11, 50, 660, 'Địa chỉ: 12 Phố Mẫu, Quận Ba Đình, Hà Nội');

  const cols = { stt: 55, name: 95, qty: 350, price: 450, amount: 545 };
  let y = 620;
  rule(y + 18, 50, 545, 0.8);
  text(bold, 10, cols.stt, y, inv.header[0]);
  text(bold, 10, cols.name, y, inv.header[1]);
  text(bold, 10, cols.qty, y, inv.header[2], 'right');
  text(bold, 10, cols.price, y, inv.header[3], 'right');
  text(bold, 10, cols.amount, y, inv.header[4], 'right');
  rule(y - 8, 50, 545, 0.8);
  inv.items.forEach((it, i) => {
    y -= 24;
    text(regular, 10, cols.stt, y, String(i + 1));
    text(regular, 10, cols.name, y, it.name);
    text(regular, 10, cols.qty, y, String(it.qty), 'right');
    text(regular, 10, cols.price, y, fmtVi(it.price), 'right');
    text(regular, 10, cols.amount, y, fmtVi(it.amount), 'right');
    rule(y - 8);
  });
  y -= 34;
  text(regular, 11, 450, y, 'Cộng tiền hàng:', 'right');
  text(regular, 11, 545, y, fmtVi(inv.subtotal), 'right');
  y -= 20;
  text(regular, 11, 450, y, `Thuế GTGT (${inv.vatRate}%):`, 'right');
  text(regular, 11, 545, y, fmtVi(inv.vat), 'right');
  y -= 22;
  text(bold, 12, 450, y, 'Tổng thanh toán:', 'right');
  text(bold, 12, 545, y, fmtVi(inv.total), 'right');
  y -= 34;
  text(regular, 11, 50, y, `Bằng chữ: ${inv.inWords}`);
  text(regular, 9, 50, 60, 'Dữ liệu tổng hợp để kiểm thử, không phải hóa đơn thật.');

  const content = Buffer.from(ops.join('\n') + '\n', 'latin1');
  const objects = []; // 1-based; each a Buffer body
  const add = (body) => objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')) && objects.length;
  const stream = (dict, data) =>
    Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);

  // Reserve 1..4: catalog, pages, page, contents; then fonts; resources reference them by number.
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(''); // page, filled after fonts
  add(stream('', content));
  const fontRefs = {};
  for (const f of [regular, bold]) {
    const file = subsetTtf(f.font, [...f.used.keys()]);
    const base = objects.length + 1;
    const [x0, y0, x1, y1] = [36, 38, 40, 42].map((o) => (f.font.buf.readInt16BE(f.font.tables.head.offset + o) * 1000) / f.font.unitsPerEm);
    const tag = `${f.resource === 'F1' ? 'AAAAAA' : 'BBBBBB'}+${f.psName}`;
    const widths = [...f.used.keys()].sort((a, b) => a - b).map((gid) => `${gid} [${Math.round((glyphWidth(f.font, gid) * 1000) / f.font.unitsPerEm)}]`);
    add(`<< /Type /Font /Subtype /Type0 /BaseFont /${tag} /Encoding /Identity-H /DescendantFonts [${base + 1} 0 R] /ToUnicode ${base + 4} 0 R >>`);
    add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${tag} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${base + 2} 0 R /CIDToGIDMap /Identity /DW 600 /W [${widths.join(' ')}] >>`);
    add(`<< /Type /FontDescriptor /FontName /${tag} /Flags 4 /FontBBox [${[x0, y0, x1, y1].map(Math.round).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round((f.font.ascent * 1000) / f.font.unitsPerEm)} /Descent ${Math.round((f.font.descent * 1000) / f.font.unitsPerEm)} /CapHeight 714 /StemV 80 /FontFile2 ${base + 3} 0 R >>`);
    add(stream(`/Length1 ${file.length}`, file));
    add(stream('', Buffer.from(toUnicodeCMap(f), 'latin1')));
    fontRefs[f.resource] = base;
  }
  objects[2] = Buffer.from(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Contents 4 0 R /Resources << /Font << /F1 ${fontRefs.F1} 0 R /F2 ${fontRefs.F2} 0 R >> >> >>`,
    'latin1',
  );
  const infoId = add('<< /Title (Invoice HD-2026-0001, synthetic) /Producer (UniWork fixture generator) /Creator (UniWork fixture generator) /CreationDate (D:20260101000000Z) /ModDate (D:20260101000000Z) >>');

  const chunks = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let pos = chunks[0].length;
  objects.forEach((body, i) => {
    offsets.push(pos);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    chunks.push(chunk);
    pos += chunk.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R /ID [<756e69776f726b2d66697874757265> <756e69776f726b2d66697874757265>] >>\nstartxref\n${pos}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));

  const oracle = {
    pageCount: 1,
    textLayer: true,
    fonts: ['NotoSans-Regular (subset, embedded)', 'NotoSans-Bold (subset, embedded)'],
    invoiceNumber: inv.number,
    invoiceDate: inv.date,
    lineItems: inv.items.map((it, i) => ({ stt: i + 1, ...it })),
    subtotal: inv.subtotal,
    vatRate: inv.vatRate,
    vat: inv.vat,
    total: inv.total,
    textLines,
  };
  return { bytes: Buffer.concat(chunks), oracle };
}
