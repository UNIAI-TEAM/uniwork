# 0001 — Không `FOREIGN KEY`, không cascade; index luôn `CONCURRENTLY`

**Trạng thái:** accepted (2026-08-25)

## Bối cảnh

Postgres cho phép FK + `ON DELETE CASCADE`, và đó là mặc định của hầu hết
ORM. Nhưng FK khóa bảng cha khi thêm/xóa, cascade xóa dữ liệu mà service
không nhìn thấy, và `CREATE INDEX` thường khóa ghi trên bảng lớn — ba thứ đều
gây sự cố lúc migrate trên production có người dùng.

## Quyết định

Từ migration `005`: không `FOREIGN KEY` / `REFERENCES`, không cascade. Quan hệ
và dọn dẹp phụ thuộc nằm trong service, trong một transaction khi cha và con
phải commit cùng nhau. Mọi index là `CREATE [UNIQUE] INDEX CONCURRENTLY`, đứng
một mình trong file, vì runner áp file ngoài transaction.

## Hệ quả

- Service phải tự xóa con khi xóa cha; quên là rác dữ liệu, không phải lỗi DB.
- Không có ràng buộc tham chiếu ở tầng DB → test service phải phủ đường xóa.
- `server/migrations/lint_test.go` là thứ giữ luật, không phải review.
- `001`–`004` là lịch sử đã áp, giữ nguyên.
