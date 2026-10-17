# G7-08 (UNI-1385) — Bảng hàng kiểm thử và bộ chấm điểm (Oracles) Ma trận AI theo Định dạng

Thư mục `scripts/office/g5g6g7/g7-08/` chứa định nghĩa bảng ma trận AI trên 6 định dạng tài liệu (`xlsx`, `docx`, `pptx`, `pdf`, `md`, `html`), cơ chế mở rộng lượt chạy (`expandMatrixRuns`), và bộ hàm chấm điểm thuần túy (`oracles.mjs` + `ooxml.mjs`) phục vụ tiêu chí nghiệm thu `G6-A03`..`G6-A06` và thiết kế §6.5.

## 1. Cấu trúc tệp

- `tools.mjs` — Hằng số công cụ thuần túy không I/O (`PDF_FILE_LEVEL_PAGE_TOOLS`, `BOUND_DOCUMENT_FORBIDDEN_TOOLS`).
- `rows.mjs` — Bảng 13 hàng tự động (`CAPABILITY_ROWS`) + 1 hàng thủ công (`HITL_ROWS`: `D-W1`), hàm `verifyRowFixtures` kiểm tra mã băm `sha256` của 6 tệp mẫu theo `docs/office/g5g6g7/acceptance.md` (dòng 72–77) và `docs/office/g5g6g7/fixtures/manifest.json` (gọi lười khi mở rộng lượt chạy hoặc gọi tường minh), và hàm `expandMatrixRuns` mở rộng 52 lượt tự động (`host ∈ {web, desktop}` × `provider ∈ {uniwork, byok}`, ưu tiên `web` trước) + 2 lượt thủ công (`D-W1` × `provider ∈ {uniwork, byok}` trên `host: 'web'`).
- `ooxml.mjs` — Bộ kiểm tra cấu trúc gói OOXML (`validateOoxmlPackage`: danh mục phần, `.rels`, `[Content_Types].xml`, XML cân bằng), bộ phân tích và chấm điểm thuần túy cho `DOCX` (`oracleDocxRead`, `oracleDocxEdit`), `PPTX` (`oraclePptxRead`, `oraclePptxEdit`), và trích xuất văn bản `PDF` (`extractPdfTextFromBytes`).
- `oracles.mjs` — Bộ chấm điểm thuần túy cho phiên bản & nút Lưu (`oracleVersionAndSave` — `G6-A03`, `G6-A04`), bề mặt công cụ & điều khiển giao diện (`oracleCapabilityAndToolSurface` — `G6-A06`), `XLSX` (`oracleXlsxRead`, `oracleXlsxEdit` tái sử dụng `holdout-xlsx-truth.mjs`, `holdout-score.mjs`, `holdout-write-proof.mjs`), `PDF` (`oraclePdfRead`, `oraclePdfEdit`), `Markdown` (`oracleMarkdownRead`, `oracleMarkdownEdit`), `HTML` (`oracleHtmlRead`, `oracleHtmlEdit`), và hàng thủ công Word (`oracleHitlWord`).
- `rows.test.mjs`, `oracles-ooxml.test.mjs`, `oracles-formats.test.mjs` — Bộ kiểm thử đơn vị (`node --test`) trên tệp mẫu thật (`make-fixtures.mjs`) và các bản sao đột biến có chủ đích.

## 2. Bảng 13 hàng tự động và 1 hàng thủ công (`D-W1`)

| Mã hàng | Định dạng | Thao tác | Tệp mẫu (`fixtureId`) | Công cụ kỳ vọng (`expectedTools`) | Tiêu chí nghiệm thu |
| --- | --- | --- | --- | --- | --- |
| `X-R1` | `xlsx` | `read` | `fx-xlsx-revenue-xyz` | `aggregate_range`, `summarize_range`, `read_range`, `get_workbook_context` | `G6-A03`, `G6-A06` |
| `X-R2` | `xlsx` | `read` | `fx-xlsx-revenue-xyz` | `read_range`, `read_cells`, `read_formats`, `read_sheet_features`, `find_cells`, `summarize_range`, `aggregate_range` | `G6-A03`, `G6-A06` |
| `X-E1` | `xlsx` | `edit` | `fx-xlsx-revenue-xyz` | `get_workbook_context`, `read_range`, `propose_operations` | `G6-A03`, `G6-A04`, `G6-A06` |
| `D-R1` | `docx` | `read` | `fx-docx-report-vi` | `get_document_context`, `read_blocks` | `G6-A03`, `G6-A06` |
| `D-E1` | `docx` | `edit` | `fx-docx-report-vi` | `get_document_context`, `read_blocks`, `replace_selection`, `replace_blocks`, `apply_ops` | `G6-A03`, `G6-A04`, `G6-A05`, `G6-A06` |
| `D-W1` *(`mode: 'hitl'`)* | `docx` | `edit` | `fx-docx-report-vi` | *(mở tệp đã Lưu sau `D-E1` trên `web` trong Microsoft Word thật)* | `G6-A05` |
| `P-R1` | `pptx` | `read` | `fx-pptx-deck-vi` | `read_slide` | `G6-A03`, `G6-A06` |
| `P-E1` | `pptx` | `edit` | `fx-pptx-deck-vi` | `read_slide`, `apply_ops`, `execute_slide_script` | `G6-A03`, `G6-A04`, `G6-A06` |
| `F-R1` | `pdf` | `read` | `fx-pdf-invoice-vi` | `read_pages`, `search_text`, `goto_page`, `get_outline` | `G6-A03`, `G6-A06` |
| `F-E1` | `pdf` | `edit` | `fx-pdf-invoice-vi` | `read_pages`, `edit_text`, `edit_block`, `move_text_block`, `insert_text` | `G6-A03`, `G6-A04`, `G6-A06` |
| `M-R1` | `md` | `read` | `fx-md-notes-vi` | `get_document_context`, `read_blocks`, `read_frontmatter` | `G6-A03`, `G6-A06` |
| `M-E1` | `md` | `edit` | `fx-md-notes-vi` | `get_document_context`, `read_blocks`, `apply_ops`, `write_document` | `G6-A03`, `G6-A04`, `G6-A06` |
| `H-R1` | `html` | `read` | `fx-html-page-vi` | `get_outline`, `read_source` | `G6-A03`, `G6-A06` |
| `H-E1` | `html` | `edit` | `fx-html-page-vi` | `get_outline`, `read_source`, `apply_ops` | `G6-A03`, `G6-A04`, `G6-A06` |

