# UniChat — tài khoản phát hành và nơi đặt từng khóa

> **Trạng thái:** in-progress — danh sách việc cho chủ sở hữu sản phẩm (người đứng tên mọi tài khoản), lập 2026-10-17
> trong Q1 (UNI-1838, spec `docs/superpowers/specs/2026-10-16-unichat-maturity-pilot-design.md` §4). Đã có (theo
> repo, 2026-10-22): tài khoản Expo tổ chức `uniai-team` với dự án EAS `uniwork-chat` (#18, commit `ff84056a7`; một bản
> build production EAS đã chạy 2026-10-21), Firebase/FCM cho push Android (#13–#14) và chứng chỉ ký OTA đã commit (#26,
> khoá chờ chuyển vào GitHub). Chưa có: Apple Developer (#1–#9, iOS không phát hành được), Sentry (#25), Environment
> `chat-mobile-production` (#27). Google Play: xác nhận trong Play Console (repo không chứng minh được). Tick từng ô khi
> xong và dán bằng chứng (ảnh, ngày duyệt) vào bình luận UNI-1838.

Không dán khóa, mật khẩu hay tệp chứng chỉ vào issue, PR, chat hay tệp trong repo. Giá trị bí mật chỉ đi vào ba nơi:
GitHub Environment (`Settings → Environments`), EAS credentials (`eas credentials`) và Kubernetes Secret của server.

## 1. Thứ tự (việc dài nhất trước)

1. **D-U-N-S** cho pháp nhân (miễn phí ở Dun & Bradstreet, 5–14 ngày) — Apple Developer tổ chức và Google Play
   tổ chức đều đòi.
2. **Tài khoản Expo tổ chức** (cùng ngày, không chờ gì): mở khóa build Android cài trực tiếp và push cho pilot.
3. **Chứng chỉ ký Windows OV/EV** (1–2 tuần xác minh doanh nghiệp).
4. **Apple Developer Program — tổ chức** (khi có D-U-N-S; 1–2 tuần duyệt). Ngày tài khoản mở: giữ tên "UniChat".
5. **Google Play Console — tổ chức** (khi có D-U-N-S; xác minh 1–2 ngày hoặc hơn).

Tới khi có: desktop phát hành bản `unsigned` (Windows SmartScreen cảnh báo, macOS không tự cập nhật), Android cài APK
từ EAS `preview`, **iPhone không cài được bản nào** (TestFlight và ad hoc đều cần Apple Developer).

## 2. Bảng: tài khoản → thứ tạo ra → tên chính xác → nơi đặt → ai đọc

| # | Tài khoản / việc | Tạo ra | Tên chính xác | Đặt ở đâu | Ai đọc |
| --- | --- | --- | --- | --- | --- |
| 1 | Apple Developer (tổ chức) | Team ID (10 ký tự) | `APPLE_TEAM_ID` | GitHub Environment `chat-desktop-release` (secret) | `.github/workflows/chat-desktop-release.yml` (job `package`, máy mac) → notarize |
| 2 | ″ | ″ | `UNICHAT_IOS_TEAM_ID` | `deploy/app/env/uniwork-fe.env` (không bí mật) | `apps/web/platform/well-known.ts` → `/.well-known/apple-app-site-association` (universal link) |
| 3 | ″ | ″ | `EXPO_APPLE_TEAM_ID` (tùy chọn) | Môi trường EAS `preview` và `production` (plaintext) | `apps/chat-mobile/app.config.ts` › `ios.appleTeamId` |
| 4 | Chứng chỉ **Developer ID Application** (Certificates → `+`) | tệp `.p12` + mật khẩu | `CSC_LINK` (base64 của `.p12`), `CSC_KEY_PASSWORD` | GitHub Environment `chat-desktop-release` (secret) | workflow desktop (chỉ máy mac); `apps/chat-desktop/electron.vite.config.ts` bật `UNICHAT_MAC_SIGNED` khi có `CSC_LINK` → auto-update macOS |
| 5 | Notarization (Apple ID của một thành viên team + app-specific password ở appleid.apple.com) | email + mật khẩu ứng dụng | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` | GitHub Environment `chat-desktop-release` (secret) | electron-builder notarize trên máy mac |
| 6 | Identifiers: đăng ký `com.uniworkos.chat` và `com.uniworkos.chat.staging` (bật Associated Domains, Push Notifications) | App ID | — | Apple Developer | EAS khi tạo profile |
| 7 | App Store Connect: tạo app `com.uniworkos.chat` tên **"UniChat"** ngay ngày tài khoản mở (không được → **"UniWork Chat"**, id giữ nguyên; ghi quyết định vào UNI-1838) và app `com.uniworkos.chat.staging` (tên ví dụ "UniChat Staging") cho bản `internal` | Apple ID số của app | `ascAppId` | `apps/chat-mobile/eas.json` › `submit.internal.ios.ascAppId` (và `submit.production.ios.ascAppId`) qua PR — không bí mật | `eas submit` (`--auto-submit` trong `chat-mobile-release.yml`) |
| 8 | App Store Connect API key (Users and Access → Integrations, vai trò App Manager) | `.p8` + Key ID + Issuer ID | — | EAS: `eas credentials -p ios` (mục App Store Connect API Key) | EAS submit; không đặt vào GitHub |
| 9 | Chứng chỉ phân phối iOS, provisioning profile, khóa APNs | do EAS tạo | — | EAS: `eas credentials -p ios` | EAS build; push iOS qua Expo |
| 10 | TestFlight: nhóm thử nội bộ | link mời | `UNICHAT_TESTFLIGHT_URL` | `deploy/app/env/uniwork-be.env` | `GET /api/v1/config` → trang `/apps/unichat` |
| 11 | Google Play Console (tổ chức) | app `com.uniworkos.chat` (và `com.uniworkos.chat.staging` cho `internal`) | — | Play Console; bản AAB **đầu tiên tải tay** (`eas build -p android --profile internal`) | — |
| 12 | Service account Google Cloud có quyền phát hành trên app | khóa JSON | — | EAS: `eas credentials -p android` (Google Service Account Key for submissions) | `eas submit` Android |
| 13 | Firebase project (cùng tài khoản Google) có app Android `com.uniworkos.chat`, `.staging`, `.dev` | `google-services.json` | `GOOGLE_SERVICES_JSON` (biến EAS **kiểu file**) | Môi trường EAS `development`, `preview`, `production`: `eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment <env>` | `apps/chat-mobile/app.config.ts` › `android.googleServicesFile`; thiếu thì Android **không lấy được Expo push token** |
| 14 | Khóa FCM V1 (service account Firebase, khác khóa #12) | khóa JSON | — | EAS: `eas credentials -p android` (FCM V1 service account key) | Expo Push Service gửi tới Android |
| 15 | Play App Signing | SHA-256 của khóa ký app (Play Console → App integrity) | `UNICHAT_ANDROID_SHA256` (nhiều giá trị cách dấu phẩy) | `deploy/app/env/uniwork-fe.env` | `apps/web/platform/well-known.ts` → `/.well-known/assetlinks.json` (App Links) |
| 16 | Play internal testing | link opt-in | `UNICHAT_PLAY_INTERNAL_URL` | `deploy/app/env/uniwork-be.env` | trang `/apps/unichat` |
| 17 | Chứng chỉ ký Windows OV/EV | workflow đang chờ `.pfx` + mật khẩu — **chứng chỉ mua mới không còn dạng này**, xem ghi chú cuối trang | `WIN_CSC_LINK` (base64 của `.pfx`), `WIN_CSC_KEY_PASSWORD` | GitHub Environment `chat-desktop-release` (secret) | workflow desktop (chỉ máy Windows) |
| 18 | Expo tổ chức: `cd apps/chat-mobile && eas init` (dự án `unichat`) | project id (UUID) | hằng `EAS_PROJECT_ID` | `apps/chat-mobile/app.config.ts` qua PR (không bí mật); `UNICHAT_EAS_PROJECT_ID` chỉ để ghi đè | push (`extra.eas.projectId`), OTA (`updates.url`) |
| 19 | Expo robot token | token | `EXPO_TOKEN` | GitHub Environment `chat-mobile-release` và `chat-mobile-update` (secret) | `.github/workflows/chat-mobile-release.yml`, `.github/workflows/chat-mobile-update.yml` |
| 20 | Biến máy chủ của bản mobile | URL | `UNICHAT_API_URL`, `UNICHAT_APP_URL` | Môi trường EAS `preview` và `production` (plaintext) | `app.config.ts`; thiếu thì build staging/production đỏ |
| 21 | Expo "Enhanced push security" (tùy chọn) | access token | `EXPO_ACCESS_TOKEN` | Kubernetes Secret `uniwork-expo` (key `EXPO_ACCESS_TOKEN`, chart `be.secrets.expo`, không vào ConfigMap) | `server/internal/notification` Expo sender; rỗng = gửi không xác thực |
| 22 | Nightly Maestro trên staging (sau M4 phase 2) | tài khoản thử email/mật khẩu, org/ws/phòng thử | vars `MAESTRO_API_URL`, `MAESTRO_APP_URL`, `MAESTRO_ORG_SLUG`, `MAESTRO_WS_SLUG`, `MAESTRO_ROOM_ID`; secrets `MAESTRO_TEST_EMAIL`, `MAESTRO_TEST_PASSWORD` | GitHub repository variables / secrets | `.github/workflows/chat-mobile-verify.yml` |
| 23 | Trang tải desktop | `installer-urls.env` của mỗi release | `UNICHAT_INSTALLER_DEV_URLS`, `UNICHAT_INSTALLER_BETA_URLS`, `UNICHAT_INSTALLER_STABLE_URLS` | `deploy/app/env/uniwork-be.env` | trang `/apps/unichat` |
| 24 | Khi lên store công khai (sau go) | link store | `UNICHAT_STORE_IOS_URL`, `UNICHAT_STORE_ANDROID_URL` | `deploy/app/env/uniwork-be.env` | trang `/apps/unichat` (ẩn TestFlight/Play internal) |
| 25 | Sentry: project React Native trong tổ chức Sentry (UNI-2053) | DSN; token tổ chức (`project:releases`, `org:read`); slug tổ chức và project | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Môi trường EAS `preview` và `production` (DSN, org, project plaintext; token secret); GitHub Environment `chat-mobile-update` (token secret, org/project variables) | `app.config.ts` (`extra.sentryDsn`), Gradle/Xcode của bản EAS, source map của OTA |
| 26 | Khoá ký OTA (EAS Update code signing) | khoá riêng PEM — đã sinh 2026-10-22, chứng chỉ công khai đã commit ở `apps/chat-mobile/certs/eas-update-certificate.pem`; khoá nằm ở `.secrets/unichat-keys/private-key.pem` trên máy đã sinh, chờ chuyển | `EAS_UPDATE_PRIVATE_KEY` | GitHub Environment `chat-mobile-update` (secret) và kho bí mật của tổ chức, rồi xoá bản trên máy | `.github/workflows/chat-mobile-update.yml` |
| 28 | Sức khoẻ bản phát hành, alert Sentry và rollback OTA | token Sentry thêm `event:read`, `alerts:write`; slug team nhận alert; khoá #26 | `SENTRY_AUTH_TOKEN`, `EXPO_TOKEN`, `EAS_UPDATE_PRIVATE_KEY`, `PLAY_SERVICE_ACCOUNT_JSON` (thêm quyền "View app quality information"); variables `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_ALERT_TEAM`, tùy chọn `SENTRY_ALERT_EXTRA_ACTIONS` (action pager của Sentry) | GitHub Environment `chat-mobile-release-health` (nhánh `main`, **không** reviewer); rollback dùng Environment `chat-mobile-update` (#26) | `.github/workflows/chat-mobile-release-health.yml`, `.github/workflows/chat-mobile-rollback.yml` |
| 29 | App Store Connect API key cho phased release (khi có #1) | `.p8` + Key ID + Issuer ID (có thể là khoá #8) và Apple ID số của app | secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`; variable `ASC_APP_ID` | GitHub Environment `chat-mobile-production` và `chat-mobile-release-health` | `scripts/mobile-asc-release.mjs` qua `chat-mobile-promote.yml` (`platform: ios`) và job sức khoẻ |
| 27 | Promote bản production giữa các track Play | khoá JSON của service account Google Cloud có quyền phát hành trên `com.uniworkos.chat` (có thể dùng lại khoá #12) | `PLAY_SERVICE_ACCOUNT_JSON` | GitHub Environment `chat-mobile-production` (secret, Required reviewers, tag `chat-mobile-v*` + nhánh `main`) cùng `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN` và variables `SENTRY_ORG`, `SENTRY_PROJECT` | `.github/workflows/chat-mobile-production.yml`, `.github/workflows/chat-mobile-promote.yml` |

Biến tùy chọn của repo: `UNICHAT_APP_URL`, `UNICHAT_API_URL` (repository variables) ghi đè URL production mặc định
`https://uniworkos.com` của bản desktop (`chat-desktop-release.yml`, job `package`).

## 3. Trước khi thêm secret vào GitHub

- Environment `chat-desktop-release`: **Deployment branches and tags → Selected → tag `chat-desktop-v*`**; nên thêm
  Required reviewers (chủ sở hữu). Workflow đã chặn tag trỏ commit ngoài `main`/`develop`, nhưng quy tắc Environment
  là lớp chặn thứ hai cho người có quyền đẩy tag.
- Environment `chat-mobile-release`: giới hạn tag `chat-mobile-v*`, cùng cách.
- Environment `chat-mobile-update` (OTA, chạy tay trên nhánh): **Deployment branches → Selected → `main` và `develop`**
  — không giới hạn tag, vì run OTA chạy trên nhánh và environment giới hạn tag sẽ từ chối nó trước bước đầu.
- Không đặt khóa Apple/Google vào GitHub: chúng ở EAS.

## 4. Kiểm sau khi đặt

- [ ] Desktop: tag `chat-desktop-v0.1.0-beta.1` → release có tệp **không** mang nhãn `unsigned` cho mac và Windows;
      `spctl -a -vv /Applications/UniChat.app` báo `Notarized Developer ID`; Windows: thuộc tính tệp → Digital
      Signatures có tên công ty (`docs/runbooks/unichat-desktop-release.md`).
- [ ] Desktop macOS đã ký nhận bản mới tự động (cài bản cũ, cắt bản mới, mở lại).
- [ ] Mobile: tag `chat-mobile-v0.3.0` (bản `version` hiện tại của `apps/chat-mobile/app.config.ts`) → run xanh, build có
      ở Play internal (và TestFlight khi có #1–#9) (`docs/runbooks/unichat-mobile-release.md`).
- [ ] `gh auth login` (admin) rồi `node scripts/mobile-ci-provisioning.mjs --check` xanh: mọi biến, secret và
      environment mà workflow mobile đọc đã có (tên thiếu in `MISSING`).
- [ ] Push tới iPhone và Android thật (đăng nhập, khóa máy, gửi DM từ web).
- [ ] `https://uniworkos.com/.well-known/apple-app-site-association` và `/assetlinks.json` trả JSON; chạm link
      `https://app.uniworkos.com/{org}/{ws}/chat?room=…` trên điện thoại mở app.
- [ ] Tên app trên App Store Connect đã giữ — ghi tên cuối cùng ("UniChat" hoặc "UniWork Chat") vào UNI-1838.

**Ghi chú Windows — quan trọng trước khi mua:** từ 2023-06-01 CA/Browser Forum bắt khóa riêng của chứng chỉ ký mã,
**cả OV lẫn EV**, nằm trên phần cứng (token USB hoặc HSM đám mây); CA không còn phát tệp `.pfx` xuất được. Workflow
hiện tại chỉ biết ký bằng tệp (`WIN_CSC_LINK` → electron-builder), nên với chứng chỉ mua mới, hàng #17 không dùng được
như đang viết. Chọn một trong hai rồi sửa bước ký Windows của `chat-desktop-release.yml` + `electron-builder.ts`
trong một PR riêng (UNI-1879): (a) dịch vụ ký đám mây của CA (DigiCert KeyLocker, SSL.com eSigner, Certum SimplySign…) gọi
qua hook `win.signtoolOptions.sign` của electron-builder; (b) Azure Trusted Signing (`win.azureSignOptions`) nếu
pháp nhân đủ điều kiện ở khu vực được hỗ trợ. Tên secret sẽ theo dịch vụ chọn; ghi lại vào bảng trên khi chốt.

## 5. Diễn tập dừng và quay lại (trước người thử ngoài đầu tiên)

Đường dừng/quay lại chỉ đáng tin khi đã thấy nó chạy một lần trên tài khoản thật (audit "observability-not-provisioned").
Làm theo thứ tự, mỗi bước dán link run GitHub (hay ảnh Sentry/Play) vào bình luận UNI-1838:

- [ ] Sentry (#25, #28): bản `preview` mới có DSN; mở app, gây một crash thử từ build dev (`Sentry.nativeCrash()` trong
      console Metro của bản dev client trỏ cùng DSN) → issue có release `com.uniworkos.chat.staging@<version>+<build>.android`
      và stack đã giải nhờ source map.
- [ ] "UniChat mobile release health" chạy tay với `sync_alerts` (không `dry_run` không cần): summary ghi `created` cho
      bốn alert của `deploy/sentry/unichat-mobile-alerts.json`; lượt chạy theo giờ sau đó ghi `ok` cho cả bốn.
- [ ] Rebuild bản production có chứng chỉ OTA qua `chat-mobile-production.yml` (không build tay: bản 2026-10-21 nằm
      ngoài gate, không đưa lên track nào người dùng thấy) → bước kiểm release Sentry xanh → submit lên internal.
      Owner: trong Expo (Project settings › Members/Roles) chỉ để robot token của CI và owner có quyền build, để bản
      production chỉ ra từ workflow.
- [ ] "UniChat mobile promote": internal → alpha (`status: inProgress`, `rollout: 0.2`), rồi `action: halt` →
      Play Console thấy release alpha ở trạng thái Halted; chạy lại halt → run xanh, ghi `already halted`.
- [ ] "UniChat mobile release health" chạy tay (`dry_run` bật) → summary liệt kê release production/staging với số
      phiên, số người; không có lỗi đọc Sentry hay Play vitals (cảnh báo vitals = service account thiếu quyền).
- [ ] OTA kênh `internal` 10 % qua "UniChat mobile OTA update" → "UniChat mobile rollback" `revert-rollout`
      (`dry_run` trước, rồi thật) → `eas update:list --branch internal` có group revert mới nhất. Rồi một OTA 100 % và
      `republish-previous` → máy thử nhận lại bản trước ở lần mở sau.
- [ ] Prometheus: `uniwork_mobile_events_total{event="app_open"}` có dữ liệu của bản thử; alert
      `UniChatMobileCrashes`, `UniChatMobileUpdateLaunchFailures`, `UniChatMobileSendFailures` có trong Alertmanager
      (trạng thái inactive).
