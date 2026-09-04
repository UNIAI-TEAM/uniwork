# 0002 — Id là ULID trong cột `TEXT`

**Trạng thái:** accepted (2026-08-25)

## Bối cảnh

Multica (nguồn port) dùng UUID. UUID v4 ngẫu nhiên làm B-tree phân mảnh và
không sắp xếp được theo thời gian; kiểu `uuid` của Postgres cũng khiến id lộ
ra ở URL dài và khó đọc.

## Quyết định

`util.NewID()` sinh ULID (26 ký tự, sắp xếp được theo thời gian tạo), lưu
trong cột `TEXT`. Không cột `uuid`, không `SERIAL`.

## Hệ quả

- Id là chuỗi mờ ở mọi tầng: handler không parse, service quyết định
  403/404 (`CLAUDE.md` § Backend ID Rules).
- Không dùng `uuid` extension; sort theo id ≈ sort theo thời gian tạo.
- Không được suy diễn gì từ định dạng id ở frontend.
