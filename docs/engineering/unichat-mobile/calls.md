# UniChat mobile — Cuộc gọi

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Engine cuộc gọi, UI, nhạc chuông, cuộc gọi native trên Android, kênh thông báo, push đổ chuông, kind giàu. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- Gọi (M3, UNI-1834; spec `2026-10-16-unichat-mobile-calls-design.md`, plan
  `2026-10-17-unichat-mobile-calls.md`). Trạng thái, đồng hồ và cách đọc lời mời là của core
  (`@uniwork/core/chat/voice-call-{types,kind,invites}`, cùng bản với web), `lib/voice-call.ts` chỉ còn câu kết thúc
  (copy `voice-call-copy.ts` web) →
  `data/calls/call-engine.ts` (máy trạng thái của `use-native-voice-call.ts`,
  store vanilla, test node) → `data/calls/call-store.ts` (một engine, nối
  `chatApi`) ← `data/realtime/use-call-realtime.ts` (`chat.voice.*`, đồng bộ
  lời mời chờ khi mở workspace; mỗi lần reconnect và mỗi lần từ background về
  thì `callEngine.reconcile()`: chuông mà server không còn liệt kê thì dừng; người gọi đang đổ chuông đọc
  `outgoing` của `GET …/chat/voice/pending` (cuộc gọi của chính mình server còn giữ) và nối nếu đã được nghe — không
  có trong danh sách không phải bằng chứng đã kết thúc, đồng hồ chuông vẫn lo). Cuộc gọi
  đang đến/đổ chuông/đang nối/đang diễn ra (`lib/call-socket.ts`) giữ socket mở khi
  app vào background (`holdOpen` của `RealtimeProvider`, audit C1); hết cuộc gọi thì
  pause như thường. UI:
  `components/calls/call-overlay.tsx` (lớp toàn màn hình, không phải Modal,
  gắn một lần ở `(app)/_layout.tsx`, trên mọi màn workspace; mỗi layout
  workspace `attach` ngữ cảnh vào engine, cái trên cùng được dùng) + `call-room.tsx` (LiveKit RN;
  `registerGlobals()` chạy khi module này nạp lần đầu: `call-overlay.tsx` `require` nó khi một cuộc gọi hiện, không
  import tĩnh, nên lần mở app không gọi ai không chạy LiveKit/WebRTC). Mọi sheet/dialog là `components/ui/call-aware-modal.tsx`
  (lint cấm `Modal` của react-native ở nơi khác): cuộc gọi bắt đầu đổ chuông thì sheet đang mở đóng qua
  `onRequestClose` của nó (audit C2). Mọi sheet trượt lên là `components/ui/bottom-sheet.tsx` (lint cấm `CallAwareModal`
  với `animationType="slide"` ở nơi khác, fixture `lib/lint-quality.test.ts`): kéo xuống quá một phần chiều cao
  hay vuốt nhanh thì đóng, kéo ngắn thì bật lại (`lib/sheet-drag.ts`), cử chỉ "escape" của VoiceOver đóng, sheet có
  danh sách cuộn chỉ kéo từ dải grabber (`dragFrom="handle"`), sheet có ô nhập đi theo bàn phím (`avoidKeyboard`). Nhạc chuông: `lib/call-ringtone.ts`
  render `assets/sounds/ring-*.wav` (test so byte; sinh lại bằng
  `UPDATE_RINGTONES=1`); trên Android cuộc gọi đến reo trong app bằng nhạc chuông của máy trên luồng chuông
  (`CallRinger` native), WAV chỉ còn cho iOS và nhạc chờ của người gọi. Nút âm thanh
  (`components/calls/audio-output-button.tsx`, `lib/audio-outputs.ts`): Android liệt kê Bluetooth/tai nghe/loa
  trong/loa ngoài khi có tai nghe, iOS mở route picker; gọi thoại bắt đầu ở loa trong, video ở loa ngoài.
  Mạng trong cuộc gọi (review "no-in-call-reconnecting-ui"): `components/calls/use-call-link.ts` nghe
  `Reconnecting`/`SignalReconnecting`/`Reconnected` và `ConnectionQualityChanged` của phòng LiveKit; rớt thì màn cuộc gọi
  hiện "Mất kết nối, đang kết nối lại…" (vùng live, đọc cho trình đọc màn hình) và thông báo cuộc gọi đang diễn ra cũng
  vậy (`nativeCallSync.setReconnecting`), tới khi nối lại; mạng yếu (poor/lost) thì hiện "Mạng của bạn yếu" trước, rồi
  "Mạng của người kia yếu". Mỗi lần rớt được đếm (`data/calls/call-link.ts`, sự kiện `call_reconnect`: recovered kèm
  thời gian, hay dropped khi phòng buông lúc đang nối lại).
  Push "X đang gọi" mang `?call=`; tab Chat gọi `callEngine.ringFromPush` (màn đổ chuông, không tự trả lời);
  không URL nào nhận cuộc gọi: `answer=` bị bỏ qua (`lib/deep-link.test.ts`), vì link từ trang web, tin nhắn hay app khác
  trên máy (intent VIEW ngầm) đều mở được app. Nút Nghe của thông báo native mở cùng link đổ chuông, kèm token ngẫu
  nhiên của lần đổ chuông đó trong PendingIntent (`CallLaunchTokens.kt`: chỉ hệ thống và app đọc được extra của
  PendingIntent); listener kiểm token rồi ghi "đã bấm Nghe", tab Chat hỏi `nativeCalls.takeAnsweredCall(callId)` rồi mới
  `joinFromPush`. Launch không có token đúng (app khác giả extra của cuộc gọi) không hiện trên màn khoá và không nghe.
  Link `dm=` hỏi trước khi mở/tạo DM (`Alert`, nêu tên nếu cache thành viên có). Cần dev client (EAS), không chạy Expo Go.
