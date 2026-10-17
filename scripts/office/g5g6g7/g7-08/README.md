# G7-08 (UNI-1385) — Bảng hàng kiểm thử và bộ chấm điểm (Oracles) Ma trận AI theo Định dạng

Thư mục `scripts/office/g5g6g7/g7-08/` chứa định nghĩa bảng ma trận AI trên 6 định dạng tài liệu (`xlsx`, `docx`, `pptx`, `pdf`, `md`, `html`), cơ chế mở rộng lượt chạy (`expandMatrixRuns`), và bộ hàm chấm điểm thuần túy (`oracles.mjs` + `ooxml.mjs`) phục vụ tiêu chí nghiệm thu `G6-A03`..`G6-A06` và thiết kế §6.5.

## 1. Cấu trúc tệp

- `tools.mjs` — Hằng số công cụ thuần túy không I/O (`PDF_FILE_LEVEL_PAGE_TOOLS`, `BOUND_DOCUMENT_FORBIDDEN_TOOLS`).
- `rows.mjs` — Bảng 13 hàng tự động (`CAPABILITY_ROWS`) + 1 hàng thủ công (`HITL_ROWS`: `D-W1`), hàm `verifyRowFixtures` kiểm tra mã băm `sha256` của 6 tệp mẫu theo `docs/office/g5g6g7/acceptance.md` (dòng 72–77) và `docs/office/g5g6g7/fixtures/manifest.json` (gọi lười khi mở rộng lượt chạy hoặc gọi tường minh), và hàm `expandMatrixRuns` mở rộng 52 lượt tự động (`host ∈ {web, desktop}` × `provider ∈ {uniwork, byok}`, ưu tiên `web` trước) + 2 lượt thủ công (`D-W1` × `provider ∈ {uniwork, byok}` trên `host: 'web'`).
- `ooxml.mjs` — Bộ kiểm tra cấu trúc gói OOXML (`validateOoxmlPackage`: danh mục phần, `.rels`, `[Content_Types].xml`, XML cân bằng), bộ phân tích và chấm điểm thuần túy cho `DOCX` (`oracleDocxRead`, `oracleDocxEdit`), `PPTX` (`oraclePptxRead`, `oraclePptxEdit`), và trích xuất văn bản `PDF` (`extractPdfTextFromBytes`).
- `oracles.mjs` — Bộ chấm điểm thuần túy cho phiên bản & nút Lưu (`oracleVersionAndSave` — `G6-A03`, `G6-A04`: yêu cầu truyền tường minh `rowId` cho `oracleXlsxRead` và `targetSheet`/`targetRange` cho `oracleXlsxEdit`), bề mặt công cụ & điều khiển giao diện (`oracleCapabilityAndToolSurface` — `G6-A06`), `XLSX` (`oracleXlsxRead`, `oracleXlsxEdit`), `PDF` (`oraclePdfRead`, `oraclePdfEdit`), `Markdown` (`oracleMarkdownRead`, `oracleMarkdownEdit`), `HTML` (`oracleHtmlRead`, `oracleHtmlEdit`), và hàng thủ công Word (`oracleHitlWord`).
- `docx-roundtrip.mjs` — Bộ chuẩn hóa OOXML bước (i) (chuẩn hóa thứ tự phần tử con trong `<w:p>`, `<w:pPr>`, `<w:r>`, `<w:rPr>`, `<w:tcPr>` theo lược đồ ECMA-376 giống `ooxml-normalize.ts`) và kiểm tra vòng khép kín bước (ii) (`validateOoxmlPackage` + `parseDocxStructure` + chạy lại qua trình tạo gói hoặc `apps/office-engine/cmd/server` khi cấu hình `officeEngineUrl`), trả về `{ normalizedOk, roundTripOk }` cho `oracleDocxEdit`.
- `web-driver.mjs` — Trình điều khiển khung Web (`host: 'web'`) cho từng nhóm định dạng (`runWebXlsxRow`, `runWebDocxRow`, `runWebPptxRow`, `runWebPdfRow`, `runWebMarkdownRow`, `runWebHtmlRow`, `runWebMatrixRow`) và hai nhà cung cấp (`uniwork` qua `/api/v1/ai/chat/completions`, `byok` qua `/api/v1/ai/byok/chat/completions`), tái sử dụng `harness/web.mjs`, `g7-04/cross-host.mjs` (`listVersions`), và `g7-10/tracer.mjs`.
- `save-observe.mjs` — Các hàm thuần túy mà trình điều khiển dùng để quan sát lượt Lưu và lượt AI (w2e2): `isSaveIntentPath` (đường POST tải lên / commit / tạo phiên bản cũ), `parseCommitBaseRevision`, `extractWireUsage` (một lần gọi mô hình không có `usage` là *chưa biết*, không phải 0), `readVersionCount` (danh sách phiên bản phải là mảng, nếu không thì `BLOCKED` `missing_version_list`), `buildUndoRedoObserved`, `buildEditSaveObservation` và `observeOldVersionAfterSave`. Ý nghĩa trường: `doubleClickVersionsCreated` = số phiên bản mà lần Lưu **thứ hai** thêm vào (phải là `0`), `versionsAfterSave` = số phiên bản sau lần Lưu thứ hai.
- `web-edit-flow.mjs` — Phần đuôi của các hàng `edit` (w2e2): hoàn tác rồi làm lại qua khung, Lưu, Lưu lần hai thật, rồi đọc lại byte của phiên bản cũ qua `GET /documents/{id}/download?version=N`. Mọi bước IO có thể thay thế nên thứ tự và ánh xạ `BLOCKED` được kiểm thử không cần trình duyệt.
- `run-g7-08.mjs` — Trình chạy dòng lệnh (CLI) cho ma trận `G7-08`, ghi biên bản 18 trường chuẩn `evidence.jsonl` (qua `scripts/office/g5g6g7/evidence.mjs`) kèm tệp chi tiết `<run-dir>/g7-08/<rowId>-<provider>-<host>.json` và bộ đếm ngân sách token đầu ra.
- `rows.test.mjs`, `oracles-ooxml.test.mjs`, `oracles-formats.test.mjs`, `docx-roundtrip.test.mjs`, `run-g7-08.test.mjs` — Bộ kiểm thử đơn vị (`node --test`).

