# UniWork Office desktop - chọn bản cài và luồng setup macOS / Ubuntu

> **Trạng thái:** in-progress (UNI-919 lane A, UNI-920 lane B; người dùng yêu cầu 2026-10-02 14:00 UTC+7)

## 1. Lý do

Người dùng 2026-10-02: "cần thêm UI chọn bản cài đặt, bổ sung thêm lane làm luồng setup cho macOS và linux
(nếu còn phụ thuộc các bản phân phối linux thì trước hết áp dụng cho ubuntu)".

Hiện trạng trên root `feature/UNI-819-office-g3-g4`:

- `apps/office-desktop/scripts/package.mjs` chỉ build Windows x64 (`zip` + NSIS `-setup.exe`). Config `darwin`
  (`dmg`, arm64/x64, chưa ký) có trong `createPackagerConfig` nhưng không có đường build. `identity.json`
  `build.platforms` chỉ có `win32` và `darwin`; Linux bị từ chối.
- Server có một installer URL cho mỗi kênh (`OFFICE_INSTALLER_{DEV,BETA,STABLE}_URL`), trả qua
  `GET /api/v1/office/desktop/download` và gói zip `bundle=true` (installer + deployment profile).
  `office_desktop_bundle.go` nhận `.exe .dmg .pkg .zip`.
- Web (`packages/views/office/install-prompt.tsx`, `desktop-open-action.tsx`) hiện một nút cài cho kênh; không
  nhận diện hệ điều hành, không có lựa chọn bản khác. Người dùng Mac/Linux sẽ tải bản Windows.

Quyết định này mở rộng plan G3-G4 §G4-07 và spec G4 §77 ("Linux installer không thuộc cam kết Q3-B"):
Linux Ubuntu được thêm theo yêu cầu người dùng, ở mức **dev chưa ký**, như Windows/macOS hiện tại. Ký số,
notarization, feed update thật và pilot vẫn thuộc G4-07c/G7 (gate G4-D3 không đổi).

## 2. Contract dùng chung: khóa nền tảng

Một khóa cho mỗi artifact, dùng ở identity, packager, server config, API và UI:

| Khóa | Hệ điều hành | Artifact | Ghi chú |
| --- | --- | --- | --- |
| `win32-x64` | Windows 10/11 x64 | `…_win32_x64-setup.exe` (NSIS per-user) | đã có |
| `win32-x64-zip` | Windows x64 | `…_win32_x64.zip` (portable) | đã có, phụ |
| `darwin-arm64` | macOS Apple Silicon | `…_darwin_arm64.dmg` | mới |
| `darwin-x64` | macOS Intel | `…_darwin_x64.dmg` | mới |
| `linux-x64-deb` | Ubuntu 22.04/24.04 x64 | `…_linux_x64.deb` | mới, chính cho Ubuntu |
| `linux-x64-appimage` | Linux x64 (Ubuntu trước) | `…_linux_x64.AppImage` | mới, phụ |

Tên artifact giữ mẫu hiện tại `<artifactPrefix>_<version>_<label>_<platform>_<arch>[-setup].<ext>`; nhãn
`unsigned` bắt buộc khi chưa ký. Không thêm arch khác (arm64 Linux, Windows arm64) trong đợt này.

## 3. Lane A - G4-07d: chọn bản cài (server + core + web)

**Phạm vi.**

- Server: cấu hình installer theo kênh **và** khóa nền tảng. Biến mới
  `OFFICE_INSTALLER_<CHANNEL>_URLS` (JSON object `{ "<platform-key>": "<https url>" }`) hoặc một manifest URL
  theo kênh; lane chọn một cách, ghi lý do, giữ biến cũ `OFFICE_INSTALLER_<CHANNEL>_URL` đọc như
  `win32-x64` trong đúng một release rồi bỏ (API boundary được phép có compat; ghi ngày bỏ). Mọi biến vào
  `.env.example` (`scripts/env-example.test.mjs`).
- API: `GET /api/v1/office/desktop/download` trả thêm danh sách `installers[]`
  (`platform`, `url`, `kind`, `size_bytes?`, `sha256?`), chỉ các khóa đã cấu hình; `bundle=true` nhận thêm
  `platform=<key>`. `office_desktop_bundle.go` nhận thêm `.deb` và `.AppImage`. SDI/SDO, Swagger
  (`docs/api-sdi-sdo.md`), test malformed-response trong `api/endpoints/office-desktop.test.ts`.
  Không đổi quyền: vẫn `RequireMember` tổ chức như hiện tại.
