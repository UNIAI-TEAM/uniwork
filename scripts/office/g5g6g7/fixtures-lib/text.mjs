import { xmlEscape } from './zip.mjs';
import { Q1_TOTAL, REPORT_TABLE_HEADER, fmtVi, reportTableRows } from './data.mjs';

const mdRow = (cells) => `| ${cells.join(' | ')} |`;

const MD_CODE = "=SUMIF('Doanh thu Q1'!$B$2:$B$7, $A2, 'Doanh thu Q1'!$G$2:$G$7)";

export function buildMarkdown() {
  const rows = reportTableRows();
  const headings = [
    { level: 1, text: 'Ghi chú họp rà soát doanh thu quý 1' },
    { level: 2, text: 'Tóm tắt' },
    { level: 2, text: 'Doanh thu theo khu vực' },
    { level: 2, text: 'Công thức tham chiếu' },
    { level: 2, text: 'Việc cần làm' },
  ];
  const bullets = [
    'Thống nhất cách nhập giảm giá: dùng 10% thay cho số 10.',
    'Sửa các ô lỗi trong bảng doanh thu quý 2.',
  ];
  const doc = [
    `# ${headings[0].text}`,
    '',
    'Ngày họp: 05/10/2026. Dữ liệu mẫu, không phải dữ liệu khách hàng.',
    '',
    `## ${headings[1].text}`,
    '',
    `Tổng doanh thu quý 1 là ${fmtVi(Q1_TOTAL())} đồng, tính cả các dòng bị ẩn.`,
    '',
    `## ${headings[2].text}`,
    '',
    mdRow(REPORT_TABLE_HEADER),
    '| --- | ---: | ---: |',
    ...rows.map(mdRow),
    '',
    `## ${headings[3].text}`,
    '',
    '```excel',
    MD_CODE,
    '```',
    '',
    `## ${headings[4].text}`,
    '',
    ...bullets.map((b) => `- [ ] ${b}`),
    '',
  ].join('\n');
  const oracle = {
    headings,
    tables: [{ header: REPORT_TABLE_HEADER, rows }],
    codeBlocks: [{ lang: 'excel', code: MD_CODE }],
    taskItems: bullets,
    lineEndings: 'LF',
  };
  return { bytes: Buffer.from(doc, 'utf8'), oracle };
}

export function buildHtml() {
  const rows = reportTableRows();
  const headings = [
    { level: 1, text: 'Bảng doanh thu quý 1 theo khu vực' },
    { level: 2, text: 'Ghi chú' },
  ];
  const e = xmlEscape;
  const tr = (cells, tag) => `        <tr>${cells.map((c) => `<${tag}>${e(c)}</${tag}>`).join('')}</tr>`;
  const caption = 'Doanh thu quý 1 (đồng)';
  const note = 'Dữ liệu mẫu để kiểm thử. Tổng đã gồm các đơn hàng bị ẩn trong bảng tính.';
  const doc = [
    '<!doctype html>',
    '<html lang="vi">',
    '  <head>',
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    `    <title>${e(headings[0].text)}</title>`,
    '  </head>',
    '  <body>',
    '    <main>',
    `      <h1>${e(headings[0].text)}</h1>`,
    '      <table>',
    `        <caption>${e(caption)}</caption>`,
    '        <thead>',
    tr(REPORT_TABLE_HEADER, 'th'),
    '        </thead>',
    '        <tbody>',
    ...rows.map((r) => tr(r, 'td')),
    '        </tbody>',
    '      </table>',
    `      <h2>${e(headings[1].text)}</h2>`,
    `      <p>${e(note)}</p>`,
    '    </main>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');
  const oracle = {
    htmlLang: 'vi',
    title: headings[0].text,
    headings,
    tables: [{ caption, header: REPORT_TABLE_HEADER, rows }],
    paragraphs: [note],
    externalResources: 0,
    scripts: 0,
  };
  return { bytes: Buffer.from(doc, 'utf8'), oracle };
}
