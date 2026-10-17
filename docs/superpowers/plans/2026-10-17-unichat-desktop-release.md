# UniChat D2 — Đóng gói và phát hành desktop — Kế hoạch triển khai

> **Trạng thái:** in-progress — nhánh `feature/UNI-1835-unichat-d2-dong-goi-va-phat-hanh-desktop`, issue UNI-1835; Task 1–6 xong trên nhánh, còn chạy thật tag `chat-desktop-v0.1.0-dev.1` → release và smoke cài/cập nhật trên máy sạch (sau merge).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một tag `chat-desktop-v*` dựng bản cài macOS (arm64, x64), Windows (x64), Linux (deb, AppImage), đăng lên GitHub Releases kèm `SHA256SUMS`, feed auto-update và `installer-urls.env` (`UNICHAT_INSTALLER_<CHANNEL>_URLS`, cùng định dạng `OFFICE_INSTALLER_<CHANNEL>_URLS`). Bản chưa ký dùng được cho pilot; ký/notarize tự bật khi GitHub Environment `chat-desktop-release` có secrets.

**Architecture:** Cấu hình electron-builder là hàm thuần `builderConfig(env)` trong `apps/chat-desktop/electron-builder.ts` (electron-builder nạp `.ts` qua jiti) — nhãn `unsigned` và cách ký mac đi theo env ký, nên test được. Kênh đi một đường: tag → version (`-c.extraMetadata.version`) → electron-builder suy kênh từ phần prerelease (`dev.yml`/`beta.yml`/`latest.yml`) và ghi `channel` vào `app-update.yml`; app không tự đặt kênh. Feed là provider `generic` trỏ một release cuộn `chat-desktop-feed`; workflow viết lại URL trong các `*.yml` thành URL tuyệt đối tới release theo tag. Main process có `src/main/updater.ts` thuần (mode `install` | `notify`).

