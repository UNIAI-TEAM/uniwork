# apps/chat-mobile

App Expo (iOS + Android) của UniChat (lát M1, UNI-1831): đăng nhập PKCE qua
trình duyệt hệ thống, chọn workspace, một socket realtime, push Expo, deep
link, bốn tab khung. Spec:
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
  `UNICHAT_API_URL`, `UNICHAT_APP_URL`; kết quả nằm ở `extra` (`apiUrl`,
  `appUrl`, `authClientId=uniwork-chat-mobile`, `deploymentId`) và app gọi
  `configureRuntime()` lúc boot. Bundle id `com.uniworkos.chat{.dev,.staging}`,
  scheme `uniworkchat-dev` (dev) / `uniworkchat`; universal link chỉ xác minh
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
