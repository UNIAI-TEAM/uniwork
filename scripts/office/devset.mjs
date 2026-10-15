#!/usr/bin/env node
// Synthetic dev set generator, validator and deterministic scorer for G6-08 (UNI-1373).
//
//   node scripts/office/devset.mjs           write fixtures, oracle sidecars and manifest.json
//   node scripts/office/devset.mjs --check   verify disk fixtures match deterministic generator

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CT_APP,
  CT_CORE,
  REL_DOC,
  ROOT_RELS,
  XML_DECL,
  appProps,
  contentTypes,
  coreProps,
  ooxmlEntries,
  relsXml,
  xmlEscape,
  zipStore,
} from './g5g6g7/fixtures-lib/zip.mjs';
import { TOOLS_DOC, parseMechanicalTable } from './instruction-pack-tools.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const DEVSET_DIR = 'docs/office/g5g6g7/devset';
export const DEVSET_FIXTURES_DIR = `${DEVSET_DIR}/fixtures`;
export const DEVSET_MANIFEST_PATH = `${DEVSET_FIXTURES_DIR}/manifest.json`;
export const DEVSET_CASES_PATH = `${DEVSET_DIR}/cases.json`;
export const DEVSET_README_PATH = `${DEVSET_DIR}/README.md`;

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const ST = { general: 0, header: 1, int: 2, pct0: 3, pct1: 4, totalInt: 5, bold: 6 };
const colLetter = (index) => String.fromCharCode(65 + index);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

class SharedStrings {
  constructor() {
    this.list = [];
    this.index = new Map();
    this.count = 0;
  }
  add(text) {
    this.count += 1;
    if (!this.index.has(text)) {
      this.index.set(text, this.list.length);
      this.list.push(text);
    }
    return this.index.get(text);
  }
  xml() {
    return (
      XML_DECL +
      `<sst xmlns="${NS_MAIN}" count="${this.count}" uniqueCount="${this.list.length}">` +
      this.list.map((t) => `<si><t xml:space="preserve">${xmlEscape(t)}</t></si>`).join('') +
      '</sst>'
    );
  }
}

