# Báo cáo bộ dữ liệu phát triển (Dev Set) và tinh chỉnh gói chỉ dẫn UniWork AI (G6-08)

> **Trạng thái:** Hoàn tất đánh giá `office_uniwork_ai@1` → `office_uniwork_ai@2` trên bộ dữ liệu phát triển G6-08 (UNI-1373, ngày 2026-10-14).

## 1. Thông tin phiên chạy và môi trường

- **Mã gói chỉ dẫn (`prompt_id`) được đo:**
  - Trước tinh chỉnh: `office_uniwork_ai@1` (sha256 pin: `610071c053949cca830cacac60883e3491fa131418e377757893b5965d8b1faa`)
  - Sau tinh chỉnh: `office_uniwork_ai@2` (sha256 pin: `1e47cf912b53dfb5c481f34bce6c27cc0c7e2e310f1ba22088083c8b0a3e5a82`)
- **Upstream phát triển:** dev upstream (`customlocal`, `~/.codex/config.toml`) nạp qua biến môi trường theo `docs/office/g5g6g7/dev-upstream.md` (`AI_PROVIDER=openai`). Không lưu host, IP, cổng hoặc khóa API trong kho mã hay báo cáo.
- **Mô hình thực tế được phân giải (`resolved model`):** `gpt-6-luna`
- **Ngày thực hiện:** `2026-10-14`
- **Đường chạy thực tế:**
  1. **Kiểm chứng đầu-cuối qua giao diện bảng điều khiển (Panel UI End-to-End):** Trình duyệt không giao diện (Playwright Chromium headless) điều khiển trực tiếp khung ứng dụng `uniwork-office` (`web/modules/shared/ai/web-ai.ts`, `AiPanel` cho Docs và `AiChatPanel` + `AgentLoop` cho Sheets) gọi tuyến façade `/api/v1/office-frame/documents/{id}/ai/uniwork/chat/completions` bằng `frame_token` cho cả 4 tổ hợp `(docs, sheets) × (vi, en)`.
  2. **Đánh giá toàn bộ 20 ca phát triển (`DV-XLSX-001..016`, `DV-DOCX-001..004`):** Chạy qua tuyến façade thật trên máy chủ D cục bộ kết nối cơ sở dữ liệu riêng và thực thi các công cụ trong danh sách cho phép (`docs/office/g5g6g7/genoffice-tools.md` §3) trên các tệp mẫu tổng hợp (`dev-xlsx-revenue-vi.xlsx`, `dev-docx-proposal-vi.docx`).

### Lệnh tái lập kết quả

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
source scripts/office/ai-upstream-spike-env.sh
export AI_MODEL_ALLOW="gpt-6-luna"
export AI_MODEL_OFFICE_UNIWORK_AI="gpt-6-luna"

# Kiểm tra ràng buộc lược đồ, quét bí mật, tách biệt với holdout và kiểm tra danh sách công cụ:
node --test scripts/office/devset.test.mjs scripts/office/instruction-pack-tools.test.mjs

# Chạy bộ dữ liệu phát triển qua tuyến façade + khung giao diện UniWork AI:
node scripts/office/devset-run.mjs \
  --server-url "$UNIWORK_DEVSET_SERVER_URL" \
  --db-url "$UNIWORK_DEVSET_DB_URL" \
  --frame-dir /home/ubuntu/orca/workspaces/uniwork-office/g6-08-panel-run \
  --out /tmp/g6-08-run-v2.json