## 2. Bảng 13 hàng tự động và 1 hàng thủ công (`D-W1`) — Nội dung kiểm tra từng hàng

| Mã hàng | Định dạng | Thao tác | Tệp mẫu (`fixtureId`) | Nội dung kiểm tra chính (Oracle) | Tiêu chí nghiệm thu |
| --- | --- | --- | --- | --- | --- |
| `X-R1` | `xlsx` | `read` | `fx-xlsx-revenue-xyz` | Điểm số chân thực ≥ 85% trên doanh thu Q1 và 3 tỷ trọng vùng (`holdout-xlsx-truth.mjs`), không tạo phiên bản mới trong lượt AI (`G6-A03`). | `G6-A03`, `G6-A06` |
| `X-R2` | `xlsx` | `read` | `fx-xlsx-revenue-xyz` | Điểm số chân thực ≥ 85% trên giá trị `Khách hàng B` Quý 2 và công thức `SUM(B2:E2)` ở `F2:F6`, không tự lưu phiên bản. | `G6-A03`, `G6-A06` |
| `X-E1` | `xlsx` | `edit` | `fx-xlsx-revenue-xyz` | Điền cột `% Q1` (`G2:G6`) với công thức chia cho `$B$7`, định dạng phần trăm, ngoài vùng `G1:G7` bất biến, dấu vết chỉnh sửa hiển thị trên khung AI, chỉ tạo đúng 1 phiên bản mới khi nhấn **Lưu** (`G6-A04`). | `G6-A03`, `G6-A04`, `G6-A06` |
| `D-R1` | `docx` | `read` | `fx-docx-report-vi` | Trích dẫn đúng mục tiêu và số liệu Quý 1, có ít nhất 1 trích dẫn neo đoạn/tiêu đề (`citedAnchors`), không bịa đặt thực thể ngoài tài liệu. | `G6-A03`, `G6-A06` |
| `D-E1` | `docx` | `edit` | `fx-docx-report-vi` | Chỉ đoạn mục tiêu (`paragraphIndex: 2`) thay đổi kèm từ khóa bắt buộc, bảng và cấu trúc tiêu đề giữ nguyên, `docx-roundtrip.mjs` đạt `normalizedOk && roundTripOk` (`G6-A05`), chỉ tạo 1 phiên bản khi nhấn **Lưu**. | `G6-A03`, `G6-A04`, `G6-A05`, `G6-A06` |
| `D-W1` *(`hitl`)* | `docx` | `edit` | `fx-docx-report-vi` | Người kiểm thử mở tệp `.docx` đã Lưu từ `D-E1` (`web`) trong Microsoft Word thật: mở sạch, không hộp thoại khôi phục lỗi (`G6-A05`). | `G6-A05` |
| `P-R1` | `pptx` | `read` | `fx-pptx-deck-vi` | Tóm tắt đầy đủ nội dung từng trang chiếu (slide 1..3) khớp văn bản thực tế trong gói OOXML. | `G6-A03`, `G6-A06` |
| `P-E1` | `pptx` | `edit` | `fx-pptx-deck-vi` | Chỉ khung văn bản mục tiêu (`slideIndex: 2`, `shapeId: 3`) cập nhật chuỗi kỳ vọng; các trang chiếu và hình dạng khác bất biến; gói `.pptx` hợp lệ. | `G6-A03`, `G6-A04`, `G6-A06` |
| `F-R1` | `pdf` | `read` | `fx-pdf-invoice-vi` | Trích xuất đúng các trường số hóa đơn, đơn vị phát hành, khách hàng và tổng thanh toán từ văn bản PDF; từ chối bịa đặt nếu trang quét chưa có OCR. | `G6-A03`, `G6-A06` |
| `F-E1` | `pdf` | `edit` | `fx-pdf-invoice-vi` | Nếu host có `pdfium`: chỉ dòng văn bản mục tiêu đổi sang chuỗi mới và các trang khác bất biến. Nếu host chưa có `pdfium`: các công cụ sửa văn bản (`edit_text`, `edit_block`, `move_text_block`, `insert_text`) phải **ẩn hoàn toàn** (không disabled theo `G6-A06`) và trả về `BLOCKED` (`77`). | `G6-A03`, `G6-A04`, `G6-A06` |
| `M-R1` | `md` | `read` | `fx-md-notes-vi` | Trả lời đầy đủ các mục tiêu đề và trạng thái công việc khớp nội dung tệp Markdown. | `G6-A03`, `G6-A06` |
| `M-E1` | `md` | `edit` | `fx-md-notes-vi` | Chỉ dòng mục tiêu (`lineIndex: 9`) chuyển từ `- [ ]` sang `- [x]`; toàn bộ dòng khác, frontmatter và liên kết hình ảnh/tài sản giữ nguyên. | `G6-A03`, `G6-A04`, `G6-A06` |
| `H-R1` | `html` | `read` | `fx-html-page-vi` | Trả lời đầy đủ bố cục các khối `header`, `main`, `section` khớp nội dung HTML. | `G6-A03`, `G6-A06` |
| `H-E1` | `html` | `edit` | `fx-html-page-vi` | Khối `<section id="summary">` cập nhật văn bản mới, các khối khác bất biến, không chèn `<script>` hay thuộc tính `on*`, và khung xem trước HTML giữ sandbox/CSP an toàn. | `G6-A03`, `G6-A04`, `G6-A06` |

