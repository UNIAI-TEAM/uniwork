# apps/chat-mobile

App Expo (iOS + Android) của UniChat (lát M1, UNI-1831): đăng nhập PKCE qua
trình duyệt hệ thống, chọn workspace, một socket realtime, push Expo, deep
link, bốn tab; tab Chat thật từ M2a (UNI-1832, mục Cấu trúc). Spec:
`docs/superpowers/specs/2026-10-16-unichat-mobile-foundation-design.md`;
plan: `docs/superpowers/plans/2026-10-17-unichat-mobile-foundation.md`;
luật gốc: ADR 0011. Mirror từ `usf/apps/mobile` — mỗi file copy ghi một dòng
"Ported from usf apps/mobile/<path>" ở đầu và sạch tên thương hiệu usf
(`scripts/no-usf-leak.test.mjs`).

## Ranh giới import (lint, không phải quy ước)

`eslint.config.mjs` dùng `@typescript-eslint/no-restricted-imports`: cấm
`@uniwork/views*`, `@uniwork/ui*`, `next/*`, `@react-navigation/*`, đường
dẫn tương đối vào `packages/*`; cấm `@uniwork/core` và mọi subpath trừ
allowlist trong `scripts/mobile-core-allowlist.test.mjs` (`api/schema`,
`api/endpoints/chat-schemas`, `permissions/rules`, `paths/paths`,
`paths/marketing`, `types/events`, các `chat/*-utils` thuần…) và
`@uniwork/core/types/*` chỉ với `import type`. Hai danh sách phải giống
nhau; test đó đi theo import bắc cầu của từng mục nên mục không thuần phải
tách file ở core, không nới lint. Fixture: `lib/lint-boundary.test.ts`.
Logic khác của web: **copy, ghi nguồn**, test parity — không import.

Cùng file lint còn giữ năm luật chất lượng (fixture: `lib/lint-quality.test.ts`):
`@typescript-eslint/no-explicit-any` bật (base tắt cho web); bộ `all` của
`eslint-plugin-react-native-a11y` (role, state, value, action, live region,
`importantForAccessibility` hợp lệ; không touchable trong phần tử `accessible`)
trừ `has-accessibility-hint` — tắt có lý do ghi trong config: hint chỉ dùng khi
nhãn không nói rõ kết quả; `i18next/no-literal-string` (`jsx-text-only`)
như `packages/views`; `no-console` ngoài `data/logger.ts`; và không `Modal` của react-native
ngoài `components/ui/call-aware-modal.tsx` (sheet phải đóng khi có cuộc gọi đến). Tắt một luật ở
một dòng thì ghi lý do ở dòng trên.

## Cấu trúc

- `app.config.ts` — cấu hình duy nhất, không `app.json`, **không `.env`**
  (pre-commit từ chối). Biến build: `UNICHAT_ENV` (`dev`|`staging`|`production`),
  `UNICHAT_API_URL`, `UNICHAT_APP_URL` (bắt buộc với staging/production: thiếu
  thì config ném lỗi trên máy build EAS (`EAS_BUILD=true`) thay vì ship bản trỏ
  `localhost`; ngoài đó đọc là chuỗi rỗng, vì eas-cli đọc config một lần để lấy
  project id trước khi nạp môi trường EAS chứa URL), `UNICHAT_EAS_PROJECT_ID`
  (ghi đè hằng `EAS_PROJECT_ID`), `GOOGLE_SERVICES_JSON` (biến EAS kiểu file →
  `android.googleServicesFile`; thiếu thì Android không lấy được push token),
  `SENTRY_DSN` (→ `extra.sentryDsn`; thiếu thì không khởi động Sentry);
  kết quả nằm ở `extra` (`apiUrl`,
  `appUrl`, `authClientId=uniwork-chat-mobile`, `deploymentId`, `eas.projectId`
  khi có dự án EAS, `sentryDsn`) và app gọi `configureRuntime()` lúc boot.
  `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` chỉ là biến môi trường của
  build (plugin `@sentry/react-native/expo` không nhận tham số nào ngoài `url`),
  để fingerprint không đổi theo chúng. Bundle id
  `com.uniworkos.chat{.dev,.staging}`, scheme `uniworkchat-dev` (dev) / `uniworkchat`; universal link chỉ xác minh
  với id prod.
- `lib/` — helper thuần + test vitest (env node). `theme.ts`/`global.css`/
  `tailwind.config.js` mirror nhau; giá trị là `packages/ui/styles/tokens.css`
  đổi sang HSL, đổi một nơi thì đổi cả ba. `radius-tokens.json` là thang
  `--radius-*` của tokens.css. Ngoại lệ có chủ ý (R4b, UNI-1916): các slot
  `chat-*` của chế độ tối và `call-surface` lấy giá trị của canvas, ghi trong
  comment. Mặt người / phòng / workspace là `--tint-*-solid` theo
  `lib/identity-tint.ts` (bảy tint, cùng hash với web) với chữ cái của
  `lib/initials.ts`. Font: Inter (thân) và Plus Jakarta Sans (`font-display`:
  tiêu đề, tên) nhúng bằng plugin `expo-font` trong `app.config.ts`.
