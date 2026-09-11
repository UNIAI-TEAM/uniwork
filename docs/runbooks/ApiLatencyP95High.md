# ApiLatencyP95High — p95 GET vượt 400 ms

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · API*, *UniWork · DB*

## Triệu chứng

- Alert `ApiLatencyP95High`: `histogram_quantile(0.95, sum by (le) (rate(uniwork_http_request_duration_seconds_bucket{method="GET"}[5m]))) > 0.4` liên tục 10 phút.
- Bảng công việc, chat, lịch mở chậm; người dùng thấy skeleton lâu. Vision §6.3 hứa p95 đọc ≤ 200 ms nên 400 ms là gấp đôi ngân sách.
- Panel **p95 theo route** trên *UniWork · API* có một hoặc nhiều đường vượt 0,4 s.

## Kiểm tra

1. Route nào chậm?
   ```promql
   topk(5, histogram_quantile(0.95, sum by (le, route) (rate(uniwork_http_request_duration_seconds_bucket{method="GET"}[5m]))))
   ```
2. Tải có tăng không? Panel **RPS theo route** và **Request đang xử lý** (`uniwork_http_in_flight_requests`). RPS tăng đột biến cùng p95 → thiếu tài nguyên; RPS bình thường mà p95 tăng → truy vấn hoặc dependency chậm.
3. DB: dashboard *UniWork · DB*, panel **p95 truy vấn theo tên** (`uniwork_db_query_duration_seconds`) và **Pool: acquired / idle / max**. Acquired chạm max → tăng `DATABASE_MAX_CONNS` hoặc tìm truy vấn giữ kết nối lâu.
4. Truy vấn đang chạy lâu trên Postgres:
   ```sql
   SELECT pid, now() - query_start AS age, left(query, 120)
   FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '1s'
   ORDER BY age DESC;
   ```
5. Lấy một trace của route chậm: gọi lại với `X-Debug-Trace: 1` (tài khoản `platform_role`), lấy `X-Trace-Id` từ response, xem span trong backend trace (Tempo/Jaeger) hoặc `docker compose logs otel-collector` — span `pgx` cho biết truy vấn nào chiếm thời gian.
6. GC/CPU: `rate(process_cpu_seconds_total[5m])` và `go_memstats_heap_inuse_bytes` (Go collector có sẵn trên listener metrics).

## Khắc phục

- Truy vấn thiếu index → thêm migration `CREATE INDEX CONCURRENTLY` (một index một file, có `.down.sql`, xem CLAUDE.md), deploy; kiểm tra `EXPLAIN ANALYZE` trước.
- Route trả quá nhiều dữ liệu (list không phân trang, N+1) → sửa handler/service, phân trang cursor theo pattern `dto/sdi`.
- Pool cạn → tạm nâng `DATABASE_MAX_CONNS` (restart API), rồi tìm nguồn giữ kết nối.
- Máy chật CPU/RAM → scale ngang (thêm replica API sau load balancer) hoặc nâng máy; API stateless, realtime đi qua Redis relay nên thêm replica an toàn.
- Dependency ngoài chậm (LLM, LiveKit) → đúng như thiết kế nếu là route POST; nếu là GET thì response không được chờ dependency, mở issue.

## Leo thang

- p95 > 1 s hoặc kéo dài quá 1 giờ → nâng lên sev 1, gọi on-call backend.
- Cần đổi hạ tầng (nâng DB, thêm replica) → người giữ hạ tầng quyết, ghi vào `docs/ops/incidents/`.
