// The PDF sample for the Office page screenshots: a three-page monthly operations report (headings, a figures
// table, a per-warehouse table, a numbered recommendation list, an action table) about a made-up Vietnamese
// company, in Vietnamese and in English. capture.mjs prints reportHtml() with the browser it already runs.

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const REPORT_COPY = {
  vi: {
    title: "Báo cáo vận hành tháng 9",
    meta: "Công ty Minh An · Khối vận hành · Lập ngày 02/10/2026",
    summaryHeading: "1. Tóm tắt điều hành",
    summary: "Số đơn xử lý trong tháng tăng 12% so với tháng 8 và thời gian phản hồi trung bình giảm còn 6 giờ. Hai kho phía Nam vẫn cập nhật tồn kho chậm; nhóm đề xuất đồng bộ hằng ngày từ tháng 10.",
    kpiHeading: "2. Chỉ số chính",
    kpiHead: ["Chỉ số", "Tháng 8", "Tháng 9", "Thay đổi"],
    kpi: [["Đơn hàng xử lý", "8.420", "9.430", "+12%"], ["Thời gian phản hồi (giờ)", "7,5", "6,0", "−20%"], ["Tỷ lệ giao đúng hẹn", "93,1%", "95,4%", "+2,3 điểm"], ["Đơn hoàn trả", "2,4%", "2,1%", "−0,3 điểm"]],
    kpiNote: "Số liệu lấy từ bảng việc và hệ thống kho, chốt đến hết ngày 30/09.",
    warehouseHeading: "3. Hiệu suất theo kho",
    warehouseIntro: "Ba trong năm kho đạt mục tiêu giao đúng hẹn 95%. Hai kho phía Nam thấp hơn do tồn kho cập nhật chậm vào cuối ngày.",
    warehouseHead: ["Kho", "Đơn xử lý", "Đúng hẹn", "Cập nhật tồn kho"],
    warehouses: [["Hà Nội", "3.210", "97,0%", "Thời gian thực"], ["Hải Phòng", "1.480", "96,2%", "Thời gian thực"], ["Đà Nẵng", "1.350", "95,8%", "Mỗi giờ"], ["TP. Hồ Chí Minh", "2.050", "92,4%", "Cuối ngày"], ["Cần Thơ", "1.340", "91,7%", "Cuối ngày"]],
    improveHeading: "4. Điểm cần cải thiện",
    improve: ["Tồn kho ở hai kho phía Nam chỉ được cập nhật vào cuối ngày, nên đơn buổi chiều đôi khi nhận sai số lượng.", "Đơn hoàn trả tập trung ở ba mặt hàng mới; nhóm sản phẩm cần rà lại mô tả và ảnh."],
    recHeading: "5. Đề xuất",
    rec: ["Đồng bộ tồn kho hằng ngày cho hai kho phía Nam từ ngày 15/10.", "Duy trì buổi rà soát tuần và giao chủ sở hữu cho từng chỉ số.", "Rà lại mô tả ba mặt hàng có tỷ lệ hoàn trả cao nhất trước cuối tháng."],
    actionHeading: "6. Kế hoạch hành động",
    actionHead: ["Việc", "Phụ trách", "Hạn"],
    actions: [["Đồng bộ tồn kho hằng ngày", "Quang Huy", "15/10"], ["Rà mô tả ba mặt hàng", "Thu Hà", "25/10"], ["Báo cáo kết quả sau một tháng", "Lan Anh", "15/11"]],
  },
  en: {
    title: "September operations report",
    meta: "Minh An Company · Operations · Prepared Oct 2, 2026",
    summaryHeading: "1. Executive summary",
    summary: "Orders processed rose 12% over August, and the average response time fell to 6 hours. Two southern warehouses are still slow to update stock; the team suggests a daily sync from October.",
    kpiHeading: "2. Key figures",
    kpiHead: ["Metric", "August", "September", "Change"],
    kpi: [["Orders processed", "8,420", "9,430", "+12%"], ["Response time (hours)", "7.5", "6.0", "−20%"], ["On-time delivery", "93.1%", "95.4%", "+2.3 pts"], ["Returned orders", "2.4%", "2.1%", "−0.3 pts"]],
    kpiNote: "Figures come from the task board and the warehouse system, as of the end of September 30.",
    warehouseHeading: "3. Performance by warehouse",
    warehouseIntro: "Three of the five warehouses met the 95% on-time target. The two southern ones fell short because stock is updated late in the day.",
    warehouseHead: ["Warehouse", "Orders", "On time", "Stock updates"],
    warehouses: [["Hanoi", "3,210", "97.0%", "Real time"], ["Hai Phong", "1,480", "96.2%", "Real time"], ["Da Nang", "1,350", "95.8%", "Hourly"], ["Ho Chi Minh City", "2,050", "92.4%", "End of day"], ["Can Tho", "1,340", "91.7%", "End of day"]],
    improveHeading: "4. Where to improve",
    improve: ["Stock in the two southern warehouses is only updated at the end of the day, so afternoon orders sometimes get the wrong quantity.", "Returns cluster on three new products; the product team should review their descriptions and photos."],
    recHeading: "5. Recommendations",
    rec: ["Sync stock daily for the two southern warehouses from Oct 15.", "Keep the weekly review and give each metric an owner.", "Review the descriptions of the three products with the most returns before the end of the month."],
    actionHeading: "6. Action plan",
    actionHead: ["Task", "Owner", "Due"],
    actions: [["Daily stock sync", "Quang Huy", "Oct 15"], ["Review three product descriptions", "Thu Ha", "Oct 25"], ["Report results after one month", "Lan Anh", "Nov 15"]],
  },
};

