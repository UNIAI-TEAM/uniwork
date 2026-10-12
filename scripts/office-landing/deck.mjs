// The Slides sample for the Office page screenshots: a five-slide quarterly business deck (title, agenda,
// a chart + table slide, a timeline, the team) about a made-up Vietnamese company, in Vietnamese and in English.
// It reuses the master, layouts and theme of the business fixture deck but sets the position, size, colour and
// font of every shape itself, because the fixture's master is laid out for 4:3 while its slides are 16:9 and
// inherited geometry would leave everything in the left two thirds of the slide.

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const DECK_COPY = {
  vi: {
    lang: "vi-VN",
    title: "Kết quả kinh doanh quý 3",
    subtitle: "Công ty Minh An · Năm tài chính 2026",
    agendaTitle: "Nội dung",
    agenda: [["Kết quả tài chính", "Doanh thu và lợi nhuận quý 3"], ["Cập nhật sản phẩm", "Ứng dụng di động và quy trình duyệt đơn"], ["Lộ trình", "Bốn mốc từ quý 4 đến hết 2027"], ["Đội ngũ", "Người phụ trách từng mảng"]],
    chartTitle: "Doanh thu tăng đều bốn quý liên tiếp",
    chartCaption: "Doanh thu theo quý (tỷ đồng)",
    chart: [["Q4/25", 18.2], ["Q1/26", 19.6], ["Q2/26", 21.5], ["Q3/26", 24.8]],
    tableHead: ["Khu vực", "Quý 3", "So với cùng kỳ"],
    table: [["Miền Bắc", "12,3 tỷ", "+8%"], ["Miền Nam", "7,1 tỷ", "+12%"], ["Miền Trung", "5,4 tỷ", "+9%"], ["Tổng", "24,8 tỷ", "+9%"]],
    timelineTitle: "Lộ trình đến hết 2027",
    timeline: [["Quý 4/2026", "Ra mắt ứng dụng di động"], ["Quý 1/2027", "Mở rộng sang miền Trung"], ["Quý 2/2027", "Tích hợp thanh toán"], ["Quý 3/2027", "Trợ lý AI cho đội bán hàng"]],
    teamTitle: "Đội ngũ",
    team: [["LA", "Lan Anh", "Giám đốc vận hành"], ["QH", "Quang Huy", "Trưởng nhóm sản phẩm"], ["TH", "Thu Hà", "Trưởng kinh doanh"], ["MK", "Minh Khôi", "Kỹ sư dữ liệu"]],
    closing: "Hỏi đáp?",
  },
  en: {
    lang: "en-US",
    title: "Q3 business results",
    subtitle: "Minh An Company · Fiscal year 2026",
    agendaTitle: "Agenda",
    agenda: [["Financial results", "Q3 revenue and profit"], ["Product updates", "The mobile app and order approval"], ["Roadmap", "Four milestones from Q4 to the end of 2027"], ["Team", "Who owns what"]],
    chartTitle: "Revenue has grown four quarters in a row",
    chartCaption: "Revenue by quarter (VND bn)",
    chart: [["Q4 '25", 18.2], ["Q1 '26", 19.6], ["Q2 '26", 21.5], ["Q3 '26", 24.8]],
    tableHead: ["Region", "Q3", "YoY"],
    table: [["North", "VND 12.3bn", "+8%"], ["South", "VND 7.1bn", "+12%"], ["Central", "VND 5.4bn", "+9%"], ["Total", "VND 24.8bn", "+9%"]],
    timelineTitle: "Roadmap to the end of 2027",
    timeline: [["Q4 2026", "Launch the mobile app"], ["Q1 2027", "Expand to the Central region"], ["Q2 2027", "Payments integration"], ["Q3 2027", "AI assistant for the sales team"]],
    teamTitle: "The team",
    team: [["LA", "Lan Anh", "Head of operations"], ["QH", "Quang Huy", "Product lead"], ["TH", "Thu Ha", "Head of sales"], ["MK", "Minh Khoi", "Data engineer"]],
    closing: "Questions?",
  },
};

const NAVY = "0B2A5B";
const BLUE = "0B5BF5";
const INK = "1D2433";
const MUTED = "5B6475";
const PALE = "EEF3FB";
const LINE = "D5DDEB";
const SLIDE_W = 12191695;
const SLIDE_H = 6858000;
const MARGIN = 800000;