- `data/` (Task 2–3) — `auth/*` (port từ `apps/chat-desktop/src/main/auth/*`),
  `realtime/ws-client.ts`, `api.ts`, `secure-storage.ts`, `session-epoch.ts`.
  Realtime ba tầng: `ws-client` (socket, auth frame, scope/replay, 4001 →
  refresh → reconnect), `realtime-provider` (mount theo auth + workspace,
  AppState/NetInfo), `use-<feature>-realtime` (hook theo feature, patch rồi
  invalidate hẹp). Luật socket: frame `subscribe`/`unsubscribe` chỉ đi sau
  `auth_ack` (server đòi auth là frame đầu; replay lo phần còn lại); frame
  `{error}` trước auth là kết thúc của socket đó — `onSessionEnded(error)`, client
  không tự redial; provider giao cho `realtime/socket-recovery.ts` (thuần): 4001 và
  `invalid token` thì refresh, refresh lỗi tạm thời thì thử lại theo backoff
  2/5/15/60 s có jitter (`data/retry-timers.ts`), `too many connections` thì redial
  theo cùng backoff, lời từ chối khác (không phải thành viên) thì chờ tín hiệu sau;
  reset khi socket `online`. `active` chỉ `resume()` khi socket đã pause (trạng thái
  `offline`) hoặc chưa auth. Reader token cho provider là
  `realtime/refresh-for-socket.ts` (thuần): thử token hiện tại trước, refresh
  khi vẫn là token đã chết, thất bại tạm thời thì reject để giữ phiên.
  `ws-client` báo trạng thái `connecting`/`online`/`waiting`/`offline`
  (`onConnectionStateChange`), provider đưa qua `useConnectionState()` cho
  `components/chat/connection-banner.tsx` ("Đang chờ mạng…" khi NetInfo offline,
  "Đang kết nối…" khi socket mất quá 1.5 s; trên danh sách chat và mọi cuộc trò chuyện).
