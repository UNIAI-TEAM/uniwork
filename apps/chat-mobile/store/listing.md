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
**Danh mục:** Business (chính), Productivity (phụ).

**Độ tuổi: 18+**, khớp chính sách quyền riêng tư ("dành cho người từ 18 tuổi", `apps/web/features/landing/privacy-content.ts`).
App Store: Age Rating 18+ (không nội dung phản cảm; có nhắn tin giữa người dùng). Google Play: Target audience chỉ nhóm
18+; bảng hỏi IARC — không bạo lực, tình dục, cờ bạc hay mua trong app; Interactive elements: **Users interact** (nhắn
tin, gọi giữa thành viên một tổ chức), không chia sẻ vị trí. Nội dung do người dùng tạo có báo cáo và chặn (mục
"Nội dung do người dùng tạo" dưới đây).

## Quyền riêng tư

App gửi về server UniWork, qua Expo Push Service (bên thứ ba, rồi APNs/FCM), tới Sentry (bên thứ ba, báo cáo
crash; UNI-2053) và — khi người dùng, hay một thành viên khác của cuộc trò chuyện hoặc cuộc gọi chung, dùng tính năng
AI — qua server UniWork tới Anthropic (nhà cung cấp mô hình AI) những dữ liệu sau. Không có quảng cáo, không theo dõi giữa app (App Tracking Transparency: không),
không bán dữ liệu. Ghi Expo và Sentry vào chính sách riêng tư (spec §11). Báo cáo crash không chứa nội dung tin, email,
tên, token hay query của URL (`lib/redact.ts` lọc trước khi gửi), không chụp màn hình, không ghi lại phiên.

| Dữ liệu | Khi nào | Apple App Privacy | Google Data safety |
| --- | --- | --- | --- |
| Tên, email | Hồ sơ tài khoản, danh bạ | Contact Info → Name, Email Address; App Functionality; Linked | Personal info → Name, Email; App functionality |
| Nội dung tin, ảnh, tệp, tin thoại | Người dùng gửi | User Content → Emails or Text Messages, Photos or Videos, Audio Data, Other User Content; App Functionality; Linked | Messages → Other in-app messages; Photos and videos; Audio; Files and docs |
| Nội dung xem trước trong push | Mỗi thông báo tin mới | (như dòng trên; đi qua Expo/APNs/FCM) | Shared → Messages (với nhà cung cấp dịch vụ push) |
| Push token Expo, tên máy, nền tảng | Đăng ký push, đăng nhập (danh sách thiết bị) | Identifiers → Device ID; App Functionality; Linked | Device or other IDs; App functionality |
| Chẩn đoán: báo cáo crash và hiệu năng (Sentry, bên thứ ba) | Khi app crash hay một thao tác lỗi phía server; mẫu 10 % phiên cho thời gian mở app và màn hình. Chỉ khi bản build có `SENTRY_DSN` | Diagnostics → Crash Data, Performance Data; App Functionality; Linked (id người dùng dạng mã, không email/tên); không Tracking | Collected → App info and performance → Crash logs, Diagnostics; App functionality; Shared: không (Sentry là nhà cung cấp dịch vụ xử lý thay); không tuỳ chọn |
| Mã định danh trong báo cáo crash | Cùng báo cáo trên: id người dùng UniWork (mã ULID), phiên bản, bản dựng, kênh và id bản cập nhật | Identifiers → User ID; App Functionality; Linked | Personal info → User IDs; App functionality |
| Xử lý AI (Anthropic, bên thứ ba) | Khi **bất kỳ thành viên nào** dùng AI trên nội dung chung: người dùng này bấm "Bắt kịp nhanh" trên điện thoại, hoặc một thành viên khác dùng Bắt kịp, Hỏi UNI hay tóm tắt cuộc gọi trên web/máy tính. Gửi tin nhắn của cuộc trò chuyện (và nội dung cuộc gọi đã ghi, khi có người ghi) kèm tên người gửi và thời gian — gồm cả tin của người dùng này; server UniWork gửi đi, app không gọi thẳng Anthropic. Màn thông báo xử lý AI trên điện thoại (nêu tên Anthropic, dữ liệu gửi đi, không dùng để huấn luyện, rút lại ở Cài đặt › Quyền riêng tư và pháp lý; câu trả lời lưu trên server, `PUT /me/ai-consent`) chỉ chặn yêu cầu AI của chính người dùng từ điện thoại: server chưa đọc câu trả lời đó, web và máy tính không hỏi | User Content → Emails or Text Messages (và Audio Data nếu khai cuộc gọi đã ghi); App Functionality; Linked; Apple 5.1.2(i): màn đồng ý trước yêu cầu AI đầu tiên từ điện thoại — không bao trùm việc thành viên khác dùng AI | Messages → Other in-app messages; App functionality; **Shared** với nhà cung cấp dịch vụ (Anthropic, Hoa Kỳ); khi người dùng hoặc một thành viên khác dùng tính năng AI |
| Báo cáo vi phạm | Người dùng báo cáo một tin nhắn hay một người: lý do, lời mô tả (tuỳ chọn), id tin và người. Chủ sở hữu và quản trị viên tổ chức thấy lý do, người/tin bị báo cáo và **người báo cáo** trong Nhật ký hoạt động; lời mô tả chỉ nằm trong bản xuất dữ liệu của tổ chức | User Content → Other User Content; App Functionality; Linked | Messages → Other in-app messages; App functionality |

Mọi dữ liệu mã hoá khi truyền (HTTPS/WSS).

