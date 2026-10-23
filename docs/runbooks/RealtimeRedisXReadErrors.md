# RealtimeRedisXReadErrors — Redis relay lỗi XREAD liên tục

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · Outbox & Realtime* (panel **Lỗi XREAD của Redis relay mỗi giây**)

## Triệu chứng

- Alert `RealtimeRedisXReadErrors`: hơn 30 lỗi XREAD trong 5 phút, kéo dài 10 phút.
- Redis relay chuyển sự kiện realtime giữa các replica. Hiện chỉ có một replica, và broadcaster gửi cho client trên chính pod trước rồi mới qua Redis, nên người dùng thường chưa thấy gì. Alert này báo sớm rằng Redis hoặc relay đang hỏng, trước khi lỗi lan sang limiter, cache hay replica thứ hai.
- Relay mở một vòng XREADGROUP cho mỗi scope (workspace, phòng họp, kênh chat). Khi số scope vượt pool đọc, lỗi tăng theo số scope (G10 trong bản đánh giá).

## Kiểm tra

1. Redis còn nối không, và lỗi ghi có tăng theo không?
   ```promql
   min(uniwork_realtime_redis_connected)
   rate(uniwork_realtime_redis_xread_errors_total[5m])
   rate(uniwork_realtime_redis_xadd_errors_total[5m])
   ```
   XADD cũng lỗi: Redis hoặc mạng có vấn đề. Chỉ XREAD lỗi: nghi pool đọc cạn hoặc quá nhiều scope.
2. Lỗi XREAD chỉ được đếm, không ghi log. Log BE vẫn có lỗi XADD và lỗi ping cùng nguồn: `kubectl -n uniwork logs deploy/uniwork-be --since=15m | grep 'realtime/redis'`. `pool timeout` nghĩa là pool cạn. `connection refused` hay `i/o timeout` nghĩa là Redis hoặc mạng. Không có dòng nào mà XADD vẫn chạy: nghi pool đọc (bước 3, 4).
3. Redis: `redis-cli INFO clients`, `INFO memory`, `redis-cli --latency`. Đếm stream của relay bằng `redis-cli --scan --pattern 'ws:scope:*:stream' | wc -l` (key không bao giờ hết hạn, nên số này chỉ tăng).
4. Số kết nối và số scope đang mở: `sum(uniwork_realtime_active_connections)`, `rate(uniwork_realtime_subscribes_total[5m])`.

## Khắc phục

- Redis quá tải hoặc hết bộ nhớ: kiểm tra `maxmemory` và dọn stream cũ của các scope không còn dùng. Nâng tài nguyên Redis nếu cần.
- Pool đọc cạn vì quá nhiều scope: restart BE để đóng các vòng đọc của scope đã nguội (`kubectl -n uniwork rollout restart deploy/uniwork-be`). Cách sửa lâu dài là nối `ShardedStreamRelay` (G10).
- Redis mất hẳn: realtime trên một replica vẫn chạy nhờ gửi cục bộ. `/readyz` vẫn 200 nhưng báo check `redis` lỗi; xử lý theo [RedisUnreachable](RedisUnreachable.md).

## Leo thang

- Kèm [ReadinessFailing](ReadinessFailing.md) hoặc 5xx tăng: nâng sev 1.
- Lặp lại mỗi ngày: mở issue cho G10 (relay theo scope), gắn nhãn `perf`.
