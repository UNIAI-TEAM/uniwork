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
`@uniwork/core/types/*` chỉ với `import type`, trừ module `types/*` có trong allowlist (`types/ai`: schema zod thuần). Hai danh sách phải giống
nhau; test đó đi theo import bắc cầu của từng mục nên mục không thuần phải
tách file ở core, không nới lint. Fixture: `lib/lint-boundary.test.ts`.
Logic thuần dùng chung nằm ở core và được import (UNI-2053 S7: `chat/search-fold`, `chat/initials`,
`chat/identity-tint`, `chat/contact-labels`, `chat/typing-label`, `chat/voice-call-{types,kind,invites,duration}`,
`chat/room-timeline-pages` — trang timeline và mọi phép thuần trên nó, tách khỏi `room-timeline.ts` của core —
web và điện thoại cùng một bản; thêm mục thì thêm vào `core-allowlist.json` và `exports` của core). Endpoint dùng chung
là factory nhận transport (`api/endpoints/chat-users-api` — tra cứu, chặn, biệt danh; `chat-presence-api` — nhịp hiện
diện): web bind `request` của `http.ts` (`chat-users.ts`, `chat-presence.ts` chỉ còn dòng bind), điện thoại bind
transport của nó qua `toChatRequest` (`data/chat-api.ts`); schema mà cả hai đọc (`ChatUnreadSummarySchema`,
`ChatRoomSharedSummarySchema` trong `chat-schemas`, `ChatCatchUpResponseSchema` của `types/ai`) cũng là của core. Endpoint
chat còn lại trong `data/chat-api.ts` vẫn là bản copy: chuyển từng nhóm thành factory như hai nhóm trên là việc tiếp theo,
`web-copies.json` đếm phần còn lại. Logic khác của web:
**copy, ghi nguồn ở comment đầu file** ("Copied/Ported from …", "← packages/…"), test parity — không import.
`web-copies.json` ghi sha256 của từng file nguồn web mà mỗi bản copy nêu, lúc bản copy được rà lần cuối;
`scripts/mobile-web-copies.test.mjs` (chạy cả ở `ci.yml`, nên PR chỉ sửa web cũng đỏ) đỏ khi một nguồn đổi, khi có
bản copy mới chưa ghi, hay khi header và manifest lệch. Rà bản copy (port bản sửa hoặc quyết định không áp dụng) rồi
`node scripts/mobile-web-copies.mjs --write`.

Lớp mutation (UNI-2053 S7, audit T4): `app/` và `components/` đổi trạng thái server chỉ qua hook ở
`data/mutations/*` (`messages`, `rooms`, `safety`, `account` — cả đồng ý AI —, `push`; mỗi hook là một `useMutation` qua `useCommand` của
`command.ts`, key mutation là tên lệnh nên lỗi là bug tới Sentry một lần qua `MutationCache`, lỗi mong đợi —
offline, 4xx, `RefusedError` của `data/report.ts` — thì không; màn hình báo lỗi từ `mutateAsync`). Mọi lệnh chạy
ngay cả khi offline (`networkMode: "always"`): gửi, thử lại, biểu cảm, bình chọn vào hàng đợi bền ngay lúc đó, lệnh
khác lỗi ngay — mặc định `"online"` của TanStack giữ mutation ở trạng thái paused, tin không vào outbox và mất khi app
bị kill (`data/mutations/offline.test.tsx`). Lệnh và việc
chúng làm với cache ở `data/chat-actions.ts`, `safety-actions.ts`, `chat-send.ts`, `pending-ops.ts`. Lint cấm
`app/`/`components/` import giá trị từ `@/data/{api,chat-api,chat-actions,chat-send,pending-ops,safety-api,
safety-actions,account-api,ai-consent}`, `revokeDevice` và `setPushEnabled`/`registerPushToken`/`unregisterPushToken`
của `@/data/push` (`import type` vẫn được; trừ `app/_layout.tsx` và `app/(app)/_layout.tsx` — composition root trao
transport và endpoint cho dịch vụ lúc boot, như đăng ký push — và file test, vốn mock transport). Query mới thì thêm `*Options` ở
`data/queries/`, không gọi `chatApi` trong component.

Cùng file lint còn giữ năm luật chất lượng (fixture: `lib/lint-quality.test.ts`):
`@typescript-eslint/no-explicit-any` bật (base tắt cho web); bộ `all` của
`eslint-plugin-react-native-a11y` (role, state, value, action, live region,
`importantForAccessibility` hợp lệ; không touchable trong phần tử `accessible`)
trừ `has-accessibility-hint` — tắt có lý do ghi trong config: hint chỉ dùng khi
nhãn không nói rõ kết quả; `i18next/no-literal-string` (`jsx-text-only`)
như `packages/views`; `no-console` ngoài `data/logger.ts`; và không `Modal` của react-native
ngoài `components/ui/call-aware-modal.tsx` (sheet phải đóng khi có cuộc gọi đến; trừ sheet ghi `keepOpenForCall` của
chính cuộc gọi đó — màn giải thích micro khi nghe từ thông báo). Tắt một luật ở
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
  để fingerprint không đổi theo chúng. Ngôn ngữ: plugin `expo-localization` khai `supportedLocales: ["vi", "en"]`
  (iOS `CFBundleLocalizations`, Android 13+ `locales_config.xml`) và `ios.infoPlist.CFBundleDevelopmentRegion: "vi"`
  (chuỗi xin quyền gốc tiếng Việt, `locales.en` dịch). Bundle id
  `com.uniworkos.chat{.dev,.staging}`, scheme `uniworkchat-dev` (dev) / `uniworkchat`; universal link chỉ xác minh
  với id prod.
  Bảo mật của config (audit "Security & privacy"): staging/production chỉ nhận `UNICHAT_API_URL`/`UNICHAT_APP_URL`
  `https://` (ném lỗi ở mọi nơi đọc config; socket là `wss://` suy từ API), và `transport.start` chỉ mở trang đăng nhập
  cùng origin với `appUrl`; chứng chỉ ký OTA `certs/eas-update-certificate.pem` đã commit (2026-10-22, hạn 10 năm,
  `app.config.test.ts` giữ nó là chứng chỉ code-signing thật còn ≥ 2 năm), mọi biến thể nhúng nó; bản staging hay
  production trên máy build EAS thiếu nó thì ném lỗi (binary không ký OTA không bao giờ được build lại). Android: `allowBackup: false` + `plugins/with-android-backup-rules.js`
  (data extraction rules loại mọi vùng khỏi sao lưu đám mây và chuyển máy, Android 12+), `READ_/WRITE_EXTERNAL_STORAGE`
  bị chặn; `android-manifest.test.ts` giữ thuộc tính `application` (không cleartext, không network security config).
  Ghim khoá TLS sẵn sàng nhưng tắt: `UNICHAT_TLS_PINS` (≥ 2 SPKI SHA-256 base64: CA hiện tại + dự phòng) và
  `UNICHAT_TLS_PIN_EXPIRES` (YYYY-MM-DD, tương lai) trong môi trường EAS bật `plugins/with-tls-pins.js` cho host của
  API và web (Android `pin-set` có hạn, iOS `NSPinnedDomains` không hạn); thiếu một nửa, một pin, pin sai dạng hay ngày
  đã qua thì config ném lỗi; không bao giờ cho dev (`app.config.ts › tlsPinning`, runbook › Khắc phục 19). Baseline
  OWASP MASVS L1 và cái giữ từng kiểm soát: `docs/engineering/unichat-mobile-masvs.md` — đổi một kiểm soát thì sửa dòng
  của nó cùng PR.
- `lib/` — helper thuần + test vitest (env node), đo trọn ở sàn 100 %. Thuần là luật lint, không phải quy ước
  (khối `lib/**` của `eslint.config.mjs`, fixture `lib/lint-boundary.test.ts`): không import giá trị từ `react*`,
  `react-native*`, `expo*`, `@expo/*`, `@sentry/*`, `nativewind`, LiveKit, hay từ `data/`, `components/`, `app/`
  (`import type` thì được). Hook và provider ở `components/` (`components/ui/use-color-scheme.ts`,
  `components/ui/nav-theme.ts`, `components/app/i18n-provider.tsx`) hoặc `data/`
  (`data/realtime/use-ws-subscriptions.ts`); logic dùng chung giữa `lib/` và `data/` nằm ở `lib/` (ví dụ
  `lib/auth-callback-url.ts`). Lựa chọn của máy (theme, ngôn ngữ) chỉ đọc/ghi qua `data/device-preferences.ts`
  (Keychain/Keystore, `AFTER_FIRST_UNLOCK` để task nền trên máy khoá đọc được ngôn ngữ, ghi tuần tự).
  `theme.ts`/`global.css`/
  `tailwind.config.js` mirror nhau; giá trị là `packages/ui/styles/tokens.css`
  đổi sang HSL, đổi một nơi thì đổi cả ba. `radius-tokens.json` là thang
  `--radius-*` của tokens.css. Ngoại lệ có chủ ý (R4b, UNI-1916): các slot
  `chat-*` của chế độ tối và `call-surface` lấy giá trị của canvas, ghi trong
  comment — trừ `chat-bubble-own` tối, tối hơn canvas để dòng meta (giờ, dấu tick) đạt AA. Tương phản là test, không
  phải đo tay: `lib/theme-contrast.test.ts` giữ mọi cặp chữ/nền của cả hai chế độ ≥ 4.5:1 (`lib/contrast.ts`, WCAG 2.x;
  thêm bề mặt hay slot chữ thì thêm vào `PAIRS`), `lib/theme.test.ts` đỏ khi `theme.ts` và `global.css` lệch nhau. "Đã
  xem" khác "đã tới" bằng hình (huy hiệu hai tick đặc), không chỉ bằng màu. Mặt người / phòng / workspace là `--tint-*-solid` (`lib/identity-tint.ts › SOLID_TINT_BG`) theo
  `identityTint` của core (`@uniwork/core/chat/identity-tint`, bảy tint, cùng bản với web) với chữ cái của
  `@uniwork/core/chat/initials`. Font: Inter (thân) và Plus Jakarta Sans (`font-display`:
  tiêu đề, tên) nhúng bằng plugin `expo-font` trong `app.config.ts`.
