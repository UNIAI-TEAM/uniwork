# UniChat — rà soát bảo mật 2026-10-17 (Q1)

> **Trạng thái:** shipped — rà soát mã trên `develop` `aab341175` (sau M4 phase 1), issue UNI-1838; mục medium đã sửa
> trong PR của UNI-1838, phần còn lại ở UNI-1877, UNI-1878, UNI-1879. Không gồm mã gọi LiveKit của M3 (PR #345, vào `develop` sau lượt
> rà soát); riêng đường push cuộc gọi của M3 đã kiểm sau rebase: đi qua cùng lọc subscription đang sống và cùng bản sửa
> lỗi ticket Expo (test `TestCallPushSkipsAPhoneWhoseDeviceWasRevoked`).

## 1. Phạm vi và cách làm

Đọc mã, không chạy app. Bốn vùng, mỗi vùng một lượt đọc riêng rồi kiểm lại từng phát hiện medium trên mã:

| Vùng | Đã đọc |
| --- | --- |
| Desktop | toàn bộ `apps/chat-desktop/src`, `electron-builder.ts`, `electron.vite.config.ts`, `scripts/*`, `packages/core/platform/desktop-bridge.ts` và chỗ web dùng `window.desktopAPI` |
| Mobile | `apps/chat-mobile/{app,data,lib,components}`, `app.config.ts`, `eas.json`, `maestro/` |
| Server và web | `DesktopAuthService` + cấu hình `DESKTOP_AUTH_CLIENTS`, rate limit refresh theo thiết bị, Expo push (`server/internal/notification`), `GET …/chat/call-logs`, `/.well-known/*`, session provider theo token, catalogue bản cài trong `GET /api/v1/config` |
| Workflow | `chat-desktop-release.yml`, `chat-mobile-release.yml`, `chat-mobile-verify.yml`, `mobile-verify.yml` |

Lệnh đã chạy:

| Lệnh | Kết quả |
| --- | --- |
| `pnpm audit --audit-level high` | exit 0 — 2 high đều nằm trong `pnpm.auditConfig.ignoreCves` của `package.json`; còn 5 moderate, 3 low (xem §4) |
| `govulncheck ./...` | **không chạy ở máy này** (chưa cài, không cài thêm); CI chạy `govulncheck@v1.7.0` ở job `backend-test (rest)` trên mỗi PR |
| `gitleaks` | không chạy ở máy này; CI job `secrets` chạy `gitleaks git --redact` trên mỗi PR |
| Test Go/vitest của các bản sửa | xem §5 |

Mức: **high** = khai thác được thực tế, không cần điều kiện đặc biệt; **medium** = khai thác được với một điều kiện có
thật (mất máy, chung máy, repo công khai, script trên origin app); **low** = phòng thủ thêm lớp hoặc tác động nhỏ.

**Kết quả: 0 high; 5 medium — 4 đã sửa trong PR này, 1 chờ chủ sở hữu chọn (UNI-1877); low/info — 3 sửa kèm, còn
lại gom ở UNI-1878.**

## 2. Phát hiện medium

Dòng mã theo `develop` `aab341175` (trước khi sửa).