function stylesXml() {
  return (
    XML_DECL +
    `<styleSheet xmlns="${NS_MAIN}">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  );
}

function cellXml(ref, cell, sst) {
  const s = cell.s ? ` s="${cell.s}"` : '';
  if (cell.blank) return `<c r="${ref}"${s}/>`;
  if (cell.f !== undefined) {
    const f = `<f>${xmlEscape(cell.f)}</f>`;
    if (cell.err) return `<c r="${ref}"${s} t="e">${f}<v>${cell.err}</v></c>`;
    if (cell.str !== undefined) return `<c r="${ref}"${s} t="str">${f}<v>${xmlEscape(cell.str)}</v></c>`;
    return `<c r="${ref}"${s}>${f}<v>${cell.n}</v></c>`;
  }
  if (cell.str !== undefined) return `<c r="${ref}"${s} t="s"><v>${sst.add(cell.str)}</v></c>`;
  return `<c r="${ref}"${s}><v>${cell.n}</v></c>`;
}

function sheetXml(rows, widths, sst, autoFilterRef) {
  const lastRow = rows.length;
  const lastCol = Math.max(...rows.map((r) => r.cells.length));
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const body = rows
    .map((row, ri) => {
      const r = ri + 1;
      const cells = row.cells.map((cell, ci) => (cell ? cellXml(`${colLetter(ci)}${r}`, cell, sst) : '')).join('');
      return `<row r="${r}"${row.hidden ? ' hidden="1"' : ''}>${cells}</row>`;
    })
    .join('');
  const af = autoFilterRef ? `<autoFilter ref="${autoFilterRef}"/>` : '';
  return (
    XML_DECL +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${REL_DOC}">` +
    `<dimension ref="A1:${colLetter(lastCol - 1)}${lastRow}"/>` +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols><sheetData>${body}</sheetData>${af}</worksheet>`
  );
}

const h = (text) => ({ str: text, s: ST.header });

const DEV_ORDERS = [
  { id: 'BH-101', branch: 'Miền Bắc', item: 'Sổ tay A5', x: 10, y: 1200, z: 0.05, zKind: 'pct', net: 11400, unitAfter: 1140, status: 'Hợp lệ' },
  { id: 'BH-102', branch: 'Miền Trung', item: 'Bút bi xanh', x: 20, y: 800, z: 10, zKind: 'plain', net: 14400, unitAfter: 720, status: 'Hợp lệ' },
  { id: 'BH-103', branch: 'Miền Nam', item: 'Kẹp tài liệu', x: 15, y: 1000, z: 0.1, zKind: 'pct', net: 13500, unitAfter: 900, status: 'Hợp lệ' },
  { id: 'BH-104', branch: 'Miền Bắc', item: 'Thước kẻ', x: 8, y: 1500, z: null, zKind: 'blank', net: 12000, unitAfter: 1500, status: 'Hợp lệ' },
  { id: 'BH-105', branch: 'Miền Trung', item: 'Bìa hồ sơ', x: 12, y: 900, z: 0.1, zKind: 'pct', net: 9720, unitAfter: 810, status: 'Ẩn kiểm kê', hidden: true },
  { id: 'BH-106', branch: 'Miền Nam', item: 'Nhãn dán', x: 0, y: 1100, z: null, zKind: 'blank', net: 0, unitAfter: '#DIV/0!', status: '#N/A' },
];

function buildDevXlsx() {
  const sst = new SharedStrings();
  const s1Rows = [
    {
      cells: [
        h('Mã phiếu'),
        h('Chi nhánh'),
        h('Mặt hàng'),
        h('Số lượng (X)'),
        h('Đơn giá (Y)'),
        h('Chiết khấu (Z)'),
        h('Doanh thu ròng'),
        h('Đơn giá sau CK'),
        h('Tra cứu mã'),
      ],
    },
  ];
  DEV_ORDERS.forEach((o, idx) => {
    const r = idx + 2;
    const zCell =
      o.zKind === 'blank'
        ? { blank: true }
        : o.zKind === 'plain'
          ? { n: o.z }
          : { n: o.z, s: ST.pct0 };
    const unitCell =
      o.x === 0
        ? { f: `G${r}/D${r}`, err: '#DIV/0!' }
        : { f: `G${r}/D${r}`, n: o.unitAfter, s: ST.int };
    const lookupCell =
      o.status === '#N/A'
        ? { f: `VLOOKUP(A${r},'Kiểm toán'!$A$2:$B$6,2,FALSE)`, err: '#N/A' }
        : { str: o.status };
    s1Rows.push({
      hidden: Boolean(o.hidden),
      cells: [
        { str: o.id },
        { str: o.branch },
        { str: o.item },
        { n: o.x, s: ST.int },
        { n: o.y, s: ST.int },
        zCell,
        { f: `D${r}*E${r}*(1-IF(F${r}>1,F${r}/100,F${r}))`, n: o.net, s: ST.int },
        unitCell,
        lookupCell,
      ],
    });
  });
  // Row 8: Totals row (all rows 2..7 including hidden row 6)
  s1Rows.push({
    cells: [
      { str: 'Tổng cộng', s: ST.bold },
      null,
      null,
      { f: 'SUM(D2:D7)', n: 65, s: ST.totalInt },
      null,
      null,
      { f: 'SUM(G2:G7)', n: 61020, s: ST.totalInt },
      null,
      null,
    ],
  });
  // Row 9: Totals row (visible rows only, excluding hidden row 6)
  s1Rows.push({
    cells: [
      { str: 'Tổng dòng hiển thị', s: ST.bold },
      null,
      null,
      { f: 'SUBTOTAL(109,D2:D7)', n: 53, s: ST.totalInt },
      null,
      null,
      { f: 'SUBTOTAL(109,G2:G7)', n: 51300, s: ST.totalInt },
      null,
      null,
    ],
  });

  // Sheet 2: Kiểm toán (stale cache, unsupported formula, locale text, rounding rule)
  const s2Rows = [
    {
      cells: [
        h('Khoản mục'),
        h('Giá trị gốc'),
        h('Hệ số'),
        h('Kết quả công thức'),
        h('Quy tắc và ghi chú'),
      ],
    },
    {
      // Row 2: Stale cached formula value (cached 99999 in XML, formula LEGACYCACHE cannot be recalculated by engine)
      cells: [
        { str: 'Doanh thu dự phòng' },
        { n: 2500, s: ST.int },
        { n: 4, s: ST.int },
        { f: 'LEGACYCACHE(B2,C2)', n: 99999, s: ST.int },
        { str: 'Giá trị cache lưu trong tệp (99999) đã cũ (NOT RECALCULATED); công thức đúng là B2*C2 = 10000' },
      ],
    },
    {
      // Row 3: Stale cached value 88888 on standard formula =B3*C3 (engine recalculates to 10000)
      cells: [
        { str: 'Chi phí vận hành chuẩn' },
        { n: 2500, s: ST.int },
        { n: 4, s: ST.int },
        { f: 'B3*C3', n: 88888, s: ST.int },
        { str: 'Cache cũ trong tệp là 88888 nhưng tích thực tế B3*C3 = 10000' },
      ],
    },
    {
      // Row 4: Unsupported Excel function FILTERXML -> #NAME?
      cells: [
        { str: 'Tỷ giá XML ngoại vi' },
        { str: '<root><tygia>25</tygia></root>' },
        { n: 1, s: ST.int },
        { f: 'FILTERXML(B4,"//tygia")', err: '#NAME?' },
        { str: 'Hàm FILTERXML không được hỗ trợ trong bộ tính công thức hiện tại' },
      ],
    },
    {
      // Row 5: Locale text "1.250,5" in B5 + fractional number 3200.756 in D5
      cells: [
        { str: 'Phí vận chuyển (văn bản locale)' },
        { str: '1.250,5' },
        { n: 1, s: ST.int },
        { n: 3200.756 },
        { str: 'Làm tròn kết quả cột D đến hàng đơn vị (0 chữ số thập phân)' },
      ],
    },
    {
      // Row 6: Numeric 800 in B6 + fractional number 1450.244 in D6
      cells: [
        { str: 'Phí bảo hiểm kho' },
        { n: 800, s: ST.int },
        { n: 1, s: ST.int },
        { n: 1450.244 },
        { str: 'Làm tròn kết quả cột D đến hàng đơn vị (0 chữ số thập phân)' },
      ],
    },
  ];

  const sheets = [
    ['Bán hàng T1', { rows: s1Rows, widths: [12, 14, 16, 14, 14, 14, 16, 16, 14], autoFilter: 'A1:I7' }],
    ['Kiểm toán', { rows: s2Rows, widths: [24, 24, 10, 18, 48], autoFilter: null }],
  ];

  const parts = {};
  sheets.forEach(([, sheet], i) => {
    parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheet.rows, sheet.widths, sst, sheet.autoFilter);
  });
  parts['xl/sharedStrings.xml'] = sst.xml();
  parts['xl/styles.xml'] = stylesXml();
  parts['xl/workbook.xml'] =
    XML_DECL +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${REL_DOC}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
    sheets.map(([name], i) => `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';
  parts['xl/_rels/workbook.xml.rels'] = relsXml([
    ...sheets.map((_, i) => [`rId${i + 1}`, `${REL_DOC}/worksheet`, `worksheets/sheet${i + 1}.xml`]),
    [`rId${sheets.length + 1}`, `${REL_DOC}/styles`, 'styles.xml'],
    [`rId${sheets.length + 2}`, `${REL_DOC}/sharedStrings`, 'sharedStrings.xml'],
  ]);
  parts['_rels/.rels'] = ROOT_RELS('officeDocument', 'xl/workbook.xml');
  parts['docProps/core.xml'] = coreProps('Bán hàng X/Y/Z — Dev set G6-08');
  parts['docProps/app.xml'] = appProps('UniWork G6-08 devset generator');
  const ws = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  parts['[Content_Types].xml'] = contentTypes([
    ['/xl/workbook.xml', `${ws}.sheet.main+xml`],
    ...sheets.map((_, i) => [`/xl/worksheets/sheet${i + 1}.xml`, `${ws}.worksheet+xml`]),
    ['/xl/styles.xml', `${ws}.styles+xml`],
    ['/xl/sharedStrings.xml', `${ws}.sharedStrings+xml`],
    ['/docProps/core.xml', CT_CORE],
    ['/docProps/app.xml', CT_APP],
  ]);

  const oracle = {
    sheetNames: ['Bán hàng T1', 'Kiểm toán'],
    sheets: {
      'Bán hàng T1': {
        dataRange: 'A2:I7',
        headerRow: 1,
        hiddenRows: [6],
        totalsRows: [8, 9],
        autoFilter: 'A1:I7',
        columns: { X: 'D', Y: 'E', Z: 'F', netRevenue: 'G', unitAfterDiscount: 'H', codeLookup: 'I' },
        zStorage: [
          { cell: 'F2', orderId: 'BH-101', stored: 0.05, kind: 'percent (5%)', discountFraction: 0.05 },
          { cell: 'F3', orderId: 'BH-102', stored: 10, kind: 'plain number 10 (10%)', discountFraction: 0.1 },
          { cell: 'F4', orderId: 'BH-103', stored: 0.1, kind: 'percent (10%)', discountFraction: 0.1 },
          { cell: 'F5', orderId: 'BH-104', stored: null, kind: 'blank (0%)', discountFraction: 0 },
          { cell: 'F6', orderId: 'BH-105', stored: 0.1, kind: 'percent (10%, hidden row)', discountFraction: 0.1 },
          { cell: 'F7', orderId: 'BH-106', stored: null, kind: 'blank (0%)', discountFraction: 0 },
        ],
        totals: {
          withHiddenRow6: { sumX: 65, netRevenue: 61020 },
          withoutHiddenRow6: { sumX: 53, netRevenue: 51300 },
          byBranchWithHidden: { 'Miền Bắc': 23400, 'Miền Trung': 24120, 'Miền Nam': 13500 },
          byBranchVisibleOnly: { 'Miền Bắc': 23400, 'Miền Trung': 14400, 'Miền Nam': 13500 },
          unitAfterDiscountValidCount: 5,
          unitAfterDiscountValidSum: 5070,
          unitAfterDiscountValidAvg: 1014,
        },
        errorCells: [
          { cell: 'H7', formula: 'G7/D7', error: '#DIV/0!' },
          { cell: 'I7', formula: "VLOOKUP(A7,'Kiểm toán'!$A$2:$B$6,2,FALSE)", error: '#N/A' },
        ],
      },
      'Kiểm toán': {
        staleCacheCells: [
          { cell: 'D2', formula: 'LEGACYCACHE(B2,C2)', staleCachedValue: 99999, trueProduct: 10000 },
          { cell: 'D3', formula: 'B3*C3', staleCachedValue: 88888, trueProduct: 10000 },
        ],
        unsupportedFormulaCells: [
          { cell: 'D4', formula: 'FILTERXML(B4,"//tygia")', unsupportedFunction: 'FILTERXML', error: '#NAME?' },
        ],
        localeAndRounding: {
          textNumberCell: { cell: 'B5', text: '1.250,5', type: 'text' },
          numericCell: { cell: 'B6', value: 800, type: 'number' },
          sumB5B6NumericOnly: 800,
          skippedTextCount: 1,
          roundingRuleCell: 'E5',
          d5Raw: 3200.756,
          d5RoundedInt: 3201,
          d6Raw: 1450.244,
          d6RoundedInt: 1450,
          sumD5D6: 4651,
        },
      },
    },
  };
  return { bytes: zipStore(ooxmlEntries(parts)), oracle };
}

const DOCX_BLOCKS = [
  { index: 0, style: 'Title', text: 'Đề xuất triển khai hệ thống kho vận 2026' },
  { index: 1, style: 'Heading1', text: '1. Mục tiêu dự án' },
  {
    index: 2,
    style: 'Normal',
    text: 'Dự án hướng tới giảm thời gian xử lý đơn hàng tại ba kho miền Bắc, miền Trung và miền Nam xuống dưới 4 giờ cho mỗi đơn.',
  },
  { index: 3, style: 'Heading1', text: '2. Phạm vi áp dụng' },
  {
    index: 4,
    style: 'Normal',
    text: 'Giai đoạn đầu áp dụng thử nghiệm cho 150 nhân viên vận hành tại kho Đà Nẵng trong vòng 6 tuần trước khi mở rộng toàn quốc.',
  },
  { index: 5, style: 'Heading1', text: '3. Kế hoạch bàn giao' },
  {
    index: 6,
    style: 'Normal',
    text: 'Đội dự án bàn giao tài liệu hướng dẫn vận hành trước ngày 20 tháng 11 và tổ chức hai buổi tập huấn trực tuyến.',
  },
];

function buildDevDocx() {
  const run = (text, bold) =>
    `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
  const para = (text, style) =>
    `<w:p><w:pPr>${style && style !== 'Normal' ? `<w:pStyle w:val="${style}"/>` : ''}</w:pPr>${run(text)}</w:p>`;
  const body = DOCX_BLOCKS.map((b) => para(b.text, b.style)).join('');
  const headingStyle = (id, name, size, before) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles =
    XML_DECL +
    `<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>` +
    '<w:sz w:val="22"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>' +
    headingStyle('Heading1', 'heading 1', 30, 240) +
    '</w:styles>';

  const parts = {
    'word/document.xml':
      XML_DECL +
      `<w:document xmlns:w="${NS_W}"><w:body>${body}` +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>',
    'word/styles.xml': styles,
    'word/_rels/document.xml.rels': relsXml([['rId1', `${REL_DOC}/styles`, 'styles.xml']]),
    '_rels/.rels': ROOT_RELS('officeDocument', 'word/document.xml'),
    'docProps/core.xml': coreProps(DOCX_BLOCKS[0].text),
    'docProps/app.xml': appProps('UniWork G6-08 devset generator'),
  };
  const wp = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  parts['[Content_Types].xml'] = contentTypes([
    ['/word/document.xml', `${wp}.document.main+xml`],
    ['/word/styles.xml', `${wp}.styles+xml`],
    ['/docProps/core.xml', CT_CORE],
    ['/docProps/app.xml', CT_APP],
  ]);

  const oracle = {
    title: DOCX_BLOCKS[0].text,
    paragraphCount: DOCX_BLOCKS.length,
    blocks: DOCX_BLOCKS,
  };
  return { bytes: zipStore(ooxmlEntries(parts)), oracle };
}

const DEV_SPECS = [
  {
    id: 'dev-xlsx-orders-xyz',
    file: 'dev-xlsx-orders-xyz.xlsx',
    format: 'xlsx',
    build: buildDevXlsx,
    description:
      'Synthetic devset order workbook (X = quantity, Y = unit price, Z = discount as 10, 0.1 and blank, hidden row, two totals rows, #DIV/0! and #N/A errors, stale cached formula value, unsupported FILTERXML, locale text and rounding).',
  },
  {
    id: 'dev-docx-proposal-vi',
    file: 'dev-docx-proposal-vi.docx',
    format: 'docx',
    build: buildDevDocx,
    description:
      'Synthetic devset Vietnamese warehouse proposal (title, 3 headings, 3 body paragraphs) for selected-paragraph edit verification.',
  },
];

const ATTRIBUTES_PATH = `${DEVSET_DIR}/.gitattributes`;
const ATTRIBUTES_TEXT = '# Generated by devset.mjs. Binary fixtures stay untouched across checkouts.\n* -text\n';

export function buildDevFixtures() {
  const fixtures = DEV_SPECS.map((spec) => {
    const { bytes, oracle } = spec.build();
    const digest = sha256(bytes);
    const filePath = `${DEVSET_FIXTURES_DIR}/${spec.file}`;
    const oraclePath = `${DEVSET_FIXTURES_DIR}/${spec.id}.oracle.json`;
    const oracleText = jsonText({
      fixtureId: spec.id,
      format: spec.format,
      fixtureSha256: digest,
      synthetic: true,
      ...oracle,
    });
    return {
      spec,
      bytes,
      sha256: digest,
      path: filePath,
      oraclePath,
      oracleSha256: sha256(Buffer.from(oracleText, 'utf8')),
      oracleText,
    };
  });
  const manifest = {
    schemaVersion: 1,
    kind: 'uniwork-office-g6-08-devset-fixtures',
    fixtures: fixtures.map((f) => ({
      id: f.spec.id,
      path: f.path,
      format: f.spec.format,
      sha256: f.sha256,
      bytes: f.bytes.length,
      synthetic: true,
      description: f.spec.description,
      oracle: f.oraclePath,
      oracleSha256: f.oracleSha256,
    })),
  };
  return { fixtures, manifestText: jsonText(manifest), attributesPath: ATTRIBUTES_PATH, attributesText: ATTRIBUTES_TEXT };
}

/** Normalises a prompt for holdout-collision comparison (NFD + lowercase + collapse non-alphanumeric). */
export function normalizePrompt(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;
const HOST_PORT_URL_RE = /\bhttps?:\/\/[^\s"'<>]+:\d+\b/i;
const KEY_PREFIX_RE = /\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/;

/** Scans arbitrary text for secret-looking tokens (IPv4, http(s)://host:port, API key prefixes). */
export function scanForSecrets(text, label = 'input') {
  const s = String(text ?? '');
  const findings = [];
  const ipMatch = IPV4_RE.exec(s);
  if (ipMatch) findings.push(`${label}: contains IPv4 literal "${ipMatch[0]}"`);
  const urlMatch = HOST_PORT_URL_RE.exec(s);
  if (urlMatch) findings.push(`${label}: contains host:port URL "${urlMatch[0]}"`);
  const keyMatch = KEY_PREFIX_RE.exec(s);
  if (keyMatch) findings.push(`${label}: contains key-like token "${keyMatch[0].slice(0, 10)}..."`);
  return findings;
}

const FORMAT_TO_SECTION = {
  xlsx: 'sheets',
  docx: 'docs',
};

const REQUIRED_CATEGORIES = [
  'whole_range',
  'sheet_range_types_filters',
  'ambiguity',
  'unsupported_formula',
  'stale_cache',
  'error_cell',
  'locale_rounding',
  'docx_selected_paragraph_edit',
];

export function validateDevCase(caseDoc, byModule, fixtureMap) {
  const problems = [];
  const id = caseDoc?.id || '<missing-id>';
  if (!/^DV-(?:XLSX|DOCX)-\d{3}$/.test(String(caseDoc?.id ?? ''))) {
    problems.push(`${id}: id must match DV-(XLSX|DOCX)-NNN`);
  }
  if (!['vi', 'en'].includes(caseDoc?.lang)) {
    problems.push(`${id}: lang must be "vi" or "en"`);
  }
  if (!['xlsx', 'docx'].includes(caseDoc?.format)) {
    problems.push(`${id}: format must be "xlsx" or "docx"`);
  }
  if (typeof caseDoc?.category !== 'string' || !caseDoc.category.trim()) {
    problems.push(`${id}: category must be a non-empty string`);
  }
  if (typeof caseDoc?.prompt !== 'string' || caseDoc.prompt.trim().length < 10) {
    problems.push(`${id}: prompt must be a string of at least 10 chars`);
  }
  const fx = fixtureMap.get(caseDoc?.fixtureId);
  if (!fx) {
    problems.push(`${id}: unknown fixtureId "${caseDoc?.fixtureId}"`);
  } else if (fx.format !== caseDoc?.format) {
    problems.push(`${id}: fixtureId "${caseDoc?.fixtureId}" format ${fx.format} != case format ${caseDoc?.format}`);
  }
  if (!caseDoc?.selection || typeof caseDoc.selection !== 'object') {
    problems.push(`${id}: selection must be an object`);
  }
  if (!caseDoc?.context || typeof caseDoc.context !== 'object') {
    problems.push(`${id}: context must be an object`);
  }
  const section = FORMAT_TO_SECTION[caseDoc?.format];
  const moduleTools = section ? byModule.get(section) : null;
  if (!Array.isArray(caseDoc?.allowedTools) || caseDoc.allowedTools.length === 0) {
    problems.push(`${id}: allowedTools must be a non-empty array`);
  } else if (moduleTools) {
    for (const tool of caseDoc.allowedTools) {
      if (!moduleTools.has(tool)) {
        problems.push(`${id}: allowedTools entry "${tool}" is not in ${TOOLS_DOC} §3 for module "${section}"`);
      }
    }
  }
  if (!Array.isArray(caseDoc?.requiredTools)) {
    problems.push(`${id}: requiredTools must be an array`);
  } else {
    for (const tool of caseDoc.requiredTools) {
      if (!caseDoc.allowedTools?.includes(tool)) {
        problems.push(`${id}: requiredTools entry "${tool}" must also be in allowedTools`);
      }
    }
  }
  const oracle = caseDoc?.oracle;
  if (!oracle || typeof oracle !== 'object') {
    problems.push(`${id}: oracle must be an object`);
  } else {
    if (oracle.type !== 'deterministic') {
      problems.push(`${id}: oracle.type must be "deterministic"`);
    }
    if (typeof oracle.source !== 'string' || !oracle.source.includes('docs/office/g5g6g7/devset/fixtures/')) {
      problems.push(`${id}: oracle.source must cite a devset fixture oracle sidecar`);
    }
    if (!['answer', 'clarification', 'edited', 'not_supported'].includes(oracle.expectedKind)) {
      problems.push(`${id}: oracle.expectedKind must be answer | clarification | edited | not_supported`);
    }
    if (!Number.isInteger(oracle.writes) || oracle.writes < 0) {
      problems.push(`${id}: oracle.writes must be a non-negative integer`);
    }
    if (caseDoc.format === 'docx' && oracle.expectedKind === 'edited') {
      const pe = oracle.paragraphEdit;
      if (
        !pe ||
        typeof pe.targetBlockIndex !== 'number' ||
        !Array.isArray(pe.mustContainAfter) ||
        pe.mustContainAfter.length === 0 ||
        !Array.isArray(pe.unchangedBlocks) ||
        pe.unchangedBlocks.length === 0
      ) {
        problems.push(`${id}: DOCX edit oracle must define paragraphEdit.{targetBlockIndex,mustContainAfter,unchangedBlocks}`);
      }
    }
  }
  return problems;
}

function textHasNumber(text, target, tolerance = 0) {
  const s = String(text ?? '');
  const intVal = Math.round(target);
  if (tolerance === 0 && Number.isInteger(target)) {
    const en = intVal.toLocaleString('en-US');
    const vi = en.replace(/,/g, '.');
    const space = en.replace(/,/g, ' ');
    for (const form of [String(intVal), en, vi, space]) {
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![\\d.,])${escaped}(?![\\d])`).test(s)) return true;
    }
    return false;
  }
  for (const m of s.matchAll(/-?\d[\d.,]*/g)) {
    const raw = m[0].replace(/[.,]$/, '');
    const candidates = [
      Number(raw.replace(/,/g, '')),
      Number(raw.replace(/\./g, '').replace(',', '.')),
      Number(raw),
    ].filter(Number.isFinite);
    if (candidates.some((n) => Math.abs(n - target) <= tolerance)) return true;
  }
  return false;
}

