# UniChat — Ứng dụng native cho Chat của UniWork (desktop Electron, mobile Expo)

> **Trạng thái:** in-progress — Khảo sát 2026-10-16; mười câu hỏi mở đã chốt cùng chủ sở hữu sản phẩm ngày 2026-10-16 (§12). Chờ duyệt toàn văn để viết plan.

**Ngày:** 2026-10-16
**Issue:** epic **UNI-1826** (Roadmap ID C-19) với 12 sub-issue theo stage: N1 UNI-1827 · N2 UNI-1828 · N3 UNI-1829 · D1 UNI-1830 · M1 UNI-1831 · M2a UNI-1832 · M2b UNI-1833 · M3 UNI-1834 · D2 UNI-1835 · M4 UNI-1836 · L1 UNI-1837 · Q1 UNI-1838 — mỗi lát có spec riêng `2026-10-16-unichat-*-design.md` trong thư mục này (C-08 mobile vẫn là dòng khác, không thay)
**Quyết định nền:** ADR 0011 (mobile là app Expo độc lập; §1 "iOS trước" được nới cho UniChat, xem §5), ADR 0026 (ranh giới Electron main/preload/renderer — deprecated cho Office nhưng luật an toàn vẫn đúng), ADR 0032 (một tài khoản một tổ chức), ADR 0015 (frame realtime chỉ mang id)
**Spec liên quan:** `2026-09-04-mobile-app-design.md` (app UniWork 5 tab, C-08 — UniChat là app khác, dùng chung luật và hạ tầng), `2026-09-04-notifications-design.md` (push, kind chat — §3.4 bổ sung preview và rule bỏ push), `2026-09-09-chat-work-hub-design.md`, `2026-10-05-chat-dod-audit.md` (mục "gỡ route chat cũ chờ mobile")
**Nguồn mirror:** `~/UNICOM/multica` (= `usf` trong ADR 0011; có `apps/mobile` Expo và `apps/desktop` Electron), `~/UNICOM/uniwork-office/apps/shell` (Electron shell + client PKCE `src/main/uniwork-auth/`)

## 1. Ý định và lý do

Chat là bề mặt người dùng mở cả ngày, và một tab trình duyệt không làm được việc của
một ứng dụng chat: không có badge trên dock/taskbar, thông báo mất khi đóng tab, không
có push trên điện thoại, không nhận cuộc gọi khi màn hình khóa. Đội Việt Nam đang sống
trong Zalo; muốn Chat của UniWork thành cửa vào Work OS thì nó phải có mặt ở hai nơi
người ta thực sự nhìn: khay hệ thống và màn hình khóa.

Sản phẩm là **UniChat**: một ứng dụng riêng, trải nghiệm như Telegram (nhanh, hai cột,
chat là trung tâm) nhưng xoay quanh công việc — điểm khác biệt là những tính năng Chat của
UniWork đã có mà Telegram không có: tin nhắn thành task, kênh gắn dự án, follow-up, nhắc
việc, xem nhanh task ngay trong hội thoại, gọi nhóm có ghi âm và tóm tắt. Trang đầy đủ
của task, họp, tài liệu vẫn là web UniWork.

Mục tiêu đo được của đợt này:

- Desktop: tin nhắn, nhắc đến, nhắc việc, cuộc gọi đến hiện thành thông báo hệ điều
  hành và badge số chưa đọc, kể cả khi cửa sổ đang ẩn; mở app rơi đúng phòng.
- Mobile (iOS và Android): nhận push có nội dung cho DM, nhắc đến, trả lời luồng trong vài
  giây; đọc và trả lời được phòng, nhóm, kênh với cùng số đếm chưa đọc như web; điện
  thoại không rung khi đang làm việc trên desktop.
- Không có ngữ nghĩa thứ hai: quyền, enum, số đếm, danh tính dữ liệu bằng web
  (ADR 0011 §4).

## 2. Kết quả khảo sát