Hàm chấm điểm `oracleCapabilityAndToolSurface` luôn áp dụng toàn bộ tập hợp công cụ bị cấm trên tài liệu gắn cố định `BOUND_DOCUMENT_FORBIDDEN_TOOLS` (gồm `create_document` và 8 công cụ tách/gộp/cắt trang PDF cấp tệp: `insert_blank_page`, `set_page_size`, `crop_pages`, `replace_pages`, `extract_pages`, `split_pdf`, `split_pages`, `merge_pages`) cho mọi hàng vì biên tập viên luôn gắn với một `document_id` cố định (`docs/office/g5g6g7/genoffice-tools.md` §8.1), cộng thêm `forbiddenTools` riêng của từng hàng (như `plan_page`, `write_document` ở `H-E1`).

## 3. Tự động hoàn toàn so với Kiểm tra Thủ công (`D-W1` Microsoft Word)

- **52 lượt chạy tự động** (`13 hàng × 2 host × 2 provider`, `mode: 'automated'`):
  - Kiểm tra cấu trúc gói OOXML (`validateOoxmlPackage`) và hook chuẩn hóa / vòng khép kín (`ooxml-normalize` + round-trip engine) được thực thi tự động trong `oracleDocxEdit` (`D-E1`).
  - Đối với `F-E1` khi môi trường chưa có `pdfium` để sửa văn bản PDF (`hostSupportsPdfTextEdit === false`): `oraclePdfEdit` kiểm tra các công cụ sửa văn bản (`edit_text`, `edit_block`, `move_text_block`, `insert_text`) phải hoàn toàn **vắng mặt** (không xuất hiện và không ở trạng thái vô hiệu hóa theo `G6-A06`), sau đó trả về `BLOCKED` (`77`) kèm lý do rõ ràng (`missing: ẩn công cụ sửa text khi pdfium không có (docs/office/g5g6g7/genoffice-tools.md:747)`).
- **2 lượt chạy thủ công (`D-W1`, `mode: 'hitl'`)**:
  - Mở rộng theo `D-W1` × `provider ∈ {uniwork, byok}` trên `host: 'web'` (`D-W1:uniwork:web:hitl`, `D-W1:byok:web:hitl`): người kiểm thử mở tệp `.docx` đã nhấn **Lưu** từ lượt chạy web `D-E1` tương ứng của từng provider trong Microsoft Word thật để xác nhận tiêu chí `G6-A05` (mở sạch, không hộp thoại sửa lỗi). Khi chưa có xác nhận của người dùng, `oracleHitlWord` trả về `BLOCKED` (`77`, `hitl_word_open_pending_user`).

## 4. Quy ước Mã thoát (`0` / `1` / `77`)

Mọi hàm chấm điểm đều trả về `{ status, exitCode, reason, details }` tuân thủ nghiêm ngặt quy ước của `docs/office/g5g6g7/acceptance.md` (dòng 35–42):

- `0` (`PASS`): Đạt toàn bộ điều kiện kiểm tra của hàng và các tiêu chí nghiệm thu liên quan.
- `1` (`FAIL`): Vi phạm bất kỳ điều kiện bảo vệ nào (sai số liệu, sửa nhầm vùng ngoài mục tiêu, tự tạo phiên bản trong lượt AI, hiển thị nút công cụ ở trạng thái disabled thay vì ẩn, hoặc `BLOCKED` nhưng không nêu lý do `reason`).
- `77` (`BLOCKED`): Thiếu bất kỳ trường đầu vào bắt buộc nào (mỗi trường thiếu đều trả về `missing_<field>`, không bao giờ tự gán giá trị mặc định để `PASS`), thiếu khả năng trên host đã được ghi nhận trong `genoffice-tools.md` §8, hoặc đang chờ người dùng xác nhận ở bước `mode: 'hitl'` (`D-W1`).

## 5. Chạy kiểm thử đơn vị

```bash
node --test scripts/office/g5g6g7/g7-08/*.test.mjs
```
