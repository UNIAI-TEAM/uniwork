# Runbooks theo alert

> **Trạng thái:** shipped · **Cập nhật:** 2026-09-07 · **Nguồn alert:** `deploy/alerts.yml` · **Hướng dẫn chung:** [`docs/ops/OBSERVABILITY.md`](../ops/OBSERVABILITY.md)

Mỗi rule trong `deploy/alerts.yml` có `runbook_url` trỏ tới đúng một file ở
đây; `scripts/alerts-runbooks.test.mjs` fail khi thiếu file, thiếu mục hoặc có
runbook mồ côi. Mọi runbook có đúng bốn mục theo thứ tự: **Triệu chứng →
Kiểm tra → Khắc phục → Leo thang**.

| Alert | Sev | Nghĩa ngắn | Runbook |
| --- | --- | --- | --- |
| `ApiErrorRateHigh` | 1 | 5xx / tổng > 2 % trong 5 phút | [ApiErrorRateHigh.md](ApiErrorRateHigh.md) |
| `ReadinessFailing` | 1 | `/readyz` 503 quá 2 phút | [ReadinessFailing.md](ReadinessFailing.md) |
| `ApiLatencyP95High` | 2 | p95 GET > 400 ms trong 10 phút | [ApiLatencyP95High.md](ApiLatencyP95High.md) |
| `OutboxLagHigh` | 2 | dòng outbox chờ > 60 s | [OutboxLagHigh.md](OutboxLagHigh.md) |
| `OutboxDeadLetter` | 2 | có dead letter mới trong 15 phút | [OutboxDeadLetter.md](OutboxDeadLetter.md) |
| `AiCostSpike` | 2 | chi phí AI 1 giờ > 3× trung bình 7 ngày | [AiCostSpike.md](AiCostSpike.md) |
| `RealtimePublishSlow` | 3 | p95 commit → frame > 1 s | [RealtimePublishSlow.md](RealtimePublishSlow.md) |
| `WebVitalsLCPPoor` | 3 | p75 LCP > 2,5 s trong 30 phút | [WebVitalsLCPPoor.md](WebVitalsLCPPoor.md) |

Hướng dẫn chung (chạy stack, env, sampling, `/readyz`): [`docs/ops/OBSERVABILITY.md`](../ops/OBSERVABILITY.md).

Sev 1: gọi ngay, mọi giờ. Sev 2: xử lý trong giờ làm việc, tối đa 4 giờ.
Sev 3: đưa vào sprint, không đánh thức ai.

## Từ một request lỗi tới nguyên nhân: trace id

1. Mọi response của API mang header `X-Trace-Id` (cùng giá trị với
   `X-Correlation-ID`). Hỏi người dùng gửi ảnh chụp lỗi có header này, hoặc lấy
   từ log truy cập (`trace_id`).
2. Mở `/admin/trace/<trace_id>` (cần `platform_role`): màn hình liệt kê
   `audit_events`, `outbox_events` và `admin_actions` mang cùng trace id, tối
   đa 500 dòng mỗi bảng. Đây là chỗ nhìn đầu tiên: request đã ghi audit gì,
   sự kiện nào đã phát, sự kiện nào còn kẹt.
3. Log: `LOG_FORMAT=json` in `trace_id` trên mọi dòng của request đó.
   `docker compose logs server | grep '"trace_id":"<id>"'` hoặc Loki
   `{container="uniwork-server-1"} | json | trace_id = "<id>"`.
4. Span: nếu `OTEL_EXPORTER_OTLP_ENDPOINT` được đặt, tìm trace id trong backend
   trace (Tempo/Jaeger) hoặc `docker compose logs otel-collector`.
5. Cần 100 % sampling cho một lần tái hiện: gọi lại với header
   `X-Debug-Trace: 1` từ tài khoản có `platform_role`.