| Mã | Phát hiện | Kịch bản | Trạng thái |
| --- | --- | --- | --- |
| S-F1 / Mo-M1 | Thu hồi thiết bị không dừng push tới thiết bị đó. `revokeAllUserSessions`, `revokeDesktopFamily`, `Logout` scope device (`server/internal/service/desktop_auth.go:517-531, 598-617, 702-710`) không đụng `push_subscriptions`; bảng không có liên kết tới phiên. | Điện thoại bị mất; chủ thu hồi nó ở Thiết bị, đổi mật khẩu hoặc đăng xuất mọi nơi. Phiên chết, nhưng token Expo còn sống: mọi DM, nhắc đến, trả lời luồng hiện trên màn khoá của người nhặt được, kèm preview ~120 ký tự, không cần đăng nhập, không hạn. | **Đã sửa** — `fix(push): close the push of a revoked device`: cột `push_subscriptions.session_id` (migration `9991792251608351`), ghi `sid` lúc đăng ký; đóng theo family khi thu hồi family hoặc thiết bị cuối của family; thu hồi toàn tài khoản đóng mọi push đăng ký từ phiên thiết bị (push trình duyệt giữ). Test `TestRevokingADeviceClosesThePushItRegistered`. |
| Mo-M2 | Nightly Maestro tải `~/.maestro/tests` lên artifact (`.github/workflows/chat-mobile-verify.yml:145-151, 209-215`) trong repo **công khai**; log lệnh của Maestro ghi chữ `inputText` đã gõ (`maestro/subflows/sign-in.yaml:34,36` gõ email và mật khẩu thử). Tài khoản thử còn nằm trong env của cả job (`:78-83, 158-163`), lộ cho `pnpm install`, `expo prebuild`, build native và `curl … \| bash`. | Bất kỳ ai có tài khoản GitHub tải artifact và đăng nhập staging bằng tài khoản thử. Chưa xảy ra: job là no-op tới khi đặt biến `MAESTRO_*`. | **Đã sửa** — `ci(chat-mobile): keep the Maestro test account out of artifacts`: chỉ tải ảnh `*.png`; tài khoản chỉ ở env các bước chạy Maestro. `scripts/governance.test.mjs` giữ cả hai. |
| Mo-M3 | Đăng xuất từ Cài đặt hoặc màn chọn workspace (`app/(app)/[org]/[ws]/(tabs)/settings.tsx:85-88`, `select-workspace.tsx:30-33`, `data/auth/store.ts:69-75`) không xoá query cache và hàng gửi; chỉ đường 401 xoá cache. | A đăng xuất, B đăng nhập trên cùng điện thoại trong 10 phút: B thấy danh sách workspace, phòng kèm preview, tin đã cache của A; bong bóng chưa gửi của A hiện trong phòng chung (không bị gửi dưới tên B). | **Đã sửa** — `fix(chat-mobile): drop the cache and the unsent queue on logout`. Test trong `data/auth/store.test.ts`. |
| D-M2 | Chia sẻ màn hình được cấp im lặng: không picker, không cần cú click (`apps/chat-desktop/src/main/screen-share.ts:16-27`) trên Windows, Linux, macOS < 15. | Script chạy trên origin app (XSS trong render chat, deploy hỏng, dependency độc) gọi `getDisplayMedia` → nhận toàn bộ màn hình đầu tiên, gồm ứng dụng khác, không chỉ báo nào trên Windows. | **Đã sửa** — `fix(chat-desktop): ask before sharing the whole screen`: cần `userGesture` và hộp xác nhận hệ điều hành trước khi gọi capturer. Test trong `screen-share.test.ts`. |
| D-M1 | Tự cập nhật Windows/Linux chưa ký chỉ dựa vào sha512 trong `<kênh>.yml` nằm cùng release cuộn `chat-desktop-feed` với bản cài (`src/main/updater.ts:10-12, 25-30`, `electron-builder.ts:39`, `chat-desktop-release.yml:234-242`); electron-updater chỉ kiểm chữ ký Windows khi có `publisherName` (chỉ có khi build có ký), Linux không bao giờ. | Ai có một credential `contents: write` của repo thay yml trên `chat-desktop-feed` → mọi bản Windows chưa ký và mọi bản Linux tự cài mã của họ khi thoát (deb: root qua pkexec). | **Chưa sửa — UNI-1877**: sửa là đảo quyết định D2 (tự cập nhật khi chưa ký), chủ sở hữu chọn: giữ + ghi rủi ro, hoặc Windows chưa ký chỉ thông báo. Tự hết với Windows khi có chữ ký (UNI-1879). |

## 3. Phát hiện low và info

Đã sửa kèm trong PR này (rẻ, hoặc không sửa được sau bản store đầu):

| Mã | Phát hiện | Sửa |
| --- | --- | --- |
| S-F3 | Lỗi ticket Expo mang `message` của Expo — có trích token thiết bị — vào `outbox_events.last_error` và log dead letter (`server/internal/notification/push_expo.go:124`). | `fix(push): keep the device token out of Expo ticket errors`; test `TestExpoPushSenderMapsTickets`. |
| Mo-L1 | Keychain class `AFTER_FIRST_UNLOCK` (`apps/chat-mobile/data/secure-storage.ts:11`): phiên, gồm refresh token, vào bản sao lưu iCloud/iTunes và sang máy khôi phục. Đổi sau bản store đầu không có tác dụng với mục đã lưu. | `fix(chat-mobile): keep the session in this phone's keychain only` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). |
| Mo-L3 | Tài khoản thử Maestro ở env cấp job. | Cùng bản sửa Mo-M2. |

