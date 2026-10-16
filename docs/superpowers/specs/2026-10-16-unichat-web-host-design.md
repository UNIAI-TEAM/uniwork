# UniChat — Web host: session provider theo token, layout chỉ Chat, badge/focus/deep link, universal links (lát N3)

> **Trạng thái:** in-progress — Đề xuất, chờ duyệt. Lát N3 của epic UNI-1826; issue UNI-1829.

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
`packages/core/platform/desktop-bridge.ts` khai báo kiểu `DesktopBridge` dùng chung với `apps/chat-desktop` (lát D1): `app: "unichat"`, `appInfo`, `session: {getAccessToken(): Promise<string|null>; refresh(): Promise<string|null>; logout(): Promise<void>; onChange(cb)}`, `setBadgeCount(n)`, `isFocused(): Promise<boolean>`, `onFocusChange(cb)`, `focusWindow()`, `openExternal(url)`, `downloadURL(url, name?)`, `onDeepLink(cb)`. `use-download-attachment.ts` chuyển sang kiểu này.

### 3.2 Session provider trong core
`packages/core/auth/session-provider.ts`: `registerSessionProvider(p | null)`. Khi có provider: `http.ts` `refreshSession()` gọi `provider.refresh()` (vẫn single-flight), `setAccessToken`; `auth/store.initialize()` lấy token từ provider rồi `GET /api/v1/me` để điền `user`; `logout` gọi `provider.logout()`; `ws-client` chạy chế độ token với `getAccessToken()`. Không provider → mọi đường cookie **y nguyên** (test cũ phải xanh không sửa). Refresh token không bao giờ tới web: provider chỉ trả access token.

### 3.3 Host detection và điều hướng
`apps/web/platform/desktop-host.tsx` (mount trong `ApplicationProviders`): nếu `window.desktopAPI?.app === "unichat"` → đăng ký provider, đặt `WSClientIdentity.platform = "desktop"`, mount badge/focus/deep link. `WebNavigationProvider`: trong host UniChat, `push()/replace()` tới đường dẫn ngoài `/{org}/{ws}/chat*` (và `/login`, `/auth/*`, `/invite/*` được phép) → `desktopAPI.openExternal(appUrl + path)`; `<AppLink>` đi cùng đường.

### 3.4 Layout chỉ Chat
`DashboardLayout` nhận `variant: "full" | "chat-only"` (web truyền `chat-only` khi host là UniChat). `chat-only`: không `AppSidebar` nav; `WorkspaceSwitcher` nằm ở đầu sidebar chat (`chat-sidebar.tsx` nhận slot `header`); `NavigationProgress`, `WSProvider`, gate giữ nguyên; trang mặc định của workspace là `/chat`. Các dialog/sheet gắn công việc trong `packages/views/chat/` (xem nhanh task, tạo task từ tin, liên kết task, follow-up, kênh Project) không đổi; nút "Mở đầy đủ" của chúng đi qua `push()` nên tự mở ngoài.

### 3.5 Badge, banner, deep link
Badge: hook trong `apps/web/platform` đọc `useChatRooms(wsId)` → tổng `unread_count` phòng không mute (cùng công thức `unreadMapFromRooms`) → `setBadgeCount`. Banner: `useHostFocus()` trong `packages/core/platform` (bridge → `isFocused`/`onFocusChange`; không bridge → `visibilityState`), `workspace-chat-attention.tsx` dùng nó; bấm banner → `focusWindow()` + điều hướng. Deep link: `onDeepLink(url)` chấp nhận `uniworkchat://open?url=<path>` và `https://<appUrl>/...`; chỉ path cùng origin → `router.push`.

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

## 6. Để builder quyết
Hình dạng API provider; `variant` truyền qua prop hay context; vị trí WorkspaceSwitcher trong sidebar chat; có để Office frame (`apps/web/platform/office-frame/`) chạy trong host UniChat hay mở ngoài (đề xuất: mở ngoài).
