# Runbook — Connector MCP

> **Trạng thái:** shipped · **Cập nhật:** 2026-10-14 · **Thành phần:** OAuth server và `/mcp` trong tiến trình API (`server/internal/service/mcp_*.go`) · **Liên quan:** ADR 0031, ADR 0033, UNI-1308, UNI-1567

Ứng dụng AI bên ngoài (Claude, ChatGPT, Gemini) vào UniWork qua `/mcp` bằng
token `uwm_at_` của một grant. Đọc cần cờ `mcp_connector` và công tắc của tổ
chức; ghi cần thêm cờ `mcp_connector_write` và công tắc ghi của tổ chức.

## Tắt riêng phần ghi

Khi một ứng dụng AI ghi sai hàng loạt: ở `/admin/flags`, đặt override `mcp_connector_write` = false
(toàn cục, hoặc tổ chức bị ảnh hưởng, lý do ≥ 10 ký tự). Tool ghi biến mất ngay ở lần `tools/list`
kế tiếp và mọi lời gọi tool ghi trả `write_disabled`; phần đọc chạy tiếp, không thu hồi token.
Admin tổ chức cũng tự tắt được ở Cài đặt › Truy cập AI › "Cho phép tạo và sửa".
Lần ra lệnh nào do ứng dụng nào: `audit_events.metadata::jsonb->'via'->>'grant_id'` (cột `metadata` là `TEXT`, nên cần ép `::jsonb`).
