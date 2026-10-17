# UniChat — Push qua Expo, preview nội dung, bỏ push khi đang hoạt động (lát N2)

> **Trạng thái:** shipped — merge vào develop 2026-10-17 qua PR #333 (squash d4d5aaa31, gộp N1–N3 giai đoạn 1); sửa sau khảo sát usf qua PR #334 (df17638c0); plan `../plans/2026-10-16-unichat-push.md`. Lát N2 của epic UNI-1826; issue UNI-1828. Addendum cho `2026-09-04-notifications-design.md`.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §2 "Push", §3.4, §6 S3–S4 · **Vùng:** `server/internal/notification/`, `apps/web/public/sw.js`

## 1. Mục tiêu

Điện thoại nhận push có nội dung cho DM, nhắc đến, trả lời luồng; không push khi người nhận đang hoạt động trên client khác; không migration, không đổi catalogue sự kiện.

## 2. Hiện trạng

- `notification/push.go`: `PushMessage{Title, URL, Tag}`, `PushSender` interface, `WebPushSender` (VAPID, TTL 1 giờ), `ErrSubscriptionGone` khi 404/410.
- `notification/push_consumer.go`: consumer `notification-push`, topic `TopicPush`, lane `push`; gửi tới mọi subscription của người nhận, bỏ qua khi đã đọc trước lúc gửi.
- `notification/service.go` `SubscribePush`: 404 khi chưa có VAPID, đòi endpoint `https://` và hai khóa khác rỗng.
- `notification/chat_rules.go`: topic `chat.message.mentioned`, `chat.dm.received`, `chat.thread.reply_received` → kind `chat_mentioned`, `chat_dm`, `chat_thread_replied`; đọc lại tin và thành viên lúc giao; mute đọc lúc giao; **không lưu nội dung tin** (bảng `notifications`: `title_key`, `params`, `resource_type`, `resource_id`).
- `service/chat_presence_redis.go`: nhịp 15 giây, TTL 90 giây, theo người dùng.
- `apps/web/public/sw.js`: hiện `title`, mở `url`, gộp theo `tag`; không xét focus.

## 3. Thiết kế

### 3.1 `ExpoPushSender`
`POST https://exp.host/--/api/v2/push/send`, JSON `{to, title, body, data: {url, tag}, sound: "default", channelId: "chat", ttl: 3600, priority: "high"}`, mỗi lần gọi mang đúng một thông điệp (consumer gửi từng subscription; gộp 100 thông điệp là tối ưu sau). Đọc `tickets`: `DeviceNotRegistered` → `ErrSubscriptionGone` (thu hồi như 410); 429/5xx → trả lỗi để lane `push` retry. `EXPO_ACCESS_TOKEN` tùy chọn cho enhanced security, có trong `.env.example`. Client HTTP có timeout 10 giây.

### 3.2 Sender gộp
`prefixSender{expo, web}`: endpoint khớp `^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$` → Expo, còn lại → Web Push. `nil` web sender (chưa VAPID) vẫn cho Expo chạy.

### 3.3 Đăng ký token Expo
Cùng tuyến `POST /me/push-subscriptions`: body `endpoint` khớp mẫu Expo → bỏ qua điều kiện VAPID/https/khóa, `p256dh`/`auth` lưu rỗng, `user_agent` = `expo/ios` hoặc `expo/android`. Trường `platform` của body là bắt buộc với token Expo và chỉ nhận `ios` hoặc `android`. Đăng ký Expo chạy cả khi VAPID tắt. Token không khớp mẫu Expo và không phải https → 400. Web Push giữ nguyên hành vi, kể cả 404 khi thiếu VAPID. Khi VAPID tắt, subscription web có sẵn được đánh dấu đã xử lý mà không gửi.

### 3.4 Preview nội dung (`body`)
`PushMessage.Body string json:"body,omitempty"`. Chỉ ba kind chat; consumer đọc `chat_messages` theo id tin là `resource_id` của notification (tin mới nhất của dòng đã gộp) **lúc giao**. Tin đã xóa lúc giao → không gửi push, đánh dấu `pushed_at`. Văn bản → `service.ChatPreviewBody` (cùng preview của sidebar) rồi bỏ markdown tối thiểu, cắt 120 ký tự theo rune. Tệp/ảnh/thoại → nhãn theo ngôn ngữ người nhận: vi `[Tệp]`/`[Ảnh]`/`[Tin thoại]`, en `[File]`/`[Image]`/`[Voice message]`. `voice_call_log` → không body; các kind khác đi qua `service.ChatPreviewBody`. Bảng `notifications` không lưu body; log không ghi body (`scripts/no-pii-log.test.mjs`). `sw.js` hiện `body` khi có.