- Offline-first (UNI-2053 S3; audit P0-3, R1–R5, C1). **Mở lạnh**: `useAuthStore.initialize()`
  đọc cùng lúc phiên (`session.restore({ awaitRefresh: false })`: có credential là đủ, refresh chạy nền), người
  dùng cuối (`data/auth/last-user.ts`, Keychain cạnh phiên, ghi sau mỗi `/me`/`setUser`, bỏ qua khi epoch đổi),
  workspace và các hàng đợi; có credential + người dùng đã lưu thì vào inbox ngay và `/me` revalidate phía sau.
  Chỉ phán quyết của server (onChange(null), `onUnauthorized`) mới đăng xuất; offline/5xx/timeout giữ người dùng.
  Server đã kết thúc phiên trước khi ai được vào (refresh hết hạn, thiết bị bị thu hồi) mà máy còn người dùng đã lưu
  hay hàng đợi thì xoá như đăng xuất (outbox và tệp, lượt chờ, cache đĩa, workspace); màn chat chỉ hiện và thử lại
  tin chờ của chính người đang đăng nhập (`selectRoomSends` lọc theo người gửi). `login()` và `adoptSession()`
  dùng chung một lần nhận người dùng; `restoreAccountCache` gộp hai lần gọi cho cùng người và chỉ lần gọi cuối
  được ghi đĩa (một lần dừng — đăng xuất, cài lại — làm lần khôi phục đang chạy không hydrate, không ghi).
  Splash (`expo-splash-screen`, plugin trong `app.config.ts`) giữ tới khi `isLoading` tắt, tối đa 8 s
  (`app/_layout.tsx`). **Kho trên máy**: `data/storage/device-store.ts` (thuần, mặc định bộ nhớ — test node không
  cần mock) ← `native-device-store.ts` cài lúc boot: MMKV (`react-native-mmkv` + `react-native-nitro-modules`)
  mã hoá AES-256, khoá ngẫu nhiên trong Keychain/Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`); mở lỗi thì chạy
  bằng bộ nhớ và log. Store zustand persist trên đó dùng `skipHydration` + hydrate trong `initialize()` và bỏ mọi
  lần ghi trước khi hydrate (không ghi đè hàng đợi trên đĩa bằng mảng rỗng). **Outbox**: `data/chat-send.ts` —
  mọi lần gửi (chữ, ảnh/tệp, tin thoại, nhắc hẹn) vào `stores/chat-send-store.ts` (persist; `sending` → `queued`
  khi đọc lại, `client_msg_id` làm replay an toàn), tệp chép vào `documents/outbox/<clientMsgId>/`
  (`data/outbox-files.ts`) trước khi xếp hàng, xoá khi server nhận, khi bỏ hoặc khi đăng xuất; lúc giao tìm lại bản
  chép theo `<clientMsgId>/<tên>` dưới thư mục documents hiện tại (iOS có thể dời container khi cập nhật), tệp đã mất
  thì tin thành `failed` ngay (không tải lên, hàng của phòng đi tiếp); một hàng FIFO nghiêm
  ngặt cho mỗi (workspace, phòng, người gửi), một lần gửi một tin; guard flush theo workspace + người gửi; lỗi tạm
  thời giữ hàng của phòng và thử lại theo backoff; flush khi mở workspace, NetInfo online, socket reconnect và mỗi
  lần về foreground (`use-chat-realtime.ts`). **Đọc, biểu cảm, bình chọn offline**: `data/pending-ops.ts` +
  `stores/pending-ops-store.ts` — cache hiện lựa chọn ngay (`lib/optimistic-message.ts`, luật toggle của server),
  mỗi thứ một mục giữ mong muốn cuối; endpoint của server là toggle nên lần giao có thể đã tới (mất câu trả lời,
  khởi động lại) và mọi phiếu bầu đều GET tin trước rồi chỉ chạm phần còn khác; từ chối hẳn thì bỏ, refetch phòng
  và reject cho màn hình báo (lượt đọc thì báo Sentry, không toast). Sửa và xoá tin vẫn chỉ online. **Cache đĩa**:
  `data/query-persister.ts` — allowlist `["workspaces"]`, rooms, unread-summary, nicknames, members, room-members và
  trang mới nhất của 12 phòng hoạt động gần nhất; ghi sau 1 s yên; buster `<version>:<userId>`; khôi phục trước
  màn đầu (`restoreAccountCache` trong auth store), xoá khi đăng xuất (`dropAccountCache`). Thêm query vào cache
  đĩa thì sửa `shouldPersistQuery` và test. **Realtime**: `chat-realtime.ts` không bỏ frame khi GET lỗi (tin mới →
  catch-up phòng, sửa/nhắc → refetch phòng, trả lời chủ đề → refetch chủ đề, danh sách theo sau); mỗi phòng một GET
  một lúc, frame đến trong lúc đó gộp theo tin và từ 2 tin mới trên timeline đang hiện thì đọc bằng một catch-up.
  Reconnect (mỗi lần về foreground) giữ mọi trang đã cuộn của phòng đang hiện và refetch từng trang (nối lại từ trang
  mới nhất) để thấy sửa/xoá/biểu cảm lúc offline; chỉ mở lại phòng mới cắt về trang mới nhất.
- Quan sát và phát hành (UNI-2053). `data/report.ts` là cửa duy nhất tới báo
  crash (no-op khi chưa có sink; 4xx và mất mạng không báo; `force` cho
  boundary); `data/sentry.ts` cài Sentry làm sink khi có DSN (release
  `<appId>@<version>+<build>`, tag `channel`/`update_id`/`runtime_version`,
  không ảnh màn hình, không replay, `beforeSend` qua `lib/redact.ts`: email,
  token, query URL, push token, callback PKCE). Log qua `data/logger.ts`
  (`createLogger(scope)`: breadcrumb luôn, console chỉ ở dev; `argsLogger` cho
  `ws-client`, chỉ giữ số và boolean) — `no-console` đỏ trong `app/`,
  `components/`, `data/`, `lib/` trừ chính logger (fixture
  `lib/lint-quality.test.ts`). Lỗi query/mutation báo qua `data/query-errors.ts`.
  `ErrorBoundary` export ở `app/_layout.tsx` (root) và `[org]/[ws]/_layout.tsx`
  (workspace), cả hai vẽ `components/ui/error-fallback.tsx`. Danh tính build:
  `lib/build-info.ts` (thuần) ← `data/build-info.ts` (expo-application,
  expo-updates) → header `X-Client-Version`/`-OS`/`-Update-Id`
  (`api.setClientIdentity` lúc boot), `client_version` của socket, Cài đặt ›
  Giới thiệu (`components/settings/about-section.tsx`). Cấu hình từ xa:
  `data/remote-config.ts` đọc `GET /api/v1/config` lúc mở và mỗi lần
  foreground (`min_supported_mobile_version`, `mobile_flags`, link store);
  `components/app/update-gate.tsx` chặn cả app (cả màn đăng nhập) khi version
  dưới mức tối thiểu; `useMobileFlag(name)` / `readMobileFlag(qc, name)` cho
  công tắc (`unichat_mobile_calls`: tắt thì ẩn nút gọi, không đổ chuông — cả màn đổ chuông
  native của Android, push cuộc gọi mở phòng; server cũng không gửi push cuộc gọi hay push kết thúc cho người đó —
  `PushConsumer.SetMobileCalls`; cuộc gọi đang diễn ra không bị cắt và giữ dịch vụ cuộc gọi). Chưa có câu trả lời hay server không tới được thì không
  chặn gì và mọi công tắc ở mặc định. Lỗi một thao tác → `toast.error(...)`
  (`data/stores/toast-store.ts`, `components/ui/toast-host.tsx`); `Alert.alert`
  chỉ cho xác nhận thật (xoá, rời, thu hồi) và trong sheet là `Modal` (toast vẽ
  dưới cửa sổ Modal). Đăng xuất: `useAuthStore.logout()` tự gỡ push
  subscription trước (tối đa 3 s); phiên đã bị server kết thúc thì chỉ quên
  token, server bỏ qua thiết bị đó. Cache của tài khoản bỏ qua
  `clearAccountCache` (`data/remote-config.ts`), không `queryClient.clear()`:
  query cấu hình từ xa được giữ (update gate quan sát nó suốt đời app; xoá thì
  gate đứng ở câu trả lời cũ) và hỏi lại không kèm tổ chức.
- Tuân thủ store (UNI-2053 S2; Apple 5.1.1(v), 1.2, 5.1.2(i), Play account deletion/UGC/FGS). **Xóa tài khoản**:
  Cài đặt › Xóa tài khoản (`components/settings/delete-account.tsx`, port dialog web) nêu hệ quả, xin một bằng chứng
  theo `lib/account-deletion.ts` (mật khẩu, else mã hai lớp, else gõ lại email), gọi `POST /me/delete`
  (`data/account-api.ts`), `owner_must_transfer` → hướng dẫn chuyển quyền trên web; thành công thì
  `useAuthStore.accountDeleted()` (không gọi server: phiên và push đã bị thu hồi; như đăng xuất, xoá người dùng đã
  lưu, outbox và tệp của nó, lượt đọc/biểu cảm chờ gửi, cache đĩa) + `data/local-wipe.ts` (cache ảnh,
  thông báo, badge, lựa chọn push, ghim từng workspace; theme và ngôn ngữ giữ vì là của máy). **Quyền riêng tư và pháp
  lý** (`components/settings/legal-section.tsx`, link ở `lib/legal-links.ts`: `/privacy` và `/vi/privacy`, neo
  `#delete-account`, terms ẩn tới khi có URL, `mailto:` hỗ trợ — không có app mail thì chép địa chỉ), mở trang qua
  `components/settings/use-open-web-page.ts`. **Giấy phép**: route `licenses.tsx` đọc `assets/licenses.json`, sinh bởi
  `scripts/generate-licenses.mjs` (đi cây `dependencies` production qua node_modules của pnpm, bỏ `@uniwork/*` và gói
  ghim OS/CPU; `lib/licenses.test.ts` chạy `--check` — đổi dependency thì chạy lại script). **Đồng ý xử lý AI**:
  `lib/ai-consent.ts` (`AI_CONSENT_VERSION`, nhà cung cấp Anthropic; đổi nhà cung cấp hay dữ liệu gửi đi thì đổi
  version để hỏi lại mọi người, và sửa mục AI của `privacy-content.ts` cùng PR), câu trả lời lưu ở server
  (`PUT/DELETE /me/ai-consent`, `user.ai_consent_version`) qua `data/ai-consent.ts`; `catch-up-sheet.tsx` không gọi AI
  khi chưa đồng ý mà vẽ `components/chat/ai-consent-notice.tsx`; tính năng AI mới trên điện thoại dùng cùng
  `useAiConsent()`. Đồng ý chỉ do client giữ: không route AI nào của server đọc nó, và tin của người dùng vẫn tới
  Anthropic khi thành viên khác dùng AI trên web — chính sách và dòng "Xử lý AI" của listing nói đúng vậy
  (`privacy-content.test.ts`), đừng viết lại thành "chỉ khi người dùng đồng ý". **Báo cáo và chặn**: `data/safety-api.ts` (route chặn của web + `POST …/chat/reports`), key
  `chatKeys.blockStatus`, `data/queries/safety.ts`; `components/chat/report-sheet.tsx` (lý do đóng theo
  `lib/report.ts` = CHECK của server, mô tả, "chặn luôn"), `room-safety.tsx` (DM: chặn/bỏ chặn + báo cáo trong chi
  tiết, banner trong cuộc trò chuyện; nhóm: chạm thành viên → nhắn riêng/báo cáo/chặn), nhấn giữ tin của người khác ›
  Báo cáo. Audit `chat.report.created` ghi người báo cáo làm actor, nên chủ sở hữu và quản trị viên (kể cả khi chính họ
  bị báo cáo) thấy ai đã báo cáo: sheet và chính sách nói thế, không hứa ẩn danh (`report-sheet.test.tsx`,
  `privacy-content.test.ts`). **Android FGS**: `expo-audio` tắt phát/ghi nền tường minh, `plugins/with-removed-android-services.js` gỡ
  `MediaProjectionService` (`tools:node="remove"`); FGS duy nhất là dịch vụ cuộc gọi (`phoneCall|microphone|camera`,
  mục Cuộc gọi native); `android-manifest.test.ts` giữ danh sách quyền và dịch vụ cuối của
  bản release (`scripts/android-manifest.mjs`: introspect của `expo config` với biến thể production + manifest của
  từng thư viện được link). Thêm quyền/dịch vụ thì sửa test đó, bảng quyền của `store/listing.md` và checklist Play
  App content của runbook cùng PR.
