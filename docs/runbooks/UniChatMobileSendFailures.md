# UniChatMobileSendFailures — một bản UniChat mobile gửi tin hỏng nhiều

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` (nhóm `uniwork-app-builds`) · **Metric:** `uniwork_mobile_events_total{event="message_send"}`

## Triệu chứng

- Alert `UniChatMobileSendFailures` bật cho một `os` và `client_version`: trong 1 giờ, trên 5 % tin gửi (ít nhất 50) của
  bản đó **hỏng hẳn** — bong bóng đỏ "Không gửi được" kèm nút Thử lại. Mạng chậm hay mất mạng **không** tính: tin đó
  nằm chờ và tự đi khi có mạng (`apps/chat-mobile/data/chat-send.ts`); hỏng hẳn là server từ chối (4xx vĩnh viễn), tệp
  đính kèm đã mất trên máy, hay cùng một tin hỏng nhiều lần liên tiếp vì chính nó (`MAX_SEND_ITEM_FAILURES`).
- Người dùng bản đó kêu tin không đi, nhất là tin có ảnh/tệp hay trong một kiểu phòng.
- Bộ đếm đến từ chính máy (gửi khi đã đăng nhập và không tắt thống kê ẩn danh), nên là cận dưới. Một bản vẫn
  crash-free mà gửi hỏng thì job sức khoẻ bản phát hành không dừng nó: alert này là tín hiệu đó.

## Kiểm tra

1. Bản nào, OTA nào, từ khi nào? Explore:
   ```promql
   sum by (os, client_version, client_update, result) (increase(uniwork_mobile_events_total{event="message_send"}[1h]))
   ```
   Chỉ một `client_update` lệch là lỗi JS của bản OTA đó; mọi update của một `client_version` lệch là binary hoặc server.
2. Server: `uniwork_http_client_requests_total{platform="mobile", status_class="4xx"}` theo `client_version` và log truy
   cập của `POST /api/v1/workspaces/{id}/chat/rooms/{id}/messages` (và upload tệp) cho bản đó; deploy server gần nhất ở
   panel **Bản build đang chạy** — server đổi hợp đồng (trường bắt buộc mới, giới hạn cỡ tệp) là nguyên nhân hay gặp.
3. Sentry của bản đó: issue mức `warning` tag `endpoint` là route gửi tin, `http_status`/`error_code` cho biết server
   nói gì; breadcrumb `chat-send` của các báo cáo khác.
4. Chỉ tin có tệp: kích cỡ ảnh sau khi thu nhỏ, loại tệp, và breadcrumb `outbox copy failed` (tệp gốc mất trước khi gửi).

## Khắc phục

- Server đổi hợp đồng: sửa hoặc rollback server — tin hỏng hẳn không tự gửi lại, người dùng bấm Thử lại sau khi sửa.
- Lỗi JS trong một bản OTA: "UniChat mobile rollback" (`chat-mobile-rollback.yml`) — `revert-rollout` nếu còn rollout,
  `republish-previous` nếu đã 100 % — rồi phát bản sửa với `critical`.
- Lỗi binary: "UniChat mobile promote" › `halt` (Android) hay `platform: ios` › `halt` (pause phased release), sửa và
  phát bản store mới. Chỉ gửi ảnh/tệp hỏng: tắt `unichat_mobile_media_upload` ở console admin trong lúc chờ.

## Leo thang

- Trên 20 % kéo dài 1 giờ, hoặc là bản đa số người dùng đang chạy → người giữ bản phát hành mobile và on-call backend
  (kênh `#uniwork-incident`), kèm `client_version`, `client_update`, route và mã lỗi đứng đầu.
