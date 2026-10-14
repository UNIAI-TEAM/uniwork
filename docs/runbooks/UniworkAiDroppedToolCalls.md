# UniworkAiDroppedToolCalls — UniWork AI bỏ nhiều tool call

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** chưa có panel cho series này: đọc `sum by (reason) (increase(uniwork_ai_uniwork_dropped_tool_calls_total[15m]))` bằng Explore · **Nền:** [`docs/ops/RUNBOOK_AI.md`](../ops/RUNBOOK_AI.md)

## Triệu chứng

- Alert `UniworkAiDroppedToolCalls`: hơn 20 tool call trong 15 phút bị allowlist bỏ cho một `reason` (`uniwork_ai_uniwork_dropped_tool_calls_total`): `view_only` hoặc `not_allowlisted`.
- Người dùng có thể thấy trợ lý "không làm gì" hoặc làm thiếu; không có thay đổi tài liệu nào bị áp trái phép (bỏ là hành vi an toàn).

## Kiểm tra

1. `view_only`: client gửi công cụ ghi cho người chỉ có quyền xem; kiểm bản app/frame vừa phát hành (grant `uniwork_ai`, `viewOnly`).
2. `not_allowlisted`: model gọi công cụ ngoài danh sách; model hoặc instruction pack vừa đổi? Nhiều lần liên tiếp từ một nguồn có thể là prompt injection từ nội dung tài liệu.
3. Chỉ dùng số đếm và id; không đọc nội dung lượt.

## Khắc phục

- `view_only`: sửa client; server đã chặn đúng.
- `not_allowlisted`: đổi model hoặc hoàn tác instruction pack; không mở rộng allowlist để làm cảnh báo im.

## Leo thang

`not_allowlisted` tăng cùng dấu hiệu injection (cùng tổ chức/tài liệu): báo người phụ trách bảo mật và owner AI server (G6-03b).