- Cuộc gọi native trên Android (UNI-2053 S4; `docs/adr/0038-cuoc-goi-native-android-va-ke-hoach-callkit-ios.md`).
  `modules/unichat-calls` là Expo module cục bộ (Kotlin, tự autolink từ `modules/`; `index.ts` trả `null` ngoài
  Android) — chỉ là cầu nối, không chính sách: thông báo cuộc gọi đến `CallStyle.forIncomingCall` + full-screen intent
  trên kênh `calls` (nhạc chuông của máy, `USAGE_NOTIFICATION_RINGTONE`, lặp tới khi hết `timeoutMs`), foreground
  service `CallService` (`phoneCall`, thêm `microphone`/`camera` khi quyền đã cấp) với `CallStyle.forOngoingCall`;
  chỉ `startForegroundService` một lần, cập nhật sau đó đi thẳng tới service đang chạy, loại bị Android từ chối lúc đó
  thì giữ loại đã có và chỉ đổi thông báo (không bao giờ tự dừng service của cuộc gọi đang chạy),
  `CallRinger`, `CallProximity` (wake lock `PROXIMITY_SCREEN_OFF` — màn tắt khi áp tai — chỉ khi cuộc gọi thoại đã nối
  và âm thanh ở loa trong: `lib/audio-outputs.ts › proximityScreenOff`, gắn ở `audio-output-button.tsx`; nhả khi ra loa
  ngoài/tai nghe, khi cuộc gọi đang thu nhỏ (`minimized` từ `call-overlay.tsx`), khi app xuống nền (wake lock
  này tác động cả máy), khi màn cuộc gọi đóng và trong `CallService.stop`; nhả bằng `RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY`; iOS
  chưa có — gọi trên iPhone còn tắt), `CallInterruptions` (cuộc gọi di động trong lúc gọi UniChat, Android 12+: khi
  `CallService` chạy thì nghe `AudioManager.OnModeChangedListener` — không cần quyền, trạng thái cuộc gọi của telephony thì
  cần `READ_PHONE_STATE` —; `MODE_IN_CALL`/`MODE_CALL_SCREENING` là đang giữ máy, event `onCallHeld` + `isCallHeld()`
  tới `components/calls/use-cellular-hold.ts`: tắt micro, đưa âm lượng người khác về 0 — cả người vào sau —, màn cuộc gọi
  hiện "Đang tạm giữ"; trả máy thì bật lại, micro chỉ khi trước đó đang bật; Telecom vẫn chưa làm, ADR 0038 §5), Từ chối/Gác máy → `CallActionReceiver` → headless task `UniChatCallAction` (không khởi động được thì
  `PendingActions` giữ tới lần mở sau), activity hiện trên màn khoá chỉ khi được mở bởi cuộc gọi
  (`CallLockScreen`, nhả khi cuộc gọi xong, và khi lần đổ chuông mở app không thành màn cuộc gọi — cuộc gọi đã kết thúc
  lúc app mở lạnh, công tắc gọi tắt — trước khi tab Chat mở phòng, `use-deep-link-target.ts`; thêm một watchdog native:
  `HOLD_MS` (75 s: cửa sổ chuông 60 s + mở lạnh) sau lần mở cuối mà không có dịch vụ cuộc gọi nào chạy thì tự nhả, dù JS
  có làm gì, cuộc gọi đang diễn ra thì giữ và kiểm lại mỗi `HOLD_MS`. Đồng hồ của `Handler` là uptime, dừng khi máy ngủ
  sâu, nên lần mở còn được tính theo `elapsedRealtime` và `onResume` (bấm nút nguồn đánh thức máy) nhả ngay khi đã quá
  `HOLD_MS` mà không có cuộc gọi — watchdog một mình có thể để app trên màn khoá hàng giờ. Thu nhỏ cuộc gọi đang hiện
  trên màn khoá đòi mở khoá trước: `nativeCalls.leaveLockScreen()` → `CallLockScreen.leave` (`requestDismissKeyguard`,
  Android hỏi PIN/vân tay; huỷ thì màn cuộc gọi ở nguyên, mở được thì nhả giữ để khoá máy lại sẽ che app như thường;
  dưới Android 8 không thu nhỏ được khi máy khoá), `call-overlay.tsx` chỉ thu nhỏ khi nó trả `true`; listener đăng ký qua `UniChatCallsPackage.kt` — autolinking chỉ nhận
  `Package` từ file tên `*Package.kt`). Mã Kotlin nằm trong git: `.gitignore` của app chỉ bỏ `/android/` và `/ios/` ở
  gốc; `native-modules.test.ts` đỏ khi git thiếu project native của module, khi có gì dưới đó bị ignore, khi một
  `Package` nằm sai file, hay khi autolinking không liệt kê `UniChatCallsPackage`. Khai báo ở `plugins/with-unichat-calls.js` (quyền, service, receiver; gỡ
  background mode `fetch` mà plugin tự động của `expo-task-manager` thêm cho iOS, và `audio` trừ khi bản build có gọi trên
  iPhone: `UNICHAT_IOS_CALLS=1`, `app.config.ts › iosCallsBuilt` từ chối nó khi module chưa có phần iOS; bản iPhone
  không có nó đọc `unichat_mobile_calls` là tắt dù server nói gì, `lib/runtime-extra.ts › lackingFlags` qua
  `data/remote-config.ts › setBuildLacks` lúc boot). Chính sách ở TypeScript, test node
  với module giả (`data/calls/native-calls.ts` là no-op khi không có module): `lib/call-push.ts` đọc push cuộc gọi
  (`call_invite`/`call_end`/`call_missed`, mọi giá trị là chuỗi); `data/calls/call-push.ts` quyết định reo — công tắc
  tắt hay hết cửa sổ thì không, màn cuộc gọi đã có cuộc gọi đó (hay cuộc gọi khác) thì không, đang mở app trong một
  workspace thì hỏi danh sách chờ trước, còn lại hiện thông báo native (heads-up khi app đang mở, audit C3); thông báo native
  không hiện được (bản thiếu module, hệ thống từ chối) thì một thông báo thường trên kênh `missed_calls` (`callFallback`
  trong `call-wiring.ts`, id `call-ring:<callId>`) mở màn đổ chuông, push kết thúc gỡ nó — một lần đổ chuông data-only
  không bao giờ mất im lặng;
  **Đổ chuông không cần JavaScript** (review "killed-app-ring-js-dependent"): dịch vụ FCM của app là
  `UniChatMessagingService` (khai ở `plugins/with-unichat-calls.js` với priority 1, trên `ExpoFirebaseMessagingService`
  của expo-notifications ở -1; `android-manifest.test.ts › messagingServices` giữ thứ tự) và đưa mọi tin FCM qua
  `NativeCallPush.handle` trước: push đổ chuông khi activity của app không ở trước (`AppVisibility`, từ listener của
  `UniChatCallsPackage`) và không có cuộc gọi đang chạy thì hiện ngay thông báo CallStyle, không khởi động Hermes hay
  đọc phiên; push kết thúc gỡ nó và thông báo dự phòng `call-ring:<id>`; công tắc tắt hay hết cửa sổ thì
  không reo. Những gì cần JavaScript quyết — app đang mở (engine biết in_app/bận), engine đang giữ một cuộc gọi kể cả khi
  app ở nền (đến, đang gọi đi chưa ai nghe, đang nối, đang nói: `CallEngineLive`, do `call-native-sync.ts › markLive`
  ghi trong bộ nhớ, nên cuộc gọi thứ hai không reo đè lên cuộc gọi đi và người gọi 1-1 nghe "bận"), chưa có cấu hình
  chuông, hệ thống từ chối thông báo — và mọi push khác đi tiếp tới expo-notifications như cũ. Cấu hình chuông
  (`RingConfig`: bật khi công tắc gọi bật — không theo phiên: máy đã đăng xuất không còn token push, còn phiên đang
  khôi phục lúc offline không được làm im chuông —, scheme, chữ theo ngôn ngữ app) do
  `data/calls/native-ring.ts` ghi lúc mở app và mỗi khi công tắc hay ngôn ngữ đổi (`ringSyncEnv` trong
  `call-wiring.ts`); kết quả của đường native (`RingReports`) được đếm khi JavaScript chạy lại: `call_push` `native`, và
  `call_ring` (từ lúc server gọi — `expires_at` trừ cửa sổ 60 s — tới lúc máy reo, cả đường JavaScript với `app`; alert
  `UniChatCallRingSlow`). Task nền JavaScript (`runCallPushTask`) đọc lại cấu hình từ xa đã giữ trước khi quyết, nên
  công tắc tắt vẫn giữ trong runtime không giao diện.
  **Đang có cuộc gọi khác** (cuộc gọi điện thoại hay VoIP của app khác: `AudioManager.mode` là `IN_CALL`,
  `IN_COMMUNICATION` hay `CALL_SCREENING`, đọc lúc reo, mọi API level): thông báo đổ chuông là chờ cuộc gọi — vẫn heads-up
  với Nghe/Từ chối, báo một lần, không `FLAG_INSISTENT` (đang gọi điện thoại thì Android tự thay tiếng của thông báo bằng
  tiếng bíp chờ cuộc gọi; không tắt hẳn tiếng vì thông báo im lặng cũng mất heads-up); chuông trong app chỉ rung ngắn
  (`CallRinger.ringFor`). Telecom vẫn chưa
  làm (ADR 0038 §5): đây là phần thay tạm cho call-waiting của Telecom.
  **Khi app đóng mà máy chặn**: `BackgroundDelivery.kt` báo tối ưu pin, hạn chế nền (API 28+) và hãng có công tắc tự khởi
  động (Xiaomi/Redmi/POCO, Oppo/realme, vivo/iQOO, Huawei/Honor, OnePlus, Asus); Cài đặt › Thông báo
  (`components/settings/background-calls-rows.tsx`, logic ở `lib/background-delivery.ts`) hiện dòng mở trang pin của
  hệ thống (trang của app từ Android 12, danh sách tối ưu pin trước đó) và trang tự khởi động của hãng (không có thì
  trang của app), với các bước theo từng hãng; đọc lại khi quay về app. Không xin `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
  `data/calls/call-actions.ts` (Từ chối khi app đã kill báo server bằng phiên đã lưu qua `POST …/voice/decline`: cuộc
  gọi 1-1 kết thúc như hangup, cuộc gọi nhóm/kênh tiếp tục mà không có người đó, ngừng đổ chuông ở mọi thiết bị của họ —
  server ghi người từ chối trong phiên, danh sách chờ và push đổ chuông bỏ qua họ, `ring_closed` dừng máy Android khác;
  Từ chối cuộc gọi nhóm trên màn cuộc gọi cũng báo như vậy, `data/calls/group-decline.ts`, vì engine là bản copy của
  web chỉ đóng cuộc gọi tại chỗ);
  `data/calls/call-native-sync.ts` theo engine (service từ connecting tới hết, thử lại mỗi lần app về foreground —
  `onAppStateChange`, hỏi `BLUETOOTH_CONNECT` lúc bắt đầu
  trên API 31+, gỡ thông báo đổ chuông khi màn trong app reo, nhả màn khoá). `data/calls/call-wiring.ts` nối tất cả:
  task nền của `expo-task-manager` cho push data-only và headless task đăng ký ở entry mới `index.ts`
  (`data/calls/background-tasks.ts`, trước `expo-router/entry`, để runtime không giao diện cũng có), còn
  `startNativeCalls()` (ở `app/_layout.tsx`) gắn sync, chạy hành động đang chờ và `setNotificationHandler`
  (`lib/notification-presentation.ts`: push của workspace đang mở thì im, khác thì banner). `data/boot.ts` là phần
  boot chung (Sentry, `configureRuntime`, header) mà task nền cũng gọi; `data/app-locale.ts` cho task nền nói đúng ngôn
  ngữ. Kênh Android (`lib/notification-channels.ts`, `data/notification-channels.ts`): `calls`, `call_ongoing` (native),
  `missed_calls`, `mentions`, `messages`, `general`, `chat_quiet`, dịch theo ngôn ngữ app lúc mở và khi đổi ngôn ngữ (hai kênh native,
  khi máy reo trước lần chạy JavaScript đầu, lấy tên từ `res/values*/strings.xml` của module — `values` tiếng Anh,
  `values-vi` tiếng Việt — mà `scripts/sync-i18n.mjs` sinh từ cùng chuỗi `mobile.notify.channel_*`), kênh cũ `chat`
  bị xoá; server chọn kênh theo kind (`push_expo.go › pushChannel`) — đổi âm thanh/độ ưu tiên của kênh thì phải đổi id.
  Mỗi tin chat (DM, nhắc tên, trả lời thread, và tin thường trong nhóm/kênh/phòng workspace) là một push (UNI-2141;
  trước đó chỉ tin đầu của một hàng thông báo còn mở, và tin nhóm/kênh không nhắc tên thì không báo gì):
  `Consumer.write` của server ghi `notification.push` cho mọi tin, kể cả khi hàng gộp, kèm `message_id`; tắt thông báo
  phòng, tắt push theo loại, người gửi và đang đọc phòng (presence) vẫn chặn như cũ. Tin thường trong phòng không phải DM
  là loại `chat_message` (`chat.message.received`, `emitChatMessageNotifications`): mỗi thành viên khác mà tin không
  nhắc tên một hàng, gom theo phòng (`chat_room:<id>:message`, đọc phòng thì đóng), chỉ khi phòng có tối đa
  `chatSmallRoomMembers` (50) thành viên — phòng lớn hơn chỉ báo khi được nhắc tên, như @all; trả lời thread chỉ tới
  người theo dõi thread. Push mặc định bật, email tổng hợp mặc định tắt; tắt push của "Tin nhắn trong nhóm và kênh" ở
  Cài đặt › Thông báo là "chỉ khi được nhắc tên" cho mọi phòng (chưa có mức riêng từng phòng ngoài tắt thông báo phòng). Lane push (nhiều
  worker, nhiều node) giành quyền gửi một tin bằng một câu lệnh dưới khoá của hàng trước khi gửi
  (`ClaimChatNotificationPush`): chỉ được khi hàng chưa đọc và tin đứng sau tin đã giành gần nhất theo thứ tự của phòng
  (`pushed_message_at` = `chat_messages.created_at` theo đồng hồ DB, rồi `pushed_message_id`; không so ULID vì id sinh
  theo đồng hồ từng node). Nên push lặp, push của tin cũ hơn tin đã giành, hay hai worker chạy cùng lúc không gửi
  trùng; gửi lỗi thì trả lại quyền (`ReleaseChatNotificationPush`) để lần thử lại gửi như lần đầu. Gom theo phòng: iPhone nhận `threadId` (aps.thread-id) = `group_key` của hàng và xếp chồng
  các push của phòng. Android: expo-notifications đặt tên thông báo theo `data["tag"]` ở cấp ngoài của tin FCM
  (`FirebaseMessagingDelegate.getNotificationIdentifier`), còn Expo gửi data của server thành một chuỗi JSON dưới
  `body`, nên `UniChatMessagingService` nhấc `tag` (= `group_key`) từ chuỗi đó lên trước khi chuyển cho
  expo-notifications (`PushTag.kt`, test `PushTagTest`) — mỗi push thay thông báo của phòng, và chỉ bản có bước nhấc
  này (cùng bản đăng ký `chat_quiet`) mới nhận tiêu đề thêm "· N tin nhắn mới"; bản cũ vẫn mỗi push một thông báo,
  tiêu đề trơn. Một đợt tin chỉ reo một lần mỗi `chatAlertWindow` (30 s, `push_consumer.go`): `phone_pushed_at`
  là lần cuối điện thoại reo cho hàng, đặt cùng lúc giành quyền và tính theo đồng hồ DB; tin tới trong cửa sổ là tin im (`quiet` = `1` trong data): iPhone không
  `sound`, mức `passive`; Android đi kênh `chat_quiet` (độ ưu tiên mặc định, không chuông, không rung — không để mức thấp, vì Android 10+
  dồn thông báo mức thấp vào mục "Im lặng" thu gọn và bỏ biểu tượng trên thanh trạng thái), chỉ tới bản đã
  đăng ký `chat_quiet: true` (`data/push.ts`, user agent `…; chat-quiet`) — bản cũ không có kênh đó sẽ hiện trên kênh
  dự phòng có chuông, nên không nhận tin im; listener khi app mở cũng không phát tiếng cho tin im
  (`foregroundBehavior`). Đọc phòng đóng hàng, nên tin đầu sau khi đọc luôn reo. Khoá của hành động thông báo là
  `<id thông báo>:<id tin>:<hành động>` (`lib/chat-notification.ts`), và khoá chống chạm hai lần cũng có id tin
  (`lib/notification-response.ts`): Android giữ một id cho mọi push của phòng.
  Thông báo tin chat (DM, nhắc tên, tin nhóm/kênh, trả lời thread) mang category `chat_message` và id workspace/phòng/tin/chủ đề
  (server `push_expo.go › ChatMessageCategory`, `chatData`); app đăng ký category đó lúc mở, khi đổi ngôn ngữ và khi
  khoá UniChat bật/tắt (`components/app/chat-category-sync.tsx`, `data/chat-notification-actions.ts`; khoá đang bật
  thì chỉ còn Đánh dấu đã đọc, câu trả lời gõ vào thông báo cũ bị từ chối và Android đăng lại thông báo nói chưa gửi —
  `device-privacy.md`):
  **Trả lời** (ô nhập) gửi qua outbox như mọi lần gửi rồi đánh dấu phòng đã đọc,
  **Đánh dấu đã đọc** xếp lượt đọc; cả hai gỡ thông báo, không mở app trên Android (task nền thông báo —
  `runCallPushTask` chuyển tiếp — hoặc listener của app đang chạy; mỗi hành động chạy một lần), mở app trên iOS (iOS
  không giao câu trả lời cho JS khi app bị kill và hành động ở nền). `lib/chat-notification.ts` đọc phản hồi (thuần)
  ở cả hai dạng: listener nhận `content.data` đã parse, task nền Android nhận bundle native nguyên trạng — data của push
  Expo là chuỗi JSON ở `content.dataString`, không có `data` (`NotificationSerializer.toBundle`); test dùng cả hai dạng.
  **Chưa làm: thông báo chat kiểu hội thoại trên Android** (MessagingStyle, gom theo phòng; ADR 0038 › Hệ quả). Thông
  báo tin vẫn phẳng (tiêu đề là một câu "X đã nhắn tin cho bạn", thân là bản xem trước) do `ExpoNotificationBuilder`
  dựng. Chỗ móc đúng không phải `UniChatMessagingService` (tự đăng thông báo là bỏ qua intent phản hồi của expo, Trả
  lời và chạm sẽ hỏng) mà là một lớp con `NotificationsService` khai ở priority trên -1 của expo, trả về một
  `ExpoPresentationDelegate` có `createNotification` bọc lại thông báo expo đã dựng. Hợp đồng phải giữ: tag = `tag` của
  data (server: `group_key` của hàng thông báo, `chat_room:<phòng>:dm|:mention`, `chat_thread:<gốc>:reply`) và id 0
  (`ExpoPresentationDelegate.ANDROID_NOTIFICATION_ID`) — đổi một trong hai thì hai push của một nhóm thành hai thông
  báo; extra `EXTRAS_MARSHALLED_NOTIFICATION_REQUEST_KEY` (`getPresentedNotificationsAsync` đọc lại request, nên
  `dismissRoomNotifications` và push `room_read` mới tìm được thông báo theo `room_id`); content intent và hai nút của
  category `chat_message` (Trả lời có RemoteInput) do expo dựng (`NotificationsService.createNotificationResponseIntent`)
  để `runChatNotificationAction` và `data.url` của lần chạm còn chạy; ẩn xem trước (`hiddenPushTitle`, thân rỗng) giữ
  phẳng. Còn thiếu ở server: data push chat chỉ có id, nên MessagingStyle không có tên người gửi và tên phòng tách
  riêng (cần `sender_name`, `room_name`, loại phòng — chỉ khi không ẩn xem trước); mỗi tin giờ đã có push riêng
  (UNI-2141), nên MessagingStyle chỉ cần nối các push cùng tag thay vì thay. Hoãn vì: không build/kiểm được Android ở máy làm
  việc này, và một lỗi ở bước bọc làm hỏng Trả lời/chạm trên mọi push chat; làm sau công tắc mobile mới (keys.go +
  `MOBILE_FLAG_DEFAULTS`), có test Robolectric giữ tag/id/extra/nút, và checklist máy thật Android 11+ (mục Hội thoại
  cần `setShortcutId` với shortcut động dài hạn).
  Badge app = mọi tin chưa đọc (`appBadgeCount`, `data/badge.ts`); iPhone còn nhận số đó trong mỗi push tin (server
  `ChatService.UnreadBadge` → `badge` của push Expo, chỉ khi người đó có iPhone) nên biểu tượng đúng cả khi app đóng;
  nhắc tên, cuộc gọi đến/nhỡ trên iPhone là `interruptionLevel: time-sensitive` (entitlement trong `app.config.ts`).
  Phòng đã đọc — ở máy này (`pending-ops.ts › markRoomRead`) hay ở thiết bị khác khi socket còn mở (`chat.room.read` của
  chính mình) — gỡ thông báo tin của phòng khỏi khay (`data/room-read-signal.ts` → `data/notification-tray.ts`, gắn ở
  `app-startup.ts`; thông báo trả lời chủ đề và cuộc gọi ở lại). Khi app đóng hay socket đã ngủ: đọc phòng ở thiết bị nào
  mà đóng được thông báo DM/nhắc tên còn mở của phòng đó *đã thật sự tới một điện thoại* (`notifications.phone_pushed_at`,
  chỉ đặt khi push gửi được tới một token Expo; push bị giữ lại vì người đó đang đọc phòng, tắt push hay chưa tới lượt
  thì không) thì server ghi `chat.room.notifications_cleared` (cùng
  transaction, `ChatService.closeRoomNotifications`), lane push gửi một push data-only ưu tiên thường `room_read`
  (phòng, workspace, số chưa đọc; `push_expo.go › roomReadMessage`) tới máy Android có call UI, và task nền
  (`runCallPushTask` → `lib/room-read-push.ts`) gỡ thông báo của phòng và đặt badge, không khởi động runtime. Đọc phòng
  không còn thông báo nào đã tới điện thoại thì không gửi gì, nên chat trên web không đánh thức máy; đọc trúng lúc push
  đang trên đường thì lane push tự gửi `room_read` ngay sau push đó (`push_consumer.go › markPhonePushed`); iPhone không nhận (số trên biểu tượng đi theo mỗi push). Android 14+ bị thu hồi full-screen intent thì Cài
  đặt › Thông báo hiện `components/settings/full-screen-calls-row.tsx`. Server: push đổ chuông tới Android là data-only chỉ khi bản đó
  đăng ký token với `call_ui: true` (`registerPushToken({ callUI: nativeCalls.available })`, mỗi lần mở app, và lại khi
  FCM/APNs đổi token lúc app đang chạy — `watchPushTokenRotation`, chỉ khi token máy khác lần trước vì tự lấy token cũng
  phát sự kiện, không hỏi quyền, token Expo đổi thì gỡ cái cũ; server lưu
  user agent `expo/android; call-ui`), bản Android cũ giữ push hiển thị, iPhone không nhận push đổ chuông khi công tắc
  `unichat_mobile_calls_ios` tắt (mặc định; server gộp nó vào `unichat_mobile_calls` của máy gửi `X-Client-OS: ios`, nên
  iPhone cũng ẩn nút gọi; bật nó là bước cuối của PushKit + CallKit, `calls-ios.md`); `chat.voice.ring_closed` (outbox, cùng transaction đóng hàng ring) → push data-only "kết thúc"
  tới máy Android; cuộc gọi 1-1 nhỡ là "Cuộc gọi nhỡ từ X" trên `missed_calls`. Phiên cuộc gọi của server (ai đang đổ
  chuông, đã nghe, đã từ chối) được ghi nhật ký vào Redis (`server/internal/service/chat_voice_journal.go`) nên restart
  hay deploy giữa lúc đổ chuông không làm mất danh sách chờ, push đổ chuông đang xếp hàng hay quyền gác máy của người
  gọi.
  Kotlin có test JVM trên Robolectric (`modules/unichat-calls/android/src/test`, SDK 34 vì CI chạy JDK 17): token khởi
  chạy (chỉ token của chính thông báo đó mới cho hiện trên màn khoá và Nghe, token thu hồi/hết hạn/giả thì không),
  `PendingActions` (giữ 10 mục mới nhất, lấy một lần), và thông báo như hệ thống nhận (`CallStyle` thật, `FLAG_INSISTENT`,
  full-screen intent, intent mang token, chỉ Nghe có `EXTRA_ANSWER`, Gác máy của cuộc gọi đang diễn ra),
  `NativeCallPush` (push Expo đổ chuông khi app đóng thành thông báo theo cấu hình đã ghi, push kết thúc gỡ nó, app đang
  mở hay chưa có cấu hình thì để JavaScript, công tắc tắt hay muộn thì không reo), `BackgroundDelivery` (hãng theo
  thương hiệu con, trạng thái pin, mở trang của hãng hay trang của app), `RingReports`/`RingConfig`, chờ cuộc gọi khi
  máy đang gọi (`CallNotifications`, `CallRinger.ringFor`),
  `CallService` (loại phoneCall, thêm micro/camera khi đã cấp; Android từ chối một loại thì giữ loại đã có, từ chối hết
  lúc đầu thì tự dừng; một cuộc gọi chỉ một `startForegroundService`, cập nhật sau đi thẳng vào dịch vụ đang chạy — shadow
  `ShadowRefusingService` trong test giả lời từ chối theo loại của Android 14), `CallActionReceiver` (Từ chối gỡ thông báo
  đổ chuông, khởi task JS; Android không cho khởi thì hành động nằm ở `PendingActions`), `CallLockScreen` và listener của
  `UniChatCallsPackage` (chỉ lần mở có token đúng mới hiện trên màn khoá và ghi Nghe, một lần kể cả khi activity tạo
  lại; watchdog trả màn khoá khi không thành cuộc gọi, giữ khi dịch vụ cuộc gọi chạy), `CallRinger` (im lặng không reo,
  rung chỉ rung), `CallProximity` (giữ một lần, nhả khi tắt và khi cuộc gọi dừng, máy không có cảm biến thì không giữ); CI chạy
  `:unichat-calls:testReleaseUnitTest` cùng lượt Gradle của `android-release`. Thêm một test instrumented
  (`src/androidTest`, UiAutomator): cuộc gọi đến đăng qua `CallNotifications` hiện trong khay của System UI như một cuộc
  gọi có Nghe/Từ chối và biến mất khi huỷ, và cùng thông báo đó tới từ một push FCM qua `NativeCallPush` không có
  JavaScript (`NativeCallPushRingTest`); `android-release` build APK test (`:unichat-calls:assembleDebugAndroidTest`),
  `android-smoke` cài và chạy nó trên emulator (`am instrument`, đỏ nếu không `OK (`). APK test mang nhãn của app
  (`UniChat`, `src/androidTest/AndroidManifest.xml`): đầu thông báo CallStyle là "người gọi • tên app • giờ" và Android
  chỉ co tên người gọi cho vừa, nên nhãn mặc định (tên gói, 30 ký tự) chiếm hết đầu thông báo trên emulator 320 dp và
  người gọi bị co về rộng 0, UI Automator không thấy. Hai thư mục test nằm ngoài
  fingerprint (`fingerprint.config.js › ignorePaths`): thêm test không tách runtime.
  Hằng đêm `chat-mobile-verify.yml › android-two-party` chạy `maestro/flows/call-answer-incoming.yaml` với FCM thật trên
  emulator Google APIs, khi app ở nền và khi tiến trình bị kill: thông báo CallStyle, Nghe, nối, gác máy.
  **Chỉ máy thật kiểm được** (checklist ở runbook › Cuộc gọi native trên Android): màn toàn màn hình trên máy khoá, nhạc
  chuông theo công tắc chuông/DND, Nghe từ màn khoá (listener của `UniChatCallsPackage` đặt
  `showWhenLocked` khi activity được mở bởi cuộc gọi), micro còn sau khi khoá máy giữa cuộc gọi và khi người kia nối lúc
  app đã ở nền, Từ chối khi app đã kill (headless task, giới hạn
  khởi động service nền), định tuyến Bluetooth, badge theo launcher.
  Kind giàu (M3): endpoint trong `data/chat-api.ts`, lệnh và cache trong
  `data/chat-actions.ts` (follow-up, tạo việc, nhóm, chuyển tiếp; bỏ phiếu ở `pending-ops.ts`, tin thoại và nhắc là
  lượt gửi của outbox), màn gọi qua `data/mutations/*`;
  tin thoại (`components/chat/voice-card.tsx`, `lib/voice-player.ts`): phát/dừng, chạm vào
  thanh sóng để tua, chip tốc độ 1×/1.5×/2×, với trình đọc màn hình là một điều khiển `adjustable` (vuốt lên/xuống tua
  5 s, giá trị là vị trí trong clip, `disabled` khi chưa có URL) — sóng vẫn là hình cố định vì server không giữ waveform;
  composer ghi âm (`components/chat/use-voice-recorder.ts`), mở
  `expression-sheet.tsx` và `reminder-sheet.tsx`; follow-up và "Tạo việc" ở
  sheet nhấn giữ; thẻ việc `task-card.tsx` dưới tin.
- Cuộc gọi trên iPhone: PushKit + CallKit (UNI-2141; `docs/adr/0038-cuoc-goi-native-android-va-ke-hoach-callkit-ios.md`
  §4 là hợp đồng, file này là chi tiết). Expo push service không gửi được VoIP push, nên server gửi thẳng tới APNs.
  **Đăng ký** (app → server): ngoài token Expo, app đăng ký token PushKit qua `POST /api/v1/me/push-subscriptions`
  với `{"endpoint": "<token hex>", "transport": "apns_voip", "apns_environment": "production" | "sandbox",
  "apns_bundle_id": "com.uniworkos.chat" | "com.uniworkos.chat.staging", "platform": "ios"}` (`kind` và
  `bundle_id` được nhận thay `transport` và `apns_bundle_id`). `apns_environment` theo bản build: development → `sandbox`, TestFlight/App Store → `production`. Gọi lại
  mỗi lần mở app và khi PushKit đổi token (`pushRegistry(_:didUpdate:for:)`); `DELETE` cùng route với endpoint là token
  khi đăng xuất. Server (`notification.Service.SubscribeVoIPPush`) kiểm token hex 64–200 ký tự, môi trường và bundle id,
  lưu thành hàng `push_subscriptions` có `transport = 'apns_voip'`, `apns_environment`, `apns_bundle_id` và
  `session_id` của phiên thiết bị; endpoint lưu chữ thường. **Gửi** (`server/internal/notification/push_apns.go`):
  HTTP/2 tới `api.push.apple.com` hoặc `api.sandbox.push.apple.com` theo môi trường của token, JWT ES256 từ khoá `.p8`
  (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`; dùng lại 50 phút, `ExpiredProviderToken` thì ký lại và thử một
  lần nữa), header `apns-push-type: voip`, `apns-topic: <bundle id>.voip` (`APNS_VOIP_TOPIC` ghi đè), `apns-priority:
  10`, `apns-expiration` = lúc hết đổ chuông (lời mời) hoặc bây giờ + 60 giây (kết thúc). 410 `Unregistered` và 400
  `BadDeviceToken` thu hồi token; mọi lỗi khác (429, 5xx, `DeviceTokenNotForTopic`, khoá bị từ chối) để outbox thử lại.
  Metric `uniwork_push_apns_voip_total{result, reason}` (reason là mã của Apple, không có token); log không có token
  hay tên. Thiếu cả ba biến thì VoIP tắt; thiếu một phần hay khoá hỏng thì server log lỗi lúc khởi động và VoIP tắt.
  **Payload** (không có `aps`): `{"uniwork": {"kind": "invite" | "end", "call_id", "room_id", "workspace_id",
  "org_slug", "ws_slug", "caller_name", "video": true | false, "expires_at": "<RFC3339 UTC>"}}`; push `end` không có
  `caller_name`. Tên người gọi theo cùng luật với push gọi Android: lời mời luôn mang nó (kể cả khi ẩn xem trước), vì nó
  chỉ sống trong cửa sổ đổ chuông. **Định tuyến** (`push_consumer.go › sendVoIP`): `unichat_mobile_calls_ios` bật và
  người đó có token PushKit → lời mời đi VoIP trước, token Expo `expo/ios` cùng `session_id` với một token PushKit đã
  nhận thì bỏ qua (không có banner "X đang gọi" chồng lên CallKit); iPhone khác (bản cũ, phiên khác), server không có
  khoá hay token chết thì vẫn nhận push hiển thị như trước; công tắc tắt thì không iPhone nào reo. `chat.voice.ring_closed`
  (nghe ở máy khác, từ chối, kết thúc) gửi `end` tới mọi token PushKit của người đó khi công tắc bật — kể cả iPhone đã
  nghe hay đã từ chối. Push tin, cuộc gọi nhỡ và `room_read` không bao giờ tới token PushKit. Outbox có thể gửi lại cùng
  một lời mời (thử lại sau lỗi), nên app coi `call_id` trùng là một cuộc gọi. **App** (nửa Swift của
  `modules/unichat-calls`): mỗi VoIP push gọi `CXProvider.reportNewIncomingCall` đồng bộ trong callback PushKit — iOS
  13+ giết app và rồi thôi giao VoIP push nếu không báo; `end`, lời mời đã quá `expires_at` hay `call_id` đã kết thúc thì
  báo rồi kết thúc ngay (`reportCall(with:endedAt:reason:)`), còn `end` của cuộc gọi đang diễn ra trên chính máy đó thì
  không gác máy. UUID của CallKit là `call_id` khi nó là UUID, nếu không thì suy ra tất định từ nó (server cho tới 64
  ký tự). Nghe → mở `uniworkchat://open?url=/<org>/<ws>/chat?room=<room>&call=<call_id>` và phát sự kiện JS để màn cuộc
  gọi nối LiveKit; Từ chối → `POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/decline` với
  `{"call_id"}`, đúng API Android dùng. JS thấy cả hai nền tảng qua giao diện trung lập `NativeCallSession` (đến, đã
  nghe, đã từ chối, đã kết thúc; tắt tiếng/giữ máy tuỳ chọn). Test server: `push_apns_test.go` (APNs giả HTTP/2 TLS:
  header, topic, push type, expiration, JWT và cache, payload, 410, tắt khi thiếu khoá), `chat_call_voip_test.go`
  (định tuyến, thu hồi, kết thúc, push tin không tới PushKit), `service_voip_test.go`, `TestNotificationEndpoints`.
  **Việc của chủ sở hữu** trước khi bật công tắc: tạo khoá APNs (Apple Developer › Keys, bật Apple Push Notifications
  service, môi trường Sandbox & Production, tải `AuthKey_<KeyID>.p8` một lần), bật Push Notifications cho App ID
  `com.uniworkos.chat` và `com.uniworkos.chat.staging`, tạo Secret `uniwork-apns` (khoá `APNS_KEY_ID`, `APNS_TEAM_ID` =
  `XJAM488A6D`, `APNS_PRIVATE_KEY` = nội dung PEM) trong namespace của server rồi deploy, kiểm log "APNs VoIP push
  enabled", rồi bật `unichat_mobile_calls_ios` cho một người thử trước (override theo user ở console `/admin`).
