# UniChat M1 — Nền app mobile `apps/chat-mobile` (Expo) — Kế hoạch triển khai

> **Trạng thái:** shipped — merge vào develop 2026-10-17 qua PR #337 (squash f24ce4874); issue UNI-1831.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một app Expo riêng (iOS + Android) đăng nhập PKCE qua trình duyệt hệ thống, chọn workspace, giữ một socket realtime sống qua vòng 4001 (token 15 phút hết hạn → refresh → reconnect → replay scope), đăng ký push Expo, parse deep link, có i18n vi/en + theme, bốn tab (Chat · Cuộc gọi · Danh bạ · Cài đặt) ở dạng khung. Màn hình chat thật là M2a.

**Architecture:** Mirror `usf/apps/mobile` (`/Users/ducquang/product/usf`) rồi đổi tên; chỉ import từ `@uniwork/core` các module thuần trong allowlist của `scripts/mobile-core-allowlist.test.mjs` (+ `import type` từ `types/*`), giữ bằng lint `@typescript-eslint/no-restricted-imports` và test fixture. Lớp dữ liệu: `data/auth/*` (port từ `apps/chat-desktop/src/main/auth/*` sang Expo APIs), `data/realtime/ws-client.ts` (usf + scope/replay/4001 từ `packages/core/api/ws-client.ts`), `data/api.ts` (401 → refresh single-flight → retry), `data/secure-storage.ts` + `session-epoch.ts` (usf). Không `.env` (pre-commit từ chối): cấu hình ở `app.config.ts extra` + biến `UNICHAT_*` lúc build, `configureRuntime()` lúc boot.

