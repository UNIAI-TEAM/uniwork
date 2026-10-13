// Sample files for the Office page screenshots (scripts/office-landing/capture.mjs): short, realistic
// working documents about a made-up Vietnamese company, in Vietnamese and in English. Nothing here is a
// customer's data, and no file names a product other than UniWork. The Slides deck lives in deck.mjs and the
// PDF report in report.mjs; both are re-exported here so capture.mjs keeps one import.

export { buildPptx } from "./deck.mjs";
export { REPORT_PDF_OPTIONS, reportHtml as pdfHtml } from "./report.mjs";

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const COPY = {
  vi: {
    docTitle: "Kế hoạch triển khai quý 4",
    docIntro: "Tài liệu này tóm tắt mục tiêu, các mốc chính và người phụ trách cho đợt triển khai quý 4 của Công ty Minh An.",
    docHeading1: "Mục tiêu",
    docBody1: "Đưa toàn bộ quy trình duyệt đơn hàng lên một workspace chung, giảm thời gian xử lý trung bình từ ba ngày xuống một ngày.",
    docHeading2: "Các mốc chính",
    docTable: [["Mốc", "Thời hạn", "Phụ trách"], ["Chốt phạm vi", "15/10", "Lan Anh"], ["Chạy thử với hai nhóm", "31/10", "Quang Huy"], ["Mở rộng toàn công ty", "30/11", "Thu Hà"]],
    docHeading3: "Rủi ro cần theo dõi",
    docBody3: "Dữ liệu cũ chưa thống nhất định dạng; cần một buổi rà soát chung trước khi chuyển.",
    sheetName: "Doanh thu",
    sheetHead: ["Tháng", "Doanh thu (triệu đồng)", "Chi phí (triệu đồng)", "Lợi nhuận (triệu đồng)"],
    sheetMonths: ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8"],
    htmlTitle: "Hội thảo khách hàng 2026",
    htmlLead: "Một buổi chiều chia sẻ cách các nhóm vận hành làm việc cùng nhau.",
    htmlCta: "Đăng ký tham dự",
    htmlItems: ["Khai mạc và giới thiệu", "Thảo luận nhóm nhỏ", "Giải đáp và kết nối"],
    mdTitle: "Ghi chú họp nhóm vận hành",
    mdLines: ["## Quyết định", "- Chuyển quy trình duyệt đơn sang workspace chung từ ngày 15/10.", "- Quang Huy chạy thử với hai nhóm trong tháng 10.", "", "## Việc cần làm", "- [ ] Lan Anh: chốt phạm vi và gửi lại cho cả nhóm", "- [ ] Thu Hà: chuẩn bị tài liệu hướng dẫn", "", "## Ghi chú", "Dữ liệu cũ cần được rà soát trước khi chuyển."],
  },
  en: {
    docTitle: "Q4 rollout plan",
    docIntro: "This document summarises the goals, key milestones and owners for Minh An Company's Q4 rollout.",
    docHeading1: "Goals",
    docBody1: "Move the whole order-approval process into one shared workspace and cut the average handling time from three days to one.",
    docHeading2: "Key milestones",
    docTable: [["Milestone", "Due", "Owner"], ["Lock the scope", "Oct 15", "Lan Anh"], ["Pilot with two teams", "Oct 31", "Quang Huy"], ["Roll out company-wide", "Nov 30", "Thu Ha"]],
    docHeading3: "Risks to watch",
    docBody3: "Legacy data is not in a single format; a joint review is needed before the move.",
    sheetName: "Revenue",
    sheetHead: ["Month", "Revenue (VND million)", "Cost (VND million)", "Profit (VND million)"],
    sheetMonths: ["January", "February", "March", "April", "May", "June", "July", "August"],
    htmlTitle: "Customer summit 2026",
    htmlLead: "An afternoon on how operations teams work together.",
    htmlCta: "Register to attend",
    htmlItems: ["Opening and introductions", "Small-group discussion", "Q&A and networking"],
    mdTitle: "Operations team meeting notes",
    mdLines: ["## Decisions", "- Move the order-approval process to the shared workspace from Oct 15.", "- Quang Huy pilots it with two teams in October.", "", "## Action items", "- [ ] Lan Anh: lock the scope and send it back to the team", "- [ ] Thu Ha: prepare the how-to guide", "", "## Notes", "Legacy data needs a review before the move."],
  },
};

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${para(text)}</w:tc>`;
const table = (rows) => `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="4" w:color="999999"/>`).join("")}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows.map((row) => `<w:tr>${row.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;
const heading = (id, name, size) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;

/** A .docx buffer: a title, an intro, two headed sections, a milestone table and a closing risk note. */
export async function buildDocx(JSZip, lang) {
  const c = COPY[lang];
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:style>${heading("Title", "Title", 52)}${heading("Heading1", "heading 1", 32)}</w:styles>`);
  const body = [para(c.docTitle, "Title"), para(c.docIntro), para(c.docHeading1, "Heading1"), para(c.docBody1), para(c.docHeading2, "Heading1"), table(c.docTable), para(c.docHeading3, "Heading1"), para(c.docBody3)].join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A .xlsx buffer: eight months of revenue and cost with profit as a formula. */
export async function buildXlsx(JSZip, lang) {
  const c = COPY[lang];
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(c.sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  const revenue = [420, 455, 510, 498, 560, 612, 640, 705];
  const cost = [310, 322, 351, 349, 372, 401, 418, 440];
  const text = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
  const rows = [`<row r="1">${c.sheetHead.map((value, i) => text(`${"ABCD"[i]}1`, value)).join("")}</row>`];
  c.sheetMonths.forEach((month, i) => {
    const r = i + 2;
    rows.push(`<row r="${r}">${text(`A${r}`, month)}<c r="B${r}"><v>${revenue[i]}</v></c><c r="C${r}"><v>${cost[i]}</v></c><c r="D${r}"><f>B${r}-C${r}</f><v>${revenue[i] - cost[i]}</v></c></row>`);
  });
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="4" width="26" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

export function htmlPage(lang) {
  const c = COPY[lang];
  return `<!doctype html>\n<html lang="${lang}">\n<head>\n  <meta charset="utf-8">\n  <title>${esc(c.htmlTitle)}</title>\n  <style>\n    body { font-family: system-ui, sans-serif; margin: 0; color: #1d2433; }\n    header { padding: 56px 32px; background: #e8f0ff; }\n    h1 { font-size: 36px; margin: 0 0 12px; }\n    a.cta { display: inline-block; margin-top: 16px; padding: 12px 20px; border-radius: 8px; background: #0b5bf5; color: #fff; text-decoration: none; }\n    ul { padding: 24px 48px; line-height: 2; }\n  </style>\n</head>\n<body>\n  <header>\n    <h1>${esc(c.htmlTitle)}</h1>\n    <p>${esc(c.htmlLead)}</p>\n    <a class="cta" href="#">${esc(c.htmlCta)}</a>\n  </header>\n  <ul>\n${c.htmlItems.map((item) => `    <li>${esc(item)}</li>`).join("\n")}\n  </ul>\n</body>\n</html>\n`;
}

export function markdownNotes(lang) {
  const c = COPY[lang];
  return `# ${c.mdTitle}\n\n${c.mdLines.join("\n")}\n`;
}