- Core: hàm thuần `detectDesktopPlatform(hints)` trong `packages/core/office/` nhận
  `navigator.userAgentData` (platform, architecture qua `getHighEntropyValues` nếu có) và userAgent,
  trả khóa gợi ý + độ chắc chắn. Không đọc `navigator` trong core; host web truyền hint vào.
  Mac không phân biệt chắc arm64/x64 thì gợi ý `darwin-arm64` nhưng đánh dấu "không chắc" và hiện cả hai.
- Views: `OfficeInstallPrompt` thành bộ chọn, **làm đúng thiết kế ở §6** (Advisor thiết kế theo yêu cầu người
  dùng; lệch thiết kế phải hỏi Advisor trước). Tóm tắt:
  - Nút chính "Tải cho <hệ điều hành>" theo gợi ý; dòng phụ ghi kiến trúc và loại file.
  - "Bản khác" mở danh sách mọi bản đã cấu hình (icon OS, tên, kiến trúc, đuôi file, dung lượng nếu có).
  - Hệ điều hành không có bản (vd. Linux arm64, ChromeOS, mobile): nói rõ "chưa hỗ trợ", vẫn cho xem danh sách.
  - Hướng dẫn ngắn sau khi tải, theo nền tảng: SmartScreen (More info → Run anyway); Gatekeeper
    (chuột phải → Open); Ubuntu `.deb` (mở bằng App Center hoặc `sudo apt install ./file.deb`), AppImage
    (`chmod +x`, cần `libfuse2` trên 22.04/24.04). Nhãn "bản chưa ký - chỉ dùng nội bộ" khi `unsigned`.
  - Kênh stable không bao giờ rơi về bản dev (giữ quy tắc hiện tại).
  - Mọi chữ qua `t()`, đủ vi + en; primitives `packages/ui`; token semantic; 390px và 1440px, sáng/tối.
- Có thể thêm điểm vào "Tải UniWork Office" ở trang cài đặt tổ chức/người dùng nếu đã có chỗ phù hợp; không
  tạo trang mới nếu chưa có route (nếu cần, đề xuất cho Advisor trước).

**Ngoài phạm vi.** Build artifact (lane B), ký số, feed update, đếm lượt tải.

**Nghiệm thu.**

- A-1: Go test service/handler: nhiều nền tảng, thiếu nền tảng, URL không an toàn, đuôi mới, `platform` sai,
  compat biến cũ; `TestFlagsAreReviewed`/arch test/migration lint không ảnh hưởng.
- A-2: Core test `detectDesktopPlatform` với bảng UA thật (Windows 11 Edge/Chrome, macOS Safari/Chrome arm64 và
  Intel, Ubuntu Firefox/Chrome, ChromeOS, Android, iOS) + test malformed-response endpoint.
- A-3: Views test: gợi ý đúng, "Bản khác", chưa hỗ trợ, stable không rơi về dev, tải lỗi, hướng dẫn theo nền tảng.
- A-4: Visual Tester (claude-sonnet-5-5 medium + Jev, 9 tiêu chí UI) ở 1440 và 390 CSS px thật, hai theme.
- A-5: lint (max-warnings 0, no-literal-string), typecheck, knip, coverage chỉ tăng, 500 dòng,
  `node --test scripts/*.test.mjs`, Go `make test-go` phần bị ảnh hưởng.

## 4. Lane B - G4-07e: luồng setup macOS và Ubuntu (apps/office-desktop)

**Phạm vi.**

- `identity.json`: thêm `linux: ["x64"]` vào `build.platforms`; giữ `darwin: ["arm64","x64"]`. Các profile
  kênh không đổi tên/namespace.
- `scripts/package.mjs`: chọn nền tảng theo `process.platform` hoặc cờ `--platform/--arch`; đường build
  `darwin` (dmg arm64 + x64) và `linux` (`deb` + `AppImage` x64). Từ chối build chéo không hỗ trợ bằng lỗi
  rõ ràng (dmg chỉ trên macOS). Linux build trên Windows qua Docker (`electronuserland/builder` hoặc tương
  đương, pin digest, kiểm `docker manifest inspect` trước) - script riêng, không đổi CI.
- Linux runtime (main process, sau IPC allowlist hiện có):
  - Scheme `uniwork-office-dev://` (và `uniwork-office://`) qua file `.desktop` `MimeType=x-scheme-handler/…`,
    `.deb` chạy `update-desktop-database`/`xdg-mime` trong postinst; AppImage đăng ký lần chạy đầu
    (hoặc ghi rõ là không đăng ký và web hiện hướng dẫn).
  - Liên kết `.docx` (đã có trong config) qua MimeType.
  - Credential: Electron `safeStorage` trên Linux cần Secret Service (gnome-keyring / KWallet). Nếu
    `safeStorage.getSelectedStorageBackend()` là `basic_text` hoặc không có keyring: **từ chối lưu credential**,
    báo lỗi có lý do và cách sửa; không fallback plaintext (bất biến plan §1.2, G4-D2).
  - Đường dẫn dữ liệu XDG (`~/.config/<userDataNamespace>`), single-instance + deep link qua `second-instance`.
