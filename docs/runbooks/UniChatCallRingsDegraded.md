# UniChatCallRingsDegraded — một bản UniChat Android không đổ chuông cuộc gọi bằng màn native

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (nhóm `uniwork-app-builds`) · **Metric:** `uniwork_mobile_events_total{event="call_push"}`

## Triệu chứng

- Alert `UniChatCallRingsDegraded` bật cho một `client_version`: trong 1 giờ, trên 10 % push cuộc gọi (ít nhất 20) tới
  máy Android của bản đó không thành màn đổ chuông native (`CallStyle`, toàn màn hình trên máy khoá, nhạc chuông lặp):
  `fallback` là một thông báo thường trên kênh "Cuộc gọi nhỡ" (bấm thì mở màn đổ chuông, không reo lặp), `lost` là
  không thông báo nào.
- Người dùng bản đó kêu "gọi không đổ chuông", "chỉ thấy thông báo", hoặc người gọi thấy hết giờ dù máy kia có mạng.
- Số đếm đến từ chính máy (`data/calls/call-push.ts` → `track({ name: "call_push" })`, gửi khi app ở foreground; một
  lần đổ chuông lúc app đã bị kill mà người dùng không mở app thì không được đếm), nên tỷ lệ là cận dưới.

## Kiểm tra

1. Bản nào, kết quả nào, từ khi nào? Explore:
   ```promql
   sum by (client_version, client_update, result) (rate(uniwork_mobile_events_total{event="call_push"}[1h]))
   ```
   Chỉ một `client_update` (OTA) lệch là lỗi JS; mọi update của một `client_version` lệch là binary (module native,
   manifest, quyền).
2. `fallback` nhiều: `showIncomingCall` trả false — hệ thống từ chối post (thiếu `POST_NOTIFICATIONS`, kênh `calls` bị
   người dùng tắt, Android 14 thu hồi full-screen intent thì vẫn `shown` dạng heads-up). Sentry của bản đó: breadcrumb
   `call push` ghi `outcome`. Kiểm `android-manifest.test.ts` của tag `chat-mobile-v<version>` còn `USE_FULL_SCREEN_INTENT`
   và dịch vụ cuộc gọi.
3. `lost` nhiều: cả thông báo thường cũng không post được (thông báo của app bị tắt hẳn, hay lỗi JS trong task nền).
   Sentry: lỗi `call push failed` / `ring lost` theo release `com.uniworkos.chat@<version>+…`.
4. Server có đổi push không: `push_expo.go › expoMessageFor` (data-only cho `expo/android; call-ui`), kênh và TTL; deploy
   gần nhất ở panel **Bản build đang chạy**.

## Khắc phục

- Lỗi JS trong một OTA: dừng OTA đó (runbook `unichat-mobile-release.md` › Khắc phục), phát bản sửa với `critical`.
- Lỗi binary: halt staged rollout ("UniChat mobile promote" › `halt`), sửa và phát bản store mới; trong lúc chờ, cuộc
  gọi vẫn tới dạng thông báo thường — chỉ tắt gọi (`unichat_mobile_calls`) khi cả `lost` cao.
- Do máy người dùng (kênh "Cuộc gọi đến" bị tắt, tối ưu pin của OEM): hướng dẫn trong Cài đặt › Thông báo của app
  (dòng bật lại toàn màn hình), không cần phát bản.

## Leo thang

- `lost` trên 10 % kéo dài 2 giờ, hoặc bản lỗi là bản đa số người dùng đang chạy → người giữ bản phát hành mobile và
  on-call backend (kênh `#uniwork-incident`), kèm `client_version`, `client_update` và vài release Sentry.
