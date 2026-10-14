# Báo cáo bộ dữ liệu phát triển (Dev Set) và tinh chỉnh gói chỉ dẫn UniWork AI (G6-08)

> **Trạng thái:** Hoàn tất vòng w21 (UNI-1373) — bảng đo lường được tính tự động từ hai tệp run đã commit (`docs/office/g5g6g7/devset/runs/`); `office_uniwork_ai@2` giữ pin, `@1` tái lập được bằng `--server-sha 4df589a37`.

## 1. Thông tin phiên chạy

- **Phiên bản gói chỉ dẫn:**
  - `office_uniwork_ai@1` (baseline) — sha256 pin `610071c053949cca830cacac60883e3491fa131418e377757893b5965d8b1faa`
  - `office_uniwork_ai@2` (đã tinh chỉnh) — sha256 pin `1e47cf912b53dfb5c481f34bce6c27cc0c7e2e310f1ba22088083c8b0a3e5a82`
- **Cách tái lập `@1`:** runner tự dựng server ở commit `4df589a37` (commit cuối trước khi gói `@2` được đăng ký) trong worktree tạm `/tmp/g608-server-<sha>`, chạy migrate của chính commit đó, khởi động server, chạy đo và xoá worktree khi xong — không cần biến môi trường mới và không cần checkout thứ hai.
- **Upstream phát triển:** dev upstream (`customlocal`, `~/.codex/config.toml`) nạp **chỉ qua biến môi trường** theo `docs/office/g5g6g7/dev-upstream.md` (`AI_PROVIDER=openai`, `AI_MODEL_ALLOW=gpt-6-luna`, `AI_MODEL_OFFICE_UNIWORK_AI=gpt-6-luna`). Không host/IP/cổng/khoá nào được ghi vào repo, log hay báo cáo.
- **Mô hình phân giải:** `gpt-6-luna` (giá trị `model` mà upstream trả về, ghi trong từng ca của run JSON).
- **Panel:** worktree detached của `uniwork-office` tại `origin/main`, chỉ đọc — harness dựng mọi liên kết `@genoffice` trong `/tmp/g608-panel-harness` (BE68-12).

## 2. Lệnh tái lập

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
source scripts/office/ai-upstream-spike-env.sh        # đọc customlocal, không in giá trị
export AI_MODEL_ALLOW='gpt-6-luna'
export AI_MODEL_OFFICE_UNIWORK_AI='gpt-6-luna'
# DATABASE_URL trỏ database riêng của phiên; JWT_SECRET/FRONTEND_ORIGIN/PREVIEW_ORIGIN/DESKTOP_AUTH_*
# theo .env.worktree của checkout (không nằm trong repo).

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

# Kiểm định + bảng báo cáo (bảng dưới đây do lệnh này sinh ra):
node --test scripts/office/devset.test.mjs scripts/office/instruction-pack-tools.test.mjs
node scripts/office/devset-report.mjs --check
```

Runner ghi JSON **chỉ khi** không có giá trị giống bí mật (`scanForSecrets`), và (có `--frame-dir`) chỉ khi cả 4 tổ hợp panel đã chạy và gọi tới façade bằng bearer `frame_token`; nếu không, tiến trình thoát khác 0 và không có summary nào được ghi.

## 3. Kết quả đo lường (tính từ `devset/runs/*.json`)

<!-- devset-run-tables:begin -->
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

- Trước mỗi commit: `git diff --cached | grep -E '[0-9]{1,3}(\.[0-9]{1,3}){3}|https?://[^ ]*:[0-9]+|sk-[A-Za-z0-9]'` → **không hit** (log trong `w21-logs/secret-scan-commit-*.log`).
- Runner quét `scanForSecrets` trên JSON kết quả trước khi ghi; `scripts/office/devset.test.mjs` quét lại hai tệp run đã commit → 0 hit. `w21-logs/secret-scan-red-before.log` chứng minh phép quét bắt được IPv4/`host:port`/tiền tố khoá khi cấy thử.

## 8. Giới hạn và phần chưa làm

- Panel harness chạy khung web của fork qua vite trong **cùng một process Playwright**; nó chứng minh panel thật gọi façade bằng `frame_token` và câu trả lời đạt oracle của ca, không thay cho kiểm thử desktop (Electron) hay e2e của app.
- Executor công cụ phía façade vẫn là bản mô phỏng xác định trên fixture (không gọi Calc engine); mọi số của oracle được tính tay lại trong review trước đó và §3 được sinh từ run JSON đã commit.
- `G6-D2` (chọn upstream production) vẫn mở; mọi số ở đây là của dev upstream, không phải tuyên bố về production.
