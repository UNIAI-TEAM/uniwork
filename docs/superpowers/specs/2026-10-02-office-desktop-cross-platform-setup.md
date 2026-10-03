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
  - Thẻ hệ điều hành + chip "Kiến trúc & định dạng" theo mockup người dùng gửi; gợi ý theo máy (tag "Phù hợp").
  - Lựa chọn **sinh từ dữ liệu**, không cố định trong UI (§6.0).
  - Info yêu cầu / dung lượng / phiên bản + nhãn "chưa ký"; hướng dẫn "Sau khi tải" theo định dạng.
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
- **Chặn cài sai máy** (người dùng 2026-10-02: "nếu bấm cài đặt bản k phù hợp thì báo lỗi và k cài đặt"). Mỗi bộ cài
  tự kiểm máy trước khi chép file; không đạt thì hiện lỗi có lý do + bản nên tải, thoát, **không để lại file nào**:
  - Windows NSIS (`build/installer.nsh`, `.onInit`/`customInit`): yêu cầu Windows 10 trở lên và hệ 64-bit
    (`${AtLeastWin10}`, `${RunningX64}`); Windows ARM64 chạy được bản x64 qua giả lập nên **cho cài**, ghi rõ trong
    tài liệu. Lỗi: MessageBox "UniWork Office cần Windows 10 hoặc mới hơn, bản 64-bit. Máy này: <phiên bản>." rồi
    `Abort`. Chế độ `/S` (silent) thoát với mã lỗi khác 0, không hiện hộp thoại.
  - Bản ZIP portable Windows và mọi bản: app tự kiểm lúc khởi động (main process, trước khi tạo cửa sổ) cùng điều kiện
    tối thiểu; không đạt thì `dialog.showErrorBox` rồi thoát, không ghi dữ liệu.
  - macOS `.dmg`: không có script cài. Đặt `LSMinimumSystemVersion` (theo mức tối thiểu của Electron đang pin) và
    `LSArchitecturePriority`/binary đúng một kiến trúc, để macOS tự từ chối mở với thông báo hệ thống trên máy cũ hoặc
    sai chip; app kiểm thêm lúc khởi động như trên. Kiểm thật: blocked tới khi có máy Mac.
  - Ubuntu `.deb`: `Architecture: amd64` (dpkg tự từ chối máy khác kiến trúc); `Depends` đúng thư viện tối thiểu;
    `preinst` đọc `/etc/os-release`, từ chối khi không phải Ubuntu/Debian hoặc Ubuntu < 22.04 với thông báo rõ ràng
    và mã lỗi khác 0 (apt dừng, không cài). Distro khác Ubuntu/Debian mà vẫn dùng `.deb`: từ chối, gợi ý AppImage.
  - AppImage: kernel tự từ chối khác kiến trúc; app kiểm lúc khởi động (glibc, có `libfuse2` thì AppImage mới chạy -
    thông báo hướng dẫn khi thiếu).
  - Bộ cài/ app chạy trên hệ điều hành khác hẳn (`.exe` trên macOS/Linux, `.dmg` trên Windows, `.deb` trên Windows)
    thì hệ điều hành đã từ chối mở; không cần code thêm, ghi vào tài liệu.
  - Chữ lỗi của bộ cài: tiếng Anh + tiếng Việt cùng hộp (NSIS không có i18next); chữ trong app qua i18n desktop.
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
- B-2b: Chặn cài sai máy: test cho mỗi kiểm tra (NSIS macro qua build thật + chạy trên Windows hiện có với điều kiện
  giả lập bằng tham số test riêng chỉ có ở bản dev, hoặc kiểm bằng log `makensis`; `preinst` chạy trong container
  Ubuntu 20.04 → từ chối, 24.04 → cài, Debian 12 → cài, Fedora → `.deb` không áp dụng; kiểm khởi động của app với
  điều kiện tối thiểu sai → hộp lỗi, thoát, không có dữ liệu mới trong userData). Bằng chứng: log, ảnh, mã thoát.
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

