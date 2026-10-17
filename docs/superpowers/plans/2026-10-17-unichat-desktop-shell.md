# UniChat D1 — Shell Electron `apps/chat-desktop` — Kế hoạch triển khai

> **Trạng thái:** in-progress — issue UNI-1830, nhánh `feature/UNI-1830-unichat-d1-shell-electron`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một shell Electron mỏng tải web app UniWork đã deploy ở layout chỉ Chat (lát N3), đăng nhập PKCE qua trình duyệt hệ thống với refresh token chỉ ở main, và expose đúng `DesktopBridge` (`packages/core/platform/desktop-bridge.ts`) qua `window.desktopAPI`.

**Architecture:** Không `src/renderer`. `src/main` = cửa sổ + guard + PKCE + IPC đóng; `src/preload` = một bundle CJS expose đúng kiểu `DesktopBridge`; `src/shared/bridge.ts` re-export kiểu từ `@uniwork/core/platform`. Module main thuần hàm, test không cần Electron (mock `electron` bằng `vi.mock`). Nguồn copy: usf `apps/desktop/src/main/{navigation-guard,external-url,window-state,renderer-web-preferences}.ts`, `src/shared/main-renderer-messages.ts` (+test); uniwork-office `apps/shell/src/main/uniwork-auth/{pkce,callback,transport,session-core,manager,credentials,routing}.ts` (+tests). Mọi token `multica`, `MUL-`, `.multica`, `multica.ai` phải biến mất (`scripts/no-usf-leak.test.mjs`).

**Tech Stack:** Electron ^43.7.6, electron-vite ^5, electron-builder ^26 (chỉ cấu hình, không ký, không updater — D2), TypeScript strict, vitest env node. Không `@electron-toolkit/*`.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-desktop-shell-design.md` (+ amendment 2026-10-17 từ khảo sát usf).

## Global Constraints

- `webPreferences`: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, không đặt `webSecurity`/`plugins`; `preload` duy nhất; không `@electron-toolkit/preload`, không expose `ipcRenderer` thô (ADR 0026).
- IPC đóng, tên kênh theo spec §3.3: `session:login|get-access-token|refresh|logout`, `app:info|set-badge|is-focused|focus-changed|focus-window`, `shell:open-external|download-url`, `link:deep-link`, `link:ready` (handshake hàng đợi). Mỗi handler kiểm `new URL(event.senderFrame.url).origin === appOrigin`; payload qua validator tay trong `src/main/ipc/schema.ts`; chuỗi ≤ 64 KiB.
- Renderer chỉ nhận access token; không hàm nào trả refresh token (`preload.test.ts`).
- Cấu hình: `UNICHAT_ENV` (`dev`|`staging`|`prod`), `UNICHAT_APP_URL`, `UNICHAT_API_URL`, `UNICHAT_DEPLOYMENT_ID` (mặc định `default`). Client id **một** `uniwork-chat-desktop`; `dev` dùng redirect `uniworkchat-dev://auth/callback`, còn lại `uniworkchat://auth/callback` (khớp `DESKTOP_AUTH_CLIENTS` ở `.env.example` dòng 83 và `deploy/app/env/uniwork-be.env`). `electron.vite.config.ts` `define` thay `process.env.UNICHAT_*` lúc build nên dev và packaged cùng một đường mã; dev mặc định `http://localhost:3000` / `http://localhost:8080`.
- `openExternal`: chỉ `https:`; `http:` loopback khi `UNICHAT_ENV=dev`. `will-navigate` chỉ cho origin `appUrl` và `apiUrl`; `setWindowOpenHandler` → `deny` + `openExternalSafely`.
- Deep link: desktop chỉ nhận `uniworkchat(-dev)://open?url=<path percent-encoded>`; `https://` để D2. Hàng đợi tới khi renderer gửi `link:ready`.
- Refresh token: `safeStorage` vào `userData/unichat-auth/session.bin` (atomic temp+fsync+rename); Linux không keyring (`basic_text`) → từ chối đăng nhập với log, **không** fallback mã hoá yếu (đổi so với spec §5, theo Office).
- `/auth/desktop/refresh` gửi `X-UniWork-Device: <device_session_id>`; 429 `rate_limited` → chờ `Retry-After` (cap 60 s) rồi thử lại, không đăng xuất; `device_revoked`/`refresh_reused`/401 từ server → xoá credential, `onChange(null)`.
- Repo: `apps/chat-desktop/package.json` dùng `catalog:` cho electron/electron-vite/electron-builder/typescript/vitest/@types/node/@vitest/coverage-v8 (thêm electron* vào `pnpm-workspace.yaml` catalog); root `package.json` `pnpm.onlyBuiltDependencies` thêm `"electron"`; `knip.json` thêm block `apps/chat-desktop` với `entry` main/preload/config; vitest `coverageThresholds` số nguyên (đo lần đầu rồi đặt); file ≤ 500 dòng; `pnpm knip`, `node --test scripts/` xanh; root `CLAUDE.md` › Project Shape thêm dòng `apps/chat-desktop/` **cùng commit** tạo thư mục (governance kiểm path tồn tại).
- Output build vào `dist/` (turbo `outputs` đã có `dist/**`); `electron.vite.config.ts` đặt `build.outDir` cho main/preload.
- Comment tiếng Anh; không ghi body token/URL callback vào log.