const STYLE = `@page{size:A4;margin:0 0 12mm}
body{font:14px/1.65 Arial,Helvetica,sans-serif;color:#1d2433;margin:0}
.page{box-sizing:border-box;height:285mm;padding:22mm 20mm 14mm;page-break-after:always;overflow:hidden}
.page:last-child{page-break-after:auto}
h1{font-size:28px;margin:0 0 4px;color:#0b2a5b}
.meta{margin:0 0 22px;color:#5b6475;font-size:12px;padding-bottom:12px;border-bottom:3px solid #0b5bf5}
h2{font-size:18px;margin:26px 0 8px;color:#0b2a5b}
p{margin:0 0 10px}
table{width:100%;border-collapse:collapse;margin:10px 0 6px;font-size:13px}
th{background:#0b2a5b;color:#fff;text-align:left;padding:8px 10px}
td{padding:8px 10px;border-bottom:1px solid #d5ddeb}
th:not(:first-child),td:not(:first-child){text-align:right}
tr:nth-child(even) td{background:#f3f6fc}
.note{font-size:11.5px;color:#5b6475}
ul,ol{margin:0 0 10px;padding-left:22px}
li{margin-bottom:6px}`;

const rows = (list) => list.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("");
const grid = (head, list) => `<table><thead><tr>${head.map((cell) => `<th>${esc(cell)}</th>`).join("")}</tr></thead><tbody>${rows(list)}</tbody></table>`;

/** The report as one printable page per section group: summary and figures, warehouses and findings, plan. */
export function reportHtml(lang) {
  const c = REPORT_COPY[lang];
  const pageOne = `<section class="page"><h1>${esc(c.title)}</h1><p class="meta">${esc(c.meta)}</p><h2>${esc(c.summaryHeading)}</h2><p>${esc(c.summary)}</p><h2>${esc(c.kpiHeading)}</h2>${grid(c.kpiHead, c.kpi)}<p class="note">${esc(c.kpiNote)}</p></section>`;
  const pageTwo = `<section class="page"><h2>${esc(c.warehouseHeading)}</h2><p>${esc(c.warehouseIntro)}</p>${grid(c.warehouseHead, c.warehouses)}<h2>${esc(c.improveHeading)}</h2><ul>${c.improve.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></section>`;
  const pageThree = `<section class="page"><h2>${esc(c.recHeading)}</h2><ol>${c.rec.map((line) => `<li>${esc(line)}</li>`).join("")}</ol><h2>${esc(c.actionHeading)}</h2>${grid(c.actionHead, c.actions)}</section>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(c.title)}</title><style>${STYLE}</style></head><body>${pageOne}${pageTwo}${pageThree}</body></html>`;
}

/** page.pdf() options: A4, backgrounds on, page numbers in the footer (no words, so one template serves both languages). */
export const REPORT_PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: '<div style="width:100%;font:9px Arial,sans-serif;color:#5b6475;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
};
