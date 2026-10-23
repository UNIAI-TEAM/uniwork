# Browser system notifications

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** không có alert — runbook triển khai và nghiệm thu UNI-1965 (browser permission + Web Push)

The web workspace invites the person to enable system notifications. The browser
permission dialog runs only after their click. The notification settings page
also offers a test while server push is unavailable.

## Triệu chứng

- Tab đang mở nhưng không có banner hệ thống cho tin chat, mention, giao việc,
  lời mời/nhắc họp hoặc cuộc gọi đến dù người dùng đã bật quyền trình duyệt.
- Cột **Đẩy** trong Cài đặt → Thông báo biến mất kèm dòng giải thích máy chủ
  chưa bật push sau khi đóng tab.
- Đã đăng ký Web Push nhưng đóng tab vẫn không nhận thông báo (hoặc cuộc gọi
  chỉ rung trên điện thoại, không trùng banner desktop).

## Kiểm tra

**Hai đường giao hàng**

- Workspace đang mở: sự kiện realtime → banner hệ thống (cần quyền trình duyệt).
  Tab nền vẫn được coi là unfocused. Banner cuộc gọi đóng khi gọi kết thúc, được
  trả lời hoặc app lấy lại focus.
- Web Push đã đăng ký: thông báo sau khi đóng tab. Cuộc gọi đến vẫn qua TTL ngắn;
  tab mở có subscription thì banner hệ thống nhường lane push để tránh trùng.

**Cấu hình server**

1. `GET /api/v1/notifications/push/config` phải trả `enabled: true` và public key
   sau khi backend có `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`.
2. HTTPS (ngoài localhost). Kiểm tra quyền site và cài đặt thông báo OS (Focus
   assist / Do Not Disturb có thể che banner dù quyền trình duyệt đã granted).
3. Đăng ký push: `/sw.js`, `PushSubscription`, `POST /api/v1/me/push-subscriptions`
   thành công sau khi bật trong Cài đặt.

## Khắc phục

1. Cấp một cặp VAPID ổn định trong secret manager. Gắn lên **Go backend**:
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (bắt buộc), `VAPID_SUBJECT` (origin
   hoặc `mailto:`). Không để private key trong biến frontend, repo, ảnh chụp hay
   log. Giữ cùng cặp trên mọi instance và sau restart.
2. Restart backend, refresh trình duyệt đã đăng nhập, xác nhận bước Kiểm tra §2.
3. Từ lời mời trong workspace bấm bật thông báo và allow dialog. Nếu quyền đã
   có, bật **Receive push notifications in this browser** trong Cài đặt →
   Thông báo.

**Nghiệm thu thủ công** (tài khoản test, tin giả; không spam đồng nghiệp production)

- Windows Chrome/Edge, macOS Chrome/Safari: quyền ban đầu `default`, lời mời
  không tự mở dialog, nút trên lời mời mới mở.
- Gửi thử từ Cài đặt và xem trung tâm thông báo OS; chỉ toast UI không đủ.
- App unfocused: tin mới và cuộc gọi từ account test khác; chọn banner mở đúng
  hội thoại; trả lời/kết thúc gọi thì banner cuộc gọi đóng.
- Thử nhắc họp, phòng mute, từ chối quyền, quyền đã granted trước đó; cài đặt
  trình duyệt vẫn vào được sau khi bỏ qua lời mời.
- Đã cấu hình push + đăng ký browser: đóng tab và lặp lại; giao hàng khi process
  trình duyệt thoát hẳn phụ thuộc browser/OS. Chat push vẫn áp suppression
  recent-activity — chờ hết cửa sổ khi kiểm tra delivery tab đóng.

## Leo thang

- VAPID đúng, `push/config` enabled, đăng ký 200 nhưng không delivery: ghi
  correlation id, endpoint push (không log subscription keys), báo nhóm platform
  với browser/OS và bước nghiệm thu đã chạy.
- Lỗi permission bị từ chối vĩnh viễn: hướng dẫn người dùng reset quyền site
  trong cài đặt trình duyệt; không có đường bypass phía server.
