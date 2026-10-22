# UniChat mobile — Phát hành

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Profile EAS, version và runtime, workflow phát hành và OTA, sức khoẻ bản phát hành, Maestro, icon. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

### Phát hành (M4, UNI-1836)

Runbook: `docs/runbooks/unichat-mobile-release.md`; plan:
`docs/superpowers/plans/2026-10-17-unichat-mobile-release.md`.

- `eas.json`: `development` (dev client), `preview` (cài trực tiếp, pilot trước
  store), `internal` (TestFlight + Play internal, staging), `production`. Mỗi
  profile ghim `UNICHAT_ENV`, kênh OTA cùng tên và môi trường EAS chứa URL
  server. Build number do EAS giữ (`appVersionSource: remote`), không commit.
- `version` trong `app.config.ts` là version store (0.3.0); `runtimeVersion` là
  `policy: fingerprint` (hash phần native; `fingerprint.config.js` bỏ `extra`
  ra khỏi hash để URL, DSN không tách runtime): đổi native (gói native, plugin,
  quyền, SDK) thì bump `version` và cắt bản store — quên bump thì OTA cũng
  không khớp máy nào; chỉ đổi JS thì phát OTA. Chưa có `EAS_PROJECT_ID` thì
  `updates.enabled: false` và push bỏ qua. Ký OTA: `certs/eas-update-certificate.pem` đã commit nên
  `updates.codeSigningCertificate` luôn bật (khoá riêng không bao giờ vào repo; runbook › Ký OTA); thiếu nó thì build
  staging/production trên EAS đỏ, và `chat-mobile-update.yml` không phát OTA không ký trên kênh nào.
  `eas.json` đặt `SENTRY_ALLOW_FAILURE=true` cho mọi profile: build thiếu token
  Sentry vẫn xanh. Bản store production phát theo giai đoạn (Play 5 % → 100 %,
  iOS phased release), mở rộng chỉ khi crash-free sessions ≥ 99.5 % (runbook ›
  Phát hành production theo giai đoạn); `submit.production.android` là `draft`
  tới khi app Play công khai, rồi `inProgress` + `rollout: 0.05`.
  Ngoại lệ của knip (gói giữ lại dù knip coi là không dùng) ghi ở `apps/chat-mobile/CLAUDE.md` › Ngoại lệ của knip.
- Tag `chat-mobile-v<version>` → `.github/workflows/chat-mobile-release.yml`:
  job `verify` gọi `mobile-verify.yml` trên SHA của tag với `force_native: true`
  (luôn build Android native và chạy smoke, kể cả tag đẩy lại; không có `ios: true` nên
  `ios-release` không chặn một bản chỉ Android — output `ios` của job scope,
  `scripts/mobile-verify-gate.mjs`), rồi EAS build +
  auto-submit **chỉ Android** (Play internal) tới khi có tài khoản Apple
  (UNI-1838), `eas-cli` ghim ở `EAS_CLI_VERSION`. Environment
  `chat-mobile-release`, chỉ `EXPO_TOKEN`; thiếu thì **đỏ** (một tag không build gì không được trông như một bản phát hành).
- Bản production (app `com.uniworkos.chat`) build một lần và chính binary đó đi qua các track:
  `.github/workflows/chat-mobile-production.yml` (chạy tay trên tag `chat-mobile-v*` của `main`, Environment
  `chat-mobile-production` có reviewer): `verify` → tag khớp `version` và có "Có gì mới" ở
  `store/release-notes.md` (vi-VN + en-US ≤ 500 ký tự, `scripts/mobile-release-notes.test.mjs` đỏ khi version hiện tại
  thiếu) → báo crash bắt buộc (DSN trong môi trường EAS `production` + thiết lập Sentry để kiểm; đỏ trừ khi tick
  `allow_missing_crash_reporting`) → `eas build --profile production --wait` → Sentry phải có release
  `com.uniworkos.chat@<version>+<version code>` (bằng chứng source map/symbol đã tải) → `eas submit --profile
  production-internal --id <build>` (internal track của app production). `.github/workflows/chat-mobile-promote.yml`
  chuyển **version code** đó sang alpha/beta/production, mở rộng hay dừng rollout qua
  `scripts/mobile-play-release.mjs` (Play Developer API, chỉ built-in của Node; chỉ nhận bản đã live trên track nguồn;
  `PLAY_SERVICE_ACCOUNT_JSON`). Không workflow nào khác build profile `production` cho store.
- Sức khoẻ bản phát hành: `.github/workflows/chat-mobile-release-health.yml` mỗi giờ (bật bằng biến repo
  `UNICHAT_RELEASE_HEALTH=on`) chạy `scripts/mobile-release-health.mjs`: crash-free sessions 24 giờ của từng release
  production trong Sentry (mỗi bản OTA là một release riêng, `lib/build-info.ts › sentryRelease`); < 99.5 % trên ≥ 200
  phiên (hay < 98 % trên ≥ 50) thì revert rollout của OTA đó hoặc halt rollout Play của bản store, run đỏ.
