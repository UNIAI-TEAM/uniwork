# 0038 — Cuộc gọi native trên Android ngay; iOS đi PushKit + CallKit khi có tài khoản Apple

**Trạng thái:** accepted (2026-10-23, UNI-2141). Đề xuất ngày 2026-10-21 (UNI-2053 S4); phần Android đã được xây
cùng bản nháp theo quyết định của chủ sản phẩm ("xây hỗ trợ cuộc gọi đến và đang gọi native trên Android ngay, và
chặn tính năng bằng công tắc phía server"). Chấp nhận khi có tài khoản Apple (Team `XJAM488A6D`): §4 không còn là kế
hoạch mà là hợp đồng giữa server và app iPhone, kèm phần server (sender APNs VoIP, định tuyến ở lane push). Luật vào
`CLAUDE.md › Audit and Events`.
**Xem lại:** quyết định "không CallKit, cuộc gọi đến qua push thường" của
`docs/superpowers/specs/2026-10-16-unichat-mobile-calls-design.md` (chủ sở hữu, 2026-10-16) và việc hoãn
foreground service sang UNI-1880 của cùng spec.
**Liên quan:** [0011](0011-mobile-la-app-expo-doc-lap.md) (mobile là app Expo độc lập),
[0009](0009-audit-va-outbox-cung-transaction.md) (outbox cùng transaction), bản audit mobile 2026-10-21
(P0-4, P0-5, C1–C3, P2 Calls).

## Bối cảnh

Spec M3 chọn cách rẻ nhất: lời mời cuộc gọi tới điện thoại ở nền là một push thường "X đang gọi" trên
kênh `chat`, chạm vào thì trả lời; không CallKit, không ConnectionService, không foreground service. Bản
audit ngày 2026-10-21 đo cái giá của lựa chọn đó:

- Máy khoá hoặc app đã bị kill chỉ nghe một tiếng "ting" rồi im; không có màn đổ chuông, không nút
  Nghe/Từ chối. Với app nhắn tin thì đây là lỗi chặn ra mắt tính năng gọi (P0-4).
- Android không có foreground service khi đang gọi: khoá màn hình giữa cuộc gọi thì Android tắt micro
  của app ở nền và có thể giết process (P0-5). Android lại là bản build duy nhất đang có.
- Không gì báo điện thoại khi cuộc gọi đã được nghe ở máy khác hay đã kết thúc, nên push cũ vẫn nằm đó.
- Một `Modal` đang mở che nút Nghe (C2); cuộc gọi từ workspace khác không reo khi app đang mở (C3);
  nhạc chuông phát trên luồng media, bỏ qua công tắc chuông (P2).

Các app nhắn tin hàng đầu làm giống nhau: Android nhận FCM data-only ưu tiên cao rồi tự vẽ
`CallStyle` với full-screen intent và chạy foreground service kiểu `phoneCall`/`microphone` suốt cuộc gọi;
iOS nhận VoIP push qua PushKit và báo ngay cho CallKit.

## Quyết định

1. **Android, làm ngay.** Một Expo module cục bộ `apps/chat-mobile/modules/unichat-calls` (Kotlin, Expo
   Modules API) giữ phần native, nhỏ và không có chính sách:
   - Cuộc gọi đến: `NotificationCompat.CallStyle.forIncomingCall` với full-screen intent trên kênh `calls`
     (importance HIGH, âm thanh là nhạc chuông của máy với `USAGE_NOTIFICATION_RINGTONE`, lặp tới khi nghe,
     từ chối hoặc hết cửa sổ đổ chuông). Chạm hoặc full-screen intent mở màn đổ chuông của app; Nghe mở
     cùng màn và trả lời; Từ chối chạy task JavaScript không giao diện để báo server.
   - Đang gọi: foreground service kiểu `phoneCall` (cần `MANAGE_OWN_CALLS` trên Android 14), thêm
     `microphone` và `camera` khi quyền đã được cấp, với thông báo `CallStyle.forOngoingCall` và Gác máy.
   - Activity chỉ hiện trên màn khoá khi được mở bởi cuộc gọi, và trả màn khoá khi cuộc gọi kết thúc.
   - Quyền và khai báo nằm ở config plugin của app (`plugins/with-unichat-calls.js`), để
     `android-manifest.test.ts` giữ danh sách cuối của bản release.
   Chính sách (khi nào reo, khi nào service chạy, ai được báo) nằm ở `data/calls/*` bằng TypeScript và được
   test trong node với module giả.
2. **Server.** Lời mời gửi tới bản Android có giao diện cuộc gọi là Expo push data-only, ưu tiên cao (id cuộc
   gọi, phòng, workspace, tên người gọi và phòng, loại cuộc gọi, video, lúc hết đổ chuông); iOS và bản Android cũ
   giữ push hiển thị như cũ. "Có giao diện cuộc gọi" là điều app tự khai khi đăng ký token (`call_ui: true` khi
   module native có mặt, lưu thành user agent `expo/android; call-ui`): bản 0.2.x không có task nền nào biến push
   data-only thành tiếng chuông, gửi data-only tới nó là mất cuộc gọi. Khi cuộc
   gọi thôi reo với một người (họ nghe ở máy khác, từ chối, hoặc cuộc gọi kết thúc), `ChatService` ghi một
   hàng outbox `chat.voice.ring_closed` cùng transaction đóng hàng notification; lane push biến nó thành
   push data-only "kết thúc" cho các máy Android có giao diện cuộc gọi của người đó. Mỗi push mang kênh Android theo kind
   (`calls`, `missed_calls`, `mentions`, `messages`, `general`); cuộc gọi 1-1 nhỡ là push "Cuộc gọi nhỡ từ X".
3. **Công tắc.** `unichat_mobile_calls` tắt thì server không gửi push cuộc gọi (đã có) và không gửi push kết
   thúc; app không reo, không hiện màn đổ chuông; cuộc gọi đang diễn ra không bị cắt và vẫn giữ foreground
   service.
4. **iOS: PushKit + CallKit, VoIP push thẳng tới APNs.** Expo push service không gửi được VoIP push, nên server có
   sender riêng (`server/internal/notification/push_apns.go`). Hợp đồng giữa server và app iPhone, cố định:
   - **Đăng ký.** App đăng ký token PushKit qua cùng route `POST /api/v1/me/push-subscriptions`, thành một
     subscription riêng bên cạnh token Expo: `{"endpoint": "<token hex>", "transport": "apns_voip",
     "apns_environment": "production" | "sandbox", "apns_bundle_id": "<bundle id>", "platform": "ios"}` (`kind` và `bundle_id`
     được nhận thay `transport` và `apns_bundle_id`; client cũ không gửi trường nào trong số đó và không đổi gì). `apns_environment` theo bản
     build: development là `sandbox`, TestFlight và App Store là `production`. Server lưu như mọi subscription
     (cột `transport`, `apns_environment`, `apns_bundle_id` của `push_subscriptions`, gắn phiên thiết bị qua
     `session_id`; bảng là thông tin đăng nhập theo người, ngoài tenant), gỡ bằng `DELETE` cùng route với endpoint là
     token, và thu hồi khi APNs trả 410 `Unregistered` hoặc 400 `BadDeviceToken`.
   - **Gửi.** HTTP/2 tới `api.push.apple.com` (production) hoặc `api.sandbox.push.apple.com` (sandbox), xác thực bằng
     token: JWT ES256 ký bằng khoá `.p8` (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` dạng PEM), claim `iss` =
     Team ID và `iat`, dùng lại 50 phút. Header `apns-push-type: voip`, `apns-topic: <bundle id>.voip` (hoặc
     `APNS_VOIP_TOPIC`), `apns-priority: 10`, `apns-expiration` = lúc hết đổ chuông (lời mời) hoặc bây giờ + 60 giây
     (kết thúc). Thiếu khoá thì VoIP tắt và iPhone giữ đường hiện tại. Chỉ thư viện chuẩn của Go, không thêm phụ
     thuộc.
   - **Payload**, không có `aps`: `{"uniwork": {"kind": "invite" | "end", "call_id", "room_id", "workspace_id",
     "org_slug", "ws_slug", "caller_name", "video": true | false, "expires_at": "<RFC3339>"}}`. `caller_name` theo
     cùng luật riêng tư với push gọi Android (`push_consumer.go`: lời mời giữ tên người gọi kể cả khi ẩn xem trước,
     vì nghe máy cần nó và nó chỉ sống trong cửa sổ đổ chuông); push kết thúc không mang tên. `end` được gửi khi
     cuộc gọi kết thúc, được nghe ở máy khác hay bị từ chối (cùng hàng outbox `chat.voice.ring_closed` của Android),
     để màn CallKit gỡ xuống — kể cả tới chính iPhone đã nghe hoặc đã từ chối.
   - **Định tuyến.** Khi `unichat_mobile_calls_ios` bật cho người đó và họ có subscription `apns_voip`, lời mời đi
     bằng VoIP push và token Expo đăng ký từ cùng phiên thiết bị không nhận push "X đang gọi"; iPhone không có token
     PushKit (bản cũ, phiên khác), server không có khoá, hay token chết/lỗi thì giữ push hiển thị như hôm nay. Công
     tắc tắt thì không iPhone nào reo. Push tin chat, cuộc gọi nhỡ và mọi push khác không bao giờ tới token PushKit.
   - **App iPhone.** Mỗi VoIP push phải gọi `CXProvider.reportNewIncomingCall` đồng bộ trong callback PushKit (iOS
     13+ giết app và rồi thôi đánh thức app không báo); `end` hay lời mời đã quá `expires_at` thì báo một cuộc gọi rồi
     kết thúc ngay với lý do đúng (`remoteEnded`, `answeredElsewhere`, `declinedElsewhere`, `unanswered`). Nghe mở
     `uniworkchat://open?url=/<org>/<ws>/chat?room=<room>&call=<call_id>` và phát sự kiện JavaScript để màn cuộc
     gọi nối LiveKit; Từ chối gửi `POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/decline`
     (`{"call_id"}`), đúng API của Android. Phía JavaScript có giao diện trung lập `NativeCallSession` (đến, đã nghe,
     đã từ chối, đã kết thúc; tắt tiếng/giữ máy tuỳ chọn) mà nửa Kotlin và nửa Swift cùng hiện thực. `call_id` là
     UUID do client tạo, nhưng server chỉ giới hạn 64 ký tự: app suy ra UUID của CallKit một cách tất định khi nó
     không phải UUID, và coi push trùng `call_id` (outbox thử lại) là một cuộc gọi.
   Bật `unichat_mobile_calls_ios` là bước cuối, sau khi khoá APNs nằm trên server và bản iPhone có CallKit đã qua
   checklist thiết bị. Cho tới lúc đó công tắc tắt (mặc định, 2026-10-22): server gộp nó vào `unichat_mobile_calls`
   của máy gửi `X-Client-OS: ios` (`featureflags.MobileFlagsFor`) và không gửi push đổ chuông tới iPhone, vì một
   iPhone khoá máy không có CallKit chỉ kêu một tiếng và giữ banner "X đang gọi" sau khi cuộc gọi kết thúc.
5. **Cuộc gọi di động chen vào (đã làm, 2026-10-22) và Telecom trên Android (chưa làm).** Phần cấp thiết nhất của
   Telecom — Android không giữ cuộc gọi VoIP khi người dùng nghe một cuộc điện thoại, hai luồng âm thanh tranh nhau —
   được xử lý không cần Telecom: `CallInterruptions.kt` nghe chế độ âm thanh của máy
   (`AudioManager.OnModeChangedListener`, Android 12+, không cần quyền) trong lúc `CallService` chạy; `MODE_IN_CALL`
   là cuộc điện thoại đang giữ đường dây, JavaScript tắt micro, đưa âm lượng người khác về 0 và hiện "Đang tạm giữ",
   rồi trả lại khi cuộc điện thoại kết thúc. Không dùng `TelephonyCallback`: trạng thái cuộc gọi cần
   `READ_PHONE_STATE`, một quyền nguy hiểm nữa để xin. Android 11 trở xuống không được giữ (giới hạn đã biết).
   Đăng ký với Telecom (`androidx.core:core-telecom` `CallsManager`, self-managed) — nút tai nghe Bluetooth/xe hơi
   nghe-gác, đồng hồ và Android Auto thấy cuộc gọi, Android tự giữ cuộc gọi — vẫn chưa làm, và lý do không phải việc
   biên dịch: Telecom nhận quyền định tuyến âm thanh (`CallControlScope.requestEndpointChange`, `CallEndpointCompat`)
   từ AudioSwitch của LiveKit, đang chọn loa trong/loa ngoài/Bluetooth cho nút Âm thanh (`audio-output-button.tsx`).
   Hai chủ cùng định tuyến một cuộc gọi là lỗi chỉ thấy trên máy thật (Bluetooth SCO, tai nghe có dây, xe hơi), nên
   việc này chờ checklist thiết bị chạy lần đầu, cùng một thay đổi đưa định tuyến về hẳn một phía.

## Hệ quả

Được: Android có màn đổ chuông thật trên máy khoá, nhạc chuông theo công tắc chuông và Không làm phiền,
Nghe/Từ chối ngay trên thông báo, cuộc gọi giữ micro và process khi tắt màn hình, máy thôi reo khi cuộc gọi
được nghe ở nơi khác. Logic vẫn nằm ở TypeScript có test; phần Kotlin chỉ là cầu nối.

Mất / phải trả:

- Thêm quyền `USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE_PHONE_CALL|MICROPHONE|CAMERA`,
  `MANAGE_OWN_CALLS`, `BLUETOOTH_CONNECT` — mỗi cái là một khai báo trên Play Console (video giải thích cho
  foreground service, khai báo full-screen intent cho app gọi điện). Android 14 cho người dùng thu hồi
  full-screen intent; khi đó cuộc gọi chỉ là thông báo heads-up (Cài đặt › Thông báo chỉ đường bật lại).
- Kotlin không được biên dịch ở máy dev không có Android SDK; CI (`mobile-verify.yml › android-release`)
  là nơi đầu tiên build nó, và một phần chỉ kiểm được trên máy thật (danh sách ở `apps/chat-mobile/CLAUDE.md`).
- Từ chối khi app đã bị kill phải khởi động một runtime JavaScript không giao diện để đọc phiên và gọi API;
  Android có thể từ chối khởi động service đó, khi ấy hành động chờ tới lần mở app sau (người gọi vẫn được
  đồng hồ đổ chuông kết thúc).
- Trạng thái đổ chuông ở server vẫn là bộ nhớ của một process (`chat_voice.go`), nên `ring_closed` cũng chỉ
  đúng với một replica. Từ 2026-10-22 mỗi thay đổi phiên được ghi nhật ký vào Redis (`chat_voice_journal.go`, hết hạn
  cùng phiên), process mới đọc lại lúc khởi động và đọc qua khi không giữ phiên: restart hay deploy không còn làm mất
  cuộc gọi đang đổ chuông. Nhiều replica cùng sửa một cuộc gọi vẫn chưa đúng (bản đồ trong process vẫn là nguồn
  quyết định); deploy hiện chạy một replica.
- iOS có trải nghiệm tương đương khi bản có CallKit tới tay người dùng và công tắc bật; tới lúc đó iPhone không reo.
  Server giữ thêm một bí mật (khoá `.p8`, Secret Helm `uniwork-apns`) và một đường gửi thứ ba không qua Expo, với
  metric riêng `uniwork_push_apns_voip_total{result, reason}`. Token PushKit của bản development chỉ sống trên
  sandbox: một bản build khai sai môi trường nhận `BadDeviceToken` và bị thu hồi token, rồi đăng ký lại ở lần mở app
  sau. Một push VoIP mà app không báo CallKit là lỗi chết người với app (iOS ngừng giao VoIP), nên sender chỉ gửi lời
  mời còn hạn và push kết thúc, không gì khác (`TestAPNsVoIPSenderSkipsWhatCallKitDoesNotRing`,
  `TestChatPushNeverReachesAPushKitToken`).
- Dịch vụ FCM native (`UniChatMessagingService`) thấy mọi push trước nhưng chỉ đổ chuông; thông báo tin chat vẫn do
  expo-notifications dựng, phẳng, không MessagingStyle hay gom theo phòng (hoãn 2026-10-22). Đường làm và hợp đồng
  phải giữ (tag = `group_key`, id 0, request marshal trong extra, intent phản hồi và nút Trả lời/Đánh dấu đã đọc của
  expo) ghi ở `docs/engineering/unichat-mobile/calls.md`; server còn phải gửi tên người gửi và tên phòng tách riêng.
  Việc này chờ một người có máy Android thật và môi trường build, sau một công tắc mobile riêng.