const SCOPE_MARKER_RE =
  /(?:^|\n|(?<=[.!?])\s+)(?:[*#_>-]+\s*)*(?:phạm\s+vi(?:\s+dữ\s+liệu)?|scope|ghi\s+chú|notes?)(?![\p{L}\p{N}])\s*[*_]*\s*:/iu;

const NEGATED_OR_DISQUALIFIED_RE =
  /(?:không\s+(?:được\s+)?(?:dùng|sử\s+dụng|thay(?:\s+thế|\s+ô\s+lỗi)?|coi|tính\s+lại|hỗ\s+trợ|phải(?:\s+là)?\s+kết\s+quả)|chưa\s+(?:được\s+)?tính\s+lại|chỉ\s+là\s+(?:giá\s+trị\s+)?cache|(?:cache(?:\s+cũ)?|giá\s+trị\s+cache(?:\s+cũ)?)\s+[^\n.;]*?(?:đã\s+lỗi\s+thời|lỗi\s+thời)|nhưng\s+(?:hàm\s+\S+\s+không\s+được|sau\s+khi\s+tính\s+lại)|trả\s+về\s+#name\?|bỏ\s+qua|loại\s+trừ|must\s+not\s+be\s+used|(?:do|should)\s+not\s+use|not\s+(?:a\s+)?verified|are\s+not\s+verified|is\s+not\s+verified|not\s+recalculated|is\s+stale|are\s+stale|stale\s+cached|is\s+unsupported|returns\s+#name\?|not\s+replaced\s+by\s+0|never\s+replace)/iu;

const CACHE_SUBJECT_RE =
  /^(?:[-*•]\s*)?(?:[^:]{1,40}:\s*)?(?:(?:the|its)\s+)?(?:(?:giá\s+trị\s+)?cache(?:\s+cũ)?(?:\s+trong\s+tệp)?|(?:stale\s+)?cached\s+values?)(?:\s+(?:của|ở|tại|in|of|for)\s+[a-z]+\d+(?:\s+(?:và|and)\s+\S+\s+(?:của|ở|tại|in|of|for)\s+[a-z]+\d+)?)?\s+(?:là|is|are|=)(?![\p{L}\p{N}])/iu;

const POSITIVE_RESULT_CLAIM_RE =
  /(?:(?<![\p{L}\p{N}])(?:kết\s+quả|đáp\s+án|đáp\s+số|giá\s+trị|trung\s+bình(?:\s+cộng)?|tích(?:\s+thực\s+tế)?|tổng|result|answer|the\s+answer|average|product|value)(?![\p{L}\p{N}])[^\n:;]*?(?::|là|is|=)|(?<![\p{L}\p{N}])(?:[a-z]+\d+)\s*(?:=|:|\s+là|\s+is|\s+holds|\s+has|\s+equals|\s+bằng)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:giving|cho\s+kết\s+quả|được\s+thay\s+bằng|set\s+to|coi\s+[^\n)]*?\s+là\s+0)(?![\p{L}\p{N}])|(?:^|[=:])\s*(?:99[.,]?999|88[.,]?888|845|0)(?![\p{L}\p{N}]))/iu;

/**
 * Extracts the result region of an assistant reply for negative-oracle checks
 * (G6-A02 / BE68-6 / BE68-G2-1). Consistent with the instruction pack ("Result
 * first, then its scope" in common rule 5 and sheets "Answer shape"), the result
 * region is selected positively as the text before the first scope/note marker
 * ("Phạm vi:", "Scope:", "Ghi chú:", "Note:"), or the whole text when no scope
 * marker is present, using Unicode-aware (`u`) boundaries.
 */
export function extractConclusionPart(answer) {
  const text = String(answer ?? '').trim();
  if (!text) return '';
  const match = SCOPE_MARKER_RE.exec(text);
  const region = match ? text.slice(0, match.index) : text;
  return region.trim();
}

/**
 * Claim-based check for whether a forbidden token (stale cached value or 0
 * substituted for an error cell) is asserted as a result or cell value inside
 * the result region, rather than rejected/disqualified as stale cache or named
 * with the cache itself as the subject (AC G6-A02 / BE68-G2-1).
 */
export function isForbiddenTokenClaimed(conclusionText, badToken) {
  const text = String(conclusionText ?? '').trim();
  const needle = String(badToken ?? '').trim().toLowerCase();
  if (!text || !needle) return false;
  const clauses = text
    .split(/(?:[\r\n;]+|(?<!\d)[.!?]+(?!\d)\s+)/u)
    .map((c) => c.replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const clause of clauses) {
    if (!clause.toLowerCase().includes(needle)) continue;
    if (NEGATED_OR_DISQUALIFIED_RE.test(clause)) continue;
    if (CACHE_SUBJECT_RE.test(clause)) continue;
    if (POSITIVE_RESULT_CLAIM_RE.test(clause)) return true;
  }
  return false;
}

/**
 * Deterministic scorer for a dev set case against a recorded run result:
 * { answerText, toolCalls: [{name, input, output}], mutatedBlocks?: [{index, text}], writes?: number }
 */
export function scoreDevCase(caseDoc, runResult) {
  const checks = [];
  const section = FORMAT_TO_SECTION[caseDoc.format];
  const answer = String(runResult?.answerText ?? '');
  const toolCalls = Array.isArray(runResult?.toolCalls) ? runResult.toolCalls : null;

  if (!toolCalls) {
    return {
      passed: false,
      score: 0,
      checks: [{ id: 'tools_reported', passed: false, detail: 'runResult.toolCalls is missing' }],
    };
  }

  const usedNames = toolCalls.map((c) => c.name);
  const outsideAllowlist = usedNames.filter((name) => !caseDoc.allowedTools.includes(name));
  checks.push({
    id: 'allowlist',
    passed: outsideAllowlist.length === 0,
    detail:
      outsideAllowlist.length === 0
        ? `all ${usedNames.length} tool call(s) within ${section} allowlist`
        : `outside allowlist: ${outsideAllowlist.join(', ')}`,
  });

  if (caseDoc.requiredTools.length > 0) {
    // For edit cases where any of replace_selection/replace_blocks/apply_ops is acceptable,
    // oracle.requireAnyTool = true means at least one of requiredTools must be called;
    // otherwise every entry in requiredTools must be called.
    const requireAny = Boolean(caseDoc.oracle.requireAnyTool);
    const reqPassed = requireAny
      ? caseDoc.requiredTools.some((t) => usedNames.includes(t))
      : caseDoc.requiredTools.every((t) => usedNames.includes(t));
    checks.push({
      id: 'required_tools',
      passed: reqPassed,
      detail: reqPassed
        ? `required tool(s) called: ${usedNames.join(', ')}`
        : `missing required tool(s) (${requireAny ? 'any of' : 'all of'} [${caseDoc.requiredTools.join(', ')}]); called [${usedNames.join(', ')}]`,
    });
  }

  const writes = Number(runResult?.writes ?? 0);
  checks.push({
    id: 'writes',
    passed: writes === caseDoc.oracle.writes,
    detail: `writes=${writes}, expected=${caseDoc.oracle.writes}`,
  });

  const combinedText = [
    answer,
    ...toolCalls
      .filter((c) => c.name === 'ask_clarification')
      .map((c) => JSON.stringify(c.input ?? {})),
  ].join('\n');

  for (const numSpec of caseDoc.oracle.mustContainNumbers ?? []) {
    const ok = textHasNumber(combinedText, numSpec.value, numSpec.tolerance ?? 0);
    checks.push({
      id: `num:${numSpec.label}`,
      passed: ok,
      detail: ok ? `found ${numSpec.value}` : `missing expected number ${numSpec.value} (${numSpec.label})`,
    });
  }

  for (const token of caseDoc.oracle.mustContainTokens ?? []) {
    const ok = combinedText.toLowerCase().includes(String(token).toLowerCase());
    checks.push({
      id: `token:${token}`,
      passed: ok,
      detail: ok ? `found "${token}"` : `missing token "${token}"`,
    });
  }

  for (const group of caseDoc.oracle.mustContainAny ?? []) {
    const ok = group.some((candidate) => combinedText.toLowerCase().includes(String(candidate).toLowerCase()));
    checks.push({
      id: `any:${group[0]}`,
      passed: ok,
      detail: ok ? `matched one of [${group.join(' | ')}]` : `none of [${group.join(' | ')}] found`,
    });
  }

  const conclusionText = extractConclusionPart(answer);
  for (const badToken of caseDoc.oracle.mustNotContainTokens ?? []) {
    const present = isForbiddenTokenClaimed(conclusionText, badToken);
    checks.push({
      id: `forbid_token:${badToken}`,
      passed: !present,
      detail: !present
        ? `conclusion did not claim "${badToken}" as the result`
        : `forbidden token "${badToken}" claimed as result in conclusion ("${conclusionText.slice(0, 120)}")`,
    });
  }

  if (caseDoc.oracle.paragraphEdit) {
    const pe = caseDoc.oracle.paragraphEdit;
    const blocks = Array.isArray(runResult?.mutatedBlocks) ? runResult.mutatedBlocks : [];
    const targetBlock = blocks.find((b) => b.index === pe.targetBlockIndex);
    const targetText = String(targetBlock?.text ?? '');
    const editedOk =
      Boolean(targetBlock) &&
      pe.mustContainAfter.every((sub) => targetText.toLowerCase().includes(sub.toLowerCase())) &&
      (pe.mustNotContainAfter ?? []).every((sub) => !targetText.toLowerCase().includes(sub.toLowerCase()));
    checks.push({
      id: `docx_target_block:${pe.targetBlockIndex}`,
      passed: editedOk,
      detail: editedOk
        ? `block ${pe.targetBlockIndex} updated as required`
        : `block ${pe.targetBlockIndex} text "${targetText}" did not match oracle`,
    });
    const unchangedOk = pe.unchangedBlocks.every((u) => {
      const found = blocks.find((b) => b.index === u.index);
      return found && found.text === u.text;
    });
    checks.push({
      id: 'docx_other_paragraphs_unchanged',
      passed: unchangedOk,
      detail: unchangedOk ? 'all non-target paragraphs unchanged' : 'a non-target paragraph was modified or missing',
    });
  }

  const passed = checks.every((c) => c.passed);
  const passedCount = checks.filter((c) => c.passed).length;
  return {
    passed,
    score: checks.length > 0 ? Number((passedCount / checks.length).toFixed(4)) : 0,
    checks,
  };
}

export function loadDevSet(rootDir = repoRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, DEVSET_MANIFEST_PATH), 'utf8'));
  const casesDoc = JSON.parse(fs.readFileSync(path.join(rootDir, DEVSET_CASES_PATH), 'utf8'));
  const toolsDoc = fs.readFileSync(path.join(rootDir, TOOLS_DOC), 'utf8');
  const { byModule } = parseMechanicalTable(toolsDoc);
  return { manifest, casesDoc, cases: casesDoc.cases ?? [], byModule, REQUIRED_CATEGORIES };
}