```

---

## 2. Tổng hợp độ chính xác (Accuracy) và kiểm tra danh sách công cụ (Allowlist)

### 2.1. Tổng quan toàn bộ bộ dữ liệu (20 ca)

| Chỉ số | `office_uniwork_ai@1` | `office_uniwork_ai@2` | Thay đổi |
| --- | ---: | ---: | ---: |
| Tổng số ca | 20 | 20 | — |
| Số ca đạt (`PASS`, `score = 1.0`) | 14 / 20 | **18 / 20** | **+4 ca** |
| Độ chính xác tổng (`Accuracy`) | 70,0% | **90,0%** | **+20,0 điểm %** |
| Độ chính xác tiếng Việt (`vi`) | 7 / 10 (70,0%) | **9 / 10 (90,0%)** | **+20,0 điểm %** |
| Độ chính xác tiếng Anh (`en`) | 7 / 10 (70,0%) | **9 / 10 (90,0%)** | **+20,0 điểm %** |
| Độ chính xác bảng tính (`xlsx`) | 11 / 16 (68,75%) | **14 / 16 (87,50%)** | **+18,75 điểm %** |
| Độ chính xác tài liệu chữ (`docx`) | 3 / 4 (75,0%) | **4 / 4 (100,0%)** | **+25,0 điểm %** |
| Lệnh gọi công cụ ngoài danh sách cho phép (`outsideAllowlistTotal`) | **0** | **0** | Đạt tuyệt đối (0 vi phạm) |

### 2.2. Kiểm chứng giao diện bảng điều khiển (Playwright Panel UI End-to-End)

| Ca đại diện | Phân hệ (`module`) | Ngôn ngữ (`lang`) | Gọi tuyến façade thật | Xác thực `Bearer frame_token` | Số vòng gọi façade | Thời gian đầu-cuối (`@2`, ms) |
| --- | --- | --- | --- | --- | ---: | ---: |
| `DV-DOCX-001` | `docs` (`AiPanel`) | `vi` | Có (`true`) | Có (`true`) | 3 | 54.951,4 |
| `DV-DOCX-002` | `docs` (`AiPanel`) | `en` | Có (`true`) | Có (`true`) | 3 | 9.060,3 |
| `DV-XLSX-001` | `sheets` (`AiChatPanel`) | `vi` | Có (`true`) | Có (`true`) | 3 | 13.284,3 |
| `DV-XLSX-002` | `sheets` (`AiChatPanel`) | `en` | Có (`true`) | Có (`true`) | 3 | 8.033,2 |

---

## 3. Độ trễ phân tách theo 3 thành phần (Latency p50 / p95)

Ba loại độ trễ được đo tách biệt hoàn toàn trên mỗi ca:
- **Mô hình (`model`):** Thời gian chờ phản hồi từ dev upstream (`customlocal`, `~/.codex/config.toml`) qua các vòng gọi của lượt chạy.
- **Công cụ / bộ máy (`tool`):** Thời gian thực thi công cụ đọc/tính toán/sửa tài liệu tại trình thực thi.
- **Đầu-cuối (`endToEnd`):** Tổng thời gian từ lúc gửi yêu cầu đầu tiên của ca đến khi nhận câu trả lời cuối cùng.

| Thành phần độ trễ | `office_uniwork_ai@1` p50 (ms) | `office_uniwork_ai@1` p95 (ms) | `office_uniwork_ai@2` p50 (ms) | `office_uniwork_ai@2` p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| Mô hình (`model`) | 10.633,5 | 25.858,6 | **9.426,8** | **24.229,8** |
| Công cụ / bộ máy (`tool`) | 0,1 | 0,8 | **0,1** | **0,5** |
| Đầu-cuối (`endToEnd`) | 10.634,4 | 25.859,3 | **9.427,2** | **24.230,3** |

---

## 4. Bảng kết quả chi tiết từng ca (`@1` so với `@2`)

| Mã ca | Ngôn ngữ | Định dạng | Nhóm kiểm thử | Công cụ đã gọi (`@2`) | Ngoài allowlist | Điểm `@1` | Kết quả `@1` | Điểm `@2` | Kết quả `@2` | Độ trễ `@2` `model` / `tool` / `e2e` (ms) |
| --- | --- | --- | --- | --- | ---: | ---: | --- | ---: | --- | ---: |
| `DV-XLSX-001` | `vi` | `xlsx` | `whole_range` | `get_workbook_context`, `read_range`, `read_sheet_features`, `aggregate_range` | 0 | 0,8571 | FAIL | **1,0000** | **PASS** | 51.326,7 / 0,5 / 51.328,2 |
| `DV-XLSX-002` | `en` | `xlsx` | `whole_range` | `get_workbook_context`, `read_range`, `read_sheet_features` | 0 | 0,8571 | FAIL | **1,0000** | **PASS** | 16.002,4 / 0,1 / 16.002,9 |
| `DV-XLSX-003` | `vi` | `xlsx` | `sheet_range_types_filters` | `get_workbook_context`, `read_range`, `read_sheet_features` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 12.137,1 / 0,1 / 12.137,5 |
| `DV-XLSX-004` | `en` | `xlsx` | `sheet_range_types_filters` | `get_workbook_context`, `read_range` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 10.278,8 / 0,0 / 10.279,0 |
| `DV-XLSX-005` | `vi` | `xlsx` | `error_cell` | `get_workbook_context`, `read_range` | 0 | 0,8750 | FAIL | 0,8750 | FAIL | 7.645,0 / 0,0 / 7.645,3 |
| `DV-XLSX-006` | `en` | `xlsx` | `error_cell` | `get_workbook_context`, `read_range`, `aggregate_range` | 0 | 0,8750 | FAIL | 0,8750 | FAIL | 9.426,8 / 0,1 / 9.427,2 |
| `DV-XLSX-007` | `vi` | `xlsx` | `stale_cache` | `get_workbook_context`, `read_range` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 8.174,1 / 0,2 / 8.174,6 |
| `DV-XLSX-008` | `en` | `xlsx` | `stale_cache` | `get_workbook_context`, `read_range` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 7.587,8 / 0,0 / 7.588,1 |
| `DV-XLSX-009` | `vi` | `xlsx` | `unsupported_formula` | `get_workbook_context`, `read_cells` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 8.399,1 / 0,0 / 8.399,4 |
| `DV-XLSX-010` | `en` | `xlsx` | `unsupported_formula` | `get_workbook_context`, `read_cells` | 0 | 0,8333 | FAIL | **1,0000** | **PASS** | 4.593,9 / 0,0 / 4.594,2 |
| `DV-XLSX-011` | `vi` | `xlsx` | `locale_rounding` | `get_workbook_context`, `read_range` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 10.525,4 / 0,0 / 10.525,9 |
| `DV-XLSX-012` | `en` | `xlsx` | `locale_rounding` | `get_workbook_context`, `read_range`, `aggregate_range` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 13.169,0 / 0,1 / 13.169,4 |
| `DV-XLSX-013` | `vi` | `xlsx` | `ambiguity` | `get_workbook_context`, `read_range`, `read_range`, `ask_clarification` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 24.032,5 / 0,1 / 24.033,6 |
| `DV-XLSX-014` | `en` | `xlsx` | `ambiguity` | `get_workbook_context`, `read_range`, `read_range`, `ask_clarification` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 13.812,9 / 0,1 / 13.813,4 |
| `DV-XLSX-015` | `vi` | `xlsx` | `whole_range` | `get_workbook_context`, `read_sheet_features`, `read_range` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 12.003,8 / 0,1 / 12.004,2 |
| `DV-XLSX-016` | `en` | `xlsx` | `whole_range` | `get_workbook_context`, `read_range`, `read_sheet_features` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 24.229,8 / 0,1 / 24.230,3 |
| `DV-DOCX-001` | `vi` | `docx` | `docx_selected_paragraph_edit` | `get_document_context`, `replace_selection` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 6.164,5 / 0,4 / 6.165,2 |
| `DV-DOCX-002` | `en` | `docx` | `docx_selected_paragraph_edit` | `get_document_context`, `replace_selection` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 6.814,3 / 0,2 / 6.814,7 |
| `DV-DOCX-003` | `vi` | `docx` | `docx_selected_paragraph_edit` | `replace_selection` | 0 | 0,8571 | FAIL | **1,0000** | **PASS** | 4.156,5 / 1,0 / 4.157,7 |
| `DV-DOCX-004` | `en` | `docx` | `docx_selected_paragraph_edit` | `get_document_context`, `replace_selection` | 0 | 1,0000 | PASS | **1,0000** | **PASS** | 6.010,8 / 0,3 / 6.011,4 |

---

## 5. Nội dung tinh chỉnh từ `office_uniwork_ai@1` sang `office_uniwork_ai@2` và lý do

### 5.1. Tuân thủ trần token của gói chỉ dẫn (A2 Token Caps)

Ở `office_uniwork_ai@1`, phần `common + UntrustedFooter` đang chạm đúng trần `800 / 800` token (0 token dư). Để bổ sung quy tắc ngôn ngữ phản hồi vào `common` mà vẫn giữ chặt trần A2:

1. **Chuyển danh sách ví dụ nhập nhằng đặc thù bảng tính từ `common` sang `sheets`:** Cụm `(which column, range or rows, unit, percent or amount, where to write)` ở Điều 4 của `common` được chuyển xuống mục `Types and locale` của `sheets`, giải phóng 10 token dư cho `common + UntrustedFooter` (`790 / 800`).
2. **Bảng định mức token theo bộ ước lượng chuẩn (`officeEstimate`):**

| Thành phần | `office_uniwork_ai@1` | `office_uniwork_ai@2` | Trần cho phép (G6-D1 A2) |
| --- | ---: | ---: | ---: |
| `common + UntrustedFooter` | 800 | **790** | ≤ 800 |
| `sheets` (`xlsx`) | 1090 | **1190** | ≤ 1200 |
| `docs` (`docx`) | 571 | **595** | ≤ 1200 |
| `slides` (`pptx`) | 236 | **236** | ≤ 1200 |
| `pdf` (`pdf`) | 252 | **252** | ≤ 1200 |
| `markdown` (`md`) | 224 | **224** | ≤ 1200 |
| `html` (`html`) | 164 | **164** | ≤ 1200 |
| Bản ghép lớn nhất (`common + sheets + footer`) | 1890 | **1980** | ≤ 2000 |

### 5.2. Các thay đổi quy tắc trong `@2` và nguyên nhân từ kết quả đo `@1`

1. **Quy tắc ngôn ngữ phản hồi khi tài liệu khác ngôn ngữ với câu hỏi (`common` điều 7 & `sheets` mục `Recalculation` / `Answer shape`):**
   - *Hiện tượng ở `@1`:* Trong `DV-XLSX-010` (`en/xlsx`), câu hỏi bằng tiếng Anh nhưng tên trang tính và dữ liệu ô bằng tiếng Việt khiến mô hình trả lời hoàn toàn bằng tiếng Việt (`"không hỗ trợ"` thay vì `"unsupported"` / `"not supported"`). Hiện tượng tương tự xảy ra ở `DV-XLSX-002` và `DV-XLSX-016`.
   - *Tinh chỉnh ở `@2`:* Nêu rõ trong `common` điều 7 và `sheets` rằng phần diễn giải luôn viết bằng ngôn ngữ của tin nhắn cuối cùng từ người dùng ngay cả khi tài liệu/trang tính ở ngôn ngữ khác (chỉ trích dẫn nguyên văn tên trang tính, tiêu đề cột và nội dung ô). Khi gặp hàm không hỗ trợ (`unsupported function: X`), nêu rõ bằng ngôn ngữ của người dùng rằng hàm đó không được hỗ trợ (`unsupported` / `not supported`).
   - *Kết quả:* `DV-XLSX-010` và `DV-XLSX-002` chuyển từ FAIL sang **PASS (1,0)** và trả lời đúng bằng tiếng Anh.
2. **Quy tắc nêu giá trị số của dòng ẩn / bị lọc (`sheets` mục `Compute with the tools`):**
   - *Hiện tượng ở `@1`:* Trong `DV-XLSX-001` (`vi/xlsx`) và `DV-XLSX-002` (`en/xlsx`), mô hình nêu đúng tổng hiển thị và tổng toàn bộ cùng mã dòng ẩn nhưng bỏ sót giá trị doanh thu ròng riêng của dòng ẩn tạo nên phần chênh lệch.
   - *Tinh chỉnh ở `@2`:* Bổ sung yêu cầu nêu rõ số lượng dòng ẩn/lọc, việc chúng có được tính hay không, và giá trị số của từng dòng ẩn/lọc đó (`each hidden or filtered row's numeric value`).
   - *Kết quả:* Cả `DV-XLSX-001` và `DV-XLSX-002` chuyển từ FAIL (`0,8571`) sang **PASS (`1,0000`)**.