**Tech Stack:** Expo SDK 57 (`~57.0.26`), RN 0.86.3, React 19.2.3 (đúng catalog), expo-router 57, NativeWind 4 + Tailwind 3.4, TanStack Query, Zustand, expo-secure-store, expo-web-browser, expo-crypto, expo-notifications, NetInfo; vitest env node. Spec §2 ghi "Expo ~55 / RN 0.83" đã lỗi thời — plan này đúng với usf HEAD.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-mobile-foundation-design.md` (+ §3.7 yêu cầu từ khảo sát usf).

## Global Constraints

- **Không copy** từ usf: ranh giới import chỉ bằng quy ước, barrel re-export, `shamefully-hoist`, knip `continue-on-error`, mô hình session trượt 30 ngày (`session-renewal.ts`, `session-activity.ts`), OTP login, agent chat, inbox/issue/project, `.env.*`, patch `expo-modules-core` (M2 nếu cần picker).
- Mọi file copy phải sạch `multica`/`MUL-`/`UniAI` (`scripts/no-usf-leak.test.mjs` grep case-insensitive `apps/**`); ghi nguồn một dòng "Ported from usf apps/mobile/<path>".
- `apps/chat-mobile` **không có script `build`/`package`** nên turbo bỏ qua nó ở `turbo build`; `typecheck`/`lint`/`test` bị lọc `!@uniwork/chat-mobile` ở root `package.json` (`typecheck`, `test`), `scripts/lint-gate.sh`, và **ci.yml** (`pnpm exec turbo build typecheck --filter=!@uniwork/chat-mobile` — governance grep chuỗi này trong ci.yml). Mobile kiểm ở `.github/workflows/mobile-verify.yml` (lọc path `apps/chat-mobile/**`, `packages/core/**`, lockfile/workspace/turbo). Root `.gitignore` dòng `.github/workflows/*` cần thêm `!.github/workflows/mobile-verify.yml`.
- `packages/core/package.json` `exports` thêm 5 subpath allowlist chưa có: `./paths/paths`, `./paths/marketing`, `./permissions/rules`, `./chat/lazy-chat-scopes`, `./chat/chat-room-helpers`; `scripts/mobile-core-allowlist.test.mjs` thêm assertion "mỗi entry có khoá exports" (literal hoặc pattern `/*`).
- `pnpm-workspace.yaml` catalog thêm `expo: "~57.0.26"`, `react-native: "0.86.3"` (mẫu khối electron); app dùng `catalog:` cho react, react-dom, @types/react, typescript, zod, vitest, @vitest/coverage-v8, @tanstack/react-query, zustand, i18next, react-i18next; các gói Expo khác pin trực tiếp trong app. Sau `pnpm install` đọc cảnh báo "Ignored build scripts" và chỉ thêm vào `onlyBuiltDependencies` gói app thật sự cần. Không `.npmrc` hoist; nếu Metro/autolinking kẹt vì layout isolated → **dừng, báo chủ sở hữu** trước khi đổi `node-linker`.
- ESLint: `@uniwork/eslint-config/react` + `@typescript-eslint/no-restricted-imports` (tắt core `no-restricted-imports`, spread `lucideAliasPaths`): cấm `@uniwork/views*`, `@uniwork/ui*`, `next/*`, `@react-navigation/*`, `../../packages/*`; cấm `@uniwork/core` và `@uniwork/core/*` trừ danh sách allowlist (đồng bộ với test) và `@uniwork/core/types/*` với `allowTypeImports`. Fixture test `lib/lint-boundary.test.ts` chạy ESLint API: import cấm đỏ, allowlist xanh, `import type` types xanh.
- vitest env node; `coverage.include` chỉ `lib/**/*.ts`, `data/**/*.ts` (loại `*.tsx`, `realtime-provider`, file chạm `react-native`); thresholds số nguyên từ lần đo đầu (`coverageThresholds`, `vitestPoolOptions` như `apps/chat-desktop/vitest.config.ts`).
- WS: một `WSClient` với `getToken()` đọc lúc connect (mẫu usf), thêm `subscribe/unsubscribe` + replay sau `auth_ack` (bỏ `workspace`/`user`), `onclose(ev)` đọc `ev.code`, `4001` → `onSessionEnded`; `client_platform=mobile`, `client_os` qua option (không import RN trong module test được). Cap 25 scope chat (client), server 50 kể cả scope danh tính. **Test viết trước** (§3.7 spec, Review Focus 1–3).
- Refresh (`data/auth/session.ts`, port `ShellSession` bỏ Electron): single-flight, skew 30 s, header `X-UniWork-Device`, 429 → chờ `Retry-After` (cap 60 s) rồi thử lại một lần, verdict server `unauthorized|device_revoked|refresh_reused|auth_code_invalid` (`fromServer`) → xoá SecureStore + signed-out; 401 trần/mạng/5xx → transient + backoff (giữ phiên). Refresh token xoay vòng ghi SecureStore **trước** khi công bố access token; ghi qua hàng đợi tuần tự + epoch (usf). 4001 khi app ở background → không refresh ngay, để `resume()` xử lý. Chưa làm refresh chủ động 80 % (M2a/M3; ghi §Để sau).
- Phiên lưu một khoá SecureStore `uniwork_chat_session` JSON `{access_token, refresh_token, device_session_id, deployment_id, expires_at, refresh_expires_at}`.
- Không `process.env` trong `data/**`/`lib/**`; chỉ `app.config.ts` đọc `UNICHAT_ENV|UNICHAT_API_URL|UNICHAT_APP_URL`. Client id `uniwork-chat-mobile`; `dev` dùng redirect `uniworkchat-dev://auth/callback`, còn lại `uniworkchat://auth/callback` (server đã cấu hình, `.env.example:83`); `platform=ios|android`, `device_label` tên máy.
- `.env.example`: bật dòng `DESKTOP_AUTH_CLIENTS` (dòng 83) và comment hai biến legacy `DESKTOP_AUTH_CLIENT_ID`/`REDIRECT_URIS` (đặt cả hai là lỗi khởi động) để server dev chấp nhận client mobile/desktop; ghi lý do một dòng.
- Bundle id `com.uniworkos.chat` (prod) / `.dev` / `.staging`; scheme `uniworkchat`/`uniworkchat-dev`; universal links chỉ hoạt động với id prod (AASA/assetlinks của N3) — ghi rõ, không mở rộng web.
- i18n: `scripts/sync-i18n.mjs` sinh `locales/{vi,en}.json` từ `packages/core/i18n/locales` (subtree `auth.desktop`, `common`, `nav`, `chat` tối thiểu M1 cần) + test parity; `DEFAULT_LOCALE="vi"`, device language chỉ chọn giữa vi/en.
- Theme: giá trị HSL copy tay từ `packages/ui/styles/tokens.css` (đọc file trước; nếu tokens là oklch thì convert một lần, ghi nguồn); tên biến giữ `--background/--foreground/--brand…`.
- Icon: dùng `apps/web/public/apple-icon.png` làm placeholder (`shortcut: icon placeholder 180px, thay bằng icon 1024² UniChat ở M4`). Logo: `components/brand/unichat-logo.tsx` text-mark đơn giản, không SVG.
- Push: `data/push.ts` đăng ký khi có `extra.eas.projectId`; thiếu (chưa có EAS, §12 Q8) → bỏ qua + log một lần. Body `{endpoint, keys:{p256dh:"",auth:""}, platform}`.
- Mọi file ≤ 500 dòng; comment tiếng Anh; vi copy theo `docs/conventions.md`.

## Quyết định builder (spec §6 và câu hỏi mở)

| Mục | Chọn | Lý do |
|---|---|---|
| Phiên bản | Expo 57 / RN 0.86.3 / React 19.2.3 | usf HEAD; cùng react với catalog → một react |
| Mô hình socket | Một client + `getToken` + `forceReconnect` sau refresh | Ít socket, replay miễn phí |
| 401 trần khi refresh | Transient (như desktop), không đăng xuất | Captive portal không được xoá phiên; spec §3.3 "401 → đăng xuất" áp cho verdict server |
| 4001 lúc background | Hoãn tới `resume()` | iOS có thể giết request nền |
| Refresh chủ động 80 % | Chưa (M2a) | Reactive đủ cho nền; ghi lại |
| `.env` | Không có; `app.config.ts extra` + `UNICHAT_*` | pre-commit từ chối `.env` |
| `X-Workspace-Slug` | Bỏ | API UniWork scope theo `wsId` trong path |
| `WSMessage` type | Interface 5 dòng trong app | `api/ws-types` không trong allowlist |
| Tab | 4 tab khung; Cài đặt có theme + ngôn ngữ; chưa switch-workspace | Rẻ, tập stores |

## Review Focus

1. Socket `auth_ack` → `subscribe chat r1` → đóng 4001 → `onSessionEnded` 1 lần → refresh → socket mới gửi auth với token mới → sau `auth_ack` gửi lại đúng một `subscribe r1`; `onReconnect` 1 lần — `ws-client.test.ts`.
2. 1006/1012 không gọi `onSessionEnded`, vẫn reconnect jitter — `ws-client.test.ts`.
3. Refresh 429 `Retry-After: 2` → chờ 2 s → thử lại thành công, SecureStore không đổi, không signed-out; 401 `refresh_reused` từ server → SecureStore xoá, signed-out, không thử lại; 401 trần → giữ phiên + backoff — `session.test.ts`.
4. Hai caller cùng lúc (api 401 + ws 4001) → một request refresh — `session.test.ts`.
5. Refresh về sau logout bị bỏ (epoch) — `session.test.ts`.
6. `validateCallback`: state sai/thiếu code/scheme lạ → không exchange — `flow.test.ts`.
7. Lint fixture: `import { useX } from "@uniwork/core/chat"` đỏ, `import { parseWithFallback } from "@uniwork/core/api/schema"` xanh, `import type { User } from "@uniwork/core/types/user"` xanh, `import { x } from "@uniwork/views/..."` đỏ — `lib/lint-boundary.test.ts`.
8. `pnpm --filter @uniwork/chat-mobile typecheck` thấy 5 subpath core qua `exports`; `node --test scripts/mobile-core-allowlist.test.mjs` xanh với assertion exports mới.

---

### Task 1: Nối repo và scaffold workspace

**Files:**
- Create: `apps/chat-mobile/{package.json,app.config.ts,app.config.test.ts,babel.config.js,metro.config.js,tailwind.config.js,global.css,nativewind-env.d.ts,tsconfig.json,eslint.config.mjs,vitest.config.ts,CLAUDE.md,.gitignore,assets/icon.png}`, `apps/chat-mobile/lib/{utils,radius,theme,use-color-scheme}.ts` (+ `radius-tokens.json`), `apps/chat-mobile/lib/lint-boundary.test.ts`, `apps/chat-mobile/scripts/native-run.sh` (+ `.test.sh`)
- Modify: `pnpm-workspace.yaml` (catalog expo/react-native), root `package.json` (filters `typecheck`/`test`; `onlyBuiltDependencies` theo cảnh báo), `scripts/lint-gate.sh` (filter), `.github/workflows/ci.yml` (filter literal), `.gitignore` (negation workflow), `knip.json` (`"apps/chat-mobile": {}` rồi thêm entry nếu knip báo), `packages/core/package.json` (5 exports), `scripts/mobile-core-allowlist.test.mjs` (assertion exports), root `CLAUDE.md` (một dòng `apps/chat-mobile/` dưới chat-desktop; đổi câu "under apps/mobile" → `apps/chat-mobile`), `.env.example` (bật `DESKTOP_AUTH_CLIENTS`), `docs/adr/0011-mobile-la-app-expo-doc-lap.md` (một dòng "Hệ quả": tên thư mục `apps/chat-mobile`, iOS+Android cùng lúc theo spec UniChat §5)
- Create: `.github/workflows/mobile-verify.yml`

- [ ] Test trước: `app.config.test.ts` (tên/bundle/scheme/extra theo env, android package + intentFilters), `lib/lint-boundary.test.ts`, `scripts/native-run.test.sh`; chạy đỏ.
- [ ] Scaffold; `pnpm install` (một lần; đọc "Ignored build scripts"); `pnpm --filter @uniwork/chat-mobile typecheck|lint|test`; `pnpm knip`; `node --test scripts/*.test.mjs` (governance giờ chạy thật ba test ADR 0011); `pnpm typecheck && pnpm lint` root không chạm mobile.
- [ ] Thresholds coverage từ lần đo đầu.

### Task 2: Realtime client với scope/replay/4001 (test trước)

**Files:** `apps/chat-mobile/data/realtime/{ws-client,ws-client.test,realtime-provider,realtime-provider.test,use-chat-scopes,use-chat-scopes.test}.ts(x)`, `apps/chat-mobile/lib/use-ws-subscriptions.ts`, `apps/chat-mobile/data/realtime/ws-types.ts`

- [ ] `ws-client.test.ts`: giữ 4 describe usf (heartbeat, token re-read, frame validation, foreground recovery) + Review Focus 1–2 + unsubscribe khỏi replay + `client_os` từ option + `subscribe_error` đi qua `onAny`.
- [ ] Port + mở rộng ws-client; `realtime-provider` dùng `runtimeConfig().wsUrl`, `workspace_slug=org/ws`, `onSessionEnded` → `session.refresh()` → `forceReconnect()`; AppState/NetInfo như usf; `use-chat-scopes` port từ `packages/core/realtime/use-chat-room-scopes.ts` + `scopes.ts` (ghi nguồn).

### Task 3: Auth PKCE và phiên (test trước)

**Files:** `apps/chat-mobile/data/auth/{pkce,callback,transport,session,flow,store}.ts` (+ `.test.ts`), `apps/chat-mobile/data/{secure-storage,session-epoch,api}.ts` (+ tests), `apps/chat-mobile/data/schemas.ts` (+ test malformed), `apps/chat-mobile/data/queries/workspaces.ts`

- [ ] Tests: Review Focus 3–6; pkce (vector RFC 7636, 43/64 ký tự, base64url tay vì Hermes không có `Buffer`, `digestStringAsync` async); api 401 → refresh → retry một lần → lần hai → `onUnauthorized` một lần; secure-storage ghi tuần tự + commit có điều kiện theo epoch.
- [ ] Port từ `apps/chat-desktop/src/main/auth/{pkce,callback,transport,session}.ts` (bỏ Node `crypto`/`Buffer`/Electron; `expo-crypto`, `WebBrowser.openAuthSessionAsync(authorization_url, redirectUri)` — consent web cần một chạm "Mở UniChat"); `store.ts` từ usf `auth-store.ts` (initialize = restore → refresh → `/me`; login = flow; logout = epoch++ → xoá SecureStore → `POST /auth/desktop/logout` best-effort).

### Task 4: App shell: routes, tabs, i18n, theme, deep link, push

**Files:** `apps/chat-mobile/app/{_layout,index}.tsx`, `app/(auth)/{_layout,login}.tsx`, `app/(app)/{_layout,select-workspace}.tsx`, `app/(app)/[org]/[ws]/_layout.tsx`, `app/(app)/[org]/[ws]/(tabs)/{_layout,chat,calls,contacts,settings}.tsx`, `components/ui/{text,button,card,header,separator,skeleton,icon-button,avatar,switch,radio-group}.tsx` (RNR copy), `components/brand/unichat-logo.tsx`, `components/workspace/workspace-avatar.tsx`, `lib/i18n/*` (+ `singleton.test.ts`, `i18n.test.ts` parity), `scripts/sync-i18n.mjs`, `locales/{vi,en}.json`, `lib/deep-link.ts` (+ test), `data/push.ts` (+ test phần thuần), `data/stores/workspace-store.ts`, `data/query-client.ts`

- [ ] Tests: deep-link parser (`https://<appUrl>/{org}/{ws}/chat?room=&message=` và `uniworkchat://open?url=`; origin lạ → null; `dm` theo parser web nếu có), i18n parity vi/en và với core, push payload thuần.
- [ ] Routes: `_layout` (`configureRuntime()` từ `Constants.expoConfig.extra` trước mọi thứ; providers như usf bỏ Keyboard/Lightbox/SessionActivity; `AuthInitializer` với teardown 401 idempotent; listener notification response → deep link); `index` → login / select-workspace / `/{org}/{ws}/chat`; login một nút + chuỗi `auth.desktop.unichat_login_*`; tabs icon `@expo/vector-icons` (SF symbol chỉ iOS); settings: theme + ngôn ngữ.
- [ ] `pnpm --filter @uniwork/chat-mobile typecheck|lint|test`; `pnpm knip`; `node --test scripts/*.test.mjs`.

### Task 5: Chạy thật và tài liệu

- [ ] `UNICHAT_ENV=dev pnpm --filter @uniwork/chat-mobile exec expo start` khởi động Metro không lỗi (không mở simulator nếu không có người quan sát; ghi rõ). Nếu có simulator iOS: `scripts/native-run.sh ios`, đăng nhập thử, ghi kết quả thật vào issue.
- [ ] Spec M1: `Trạng thái` → in-progress (nhánh), §2 phiên bản Expo 57, §3.3 câu consent "UniWork Office" đã lỗi thời (xoá), §4 dòng "chỉ `paths` là barrel" → "không barrel"; §6 bảng quyết định trên.
- [ ] `apps/chat-mobile/CLAUDE.md`: allowlist + "copy, ghi nguồn", 3 tầng realtime, lệnh, không `.env`, quy tắc LAN IP cho API local.
- [ ] `make issue-pr KEY=UNI-1831`.