- macOS runtime: scheme qua `CFBundleURLTypes` (electron-builder `protocols`), `open-url`, single-instance,
  Keychain qua `safeStorage`, `.docx` qua `fileAssociations`. Chưa ký: hardened runtime tắt, ghi hướng dẫn
  Gatekeeper.
- Bộ cài Ubuntu `.deb`: cài vào `/opt/<product>`, symlink `/usr/bin/<executable>`, icon theo hicolor, gỡ
  bằng `apt remove` giữ dữ liệu người dùng (như `deleteAppDataOnUninstall:false` của Windows).
- Release inventory, licence inventory và build metadata chạy cho mọi nền tảng (`generateReleaseInventory`).
- Tài liệu: `docs/office/g3g4/` thêm mục cài đặt macOS/Ubuntu (dev chưa ký), kèm giới hạn.

**Ngoài phạm vi.** Ký Developer ID/notarization, ký GPG repo apt, Snap/Flatpak/RPM, auto-update Linux/macOS,
Linux arm64. Distro khác Ubuntu chỉ ghi "chưa kiểm".

**Nghiệm thu.**

- B-1: Unit/contract test packager cho darwin + linux config (target, tên artifact, nhãn unsigned, protocol,
  MimeType, không file test/fixture trong asar), test identity và check-boundaries.
- B-2: Build thật Ubuntu `.deb` + AppImage trong Docker; cài `.deb` trong container Ubuntu 24.04 (và 22.04 nếu
  kịp) với Xvfb: app khởi động, `xdg-open uniwork-office-dev://…` tới đúng instance, có gnome-keyring thì
  credential lưu/đọc được, không keyring thì từ chối có lý do; `apt remove` giữ dữ liệu. Bằng chứng: log,
  ảnh màn hình, checksum.
- B-3: macOS: không có máy Mac trong môi trường này. Lane giao config + script + test; build `.dmg` và kiểm
  cài thật ghi **blocked: cần máy macOS** (plan §8.3: không thay bằng giả lập). Advisor sẽ hỏi người dùng
  về máy/runner Mac.
- B-4: Windows không regression: `pnpm --filter @uniwork/office-desktop package` vẫn ra zip + setup.exe,
  test desktop xanh, coverage chỉ tăng.
- B-5: lint, typecheck, knip, 500 dòng, `node --test scripts/*.test.mjs`, `node scripts/office/check-boundaries.mjs`.

## 5. Phụ thuộc và thứ tự

- Lane A và B chạy song song, chung contract khóa nền tảng ở §2 (contract-first: A dùng khóa trước, B tạo
  artifact khớp tên). Lane nào đổi §2 phải hỏi Advisor.
- Lane A đụng `install-prompt.tsx`/`desktop-open-action.tsx` (FE-SHELL G3-09, đã merge) và server download
  service (G4-05); Advisor cấp scope các file này cho lane A. Lane B chỉ ở `apps/office-desktop/` và
  `docs/office/g3g4/`.
- Không đụng file của các lane đang chạy (UNI-823, UNI-824, UNI-916) và không đụng shell editor Office.

## 6. Thiết kế UI bộ chọn bản cài (binding cho lane A)

Người dùng 2026-10-02: "phần UI thì bro thiết kế rồi gửi lane làm theo". Advisor thiết kế; lane làm đúng bố cục,
trạng thái, chữ và token dưới đây. Muốn đổi gì phải hỏi Advisor trước.

### 6.1 Điểm vào

Một component `OfficeInstallPrompt` (giữ tên, mở rộng props) dùng cho cả hai đường đã có:

- `reason = not-installed | expired | error`: sau khi deep link không mở được app (`desktop-open-action.tsx`).
- `reason = download`: nút "Tải UniWork Office" trên header Office.

Props mới: `installers: OfficeInstallerOption[]` (từ API, đã lọc theo kênh), `platformHint: DesktopPlatformGuess`
(từ `detectDesktopPlatform`), `onDownload(platform)`. Bỏ `OfficeInstallerURLs` theo kênh sau khi lane chuyển xong
mọi caller (không giữ hai đường song song trong code nội bộ).