3. **Quy tắc trích dẫn nguyên văn cụm từ trước và sau khi sửa trên tài liệu Word (`docs` mục `Edit`):**
   - *Hiện tượng ở `@1`:* Trong `DV-DOCX-003` (`vi/docx`), mô hình gọi `replace_selection` sửa đúng nội dung đoạn 6 và giữ nguyên mọi đoạn khác, nhưng trong câu tóm tắt cuối lượt lại viết tắt cụm từ mới (`"ba buổi"` thay vì trích dẫn đầy đủ cụm đã thay).
   - *Tinh chỉnh ở `@2`:* Yêu cầu sau khi sửa phải trích dẫn nguyên văn cụm từ trước và sau khi thay đổi mà không viết tắt (`quote the exact before and after phrases verbatim without abbreviating any words`).
   - *Kết quả:* `DV-DOCX-003` chuyển từ FAIL (`0,8571`) sang **PASS (`1,0000`)**, đưa độ chính xác DOCX lên **4 / 4 (100%)**.
4. **Ghi chú về 2 ca còn đạt điểm từng phần (`DV-XLSX-005`, `DV-XLSX-006` — `score = 0,875`):**
   - Cả hai ca đều đọc đúng lỗi `#DIV/0!` và `#N/A`, không thay ô lỗi bằng `0`, và tính đúng trung bình cộng của 5 dòng hợp lệ (`1014`). Dù `@2` đã nhắc nêu thêm tổng số học đi kèm trung bình, khi câu hỏi của người dùng chỉ hỏi giá trị trung bình cộng thì mô hình ưu tiên trả lời ngắn gọn đúng số trung bình và số ô hợp lệ (đạt 7/8 tiêu chí kiểm tra = `0,875`). Không đưa bất kỳ đáp án cụ thể nào của ca kiểm thử vào gói chỉ dẫn.