Hàm chấm điểm `oracleCapabilityAndToolSurface` luôn áp dụng toàn bộ tập hợp công cụ bị cấm trên tài liệu gắn cố định `BOUND_DOCUMENT_FORBIDDEN_TOOLS` (gồm `create_document` và 8 công cụ tách/gộp/cắt trang PDF cấp tệp) cho mọi hàng (`docs/office/g5g6g7/genoffice-tools.md` §8.1), cộng thêm `forbiddenTools` riêng của từng hàng (như `plan_page`, `write_document` ở `H-E1`).

## 3. Cách chạy CLI (`run-g7-08.mjs`) và Chế độ `--dry-run`

Trình chạy `scripts/office/g5g6g7/g7-08/run-g7-08.mjs` nhận các cờ:

- `--rows <danh-sách|all>`: Danh sách mã hàng phân tách bằng dấu phẩy (ví dụ: `--rows X-R1,D-E1`) hoặc `all` (mặc định: toàn bộ 13 hàng tự động).
- `--providers <danh-sách|all>`: `uniwork`, `byok`, hoặc `uniwork,byok` / `all` (mặc định: cả hai).
- `--host <web|desktop>`: Môi trường chạy (mặc định: `web`). Ở phạm vi W2, `--host desktop` thoát ngay với mã `77` (`BLOCKED`) và lý do `"W3"`.
- `--dry-run`: Khởi chạy bộ giả lập OpenAI nội bộ (`startStubFacade`) với kịch bản phản hồi/gọi công cụ xác định để kiểm chứng đầu-cuối toàn bộ luồng trình duyệt, cổng D (`uniwork` / `byok`), các hàm chấm điểm và việc ghi biên bản `evidence.jsonl` mà không tốn ngân sách LLM thật.
- `--run-dir <đường-dẫn>`: Thư mục phiên chạy chứa `ports.env` của harness, tệp `<run-dir>/evidence.jsonl` và thư mục `<run-dir>/g7-08/<rowId>-<provider>-<host>.json`.

