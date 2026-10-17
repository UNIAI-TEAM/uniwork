# G7-08 (UNI-1385) — Bảng hàng kiểm thử và bộ chấm điểm (Oracles) Ma trận AI theo Định dạng

Thư mục `scripts/office/g5g6g7/g7-08/` chứa định nghĩa bảng ma trận AI trên 6 định dạng tài liệu (`xlsx`, `docx`, `pptx`, `pdf`, `md`, `html`), cơ chế mở rộng lượt chạy (`expandMatrixRuns`), và bộ hàm chấm điểm thuần túy (`oracles.mjs` + `ooxml.mjs`) phục vụ tiêu chí nghiệm thu `G6-A03`..`G6-A06` và thiết kế §6.5.

## 1. Cấu trúc tệp

- `rows.mjs` — Bảng 13 hàng tự động (`CAPABILITY_ROWS`) + 1 hàng thủ công (`HITL_ROWS`: `D-W1`), kiểm tra mã băm `sha256` của 6 tệp mẫu theo `docs/office/g5g6g7/acceptance.md` (dòng 72–77) và `docs/office/g5g6g7/fixtures/manifest.json`, và hàm `expandMatrixRuns` mở rộng theo trục `host ∈ {web, desktop}` × `provider ∈ {uniwork, byok}` (ưu tiên chạy `web` trước).
- `ooxml.mjs` — Bộ kiểm tra cấu trúc gói OOXML (`validateOoxmlPackage`: danh mục phần, `.rels`, `[Content_Types].xml`, XML cân bằng), bộ phân tích và chấm điểm thuần túy cho `DOCX` (`oracleDocxRead`, `oracleDocxEdit`), `PPTX` (`oraclePptxRead`, `oraclePptxEdit`), và trích xuất văn bản `PDF` (`extractPdfTextFromBytes`).
- `oracles.mjs` — Bộ chấm điểm thuần túy cho phiên bản & nút Lưu (`oracleVersionAndSave` — `G6-A03`, `G6-A04`), bề mặt công cụ & điều khiển giao diện (`oracleCapabilityAndToolSurface` — `G6-A06`), `XLSX` (`oracleXlsxRead`, `oracleXlsxEdit` tái sử dụng `holdout-xlsx-truth.mjs`, `holdout-score.mjs`, `holdout-write-proof.mjs`), `PDF` (`oraclePdfRead`, `oraclePdfEdit`), `Markdown` (`oracleMarkdownRead`, `oracleMarkdownEdit`), `HTML` (`oracleHtmlRead`, `oracleHtmlEdit`), và hàng thủ công Word (`oracleHitlWord`).
- `rows.test.mjs`, `oracles-ooxml.test.mjs`, `oracles-formats.test.mjs` — Bộ kiểm thử đơn vị (`node --test`) trên tệp mẫu thật (`make-fixtures.mjs`) và các bản sao đột biến có chủ đích.

## 2. Bảng 13 hàng tự động và 1 hàng thủ công (`D-W1`)

| Mã hàng | Định dạng | Thao tác | Tệp mẫu (`fixtureId`) | Công cụ kỳ vọng | Tiêu chí nghiệm thu |
| --- | --- | --- | --- | --- | --- |
| `X-R1` | `xlsx` | `read` | `fx-xlsx-revenue-xyz` | `get_Document_Column_Summary`, `read_Sheet` | `G6-A03`, `G6-A06` |
| `X-R2` | `xlsx` | `read` | `fx-xlsx-revenue-xyz` | `get_Document_Column_Summary`, `read_Sheet`, `search_content` | `G6-A03`, `G6-A06` |
| `X-E1` | `xlsx` | `edit` | `fx-xlsx-revenue-xyz` | `read_Sheet`, `write_cells` | `G6-A03`, `G6-A04`, `G6-A06` |
| `D-R1` | `docx` | `read` | `fx-docx-report-vi` | `get_document_Outline`, `read_document_content` | `G6-A03`, `G6-A06` |
| `D-E1` | `docx` | `edit` | `fx-docx-report-vi` | `read_document_content`, `edit_block` | `G6-A03`, `G6-A04`, `G6-A05`, `G6-A06` |
| `D-W1` *(hitl)* | `docx` | `edit` | `fx-docx-report-vi` | *(mở tệp sau `D-E1` trong Microsoft Word thật)* | `G6-A05` |
| `P-R1` | `pptx` | `read` | `fx-pptx-deck-vi` | `read_Slide_Summary`, `read_slide_details` | `G6-A03`, `G6-A06` |
| `P-E1` | `pptx` | `edit` | `fx-pptx-deck-vi` | `read_slide_details`, `update_Element` | `G6-A03`, `G6-A04`, `G6-A06` |
| `F-R1` | `pdf` | `read` | `fx-pdf-invoice-vi` | `get_pdf_Structure`, `extract_pdf_text` | `G6-A03`, `G6-A06` |
| `F-E1` | `pdf` | `edit` | `fx-pdf-invoice-vi` | `extract_pdf_text`, `edit_text` | `G6-A03`, `G6-A04`, `G6-A06` |
| `M-R1` | `md` | `read` | `fx-md-notes-vi` | `get_markdown_Structure`, `read_markdown_content` | `G6-A03`, `G6-A06` |
| `M-E1` | `md` | `edit` | `fx-md-notes-vi` | `read_markdown_content`, `edit_markdown_lines` | `G6-A03`, `G6-A04`, `G6-A06` |
| `H-R1` | `html` | `read` | `fx-html-page-vi` | `get_html_outline`, `read_html_Element` | `G6-A03`, `G6-A06` |
| `H-E1` | `html` | `edit` | `fx-html-page-vi` | `read_html_Element`, `edit_Element` | `G6-A03`, `G6-A04`, `G6-A06` |

