# 0035 — Agent được share tài liệu ở mức Nhận xét/Chỉnh sửa thì ghi trực tiếp, không qua đề xuất

**Trạng thái:** proposed (bản nháp, quyết định người dùng 2026-10-15: agent tự chạy được coi như một người; được share thì "luôn ghi trực tiếp như người", tối đa Chỉnh sửa). **Chưa chấp nhận**: nằm ở `drafts/` cho tới khi người giữ ADR 0010 ký; code SH-S4 không bắt đầu trước đó. Số 0035 là tạm, đổi nếu ADR khác land trước.
**Bổ sung cho 0010** (không sửa nó): thay điểm 1–3 của [0010](../0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md) **chỉ** cho lệnh ghi lên một tài liệu mà agent được share trực tiếp; mọi hành động khác của agent vẫn theo 0010. Tiền lệ: [0033](../0033-tool-ghi-qua-mcp-chay-truc-tiep-bang-actor-human.md) (ghi qua MCP trực tiếp bằng actor human).
**Spec:** [`2026-10-15-documents-share-srs-addendum.md`](../../superpowers/specs/2026-10-15-documents-share-srs-addendum.md) §6.6.

## Bối cảnh

ADR 0007 coi agent là actor hạng nhất; ADR 0010 nói agent "có quyền như thành viên" nhưng mọi lệnh ghi nghiệp vụ đi qua `action_proposals` (đề xuất → người xác nhận → thực thi), trừ hành động rủi ro thấp khi tổ chức bật policy. Code tài liệu hôm nay còn chặt hơn: agent tối đa `view`, không thấy tài liệu riêng tư (`document_permissions.go:120-126`), không bình luận trực tiếp (phụ lục G8, bất biến 7).

SRS Share v1.0 làm tài liệu mới mặc định **riêng tư** (quyết định U-SH2). Người dùng muốn agent vẫn hỗ trợ được công việc trên tài liệu đó: được chia sẻ như một thành viên, và khi được cấp Nhận xét/Chỉnh sửa thì làm việc ngay như người, không chờ duyệt từng lệnh.

Khác 0033: ở MCP, người khởi động từng lệnh. Ở đây agent tự chạy; sự đồng ý của con người nằm ở **lần chia sẻ**: người có quyền Quản lý tài liệu chọn đích danh agent và mức quyền, có audit, thu hồi được bất cứ lúc nào.

## Quyết định

1. `agent` là một `principal_type` của share tài liệu (bên cạnh `user`, `workspace`, `organization`). Mức cấp được: `view`, `comment`, `edit`. **Không** `manage` (agent không chia sẻ, đổi quyền, tạo liên kết, chuyển chủ, archive).
2. Mức ghi chỉ đến từ **share trực tiếp cho agent**. Share Workspace (kể cả dòng Workspace gốc) và Tổ chức cho agent thành viên tối đa `view`, như hôm nay — một lần bật "Chia sẻ với workspace" không biến mọi agent của workspace thành người sửa mọi tài liệu.
3. Agent có share `comment`/`edit` gọi lệnh bình luận / sửa nội dung của `DocumentService` **trực tiếp** với `service.Agent(agentID)`, `created_by_kind = agent`; không qua `action_proposals`, không cần policy tổ chức.
4. Điều kiện bắt buộc, thiếu một thì lệnh ghi bị từ chối:
   - share của agent còn sống **và** người khởi chạy lượt chạy (hoặc owner của agent khi chạy theo lịch) đọc được tài liệu lúc ghi (điểm 6 của 0010 áp cho cả ghi), để không ai nhờ agent đọc/ghi hộ tài liệu mình không có quyền;
   - mọi lệnh sửa gửi `revision` đã đọc, lệch thì `409` như người;
   - mỗi lần sửa nội dung là một phiên bản mới ghi tên agent — hoàn tác = khôi phục phiên bản trước (lệnh đã có), không cần lệnh bù mới;
   - không có lệnh xóa, archive, đổi quyền cho agent (điểm 1);
   - ngân sách ghi theo agent (đề xuất 60 lệnh/phút/agent/tổ chức) để một vòng lặp hỏng không ghi tràn;
   - admin tổ chức tắt được tức thì toàn bộ quyền ghi tài liệu của agent (công tắc, mặc định bật), và người Quản lý tài liệu thu hồi share của agent như mọi share khác.
5. Trạng thái `agent_runs` và luật `accepted` chỉ do human ghi (điểm 4 của 0010) giữ nguyên: ghi trực tiếp vào tài liệu không làm lượt chạy tự `accepted`.

## Hệ quả

- `server/internal/ai` và agent runtime vẫn không import service ghi. Runtime nhận một port hẹp `DocumentAgentWriter` (bình luận, sửa nội dung, tạo phiên bản) do `DocumentService` cài, mọi kiểm ở điểm 4 nằm trong service. `arch_test.go` thêm ràng buộc: port này là đường ghi nghiệp vụ duy nhất của agent ngoài `action_proposals`.
- Bỏ bất biến "agent không bình luận trực tiếp" của phụ lục G8 cho tài liệu có share `comment`/`edit` cho agent; luồng mention/thông báo coi agent như tác giả.
- Picker chia sẻ trả cả agent của tổ chức (loại `agent`, biểu tượng riêng); danh sách quyền, huy hiệu phạm vi và audit hiện agent đúng loại.
- Cái giá: model có thể sai hoặc bị prompt injection và sửa tài liệu không ai duyệt trước. Bù bằng: chỉ trên tài liệu được share đích danh, không xóa/không đổi quyền, mọi lần sửa là một phiên bản hoàn tác được, audit `actor_kind=agent` + `run_id`, ngân sách ghi, và công tắc tắt tức thì.

## Test giữ luật (điều kiện để chấp nhận và đưa vào `CLAUDE.md`)

- `TestAgentDocumentWriteNeedsDirectShare` — share Workspace/Tổ chức cho agent không cho ghi; share trực tiếp `edit` cho ghi; `manage` cho agent bị từ chối lúc cấp.
- `TestAgentDocumentWriteNeedsInitiatorRead` — người khởi chạy không đọc được tài liệu → lệnh ghi của agent bị từ chối.
- `TestAgentDocumentWriteIsVersionedAndAudited` — mỗi lần sửa có phiên bản và audit `actor_kind=agent`, khôi phục được.
- `TestAgentDocumentWriteRespectsOrgSwitch` + giới hạn tần suất.
- `arch_test.go`: `DocumentAgentWriter` là port ghi duy nhất của runtime ngoài `action_proposals`; `TestAgentRuntimeCannotSetAccepted` (0010) giữ nguyên.
