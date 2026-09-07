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
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | OpenAI-compatible (OpenAI, Gemini OpenAI-compat, vLLM…) |
| `OLLAMA_BASE_URL` | Ollama local/on-prem, không cần key |
| `AI_MODEL_<CAPABILITY>` | Override model cho một capability (`AI_MODEL_COPILOT_ANSWER=claude-sonnet-5`); ngoài allowlist → dùng mặc định + log warn |
| `AI_MODEL_ALLOW` | Mở rộng allowlist (csv) cho model self-host |
| `AI_TIMEOUT_SECONDS` | Mặc định 60 |

`AI_PROVIDER=fake` cho dev và E2E: trả lời deterministic, cite mọi nguồn, không
ra mạng.

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

## Không bao giờ

- Không log prompt, nguồn hay câu trả lời. `ai_messages` là dữ liệu người dùng,
  xóa được từ panel.
- Không gọi SDK provider ngoài `internal/ai/provider`; không cho `internal/ai`
  chạm bảng nghiệp vụ (`arch_test.go`).
