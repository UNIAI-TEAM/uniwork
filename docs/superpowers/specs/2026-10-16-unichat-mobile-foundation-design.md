# UniChat — Nền `apps/chat-mobile`: Expo iOS + Android, ranh giới import, CI, auth PKCE, realtime, push, deep link (lát M1)

> **Trạng thái:** shipped — merge vào develop 2026-10-17 qua PR #337 (squash f24ce4874); plan `../plans/2026-10-17-unichat-mobile-foundation.md`; chạy trên máy/simulator thật còn lại cho Q1 (UNI-1838). Lát M1 của epic UNI-1826; issue UNI-1831.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §3.3, §6 M1 · **Luật:** ADR 0011 (§1 nới cho UniChat: iOS và Android cùng lúc) · **Nguồn mirror:** `usf/apps/mobile/{CLAUDE.md, data/realtime/ws-client.ts, data/realtime/realtime-provider.tsx, data/api.ts, data/query-client.ts, data/secure-storage.ts, data/auth-store.ts, data/workspace-store.ts, scripts/ios-run.sh}`, `usf/.github/workflows/mobile-verify.yml`

## 1. Mục tiêu

App Expo chạy trên simulator iOS và emulator Android với: đăng nhập PKCE qua trình duyệt hệ thống, chọn workspace, socket realtime ba tầng có replay khi hết hạn token, đăng ký push Expo, deep link; mọi tầng có test Node; chưa có màn hình chat.

## 2. Cấu trúc và stack

```text
apps/chat-mobile/
  app/                 # Expo Router: (auth)/login, (app)/[org]/[ws]/(tabs)/{chat,calls,contacts,settings}
  components/{ui,nav,chat,calls,contacts,settings,brand}/
  data/{api.ts,schemas.ts,query-client.ts,secure-storage.ts,auth/,realtime/,queries/,mutations/,stores/}
  lib/                 # pure helpers + *.test.ts (vitest, Node): *-display.ts mirror web
  locales/{vi,en}.json # sinh bằng scripts/sync-i18n.mjs từ packages/core/i18n/locales
  scripts/{ios-run.sh,sync-i18n.mjs}
  app.config.ts eas.json(M4) CLAUDE.md
```

Stack theo `usf/apps/mobile/package.json` tại thời điểm scaffold (Expo SDK 57 `~57.0.26`, React Native 0.86.3, React 19.2.3 — cùng react với catalog nên monorepo chỉ có một react; dòng cũ "Expo ~55 / RN 0.83" đã lỗi thời, Expo Router, NativeWind 4 + Tailwind 3.4, react-native-reusables, TanStack Query 5, Zustand, expo-secure-store, NetInfo), thêm `expo-web-browser`, `expo-crypto`, `expo-notifications`, `expo-linking`, `expo-image`, `expo-image-picker`, `expo-document-picker`. `expo` và `react-native` ghim trong catalog (cùng kiểu khối electron), react/react-dom/@types/react qua `catalog:`; các gói Expo còn lại pin trực tiếp trong app (chỉ một workspace dùng).

## 3. Thiết kế

### 3.1 Ranh giới import (lint, không phải quy ước)
ESLint `no-restricted-imports`: cấm `@uniwork/views*`, `@uniwork/ui*`, `next/*`, và trong `@uniwork/core` cấm mọi đường trừ allowlist: `types/*` (chỉ `import type`), `api/schema` (`parseWithFallback`), `api/endpoints/chat-schemas`, `permissions/rules`, `paths/paths.ts` và `paths/marketing.ts` (không phải barrel `paths`), `types/events`, và các module thuần của `core/chat` liệt kê rõ (`read-receipt-utils`, `poll-utils`, `post-utils`, `note-utils`, `reminder-utils`, `room-permissions-utils`, `client-msg-id`, `pending-message-id`, `lazy-chat-scopes`, `message-links`, `typing-user-id`, `composer-priority`, `chat-room-helpers`). Allowlist là **theo đường dẫn tệp, không bao giờ là barrel** (`index.ts`), không có ngoại lệ; usf vỡ đúng ở chỗ này: barrel `core/{agents,permissions}/index.ts` kéo TanStack, zustand và ApiClient web vào Metro. `scripts/mobile-core-allowlist.test.mjs` giữ allowlist: mỗi mục phải resolve ra tệp, không mục nào là barrel, và đi theo import giá trị bắc cầu (bỏ `import type`) của từng mục — gặp `react`, `react-dom`, `zustand`, `@tanstack/*`, `next`, bất kỳ gói ngoài trừ `zod`, hoặc tệp `core/platform/`, `core/api/http.ts`, `core/api/session.ts`, `*.tsx` là đỏ và in cả chuỗi import (`core/runtime-config.ts` được phép: không phụ thuộc gì, không đọc env — app mobile tự gọi `configureRuntime()`). Mục không thuần phải tách phần thuần ra tệp riêng rồi allowlist tệp đó, không nới test (đã làm: `paths` barrel kéo `resolve.ts → auth/hooks` nên allowlist hai tệp thuần; `chat-room-helpers` giữ `mergeChatContact` thuần và `contacts-store` import lại, còn `fetchChatUserById` về `user-lookup`). Logic khác: copy vào `lib/*-display.ts`, ghi nguồn ở đầu tệp, test parity. `scripts/governance.test.mjs` (`describe` "ADR 0011 — apps/chat-mobile", pass rỗng khi chưa có app): có `apps/chat-mobile` ⇒ có `CLAUDE.md`, eslint config chứa `no-restricted-imports` và `@uniwork/views`, có `.github/workflows/mobile-verify.yml`, CI chính lọc `!@uniwork/chat-mobile`.

