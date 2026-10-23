# UniChat mobile — Cấu hình build và bảo mật của config

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

`app.config.ts`, biến build, bundle id, ký OTA, sao lưu Android, ghim TLS. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- `app.config.ts` — cấu hình duy nhất, không `app.json`, **không `.env`**
  (pre-commit từ chối). Biến build: `UNICHAT_ENV` (`dev`|`staging`|`production`),
  `UNICHAT_API_URL`, `UNICHAT_APP_URL` (bắt buộc với staging/production: thiếu
  thì config ném lỗi trên máy build EAS (`EAS_BUILD=true`) thay vì ship bản trỏ
  `localhost`; ngoài đó đọc là chuỗi rỗng, vì eas-cli đọc config một lần để lấy
  project id trước khi nạp môi trường EAS chứa URL), `UNICHAT_EAS_PROJECT_ID`
  (ghi đè hằng `EAS_PROJECT_ID`), `GOOGLE_SERVICES_JSON` (biến EAS kiểu file →
  `android.googleServicesFile`; thiếu thì Android không lấy được push token),
  `SENTRY_DSN` (→ `extra.sentryDsn`; thiếu thì không khởi động Sentry), `UNICHAT_IOS_CALLS` (`1` thì bản iPhone
  khai `UIBackgroundModes: audio` và hiện giao diện gọi; thiếu thì iPhone không bao giờ hiện gọi, dù flag
  `unichat_mobile_calls_ios` bật; `app.config.ts › iosCallsBuilt` từ chối `1` khi `modules/unichat-calls` chưa có phần
  iOS), `UNICHAT_CRITICAL_UPDATE` (chỉ workflow OTA đặt, xem `release.md`), `UNICHAT_PERF_MARKS`, `UNICHAT_TLS_PIN*`
  (dưới), `EXPO_BUNDLE_IDENTIFIER_*`/`EXPO_APPLE_TEAM_ID` (ghi đè, hiếm dùng); mọi biến ấy có dòng trong khối "UniChat
  mobile (build-time)" của `.env.example` (`app.config.test.ts › the build variables app.config.ts reads`);
  kết quả nằm ở `extra` (`apiUrl`,
  `appUrl`, `authClientId=uniwork-chat-mobile`, `deploymentId`, `eas.projectId`
  khi có dự án EAS, `sentryDsn`) và app gọi `configureRuntime()` lúc boot.
  `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` chỉ là biến môi trường của
  build (plugin `@sentry/react-native/expo` không nhận tham số nào ngoài `url`),
  để fingerprint không đổi theo chúng. Ngôn ngữ: plugin `expo-localization` khai `supportedLocales: ["vi", "en"]`
  (iOS `CFBundleLocalizations`, Android 13+ `locales_config.xml`) và `ios.infoPlist.CFBundleDevelopmentRegion: "vi"`
  (chuỗi xin quyền gốc tiếng Việt, `locales.en` dịch). Bundle id
  `com.uniworkos.chat{.dev,.staging}`, scheme `uniworkchat-dev` (dev) / `uniworkchat`; universal link chỉ xác minh
  với id prod.
  Bảo mật của config (audit "Security & privacy"): staging/production chỉ nhận `UNICHAT_API_URL`/`UNICHAT_APP_URL`
  `https://` (ném lỗi ở mọi nơi đọc config; socket là `wss://` suy từ API), và `transport.start` chỉ mở trang đăng nhập
  cùng origin với `appUrl`; chứng chỉ ký OTA `certs/eas-update-certificate.pem` đã commit (2026-10-22, hạn 10 năm,
  `app.config.test.ts` giữ nó là chứng chỉ code-signing thật còn ≥ 2 năm), mọi biến thể nhúng nó; bản staging hay
  production trên máy build EAS thiếu nó thì ném lỗi (binary không ký OTA không bao giờ được build lại). Android: `allowBackup: false` + `plugins/with-android-backup-rules.js`
  (data extraction rules loại mọi vùng khỏi sao lưu đám mây và chuyển máy, Android 12+), `READ_/WRITE_EXTERNAL_STORAGE`
  bị chặn; `android-manifest.test.ts` giữ thuộc tính `application` (không cleartext, không network security config).
  Ghim khoá TLS sẵn sàng nhưng tắt: `UNICHAT_TLS_PINS` (≥ 2 SPKI SHA-256 base64: CA hiện tại + dự phòng) và
  `UNICHAT_TLS_PIN_EXPIRES` (YYYY-MM-DD, tương lai) trong môi trường EAS bật `plugins/with-tls-pins.js` cho host của
  API và web, cộng các host `UNICHAT_TLS_PIN_HOSTS` kê (hostname trần, phẩy ngăn: host signalling LiveKit, nơi token
  vào cuộc gọi đi qua; chuỗi chứng chỉ của nó phải kết thúc ở một trong các pin) (Android `pin-set` có hạn, iOS
  `NSPinnedDomains` không hạn); host sai dạng thì config ném lỗi; thiếu một nửa, một pin, pin sai dạng hay ngày
  đã qua thì config ném lỗi; không bao giờ cho dev (`app.config.ts › tlsPinning`, runbook › Khắc phục 19). Baseline
  OWASP MASVS L1 và cái giữ từng kiểm soát: `docs/engineering/unichat-mobile-masvs.md` — đổi một kiểm soát thì sửa dòng
  của nó cùng PR.