**Tech Stack:** electron-builder ^26 (đã có), electron-updater ^6.8.9 (mới, `dependencies`, range thường: electron-builder kiểm spec này và từ chối `catalog:`), GitHub Actions (Node 22, pnpm theo `packageManager` như `ci.yml`), `gh` CLI trong job publish.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-desktop-release-design.md`; spec cha `2026-10-16-chat-native-apps-design.md` §3.1, §6 D5, §10, §12 Q8.

## Global Constraints

- Không nới tư thế an ninh D1: `sandbox`, `contextIsolation`, IPC đóng, refresh token chỉ ở main. Updater sống hoàn toàn ở main, không kênh IPC mới, không đụng preload.
- Link "tải bản mới" chỉ mở qua `openExternalSafely` (https), tới `${appUrl}/unichat` (trang tải của lát L1).
- Bản `UNICHAT_ENV=dev` không đọc feed phát hành.
- Không bí mật trong repo; secrets chỉ đến job build qua Environment `chat-desktop-release`, biến rỗng bị `unset` trước electron-builder (`CSC_LINK=""` bị hiểu là đường dẫn chứng chỉ).
- Job có quyền ghi (`publish`) không checkout, không chạy mã repo; mã repo chỉ chạy với `contents: read`.
- Không đụng `server/`, `.env.example`, `apps/web/` (lát L1 sở hữu parser `UNICHAT_INSTALLER_*_URLS`, `/api/v1/config`, trang `/unichat`).
- CI gốc không đổi: workflow mới chỉ chạy theo tag; `apps/chat-desktop` vẫn chỉ typecheck/lint/test/build trong turbo.
- `scripts/office/installer-urls.mjs`: hành vi Office không đổi, test cũ xanh nguyên văn.

## Quyết định builder (spec §5 và chỗ spec để ngỏ)

| Mục | Chọn | Lý do |
|---|---|---|
| Provider auto-update | `generic`, URL `https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-feed`; release cuộn `chat-desktop-feed` giữ `<kênh>*.yml` với URL tuyệt đối tới release theo tag | Provider `github` của electron-updater bỏ qua tag không phải semver (`chat-desktop-v…` bị `semver.valid` loại) và kênh stable đọc `/releases/latest` của cả repo — đang là bản Office. Đổi spec §2 (`publish: github`) |
| Cấu hình electron-builder | `electron-builder.ts` thay `.yml`, export `builderConfig(env)` | Nhãn `unsigned` và ký ad-hoc mac phụ thuộc env ký; YAML không biểu diễn được, `.ts` có kiểu và test được |
| Tên tệp | `unichat_<version>[_unsigned]_<os>_<arch>…` theo khuôn Office: `_win32_x64-setup.exe`, `_darwin_arm64.dmg`, `_darwin_x64.dmg`, `_linux_x64.deb`, `_linux_x64.AppImage`; zip mac `_darwin_<arch>.zip` không ánh xạ khoá nào | Server suy `version` và `unsigned` từ tên; `x64` viết cứng cho Windows/Linux vì `${arch}` ra `amd64`/`x86_64` |
| Nhãn `unsigned` | Có khi nền tảng đó không có chứng chỉ (`CSC_LINK` mac, `WIN_CSC_LINK` Windows); Linux luôn có | Như Office: nhãn biến mất khi có chữ ký, trang tải thôi hiện bước "chưa ký" |
| `installer-urls.mjs` | Thêm tham số `prefix` (`--prefix unichat`): khi có, tên phải bắt đầu `unichat_`, kênh đọc từ đoạn version (`dev`/`beta`/không hậu tố = `stable`), nhãn `unsigned` không bắt buộc | Không có prefix (Office) giữ nguyên luật cũ: chỉ dev/beta, nhãn `unsigned` là dấu nhận diện bản Office. Với UniChat, prefix làm việc đó nên bản ký và stable đi được |
| macOS chưa ký | `identity: "-"` (ad-hoc), `hardenedRuntime: false`, `notarize: false`; app chỉ thông báo "có bản mới" và mở trang tải | Thiếu chữ ký thì Apple Silicon báo app "hỏng"; library validation của hardened runtime từ chối framework ký ad-hoc (bài học Office). Squirrel.Mac chỉ cài vào app đã ký |
| macOS có `CSC_LINK` | Ký Developer ID + hardened runtime + entitlements D1; notarize khi có `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`; app tự cập nhật | Cờ build `UNICHAT_MAC_SIGNED` suy từ chính `CSC_LINK` lúc `electron-vite build`, một nguồn sự thật |
| Windows portable zip | Không | Spec cho phép bỏ; NSIS một-click đủ cho pilot, khoá `win32-x64-zip` để trống |
| `installer-urls.env` vào deploy | Đính vào release + in trong run summary; người phát hành dán dòng vào `deploy/app/env/uniwork-be.env` qua PR rồi rollout (runbook), như `OFFICE_INSTALLER_*_URLS` | Cùng đường với Office; L1 mới thêm biến; tự động hoá khi có nhịp phát hành đều |
| Kênh stable | Hỗ trợ đủ (tag `chat-desktop-v1.2.3` → `latest.yml`, release không prerelease); runbook khuyên chỉ cắt stable khi đã có chữ ký (UNI-1838) | Spec liệt kê ba kênh; chặn hay không là quyết định phát hành, không phải của mã |
| SHA256SUMS | Một tệp `SHA256SUMS` cho mọi tệp của release | Spec ghi một tệp; người dùng kiểm một chỗ |
| Rollback | Tải `*.yml` của release tốt trước đó, upload `--clobber` vào `chat-desktop-feed`; không `allowDowngrade` | Chặn lan bản lỗi; người đã lên bản lỗi nhận bản sửa có số lớn hơn |
| Nguồn tag | Commit của tag phải nằm trên `origin/main` hoặc `origin/develop` (job `meta`, trước khi secrets vào job build) | Tag đẩy từ nhánh lạ không được nhận chứng chỉ ký |

## Review Focus

1. `package.test.mjs`: cả năm khoá `DESKTOP_INSTALLER_KINDS` (trừ `win32-x64-zip`) ánh xạ đúng từ tên tệp cấu hình sinh ra, ở cả chế độ chưa ký và có chữ ký; zip mac không ánh xạ; mac chưa ký là ad-hoc không hardened runtime.
2. `releaseFromTag` từ chối tag lạ (`v1.2.3-dev.1`, `chat-desktop-v1.2`, `-rc.1`, số 0 đứng đầu); `absoluteFeed` chỉ viết lại `url:`/`path:` là tên tệp an toàn.
3. `installer-urls.test.mjs`: test Office cũ không sửa; ca prefix: tệp không prefix bị bỏ, dev không lấp beta/stable, tệp ký được nhận.
4. `updater.test.ts`: mac chưa ký không tự tải, thông báo một lần mỗi version, click mở trang tải; nơi khác tự tải và báo khi tải xong; lỗi kiểm/tải không thành unhandled rejection.
5. Workflow: secrets chỉ ở job build qua Environment, biến rỗng bị `unset`, secret mac không tới runner Windows; job `publish` không checkout.

---

### Task 1: `installer-urls.mjs` nhận `prefix`

**Files:** Modify `scripts/office/installer-urls.mjs`, `scripts/office/installer-urls.test.mjs`

- [x] Test trước (đỏ): `installerPlatformOf(name, channel, "unichat")` nhận `unichat_0.1.0-dev.1_unsigned_*`, `unichat_0.1.0-dev.1_darwin_arm64.dmg` (ký), `unichat_1.0.0_win32_x64-setup.exe` cho `stable`; bỏ tên Office, dev cho kênh beta, version lạ; `buildInstallerUrls({ prefix })`; CLI `--prefix`.
- [x] Cài đặt; `node --test scripts/office/installer-urls.test.mjs`.

### Task 2: Cấu hình đóng gói, helper phát hành, `package.test.mjs`

**Files:**
- Create: `apps/chat-desktop/electron-builder.ts` (thay `electron-builder.yml`), `apps/chat-desktop/scripts/release.mjs`, `apps/chat-desktop/scripts/package.test.mjs`
- Modify: `apps/chat-desktop/package.json` (`homepage` — deb bắt buộc; `package`: `electron-builder --publish never`), `vitest.config.ts` (`include` thêm `scripts/**/*.test.mjs`), `tsconfig.json` (`include` thêm `electron-builder.ts`)

**Interfaces:**
- `builderConfig(env): Configuration` — appId `com.uniworkos.chat`, productName `UniChat`, output `dist/package`, mac `dmg`+`zip` × `arm64`+`x64`, win `nsis` x64, linux `AppImage`+`deb` x64, `publish: { provider: "generic", url: UPDATE_FEED_URL }`, protocol `uniworkchat`.
- `releaseFromTag(tag): { version, channel: "dev"|"beta"|"stable" }`; `absoluteFeed(yml, baseUrl): string`; CLI `node scripts/release.mjs meta <tag>` (in `version=`/`channel=`), `node scripts/release.mjs feed <baseUrl> <file.yml>…` (viết lại tại chỗ).

- [x] Test trước: ánh xạ tên → khoá qua `installerPlatformOf(…, "unichat")`, hai chế độ ký; tag → kênh; feed tuyệt đối; cấu hình bất biến (appId, publish, protocol, output).
- [x] Cài đặt; `pnpm --filter @uniwork/chat-desktop test|typecheck|lint`.

### Task 3: Updater ở main

**Files:**
- Create: `apps/chat-desktop/src/main/updater.ts` (+ `.test.ts`)
- Modify: `apps/chat-desktop/src/main/index.ts`, `apps/chat-desktop/electron.vite.config.ts` (define `UNICHAT_MAC_SIGNED`), `apps/chat-desktop/package.json` (`dependencies.electron-updater: ^6.8.9`), `pnpm-lock.yaml`

**Interfaces:**
- `updateMode(platform, macSigned): "install" | "notify"`; `startUpdater({ updater, mode, notify, openDownloadPage })` — `autoDownload` theo mode; `install`: báo khi `update-downloaded`; `notify`: báo khi `update-available`, một lần mỗi version, click → `openDownloadPage`; kiểm ngay và mỗi 6 giờ; mọi promise có `.catch`.
- `index.ts`: sau `createWindow()`, nếu `config.env !== "dev"` thì `startUpdater` với `autoUpdater`, `Notification` của Electron và `openExternalSafely(`${config.appUrl}/unichat`)`.

- [x] Test trước `updater.test.ts` (EventEmitter giả, fake timers); cài đặt; coverage giữ 100 %.

### Task 4: Workflow `chat-desktop-release.yml`

**Files:** Create `.github/workflows/chat-desktop-release.yml`

- Trigger `push.tags: chat-desktop-v*`; `permissions: contents: read`; `concurrency` một nhóm, không huỷ.
- `meta` (ubuntu): `release.mjs meta` → `version`, `channel`, `tag`; commit trên `origin/main|develop`.
- `package` (matrix `macos-14` `--mac`, `windows-latest` `--win`, `ubuntu-latest` `--linux`; `environment: chat-desktop-release`): pnpm install, `build`, `package -- <flag> -c.extraMetadata.version=$VERSION`; env `UNICHAT_ENV=prod`, `UNICHAT_APP_URL`/`UNICHAT_API_URL` (biến repo, mặc định `https://uniworkos.com`); secret theo nền tảng, rỗng thì `unset`; upload installer, zip, blockmap, `*.yml`.
- `assemble` (ubuntu, read-only, chạy mã repo): `installer-urls.mjs --prefix unichat` → `installer-urls.env`; `release.mjs feed`; `SHA256SUMS`; summary.
- `publish` (ubuntu, `contents: write`, không checkout): `gh release create` (prerelease trừ stable, `--latest=false`) + upload; tạo/cập nhật release `chat-desktop-feed` với các `*.yml`.

