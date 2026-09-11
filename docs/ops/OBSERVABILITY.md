# Observability — từ alert tới nguyên nhân trong 10 phút

> **Trạng thái:** shipped · **Cập nhật:** 2026-09-07 · **Thành phần:** `server/internal/telemetry` (OTel), `server/internal/metrics` (Prometheus), `/readyz`, `/admin/trace` · **Liên quan:** spec `2026-09-04-platform-admin-observability-design.md` §6, §8; [`docs/runbooks/README.md`](../runbooks/README.md)

Một tiến trình API phát ra bốn thứ, mỗi thứ mang cùng một `trace_id`: span
OTel (khi có collector), metric Prometheus trên listener riêng, log JSON, và
dòng `audit_events`/`outbox_events`/`admin_actions` trong DB. Hướng dẫn này
là đường đi giữa bốn thứ đó khi có sự cố. Chi tiết từng alert nằm ở runbook.

## Chạy stack observability

```sh
# .env cần GRAFANA_ADMIN_PASSWORD (và JWT_SECRET như prod)
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.observability.yml up
```

| Dịch vụ | Cổng host | Việc |
| --- | --- | --- |
| `otel-collector` | 4317 | Nhận OTLP/gRPC từ API; exporter `debug` in span ra `docker compose logs otel-collector`. Tempo/Jaeger để sẵn dạng comment trong `deploy/otel-collector.yaml` |
| `prometheus` | 9091 | Scrape `server:9090` (job `uniwork-api`) và probe `/readyz` qua `blackbox` (job `readyz`); nạp `deploy/alerts.yml` |
| `blackbox` | — | `prom/blackbox-exporter`, module `http_2xx`, chỉ để probe `/readyz` |
| `grafana` | 3001 | Đăng nhập `admin` / `GRAFANA_ADMIN_PASSWORD`; anonymous tắt; sáu dashboard nạp tự động từ `deploy/grafana/dashboards` (thư mục *UniWork*) |
| `loki` | 3100 | Tùy chọn. Datasource đã khai báo; ship log bằng promtail/Docker log driver, API không tự ghi vào Loki |

File này ghi đè env của `server`: `METRICS_ADDR=0.0.0.0:9090`,
`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317`, `LOG_FORMAT=json`.
On-prem nhỏ bỏ file này đi là xong: API không cần bất kỳ dịch vụ nào ở trên.

Kiểm tra cấu hình mà không chạy: `docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.observability.yml config`,
và `docker run --rm -v "$PWD/deploy:/etc/prometheus:ro" --entrypoint promtool prom/prometheus:v2.55.1 check rules /etc/prometheus/alerts.yml`.

## Đường đi 10 phút khi có alert

1. **Alert → runbook.** Mỗi alert mang `runbook_url`; mở nó. Runbook nói dashboard nào, PromQL nào, màn hình `/admin` nào. Mục lục: [`docs/runbooks/README.md`](../runbooks/README.md).
2. **Dashboard → khoanh vùng.** Grafana thư mục *UniWork*: *API* (RPS, p50/p95/p99 theo route, error rate, `build_info`), *Outbox & Realtime*, *DB* (p95 truy vấn, pool), *AI* (lượt gọi, chi phí, top tổ chức), *Web Vitals* (p75 LCP/INP/CLS/TTFB theo route), *Business* (họp, task mutation, audit, thông báo). Câu hỏi cần trả lời ở bước này: một route hay mọi route, một tổ chức hay mọi tổ chức, có trùng deploy (`uniwork_build_info` đổi commit) không.
3. **Trace id → `/admin/trace/{id}`.** Lấy `X-Trace-Id` từ response lỗi (người dùng gửi ảnh chụp, hoặc từ log). `X-Correlation-ID` cùng giá trị. Mở `/admin/trace/<id>` (cần `platform_role`, mọi truy cập ghi `admin_actions`): thấy audit, outbox và admin action mang trace id đó, tối đa 500 dòng mỗi bảng, chỉ metadata — không có nội dung task/tin nhắn. Trả lời được: command đã ghi audit chưa, sự kiện nào đã phát, sự kiện nào kẹt/dead letter.
4. **Log.** `LOG_FORMAT=json` in mỗi dòng một object với `trace_id`, `span_id`, `organization_id`, `workspace_id`, `actor_id` (lấy từ context, chỉ với các lệnh `*Context`). Không có email/display_name trong log (`scripts/no-pii-log.test.mjs` chặn).
   ```sh
   docker compose logs --since 1h server | grep '"trace_id":"<id>"'
   ```
   Loki: `{container=~".*server.*"} | json | trace_id = "<id>"`. Muốn thấy toàn bộ request kèm span: gọi lại với header `X-Debug-Trace: 1` từ tài khoản `platform_role` — request đó luôn được sample.
