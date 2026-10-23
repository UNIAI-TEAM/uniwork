# 0025 — Chưa tách API và worker thành hai service; một process cho đến khi có tín hiệu

**Trạng thái:** accepted (2026-10-02) — đánh giá chủ động, chưa có sự cố nào thúc đẩy.

## Bối cảnh

Máy chủ có đúng một binary chạy lâu dài, `server/cmd/server`. Cùng một process vừa
phục vụ HTTP + WebSocket, vừa chạy toàn bộ việc nền (wiring trong `main.go`):

| Vòng lặp | Nhịp | Chạy nhiều replica |
| --- | --- | --- |
| `mail.Outbox.Run` | 5s + `Kick()` | an toàn — `ClaimPendingEmails` `FOR UPDATE SKIP LOCKED` |
| `outbox.Dispatcher.Run` (~10 consumer: realtime, notification, push, audit export, webhook, chat↔task, voice summary AI, meeting provider, feature-flag invalidator) | `MeetingWorkerTick` | an toàn — `ClaimPendingOutbox` `SKIP LOCKED`, claim commit trước khi consumer chạy |
| `MeetingService.RunWorkers` (webhook inbox) | `MeetingWorkerTick` | an toàn — `ClaimPendingWebhookInbox` `SKIP LOCKED` |
| `FileGCWorker.Run` | sweep | an toàn — `file_gc` / `file_jobs` `SKIP LOCKED` + lease + generation fencing |
| `EmailHubService.RunWorkers` — hẹn giờ gửi | 1 phút | **không an toàn** — `ListDueEmailHubScheduledSends` là `SELECT` không khóa: hai replica gửi trùng email của người dùng |
| `EmailHubService.RunWorkers` — pull / reconcile | ticker | **không an toàn** — mỗi replica sync cùng tài khoản; trùng việc, có thể vượt hạn mức nhà cung cấp |
| `EmailHubService.RunHubWatchers` (IMAP IDLE) | liên tục | **không an toàn** — mỗi replica mở một kết nối IDLE cho mỗi tài khoản |
| `notification.DigestScheduler.Run` | 15 phút | **không an toàn** — đọc ứng viên rồi mới đánh `digested_at`; hai replica cùng cửa sổ 08:00 gửi digest hai lần |
| `notification.MeetingReminder.Run` | 1 phút | dedupe một phần — upsert theo `(user_id, group_key)` gộp hàng inbox, chưa xác minh push có bắn hai lần không |
| `MeetingService.RunAutoEnd` | ticker | chưa xác minh — `endMeeting` cần chuyển trạng thái có điều kiện để lần thứ hai là no-op |
| `DocumentWorkers.Run` (auto-version, purge, compact) | ba ticker | chưa xác minh |
| `DocumentOfficeService.RunReconciler` | `ReconcileInterval` | chưa xác minh — các câu `Settle`/`Complete`/`Cancel` là `:one` theo trạng thái |
| `AuditService.RunRetentionMarker` | ticker | vô hại — chỉ đếm và set gauge; nhả file export trong transaction của từng hàng |

Triển khai hiện tại: Helm `be.replicaCount: 1`, request 100m / 256Mi, limit 500m / 512Mi,
không HPA. Spec transactional email (2026-08-28) đã ghi sẵn lối tách: "tách worker ra
process riêng (cùng code, flag `--role=mail-worker`)".

Tách thành `api-service` và `worker-service` đem lại: scale API độc lập với job nặng
(AI, office, email hub), rolling deploy API không ngắt job, giới hạn tài nguyên riêng.
Cái giá: thêm một Deployment và cấu hình của nó; worker không giữ WebSocket nên realtime
consumer chỉ tới client qua Redis relay — **Redis thành bắt buộc**; `mail.Outbox.Kick()`
được 7 service gọi (đăng ký, xác minh, đặt lại mật khẩu, lời mời, onboarding, digest)
và chỉ đánh thức worker trong cùng process — tách ra thì mail xác minh chờ tới tick 5s
trừ khi có tín hiệu liên process (`LISTEN/NOTIFY` hoặc Redis).

Ở một replica và tải hiện tại, chưa có vấn đề nào mà cái lợi trên giải quyết.

## Quyết định

1. **Chưa tách.** API và worker tiếp tục chạy trong một process `server/cmd/server`.
2. **Khi tách, tách bằng vai trò, không bằng binary.** Cùng binary, biến môi trường
   `SERVER_ROLE=api|worker|all` (mặc định `all`), Helm hai Deployment `be-api` /
   `be-worker`. Không viết `cmd/worker` riêng: wiring ~570 dòng sẽ phải nhân đôi hoặc
   rút ra package chung mà không thu được gì hơn vai trò.
3. **Điều kiện trước khi tăng `be.replicaCount` lên 2 — kể cả khi chưa tách.** Mọi hàng
   "không an toàn" và "chưa xác minh" ở bảng trên phải thành "an toàn": job chọn hàng
   thì claim bằng `SKIP LOCKED` hoặc chuyển trạng thái có điều kiện; job chỉ được chạy
   một bản (digest, IMAP watcher, pull email hub) thì giữ leader bằng
   `pg_try_advisory_lock` theo tên job.
4. **Điều kiện trước khi tách vai trò.** Đủ điều kiện 3, cộng: role `worker` từ chối khởi
   động khi thiếu `REDIS_URL`; `Kick()` đi qua tín hiệu liên process.
5. **Tín hiệu để mở lại quyết định** (bất kỳ một):
   - API cần hơn một replica vì tải hoặc HA.
   - Job AI / office / email hub làm p95 HTTP tăng hoặc bộ nhớ pod sát limit — đọc từ
     metrics Prometheus sẵn có (`uniwork_http_*`, `uniwork_db_pool_*`, AI, office).
   - Số kết nối IMAP hoặc thời gian rolling deploy (mỗi worker được chờ tối đa 30s,
     lần lượt) thành vấn đề vận hành.

## Hệ quả

- Không thêm runtime, không thêm Deployment; Redis vẫn là tùy chọn khi chạy một replica.
- Một job nặng vẫn chia CPU/RAM với request HTTP trong cùng pod. Chấp nhận ở quy mô hiện
  tại; tín hiệu ở mục 5 là cách biết khi nào thôi chấp nhận.
- `be.replicaCount > 1` hôm nay là **lỗi**, không phải tối ưu: gửi trùng email hẹn giờ và
  digest, mở trùng kết nối IMAP. Ai tăng replica phải làm mục 3 trước.
- Ngay cả ở một replica, rolling update mặc định (`deployment-be.yaml` không khai
  `strategy`: maxSurge 1, maxUnavailable 0) cho pod cũ và pod mới chạy chồng nhau trong
  mỗi lần deploy — các hàng "không an toàn" đã có cửa sổ chạy hai bản ngay bây giờ.
- Worker mới vẫn theo luật hiện có: đăng ký trong chuỗi shutdown của `main.go`, không là
  goroutine trần — và thêm một hàng vào bảng trên với cột "chạy nhiều replica".

## Test giữ luật

Chưa có. Khi làm mục 3: một test Go chạy hai bản của mỗi job trên cùng DB và khẳng định
mỗi đơn vị việc được xử lý đúng một lần (mẫu: test hai worker song song trên 50 hàng của
mail outbox).
