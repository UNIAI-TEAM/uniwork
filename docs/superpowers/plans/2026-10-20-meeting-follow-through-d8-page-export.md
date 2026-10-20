# Meetings sau họp — đợt 8: xuất trang UniNote ra DOCX/PDF — Kế hoạch

> **Trạng thái:** in-progress — UNI-2004 (đợt 8 của UNI-1995), nhánh `feature/UNI-2004-meetings-sau-hop-dot-8-xuat-trang-uninot`, PR vào `develop`.

**Mục tiêu:** spec `2026-10-20-meeting-follow-through-design.md` §1.1 (G9), D13, §6.6 (dòng
`POST /documents/{documentID}/export`), §7.7, §12 dòng 8. Mọi trang UniNote (`kind=page`) xuất
được DOCX và PDF qua office-engine, sau cờ `page_export`.

## Thiết kế

- **Hợp đồng engine:** thêm định dạng `page` vào bộ từ vựng biên (`office-contracts` `officeFormats`,
  Go `office.FormatPage`). Đầu vào của job là JSON `{title, content, images}`: `content` là
  ProseMirror JSON đã qua `document.Sanitize`, `images` là byte (base64) của các asset trang mà
  `content` tham chiếu (`asset://{id}`). `ExportTargets` thành danh sách: `docx → [pdf]`,
  `page → [docx, pdf]`.
- **Engine:** handler `export:page`. DOCX do một bộ ghi WordprocessingML viết tay trong
  `packages/office-engine/src/node/convert/page-docx.ts` (cùng kiểu `docx-write.ts`, dùng
  `writeZip` sẵn có, không thêm thư viện). PDF = DOCX đó → `renderDocxPdf` (bộ dựng UNI-1013),
  dùng chung phần kiểm sandbox/asset với `export:docx`.
- **Server:** `DocumentOfficeService.ExportPage` chạy đúng đường của `ExportFramePDF`: một office job
  `export`, chờ kết quả, trả byte thẳng (không job rồi tải), ghi nhật ký truy cập `export`. Quyền
  xem trang là đủ. `kind` khác `page` → 422 `page_export_not_page`. Route
  `POST /api/v1/documents/{documentID}/export` `{format}` sau cờ `documents` + `page_export`, có hạn
  mức riêng mỗi người.
- **Web:** `exportDocumentPage` trong `core/api/endpoints` (POST, tải file), hai mục "Xuất DOCX",
  "Xuất PDF" trong menu trang (`document-actions-menu.tsx`) khi cờ `page_export` bật.

## Việc và test chứng minh

1. Bộ ghi DOCX — `page-docx.test.ts`: trang mẫu đủ mọi loại node → DOCX giải nén được, chứa chữ
   tiếng Việt, heading, numbering, bảng (gộp ô), hyperlink, ảnh, phông Noto Sans.
2. Handler `export:page` — `docs-pdf.test.ts`: docx ghi thẳng; pdf qua Chromium giả; từ chối đầu
   vào sai, đích sai; với renderer thật (khi có asset) PDF có trang.
3. Hợp đồng + capability — test engine (`handlers.test.ts`, capability).
4. Server — `page_export_test.go`: job `export`/`page` đúng đích, đầu vào mang ảnh, nhật ký
   truy cập, `kind=file` → 422, người không có quyền → 404/403; handler: cờ, định dạng sai → 400;
   `TestIsolationMatrix` phân loại route mới.
5. Web — endpoint + test phản hồi lỗi; menu hiện/ẩn theo cờ và `kind`.

## Quyết định

Xem báo cáo UNI-2004 (`Decision:` từng dòng).