- `app/+native-intent.ts` — expo-router tự route mọi URL từ OS; file này map
  `<scheme>://open?url=` và callback PKCE qua `lib/deep-link.ts ›
  systemPathToRoute` (thuần, có test). `openUrl` ở `app/_layout.tsx` chỉ
  `router.push` cho chạm thông báo; URL Linking không push lần hai.
- Tab Chat (M2a, UNI-1832; spec `2026-10-16-unichat-mobile-chat-design.md`,
  plan `2026-10-17-unichat-mobile-chat.md`). Ba lớp:
  `lib/*` thuần, copy từ web có ghi nguồn và test parity chạy đúng case của
  test web (`rooms-display`, `typing-display`, `timeline-display`,
  `send-pipeline`, `mentions`, `file-accept`, `media-body`, `search-fold`,
  `people-display`, `message-display`, `room-list`); `data/*` — endpoint
  (`chat-api.ts`, mỗi endpoint một case malformed), key riêng
  (`queries/chat-keys.ts`, không import `chatKeys` web), cache
  (`chat-timeline.ts` ← core `room-timeline`, `chat-cache.ts` ← core
  `realtime-cache`, viewer là tham số), outbox bền (`chat-send.ts` +
  `stores/chat-send-store.ts`, mục Offline-first), `realtime/chat-realtime.ts` (bảng §8
  spec cha, thuần) và `realtime/use-chat-realtime.ts` (hook mỏng, gắn ở
  `[org]/[ws]/_layout.tsx`, ≤ 25 scope qua `selectLazyChatScopeRoomIds`);
  màn hình ở `app/(app)/[org]/[ws]/{(tabs)/chat,room/[roomId]/{index,info,thread/[rootId]},new-chat,new-group,channels}.tsx`
  + `components/chat/*`. Route tab `/{org}/{ws}/chat` nhận `room`/`message`/`dm`
  của `lib/deep-link.ts › deepLinkHref` (hợp đồng với push và tab khác).
  Chuỗi: cả subtree `chat` của core + `chat.mobile.*` trong
  `scripts/sync-i18n.mjs`. Kind lạ → `messageView` = `unsupported` → hàng
  "Mở trên web" (`expo-web-browser`, không kích hoạt universal link).
