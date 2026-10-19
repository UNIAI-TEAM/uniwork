# UniChat — Shell Electron `apps/chat-desktop` (lát D1)

> **Trạng thái:** shipped — merge vào develop 2026-10-17 qua PR #336 (squash 4b50d7047); plan `../plans/2026-10-17-unichat-desktop-shell.md`; smoke tay shell còn lại cho nghiệm thu Q1 (UNI-1838). Lát D1 của epic UNI-1826; issue UNI-1830.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §3.2, §3.5, §6 D1 · **Nguồn mirror (đã khảo sát 2026-10-17):** `usf/apps/desktop/src/main/{navigation-guard,external-url,window-state,updater,updater-preferences,notification-gate,renderer-web-preferences,runtime-config-loader}.ts` (+ test), `usf/apps/desktop/src/shared/main-renderer-messages.ts` (+ test), `usf/apps/desktop/eslint.config.mjs` (rule `no-restricted-syntax` cấm gọi thẳng `shell.openExternal` / `webContents.downloadURL` ngoài một tệp `external-url.ts`), `uniwork-office/apps/shell/src/main/uniwork-auth/{pkce,callback,transport,session-core,manager}.ts`. **Không copy** từ usf: renderer riêng và tab coordinator, `webSecurity: false` + xóa header Origin, token trong `localStorage` + PAT của daemon, deep link mang token, `window.electron.ipcRenderer` chung · **Luật:** ADR 0026

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
  src/shared/bridge.ts    # re-export DesktopBridge từ @uniwork/core/platform, không định nghĩa lại
  resources/offline.html  # trang offline tĩnh, nút thử lại
  CLAUDE.md
```

Không có `src/renderer`: cửa sổ tải `UNICHAT_APP_URL`. Cấu hình theo `UNICHAT_ENV` (dev/staging/prod): `UNICHAT_APP_URL`, `UNICHAT_API_URL`, `UNICHAT_DEPLOYMENT_ID=default`, `UNICHAT_AUTH_CLIENT_ID` (`uniwork-chat-desktop`/`-dev`), scheme `uniworkchat`/`uniworkchat-dev`.

## 3. Thiết kế

### 3.1 Cửa sổ và an toàn
`BrowserWindow` với `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity` mặc định, `preload` duy nhất. Tiêu đề cửa sổ cố định là tên app (bỏ `page-title-updated`; số chưa đọc nằm ở badge). Trên macOS cửa sổ không có thanh tiêu đề (`titleBarStyle: "hidden"`, đèn giao thông căn giữa rail 72px): web đặt `data-window-chrome` trên `<html>` và đánh dấu `data-window-drag` ở dải trên rail, các header khung chat, `PageHeader`, màn đăng nhập và trang offline; nút bên trong vẫn bấm được. Vào toàn màn hình thì dải trên rail ẩn. `navigation-guard`: `will-navigate` chỉ cho origin `appUrl` và `apiUrl`; `setWindowOpenHandler` → `deny` và `openExternal` nếu `https:`. Điều hướng trong shell tới `/login`, `/register` (kể cả redirect `?next=` của web khi mất phiên) bị chặn và thay bằng `session.login()` (§3.2): trang đăng nhập web đăng nhập bằng cookie, không đi qua session provider theo token, nên nếu để qua thì lần khởi động sau sẽ mất phiên. Permission handler: cho `media` (mic/camera), `display-capture`, `notifications`; từ chối phần còn lại. Windows: `app.setAppUserModelId("com.uniworkos.chat")` để toast và badge chạy.

### 3.2 Phiên (PKCE ở main)
Nút đăng nhập của web (host UniChat) gọi `desktopAPI.session.login()` → main `GET /auth/desktop/start` (client, redirect, state, `code_challenge` S256, `deployment_id`, `device_label`, `platform`, `build`) → `shell.openExternal(authorization_url)` → protocol `uniworkchat://auth/callback?code&state` (single-instance: instance thứ hai chuyển argv về instance chính; macOS `open-url`) → kiểm `state` → `POST /auth/desktop/exchange` → refresh token mã hóa `safeStorage` trong `userData`, access token chỉ trong bộ nhớ main. `refresh()` single-flight, dùng `/auth/desktop/refresh` (header `X-UniWork-Device`), replay grace của server. `logout()` → `/auth/desktop/logout` + xóa. Renderer chỉ nhận access token qua IPC, không bao giờ nhận refresh token. Refresh 429 `rate_limited` → chờ `Retry-After` rồi thử lại, không đăng xuất. Trang consent web hiện vẫn ghi "UniWork Office" (`auth.desktop.title` / `approved` / `openDesktop` trong `packages/core/i18n/locales/{vi,en}.json`) và ô "Ứng dụng" hiện `client_id` thô: ánh xạ `client_id` → tên hiển thị và copy consent cho `uniwork-chat-*` thuộc lát này (lát N1 UNI-1827 cố ý để lại).

