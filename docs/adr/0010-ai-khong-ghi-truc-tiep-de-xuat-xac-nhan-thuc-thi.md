# 0010 — AI không ghi dữ liệu nghiệp vụ trực tiếp: đề xuất → xác nhận → thực thi

**Trạng thái:** accepted (2026-09-04) — chấp nhận bởi quangpd trong phiên Giai đoạn 0 (UNI-420). Luật tương ứng vào `CLAUDE.md` cùng lúc với test giữ luật (xem mục cuối); đến lúc đó reviewer giữ luật bằng tay theo DoD.
`unidigiwork/docs/architecture/ADR_AI_ACTION_PROPOSE_CONFIRM_EXECUTE.md` và
`ADR_AI_PERMISSION_AWARE_CONTEXT.md`.

## Bối cảnh

Một agent có quyền như thành viên (ADR 0007) nhưng model có thể sai, bị prompt injection,
hoặc hiểu nhầm ngữ cảnh. Bản cũ đã chốt và kiểm thử bất biến: AI chỉ tạo đề xuất; trạng
thái kết thúc của lượt chạy AI chỉ là `WAITING_REVIEW` hoặc `FAILED`; `ACCEPTED` chỉ con
người ghi được; orchestrator chỉ đọc. Vision §6.1 và `PRODUCT.md` § Agent Principles giữ
nguyên yêu cầu này và thêm "hoàn tác với cùng affordance như người".

Meeting summary hiện gọi Claude và ghi `meeting_summaries` trực tiếp, và
`POST /meetings/{id}/summary/tasks` tạo task ngay theo lệnh của người, không phải của AI.
Điều đó hợp lệ (người bấm) nhưng cần được nói rõ để không thành tiền lệ.

## Quyết định

1. Mã trong `server/internal/ai` và mọi agent runtime **không có** quyền gọi service
   method ghi nghiệp vụ. Kết quả của AI chỉ được ghi vào các bảng thuộc AI bounded context:
   `agent_runs`, `agent_deliverables`, `action_proposals`, `ai_usage_events`.
2. Hành động ghi nghiệp vụ do agent đề xuất đi qua `action_proposals`:
   `proposed → confirmed | rejected → executed | failed`. Bước `executed` do service
   nghiệp vụ thực hiện với actor là **người xác nhận** làm `confirmed_by` và agent làm
   `created_by` (+ `created_by_kind = agent`), để attribution đủ hai phía.
3. Ngoại lệ tự động chỉ cho hành động có `risk_level = low` trong tool registry **và**
   organization đã bật policy cho phép; danh sách hành động low-risk là enum đóng trong
   mã, không cấu hình từ UI. Mặc định: không tự động.
4. Trạng thái kết thúc của `agent_runs` do runtime ghi chỉ là `waiting_review` hoặc
   `failed`. `accepted` / `changes_requested` chỉ được ghi bởi actor `human`.
5. Mọi hành động đã `executed` phải có `undo` tương ứng (compensating command) ghi audit
   riêng; nếu không có undo thì hành động không được đưa vào tool registry.
6. Ngữ cảnh đưa vào model chỉ gồm dữ liệu actor người khởi tạo (hoặc owner của agent)
   được phép đọc; nội dung người dùng luôn được bọc dấu "không tin cậy".

## Hệ quả

- `arch_test.go`: package `ai` và `agents` không import các service ghi nghiệp vụ; chỉ
  import interface đọc.
- Bảng `action_proposals` có cột `executed_by` (human) và `created_by_kind = agent`.
- Meeting summary: giữ nguyên, nhưng "tạo task từ tóm tắt" chuyển sang proposal khi agent
  chủ động, người bấm thì vẫn trực tiếp.
- Cái giá: agent chậm hơn vì chờ người; bù lại là điều kiện để khách hàng tin.

## Test giữ luật (điều kiện để đưa luật vào `CLAUDE.md`)

- `server/internal/arch_test.go`: ràng buộc import cho `ai/` và `agents/`.
- `server/internal/agents/lifecycle_test.go` (mới): runtime không thể đặt `accepted`;
  `accepted` từ actor agent bị từ chối.
- Test tool registry: mọi tool có `undo` hoặc `risk_level != low` và không auto.
