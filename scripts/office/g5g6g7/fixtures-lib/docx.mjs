import {
  CT_APP, CT_CORE, REL_DOC, ROOT_RELS, XML_DECL, appProps, contentTypes, coreProps, ooxmlEntries, relsXml, xmlEscape,
  zipStore,
} from './zip.mjs';
import { Q1_TOTAL, REPORT_TABLE_HEADER, fmtVi, q1Shares, reportTableRows } from './data.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const run = (text, bold) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
const para = (text, style, extra = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${run(text)}</w:p>`;

function table(header, rows) {
  const widths = [2600, 3600, 2200];
  const cell = (text, w, bold, shade) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${shade ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E1F2"/>' : ''}</w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run(text, bold)}</w:p></w:tc>`;
  const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`)
    .join('');
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${header.map((t, i) => cell(t, widths[i], true, true)).join('')}</w:tr>` +
    rows
      .map((row, ri) => `<w:tr>${row.map((t, i) => cell(t, widths[i], ri === rows.length - 1, false)).join('')}</w:tr>`)
      .join('') +
    '</w:tbl>'
  );
}

const styles = () => {
  const heading = (id, name, size, before) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${id === 'Heading1' ? 0 : 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  return (
    XML_DECL +
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>` +
    '<w:sz w:val="22"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>' +
    heading('Heading1', 'heading 1', 30, 240) +
    heading('Heading2', 'heading 2', 26, 200) +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style></w:styles>'
  );
};

const numbering = () =>
  XML_DECL +
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>` +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

function reportContent() {
  const shares = q1Shares();
  const top = shares.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  return {
    title: 'Báo cáo kinh doanh quý 1 năm 2026',
    summary: `Tổng doanh thu quý 1 đạt ${fmtVi(Q1_TOTAL())} đồng. Khu vực ${top.region} đóng góp nhiều nhất với ${fmtVi(top.revenue)} đồng (${top.shareText}).`,
    dataNote: 'Số liệu lấy từ workbook mẫu, đã gồm cả các đơn hàng bị ẩn trong bảng tính. Đây là dữ liệu tổng hợp để kiểm thử.',
    headings: [
      { level: 1, text: '1. Tóm tắt điều hành' },
      { level: 1, text: '2. Doanh thu theo khu vực' },
      { level: 2, text: '2.1. Ghi chú về dữ liệu' },
      { level: 1, text: '3. Việc cần làm tiếp' },
    ],
    bullets: [
      'Rà soát các ô giảm giá nhập theo hai cách (10 và 10%).',
      'Xử lý các ô lỗi trong bảng doanh thu quý 2.',
      'Gửi báo cáo cho trưởng nhóm kinh doanh trước ngày 15.',
    ],
  };
}

export function buildDocx() {
  const c = reportContent();
  const body =
    para(c.title, 'Title') +
    para(c.headings[0].text, 'Heading1') + para(c.summary) +
    para(c.headings[1].text, 'Heading1') + table(REPORT_TABLE_HEADER, reportTableRows()) +
    para(c.headings[2].text, 'Heading2') + para(c.dataNote) +
    para(c.headings[3].text, 'Heading1') +
    c.bullets.map((b) => para(b, 'ListParagraph', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')).join('');
  const parts = {
    'word/document.xml':
      XML_DECL + `<w:document xmlns:w="${W}"><w:body>${body}` +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>',
    'word/styles.xml': styles(),
    'word/numbering.xml': numbering(),
    'word/_rels/document.xml.rels': relsXml([
      ['rId1', `${REL_DOC}/styles`, 'styles.xml'],
      ['rId2', `${REL_DOC}/numbering`, 'numbering.xml'],
    ]),
    '_rels/.rels': ROOT_RELS('officeDocument', 'word/document.xml'),
    'docProps/core.xml': coreProps(c.title),
    'docProps/app.xml': appProps('UniWork fixture generator'),
  };
  const wp = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  parts['[Content_Types].xml'] = contentTypes([
    ['/word/document.xml', `${wp}.document.main+xml`],
    ['/word/styles.xml', `${wp}.styles+xml`],
    ['/word/numbering.xml', `${wp}.numbering+xml`],
    ['/docProps/core.xml', CT_CORE],
    ['/docProps/app.xml', CT_APP],
  ]);
  const oracle = {
    title: c.title,
    headings: c.headings,
    tables: [{ header: REPORT_TABLE_HEADER, rows: reportTableRows() }],
    listItems: c.bullets,
    comments: 0,
    paragraphCount: 1 + c.headings.length + 2 + c.bullets.length,
    pageCountEstimate: 1,
    pageCountNote: 'Estimate for A4 with 1-inch margins; not render-verified.',
  };
  return { bytes: zipStore(ooxmlEntries(parts)), oracle };
}
