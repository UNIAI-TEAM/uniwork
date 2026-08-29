# 0004 — Không middleware `RealIP`; mỗi consumer tự áp `TRUSTED_PROXIES`

**Trạng thái:** accepted (2026-08-26)

## Bối cảnh

`chi/middleware.RealIP` ghi đè `r.RemoteAddr` từ `X-Forwarded-For` cho mọi
request, kể cả khi header do client tự gửi. Khi đó rate limiter và kiểm tra
origin WebSocket tin vào một địa chỉ mà kẻ gọi tự chọn.

## Quyết định

Không có gì ghi lại `r.RemoteAddr`. Rate limiter và WebSocket origin check
mỗi bên tự đọc header và chỉ tin khi peer nằm trong `TRUSTED_PROXIES`.

## Hệ quả

- Thêm consumer địa chỉ client mới = tự áp `TRUSTED_PROXIES`, không có
  "một chỗ" để hưởng sẵn.
- `server/internal/handler/router_test.go` giữ luật.
- Deploy sau proxy phải cấu hình `TRUSTED_PROXIES`, nếu không rate limit gộp
  mọi người dùng vào một IP.