## Quyết định builder (spec §6 và câu hỏi mở)

| Mục | Chọn | Lý do |
|---|---|---|
| `login()` | Thêm `login(): Promise<void>` vào `SessionProvider` (core) ; trang `/login` của web trong host UniChat render `UniChatLoginGate` (gọi `session.login()` khi mount, nút thử lại) | Client-side routing của Next không bắn `will-navigate`, shell không chặn `/login` được; đây là đường duy nhất để web khởi động PKCE |
| Client id | `uniwork-chat-desktop` cho mọi env; dev khác redirect | Server N1 chỉ có client này với hai redirect |
| Cấu hình | `process.env.UNICHAT_*` thay lúc build qua `define` | Một đường mã, không file `desktop.json` |
| `credentials.ts` | Giữ module riêng + 15 test của Office | Trần 500 dòng, test copy nguyên |
| Updater | Không trong D1 | Chưa có kênh phát hành/ký (D2) |
| `downloadURL(url, name?)` | Bỏ qua `name` (comment `shortcut:`) | `webContents.downloadURL` không đặt tên; cần `will-download` sau |
| Badge Windows | `app.setBadgeCount` mac/linux; Windows `win.setOverlayIcon` chấm đỏ 16×16 từ data URL inline, không số | Không cần asset, đủ cho pilot |
| Chia sẻ màn hình | `setDisplayMediaRequestHandler`: macOS ≥ 15 `useSystemPicker: true`; nơi khác nguồn màn hình đầu tiên (`shortcut:` picker ở D2) | Nhỏ nhất chạy được |
| `window-state` | `userData/window-state.json` | Mặc định usf |
| Dev app name | `app.setName("UniChat Dev")` + `userData` riêng khi `UNICHAT_ENV=dev` trước `requestSingleInstanceLock` | Tránh trộn phiên với bản cài |

## Review Focus

1. Callback có `state` sai, hết hạn, thiếu `code`, scheme lạ → không gọi exchange, attempt còn sống (trừ hết hạn) — `auth/callback.test.ts`, `auth/session.test.ts`.
2. Refresh song song → một request; token xoay vòng persist **trước** khi adopt; 429 chờ rồi thử lại không `onChange(null)` — `auth/session.test.ts`.
3. IPC từ frame origin lạ hoặc payload > 64 KiB → từ chối, không gọi handler — `ipc/schema.test.ts`.
4. `preload.test.ts`: bề mặt `desktopAPI` đúng tập khoá của `DesktopBridge` (kể cả `session.login`), không khoá nào có "refresh" trong tên, không `ipcRenderer` lộ.
5. Deep link đến trước khi renderer sẵn sàng → giữ, phát một lần sau `link:ready`; cold start argv Windows/Linux và `open-url` macOS đều vào cùng hàng đợi — `deep-link.test.ts`.
6. `renderer-web-preferences.test.ts`: ba cờ đúng, không có khoá `webSecurity`.
7. Web: host UniChat + anon → `/login` không render form, gọi `session.login()` một lần; host web → form như cũ — `apps/web/platform/unichat-login-gate.test.tsx`.

