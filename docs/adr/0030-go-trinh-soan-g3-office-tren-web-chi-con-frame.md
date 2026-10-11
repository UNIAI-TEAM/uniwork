# 0030 — Gỡ các trình soạn G3 và lối vào trình duyệt của engine Office; web chỉ còn frame genoffice

**Trạng thái:** accepted (2026-10-11, UNI-1240)
**Issue:** UNI-1240 (GO-C4 mục 5) · **Liên quan:** [0021](0021-runtime-engine-office-da-dinh-dang.md),
[0026](0026-office-desktop-host.md), [0027](0027-inspector-script-uniwork-cho-che-do-visual-edit.md), UNI-1001 (chuyển sang bản fork genoffice).

---

## Bối cảnh

0021 chốt "editor ở lại trang host, mọi năng lực host đi qua adapter tiêm" và nhóm G3 dựng sáu trình soạn trong trang
(DOCX, XLSX, PPTX, PDF, Markdown, HTML) trên lối vào trình duyệt của `packages/office-engine`
(`./browser`, `./desktop`, renderer DOCX/PPTX, các bundle trình duyệt của `office-upstream`). Từ UNI-1001 (2026-10-08)
tài liệu Office trên web mở trong frame genoffice cùng origin (`office_*_web`), còn "Mở trong UniWork Office" chuyển sang
ứng dụng desktop dựng từ bản fork genoffice. Sau khi mọi định dạng đã có frame, không route nào còn mount trình soạn G3
nữa; giữ chúng là giữ một bản sao thứ hai của cùng tính năng, kèm hàng nghìn khoá i18n, các pin Univer/CodeMirror/Electron
và một bề mặt bảo mật (preview HTML, inspector visual-edit) không ai còn dùng.

## Quyết định

1. Các trình soạn G3 trong `packages/views/office/` và chrome chỉ chúng dùng bị gỡ ngày 2026-10-11. Web mở tài liệu
   Office **chỉ** qua frame genoffice; khi frame không mở được thì người dùng thấy thông báo kèm Tải xuống (và Mở trong
   UniWork Office khi được bật), không có trình soạn dự phòng trong trang.
2. Lối vào trình duyệt của engine bị gỡ cùng ngày: `packages/office-engine` không còn `./browser`, `./desktop`, renderer
   DOCX/PPTX, Markdown/HTML; `office-upstream` không còn bundle trình duyệt. Engine chỉ giữ phần chạy trên Node/service
   (`.`, `./node`, `./pdf`, `./xlsx`, `./xlsx/native`, `./convert/native`) cho `apps/office-engine` và server.
3. Mục 1 của 0021 ("editor ở lại trang host") **được thay bằng ADR này**; các mục còn lại của 0021 (service nội bộ,
   engine native riêng, bằng chứng theo thao tác) vẫn giữ.
4. 0027 chuyển sang `deprecated`: chế độ visual-edit và inspector của preview HTML không còn host; cờ
   `office_html_visual_edit` đã bị xoá.

## Hệ quả

- Một đường mở tài liệu trên web thay vì hai; lỗi frame hiện thông báo và hành động tệp, không rơi về trình soạn cũ.
- Bản build web nhẹ hơn và không còn phụ thuộc Univer, CodeMirror, Electron hay pdfium.
- Các cờ `office_engine` và `office_docx` … `office_html` giờ chỉ quyết định tệp có mở trong frame hay không.
- Muốn có lại một trình soạn trong trang thì phải viết ADR mới; không khôi phục code G3 từ lịch sử git.

## Trạng thái

`accepted` (2026-10-11, UNI-1240). Thay mục 1 của 0021 (0021 vẫn `accepted` cho các mục còn lại, có ghi chú trỏ về đây);
0027 `deprecated`; 0026 đã `deprecated` cùng đợt gỡ này.
