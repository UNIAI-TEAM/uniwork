# Runbooks theo alert

> **Trạng thái:** shipped · **Cập nhật:** 2026-10-14 · **Nguồn alert:** `deploy/alerts.yml` · **Hướng dẫn chung:** [`docs/ops/OBSERVABILITY.md`](../ops/OBSERVABILITY.md)

Mỗi rule trong `deploy/alerts.yml` có `runbook_url` trỏ tới đúng một file ở
đây; `scripts/alerts-runbooks.test.mjs` fail khi thiếu file, thiếu mục hoặc có
runbook mồ côi. Mọi runbook có đúng bốn mục theo thứ tự: **Triệu chứng →
Kiểm tra → Khắc phục → Leo thang**.

| Alert | Sev | Nghĩa ngắn | Runbook |
| --- | --- | --- | --- |
| `ApiErrorRateHigh` | 1 | 5xx / tổng > 2 % trong 5 phút | [ApiErrorRateHigh.md](ApiErrorRateHigh.md) |
| `ReadinessFailing` | 1 | `/readyz` 503 quá 2 phút | [ReadinessFailing.md](ReadinessFailing.md) |
| `RedisUnreachable` | 2 | check `redis` của `/readyz` fail quá 2 phút (limiter đang fail open) | [RedisUnreachable.md](RedisUnreachable.md) |
| `ApiLatencyP95High` | 2 | p95 GET > 400 ms trong 10 phút | [ApiLatencyP95High.md](ApiLatencyP95High.md) |
| `ApiRateLimitedSpike` | 2 | một route trả 429 > 0,5 req/s trong 5 phút; webhook LiveKit: bất kỳ 429 nào | [ApiRateLimitedSpike.md](ApiRateLimitedSpike.md) |
| `OutboxLagHigh` | 2 | dòng outbox chờ > 60 s | [OutboxLagHigh.md](OutboxLagHigh.md) |
| `OutboxDeadLetter` | 2 | có dead letter mới trong 15 phút | [OutboxDeadLetter.md](OutboxDeadLetter.md) |
| `BILLING_VNPAY_WEBHOOK` | 2 | billing webhook dead letter trong 15 phút | [BILLING_VNPAY_WEBHOOK.md](BILLING_VNPAY_WEBHOOK.md) |
| `AiCostSpike` | 2 | chi phí AI 1 giờ > 3× trung bình 7 ngày | [AiCostSpike.md](AiCostSpike.md) |
| `WebhookInboxLagHigh` | 2 | webhook LiveKit chờ xử lý > 30 s | [WebhookInboxLagHigh.md](WebhookInboxLagHigh.md) |
| `QueueLagUnreadable` | 2 | không đọc được lag outbox hoặc webhook inbox suốt 5 phút | [QueueLagUnreadable.md](QueueLagUnreadable.md) |
| `RealtimePublishSlow` | 3 | p95 commit → frame > 1 s | [RealtimePublishSlow.md](RealtimePublishSlow.md) |
| `RealtimeSlowEvictions` | 3 | > 25 client WebSocket bị đuổi trong 10 phút | [RealtimeSlowEvictions.md](RealtimeSlowEvictions.md) |
| `RealtimeRedisXReadErrors` | 3 | > 30 lỗi XREAD Redis trong 5 phút, kéo dài 10 phút | [RealtimeRedisXReadErrors.md](RealtimeRedisXReadErrors.md) |
| `GraphProjectorLagHigh` | 3 | Work Graph chiếu chậm hơn nguồn | [GraphProjectorLagHigh.md](GraphProjectorLagHigh.md) |
| `WebVitalsLCPPoor` | 3 | p75 LCP > 2,5 s trong 30 phút | [WebVitalsLCPPoor.md](WebVitalsLCPPoor.md) |
| `OfficeChangeFeedLagHigh` | 2 | change feed Office trễ > 300 s trong 10 phút (pending G7-D1) | [OfficeChangeFeedLagHigh.md](OfficeChangeFeedLagHigh.md) |
| `OfficeLeaseRevokeFailed` | 2 | revoke lease offline fail-closed không ghi được (pending G7-D1) | [OfficeLeaseRevokeFailed.md](OfficeLeaseRevokeFailed.md) |
| `UniworkAiModelErrors` | 2 | > 10 % lượt model `office_uniwork_ai` lỗi trong 10 phút (pending G7-D1) | [UniworkAiModelErrors.md](UniworkAiModelErrors.md) |
| `OfficeCommitConflictSpike` | 3 | > 20 % lệnh Lưu file bị 409 trong 30 phút (pending G7-D1) | [OfficeCommitConflictSpike.md](OfficeCommitConflictSpike.md) |
| `OfficeIntentLookupUnknown` | 3 | > 5 lượt tra intent `unknown` trong 1 giờ (pending G7-D1) | [OfficeIntentLookupUnknown.md](OfficeIntentLookupUnknown.md) |
| `OfficeIdempotentReplaySpike` | 3 | > 50 replay Idempotency-Key trong 15 phút (pending G7-D1) | [OfficeIdempotentReplaySpike.md](OfficeIdempotentReplaySpike.md) |
| `OfficeLeaseBlockedSpike` | 3 | > 50 lease offline bị chặn / lý do trong 15 phút (pending G7-D1) | [OfficeLeaseBlockedSpike.md](OfficeLeaseBlockedSpike.md) |
| `UniworkAiLatencyP95High` | 3 | p95 lượt model `office_uniwork_ai` > 20 s (pending G7-D1) | [UniworkAiLatencyP95High.md](UniworkAiLatencyP95High.md) |
| `UniworkAiUsageUnknownSpike` | 3 | > 10 % lượt không có usage từ upstream (pending G7-D1) | [UniworkAiUsageUnknownSpike.md](UniworkAiUsageUnknownSpike.md) |
| `UniworkAiRunSecondsHigh` | 3 | p95 tuổi run UniWork AI > 64 s (pending G7-D1) | [UniworkAiRunSecondsHigh.md](UniworkAiRunSecondsHigh.md) |
| `UniworkAiRunCreditsHigh` | 3 | p95 token mỗi run UniWork AI > 64.000 (pending G7-D1) | [UniworkAiRunCreditsHigh.md](UniworkAiRunCreditsHigh.md) |
| `UniworkAiDroppedToolCalls` | 3 | > 20 tool call bị bỏ / lý do trong 15 phút (pending G7-D1) | [UniworkAiDroppedToolCalls.md](UniworkAiDroppedToolCalls.md) |