---

## 6. Tinh chỉnh trần token đầu ra (`MaxTokens` / `OfficeModuleMaxTokens`)

Trong `server/internal/ai/policy.go`, trần cấp capability `policies[CapOfficeUniworkAI].MaxTokens` giữ ở `4096` (mức bao phủ lượt gọi công cụ lớn nhất của toàn bộ Office), đồng thời bổ sung bảng trần đầu ra theo từng phân hệ `OfficeModuleMaxTokens(module)` kèm lý do một dòng cho từng mức:

| Phân hệ / Capability | Trần token đầu ra (`MaxTokens`) | Lý do kỹ thuật (1 dòng) |
| --- | ---: | --- |
| `CapOfficeUniworkAI` (cấp capability) | `4096` | Trần tổng bao phủ lượt gọi công cụ đơn lẻ lớn nhất trong Office (HTML/DOCX); trần chi tiết theo từng phân hệ nằm ở `officeModuleMaxTokens`. |
| `xlsx` (`sheets`) | `2048` | Lệnh gọi công cụ bảng tính (`read_range`, `summarize_range`, `propose_operations`) và câu trả lời số học có phạm vi đều gọn trong 2048 token. |
| `docx` (`docs`) | `3072` | Lệnh sửa nhiều đoạn văn (`replace_blocks` / `apply_ops`) kèm phần trích dẫn nguyên văn cụm từ trước/sau khi sửa nằm gọn trong 3072 token. |
| `pptx` (`slides`) | `2048` | Lệnh viết lại văn bản trong khung hình (`apply_ops`) và bản tóm tắt theo từng trang chiếu nhỏ gọn trong 2048 token. |
| `pdf` (`pdf`) | `2048` | Câu trả lời theo trang, ghi chú và lệnh sửa một khối văn bản trên PDF nằm gọn trong 2048 token. |
| `md` (`markdown`) | `3072` | Lô lệnh `apply_ops` trên nhiều khối Markdown cần bảo toàn nguyên vẹn định dạng nguồn xung quanh trong phạm vi 3072 token. |
| `html` (`html`) | `4096` | Lô lệnh `apply_ops` trên cây phần tử DOM của trang HTML có thể mang nhánh phần tử lớn tới trần 4096 token của capability. |

---

## 7. Kiểm tra rò rỉ thông tin nhạy cảm (Secret Scan)

Trước mỗi commit, toàn bộ phần thay đổi đã staged (`git diff --cached`) và các tệp trong `docs/office/g5g6g7/` được quét bằng biểu thức chính quy kiểm tra địa chỉ IPv4, URL `http(s)://host:port` và tiền tố khóa `sk-...`:
- Kết quả quét: **0 kết quả khớp** (không có địa chỉ IP, host, cổng hay khóa API của upstream trong mã nguồn, bộ dữ liệu phát triển hay báo cáo).
