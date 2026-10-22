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
  Push "X đang gọi" mang `?call=`; tab Chat gọi `callEngine.ringFromPush` (màn đổ chuông, không tự trả lời);
  không URL nào nhận cuộc gọi: `answer=` bị bỏ qua (`lib/deep-link.test.ts`), vì link từ trang web, tin nhắn hay app khác
  trên máy (intent VIEW ngầm) đều mở được app. Nút Nghe của thông báo native mở cùng link đổ chuông, kèm token ngẫu
  nhiên của lần đổ chuông đó trong PendingIntent (`CallLaunchTokens.kt`: chỉ hệ thống và app đọc được extra của
  PendingIntent); listener kiểm token rồi ghi "đã bấm Nghe", tab Chat hỏi `nativeCalls.takeAnsweredCall(callId)` rồi mới
  `joinFromPush`. Launch không có token đúng (app khác giả extra của cuộc gọi) không hiện trên màn khoá và không nghe.
  Link `dm=` hỏi trước khi mở/tạo DM (`Alert`, nêu tên nếu cache thành viên có). Cần dev client (EAS), không chạy Expo Go.
- Cuộc gọi native trên Android (UNI-2053 S4; `docs/adr/drafts/0038-cuoc-goi-native-android-va-ke-hoach-callkit-ios.md`).
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
  background mode `fetch` mà plugin tự động của `expo-task-manager` thêm cho iOS). Chính sách ở TypeScript, test node
  với module giả (`data/calls/native-calls.ts` là no-op khi không có module): `lib/call-push.ts` đọc push cuộc gọi
  (`call_invite`/`call_end`/`call_missed`, mọi giá trị là chuỗi); `data/calls/call-push.ts` quyết định reo — công tắc
  tắt hay hết cửa sổ thì không, màn cuộc gọi đã có cuộc gọi đó (hay cuộc gọi khác) thì không, đang mở app trong một
  workspace thì hỏi danh sách chờ trước, còn lại hiện thông báo native (heads-up khi app đang mở, audit C3); thông báo native
  không hiện được (bản thiếu module, hệ thống từ chối) thì một thông báo thường trên kênh `missed_calls` (`callFallback`
  trong `call-wiring.ts`, id `call-ring:<callId>`) mở màn đổ chuông, push kết thúc gỡ nó — một lần đổ chuông data-only
  không bao giờ mất im lặng;
  `data/calls/call-actions.ts` (Từ chối khi app đã kill chỉ báo server cho cuộc gọi 1-1, bằng phiên đã lưu);
  `data/calls/call-native-sync.ts` theo engine (service từ connecting tới hết, thử lại mỗi lần app về foreground —
  `onAppStateChange`, hỏi `BLUETOOTH_CONNECT` lúc bắt đầu
  trên API 31+, gỡ thông báo đổ chuông khi màn trong app reo, nhả màn khoá). `data/calls/call-wiring.ts` nối tất cả:
  task nền của `expo-task-manager` cho push data-only và headless task đăng ký ở entry mới `index.ts`
  (`data/calls/background-tasks.ts`, trước `expo-router/entry`, để runtime không giao diện cũng có), còn
  `startNativeCalls()` (ở `app/_layout.tsx`) gắn sync, chạy hành động đang chờ và `setNotificationHandler`
  (`lib/notification-presentation.ts`: push của workspace đang mở thì im, khác thì banner). `data/boot.ts` là phần
  boot chung (Sentry, `configureRuntime`, header) mà task nền cũng gọi; `data/app-locale.ts` cho task nền nói đúng ngôn
  ngữ. Kênh Android (`lib/notification-channels.ts`, `data/notification-channels.ts`): `calls`, `call_ongoing` (native),
  `missed_calls`, `mentions`, `messages`, `general`, dịch theo ngôn ngữ app lúc mở và khi đổi ngôn ngữ, kênh cũ `chat`
  bị xoá; server chọn kênh theo kind (`push_expo.go › pushChannel`) — đổi âm thanh/độ ưu tiên của kênh thì phải đổi id.
  Thông báo tin chat (DM, nhắc tên, trả lời chủ đề) mang category `chat_message` và id workspace/phòng/tin/chủ đề
  (server `push_expo.go › ChatMessageCategory`, `chatData`); app đăng ký category đó lúc mở và khi đổi ngôn ngữ
  (`data/chat-notification-actions.ts`): **Trả lời** (ô nhập) gửi qua outbox như mọi lần gửi rồi đánh dấu phòng đã đọc,
  **Đánh dấu đã đọc** xếp lượt đọc; cả hai gỡ thông báo, không mở app trên Android (task nền thông báo —
  `runCallPushTask` chuyển tiếp — hoặc listener của app đang chạy; mỗi hành động chạy một lần), mở app trên iOS (iOS
  không giao câu trả lời cho JS khi app bị kill và hành động ở nền). `lib/chat-notification.ts` đọc phản hồi (thuần)
  ở cả hai dạng: listener nhận `content.data` đã parse, task nền Android nhận bundle native nguyên trạng — data của push
  Expo là chuỗi JSON ở `content.dataString`, không có `data` (`NotificationSerializer.toBundle`); test dùng cả hai dạng.
  Badge app = mọi tin chưa đọc (`appBadgeCount`, `data/badge.ts`); iPhone còn nhận số đó trong mỗi push tin (server
  `ChatService.UnreadBadge` → `badge` của push Expo, chỉ khi người đó có iPhone) nên biểu tượng đúng cả khi app đóng;
  nhắc tên, cuộc gọi đến/nhỡ trên iPhone là `interruptionLevel: time-sensitive` (entitlement trong `app.config.ts`).
  Phòng đã đọc — ở máy này (`pending-ops.ts › markRoomRead`) hay ở thiết bị khác khi socket còn mở (`chat.room.read` của
  chính mình) — gỡ thông báo tin của phòng khỏi khay (`data/room-read-signal.ts` → `data/notification-tray.ts`, gắn ở
  `app-startup.ts`; thông báo trả lời chủ đề và cuộc gọi ở lại). Android 14+ bị thu hồi full-screen intent thì Cài
  đặt › Thông báo hiện `components/settings/full-screen-calls-row.tsx`. Server: push đổ chuông tới Android là data-only chỉ khi bản đó
  đăng ký token với `call_ui: true` (`registerPushToken({ callUI: nativeCalls.available })`, mỗi lần mở app, và lại khi
  FCM/APNs đổi token lúc app đang chạy — `watchPushTokenRotation`, chỉ khi token máy khác lần trước vì tự lấy token cũng
  phát sự kiện, không hỏi quyền, token Expo đổi thì gỡ cái cũ; server lưu
  user agent `expo/android; call-ui`), bản Android cũ giữ push hiển thị, iPhone không nhận push đổ chuông khi công tắc
  `unichat_mobile_calls_ios` tắt (mặc định; server gộp nó vào `unichat_mobile_calls` của máy gửi `X-Client-OS: ios`, nên
  iPhone cũng ẩn nút gọi — chưa có CallKit/PushKit); `chat.voice.ring_closed` (outbox, cùng transaction đóng hàng ring) → push data-only "kết thúc"
  tới máy Android; cuộc gọi 1-1 nhỡ là "Cuộc gọi nhỡ từ X" trên `missed_calls`.
  Kotlin có test JVM trên Robolectric (`modules/unichat-calls/android/src/test`, SDK 34 vì CI chạy JDK 17): token khởi
  chạy (chỉ token của chính thông báo đó mới cho hiện trên màn khoá và Nghe, token thu hồi/hết hạn/giả thì không),
  `PendingActions` (giữ 10 mục mới nhất, lấy một lần), và thông báo như hệ thống nhận (`CallStyle` thật, `FLAG_INSISTENT`,
  full-screen intent, intent mang token, chỉ Nghe có `EXTRA_ANSWER`, Gác máy của cuộc gọi đang diễn ra),
  `CallService` (loại phoneCall, thêm micro/camera khi đã cấp; Android từ chối một loại thì giữ loại đã có, từ chối hết
  lúc đầu thì tự dừng; một cuộc gọi chỉ một `startForegroundService`, cập nhật sau đi thẳng vào dịch vụ đang chạy — shadow
  `ShadowRefusingService` trong test giả lời từ chối theo loại của Android 14), `CallActionReceiver` (Từ chối gỡ thông báo
  đổ chuông, khởi task JS; Android không cho khởi thì hành động nằm ở `PendingActions`), `CallLockScreen` và listener của
  `UniChatCallsPackage` (chỉ lần mở có token đúng mới hiện trên màn khoá và ghi Nghe, một lần kể cả khi activity tạo
  lại; watchdog trả màn khoá khi không thành cuộc gọi, giữ khi dịch vụ cuộc gọi chạy), `CallRinger` (im lặng không reo,
  rung chỉ rung), `CallProximity` (giữ một lần, nhả khi tắt và khi cuộc gọi dừng, máy không có cảm biến thì không giữ); CI chạy
  `:unichat-calls:testReleaseUnitTest` cùng lượt Gradle của `android-release`. Thêm một test instrumented
  (`src/androidTest`, UiAutomator): cuộc gọi đến đăng qua `CallNotifications` hiện trong khay của System UI như một cuộc
  gọi có Nghe/Từ chối và biến mất khi huỷ; `android-release` build APK test (`:unichat-calls:assembleDebugAndroidTest`),
  `android-smoke` cài và chạy nó trên emulator (`am instrument`, đỏ nếu không `OK (`). Hai thư mục test nằm ngoài
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
