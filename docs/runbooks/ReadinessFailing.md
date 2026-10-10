# ReadinessFailing — /readyz trả 503 quá 2 phút

> **Trạng thái:** shipped · **Sev:** 1 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · API*, *UniWork · DB*

## Triệu chứng

- Alert `ReadinessFailing`: `probe_success{job="readyz"} == 0` liên tục 2 phút (blackbox exporter trong `docker-compose.observability.yml` gọi `GET /readyz`, cấu hình ở `deploy/prometheus.yml`).
- Load balancer/Kubernetes ngừng gửi traffic tới node; người dùng thấy 502/503 từ proxy, không phải từ API.
- `/healthz` vẫn 200 (tiến trình sống) — chỉ dependency hỏng.

## Kiểm tra

1. Đọc báo cáo từng check:
   ```sh
   curl -s -o /dev/stderr -w '%{http_code}\n' http://<api>:8080/readyz | jq
   ```
   Body có `ready` và `checks[]` với `name` ∈ `db`, `migrations`, `redis` (chỉ khi đặt `REDIS_URL`), `storage` (khi có adapter), mỗi check có `ok` và `detail`. Chỉ `db` và `migrations` làm `/readyz` trả 503; `redis` và `storage` fail vẫn 200, chỉ hiện trong body và trang admin.
   - `db` fail: Postgres không trả `SELECT 1` trong 2 s → DB chết, mạng, hoặc pool cạn (dashboard *UniWork · DB*).
   - `migrations` fail: `detail` nêu version đã áp dụng **cũ hơn** version embedded trong binary → deploy binary mới mà chưa chạy migrate. Binary cũ chạy trên schema mới hơn (rollback) vẫn ready.
   - Redis hỏng không còn làm alert này kêu: xem [RedisUnreachable](RedisUnreachable.md) (gauge `uniwork_readiness_dependency_up`, cũng có `dependency="storage"`) và check `redis` trong body.
2. Postgres: `docker compose ps postgres`, `docker compose logs --since 10m postgres`. Redis tương tự.
3. Nếu chỉ một node sau load balancer fail → node đó mất mạng tới DB; các node khác xanh thì traffic không ảnh hưởng.
4. Build vừa đổi? `uniwork_build_info` trên dashboard *UniWork · API* — nếu commit mới và `migrations` fail thì đây là deploy thiếu bước migrate.

## Khắc phục

- `migrations` lệch → chạy migrate cho đúng binary đang chạy:
  ```sh
  make migrate-up              # dùng DATABASE_URL của env hiện tại
  # hoặc trong container: docker compose exec server /app/migrate up
  ```
- `db` fail → khởi động Postgres, kiểm tra ổ đĩa đầy (`df -h` trên volume `pgdata`), `max_connections`. API tự nối lại, không cần restart.
- Mọi thứ xanh mà probe vẫn fail → blackbox không tới được `server:8080` (đổi tên service/port trong compose?) — sửa `deploy/prometheus.yml`, không phải API.

## Leo thang

- DB không lên trong 10 phút → gọi người giữ hạ tầng, cân nhắc restore từ backup gần nhất (ghi rõ thời điểm mất dữ liệu).
- Migration không áp dụng được (lỗi SQL) → gọi người viết migration, không sửa tay `schema_migrations`.
