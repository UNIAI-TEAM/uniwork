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

## Cấu trúc

- `app.config.ts` — cấu hình duy nhất, không `app.json`, **không `.env`**
  (pre-commit từ chối). Biến build: `UNICHAT_ENV` (`dev`|`staging`|`production`),
  `UNICHAT_API_URL`, `UNICHAT_APP_URL` (bắt buộc với staging/production: thiếu
  thì config ném lỗi thay vì ship bản trỏ `localhost`), `UNICHAT_EAS_PROJECT_ID`
  (ghi đè hằng `EAS_PROJECT_ID`), `GOOGLE_SERVICES_JSON` (biến EAS kiểu file →
  `android.googleServicesFile`; thiếu thì Android không lấy được push token);
  kết quả nằm ở `extra` (`apiUrl`,
  `appUrl`, `authClientId=uniwork-chat-mobile`, `deploymentId`, `eas.projectId`
  khi có dự án EAS) và app gọi `configureRuntime()` lúc boot. Bundle id
  `com.uniworkos.chat{.dev,.staging}`, scheme `uniworkchat-dev` (dev) / `uniworkchat`; universal link chỉ xác minh
  với id prod.
- `lib/` — helper thuần + test vitest (env node). `theme.ts`/`global.css`/
  `tailwind.config.js` mirror nhau; giá trị là `packages/ui/styles/tokens.css`
  đổi sang HSL, đổi một nơi thì đổi cả ba. `radius-tokens.json` là thang
  `--radius-*` của tokens.css.
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
  màn hình ở `app/(app)/[org]/[ws]/{(tabs)/chat,room/[roomId]/{index,info,thread/[rootId]},new-chat,channels}.tsx`
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
```

Máy thật không thấy `localhost` của máy dev: đặt `UNICHAT_API_URL=http://<LAN IP>:8080`
và `UNICHAT_APP_URL=http://<LAN IP>:3000` khi chạy. Server dev phải bật
`DESKTOP_AUTH_CLIENTS` (`.env.example`) với client `uniwork-chat-mobile`.

Root `typecheck`/`test`/`lint` và CI chính lọc `!@uniwork/chat-mobile`;
app kiểm ở `.github/workflows/mobile-verify.yml`. Không có script `build`.
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
- `version` trong `app.config.ts` là `runtimeVersion` (`policy: appVersion`):
  đổi native (gói native, plugin, quyền, SDK) thì bump nó; chỉ đổi JS thì phát
  OTA. Chưa có `EAS_PROJECT_ID` thì `updates.enabled: false` và push bỏ qua.
  `knip.json` bỏ qua `expo-updates` vì knip đọc config dev.
- Tag `chat-mobile-v<version>` → `.github/workflows/chat-mobile-release.yml`
  (EAS build + auto-submit, Environment `chat-mobile-release`, chỉ
  `EXPO_TOKEN`; thiếu thì notice và xanh).
- `maestro/`: `subflows/sign-in.yaml` đăng nhập qua sheet trình duyệt thật (không
  có lối tắt phiên thử nghiệm trong bản nào), ba luồng vàng
  `flows/{chat-read-send,push-open-room,call-join}.yaml` chạy hằng đêm bởi
  `.github/workflows/chat-mobile-verify.yml` với server staging (biến
  `MAESTRO_*`; thiếu thì notice và xanh). Trong app flow chọn theo `testID`
  (`room-row-<roomId>`, `conversation-<roomId>`, `composer-input`,
  `composer-send`, `room-call-*`, `call-*`) — đổi tên một id thì sửa flow cùng
  PR; trang web trong sheet đăng nhập thì theo chữ vi|en.
- `store/listing.md`: mô tả vi/en, privacy labels, lý do từng quyền, tài khoản
  demo cho review. Thêm quyền native thì cập nhật bảng quyền ở đó.