Người dùng 2026-10-02: "phần UI thì bro thiết kế rồi gửi lane làm theo", sau đó gửi mockup
`Modal chọn bản cài đặt theo hệ điều hành.html` với lời dặn "có thể áp dụng layout như này nhé". Layout dưới đây
theo mockup đó (bản chép nằm ở `docs/office/g3g4/design/installer-picker-mockup.html`), đã map sang primitives,
token và dữ liệu thật của UniWork. Lane làm đúng bố cục, trạng thái, chữ và token; muốn đổi gì phải hỏi Advisor
trước. Mockup là tham chiếu bố cục, không chép CSS/hex của nó.

### 6.0 Lựa chọn phụ thuộc bản app hỗ trợ

Người dùng 2026-10-02: "về các cấu hình máy lựa chọn thì sẽ phụ thuộc app hỗ trợ những loại file nào nhé".

- Nguồn sự thật là danh sách khóa nền tảng ở §2, khai báo một lần trong `apps/office-desktop/identity.json`
  (`build.platforms` + định dạng của từng khóa) và trong config khóa hợp lệ của server. Server chỉ trả trong
  `installers[]` những khóa vừa nằm trong danh sách đó vừa có URL cấu hình cho kênh.
- UI **không có danh sách hệ điều hành / định dạng cố định**: thẻ hệ điều hành = các hệ điều hành có ít nhất một khóa
  được hỗ trợ; chip = các khóa của hệ điều hành đó, theo thứ tự ở §2. Hệ điều hành app không hỗ trợ thì không hiện
  thẻ. Hệ điều hành được hỗ trợ nhưng kênh này chưa có URL thì hiện thẻ "Chưa có" (§6.3).
- Chữ, icon, gợi ý và hướng dẫn cho từng khóa nằm trong một bảng `DESKTOP_INSTALLER_KINDS` (core, thuần dữ liệu) để
  thêm một định dạng (vd. Windows ARM64, `.msi`, `.rpm` sau này) chỉ cần: khóa mới ở §2 + packager lane B +
  một dòng bảng + key i18n, không sửa layout. Khóa server trả mà client chưa biết thì bỏ qua (API drift), có test.
- Test: thêm/bớt khóa trong dữ liệu giả làm thẻ/chip đổi theo; một hệ điều hành chỉ có một định dạng vẫn hiện chip
  đó (đã chọn sẵn); khóa lạ bị bỏ qua.

### 6.1 Điểm vào

Một component `OfficeInstallPrompt` (giữ tên, mở rộng props) dùng cho cả hai đường đã có:

- `reason = not-installed | expired | error`: sau khi deep link không mở được app (`desktop-open-action.tsx`).
- `reason = download`: nút "Tải UniWork Office" trên header Office.

Props mới: `installers: OfficeInstallerOption[]` (từ API, đã lọc theo kênh), `platformHint: DesktopPlatformGuess`
(từ `detectDesktopPlatform`), `onDownload(platform)`. Bỏ `OfficeInstallerURLs` theo kênh sau khi lane chuyển xong
mọi caller (không giữ hai đường song song trong code nội bộ).

### 6.2 Bố cục (Dialog `sm:max-w-[560px]`, bo góc 16px; dưới 480px padding ngang 16px)