Gom ở **UNI-1878** (mỗi mục có vị trí, kịch bản, cách sửa, test): S-F2 preview push không kiểm lại thành viên/mute lúc
giao; S-F4 không trần độ dài token và số subscription; S-F5 trang consent nhúng được trong iframe; S-I1 production cho
phép redirect `uniworkchat-dev://`; S-I7 SSRF mù qua endpoint web push (ngoài UniChat); D-L1 thiếu permission check
handler; D-L2 deep link desktop để lọt path chuẩn hoá thành `//host` (web chặn lại); D-L3 `appUrl` không bị đòi https
ngoài dev; D-L4 chưa có Electron fuses; D-L5 tag stable nhận commit `develop`, action ghim theo tag; D-L6 exchange sau
logout để lại thiết bị ma; D-I1 DevTools trong bản đóng gói; D-I3 trang offline không CSP; Mo-L2 App Link Android nhận
mọi path; Mo-L4 `mobile-verify.yml` không khối `permissions`; Mo-L5 không chặn `http://` cho server release; Mo-L6
deep link `?dm=` tạo DM không hỏi; Mo-I (`redirect: "error"` bị RN bỏ qua, log frame thô, OTA chưa ký mã, phiên bản
`eas`/Maestro chưa ghim).

Ký Windows: chứng chỉ mua sau 2023-06 nằm trên phần cứng/HSM, workflow chỉ ký bằng `.pfx` — **UNI-1879**.

## 4. Phụ thuộc (`pnpm audit`)

Không high/critical ngoài hai CVE đã chấp nhận trong `ignoreCves`. Moderate chạm UniChat: `decode-uri-component ≤ 0.4.2`
qua `expo-router > query-string` (chạy lúc parse URL trong app; `lib/deep-link.ts` chặn trước những gì đi vào route),
`uuid < 11.1.1` qua `@expo/config-plugins > xcode` (chỉ lúc build), `postcss-selector-parser` qua `tailwindcss` (build),
`sprintf-js` qua `electron-builder > … > roarr` (build). Theo dõi khi nâng Expo SDK/electron-builder; không chặn pilot.

## 5. Bằng chứng của các bản sửa (red → green, chạy 2026-10-17)

| Bản sửa | Test chạy |
| --- | --- |
| S-F1 | `go test ./internal/service -run TestRevokingADeviceClosesThePushItRegistered` đỏ trước, xanh sau; cùng các test `TestDesktop*`, `TestEndingASession…`, `TestOfficeLeaseRevokedWithRevokeAll`, admin/family; `go test ./internal/notification ./migrations ./internal` (DB thử riêng) xanh; `go vet`, `staticcheck` sạch |
| S-F3 | `go test ./internal/notification -run TestExpoPushSender` đỏ trước, xanh sau |
| Mo-M3, Mo-L1, Firebase | `vitest run` toàn bộ `apps/chat-mobile` (53 tệp, 626 test; sau rebase lên M3: 56 tệp, 726 test) xanh; `typecheck`, `lint` sạch |
| Mo-M2 | `node --test scripts/governance.test.mjs` (test mới đỏ trước, xanh sau) |
| D-M2, crash renderer | `vitest run` toàn bộ `apps/chat-desktop` (21 tệp, 261 test) xanh; `typecheck`, `lint` sạch |

## 6. Đã kiểm, ổn (bằng chứng cho checklist "Bảo mật")

