# UniChat N3 — Web host: session provider theo token, layout chỉ Chat, badge/focus/deep link, universal links — Kế hoạch triển khai

> **Trạng thái:** shipped — merge vào develop 2026-10-17 qua PR #333 (squash d4d5aaa31, gộp N1–N3 giai đoạn 1); sửa sau khảo sát usf qua PR #334 (df17638c0); issue UNI-1829.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web app chạy trong shell UniChat (Electron, lát D1) không cần renderer riêng: phiên lấy từ host qua token, layout chỉ Chat, badge/banner theo focus cửa sổ, deep link vào đúng phòng; web phục vụ hai tệp universal links cho mobile. Không có host → mọi đường cookie **y nguyên**, test cũ xanh không sửa.

**Architecture:** Một kiểu bridge chung `DesktopBridge` trong `packages/core/platform/desktop-bridge.ts`; host cắm `bridge.session` vào core qua `registerSessionProvider` (mẫu `registerPushAdapter`). `http.ts` `refreshSession()` rẽ nhánh **bên trong** single-flight; `auth/store.initialize()` lấy token từ provider rồi `GET /api/v1/me`. Nền tảng WS đọc `runtimeConfig().clientPlatform`. Mọi phát hiện host nằm ở `apps/web/platform/desktop-host.tsx` (side effect lúc import + một component null). Chính sách điều hướng chỉ-chat nằm trong `createWebNavigationAdapter` (tham số thứ 4), nên `<AppLink>` và mọi `push()` trong views tự đi đúng đường.