- `data/` (Task 2–3) — `auth/*` (port từ `apps/chat-desktop/src/main/auth/*`),
  `realtime/ws-client.ts`, `api.ts`, `secure-storage.ts`, `session-epoch.ts`.
  Realtime ba tầng: `ws-client` (socket, auth frame, scope/replay, 4001 →
  refresh → reconnect), `realtime-provider` (mount theo auth + workspace,
  AppState/NetInfo), `use-<feature>-realtime` (hook theo feature, patch rồi
  invalidate hẹp). Mọi frame đi qua `realtime/frames.ts` trước khi tới handler: mỗi event điện thoại xử lý (và
  `subscribe_ack`/`subscribe_error`) có một decoder zod (object loose, chỉ key của `docs/events/CATALOGUE.md`,
  id cần thì bắt buộc và khác rỗng); payload sai thì frame bị bỏ kèm breadcrumb (tên event + key hỏng, không giá
  trị), type chưa liệt kê đi qua nguyên vẹn. `ws.on(type)` nhận payload đã có kiểu, `onAny` dùng `isKnownFrame`
  để thu hẹp; không ép kiểu payload ở đâu cả (cả `call-engine.ts`). `frames.test.ts` đọc CATALOGUE.md: decoder
  chỉ được đọc key mà catalogue liệt kê. Luật socket: frame `subscribe`/`unsubscribe` chỉ đi sau
  `auth_ack` (server đòi auth là frame đầu; replay lo phần còn lại); frame
  `{error}` trước auth là kết thúc của socket đó — `onSessionEnded(error)`, client
  không tự redial; provider giao cho `realtime/socket-recovery.ts` (thuần): 4001 và
  `invalid token` thì refresh, refresh lỗi tạm thời thì thử lại theo backoff
  2/5/15/60 s có jitter (`data/retry-timers.ts`), `too many connections` thì redial
  theo cùng backoff, lời từ chối khác (không phải thành viên) thì chờ tín hiệu sau;
  reset khi socket `online`. Vào background thì socket ở lại `BACKGROUND_GRACE_MS` (25 s,
  `realtime/background-grace.ts`, thuần) rồi mới pause — chuyển app nhanh (chép OTP) không reconnect, không refetch;
  `active` trong cửa sổ đó thì `ws.probe()` (heartbeat ngay, không pong trong 10 s thì thay socket), còn sau khi đã
  pause, quá cửa sổ (iOS treo JS nên timer không chạy) hoặc socket chưa auth thì `resume()`. Reader token cho provider là
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
  Lần mở đầu của một bản cài mới (`data/install-marker.ts`: chưa có dấu `install/marker` trong kho MMKV — tệp của
  container, mất khi gỡ app — và kho chưa có key nào; bản nâng cấp từ trước dấu đã có key nên không bị nhầm, kho chỉ
  trong bộ nhớ thì không kết luận gì) bỏ phiên và người dùng cuối mà bản cài trước để lại trong Keychain (iOS giữ
  Keychain khi xoá app) qua `session.discardStored()` — xoá, không adopt, thu hồi thiết bị ở nền — trước khi đọc chúng:
  xoá app là đăng xuất.
  Server đã kết thúc phiên trước khi ai được vào (refresh hết hạn, thiết bị bị thu hồi) mà máy còn người dùng đã lưu
  hay hàng đợi thì xoá như đăng xuất (outbox và tệp, lượt chờ, cache đĩa, workspace); màn chat chỉ hiện và thử lại
  tin chờ của chính người đang đăng nhập (`selectRoomSends` lọc theo người gửi). `login()` và `adoptSession()`
  dùng chung một lần nhận người dùng; `restoreAccountCache` gộp hai lần gọi cho cùng người và chỉ lần gọi cuối
  được ghi đĩa (một lần dừng — đăng xuất, cài lại — làm lần khôi phục đang chạy không hydrate, không ghi).
  Splash (`expo-splash-screen`, plugin trong `app.config.ts`) giữ tới khi `isLoading` tắt, tối đa 8 s
  (`app/_layout.tsx`). **Kho trên máy**: `data/storage/device-store.ts` (thuần, mặc định bộ nhớ — test node không
  cần mock) ← `native-device-store.ts` cài lúc boot: MMKV (`react-native-mmkv` + `react-native-nitro-modules`)
  mã hoá AES-256, khoá ngẫu nhiên trong Keychain/Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). Không mất dữ liệu
  im lặng: đọc khoá lỗi (máy chưa mở khoá lần đầu từ lúc bật) thì thử lại 3 lần (0.5 s, 1 s) trước khi bỏ đĩa; khoá mất
  mà tệp còn (khôi phục sang máy khác, Keystore bị xoá) thì xoá tệp có chủ ý và báo Sentry (`device_store_key_lost`),
  không mở khoá mới trên dữ liệu không đọc được; không mở được thì chạy bằng bộ nhớ (`durable: false`) và báo Sentry
  (tag `outcome: memory`), không chỉ log. Store zustand persist trên đó dùng `skipHydration` + hydrate trong `initialize()` và bỏ mọi
  lần ghi trước khi hydrate (không ghi đè hàng đợi trên đĩa bằng mảng rỗng). **Outbox**: `data/chat-send.ts` —
  mọi lần gửi (chữ, ảnh/tệp, tin thoại, nhắc hẹn) vào `stores/chat-send-store.ts` (persist; `sending` → `queued`
  khi đọc lại, `client_msg_id` làm replay an toàn), tệp chép vào `documents/outbox/<clientMsgId>/`
  (`data/outbox-files.ts`) trước khi xếp hàng, xoá khi server nhận, khi bỏ hoặc khi đăng xuất; lúc giao tìm lại bản
  chép theo `<clientMsgId>/<tên>` dưới thư mục documents hiện tại (iOS có thể dời container khi cập nhật), tệp đã mất
  thì tin thành `failed` ngay (không tải lên, hàng của phòng đi tiếp); mỗi (workspace, phòng, người gửi) có hai hàng
  FIFO nghiêm ngặt, một lần gửi một tin: chữ (chữ, trả lời chủ đề, nhắc hẹn) và media (ảnh, tệp, tin thoại). Chữ viết
  sau một media chờ nó (phòng đọc đúng thứ tự viết), trừ khi lần tải lên đó đã ở trên dây `MEDIA_OVERTAKE_MS` (4 s)
  hay đang chờ backoff: khi đó chữ đi trước, ảnh tới khi tới (như Telegram/WhatsApp) — tải lên chậm không giữ chữ của
  cả phòng. Guard flush theo workspace + người gửi; lỗi tạm thời giữ hàng đó và thử lại theo backoff của riêng hàng đó (chữ gửi được không huỷ lượt thử lại của ảnh, phòng lỗi không kéo dài lượt chờ của phòng khác); tin bị từ chối
  hẳn mà không ai thử lại sau `FAILED_SEND_TTL_MS` (14 ngày — workspace đã rời) bị bỏ cùng tệp. Outbox là của tài
  khoản, không của màn đang mở: `data/owed.ts › flushOwed` đẩy tin chờ và lượt chờ của **mọi** workspace của người
  đó, khi phiên sẵn sàng, NetInfo online, mỗi lần về foreground và lúc rời foreground (tin viết ngay trước khi chuyển
  app đi trong lúc JS còn chạy) (`data/use-account-sync.ts`, gắn ở
  `app/(app)/_layout.tsx` — cả màn chọn workspace) và khi socket reconnect (`use-chat-realtime.ts`). Không gì xả
  outbox khi app ở nền lâu: iOS cần module riêng cho `beginBackgroundTask`, còn task định kỳ của OS
  (`expo-background-task`) chạy ≥ 15 phút một lần và thêm manifest của WorkManager mà `scripts/android-manifest.mjs`
  không thấy (chỉ đọc gói được link, không đọc thư viện Maven) — hoãn tới khi kiểm được bằng bản build EAS. **Bản offline
  luôn mới** (`data/timeline-refresh.ts`, cùng hook): frame của phòng không ai xem chỉ đánh dấu stale (UNI-1078), nên lúc
  app rời foreground (còn mạng) các phòng trong 24 phòng gần nhất có timeline đứng sau — bị đánh dấu stale, cũ hơn
  preview của danh sách, hay chưa tải mà còn chưa đọc — được đọc trang mới nhất một lần (cắt về trang đầu trước: một
  request; tối đa `REFRESH_CONCURRENCY` = 4 request cùng lúc). `last_message_at` của danh sách tính cả trả lời chủ đề
  còn timeline thì không, nên timeline đã đọc theo một giá trị `last_message_at` không được đọc lại tới khi giá trị đó
  đổi (không thì phòng có tin mới nhất là trả lời chủ đề bị đọc lại mỗi lần rời app); push về một phòng, nhận lúc đang mở app hay khi chạm, đọc trang mới nhất của phòng đó và danh sách phòng
  của workspace (workspace đó có thể không có socket trên máy). Timeline đang hiện là của socket, không đụng. Push nền
  khi app đã đóng chưa nạp cache: cần push data/`content-available` (server) và task nền cho tin chat. **Đọc, biểu
  cảm, bình chọn offline**: `data/pending-ops.ts` + `stores/pending-ops-store.ts` — cache hiện lựa chọn ngay (`lib/optimistic-message.ts`, luật toggle của server),
  mỗi thứ một mục giữ mong muốn cuối; endpoint của server là toggle nên lần giao có thể đã tới (mất câu trả lời,
  khởi động lại) và mọi phiếu bầu đều GET tin trước rồi chỉ chạm phần còn khác; từ chối hẳn thì bỏ, refetch phòng
  và reject cho màn hình báo (lượt đọc thì báo Sentry, không toast). **Nháp** (`lib/drafts.ts`, `stores/draft-store.ts`, `components/chat/use-drafts.ts`): chữ đang viết và tin đang trích
  của từng (người, workspace, phòng, chủ đề) sống qua rời phòng và kill app — composer ghi sau 400 ms ngừng gõ, ngay khi
  composer đóng hay app rời foreground, gửi thì xoá; sửa tin mượn ô nhập rồi trả lại nháp; danh sách phòng hiện
  "Nháp: …" (trừ khi có người đang gõ). Persist như outbox (đọc qua `DraftSchema`, quá 30 ngày thì bỏ, có trong
  `persisted-schema.lock.json`), hydrate lúc boot, xoá khi đăng xuất. **Sửa và xoá tin cũng offline** (cùng hàng đợi,
  key `edit/<ws>/<msg>`, `delete/<ws>/<msg>`): sửa hiện ngay (`withEdit`: body mới + `edited_at`), lần sửa cuối thắng,
  giao bằng PATCH cả body (idempotent, không đọc trước); xoá gỡ tin khỏi timeline ngay và bỏ mọi mong muốn còn chờ cho
  tin đó (sửa, biểu cảm, phiếu); 404 khi giao là đã xong (tin đã mất), từ chối hẳn thì refetch phòng (tin quay lại) và
  reject cho màn hình báo. **Cache đĩa**:
  `data/query-persister.ts` — allowlist `["workspaces"]`, rooms, unread-summary, nicknames, members, room-members và
  trang mới nhất của 24 phòng hoạt động gần nhất; chỉ ghi khi một query được giữ có data mới (câu trả lời fetch, patch
  — không phải fetch bắt đầu, observer hay bộ nhớ bỏ query), sau 1 s yên; mỗi query được giữ một key MMKV
  (`query-cache/timeline/<queryHash>` cho timeline, `query-cache/query/<queryHash>` cho phần còn lại), chỉ ghi lại khi
  data đổi — data cùng object và cùng `dataUpdatedAt` với lần ghi trước thì không cả `JSON.stringify` (structural
  sharing giữ object; trang mới nhất cắt từ timeline được nhớ theo object data), nên một frame tuần tự hoá phòng đó và
  vỏ nhỏ ở `query-cache`, không phải danh sách 1.000 thành viên (test đếm `JSON.stringify`). Mở lạnh đọc hai bước: vỏ
  liệt kê `first` (workspaces, rooms, unread-summary, nicknames — màn đầu) và `later` (thành viên, thành viên phòng,
  timeline); splash chỉ chờ `first`, `later` đọc và hydrate `RESTORE_LATER_MS` (100 ms) sau (hydrate không ghi đè data
  mới hơn bộ nhớ đã fetch), và lần lưu trước đó không xoá key nào chưa đọc lại; vỏ cũ (query nằm trong vỏ, `timelines`)
  vẫn đọc được; buster
  `<CACHE_SCHEMA_VERSION>:<userId>` (bản store mới và OTA đều giữ cache, đọc qua schema). Đĩa không phải gương của bộ
  nhớ: `gcTime` 10 phút bỏ query không ai xem, nên query được giữ mà bộ nhớ đã bỏ được mang từ bản trước
  (`withEvicted`) tới khi quá 7 ngày hay phòng rời nhóm gần nhất / danh sách. Frame chỉ patch bộ nhớ nên không tới được
  bản mang theo: sửa, biểu cảm, xoá tin của phòng mà bộ nhớ không còn timeline thì bỏ bản đó khỏi đĩa
  (`dropCarriedTimeline`, gọi từ `chat-cache.ts`) — thiếu còn hơn sai. Query khôi phục từ đĩa sống trong bộ nhớ
  bằng tuổi của bản đĩa (`hydrateOptions` `gcTime` = 7 ngày; TanStack giữ `gcTime` lớn nhất nên observer 10 phút
  không rút ngắn): không gì đọc lại đĩa khi bộ nhớ thiếu, nên mở offline một giờ sau mở lạnh vẫn có trang. Khôi phục trước màn đầu
  (`restoreAccountCache` trong auth store), xoá khi đăng xuất (`dropAccountCache`, cả các key của từng query). Bản trên
  đĩa là dữ liệu không tin được như câu trả lời mạng (OTA giữ buster mà đổi code đọc): `data/persisted-cache.ts`
  kiểm vỏ rồi đọc lại data của từng query qua đúng schema đã dựng nó từ mạng (`data/chat-api-schemas.ts`,
  `data/schemas.ts`, schema của core như `ChatUnreadSummarySchema`), query không đọc được bị bỏ riêng (refetch như lần mở đầu), không chỗ nào cast từ đĩa. Outbox và
  lượt chờ cũng vậy: mỗi mục qua schema zod của `lib/persisted-records.ts` (cả trường lồng: tệp, tin thoại, nhắc
  hẹn), mục hỏng bị bỏ riêng; `migrate` của hai store chạy các bước theo version (`migratePersisted`) và giữ state của
  bản mới hơn (OTA bị rollback) thay vì để zustand xoá cả hàng đợi. `data/persisted-schema.lock.json` ghim hash của
  module schema với version của nó (`persisted-schema-lock.test.ts`): sửa schema thì quyết định có bump version không
  (bản ghi giữ shape mà đổi nghĩa → bump `CACHE_SCHEMA_VERSION`, hay version store + bước migrate), rồi
  `UPDATE_PERSISTED_LOCK=1`. Thêm query vào cache đĩa thì sửa `shouldPersistQuery`, reader trong `persisted-cache.ts`
  và test. **Realtime**: `chat-realtime.ts` không bỏ frame khi GET lỗi (tin mới →
  catch-up phòng, sửa/nhắc → refetch phòng, trả lời chủ đề → refetch chủ đề, danh sách theo sau); mỗi phòng một GET
  một lúc, frame đến trong lúc đó gộp theo tin và từ 2 tin mới trên timeline đang hiện thì đọc bằng một catch-up.
  Reconnect (về foreground sau cửa sổ ân hạn, mạng quay lại) giữ mọi trang đã cuộn của phòng đang hiện và refetch từng trang (nối lại từ trang
  mới nhất) để thấy sửa/xoá/biểu cảm lúc offline; chỉ mở lại phòng mới cắt về trang mới nhất.