Hướng dẫn chung (chạy stack, env, sampling, `/readyz`): [`docs/ops/OBSERVABILITY.md`](../ops/OBSERVABILITY.md).

Runbook vận hành (không gắn alert, mở theo bước deploy):

| Runbook | Dùng khi |
| --- | --- |
| [documents-folder-name-index.md](documents-folder-name-index.md) | Index unique tên thư mục (`idx_documents_folder_name_uidx`, FD-02/UNI-1462) INVALID hoặc không dựng được sau deploy |
| [unichat-desktop-release.md](unichat-desktop-release.md) | Cắt, kiểm, rollback bản desktop UniChat (tag `chat-desktop-v*`, feed `chat-desktop-feed`, UNI-1835) |
| [unichat-mobile-release.md](unichat-mobile-release.md) | Thiết lập, cắt, OTA, rollback bản mobile UniChat (tag `chat-mobile-v*`, EAS, nightly Maestro, UNI-1836) |
| [unichat-pilot.md](unichat-pilot.md) | Pilot nội bộ UniChat: chuẩn bị, triage mỗi sáng, đo người dùng hằng ngày và `uniwork_push_suppressed_total`, điều kiện dừng (UNI-1838) |

Alert `Office*` và `UniworkAi*` (G7-07) chỉ đọc metric mà code server D đăng ký (`scripts/office/alert-metrics.test.mjs`).
Ngưỡng của chúng là đề xuất theo load profile, **pending G7-D1** (người dùng chốt). Các mục vận hành không có alert
(cursor hết hạn, reconciling kẹt, upload hết hạn, trần đồng thời UniWork AI, ...):
[`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md). Metric chỉ có ở app không có alert ở v1:
[`docs/office/g5g6g7/support-matrix.md`](../office/g5g6g7/support-matrix.md).

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
   trace (Tempo/Jaeger) hoặc `docker compose logs otel-collector`. Khi biến này
   rỗng (production hiện nay), API vẫn cấp trace id cho mọi request nhưng không
   ghi span nào, nên chỉ còn bước 2 và 3.
5. Cần 100 % sampling cho một lần tái hiện: gọi lại với header
   `X-Debug-Trace: 1` từ tài khoản có `platform_role`. Header này chỉ có tác
   dụng khi có exporter.
