# UniworkAiModelErrors — UniWork AI lỗi trên 10 % lượt gọi model

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** Grafana *UniWork · AI* · **Nền:** [`docs/ops/RUNBOOK_AI.md`](../ops/RUNBOOK_AI.md)

## Triệu chứng

- Alert `UniworkAiModelErrors`: trên 10 % lượt gọi model của capability `office_uniwork_ai` kết thúc `failed` trong 10 phút (`uniwork_ai_calls_total{capability="office_uniwork_ai"}`), với ít nhất 20 lượt.
- Người dùng thấy trợ lý UniWork AI báo lỗi hoặc timeout (`ai_provider_error`, `ai_provider_timeout`). Editor, Lưu, BYOK và đồng bộ không bị ảnh hưởng (spec §8.3).

## Kiểm tra

1. `rejected` hay `failed`? `rejected` là hết quota, không phải lỗi upstream (`uniwork_ai_calls_total{status="rejected"}`).
2. Lỗi chung mọi capability hay riêng `office_uniwork_ai`: so `sum by (capability) (increase(uniwork_ai_calls_total{status="failed"}[10m]))`. Chung = upstream/khóa; riêng = model `AI_MODEL_OFFICE_UNIWORK_AI` hoặc vòng tool-result.
3. `ai_usage_events` theo `reason_code` của 10 phút qua (`ai_provider_error` / `ai_provider_timeout`); log `ai: provider error` chỉ có id, capability, latency.
4. Vừa đổi `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `AI_MODEL_ALLOW` hay `AI_MODEL_OFFICE_UNIWORK_AI` không (mục "UniWork AI upstream" trong [`docs/ops/RUNBOOK_AI.md`](../ops/RUNBOOK_AI.md)).

## Khắc phục

- Upstream sập: UniWork AI tự báo không khả dụng, không fallback âm thầm sang nhà cung cấp khác. Chuyển upstream theo mục "Upstream model: sập và đổi" trong [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md).
- Model sai: sửa `AI_MODEL_OFFICE_UNIWORK_AI` về model trong allowlist, restart.
- Cần dừng ngay: tắt flag `office_ai_uniwork` (kill switch, không ảnh hưởng BYOK).

## Leo thang

Chạm 30 phút không có nguyên nhân hoặc chi phí tăng cùng lúc: nâng sev 1, báo owner AI server (G6-03a/G6-03b) và người giữ hợp đồng upstream.