- Gọi (M3, UNI-1834; spec `2026-10-16-unichat-mobile-calls-design.md`, plan
  `2026-10-17-unichat-mobile-calls.md`). `lib/voice-call.ts` (thuần, copy
  `voice-call-{overlay-types,kind-utils,invites,copy}` web) →
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
  `registerGlobals()` ở `app/_layout.tsx`). Mọi sheet/dialog là `components/ui/call-aware-modal.tsx`
  (lint cấm `Modal` của react-native ở nơi khác): cuộc gọi bắt đầu đổ chuông thì sheet đang mở đóng qua
  `onRequestClose` của nó (audit C2). Nhạc chuông: `lib/call-ringtone.ts`
  render `assets/sounds/ring-*.wav` (test so byte; sinh lại bằng
  `UPDATE_RINGTONES=1`); trên Android cuộc gọi đến reo trong app bằng nhạc chuông của máy trên luồng chuông
  (`CallRinger` native), WAV chỉ còn cho iOS và nhạc chờ của người gọi. Nút âm thanh
  (`components/calls/audio-output-button.tsx`, `lib/audio-outputs.ts`): Android liệt kê Bluetooth/tai nghe/loa
  trong/loa ngoài khi có tai nghe, iOS mở route picker; gọi thoại bắt đầu ở loa trong, video ở loa ngoài.
  Push "X đang gọi" mang `?call=`; tab Chat gọi `callEngine.ringFromPush` (màn đổ chuông, không tự trả lời);
  `&answer=1` (nút Nghe của thông báo native) gọi `joinFromPush`. Cần dev client (EAS), không chạy Expo Go.