- Quan sát và phát hành (UNI-2053). `data/report.ts` là cửa duy nhất tới báo
  crash (no-op khi chưa có sink; `force` cho boundary). `classifyError` chia ba: mong đợi (mất mạng/timeout = 0,
  401, 403, 404, 408, 410, 429, `AbortError`, `RefusedError`, mã lỗi mà nơi gọi tự nói thành lời — `handledCodes`,
  ví dụ `DELETE_ACCOUNT_HANDLED_CODES`, `VOICE_CALL_HANDLED_CODES`, hay `useCommand(…, { handledCodes })` qua
  `meta` của mutation) thì không báo; 4xx khác (400, 409, 413, 415, 422…) là lệch hợp đồng với server, báo mức
  `warning`; 5xx và lỗi khác là bug, mức `error`. `ApiError` mang `endpoint` (`lib/redact.ts › endpointShape`: method +
  route, id thành `{id}`), báo cáo có tag `endpoint`/`http_status`/`error_code` và fingerprint theo endpoint + status +
  mã, nên mỗi route lệch là một issue riêng. Không nuốt lỗi im lặng: lint (`no-restricted-syntax`, fixture
  `lib/lint-quality.test.ts`) cấm `.catch(() => undefined | null | {} | [])`; dùng `.catch(bestEffort(scope, what,
  "report" | "breadcrumb"))` — luôn để breadcrumb, `"report"` còn qua `reportError` (lời gọi server, lỗi là sự cố),
  `"breadcrumb"` cho lời gọi native chỉ mang tính trang trí (rung, splash, share) — hoặc `settled()` của
  `lib/settled.ts` khi chỉ chờ (chuỗi ghi tuần tự, fetch đang chạy mà query tự báo lỗi). `call-engine.ts` báo mọi
  cuộc gọi không bắt đầu/không nối được (breadcrumb + lỗi qua `reportError`); `data/sentry.ts` cài Sentry làm sink khi có DSN (release
  `<appId>@<version>+<build>`, tag `channel`/`update_id`/`runtime_version`,
  không ảnh màn hình, không replay, `beforeSend` qua `lib/redact.ts`: email,
  token, query URL, push token, callback PKCE). Log qua `data/logger.ts`
  (`createLogger(scope)`: breadcrumb luôn, console chỉ ở dev; `argsLogger` cho
  `ws-client`, chỉ giữ số và boolean) — `no-console` đỏ trong `app/`,
  `components/`, `data/`, `lib/` trừ chính logger (fixture
  `lib/lint-quality.test.ts`). Lỗi query/mutation báo qua `data/query-errors.ts`.
  `ErrorBoundary` export ở `app/_layout.tsx` (root) và `[org]/[ws]/_layout.tsx`
  (workspace), cả hai vẽ `components/ui/error-fallback.tsx`. Hiệu năng khi có DSN (S5): mở app (lạnh/ấm), mỗi
  lần tải màn (TTID tự động; TTFD bằng `ScreenFullyDrawn` của `data/sentry.ts` ở tab Chat khi có danh sách phòng
  và ở phòng khi có trang mới nhất), khung chậm/đơ và JS stall, mẫu 10 % phiên production; transaction đi qua
  `scrubTransaction` (`lib/redact.ts`: mô tả và data của span mang URL request). Danh tính build:
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
  `PushConsumer.SetMobileCalls`; cuộc gọi đang diễn ra không bị cắt và giữ dịch vụ cuộc gọi;
  `unichat_mobile_media_upload` / `unichat_mobile_voice_messages`: ô soạn tin bỏ ảnh/tệp khỏi menu đính kèm / bỏ nút ghi
  âm; `unichat_mobile_ai_catch_up`: `CatchUpBanner` không hiện; `unichat_mobile_outbox_flush`: `flushOwed` không tự gửi
  lại gì, gửi từ ô soạn tin và Thử lại vẫn chạy). Công tắc mới: thêm vào `MOBILE_FLAG_DEFAULTS` và vào catalogue
  `server/internal/featureflags/keys.go` với `Mobile: true`, cùng `Default` và `ReviewAt` (`data/server-contract.test.ts`
  đỏ khi lệch); bật dần theo tỷ lệ người dùng là việc của server (`FF_<KEY>=N%`, runbook). Câu trả lời cuối của server được giữ trên máy
  (`remote-config/v1` trong device store, `persistRemoteConfig`, ≤ 30 ngày, ngoài mọi tài khoản — nên đăng xuất
  (`clearAccountCache(qc, openDeviceStore)`) bỏ công tắc cả trong bộ nhớ lẫn bản giữ, chỉ giữ mức tối thiểu và link store) và gieo lại vào query
  lúc mở (`restoreRemoteConfig`, đề ngày lúc nhận nên query hỏi lại ngay): kill switch và mức tối thiểu giữ qua một lần
  mở lạnh không mạng. Chưa từng có câu trả lời và server không tới được thì không chặn gì và mọi công tắc ở mặc định.
  Thống kê sản phẩm (audit "no-product-analytics"): `data/analytics.ts` (khởi ở `data/app-startup.ts › startAppServices`, mà `app/_layout.tsx` gọi lúc boot) xếp hàng sự kiện
  ẩn danh — `app_open` cold/warm, `first_screen` (ms từ lúc JS chạy), `message_send` sent/failed (`observeChatSends` của
  `data/chat-send.ts`, ms từ lúc viết), `push_open` chat/call/other, `call_connect` connected (ms từ `connecting` tới lúc phòng media nối, `callEngine.onMediaConnected`; `active` chỉ là đã có token) / failed (`connect_failed`, `start_failed`, hay phòng media buông trước khi nối; tự cúp máy thì không tính)
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
  (`privacy-content.test.ts`), đừng viết lại thành "chỉ khi người dùng đồng ý". **Báo cáo và chặn**: `data/safety-api.ts` (route chặn qua factory `chat-users-api` của core + `POST …/chat/reports`), key
  `chatKeys.blockStatus`, `data/queries/safety.ts`, lệnh chặn `data/safety-actions.ts` qua `data/mutations/safety.ts`; `components/chat/report-sheet.tsx` (lý do đóng theo
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
- Quyền riêng tư trên máy (audit "Security & privacy", no-app-switcher-privacy-or-lock). Cài đặt › Quyền riêng tư và
  bảo mật (`components/settings/privacy-section.tsx`): **Hiện nội dung tin trong thông báo**
  (`push-previews-row.tsx`; lựa chọn của tài khoản ở server: `PUT /me/push-previews`, `user.push_previews` trên `/me`,
  `data/push-previews.ts`; tổ chức ẩn cho mọi người qua `GET/PUT /orgs/{org}/push-preview-policy` — owner/admin đổi ở web ›
  Cài đặt › Tổ chức — thì công tắc tắt, khoá và nói lý do; ẩn thì push tin chat chỉ còn "Tin nhắn mới" kèm người gửi ở
  tiêu đề, `PushConsumer` của server thay chữ), **Khoá UniChat** (`expo-local-authentication`: Face ID, vân tay
  hay mã khoá của máy — bật hay tắt đều phải chứng minh chủ máy trước, máy không có khoá màn hình thì nói vậy) với "Khoá lại
  sau khi rời app" (ngay, 1, 5, 15 phút) và **Chặn chụp màn hình** (`expo-screen-capture`: Android `FLAG_SECURE`, cũng
  xoá ảnh trong màn đa nhiệm; iOS chặn chụp/quay). Luật thuần ở `lib/app-lock.ts` (`shouldLock`: mở lạnh luôn khoá,
  về foreground sau ≥ thời gian đã chọn ở nền thì khoá; chỉ `background` tính là rời app — Face ID, kéo thanh thông
  báo làm app `inactive`); lựa chọn là của máy, trong Keychain cạnh theme/ngôn ngữ (`device-preferences` key
  `privacy`), đọc một lần lúc boot (`data/privacy-settings.ts`, tối đa 3 s; quá hạn thì tạm coi cả hai tắt, nhưng câu
  trả lời đến muộn vẫn được áp — `restored` — và guard coi nó là lần mở lạnh, Keychain chậm không tắt khoá cả phiên), nối với nền tảng ở
  `components/app/privacy.ts` (iOS bật app switcher protection khi một trong hai đang bật).
  `components/app/privacy-guard.tsx` (gắn ở `app/_layout.tsx`, trên mọi thứ): khi bật một trong hai, app không ở
  foreground thì phủ một lớp trơn (ảnh đa nhiệm không có cuộc trò chuyện); khoá thì hiện màn khoá và hỏi Face ID ngay
  (một lần mỗi lần khoá hiện ở foreground; huỷ thì nút Mở khoá hỏi lại); chỉ khi có người đăng nhập; cuộc gọi đang đổ
  chuông hay đang diễn ra không bao giờ bị giữ sau màn khoá (nghe từ màn khoá của máy phải nối được), hết cuộc gọi thì
  khoá lại; chưa biết lựa chọn thì phủ (app có khoá không hiện inbox một khung hình). Trong lúc đó chỉ cuộc gọi hiện:
  `components/app/app-lock-state.ts` (`engaged`, guard ghi) làm màn cuộc gọi không thu nhỏ được (đang thu nhỏ thì phóng
  to lại) và đóng mọi `CallAwareModal` đang mở khi khoá bật (Modal là cửa sổ native riêng, nằm trên màn khoá; sheet của
  chính cuộc gọi đang diễn ra — `keepOpenForCall` — thì giữ). Màn Face ID/mã khoá của chính app (`authenticateOwner`,
  đếm ở `ownerPrompts`) không tính là rời app: trên Android màn mã khoá là activity khác, app thành `background`, nếu
  tính thì "Ngay" khoá lại ngay sau khi mở. Trình chọn ảnh/tệp và hộp thoại quyền của hệ thống vẫn tính là rời app. Android: `USE_BIOMETRIC`/
  `USE_FINGERPRINT` là quyền thường; `READ_MEDIA_IMAGES`/`DETECT_SCREEN_CAPTURE` mà `expo-screen-capture` khai cho
  listener chụp màn hình (app không dùng) bị chặn. Chính sách tổ chức bắt buộc (MAM) chưa có: cần route cấu hình theo
  tổ chức, không dùng feature flag (flag chỉ ẩn năng lực).