```
┌───────────────────────────────────────────────────────────────┐
│ [U]  Tải UniWork Office cho máy tính                       ×  │  header: logo mark 36px + title + mô tả
│      Chọn hệ điều hành và định dạng phù hợp với máy của bạn.  │  (mô tả theo reason, xem §6.7)
│                                                               │
│ ┌───Phù hợp───┐ ┌─────────────┐ ┌─────────────┐               │  radiogroup hệ điều hành, 3 cột
│ │   [⊞]       │ │   [  ]     │ │   [🐧]      │               │  thẻ đang chọn: viền primary,
│ │  Windows    │ │   macOS     │ │   Linux     │               │  nền primary/10; tag "Phù hợp"
│ └─────────────┘ └─────────────┘ └─────────────┘               │  trên thẻ hệ điều hành nhận diện được
│                                                               │
│ Kiến trúc & định dạng                                         │  nhãn text-caption font-medium
│ ┌──────────────────┐ ┌──────────────────┐                     │  radiogroup chip (wrap)
│ │ x64 · .exe       │ │ ZIP portable     │                     │  dòng 1 font-medium, dòng 2
│ │ Intel / AMD      │ │ Không cần cài    │                     │  text-caption text-muted-foreground
│ └──────────────────┘ └──────────────────┘                     │
│                                                               │
│ ┌───────────────────────────────────────────────────────────┐ │  info: bg-muted rounded-lg p-3
│ │ Yêu cầu: Windows 10/11 64-bit       Dung lượng: 142 MB    │ │  text-caption; giá trị font-medium
│ │ Phiên bản 0.4.0 · kênh dev · [chưa ký]                    │ │  text-foreground; Badge outline
│ └───────────────────────────────────────────────────────────┘ │
│                                                               │
│ ▸ Sau khi tải                                                 │  Collapsible (đóng; tự mở khi tải xong)
│                                                               │
│ Đang tải UniWork-Office-Setup.exe…     [Để sau] [⬇ Tải cho Windows] │  footer
└───────────────────────────────────────────────────────────────┘
```

- **Header:** logo mark UniWork (`Logo variant="mark"` từ `@uniwork/ui/brand`, 36px, bo 10px), `DialogTitle`
  `text-title`, `DialogDescription` `text-body text-muted-foreground`, nút đóng của Dialog (32px, aria-label "Đóng").
- **Hệ điều hành:** `RadioGroup` 1 cột cho mỗi hệ điều hành được hỗ trợ (§6.0; hiện là 3) (gap 10px; dưới 480px gap 8px), mỗi thẻ là radio item cao tối thiểu
  88px: icon hệ điều hành 30px + tên (`font-medium`). Không chọn: `border-input bg-background` (Advisor 2026-10-02: `border-border` chỉ đạt 1,27:1 / 1,39:1, cần ≥ 3:1), hover
  `border-muted-foreground`. Đang chọn: `border-primary bg-primary/10` (hoặc token `accent` nếu tương phản tốt hơn,
  kiểm cả hai theme). Tag "Phù hợp": `Badge` nhỏ `bg-primary text-primary-foreground`, nằm đè mép trên giữa thẻ.
  Icon hệ điều hành: glyph đơn sắc Windows / Apple / Tux như mockup, vẽ bằng inline SVG `fill-current` trong
  `packages/views/office/os-glyphs.tsx`, `aria-hidden`; tên hệ điều hành luôn là chữ.
- **Kiến trúc & định dạng:** `RadioGroup` dạng chip (wrap, gap 8px), chỉ các bản server trả cho hệ điều hành đang chọn
  (§6.0), thứ tự theo §2. Với các khóa hiện có, chữ chip là:
  - Windows: `x64 · .exe` "Intel / AMD"; `ZIP portable` "Không cần cài".
  - macOS: `Apple Silicon · .dmg` "M1, M2, M3, M4"; `Intel · .dmg` "Mac đời cũ".
  - Linux: `.deb` "Ubuntu, Debian"; `.AppImage` "Chạy trên mọi bản phân phối x64".
  Chip: `rounded-md border px-3 py-2 text-left`, đang chọn giống thẻ hệ điều hành. Cao tối thiểu 44px.
  Bản mockup có mà UniWork chưa có (Windows ARM64, `.msi`, `.rpm`) **không hiện**.
- **Phiên bản:** mockup có `select` nhiều phiên bản; UniWork chỉ có một artifact cho mỗi kênh của deployment, nên
  **không có select**. Phiên bản và kênh hiện ở dòng thứ hai của khối info. Khi server trả nhiều phiên bản (sau này),
  mới thêm `Select` theo mockup - không làm trong lane này.
- **Info:** `bg-muted rounded-lg p-3 text-caption text-muted-foreground`, dòng 1 hai cột (wrap dưới 480px):
  "Yêu cầu: **…**" và "Dung lượng: **…**" (ẩn dung lượng khi API không trả); dòng 2 "Phiên bản **x.y.z** · kênh
  **dev|beta|stable**" + `Badge variant="outline"` "chưa ký" khi artifact `unsigned`.
