# UniChat M4 — Phát hành mobile: EAS, TestFlight/Play internal, OTA, Maestro — Kế hoạch triển khai

> **Trạng thái:** in-progress — phase 1 merge vào develop 2026-10-17 qua PR #343 (squash aab341175); phase 2 (ba luồng vàng) chưa làm, M3 (UNI-1834) đã vào develop qua PR #345. Issue UNI-1836.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một tag `chat-mobile-v*` build iOS và Android qua EAS và nộp lên TestFlight và Play internal; sửa JS phát qua EAS Update mà không áp nhầm vào bản native khác; ba luồng vàng chạy Maestro hằng đêm trên simulator iOS và emulator Android.

**Architecture:** `apps/chat-mobile/eas.json` mô tả bốn profile; `app.config.ts` vẫn là cấu hình duy nhất (thêm `runtimeVersion`, `updates`, `extra.eas.projectId` — trống tới khi có tài khoản EAS, khi đó OTA tắt và push bỏ qua như hôm nay). Hai workflow mới: `chat-mobile-release.yml` (tag → `eas build --auto-submit`, môi trường `chat-mobile-release`) và `chat-mobile-verify.yml` (nightly, build Release cho simulator/emulator ngay trên runner GitHub, không qua EAS, chạy Maestro với server staging). Mọi job cần bí mật tự bỏ qua kèm `::notice::` khi bí mật vắng, nên CI xanh khi chưa có tài khoản (UNI-1838).

