# ApiErrorRateHigh — API trả 5xx trên 2 % tổng request

> **Trạng thái:** shipped · **Sev:** 1 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · API*

## Triệu chứng

- Alert `ApiErrorRateHigh` bật: `sum(rate(uniwork_http_requests_total{status=~"5.."}[5m])) / sum(rate(uniwork_http_requests_total[5m])) > 0.02` liên tục 5 phút.
- Người dùng thấy toast "Có lỗi xảy ra" hoặc màn hình trắng; client web log `500`/`502` trong Network tab.
- Panel **Error rate 5xx (%)** trên dashboard *UniWork · API* vượt 2.

## Kiểm tra

1. Route nào lỗi? Trên dashboard *UniWork · API* hoặc Explore:
   ```promql
   topk(5, sum by (route, status) (rate(uniwork_http_requests_total{status=~"5.."}[5m])))
   ```
   Một route chiếm hết → lỗi code của handler đó. Mọi route cùng lỗi → hạ tầng (DB, Redis).
2. `/readyz` có 503 không? `curl -s http://<api>/readyz | jq` — check `db`, `redis`, `migrations`. Nếu 503, theo [ReadinessFailing](ReadinessFailing.md) trước.
3. Lấy một trace id: log JSON (`LOG_FORMAT=json`) lọc `"status":5` — mỗi dòng có `trace_id`, `route`, `error`:
   ```sh
   docker compose logs --since 10m server | grep '"level":"ERROR"' | tail -20
   ```
   Loki: `{container=~".*server.*"} | json | level = "ERROR"`.
4. Mở `/admin/trace/<trace_id>` để xem request đã ghi audit/outbox tới đâu trước khi vỡ.
5. Có deploy mới không? Panel **Bản build đang chạy** (`uniwork_build_info{version,commit}`) — commit vừa đổi trùng thời điểm alert là nghi phạm số một.
6. Pool DB cạn? Dashboard *UniWork · DB*, panel **Acquire chờ vì pool cạn**; `rate(uniwork_db_pool_empty_acquire_count[5m]) > 0` là dấu hiệu.

## Khắc phục

- Vừa deploy → rollback bản trước (`git revert` + deploy lại, hoặc đổi tag image trong `docker-compose.prod.yml` rồi `docker compose up -d server`).
- DB/Redis chết → khởi động lại dịch vụ đó; API tự nối lại, không cần restart API. Migration lệch → chạy `make migrate-up` với `DATABASE_URL` production (đọc `docs/ops/OBSERVABILITY.md` mục `/readyz`).
- Một route lỗi do dữ liệu (panic trên bản ghi cụ thể) → tìm `organization_id` trong log, kiểm tra bản ghi bằng SQL, sửa dữ liệu hoặc hotfix handler; không tắt route.
- Provider ngoài (LiveKit, LLM, S3) lỗi → lỗi phải là 502/503 với mã lỗi rõ; nếu là 500 thì handler thiếu map lỗi, mở issue.

## Leo thang

- Chưa hạ được dưới 2 % sau 15 phút → gọi on-call backend (kênh `#uniwork-incident`), kèm route, trace id và commit đang chạy.
- Ảnh hưởng mọi tổ chức trên 30 phút → thông báo status page và ghi incident vào `docs/ops/incidents/` (post-mortem trong 3 ngày).
