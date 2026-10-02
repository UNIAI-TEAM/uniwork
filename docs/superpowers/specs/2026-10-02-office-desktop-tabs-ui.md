# UniWork Office desktop — thanh tiêu đề có tab tài liệu

> **Trạng thái:** in-progress (UNI-917)

Người dùng 2026-10-02 (ảnh màn chọn workspace trên app): "chỗ này trên app cũng cần làm cho đẹp hơn nhé. làm UI các
tab tài liệu, kiểu kiểu của gen office ấy. logo cũng nên đưa lên header trên cùng".

Hiện trạng: hai thanh chồng nhau. Thanh caption 32px (`apps/office-desktop/renderer/desktop-frame.tsx`) chỉ có chữ
"UniWork Office" cạnh nút cửa sổ OS; dưới nó là header 48px (`renderer/signed-in-shell.tsx`) có logo, tên workspace,
tài khoản. Mỗi lúc chỉ mở được một tài liệu (`library.fileOpenQueued`).

Nguồn tham chiếu (chỉ đọc, không chép code): genoffice `apps/shell/src/renderer/src/TabBar.tsx` + `tabbar.css`,
`main/title-bar-overlay.ts`, `main/tab-manager.ts` (pin 09485f88). Map vào primitives `packages/ui`, token ngữ nghĩa
và quy tắc CLAUDE.md (renderer sandbox, preload allowlist, main giữ OS/window policy).

## 1. Bố cục

```
y=0 ┌────────────────────────────────────────────────────────────────────────────────────┐
    │ ◆ │ ⌂ Thư viện │▕ 📄 Báo cáo quý.docx ● ×▏│ 📊 Ngân sách.xlsx × │ + │ ▾ │  (GA) │ ─ □ × │ 40px
    │logo pinned tab   tab đang mở (plate bg-background)  tab thường      new  all  avatar  OS
y=40├───────────────── plate tab đang mở liền với nội dung bên dưới ─────────────────────────┤
    │ BreadcrumbHeader của màn hiện tại (Thư viện: workspace switcher + tìm kiếm;           │
    │ tài liệu: OfficeShell như hiện nay)                                                   │
    └────────────────────────────────────────────────────────────────────────────────────────┘
```

- Một thanh 40px duy nhất thay cho caption 32px + header 48px. Nền `bg-muted` (token mới `--tabstrip` nếu cần, khai
  báo cả `:root` và `.dark`), viền dưới `border-border`.
- Trái: logo mark UniWork (`Logo variant="mark"`, 20px, `@uniwork/ui/brand`) trong ô 40×40, là vùng kéo cửa sổ; trên
  macOS đặt sau khoảng trống traffic light (`env(titlebar-area-x)`).
- Tab cố định `Thư viện` (icon `House`/`Library`, không đóng, không kéo, không co). Bấm = về thư viện.
- Tab tài liệu: icon theo định dạng (tái dùng `DocumentTypeIcon` của views), tên rút gọn bằng ellipsis, chấm `●` khi
  chưa lưu (từ save coordinator của tab), nút `×` hiện khi hover/tab đang mở. Cao 32px (mt 8px), rộng cơ bản 220px,
  co tới tối thiểu 112px, bo góc trên 10px, chữ `text-caption`. Tab đang mở: plate `bg-background` liền với nội dung;
  hover: capsule `bg-background/70`; tab thường ngăn cách bằng vạch 1×16px `bg-border`.
- `+` (28px tròn): menu Tài liệu DOCX mới / Mở tệp trên máy (đúng các action thư viện hiện có, không thêm capability).
- `▾` tất cả tab: Popover danh sách tab khi tràn; strip cuộn ngang (wheel → ngang), tab đang mở luôn được cuộn vào.
- Phải: avatar tài khoản (menu: tên, email, Đổi workspace, Đăng xuất) đặt trước vùng nút cửa sổ OS
  (`env(titlebar-area-width)`), rồi mới tới nút OS do `titleBarOverlay` vẽ (cao 40px, màu theo theme).
- Kéo cửa sổ: thanh là `-webkit-app-region: drag`; tab, nút và avatar là `no-drag`.