- **Footer:** trái là dòng trạng thái `role=status` (`text-caption`, màu `text-success` nếu token có, không thì
  `text-muted-foreground`), phải là nút phụ và nút chính:
  - `reason = download`: `[Để sau]` (`Button variant="outline"`) + `[⬇ Tải cho <OS>]` (`Button` primary, icon
    `Download` 16px).
  - `reason = not-installed | expired | error`: thêm `[Mở lại]` (`variant="ghost"`) trước "Để sau".
  - Dưới 480px: footer xếp dọc, nút full-width, nút chính trên cùng, dòng trạng thái ở dưới cùng.
- Màu: chỉ token semantic từ `packages/ui/styles/tokens.css`, không hex của mockup; overlay dùng overlay mặc định
  của `Dialog`. Animation theo `Dialog`, tôn trọng `prefers-reduced-motion`.

### 6.3 Chọn mặc định và trạng thái

| Tình huống | Hệ điều hành chọn sẵn | Chip chọn sẵn | Ghi chú |
| --- | --- | --- | --- |
| Windows x64 nhận diện được | Windows + tag "Phù hợp" | `x64 · .exe` | |
| macOS, đọc được `architecture` | macOS + tag | đúng chip Apple Silicon / Intel | |
| macOS, không rõ chip | macOS + tag | `Apple Silicon · .dmg` | dưới chip: dòng trợ giúp `mac_chip_help` |
| Linux x64 | Linux + tag | `.deb` | |
| Không hỗ trợ (Linux arm64, ChromeOS, Android, iOS, không nhận diện) | Windows, không tag | `x64 · .exe` | `Alert` `unsupported` phía trên radiogroup |
| Kênh không có bản cho hệ điều hành đang chọn | thẻ đó `aria-disabled`, mờ, chú thích "Chưa có" | - | chọn thẻ đó: thay khối chip bằng `Alert` `not_in_channel`, nút chính disabled |
| Kênh không có bản nào | - | - | ẩn radiogroup/chip/info; `Alert role=status` `unavailable` (key cũ); chỉ còn "Để sau" |

Đổi hệ điều hành: chip về bản đầu tiên của hệ điều hành đó, trạng thái tải xoá, "Sau khi tải" đóng lại.