### 6.2 Bố cục (Dialog `sm:max-w-lg`; dưới `sm` Dialog full-width, footer xếp dọc)

```
┌ Cài UniWork Office ─────────────────────────────────────── × ┐   DialogTitle text-title
│ Ứng dụng máy tính chưa phản hồi. Cài bản phù hợp cho máy này  │   DialogDescription (theo reason)
│ rồi bấm Mở lại.                                               │
│                                                               │
│ ┌ ĐỀ XUẤT CHO MÁY NÀY ───────────────────────────────────────┐│   section: border-border bg-muted/40
│ │ [▣]  Windows · 64-bit                                      ││   rounded-lg p-4; nhãn text-caption
│ │      Bộ cài .exe · 142 MB                     [chưa ký]    ││   uppercase text-muted-foreground
│ │ [ ⬇  Tải cho Windows                                     ] ││   Button primary, full width, h-10
│ └────────────────────────────────────────────────────────────┘│
│                                                               │
│ ▸ Sau khi tải                                                 │   Collapsible (đóng mặc định)
│ ▸ Bản khác (4)                                                │   Collapsible (đóng mặc định)
│ ───────────────────────────────────────────────────────────── │   DialogFooter
│ [ Mở lại ]                                       [ Đóng ]     │   Mở lại ẩn khi reason = download
└───────────────────────────────────────────────────────────────┘
```

- Hàng nền tảng (trong card và trong "Bản khác") dùng `Item` của `packages/ui`: icon 20px trong ô 36×36
  `rounded-md border bg-background`, dòng 1 tên hệ điều hành + kiến trúc (`text-body font-medium`), dòng 2 loại
  file · dung lượng (`text-caption text-muted-foreground`, ẩn dung lượng nếu API không trả); `Badge
  variant="outline"` "chưa ký" khi artifact `unsigned`. Hàng trong danh sách cao tối thiểu 44px, nút
  `Button variant="outline" size="sm"` "Tải" ở bên phải.
- Icon lucide, không dùng logo thương hiệu: Windows `Monitor`, macOS `Laptop`, `.deb` `Package`, AppImage `Box`,
  tải `Download`. Icon `aria-hidden`; tên hệ điều hành luôn là chữ.
- Chỉ token semantic; không màu cứng; đúng trong `:root` và `.dark`.

### 6.3 Trạng thái card đề xuất

| Gợi ý từ `detectDesktopPlatform` | Card hiện |
| --- | --- |
| Chắc chắn (Windows x64, Mac đọc được `architecture`) | Một hàng + nút chính "Tải cho <OS>" |
| macOS không rõ chip | Hai nút: "Mac chip Apple (M1–M4)" (primary) và "Mac chip Intel" (outline); dòng trợ giúp `mac_chip_help` |
| Linux x64 (không biết distro) | Hàng `.deb` "Ubuntu / Debian" + nút chính; dưới nút một link phụ "Dùng AppImage cho Linux x64 khác" |
| Có nền tảng nhưng kênh chưa có bản đó | `Alert` `not_in_channel` + "Bản khác" mở sẵn |
| Không hỗ trợ (Linux arm64, ChromeOS, Android, iOS, không nhận diện được) | `Alert` `unsupported` + "Bản khác" mở sẵn; không có nút chính |
| Kênh không có bản nào | `Alert role=status` `unavailable` (key cũ); ẩn card và danh sách |

### 6.4 Tải về

- Bấm tải: nút đó `disabled` + `Spinner` + "Đang tải…"; mọi nút tải khác khoá tới khi xong.
- Thành công: dòng `role=status` dưới card `started`, và tự mở "Sau khi tải" đúng nền tảng vừa tải.
- Lỗi: `Alert variant="destructive"` `download_failed` + nút `retry` (gọi lại cùng nền tảng).
- Kênh stable không có bản: không bao giờ hiện bản dev (giữ quy tắc hiện tại, có test).

### 6.5 "Sau khi tải" (theo nền tảng đang chọn; danh sách đánh số `text-body`)

- Windows: 1. Giải nén tệp ZIP. 2. Chạy tệp `…-setup.exe`. 3. Nếu Windows báo "Windows protected your PC", chọn
  **More info** → **Run anyway** (bản nội bộ chưa ký).
- macOS: 1. Giải nén ZIP, mở tệp `.dmg`. 2. Kéo UniWork Office vào Applications. 3. Lần đầu mở: chuột phải vào app
  → **Open** → **Open** (bản nội bộ chưa ký).
