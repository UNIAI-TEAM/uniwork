# UniChat — Client PKCE native, scheme callback theo danh sách server, rate limit refresh theo thiết bị (lát N1)

> **Trạng thái:** shipped — merge vào develop 2026-10-17 qua PR #333 (squash d4d5aaa31, gộp N1–N3 giai đoạn 1); sửa sau khảo sát usf qua PR #334 (df17638c0); plan `../plans/2026-10-16-unichat-auth-clients.md`. Lát N1 của epic UNI-1826; issue UNI-1827.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §2 "Đăng nhập native", §3.1, §6 S1–S2 · **Vùng:** `server/internal/{config,service,handler}`, `apps/web/app/(auth)/auth/desktop/authorize/`, `packages/views/auth/`

## 1. Mục tiêu

Hai app UniChat đăng nhập bằng luồng PKCE đã có của `DesktopAuthService` mà không sửa giao thức: mỗi app một client, callback về scheme `uniworkchat://`, trang consent không còn hằng scheme của Office, và refresh của điện thoại không chết vì giới hạn theo IP chung của nhà mạng.

## 2. Hiện trạng (đo bằng mã, 2026-10-16)

- `server/internal/config/config.go`: `DESKTOP_AUTH_CLIENTS=client_id=redirect|redirect,...` (`parseDesktopAuthClients`), mặc định một client `uniwork-office` / `uniwork-office://auth/callback`; `DESKTOP_AUTH_DEPLOYMENT_IDS` mặc định `default`.
- `server/internal/service/desktop_auth.go`: `Start` kiểm `allowed(clientID, redirectURI, deploymentID)`; `Exchange` và `Refresh` ghi `UserAgent: "uniwork-office/" + platform` cứng (hai chỗ).
- `server/internal/handler/router/auth.go`: `GET /auth/desktop/start`, `POST /auth/desktop/exchange`, `POST /auth/desktop/refresh` đều dưới `credentialLimit` = 60 yêu cầu/phút/IP (`router.go:97`).
- `apps/web/app/(auth)/auth/desktop/authorize/page.tsx`: `isDesktopCallbackUrl` chỉ nhận `uniwork-office:` và `uniwork-office-dev:`; host `auth`, path `/callback`.
- Mẫu giới hạn theo danh tính dưới trần theo IP đã có: `/mcp` (`mcp` 120/phút theo token, `mcp-ip` 1200/phút), test `TestMCPBudgetsEachAccessTokenAndSkipsTheGlobalLimiter`, `TestMCPAddressCeilingStopsRotatingTokens`.

## 3. Thiết kế

### 3.1 Client và redirect
`.env.example` và deploy: `DESKTOP_AUTH_CLIENTS=uniwork-office=uniwork-office://auth/callback,uniwork-chat-desktop=uniworkchat://auth/callback|uniworkchat-dev://auth/callback,uniwork-chat-mobile=uniworkchat://auth/callback|uniworkchat-dev://auth/callback`. Hai client cùng redirect là hợp lệ (redirect gắn với client liệt kê nó). Cả hai app gửi `deployment_id=default`.

### 3.2 Scheme callback từ server
`DesktopConsentSDO` không thêm trường nào: trang consent so `callback_url` (protocol, host, path) với `redirect_uri` sẵn có của attempt (đã được `Start` kiểm theo allowlist) qua `isDesktopCallbackUrl` trong `packages/views/auth/desktop-consent.tsx` — không còn danh sách cứng. `sessionStorage` lưu callback để mở lại app giữ nguyên.

### 3.3 UserAgent theo client
`UserAgent: row.ClientID + "/" + platform` ở `Exchange` và `device.ClientID + "/" + device.Platform` ở `Refresh` (cần `client_id` trên `device_sessions`, đã có). Office giữ đúng chuỗi cũ nên `isNewDevice` (`CountRefreshTokensForUserAgent`) không đổi.

### 3.4 Rate limit refresh theo thiết bị
`POST /auth/desktop/refresh` rời `credentialLimit` và rời cả global limiter 300/IP (`ExceptPaths`, vì limiter đó vẫn chặn trường hợp NAT nhà mạng), nhận hai lớp: bucket `desktop-refresh` theo cặp (IP, `device_session_id`) (client gửi thêm header `X-UniWork-Device`; không header → theo IP; có IP trong khóa vì id thiết bị không bí mật, kẻ biết id không tiêu được ngân sách của máy thật từ địa chỉ khác) ngân sách 60/phút — bằng `credentialLimit` cũ nên client Office chưa gửi header giữ nguyên ngân sách theo IP — dưới trần theo IP `desktop-refresh-ip` 600/phút (mẫu `mcp-ip`). Header không được xác minh ở router (router không đọc DB), trần theo IP chặn kẻ xoay vòng id. Redis quá 100 ms → fail open như mọi limiter.

### 3.5 Không đổi
Giao thức PKCE, bảng `desktop_auth_attempts`/`device_sessions`/`refresh_tokens`, audit action (`ActionAuthDesktopSessionCreated` đã mang `client_id`), `start`/`exchange` vẫn dưới `credentialLimit`.

## 4. Tiêu chí hoàn thành và test

| Kiểm | Test |
|---|---|
| Ba client, redirect không dùng chéo | `server/internal/config/desktop_auth_clients_test.go` |
| Consent so `callback_url` với `redirect_uri` của attempt; nhận `uniworkchat:`, từ chối scheme lạ | `packages/views/auth/desktop-consent.test.tsx`, `apps/web/platform/auth/desktop-consent-page.test.tsx` |
| UA `uniwork-chat-mobile/<platform>`; Office vẫn `uniwork-office/` | `server/internal/service/desktop_auth_test.go` |
| 100 thiết bị / 1 IP / 1 phút đều qua; 1 thiết bị vượt 60 → 429; trần IP chặn id xoay vòng | `server/internal/handler/router/ratelimit_test.go` |
| Swagger/SDO mô tả có `description`/`example`; `.env.example` cập nhật | `docs/api-sdi-sdo.md` checklist, `scripts/env-example.test.mjs` |

Lệnh hẹp: `make test-go` (gói `config`, `service`, `handler/router`); `pnpm --filter @uniwork/views exec vitest run auth/desktop-consent.test.tsx`; `pnpm --filter @uniwork/web exec vitest run platform/auth/desktop-consent-page.test.tsx`.

## 5. Rủi ro
Đổi hành vi limiter của tuyến refresh có thể ảnh hưởng UniWork Office (client hiện hữu): ngân sách theo thiết bị 60/phút rộng hơn nhu cầu thật (một refresh mỗi 15 phút), và không header thì y như cũ.

## 6. Để builder quyết
Tên header; số ngân sách chính xác; `redirect_scheme` tính ở service hay handler; có gộp `uniwork-chat-desktop` và `uniwork-chat-mobile` thành một client hay không (spec cha chọn hai để tách nhãn thiết bị).

**Đã quyết:** header là `X-UniWork-Device`; ngân sách 60/phút theo cặp (IP, thiết bị) dưới trần 600/phút theo IP; header nằm trong CORS `AllowedHeaders`; không tính `redirect_scheme` ở đâu cả mà dùng lại `redirect_uri` sẵn có của attempt; giữ hai client chat riêng để tách nhãn thiết bị.