**Chọn bản khác với máy đang dùng** (người dùng 2026-10-02: "khi tải k cần cảnh báo, nhưng có thể focus đúng vào
bản phù hợp nhất với hđh của client. nếu bấm cài đặt bản k phù hợp thì báo lỗi và k cài đặt"):

- Modal **không cảnh báo, không hỏi xác nhận** khi người dùng chọn hoặc tải bản khác máy đang dùng. Nút chính luôn là
  "Tải cho <OS đang chọn>".
- Khi mở modal: thẻ hệ điều hành và chip của bản phù hợp nhất được **chọn sẵn**, có tag "Phù hợp", và **focus ban
  đầu nằm trên nút "Tải cho <OS>" của bản đó** (Enter là tải đúng bản). Đổi thẻ/chip rồi quay lại vẫn thấy tag.
- Bản phù hợp nhất theo thứ tự: đúng hệ điều hành + đúng kiến trúc → đúng hệ điều hành, kiến trúc chưa rõ (Mac:
  Apple Silicon; Windows: `.exe`; Linux: `.deb`) → không nhận diện được: không tag, chọn bản đầu tiên.
- Hướng dẫn "Sau khi tải" theo **bản đã chọn**.
- Việc chặn bản không phù hợp nằm ở **bộ cài** (lane B, §4 "Chặn cài sai máy"): chạy bộ cài trên máy không đúng thì
  báo lỗi rõ ràng và **không cài gì**.

### 6.4 Tải về

- Bấm "Tải cho <OS>": nút `disabled` + `Spinner` + "Đang tải…"; radiogroup khoá tới khi xong.
- Thành công: footer status `started` ("Đã bắt đầu tải <tệp>."), nút trở lại bình thường, tự mở "Sau khi tải" đúng
  nền tảng vừa tải.
- Lỗi: `Alert variant="destructive"` `download_failed` ngay trên footer + nút chính đổi thành `retry`.
- Kênh stable không có bản: không bao giờ hiện bản dev (giữ quy tắc hiện tại, có test).

### 6.5 "Sau khi tải" (theo chip đang chọn; danh sách đánh số `text-body`)

- Windows `.exe`: 1. Giải nén tệp ZIP. 2. Chạy tệp `…-setup.exe`. 3. Nếu Windows báo "Windows protected your PC",
  chọn **More info** → **Run anyway** (bản nội bộ chưa ký).
- Windows ZIP portable: 1. Giải nén tệp ZIP đã tải. 2. Giải nén tiếp tệp ZIP portable bên trong (gói tải về bọc bản portable cùng hồ sơ
  triển khai). 3. Chạy `uniwork-office*.exe` trong thư mục vừa giải nén. (Advisor 2026-10-02, câu hỏi UNI-919.)
- macOS: 1. Giải nén ZIP, mở tệp `.dmg`. 2. Kéo UniWork Office vào Applications. 3. Lần đầu mở: chuột phải vào app
  → **Open** → **Open** (bản nội bộ chưa ký).
- Linux `.deb`: 1. Giải nén ZIP. 2. Mở tệp `.deb` bằng App Center, hoặc chạy `sudo apt install ./<tệp>.deb`.
  3. Mở UniWork Office từ danh sách ứng dụng. Cần gnome-keyring (mặc định trên Ubuntu) để lưu đăng nhập.
- AppImage: 1. Giải nén ZIP. 2. `chmod +x <tệp>.AppImage` rồi chạy. 3. Ubuntu 22.04/24.04 cần
  `sudo apt install libfuse2`.
- Lệnh shell trong `<code>` `font-mono text-caption bg-muted rounded px-1`, kèm nút copy
  (`Button variant="ghost" size="icon-sm"`, aria-label `copy_command`), tên tệp thật thay cho `<tệp>`.

### 6.6 Yêu cầu hệ thống (dòng "Yêu cầu")

- Windows: "Windows 10/11 64-bit". macOS: "macOS 13 Ventura trở lên" (Electron 44.5.0 đang pin yêu cầu macOS 13+, nguồn: electronjs.org breaking-changes
  và release notes v44.0.0; lane UNI-919 xác nhận 2026-10-02). Lane UNI-920 dùng cùng mức này cho
  `LSMinimumSystemVersion` và kiểm tra lúc khởi động. Linux: "Ubuntu 22.04 / 24.04 (x64)"; AppImage: "Linux x64,
  cần libfuse2".
- Server có thể trả `requirements` cho từng bản; có thì dùng giá trị server, không thì dùng chuỗi i18n trên.

### 6.7 Chữ (key dưới `office.desktop.install.*`, đủ vi + en)

| key | vi | en |
| --- | --- | --- |
| `title` | Tải UniWork Office cho máy tính | Get UniWork Office for desktop |
| `description_download` | Chọn hệ điều hành và định dạng phù hợp với máy của bạn. | Choose the operating system and format that fits your computer. |
| `not_installed` (giữ key, đổi chữ) | Ứng dụng máy tính chưa phản hồi. Cài bản phù hợp rồi bấm Mở lại. | The desktop app didn't respond. Install the right version, then select Open again. |
| `os_group` | Hệ điều hành | Operating system |
| `recommended_tag` | Phù hợp | Recommended |
| `format_group` | Kiến trúc & định dạng | Architecture & format |
| `unavailable_os` | Chưa có | Not available |
| `requirements` | Yêu cầu: {{value}} | Requires: {{value}} |
| `size` | Dung lượng: {{value}} | Size: {{value}} |
| `version_line` | Phiên bản {{version}} · kênh {{channel}} | Version {{version}} · {{channel}} channel |
| `unsigned` | chưa ký | unsigned |
| `mac_chip_help` | Không chắc loại chip? Xem tại menu Apple → Giới thiệu máy Mac này. | Not sure which chip? Check Apple menu → About This Mac. |
| `download_for` | Tải cho {{os}} | Download for {{os}} |
| `later` | Để sau | Not now |
| `after_download` | Sau khi tải | After downloading |
| `not_in_channel` | Chưa có bản cho {{os}} ở kênh này. | No {{os}} build in this channel yet. |
| `unsupported` | UniWork Office chưa hỗ trợ thiết bị này. Bạn vẫn có thể tải cho máy khác. | UniWork Office doesn't support this device yet. You can still download it for another computer. |
| `started` | Đã bắt đầu tải {{file}}. ({{file}} = tên tệp trình duyệt lưu, vd. UniWork-Office.zip) | Download started: {{file}}. |
| `description_unavailable` | Kênh này chưa có bản cài đặt. Bạn có thể thử lại sau. | This channel has no installer yet. Try again later. |
| `retry` | Thử lại | Try again |
| `copy_command` | Sao chép lệnh | Copy command |
| `copied` | Đã sao chép | Copied |
| `fmt.win_exe` / `fmt.win_exe_hint` | x64 · .exe / Intel / AMD | x64 · .exe / Intel / AMD |
| `fmt.win_zip` / `fmt.win_zip_hint` | ZIP portable / Không cần cài | Portable ZIP / No install needed |
| `fmt.mac_arm` / `fmt.mac_arm_hint` | Apple Silicon · .dmg / M1, M2, M3, M4 | Apple Silicon · .dmg / M1, M2, M3, M4 |
| `fmt.mac_intel` / `fmt.mac_intel_hint` | Intel · .dmg / Mac đời cũ | Intel · .dmg / Older Macs |
| `fmt.deb` / `fmt.deb_hint` | .deb / Ubuntu, Debian | .deb / Ubuntu, Debian |
| `fmt.appimage` / `fmt.appimage_hint` | .AppImage / Chạy trên mọi bản phân phối x64 | .AppImage / Runs on any x64 distribution |
| `req.windows` / `req.macos` / `req.deb` / `req.appimage` | theo §6.6 | theo §6.6 |
| `os.windows` / `os.macos` / `os.linux` | Windows / macOS / Linux | Windows / macOS / Linux |

Các key cũ (`expired`, `error`, `download_failed`, `downloading`, `unavailable`, `open_again`, `close`, `install`)
giữ nguyên; `download_description` bỏ (thay bằng `description_download`). Giọng văn theo `docs/conventions.md`.

### 6.8 A11y và responsive

- Hai radiogroup có `aria-label` (`os_group`, `format_group`), điều hướng phím mũi tên trong nhóm (RadioGroup
  primitive), thẻ "Chưa có" là `aria-disabled` nhưng vẫn focus được và đọc lý do.
- Focus đầu tiên vào nút chính (không có thì "Mở lại", rồi "Để sau"). Esc và click overlay đóng dialog. Touch
  target ≥ 44px trên coarse pointer; giữ `:focus-visible` toàn cục.
- 390 CSS px: 3 thẻ hệ điều hành vẫn một hàng (thu icon 24px nếu cần), chip wrap, info wrap, footer xếp dọc;
  không thanh cuộn ngang lồng nhau; tên tệp dài bẻ dòng (`break-all` chỉ cho tên tệp). 1440: dialog 560px.

### 6.9 Nghiệm thu UI

Visual Tester đặt ảnh cạnh mockup (mở `docs/office/g3g4/design/installer-picker-mockup.html` trong cùng trình duyệt)
và chụp: mỗi hệ điều hành được nhận diện (Windows, macOS rõ chip, macOS không rõ chip, Linux), không hỗ trợ, kênh
thiếu một hệ điều hành, kênh không có bản nào, focus ban đầu đúng bản phù hợp (Windows, Mac Apple Silicon, Mac Intel, Ubuntu), đang tải, lỗi, "Sau khi tải" của 6 định dạng; 1440 và 390 CSS px;
sáng và tối; chấm 9 tiêu chí UI (team-rules "Tester visual"). Người dùng duyệt giao diện cuối.
