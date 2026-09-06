# RealtimePublishSlow — p95 commit → frame realtime vượt 1 giây

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · Outbox & Realtime*

## Triệu chứng

- Alert `RealtimePublishSlow`: `histogram_quantile(0.95, sum by (le) (rate(uniwork_realtime_publish_latency_seconds_bucket[5m]))) > 1` liên tục 5 phút.
- Người dùng thấy thẻ vừa kéo "nhảy lại" rồi mới sang cột; chat hiện tin của người khác trễ hơn 1 giây; ai đang gõ hiển thị muộn.
- Panel **p95 commit → frame realtime** vượt 1 s trong khi **Tuổi dòng pending cũ nhất** có thể vẫn thấp (khác với OutboxLagHigh: ở đây outbox chạy nhưng chậm).

## Kiểm tra

1. Outbox có lag theo cùng nhịp không? `max(uniwork_outbox_pending_age_seconds)` — nếu cũng cao thì đây là hệ quả của [OutboxLagHigh](OutboxLagHigh.md); xử lý bên đó trước.
2. Redis relay:
   ```promql
   min(uniwork_realtime_redis_connected)
   rate(uniwork_realtime_redis_xadd_errors_total[5m])
   rate(uniwork_realtime_redis_xread_errors_total[5m])
   ```
   Lỗi XADD/XREAD hoặc `redis_connected` nhấp nháy → Redis quá tải hoặc mạng.
3. Client chậm kéo cả hub? `rate(uniwork_realtime_slow_evictions_total[5m])` và `rate(uniwork_realtime_messages_dropped_total[5m])` — nếu tăng, hub đang phải đuổi client; số kết nối (`uniwork_realtime_active_connections`) có tăng bất thường không.
4. Tick của dispatcher: outbox claim theo lô; nếu một topic khác (email, provider) chiếm lô, realtime chờ. `sum by (topic) (uniwork_outbox_pending_total)`.
5. Log: `docker compose logs --since 10m server | grep 'realtime'`; span `realtime.publish` trong backend trace cho biết thời gian nằm ở DB claim hay ở gửi frame.

## Khắc phục

- Redis quá tải → xem `redis-cli --latency`, `INFO memory`; nâng máy hoặc bật `maxmemory-policy` hợp lý. Redis chỉ là relay giữa các replica; một replica có thể tạm bỏ `REDIS_URL`.
- Một topic khác chiếm lô → sửa consumer chậm đó (thường là provider ngoài); realtime sẽ tự nhanh lại.
- Nhiều kết nối từ một tổ chức bất thường (tab mở hàng loạt, bot) → xem `/admin/organizations/<id>`; nếu cần, tạm khoá tổ chức với lý do ghi rõ.
- API thiếu CPU → thêm replica (realtime qua Redis nên scale ngang an toàn).

## Leo thang

- p95 > 5 s hoặc kèm drop message tăng → nâng sev 2.
- Kéo dài quá một ngày làm việc → mở issue perf, gắn nhãn `perf` để chạy k6 smoke trong PR sửa.
