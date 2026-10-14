import {
  CT_APP, CT_CORE, REL_DOC, ROOT_RELS, XML_DECL, appProps, contentTypes, coreProps, ooxmlEntries, relsXml, xmlEscape,
  zipStore,
} from './zip.mjs';
import {
  ORDERS, REGIONS, SHEET_NOTES, SHEET_Q1, SHEET_Q2, SHEET_SUMMARY, discountFraction, fmtVi, regionTotals, revenueOf, sheetTotals,
} from './data.mjs';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

// cellXfs indexes, see stylesXml().
const ST = { general: 0, header: 1, int: 2, pct0: 3, pct1: 4, totalInt: 5, bold: 6 };

const colLetter = (index) => String.fromCharCode(65 + index); // sheets here never pass column Z

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

/**
 * Cell kinds: {n}, {str}, {f, n} formula with cached number, {f, str} formula with cached text,
 * {f, err} formula with cached error, {blank}. All take an optional `s` style index.
 */
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

function sheetXml(rows, widths, sst) {
  const lastRow = rows.length;
  const lastCol = Math.max(...rows.map((r) => r.cells.length));
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const body = rows
    .map((row, ri) => {
      const r = ri + 1;
      const cells = row.cells
        .map((cell, ci) => (cell ? cellXml(`${colLetter(ci)}${r}`, cell, sst) : ''))
        .join('');
      return `<row r="${r}"${row.hidden ? ' hidden="1"' : ''}>${cells}</row>`;
    })
    .join('');
  return (
    XML_DECL +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${REL_DOC}">` +
    `<dimension ref="A1:${colLetter(lastCol - 1)}${lastRow}"/>` +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`
  );
}

const h = (text) => ({ str: text, s: ST.header });

/** One order sheet; returns rows plus where the data and totals landed (for the oracle). */
function ordersSheet(sheetName, withLookups) {
  const orders = ORDERS[sheetName];
  const first = 2;
  const last = first + orders.length - 1;
  const rows = [
    {
      cells: [h('Mã đơn'), h('Khu vực'), h('Sản phẩm'), h('Số lượng (X)'), h('Đơn giá (Y, đồng)'), h('Giảm giá (Z)'), h('Doanh thu (đồng)')],
    },
  ];
  if (withLookups) rows[0].cells.push(h('Đơn giá bình quân'), h('Đối chiếu Q1'));
  orders.forEach((o, i) => {
    const r = first + i;
    const z =
      o.zKind === 'blank' ? { blank: true } : o.zKind === 'plain' ? { n: o.z } : { n: o.z, s: ST.pct0 };
    const cells = [
      { str: o.id },
      { str: o.region },
      { str: o.product },
      { n: o.x, s: ST.int },
      { n: o.y, s: ST.int },
      z,
      { f: `D${r}*E${r}*(1-IF(F${r}>1,F${r}/100,F${r}))`, n: revenueOf(o), s: ST.int },
    ];
    if (withLookups) {
      // Average price per unit: #DIV/0! where the quantity is zero.
      cells.push(o.x === 0 ? { f: `G${r}/D${r}`, err: '#DIV/0!' } : { f: `G${r}/D${r}`, n: revenueOf(o) / o.x, s: ST.int });
      // Lookup of an id that Q1 never contains: #N/A (first row only).
      cells.push(i === 0 ? { f: `VLOOKUP(A${r},'${SHEET_Q1}'!$A$2:$G$7,7,FALSE)`, err: '#N/A' } : null);
    }
    rows.push({ cells, hidden: Boolean(o.hidden) });
  });
  const t = sheetTotals(orders);
  const totalRow = last + 1;
  rows.push({
    cells: [
      { str: 'Tổng', s: ST.bold }, null, null,
      { f: `SUM(D${first}:D${last})`, n: t.withHiddenRows.sumX, s: ST.totalInt }, null, null,
      { f: `SUM(G${first}:G${last})`, n: t.withHiddenRows.revenue, s: ST.totalInt },
    ],
  });
  rows.push({
    cells: [
      { str: 'Tổng (không tính dòng ẩn)', s: ST.bold }, null, null,
      { f: `SUBTOTAL(109,D${first}:D${last})`, n: t.withoutHiddenRows.sumX, s: ST.totalInt }, null, null,
      { f: `SUBTOTAL(109,G${first}:G${last})`, n: t.withoutHiddenRows.revenue, s: ST.totalInt },
    ],
  });
  return { rows, first, last, totalRow, widths: withLookups ? [10, 10, 16, 14, 18, 14, 18, 18, 14] : [10, 10, 16, 14, 18, 14, 18] };
}

function summarySheet() {
  const q1 = ORDERS[SHEET_Q1].length + 1;
  const q2 = ORDERS[SHEET_Q2].length + 1;
  const totals = regionTotals();
  const grand = totals.reduce((a, r) => a + r.total, 0);
  const rows = [{ cells: [h('Khu vực'), h('Doanh thu Q1'), h('Doanh thu Q2'), h('Tổng'), h('Tỷ trọng')] }];
  totals.forEach((t, i) => {
    const r = i + 2;
    rows.push({
      cells: [
        { str: t.region },
        { f: `SUMIF('${SHEET_Q1}'!$B$2:$B$${q1},$A${r},'${SHEET_Q1}'!$G$2:$G$${q1})`, n: t.q1, s: ST.int },
        { f: `SUMIF('${SHEET_Q2}'!$B$2:$B$${q2},$A${r},'${SHEET_Q2}'!$G$2:$G$${q2})`, n: t.q2, s: ST.int },
        { f: `B${r}+C${r}`, n: t.total, s: ST.int },
        { f: `D${r}/$D$5`, n: t.total / grand, s: ST.pct1 },
      ],
    });
  });
  const sum = (key) => totals.reduce((a, r) => a + r[key], 0);
  rows.push({
    cells: [
      { str: 'Tổng cộng', s: ST.bold },
      { f: 'SUM(B2:B4)', n: sum('q1'), s: ST.totalInt },
      { f: 'SUM(C2:C4)', n: sum('q2'), s: ST.totalInt },
      { f: 'SUM(D2:D4)', n: sum('total'), s: ST.totalInt },
      { f: 'SUM(E2:E4)', n: 1, s: ST.pct1 },
    ],
  });
  rows.push({ cells: [] });
  // A formula pointing at a deleted sheet: #REF!
  rows.push({ cells: [{ str: 'Tham chiếu hỏng' }, { f: '#REF!', err: '#REF!' }] });
  return { rows, widths: [18, 16, 16, 16, 12] };
}

const NOTES_LINES = [
  'Ghi chú về workbook mẫu',
  'Dữ liệu tổng hợp để kiểm thử, không phải dữ liệu khách hàng.',
  'Cột X là số lượng, cột Y là đơn giá (đồng), cột Z là giảm giá.',
  'Giảm giá (Z) được nhập theo hai cách: số 10 (nghĩa là 10 phần trăm) và 10% (giá trị 0,1 định dạng phần trăm).',
  'Ô giảm giá để trống nghĩa là không giảm giá.',
  'Dòng ẩn: Q1-005 trong Doanh thu Q1 và Q2-005 trong Doanh thu Q2.',
  'Một số ô cố ý chứa lỗi: #DIV/0!, #N/A và #REF!.',
];

export function buildXlsx() {
  const sst = new SharedStrings();
  const q1 = ordersSheet(SHEET_Q1, false);
  const q2 = ordersSheet(SHEET_Q2, true);
  const summary = summarySheet();
  const notes = { rows: NOTES_LINES.map((line, i) => ({ cells: [{ str: line, s: i === 0 ? ST.bold : 0 }] })), widths: [100] };
  const sheets = [
    [SHEET_Q1, q1],
    [SHEET_Q2, q2],
    [SHEET_SUMMARY, summary],
    [SHEET_NOTES, notes],
  ];
  const parts = {};
  sheets.forEach(([, sheet], i) => {
    parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheet.rows, sheet.widths, sst);
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
  parts['docProps/core.xml'] = coreProps('Doanh thu X/Y/Z (dữ liệu mẫu)');
  parts['docProps/app.xml'] = appProps('UniWork fixture generator');
  const ws = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  parts['[Content_Types].xml'] = contentTypes([
    ['/xl/workbook.xml', `${ws}.sheet.main+xml`],
    ...sheets.map((_, i) => [`/xl/worksheets/sheet${i + 1}.xml`, `${ws}.worksheet+xml`]),
    ['/xl/styles.xml', `${ws}.styles+xml`],
    ['/xl/sharedStrings.xml', `${ws}.sharedStrings+xml`],
    ['/docProps/core.xml', CT_CORE],
    ['/docProps/app.xml', CT_APP],
  ]);

  const orderLayout = (sheet, name) => {
    const orders = ORDERS[name];
    const t = sheetTotals(orders);
    return {
      dataRows: `${sheet.first}-${sheet.last}`,
      hiddenRows: orders.flatMap((o, i) => (o.hidden ? [sheet.first + i] : [])),
      totalsRow: sheet.totalRow,
      totalsRowWithoutHidden: sheet.totalRow + 1,
      columns: { X: 'D', Y: 'E', Z: 'F', revenue: 'G' },
      totals: t,
      zCells: orders.map((o, i) => ({
        cell: `F${sheet.first + i}`,
        stored: o.z,
        kind: o.zKind === 'pct' ? 'percent-format (0%)' : o.zKind === 'plain' ? 'plain number' : 'blank',
        discountFraction: discountFraction(o.z),
      })),
      revenueByRow: orders.map((o, i) => ({ row: sheet.first + i, id: o.id, revenue: revenueOf(o) })),
    };
  };
  const grand = regionTotals().reduce((a, r) => a + r.total, 0);
  const oracle = {
    revenueFormula: 'Doanh thu = X * Y * (1 - Z); Z stored as 10 means 10 percent, as 10% means 0.1; blank means 0.',
    zRuleNote:
      'The discount rule is IF(Z>1, Z/100, Z): a stored Z above 1 is a percentage written as a number, so 10 means 10 percent. A Z of exactly 1 would therefore be read as 100 percent, which is why no cell stores 1; a blank Z is no discount. The same rule is what the workbook column G encodes.',
    shareBasisNote:
      'Tổng hợp column E ("Tỷ trọng") is each region share of Q1+Q2 revenue, while the DOCX/PPTX/MD/HTML "Tỷ trọng" column is the Q1-only share; the two are deliberately different bases and a cross-format comparison must not read them as a mismatch.',
    sheets: {
      [SHEET_Q1]: orderLayout(q1, SHEET_Q1),
      [SHEET_Q2]: orderLayout(q2, SHEET_Q2),
      [SHEET_SUMMARY]: {
        regions: regionTotals().map((r) => ({ ...r, cells: { q1Formula: 'SUMIF over Doanh thu Q1', q2Formula: 'SUMIF over Doanh thu Q2' } })),
        grandTotals: { q1: regionTotals().reduce((a, r) => a + r.q1, 0), q2: regionTotals().reduce((a, r) => a + r.q2, 0) },
        grandTotalRow: 5,
        // Column E: each region share of Q1+Q2, unlike the Q1-only share in the text formats.
        shareColumn: {
          column: 'E',
          header: 'Tỷ trọng',
          basis: 'Q1+Q2',
          formula: 'D{r}/$D$5',
          denominator: grand,
          rows: regionTotals().map((r, i) => ({
            cell: `E${i + 2}`,
            region: r.region,
            total: r.total,
            share: r.total / grand,
            shareText: `${((r.total / grand) * 100).toFixed(1).replace('.', ',')}%`,
          })),
          totalCell: 'E5',
        },
      },
    },
    sheetNames: sheets.map(([name]) => name),
    errorCells: [
      { sheet: SHEET_Q2, cell: 'H5', error: '#DIV/0!' },
      { sheet: SHEET_Q2, cell: 'I2', error: '#N/A' },
      { sheet: SHEET_SUMMARY, cell: 'B7', error: '#REF!' },
    ],
    blankCells: [
      { sheet: SHEET_Q1, cell: 'F5' },
      { sheet: SHEET_Q2, cell: 'F5' },
    ],
    cachedValuesAreCorrect: true,
    displayExamples: { revenueQ1WithHidden: fmtVi(sheetTotals(ORDERS[SHEET_Q1]).withHiddenRows.revenue) },
    regionNames: REGIONS,
  };
  return { bytes: zipStore(ooxmlEntries(parts)), oracle };
}
