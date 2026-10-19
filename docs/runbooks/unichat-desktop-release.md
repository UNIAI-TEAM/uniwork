# unichat-desktop-release — phát hành, kiểm và rollback bản desktop UniChat

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** không có alert — runbook vận hành của UniChat D2 (UNI-1835) · **Workflow:** `.github/workflows/chat-desktop-release.yml`

Một tag `chat-desktop-v*` dựng bản cài UniChat (`apps/chat-desktop`) và đăng lên GitHub Releases của repo này.
Tag quyết định version và kênh: `chat-desktop-v0.1.0-dev.3` → `0.1.0-dev.3`, kênh `dev`;
`chat-desktop-v0.2.0-beta.1` → kênh `beta`; `chat-desktop-v1.0.0` → `stable` (file feed `latest*.yml`).
Chỉ cắt stable khi bản mac/Windows đã có chữ ký (UNI-1838).

**Cắt một bản**

1. Chọn commit đã nằm trên `develop` hoặc `main` (job `meta` từ chối commit khác, vì job build nhận secrets ký).
2. `git tag chat-desktop-v0.1.0-dev.1 <sha>` rồi `git push origin chat-desktop-v0.1.0-dev.1`.
3. Workflow chạy `meta` → `package` (macOS arm64+x64, Windows x64, Linux x64) → `assemble` → `publish`.
   Release có: 5 bản cài (`unichat_<version>[_unsigned]_win32_x64-setup.exe`, `_darwin_arm64.dmg`, `_darwin_x64.dmg`,
   `_linux_x64.deb`, `_linux_x64.AppImage`), 2 zip mac (payload cập nhật), các `.blockmap`, `<kênh>.yml`,
   `<kênh>-mac.yml`, `<kênh>-linux.yml`, `SHA256SUMS`, `installer-urls.env`.
4. Release cuộn `chat-desktop-feed` nhận ba file `<kênh>*.yml` (URL tuyệt đối tới release vừa tạo). App đã cài đọc
   feed này (`apps/chat-desktop/electron-builder.ts`, `UPDATE_FEED_URL`) lúc mở và mỗi 6 giờ.
5. Trang tải `/unichat`: chép dòng trong `installer-urls.env` (`UNICHAT_INSTALLER_<KÊNH>_URLS={…}`, cũng in ở run
   summary) vào `deploy/app/env/uniwork-be.env` qua PR, như `OFFICE_INSTALLER_*_URLS`, rồi rollout server.

## Triệu chứng

- Run của workflow đỏ: `meta` (tag sai mẫu, commit không trên `main`/`develop`), `package` (electron-builder),
  `assemble` (`no update file …`, `expected 5 installers`, lỗi của `installer-urls.mjs`), `publish` (`gh`).
- App Windows/Linux đã cài không lên bản mới sau khi mở lại; bản mac không hiện thông báo "Đã có bản UniChat mới".
- Bản vừa phát hành lỗi (không mở, không đăng nhập được, crash) và đang lan qua auto-update — cần rollback.
- Trang `/unichat` trỏ tới tệp 404.

## Kiểm tra

1. Tệp của release: `gh release view chat-desktop-v0.1.0-dev.1 --json assets --jq '.assets[].name'` — đủ danh sách ở bước 3.
2. Feed trỏ đúng bản: `curl -sL https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-feed/dev.yml`
   (và `dev-mac.yml`, `dev-linux.yml`): `version:` là bản mới, mọi `url:`/`path:` trỏ vào tag mới.
3. Checksum: tải tệp về cùng `SHA256SUMS`, chạy `sha256sum -c SHA256SUMS --ignore-missing`.
4. Cài trên máy sạch, theo ghi chú của release: Windows (SmartScreen > More info > Run anyway), macOS
   (`xattr -d com.apple.quarantine ~/Downloads/<tệp>.dmg`, hoặc Privacy & Security > Open Anyway),
   Linux (`sudo apt install ./<tệp>.deb` hoặc `chmod +x` AppImage). App mở `/auth/unichat` của `UNICHAT_APP_URL`.
5. Auto-update: cài bản N, phát bản N+1 cùng kênh, mở lại app từ terminal để thấy log electron-updater
   (`Checking for update`, `Downloading update`). Windows/Linux: thoát app thì bản mới được cài. macOS chưa ký:
   thông báo hiện một lần mỗi version, bấm vào mở `<app>/unichat`.
6. Chữ ký mac: `codesign -dv --verbose=2 /Applications/UniChat.app` → `Signature=adhoc` khi chưa có secrets,
   `Authority=Developer ID Application` khi có; `spctl -a -vv /Applications/UniChat.app` → `Notarized Developer ID`.

## Khắc phục

1. Tag sai hoặc commit ngoài `main`/`develop`: xoá tag (`git push origin :refs/tags/<tag>`, `git tag -d <tag>`) rồi tag lại.
2. `package`/`assemble` đỏ vì runner hoặc mạng: "Re-run failed jobs". `publish` chạy lại an toàn (tạo release chỉ khi
   chưa có, upload `--clobber`).
3. **Rollback bản lỗi** (ví dụ kênh `dev`, bản tốt trước là `chat-desktop-v0.1.0-dev.1`):
   1. Chặn lan: `gh release download chat-desktop-v0.1.0-dev.1 -p 'dev*.yml' -D rollback` rồi
      `gh release upload chat-desktop-feed rollback/*.yml --clobber`. App chưa lên bản lỗi sẽ không tải nó.
      App đã lên bản lỗi không tự hạ (không bật `allowDowngrade`).
   2. Sửa rồi phát bản số lớn hơn (`chat-desktop-v0.1.0-dev.3`): mọi app, kể cả bản lỗi, lên bản sửa.
   3. Trang tải: đặt lại `UNICHAT_INSTALLER_DEV_URLS` bằng `installer-urls.env` của bản tốt.
   4. Ẩn release lỗi khỏi người tải tay: `gh release edit <tag> --draft`. Không xoá `chat-desktop-feed`.
4. Release `chat-desktop-feed` bị xoá nhầm: "Re-run" job `publish` của bản mới nhất mỗi kênh — nó tạo lại release và
   đưa `*.yml` lên.
5. Bật ký lần đầu (UNI-1838): giới hạn Environment `chat-desktop-release` cho tag `chat-desktop-v*`, thêm secrets
   `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`,
   `WIN_CSC_KEY_PASSWORD`, rồi cắt một bản dev. Tên tệp mac/Windows mất nhãn `_unsigned`, bản mac tự cập nhật
   từ bản ký đầu tiên; bản mac chưa ký đã cài vẫn chỉ nhận thông báo và phải tải tay một lần. Chứng chỉ Windows
   mua sau 2023-06 nằm trên phần cứng/HSM, không có `.pfx` cho `WIN_CSC_LINK`: đổi bước ký Windows theo
   `docs/evidence/unichat/release-accounts.md` (ghi chú Windows) trước khi thêm secret Windows.

## Leo thang

- Notarize lỗi, chứng chỉ Apple/Windows hết hạn hoặc bị thu hồi: người giữ tài khoản Apple Developer / chứng chỉ
  ký Windows (UNI-1838).
- GitHub Releases hoặc Actions sự cố: <https://www.githubstatus.com>; app vẫn chạy bản đang có, chỉ chậm cập nhật.
- Bản lỗi đã lan và rollback ở mục Khắc phục 3 không đủ (app không mở được để nhận bản sửa): chủ epic UNI-1826,
  hướng dẫn người dùng gỡ và cài bản tốt từ trang `/unichat`.