- Ubuntu `.deb`: 1. Giải nén ZIP. 2. Mở tệp `.deb` bằng App Center, hoặc chạy `sudo apt install ./<tệp>.deb`.
  3. Mở UniWork Office từ danh sách ứng dụng. Cần gnome-keyring (mặc định trên Ubuntu) để lưu đăng nhập.
- AppImage: 1. Giải nén ZIP. 2. `chmod +x <tệp>.AppImage` rồi chạy. 3. Ubuntu 22.04/24.04 cần
  `sudo apt install libfuse2`.
- Lệnh shell trong `<code>` `font-mono text-caption bg-muted rounded px-1`, kèm nút copy
  (`Button variant="ghost" size="icon-sm"`, aria-label `copy_command`), tên tệp thật thay cho `<tệp>`.

### 6.6 "Bản khác"

Liệt kê mọi bản đã cấu hình của kênh, trừ bản đang ở card đề xuất, nhóm theo thứ tự Windows → macOS → Linux. Số trong
tiêu đề = số hàng. `win32-x64-zip` ghi "Windows · bản portable (ZIP)".

### 6.7 Chữ (key dưới `office.desktop.install.*`, đủ vi + en)

| key | vi | en |
| --- | --- | --- |
| `title` | Cài UniWork Office | Install UniWork Office |
| `recommended` | Đề xuất cho máy này | Recommended for this device |
| `download_for` | Tải cho {{os}} | Download for {{os}} |
| `mac_apple` | Mac chip Apple (M1–M4) | Mac with Apple chip (M1–M4) |
| `mac_intel` | Mac chip Intel | Mac with Intel chip |
| `mac_chip_help` | Xem loại chip tại menu Apple → Giới thiệu máy Mac này. | Check your chip in Apple menu → About This Mac. |
| `appimage_link` | Dùng AppImage cho Linux x64 khác | Use the AppImage for other Linux x64 |
| `other_versions` | Bản khác ({{count}}) | Other versions ({{count}}) |
| `after_download` | Sau khi tải | After downloading |
| `unsigned` | chưa ký | unsigned |
| `not_in_channel` | Chưa có bản cho {{os}} ở kênh này. | No {{os}} build in this channel yet. |
| `unsupported` | UniWork Office chưa hỗ trợ thiết bị này. Bạn vẫn có thể tải cho máy khác. | UniWork Office doesn't support this device yet. You can still download it for another computer. |
| `started` | Đã bắt đầu tải {{file}}. | Download started: {{file}}. |
| `retry` | Thử lại | Try again |
| `copy_command` | Sao chép lệnh | Copy command |
| `copied` | Đã sao chép | Copied |
| `kind.exe` | Bộ cài .exe | .exe installer |
| `kind.zip` | Bản portable (ZIP) | Portable (ZIP) |
| `kind.dmg` | Ảnh đĩa .dmg | .dmg disk image |
| `kind.deb` | Gói .deb | .deb package |
| `kind.appimage` | AppImage | AppImage |
| `os.windows` / `os.macos` / `os.ubuntu` / `os.linux` | Windows / macOS / Ubuntu / Debian / Linux | Windows / macOS / Ubuntu / Debian / Linux |
| `arch.x64` / `arch.arm64` | 64-bit / Apple Silicon | 64-bit / Apple Silicon |

Các key cũ (`not_installed`, `expired`, `error`, `download_failed`, `downloading`, `unavailable`, `open_again`,
`close`, `install`) giữ nguyên. `download_description` đổi thành "Tải bộ cài dành cho trang UniWork của bạn." /
"Download the installer for your UniWork site." (hướng dẫn giải nén chuyển vào "Sau khi tải"). Giọng văn theo
`docs/conventions.md`.

### 6.8 A11y và responsive

- Card đề xuất là `section` có `aria-labelledby` trỏ tới nhãn `recommended`; "Bản khác" là `ItemGroup`
  (`role=list`); trigger Collapsible là button có `aria-expanded`.
- Focus đầu tiên vào nút tải chính (không có thì vào "Mở lại", rồi "Đóng"). Esc đóng dialog. Touch target ≥ 44px
  trên coarse pointer; giữ `:focus-visible` toàn cục.
- 390 CSS px: không thanh cuộn ngang lồng nhau; tên tệp dài bẻ dòng (`break-all` chỉ cho tên tệp); footer xếp dọc,
  nút full-width. 1440: dialog 512px.

### 6.9 Nghiệm thu UI

Visual Tester chụp cả 6 trạng thái ở §6.3, đang tải, lỗi, và "Sau khi tải" của 4 nền tảng; 1440 và 390 CSS px;
sáng và tối; chấm 9 tiêu chí UI (team-rules "Tester visual"). Người dùng duyệt giao diện cuối.
