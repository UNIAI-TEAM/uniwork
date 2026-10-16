# UniChat — Web host: session provider theo token, layout chỉ Chat, badge/focus/deep link, universal links (lát N3)

> **Trạng thái:** in-progress — đang triển khai trên nhánh `feature/UNI-1829-unichat-n3-web-host-session-provider-the`; plan `../plans/2026-10-16-unichat-web-host.md`. Lát N3 của epic UNI-1826; issue UNI-1829.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §3.2, §6 D2–D3, M1 (well-known) · **Vùng:** `packages/core/{auth,api,platform}`, `packages/views/layout/`, `apps/web/platform/`, `apps/web/app/.well-known/`

## 1. Mục tiêu

Web app chạy bên trong shell UniChat mà không có renderer riêng: phiên do host cấp bằng token, giao diện chỉ Chat kiểu Telegram giữ nguyên tính năng gắn công việc, badge và banner theo focus cửa sổ, deep link vào đúng phòng; đồng thời phục vụ hai tệp universal links cho mobile.

## 2. Hiện trạng

- `packages/core/api/http.ts`: `credentials: "include"`, 401 → `refreshSession()` (cookie, single-flight) → retry; `packages/core/auth/store.ts` `initialize()` đổi cookie lấy access token.
- `packages/core/api/ws-client.ts`: đã có chế độ token (`cookieAuth=false` → frame `auth`), `WSClientIdentity{platform, version, os}`, reconnect khi `CloseSessionEnded`.
- `packages/core/analytics/index.ts` `detectClientType()` và `packages/core/shortcuts/platform.ts` nhận Electron qua `window.desktopAPI`; `packages/views/editor/use-download-attachment.ts` khai báo `DesktopBridge` cục bộ với `downloadURL()`.
- `packages/core/platform/system-notification.ts` và `packages/views/layout/workspace-chat-attention.tsx`: banner chỉ khi `visibilityState === "hidden"` và chưa có push subscription.
- `DashboardLayout` (`packages/views/layout/`): gate → `WorkspaceProvider` → `WSProvider` → `AppSidebar` (WorkspaceSwitcher + nav) → nội dung. `NavigationAdapter` có `openExternal?` tùy chọn; `apps/web/platform/navigation.tsx` là bản cài duy nhất.
- `apps/web/app/manifest.ts` là tiền lệ route handler tĩnh; `apps/web/platform` là nơi duy nhất đọc env.

## 3. Thiết kế

### 3.1 Hợp đồng bridge chung
`packages/core/platform/desktop-bridge.ts` khai báo kiểu `DesktopBridge` dùng chung với `apps/chat-desktop` (lát D1): `app: "unichat"`, `appInfo`, `session: {getAccessToken(): Promise<string|null>; refresh(): Promise<string|null>; logout(): Promise<void>; onChange(cb)}`, `setBadgeCount(n)`, `isFocused(): Promise<boolean>`, `onFocusChange(cb)`, `focusWindow()`, `openExternal(url)`, `downloadURL(url, name?)`, `onDeepLink(cb)`; mọi `on*` trả hàm huỷ. Web chỉ đọc nó qua `getDesktopBridge()` (null khi `desktopAPI.app !== "unichat"`, SSR). `use-download-attachment.ts` chuyển sang kiểu này.

Yêu cầu cho D1 (UNI-1830): preload expose đúng object này; **xếp hàng** deep link và `onChange` tới khi renderer đăng ký (renderer đăng ký trong effect, sau khi hydrate); shell chặn điều hướng tới `/login` để chạy PKCE qua trình duyệt hệ thống — trang `/login` của web chạy trong shell không nạp token vào provider, nên lần mở sau `getAccessToken()` sẽ null.

### 3.2 Session provider trong core
`packages/core/auth/session-provider.ts`: `registerSessionProvider(p | null)`. Khi có provider: `http.ts` `refreshSession()` gọi `provider.refresh()` (vẫn single-flight), `setAccessToken`; `auth/store.initialize()` lấy token từ provider rồi `GET /api/v1/me` để điền `user`; `logout` gọi `provider.logout()`; `ws-client` chạy chế độ token với `getAccessToken()`. Không provider → mọi đường cookie **y nguyên** (test cũ phải xanh không sửa). Refresh token không bao giờ tới web: provider chỉ trả access token.

### 3.3 Host detection và điều hướng
`apps/web/platform/desktop-host.tsx` (import trong `ApplicationProviders`, side effect **lúc import** vì `AuthInitializer` là con đầu của `CoreProvider` nên một effect đến sau là quá muộn): nếu `getDesktopBridge()` → `registerSessionProvider(bridge.session)`, `configureRuntime({ clientPlatform: "desktop" })` (hai socket WS đọc `runtimeConfig().clientPlatform`). Component `DesktopHost` (null) nghe deep link; `useIsUniChatHost()` cho layout. `createWebNavigationAdapter` nhận chính sách host (`chat-only-navigation.ts`): `isGlobalPath(path)` (login, auth, invite, workspaces, onboarding, verify, … — rộng hơn ba tiền tố ban đầu vì gate và luồng đăng nhập `replace()` tới chúng) và `/{org}/{ws}/chat*` ở lại; `/{org}/{ws}` và `/{org}/{ws}/tasks` (điểm đáp sau đăng nhập, chọn hoặc đổi workspace) viết lại thành `/{org}/{ws}/chat`; còn lại → `bridge.openExternal(appUrl + path)`. `<AppLink>` gọi cùng `push()` nên đi cùng đường, views không đổi.