### 3.2 Định danh và cấu hình
`app.config.ts` theo `APP_ENV`: bundle id / applicationId `com.uniworkos.chat`, `.dev`, `.staging`; scheme `uniworkchat` / `uniworkchat-dev`; `associatedDomains: applinks:app.uniworkos.com`; Android `intentFilters` `autoVerify` cho `https://app.uniworkos.com`; chuỗi quyền vi/en (mic, camera, ảnh, thông báo); `extra.apiUrl`, `extra.appUrl`, `extra.authClientId`, `extra.deploymentId`.

### 3.3 Đăng nhập
`data/auth/pkce.ts` (verifier 64 ký tự từ `expo-crypto`, S256), `data/auth/flow.ts`: `GET /auth/desktop/start` → `WebBrowser.openAuthSessionAsync(authorization_url, redirectUri)` → parse `code`/`state` → `POST /auth/desktop/exchange` → SecureStore `{access_token, refresh_token, device_session_id, expires_at}`. `data/api.ts`: bearer, 401 → refresh single-flight → retry; refresh (`/auth/desktop/refresh`) luôn gửi header `X-UniWork-Device: <device_session_id>` để có ngân sách 60/phút theo thiết bị thay vì theo IP (điện thoại sau NAT nhà mạng dùng chung IP); refresh 401 → đăng xuất, còn 429 `rate_limited` → chờ `Retry-After` rồi thử lại, không đăng xuất. Trang consent web đã hiện tên theo client (`uniwork-chat-*` → "UniChat", `{{app}}` trong `auth.desktop.*`) từ lát D1; mobile không cần đổi gì ở web. Lưu ý: sau khi duyệt, trang consent cần một chạm "Mở UniChat" rồi mới redirect về scheme, nên `openAuthSessionAsync` chờ qua bước đó. Đăng xuất gọi `/auth/desktop/logout`. Hồ sơ `GET /me`, tổ chức/workspace qua API hiện có; một tài khoản một tổ chức (ADR 0032) nên màn hình chọn chỉ liệt kê workspace.

### 3.4 Realtime ba tầng
`ws-client.ts` (copy thiết kế usf, thêm scope/replay/4001 từ core): một socket, frame đầu `{"type":"auth","payload":{"token"}}`, chờ `auth_ack`, `subscribe`/`unsubscribe` scope `chat`, xử lý `subscribe_ack`/`subscribe_error(lookup_failed)` với backoff như `packages/core/realtime/use-chat-room-scopes.ts`, `{"type":"ping"}` mỗi 25 giây, backoff jitter, ba trạng thái idle/active/paused theo AppState, NetInfo; socket đóng `CloseSessionEnded` → refresh → reconnect → replay scope; giới hạn 25 scope chat. `realtime-provider.tsx` mount theo auth + workspace. `use-<feature>-realtime.ts` là tầng ba (M2a). Mọi frame chỉ mang id (ADR 0015): patch bằng fetch theo id, rồi invalidate hẹp.

### 3.5 Push
Sau đăng nhập lần đầu hỏi quyền; `getExpoPushTokenAsync({projectId})` → đăng ký qua tuyến push hiện có với `platform` (lát N2). Android: kênh `chat` (importance high). Chạm thông báo → mở `data.url` qua bộ parse deep link. Hủy đăng ký khi tắt trong Cài đặt hoặc đăng xuất. Nhịp presence chat (`POST` heartbeat, lát N2 §3.5) mang `visible: AppState.currentState === "active"`; thiếu trường này nhịp bị coi là ẩn và push không bao giờ được chặn khi app đang mở.

### 3.6 Deep link
`expo-linking`: universal/app link `https://app.uniworkos.com/{org}/{ws}/chat?room=&message=` và `uniworkchat://open?url=`; `lib/deep-link.ts` parse bằng cùng tham số web (`room`, `message`, `dm`), có test; app chưa đăng nhập → lưu rồi mở sau.