- Cuộc gọi native trên Android (UNI-2053 S4; `docs/adr/drafts/0038-cuoc-goi-native-android-va-ke-hoach-callkit-ios.md`).
  `modules/unichat-calls` là Expo module cục bộ (Kotlin, tự autolink từ `modules/`; `index.ts` trả `null` ngoài
  Android) — chỉ là cầu nối, không chính sách: thông báo cuộc gọi đến `CallStyle.forIncomingCall` + full-screen intent
  trên kênh `calls` (nhạc chuông của máy, `USAGE_NOTIFICATION_RINGTONE`, lặp tới khi hết `timeoutMs`), foreground
  service `CallService` (`phoneCall`, thêm `microphone`/`camera` khi quyền đã cấp) với `CallStyle.forOngoingCall`,
  `CallRinger`, Từ chối/Gác máy → `CallActionReceiver` → headless task `UniChatCallAction` (không khởi động được thì
  `PendingActions` giữ tới lần mở sau), activity hiện trên màn khoá chỉ khi được mở bởi cuộc gọi
  (`CallLockScreen`, nhả khi cuộc gọi xong). Khai báo ở `plugins/with-unichat-calls.js` (quyền, service, receiver; gỡ
  background mode `fetch` mà plugin tự động của `expo-task-manager` thêm cho iOS). Chính sách ở TypeScript, test node
  với module giả (`data/calls/native-calls.ts` là no-op khi không có module): `lib/call-push.ts` đọc push cuộc gọi
  (`call_invite`/`call_end`/`call_missed`, mọi giá trị là chuỗi); `data/calls/call-push.ts` quyết định reo — công tắc
  tắt hay hết cửa sổ thì không, màn cuộc gọi đã có cuộc gọi đó (hay cuộc gọi khác) thì không, đang mở app trong một
  workspace thì hỏi danh sách chờ trước, còn lại hiện thông báo native (heads-up khi app đang mở, audit C3);
  `data/calls/call-actions.ts` (Từ chối khi app đã kill chỉ báo server cho cuộc gọi 1-1, bằng phiên đã lưu);
  `data/calls/call-native-sync.ts` theo engine (service từ connecting tới hết, hỏi `BLUETOOTH_CONNECT` lúc bắt đầu
  trên API 31+, gỡ thông báo đổ chuông khi màn trong app reo, nhả màn khoá). `data/calls/call-wiring.ts` nối tất cả:
  task nền của `expo-task-manager` cho push data-only và headless task đăng ký ở entry mới `index.ts`
  (`data/calls/background-tasks.ts`, trước `expo-router/entry`, để runtime không giao diện cũng có), còn
  `startNativeCalls()` (ở `app/_layout.tsx`) gắn sync, chạy hành động đang chờ và `setNotificationHandler`
  (`lib/notification-presentation.ts`: push của workspace đang mở thì im, khác thì banner). `data/boot.ts` là phần
  boot chung (Sentry, `configureRuntime`, header) mà task nền cũng gọi; `data/app-locale.ts` cho task nền nói đúng ngôn
  ngữ. Kênh Android (`lib/notification-channels.ts`, `data/notification-channels.ts`): `calls`, `call_ongoing` (native),
  `missed_calls`, `mentions`, `messages`, `general`, dịch theo ngôn ngữ app lúc mở và khi đổi ngôn ngữ, kênh cũ `chat`
  bị xoá; server chọn kênh theo kind (`push_expo.go › pushChannel`) — đổi âm thanh/độ ưu tiên của kênh thì phải đổi id.
  Badge app = mọi tin chưa đọc (`appBadgeCount`, `data/badge.ts`). Android 14+ bị thu hồi full-screen intent thì Cài
  đặt › Thông báo hiện `components/settings/full-screen-calls-row.tsx`. Server: push đổ chuông tới Android là data-only,
  iOS giữ push hiển thị; `chat.voice.ring_closed` (outbox, cùng transaction đóng hàng ring) → push data-only "kết thúc"
  tới máy Android; cuộc gọi 1-1 nhỡ là "Cuộc gọi nhỡ từ X" trên `missed_calls`.
  **Chỉ máy thật kiểm được** (checklist ở runbook › Cuộc gọi native trên Android; luồng tay
  `maestro/flows/call-answer-incoming.yaml`): Kotlin có biên dịch (máy dev không có Android SDK; CI
  `android-release` build nó), push data-only tới khi app bị kill (cần FCM thật), màn toàn màn hình trên máy khoá, nhạc
  chuông theo công tắc chuông/DND, Nghe từ màn khoá (Android có thể đòi mở khoá cho nút Nghe vì activity chỉ tự đặt
  `showWhenLocked` lúc chạy), micro còn sau khi khoá máy giữa cuộc gọi, Từ chối khi app đã kill (headless task, giới hạn
  khởi động service nền), định tuyến Bluetooth, badge theo launcher.
  Kind giàu (M3): endpoint trong `data/chat-api.ts`, lệnh và cache trong
  `data/chat-actions.ts` (bỏ phiếu, tin thoại, nhắc, follow-up, tạo việc);
  composer ghi âm (`components/chat/use-voice-recorder.ts`), mở
  `expression-sheet.tsx` và `reminder-sheet.tsx`; follow-up và "Tạo việc" ở
  sheet nhấn giữ; thẻ việc `task-card.tsx` dưới tin.
- `assets/icon.png`, `assets/adaptive-icon*.png` — icon UniChat 1024², sinh
  bởi `pnpm brand:build` từ `packages/ui/brand/svg/unichat-icon*.svg`; không
  sửa tay (`assets.lock.json` khoá hash nguồn). `icon.png` không có kênh alpha.

## Chạy

```bash
pnpm --filter @uniwork/chat-mobile dev        # Metro; UNICHAT_ENV=dev mặc định
pnpm --filter @uniwork/chat-mobile ios        # scripts/native-run.sh ios (prebuild rồi run)
pnpm --filter @uniwork/chat-mobile android
pnpm --filter @uniwork/chat-mobile test | typecheck | lint
pnpm --filter @uniwork/chat-mobile test:unit         # vitest, node: lib/ data/ app.config android-manifest
pnpm --filter @uniwork/chat-mobile test:components   # jest-expo + RNTL: components/**/*.test.tsx, data/**/*.test.tsx
```

