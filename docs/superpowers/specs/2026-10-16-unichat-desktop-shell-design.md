# UniChat — Shell Electron `apps/chat-desktop` (lát D1)

> **Trạng thái:** in-progress — Đề xuất, chờ duyệt. Lát D1 của epic UNI-1826; issue UNI-1830.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §3.2, §3.5, §6 D1 · **Nguồn mirror:** `multica/apps/desktop/src/main/{navigation-guard,external-url,window-state,updater,renderer-web-preferences,runtime-config-loader}.ts` (+ test), `uniwork-office/apps/shell/src/main/uniwork-auth/{pkce,callback,transport,session-core,manager}.ts` · **Luật:** ADR 0026

## 1. Mục tiêu

Một shell Electron tải web app UniWork ở layout chỉ Chat, đăng nhập qua trình duyệt hệ thống bằng PKCE, giữ phiên an toàn trong main process, và cấp cho web đúng những gì web cần qua `desktopAPI` (lát N3): badge, focus, deep link, mở ngoài, tải tệp, chia sẻ màn hình.

## 2. Cấu trúc

```text
apps/chat-desktop/
  package.json            # @uniwork/chat-desktop; electron, electron-vite, electron-builder, electron-updater (phiên bản như uniwork-office shell)
  electron.vite.config.ts # main + preload (preload bundle một tệp CJS vì sandbox)
  src/main/index.ts       # app lifecycle, single-instance, protocol, cửa sổ
  src/main/{window-state,navigation-guard,external-url,offline,runtime-config}.ts
  src/main/auth/{pkce,callback,transport,session}.ts   # copy-adapt uniwork-auth
  src/main/ipc/{schema,handlers}.ts                   # kiểm sender, schema, 64 KiB
  src/main/screen-share.ts
  src/preload/index.ts    # contextBridge.exposeInMainWorld("desktopAPI", …)
  src/shared/bridge.ts    # kiểu dùng chung với packages/core/platform/desktop-bridge.ts
  resources/offline.html  # trang offline tĩnh, nút thử lại
  CLAUDE.md
```

Không có `src/renderer`: cửa sổ tải `UNICHAT_APP_URL`. Cấu hình theo `UNICHAT_ENV` (dev/staging/prod): `UNICHAT_APP_URL`, `UNICHAT_API_URL`, `UNICHAT_DEPLOYMENT_ID=default`, `UNICHAT_AUTH_CLIENT_ID` (`uniwork-chat-desktop`/`-dev`), scheme `uniworkchat`/`uniworkchat-dev`.

## 3. Thiết kế

### 3.1 Cửa sổ và an toàn
`BrowserWindow` với `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity` mặc định, `preload` duy nhất. `navigation-guard`: `will-navigate` chỉ cho origin `appUrl` và `apiUrl`; `setWindowOpenHandler` → `deny` và `openExternal` nếu `https:`. Permission handler: cho `media` (mic/camera), `display-capture`, `notifications`; từ chối phần còn lại. Windows: `app.setAppUserModelId("com.uniworkos.chat")` để toast và badge chạy.

### 3.2 Phiên (PKCE ở main)
Nút đăng nhập của web (host UniChat) gọi `desktopAPI.session.login()` → main `GET /auth/desktop/start` (client, redirect, state, `code_challenge` S256, `deployment_id`, `device_label`, `platform`, `build`) → `shell.openExternal(authorization_url)` → protocol `uniworkchat://auth/callback?code&state` (single-instance: instance thứ hai chuyển argv về instance chính; macOS `open-url`) → kiểm `state` → `POST /auth/desktop/exchange` → refresh token mã hóa `safeStorage` trong `userData`, access token chỉ trong bộ nhớ main. `refresh()` single-flight, dùng `/auth/desktop/refresh` (header `X-UniWork-Device`), replay grace của server. `logout()` → `/auth/desktop/logout` + xóa. Renderer chỉ nhận access token qua IPC, không bao giờ nhận refresh token. Refresh 429 `rate_limited` → chờ `Retry-After` rồi thử lại, không đăng xuất. Trang consent web hiện vẫn ghi "UniWork Office" (`auth.desktop.title` / `approved` / `openDesktop` trong `packages/core/i18n/locales/{vi,en}.json`) và ô "Ứng dụng" hiện `client_id` thô: ánh xạ `client_id` → tên hiển thị và copy consent cho `uniwork-chat-*` thuộc lát này (lát N1 UNI-1827 cố ý để lại).

### 3.3 IPC
Kênh đóng: `session:login|get-access-token|refresh|logout|state`, `app:info|set-badge|is-focused|focus-changed|focus-window`, `shell:open-external|download-url`, `link:deep-link`, `media:pick-source`. Mỗi handler kiểm `event.senderFrame.url` cùng origin `appUrl`, payload qua validator tay (không thêm thư viện), cap 64 KiB. Không kênh fs/process/HTTP chung (ADR 0026).

### 3.4 Thông báo, badge, deep link, offline
Banner: renderer dùng `new Notification()` (Electron ánh xạ sang hệ điều hành); web quyết định theo `isFocused()` (lát N3). Badge: `app.setBadgeCount(n)` (macOS/Linux), overlay icon trên Windows. Deep link: `uniworkchat://open?url=<path>` và `https://app.uniworkos.com/...` khi app là handler → `webContents.send("link:deep-link", url)`; app chưa mở → lưu và phát sau `did-finish-load`. Offline: `did-fail-load` → `loadFile(offline.html)`, thử lại theo lịch và khi `online`.

### 3.5 Chia sẻ màn hình
`session.setDisplayMediaRequestHandler`: macOS 15+ `useSystemPicker: true`; nơi khác `desktopCapturer.getSources` + cửa sổ chọn nguồn nhỏ (hoặc màn hình đầu tiên ở bước đầu — builder quyết). Không đổi `packages/views/chat/voice-call-*`.

## 4. Tiêu chí hoàn thành và test

| Kiểm | Test |
|---|---|
| `webPreferences` đúng ba cờ; `webSecurity` không bị tắt | `renderer-web-preferences.test.ts` |
| Host lạ → `openExternal`, host app → qua; `javascript:`/`file:` bị chặn | `navigation-guard.test.ts`, `external-url.test.ts` |
| Callback `state` sai / hết hạn / thiếu code → từ chối, không exchange | `auth/callback.test.ts` |
| IPC payload sai kiểu, quá 64 KiB, sender lạ → từ chối | `ipc/schema.test.ts` |
| Parse deep link: path cùng origin → chuyển, khác → bỏ | `deep-link.test.ts` |
| Preload không lộ hàm trả refresh token | `preload.test.ts` (kiểm bề mặt `desktopAPI`) |
| Smoke tay (ký tên trong issue): đăng nhập → quay về app; khởi động lại giữ phiên; đăng xuất thu hồi thiết bị; badge; banner mất focus; chia sẻ màn hình mac/win | checklist |

Lệnh: `pnpm --filter @uniwork/chat-desktop test|lint|typecheck`; `scripts/no-usf-leak.test.mjs`; `pnpm knip`.

## 5. Rủi ro
Protocol handler trên Linux (desktop file) không đáng tin — chấp nhận ở pilot; `safeStorage` trên Linux phụ thuộc keyring — fallback mã hóa yếu kèm cảnh báo log.

## 6. Để builder quyết
Có dùng `@electron-toolkit/*` như multica hay không; cách sinh overlay badge Windows; picker nguồn chia sẻ màn hình; nơi lưu `window-state`.