### 3.7 i18n và theme
`scripts/sync-i18n.mjs` lấy khóa `chat.*`, `common.*`, `auth.*` từ `packages/core/i18n/locales/{vi,en}.json` → `locales/`; test parity thất bại khi lệch. Theme: biến CSS NativeWind đặt tên theo `packages/ui/styles/tokens.css` (`--background`, `--foreground`, `--brand`…), sáng/tối/hệ thống lưu SecureStore; `NAV_THEME` mirror.

## 4. Tiêu chí hoàn thành và test

| Kiểm | Test |
|---|---|
| ws-client: frame auth trước mọi frame; replay scope sau reconnect; pause ở nền; hết hạn token → refresh → reconnect | `data/realtime/ws-client.test.ts` |
| Schema malformed → fallback, không ném | `data/schemas.test.ts` |
| Parse deep link ba dạng | `lib/deep-link.test.ts` |
| PKCE: verifier/challenge đúng RFC 7636; state lệch → từ chối | `data/auth/pkce.test.ts`, `flow.test.ts` |
| i18n parity | `lib/i18n.test.ts` |
| Lint đỏ với import cấm, xanh với allowlist | fixture test eslint |
| Governance | `scripts/governance.test.mjs` |
| Allowlist core thuần: mỗi mục resolve ra tệp (không barrel nào), có khoá trong `exports` của `@uniwork/core`, không mục nào bắc cầu tới react/zustand/TanStack/`platform/`/`api/http.ts`/`api/session.ts`/`*.tsx` (`runtime-config.ts` được phép) | `scripts/mobile-core-allowlist.test.mjs` |
| Chạy tay: `ios` và `android` đăng nhập → danh sách workspace đúng như web; token push xuất hiện trong `push_subscriptions` | checklist |

Lệnh: `pnpm --filter @uniwork/chat-mobile test|lint|typecheck`; `node --test scripts/governance.test.mjs`; `scripts/no-usf-leak.test.mjs`.

### 3.7 Yêu cầu từ khảo sát usf (2026-10-17)
- **Reconnect 4001 viết test trước khi port**: server đóng socket `CloseSessionEnded` (4001) khi access token 15 phút hết hạn; `ws-client` của usf (`apps/mobile/data/realtime/ws-client.ts`) chưa từng phải xử lý vì token usf sống 30 ngày. `data/realtime/ws-client.test.ts` phải có ba case trước khi copy: token hết hạn giữa scope → refresh → reconnect → replay scope; refresh 429 với `Retry-After` → chờ rồi thử lại, không đăng xuất; refresh 401 → đăng xuất. Dùng `packages/core/api/ws-client.test.ts` làm fixture parity.
- **Nguồn mirror đã xác minh ở usf** (`/Users/ducquang/product/usf/apps/mobile`): `data/realtime/ws-client.ts` (idle/active/paused, jitter, ping/pong app-level, AppState, NetInfo), `data/realtime/realtime-provider.tsx`, `lib/use-ws-subscriptions.ts`, `data/secure-storage.ts` + `data/session-epoch.ts` (ghi SecureStore tuần tự, epoch chặn refresh muộn hồi sinh phiên đã đăng xuất), `data/auth-store.ts`, `data/query-client.ts` (`focusManager` ← AppState, `onlineManager` ← NetInfo), `app.config.ts` theo `APP_ENV` (thêm khối android usf thiếu), `scripts/ios-run.sh`, `.github/workflows/mobile-verify.yml` (lọc theo path). Không mượn: ranh giới import chỉ bằng quy ước, barrel re-export từ core, `shamefully-hoist`, knip `continue-on-error`.

## 5. Rủi ro
Expo SDK trôi so với usf lúc scaffold (đã chốt SDK 57 ngày 2026-10-17); `openAuthSessionAsync` trên Android cần Custom Tabs; universal links chỉ hoạt động khi web đã phục vụ `/.well-known` (lát N3).

## 6. Quyết định của builder
Đã chốt trong plan (`../plans/2026-10-17-unichat-mobile-foundation.md` › Quyết định builder): PKCE viết tay port từ `apps/chat-desktop/src/main/auth` (expo-crypto, `openAuthSessionAsync`), không `expo-auth-session`; một `WSClient` + `getToken` + `forceReconnect` sau refresh (4001 không tự quay số lại; host refresh); 401 trần khi refresh là transient (chỉ verdict server mới đăng xuất); 4001 lúc background hoãn tới `resume()`; chưa refresh chủ động 80 % (M2a); không `.env` — `app.config.ts extra` + `UNICHAT_*` lúc build, `configureRuntime()` lúc boot; bỏ header `X-Workspace-Slug`; `WSMessage` khai báo trong app (`api/ws-types` không trong allowlist); RNR copy qua CLI vào `components/ui`, không gói `react-native-reusables`; icon tạm từ `apps/web` (thay ở M4); push chỉ đăng ký khi có `extra.eas.projectId`.
