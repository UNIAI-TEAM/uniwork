# UniChat mobile — Deep link và phản hồi thông báo

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

`app/+native-intent.ts`, `lib/deep-link.ts`, `lib/notification-response.ts`. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- `app/+native-intent.ts` — expo-router tự route mọi URL từ OS; file này map
  `<scheme>://open?url=` và callback PKCE qua `lib/deep-link.ts ›
  systemPathToRoute` (thuần, có test). Đây là allowlist: chỉ link chat cùng origin (universal, bọc `open?url=` hay
  path trần), link mời `/invite/{token}` (`parseInviteLink`; mở `app/(app)/invite/[token].tsx`, màn xem trước không
  bao giờ tự nhận lời mời; `/invite/meeting/…` vẫn là của web) và callback được route; URL nào khác — kể cả `uniworkchat://account` hay App Link tới
  `/{org}/{ws}/room/{id}/info` — về `/` (`app/index.tsx` đưa về trang chủ hoặc đăng nhập), vì app hay trang web nào
  cũng bắn được URL vào máy (audit "Security & privacy", deep-link-catch-all; `lib/deep-link.test.ts` kê từng route
  trong). `openUrl` ở `app/_layout.tsx` chỉ
  `router.push` cho chạm thông báo; URL Linking không push lần hai. Link chat hay link mời tới khi chưa ai đăng nhập
  (lời mời thường mở trước khi có tài khoản) chờ qua đăng nhập dưới dạng href trong app (`incomingUrlAction` › `keep`,
  `setPendingLink`/`takePendingLink`); `app/index.tsx` lấy nó một lần khi đã có người dùng đã xác minh địa chỉ. Phản hồi thông báo đi qua
  `lib/notification-response.ts` (thuần): listener của app đang chạy và, cho lần chạm mở app đã bị kill,
  `Notifications.getLastNotificationResponse()` đọc một lần lúc boot (không trông vào listener đăng ký kịp); mỗi
  (thông báo, hành động) chạy một lần, đã xử lý thì `clearLastNotificationResponse` (reload JS không chạy lại); trên
  Android chỉ lấy lần chạm từ đó — Trả lời/Đánh dấu đã đọc đã chạy ở task nền.