- **Renderer Electron**: một `BrowserWindow`, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`;
  `webSecurity`, `allowRunningInsecureContent`, `experimentalFeatures`, `webviewTag` để mặc định an toàn
  (`apps/chat-desktop/src/main/renderer-web-preferences.ts:6`, test cùng tên). Preload từ chối chạy khi không cô lập
  context, chỉ expose API có kiểu, không `ipcRenderer` thô (`src/preload/index.ts:5,17-21,54`).
- **IPC**: tập kênh đóng (`src/main/ipc/handlers.ts:40-71`); kiểm origin chính xác của `senderFrame` kể cả `null`,
  chặn mẹo `app.example.com.evil.com`/userinfo; chuỗi ≤ 64 KiB (`src/main/ipc/schema.ts:24-35,49-88`); `sendToApp`
  chỉ gửi khi main frame ở origin app (`:43-47`). Không kênh nào trả refresh token (`handlers.test.ts:85`).
- **Refresh token chỉ ở main/SecureStore**: desktop `safeStorage`, từ chối `basic_text` và khi không mã hoá được, thư mục
  0700, tệp 0600 (`src/main/auth/credentials.ts:106-121,177-188`); mobile chỉ SecureStore, không AsyncStorage/MMKV, query
  cache chỉ trong bộ nhớ (`apps/chat-mobile/data/secure-storage.ts`, `data/query-client.ts`); Android Auto Backup loại
  SecureStore (plugin `expo-secure-store`).
- **PKCE**: verifier ~384 bit từ CSPRNG, S256, `state` 256 bit so sánh hằng thời gian, callback khớp đúng redirect, chỉ
  `code` và `state` một lần, không fragment (desktop `src/main/auth/{pkce,callback}.ts`; mobile `data/auth/{pkce,callback}.ts`).
  Server: chỉ S256, code gắn client/deployment/redirect/challenge, dùng một lần, TTL 120 s; redirect so khớp `==` theo
  đúng danh sách của client (`server/internal/service/desktop_auth.go:734-761`, `server/pkg/db/queries/desktop_auth.sql:30-34`);
  xoay refresh có phát hiện dùng lại → thu hồi family (`desktop_auth.go:413-443`).
- **Trang consent**: callback chỉ đến từ server và khớp `redirect_uri` của attempt — không open redirect
  (`packages/views/auth/desktop-consent.tsx:76-85`).
- **Điều hướng và link ngoài**: guard `will-navigate` + `will-redirect` so origin chính xác (`src/main/navigation-guard.ts`);
  `window.open` bị từ chối và chuyển `openExternalSafely`; `openExternal` chỉ `https:` (loopback `http:` ở dev), chặn
  `file:`, `smb:`, `ms-msdt:`, `javascript:` (`src/main/external-url.ts:13-21`), lint cấm gọi thẳng. Mobile không có
  WebView, không `Linking.openURL`; `openBrowserAsync` chỉ URL file ký sẵn từ server và URL dựng từ `appUrl`.
- **Deep link**: desktop đúng scheme/host/path, kết quả ép về `appUrl`, web kiểm lại (`src/main/deep-link.ts:20`,
  `handlers.ts:25`); mobile kiểm origin, thử `//evil`, `\\evil`, `%2e%2e`, `javascript:` đều bị chặn
  (`apps/chat-mobile/lib/deep-link.ts:28-48`); chạm push đi qua cùng parser.
- **Token chỉ tới API**: web `packages/core/api/http.ts:180-201`; mobile `data/api.ts`, socket gửi token ở frame đầu,
  không trên URL (`data/realtime/ws-client.ts`); chế độ token trên web chỉ bật khi `desktopAPI.app === "unichat"`
  (`packages/core/platform/desktop-bridge.ts:41`).
- **Rate limit refresh**: header thiết bị phải đúng 26 ký tự chữ-số, không thì khoá theo IP; trần theo địa chỉ chạy trước
  ngân sách theo thiết bị (`server/internal/handler/router/auth.go:113-125`, `router.go:106-114`).
- **Expo push**: đăng ký kiểm regex token và platform, gắn người dùng của phiên; `DeviceNotRegistered` chỉ thu hồi đúng
  dòng của người nhận; thân lỗi 4xx cắt 4 KiB, chỉ mã lỗi; `EXPO_ACCESS_TOKEN` chỉ ở header. Không dòng log nào mang
  preview (đã đọc mọi lời gọi slog trong `notification` và `outbox`). Metric bỏ push đúng tên
  `uniwork_push_suppressed_total{kind}` (`server/internal/metrics/notifications.go:34-37`).
- **`GET …/chat/call-logs`**: `RequireMember` theo workspace trên path, query ràng `organization_id`/`workspace_id`,
  chỉ phòng người gọi là thành viên, tôn trọng chặn, tối đa 100 dòng; `TestIsolationMatrix` tự phủ route
  (`server/internal/service/chat_voice_call_logs.go:42-49`, `server/pkg/db/queries/chat_call_logs.sql:17-35`).
- **Bản cài/store trong `/api/v1/config`**: chỉ từ env, chỉ `https` (loopback http ở kênh dev)
  (`server/internal/config/office_installers.go:50-80`, `unichat_downloads.go:44-50`).
- **Workflow**: không `pull_request_target` ở đâu; quyền gốc `contents: read`, chỉ job `publish` có `contents: write` và
  không checkout; `github.ref_name` đi qua env, không nội suy vào `run:`; `persist-credentials: false`; secrets ký chia
  theo nền tảng vào đúng một bước; tag phải trỏ commit trên `main`/`develop` trước khi job có secrets chạy.