---

### Task 1: Scaffold workspace, cấu hình, `runtime-config`, `renderer-web-preferences`

**Files:**
- Create: `apps/chat-desktop/{package.json,electron.vite.config.ts,tsconfig.json,eslint.config.mjs,vitest.config.ts,CLAUDE.md}`
- Create: `apps/chat-desktop/src/main/runtime-config.ts` (+ `.test.ts`), `apps/chat-desktop/src/main/renderer-web-preferences.ts` (+ `.test.ts`), `apps/chat-desktop/src/shared/bridge.ts`
- Modify: `pnpm-workspace.yaml` (catalog: `electron: ^43.7.6`, `electron-vite: ^5.0.0`, `electron-builder: ^26.0.12`), root `package.json` (`onlyBuiltDependencies` + `electron`), `knip.json` (block `apps/chat-desktop`), root `CLAUDE.md` (Project Shape: một dòng `apps/chat-desktop/`), `.env.example` (mục `# UniChat desktop shell (build-time)` với 4 biến comment)

**Interfaces:**
- `package.json`: `name @uniwork/chat-desktop`, `private`, `main dist/main/index.js`, scripts `dev: electron-vite dev`, `build: electron-vite build`, `typecheck: tsc --noEmit`, `lint: eslint . --max-warnings 0`, `test: vitest run --passWithNoTests=false --coverage`; deps `@uniwork/core workspace:*` (chỉ kiểu); devDeps electron/electron-vite/electron-builder/typescript/vitest/@vitest/coverage-v8/@types/node `catalog:`, `@uniwork/eslint-config`, `@uniwork/tsconfig` `workspace:*`.
- `eslint.config.mjs`: `@uniwork/eslint-config/base` + rule `no-restricted-syntax` cấm `shell.openExternal` / `webContents.downloadURL` ngoài `src/main/external-url.ts` (copy từ usf `apps/desktop/eslint.config.mjs` dòng 13–43, đổi đường dẫn), ignores `dist/`, `coverage/`; nếu `import-x/no-extraneous-dependencies` báo `electron` (devDependency) thì cho `src/main/**`, `src/preload/**` vào `devDependencies` allowlist của rule trong file này.
- `tsconfig.json`: `extends @uniwork/tsconfig/base.json`, `types: ["node"]`, `noEmit`, `include: ["electron.vite.config.ts","src/**/*"]`.
- `electron.vite.config.ts`: `main: { build: { outDir: "dist/main" }, plugins: [externalizeDepsPlugin()] }`, `preload: { build: { outDir: "dist/preload", lib: { formats: ["cjs"] } }, plugins: [externalizeDepsPlugin()] }`, `define` cho 4 biến `UNICHAT_*` (giá trị `process.env.X ?? default-dev`).
- `runtime-config.ts`: `export interface ShellConfig { env: "dev"|"staging"|"prod"; appUrl: string; apiUrl: string; deploymentId: string; clientId: "uniwork-chat-desktop"; scheme: "uniworkchat"|"uniworkchat-dev"; redirectUri: string }`; `export function resolveShellConfig(env: Record<string,string|undefined>): ShellConfig` (normalize origin http/https, bỏ path/query/hash, trim `/`; `env` lạ → `prod`; URL sai → throw). Test: mặc định dev, prod đọc env, URL hỏng ném, scheme theo env.
- `renderer-web-preferences.ts`: `createRendererWebPreferences(preloadPath): WebPreferences` = `{ preload, sandbox: true, contextIsolation: true, nodeIntegration: false }`.
- `src/shared/bridge.ts`: `export type { DesktopBridge, SessionProvider } from "@uniwork/core/platform";` (core được transpile bởi app như apps/web; chỉ kiểu nên không kéo runtime).

