# UniworkAiUsageUnknownSpike — upstream không trả usage cho hơn 10 % lượt

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** chưa có panel cho series này: đọc `sum(increase(uniwork_ai_uniwork_usage_unknown_total[1h]))` bằng Explore (mẫu số `uniwork_ai_calls_total` có trên Grafana *UniWork · AI*) · **Nền:** [`docs/ops/RUNBOOK_AI.md`](../ops/RUNBOOK_AI.md)

## Triệu chứng

- Alert `UniworkAiUsageUnknownSpike`: hơn 10 % lượt `succeeded` của `office_uniwork_ai` trong 1 giờ không có khối usage (`uniwork_ai_uniwork_usage_unknown_total`), với ít nhất 20 lượt.
- Không có triệu chứng với người dùng. Chi phí và meter `ai.tokens` của các lượt đó được ước lượng bằng lượt đối soát (ký tự/4 trên transcript đã lưu), không phải số thật.

## Kiểm tra

1. Upstream hoặc model vừa đổi (khối usage biến mất khi đổi model self-host hoặc bật stream)?
2. `uniwork_ai_uniwork_usage_reconciled_total` có theo sau không; đứng ở 0 trong khi unknown tăng = lượt quét không chạy hoặc transcript hết hạn trước khi kịp đối soát (log `ai: usage reconcile: transcript gone`).
3. `ai_usage_events`: `reason_code = 'usage_unknown'` (đang chờ) và `usage_unknown_reconciled` (đã định giá).
4. Worker TTL còn chạy không (log `uniwork ai conversation sweep`, mỗi phút) và `AI_CONVERSATION_KEY` chưa đổi.

## Khắc phục

- Đổi model/upstream trả usage đầy đủ; hoặc chấp nhận ước lượng nếu upstream không có khả năng này, và ghi vào hồ sơ chi phí.
- Đối soát không tiến: khởi động lại pod API (worker chạy cùng server); xem mục "Đối soát usage" trong [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md).
- Không sửa tay `ai_usage_events` hay `usage_counters`.

## Leo thang

Đối soát đứng nhiều giờ hoặc chi phí ước lượng lệch rõ so với hóa đơn upstream: báo owner AI server (G6-03b) và billing.