Hai lớp test, không chung file (ADR 0037 — cả hai chặn ở mọi `GATE_LEVEL`):

- `vitest.config.ts` — `*.test.ts` trong `lib/`, `data/`, môi trường node, sàn
  100/100/100/100 cứng (không qua `scripts/coverage-gate.ts`); không loại file để
  qua sàn, nhánh không thể xảy ra thì viết lại.
- `jest.config.js` — `components/**/*.test.tsx` và hook React của lớp data
  (`data/**/*.test.tsx`, như `use-call-realtime.test.tsx`: công tắc gọi đổi giữa
  cuộc gọi không được cắt cuộc gọi), preset `jest-expo` với
  `@testing-library/react-native` 14 (mọi `render`/`fireEvent` đều `await`), truy
  vấn theo role và label như người dùng VoiceOver/TalkBack. Render qua
  `test/render.tsx` (i18n tiếng Việt, `QueryClient` mới với `gcTime: Infinity` — query
  đã unmount không để lại timer giữ Jest không thoát), `viText(key)` là chuỗi
  người nghe. `Switch` của Android không truy được theo role trong renderer: truy theo label. `test/jest-setup.ts` mock `expo-router`, `expo-audio`, safe area,
  Reanimated và làm đỏ test nào log `console.error` (update ngoài `act`…).
  `test/jest-resolver.js` thay resolver của worklets (bản gốc khớp mọi đường dẫn
  pnpm có chữ `react-native-worklets`, làm mất mock native của Expo). Sàn coverage
  đo trên file trong `collectCoverageFrom`; thêm file thì thêm test và nâng sàn.
  Không đặt test dưới `app/` (expo-router coi là route).

Máy thật không thấy `localhost` của máy dev: đặt `UNICHAT_API_URL=http://<LAN IP>:8080`
và `UNICHAT_APP_URL=http://<LAN IP>:3000` khi chạy, và chạy server + web với
`FRONTEND_ORIGIN` / `NEXT_PUBLIC_{API,WS,APP}_URL` trỏ cùng IP (một bản sao
`.env`, `make start ENV_FILE=…`); `apps/web/next.config.mjs` tự cho host của
`NEXT_PUBLIC_APP_URL` vào `allowedDevOrigins`, thiếu thì trang đăng nhập trắng.
Server dev phải bật `DESKTOP_AUTH_CLIENTS` (`.env.example`) với client
`uniwork-chat-mobile`. Ký bằng Apple ID cá nhân (Personal Team) thì team không
có push và associated domains: build tay với file entitlements rỗng.

Root `typecheck`/`test`/`lint` và CI chính lọc `!@uniwork/chat-mobile`;
app kiểm ở `.github/workflows/mobile-verify.yml`: job `mobile` (typecheck, lint,
hai lớp test, `scripts/mobile-*.test.mjs`), `doctor-bundle` (`expo-doctor` rồi
`expo export --platform android` giữ trong `bundle-budget.json` bởi
`scripts/mobile-bundle-budget.mjs`) và `android-release` (`expo prebuild` +
`./gradlew :app:assembleRelease` x86_64, chỉ khi `scripts/mobile-native-scope.mjs`
nói thay đổi chạm binary) rồi `android-smoke` (cài APK đó lên emulator, chạy
`maestro/flows/smoke-launch.yaml`: mở lạnh tới màn đăng nhập, không cần server). Thêm gói làm bundle nặng hơn trần thì nâng trần cùng
commit, ghi lý do; bundle nhỏ đi thì hạ trần. Không có script `build`.
Thêm gói native bằng `pnpm --filter @uniwork/chat-mobile exec expo install <pkg>`;
nếu Metro kẹt vì layout isolated của pnpm thì dừng và báo, không thêm
`.npmrc` hoist.

## Phát hành (M4, UNI-1836)

Runbook: `docs/runbooks/unichat-mobile-release.md`; plan:
`docs/superpowers/plans/2026-10-17-unichat-mobile-release.md`.

- `eas.json`: `development` (dev client), `preview` (cài trực tiếp, pilot trước
  store), `internal` (TestFlight + Play internal, staging), `production`. Mỗi
  profile ghim `UNICHAT_ENV`, kênh OTA cùng tên và môi trường EAS chứa URL
  server. Build number do EAS giữ (`appVersionSource: remote`), không commit.
