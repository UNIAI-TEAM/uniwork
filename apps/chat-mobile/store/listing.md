# UniChat mobile — hồ sơ store (bản nháp, UNI-1836)

Nguồn cho App Store Connect và Google Play Console khi có tài khoản (UNI-1838). Tên hiển thị "UniChat", định danh
`com.uniworkos.chat` (bản `internal` dùng `com.uniworkos.chat.staging`, tên "UniChat (Staging)"). Lý do và luật: spec
`docs/superpowers/specs/2026-10-16-chat-native-apps-design.md` §3.1, §3.4, §11; quy trình nộp:
`docs/runbooks/unichat-mobile-release.md`. Chữ ở đây là bản nháp; chủ sở hữu duyệt trước lần nộp production (Q1).

## Mô tả

**vi — phụ đề (≤ 30 ký tự):** Nhắn tin và gọi cho cả đội

**vi — mô tả:**

> UniChat là ứng dụng nhắn tin của UniWork cho đội ngũ Việt Nam. Trò chuyện riêng, nhóm và kênh của workspace luôn
> đồng bộ với UniWork trên web và máy tính.
>
> - Tin nhắn tức thời, trả lời trích dẫn, luồng, cảm xúc, nhắc tên, đã đọc
> - Gửi ảnh và tệp vào cuộc trò chuyện
> - Gọi thoại và video cho hai người hoặc cả nhóm
> - Danh bạ đồng nghiệp với trạng thái hoạt động
> - Thông báo đẩy có xem trước nội dung; không làm phiền khi bạn đang dùng UniWork ở thiết bị khác
>
> Cần một tài khoản UniWork. Đăng nhập an toàn qua trình duyệt, ứng dụng không lưu mật khẩu.

**en — subtitle:** Messages and calls for your team

**en — description:**

> UniChat is the messaging app of UniWork, built for Vietnamese teams. Direct messages, groups and workspace channels
> stay in sync with UniWork on the web and desktop.
>
> - Instant messages, quoted replies, threads, reactions, mentions and read receipts
> - Share photos and files in a conversation
> - Voice and video calls, one-to-one or with the whole group
> - A directory of your colleagues with their presence
> - Push notifications with message previews, held back while you are active in UniWork elsewhere
>
> Requires a UniWork account. You sign in securely in the browser; the app never stores your password.

**Từ khoá (≤ 100 ký tự):** `uniwork,chat,nhắn tin,gọi video,nhóm,công việc,team,messaging`
**Danh mục:** Business (chính), Productivity (phụ). **Độ tuổi:** 4+ / Everyone (không nội dung do app tạo; chat giữa
thành viên một tổ chức).

## Quyền riêng tư

App gửi về server UniWork và qua Expo Push Service (bên thứ ba, rồi APNs/FCM) những dữ liệu sau. Không có quảng cáo,
không theo dõi giữa app (App Tracking Transparency: không), không bán dữ liệu. Ghi Expo vào chính sách riêng tư
(spec §11).

| Dữ liệu | Khi nào | Apple App Privacy | Google Data safety |
| --- | --- | --- | --- |
| Tên, email | Hồ sơ tài khoản, danh bạ | Contact Info → Name, Email Address; App Functionality; Linked | Personal info → Name, Email; App functionality |
| Nội dung tin, ảnh, tệp, tin thoại | Người dùng gửi | User Content → Emails or Text Messages, Photos or Videos, Audio Data, Other User Content; App Functionality; Linked | Messages → Other in-app messages; Photos and videos; Audio; Files and docs |
| Nội dung xem trước trong push | Mỗi thông báo tin mới | (như dòng trên; đi qua Expo/APNs/FCM) | Shared → Messages (với nhà cung cấp dịch vụ push) |
| Push token Expo, tên máy, nền tảng | Đăng ký push, đăng nhập (danh sách thiết bị) | Identifiers → Device ID; App Functionality; Linked | Device or other IDs; App functionality |
| Chẩn đoán | Hiện app không gửi báo cáo crash hay hiệu năng | Không khai, cho tới khi thêm công cụ crash | Không khai, cùng điều kiện |

