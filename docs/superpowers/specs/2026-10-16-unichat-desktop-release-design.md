# UniChat — Đóng gói và phát hành desktop (lát D2)

> **Trạng thái:** shipped — merge vào develop 2026-10-17 qua PR #339 (squash 0c72b9b15); plan `../plans/2026-10-17-unichat-desktop-release.md`; chạy thật tag → release, smoke cài/cập nhật trên máy sạch và ký số còn lại cho Q1 (UNI-1838). Lát D2 của epic UNI-1826; issue UNI-1835.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §3.1, §6 D5, §10 · **Tiền lệ:** `scripts/office/installer-urls.mjs` (+ test), `packages/core/office/desktop-platform.ts` (`DESKTOP_INSTALLER_KINDS`), `server/internal/service/office_desktop_*` (parser `OFFICE_INSTALLER_<CHANNEL>_URLS`), `uniwork-office/.github/workflows/release-installers.yml`

## 1. Mục tiêu
Một tag `chat-desktop-v*` tạo bản cài macOS (arm64, x64), Windows (x64), Linux (deb, AppImage) trên GitHub Releases kèm SHA256SUMS và feed auto-update; bản dev chưa ký dùng được cho pilot; ký/notarize tự bật khi có secrets.

## 2. Thiết kế
- **electron-builder** (`apps/chat-desktop/electron-builder.yml`): `appId: com.uniworkos.chat`, `productName: UniChat`, mac `dmg` + `zip` (zip cần cho electron-updater) cho `arm64` và `x64`, win `nsis` x64, linux `deb` + `AppImage`; tên tệp theo khóa `DESKTOP_INSTALLER_KINDS` (`win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64-deb`, `linux-x64-appimage`) để `installer-urls.mjs` ánh xạ được; ~~`publish: github`~~ → `publish: generic` trên release cuộn `chat-desktop-feed` (plan 2026-10-17: provider `github` của electron-updater bỏ qua tag `chat-desktop-v…` không phải semver và đọc release "latest" của cả repo, đang là bản Office).
- **Kênh** theo hậu tố tag: `chat-desktop-v1.2.3` → stable, `-beta.N` → beta, `-dev.N` → dev; `electron-updater` `channel` tương ứng (`latest.yml`, `beta.yml`, `dev.yml`). Windows/Linux tự cập nhật ngay; macOS chỉ khi có chữ ký (Squirrel.Mac) — tới đó thông báo "có bản mới" + link tải.
- **Workflow** `.github/workflows/chat-desktop-release.yml`: trigger tag; matrix `macos-14` (hai kiến trúc), `windows-latest`, `ubuntu-latest`; Node 22, pnpm 10.28 như CI; `pnpm --filter @uniwork/chat-desktop package`; SHA256SUMS theo nền tảng; upload release; bước ký/notarize có `if: secrets` (GitHub Environment `chat-desktop-release`: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`); bước cuối chạy `installer-urls.mjs` (tổng quát hóa tiền tố tệp) và đính `installer-urls.env` vào release — giá trị `UNICHAT_INSTALLER_<CHANNEL>_URLS` cho deploy (lát L1).
- **Runbook** `docs/runbooks/unichat-desktop-release.md`: tạo tag, kiểm release, rollback (gỡ release/đổi `latest.yml`), ký lần đầu.

## 3. Tiêu chí hoàn thành và test
- Tag dev.1 → release đủ 5 tệp + 2 zip mac + SHA256SUMS; cài và mở trên máy sạch ba hệ điều hành với hướng dẫn "chưa ký" (như Office: `mac_unsigned`, `win_exe_unsigned`).
- Windows/Linux dev.1 → dev.2 tự cập nhật; macOS hiện thông báo; khi có secrets ký: macOS tự cập nhật, notarize qua.
- `scripts/office/installer-urls.test.mjs` (hoặc bản UniChat) ánh xạ tên tệp → khóa; `apps/chat-desktop/scripts/package.test.mjs` kiểm cấu hình; `gitleaks` sạch.

## 4. Rủi ro
Ký macOS cần Apple Developer (lát Q1); Windows SmartScreen cảnh báo bản chưa ký — chấp nhận ở pilot.

## 5. Để builder quyết
Có portable zip Windows không; cách đưa `installer-urls.env` vào deploy (tay hay repo deploy).