| Hạng mục | Hiện trạng | Ý nghĩa cho native |
|---|---|---|
| Bề mặt Chat trên web | `packages/core/api/endpoints/chat*.ts` ≈ 80 hàm, ~3.100 dòng; `packages/core/chat/` 50 module (≈21 thuần, không React/zustand/transport); `packages/views/chat/` > 150 file; `server/internal/service/chat*.go` ~100 file. Tính năng: phòng workspace, DM, nhóm, kênh (gắn Project), luồng, follow-up, liên kết task, file/ảnh/GIF/sticker, tin thoại, gọi thoại/video LiveKit (chia sẻ màn hình, ghi âm, tóm tắt AI), poll, note, post, nhắc, reaction, ghim, biệt danh, chặn, đã đọc, đang gõ, hiện diện, tìm kiếm, CatchUp AI, bảng tin phòng | Desktop tái dùng toàn bộ qua web. Mobile phải chọn lát: không thể port 150 file; cần thứ tự ưu tiên (§6) và một hàng dự phòng cho `kind` chưa hỗ trợ |
| Realtime | `/api/v1/ws` xác thực bằng frame đầu `{"type":"auth","payload":{"token"}}` → `auth_ack`; không cần cookie. Scope `chat:{roomId}` qua `{"type":"subscribe","payload":{"scope":"chat","id"}}` có `subscribe_ack`/`subscribe_error(lookup_failed)`; client tự giới hạn 25 scope chat (`chatScopeSubscriptionLimit`, env `NEXT_PUBLIC_CHAT_SCOPE_LIMIT`), server cap 50 scope mỗi socket mọi loại (`maxScopesPerSocket`); keepalive `{"type":"ping"}`; rate inbound 10/s, burst 60. **Socket bị server đóng khi access token 15 phút hết hạn** (`hub.go` `CloseSessionEnded`), client web refresh rồi reconnect và replay scope (`packages/core/api/ws-client.ts`). Origin trống hoặc trùng host được chấp nhận (ghi rõ "native clients"); `client_platform/version/os` trên query, giá trị tự do | Giao thức đã sẵn cho native. Mobile viết ws-client riêng theo 3 tầng (ADR 0011 §5), gồm refresh + reconnect + replay scope khi socket đóng vì hết hạn token; frame chỉ mang id → fetch theo id rồi vá cache, mirror `packages/core/chat/realtime-cache.ts` |
| Đăng nhập native | `DesktopAuthService` đã có: PKCE public client, `GET /auth/desktop/start` → `authorization_url` (trang `/auth/desktop/authorize?attempt_id` trên web, đăng nhập mọi provider kể cả Google) → callback `scheme://auth/callback?code&state` → `POST /auth/desktop/exchange` → access (15 phút) + refresh xoay vòng có phát hiện reuse → `POST /auth/desktop/refresh`. Nhiều client qua `DESKTOP_AUTH_CLIENTS=client_id=redirect\|redirect,...`; mọi tuyến bắt buộc `deployment_id` thuộc `DESKTOP_AUTH_DEPLOYMENT_IDS`. Quản lý thiết bị: `GET/DELETE /auth/desktop/devices`, `POST /auth/desktop/logout`. Client đã viết sẵn ở `uniwork-office/apps/shell/src/main/uniwork-auth/` (pkce, callback, transport, manager — mã Node) | Cả hai app dùng luồng này (tên "desktop" chỉ là lịch sử). Hai chỗ phải nới: web `isDesktopCallbackUrl` (`apps/web/app/(auth)/auth/desktop/authorize/page.tsx`) chỉ nhận scheme `uniwork-office(-dev):`; server ghi `UserAgent: "uniwork-office/"+platform` cứng. Web app chạy trong Electron cần một **session provider theo token** vì `packages/core/api/http.ts` và `auth/store.ts` hôm nay chỉ biết refresh bằng cookie. Mục "server cần PR nhỏ cho refresh body" trong spec mobile 2026-09-04 đã được giải quyết bằng luồng này |
| Push | Chỉ Web Push (VAPID): `push_subscriptions(endpoint, p256dh, auth NOT NULL)`, `PushSender.Send(ctx, sub, msg)`, `PushMessage{title, url, tag}`, consumer `notification-push` trên lane `push`. Rule chat đã có cho topic outbox `chat.message.mentioned`, `chat.dm.received`, `chat.thread.reply_received` → kind `chat_mentioned`, `chat_dm`, `chat_thread_replied`; mute đọc lúc giao; gộp theo phòng; **không lưu nội dung tin** (tiêu đề chỉ nêu người gửi và phòng). `SubscribePush` trả 404 khi chưa cấu hình VAPID và đòi endpoint `https://` + hai khóa khác rỗng (`notification/service.go`). Web đẩy push bất kể tab có đang mở hay không (`sw.js` không xét focus) | Mobile cần một `PushSender` thứ hai gửi qua Expo Push Service, chọn theo tiền tố `ExponentPushToken[`, và một nhánh đăng ký không đi qua điều kiện VAPID/https/khóa; không cần migration. Preview nội dung và rule bỏ push khi đang hoạt động là hai thay đổi server có chủ đích (§3.4). Desktop không cần push: socket luôn mở |
| Thông báo trên web | `packages/core/platform/system-notification.ts` (`showWebNotification`, chú thích sẵn đường `window.desktopAPI`), `packages/views/layout/workspace-chat-attention.tsx` gọi nó; `detectClientType()` và `shortcuts/platform.ts` đã nhận ra Electron qua `window.desktopAPI`/`window.electron`; `views/editor/use-download-attachment.ts` đã gọi `desktopAPI.downloadURL()` | Mã web đã "biết" có host Electron với bridge `desktopAPI`, và `new Notification()` của renderer trong Electron ra banner hệ điều hành thật. Nhưng `workspace-chat-attention.tsx` chỉ bắn khi `document.visibilityState === "hidden"` và chưa có push subscription; một cửa sổ Electron bị che hay mất focus vẫn là `visible` → desktop cần cổng theo focus cửa sổ (D3) |
| CORS / origin | CORS chỉ `FRONTEND_ORIGIN`; `ALLOWED_ORIGINS` chỉ nới WebSocket (ghi rõ "CORS is not widened") | Electron tải chính web (§3.2) thì origin trùng, không đụng CORS. Một host Electron tự render `views` sẽ phải mở CORS cho scheme riêng — một lý do hoãn phương án đó |
| Mobile | ADR 0011 + spec 2026-09-04: Expo, chỉ import type + pure function từ core, CI riêng. Chưa có app Expo nào trong repo, chưa có guard trong `scripts/governance.test.mjs`. OPEN_QUESTIONS D8 chốt Expo | Spec này không mở lại ADR 0011 (chỉ nới §1 "iOS trước" cho UniChat, §5). `multica/apps/mobile` là nguồn copy lớp hạ tầng (Expo ~55, RN 0.83, Expo Router, NativeWind 4, RNR, TanStack Query, Zustand, expo-secure-store, NetInfo; `data/realtime/ws-client.ts` 398 dòng, `realtime-provider.tsx` 146 dòng, `data/api.ts` fetchValidated). Chat của multica là chat với agent, không phải team chat: chỉ copy hạ tầng, UI chat viết mới. multica mobile đăng nhập bằng email + mã, không có `expo-notifications`, `expo-web-browser`/`expo-auth-session`, LiveKit: PKCE trên React Native và đăng ký push là mã mới |
| Desktop trong họ codebase | `multica/apps/desktop`: electron-vite + electron-builder + electron-updater, renderer là host của `@multica/views` qua react-router-dom, nhưng chạy `webSecurity: false` (nợ họ ghi nhận). `uniwork-office/apps/shell`: Electron 43, electron-vite 5, electron-builder 26, electron-updater 6, có client PKCE và updater. ADR 0026 đặt luật sandbox/contextIsolation/IPC có schema | Electron là lựa chọn có kỹ năng nội bộ và tiền lệ; luật an toàn của ADR 0026 mang sang nguyên |
| Deep link | Phòng đang mở nằm ở `?room=<id>`, tin ở `&message=<id>`, DM ở `?dm=<userId>` (`packages/views/chat/use-chat-*-url.ts`); `paths.workspace(org, ws).chat()` | URL web là hợp đồng deep link cho cả hai app: push gửi `url` web, app tự mở; Universal Links/App Links trên tên miền chính thức, custom scheme chỉ cho auth callback và desktop |
| Nợ chờ native | DoD audit chat: "Gỡ `GET/POST …/chat/room`, `…/chat/messages` — chờ mobile C-08" | Mobile dùng tuyến `rooms/{id}/messages` ngay từ đầu để việc gỡ không bị chặn thêm |