### 3.5 Bỏ push khi đang hoạt động
Trước khi gửi, consumer hỏi presence: người nhận có nhịp **từ tab hiện** trong 120 giây gần nhất → không gửi, đánh dấu `pushed_at` (coi như đã xử lý), tăng `uniwork_push_suppressed_total{kind}`. Body của nhịp presence chat mang `visible`, web gửi `document.visibilityState === "visible"`, app mobile gửi `AppState.currentState === "active"`; thiếu `visible` thì nhịp được coi là ẩn và không bao giờ chặn push. Host desktop (UniChat) gửi focus của cửa sổ shell (`useHostFocus`/`isHostFocused`) làm `visible`, vì `visibilityState` của Electron không đổi khi cửa sổ mất focus. Tab ẩn vẫn giữ presence online nhưng không dời khóa nhịp cuối theo người dùng `uw:presence:user:<id>` (TTL 10 phút). Redis tắt hoặc lỗi, hoặc người nhận chưa từng có nhịp → gửi (fail open). Áp cho ba kind chat trước; mở rộng cho kind khác là quyết định sau.

### 3.6 Riêng tư
Nội dung đi qua Expo rồi APNs/FCM. Ghi vào chính sách riêng tư và addendum của spec notifications; tùy chọn tắt preview theo người dùng là pha sau.

## 4. Tiêu chí hoàn thành và test

| Kiểm | Test |
|---|---|
| Expo và Web Push cùng một notification, mỗi subscription đúng sender | `notification/consumer_test.go` / `delivery_test.go` với sender giả ghi lại lời gọi |
| `DeviceNotRegistered` thu hồi; 429/5xx trả lỗi | test sender với `httptest.Server` |
| Đăng ký Expo không cần VAPID; sai mẫu → 400; Web Push vẫn 404 khi thiếu VAPID | `notification/service_test.go` |
| Body đúng ba trường hợp, tin đã xóa không push; không có trong log | test consumer + `scripts/no-pii-log.test.mjs` |
| Nhịp tab hiện 30 giây → không gửi + `uniwork_push_suppressed_total`; 5 phút → gửi; Redis nil → gửi; tab ẩn không dời nhịp | test consumer với presence giả |

Lệnh hẹp: `make test-go` (gói `notification`); `pnpm --filter @uniwork/core test -- notifications` nếu schema client đổi.

## 5. Rủi ro
Giới hạn Expo 600 thông điệp/giây (xa nhu cầu pilot); presence "nối" khác "hoạt động"; preview làm lộ nội dung trên màn hình khóa — đã là quyết định chủ sở hữu.

## 6. Đã quyết
- Id tin là `resource_id` của notification, tức tin mới nhất của dòng đã gộp.
- Nhãn vi `[Tệp]`/`[Ảnh]`/`[Tin thoại]`, en `[File]`/`[Image]`/`[Voice message]`.
- `voice_call_log` không có body; kind khác đi qua `service.ChatPreviewBody` cùng sidebar, bỏ markdown tối thiểu, cắt 120 rune.
- Mỗi lần gọi Expo mang một thông điệp; gộp 100 thông điệp để pha sau.
- `EXPO_ACCESS_TOKEN` có ngay, tùy chọn, khai trong `.env.example`.
- Metric là `uniwork_push_suppressed_total{kind}`, theo cách đặt tên của repo thay cho `notification_push_suppressed_total`.
- Tín hiệu "đang hoạt động" là nhịp presence chat từ tab hiện, cửa sổ 120 giây.
- Tin đã xóa lúc giao không gửi push và đánh dấu `pushed_at`.
- Đăng ký Expo đòi `platform` ∈ `ios`|`android`, khóa rỗng, `user_agent` `expo/<platform>`, chạy cả khi VAPID tắt.
