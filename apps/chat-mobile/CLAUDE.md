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

Cùng file lint còn giữ bốn luật chất lượng (fixture: `lib/lint-quality.test.ts`):
`@typescript-eslint/no-explicit-any` bật (base tắt cho web); bộ `all` của
`eslint-plugin-react-native-a11y` (role, state, value, action, live region,
`importantForAccessibility` hợp lệ; không touchable trong phần tử `accessible`)
trừ `has-accessibility-hint` — tắt có lý do ghi trong config: hint chỉ dùng khi
nhãn không nói rõ kết quả; `i18next/no-literal-string` (`jsx-text-only`)
như `packages/views`; và `no-console` ngoài `data/logger.ts`. Tắt một luật ở
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
  `{error}` trước auth là kết thúc — `onSessionEnded(error)`, không backoff,
  provider chỉ refresh với `invalid token`; `active` chỉ `resume()` sau
  `background` hoặc khi socket chưa auth. Reader token cho provider là
  `realtime/refresh-for-socket.ts` (thuần): thử token hiện tại trước, refresh
  khi vẫn là token đã chết, thất bại tạm thời thì reject để giữ phiên.
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
  công tắc (`unichat_mobile_calls`: tắt thì ẩn nút gọi, không đổ chuông, push
  cuộc gọi mở phòng; server cũng không gửi push cuộc gọi cho người đó —
  `PushConsumer.SetMobileCalls`; cuộc gọi đang diễn ra không bị cắt). Chưa có câu trả lời hay server không tới được thì không
  chặn gì và mọi công tắc ở mặc định. Lỗi một thao tác → `toast.error(...)`
  (`data/stores/toast-store.ts`, `components/ui/toast-host.tsx`); `Alert.alert`
  chỉ cho xác nhận thật (xoá, rời, thu hồi) và trong sheet là `Modal` (toast vẽ
  dưới cửa sổ Modal). Đăng xuất: `useAuthStore.logout()` tự gỡ push
  subscription trước (tối đa 3 s); phiên đã bị server kết thúc thì chỉ quên
  token, server bỏ qua thiết bị đó. Cache của tài khoản bỏ qua
  `clearAccountCache` (`data/remote-config.ts`), không `queryClient.clear()`:
  query cấu hình từ xa được giữ (update gate quan sát nó suốt đời app; xoá thì
  gate đứng ở câu trả lời cũ) và hỏi lại không kèm tổ chức.
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
  `realtime-cache`, viewer là tham số), hàng đợi gửi trong phiên
  (`chat-send.ts` + `stores/chat-send-store.ts`, `client_msg_id`, flush khi
  NetInfo online hoặc socket reconnect), `realtime/chat-realtime.ts` (bảng §8
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
  lời mời chờ khi mở workspace và mỗi lần reconnect). UI:
  `components/calls/call-overlay.tsx` (lớp toàn màn hình, không phải Modal,
  gắn một lần ở `(app)/_layout.tsx`, trên mọi màn workspace; mỗi layout
  workspace `attach` ngữ cảnh vào engine, cái trên cùng được dùng) + `call-room.tsx` (LiveKit RN;
  `registerGlobals()` ở `app/_layout.tsx`). Nhạc chuông: `lib/call-ringtone.ts`
  render `assets/sounds/ring-*.wav` (test so byte; sinh lại bằng
  `UPDATE_RINGTONES=1`). Push "X đang gọi" mang `?call=`; tab Chat gọi
  `callEngine.joinFromPush`. Cần dev client (EAS), không chạy Expo Go.
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
pnpm --filter @uniwork/chat-mobile test:unit         # vitest, node: lib/ data/ app.config
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
  `test/render.tsx` (i18n tiếng Việt, `QueryClient` mới), `viText(key)` là chuỗi
  người nghe. `test/jest-setup.ts` mock `expo-router`, `expo-audio`, safe area,
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
  có lối tắt phiên thử nghiệm trong bản nào), ba luồng vàng
  `flows/{chat-read-send,push-open-room,call-join}.yaml` chạy hằng đêm bởi
  `.github/workflows/chat-mobile-verify.yml` với server staging (biến
  `MAESTRO_*`; thiếu thì run theo lịch **đỏ**, chạy tay bỏ chọn `maestro` để chỉ
  build), Maestro ghim `MAESTRO_VERSION`; cùng đêm đó job `android-production`
  build AAB release từ profile production, không cần secret. Trong app flow chọn theo `testID`
  (`room-row-<roomId>`, `conversation-<roomId>`, `composer-input`,
  `composer-send`, `room-call-*`, `call-*`) — đổi tên một id thì sửa flow cùng
  PR; trang web trong sheet đăng nhập thì theo chữ vi|en.
- `store/listing.md`: mô tả vi/en, privacy labels, lý do từng quyền, tài khoản
  demo cho review. Thêm quyền native thì cập nhật bảng quyền ở đó; thêm dịch vụ
  nhận dữ liệu (như Sentry) thì cập nhật bảng Quyền riêng tư.
