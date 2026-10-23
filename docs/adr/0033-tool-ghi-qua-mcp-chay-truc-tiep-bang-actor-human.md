# 0033 — Tool ghi qua MCP chạy trực tiếp bằng actor human của người đã đồng ý

**Trạng thái:** accepted (2026-10-14) — chấp nhận bởi bavinh2803 trong brainstorm của spec
`2026-10-14-mcp-connector-write-design.md` (UNI-1567). Thay §3 của
[0031](0031-uniwork-la-oauth-server-cho-client-ai-ben-ngoai.md); các mục còn lại của 0031 giữ nguyên.

## Bối cảnh

ADR 0031 mở connector MCP chỉ đọc và hẹn rằng tool ghi, khi có, sẽ theo ADR 0010: AI chỉ
đề xuất, người duyệt trong UniWork rồi mới thực thi qua `action_proposals`. Bảng đó thuộc
agent runtime (A-01/A-02) và chưa tồn tại. Người dùng muốn tạo và sửa task, dự án, lịch
họp, tài liệu ngay trong Claude, ChatGPT, Gemini, ngang với các connector chuẩn, trước
khi nộp Directory.

ADR 0010 nhắm agent **tự chạy** trong UniWork: không người nào bấm trước khi nó ghi. Qua
MCP, lệnh ghi do chính người đã đồng ý khởi động trong cuộc trò chuyện, và client hỏi
người đó trước mỗi tool không có `readOnlyHint`. Bắt người đó mở UniWork để duyệt lại
lệnh vừa duyệt trong client là hai lần hỏi cho một ý định.

## Quyết định

1. Tool ghi qua MCP gọi service nghiệp vụ bằng `service.Human(userID)` của người đã đồng
   ý, qua `RequireMember` như màn hình. Không đi qua `action_proposals`.
2. ADR 0010 giữ nguyên cho agent runtime của UniWork. Ranh giới là ai khởi động lệnh:
   người qua client MCP, hay agent tự chạy. Có model ở giữa không làm lệnh thành của agent.
3. Điều kiện bắt buộc, thiếu một thì tool ghi không tồn tại:
   - scope `write` do người dùng tự chọn ở màn đồng ý, mặc định không chọn;
   - admin tổ chức bật riêng phần ghi, cùng flag rollout `mcp_connector_write`;
   - không có tool xóa;
   - mọi tool ghi khai cách hoàn tác (`ai.Tool.Undo`); hủy họp có lệnh khôi phục;
   - mọi lệnh sửa gửi `revision` đã đọc, lệch thì từ chối;
   - dòng audit của lệnh ghi qua MCP mang `metadata.via` (client, grant); `actor_kind`
     vẫn là `human`.
4. Dữ liệu connector đọc và ghi gồm task, dự án, cuộc họp, tài liệu trang. Chat, Email
   Hub, transcript vẫn ngoài phạm vi (ADR 0031 §4).

## Hệ quả

- `TestMCPToolsAreReadOnly` thay bằng bốn test: tool đọc không ghi; tool ghi cần đủ scope,
  flag và công tắc tổ chức; không có tool xóa; mọi tool ghi khai hoàn tác.
- `audit.RequestInfo` có thêm `Via`; `Recorder` ghi nó vào metadata của mọi dòng trong
  request `/mcp`.
- Thêm hai cột `organizations.mcp_write_enabled_at/_by` và lệnh `MeetingService.Restore`.
- Cái giá: UniWork không tự kiểm được bước hỏi của client; một client cấu hình "luôn cho
  phép" sẽ ghi không hỏi. Bù bằng không có xóa, ngân sách 30 lệnh ghi/phút/grant, hoàn tác
  và `via` để lần ra, và admin tắt được tức thì.

## Test giữ luật

- `TestMCPReadToolsDoNotMutate`, `TestMCPWriteToolsNeedScopeFlagAndPolicy`,
  `TestMCPHasNoDeleteTool`, `TestMCPWriteToolsDeclareUndo` (Phase 0 của spec).
- `TestIsolationMCP` mở rộng sang mọi tool ghi.
- Cho tới khi Phase 0 merge, `TestMCPToolsAreReadOnly` vẫn giữ connector chỉ đọc; luật
  vào `CLAUDE.md` cùng PR thay test.