## 3. Quyết định

Những dòng ghi **(chủ sở hữu, 2026-10-16)** đã chốt trong phiên hỏi đáp §12; những dòng
ghi **(người viết)** là lựa chọn của người viết spec, chủ sở hữu đổi được mà không phải
viết lại phần còn lại.

### 3.1 Sản phẩm và danh tính

- **App riêng, không phải app UniWork mở vào Chat** (chủ sở hữu). Tên hiển thị **UniChat**
  (chủ sở hữu). Định danh kỹ thuật theo reverse-DNS của tên miền chính thức
  `uniworkos.com` (chủ sở hữu chọn bộ id này):

| Hạng mục | Giá trị |
|---|---|
| Bundle id iOS = applicationId Android = Electron appId | `com.uniworkos.chat`; dev `com.uniworkos.chat.dev`; staging `com.uniworkos.chat.staging` (cài song song) |
| Deep link chính | `https://app.uniworkos.com/{org}/{ws}/chat?room=…` qua Universal Links (`apple-app-site-association`) và App Links (`assetlinks.json`) do web phục vụ |
| Custom scheme | `uniworkchat://` (dev `uniworkchat-dev://`) — chỉ cho auth callback và desktop. Không dùng `unichat://`: scheme không duy nhất trên hệ điều hành, một app khác cùng tên có thể cướp callback (người viết) |
| Client PKCE | `uniwork-chat-desktop`, `uniwork-chat-mobile` (+ `-dev`); redirect `uniworkchat://auth/callback`; `deployment_id=default` |
| Gói và thư mục | `@uniwork/chat-desktop` → `apps/chat-desktop/`; `@uniwork/chat-mobile` → `apps/chat-mobile/`; `apps/mobile` để dành cho app UniWork C-08 |
| Tệp cài | `UniChat.app`, `UniChat Setup x.y.z.exe`, `unichat_x.y.z_amd64.deb`, `UniChat-x.y.z.AppImage` |
| Tag phát hành | `chat-desktop-v*`, `chat-mobile-v*`; trang tải `uniworkos.com/download` (D6) |

- Tên "UniChat" đang **đông đúc trên App Store** (tra cứu 2026-10-16): "UniChat 4.5: AI Chat
  Bot" (id 6448216007), "UniChat Lingua" — app nhắn tin có dịch tự động, ra 2026-04 (id
  6761389804), "The Uni-Chat" (id 6743700830), và "UnicChat" — messenger doanh nghiệp
  Nga (id 1665533885); không thấy bản Google Play nào tên đúng "UniChat". Apple đòi tên app
  duy nhất theo chuỗi chính xác, chỉ biết chắc khi đặt tên trên App Store Connect; nhãn
  hiệu cần tra riêng. Việc đầu tiên sau khi có tài khoản Apple là giữ tên; nếu không được
  hoặc vướng nhãn hiệu thì dự phòng "UniWork Chat" với cùng id (người viết; §11).
- Khi app UniWork C-08 ra đời nên dùng `com.uniworkos.app` thay cho `vn.unicomhub.uniwork`
  của spec 2026-09-04 để cùng họ (ghi chú, ngoài phạm vi).

### 3.2 Desktop: Electron, pha 1 là vỏ tải chính web app, cửa sổ chỉ Chat

**Electron, không phải Tauri** (người viết). Gọi thoại/video và chia sẻ màn hình cần
Chromium: WKWebView (Tauri trên macOS) không có `getDisplayMedia`, WebKitGTK trên Linux
không ổn định với WebRTC. Đội đã có hai shell Electron (`uniwork-office`, `multica`) và
một ADR về ranh giới an toàn.