- [x] `actionlint` nếu có.

### Task 5: Runbook, tài liệu

**Files:** Create `docs/runbooks/unichat-desktop-release.md` (bốn mục bắt buộc); Modify `scripts/alerts-runbooks.test.mjs` (`OPERATOR_RUNBOOKS`), `apps/chat-desktop/CLAUDE.md`, spec D2 §2.

- [x] `node --test scripts/alerts-runbooks.test.mjs scripts/governance.test.mjs scripts/catalog-check.test.mjs scripts/no-usf-leak.test.mjs`.

### Task 6: Kiểm chứng và PR

- [x] `pnpm --filter @uniwork/chat-desktop build` rồi `package -- --mac -c.extraMetadata.version=0.1.0-dev.1` trên máy Intel này (x64 + arm64 nếu cross-build được); tên tệp ra khớp khoá; `dev-mac.yml` có hai zip; asar có `node_modules/electron-updater`. Thử `--linux`. Không commit artifact.
- [x] `pnpm knip`; `make issue-pr KEY=UNI-1835`; thân PR tiếng Việt; comment `[agent]`.

## Kết quả (2026-10-17)

- Đóng gói thật trên máy Intel macOS này (`pnpm --filter @uniwork/chat-desktop package --mac|--linux|--win -c.extraMetadata.version=0.1.0-dev.1`): `unichat_0.1.0-dev.1_unsigned_darwin_arm64.dmg`/`.zip`, `…_darwin_x64.dmg`/`.zip`, `…_win32_x64-setup.exe`, `…_linux_x64.AppImage`, `…_linux_x64.deb`, `dev.yml`, `dev-mac.yml` (hai zip + hai dmg), `dev-linux.yml` (AppImage + deb); `app-update.yml` có `provider: generic`, `channel: dev`; hai app mac `Signature=adhoc`, `lipo` đúng arch; `app.asar` có `node_modules/electron-updater` và phụ thuộc. `installer-urls.mjs --prefix unichat` trên thư mục ra đủ 5 khoá.
- Bước `Collect` + `assemble` của workflow chạy thử bằng bash cục bộ trên output đó: `installer-urls.env`, feed URL tuyệt đối, `SHA256SUMS` đúng.
- Chưa chạy: tag → release thật, cài/cập nhật trên máy sạch, nhánh có chữ ký (chưa có tài khoản).
- Theo sau: `desktopName`/`linux.syncDesktopName` cho nhóm cửa sổ trên Linux (electron-builder cảnh báo), dòng `UNICHAT_INSTALLER_*_URLS` trong `deploy/app/env/uniwork-be.env` khi có release đầu và parser của L1.