- `app/+native-intent.ts` — expo-router tự route mọi URL từ OS; file này map
  `<scheme>://open?url=` và callback PKCE qua `lib/deep-link.ts ›
  systemPathToRoute` (thuần, có test). `openUrl` ở `app/_layout.tsx` chỉ
  `router.push` cho chạm thông báo; URL Linking không push lần hai. Phản hồi thông báo đi qua
  `lib/notification-response.ts` (thuần): listener của app đang chạy và, cho lần chạm mở app đã bị kill,
  `Notifications.getLastNotificationResponse()` đọc một lần lúc boot (không trông vào listener đăng ký kịp); mỗi
  (thông báo, hành động) chạy một lần, đã xử lý thì `clearLastNotificationResponse` (reload JS không chạy lại); trên
  Android chỉ lấy lần chạm từ đó — Trả lời/Đánh dấu đã đọc đã chạy ở task nền.
- Tab Chat (M2a, UNI-1832; spec `2026-10-16-unichat-mobile-chat-design.md`,
  plan `2026-10-17-unichat-mobile-chat.md`). Ba lớp:
  `lib/*` thuần, copy từ web có ghi nguồn và test parity chạy đúng case của
  test web (`rooms-display`, `typing-display`, `timeline-display`,
  `send-pipeline`, `mentions`, `file-accept`, `media-body`,
  `people-display`, `message-display`, `room-list`; hash nguồn ở `web-copies.json`); `data/*` — endpoint
  (`chat-api.ts`, mỗi endpoint một case malformed), key riêng
  (`queries/chat-keys.ts`, không import `chatKeys` web; mỗi resource một module và một key factory — `chatKeys`
  (mọi key dưới `["chat", wsId]` trừ unread-summary của cả tài khoản, kể cả call log, preview nhấn giữ, ghi âm
  cuộc gọi; `chat-keys.test.ts` đỏ khi một key lồng dưới prefix của key khác ngoài các họ đã khai),
  `org-members.ts` (khoá tầng tổ chức), `workspaceKeys`, `deviceKeys`; thành viên workspace và biệt danh chỉ
  đọc qua `chatApi`. Call log refetch khi có `chat.voice.hangup` (server ghi log trước khi phát frame), khi hangup
  của chính máy xong (`onHangupSettled` của `call-store.ts`) và khi reconnect; reconnect cũng refetch thành viên), cache
  (`chat-timeline.ts` ← core `room-timeline` — chỉ phần thao tác cache trên `QueryClient`; trang và phép thuần import từ
  `@uniwork/core/chat/room-timeline-pages` —, `chat-cache.ts` ← core
  `realtime-cache`, viewer là tham số), outbox bền (`chat-send.ts` +
  `stores/chat-send-store.ts`, mục Offline-first), `realtime/chat-realtime.ts` (bảng §8
  spec cha, thuần) và `realtime/use-chat-realtime.ts` (hook mỏng, gắn ở
  `[org]/[ws]/_layout.tsx`, ≤ 25 scope qua `selectLazyChatScopeRoomIds`);
  màn hình ở `app/(app)/[org]/[ws]/{(tabs)/chat,room/[roomId]/{index,info,thread/[rootId]},new-chat,new-group,channels}.tsx`
  + `components/chat/*`. Route tab `/{org}/{ws}/chat` nhận `room`/`message`/`dm`
  của `lib/deep-link.ts › deepLinkHref` (hợp đồng với push và tab khác): `lib/deep-link-target.ts` (thuần) quyết
  định, `components/chat/use-deep-link-target.ts` (jest) làm. `dm=` từ ngoài app hỏi trước khi mở; "Nhắn tin" trong
  app (Danh bạ, thông tin phòng) đi qua `inAppDmHref`, bảo lãnh trong bộ nhớ (một DM, một lần, 10 s — không bao giờ là
  param, vì URL nào cũng giả được param) nên mở thẳng. File route chỉ ghép màn — query, state của màn và nối
  các phần — và **không được đo** (jest không đo `app/`), nên logic có nhánh nằm ở `lib/` (thuần, vitest —
  `quickCatchUp`, `pickerPeople`, `channelDirectory`, `canCallRoom`, `keptCounts`, `missedCallCount`,
  `selectQueuedRoomIds`) hoặc ở component/hook của `components/` có test jest; không đặt test dưới `app/`. Component
  con không định nghĩa trong file route, và đây là luật có test: `lib/route-files.test.ts` đỏ khi một file route
  định nghĩa hàm, component hay hook nào ngoài export default và các tên liệt kê kèm lý do ở đó (`ErrorBoundary`,
  composition root của `app/_layout.tsx`, thân màn sau cổng workspace như `RoomInfo`; danh sách chỉ co lại). Phần
  con nằm ở `components/`: `components/calls/call-log-{row,filters}.tsx`, `components/contacts/*` (dải đang hoạt
  động, hàng người, chữ cái nhảy mục), `components/settings/option-group.tsx`, `components/chat/room-info/*` (đầu
  trang, nút nhanh, kết quả tìm, ghim, thành viên, rời phòng, "Đã chia sẻ"); realtime cấp workspace là
  `data/realtime/use-workspace-realtime.ts`. JSX có điều kiện còn lại trong file route (chọn trạng thái rỗng/lỗi,
  handler một dòng) không có test component.
  Chuỗi: cả subtree `chat` của core + `chat.mobile.*` trong
  `scripts/sync-i18n.mjs`. `lib/message-display.ts › messageContent` đọc record một lần thành union phân biệt
  (`{ view: "image", file }`, `{ view: "poll", poll }`…): card nhận payload đã thu hẹp, không `x!` (lint
  `@typescript-eslint/no-non-null-assertion` đỏ trong `app/`/`components/`); kind lạ hay kind biết mà thiếu payload →
  `unsupported` → hàng "Mở trên web" (`expo-web-browser`, không kích hoạt universal link).
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
  ngoài/tai nghe, khi màn cuộc gọi đóng và trong `CallService.stop`; nhả bằng `RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY`; iOS
  chưa có — gọi trên iPhone còn tắt), Từ chối/Gác máy → `CallActionReceiver` → headless task `UniChatCallAction` (không khởi động được thì
  `PendingActions` giữ tới lần mở sau), activity hiện trên màn khoá chỉ khi được mở bởi cuộc gọi
  (`CallLockScreen`, nhả khi cuộc gọi xong, và khi lần đổ chuông mở app không thành màn cuộc gọi — cuộc gọi đã kết thúc
  lúc app mở lạnh, công tắc gọi tắt — trước khi tab Chat mở phòng, `use-deep-link-target.ts`; thêm một watchdog native:
  `HOLD_MS` (75 s: cửa sổ chuông 60 s + mở lạnh) sau lần mở cuối mà không có dịch vụ cuộc gọi nào chạy thì tự nhả, dù JS
  có làm gì, cuộc gọi đang diễn ra thì giữ và kiểm lại mỗi `HOLD_MS`; listener đăng ký qua `UniChatCallsPackage.kt` — autolinking chỉ nhận
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
  **Chỉ máy thật kiểm được** (checklist ở runbook › Cuộc gọi native trên Android; luồng tay
  `maestro/flows/call-answer-incoming.yaml`): push data-only tới khi app bị kill (cần FCM thật), màn toàn màn hình trên máy khoá, nhạc
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
- Hiệu năng (UNI-2053 S5; audit H1–H3, P2 Perf). **Danh sách tin**: `lib/message-row-model.ts` tính mỗi hàng một lần
  cho mỗi lần timeline đổi (quote, receipt, ô avatar, album, gốc chủ đề, việc) và trả lại đúng object cũ khi hàng vẽ
  như cũ; `components/chat/message-cell.tsx` (memo) nhận model, `ctx`, scheme và một object handler ổn định
  (`use-stable-handlers.ts`); `renderItem` của `MessageList` là `useCallback`. Ai đang gõ không nằm trong
  `useRoomContext`: bong bóng gõ và dòng trạng thái của header tự đọc (`room-typing.tsx`). **Danh sách phòng**:
  `buildRoomList` dựng hàng không có gõ và hiện diện; `room-list-view.tsx` phủ dòng gõ (`roomListTypingLines`), mỗi
  hàng DM đọc người kia bằng `useIsOnline` (selector theo từng người, `components/people/use-is-online.ts`; cũng
  dùng ở composer, danh bạ, `LivePersonAvatar` và các hàng người memo của `components/people/member-rows.tsx` — tin nhắn
  mới, tạo/thêm nhóm, chi tiết phòng; không màn nào đọc cả tập `onlineUserIds` trừ dải "đang hoạt động" của danh bạ),
  hàng so bằng `sameRoomListRow`, chạm vào hành động trên hàng mới
  nhất cùng key. Đừng truyền closure mới hay object dựng trong render vào một cell: test đếm render đỏ.
  **Danh sách tái chế** (`@shopify/flash-list` 2, chỉ JS — không đổi fingerprint): danh sách phòng, danh bạ
  (`components/contacts/contact-list.tsx`: section dàn phẳng thành ô chữ cái + ô người bằng `contactListItems`, chữ
  cái dính, chữ cái bên phải nhảy bằng `scrollToIndex` — `scrollToLocation` của SectionList không có `getItemLayout`
  ném invariant khi chữ cái nằm ngoài phần đã đo, crash cả app ở workspace lớn) và dải "đang hoạt động" (ngang).
  Ô tái chế không giữ state riêng (hiện diện đọc theo người của hàng), `getItemType` theo loại ô, avatar có
  `recyclingKey` (ô dùng lại không loé mặt người trước). FlashList 2 mặc định giữ hàng đầu đang thấy tại chỗ khi data
  đổi (`maintainVisibleContentPosition`, khác FlatList): danh sách phòng và danh bạ tắt nó (`{ disabled: true }`) —
  phòng có tin mới lên đầu phải hiện ở đầu, kết quả tìm bắt đầu từ kết quả đầu; `test/list-anchoring.ts` đọc cây host
  và test đỏ khi ScrollView nhận prop đó hay có `ScrollAnchor`. Ô tìm danh bạ lọc sau phím gõ (`useDeferredValue`).
  Jest: `test/jest-setup.ts` mock đo layout của FlashList (cửa sổ 400 × 900, ô 100) — `jestSetup.js` của gói trỏ
  tới export không có ở bản 2.0; danh sách dài trong test chỉ mount khoảng một màn như trên máy.
  Timeline tin nhắn vẫn là FlatList đảo ngược (lý do ở `message-list.tsx`: neo cuộn của danh sách đảo ngược chỉ kiểm
  được trên máy), chỉnh cửa sổ: 15 ô đầu, 10 ô một lượt, `windowSize` 11; nhảy tới tin xa hơn 30 hàng không animate,
  đích chưa đo thì cuộn theo chiều cao trung bình rồi thử lại chỉ số tối đa 3 lần, không animate. **Timeline dài**
  (`lib/timeline-perf.test.ts`, 2.000 tin): hàng có cùng tin, cùng tin được trích và cùng bộ đọc (`senderName`,
  `quoteText`, người xem, chủ đề) giữ tên và trích dẫn của lần trước, không gọi lại bộ đọc, và được trả lại nguyên object
  khi không gì nó vẽ đổi (`buildMessageRowModels` nhớ bộ đọc của mỗi map đã dựng); test đếm lời gọi bộ đọc khi có tin
  mới (≤ 2) và một ngân sách thời gian thô chặn việc dựng lại thành bậc hai. Vì vậy bộ đọc phải giữ identity:
  `useRoomContext` lấy người kia của DM qua `select` của query phòng (structural sharing — tin mới đổi record phòng,
  không đổi người kia), `receiptOf` phụ thuộc hai chuỗi con trỏ, không phải object. `messageDayKey` nhớ ngày theo
  timestamp (giới hạn 10.000, xoá khi múi giờ hiện tại đổi, xem tối đa mỗi phút): trước đó nó là phần lớn chi phí dựng.
  Bố cục timeline là một lượt (`lib/timeline-layout.ts › layoutTimeline`): mỗi tin đọc một lần, ra hàng theo thứ tự
  của danh sách đảo ngược (mới nhất trước — `MessageList` không đảo mảng mỗi lần đổi), chuỗi bong bóng nối, album và
  chỉ mục theo id mà trích dẫn đọc; hàng của một tin giữ theo object tin và tin ngay trước nó (cùng múi giờ —
  `dayKeysEpoch`), nên tin không đổi trả lại đúng object hàng cũ, và "là ảnh album" tính một lần mỗi tin.
  `buildTimelineRows`, `continuedRunKeys`, `albumsOf` là định nghĩa gốc mà `timeline-layout.test.ts` so bằng; test
  perf đếm số lần đọc mảng tin (một lượt mỗi lần đổi). Danh sách ảnh của trình xem chỉ dựng khi trình xem mở.
  Không đặt `maxPages` cho timeline: TanStack bỏ `pages[0]` khi thêm trang cuối, mà cache realtime
  (`room-timeline-pages`) coi trang đầu là trang mới nhất. Thay vào đó là cửa sổ trượt (`data/timeline-window.ts`,
  `components/chat/use-timeline-window.ts`): mỗi lần người đọc về tin mới nhất (không đang xem trang quanh một tin
  cũ), phòng bỏ các trang cũ nhất quá `KEPT_TIMELINE_PAGES` (8 trang, 400 tin), không bao giờ khi đang fetch; cuộn lên
  thì tải lại theo cursor. Mở lại phòng vẫn cắt về trang mới nhất.
  `lib/user-id.ts` (`userKey`/`sameUser`) thay `trim().toUpperCase()` ngoài các file copy từ web. Link việc của tin
  hỏi theo cửa sổ (`lib/link-windows.ts`, ranh giới theo hash id): tin mới chỉ refetch cửa sổ mới nhất; cửa sổ vừa
  đổi key giữ thẻ việc cũ của các tin trong nó tới khi có câu trả lời (`taskIdsByMessage`; `keepPreviousData` không áp
  dụng được vì `useQueries` tạo observer mới cho key mới). **Ảnh**: mọi
  ảnh là `expo-image` với `cachePolicy` memory-disk (`lib/media-source.ts`): ảnh chat khoá cache theo id tin + biến thể
  (`thumb`/`full`), avatar và icon workspace theo URL bỏ query (đường dẫn object đã là một tệp bất biến); server ký URL
  media chat theo đầu giờ (`chatMediaSigningWindow`, `files.ResolveInput.SigningWindow`) nên refetch trong giờ trả đúng
  URL và record cũ, và trả `width`/`height` của ảnh khi đọc được header lúc tải lên — bong bóng ảnh giữ đúng tỷ lệ
  (`bubbleImageSize`) trước khi ảnh tới. URL ký hết hạn (server ký 1 giờ, cache đĩa giữ timeline 7 ngày): ảnh vẫn vẽ
  bằng URL cũ (`useChatImageSrc` — cache đĩa theo id tin nên ảnh đã xem hiện ngay, cả offline; chưa xem thì ô xám), tin
  thoại/tệp chờ URL mới (`useChatMediaSrc`); mọi lần xin lại của một phòng trong 50 ms gộp một lượt
  (`data/media-refresh.ts`): ảnh thuộc timeline đang hiện về bằng một lần refetch timeline đó (nhập vào lần refetch
  đang chạy, như lần mở phòng) khi số ảnh ≥ số trang đã tải, còn lại (chủ đề, trang nhảy tới) xin từng tin — không còn
  N request, N lần ghi timeline và N lần lưu cache cho N ảnh. Không prefetch: `Image.prefetch` khoá cache theo URL, không
  theo `cacheKey` của ta. Theme: chọn
  một lần lúc boot (`data/theme-preference.ts`, `loadThemePreference` trong `app/_layout.tsx`), `useColorScheme` chỉ đọc
  store. **Đo**: `components/chat/conversation-renders.test.tsx` và `chat-tab-renders.test.tsx` (jest, job `mobile`)
  khoá số render của hàng khi gõ, hiện diện, tin mới, biểu cảm; ngân sách bundle như cũ. `inlineRequires` của Metro
  **không** bật: Metro 0.84 coi import đã bị inline là `require` (nhận diện import ESM theo vị trí khai báo), nên gói
  hai định dạng vào bundle hai lần (đo được: `@sentry/core` và `clsx` ESM + CJS, +176 module, +397 KB) — nạp lười thì
  `require` tường minh như `call-overlay.tsx`. Route không cần nạp lười bằng tay: expo-router chỉ đánh giá module
  của một màn khi màn đó dựng (`getComponent`), layout thì lúc khởi động; sheet ẩn trong phòng không fetch gì
  (`enabled` theo `visible`). `metro.config.js` đặt `includeWebReplay: false` của Sentry: gói session replay cho web
  (`@sentry-internal/replay*`) thành module rỗng (−182 KB bytecode; app không bao giờ ghi replay). Bản release
  Android qua R8 và thu gọn tài nguyên (`expo-build-properties` trong `app.config.ts`, luật giữ `ANDROID_KEEP_RULES`
  cho Nitro/MMKV và module cuộc gọi — các thư viện khác mang luật riêng): đường code nào R8 làm hỏng chỉ máy thấy —
  `android-smoke` mở lạnh bản đã minify, nightly đăng nhập, nhắn và vào cuộc gọi trên nó.
- UX, trợ năng và ngôn ngữ (UNI-2053 S6; audit U1–U3, P2 UX/i18n). **Trình đọc màn hình**: live region chỉ chạy trên
  Android, nên chỗ nào có `accessibilityLiveRegion` thì gọi `useAnnounce` (`components/ui/a11y.ts`, chỉ iOS, một lần
  mỗi lần đổi) — banner kết nối, lỗi đăng nhập, bong bóng gõ, thông báo push ở Cài đặt, dòng trạng thái cuộc gọi
  (đồng hồ cuộc gọi là `timer`, không live region). Tin mới của người khác ở đáy phòng đang mở được đọc
  (`lib/arrivals.ts` = luật live region của web; `use-arrival-announcements.ts`: một tin "Bình: …", nhiều tin "N tin
  nhắn mới", tối đa một câu mỗi 4 s, chỉ khi trình đọc màn hình bật). Bong bóng là một phần tử: nhãn gồm trích dẫn, nội
  dung, trạng thái (đang gửi/chờ mạng/lỗi/đã sửa) và đã gửi/đã tới/đã xem; tin chưa gửi có hint; hành động
  `longpress` (menu) và `open_quote` (trích dẫn ẩn khỏi cây trợ năng khi bong bóng là một phần tử); card có nút riêng
  (ảnh, tệp, bình chọn…) giữ nút và đọc chân tin là một dòng; ô album có `longpress` và ô đầu nói "Album N ảnh".
  **Cảm giác**: `react-native-keyboard-controller` (`KeyboardProvider` ở root; `KeyboardAvoidingView` của nó cho phòng
  và tạo nhóm; inset home indicator của composer co theo `progress` của bàn phím); rung `data/haptics.ts` (iOS
  impact/selection/notification, Android hằng số phản hồi của hệ thống) cho gửi, nhấn giữ (tin, phòng, liên kết), biểu
  cảm, nghe/gác máy, lúc vuốt trả lời vượt ngưỡng (`swipe-to-reply.tsx`, mỗi lần vượt một lần), lúc bắt đầu ghi âm và
  khi một tin của mình chuyển sang lỗi lúc phòng đang mở (`use-send-failure-feedback.ts`, kèm câu đọc cho trình đọc màn
  hình) — instance ở `components/ui/haptics.ts`. **Chuyển động**: `useReduceMotion` (`components/ui/a11y.ts`) là cách
  đọc duy nhất công tắc giảm chuyển động (bắt đầu ở "đứng yên"); `CallAwareModal` đổi `slide` thành `fade` cho mọi sheet
  khi bật. Toast đọc một lần: TalkBack qua live region, VoiceOver qua `announceForAccessibility` (chỉ iOS); vạch "N tin chưa đọc" (`lib/unread-divider.ts`, port
  `firstUnreadIndex`/`unreadSinceOf` của web): con trỏ đã đọc và số chưa đọc chụp từ danh sách phòng lúc mở (trước khi
  mở phòng đánh dấu đã đọc), vạch nằm trên tin đầu tiên của người khác sau con trỏ, giữ tới khi rời phòng; quá màn đầu
  thì phòng mở tại vạch (không animate; link tới một tin thắng); tin chưa đọc vượt các trang đã tải thì phòng tải thêm
  trang cũ (`components/chat/use-unread-backfill.ts`, tối đa `UNREAD_BACKFILL_PAGES` = 4 trang, tức tới ~250 tin chưa
  đọc, không khi đang fetch) rồi vẽ vạch và mở tại đó; vượt nữa thì không vẽ vạch thay vì vẽ sai chỗ (mở ở tin mới nhất); nút về tin mới nhất `components/chat/jump-to-latest.tsx` khi cuộn lên hoặc đang
  xem trang cũ (`onJumpToLatest`), đếm tin người khác gửi từ lúc rời đáy (`countNewSince`, như web), tự gửi thì cuộn
  xuống (`latestSignal` của `MessageList`); ảnh xem lớn `zoomable-image.tsx` (chụm, chạm hai lần, kéo khi phóng to, vuốt
  dọc ở 1x để đóng; toán ở `lib/zoom.ts`; Modal có `GestureHandlerRootView` riêng). **Quy ước Android** (`lib/platform-ui.ts`, `components/ui/ripple.ts`): nút back
  là mũi tên trên Android, chevron trên iOS; vùng chạm tối thiểu 44 pt (iOS) / 48 dp (Android) — `Button` (mọi size,
  size nhỏ qua `hitSlop`) và `HeaderIconButton` tự tính `hitSlopFor`; điều khiển tự dựng trải `useTapTarget(cỡ vẽ, tròn?)`
  (`components/ui/tap-target.ts`: `hitSlop` bù tới vùng chạm của nền tảng + `android_ripple`) — composer (đính kèm,
  sticker, gửi, mic, huỷ trả lời, dòng gợi ý @), thanh cảm xúc và menu nhấn giữ (`message-actions.tsx`: nút cảm xúc
  44 pt, dòng menu 48 dp trên Android), cảm xúc/chủ đề/trích dẫn trên tin, tin thoại (phát, tốc độ), pill workspace,
  chip lọc, tab Tin nhắn/Kênh, Thử lại; điều khiển nằm cạnh nhau (chip, cảm xúc, tab) chỉ nới trên/dưới để chạm không
  rơi sang hàng xóm. `Button`, nút header, dòng của sheet, dòng phòng, dòng người, dòng Cài đặt có `android_ripple`
  theo mực của theme. Test component đọc ripple ở `nativeBackgroundAndroid` của view host. **Cỡ chữ**: vai trò ở
  `lib/type-scale.json` (`text-meta` … `text-display-xl`, `text-emoji*`; tailwind và `cn()` đọc cùng file — thiếu
  `extendTailwindMerge` thì `text-footnote` bị coi là màu); `lib/type-scale.test.ts` đỏ khi `app/`/`components/` dùng
  `text-sm`… hay `text-[13px]`. Phần tử chứa chữ dùng `min-h-*` + padding dọc, không `h-*` cố định (cả `Button`, ô tìm kiếm, ô nhập); cùng test đỏ
  khi một chuỗi class có `h-*` cố định mà không có chiều rộng cố định (ô icon/avatar), không phải đường kẻ ≤ 2 và không
  nằm trong `FIXED_HEIGHT_OK` (scrim, skeleton, sóng âm, minh hoạ — ghi lý do); chỉ huy hiệu chặn
  cỡ chữ (`BADGE_MAX_FONT_SCALE` 1.4). **Quyền**: `data/permissions.ts` (màn giải thích `components/ui/permission-primer.tsx`
  qua `stores/permission-primer-store.ts`, instance native `components/ui/permission-gate.ts`): đã cấp thì đi tiếp, hệ
  thống còn hỏi được thì giải thích rồi mới hỏi, không hỏi được nữa thì mở `Linking.openSettings`; `once` (thông báo lúc
  mở app) chỉ hỏi một lần mỗi máy (nhớ ngay khi màn giải thích đã hiện, dù "Để sau" hay từ chối ở hộp thoại hệ thống:
  Android 13+ lần từ chối đầu vẫn báo `canAskAgain`) và không tự đưa ra Cài đặt; Cài đặt › Thông báo hỏi lại. Micro trước tin thoại
  (`use-voice-recorder.ts`) và trước gọi/nghe (`ensureCallPermissions(withCamera, callId)`; cuộc gọi vẫn đi tiếp khi bị
  từ chối; nút Nghe chỉ nghe đúng cuộc gọi đã bấm — `acceptCall(callId)` — và màn giải thích của cuộc gọi đang nghe không
  bị đóng khi chính cuộc gọi đó đổ chuông), camera
  trước gọi video và trước khi bật camera giữa cuộc gọi (`components/calls/toggle-camera.ts`; tắt camera không hỏi); ảnh không cần (trình chọn của hệ thống). **Ngôn ngữ**: chuỗi tiếng Anh có `{{count}}` là cặp
  `_one`/`_other`, tiếng Việt một khoá (như core; `lib/i18n.test.ts` đỏ khi thiếu); i18next 26 không có
  `Intl.PluralRules` (Hermes) vẫn chọn one/other theo luật tiếng Anh. Ngôn ngữ app lên server (`users.locale`, push và
  email theo nó): `data/locale-sync.ts` gửi `PATCH /me` lần đăng nhập đầu của mỗi tài khoản trên máy và mỗi lần đổi
  ngôn ngữ trong app (khoá `locale_synced:<userId>` trong kho trên máy); đổi trên web sau đó thì giữ tới khi máy đổi lại.
  Chuỗi của lát này ở `scripts/i18n-ux.mjs`.
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
  qua sàn, nhánh không thể xảy ra thì viết lại. `data/server-contract.test.ts` giữ tên trường: mỗi trường mà schema
  response app parse khai (lồng nhau cũng vậy, cả item của list parse từng phần tử qua `items`) phải là một
  `json:"…"` của SDO Go trả nó (`server/internal/handler/dto/sdo/`, bảng `CONTRACTS`: /me, /workspaces, thành viên,
  /config với `mobile_flags`, chính sách ẩn push và mọi endpoint chat); mỗi dòng còn kê handler Go trả nó, và mã của
  handler đó phải trả đúng struct ấy — kể cả từng khóa của map literal (`{"message": toChatMessageDTO(msg)}`), nên đổi
  tên khóa chỉ ở handler cũng đỏ. Mọi flag trong `MOBILE_FLAG_DEFAULTS` phải là flag `Mobile: true` của
  `server/internal/featureflags/keys.go` (công tắc gọi). Thêm một endpoint app đọc thì thêm dòng vào bảng đó; file
  handler mới thì thêm vào `HANDLER_FILES` và `MOBILE_PATHS`. PR server đổi SDO, các file handler đó hay danh mục
  flag cũng chạy test này (`MOBILE_PATHS`).
- `jest.config.js` — `components/**/*.test.tsx` và hook React của lớp data
  (`data/**/*.test.tsx`, như `use-call-realtime.test.tsx`: công tắc gọi đổi giữa
  cuộc gọi không được cắt cuộc gọi), preset `jest-expo` với
  `@testing-library/react-native` 14 (mọi `render`/`fireEvent` đều `await`), truy
  vấn theo role và label như người dùng VoiceOver/TalkBack. Render qua
  `test/render.tsx` (i18n tiếng Việt, `QueryClient` mới với `gcTime: Infinity` — query
  đã unmount không để lại timer giữ Jest không thoát), `viText(key)` là chuỗi
  người nghe. `Switch` của Android không truy được theo role trong renderer: truy theo label. `test/jest-setup.ts` mock `expo-router`, `expo-audio`, safe area,
  Reanimated, `react-native-keyboard-controller` (mock của chính nó), `expo-haptics` — **không** mock cổng quyền: component
  hỏi quyền đi qua cổng thật trên mock của module expo (`components/ui/permission-gate.test.tsx` giữ cổng đó: primer
  trước, prompt hệ thống sau Tiếp tục, Cài đặt khi hệ thống không hỏi nữa); test nào khẳng định lượt hỏi thì tự mock
  `@/components/ui/permission-gate` trong file của nó — và làm đỏ test nào log
  `console.error` (update ngoài `act`…). Cử chỉ test bằng `react-native-gesture-handler/jest-utils` (`withTestId` +
  `fireGestureHandler`; `react-native-gesture-handler/jestSetup` nạp sẵn ở `test/jest-setup.ts` vì mọi sheet có
  `GestureHandlerRootView`); `onUpdate` chỉ chạy từ sự kiện ACTIVE thứ hai. Test đếm render chờ hàng xuất hiện (`waitFor`), không chờ một khoảng cố định.
  `test/jest-resolver.js` thay resolver của worklets (bản gốc khớp mọi đường dẫn
  pnpm có chữ `react-native-worklets`, làm mất mock native của Expo). Coverage đo **cả cây** `components/**`, các
  hook React của `data/` mà vitest bỏ ra và file route `app/**` (mỗi file đúng một lớp đo). File route chỉ ghép, không
  định nghĩa component con (`lib/route-files.test.ts`), nên được giữ như **một nhóm** ở sàn `routes` của
  `coverage-floor.json` (khoá thư mục của jest, cộng dồn), không theo từng file. `app/_layout.tsx` không có test route
  nào render: dịch vụ mới khởi lúc boot vào `data/app-startup.ts` (vitest, 100 %), layout chỉ gọi một dòng — nối dây
  ngay trong file route kéo sàn `routes` xuống đỏ. `test/routes/*.test.tsx` render chúng
  qua expo-router thật (`test/route-render.tsx › renderRoutes`: `jest.unmock("expo-router")` trong file test, mock
  NetInfo, route con chưa test thì thay bằng stand-in) — cổng vào/đăng nhập/chọn workspace ở `test/routes/entry.test.tsx`;
  mọi màn trong workspace (layout với socket, thanh tab, Chat/Cuộc gọi/Danh bạ/Cài đặt, phòng, chi tiết, chủ đề, tin
  mới, nhóm mới, kênh, giấy phép, công tắc gọi của server) ở `test/routes/workspace.test.tsx`, trên một server giả sau
  `api.request` (theo đường dẫn; mọi thứ khác trả `{}`) và socket giả `test/fake-ws-client.ts` (test đóng vai server:
  trạng thái, frame, reconnect, phiên bị kết thúc). Server giả chỉ trả lời sau khi router đã mount: `renderRouter` mount
  dưới fake timer, và một lô cập nhật TanStack hẹn trên fake timer mà `renderRoutes` không chạy sẽ giữ mọi cập nhật sau.
  Sàn theo từng file ở `coverage-floor.json` (`scripts/mobile-coverage-floor.mjs --write` sau một lần
  `test:components`: lấy số cao hơn giữa sàn cũ và hôm nay, không bao giờ hạ; file đã xoá thì rời); file chưa ghi
  (component mới) gộp vào sàn `global` 90/80/90/90 — component mới không test thì đỏ
  (`scripts/mobile-coverage-floor.test.mjs`). Thêm test thì chạy lại `--write` để nâng sàn. `--write` chỉ ghi file mới
  khi nó đã đạt sàn `global` (ghi theo số hiện có thì component chưa test rời nhóm global mãi) và đỏ khi một file đã
  ghi mà còn tồn tại không có trong lần chạy (chạy cả `test:components`, không chạy một phần). File dưới sàn `global`
  chỉ là nợ đã ghi lúc có sàn theo file (`BELOW_GLOBAL` trong test đó): danh sách chỉ co lại, không file nào được thêm.
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
app kiểm ở `.github/workflows/mobile-verify.yml`, chạy ở mọi PR (job `scope` quyết `mobile`/`native` theo
`scripts/mobile-native-scope.mjs`, kể cả khi PR server đổi `docs/events/CATALOGUE.md` hay `dto/sdo/**`), kết thúc ở job
`gate` — check bắt buộc duy nhất của mobile (`scripts/branch-protection.json`), đỏ khi một job thay đổi cần mà không
xanh (`scripts/mobile-verify-gate.mjs`; thêm job thì thêm vào `JOBS` ở đó): job `mobile` (typecheck, lint,
hai lớp test, `pnpm knip --workspace apps/chat-mobile`, `expo install --check` offline — version gói native theo SDK
đã cài —, `scripts/mobile-*.test.mjs`, trong đó `mobile-lockfiles.test.mjs` cấm lockfile ngoài `pnpm-lock.yaml`), `doctor-bundle` (`expo-doctor` rồi
`expo export --platform android --platform ios` giữ trong `bundle-budget.json` bởi
`scripts/mobile-bundle-budget.mjs`, trần cho từng nền tảng — iOS có ngân sách trước khi có bản build) và `android-release` (`expo prebuild` +
`./gradlew :app:assembleRelease` x86_64 — Kotlin của `modules/*/android` thì job `mobile` chạy ktlint ở mọi PR mobile
(ghim `KTLINT_VERSION` + checksum, kiểu ở `.editorconfig` › `[*.{kt,kts}]`; trong KDoc đừng viết `/*`, Kotlin coi là
mở comment lồng), chỉ khi `scripts/mobile-native-scope.mjs`
nói thay đổi chạm binary) rồi `android-smoke` (cài APK đó lên emulator, chạy
`maestro/flows/smoke-launch.yaml` qua `scripts/maestro-retry.sh` (chạy lại một lần, lần hai qua thì cảnh báo "flaky"
chứ không im; mọi lượt Maestro trong CI đi qua nó): mở lạnh tới màn đăng nhập, không cần server — `ios-release` làm cùng việc đó trên
simulator iOS với bản Release ký ad-hoc, cùng điều kiện native ở PR (nơi gọi chỉ Android thì bỏ qua), Xcode ghim ở
`XCODE_VERSION` qua `scripts/select-xcode.sh`; cuối job, ở font_scale 2.0 và dark mode,
`flows/a11y-large-text-dark.yaml` (màn đăng nhập cuộn được, vẫn tới nút) rồi `scripts/mobile-a11y-audit.mjs` (dump
uiautomator: mọi điều khiển của app có tên và ≥ 48 dp; hitSlop không thấy được trong dump nên nightly audit phòng ở
44 dp, chỉ cảnh báo); rồi `scripts/mobile-perf.mjs` đo kích
thước APK và 5 lần mở lạnh — tới khung đầu và tới mốc `first-screen` — theo `perf-budget.json`; nightly đo thêm mở lạnh
tới `inbox` và khung/bộ nhớ khi cuộn phòng dài, runbook › Đo hiệu năng trên thiết bị). Mốc là `perfMark(name)` của
`data/logger.ts` (một dòng `UniChatPerf mark=<tên>` trong log máy, mỗi tên một lần mỗi tiến trình), chỉ bản build với
`UNICHAT_PERF_MARKS=1` (`extra.perfMarks`) mới ghi; mốc mới thì thêm vào `scripts/mobile-perf.mjs`. Thêm gói làm bundle nặng hơn trần thì nâng trần cùng
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
  `updates.enabled: false` và push bỏ qua. Ký OTA: `certs/eas-update-certificate.pem` đã commit nên
  `updates.codeSigningCertificate` luôn bật (khoá riêng không bao giờ vào repo; runbook › Ký OTA); thiếu nó thì build
  staging/production trên EAS đỏ, và `chat-mobile-update.yml` không phát OTA không ký trên kênh nào.
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
  (luôn build Android native và chạy smoke, kể cả tag đẩy lại; không có `ios: true` nên
  `ios-release` không chặn một bản chỉ Android — output `ios` của job scope,
  `scripts/mobile-verify-gate.mjs`), rồi EAS build +
  auto-submit **chỉ Android** (Play internal) tới khi có tài khoản Apple
  (UNI-1838), `eas-cli` ghim ở `EAS_CLI_VERSION`. Environment
  `chat-mobile-release`, chỉ `EXPO_TOKEN`; thiếu thì **đỏ** (một tag không build gì không được trông như một bản phát hành).
- Bản production (app `com.uniworkos.chat`) build một lần và chính binary đó đi qua các track:
  `.github/workflows/chat-mobile-production.yml` (chạy tay trên tag `chat-mobile-v*` của `main`, Environment
  `chat-mobile-production` có reviewer): `verify` → tag khớp `version` và có "Có gì mới" ở
  `store/release-notes.md` (vi-VN + en-US ≤ 500 ký tự, `scripts/mobile-release-notes.test.mjs` đỏ khi version hiện tại
  thiếu) → báo crash bắt buộc (DSN trong môi trường EAS `production` + thiết lập Sentry để kiểm; đỏ trừ khi tick
  `allow_missing_crash_reporting`) → `eas build --profile production --wait` → Sentry phải có release
  `com.uniworkos.chat@<version>+<version code>` (bằng chứng source map/symbol đã tải) → `eas submit --profile
  production-internal --id <build>` (internal track của app production). `.github/workflows/chat-mobile-promote.yml`
  chuyển **version code** đó sang alpha/beta/production, mở rộng hay dừng rollout qua
  `scripts/mobile-play-release.mjs` (Play Developer API, chỉ built-in của Node; chỉ nhận bản đã live trên track nguồn;
  `PLAY_SERVICE_ACCOUNT_JSON`). Không workflow nào khác build profile `production` cho store.
- Sức khoẻ bản phát hành: `.github/workflows/chat-mobile-release-health.yml` mỗi giờ (bật bằng biến repo
  `UNICHAT_RELEASE_HEALTH=on`) chạy `scripts/mobile-release-health.mjs`: crash-free sessions 24 giờ của từng release
  production trong Sentry (mỗi bản OTA là một release riêng, `lib/build-info.ts › sentryRelease`); < 99.5 % trên ≥ 200
  phiên (hay < 98 % trên ≥ 50) thì revert rollout của OTA đó hoặc halt rollout Play của bản store, run đỏ.
- OTA: `.github/workflows/chat-mobile-update.yml` (chạy tay trên `main`/`develop`:
  kênh, tỷ lệ rollout, message; Environment `chat-mobile-update`, giới hạn hai
  nhánh đó) → `verify` trên SHA → `eas update --platform android
  --rollout-percentage` với môi trường EAS **và `UNICHAT_ENV`** của profile build
  kênh đó (`eas update` không đọc `env` của profile; thiếu là cấu hình dev,
  fingerprint không khớp bản store nào — bước kiểm `extra.APP_ENV` đỏ), ký bằng
  `EAS_UPDATE_PRIVATE_KEY` khi app có chứng chỉ, rồi tải source map lên Sentry;
  thiếu `EXPO_TOKEN` thì **đỏ** (người bấm cần biết); kênh `production` thiếu DSN hay thiết lập tải source map cũng
  **đỏ** trừ khi tick `allow_missing_crash_reporting`. Input `critical` đặt `UNICHAT_CRITICAL_UPDATE=1` →
  `extra.criticalUpdate` trong manifest (ngoài fingerprint): `data/updates-controller.ts` (khởi ở `data/app-startup.ts`)
  hỏi lại EAS khi quay lại foreground (một phút sau lúc mở, rồi ≥ 30 phút một lần), tải, và chỉ bản critical hay lệnh
  roll-back-to-embedded mới được áp dụng — khi app đã ở nền liên tục `APPLY_AFTER_AWAY_MS` (1 phút; Android cho JS chạy
  ở nền), hay lúc quay lại sau ≥ `APPLY_ON_RETURN_MS` (10 phút; iOS đóng băng JS nên hẹn giờ không chạy), không có
  cuộc gọi và không có màn hệ thống mà app đang chờ (`data/system-ui.ts › whileSystemUiOpen`: trang đăng nhập, chọn
  ảnh/tệp, hộp xin quyền — Android đưa app vào nền khi chúng mở, nên chuyến ra ngắn không bao giờ reload); còn lại chờ
  lần mở lạnh sau. Màn hệ thống mới mà app chờ kết quả thì bọc bằng `whileSystemUiOpen`. Không phát OTA từ laptop
  trừ khi CI hỏng (runbook).
  `scripts/mobile-workflows.test.mjs` giữ các lời hứa của các workflow mobile (verify
  trước EAS, chỉ Android, phiên bản ghim, nightly đỏ khi thiếu cấu hình, OTA
  staged và ký, đúng biến thể của kênh, môi trường riêng; mọi job build Release
  trên runner tắt upload Sentry); sửa workflow nào trong bốn cũng kích `mobile-verify.yml` nên
  test đó luôn chạy.
- `maestro/`: `subflows/sign-in.yaml` đăng nhập qua sheet trình duyệt thật (không
  có lối tắt phiên thử nghiệm trong bản nào); `flows/call-answer-incoming.yaml` (khung, chạy tay: cần tài khoản thứ
  hai gọi qua `scripts/ring-from-caller.js` và máy có FCM thật; chưa nằm trong workflow nào), cũng chạy tay
  `flows/background-resume.yaml` (người kia viết qua `scripts/post-as-peer.js` khi app ở nền, trong và quá cửa sổ ân
  hạn của socket); ba luồng vàng `flows/{chat-read-send,push-open-room,call-join}.yaml` và, chỉ Android (Maestro bật
  chế độ máy bay ở đó), `flows/offline-send-relaunch.yaml` (tin viết offline sống qua kill, mở lạnh offline từ cache,
  tới đúng thứ tự mỗi tin một lần) chạy hằng đêm bởi
  `.github/workflows/chat-mobile-verify.yml` với server staging (biến
  `MAESTRO_*`; thiếu thì run theo lịch **đỏ**, chạy tay bỏ chọn `maestro` để chỉ
  build), Maestro ghim `MAESTRO_VERSION`; cùng đêm đó job `android-production`
  build AAB release từ profile production, không cần secret. Trong app flow chọn theo `testID`
  (`room-row-<roomId>`, `conversation-<roomId>`, `composer-input`,
  `composer-send`, `room-call-*`, `call-*`, `connection-banner-{offline,connecting}`) — đổi tên một id thì sửa flow cùng
  PR; trang web trong sheet đăng nhập thì theo chữ vi|en. `lib/maestro-flows.test.ts` đỏ khi một chữ trong ngoặc kép của
  flow không khớp (regex, cả chuỗi) chuỗi nào của `locales/` hay locale web ở cả vi lẫn en, hay một `id:` không có
  testID nào trong `app/`/`components/` (giá trị không phải chữ của app ghi ở `NOT_COPY` kèm lý do).
- `store/listing.md`: mô tả vi/en, độ tuổi 18+ (khớp chính sách), privacy labels (có dòng xử lý AI và báo cáo),
  xoá tài khoản, nội dung do người dùng tạo, lý do từng quyền và dịch vụ nền, tài khoản
  demo cho review. Thêm quyền native thì cập nhật bảng quyền ở đó; thêm dịch vụ
  nhận dữ liệu (như Sentry) thì cập nhật bảng Quyền riêng tư.
