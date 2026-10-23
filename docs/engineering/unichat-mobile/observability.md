# UniChat mobile — Quan sát, cấu hình từ xa và thống kê

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

`data/report.ts`, Sentry, log, cấu hình từ xa và công tắc, thống kê sản phẩm, toast, đăng xuất. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- Quan sát và phát hành (UNI-2053). `data/report.ts` là cửa duy nhất tới báo
  crash (no-op khi chưa có sink; `force` cho boundary). `classifyError` chia ba: mong đợi (mất mạng/timeout = 0,
  401, 403, 404, 408, 410, 429, `AbortError`, `RefusedError`, mã lỗi mà nơi gọi tự nói thành lời — `handledCodes`,
  ví dụ `DELETE_ACCOUNT_HANDLED_CODES`, `VOICE_CALL_HANDLED_CODES`, hay `useCommand(…, { handledCodes })` qua
  `meta` của mutation) thì không báo; 4xx khác (400, 409, 413, 415, 422…) là lệch hợp đồng với server, báo mức
  `warning`; 5xx và lỗi khác là bug, mức `error`. `ApiError` mang `endpoint` (`lib/redact.ts › endpointShape`: method +
  route, id thành `{id}`), báo cáo có tag `endpoint`/`http_status`/`error_code` và fingerprint theo endpoint + status +
  mã, nên mỗi route lệch là một issue riêng. Câu trả lời 2xx app không đọc được: `data/boot.ts` cài
  `schemaDriftLogger` (`setSchemaLogger` của core) nên mỗi lần `parseWithFallback` lùi về fallback được báo mức
  `warning` một lần mỗi endpoint mỗi lần chạy (`SchemaMismatchError`, `lib/schema-mismatch.ts`: endpoint, path và mã
  zod, không bao giờ body); `listWorkspaces` không có fallback (`fetchStrict` của `data/api.ts`: `[]` nghĩa là "chưa
  ở workspace nào") nên lệch là lỗi mức `error`, màn chọn workspace hiện lỗi + Thử lại. Không nuốt lỗi im lặng: lint (`no-restricted-syntax`, fixture
  `lib/lint-quality.test.ts`) cấm `.catch(() => undefined | null | {} | [])`; dùng `.catch(bestEffort(scope, what,
  "report" | "breadcrumb"))` — luôn để breadcrumb, `"report"` còn qua `reportError` (lời gọi server, lỗi là sự cố),
  `"breadcrumb"` cho lời gọi native chỉ mang tính trang trí (rung, splash, share) — hoặc `settled()` của
  `lib/settled.ts` khi chỉ chờ (chuỗi ghi tuần tự, fetch đang chạy mà query tự báo lỗi). `call-engine.ts` báo mọi
  cuộc gọi không bắt đầu/không nối được (breadcrumb + lỗi qua `reportError`); `data/sentry.ts` cài Sentry làm sink khi có DSN (release
  `<appId>@<version>+<build>.<os>`, thêm `.ota.<id>` khi chạy một bản OTA — OS có trong tên vì số build iOS và version
  code Android do EAS đếm riêng nên có thể trùng; tag `channel`/`update_id`/`runtime_version`,
  không ảnh màn hình, không replay, `beforeSend` qua `lib/redact.ts`: email,
  token, query URL, push token, callback PKCE, mọi đoạn trong ngoặc kép hay ngoặc kép cong (tên, phòng, tiêu đề mà
  lời báo lỗi trích), và cả giá trị của `ApiError` — lời của server có thể lặp lại chữ người dùng gõ, nên chỉ còn
  `[server message]`, status/code/endpoint đi bằng tag). Privacy policy (`apps/web/features/landing/privacy-content.ts`)
  nói đúng điều này: app không đưa nội dung tin hay tên vào báo cáo, bộ lọc là lớp thứ hai; đổi bộ lọc thì sửa câu đó. Log qua `data/logger.ts`
  (`createLogger(scope)`: breadcrumb luôn, console chỉ ở dev; `argsLogger` cho
  `ws-client`, chỉ giữ số và boolean) — `no-console` đỏ trong `app/`,
  `components/`, `data/`, `lib/` trừ chính logger (fixture
  `lib/lint-quality.test.ts`). Lỗi query/mutation báo qua `data/query-errors.ts`.
  `ErrorBoundary` export ở `app/_layout.tsx` (root) và `[org]/[ws]/_layout.tsx`
  (workspace), cả hai vẽ `components/ui/error-fallback.tsx`. Hiệu năng khi có DSN (S5): mở app (lạnh/ấm), mỗi
  lần tải màn (TTID tự động; TTFD bằng `ScreenFullyDrawn` của `data/sentry.ts` ở tab Chat khi có danh sách phòng
  và ở phòng khi có trang mới nhất), khung chậm/đơ và JS stall, mẫu 10 % phiên production, và profile Hermes trên
  một nửa số đó (`profilesSampleRate` 0,5 ở production — 5 % phiên — và 1 ở dev/staging); transaction đi qua
  `scrubTransaction` (`lib/redact.ts`: mô tả và data của span mang URL request). Danh tính build:
  `lib/build-info.ts` (thuần) ← `data/build-info.ts` (expo-application,
  expo-updates) → header `X-Client-Version`/`-OS`/`-Update-Id`
  (`api.setClientIdentity` lúc boot), `client_version` của socket, Cài đặt ›
  Giới thiệu (`components/settings/about-section.tsx`). Cấu hình từ xa:
  `data/remote-config.ts` đọc `GET /api/v1/config` lúc mở và mỗi lần
  foreground (`min_supported_mobile_version`, `mobile_flags`, link store);
  `components/app/update-gate.tsx` chặn cả app (cả màn đăng nhập) khi version
  dưới mức tối thiểu; `recommended_mobile_version` (server `UNICHAT_MOBILE_RECOMMENDED_VERSION`) là lời nhắc mềm:
  `components/app/update-nudge.tsx` trên danh sách chat, `lib/build-info.ts › updateNudgeFor` quyết định, bản đã "Để sau"
  giữ ở device store (`data/release/update-nudge.ts`), không bao giờ cùng lúc với màn chặn; `useMobileFlag(name)` / `readMobileFlag(qc, name)` cho
  công tắc (`unichat_mobile_calls`: tắt thì ẩn nút gọi, không đổ chuông — cả màn đổ chuông
  native của Android, push cuộc gọi mở phòng; server cũng không gửi push cuộc gọi hay push kết thúc cho người đó —
  `PushConsumer.SetMobileCalls`; cuộc gọi đang diễn ra không bị cắt và giữ dịch vụ cuộc gọi;
  `unichat_mobile_media_upload` / `unichat_mobile_voice_messages`: ô soạn tin bỏ ảnh/tệp khỏi menu đính kèm / bỏ nút ghi
  âm; `unichat_mobile_ai_catch_up`: `CatchUpBanner` không hiện; `unichat_mobile_outbox_flush`: `flushOwed` không tự gửi
  lại gì, gửi từ ô soạn tin và Thử lại vẫn chạy; `unichat_mobile_chat_sync`: reconnect và tick yên lặng không đọc
  `GET …/chat/sync`, đi đường refetch cũ; `unichat_mobile_timeline_recycled`, mặc định tắt: bật thì phòng mở sau đó
  vẽ danh sách tin trên FlashList 2, tag `timeline_list` của Sentry ghi danh sách nào). Công tắc mới: thêm vào `MOBILE_FLAG_DEFAULTS` và vào catalogue
  `server/internal/featureflags/keys.go` với `Mobile: true`, cùng `Default` và `ReviewAt` (`data/server-contract.test.ts`
  đỏ khi lệch); bật dần theo tỷ lệ người dùng là việc của server (`FF_<KEY>=N%`, runbook). Câu trả lời cuối của server được giữ trên máy
  (`remote-config/v1` trong device store, `persistRemoteConfig`, ≤ 30 ngày, ngoài mọi tài khoản — nên đăng xuất
  (`clearAccountCache(qc, openDeviceStore)`) bỏ công tắc cả trong bộ nhớ lẫn bản giữ, chỉ giữ mức tối thiểu và link store) và gieo lại vào query
  lúc mở (`restoreRemoteConfig`, đề ngày lúc nhận nên query hỏi lại ngay): kill switch và mức tối thiểu giữ qua một lần
  mở lạnh không mạng. Chưa từng có câu trả lời và server không tới được thì không chặn gì và mọi công tắc ở mặc định.
  Thống kê sản phẩm (audit "no-product-analytics"): `data/analytics.ts` (khởi ở `data/app-startup.ts › startAppServices`, mà `app/_layout.tsx` gọi lúc boot) xếp hàng sự kiện
  ẩn danh — `app_open` cold/warm, `first_screen` (ms từ lúc JS chạy), `message_send` sent/failed (`observeChatSends` của
  `data/chat-send.ts`, ms từ lúc viết), `push_open` chat/call/other, `call_connect` connected (ms từ `connecting` tới lúc phòng media nối, `callEngine.onMediaConnected`; `active` chỉ là đã có token) / failed (`connect_failed`, `start_failed`, hay phòng media buông trước khi nối; tự cúp máy thì không tính),
  `call_push` shown/native/fallback/in_app/ignored/cleared/lost (việc push cuộc gọi đã làm trên máy, `runCallPushTask`;
  `native` là thông báo do dịch vụ FCM đăng trước khi có JavaScript, `data/calls/native-ring.ts › reportNativeRings`
  đếm khi app chạy lại; ring lỗi ném ra cũng là lost; trong runtime không giao diện sự kiện chờ tới khi app mở; alert
  `UniChatCallRingsDegraded` khi > 10 % push đổ chuông của một bản thành fallback/lost), `call_ring` native/app (ms từ
  lúc server gọi tới lúc máy reo; alert `UniChatCallRingSlow` khi p95 > 5 s), `call_reconnect` recovered (ms từ lúc
  đường media rớt tới lúc LiveKit nối lại) / dropped, `ota_launch` emergency/failed_update và `app_crash` last_run
  (`data/release/launch-health.ts`, mỗi lần mở lạnh từ `startAppServices`: expo-updates quay về bundle nhúng hay bỏ qua
  một bản OTA crash trước màn đầu — `lib/ota-launch.ts` đọc `isEmergencyLaunch`, so bản đang chạy với bản lần mở trước
  chạy và bản expo-updates báo đã tải cho lần mở này (`latestContext`/`addUpdatesStateChangeListener`, giữ trong device
  store), cùng dòng log iOS `markFailedLaunchForUpdate`; Android không ghi log nào nêu id bản bị bỏ qua — thì thêm một
  báo cáo `OtaLaunchError` tag `ota_failure`/`failed_update_id`/`failed_update_evidence`, fingerprint theo OS và bản OTA, mà job sức khoẻ bản phát hành
  đếm cho đúng bản đó; `crashedLastRun` của Sentry nói lần chạy trước crash; alert `UniChatMobileUpdateLaunchFailures`
  và `UniChatMobileCrashes` báo qua Alertmanager không chờ Sentry; `UniChatMobileSendFailures` khi > 5 % tin của một bản
  hỏng hẳn; alert của chính Sentry là code ở `deploy/sentry/unichat-mobile-alerts.json`, `scripts/mobile-sentry-alerts.mjs`)
  — gửi theo lô ≤ 20 mỗi phút và khi vào nền tới `POST /api/v1/mobile/events` (server chỉ cộng bộ đếm
  `uniwork_mobile_events_total` theo OS, version và bản OTA / histogram `uniwork_mobile_event_duration_seconds` theo OS
  và version; dashboard `deploy/grafana/dashboards/unichat-mobile.json`; không lưu gì của người hay nội dung); không thử lại, hàng tối đa 60. Tắt ở Cài đặt › Quyền riêng tư và bảo mật (`usageStats` trong
  `lib/app-lock.ts`, mặc định bật; tắt thì hàng bị bỏ). Sự kiện mới thì thêm vào `ProductEvent` và vào tập đóng
  `mobileEventResults` của `server/internal/metrics/mobile_events.go` cùng commit, và cập nhật bảng Quyền riêng tư của
  `store/listing.md`. Lỗi một thao tác → `toast.error(...)`
  (`data/stores/toast-store.ts`, `components/ui/toast-host.tsx`); `Alert.alert`
  chỉ cho xác nhận thật (xoá, rời, thu hồi) và trong sheet là `Modal` (toast vẽ
  dưới cửa sổ Modal). Đăng xuất: `useAuthStore.logout()` tự gỡ push
  subscription trước (tối đa 3 s); phiên đã bị server kết thúc thì chỉ quên
  token, server bỏ qua thiết bị đó. Mọi lần đăng xuất, kể cả do server (thiết bị bị thu hồi, refresh bị dùng lại),
  xoá cache ảnh của expo-image (đĩa không mã hoá), thông báo còn trong khay và badge
  (`data/local-wipe.ts › wipeSessionTraces`, gọi từ `forgetAccountLocally`): máy mất rồi bị thu hồi không giữ ảnh
  hay banner tin nào. Cache của tài khoản bỏ qua
  `clearAccountCache` (`data/remote-config.ts`), không `queryClient.clear()`:
  query cấu hình từ xa được giữ (update gate quan sát nó suốt đời app; xoá thì
  gate đứng ở câu trả lời cũ) và hỏi lại không kèm tổ chức.
