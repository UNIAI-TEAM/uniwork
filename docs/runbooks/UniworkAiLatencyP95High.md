# UniworkAiLatencyP95High — p95 lượt model UniWork AI vượt 20 giây

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** Grafana *UniWork · AI* · **Nền:** [`docs/ops/RUNBOOK_AI.md`](../ops/RUNBOOK_AI.md)

## Triệu chứng

- Alert `UniworkAiLatencyP95High`: p95 `uniwork_ai_latency_ms{capability="office_uniwork_ai"}` vượt 20 000 ms liên tục 10 phút. Trần chờ upstream là 55 giây (`ai_provider_timeout`, 504).
- Người dùng thấy trợ lý trả lời rất chậm; chưa phải lỗi.

## Kiểm tra

1. Chậm cả capability khác không (`histogram_quantile(0.95, sum by (le, capability) (rate(uniwork_ai_latency_ms_bucket[10m])))`)? Cả hai = upstream chậm.
2. Model/tier vừa đổi (`AI_MODEL_OFFICE_UNIWORK_AI`)? Model lớn chậm hơn.
3. Prompt dài bất thường: `UniworkAiRunCreditsHigh` cùng lúc.
4. Số lượt đồng thời: `uniwork_http_in_flight_requests` và log `ai_uniwork_busy` (đầy trần đồng thời).

## Khắc phục

- Upstream chậm: chờ hoặc chuyển upstream theo [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md).
- Model quá lớn: đặt `AI_MODEL_OFFICE_UNIWORK_AI` về tier nhỏ hơn trong allowlist, restart.
- Không tăng trần thời gian chờ của upstream mà chưa được owner đồng ý (A14).

## Leo thang

p95 trên 30 giây quá 1 giờ hoặc bắt đầu có `ai_provider_timeout`: báo owner AI server (G6-03a) và người giữ hợp đồng upstream.
