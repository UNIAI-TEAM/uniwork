# 0022 — Email Hub: retention cache Postgres trước khi body lên object storage

**Trạng thái:** accepted (2026-09-28)

## Bối cảnh

Email Hub cache metadata và body IMAP trong `email_hub_threads` để list và mở thư nhanh.
Backfill, prefetch body và sync incremental có thể tích lũy hàng nghìn row và body TEXT
nặng. Mail gốc vẫn trên hộp thư IMAP; cache UniWork là tạm, không phải archive vĩnh viễn.

## Quyết định

1. **Metadata** — mỗi `(account_id, folder)` giữ tối đa `EMAIL_HUB_MAX_THREADS_PER_FOLDER`
   thread mới nhất (mặc định 2000). Thread vượt cap và **không** `is_starred` bị xóa khỏi
   cache cùng attachment metadata và AI summary; mở lại kéo từ IMAP.
2. **Body** — `body_text` / `body_html` bị strip khi `sent_at` cũ hơn
   `EMAIL_HUB_BODY_RETENTION_DAYS` (mặc định 90) hoặc khi số `body_cached` trong folder vượt
   `EMAIL_HUB_MAX_BODY_CACHED_PER_FOLDER` (mặc định 150, xóa body cũ nhất trước). Snippet
   giữ lại cho list.
3. **Prefetch** — chỉ body cho thread có `sent_at` trong
   `EMAIL_HUB_PREFETCH_MAX_AGE_DAYS` (mặc định 14) và khi chưa đạt cap body cache.
4. Giá trị env `0` tắt từng rule. Enforcement chạy sau sync/backfill từng folder và
   sau mỗi lần worker sync/reconcile thành công (toàn account).
5. Body lên object storage: cột `body_object_key`, blob gzip JSON
   (`email-hub/accounts/{account_id}/threads/{thread_id}/body.v1.json.gz`) qua `Storage`
   khi `EMAIL_HUB_BODY_STORAGE=s3` hoặc `auto` với `STORAGE_BACKEND=s3`. Retention xóa
   object S3 khi strip body hoặc prune thread.

## Hệ quả

- Biến env phải có trong `.env.example`; logic đọc env trong
  `server/internal/emailhub/retention/`.
- Test unit `retention/*_test.go` và integration Email Hub khi thêm case prune.
