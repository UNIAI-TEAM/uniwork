# Báo cáo bộ dữ liệu phát triển (Dev Set) và tinh chỉnh gói chỉ dẫn UniWork AI (G6-08)

> **Trạng thái:** Hoàn tất vòng w22 (UNI-1373) — bảng đo lường được tính tự động từ hai tệp run đã commit (`docs/office/g5g6g7/devset/runs/`) sau khi chấm lại ngoại tuyến bằng bộ trích xuất vùng kết quả dương tính (`extractConclusionPart`, BE68-G2-1); `office_uniwork_ai@2` giữ pin, `@1` tái lập được bằng `--server-sha 4df589a37`.

## 1. Thông tin phiên chạy

- **Phiên bản gói chỉ dẫn:**
  - `office_uniwork_ai@1` (baseline) — sha256 pin `610071c053949cca830cacac60883e3491fa131418e377757893b5965d8b1faa`
  - `office_uniwork_ai@2` (đã tinh chỉnh) — sha256 pin `1e47cf912b53dfb5c481f34bce6c27cc0c7e2e310f1ba22088083c8b0a3e5a82`
- **Cách tái lập `@1`:** runner tự dựng server ở commit `4df589a37` (commit cuối trước khi gói `@2` được đăng ký) trong worktree tạm `/tmp/g608-server-<sha>`, chạy migrate của chính commit đó, khởi động server, chạy đo và xoá worktree khi xong — không cần biến môi trường mới và không cần checkout thứ hai.
- **Upstream phát triển:** dev upstream (`customlocal`, `~/.codex/config.toml`) nạp **chỉ qua biến môi trường** theo `docs/office/g5g6g7/dev-upstream.md` (`AI_PROVIDER=openai`, `AI_MODEL_ALLOW=gpt-6-luna`, `AI_MODEL_OFFICE_UNIWORK_AI=gpt-6-luna`). Không host/IP/cổng/khoá nào được ghi vào repo, log hay báo cáo.
- **Mô hình phân giải:** `gpt-6-luna` (giá trị `model` mà upstream trả về, ghi trong từng ca của run JSON).
- **Panel:** worktree detached của `uniwork-office` tại `origin/main`, chỉ đọc — `setupPanelHarnessLinks` dựng mọi liên kết `@genoffice` trong `/tmp/g608-panel-harness` và `assertPanelHarnessFilesystem` khẳng định trực tiếp trên hệ thống tệp rằng mọi liên kết nằm trong thư mục harness còn `<fork>/node_modules/@genoffice` không thay đổi (BE68-12, BE68-G2-5).

## 2. Lệnh tái lập

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
source scripts/office/ai-upstream-spike-env.sh        # đọc customlocal, không in giá trị
export AI_MODEL_ALLOW='gpt-6-luna'
export AI_MODEL_OFFICE_UNIWORK_AI='gpt-6-luna'
# Các biến từ .env.worktree của checkout (DATABASE_URL trỏ database riêng của phiên,
# JWT_SECRET, FRONTEND_ORIGIN, PREVIEW_ORIGIN, PREVIEW_CAPABILITY_SECRET,
# STORAGE_BACKEND=local, LOCAL_UPLOAD_DIR, LOCAL_UPLOAD_BASE_URL, REDIS_URL).
# Các biến bắt buộc bổ sung mà mẫu scripts/init-worktree-env.sh chưa sinh sẵn (BE68-G2-2,
# xem .env.example; tuyệt đối không ghi giá trị khóa vào repo):
#   - AI_CONVERSATION_KEY: khóa AES 32 byte mã hóa base64 dùng niêm phong kho lưu hội thoại
#     UniWork AI; nếu thiếu biến này, route façade đóng an toàn và trả 503 ai_disabled.
#   - DESKTOP_AUTH_CLIENT_ID, DESKTOP_AUTH_REDIRECT_URIS, DESKTOP_AUTH_DEPLOYMENT_IDS:
#     nhóm cấu hình desktop auth mà server kiểm tra khi khởi động (theo .env.example).