**Tech Stack:** TypeScript strict, React 19 (`useSyncExternalStore`), vitest/jsdom, Next 16 route handlers. Không Go, không migration, không đổi catalogue.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-web-host-design.md` (cha: `2026-10-16-chat-native-apps-design.md` §3.2, §6 D2–D3, M1).

## Global Constraints

- Không provider → `http.ts`, `auth/store.ts`, `ws-client.ts`, `realtime/provider.tsx` giữ hành vi cũ từng byte; các test `packages/core/api/http.test.ts`, `auth/store.test.ts`, `api/ws-client.test.ts`, `realtime/provider.test.tsx` **không sửa case cũ** (chỉ thêm case; `store.test.ts` được thêm `me: vi.fn()` vào factory mock).
- Provider chỉ trả **access token**; refresh token không bao giờ tới web. Token vẫn chỉ sống trong `packages/core/api/session.ts`; provider đổ vào qua `setAccessToken` để `subscribeToToken` (store rớt về anon, WSProvider dựng lại socket) chạy như cũ.
- Đăng ký provider phải **đồng bộ lúc import** (`AuthInitializer` là con đầu tiên của `CoreProvider`, effect của nó chạy trước mọi effect trong `children`).
- Lint: core không `process.env` (trừ `platform/**`), không `localStorage`; views không `next/*`, không `window.location`, mọi JSX text qua `t()`; `no-floating-promises` → `void bridge.x()`; `max-lines` 500 — `chat-page-content.tsx` đang 499 dòng nên **không chạm file nào trong `packages/views/chat/`**.
- knip: mọi export mới phải có người import trong cùng lát. governance: không tạo thư mục mới dưới `packages/core/` (dùng `platform/`, `auth/`).
- Env: `UNICHAT_IOS_TEAM_ID`, `UNICHAT_ANDROID_SHA256` đọc **chỉ** trong `apps/web/platform/well-known.ts` (server-side runtime, không `NEXT_PUBLIC_`); liệt kê trong `.env.example` mục Frontend và `docker-compose.prod.yml` → `web.environment`.
- Test apps/web chỉ được thu thập dưới `platform/**`, `features/**`; route handler là một dòng gọi hàm trong `platform/`.
- i18n: không thêm key mới (tái dùng `WorkspaceSwitcher` và menu tài khoản của `AppSidebar`).
- Sau khi đổi `apps/web/platform/application-providers.tsx` (root provider) chạy e2e hai lần.

## Quyết định builder (spec §6)

| Mục | Chọn | Lý do |
|---|---|---|
| Hình dạng provider | `SessionProvider = DesktopBridge["session"]` = `{ getAccessToken(): Promise<string\|null>; refresh(): Promise<string\|null>; logout(): Promise<void>; onChange(cb: (t: string\|null) => void): () => void }` | Khớp `SessionCore.getAccessToken/refresh` của uniwork-office mà D1 sẽ bọc |
| `refreshSession()` trả gì ở chế độ provider | `{ access_token, user: null }`; kiểu trả nới thành `{ access_token: string; user: User \| null } \| null` | `request/requestText/requestDownload` chỉ xét truthiness; store không gọi `refreshSession` ở chế độ provider; không đổi test cũ |
| `variant` | Prop `variant?: "full" \| "chat-only"` trên `DashboardLayout` → truyền vào `AppSidebar` | Chỉ một component cần biết; không context, không store |
| Vị trí WorkspaceSwitcher | Giữ trong `AppSidebar`; chat-only bỏ nhóm nav module + pins, giữ header (switcher) + footer (menu tài khoản: cài đặt, đăng xuất) | `chat-page-content.tsx` hết chỗ (499/500); switcher + đăng xuất ở một cột gọn kiểu Telegram; `SidebarTrigger` ở top bar vẫn có nghĩa |
| Công thức badge | `useChatUnreadBadge(wsId)` (phòng mute chỉ tính mention) | Đúng công thức sidebar/tiêu đề tab đang dùng; spec gọi `unreadMapFromRooms` nhưng hàm đó không xử lý mute |
| `platform` của WS | `RuntimeConfig.clientPlatform` (mặc định `"web"`), host gọi `configureRuntime({ clientPlatform: "desktop" })` | Ít mã nhất, đã có `resetRuntimeConfig` cho test; áp cho cả lobby socket |
| Allowlist trong shell | `isGlobalPath(path)` (login, auth, invite, workspaces, onboarding, verify, …) + `/{org}/{ws}/chat*`; `/{org}/{ws}` và `/{org}/{ws}/tasks` **viết lại** thành `/{org}/{ws}/chat` | Mọi điểm đáp sau đăng nhập/chuyển workspace là `.tasks()`; đọc theo spec chữ nghĩa thì shell kẹt ở `/login` |
| Office frame trong UniChat | Mở ngoài | `/{org}/{ws}/documents/*` không nằm trong allowlist nên tự ra ngoài, không đổi gì |
| `detectClientType`/`detectShortcutRuntime` | Không đổi | Vẫn đúng khi có `window.desktopAPI` |

## Review Focus

1. Không provider → `fetch.mock.calls` của test refresh cũ y nguyên (URL `/api/v1/auth/refresh`, retry mang `tok-2`) — Task 2 chạy toàn bộ `http.test.ts`, `store.test.ts` không sửa case cũ.
2. Provider `refresh()` ném lỗi hoặc trả `null` → token xoá (`getAccessToken() === null`), `request()` không retry, store rớt anon — Task 2 test.
3. Hai request 401 cùng lúc → `provider.refresh` gọi **một** lần (single-flight giữ nguyên) — Task 2 test.
4. Host web: `useHostFocus()` đọc `document.visibilityState` **mỗi lần render** (test cũ đặt `visibilityState` bằng `defineProperty` không bắn event) — Task 4 chạy 4 test cũ của `workspace-chat-attention.test.tsx` không sửa.
5. Deep link `https://evil.example/acme/team/chat` và `uniworkchat://open?url=//evil` → bỏ; `uniworkchat://open?url=/acme/team/chat?room=r1` → `push("/acme/team/chat?room=r1")` — Task 5 test parser.
6. Thiếu env → `/.well-known/*` trả 404 không body; có env → JSON đúng khuôn, `Content-Type: application/json` — Task 6 test.
7. `variant` không truyền → `AppSidebar` đầy đủ như cũ (`app-sidebar.test.tsx` cũ xanh) — Task 3.

---

### Task 1: Kiểu bridge chung + session provider + `clientPlatform`

**Files:**
- Create: `packages/core/platform/desktop-bridge.ts`
- Create: `packages/core/platform/desktop-bridge.test.ts`
- Modify: `packages/core/platform/index.ts` (export `DesktopBridge`, `SessionProvider`, `getDesktopBridge`)
- Create: `packages/core/auth/session-provider.ts`
- Modify: `packages/core/auth/index.ts` (export `registerSessionProvider`, `getSessionProvider`)
- Modify: `packages/core/runtime-config.ts` (`clientPlatform: string`, mặc định `"web"`)
- Modify: `packages/views/editor/use-download-attachment.ts` (bỏ interface cục bộ, `import type { DesktopBridge } from "@uniwork/core/platform"`; giữ cast `window.desktopAPI` và hành vi)

**Interfaces:**
- `desktop-bridge.ts`:
  ```ts
  export interface DesktopBridge {
    app: "unichat";
    appInfo: { version: string; os: "macos" | "windows" | "linux" | "unknown" };
    session: SessionProvider;
    setBadgeCount(count: number): void;
    isFocused(): Promise<boolean>;
    onFocusChange(cb: (focused: boolean) => void): () => void;
    focusWindow(): void;
    openExternal(url: string): Promise<void>;
    downloadURL(url: string, name?: string): Promise<void>;
    onDeepLink(cb: (url: string) => void): () => void;
  }
  export interface SessionProvider { getAccessToken(): Promise<string | null>; refresh(): Promise<string | null>; logout(): Promise<void>; onChange(cb: (token: string | null) => void): () => void }
  /** The UniChat bridge when this page runs inside it; null on web and during SSR. */
  export function getDesktopBridge(): DesktopBridge | null  // (window as { desktopAPI?: Partial<DesktopBridge> }).desktopAPI?.app === "unichat" ? bridge : null
  ```
  Ghi chú D1 trong comment đầu file: đây là hợp đồng `window.desktopAPI` mà preload của `apps/chat-desktop` phải expose; mọi `on*` trả hàm huỷ.
- `session-provider.ts` (leaf: chỉ import `setAccessToken` từ `../api/session` và kiểu từ `../platform/desktop-bridge`):
  ```ts
  let provider: SessionProvider | null = null; let unsubscribe: (() => void) | null = null;
  export function registerSessionProvider(p: SessionProvider | null): void  // huỷ đăng ký cũ; p → unsubscribe = p.onChange(setAccessToken)
  export function getSessionProvider(): SessionProvider | null
  ```

- [ ] **Step 1: Test** `desktop-bridge.test.ts`: `getDesktopBridge()` null khi không có `window.desktopAPI`; null khi `desktopAPI.app !== "unichat"`; trả đúng object khi `app === "unichat"`. `session-provider` test (đặt trong `packages/core/auth/session-provider.test.ts`): `registerSessionProvider(p)` gọi `p.onChange` một lần; `onChange` callback → `getAccessToken()` đổi; `registerSessionProvider(null)` gọi hàm huỷ và `getSessionProvider() === null`; đăng ký provider thứ hai huỷ provider thứ nhất.
- [ ] **Step 2: Chạy, mong đợi FAIL**: `pnpm --filter @uniwork/core test -- platform/desktop-bridge auth/session-provider`
- [ ] **Step 3: Cài đặt** theo Interfaces; `runtime-config.ts` thêm `clientPlatform` vào interface, `DEFAULTS` (`"web"`) và chú thích; `use-download-attachment.ts` đổi kiểu.
- [ ] **Step 4: Xanh** + `pnpm --filter @uniwork/views typecheck`.

### Task 2: `http.ts` / `auth/store.ts` / WS identity đi qua provider

**Files:**
- Modify: `packages/core/api/http.ts` (`refreshSession`)
- Modify: `packages/core/auth/store.ts` (`initialize`, `logout`, `resetAuthStoreForTests`)
- Modify: `packages/core/realtime/provider.tsx`, `packages/core/realtime/meeting-lobby-provider.tsx` (`identity: { platform: runtimeConfig().clientPlatform }`)
- Test: `packages/core/api/http.test.ts`, `packages/core/auth/store.test.ts`, `packages/core/api/ws-client.test.ts`, `packages/core/realtime/provider.test.tsx` (chỉ thêm case)

**Interfaces:**
- `http.ts`: `export type RefreshedSession = { access_token: string; user: SessionResponse["user"] | null }`; `refreshInFlight: Promise<RefreshedSession | null>`; `refreshSession(): Promise<RefreshedSession | null>`. Trong IIFE, thay bước lấy token:
  ```ts
  const provider = getSessionProvider();
  const sess: RefreshedSession | null = provider
    ? await provider.refresh().then((t) => (t ? { access_token: t, user: null } : null))
    : parseWithFallback<SessionResponse | null>(await request("/api/v1/auth/refresh", { method: "POST", skipRefresh: true }), SessionResponseSchema, null, { endpoint: "POST /api/v1/auth/refresh" });
  ```
  `tokenBefore/tokenNow`, `setAccessToken`, `catch`, `finally` giữ nguyên.
- `store.ts` `initialize()`: trước `auth.refreshSession()`:
  ```ts
  const provider = getSessionProvider();
  const sess = provider ? await providerSession(provider) : await auth.refreshSession();
  // providerSession: token = await p.getAccessToken(); setAccessToken(token); user = token ? await auth.me() : null; return user ? { user } : null
  ```
  `set(sess?.user ? { user: sess.user, status: "authed" } : { user: null, status: "anon" })`. `logout()`: `clearSession(); const p = getSessionProvider(); if (p) { await p.logout(); setAccessToken(null); } else await auth.logout();`. `resetAuthStoreForTests()` gọi thêm `registerSessionProvider(null)`.

- [ ] **Step 1: Test** (thêm case):
  - `http.test.ts` describe "session provider": 401 → `provider.refresh` gọi 1 lần, không có fetch tới `/api/v1/auth/refresh`, retry mang `Bearer tok-p2`; hai `request()` song song cùng 401 → `refresh` vẫn 1 lần; `refresh` trả `null` → không retry, `getAccessToken() === null`; `refresh` ném → như null. `afterEach` thêm `registerSessionProvider(null)`.
  - `store.test.ts`: factory mock thêm `me: vi.fn()`; case: provider `getAccessToken → "t"`, `me → user` → `status "authed"`, `auth.refreshSession` không gọi; `getAccessToken → null` → anon, `me` không gọi; `logout` → `provider.logout` 1 lần, `auth.logout` không gọi, token null.
  - `ws-client.test.ts`: token mode gửi frame đầu `{type:"auth",payload:{token}}`; `identity.platform` xuất hiện ở `client_platform` trong URL.
  - `provider.test.tsx`: mock `WSClient` ghi `options.identity`; mặc định `"web"`; sau `configureRuntime({ clientPlatform: "desktop" })` → `"desktop"`.
- [ ] **Step 2: Chạy, mong đợi FAIL**: `pnpm --filter @uniwork/core test -- api/http auth/store api/ws-client realtime/provider`
- [ ] **Step 3: Cài đặt** theo Interfaces.
- [ ] **Step 4: Xanh**, kiểm `git diff` của 4 file test chỉ có dòng thêm trong case mới (ngoài factory mock và `afterEach`).

### Task 3: `DashboardLayout` / `AppSidebar` biến thể `chat-only`

**Files:**
- Modify: `packages/views/layout/dashboard-layout.tsx` (`variant?: "full" | "chat-only"` → `<AppSidebar variant={variant} />`)
- Modify: `packages/views/layout/app-sidebar.tsx` (`variant` prop; chat-only: không render `SidebarContent` nhóm nav và `SidebarPins`; header switcher + footer giữ)
- Test: `packages/views/layout/dashboard-layout.test.tsx` (mock `./app-sidebar` ghi props), `packages/views/layout/app-sidebar.test.tsx` (case chat-only)

- [ ] **Step 1: Test**: `dashboard-layout.test.tsx` — mock `AppSidebar` thành `(p) => <div data-testid="app-sidebar" data-variant={p.variant ?? "full"} />`; case mặc định → `full`; `variant="chat-only"` → `chat-only`. `app-sidebar.test.tsx` — `renderSidebar(pathname, { variant: "chat-only" })`: không có link `Công việc`/`Trò chuyện`, vẫn có nút chuyển workspace (tên workspace hiện tại) và menu tài khoản; case cũ không đổi.
- [ ] **Step 2: Chạy, mong đợi FAIL**: `pnpm --filter @uniwork/views test -- layout/dashboard-layout layout/app-sidebar`
- [ ] **Step 3: Cài đặt**.
- [ ] **Step 4: Xanh** + `pnpm --filter @uniwork/views lint`.

### Task 4: `useHostFocus()` và banner theo focus

**Files:**
- Create: `packages/core/platform/host-focus.ts` (+ `host-focus.test.tsx`)
- Modify: `packages/core/platform/index.ts` (export `useHostFocus`)
- Modify: `packages/core/platform/system-notification.ts` (onclick: `getDesktopBridge()?.focusWindow()` cạnh `window.focus()`; sửa luôn comment đầu file đang nhắc `handleInboxNew`/`showNotification` không tồn tại)
- Modify: `packages/views/layout/workspace-chat-attention.tsx` (`const focused = useHostFocus()`; thay `document.visibilityState !== "hidden"` bằng `focused`; thêm vào deps)
- Test: `packages/views/layout/workspace-chat-attention.test.tsx` (thêm case host UniChat)

**Interfaces:**
- `useHostFocus(): boolean` — `useSyncExternalStore(subscribe, getSnapshot, () => true)`. Có bridge: `subscribe` = `bridge.onFocusChange(f => { focused = f; cb() })` + `void bridge.isFocused().then(...)`; `getSnapshot` = biến module `focused` (khởi tạo `true`). Không bridge: `subscribe` = listener `visibilitychange` trên `document`; `getSnapshot` = `document.visibilityState === "visible"` (đọc mỗi render, nên test cũ dùng `defineProperty` không bắn event vẫn đúng).

- [ ] **Step 1: Test**: `host-focus.test.tsx` — không bridge: `visibilityState` hidden → false, bắn `visibilitychange` → cập nhật; có bridge (`vi.stubGlobal("window", …)` hoặc gán `window.desktopAPI`): `isFocused → false` → false dù `visibilityState === "visible"`; `onFocusChange(true)` → true; unmount huỷ đăng ký. `workspace-chat-attention.test.tsx` — case mới: `window.desktopAPI = { app: "unichat", isFocused: async () => false, onFocusChange: () => () => {} }`, `visibilityState` visible → banner vẫn hiện; `isFocused → true` → không banner. 4 case cũ không sửa.
- [ ] **Step 2: Chạy, mong đợi FAIL**: `pnpm --filter @uniwork/core test -- platform/host-focus` và `pnpm --filter @uniwork/views test -- layout/workspace-chat-attention`
- [ ] **Step 3: Cài đặt**.
- [ ] **Step 4: Xanh**.

### Task 5: Host UniChat trong `apps/web/platform`: đăng ký, điều hướng chỉ-chat, badge, deep link

**Files:**
- Create: `apps/web/platform/chat-only-navigation.ts` (+ `.test.ts`): thuần TS
- Modify: `apps/web/platform/web-navigation-adapter.ts` (tham số thứ 4 `host?: HostNavigationPolicy`)
- Modify: `apps/web/platform/navigation.tsx` (truyền policy khi có bridge)
- Test: `apps/web/platform/navigation.test.ts` (case chat-only)
- Create: `apps/web/platform/desktop-host.tsx` (+ `desktop-host.test.tsx`)
- Modify: `apps/web/platform/application-providers.tsx` (`import "./desktop-host"` cạnh `./runtime-config`; `<DesktopHost />` ngay trong `WebNavigationProvider`)
- Modify: `apps/web/app/[orgSlug]/[workspaceSlug]/layout.tsx` (`variant={useIsUniChatHost() ? "chat-only" : "full"}`, `extra={<><Welcome /><UniChatBadge /></>}`)

**Interfaces:**
- `chat-only-navigation.ts`:
  ```ts
  export interface HostNavigationPolicy { resolve(path: string): string | null; openExternal(url: string): void }
  /** In-shell target for a path, or null when the shell must hand it to the browser. */
  export function resolveChatOnlyPath(path: string): string | null
  // isGlobalPath(path) → path; /{org}/{ws}/chat(?|/|$) → path; /{org}/{ws} hoặc /{org}/{ws}/tasks (exact, có thể kèm query) → `/{org}/{ws}/chat`; còn lại → null
  export function parseDeepLink(url: string, appUrl: string): string | null
  // "uniworkchat://open?url=<p>" → sanitizeNextUrl(p); https cùng origin với appUrl → pathname+search (qua sanitizeNextUrl); khác → null
  export function chatOnlyPolicy(bridge: DesktopBridge): HostNavigationPolicy
  // resolve = resolveChatOnlyPath; openExternal = (url) => void bridge.openExternal(url)
  ```
- `web-navigation-adapter.ts`: `createWebNavigationAdapter(router, pathname, searchParams, host?)`; trong `push/replace`: `const target = host ? host.resolve(path) : path; if (target === null) { host.openExternal(runtimeConfig().appUrl + path); return; } guarded(() => router.push(target))`; `openExternal: host?.openExternal ?? ((url) => window.location.assign(url))`.
- `desktop-host.tsx`:
  - Side effect lúc import (guard `typeof window !== "undefined"`): `const bridge = getDesktopBridge(); if (bridge) { registerSessionProvider(bridge.session); configureRuntime({ clientPlatform: "desktop" }); }`
  - `export function useIsUniChatHost(): boolean` — `useSyncExternalStore(noopSubscribe, () => getDesktopBridge() !== null, () => false)` (server snapshot `false` tránh lỗi hydration; `DashboardGuard` đang hiện loading nên không nháy).
  - `export function DesktopHost(): null` — `useNavigation().push`; effect: `bridge.onDeepLink(url => { const p = parseDeepLink(url, runtimeConfig().appUrl); if (p) push(p); })`, trả hàm huỷ. Không bridge → null không effect.
  - `export function UniChatBadge(): null` — `const { workspace } = useWorkspace(); const count = useChatUnreadBadge(workspace.id); useEffect(() => { getDesktopBridge()?.setBadgeCount(count) }, [count])`.

- [ ] **Step 1: Test**:
  - `chat-only-navigation.test.ts`: bảng `resolveChatOnlyPath` (`/login`, `/auth/desktop/authorize?x`, `/invite/abc`, `/workspaces`, `/acme/team/chat`, `/acme/team/chat?room=r1&message=m1` → giữ; `/acme/team`, `/acme/team/tasks`, `/acme/team/tasks?view=board` → `/acme/team/chat`; `/acme/team/tasks/01H…`, `/acme/team/documents/x`, `/admin`? (ghi rõ: `/admin` là global → giữ) → theo bảng); `parseDeepLink` theo Review Focus 5 (thêm `uniworkchat://open` không `url`, `uniworkchat://other?url=/x` → null, `https://app.test/acme/team/chat?room=r1` với `appUrl=https://app.test` → `/acme/team/chat?room=r1`, port/scheme khác → null).
  - `navigation.test.ts`: adapter với `host` giả: `push("/acme/team/tasks/01H")` → `openExternal("http://localhost:3000/acme/team/tasks/01H")`, `router.push` không gọi; `push("/acme/team/tasks")` → `router.push("/acme/team/chat")`; `replace("/login?next=/x")` → `router.replace`; không `host` → case cũ y nguyên.
  - `desktop-host.test.tsx` (mẫu `navigation.notification-click.test.tsx`: mock `next/navigation`, `createRoot` + `act`): gán `window.desktopAPI` giả có `onDeepLink` ghi callback; render `<WebNavigationProvider><DesktopHost /></WebNavigationProvider>`; gọi callback với `uniworkchat://open?url=/acme/team/chat?room=r1` → `router.push("/acme/team/chat?room=r1")`; với `https://evil.example/a` → không gọi. `UniChatBadge`: QueryClient seed `chatKeys.rooms("ws1")` = 2 phòng (unread 2; muted unread 5 mention 1) trong `WorkspaceProvider` → `setBadgeCount(3)`; `setQueryData` phòng đầu `unread_count: 0` → `setBadgeCount(1)`. `useIsUniChatHost`: không bridge → false.