- `version` trong `app.config.ts` là version store (0.3.0); `runtimeVersion` là
  `policy: fingerprint` (hash phần native; `fingerprint.config.js` bỏ `extra`
  ra khỏi hash để URL, DSN không tách runtime): đổi native (gói native, plugin,
  quyền, SDK) thì bump `version` và cắt bản store — quên bump thì OTA cũng
  không khớp máy nào; chỉ đổi JS thì phát OTA. Chưa có `EAS_PROJECT_ID` thì
  `updates.enabled: false` và push bỏ qua. Ký OTA: có
  `certs/eas-update-certificate.pem` thì `updates.codeSigningCertificate` tự
  bật (khoá riêng không bao giờ vào repo; runbook › Ký OTA).
  `eas.json` đặt `SENTRY_ALLOW_FAILURE=true` cho mọi profile: build thiếu token
  Sentry vẫn xanh. Bản store production phát theo giai đoạn (Play 5 % → 100 %,
  iOS phased release), mở rộng chỉ khi crash-free sessions ≥ 99.5 % (runbook ›
  Phát hành production theo giai đoạn); `submit.production.android` là `draft`
  tới khi app Play công khai, rồi `inProgress` + `rollout: 0.05`.
  `knip.json` bỏ qua `@babel/plugin-transform-react-jsx` (preset
  `react-native-css-interop/babel` gọi nó theo tên mà không khai; thiếu thì
  bước `createReleaseUpdatesResources` của build release đỏ), và hai gói
  `@expo-google-fonts/*` vì `app.config.ts` chỉ trỏ tới file `.ttf` của chúng,
  và `react-native-css-interop` vì đó là phụ thuộc của `nativewind` mà
  `metro.config.js` trỏ tới bản của nativewind (một bản duy nhất trong bundle),
  app không khai nó. Mỗi ngoại lệ mới cần lý do ở đây:
  `scripts/mobile-knip.test.mjs` đỏ khi một tên trong `ignoreDependencies` không
  có mặt trong file này.
- Tag `chat-mobile-v<version>` → `.github/workflows/chat-mobile-release.yml`:
  job `verify` gọi `mobile-verify.yml` trên SHA của tag với `force_native: true`
  (luôn build Android native và chạy smoke, kể cả tag đẩy lại), rồi EAS build +
  auto-submit **chỉ Android** (Play internal) tới khi có tài khoản Apple
  (UNI-1838), `eas-cli` ghim ở `EAS_CLI_VERSION`. Environment
  `chat-mobile-release`, chỉ `EXPO_TOKEN`; thiếu thì notice và xanh.
- OTA: `.github/workflows/chat-mobile-update.yml` (chạy tay trên `main`/`develop`:
  kênh, tỷ lệ rollout, message; Environment `chat-mobile-update`, giới hạn hai
  nhánh đó) → `verify` trên SHA → `eas update --platform android
  --rollout-percentage` với môi trường EAS **và `UNICHAT_ENV`** của profile build
  kênh đó (`eas update` không đọc `env` của profile; thiếu là cấu hình dev,
  fingerprint không khớp bản store nào — bước kiểm `extra.APP_ENV` đỏ), ký bằng
  `EAS_UPDATE_PRIVATE_KEY` khi app có chứng chỉ, rồi tải source map lên Sentry;
  thiếu `EXPO_TOKEN` thì **đỏ** (người bấm cần biết). Không phát OTA từ laptop
  trừ khi CI hỏng (runbook).
  `scripts/mobile-workflows.test.mjs` giữ các lời hứa của bốn workflow (verify
  trước EAS, chỉ Android, phiên bản ghim, nightly đỏ khi thiếu cấu hình, OTA
  staged và ký, đúng biến thể của kênh, môi trường riêng; mọi job build Release
  trên runner tắt upload Sentry); sửa workflow nào trong bốn cũng kích `mobile-verify.yml` nên
  test đó luôn chạy.
- `maestro/`: `subflows/sign-in.yaml` đăng nhập qua sheet trình duyệt thật (không
  có lối tắt phiên thử nghiệm trong bản nào); `flows/call-answer-incoming.yaml` (khung, chạy tay: cần tài khoản thứ
  hai gọi qua `scripts/ring-from-caller.js` và máy có FCM thật; chưa nằm trong workflow nào); ba luồng vàng
  `flows/{chat-read-send,push-open-room,call-join}.yaml` chạy hằng đêm bởi
  `.github/workflows/chat-mobile-verify.yml` với server staging (biến
  `MAESTRO_*`; thiếu thì run theo lịch **đỏ**, chạy tay bỏ chọn `maestro` để chỉ
  build), Maestro ghim `MAESTRO_VERSION`; cùng đêm đó job `android-production`
  build AAB release từ profile production, không cần secret. Trong app flow chọn theo `testID`
  (`room-row-<roomId>`, `conversation-<roomId>`, `composer-input`,
  `composer-send`, `room-call-*`, `call-*`) — đổi tên một id thì sửa flow cùng
  PR; trang web trong sheet đăng nhập thì theo chữ vi|en.
- `store/listing.md`: mô tả vi/en, độ tuổi 18+ (khớp chính sách), privacy labels (có dòng xử lý AI và báo cáo),
  xoá tài khoản, nội dung do người dùng tạo, lý do từng quyền và dịch vụ nền, tài khoản
  demo cho review. Thêm quyền native thì cập nhật bảng quyền ở đó; thêm dịch vụ
  nhận dữ liệu (như Sentry) thì cập nhật bảng Quyền riêng tư.