# @2 — server ở commit hiện hành (đã commit):
node scripts/office/devset-run.mjs --server-sha <commit-@2> \
  --db-url "$DATABASE_URL" \
  --frame-dir /home/ubuntu/orca/workspaces/uniwork-office/g6-08-panel-run \
  --out docs/office/g5g6g7/devset/runs/run-v2-<commit-@2>.json

# @1 — server dựng từ 4df589a37 trong worktree tạm (tự xoá):
node scripts/office/devset-run.mjs --server-sha 4df589a37 \
  --db-url "$DATABASE_URL" \
  --frame-dir /home/ubuntu/orca/workspaces/uniwork-office/g6-08-panel-run \
  --out docs/office/g5g6g7/devset/runs/run-v1-4df589a37.json

# Chấm lại ngoại tuyến (nếu cập nhật scorer), kiểm định + bảng báo cáo:
node scripts/office/devset-report.mjs --rescore
node scripts/office/devset-report.mjs --write
node --test scripts/office/devset.test.mjs scripts/office/instruction-pack-tools.test.mjs
node scripts/office/devset-report.mjs --check
```

Runner ghi JSON **chỉ khi** không có giá trị giống bí mật (`scanForSecrets`), và (có `--frame-dir`) chỉ khi cả 4 tổ hợp panel đã chạy và gọi tới façade bằng bearer `frame_token`; nếu không, tiến trình thoát khác 0 và không có summary nào được ghi.

## 3. Kết quả đo lường (tính từ `devset/runs/*.json`)

<!-- devset-run-tables:begin -->
- **@1**: `office_uniwork_ai@1` dựng từ server ở commit `4df589a37`, mô hình phân giải `gpt-6-luna`, ngày `2026-10-14` (tệp `run-v1-4df589a37.json`).
- **@2**: `office_uniwork_ai@2` dựng từ server ở commit `9a6aadeb2`, mô hình phân giải `gpt-6-luna`, ngày `2026-10-14` (tệp `run-v2-9a6aadeb2.json`).

### Độ chính xác

| Chỉ số | `@1` | `@2` | Thay đổi |
| --- | ---: | ---: | ---: |
| Số ca đạt / tổng | 14 / 20 | **15 / 20** | +1 ca |
| Độ chính xác tổng | 70,0% | **75,0%** | +5 điểm % |
| Tiếng Việt (`vi`) | 6 / 10 (60,0%) | **7 / 10 (70,0%)** | +10 điểm % |
| Tiếng Anh (`en`) | 8 / 10 (80,0%) | **8 / 10 (80,0%)** | — điểm % |
| Bảng tính (`xlsx`) | 11 / 16 (68,8%) | **11 / 16 (68,8%)** | — điểm % |
| Tài liệu chữ (`docx`) | 3 / 4 (75,0%) | **4 / 4 (100,0%)** | +25 điểm % |
| Lệnh gọi ngoài allowlist | 0 | **0** | — |

### Độ trễ (p50 / p95, ms)

| Thành phần | `@1` p50 | `@1` p95 | `@2` p50 | `@2` p95 |
| --- | ---: | ---: | ---: | ---: |
| model | 10.169,6 | 18.331 | **8.710,2** | **13.599,4** |
| tool | 0,1 | 0,5 | **0,1** | **0,4** |
| endToEnd | 10.169,9 | 18.331,6 | **8.710,8** | **13.600** |

### Từng ca

| Mã ca | Ngôn ngữ | Định dạng | Nhóm | Công cụ đã gọi (`@2`) | Ngoài allowlist | Điểm `@1` | `@1` | Điểm `@2` | `@2` | Độ trễ `@2` model / tool / e2e (ms) |
| --- | --- | --- | --- | --- | ---: | ---: | --- | ---: | --- | ---: |
| `DV-XLSX-001` | `vi` | `xlsx` | `whole_range` | `get_workbook_context`, `read_range` | 0 | 1 | PASS | 1 | PASS | 12.571,9 / 0,4 / 12.572,8 |
| `DV-XLSX-002` | `en` | `xlsx` | `whole_range` | `get_workbook_context`, `read_range` | 0 | 1 | PASS | 1 | PASS | 13.900,7 / 0 / 13.901,1 |
| `DV-XLSX-003` | `vi` | `xlsx` | `sheet_range_types_filters` | `get_workbook_context`, `read_range` | 0 | 0,9 | FAIL | 0,9 | FAIL | 8.403,1 / 0 / 8.403,4 |
| `DV-XLSX-004` | `en` | `xlsx` | `sheet_range_types_filters` | `get_workbook_context`, `read_range` | 0 | 1 | PASS | 1 | PASS | 12.624 / 0 / 12.624,4 |
| `DV-XLSX-005` | `vi` | `xlsx` | `error_cell` | `get_workbook_context`, `read_range`, `aggregate_range` | 0 | 0,9 | FAIL | 0,9 | FAIL | 8.710,2 / 0,1 / 8.710,8 |
| `DV-XLSX-006` | `en` | `xlsx` | `error_cell` | `get_workbook_context`, `read_range` | 0 | 0,9 | FAIL | 0,9 | FAIL | 6.984,8 / 0 / 6.985,1 |
| `DV-XLSX-007` | `vi` | `xlsx` | `stale_cache` | `get_workbook_context`, `read_range` | 0 | 0,9 | FAIL | 0,9 | FAIL | 10.805,6 / 0 / 10.805,9 |
| `DV-XLSX-008` | `en` | `xlsx` | `stale_cache` | `get_workbook_context`, `read_range` | 0 | 0,9 | FAIL | 0,9 | FAIL | 7.484 / 0 / 7.484,4 |
| `DV-XLSX-009` | `vi` | `xlsx` | `unsupported_formula` | `get_workbook_context`, `read_cells` | 0 | 1 | PASS | 1 | PASS | 4.844,1 / 0,1 / 4.844,4 |
| `DV-XLSX-010` | `en` | `xlsx` | `unsupported_formula` | `get_workbook_context`, `read_cells` | 0 | 1 | PASS | 1 | PASS | 7.280,7 / 0 / 7.280,9 |
| `DV-XLSX-011` | `vi` | `xlsx` | `locale_rounding` | `get_workbook_context`, `read_range` | 0 | 1 | PASS | 1 | PASS | 10.005 / 0 / 10.005,3 |
| `DV-XLSX-012` | `en` | `xlsx` | `locale_rounding` | `get_workbook_context`, `read_range`, `aggregate_range` | 0 | 1 | PASS | 1 | PASS | 13.328 / 0,1 / 13.328,4 |
| `DV-XLSX-013` | `vi` | `xlsx` | `ambiguity` | `get_workbook_context`, `read_range`, `read_range`, `ask_clarification` | 0 | 1 | PASS | 1 | PASS | 13.599,4 / 0,1 / 13.600 |
| `DV-XLSX-014` | `en` | `xlsx` | `ambiguity` | `get_workbook_context`, `read_range`, `read_range`, `ask_clarification` | 0 | 1 | PASS | 1 | PASS | 12.278,9 / 0,1 / 12.279,4 |
| `DV-XLSX-015` | `vi` | `xlsx` | `whole_range` | `get_workbook_context`, `read_sheet_features`, `read_range`, `summarize_range` | 0 | 1 | PASS | 1 | PASS | 12.767,4 / 0,1 / 12.768 |
| `DV-XLSX-016` | `en` | `xlsx` | `whole_range` | `get_workbook_context`, `read_range`, `read_sheet_features` | 0 | 1 | PASS | 1 | PASS | 12.210,3 / 0,1 / 12.210,8 |
| `DV-DOCX-001` | `vi` | `docx` | `docx_selected_paragraph_edit` | `get_document_context`, `replace_selection` | 0 | 1 | PASS | 1 | PASS | 6.191,5 / 0,4 / 6.192,1 |
| `DV-DOCX-002` | `en` | `docx` | `docx_selected_paragraph_edit` | `get_document_context`, `replace_selection` | 0 | 1 | PASS | 1 | PASS | 4.485,6 / 0,2 / 4.486,1 |
| `DV-DOCX-003` | `vi` | `docx` | `docx_selected_paragraph_edit` | `get_document_context`, `replace_selection` | 0 | 0,9 | FAIL | 1 | PASS | 4.624,8 / 0,8 / 4.625,8 |
| `DV-DOCX-004` | `en` | `docx` | `docx_selected_paragraph_edit` | `get_document_context`, `replace_selection` | 0 | 1 | PASS | 1 | PASS | 5.972 / 0,1 / 5.972,3 |

### Chạy qua giao diện bảng điều khiển (Playwright, prompt của chính ca)

| Ca | Phân hệ | Ngôn ngữ | Số vòng gọi façade | Bearer `frame_token` | Công cụ đã gọi | Điểm | Kết quả | Đầu-cuối (ms) |
| --- | --- | --- | ---: | --- | --- | ---: | --- | ---: |
| `DV-DOCX-001` | `docs` | `vi` | 2 | Có | `replace_selection` | 1 | PASS | 15.722,3 |
| `DV-DOCX-002` | `docs` | `en` | 3 | Có | `get_document_context`, `replace_selection` | 1 | PASS | 11.185 |
| `DV-XLSX-001` | `sheets` | `vi` | 5 | Có | `get_workbook_context`, `read_range`, `read_sheet_features`, `find_cells` | 1 | PASS | 71.853,2 |
| `DV-XLSX-002` | `sheets` | `en` | 2 | Có | `get_workbook_context` | 0,4 | FAIL | 57.912,3 |
<!-- devset-run-tables:end -->

## 4. Kiểm chứng giao diện bảng điều khiển

Mỗi tổ hợp (docs/sheets × vi/en) gõ **prompt của chính ca** (`DV-DOCX-001/002`, `DV-XLSX-001/002`) vào panel thật của fork (Playwright headless), rồi chấm câu trả lời bằng `scoreDevCase` — cùng oracle với đường façade. Bảng ở §3 (mục "Chạy qua giao diện bảng điều khiển") liệt kê số vòng gọi façade, việc mang bearer `frame_token`, công cụ đã gọi, điểm và kết quả của từng tổ hợp; runner fail (không ghi summary) nếu thiếu tổ hợp.

## 5. Nội dung tinh chỉnh `@1` → `@2` và lý do

### 5.1. Trần token của gói chỉ dẫn (A2 caps, không đổi ở vòng này)

| Thành phần | `@1` | `@2` | Trần |
| --- | ---: | ---: | ---: |
| `common + UntrustedFooter` | 800 | **790** | ≤ 800 |
| `sheets` (`xlsx`) | 1090 | **1190** | ≤ 1200 |
| `docs` (`docx`) | 571 | **595** | ≤ 1200 |
| `slides` / `pdf` / `markdown` / `html` | 236 / 252 / 224 / 164 | 236 / 252 / 224 / 164 | ≤ 1200 |
| Bản ghép lớn nhất | 1890 (`xlsx`) | **1980** (`xlsx`) | ≤ 2000 |

`TestOfficePackTokenCaps` đo **cả hai** phiên bản (BE68-8); digest của mỗi phiên bản được pin riêng nên một sửa chữ vào `@1` không thể "đi nhờ" golden mới.

### 5.2. Thay đổi quy tắc trong `@2`

1. Quy tắc ngôn ngữ trả lời (common điều 7 + `sheets` mục `Recalculation`/`Answer shape`): luôn viết phần diễn giải bằng ngôn ngữ của tin nhắn cuối của người dùng, kể cả khi tài liệu tiếng Việt; hàm không hỗ trợ phải nói rõ bằng ngôn ngữ người dùng.
2. `sheets` mục `Compute with the tools`: nêu số lượng dòng ẩn/bị lọc, có tính hay không, **và giá trị số của từng dòng ẩn/bị lọc**; khi báo trung bình thì nêu kèm tổng số học và số ô hợp lệ.
3. `docs` mục `Edit`: sau khi sửa phải trích dẫn nguyên văn cụm trước/sau, không viết tắt.

### 5.3. Trần token đầu ra (`MaxTokens`)

| Phạm vi | Trần | Lý do một dòng |
| --- | ---: | --- |
| `CapOfficeUniworkAI` (capability) | 4096 | Trần bao phủ lượt gọi công cụ đơn lẻ lớn nhất (HTML) và là mức dự phòng khi prompt không theo phân hệ; là **trần trần**, không phải mức gửi cho mọi lượt. |
| `xlsx` | 2048 | Lệnh gọi `read_range`/`summarize_range`/`propose_operations` và câu trả lời số học có phạm vi nằm gọn trong 2048 token. |
| `docx` | 3072 | Lô `replace_blocks`/`apply_ops` nhiều đoạn kèm phần trích dẫn trước/sau nằm trong 3072. |
| `pptx` | 2048 | Viết lại văn bản trong shape (`apply_ops`) + tóm tắt theo slide rất gọn. |
| `pdf` | 2048 | Trả lời theo trang, ghi chú và sửa một khối văn bản. |
| `md` | 3072 | Lô `apply_ops` nhiều khối phải giữ nguyên văn phần xung quanh. |
| `html` | 4096 | Lô `apply_ops` trên cây DOM có thể mang nhánh phần tử lớn, giữ nguyên trần capability. |

Các giá trị này **bị hạ** so với trần capability 4096 (trừ `html`). Từ vòng này chúng **có hiệu lực thật**: `Gateway.Complete` gọi `officeMaxTokens(req, policy)` → `OfficeModuleMaxTokens(req.Module)` cho `CapOfficeUniworkAI` (BE68-1), và `TestGatewayOfficeModuleMaxTokens` khẳng định `MaxTokens` gửi cho provider theo từng module (xlsx → 2048, html → 4096; module rỗng/không tên trên prompt có phân hệ bị từ chối trước khi tới provider, prompt không phân hệ giữ 4096; capability khác không đổi).

## 6. Danh sách công cụ (allowlist) và tính tách biệt holdout

- `outsideAllowlistTotal = 0` ở cả hai lượt (cột "Ngoài allowlist" của bảng §3). Một lệnh gọi ngoài allowlist làm ca đó FAIL, và `summarizeRunResults` cộng dồn thành `outsideAllowlistTotal`.
- Dev set chỉ dùng fixture tổng hợp của chính nó (`dev-xlsx-orders-xyz.xlsx`, `dev-docx-proposal-vi.docx`). `scripts/office/devset.test.mjs` chuẩn hoá mọi prompt trong `cases.json` và so với mọi prompt trong `docs/office/g5g6g7/holdout/cases/*` (đọc bằng chương trình, không mở tay) — vòng này vẫn 0 trùng; guard đã được review kiểm bằng cách cấy prompt holdout vào một ca.

## 7. Kiểm tra rò rỉ thông tin nhạy cảm

- Trước mỗi commit: `git diff --cached | grep -E '[0-9]{1,3}(\.[0-9]{1,3}){3}|https?://[^ ]*:[0-9]+|sk-[A-Za-z0-9]'` → **không hit** (log trong `w21-logs/secret-scan-commit-*.log` và `w22-logs/secret-scan-commit-*.log`).
- Runner quét `scanForSecrets` trên JSON kết quả trước khi ghi; `scripts/office/devset.test.mjs` quét lại hai tệp run đã commit → 0 hit. `w21-logs/secret-scan-red-before.log` chứng minh phép quét bắt được IPv4/`host:port`/tiền tố khoá khi cấy thử.

## 8. Giới hạn và phần chưa làm

- Panel harness chạy khung web của fork qua vite trong **cùng một process Playwright**; nó khẳng định cả 4 tổ hợp (`docs`/`sheets` × `vi`/`en`) đã chạy và gọi tới façade bằng bearer `frame_token`, còn câu trả lời được chấm bằng `scoreDevCase` và ghi vào bảng §3 (`3/4` đạt ở cả hai lượt `@1` và `@2`, trong đó `DV-XLSX-002` FAIL `0,8571` ở `@1` và `0,4` ở `@2` — BE68-G2-4), không thay cho kiểm thử desktop (Electron) hay e2e của app.
- **Chấm lại ngoại tuyến (BE68-G2-1) và phần cắt ngắn 400 ký tự (`answerExcerpt`):** Khi `extractConclusionPart` chuyển sang chọn dương tính vùng kết quả (toàn bộ văn bản trước nhãn phạm vi đầu tiên `"Phạm vi:"`/`"Scope:"`/`"Ghi chú:"`/`"Note:"`, hoặc toàn bộ văn bản nếu không có nhãn) và bỏ bộ lọc từ rào đón (`cache`, `#DIV/0!`), lệnh `node scripts/office/devset-report.mjs --rescore` chấm lại hai tệp `run-v1-4df589a37.json` và `run-v2-9a6aadeb2.json` từ `answerExcerpt`:
  - Bốn ca thay đổi kết quả: `DV-XLSX-007` và `DV-XLSX-008` ở cả `@1` lẫn `@2` chuyển từ `PASS (1,0)` sang `FAIL (0,8667 — trượt forbid_token:99999 và forbid_token:88888)` vì câu trả lời đặt phần giải thích các số cache cũ `99999`/`88888` ngay trong vùng kết quả trước nhãn `Phạm vi:`/`Scope:`. Tổng số ca đạt đổi từ `16/20 (80,0%)` → `14/20 (70,0%)` ở `@1` và từ `17/20 (85,0%)` → `15/20 (75,0%)` ở `@2` (chênh lệch `@1` → `@2` giữ nguyên `+1 ca` / `+5,0 điểm %`).
  - Tồn đọng do `answerExcerpt` cắt ở 400 ký tự (không suy đoán phần bị cắt): ở `DV-XLSX-008` (`@2`) nhãn `Scope:` nằm ở ký tự 313 nên toàn bộ vùng kết quả trước `Scope:` còn nguyên vẹn; ở `DV-XLSX-007` (`@1`, `@2`) và `DV-XLSX-008` (`@1`), `answerExcerpt` dài 400 ký tự và bị cắt trước nhãn phạm vi (tuy nhiên 400 ký tự đầu của vùng kết quả đã chứa `99999` và `88888` nên `passed = false` đã xác định chắc chắn; phần đuôi sau ký tự 400 không lưu trong JSON nên không kiểm tra thêm được các token cấm khác như `d2 = 99999`/`d3 = 88888`). Mười ca không có `mustNotContainTokens` (`DV-XLSX-001..004`, `DV-XLSX-011..016`) cũng có `answerExcerpt` cắt ở 400 ký tự nhưng không chịu ảnh hưởng của `extractConclusionPart`.
- Executor công cụ phía façade vẫn là bản mô phỏng xác định trên fixture (không gọi Calc engine); mọi số của oracle được tính tay lại trong review trước đó và §3 được sinh từ run JSON đã commit.
- `G6-D2` (chọn upstream production) vẫn mở; mọi số ở đây là của dev upstream, không phải tuyên bố về production.