## 2. Hành vi tab

- Nhiều tài liệu mở đồng thời trong cùng một renderer (không dùng `WebContentsView` mỗi tab như genoffice: editor
  UniWork là component React dùng chung `packages/views`, một renderer sandbox giữ allowlist preload và cache Query
  chung). Tab không hiển thị giữ editor mounted nhưng `hidden`/`inert` để không mất undo/selection; giới hạn 8 tab, mở
  thêm thì báo và gợi ý đóng tab cũ.
- Mỗi tab có save coordinator, draft recovery và local-file handle riêng; `Ctrl+S`/menu Save chỉ tác động tab đang
  mở. Main thay `activeDocumentId` đơn bằng tập tài liệu đang mở (checkpoint bảo vệ theo từng tài liệu).
- Đóng tab có thay đổi chưa lưu: hộp thoại Lưu / Không lưu / Huỷ (tái dùng luồng rời trang G4-04b). Đóng cửa sổ hỏi
  một lần cho mọi tab bẩn.
- Mở lại tài liệu đã có tab → chuyển tới tab đó, không mở bản thứ hai. Deep link / mở tệp từ OS → tab mới.
- Phím: `Ctrl+Tab`/`Ctrl+Shift+Tab` chuyển tab, `Ctrl+W` đóng tab, `Ctrl+T` mở menu `+`, `Ctrl+1..8`.
- Kéo để sắp xếp: ngoài phạm vi lần này.
- Đổi workspace/tài khoản/đăng xuất: đóng mọi tab sau khi xử lý tab bẩn (generation tăng như G4-02/03).

## 3. Màn chọn workspace và thư viện

- Picker (`renderer/library/picker.tsx`, đã gọn nhóm một lựa chọn ở `ffeb129e`): đặt trong card `max-w-xl` căn giữa,
  tiêu đề `text-title`, mỗi lựa chọn là hàng radio 44px có icon (Server/User/Building/LayoutGrid).
- Thư viện: dùng `CollectionPageHeader` (icon, tiêu đề, số lượng, nút Tài liệu mới / Mở tệp) như web.

## 4. i18n, theme, a11y

- Mọi chuỗi qua `t()` vi/en (`officeDesktop.tabs.*`); không literal trong JSX.
- Light/dark: `titleBarOverlay` đổi màu theo theme qua `desktop:window-theme` hiện có; contrast AA cho chữ tab.
- Strip là `role="tablist"`, tab `role="tab"` + `aria-selected` + `aria-controls`; nút `×` có aria-label "Đóng
  {{name}}"; `:focus-visible` toàn cục; touch target ≥ 44px trên coarse pointer.

## 5. Ngoài phạm vi

Định dạng (Advisor 2026-10-02, trả lời UNI-917): desktop vẫn chỉ DOCX như G4-06a. Mô hình tab không phụ thuộc định
dạng (định dạng lấy từ metadata tài liệu, icon qua `DocumentTypeIcon`), có unit test với metadata giả của nhiều định
dạng; gắn editor XLSX/PPTX/PDF/MD/HTML trên desktop là việc của G4-06b..f (UNI-835).


Kéo tab ra cửa sổ mới, kéo sắp xếp, tab trên web, đồng bộ tab giữa thiết bị.

## 6. Nghiệm thu

- Unit/jsdom: mở/chuyển/đóng tab, chống trùng tài liệu, chấm chưa lưu, hộp thoại đóng tab bẩn, Ctrl+S chỉ tab đang
  mở, giới hạn tab, đổi tài khoản đóng tab; main: checkpoint theo từng tài liệu, IPC mới có schema + validate.
- `node scripts/office/check-boundaries.mjs`, `pnpm knip`, desktop typecheck/lint/test, 500 dòng/file, coverage floor.
- Tester visual trên bản đóng gói: light + dark, Windows 1360×900 và 720×550 (tràn tab, 8 tab), mở 3 tài liệu DOCX (2 cloud + 1 tệp
  trên máy), sửa một tab rồi đóng; đối chiếu genoffice shell và unicom-ui-design. Người dùng duyệt giao diện cuối.