Mọi dữ liệu mã hoá khi truyền (HTTPS/WSS). Người dùng xoá tài khoản theo quy trình của UniWork; điền URL chính sách
riêng tư và URL xoá tài khoản của `uniworkos.com` lúc nộp.

## Quyền và chuỗi xin quyền

Lát thêm module native là lát đặt chuỗi trong `app.config.ts` (qua tuỳ chọn plugin); bảng này là lý do để trả lời
review. Chuỗi iOS hiện chỉ có tiếng Việt; muốn bản tiếng Anh thì thêm `locales` trong `app.config.ts`.

| Quyền | Nền tảng | Lát | Lý do (dùng cho review) | Chuỗi đề xuất (vi / en) |
| --- | --- | --- | --- | --- |
| Thông báo | iOS (hộp thoại hệ thống), Android 13+ `POST_NOTIFICATIONS` | M1 | Báo tin nhắn mới, nhắc tên, cuộc gọi đến khi app ở nền | — (iOS không dùng chuỗi riêng) |
| Thư viện ảnh | iOS `NSPhotoLibraryUsageDescription`; Android dùng photo picker, không xin quyền | M2a | Chọn ảnh để gửi vào cuộc trò chuyện | UniChat mở thư viện ảnh để bạn gửi ảnh vào cuộc trò chuyện. / UniChat opens your photo library so you can send photos in a conversation. |
| Micro | iOS `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO` | M3 | Gọi thoại/video và ghi tin thoại; chỉ bật khi người dùng vào cuộc gọi hay bấm ghi | UniChat dùng micro cho cuộc gọi và tin nhắn thoại. / UniChat uses the microphone for calls and voice messages. |
| Camera | iOS `NSCameraUsageDescription`, Android `CAMERA` | M3 | Gọi video; chỉ bật khi người dùng bật camera trong cuộc gọi | UniChat dùng camera khi bạn bật video trong cuộc gọi. / UniChat uses the camera when you turn on video in a call. |

Không CallKit/VoIP push (spec §12 Q7), nên không có background mode `voip`. Nếu M3 cần âm thanh khi app ở nền thì
background mode `audio` phải kèm lý do riêng cho review.

## Tài khoản demo cho review

1. Trên production, tạo org riêng "UniChat Review" (không chung với khách hàng), một workspace, hai tài khoản
   (`review@…` cho Apple/Google và một tài khoản thứ hai để có người trò chuyện), vài phòng có sẵn tin, một cuộc gọi
   mẫu trong lịch sử.
2. Tài khoản review đăng nhập bằng email + mật khẩu (reviewer không dùng được Google SSO), không MFA.
3. App Store Connect → App Review Information → Sign-in required: email, mật khẩu, và ghi chú (en):
   > Tap "Sign in". The app opens a secure browser sheet on uniworkos.com; enter the email and password above, then tap
   > "Allow" and "Open UniChat" to return to the app. To test a call, open the room "Review" and tap the call button;
   > the second account can be reached the same way from another device or from https://app.uniworkos.com.
4. Play Console → App content → App access: cùng thông tin.
5. Đổi mật khẩu sau mỗi đợt review; không để tài khoản này là thành viên org nào khác.

## Ảnh chụp

Chụp ở phase 2, khi màn M2a/M3 xong (có thể lấy từ ảnh của Maestro trên simulator): iPhone 6,9" (1320 × 2868) và
6,5" (1242 × 2688), Android phone (1080 × 1920 trở lên), tối thiểu 3 ảnh mỗi ngôn ngữ: danh sách hội thoại, một cuộc
trò chuyện, cuộc gọi. Dữ liệu trong ảnh lấy từ org "UniChat Review", không dữ liệu khách hàng.