const fill = (color) => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
const run = (text, { size = 1800, color = INK, bold = false, lang }) => `<a:r><a:rPr lang="${lang}" sz="${size}" b="${bold ? 1 : 0}" dirty="0">${fill(color)}<a:latin typeface="Calibri"/><a:cs typeface="Calibri"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
const paragraph = (text, style, align = "l") => `<a:p><a:pPr marL="0" indent="0" algn="${align}"><a:buNone/></a:pPr>${run(text, style)}</a:p>`;

let nextId = 2;
const id = () => nextId++;

/** A shape with explicit geometry; `text` is a list of [text, style] lines, vertically centred by default. */
function shape({ x, y, w, h, geom = "rect", color, border, text = [], align = "l", anchor = "ctr", inset = 91440, name = "Shape" }) {
  const sid = id();
  const body = text.length ? text.map(([value, style]) => paragraph(value, style, align)).join("") : '<a:p><a:endParaRPr lang="en-US"/></a:p>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${sid}" name="${name} ${sid}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm><a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${color ? fill(color) : "<a:noFill/>"}${border ? `<a:ln w="12700">${fill(border)}</a:ln>` : "<a:ln><a:noFill/></a:ln>"}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${inset}" tIns="45720" rIns="${inset}" bIns="45720" anchor="${anchor}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`;
}

/** The title placeholder, so the editor still sees a slide title, with its own geometry and style. */
function titlePlaceholder(text, lang, { color = NAVY, y = 420000, h = 900000, size = 3600 } = {}) {
  const sid = id();
  return `<p:sp><p:nvSpPr><p:cNvPr id="${sid}" name="Title ${sid}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${MARGIN}" y="${y}"/><a:ext cx="${SLIDE_W - 2 * MARGIN}" cy="${h}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr lIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraph(text, { size, color, bold: true, lang })}</p:txBody></p:sp>`;
}

const accentBar = () => shape({ x: MARGIN, y: 1380000, w: 900000, h: 56000, color: BLUE, name: "Accent" });

