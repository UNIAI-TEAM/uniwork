# UniChatReportOverdue — một báo cáo vi phạm UniChat đã chờ quá 20 giờ

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` (nhóm `uniwork-app-builds`) · **Metric:** `uniwork_chat_reports_oldest_open_age_seconds` (`metrics.ChatReportQueueCollector`)

## Triệu chứng

- Alert `UniChatReportOverdue` bật: báo cáo mở lâu nhất trong hàng đợi `/admin/chat-reports` đã chờ hơn 20 giờ. Điều
  khoản sử dụng (`/terms#acceptable-use`) và ghi chú cho reviewer của App Store/Play hứa nhà vận hành xem mọi báo cáo
  **trong 24 giờ**; còn chưa tới 4 giờ.
- [UniChatReportFiled](UniChatReportFiled.md) đã bật từ lúc báo cáo tới và vẫn bật: ticket đó chưa ai nhận.
- Alert đọc trạng thái hàng đợi lúc scrape (các dòng `chat_reports` có `status = 'open'`), nên chỉ tắt khi báo cáo đó
  được đóng.

## Kiểm tra

1. Mở `/admin/chat-reports`, bộ lọc "Đang chờ": báo cáo chờ lâu nhất ở đầu trang (tổ chức, lý do, người và tin bị báo
   cáo, người báo cáo, thời điểm).
2. Đối chiếu số trên Prometheus nếu console không mở được:
   ```promql
   max(uniwork_chat_reports_open)
   max(uniwork_chat_reports_oldest_open_age_seconds) / 3600
   ```
3. Có ai đang xử lý chưa: ticket của [UniChatReportFiled](UniChatReportFiled.md) và kênh `#uniwork-incident`.

## Khắc phục

- Làm theo phần Khắc phục của [UniChatReportFiled](UniChatReportFiled.md) ngay, ưu tiên báo cáo cũ nhất.
- Chủ sở hữu tổ chức không trả lời kịp và nội dung rõ ràng vi phạm điều khoản: tạm ngưng tổ chức ở
  `/admin/organizations/<id>` trước hạn 24 giờ (lý do ≥ 10 ký tự), rồi đóng báo cáo kèm lý do.
- Báo cáo không có cơ sở: đóng ngay kèm lý do ≥ 10 ký tự; alert tắt ở lần scrape kế tiếp.

## Leo thang

- Không có tài khoản platform `admin` nào trực (chỉ `admin` đóng được báo cáo): gọi người giữ vai trò `admin` qua
  `#uniwork-incident`; cấp vai trò chỉ bằng `server/cmd/uniwork-admin`.
- Quá 24 giờ: ghi lại sự cố (báo cáo nào, trễ bao lâu, vì sao) cho người giữ pháp chế; App Store có thể hỏi lại theo
  Apple 1.2.