- [ ] **Step 2: Chạy, mong đợi FAIL**: `pnpm --filter @uniwork/web test -- platform/chat-only-navigation platform/navigation platform/desktop-host`
- [ ] **Step 3: Cài đặt** theo Interfaces; `application-providers.tsx` + `layout.tsx`.
- [ ] **Step 4: Xanh** + `pnpm --filter @uniwork/web typecheck lint`.

### Task 6: Universal links `/.well-known/*`

**Files:**
- Create: `apps/web/platform/well-known.ts` (+ `well-known.test.ts`)
- Create: `apps/web/app/.well-known/apple-app-site-association/route.ts`
- Create: `apps/web/app/.well-known/assetlinks.json/route.ts`
- Modify: `.env.example` (mục Frontend: 2 dòng comment + `# UNICHAT_IOS_TEAM_ID=` + `# UNICHAT_ANDROID_SHA256=`), `docker-compose.prod.yml` (`web.environment`: hai biến `${UNICHAT_IOS_TEAM_ID:-}`, `${UNICHAT_ANDROID_SHA256:-}`)

**Interfaces:**
- `well-known.ts` (đọc `process.env` tại đây, lúc gọi — route handler GET là dynamic nên đọc mỗi request):
  ```ts
  export const UNICHAT_IOS_BUNDLE_ID = "com.uniworkos.chat"; export const UNICHAT_ANDROID_PACKAGE = "com.uniworkos.chat";
  export function appleAppSiteAssociation(teamId = process.env.UNICHAT_IOS_TEAM_ID): Response
  // teamId rỗng → new Response(null, { status: 404 }); có → Response.json({ applinks: { details: [{ appIDs: [`${teamId}.com.uniworkos.chat`], components: [{ "/": "/*/*/chat*" }, { "/": "/invite/*" }] }] } })
  export function assetLinks(sha256 = process.env.UNICHAT_ANDROID_SHA256): Response
  // tách theo dấu phẩy, trim, bỏ rỗng; không còn gì → 404; có → Response.json([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "com.uniworkos.chat", sha256_cert_fingerprints: [...] } }])
  ```