- OTA: `.github/workflows/chat-mobile-update.yml` (chạy tay trên `main`/`develop`:
  kênh, tỷ lệ rollout, message; Environment `chat-mobile-update`, giới hạn hai
  nhánh đó) → `verify` trên SHA → `eas update --platform android
  --rollout-percentage` với môi trường EAS **và `UNICHAT_ENV`** của profile build
  kênh đó (`eas update` không đọc `env` của profile; thiếu là cấu hình dev,
  fingerprint không khớp bản store nào — bước kiểm `extra.APP_ENV` đỏ), ký bằng
  `EAS_UPDATE_PRIVATE_KEY` khi app có chứng chỉ, rồi tải source map lên Sentry;
  thiếu `EXPO_TOKEN` thì **đỏ** (người bấm cần biết); kênh `production` thiếu DSN hay thiết lập tải source map cũng
  **đỏ** trừ khi tick `allow_missing_crash_reporting`. Input `critical` đặt `UNICHAT_CRITICAL_UPDATE=1` →
  `extra.criticalUpdate` trong manifest (ngoài fingerprint): `data/updates-controller.ts` (khởi ở `data/app-startup.ts`)
  hỏi lại EAS khi quay lại foreground (một phút sau lúc mở, rồi ≥ 30 phút một lần), tải, và chỉ bản critical hay lệnh
  roll-back-to-embedded mới được áp dụng — khi app đã ở nền liên tục `APPLY_AFTER_AWAY_MS` (1 phút; Android cho JS chạy
  ở nền), hay lúc quay lại sau ≥ `APPLY_ON_RETURN_MS` (10 phút; iOS đóng băng JS nên hẹn giờ không chạy), không có
  cuộc gọi và không có màn hệ thống mà app đang chờ (`data/system-ui.ts › whileSystemUiOpen`: trang đăng nhập, chọn
  ảnh/tệp, hộp xin quyền — Android đưa app vào nền khi chúng mở, nên chuyến ra ngắn không bao giờ reload); còn lại chờ
  lần mở lạnh sau. Màn hệ thống mới mà app chờ kết quả thì bọc bằng `whileSystemUiOpen`. Không phát OTA từ laptop
  trừ khi CI hỏng (runbook).
  `scripts/mobile-workflows.test.mjs` giữ các lời hứa của các workflow mobile (verify
  trước EAS, chỉ Android, phiên bản ghim, nightly đỏ khi thiếu cấu hình, OTA
  staged và ký, đúng biến thể của kênh, môi trường riêng; mọi job build Release
  trên runner tắt upload Sentry); sửa workflow nào trong bốn cũng kích `mobile-verify.yml` nên
  test đó luôn chạy.
- `maestro/`: `subflows/sign-in.yaml` đăng nhập qua sheet trình duyệt thật (không
  có lối tắt phiên thử nghiệm trong bản nào); `flows/call-answer-incoming.yaml` (khung, chạy tay: cần tài khoản thứ
  hai gọi qua `scripts/ring-from-caller.js` và máy có FCM thật; chưa nằm trong workflow nào), cũng chạy tay
  `flows/background-resume.yaml` (người kia viết qua `scripts/post-as-peer.js` khi app ở nền, trong và quá cửa sổ ân
  hạn của socket); ba luồng vàng `flows/{chat-read-send,push-open-room,call-join}.yaml` và, chỉ Android (Maestro bật
  chế độ máy bay ở đó), `flows/offline-send-relaunch.yaml` (tin viết offline sống qua kill, mở lạnh offline từ cache,
  tới đúng thứ tự mỗi tin một lần), cùng ba bước đo `flows/perf-{open-room,scroll-room,jump-quote}.yaml` (cú nhảy
  tới trích dẫn xa phải tới đúng tin) chạy hằng đêm bởi
  `.github/workflows/chat-mobile-verify.yml` với server staging (biến
  `MAESTRO_*`; thiếu thì run theo lịch **đỏ**, chạy tay bỏ chọn `maestro` để chỉ
  build), Maestro ghim `MAESTRO_VERSION`; cùng đêm đó job `android-production`
  build AAB release từ profile production, không cần secret. Trong app flow chọn theo `testID`
  (`room-row-<roomId>`, `conversation-<roomId>`, `composer-input`,
  `composer-send`, `room-call-*`, `call-*`, `connection-banner-{offline,connecting}`, `message-quote`,
  `message-highlighted`) — đổi tên một id thì sửa flow cùng
  PR; trang web trong sheet đăng nhập thì theo chữ vi|en. `lib/maestro-flows.test.ts` đỏ khi một chữ trong ngoặc kép của
  flow không khớp (regex, cả chuỗi) chuỗi nào của `locales/` hay locale web ở cả vi lẫn en, hay một `id:` không có
  testID nào trong `app/`/`components/` (giá trị không phải chữ của app ghi ở `NOT_COPY` kèm lý do).

- `assets/icon.png`, `assets/adaptive-icon*.png`, `assets/notification-icon.png` — icon UniChat 1024², lớp
  monochrome cho icon theo theme của Android 13+ và glyph một màu trên thanh trạng thái (96 px, chỉ kênh alpha;
  `expo-notifications` ghi thành drawable `notification_icon` mà thông báo cuộc gọi cũng dùng, tô màu `#0044E3`), sinh
  bởi `pnpm brand:build` từ `packages/ui/brand/svg/unichat-*.svg`; không
  sửa tay (`assets.lock.json` khoá hash nguồn). `icon.png` không có kênh alpha.