### 3.4 Layout chỉ Chat
`DashboardLayout` nhận `variant: "full" | "chat-only"` (web truyền `chat-only` khi host là UniChat) và chuyển cho `AppSidebar`. `chat-only`: `AppSidebar` giữ header (`WorkspaceSwitcher`) và footer (menu tài khoản: cài đặt → mở ngoài, đăng xuất), bỏ nhóm nav module và pins — một cột gọn kiểu Telegram. *Đổi so với đề xuất ban đầu* (switcher trong header của `chat-sidebar.tsx`): `chat-page-content.tsx` đang 499/500 dòng nên không luồn slot qua được, và cột này còn cho chỗ đăng xuất. `NavigationProgress`, `WSProvider`, `WorkspaceChrome`, gate giữ nguyên; trang mặc định của workspace là `/chat` nhờ viết lại ở §3.3. Các dialog/sheet gắn công việc trong `packages/views/chat/` (xem nhanh task, tạo task từ tin, liên kết task, follow-up, kênh Project) không đổi; nút "Mở đầy đủ" của chúng đi qua `push()` nên tự mở ngoài.

### 3.5 Badge, banner, deep link
Badge: `UniChatBadge` trong `apps/web/platform/desktop-host.tsx` (mount qua `extra` của `DashboardLayout`, chỉ khi host là UniChat) dùng `useChatUnreadBadge(wsId)` → `setBadgeCount`. Công thức là của sidebar và tiêu đề tab: phòng mute chỉ tính `mention_unread_count` (`unreadMapFromRooms` không xử lý mute nên không dùng). Banner: `useHostFocus()` trong `packages/core/platform` (bridge → `isFocused`/`onFocusChange`; không bridge → `visibilityState`), `workspace-chat-attention.tsx` dùng nó; bấm banner → `focusWindow()` + điều hướng. Deep link: `onDeepLink(url)` chấp nhận `uniworkchat://open?url=<path>` và `https://<appUrl>/...`; chỉ path cùng origin → `router.push`.

### 3.6 Universal links
`apps/web/app/.well-known/apple-app-site-association/route.ts` trả `{applinks:{details:[{appIDs:["<TEAM>.com.uniworkos.chat"],components:[{"/":"/*/*/chat*"},{"/":"/invite/*"}]}]}}` (JSON, không đuôi); `assetlinks.json/route.ts` trả `[{relation:["delegate_permission/common.handle_all_urls"],target:{namespace:"android_app",package_name:"com.uniworkos.chat",sha256_cert_fingerprints:[...]}}]`. Env `UNICHAT_IOS_TEAM_ID`, `UNICHAT_ANDROID_SHA256` (danh sách phẩy) đọc trong `apps/web/platform`; thiếu → 404; liệt kê trong `.env.example`.

## 4. Tiêu chí hoàn thành và test

| Kiểm | Test |
|---|---|
| Không provider: test cũ xanh không sửa; có provider: 401 → `refresh()` một lần, retry với token mới; refresh null → anon; WS gửi frame token | `packages/core/api/http.test.ts`, `auth/store.test.ts`, `api/ws-client.test.ts` |
| `chat-only`: không nav module, có WorkspaceSwitcher trong sidebar chat; `push("/o/w/tasks")` → `openExternal` tuyệt đối; `full` không đổi | `packages/views/layout/*.test.tsx`, `apps/web/platform/navigation.test.ts` |
| Badge bằng tổng unread không mute; đọc phòng → giảm | test hook với cache giả |
| Mất focus nhưng hiện → banner; có focus → không; host web giữ `visibilityState` | `workspace-chat-attention.test.tsx` |
| Deep link path cùng origin → push; origin lạ → bỏ | test parser |
| `/.well-known/*` đúng khuôn; thiếu env → 404 | test route handler |

Lệnh hẹp: `pnpm --filter @uniwork/core test`; `pnpm --filter @uniwork/views test -- layout`; `pnpm --filter @uniwork/web test`. Sau đổi provider gốc (`apps/web/app/providers.tsx`) chạy e2e hai lần (CLAUDE.md).

## 5. Rủi ro
Chạm đường request của toàn bộ web; giảm nhẹ bằng guard "không provider → không đổi" và test hai chế độ. `credentials: "include"` gửi cookie rỗng trong Electron — vô hại.

## 6. Quyết định của builder
Đã chốt trong plan (`../plans/2026-10-16-unichat-web-host.md` › Quyết định builder): provider = `DesktopBridge["session"]`, `refreshSession()` ở chế độ provider trả `{ access_token, user: null }`; `variant` là prop; `WorkspaceSwitcher` ở lại `AppSidebar` chat-only (§3.4); badge theo `useChatUnreadBadge`; `clientPlatform` qua `RuntimeConfig`; allowlist = `isGlobalPath` + viết lại `/tasks` (§3.3); Office frame mở ngoài (không trong allowlist nên không cần đổi gì).