- Mỗi `route.ts`: `import { appleAppSiteAssociation } from "../../../platform/well-known"; export function GET() { return appleAppSiteAssociation(); }` (không `"use client"`, không đọc env).

- [ ] **Step 1: Test** `well-known.test.ts`: `vi.stubEnv` từng biến; thiếu → `status 404`, body rỗng; có → `status 200`, `content-type` chứa `application/json`, JSON đúng khuôn (appIDs, components; fingerprints tách phẩy và trim, bỏ phần tử rỗng).
- [ ] **Step 2: Chạy, mong đợi FAIL**: `pnpm --filter @uniwork/web test -- platform/well-known`
- [ ] **Step 3: Cài đặt** + env + compose.
- [ ] **Step 4: Xanh**; `curl -i localhost:3000/.well-known/assetlinks.json` khi app chạy (nếu có) → 404 không env; `node --test scripts/env-example.test.mjs`.

### Task 7: Hoàn tất

- [ ] Cập nhật spec `2026-10-16-unichat-web-host-design.md`: ghi các quyết định ở bảng trên (vị trí switcher, công thức badge, allowlist mở rộng + viết lại `/tasks`) vào §6 và §3.4/§3.5; `Trạng thái` → in-progress (shipped khi merge).
- [ ] Ghi chú cho D1 (UNI-1830) trong spec §3.1: preload phải expose đúng `DesktopBridge`; xếp hàng deep link tới khi renderer đăng ký `onDeepLink`; shell chặn `/login` để chạy PKCE qua trình duyệt hệ thống (web `/login` trong shell không nạp token vào provider).
- [ ] `pnpm typecheck && pnpm lint && pnpm knip`; `pnpm --filter @uniwork/core test`; `pnpm --filter @uniwork/views test -- layout`; `pnpm --filter @uniwork/web test`; `node --test scripts/`; e2e hai lần (đổi root provider).
- [ ] Commit theo task (`feat(core)`, `feat(web)`, `feat(views)`, `docs`), trailer `Refs: UNI-1829` do hook thêm; `make issue-pr KEY=UNI-1829`.