Ví dụ chạy kiểm chứng `--dry-run` cho `X-R1` và `D-E1` trên `web` (khi tải trung bình 5 phút `< 3.5` và giữ khóa `heavy.lock`):

```bash
RUN_DIR=/tmp/g708-w2-dryrun
rm -rf "$RUN_DIR" && mkdir -p "$RUN_DIR"
HARNESS_RUN_DIR="$RUN_DIR" bash scripts/office/g5g6g7/harness/start.sh --skip-app
node scripts/office/g5g6g7/g7-08/run-g7-08.mjs \
  --rows X-R1,D-E1 \
  --providers uniwork \
  --host web \
  --dry-run \
  --run-dir "$RUN_DIR"
HARNESS_RUN_DIR="$RUN_DIR" bash scripts/office/g5g6g7/harness/stop.sh
```

## 4. Quy ước Mã thoát (`0` / `1` / `77`), Lý do `BLOCKED` và Giới hạn Ngân sách Token

Mọi hàm chấm điểm và trình chạy CLI tuân thủ nghiêm ngặt quy ước mã thoát của `docs/office/g5g6g7/acceptance.md` (dòng 35–42):

- `0` (`PASS`): Mọi lượt chạy trong danh sách đều đạt `PASS`.
- `1` (`FAIL`): Có ít nhất một lượt chạy bị `FAIL` (sai số liệu, sửa nhầm vùng ngoài mục tiêu, tự tạo phiên bản trong lượt AI, hiển thị nút công cụ ở trạng thái disabled thay vì ẩn, hoặc `BLOCKED` không nêu lý do).
- `77` (`BLOCKED`): Không có lượt chạy nào `FAIL`, nhưng có ít nhất một lượt chạy bị `BLOCKED` với lý do định danh tường minh:
  - `"W3"`: Truyền `--host desktop` (trình điều khiển desktop thuộc phạm vi W3).
  - `"real-AI upstream required, acceptance.md l.87"`: Chạy không có `--dry-run` khi chưa cấu hình khóa/điểm cuối LLM thật (`OPENAI_API_KEY` / `OPENAI_BASE_URL`).
  - `"missing F selector <selector>"` (kèm `owner: "F (uniwork-office frame)"`): Khung trình soạn thảo F thiếu bộ chọn DOM cần thiết để điều khiển bảng AI mà không sửa kho F.
  - `"missing: ẩn công cụ sửa text khi pdfium không có (docs/office/g5g6g7/genoffice-tools.md:747)"`: Hàng `F-E1` khi host không có `pdfium` và các công cụ sửa văn bản đã được ẩn đúng quy định.
  - `"hitl_word_open_pending_user"`: Hàng thủ công `D-W1` đang chờ người kiểm thử xác nhận mở tệp trong Microsoft Word thật.
  - `"missing_<field>"`: Thiếu bất kỳ trường quan sát bắt buộc nào (như `missing_xlsx_read_row_id`, `missing_xlsx_edit_target`, `missing_before_or_after_bytes`, v.v.).
  - `"budget_exhausted_output_tokens"`: Chạm trần ngân sách token đầu ra của phiên chạy.

### Giới hạn ngân sách (`100_000` output tokens)

Sau mỗi lượt `(row, provider, host)`, `run-g7-08.mjs` trích xuất số lần gọi mô hình và số token (`{ modelCalls, inputTokens, outputTokens }`) từ phản hồi `/chat/completions`, cộng dồn và in dòng tổng kết lũy kế ra stdout. Trước khi bắt đầu lượt kế tiếp (hoặc ngay khi tổng `outputTokens` lũy kế đạt/vượt ngưỡng trần `100_000` token đầu ra cho một lần chạy), trình chạy tự động dừng các hàng còn lại, đánh dấu `BLOCKED` với lý do `budget_exhausted_output_tokens` và trả về mã thoát `77`.

## 5. Chạy kiểm thử đơn vị

```bash
node --test scripts/office/g5g6g7/g7-08/*.test.mjs
```
