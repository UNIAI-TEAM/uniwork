# UniChat — "Có gì mới" của từng bản store

Nguồn chữ "Có gì mới" (Play: release notes; App Store: What's New) cho mỗi `version` của
`apps/chat-mobile/app.config.ts`. Mỗi bản một mục `## <version>`, dưới đó `### vi-VN` và `### en-US`, mỗi ngôn
ngữ tối đa 500 ký tự. `.github/workflows/chat-mobile-promote.yml` gửi đúng mục này lên Play khi đưa bản đó sang track
khác (`scripts/mobile-play-release.mjs`); `scripts/mobile-release-notes.test.mjs` đỏ khi version hiện tại của app chưa
có đủ hai ngôn ngữ. Bản nháp từ commit: `node scripts/mobile-release-notes.mjs draft` — viết lại cho người dùng đọc,
không chép tên commit.

## 0.4.0

### vi-VN

- Đăng nhập ngay trong UniChat bằng email và mật khẩu, Google hoặc Apple, không cần mở trình duyệt.
- Xác thực hai lớp ngay trong app.
- Gợi ý mật khẩu bạn đã lưu cho UniWork trên web.

### en-US

- Sign in right inside UniChat with your email and password, Google or Apple, without opening the browser.
- Two-factor authentication right in the app.
- Suggests the password you saved for UniWork on the web.

## 0.3.1

### vi-VN

- Cuộc gọi đến hiện toàn màn hình, kể cả khi máy khoá; nghe, từ chối hay gác máy ngay trên thông báo.
- Trả lời tin hoặc đánh dấu đã đọc ngay từ thông báo.
- Khoá UniChat bằng vân tay, khuôn mặt hoặc mật mã; ẩn nội dung tin trong thông báo.
- Mở lại đúng chỗ bạn đọc dở, kể cả khi không có mạng; tin viết lúc offline tự gửi khi có mạng.
- Nháp giữ theo từng cuộc trò chuyện, link trong tin bấm được.
- Ổn định hơn, dễ dùng hơn với trình đọc màn hình và cỡ chữ lớn.

### en-US

- Incoming calls fill the screen, even on a locked phone; answer, decline or hang up from the notification.
- Reply to a message or mark it read from its notification.
- Lock UniChat with your fingerprint, face or passcode; hide message text in notifications.
- Opens where you left off, even offline; messages written offline send once you are online.
- Drafts are kept per conversation; links in messages open.
- More stable, easier with a screen reader and large text.

## 0.3.0

### vi-VN

- Cuộc gọi đến hiện toàn màn hình, kể cả khi máy đang khoá; nghe, từ chối hay gác máy ngay trên thông báo.
- Trả lời tin nhắn hoặc đánh dấu đã đọc ngay từ thông báo.
- Khoá UniChat bằng vân tay, khuôn mặt hoặc mật mã; ẩn nội dung tin trong thông báo.
- Mở lại thẳng vào chỗ bạn đọc dở, kể cả khi không có mạng; tin viết lúc offline tự gửi khi có mạng.
- Bản nháp được giữ theo từng cuộc trò chuyện, link trong tin bấm được.
- Ổn định hơn và dễ dùng hơn với trình đọc màn hình và cỡ chữ lớn.

### en-US

- Incoming calls fill the screen, even on a locked phone; answer, decline or hang up from the notification.
- Reply to a message or mark it read straight from its notification.
- Lock UniChat with your fingerprint, face or passcode, and hide message text in notifications.
- Opens where you left off, even offline; messages written offline send once you are back online.
- Drafts are kept per conversation, and links in messages open.
- More stable, and easier with a screen reader and large text.