- [ ] **Step 1**: Test `runtime-config.test.ts`, `renderer-web-preferences.test.ts` (đỏ: module chưa có).
- [ ] **Step 2**: Tạo scaffold + hai module; `pnpm install` (lockfile cập nhật, electron tải binary); `pnpm --filter @uniwork/chat-desktop test|typecheck|lint`; `pnpm knip`; `node --test scripts/governance.test.mjs scripts/no-usf-leak.test.mjs scripts/catalog-check.test.mjs`.
- [ ] **Step 3**: `vitest.config.ts` đặt thresholds theo lần đo đầu (làm tròn xuống).

### Task 2: Module main thuần: guard, external-url, window-state, deep-link, IPC schema

**Files:** `apps/chat-desktop/src/main/{navigation-guard,external-url,window-state,deep-link}.ts` (+ `.test.ts` mỗi file), `apps/chat-desktop/src/main/ipc/schema.ts` (+ `.test.ts`)

**Interfaces:**
- `navigation-guard.ts` (usf): `installNavigationGuard(win, trustedOrigins: string[])`, `isTrustedNavigation(url, trustedOrigins)`; bỏ nhánh `file:`; `javascript:`/`file:`/origin lạ → `preventDefault` + log origin.
- `external-url.ts` (usf): `isSafeExternalUrl(url, { allowHttpLoopback })`, `openExternalSafely(url, opts)`, `downloadURLSafely(win, url)`; chỉ `https:` (+ `http:` loopback khi dev).
- `window-state.ts` (usf nguyên văn, bỏ tham chiếu issue #5244).
- `deep-link.ts`: `parseDeepLink(url, scheme): string | null` (`<scheme>://open?url=<p>` → `sanitize(p)`: bắt đầu `/`, không `//`, không `\`); `MainRendererQueue` (copy `MainRendererMessageQueue` usf, kênh `["link:deep-link"]`), `extractDeepLinkFromArgv(argv, scheme)`.
- `ipc/schema.ts`: `MAX_IPC_BYTES = 65536`; `isTrustedSender(event, appOrigin)`; validators `expectString(v, max?)`, `expectUrl(v)`, `expectCount(v)`; `IpcRejected` error; `guard(appOrigin, validate, handler)` bọc `ipcMain.handle`.

- [ ] Test trước (copy test usf, đổi tên/host, thêm case `javascript:`), rồi cài đặt; `pnpm --filter @uniwork/chat-desktop test lint typecheck`.

### Task 3: Auth PKCE ở main

**Files:** `apps/chat-desktop/src/main/auth/{pkce,callback,transport,credentials,session}.ts` (+ `.test.ts`), `apps/chat-desktop/src/main/auth/fakes.ts` (test helper, chỉ test import)

**Interfaces:**
- `pkce.ts`: copy Office (verifier/challenge/`LoginAttemptStore`).
- `callback.ts`: `isAuthCallbackUrl(url, scheme)` (`<scheme>://auth/callback`), `validateCallback(url, attempt, now)` (8 lý do từ chối, so `state` constant-time), `extractAuthCallbackFromArgv`, `createAuthCallbackRouter(argv, scheme)` (giữ tới `start`).
- `transport.ts`: 4 route `/api/v1/auth/desktop/{start,exchange,refresh,logout}`; `X-UniWork-Device` ở refresh; `TransportError{code,status,fromServer,retryAfterMs?}` đọc `Retry-After`; `redirect: "error"`, `cache: "no-store"`, timeout 15 s; `isAllowedOrigin`.
- `credentials.ts`: copy Office (`safeStorage` envelope v1, `keystore_locked`/`keyring_unavailable`/`io`, atomic write, `createMemoryCredentialStore`).
- `session.ts`: `class ShellSession` trạng thái `signed-out|signing-in|signed-in|refreshing|server-unreachable`; `login()`, `completeCallback(url)`, `getAccessToken()`, `refresh()` single-flight, `logout()`, `onChange(cb)`; proactive refresh 80 %, skew 30 s, backoff 5 s→5 min; 429 chờ `retryAfterMs` (cap 60 s); `deviceInfo` label `UniChat (macOS|Windows|Linux)`.

- [ ] Test: copy các case Office liệt kê ở map (callback 133 dòng; transport 55–305; credentials 15 case; manager các dòng 208, 261, 274, 295, 305, 313, 780, 804, 1045, 1061, 1071, 1333, 1349, 1362, 1370, 1397, 1418 viết lại theo state nhỏ) + 2 case mới (`X-UniWork-Device`, 429 Retry-After). Rồi cài đặt; mỗi file ≤ 500 dòng.

### Task 4: Preload, IPC handlers, `index.ts`, offline, screen-share

**Files:** `apps/chat-desktop/src/preload/index.ts` (+ `preload.test.ts`), `apps/chat-desktop/src/main/ipc/handlers.ts` (+ `.test.ts`), `apps/chat-desktop/src/main/index.ts`, `apps/chat-desktop/src/main/{offline,screen-share,badge}.ts` (+ test cho `badge`), `apps/chat-desktop/resources/offline.html`, `apps/chat-desktop/electron-builder.yml`, `apps/chat-desktop/build/entitlements.mac.plist`

**Interfaces:**
- Preload: `const api = { app: "unichat", appInfo: ipcRenderer.sendSync("app:info"), session: { login, getAccessToken, refresh, logout, onChange }, setBadgeCount, isFocused, onFocusChange, focusWindow, openExternal, downloadURL, onDeepLink } satisfies DesktopBridge; contextBridge.exposeInMainWorld("desktopAPI", api)`; `onDeepLink` gửi `link:ready` true/false khi đăng ký/huỷ; `onChange` nhận `session:changed` (token|null). Không `contextIsolated` → throw.
- `ipc/handlers.ts`: `registerIpc({ session, win, config })` đăng ký mọi kênh qua `guard` của schema; `app:set-badge` → `badge.ts`; `app:is-focused` → `win.isFocused()`; `app:focus-window` → `restore/show/focus`; `shell:open-external` → `openExternalSafely`; `shell:download-url` → `downloadURLSafely`; `session:*` → `ShellSession`; main → renderer: `session:changed`, `app:focus-changed` (từ `focus`/`blur` của cửa sổ), `link:deep-link` qua hàng đợi.
- `index.ts`: `resolveShellConfig(process.env)`; dev: `app.setName("UniChat Dev")`, `userData` riêng; `requestSingleInstanceLock(lockData)`; `setAsDefaultProtocolClient(scheme[, execPath, [appPath]])`; `app.setAppUserModelId("com.uniworkos.chat")`; `open-url`/`second-instance`/argv cold start → router: callback auth → `session.completeCallback`, `open?url=` → hàng đợi deep link; `BrowserWindow` với `resolveWindowOptions` + `createRendererWebPreferences`; `installNavigationGuard(win, [appOrigin, apiOrigin])`; `setWindowOpenHandler`; `session.defaultSession.setPermissionRequestHandler` (cho `media`, `display-capture`, `notifications`); `setDisplayMediaRequestHandler`; `did-fail-load` → `loadFile(offline.html)` + thử lại 5 s/`online`; `loadURL(appUrl)`; lưu window-state khi `close`.
- `electron-builder.yml`: `appId com.uniworkos.chat`, `productName UniChat`, `protocols: [{ name: UniChat, schemes: [uniworkchat] }]`, mac dmg+zip (`notarize: false`), win nsis, linux AppImage+deb, `files: ["dist/**", "resources/**", "package.json"]`, `asarUnpack: resources/**`, không `publish`.

- [ ] Test: `preload.test.ts` (mock `electron` `contextBridge`/`ipcRenderer`, kiểm tập khoá, không khoá chứa "refresh", `login` tồn tại); `handlers.test.ts` (sender lạ bị từ chối, badge clamp, deep link phát sau ready); `badge.test.ts`. `index.ts` không test đơn vị (wiring) — smoke tay ghi checklist trong issue.
- [ ] `pnpm --filter @uniwork/chat-desktop build` tạo `dist/main/index.js`, `dist/preload/index.js` (CJS, một tệp).

### Task 5: Web phía host: `login()` trong bridge, cổng đăng nhập UniChat, copy consent

**Files:**
- Modify: `packages/core/platform/desktop-bridge.ts` (`SessionProvider.login(): Promise<void>`), `packages/core/auth/session-provider.test.ts` và `apps/web/platform/desktop-host.test.tsx`, `e2e/unichat-shell.spec.ts` (fake bridge thêm `login`)
- Create: `apps/web/platform/unichat-login-gate.tsx` (+ `.test.tsx`): `UniChatLoginGate` gọi `getDesktopBridge()!.session.login()` một lần khi mount, hiện tiêu đề + nút "Mở trình duyệt để đăng nhập" (i18n `auth.desktop.unichat_login_title`, `auth.desktop.unichat_login_button`, `auth.desktop.unichat_login_hint` — thêm vi trước rồi en; `pnpm --filter @uniwork/core test -- i18n/parity`)
- Modify: `apps/web/app/(auth)/login/page.tsx`: `useIsUniChatHost()` → render gate thay form (đọc file trước; giữ phần còn lại y nguyên)
- Modify: `packages/views/auth/desktop-consent.tsx` (map `client_id` → tên: `uniwork-office*` → "UniWork Office", `uniwork-chat-*` → "UniChat", khác → id thô; ba key `auth.desktop.title|approved|openDesktop` nhận `{{app}}`), `packages/core/i18n/locales/{vi,en}.json`, `packages/views/auth/desktop-consent.test.tsx` (kỳ vọng mới + case UniChat)

- [ ] Test trước: `unichat-login-gate.test.tsx` (gọi `login` đúng một lần; nút gọi lại), consent test (tên hiển thị theo client), parity i18n; rồi cài đặt; `pnpm --filter @uniwork/core --filter @uniwork/views --filter @uniwork/web typecheck`, lint file sửa, `pnpm knip`.

### Task 6: Tài liệu, governance, PR

- [ ] Spec D1: `Trạng thái` → in-progress (nhánh), §2 env/client id theo plan, §3.2 câu `desktopAPI.session.login()` khớp Task 5, §3.4 deep link chỉ scheme, §5 Linux từ chối; §6 ghi bảng quyết định.
- [ ] `apps/chat-desktop/CLAUDE.md`: cách chạy (`pnpm --filter @uniwork/web dev` + `UNICHAT_ENV=dev pnpm --filter @uniwork/chat-desktop dev`; server cần `DESKTOP_AUTH_CLIENTS` dòng 83 `.env.example` bật), luật IPC đóng, không `ipcRenderer` thô, không log token.
- [ ] `pnpm typecheck && pnpm lint && pnpm knip`; `node --test scripts/`; vitest 3 gói liên quan; `pnpm --filter @uniwork/chat-desktop build`; e2e `unichat-shell` + `onboarding*` (đổi `login/page.tsx`).
- [ ] Smoke tay (ghi vào issue, không giả vờ): nếu có màn hình — đăng nhập → quay về app; khởi động lại giữ phiên; đăng xuất; badge; banner mất focus. Không có màn hình → ghi rõ chưa làm.
- [ ] `make issue-pr KEY=UNI-1830`.