function table({ x, y, w, rowH, widths, head, rows, lang }) {
  const sid = id();
  const total = widths.reduce((sum, value) => sum + value, 0);
  const cols = widths.map((value) => Math.round((w * value) / total));
  const cell = (value, { header, last, first }) => {
    const style = { size: 1800, bold: header || last, color: header ? "FFFFFF" : INK, lang };
    const background = header ? NAVY : last ? PALE : "FFFFFF";
    const edge = `<a:lnB w="9525">${fill(LINE)}</a:lnB>`;
    return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paragraph(value, style, first ? "l" : "r")}</a:txBody><a:tcPr marL="137160" marR="137160" anchor="ctr">${edge}${fill(background)}</a:tcPr></a:tc>`;
  };
  const line = (cells, extra) => `<a:tr h="${rowH}">${cells.map((value, index) => cell(value, { ...extra, first: index === 0 })).join("")}</a:tr>`;
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${sid}" name="Table ${sid}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${rowH * (rows.length + 1)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${cols.map((value) => `<a:gridCol w="${value}"/>`).join("")}</a:tblGrid>${line(head, { header: true })}${rows.map((row, index) => line(row, { last: index === rows.length - 1 })).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

const slide = (shapes, { background } = {}) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld>${background ? `<p:bg><p:bgPr>${fill(background)}<a:effectLst/></p:bgPr></p:bg>` : ""}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

/** The five slides as xml, in order. Exported for the sample test. */
export function deckSlides(lang) {
  const c = DECK_COPY[lang];
  const l = c.lang;
  const content = SLIDE_W - 2 * MARGIN;
  const slides = [];

  nextId = 2;
  slides.push(slide([
    shape({ x: MARGIN, y: 2250000, w: 1200000, h: 70000, color: BLUE, name: "Accent" }),
    titlePlaceholder(c.title, l, { color: "FFFFFF", y: 2450000, h: 1250000, size: 5400 }),
    shape({ x: MARGIN, y: 3800000, w: content, h: 600000, text: [[c.subtitle, { size: 2400, color: "B8C7E6", lang: l }]], inset: 0, name: "Subtitle" }),
  ], { background: NAVY }));

  nextId = 2;
  const rowH = 1000000;
  slides.push(slide([
    titlePlaceholder(c.agendaTitle, l), accentBar(),
    ...c.agenda.flatMap(([name, detail], index) => {
      const y = 1800000 + index * (rowH + 120000);
      return [
        shape({ x: MARGIN, y, w: content, h: rowH, color: PALE, name: "Row" }),
        shape({ x: MARGIN + 220000, y: y + 200000, w: 600000, h: 600000, geom: "ellipse", color: BLUE, text: [[String(index + 1), { size: 2400, bold: true, color: "FFFFFF", lang: l }]], align: "ctr", inset: 0, name: "Number" }),
        shape({ x: MARGIN + 1100000, y, w: content - 1300000, h: rowH, text: [[name, { size: 2400, bold: true, color: NAVY, lang: l }], [detail, { size: 1600, color: MUTED, lang: l }]], inset: 0, name: "Item" }),
      ];
    }),
  ]));

  nextId = 2;
  const chartX = MARGIN;
  const chartW = 5300000;
  const baseY = 5750000;
  const maxHeight = 3000000;
  const peak = Math.max(...c.chart.map(([, value]) => value));
  const slot = chartW / c.chart.length;
  slides.push(slide([
    titlePlaceholder(c.chartTitle, l, { size: 3200 }), accentBar(),
    shape({ x: chartX, y: 1650000, w: chartW, h: 420000, text: [[c.chartCaption, { size: 1600, bold: true, color: MUTED, lang: l }]], inset: 0, name: "Caption" }),
    shape({ x: chartX, y: baseY, w: chartW, h: 19050, color: LINE, name: "Axis" }),
    ...c.chart.flatMap(([label, value], index) => {
      const height = (value / peak) * maxHeight;
      const x = chartX + index * slot + slot * 0.18;
      const barW = slot * 0.64;
      const last = index === c.chart.length - 1;
      return [
        shape({ x, y: baseY - height, w: barW, h: height, color: last ? BLUE : "9DB7EE", name: "Bar" }),
        shape({ x: x - 100000, y: baseY - height - 400000, w: barW + 200000, h: 380000, text: [[String(value).replace(".", lang === "vi" ? "," : "."), { size: 1600, bold: true, color: INK, lang: l }]], align: "ctr", inset: 0, name: "Value" }),
        shape({ x: x - 100000, y: baseY + 40000, w: barW + 200000, h: 340000, text: [[label, { size: 1400, color: MUTED, lang: l }]], align: "ctr", inset: 0, name: "Label" }),
      ];
    }),
    table({ x: 6500000, y: 2250000, w: SLIDE_W - 6500000 - MARGIN, rowH: 640000, widths: [1.1, 1.2, 1.2], head: c.tableHead, rows: c.table, lang: l }),
  ]));

  nextId = 2;
  const lineY = 3500000;
  const step = content / c.timeline.length;
  slides.push(slide([
    titlePlaceholder(c.timelineTitle, l), accentBar(),
    shape({ x: MARGIN, y: lineY - 20000, w: content, h: 40000, color: LINE, name: "Line" }),
    ...c.timeline.flatMap(([when, what], index) => {
      const x = MARGIN + index * step;
      return [
        shape({ x, y: lineY - 150000, w: 300000, h: 300000, geom: "ellipse", color: index === 0 ? BLUE : NAVY, name: "Milestone" }),
        shape({ x, y: lineY - 900000, w: step - 150000, h: 560000, text: [[when, { size: 2000, bold: true, color: BLUE, lang: l }]], inset: 0, anchor: "b", name: "When" }),
        shape({ x, y: lineY + 400000, w: step - 220000, h: 1500000, color: PALE, text: [[what, { size: 2000, bold: true, color: NAVY, lang: l }]], inset: 137160, anchor: "t", name: "What" }),
      ];
    }),
  ]));

  nextId = 2;
  const cardGap = 240000;
  const cardW = (content - 3 * cardGap) / 4;
  slides.push(slide([
    titlePlaceholder(c.teamTitle, l), accentBar(),
    ...c.team.flatMap(([initials, name, role], index) => {
      const x = MARGIN + index * (cardW + cardGap);
      return [
        shape({ x, y: 1900000, w: cardW, h: 3300000, color: PALE, name: "Card" }),
        shape({ x: x + cardW / 2 - 550000, y: 2250000, w: 1100000, h: 1100000, geom: "ellipse", color: index % 2 ? NAVY : BLUE, text: [[initials, { size: 3200, bold: true, color: "FFFFFF", lang: l }]], align: "ctr", inset: 0, name: "Avatar" }),
        shape({ x: x + 100000, y: 3600000, w: cardW - 200000, h: 600000, text: [[name, { size: 2200, bold: true, color: NAVY, lang: l }]], align: "ctr", inset: 0, name: "Name" }),
        shape({ x: x + 100000, y: 4200000, w: cardW - 200000, h: 700000, text: [[role, { size: 1600, color: MUTED, lang: l }]], align: "ctr", anchor: "t", inset: 0, name: "Role" }),
      ];
    }),
    shape({ x: MARGIN, y: 5600000, w: content, h: 600000, text: [[c.closing, { size: 2400, bold: true, color: BLUE, lang: l }]], inset: 0, name: "Closing" }),
  ]));
  return slides;
}

const LAYOUT_OF_SLIDE = ["slideLayout1", "slideLayout6", "slideLayout6", "slideLayout6", "slideLayout6"];

/** The fixture deck with its five slides replaced by the business deck above. */
export async function buildPptx(JSZip, fixture, lang) {
  const zip = await JSZip.loadAsync(fixture);
  deckSlides(lang).forEach((xml, index) => {
    zip.file(`ppt/slides/slide${index + 1}.xml`, xml);
    zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/${LAYOUT_OF_SLIDE[index]}.xml"/></Relationships>`);
  });
  zip.remove("ppt/media/image1.png");
  return zip.generateAsync({ type: "nodebuffer" });
}
