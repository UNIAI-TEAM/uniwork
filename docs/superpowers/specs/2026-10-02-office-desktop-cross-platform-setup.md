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
  88px: icon hệ điều hành 30px + tên (`font-medium`). Không chọn: `border-border bg-background`, hover
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

**Chọn bản khác với máy đang dùng** (người dùng hỏi 2026-10-02). Đây là việc hợp lệ, ví dụ tải giúp máy khác, nên
**không chặn** và không thêm bước xác nhận. Chỉ nhắc khi nhận diện **chắc chắn**:

| Tình huống | Hiện gì |
| --- | --- |
| Khác hệ điều hành (vd. máy Windows, chọn macOS) | `Alert` (default, icon `Info`) ngay trên khối info: `mismatch_os` "Bản này dành cho macOS. Máy bạn đang dùng Windows, nên bản này chỉ cài được trên máy khác." + link `back_to_detected` "Chọn lại bản cho Windows". Nút chính đổi chữ thành `download_os_build` "Tải bản macOS" |
| macOS: chọn Intel trên máy Apple Silicon | `mismatch_rosetta` "Bản Intel vẫn chạy trên Mac chip Apple qua Rosetta nhưng chậm hơn. Nên chọn Apple Silicon." |
| macOS: chọn Apple Silicon trên máy Intel | `mismatch_arch` "Bản Apple Silicon không chạy được trên Mac chip Intel." + link chọn lại |
| Linux: `.deb` ↔ AppImage | không nhắc (cả hai chạy được trên Ubuntu x64) |
| Nhận diện không chắc (Mac không rõ chip, không hỗ trợ) | không nhắc kiến trúc; khác hệ điều hành vẫn nhắc như dòng 1 nếu hệ điều hành chắc |

Hướng dẫn "Sau khi tải" theo **bản đã chọn**, không theo máy đang dùng. Dòng trạng thái sau khi tải ghi rõ hệ điều
hành: `started_for` "Đã bắt đầu tải bản macOS: <tệp>." Nếu người dùng vẫn chạy nhầm bộ cài thì hệ điều hành tự từ
chối (`.exe` không mở trên macOS/Linux, `.dmg` không mở trên Windows), bộ cài không cài gì sai; lane B kiểm thêm
`.deb` báo lỗi kiến trúc rõ ràng khi không phải amd64 (`Architecture: amd64` trong control).

### 6.4 Tải về

- Bấm "Tải cho <OS>": nút `disabled` + `Spinner` + "Đang tải…"; radiogroup khoá tới khi xong.
- Thành công: footer status `started` ("Đã bắt đầu tải <tệp>."), nút trở lại bình thường, tự mở "Sau khi tải" đúng
  nền tảng vừa tải.
- Lỗi: `Alert variant="destructive"` `download_failed` ngay trên footer + nút chính đổi thành `retry`.
- Kênh stable không có bản: không bao giờ hiện bản dev (giữ quy tắc hiện tại, có test).

### 6.5 "Sau khi tải" (theo chip đang chọn; danh sách đánh số `text-body`)

- Windows `.exe`: 1. Giải nén tệp ZIP. 2. Chạy tệp `…-setup.exe`. 3. Nếu Windows báo "Windows protected your PC",
  chọn **More info** → **Run anyway** (bản nội bộ chưa ký).
- Windows ZIP portable: 1. Giải nén. 2. Chạy `uniwork-office*.exe` trong thư mục vừa giải nén.
- macOS: 1. Giải nén ZIP, mở tệp `.dmg`. 2. Kéo UniWork Office vào Applications. 3. Lần đầu mở: chuột phải vào app
  → **Open** → **Open** (bản nội bộ chưa ký).
- Linux `.deb`: 1. Giải nén ZIP. 2. Mở tệp `.deb` bằng App Center, hoặc chạy `sudo apt install ./<tệp>.deb`.
  3. Mở UniWork Office từ danh sách ứng dụng. Cần gnome-keyring (mặc định trên Ubuntu) để lưu đăng nhập.
- AppImage: 1. Giải nén ZIP. 2. `chmod +x <tệp>.AppImage` rồi chạy. 3. Ubuntu 22.04/24.04 cần
  `sudo apt install libfuse2`.
- Lệnh shell trong `<code>` `font-mono text-caption bg-muted rounded px-1`, kèm nút copy
  (`Button variant="ghost" size="icon-sm"`, aria-label `copy_command`), tên tệp thật thay cho `<tệp>`.

### 6.6 Yêu cầu hệ thống (dòng "Yêu cầu")

- Windows: "Windows 10/11 64-bit". macOS: "macOS 12 Monterey trở lên" - lane đối chiếu mức tối thiểu của bản
  Electron đang pin và sửa nếu khác, ghi nguồn trong report. Linux: "Ubuntu 22.04 / 24.04 (x64)"; AppImage: "Linux x64,
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
| `started` | Đã bắt đầu tải {{file}}. | Download started: {{file}}. |
| `retry` | Thử lại | Try again |
| `mismatch_os` | Bản này dành cho {{os}}. Máy bạn đang dùng {{current}}, nên bản này chỉ cài được trên máy khác. | This build is for {{os}}. You're on {{current}}, so it installs only on another computer. |
| `back_to_detected` | Chọn lại bản cho {{current}} | Switch back to {{current}} |
| `download_os_build` | Tải bản {{os}} | Download {{os}} build |
| `mismatch_rosetta` | Bản Intel vẫn chạy trên Mac chip Apple qua Rosetta nhưng chậm hơn. Nên chọn Apple Silicon. | The Intel build runs on Apple chips through Rosetta, but slower. Apple Silicon is recommended. |
| `mismatch_arch` | Bản Apple Silicon không chạy được trên Mac chip Intel. | The Apple Silicon build doesn't run on Intel Macs. |
| `started_for` | Đã bắt đầu tải bản {{os}}: {{file}}. | Download started for {{os}}: {{file}}. |
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
thiếu một hệ điều hành, kênh không có bản nào, chọn khác hệ điều hành, Intel trên Mac chip Apple, đang tải, lỗi, "Sau khi tải" của 6 định dạng; 1440 và 390 CSS px;
sáng và tối; chấm 9 tiêu chí UI (team-rules "Tester visual"). Người dùng duyệt giao diện cuối.
