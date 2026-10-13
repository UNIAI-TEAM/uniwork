# Runbook — AI Gateway và Ask UNI

> **Trạng thái:** shipped · **Cập nhật:** 2026-09-06 · **Thành phần:** `ai.Gateway` trong tiến trình API (`server/internal/ai`) · **Liên quan:** ADR 0010, spec `2026-09-04-ai-platform-gateway-design.md`, UNI-428

Mọi lượt gọi LLM (tóm tắt họp, Ask UNI) đi qua một gateway: policy chọn model
theo capability → kiểm quota `ai.tokens` của tổ chức → ghi dòng
`ai_usage_events` trạng thái `pending` → gọi provider → kiểm tool → cập nhật
dòng với token, giá (`ai_model_rates`) và trạng thái → cộng meter entitlement
→ phát `ai.usage.updated`. Không có hàng đợi, không có worker nền: gateway
chạy trong request.

## Cấu hình

| Biến | Ý nghĩa |
| --- | --- |
| `AI_PROVIDER` | `anthropic` / `openai` / `ollama` / `fake`. Rỗng = suy từ key có sẵn (Anthropic trước). Không có gì = tắt: `capabilities.enabled=false`, client ẩn nút, không lỗi 500 |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Anthropic; `ANTHROPIC_MODEL` là override kiểu cũ, phải nằm trong allowlist |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | OpenAI-compatible (OpenAI, **OpenRouter** `https://openrouter.ai/api/v1`, Gemini OpenAI-compat, vLLM…) |
| `OLLAMA_BASE_URL` | Ollama local/on-prem, không cần key |
| `AI_MODEL_<CAPABILITY>` | Override model cho một capability (`AI_MODEL_COPILOT_ANSWER=claude-sonnet-5`); ngoài allowlist → dùng mặc định + log warn |
| `AI_MODEL_ALLOW` | Mở rộng allowlist (csv) cho model self-host |
| `AI_TIMEOUT_SECONDS` | Mặc định 60 |

`AI_PROVIDER=fake` cho dev và E2E: trả lời deterministic, cite mọi nguồn, không
ra mạng.

### OpenRouter (thay OpenAI trực tiếp)

1. Secret: `OPENAI_API_KEY=sk-or-v1-…` (rotate nếu key từng lộ).
2. ConfigMap `uniwork-be.env`: `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`.
3. Model: slug dạng `openai/gpt-4o-mini` — khai báo trong `AI_MODEL_ALLOW` và
   `AI_MODEL_<CAPABILITY>` (Email Hub dùng `AI_MODEL_EMAIL_THREAD_SUMMARY`).
4. Restart `uniwork-be`; kiểm `GET …/ai/capabilities` → `enabled: true`.

## Số cần nhìn

| Metric | Ý nghĩa | Ngưỡng |
| --- | --- | --- |
| `uniwork_ai_calls_total{capability,status}` | Lượt gọi theo trạng thái cuối (`succeeded`, `failed`, `rejected`) | `failed` > 5 % trong 10 phút = provider hoặc key hỏng; `rejected` tăng = tổ chức chạm quota, không phải lỗi |
| `uniwork_ai_latency_ms{capability}` | Vòng đi provider | p95 > 20 s = đổi model tier hoặc provider |
| `ai_usage_events` `status='pending'` quá 5 phút | Tiến trình chết giữa lượt gọi | Có = điều tra; dòng này không tính tiền (cost 0) |

## Khi có sự cố

- **Mọi lượt đều `ai_provider_error`**: kiểm key/BASE_URL, log `ai: provider error`
  (chỉ có `usage_event_id`, capability, latency và message của provider — không
  có nội dung). Tắt tính năng tạm thời bằng cách bỏ key và restart: client tự ẩn.
- **`ai_quota_exceeded` với tổ chức chưa dùng nhiều**: xem `usage_counters` meter
  `ai.tokens` và `plan_features.quota_limit` (mặc định 500k, migration 099).
- **`ai_rate_limited` hàng loạt**: Redis lỗi → Ask UNI fail-closed theo G5 (chỉ
  Ask UNI; tóm tắt họp không có rate limit riêng). Khôi phục Redis.
- **Chi phí sai**: không sửa dòng đã ghi. Thêm dòng `ai_model_rates` mới với
  `effective_at` mới; dòng cũ giữ `rate_id` cũ.
- **Model mới**: thêm vào `allowedModels` (`policy.go`) và seed rate; không
  đọc tên model từ DB hay từ người dùng.

## UniWork AI upstream

`office_uniwork_ai` là capability của trợ lý UniWork AI trong editor Office (G6-13, UNI-1365; façade ở G6-03a). Nó đi qua
cùng một Gateway như Ask UNI nên **dùng chung provider/upstream của tiến trình**: đặt `OPENAI_*` cho UniWork AI cũng đổi
upstream của Ask UNI và tóm tắt họp trên deployment đó. Upstream riêng theo capability là ADR riêng, ngoài v1.

| Biến | Vai trò với `office_uniwork_ai` |
| --- | --- |
| `AI_PROVIDER`, `OPENAI_BASE_URL`, `OPENAI_API_KEY` | Chọn upstream (chung mọi capability); `anthropic` và `openai` hỗ trợ vòng tool-result, `fake` cho dev/CI |
| `AI_MODEL_OFFICE_UNIWORK_AI` | Chọn model riêng cho capability này (override có sẵn `AI_MODEL_<CAPABILITY>`) |
| `AI_MODEL_ALLOW` | Phải chứa model self-host/ngoài danh sách có sẵn thì override mới được nhận |

Triệu chứng và kiểm tra:

- **UniWork AI tắt / `capabilities.enabled=false`** (`ai_disabled` 503 từ route): Gateway chưa có provider. Kiểm `AI_PROVIDER`
  và key/`OPENAI_BASE_URL` của provider đã chọn, restart `uniwork-be`. `AI_PROVIDER=fake` chạy được nhưng không bao giờ báo
  UniWork AI bật cho tổ chức nào.
- **Model không như đã đặt**: `AI_MODEL_OFFICE_UNIWORK_AI` ngoài allowlist → Gateway dùng model mặc định của provider và
  ghi log cảnh báo (cùng cơ chế mục "Cấu hình"). Thêm model vào `AI_MODEL_ALLOW`, restart, kiểm lại log không còn cảnh báo.
- **`AI_PROVIDER=ollama`**: capability này từ chối rõ vì ollama chưa hỗ trợ vòng tool-result (không có model mặc định cho
  ollama); UniWork AI không bật trên deployment đó. Dùng `openai` hoặc `anthropic`.
- **Lỗi `ai_provider_error` ở lượt có công cụ**: upstream từ chối tool call/`tool_call_id` hoặc không trả tool call (một
  số model self-host không trả tool call khi `stream` là false) — đổi model, chạy lại wrapper spike (xem dưới).
- **Token/credit dev trông cao**: upstream dev cộng overhead prompt riêng; số `usage` của nó không phải tín hiệu chi phí.

Dev local: cấu hình upstream dev, cách kiểm và cách quay về `fake` ở `docs/office/g5g6g7/dev-upstream.md`; wrapper
`scripts/office/ai-upstream-spike.sh fake|dev` kiểm vòng tool-result mà không in giá trị. Production: upstream, region và
retention **chưa chọn** — chờ gate G6-D2; tới đó chỉ fixture tổng hợp chạy trên upstream dev. Không ghi base URL, host, IP
hay khóa của upstream dev ở đâu ngoài secret store/cấu hình máy dev.

## UniWork AI transcript (G6-03a, design §9)

Trợ lý UniWork AI trong editor Office giữ hội thoại **trên server**: client chỉ gửi câu hỏi mới hoặc tool-result, không
bao giờ gửi lịch sử (luật bảo mật 7). Hai bảng `ai_uniwork_conversations` / `ai_uniwork_turns`; mỗi lượt là JSON của
`provider.Message` (nội dung + tool call + tool-result) được mã hóa `server/internal/util/secretbox` (AES-256-GCM)
bằng khóa riêng `AI_CONVERSATION_KEY` — không dùng chung `AI_CREDENTIAL_KEY` để lộ một khóa không lộ cả hai.

| Mục | Giá trị |
| --- | --- |
| TTL nhàn rỗi | 30 phút kể từ `last_used_at` |
| Hạn tuyệt đối | 24 giờ kể từ `created_at` |
| Lượt giữ | 20 lượt người dùng; lượt 21 bỏ khối cũ nhất nguyên khối (không để tool-result mồ côi) |
| Hết hạn / đã dọn | 409 `conversation_expired`; client mở hội thoại mới |
| Dọn | worker TTL trong tiến trình API (mỗi phút: hết hạn, rồi tổ chức đã tắt `office_ai_uniwork`) + consumer outbox `document.deleted`, `member.removed`, `member.left`, `member.deactivated` (lane slow); `Create` xóa hội thoại cũ cùng (organization, user, document, module) trong một transaction |
| Mã hóa | `ciphertext` (BYTEA) là bản mã; server không có nhánh nào ghi plaintext |

Số cần nhìn:

| Metric | Ý nghĩa | Ngưỡng |
| --- | --- | --- |
| `uniwork_ai_uniwork_conversations_swept_total{reason="expired"}` | Hội thoại hết TTL đã xóa | tăng đều là bình thường (TTL nhàn rỗi 30 phút) |
| `uniwork_ai_uniwork_conversations_swept_total{reason="kill_switch"}` | Hội thoại bị xóa vì `office_ai_uniwork` tắt cho tổ chức | phải xuất hiện ngay sau khi tắt cờ cho một tổ chức |
| `uniwork_ai_uniwork_conversations_live` | Hội thoại còn sống | |

Khi có sự cố:

- **Mọi lượt trả `conversation_expired`**: quá TTL nhàn rỗi (kể cả giữa một run dài) hoặc hạn tuyệt đối, hoặc
  `AI_CONVERSATION_KEY` vừa bị đổi — transcript cũ không giải mã được nên bị coi là hết hạn (không có xoay khóa ở v1;
  TTL 30 phút giới hạn thiệt hại).
- **Route UniWork AI trả 503 `ai_disabled` dù Gateway bật**: thiếu `AI_CONVERSATION_KEY` (hoặc chuỗi base64 không decode
  ra 32 byte) → server chạy nhưng không có kho hội thoại (fail closed). Đặt khóa rồi restart `uniwork-be`; log
  `uniwork ai transcript store disabled` nói lý do.
- **Hội thoại không được dọn**: kiểm worker TTL còn chạy (log `uniwork ai conversation sweep`, mỗi phút) và consumer
  `ai_uniwork_conversation_cleanup` có nhận `document.deleted` / `member.*` (lane slow; `RUNBOOK_OUTBOX.md`).
- **Đọc thẳng trong `psql`**: chỉ thấy bản mã. Nghi plaintext trong `ai_uniwork_turns` = sự cố bảo mật: dừng deploy đó
  và giữ nguyên hiện trường.

## Không bao giờ

- Không log prompt, nguồn hay câu trả lời. `ai_messages` là dữ liệu người dùng,
  xóa được từ panel.
- Không gọi SDK provider ngoài `internal/ai/provider`; không cho `internal/ai`
  chạm bảng nghiệp vụ (`arch_test.go`).