5. **Audit.** Với thao tác của người dùng, `audit_events` là sự thật cuối (không sửa/xóa được, ADR 0012). Với thao tác của platform admin, `admin_actions` (cùng transaction với audit, `reason` ≥ 10 ký tự). Cả hai đã hiện ở bước 3; SQL trực tiếp khi cần quá 500 dòng:
   ```sql
   SELECT created_at, action, actor_id, organization_id FROM audit_events
   WHERE correlation_id = '<trace_id>' ORDER BY created_at;
   ```

## Cấu hình (spec §8)

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `METRICS_ADDR` | rỗng = tắt | Listener Prometheus riêng, không đi qua auth. Chạy trực tiếp trên máy: `127.0.0.1:9090` (chỉ loopback, Prometheus cùng máy). Trong compose/Kubernetes: `0.0.0.0:9090` và **không** publish cổng ra ngoài — chỉ mạng nội bộ của compose/cluster |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | rỗng = không export | OTLP/gRPC, ví dụ `http://otel-collector:4317`. Rỗng vẫn tạo span (để có `X-Trace-Id`) nhưng không mở kết nối |
| `OTEL_SERVICE_NAME` | `uniwork-api` | Tên service trong backend trace |
| `OTEL_TRACES_SAMPLER_ARG` | rỗng = `1.0` | Tỷ lệ sampling parent-based 0..1. Xem mục sampling |
| `LOG_FORMAT` | text | `json` ở production; gì khác là text màu cho terminal |
| `LOG_LEVEL` | `debug` | `debug` / `info` / `warn` / `error`; production dùng `info` |
| `FEATURE_FLAGS_FILE` | rỗng | YAML flag tĩnh; override theo tổ chức nằm ở DB (`/admin/flags`) |
| `RUM_SAMPLE_RATE` | `0.2` | Tỷ lệ trình duyệt gửi web-vitals về `/api/v1/rum`; client đọc qua `GET /api/v1/config`. Flag `rum_sampling` tắt hẳn |
| `ADMIN_RATE_LIMIT_PER_MIN` | `60` | Giới hạn request `/api/v1/admin/*` mỗi phút mỗi admin |
| `GRAFANA_ADMIN_PASSWORD` | bắt buộc khi bật profile | Mật khẩu `admin` của Grafana trong `docker-compose.observability.yml` |

## Sampling

`OTEL_TRACES_SAMPLER_ARG` rỗng nghĩa là **100 %** (OPEN_QUESTIONS O3): cho tới
khi có hơn năm tổ chức trả tiền, mọi request đều có span đầy đủ — rẻ hơn
việc thiếu đúng trace cần xem. Vượt năm tổ chức, đặt `0.1` và dựa vào
`X-Debug-Trace: 1`: header này từ tài khoản có `platform_role` buộc sample
request đó bất kể tỷ lệ; từ tài khoản thường bị bỏ qua. Flag
`debug_trace_full_sampling` bật 100 % cho một tổ chức đang điều tra mà không
đổi env.

## `/healthz` và `/readyz`

- `/healthz`: 200 khi tiến trình còn trả lời. Liveness, không hơn.
- `/readyz`: JSON `{ready, checks[{name, ok, detail}]}`; 503 khi bất kỳ check
  nào fail. Check gồm `db` (`SELECT 1`, hạn 500 ms), `migrations`
  (`schema_migrations` == version embedded trong binary; `detail` ghi hai
  số khi lệch), `redis` (PING, chỉ khi đặt `REDIS_URL`). **Không kiểm S3** —
  không có probe rẻ cho bucket, và upload lỗi không nên kéo cả node ra khỏi
  load balancer. Load balancer/Kubernetes dùng `/readyz`; Prometheus probe nó
  qua blackbox (`ReadinessFailing`). Cả hai đường bị `IsHealthProbePath` loại
  khỏi metric HTTP và access log mức info.

## Metric ở đâu

Listener `METRICS_ADDR` phục vụ `/metrics` với Go/process collector cộng mọi
metric `uniwork_*`: `http_*` (`method,route,status` — route là pattern Chi,
không phải path thật), `db_pool_*`, `db_query_duration_seconds{query_name}`,
`outbox_*`, `realtime_*`, `meeting_*`, `ai_*`, `web_vitals_seconds{metric,route_pattern}`,
`audit_events_*`, `notifications_*`, `build_info{version,commit}`. Không đổi
tên metric cũ; alert và dashboard tham chiếu tên trong `server/internal/metrics/*.go`.