**Pha 1 tải chính web app đã deploy** (người viết): `BrowserWindow` mở `${appUrl}` với
`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, preload chỉ lộ
`desktopAPI` đóng (ADR 0026). Không có renderer riêng, không router riêng. Lý do: ít mã
nhất mà đủ "app" (badge, banner, khay, deep link, auto-update vỏ) và không mở lại CORS.
Cái giá: cần mạng để vẽ màn hình đầu (chat vốn cần mạng; có trang offline tĩnh nhỏ), và
mọi deploy web lập tức đến desktop — với chat đây là ưu điểm hơn là rủi ro.

**Cửa sổ chỉ Chat, kiểu Telegram Desktop** (chủ sở hữu): khi web nhận ra host là UniChat
(`desktopAPI.app === "unichat"`), nó vẽ layout gọn — bộ chuyển workspace + sidebar chat +
hội thoại, không có nav module — nhưng **giữ nguyên mọi tính năng gắn công việc đã có
trong chat**: tạo task từ tin, liên kết task, xem nhanh task, follow-up, kênh gắn Project,
nhắc việc, poll, note, post, gọi. Trang đầy đủ của task/họp/tài liệu mở ở trình duyệt hệ
thống. Mở trong cửa sổ phụ của app (mẫu issue-window của multica) là lựa chọn pha 2.

**Đăng nhập qua trình duyệt hệ thống, PKCE, ngay từ đầu** (chủ sở hữu): main process chạy
luồng `DesktopAuthService` (copy `uniwork-office/apps/shell/src/main/uniwork-auth/`,
client `uniwork-chat-desktop`), giữ refresh token trong `safeStorage`; web app trong
Electron chạy **chế độ token**: `packages/core/auth` nhận một session provider do host cắm
(`getAccessToken`, `refresh`, `logout`), `api/http.ts` và `ws-client` dùng nó thay cookie
khi có. Access token nằm trong bộ nhớ renderer như web hôm nay; refresh token không bao
giờ vào renderer. Đúng chính sách Google, cùng một đường với mobile, thiết bị hiện trong
danh sách "thiết bị" của tài khoản. `navigation-guard` chỉ cho `appUrl` và `apiUrl`;
mọi điều hướng khác mở trình duyệt hệ thống.

**Phương án B (renderer là host của `packages/views`, như `multica/apps/desktop`) hoãn**,
chỉ mở lại khi cần vỏ chạy offline hoặc nhịp phát hành desktop tách khỏi web. Khi đó
`CoreProvider`, `NavigationAdapter` (49 dòng ở web), `configureRuntime()` và session
provider của §3.2 đã đủ chỗ cắm; việc mới là CORS cho scheme riêng.

### 3.3 Mobile: Expo theo ADR 0011, app riêng, bốn tab, iOS và Android cùng lúc

`apps/chat-mobile/` là app Expo độc lập theo đúng luật ADR 0011 §2–6 (ranh giới import,
3 tầng realtime, CI riêng, EAS). **Bốn tab từ bản đầu: Chat · Cuộc gọi · Danh bạ · Cài
đặt** (chủ sở hữu) — tab Cuộc gọi ở M2 hiện lịch sử cuộc gọi từ tin call-log đã có, gọi
được từ M3. **iOS và Android cùng lúc từ M1, phát hành cả hai ở M4** (chủ sở hữu; nới ADR
0011 §1, §5). Đăng nhập PKCE qua `expo-web-browser` `openAuthSessionAsync`, token trong
`expo-secure-store`, refresh qua `/auth/desktop/refresh`.

### 3.4 Push: Expo Push Service, có preview nội dung, bỏ push khi đang hoạt động

- Thêm `ExpoPushSender` cài `PushSender`; một sender gộp chọn theo tiền tố endpoint.
  Đăng ký dùng chính `push_subscriptions`: `endpoint` = Expo push token, `p256dh`/`auth`
  rỗng, `user_agent` = `expo/ios` hoặc `expo/android`; nhánh đăng ký đi vòng điều kiện
  VAPID/https/khóa của `SubscribePush`. `DeviceNotRegistered` xử lý như 410. Không
  migration (người viết). Cái giá: phụ thuộc dịch vụ Expo (miễn phí, 600 thông báo/giây);
  đổi sang APNs/FCM trực tiếp là thay một sender, không đổi dữ liệu.
- **Preview nội dung như Telegram/Zalo** (chủ sở hữu): `PushMessage` thêm `body` (đoạn
  đầu tin, cắt ~120 ký tự, không markdown), consumer đọc tin **lúc giao** từ `chat_messages`
  — bảng notification vẫn không lưu nội dung, bất biến của spec notifications giữ nguyên;
  web Service Worker hiện `body` nếu có. Riêng tư: nội dung đi qua Expo rồi APNs/FCM
  (với APNs/FCM là chuẩn ngành; Expo là bên thứ ba thêm — lý do nữa để sender tách
  interface). Tùy chọn tắt preview theo người dùng là pha sau.
- **Bỏ push khi người nhận đang hoạt động trên client khác** (chủ sở hữu): rule trong
  consumer push bỏ qua nếu presence Redis của người nhận (`chat_presence_redis.go`, beat
  15s / TTL 90s) có nhịp trong 120 giây gần nhất. Presence là theo người, không theo thiết
  bị; app mobile ở foreground cũng đập nhịp, khi đó push không cần thiết nên rule không
  làm mất gì. Chỉ nhịp mang `visible: true` mới chặn push (lát N2 §3.5): web gửi
  `document.visibilityState === "visible"`, mobile gửi `AppState === "active"`; nhịp thiếu
  `visible` coi là ẩn.

### 3.5 Gọi thoại/video

Desktop: LiveKit web SDK chạy trong Electron; chia sẻ màn hình cần
`session.setDisplayMediaRequestHandler` + `desktopCapturer` ở main (vài chục dòng). Mobile:
`@livekit/react-native` (cần dev client/EAS, không chạy trên Expo Go) ở pha M3 (chủ sở
hữu); cuộc gọi đến khi app ở nền là push thường "X đang gọi", bấm vào để vào nếu còn đổ
chuông. **Không CallKit/VoIP push** trong đợt này (chủ sở hữu).

## 4. Mục tiêu, không mục tiêu, phản mục tiêu

**Mục tiêu**

- Desktop macOS + Windows (Linux `.deb`/`.AppImage` chưa ký nếu rẻ) cài được, tự cập
  nhật vỏ (macOS sau khi ký), badge + banner + deep link + chia sẻ màn hình hoạt động,
  đăng nhập qua trình duyệt hệ thống.
- iOS và Android: đăng nhập, chọn tổ chức/workspace, bốn tab, trò chuyện đủ dùng (§6 M2),
  push có preview cho DM/nhắc đến/trả lời luồng, không push khi đang hoạt động nơi khác.
- Mọi thay đổi server nhỏ, có test, theo luật repo (§7).

**Không mục tiêu (đợt này)**

- Soạn tài liệu, Office, quản trị org, billing, admin, workflow trong UniChat; trang đầy
  đủ của task/họp/tài liệu (mở web).
- Nhiều tài khoản cùng lúc trong một app (ADR 0032: một tài khoản một tổ chức).
- Offline ghi có hàng đợi bền trên mobile; chỉ đọc cache và retry gửi trong phiên như
  web (`send-outbox-store`).
- CallKit/VoIP push, đổ chuông khi khóa máy; tắt preview theo người dùng.
- Tablet layout; PWA như chiến lược (manifest tối thiểu vẫn được phép theo ADR 0011 §7,
  không nằm trong plan này).

**Phản mục tiêu** — coi là thất bại dù chạy được

- Mobile đếm chưa đọc khác web cùng lúc, cùng người (sự cố inbox 2026-05-09 của `usf`).
- Một tuyến chat, một bảng, một event chỉ native dùng mà web không có (ngữ nghĩa thứ hai).
- Renderer Electron chạm Node, tắt `webSecurity`, hay nhận refresh token.
- Mã native còn chữ "multica" (`scripts/no-usf-leak.test.mjs` chặn).

## 5. Ràng buộc

- ADR 0011 §3–4: mobile chỉ `import type` từ `@uniwork/core/types/*` và pure function đã
  liệt kê (schema Zod trong `api/endpoints/chat-schemas.ts` chỉ import `zod` nên nằm
  trong danh sách; `permissions/rules`, `paths`, catalogue sự kiện, các module thuần của
  `core/chat` như `read-receipt-utils`, `poll-utils`, `room-permissions-utils`,
  `client-msg-id`, `lazy-chat-scopes`). Không import hook, store, `realtime/*`,
  `api/http`. Logic trùng thì copy có ghi nguồn + test parity.
- ADR 0011 §1 ghi "iOS trước, Android sau khi iOS đạt DoD"; UniChat làm cả hai cùng lúc
  theo quyết định chủ sở hữu 2026-10-16. Plan ghi một dòng vào phần Hệ quả của ADR 0011
  (không đổi phần Quyết định, vì luật ranh giới không đổi).
- `CLAUDE.md` Audit and Events, Database and Migration Rules, Backend HTTP Rules áp dụng
  cho mọi dòng Go trong §7; `.env.example` liệt kê biến mới; flag mới có `review_at`.
- Session provider theo token chạm `packages/core/auth` và `api/http.ts` — đường đi của
  mọi request web; thay đổi phải giữ nguyên hành vi cookie khi không có provider, có test
  ở `packages/core/api/http.test.ts` và `auth/store.test.ts`.
- i18n: hai app dùng glossary `docs/conventions.md` §2; copy chat của mobile sinh từ
  `packages/core/i18n/locales/{vi,en}.json` bằng script + test parity khóa `chat.*`
  (người viết, thay cho dịch tay).
- Log không PII (`scripts/no-pii-log.test.mjs`), kể cả log của main process Electron
  gửi về server (không gửi email/tên). Preview push không vào log.
- Mobile không chặn CI web/backend (ADR 0011 §6); desktop là mã Node nên vào turbo
  `typecheck`/`lint`/`test` chính.

## 6. Phạm vi theo pha

S chặn luồng M (PKCE, push) và D1 (PKCE); phần còn lại của D chạy song song. Ước lượng là
người-tuần thô để xếp thứ tự, không phải cam kết. Trên UniAI các việc dưới gom thành 12 sub-issue của
epic UNI-1826 (S1+S2 → UNI-1827; S3+S4 → UNI-1828; D2+D3 phần web → UNI-1829; D1+D3 phần main+D4 → UNI-1830;
M1 → UNI-1831; M2 → UNI-1832 và UNI-1833; M3 → UNI-1834; D5 → UNI-1835; M4 → UNI-1836; D6 → UNI-1837;
nghiệm thu → UNI-1838); spec của từng lát mới là hợp đồng chi tiết.

### S — Server và web dọn đường (≈1,5 tuần)

| # | Việc | Test giữ |
|---|---|---|
| S1 | Thêm client `uniwork-chat-desktop`, `uniwork-chat-mobile` (+ `-dev`) vào `DESKTOP_AUTH_CLIENTS` ở `.env.example`/deploy; web `isDesktopCallbackUrl` nhận scheme theo danh sách từ server (`GET /api/v1/config` hoặc trường trong `DesktopConsentSDO`) thay vì hằng cứng; client gửi `deployment_id=default` | `packages/views/auth/desktop-consent.test.tsx`, `apps/web/platform/auth/desktop-consent-page.test.tsx`, `server/internal/config/desktop_auth_clients_test.go` |
| S2 | `UserAgent` của refresh token = `row.ClientID + "/" + platform`; `/auth/desktop/refresh` giới hạn theo `device_session_id` (`RateLimitByIdentity`) thay vì chỉ IP 60/phút — điện thoại sau NAT nhà mạng dùng chung IP | `server/internal/handler/router/ratelimit_test.go`, `server/internal/service/desktop_auth_test.go` |
| S3 | `ExpoPushSender` + sender gộp theo tiền tố; đăng ký token Expo (khóa rỗng, kiểm tra tiền tố) đi vòng điều kiện VAPID/https/khóa của `SubscribePush`; `DeviceNotRegistered` → thu hồi; `PushMessage.body` đọc lúc giao (§3.4) cho ba kind chat; `sw.js` hiện `body` | `server/internal/notification/consumer_test.go`, `delivery_test.go` thêm case Expo và body; malformed-response test phía core nếu đổi schema |
| S4 | Rule bỏ push khi người nhận có presence trong 120 giây gần nhất (§3.4) | `notification/rules_more_test.go` hoặc test consumer với presence giả |

`client_platform`/`client_version`/`client_os` trên WS và `platform` của `/auth/desktop/start`
đã nhận giá trị tự do (chỉ log), không cần đổi.

### D — Desktop (`apps/chat-desktop`, ≈3 tuần tới bản cài chưa ký)

| # | Việc | Ghi chú |
|---|---|---|
| D1 | Scaffold electron-vite: main (cửa sổ, `window-state`, `navigation-guard` chỉ cho `appUrl` + `apiUrl`, `external-url` mở trình duyệt hệ thống, `setAsDefaultProtocolClient("uniworkchat")`, trang offline), PKCE ở main (copy `uniwork-office/.../uniwork-auth/`, `safeStorage`), preload `desktopAPI` = `{ app: "unichat", appInfo, session: {getAccessToken, refresh, logout, onChange}, setBadgeCount, isFocused, onFocusChange, openExternal, downloadURL, onDeepLink }`, IPC có schema và giới hạn kích thước (ADR 0026) | Copy-adapt `multica/apps/desktop/src/main/{navigation-guard,external-url,window-state,updater,notification-gate}.ts` và test của chúng; đổi mọi tên |
| D2 | Web: session provider theo token trong `packages/core/auth` + `api/http.ts` + `ws-client` (dùng khi host cắm, cookie khi không); layout gọn kiểu Telegram khi `desktopAPI.app === "unichat"` (bộ chuyển workspace + sidebar chat + hội thoại; link trang đầy đủ → `openExternal`) | Việc web lớn nhất của D; test ở core và `packages/views/layout/` |
| D3 | Badge từ `unreadMapFromRooms` qua `setBadgeCount`; banner theo focus: `workspace-chat-attention.tsx` hỏi `desktopAPI.isFocused()` thay vì `visibilityState` khi có bridge, main giữ `NotificationGate` khử trùng theo id (mẫu multica); deep link `uniworkchat://open?url=<web path>` và `https://app.uniworkos.com/...` từ push → `push()` trong app; `client_platform=desktop` cho WS | `packages/views/layout/`, `apps/web/platform/` |
| D4 | Chia sẻ màn hình: `setDisplayMediaRequestHandler` + picker nguồn; kiểm tra với phòng gọi hiện có | Không đổi `views/chat/voice-call-*` |
| D5 | Đóng gói electron-builder mac (arm64/x64 dmg), win (nsis), linux (deb/AppImage) chưa ký; `electron-updater` feed GitHub Releases cho Windows/Linux; macOS chỉ tự cập nhật sau khi ký (Squirrel.Mac đòi chữ ký) — tới đó bản mac là tải tay; workflow `desktop-release.yml` theo tag `chat-desktop-v*` | Ký số/notarization theo lịch tài khoản §12 Q8 |
| D6 | Trang tải về `uniworkos.com/download`: tái dùng mẫu `office_desktop_download` (`OFFICE_INSTALLER_*_URLS`, chọn theo OS) cho `UNICHAT_INSTALLER_*_URLS` | Sau D5; có thể làm sau pilot |

### M — Mobile (`apps/chat-mobile`, iOS và Android)

| # | Việc | Ghi chú |
|---|---|---|
| M1 Nền (≈2,5 tuần) | Scaffold mirror `multica/apps/mobile` (Expo 55, RNR, NativeWind 4, Expo Router, TanStack Query, Zustand, secure-store, NetInfo) cho cả iOS và Android; `apps/chat-mobile/CLAUDE.md`; lint cấm import ngoài allowlist; `mobile-verify.yml`; guard trong `scripts/governance.test.mjs` theo ADR 0011; auth PKCE (§3.3) bằng `expo-web-browser` — mã mới; chọn workspace; `data/realtime` 3 tầng với scope chat và refresh-reconnect khi token hết hạn; đăng ký push Expo (`expo-notifications`, mã mới); Universal Links/App Links: web phục vụ `/.well-known/apple-app-site-association` và `assetlinks.json`; parse `?room/&message/?dm` | Copy-adapt rồi đổi tên; không còn "multica"; chat agent của multica không mang sang |
| M2 Chat lõi (≈4 tuần) | **Tab Chat:** danh sách hội thoại hợp nhất (copy có test từ `packages/views/chat/chat-sidebar-unified.ts` và các hàm `unreadMapFromRooms`, `mentionUnreadMapFromRooms`, `roomPreviewMapFromRooms` — chúng nằm ở `views`/hook của core nên mobile không import được); hội thoại: tin văn bản, ảnh/file (expo-image-picker/document-picker, multipart), trả lời trích dẫn, luồng, reaction, đã đọc (mirror `read-receipt-utils`), đang gõ, hiện diện, nhắc đến (autocomplete), xóa/sửa tin của mình; gửi với `client_msg_id` + retry trong phiên (mirror `send-outbox-store`, `merge-optimistic-chat-messages`); mở DM, nhóm có sẵn, kênh (xem/join); mute phòng; tìm tin; thành viên phòng; **mọi `kind` khác hiện thẻ chỉ đọc hoặc hàng "Mở trên web"**. **Tab Cuộc gọi:** lịch sử từ tin call-log (`chat.voice.call.completed`), chưa gọi. **Tab Danh bạ:** thành viên tổ chức/workspace, hiện diện, biệt danh, mở DM. **Tab Cài đặt:** tài khoản, thiết bị, thông báo (bật/tắt push), giao diện, ngôn ngữ, chuyển workspace, đăng xuất | Parity test cho từng `lib/*-display.ts` |
| M3 Gọi và kind giàu (≈3 tuần) | LiveKit RN gọi 1:1 và nhóm (nhận khi foreground hoặc qua push thường), tin thoại ghi/nghe, poll bỏ phiếu, sticker/GIF gửi, follow-up, tạo task từ tin, nhắc; tab Cuộc gọi gọi được | Thử trên 2–3 máy Android thật và iPhone |
| M4 Phát hành | `mobile-release.yml` tag `chat-mobile-v*` → EAS build + TestFlight + Play internal; OTA cho sửa JS; Maestro 3 luồng vàng (đăng nhập → đọc/gửi tin; nhận push → mở phòng; vào cuộc gọi) | Cần tài khoản §12 Q8; tới đó build nội bộ qua EAS internal distribution |

## 7. Thay đổi phía server và web, gom lại

Server: S1–S4 ở §6; không bảng mới, không event mới, không đổi catalogue (`PushMessage`
là payload push, không phải frame realtime). Web: session provider theo token (D2), layout
gọn khi host là UniChat (D2), cổng focus và badge (D3), hai tệp `/.well-known/*` tĩnh (M1),
danh sách scheme callback từ server (S1). Việc gỡ tuyến chat cũ (`/chat/room`,
`/chat/messages`) được mở khóa khi mobile không dùng chúng.

## 8. Bảng parity realtime cho mobile (mirror `packages/core/chat/realtime-cache.ts`)

| Sự kiện | Scope | Mobile làm gì |
|---|---|---|
| `chat.message.created` | chat | fetch `getChatRoomMessage(room, id)` → append vào cache phòng/luồng; invalidate `rooms` (preview, unread) |
| `chat.message.updated` / `.deleted` | chat | fetch theo id rồi vá / đánh dấu đã xóa |
| `chat.thread.replied` | chat | vá `reply_count` của tin gốc; nếu luồng đang mở thì append |
| `chat.room.read` | user | vá con trỏ đã đọc (mirror `read-receipt-utils`) |
| `chat.room.activity` / `.updated` / `.created` / `member_*` | workspace, room | invalidate `rooms` (listing-level, mount ở layout workspace) |
| `chat.mention.created` | user | tăng `mention_unread_count` phòng tương ứng; banner nếu không ở phòng đó |
| `chat.typing` | chat | store typing theo phòng, hết hạn như `typing-indicator` web (copy từ `views`) |
| `chat.voice.invite/accept/hangup` | user | M3: overlay cuộc gọi khi foreground |
| `chat.voice.call.completed` | — (outbox, notify) | invalidate lịch sử tab Cuộc gọi |
| `chat.reminder.due`, `chat.follow_up.*` | room, user | invalidate hẹp |
| socket đóng `CloseSessionEnded` (token hết hạn) | — | refresh token → reconnect → replay mọi scope đang giữ (mirror `packages/core/api/ws-client.ts`) |

Reconnect: mỗi hook invalidate key của mình; không sweep toàn cục (ADR 0011 §5).

## 9. Kiểm thử và DoD

- Desktop: vitest cho từng module main (navigation guard, external url, updater, deep
  link parser, IPC schema, PKCE callback); core: session provider có test cả hai chế độ;
  `electron-builder` chạy được trong CI không cần màn hình; smoke thủ công theo
  checklist: đăng nhập qua trình duyệt → quay về app; mở app → đúng phòng; badge; banner
  khi cửa sổ mất focus; chia sẻ màn hình; auto-update từ bản cũ trên Windows/Linux (macOS
  sau khi ký).
- Mobile: vitest Node cho `lib/*-display.ts` (parity), schema fallback (malformed
  response không ném), ws-client (auth frame, backoff, pause ở nền, replay sau hết hạn
  token); Maestro 3 luồng vàng nightly trên simulator iOS và emulator Android.
- Chung: vi/en ngang hàng, test parity khóa `chat.*`; sáng/tối/hệ thống; VoiceOver/
  TalkBack cho tab bar và danh sách; mục tiêu chạm ≥ 44 px; DoD chung
  (`docs/engineering/DEFINITION_OF_DONE.md`) trừ mục web-only.

## 10. CI và phát hành

- Main CI: thêm `--filter='!@uniwork/chat-mobile'`; `apps/chat-desktop` nằm trong turbo
  thường.
- `mobile-verify.yml` path-filter `apps/chat-mobile/**`, `packages/core/**`, lockfile,
  turbo; `mobile-release.yml` tag `chat-mobile-v*`; `desktop-release.yml` tag
  `chat-desktop-v*`.
- `knip.json` thêm workspace `apps/chat-desktop`, `apps/chat-mobile`; `make doctor` kiểm
  Xcode/CocoaPods/Android SDK khi có `apps/chat-mobile`.
- Tài khoản phát hành chưa có (chủ sở hữu, §12 Q8): đăng ký khi plan được duyệt — Apple
  Developer Program cho tổ chức (D-U-N-S, 1–2 tuần duyệt), Google Play Console (1–2 ngày),
  chứng chỉ ký Windows OV/EV (1–2 tuần), Apple notarization (đi cùng Apple Developer),
  EAS. Tới lúc có, pilot dùng bản chưa ký (desktop) và EAS internal distribution (mobile).

## 11. Rủi ro

| Rủi ro | Giảm nhẹ |
|---|---|
| Tên "UniChat" đã có nhiều app gần giống trên App Store (§3.1), khó tìm kiếm và có thể không đặt được tên chính xác hoặc vướng nhãn hiệu | Giữ tên trên App Store Connect ngay khi có tài khoản; tra nhãn hiệu; dự phòng "UniWork Chat", id `com.uniworkos.chat` không đổi |
| Session provider theo token chạm đường request của web | Giữ nguyên hành vi cookie khi không có provider; test cả hai chế độ; D2 là việc đầu của D |
| iOS không giữ WebSocket ở nền → tin đến muộn khi app nền | Push là đường chính cho DM/nhắc đến (đã có rule); khi foreground lại thì invalidate `rooms` + phòng đang mở |
| Nội dung tin đi qua Expo Push Service | Sender tách interface; chuyển APNs/FCM trực tiếp khi cần mà không đổi dữ liệu; ghi vào chính sách riêng tư |
| LiveKit RN làm build phức tạp (dev client, quyền mic/camera, âm thanh nền) | M3 tách riêng; M1–M2 không kéo dependency này |
| Hai bộ UI chat phải bảo trì | Chấp nhận có chủ đích (ADR 0011); hàng dự phòng cho kind lạ để web đi trước không làm mobile vỡ |
| Giới hạn 60/phút/IP trên tuyến credential với điện thoại sau NAT | S2 |
| Hai nền tảng mobile cùng lúc tăng bề mặt QA | Cùng mã Expo; 2–3 máy Android thật; Maestro chạy cả hai |
| App Store review cần tài khoản demo và lý do dùng mic/camera/thông báo | Chuẩn bị tài khoản demo trong org thử; mô tả quyền trong `app.config.ts` |

## 12. Quyết định đã chốt với chủ sở hữu sản phẩm (2026-10-16)

| # | Câu hỏi | Trả lời |
|---|---|---|
| 1 | Một app UniWork mở vào Chat hay app riêng? | **App riêng.** |
| 2 | Cửa sổ desktop hiển thị gì? | **Như Telegram nhưng xoay quanh công việc**: chỉ Chat, giữ các tính năng liên kết đến Công việc của UniWork; trang đầy đủ mở web (§3.2). |
| 3 | Form đăng nhập UniWork trên desktop ở đâu? | **Mở trình duyệt hệ thống rồi quay về app** (PKCE, ngay từ đầu). |
| 4 | Bỏ push lên điện thoại khi đang hoạt động nơi khác? | **Có, ngưỡng 2 phút.** |
| 5 | Push có preview nội dung tin? | **Có, như Telegram/Zalo.** |
| 6 | Android cùng lúc hay sau iOS? | **Cùng lúc từ M1, phát hành cả hai ở M4.** |
| 7 | Gọi trên mobile; đổ chuông khi khóa máy? | **Gọi ở M3; cuộc gọi đến qua push thường; không CallKit.** |
| 8 | Tài khoản phát hành? | **Chưa có; đăng ký khi duyệt plan**; pilot dùng bản chưa ký / internal distribution. |
| 9 | Tab mobile bản đầu? | **Chat · Cuộc gọi · Danh bạ · Cài đặt từ đầu** (Cuộc gọi hiện lịch sử trước). |
| 10 | Bộ tên? | Tên miền chính thức `uniworkos.com`; **tên hiển thị "UniChat"**, định danh `com.uniworkos.chat` và bộ tên §3.1. |

Lựa chọn của người viết còn lại để chủ sở hữu soát: Electron thay vì Tauri; pha 1 desktop
tải chính web; scheme `uniworkchat://` thay vì `unichat://`; Expo Push thay vì APNs/FCM
trực tiếp; không migration cho push; copy vi/en của mobile sinh từ locale của core;
hàng "Mở trên web" cho kind chưa hỗ trợ; mobile dùng tuyến `rooms/{id}/messages`; thư
mục `apps/chat-desktop`/`apps/chat-mobile`; preview cắt ~120 ký tự; ngưỡng presence đo
bằng nhịp Redis 120 giây.

## 13. Để builder quyết

- Cấu trúc thư mục và tên file bên trong `apps/chat-desktop` và `apps/chat-mobile` (mirror
  nguồn đã nêu, đổi tên).
- Thiết kế màn hình mobile cụ thể trong khung RNR/NativeWind theo mẫu Telegram; cách hiện
  "Mở trên web" cho kind chưa hỗ trợ; layout gọn trên web khi host là UniChat.
- Hình dạng API của session provider trong `packages/core/auth` và cách `desktopAPI.session`
  cấp access token cho renderer, miễn refresh token không vào renderer.
- Chi tiết IPC `desktopAPI` ngoài danh sách ở D1, miễn không có kênh fs/process/HTTP chung
  (ADR 0026).
- Thứ tự trong M2 theo giá trị cho pilot; chỉ số đếm/quyền/enum là bất biến.
