# RedisUnreachable — API không tới được Redis quá 2 phút

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Metric:** `uniwork_readiness_dependency_up{dependency="redis"}`

## Triệu chứng

- Alert `RedisUnreachable`: check `redis` của `/readyz` thất bại liên tục 2 phút. Gauge do chính `/readyz` đặt, mỗi lần kubelet (hoặc blackbox) probe; không đặt `REDIS_URL` thì không có series và alert im lặng.
- Node vẫn ready và vẫn nhận traffic (Redis không chặn `/readyz`, H14), nên `ReadinessFailing` không kêu. Với `REALTIME_RELAY=false` (production hiện nay) `RealtimeRedisXReadErrors` cũng không kêu.
- Ảnh hưởng: mọi rate limiter bỏ qua giới hạn (fail open sau 100 ms), presence chat không cập nhật, cache membership rơi về DB (thêm truy vấn). Người dùng thường chưa thấy lỗi; rủi ro là bị spam/brute force mà không có giới hạn.

## Kiểm tra

1. Body `/readyz` nói lý do:
   ```sh
   kubectl -n uniwork port-forward deploy/uniwork-be 8080:8080 &
   curl -s http://localhost:8080/readyz | jq
   ```
   Check `redis` có `ok: false` và `detail` (`connection refused`, `i/o timeout`, `NOAUTH`...).
2. Mọi pod hay một pod?
   ```promql
   uniwork_readiness_dependency_up{dependency="redis"}
   ```
   Một pod: mạng/DNS của node đó. Mọi pod: Redis chết hoặc `REDIS_URL` sai.
3. Redis: `kubectl -n uniwork get pods` (hoặc `docker compose ps redis`), log Redis 10 phút gần nhất, `redis-cli ping`, `redis-cli INFO memory` (hết `maxmemory`?).
4. Log BE: `kubectl -n uniwork logs deploy/uniwork-be --since=15m | grep -i redis`.

## Khắc phục

- Redis chết: khởi động lại Redis. API tự nối lại, không cần restart BE; gauge về 1 ở lần probe kế tiếp.
- Hết bộ nhớ: tăng `maxmemory`/tài nguyên Redis, dọn stream cũ (`ws:scope:*:stream`, xem [RealtimeRedisXReadErrors](RealtimeRedisXReadErrors.md)).
- `REDIS_URL` hoặc mật khẩu sai sau một lần đổi Secret: sửa Secret rồi `kubectl -n uniwork rollout restart deploy/uniwork-be`.
- Trong lúc chờ, theo dõi 429 và request bất thường trên route đăng nhập: limiter đang không chặn gì.

## Leo thang

- Quá 30 phút chưa có Redis: gọi người giữ hạ tầng; cân nhắc chặn tạm route đăng nhập/đăng ký ở ingress vì không còn rate limit.
- Kèm `ApiErrorRateHigh` hoặc `ReadinessFailing`: nâng sev 1.