**Tech Stack:** Expo SDK 57, `expo-updates ~57.0.26`, EAS CLI (cài qua `expo/expo-github-action`), Maestro (flow YAML), `reactivecircus/android-emulator-runner`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-mobile-release-design.md`; spec cha `2026-10-16-chat-native-apps-design.md` §6 M4, §9, §10.

## Global Constraints

- Không tạo dự án EAS, không đẩy tag, không chạy lệnh `eas` cần đăng nhập. Không bí mật trong repo (gitleaks); id dự án EAS không phải bí mật và sẽ được commit khi có.
- Chỉ `app.config.ts` đọc biến build (`apps/chat-mobile/CLAUDE.md`); không `.env`. Id dự án EAS nằm ở hằng `EAS_PROJECT_ID` (trống tới khi có tài khoản), `UNICHAT_EAS_PROJECT_ID` ghi đè (`""` tắt EAS) — vì `eas update` không nhận `env` của profile build.
- Bản `staging`/`production` thiếu `UNICHAT_API_URL` hoặc `UNICHAT_APP_URL` thì `app.config.ts` ném lỗi: một bản store trỏ `localhost` là bản hỏng, phải đỏ lúc build chứ không lúc người dùng mở app.
- Workflow theo kiểu của repo (D2 `chat-desktop-release.yml`): `permissions: contents: read`, `persist-credentials: false`, môi trường GitHub cho bí mật phát hành, commit được tag phải nằm trên `main` hoặc `develop`. Thêm `!.github/workflows/<file>` vào `.gitignore` gốc (dòng `.github/workflows/*`).
- Runbook trong `docs/runbooks/` theo `scripts/alerts-runbooks.test.mjs`: dòng 3 là `> **Trạng thái:** shipped`, đúng bốn H2 Triệu chứng → Kiểm tra → Khắc phục → Leo thang, đăng ký trong `OPERATOR_RUNBOOKS` và bảng runbook vận hành của README.
- Không chép tên thương hiệu usf (`scripts/no-usf-leak.test.mjs`).
- Kiểm hẹp: `pnpm --filter @uniwork/chat-mobile test|lint|typecheck`, `pnpm knip`, `node --test` các `scripts/*.test.mjs` liên quan, `expo config --type public` cho từng `UNICHAT_ENV`. Không `make check`, không build native, không chạy thiết bị.

## Quyết định builder (spec §5)

| Mục | Chọn | Lý do |
|---|---|---|
| **Maestro đăng nhập thế nào** | Đi qua **sheet trình duyệt hệ thống thật** (ASWebAuthenticationSession trên iOS, Custom Tab của Chrome trên Android) bằng một tài khoản thử trên server staging; subflow `maestro/subflows/login.yaml` chạm "Đăng nhập", nhận hộp thoại "Continue" của iOS, điền email/mật khẩu nếu trang login hiện, bấm cho phép ở trang consent rồi chờ app vào workspace. **Không có lối tắt phiên thử nghiệm ở phase 1.** | Chạy đúng đường người dùng đi (PKCE, consent, callback), không thêm mã nào vào app hay server. Lối tắt chỉ được cân nhắc ở phase 2 khi 5 đêm cho thấy chính sheet là nguồn đỏ; khi đó ràng buộc là: chỉ có trong bản `UNICHAT_ENV=dev` (quyết lúc build trong `app.config.ts`, không phải cờ runtime), token phải do server thật cấp qua đúng luồng PKCE (CI tự đổi code lấy token), không route server mới, và `app.config.test.ts` chứng minh cấu hình staging/production không mang nó. |
| Giả push trong Maestro | Hai lớp. **Định tuyến** (cả hai nền tảng): flow `push-open-room.yaml` mở đúng URL mà server đặt ở `data.url`, bọc `uniworkchat://open?url=` (`openLink`) — đi qua `parseDeepLink` → `deepLinkHref` như chạm thông báo. **Listener thông báo** (iOS): workflow chạy `xcrun simctl push` với payload dạng Expo (`body.url` và `url` gốc), Maestro mở Notification Center và chạm thông báo (`PUSH_DELIVERED=true`). Android không nhận được FCM giả từ `adb`; push thật từ staging (một tài khoản thứ hai gửi DM) là phase 2, cần `UNICHAT_EAS_PROJECT_ID` và FCM. | Không có cách giả FCM trên emulator mà không có khoá dự án; `simctl push` thì đi qua đúng `addNotificationResponseReceivedListener`. |
| Profile `preview` | **Có**: `distribution: internal`, Android APK, kênh `preview`, `UNICHAT_ENV=staging`. Chạy tay, không trong workflow. | Spec §4: tới khi có Play Console/ASC, pilot cài qua link EAS internal distribution; APK Android chỉ cần tài khoản EAS. `internal` là profile store (TestFlight/Play internal) nên không thay được. |
| Version / build number | `version` trong `app.config.ts` là version duy nhất và là `runtimeVersion` (`policy: appVersion`). Tag `chat-mobile-v<version>` phải bằng nó (workflow kiểm). Đổi native (gói native mới, plugin, quyền, nâng SDK) → bump `version`; sửa chỉ JS → OTA, không bump. Build number (`ios.buildNumber`, `android.versionCode`) do EAS giữ (`cli.appVersionSource: remote`, `autoIncrement` trên profile store) — không commit theo bản. | Một nguồn version; OTA cũ không áp được vào bản native mới vì runtimeVersion khác. |
| Backend của nightly | Server **staging** + một org/workspace/phòng thử và tài khoản thử, tên ở `vars`/`secrets` của repo (danh sách ở runbook). Thiếu → job bỏ qua với `::notice::`. Bản nightly là `UNICHAT_ENV=staging` build Release (JS nhúng, không Metro), ký ad-hoc trên simulator. | Gần bản phát hành nhất; không cần dựng server trong CI. Staging phải cho phép `uniworkchat://auth/callback` trong `DESKTOP_AUTH_CLIENTS`. |
| Bí mật nộp store | ASC API key và Google service account key **tải lên EAS credentials** (`eas credentials`), GitHub Environment `chat-mobile-release` chỉ giữ `EXPO_TOKEN`. | Không ghi file khoá ra runner; spec §2 cho phép bí mật ở EAS. |
| Kênh OTA | Profile → kênh cùng tên: `development`, `preview`, `internal`, `production`. Môi trường EAS: `development` / `preview` (preview, internal) / `production`. | Spec §2 cần `internal`, `production`; hai kênh kia đi kèm profile của chúng. |
| Nộp `production` | Android track `production` với `releaseStatus: draft`; iOS lên App Store Connect (TestFlight), phát hành App Store bấm tay. | Phát hành public store là quyết định Q1 sau pilot; không gì tự lên store. |
| Phiên bản Maestro | Cài bản mới nhất từ script chính thức. `shortcut:` ghim phiên bản sau đêm xanh đầu tiên. | Không biết bản nào chạy với Xcode 27/iOS 27 trước khi chạy thật. |

## Review Focus

1. Không job nào cần tài khoản làm đỏ CI khi bí mật vắng: release skip ở bước gate, nightly skip ở job `gate`.
2. `app.config.ts`: thiếu `UNICHAT_EAS_PROJECT_ID` → `updates.enabled: false`, không `extra.eas`; có → `updates.url = https://u.expo.dev/<id>`, `extra.eas.projectId`; `runtimeVersion` luôn `{policy: "appVersion"}`; staging/production thiếu URL → ném lỗi — `app.config.test.ts`.
3. Tag khác `version` của app → workflow release đỏ trước khi gọi EAS.
4. Runbook có rollback OTA (`eas update:republish` / `eas update:rollback`) và rollback bản store.

---

## Phase 1 (xong 2026-10-17)

### Task 1: Plan, spec, issue

- [x] `make issue-start KEY=UNI-1836`; spec `Trạng thái` → in-progress (nhánh, phase); plan này.

### Task 2: `app.config.ts` + `expo-updates` (test trước)

**Files:** `apps/chat-mobile/app.config.ts`, `apps/chat-mobile/app.config.test.ts`, `apps/chat-mobile/package.json`, `pnpm-lock.yaml`

- [x] Test: Review Focus 2 (đỏ trước).
- [x] `pnpm --filter @uniwork/chat-mobile exec expo install expo-updates` (expo install gọi npm trong workspace pnpm và hỏng — thêm dòng `expo-updates ~57.0.26` vào `package.json` rồi `pnpm install` để cập nhật lockfile; `knip.json` bỏ qua `expo-updates` vì plugin expo của knip đọc config dev, nơi updates tắt); `runtimeVersion`, `updates`, `extra.eas`, chặn URL thiếu.
- [x] `expo config --type public` cho `dev`, `staging`, `production`, có và không có `UNICHAT_EAS_PROJECT_ID`.

### Task 3: `eas.json`

**Files:** `apps/chat-mobile/eas.json`

- [x] `cli` (`appVersionSource: remote`), `build.base` (pnpm 10.28.2), `development` (dev client, internal, simulator iOS), `preview`, `internal` (store, autoIncrement), `production`; mỗi profile `env.UNICHAT_ENV`, `channel`, `environment`. `submit.internal` (Android `track: internal`; iOS điền `ascAppId` khi có app trên ASC), `submit.production` (Android `production` + `draft`).

### Task 4: Workflow phát hành

**Files:** `.github/workflows/chat-mobile-release.yml`, `.gitignore`

- [x] Tag `chat-mobile-v*`, môi trường `chat-mobile-release`, gate `EXPO_TOKEN` (notice + thoát xanh), commit trên `main`/`develop`, tag = `version`, cài `--filter "@uniwork/chat-mobile..."`, `expo/expo-github-action`, `eas build --platform all --profile internal --non-interactive --auto-submit`.

### Task 5: Nightly Maestro + flow

**Files:** `.github/workflows/chat-mobile-verify.yml`, `apps/chat-mobile/maestro/{config.yaml,subflows/login.yaml,flows/login.yaml,flows/push-open-room.yaml}`, `.gitignore`

- [x] Workflow: `schedule` + `workflow_dispatch`; job `gate` (vars/secrets đủ → `ready`); `ios` (macos, prebuild, pod install, `xcodebuild` Release simulator ký ad-hoc, boot simulator, Maestro, `simctl push` rồi flow push); `android` (prebuild, `assembleRelease`, `android-emulator-runner`, Maestro); upload báo cáo Maestro.
- [x] Flow: subflow đăng nhập (sheet thật), flow `login` (đăng nhập → thấy tab Chat), flow `push-open-room` (khung: định tuyến tới phòng; khẳng định tên phòng là phase 2).

### Task 6: Runbook, tài liệu store, CLAUDE.md

**Files:** `docs/runbooks/unichat-mobile-release.md`, `docs/runbooks/README.md`, `scripts/alerts-runbooks.test.mjs`, `apps/chat-mobile/store/listing.md`, `apps/chat-mobile/CLAUDE.md`

- [x] Runbook: cắt bản, nộp, OTA, rollback (OTA và store), thiết lập lần đầu (EAS, ASC, Play, GitHub Environment, staging cho nightly).
- [x] Store: mô tả vi/en, privacy labels (Apple) + Data safety (Google), lý do từng quyền, tài khoản demo cho review.
- [x] `apps/chat-mobile/CLAUDE.md` mục Phát hành.

### Task 7: Kiểm và PR

- [x] `pnpm --filter @uniwork/chat-mobile test|lint|typecheck` (285 test, coverage 100 %); `pnpm knip`; `node --test scripts/{governance,no-usf-leak,catalog-check,alerts-runbooks,mobile-core-allowlist}.test.mjs` (28/28); `expo config --type public` cho dev, staging, production (thiếu URL → lỗi; có id → `updates.url`, `extra.eas`); YAML của hai workflow và ba flow parse được (Ruby Psych); bước gate của hai workflow chạy thử có/không bí mật. `actionlint`, `maestro`, `gitleaks` không có trên máy — chưa chạy. Không build native, không chạy thiết bị.
- [x] Plan đánh dấu phase 1 xong; `make issue-pr KEY=UNI-1836`; body PR; ghi chú `[agent]` trên issue.

## Phase 2 (sau khi M2a, M3 lên `develop`)

### Task 8: Ba luồng vàng thật

- [ ] Thêm `testID` ở các màn M2a/M3 mà flow cần (danh sách hội thoại, ô soạn, nút gửi, nút gọi) — chọn bằng id, không bằng chữ.
- [ ] `flows/chat-read-send.yaml`: đăng nhập → mở phòng thử → thấy tin seed → gửi một tin có dấu thời gian → thấy nó trong luồng.
- [ ] `flows/push-open-room.yaml`: khẳng định header là tên phòng thử; Android: push thật từ staging (Maestro `runScript` gọi API với tài khoản thứ hai) khi đã có dự án EAS + FCM.
- [ ] `flows/call-join.yaml`: vào cuộc gọi của phòng thử (quyền mic/camera: `launchApp.permissions`), thấy màn trong cuộc gọi, rời.
- [ ] Lần chạy thật đầu tiên xác nhận các giả định phase 1 chưa kiểm được: Maestro tự đọc biến `MAESTRO_*`; `-e PUSH_DELIVERED=true` thắng `env` mặc định của flow (ảnh chụp cho thấy chạm thông báo, không phải `openLink`); Maestro cấp quyền thông báo cho app trên simulator (bản staging không tự xin vì chưa có dự án EAS); hộp thoại "Continue" của iOS chạm được; image `google_apis` có Chrome cho Custom Tab; runner `macos-26` có Xcode 27.
- [ ] Ghim phiên bản Maestro; đo 5 đêm liên tiếp xanh trên cả hai nền tảng; nếu sheet đăng nhập là nguồn đỏ thì cân nhắc lối tắt dev theo ràng buộc ở bảng quyết định.

### Task 9: Khi có tài khoản (UNI-1838)

- [ ] Làm theo "Thiết lập lần đầu" trong runbook; ghi id vào hằng `EAS_PROJECT_ID` và `ascAppId` vào `eas.json`; tag `chat-mobile-v0.1.0` đầu tiên; kiểm tiêu chí spec §3 (hai bản trên TestFlight/Play internal, OTA áp ở lần mở sau, bản native mới không nhận OTA cũ).
- [ ] Bản EAS đầu tiên: `pnpm install` của EAS chạy `prepare` của mọi workspace (`packages/office-upstream` dựng engine Office) — nếu chậm hoặc hỏng thì thu hẹp bằng `.easignore` hoặc hook `eas-build-pre-install`, không đổi luật workspace.
- [ ] Plan → shipped khi tiêu chí §3 đạt.
