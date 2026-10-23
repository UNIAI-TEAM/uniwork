# UniChat mobile — Cuộc gọi trên iPhone (PushKit + CallKit)

> **Trạng thái:** in-progress · UNI-2141, 2026-10-23: phần app đã xây, Swift chỉ được biên dịch ở CI, chưa chạy trên
> iPhone thật; `unichat_mobile_calls_ios` còn tắt.

Nửa iOS của `modules/unichat-calls` và phần JavaScript nối nó vào app. Hợp đồng server ↔ app (đăng ký `apns_voip`,
sender APNs, payload, định tuyến) là ADR 0038 §4 (`docs/adr/0038-cuoc-goi-native-android-va-ke-hoach-callkit-ios.md`);
chi tiết phía server ở `calls.md` (mục "Cuộc gọi trên iPhone"). Đường dẫn trong file này tính từ `apps/chat-mobile/`.

## Native (Swift, `modules/unichat-calls/ios/`)

- `expo-module.config.json`: `platforms: ["android", "ios"]`, khối `apple` khai module `UniChatCallKitModule` và
  subscriber `UniChatCallsAppDelegateSubscriber`; pod `UniChatCalls` (`ios/UniChatCalls.podspec`, iOS 16.4, Swift 5.9,
  `ExpoModulesCore`, framework AVFoundation/CallKit/PushKit). Module JavaScript tên `UniChatCallKit`, khác `UniChatCalls`
  của Android: hai nửa có hàm khác nhau, nên `UniChatCalls` vẫn `null` trên iPhone và `data/calls/native-calls.ts` vẫn
  là no-op ở đó.
- `CallCenter.swift`: tạo `CXProvider` (video, một cuộc gọi, handle generic, không ghi vào mục Gần đây của Điện thoại)
  và `PKPushRegistry` (`voIP`) lúc app khởi động — `UniChatCallsAppDelegateSubscriber` gọi `start()` trong
  `didFinishLaunching`, vì iOS mở app đã đóng ở nền để giao VoIP push cho registry tạo lúc đó. Chỉ chạy khi Info.plist
  khai background mode `voip` (bản build `UNICHAT_IOS_CALLS=1`): bản khác không đăng ký token VoIP, không báo gì cho
  CallKit.
- Mỗi VoIP push (`VoipCallPush.swift` đọc payload `uniwork`) được báo cho CallKit (`reportNewIncomingCall`) **trước**
  completion của PushKit, dù nó là gì (`native-modules.test.ts › every VoIP push is reported to CallKit`):
  - id CallKit tất định theo `call_id` (`VoipCallPush.callKitId`: chính nó khi là UUID, không thì UUID dạng v5 từ
    SHA-256), nên lời mời outbox gửi lại và push kết thúc trúng cùng cuộc gọi;
  - lời mời mới còn hạn: reo, tự kết thúc `unanswered` lúc `expires_at` nếu không ai nghe và không có push kết thúc;
  - lời mời lặp của cuộc gọi đang reo hay đã nghe: giữ nguyên (CallKit trả `callUUIDAlreadyExists`, báo vẫn tính);
  - `end` của cuộc gọi đang reo: kết thúc `remoteEnded`; `end` của cuộc gọi đã nghe trên chính máy này (server gửi
    `end` tới cả iPhone đã nghe): giữ nguyên, app tự gác khi cuộc gọi xong;
  - `end` không khớp cuộc gọi nào, lời mời hết hạn, lời mời của cuộc gọi đã kết thúc ở máy này (64 cuộc gần nhất) hay
    payload lạ: báo rồi kết thúc ngay (`remoteEnded`, `unanswered`, `failed`).
  - Tên trên màn CallKit là `caller_name`; rỗng thì tên app.
- Nút của CallKit → sự kiện `onCallEvent` (`answered`, `declined`, `ended`, `muted`, `held`, `audio`, `token`); sự kiện
  trước khi JavaScript nghe (app đóng được push mở) nằm trong hàng đợi (32 mục) tới `takePendingEvents`. Nghe hay kết
  thúc do chính app yêu cầu (`answer`, `end`) không phát lại sự kiện. Nghe trên CallKit còn ghi "đã nghe" cho
  `takeAnswered(callId)` (một lần), thứ duy nhất cho tab Chat tự nghe một cuộc gọi.
- Âm thanh: khi CallKit thực hiện Nghe, phiên `AVAudioSession` là `playAndRecord` (`voiceChat`, hay `videoChat` + loa
  ngoài cho video; Bluetooth HFP/A2DP); khi CallKit kích hoạt/nhả phiên thì sự kiện `audio` tới JavaScript.
- `ApnsEnvironment.swift`: môi trường APNs của token đọc từ profile ký nhúng trong app (`aps-environment: development`
  → `sandbox`; ad hoc → `production`; TestFlight/App Store không có profile nhúng → `production`; simulator →
  `sandbox`), nên không biến build nào nói sai được.

## JavaScript

- `modules/unichat-calls/index.ts › UniChatCallKit` (null ngoài iPhone), đọc sự kiện qua `lib/call-session-event.ts`
  (không tin hình dạng, sai thì bỏ).
