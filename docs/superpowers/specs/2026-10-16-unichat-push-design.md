# UniChat — Push qua Expo, preview nội dung, bỏ push khi đang hoạt động (lát N2)

> **Trạng thái:** in-progress — Đề xuất, chờ duyệt. Lát N2 của epic UNI-1826; issue UNI-1828. Addendum cho `2026-09-04-notifications-design.md`.

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
`POST https://exp.host/--/api/v2/push/send`, JSON `{to, title, body, data: {url, tag}, sound: "default", channelId: "chat", ttl: 3600, priority: "high"}`, gộp tối đa 100 thông điệp một lần gọi (consumer hiện gửi từng subscription; gộp là tối ưu sau). Đọc `tickets`: `DeviceNotRegistered` → `ErrSubscriptionGone` (thu hồi như 410); 429/5xx → trả lỗi để lane `push` retry. `EXPO_ACCESS_TOKEN` tùy chọn cho enhanced security. Client HTTP có timeout 10 giây.

### 3.2 Sender gộp
`prefixSender{expo, web}`: endpoint khớp `^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$` → Expo, còn lại → Web Push. `nil` web sender (chưa VAPID) vẫn cho Expo chạy.

### 3.3 Đăng ký token Expo
Cùng tuyến đăng ký push hiện có: body `endpoint` khớp mẫu Expo → bỏ qua điều kiện VAPID/https/khóa, `p256dh`/`auth` lưu rỗng, `user_agent` = `expo/ios` hoặc `expo/android` (từ trường `platform` của body). Token không khớp mẫu Expo và không phải https → 400. Web Push giữ nguyên hành vi, kể cả 404 khi thiếu VAPID.

### 3.4 Preview nội dung (`body`)
`PushMessage.Body string json:"body,omitempty"`. Chỉ ba kind chat; consumer đọc `chat_messages` theo id tin (từ `resource_id`/`params` của notification — builder xác nhận cột) **lúc giao**: tin đã xóa → không body; văn bản → bỏ markdown và thẻ nhắc đến, cắt 120 ký tự theo rune; tệp/ảnh/thoại → nhãn "[Tệp]"/"[Ảnh]"/"[Tin thoại]" theo ngôn ngữ người nhận (cùng cơ chế render tiêu đề của `titles.go`). Bảng `notifications` không lưu body; log không ghi body (`scripts/no-pii-log.test.mjs`). `sw.js` hiện `body` khi có.

### 3.5 Bỏ push khi đang hoạt động
Trước khi gửi, consumer hỏi presence: người nhận có nhịp trong 120 giây gần nhất → không gửi, đánh dấu `pushed_at` (coi như đã xử lý), tăng `notification_push_suppressed_total{kind}`. Redis tắt hoặc lỗi → gửi (fail open). Áp cho ba kind chat trước; mở rộng cho kind khác là quyết định sau. Nhịp presence hiện là "đang nối và tab hiện" — nếu nhịp vẫn đập khi người dùng rời máy mà tab còn mở, builder cân nhắc dùng mốc tương tác (đọc/gõ) thay vì nhịp; spec cha chốt ngưỡng 2 phút, không chốt tín hiệu.

### 3.6 Riêng tư
Nội dung đi qua Expo rồi APNs/FCM. Ghi vào chính sách riêng tư và addendum của spec notifications; tùy chọn tắt preview theo người dùng là pha sau.

## 4. Tiêu chí hoàn thành và test

| Kiểm | Test |
|---|---|
| Expo và Web Push cùng một notification, mỗi subscription đúng sender | `notification/consumer_test.go` / `delivery_test.go` với sender giả ghi lại lời gọi |
| `DeviceNotRegistered` thu hồi; 429/5xx trả lỗi | test sender với `httptest.Server` |
| Đăng ký Expo không cần VAPID; sai mẫu → 400; Web Push vẫn 404 khi thiếu VAPID | `notification/service_test.go` |
| Body đúng ba trường hợp; không có trong log | test consumer + `scripts/no-pii-log.test.mjs` |
| Presence 30 giây → không gửi + metric; 5 phút → gửi; Redis nil → gửi | test consumer với presence giả |

Lệnh hẹp: `make test-go` (gói `notification`); `pnpm --filter @uniwork/core test -- notifications` nếu schema client đổi.

## 5. Rủi ro
Giới hạn Expo 600 thông điệp/giây (xa nhu cầu pilot); presence "nối" khác "hoạt động"; preview làm lộ nội dung trên màn hình khóa — đã là quyết định chủ sở hữu.

## 6. Để builder quyết
Cách lấy id tin từ notification; nhãn ngôn ngữ cho tệp/ảnh/thoại; gộp 100 thông điệp hay gửi từng cái; có thêm `EXPO_ACCESS_TOKEN` vào `.env.example` ngay không.
