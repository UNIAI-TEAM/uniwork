# apps/chat-desktop

Shell Electron của UniChat (lát D1, UNI-1830): một `BrowserWindow` tải web app
UniWork đã deploy ở layout chỉ Chat. Không có `src/renderer`. Spec:
`docs/superpowers/specs/2026-10-16-unichat-desktop-shell-design.md`; plan:
`docs/superpowers/plans/2026-10-17-unichat-desktop-shell.md`. Đóng gói và phát
hành (lát D2, UNI-1835): spec `docs/superpowers/specs/2026-10-16-unichat-desktop-release-design.md`,
plan `docs/superpowers/plans/2026-10-17-unichat-desktop-release.md`, runbook
`docs/runbooks/unichat-desktop-release.md`.

## Cấu trúc

- `src/main/` — cửa sổ, navigation guard, PKCE (refresh token chỉ ở đây,
  `safeStorage`), IPC đóng. Module thuần hàm, test không cần Electron
  (`vi.mock("electron")`); `index.ts` là wiring, smoke tay.
- `src/preload/` — một bundle CJS, expose đúng `DesktopBridge`
  (`packages/core/platform/desktop-bridge.ts`) qua `window.desktopAPI`.
- `src/main/ipc/handlers.ts` — `registerIpc` đăng ký toàn bộ kênh (test pin
  tập kênh); `badge.ts` (mac/linux `setBadgeCount`, Windows chấm đỏ overlay,
  cap 999); `offline.ts` + `resources/offline.html` (`did-fail-load` → trang
  offline, thử lại 5 s và khi `online`); `screen-share.ts` (macOS 15+ system
  picker, nơi khác màn hình đầu tiên). Deep link tới renderer là URL app
  (`appUrl + path`) vì parser web chỉ nhận scheme prod.
- `src/shared/bridge.ts` — re-export kiểu từ `@uniwork/core/platform`; chỉ kiểu.
- `src/main/updater.ts` — electron-updater, chỉ ở main: Windows/Linux tự tải và
  cài khi thoát; mac chưa ký (`UNICHAT_MAC_SIGNED` inline từ `CSC_LINK` lúc build)
  chỉ thông báo và mở `${appUrl}/unichat`. Bản `UNICHAT_ENV=dev` không đọc feed.
- `electron-builder.ts` — `builderConfig(env)`: tên tệp `unichat_<version>[_unsigned]_<os>_<arch>…`
  theo `scripts/office/installer-urls.mjs --prefix unichat`, mac chưa ký thì ký ad hoc;
  feed `generic` trên release cuộn `chat-desktop-feed`; kênh lấy từ phần prerelease
  của version. `scripts/release.mjs` (tag → version/kênh, viết lại feed) cho
  `.github/workflows/chat-desktop-release.yml`; `scripts/package.test.mjs` giữ cả hai.
- Cấu hình build-time: `UNICHAT_ENV` (`dev`|`staging`|`prod`), `UNICHAT_APP_URL`,
  `UNICHAT_API_URL`, `UNICHAT_DEPLOYMENT_ID` — `electron.vite.config.ts` inline
  qua `define`, nên đọc chúng bằng đúng biểu thức `process.env.UNICHAT_*` rồi
  đưa vào `resolveShellConfig` (`src/main/runtime-config.ts`). Client id một
  `uniwork-chat-desktop`; `dev` dùng `uniworkchat-dev://auth/callback`.

## Chạy

```bash
pnpm --filter @uniwork/web dev                              # web app ở :3000
UNICHAT_ENV=dev pnpm --filter @uniwork/chat-desktop dev     # shell, API :8080
pnpm --filter @uniwork/chat-desktop test | typecheck | lint | build
pnpm --filter @uniwork/chat-desktop package --mac -c.extraMetadata.version=0.1.0-dev.1
                                    # sau build; → dist/package (--win, --linux cũng dựng được trên macOS)
```

Shell mở `/auth/unichat` (không phải `/`, là landing): trang đó render rỗng
rồi chuyển sang `/login`, nơi host UniChat hiện màn chào kiểu messenger khi
chưa đăng nhập, hoặc vào thẳng chat khi đã có phiên. Không có web dev server
thì shell hiện `resources/offline.html` và tự thử lại.
Trên macOS, `dev` ký ad hoc Electron.app trong `node_modules` khi nó chưa có chữ
ký (`scripts/sign-dev-electron.mjs`): bản x64 tải về không ký, và macOS từ chối
thông báo hệ thống của app chưa ký (`UNErrorDomain 1`).
Chạy từ terminal nhúng trong VS Code/Electron thì `unset ELECTRON_RUN_AS_NODE`
trước, nếu không `require("electron")` trả về đường dẫn binary và main chết ở
`app.setName`.

Server cần bật `DESKTOP_AUTH_CLIENTS` (`.env.example`, mục Desktop auth) với
client `uniwork-chat-desktop` và cả hai redirect.

## Luật

- `webPreferences`: `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`; không đặt `webSecurity`/`plugins`; một `preload`
  (`renderer-web-preferences.test.ts`).
- IPC đóng (ADR 0026): chỉ các kênh spec §3.3 (`session:*`, `app:*`,
  `shell:*`, `link:*`). Mỗi handler kiểm origin của `event.senderFrame.url`
  bằng `appUrl`, payload qua validator tay ở `src/main/ipc/schema.ts`,
  chuỗi ≤ 64 KiB. Không kênh fs/process/HTTP chung.
- Guard điều hướng nghe cả `will-navigate` và `will-redirect` (một 302 từ server
  ra ngoài `appUrl`/`apiUrl` bị chặn, log chỉ origin) — `navigation-guard.test.ts`.
- Mọi push main→renderer (`session:changed`, `app:focus-changed`,
  `link:deep-link`) đi qua `sendToApp` (`ipc/schema.ts`): bỏ qua khi
  `webContents.mainFrame.url` không có origin `appUrl` (trang offline, frame lạ).
- Quyền web quyết định bằng `decidePermission` (`permissions.ts`): chỉ main
  frame origin `appUrl` và quyền trong allowlist (media, display-capture,
  notifications, clipboard-sanitized-write, fullscreen); `screen-share.ts`
  trả `{}` khi `request.securityOrigin` không phải `appUrl`.
- Preload không expose `ipcRenderer` thô, không `@electron-toolkit/*`; đối
  tượng expose khai báo `satisfies DesktopBridge`.
- Renderer chỉ nhận access token; không hàm nào trả refresh token.
- `shell.openExternal` / `webContents.downloadURL` chỉ trong
  `src/main/external-url.ts` (ESLint `no-restricted-syntax`); chỉ `https:`,
  `http:` loopback khi `UNICHAT_ENV=dev`.
- Không log token, body callback hay URL callback.
- Updater không có kênh IPC, không UI trong renderer; link tải chỉ qua
  `openExternalSafely`. `electron-updater` nằm ở `dependencies` với range thường
  (electron-builder từ chối `catalog:`), nên được đóng vào `app.asar`.
- Phát hành chỉ bằng tag `chat-desktop-v*` (runbook); không commit artifact, không
  đặt secrets ký ngoài Environment `chat-desktop-release`.
- Không token thương hiệu usf nào sống sót trong cây (`scripts/no-usf-leak.test.mjs`).
