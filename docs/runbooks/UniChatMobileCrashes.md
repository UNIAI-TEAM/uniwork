# UniChatMobileCrashes — một bản UniChat mobile crash nhiều

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` (nhóm `uniwork-app-builds`) · **Metric:** `uniwork_mobile_events_total{event="app_crash"}`, `uniwork_mobile_events_total{event="app_open",result="cold"}`

## Triệu chứng

- Alert `UniChatMobileCrashes` bật cho một `os` và `client_version`: trong 1 giờ, trên 2 % lần mở lạnh (ít nhất 50) của
  bản đó đến ngay sau một lần app crash. Ngưỡng gấp bốn lần sàn crash-free 99,5 % mà rollout dùng: đây là sự cố, không
  phải một bản hơi kém.
- Người dùng kêu app tự tắt, nhất là ngay lúc mở hay khi vào một màn cụ thể.
- Số đếm đến từ chính máy lần mở kế tiếp (`apps/chat-mobile/data/release/launch-health.ts`, `crashedLastRun` của
  Sentry): chỉ bản build có `SENTRY_DSN` đếm được, chỉ người đã đăng nhập và không tắt thống kê ẩn danh, và crash lặp
  lúc mở mà người dùng bỏ app luôn thì không bao giờ được kể. Là cận dưới; Sentry là con số thật.

## Kiểm tra

1. Bản nào, OTA nào? Explore:
   ```promql
   sum by (os, client_version, client_update) (increase(uniwork_mobile_events_total{event="app_crash"}[1h]))
   ```
   `client_update` là bản máy chạy **khi kể** (lần mở sau crash); một bản OTA hỏng lúc khởi động bị expo-updates bỏ
   qua nên crash của nó có thể hiện dưới bản trước — xem thêm alert `UniChatMobileUpdateLaunchFailures`.
2. Sentry → Releases: release `com.uniworkos.chat@<version>+<build>.<os>` (bundle nhúng) hay
   `…<os>.ota.<id>` (một bản OTA) có crash-free sessions thấp nhất; Issues lọc `error.unhandled:true` và release đó,
   sắp theo số người. Issue mới chỉ có ở release này là nghi phạm chính.
3. Job `chat-mobile-release-health.yml` mỗi giờ đã xử lý chưa (summary): halt Play, tạm dừng phased release của App
   Store, hay revert OTA.
4. Server có đổi gì cùng lúc không (deploy gần nhất ở panel **Bản build đang chạy**); `UniChatMobileServerErrors` cùng
   bật thì crash có thể do câu trả lời lạ của server mà app không chịu được.

## Khắc phục

- Lỗi trong một bản OTA còn rollout: Actions → "UniChat mobile rollback" (`chat-mobile-rollback.yml`) → `revert-rollout`.
  Đã 100 %: `republish-previous` hay `roll-back-to-embedded`. Rồi phát bản sửa với `critical`.
- Lỗi binary (Android): "UniChat mobile promote" › `halt` (job sức khoẻ làm khi đủ ngưỡng); iOS: "UniChat mobile
  promote" › `platform: ios`, `action: halt` (tạm dừng phased release). Sửa, bump patch, cắt bản store mới.
- Lỗi chỉ ở một tính năng có công tắc (gọi, gửi ảnh, tin thoại, Bắt kịp nhanh, sync): tắt công tắc đó ở console admin
  trong lúc chờ bản sửa (runbook phát hành › Chặn bản cũ và tắt tính năng từ server).

## Leo thang

- Trên 5 % kéo dài 1 giờ, hoặc là bản đa số người dùng đang chạy → người giữ bản phát hành mobile và on-call backend
  (kênh `#uniwork-incident`), kèm `client_version`, release Sentry và issue đứng đầu.