- `data/calls/native-call-session.ts`: `NativeCallSession` — giao diện chung của hai nửa. App báo hệ thống `answered`
  / `declined` / `ended`; hệ thống báo app qua `subscribe` và `takePending`; `ringing()`, `isHeld()`,
  `takeAnswered(callId)`. Nửa Android bọc `native-calls.ts` (hành vi Kotlin không đổi: ba lệnh gỡ thông báo đổ chuông,
  `held` từ `onCallHeld`, `takeAnswered` là `takeAnsweredCall`; Từ chối/Gác máy vẫn qua headless task vì JavaScript có
  thể không chạy, nên `takePending` rỗng). Không có hàm `incoming`: trên iPhone cuộc gọi đến luôn được báo native trước
  khi JavaScript chạy. `voipPush` là nguồn token VoIP (null ngoài iPhone có gọi).
- Đăng ký (`data/push.ts`): `registerPushToken` gửi token VoIP cùng token Expo mỗi lần mở app —
  `POST /api/v1/me/push-subscriptions` với `{ endpoint: <hex>, keys: { p256dh: "", auth: "" }, platform: "ios",
  transport: "apns_voip", apns_environment, apns_bundle_id }` — không cần EAS projectId hay quyền thông báo (CallKit reo
  không cần); lỗi chỉ ghi log, không chặn token Expo. Token PushKit đưa sau hay đổi (`watchPushTokenRotation`) đăng ký
  lại và gỡ cái cũ; tắt push trên máy (`setPushEnabled(false)`), đăng xuất (`unregisterPushToken`) gỡ nó cùng token
  Expo; đăng xuất do server (`forgetPushToken`) chỉ quên. `data/api.test.ts` giữ thân request và câu trả lời trôi dạt.
- `data/calls/call-session.ts` (khởi ở `app/_layout.tsx`, trước mọi listener khác của module): nghe trước rồi lấy sự
  kiện cũ. `answered` → mở `uniworkchat://open?url=/<org>/<ws>/chat?room=<room>&call=<call_id>` như một lần chạm
  thông báo (chưa đăng nhập thì giữ tới sau đăng nhập); tab Chat (`components/chat/use-deep-link-target.ts`) thấy
  `takeAnswered` và `joinFromPush` — màn cuộc gọi nối LiveKit, trên máy khoá thì chạy nền sau màn của CallKit.
  `declined`/`ended` → `runCallActionTask({ action: "decline" })` như nút Từ chối của Android: engine giữ cuộc gọi thì
  gác máy, không thì `POST …/chat/rooms/{roomID}/voice/decline`. `audio` → `RTCAudioSession.audioSessionDidActivate`
  / `audioSessionDidDeactivate` của `@livekit/react-native-webrtc` (LiveKit cần biết CallKit đã kích hoạt phiên).
- `data/calls/call-session-sync.ts`: engine → hệ thống. Cuộc gọi đến sang đang nối → `answered` (CallKit nghe theo,
  kích hoạt âm thanh); cuộc gọi đến hết sống → `declined`; cuộc gọi khác hết sống hay nhường cho cuộc gọi khác →
  `ended`. Cuộc gọi CallKit không biết (chỉ reo trong app qua socket) được bỏ qua ở Swift.
- Màn cuộc gọi: CallKit đang reo thì app không reo thêm (`components/calls/use-call-ringtone.ts`); nút tắt tiếng của
  CallKit tắt micro (`components/calls/use-system-mute.ts`); CallKit giữ cuộc gọi khi nghe cuộc điện thoại thì màn hiện
  "Đang tạm giữ" (`components/calls/use-cellular-hold.ts`, chung với Android); tab Chat kết thúc cuộc gọi CallKit khi
  lần mở không thành cuộc gọi (công tắc tắt, cuộc gọi đã xong).

## Bản build và công tắc

`UNICHAT_IOS_CALLS=1` (môi trường EAS, không trong `eas.json`) khai `UIBackgroundModes` `audio` + `voip`
(`plugins/with-unichat-calls.js › iosBackgroundModes`; `app.config.test.ts` đọc Info.plist cuối của bản release cả hai
trường hợp) và cho app thấy `extra.iosCalls`; thiếu nó thì `lib/runtime-extra.ts › lackingFlags` giữ gọi tắt dù
`unichat_mobile_calls_ios` bật. Thứ tự bật và checklist thiết bị: runbook › Cuộc gọi trên iPhone.

## Kiểm và chưa làm

Vitest/jest cho mọi phần JavaScript (`lib/call-session-event.test.ts`, `data/calls/native-call-session.test.ts`,
`data/calls/call-session.test.ts`, `data/push.test.ts`, `data/api.test.ts`, các test component). Swift: chỉ biên dịch ở
`mobile-verify › ios-release` (Xcode 26.6, simulator); hành vi chỉ kiểm được trên iPhone thật qua TestFlight.
Chưa làm: nút tắt tiếng trong app chưa báo CallKit (`CXSetMutedCallAction` từ app); cuộc gọi chỉ reo qua socket khi app
đang mở không đi qua CallKit; cuộc gọi đi không báo CallKit (`CXStartCallAction`).