### 3.3 IPC
Kênh đóng: `session:login|get-access-token|refresh|logout|state`, `app:info|set-badge|is-focused|focus-changed|focus-window`, `shell:open-external|download-url|open-notification-settings`, `link:deep-link`, `media:pick-source`. `shell:open-notification-settings` không nhận payload: main mở trang thông báo cố định của hệ điều hành (macOS, Windows), vì Electron không cho biết người dùng đã tắt thông báo của app hay chưa. Mỗi handler kiểm `event.senderFrame.url` cùng origin `appUrl`, payload qua validator tay (không thêm thư viện), cap 64 KiB. Không kênh fs/process/HTTP chung (ADR 0026). Đối số của `contextBridge.exposeInMainWorld` trong preload khai báo `satisfies DesktopBridge` (import từ `src/shared/bridge.ts`), nên đổi tên một phương thức IPC là lỗi typecheck. Mọi sự kiện main → renderer (`link:deep-link`, `session` `onChange`, `app:focus-changed`) đi qua hàng đợi theo trạng thái sẵn sàng copy từ `usf/apps/desktop/src/shared/main-renderer-messages.ts` (+ test): renderer đăng ký listener trong effect sau hydration, `did-finish-load` chưa đủ, nên main giữ tin tới khi renderer báo kênh sẵn sàng rồi mới phát.

### 3.4 Thông báo, badge, deep link, offline
Banner: renderer dùng `new Notification()` (Electron ánh xạ sang hệ điều hành); web quyết định theo `isFocused()` (lát N3). Badge: `app.setBadgeCount(n)` (macOS/Linux), overlay icon trên Windows. Deep link: D1 chỉ nhận `uniworkchat://open?url=<path đã percent-encode>` → qua hàng đợi §3.3 tới `link:deep-link`; app chưa mở → tin nằm trong hàng đợi tới khi renderer sẵn sàng. Không nhận `https://app.uniworkos.com/...` ở D1: AASA mà N3 phục vụ chỉ liệt kê appID mobile, macOS cần entitlement associated-domains + chữ ký, Windows nhận `https` sẽ cướp mọi link của người dùng — xem lại sau khi D2 có chữ ký. Offline: `did-fail-load` → `loadFile(offline.html)`, thử lại theo lịch và khi `online`.

### 3.5 Chia sẻ màn hình
`session.setDisplayMediaRequestHandler`: macOS 15+ `useSystemPicker: true`; nơi khác `desktopCapturer.getSources` + cửa sổ chọn nguồn nhỏ (hoặc màn hình đầu tiên ở bước đầu — builder quyết). Không đổi `packages/views/chat/voice-call-*`.

## 4. Tiêu chí hoàn thành và test

| Kiểm | Test |
|---|---|
| `webPreferences` đúng ba cờ; `webSecurity` không bị tắt | `renderer-web-preferences.test.ts` |
| Host lạ → `openExternal`, host app → qua; `javascript:`/`file:` bị chặn; `/login`, `/register`, `/login?next=` cùng origin → chặn và gọi `session.login()` | `navigation-guard.test.ts`, `external-url.test.ts` |
| Callback `state` sai / hết hạn / thiếu code → từ chối, không exchange | `auth/callback.test.ts` |
| IPC payload sai kiểu, quá 64 KiB, sender lạ → từ chối | `ipc/schema.test.ts` |
| Parse deep link: path cùng origin → chuyển, khác → bỏ | `deep-link.test.ts` |
| Preload không lộ hàm trả refresh token; bề mặt `desktopAPI` khớp `DesktopBridge` (`satisfies`, lỗi typecheck khi lệch) | `preload.test.ts` (kiểm bề mặt `desktopAPI`) |
| Tin main → renderer gửi trước khi kênh sẵn sàng được giữ và phát lại đúng thứ tự khi sẵn sàng; `resetReady` khi renderer thay | `main-renderer-messages.test.ts` |
| Smoke tay (ký tên trong issue): đăng nhập → quay về app; khởi động lại vẫn còn phiên (không rơi về `/login`); đăng xuất thu hồi thiết bị; badge; banner mất focus; chia sẻ màn hình mac/win | checklist |

Lệnh: `pnpm --filter @uniwork/chat-desktop test|lint|typecheck`; `scripts/no-usf-leak.test.mjs`; `pnpm knip`.

## 5. Rủi ro
Protocol handler trên Linux (desktop file) không đáng tin — chấp nhận ở pilot; `safeStorage` trên Linux phụ thuộc keyring — fallback mã hóa yếu kèm cảnh báo log.

## 6. Quyết định của builder
Đã chốt trong plan (`../plans/2026-10-17-unichat-desktop-shell.md` › Quyết định builder): `SessionProvider` có `login()`, trang `/login` của web trong host UniChat gọi nó (client-side routing của Next không bắn `will-navigate`, shell không chặn `/login` được — thay cho ý "navigation-guard chặn /login" ở amendment 2026-10-17); một client `uniwork-chat-desktop`, dev khác redirect `uniworkchat-dev://`; cấu hình `UNICHAT_*` thay lúc build qua `define`; `credentials.ts` giữ riêng, Linux không keyring thì từ chối (không fallback yếu, thay §5 cũ); không updater trong D1; không `@electron-toolkit`; `downloadURL` bỏ qua `name`; badge Windows là chấm overlay; chia sẻ màn hình dùng system picker trên macOS 15, nơi khác màn hình đầu tiên; deep link về renderer là URL tuyệt đối trên origin app để `parseDeepLink` của web nhận cả scheme dev.
