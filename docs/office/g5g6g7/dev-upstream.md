# UniWork Office G5/G6/G7 — Upstream dev cho UniWork AI

> **Trạng thái:** shipped — ghi chú dev-setup của G6-13 (UNI-1365); cấu hình theo spec §8.4 và contract-p0 §8

**Issue:** UNI-1365 (G6-13), parent UNI-635. **Nguồn:** spec `docs/superpowers/specs/2026-10-02-office-g5-g6-g7-design.md` §8.4,
[contract-p0.md](contract-p0.md) §8, [g6-02-spike-report.md](g6-02-spike-report.md) §2–§3. **Runbook vận hành:**
`docs/ops/RUNBOOK_AI.md` › "UniWork AI upstream".

Tài liệu này chỉ cho **máy dev**: cách trỏ server local tới upstream dev để thử capability `office_uniwork_ai`. Nó chỉ tên
file cấu hình và tên biến, **không bao giờ** ghi host, IP, cổng, URL hay khóa của upstream dev (team-rules, spec §8.4); chỗ
nào cần giá trị thì ghi `<…>`. Upstream production chọn ở gate G6-D2, không nằm ở đây.

## 1. Upstream dev là gì và lấy giá trị ở đâu

Upstream dev là custom provider `customlocal` của Codex trên máy dev, nói giao thức chat OpenAI (coordinator kiểm 2026-10-12:
route chat completions đúng định dạng, `/v1/models` liệt kê model). Mọi giá trị nằm ở một nơi:

| Cần | Lấy từ |
| --- | --- |
| `<base_url from customlocal>` | khóa `base_url` của mục `[model_providers.customlocal]` trong `~/.codex/config.toml` |
| `<key>` | giá trị của **biến môi trường** mà khóa `env_key` của mục đó trỏ tới (config chỉ chứa *tên* biến, không chứa khóa) |
| `<model>` | một tên trong danh sách model của upstream (route `models` dưới base URL) |

Không có giá trị nào trong số này được chép vào repo, issue, report hay tin nhắn; không dán chúng vào `.env.example`,
`.env.worktree` đã commit hay terminal có ghi log.

## 2. Biến môi trường

Chỉ dùng biến server đã đọc (`server/internal/ai/config.go`); G6-13 không thêm biến nào ngoài dòng ví dụ
`# AI_MODEL_OFFICE_UNIWORK_AI=` trong `.env.example`.

| Biến | Giá trị trên máy dev |
| --- | --- |
| `AI_PROVIDER` | `openai` |
| `OPENAI_BASE_URL` | `<base_url from customlocal>` |
| `OPENAI_API_KEY` | `<key>` — giá trị biến mà `env_key` trỏ tới |
| `AI_MODEL_ALLOW` | `<model>` (csv nếu nhiều model; model ngoài allowlist mặc định bị bỏ qua) |
| `AI_MODEL_OFFICE_UNIWORK_AI` | `<model>` — cùng tên với dòng trên; capability `office_uniwork_ai` |

Chọn `<model>` có hậu quả: adapter openai luôn gửi `stream` tường minh, nhưng một số model của upstream dev (spike ghi
`deepseek-4.1`) không trả tool call khi `stream` là false, nên UniWork AI không chạy được vòng tool-result với chúng. Dùng
model mà bản spike đã chạy (§3 của báo cáo spike) hoặc chạy lại wrapper chế độ `dev` (§4 dưới đây) trước khi tin một model mới.

### Đọc giá trị mà không in ra

Cách khuyến nghị là helper có sẵn của spike, đọc `base_url` + `env_key` của `customlocal` và export hai biến mà không in giá
trị nào:

```bash
source scripts/office/ai-upstream-spike-env.sh   # đặt AI_PROVIDER, OPENAI_BASE_URL, OPENAI_API_KEY
export AI_MODEL_ALLOW='<model>'
export AI_MODEL_OFFICE_UNIWORK_AI='<model>'
```

Nếu chỉ cần một đoạn tự chứa (mục `customlocal`, một dòng mỗi khóa), cùng nguyên tắc — đọc vào biến, không `echo`:

```bash
cfg="$HOME/.codex/config.toml"
read_key() { awk -v want="$1" '
  /^[[:space:]]*\[/ { in_s = ($0 ~ /^[[:space:]]*\[model_providers\.customlocal\][[:space:]]*$/); next }
  in_s && $0 ~ "^[[:space:]]*" want "[[:space:]]*=" { v=$0; sub(/^[^=]*=[[:space:]]*/, "", v); gsub(/^"|"[[:space:]]*$/, "", v); print v; exit }
' "$cfg"; }
key_var="$(read_key env_key)"
export AI_PROVIDER=openai
export OPENAI_BASE_URL="$(read_key base_url)"
export OPENAI_API_KEY="${!key_var}"
unset key_var cfg
```

Không bật `set -x` khi chạy đoạn này; không `env`/`printenv` trong terminal được ghi lại. Muốn xem danh sách model, gọi route
`models` dưới `$OPENAI_BASE_URL` với header `Authorization` lấy từ `$OPENAI_API_KEY` (đừng dán kết quả có thân phản hồi dài
vào issue; chỉ tên model cần dùng).

## 3. Cảnh báo

- **Gateway chỉ có một upstream cho cả tiến trình.** `OPENAI_BASE_URL`/`OPENAI_API_KEY` áp cho mọi capability, nên trên máy dev
  Ask UNI và tóm tắt họp cũng đi tới upstream dev khi bạn đặt chúng cho UniWork AI. Upstream riêng theo capability là ADR
  riêng, ngoài v1 (plan, bảng rủi ro). Dùng upstream dev chỉ ở máy dev/staging.
- **Chỉ fixture tổng hợp.** Không gửi dữ liệu thật của tổ chức nào qua upstream dev (spec §8.4, contract-p0 §11).
- **Số `usage` của upstream dev không phải tín hiệu chi phí.** Spike đo upstream này cộng thêm khoảng 2,6k token prompt của
  riêng nó (báo cáo spike §3 ghi chú 2), nên `prompt_tokens` và dòng `ai_usage_events` trên máy dev cao hơn nội dung thật;
  đừng dùng chúng để ước lượng cost/run hay quota. G7-D1 đo lại trên ứng viên production.
- **Unit test, CI và cloud runner luôn `AI_PROVIDER=fake`**, không đặt `OPENAI_BASE_URL`/`OPENAI_API_KEY` (contract-p0 §8).
  Test không bao giờ đọc `~/.codex/config.toml`; đừng export biến upstream dev trước khi chạy test (team-rules: unset
  `OPENAI_API_KEY` của host cho test).
- Giá trị upstream không bao giờ nằm trong commit, `.env.example` hay báo cáo; gitleaks của CI quét điều đó.

## 4. Kiểm tra cấu hình chạy được

Dùng wrapper của spike; nó ghi kết quả ra thư mục báo cáo của lane và **không in URL, host, IP, cổng hay khóa** (harness che
mọi chuỗi ghi ra):

```bash
# không mạng: kiểm vòng tool call → tool-result → trả lời bằng provider fake
bash scripts/office/ai-upstream-spike.sh fake

# upstream dev: cần OPENAI_BASE_URL, OPENAI_API_KEY và model (SPIKE_MODEL hoặc AI_MODEL_OFFICE_UNIWORK_AI)
source scripts/office/ai-upstream-spike-env.sh
SPIKE_MODEL='<model>' bash scripts/office/ai-upstream-spike.sh dev
```

Chế độ `dev` từ chối chạy khi thiếu một trong ba giá trị và báo *tên* biến thiếu. Kết quả đạt: exit 0, id tool call đi hai
chiều ở mọi vòng, `usage` có mặt. Sau đó khởi động server local và gọi `GET …/ai/capabilities`: `enabled: true` nghĩa là
Gateway đã nhận provider. Nếu `enabled: false`, thiếu `AI_PROVIDER` hoặc key; nếu UniWork AI vẫn không có model, kiểm
`AI_MODEL_ALLOW` chứa `<model>` (RUNBOOK_AI › "UniWork AI upstream").

## 5. Quay về fake

Xóa cấu hình upstream khỏi shell/`.env.worktree` của bạn rồi restart server:

```bash
unset OPENAI_BASE_URL OPENAI_API_KEY AI_MODEL_ALLOW AI_MODEL_OFFICE_UNIWORK_AI
export AI_PROVIDER=fake
```

`AI_PROVIDER=fake` trả lời xác định, không ra mạng, và không bao giờ báo `ai_uniwork` bật cho tổ chức nào (contract-p0 §8,
spec §12.3). Muốn tắt hẳn Gateway: bỏ `AI_PROVIDER` và mọi key rồi restart — `capabilities.enabled=false`, client ẩn nút.