**Xoá tài khoản.** Trong app: Cài đặt › Xóa tài khoản — nêu hệ quả, xác nhận lại bằng mật khẩu (hoặc mã hai lớp, hoặc
gõ lại email với tài khoản chỉ Google), gọi `POST /api/v1/me/delete`, rồi đăng xuất mọi thiết bị và xoá dữ liệu của tài
khoản trên máy (cache, ảnh đã lưu, thông báo, ghim). Chủ sở hữu tổ chức được hướng dẫn chuyển quyền trên web trước. URL
chính sách riêng tư: `https://app.uniworkos.com/privacy`; URL xoá tài khoản cho Play:
`https://app.uniworkos.com/privacy#delete-account`. Cài đặt › Quyền riêng tư và pháp lý mở cả hai, liên hệ hỗ trợ
(`contact@unicomhub.com`) và danh sách giấy phép mã nguồn mở.

## Nội dung do người dùng tạo (Apple 1.2, Play UGC)

Tin nhắn chỉ đi giữa thành viên một tổ chức. Báo cáo: nhấn giữ một tin › Báo cáo; chi tiết cuộc trò chuyện riêng ›
Báo cáo; chạm một thành viên trong chi tiết nhóm › Báo cáo — chọn lý do (spam, quấy rối, thù ghét, khiêu dâm, bạo lực,
tự gây hại, khác), mô tả tuỳ chọn, và có thể chặn luôn. Báo cáo lưu ở server (`chat_reports`) và ghi nhật ký
`chat.report.created`: chủ sở hữu và quản trị viên tổ chức thấy nó ở web › Cài đặt › Nhật ký hoạt động — lý do, người
và tin bị báo cáo, **ai đã báo cáo** (sheet báo cáo nói điều này; người bị báo cáo không nhận thông báo, nhưng nếu là
chủ sở hữu/quản trị viên thì cũng thấy). Lời mô tả của người báo cáo không vào nhật ký (nhật ký không xoá được, không
chứa chữ tự do); chủ sở hữu đọc nó trong bản xuất dữ liệu của tổ chức. Chưa có màn hình đọc và xử lý báo cáo, và nhà
vận hành UniWork không tự thấy báo cáo nào: người dùng và reviewer báo cáo thẳng với nhà vận hành qua
`contact@unicomhub.com` (chính sách riêng tư nói vậy). Chặn: chi tiết cuộc trò chuyện riêng hoặc thành
viên nhóm › Chặn nhắn tin (hai bên không nhắn riêng được; cuộc trò chuyện biến khỏi danh sách người chặn); cuộc trò
chuyện hiện người nào đã chặn. Ghi chú cho reviewer (en):

> Long-press any message from another person and choose "Report". In a direct conversation, open its details (tap the
> name at the top) for "Block" and "Report". The organization's owners and admins see each report (reason, the
> person or message reported, and who reported it) in the web app's Settings › Activity log. Anyone can also report
> content or a user directly to the operator at contact@unicomhub.com.

## Quyền và chuỗi xin quyền

Lát thêm module native là lát đặt chuỗi trong `app.config.ts` (qua tuỳ chọn plugin); bảng này là lý do để trả lời
review. Chuỗi iOS hiện chỉ có tiếng Việt; muốn bản tiếng Anh thì thêm `locales` trong `app.config.ts`.

| Quyền | Nền tảng | Lát | Lý do (dùng cho review) | Chuỗi đề xuất (vi / en) |
| --- | --- | --- | --- | --- |
| Thông báo | iOS (hộp thoại hệ thống), Android 13+ `POST_NOTIFICATIONS` | M1 | Báo tin nhắn mới, nhắc tên, cuộc gọi đến khi app ở nền | — (iOS không dùng chuỗi riêng) |
| Thư viện ảnh | iOS `NSPhotoLibraryUsageDescription`; Android dùng photo picker, không xin quyền | M2a | Chọn ảnh để gửi vào cuộc trò chuyện | UniChat mở thư viện ảnh để bạn gửi ảnh vào cuộc trò chuyện. / UniChat opens your photo library so you can send photos in a conversation. |
| Micro | iOS `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO` | M3 | Gọi thoại/video và ghi tin thoại; chỉ bật khi người dùng vào cuộc gọi hay bấm ghi | UniChat dùng micro cho cuộc gọi và tin nhắn thoại. / UniChat uses the microphone for calls and voice messages. |
| Camera | iOS `NSCameraUsageDescription`, Android `CAMERA` | M3 | Gọi video; chỉ bật khi người dùng bật camera trong cuộc gọi | UniChat dùng camera khi bạn bật video trong cuộc gọi. / UniChat uses the camera when you turn on video in a call. |

Không CallKit/VoIP push (spec §12 Q7), nên không có background mode `voip`. iOS có background mode `audio` để cuộc gọi
giữ tiếng khi người dùng rời app hoặc khoá máy (lý do cho review: "keeps an ongoing voice/video call audible").

**Android, dịch vụ chạy nền (foreground service): hiện không có loại nào.** `expo-audio` tắt phát/ghi nền
(`enableBackgroundPlayback: false`; tin thoại dừng khi rời app), `MediaProjectionService` của WebRTC (chia sẻ màn hình,
app không dùng) bị gỡ khỏi manifest. Danh sách quyền và dịch vụ cuối cùng của bản release do
`android-manifest.test.ts` giữ; thêm loại FGS (như dịch vụ cuộc gọi) thì thêm dòng ở bảng trên và khai báo trên Play
kèm video (runbook › Play Console App content).

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
