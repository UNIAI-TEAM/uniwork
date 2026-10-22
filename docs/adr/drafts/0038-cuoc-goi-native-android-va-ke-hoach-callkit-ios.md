# 0038 — Cuộc gọi native trên Android ngay; iOS đi PushKit + CallKit khi có tài khoản Apple

**Trạng thái:** proposed (UNI-2053 S4, 2026-10-21). Số 0038 là tạm, đổi nếu ADR khác land trước. Phần
Android đã được xây cùng bản nháp này theo quyết định của chủ sản phẩm ("xây hỗ trợ cuộc gọi đến và đang
gọi native trên Android ngay, và chặn tính năng bằng công tắc phía server"); phần iOS là kế hoạch, chờ tài
khoản Apple (UNI-1838). Chấp nhận thì chuyển ra `docs/adr/`, thêm vào bảng của `README.md` và đưa luật vào
`CLAUDE.md` kèm test giữ luật.
**Xem lại:** quyết định "không CallKit, cuộc gọi đến qua push thường" của
`docs/superpowers/specs/2026-10-16-unichat-mobile-calls-design.md` (chủ sở hữu, 2026-10-16) và việc hoãn
foreground service sang UNI-1880 của cùng spec.
**Liên quan:** [0011](../0011-mobile-la-app-expo-doc-lap.md) (mobile là app Expo độc lập),
[0009](../0009-audit-va-outbox-cung-transaction.md) (outbox cùng transaction), bản audit mobile 2026-10-21
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
4. **iOS, kế hoạch khi có tài khoản Apple.** PushKit (VoIP push qua APNs, không qua Expo push service, nên
   server cần khoá APNs `.p8` và một sender riêng cho token VoIP) + CallKit (`CXProvider.reportNewIncomingCall`
   ngay trong callback PushKit — iOS 13+ giết app nếu không báo) + một module Swift tương ứng
   `modules/unichat-calls` cho iOS, cùng hợp đồng TypeScript. Push kết thúc trên iOS là VoIP push để gọi
   `reportCall(with:endedAt:reason:)`. Cho tới lúc đó gọi điện **tắt trên iPhone** bằng công tắc riêng
   `unichat_mobile_calls_ios` (mặc định tắt, 2026-10-22): server gộp nó vào `unichat_mobile_calls` của máy gửi
   `X-Client-OS: ios` (`featureflags.MobileFlagsFor`) và không gửi push đổ chuông tới đăng ký `expo/ios`, vì một
   iPhone khoá máy chỉ kêu một tiếng và giữ banner "X đang gọi" sau khi cuộc gọi kết thúc. Bật công tắc đó là bước
   cuối của việc làm CallKit.
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
  đúng với một replica; chuyển sang Redis/DB là việc riêng (lộ trình audit, giai đoạn 3).
- iOS chưa có trải nghiệm tương đương cho tới khi PushKit + CallKit land.