Mọi hàng đều cấm `create_document` và 8 công cụ tách/gộp/cắt trang PDF cấp tệp (`insert_blank_page`, `set_page_size`, `crop_pages`, `replace_pages`, `extract_pages`, `split_pdf`, `split_pages`, `merge_pages`) vì biên tập viên luôn gắn với một `document_id` cố định (`docs/office/g5g6g7/genoffice-tools.md` §8.1).

## 3. Tự động hoàn toàn so với Kiểm tra Thủ công (`D-W1` Microsoft Word)

- **52 lượt chạy tự động** (`13 hàng × 2 host × 2 provider`):
  - Kiểm tra cấu trúc gói OOXML (`validateOoxmlPackage`) và hook chuẩn hóa / vòng khép kín (`ooxml-normalize` + round-trip engine) được thực thi tự động trong `oracleDocxEdit` (`D-E1`).
  - Đối với `F-E1` khi môi trường chưa có `pdfium` để sửa văn bản PDF: `oraclePdfEdit` kiểm tra các công cụ sửa văn bản phải hoàn toàn **vắng mặt** (không xuất hiện và không ở trạng thái vô hiệu hóa theo `G6-A06`), sau đó trả về `BLOCKED` (`77`) kèm lý do rõ ràng (`missing: ẩn công cụ sửa text khi pdfium không có (docs/office/g5g6g7/genoffice-tools.md:747)`).
- **2 lượt chạy thủ công (`D-W1`, `hitl: true`)**:
  - Tiêu chí `G6-A05` yêu cầu tệp `.docx` sau khi AI sửa và nhấn **Lưu** phải mở sạch trong Microsoft Word thật (không hộp thoại sửa lỗi). Vì môi trường máy chủ CI/Linux không có Microsoft Word, `D-W1` được tách riêng thành hàng `hitl` để người kiểm thử xác nhận; khi chưa có xác nhận của người dùng, `oracleHitlWord` trả về `BLOCKED` (`77`, `hitl_word_open_pending_user`).

## 4. Quy ước Mã thoát (`0` / `1` / `77`)

Mọi hàm chấm điểm đều trả về `{ status, exitCode, reason, details }` tuân thủ nghiêm ngặt quy ước của `docs/office/g5g6g7/acceptance.md` (dòng 35–42):

- `0` (`PASS`): Đạt toàn bộ điều kiện kiểm tra của hàng và các tiêu chí nghiệm thu liên quan.
- `1` (`FAIL`): Vi phạm bất kỳ điều kiện bảo vệ nào (sai số liệu, sửa nhầm vùng ngoài mục tiêu, tự tạo phiên bản trong lượt AI, hiển thị nút công cụ ở trạng thái disabled thay vì ẩn, hoặc `BLOCKED` nhưng không nêu lý do `reason`).
- `77` (`BLOCKED`): Thiếu hiện vật đầu vào, thiếu khả năng trên host đã được ghi nhận trong `genoffice-tools.md` §8, hoặc đang chờ người dùng xác nhận ở bước `hitl` (`D-W1`). Mọi kết quả `BLOCKED` bắt buộc phải có `reason` tường minh.

## 5. Chạy kiểm thử đơn vị

```bash
node --test scripts/office/g5g6g7/g7-08/*.test.mjs
```