function writeFixturesToDisk() {
  const generated = buildDevFixtures();
  fs.mkdirSync(path.join(repoRoot, DEVSET_FIXTURES_DIR), { recursive: true });
  for (const f of generated.fixtures) {
    fs.writeFileSync(path.join(repoRoot, f.path), f.bytes);
    fs.writeFileSync(path.join(repoRoot, f.oraclePath), f.oracleText, 'utf8');
  }
  fs.writeFileSync(path.join(repoRoot, DEVSET_MANIFEST_PATH), generated.manifestText, 'utf8');
  fs.writeFileSync(path.join(repoRoot, generated.attributesPath), generated.attributesText, 'utf8');
  return generated;
}

export function verifyFixturesOnDisk(rootDir = repoRoot) {
  const generated = buildDevFixtures();
  const problems = [];
  const manifestAbs = path.join(rootDir, DEVSET_MANIFEST_PATH);
  if (!fs.existsSync(manifestAbs)) {
    problems.push(`missing ${DEVSET_MANIFEST_PATH}`);
  } else if (fs.readFileSync(manifestAbs, 'utf8') !== generated.manifestText) {
    problems.push(`${DEVSET_MANIFEST_PATH} out of sync with devset.mjs`);
  }
  const attrAbs = path.join(rootDir, generated.attributesPath);
  if (!fs.existsSync(attrAbs)) {
    problems.push(`missing ${generated.attributesPath}`);
  } else if (fs.readFileSync(attrAbs, 'utf8') !== generated.attributesText) {
    problems.push(`${generated.attributesPath} out of sync with devset.mjs`);
  }
  for (const f of generated.fixtures) {
    const fAbs = path.join(rootDir, f.path);
    if (!fs.existsSync(fAbs)) {
      problems.push(`missing ${f.path}`);
    } else if (sha256(fs.readFileSync(fAbs)) !== f.sha256) {
      problems.push(`${f.path} sha256 mismatch`);
    }
    const oAbs = path.join(rootDir, f.oraclePath);
    if (!fs.existsSync(oAbs)) {
      problems.push(`missing ${f.oraclePath}`);
    } else if (fs.readFileSync(oAbs, 'utf8') !== f.oracleText) {
      problems.push(`${f.oraclePath} oracle text mismatch`);
    }
  }
  return { ok: problems.length === 0, problems, count: generated.fixtures.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).includes('--check')) {
    const res = verifyFixturesOnDisk(repoRoot);
    if (!res.ok) {
      process.stderr.write(`devset fixture check failed:\n${res.problems.join('\n')}\n`);
      process.exit(1);
    }
    process.stdout.write(`verified ${res.count} devset fixtures and ${DEVSET_MANIFEST_PATH}\n`);
  } else {
    const generated = writeFixturesToDisk();
    process.stdout.write(`wrote ${generated.fixtures.length} devset fixtures and ${DEVSET_MANIFEST_PATH}\n`);
  }
}

