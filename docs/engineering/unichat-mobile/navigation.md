# UniChat mobile — Deep link và phản hồi thông báo

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

`app/+native-intent.ts`, `lib/deep-link.ts`, `lib/notification-response.ts`. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- `app/+native-intent.ts` — expo-router tự route mọi URL từ OS; file này map
  `<scheme>://open?url=` và callback PKCE qua `lib/deep-link.ts ›
  systemPathToRoute` (thuần, có test). `openUrl` ở `app/_layout.tsx` chỉ
  `router.push` cho chạm thông báo; URL Linking không push lần hai. Phản hồi thông báo đi qua
  `lib/notification-response.ts` (thuần): listener của app đang chạy và, cho lần chạm mở app đã bị kill,
  `Notifications.getLastNotificationResponse()` đọc một lần lúc boot (không trông vào listener đăng ký kịp); mỗi
  (thông báo, hành động) chạy một lần, đã xử lý thì `clearLastNotificationResponse` (reload JS không chạy lại); trên
  Android chỉ lấy lần chạm từ đó — Trả lời/Đánh dấu đã đọc đã chạy ở task nền.
