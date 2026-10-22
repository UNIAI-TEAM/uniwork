# UniChatReportFiled — có báo cáo vi phạm đang chờ trong UniChat

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (nhóm `uniwork-app-builds`) · **Metric:** `uniwork_chat_reports_open` (`metrics.ChatReportQueueCollector`, đọc các dòng `chat_reports` đang mở lúc scrape)

## Triệu chứng

- Alert `UniChatReportFiled` bật: có ít nhất một báo cáo tin nhắn hoặc người (nhấn giữ tin › Báo cáo, chi tiết cuộc trò
  chuyện › Báo cáo) từ web, máy tính hay điện thoại đang mở. Alert đọc trạng thái hàng đợi, không đếm tốc độ: nó bật
  ngay từ báo cáo đầu tiên và **còn bật tới khi mọi báo cáo được đóng**. Không phải sự cố hệ thống: là việc của nhà vận
  hành.
- Báo cáo chờ quá 20 giờ thì [UniChatReportOverdue](UniChatReportOverdue.md) (sev 2) kêu thêm.
- Điều khoản sử dụng (`/terms#acceptable-use`) và ghi chú cho reviewer của App Store/Play hứa nhà vận hành xem mọi báo
  cáo **trong 24 giờ**; Apple 1.2 đòi gỡ nội dung và loại người đăng trong thời hạn đó. Chủ sở hữu và quản trị viên của
  tổ chức cũng thấy báo cáo trong Nhật ký hoạt động của họ và xử lý được trước.
- Báo cáo gửi thẳng tới `contact@unicomhub.com` không bật alert này: hộp thư đó có người trực theo cùng hạn 24 giờ.

## Kiểm tra

1. Mở console `/admin/chat-reports` (vai trò platform `support` đọc được, `admin` mới đóng được): bộ lọc "Đang chờ",
   số báo cáo chờ và báo cáo chờ lâu nhất ở đầu trang. Mỗi dòng có tổ chức, lý do, người bị báo cáo, người báo cáo, tin
   nhắn (nếu có) và thời điểm — không có nội dung tin hay lời mô tả: console không bao giờ đọc nội dung.
2. Tổ chức nào, đã bị tạm ngưng chưa: bấm tên tổ chức để mở trang chi tiết (thành viên, gói, 20 thao tác admin gần nhất).
3. Một tổ chức có nhiều báo cáo về cùng một người trong thời gian ngắn, hay lý do `self_harm`/`violence`: xử lý trước.
4. Cần nội dung để đánh giá: liên hệ chủ sở hữu tổ chức (email trên trang chi tiết tổ chức hay qua `contact@unicomhub.com`)
   — họ đọc được tin trong workspace và lời mô tả của người báo cáo trong bản xuất dữ liệu của tổ chức.

## Khắc phục

- Nội dung vi phạm điều khoản: yêu cầu chủ sở hữu/quản trị viên của tổ chức xoá tin và gỡ hoặc vô hiệu hoá người đăng
  (Cài đặt › Tổ chức trên web). Tổ chức không làm trong hạn, hay chính chủ sở hữu là người vi phạm: tạm ngưng tổ chức ở
  `/admin/organizations/<id>` (lý do ≥ 10 ký tự; mọi thành viên nhận 403 `organization_suspended`).
- Xong việc (đã xử lý, hay báo cáo không có cơ sở): bấm "Đóng báo cáo" trên dòng đó, ghi lý do ≥ 10 ký tự (vd. "đã yêu cầu
  chủ sở hữu gỡ tin, đã gỡ 14:20"). Một dòng `admin_actions` và một dòng audit `chat.report.resolved` trong tổ chức đó
  được ghi cùng transaction: chủ sở hữu thấy nhà vận hành đã xử lý.
- Alert tắt khi báo cáo mở cuối cùng được đóng (`uniwork_chat_reports_open` về 0), không tự tắt theo thời gian.

## Leo thang

- Nội dung có dấu hiệu phạm pháp (xâm hại trẻ em, đe doạ tính mạng, khủng bố): báo ngay người giữ pháp chế của công ty và
  làm theo nghĩa vụ báo cáo với cơ quan chức năng; tạm ngưng tổ chức nếu cần ngăn lan rộng, không chờ tổ chức tự xử lý.
- Hàng đợi có báo cáo mở quá 20 giờ: [UniChatReportOverdue](UniChatReportOverdue.md) tự kêu (sev 2); báo người trực
  vận hành kế tiếp ở kênh `#uniwork-incident` để kịp hạn 24 giờ.
- Gauge vắng mặt (`uniwork_chat_reports_up` = 0): [QueueLagUnreadable](QueueLagUnreadable.md) kêu; trong lúc đó mở thẳng
  `/admin/chat-reports` mỗi vài giờ.
