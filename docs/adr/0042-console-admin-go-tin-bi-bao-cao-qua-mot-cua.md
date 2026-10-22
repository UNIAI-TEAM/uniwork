# 0042 — Console `/admin` gỡ tin bị báo cáo qua một cửa duy nhất

**Trạng thái:** accepted (2026-10-22) — ghi lại ngoại lệ mà nhánh UniChat mobile 8/10 (UNI-2053) đã đưa vào code:
nhà vận hành gỡ tin bị báo cáo từ console. Bổ sung cho luật "console không chạm content" của F-11
(`CLAUDE.md` § Platform Admin and Observability) và cho [0013](0013-man-tong-quan-la-cua-vao-console-admin.md), không
thay chúng. Test giữ: `TestReportedContentRemoverIsTheConsoleOnlyContentSeam` (`server/internal/arch_admin_takedown_test.go`),
`TestAdminQueriesStayInAdminService`, `server/internal/service/admin_chat_takedown_test.go`.

## Bối cảnh

F-11 dựng console cho metadata xuyên tenant và đặt luật: `admin.go` và `admin_flags.go` không chạm service content
nào, nên console không bao giờ đọc hay trả task, tin nhắn, tệp. `TestAdminQueriesStayInAdminService` giữ luật bằng
cách cấm tên `ChatService`, `TaskService`… trong `admin.go`.

Chính sách nội dung do người dùng tạo của App Store (1.2) và Google Play đòi nhà vận hành hành động trên mọi báo cáo
trong 24 giờ, và "tạm ngưng cả tổ chức" không thể là đòn bẩy duy nhất. Hàng đợi báo cáo đã ở console (chỉ id và lý
do); điều còn thiếu là gỡ đúng một tin. Việc gỡ phải đi cùng giao dịch với `admin_actions`, hàng audit của tổ chức và
việc đóng báo cáo, và phải làm mọi thứ việc người gửi tự xoá làm: nhả tham chiếu tệp, giảm số trả lời của chủ đề, xoá
bình luận công việc chép từ tin đó, phát `chat.message.deleted` sau commit.

`AdminService.RemoveReportedMessage` gọi `ChatService.RemoveReportedMessageQ` qua interface `ReportedContentRemover`
mà `cmd/server/main.go` nối vào. Test cũ vẫn xanh vì lời gọi đi qua interface: luật chữ nói "không bao giờ", test
không còn giữ đúng điều luật nói.

## Quyết định

1. **Một cửa, một việc.** Console thay đổi content đúng một cách: gỡ một tin đã bị báo cáo, qua
   `ReportedContentRemover.RemoveReportedMessageQ`. Interface có đúng một method; `AdminService` không giữ service
   content nào khác; file `admin*.go` không gọi gì khác trên nó; chỉ `cmd/server/main.go` nối nó, và nối
   `ChatService`.
2. **Console vẫn không đọc content.** Cửa nhận id (báo cáo, tổ chức, phòng, tin) và trả về một hàm thông báo sau
   commit; nó không trả nội dung tin cho console. Trang console và API admin vẫn chỉ trả metadata.
3. **Cùng cổng như mọi lệnh ghi của admin.** Vai trò platform `admin`, `reason` ≥ 10 ký tự, `admin_actions` và
   `audit_events` (hàng `chat.message.removed` và `chat.report.resolved` trong tổ chức của báo cáo) trong một giao
   dịch, chung trace id. Phòng ngoài tổ chức của báo cáo là không tìm thấy.
4. **Việc gỡ thứ hai là ADR mới.** Gỡ task, tài liệu, tệp hay tin chưa bị báo cáo từ console cần một ADR mới với cùng
   lập luận: chính sách nào đòi, và vì sao tạm ngưng tổ chức hay quản trị của tổ chức không đủ.

## Hệ quả

- `CLAUDE.md` § Platform Admin nêu ngoại lệ này và tên test giữ nó.
- Thêm method vào `ReportedContentRemover`, thêm field service vào `AdminService`, hay nối một implementer khác làm
  `TestReportedContentRemoverIsTheConsoleOnlyContentSeam` đỏ.
- `ChatService` giữ toàn bộ logic xoá tin; console không nhân đôi nó, nên một thay đổi ở việc xoá tin (tệp, chủ đề,
  bình luận chép) tự đi theo cả việc gỡ của nhà vận hành.
