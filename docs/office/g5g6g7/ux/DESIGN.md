---
name: UniWork Office — G5/G6/G7 surfaces
description: Lớp delta trên shell genoffice đã rebrand (fork UNIAI-TEAM/uniwork-office) cho trung tâm đồng bộ, thư viện offline, trạng thái Lưu, hộp thoại xung đột, thông báo phiên bản mới và nhà cung cấp UniWork AI. Mọi token không liệt kê kế thừa packages/ui/src/tokens.css, apps/shell/src/renderer/src/home.css và apps/*/src/renderer/styles.css tại fork fcfcd29d. Giá trị rgb() (scrim) là có chủ ý, chép nguyên từ fork. Đây là danh sách token duy nhất của G5/G6/G7.
status: final
updated: 2026-10-12
sources:
  - ../../../superpowers/specs/2026-10-02-office-g5-g6-g7-design.md
  - ../../../superpowers/plans/2026-10-12-office-g5-g6-g7.md
colors:
  # Light. Cột "biến fork" ở mục Colors › Bảng ánh xạ cho biết mỗi token lấy từ biến nào.
  surface: '#ffffff'
  surface-subtle: '#f6f7f9'
  chrome-bg: '#ffffff'
  border: '#e3e6ea'
  border-strong: '#d9d9d9'
  border-control: '#606366'
  text-primary: '#232425'
  text-secondary: '#606366'
  text-tertiary: '#909499'
  text-dim: '#605e5c'
  accent: '#0f7fff'
  accent-hover: '#0e72e5'
  accent-soft: '#eaf0fd'
  accent-text: '#0a52e6'
  on-accent: '#ffffff'
  dialog-primary: '#0a52e6'
  dialog-primary-text: '#ffffff'
  ai-action: '#e8663f'
  ai-action-text: '#ffffff'
  danger: '#d13438'
  danger-bg: '#fdf3f3'
  danger-text: '#b3261e'
  danger-border: '#f0c8c9'
  success: '#107c41'
  success-bg: '#eaf7ef'
  success-border: '#c8e8d4'
  warning-text: '#8a5300'
  warning-bg: '#fff4e0'
  warning-border: '#f2d9a6'
  dialog-scrim: 'rgb(0 0 0 / 24%)'
  # Dark
  surface-dark: '#1e1e1e'
  surface-subtle-dark: '#2a2a2a'
  chrome-bg-dark: '#252525'
  border-dark: '#3a3a3a'
  border-strong-dark: '#555555'
  border-control-dark: '#a0a0a0'
  text-primary-dark: '#e4e4e4'
  text-secondary-dark: '#a0a0a0'
  text-tertiary-dark: '#a0a0a0'
  text-dim-dark: '#a0a0a0'
  accent-dark: '#3f99ff'
  accent-hover-dark: '#5ba5ff'
  accent-soft-dark: '#24354d'
  accent-text-dark: '#7aabff'
  on-accent-dark: '#ffffff'
  dialog-primary-dark: '#5a96ff'
  dialog-primary-text-dark: '#0d1220'
  ai-action-dark: '#e8663f'
  ai-action-text-dark: '#ffffff'
  danger-dark: '#ff8a8d'
  danger-bg-dark: '#3a2020'
  danger-text-dark: '#ff8a8d'
  danger-border-dark: '#5a3030'
  success-dark: '#52c082'
  success-bg-dark: '#20342a'
  success-border-dark: '#33543f'
  warning-text-dark: '#f0b95a'
  warning-bg-dark: '#3a2f1a'
  warning-border-dark: '#5a4a28'
  dialog-scrim-dark: 'rgb(0 0 0 / 52%)'
typography:
  # --gs-font-sans của fork; cỡ 18/16/14/12 theo --text-body-lg / tiêu đề frame-dialog / --text-small / --text-caption
  title:
    fontFamily: "Arial, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.35'
  dialog-title:
    fontFamily: "Arial, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: 16px
    fontWeight: '600'
    lineHeight: '1.35'
  body:
    fontFamily: "Arial, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label:
    fontFamily: "Arial, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
  caption:
    fontFamily: "Arial, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
  mono:
    # stack của fork (markdown.css, settings.css)
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 12px
    fontWeight: '400'
rounded:
  sm: 6px
  md: 8px
  lg: 12px
  pill: 14px
  pill-action: 11px
  full: 30px
spacing:
  half: 2px
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  dialog-width: 448px
  dialog-button-height: 36px
  sync-center-width: 880px
  ai-panel-min: 320px
  target-min: 24px
  target-coarse: 44px
  pill-height: 28px
  pill-action-height: 22px
components:
  save-pill:
    # fork .uw-pill: trung tính khi không có tone
    background: '{colors.surface}'
    border: '{colors.border}'
    radius: '{rounded.pill}'
    height: '{spacing.pill-height}'
    text: '{colors.text-secondary}'
    typography: '{typography.caption}'
  save-pill-action:
    # fork .uw-pill-action / .uw-pill-close: 22px nhìn thấy; vùng chạm ::before
    height: '{spacing.pill-action-height}'
    radius: '{rounded.pill-action}'
    hit-area: '{spacing.target-min}'
    hit-area-coarse: '{spacing.target-coarse}'
  save-pill-tone-ok:
    # .uw-pill[data-tone='ok'] — cả pill nhuốm màu, chấm = currentColor
    background: '{colors.success-bg}'
    border: '{colors.success-border}'
    text: '{colors.success}'
  save-pill-tone-warn:
    background: '{colors.warning-bg}'
    border: '{colors.warning-border}'
    text: '{colors.warning-text}'
  save-pill-tone-error:
    background: '{colors.danger-bg}'
    border: '{colors.danger-border}'
    text: '{colors.danger-text}'
  save-pill-tone-info:
    # MỚI: data-tone='info' cho queued — thêm vào tabbar.css của fork
    background: '{colors.accent-soft}'
    border: '{colors.accent-soft}'
    text: '{colors.accent-text}'
  status-badge:
    radius: '{rounded.full}'
    typography: '{typography.caption}'
    padding: '{spacing.half} {spacing.2}'
  status-badge-info:
    background: '{colors.accent-soft}'
    text: '{colors.accent-text}'
  status-badge-warn:
    background: '{colors.warning-bg}'
    text: '{colors.warning-text}'
    border: '{colors.warning-border}'
  status-badge-error:
    background: '{colors.danger-bg}'
    text: '{colors.danger-text}'
    border: '{colors.danger-border}'
  status-badge-ok:
    background: '{colors.success-bg}'
    text: '{colors.success}'
    border: '{colors.success-border}'
  status-badge-neutral:
    background: '{colors.surface-subtle}'
    text: '{colors.text-secondary}'
    border: '{colors.border}'
  new-version-bar:
    background: '{colors.accent-soft}'
    text: '{colors.text-primary}'
    action-text: '{colors.accent-text}'
    radius: '{rounded.md}'
    padding: '{spacing.2} {spacing.3}'
  new-version-bar-warn:
    background: '{colors.warning-bg}'
    border: '{colors.warning-border}'
    text: '{colors.warning-text}'
  new-version-bar-error:
    background: '{colors.danger-bg}'
    border: '{colors.danger-border}'
    text: '{colors.danger-text}'
  dialog:
    # fork .ow-dlg (frame-dialog.css)
    background: '{colors.surface}'
    border: '{colors.border-strong}'
    scrim: '{colors.dialog-scrim}'
    radius: '{rounded.lg}'
    width: '{spacing.dialog-width}'
    padding: '{spacing.4}'
    title: '{typography.dialog-title}'
    body-text: '{colors.text-dim}'
    actions-background: '{colors.surface-subtle}'
    actions-border-top: '{colors.border}'
  button-dialog-primary:
    # .ow-dlg-btn.primary
    background: '{colors.dialog-primary}'
    text: '{colors.dialog-primary-text}'
    radius: '{rounded.md}'
    min-height: '{spacing.dialog-button-height}'
  button-dialog-danger:
    # .ow-dlg-btn.danger
    background: '{colors.danger-bg}'
    border: '{colors.danger-border}'
    text: '{colors.danger-text}'
    radius: '{rounded.md}'
    min-height: '{spacing.dialog-button-height}'
  button-dialog-ghost:
    # .ow-dlg-btn.ghost — lối thoát (Hủy, Quay lại)
    text: '{colors.text-dim}'
    radius: '{rounded.md}'
    min-height: '{spacing.dialog-button-height}'
  button-dialog-disabled:
    # aria-disabled trong hộp thoại; danger giữ chữ danger-text
    background: '{colors.surface-subtle}'
    border: '{colors.border-control}'
    text: '{colors.text-secondary}'
  button-secondary:
    # nút ở đầu S2 và hàng S2/S3 (khuôn nút shell)
    background: '{colors.surface}'
    border: '{colors.border-strong}'
    text: '{colors.text-primary}'
    radius: '{rounded.sm}'
  link-action:
    text: '{colors.accent-text}'
    min-height: '{spacing.target-min}'
    min-height-coarse: '{spacing.target-coarse}'
  radio-control:
    ring: '{colors.border-control}'
    selected: '{colors.accent-text}'
  sync-row:
    background: '{colors.surface}'
    border-bottom: '{colors.border}'
    padding: '{spacing.3} {spacing.4}'
  sync-tab:
    text: '{colors.text-secondary}'
    selected-text: '{colors.text-primary}'
    indicator: '{colors.accent}'
    count-background: '{colors.surface-subtle}'
    count-text: '{colors.text-secondary}'
  download-progress:
    track: '{colors.surface-subtle}'
    fill: '{colors.accent}'
    radius: '{rounded.full}'
    height: '{spacing.1}'
  usage-header:
    text: '{colors.text-primary}'
    bar-fill: '{colors.accent}'
    bar-track: '{colors.surface-subtle}'
  queue-popover:
    background: '{colors.surface}'
    border: '{colors.border}'
    radius: '{rounded.md}'
    padding: '{spacing.3} {spacing.4}'
  toast:
    background: '{colors.text-primary}'
    text: '{colors.surface}'
    radius: '{rounded.md}'
  provider-row:
    radius: '{rounded.md}'
    padding: '{spacing.2} {spacing.3}'
    text: '{colors.text-primary}'
    subline: '{colors.text-secondary}'
    selected-background: '{colors.accent-soft}'
    selected-indicator: '{colors.accent}'
    selected-subline: '{colors.text-primary}'
  picker-footer:
    border-top: '{colors.border}'
    text: '{colors.text-secondary}'
    typography: '{typography.caption}'
  composer-note:
    radius: '{rounded.md}'
    typography: '{typography.caption}'
  ai-disclosure:
    background: '{colors.surface-subtle}'
    border: '{colors.border}'
    text: '{colors.text-secondary}'
    radius: '{rounded.md}'
    typography: '{typography.caption}'
  result-chip:
    radius: '{rounded.full}'
    typography: '{typography.caption}'
  lock-panel:
    background: '{colors.surface-subtle}'
    border: '{colors.border}'
    text: '{colors.text-primary}'
    radius: '{rounded.lg}'
---

## Brand & Style

Các bề mặt G5/G6/G7 sống **bên trong** shell genoffice đã rebrand thành UniWork Office; chúng không có thương hiệu riêng.
Tư thế thị giác là "công cụ văn phòng bình tĩnh": nền trắng/xám nhạt, màu nhấn của app đang mở, chữ đen xám, không
gradient, không minh họa. Trạng thái đồng bộ và AI phải đọc được trong một liếc mắt nhưng không cạnh tranh với nội dung
tài liệu. Mọi điều thuộc về *dữ liệu của người dùng có an toàn không* được nói thẳng bằng chữ, không chỉ bằng màu hay
biểu tượng.

DESIGN.md này chỉ ghi phần **delta** của G5/G6/G7 (token ở frontmatter). Token, nút, dropdown, panel AI,
`AiModelPicker`, pill `uw-pill` trong `UniworkChrome.tsx`/`tabbar.css`, khuôn hộp thoại
`web/modules/shared/frame-dialog.ts` + `frame-dialog.css` và `UniworkCloudPane` của fork là hợp đồng gốc; đội nhận bàn
giao không tạo bảng màu thứ hai. Hành vi nằm ở EXPERIENCE.md.

## Colors

**Mục tiêu tương phản (WCAG 2.2 AA, cả hai chế độ):** chữ ≥ 4.5:1 với nền nó nằm trên; thành phần UI không phải chữ
(chấm, viền điều khiển, vòng radio, focus ring, progress fill) ≥ 3:1. Viền badge và viền nút phụ là trang trí; trạng
thái luôn mang bằng chữ. Kiểm bằng e2e đo trên trang render (kiểu `e2e/onboarding-contrast.spec.ts`), không bằng đọc token.

- **Accent của app chủ** — mỗi app fork có `--accent`/`--accent-soft` riêng: Docs/Markdown `#185abd` (dark `#4a9eff`,
  soft dark `#1e3a5f`); Sheets `#217346` (`--excel-green`; dark `#34a853`, soft dark `#1d3328`); PDF/Slides `#c43e1c`
  (dark `#e8663f` cho cả hai); HTML `#232425` (dark `#e4e4e4`); shell/Home `#0f7fff`. Thành phần phụ thuộc accent (Provider
  row đang chọn, Download progress fill, Sync tab indicator, focus ring) dùng `var(--accent)`/`var(--accent-soft)` của app
  đang hiển thị lúc chạy; giá trị `{colors.accent}`/`{colors.accent-soft}` trong frontmatter là của shell. Accent **không
  bao giờ là màu chữ** (PDF accent trên accent-soft chỉ 4.44:1; shell accent trên trắng 3.82:1) — chỉ cho chấm, fill, viền
  chọn, focus ring.
- **`{colors.accent-text}`** (slot mới, giá trị `--color-dialog-primary` của fork; dark = `--color-dialog-primary-hover`
  dark) — chữ màu xanh duy nhất: badge info, Link action, hành động trong New-version bar, pill tone info. Đo: 6.25:1 trên
  trắng, 5.47:1 trên `accent-soft`; dark `#7aabff` 7.22:1 trên `surface-dark`, 5.38:1 trên `accent-soft-dark`.
- **Dialog (`{colors.dialog-primary}`, `{colors.text-dim}`)** — theo `frame-dialog.css`: nút chính `dialog-primary`
  (6.25:1 / 6.44:1), câu mô tả và nút lối thoát `--text-dim` (6.46:1 trên trắng, 6.02:1 trên dải nút `surface-subtle`;
  dark 6.38 / 5.49). Trong hộp thoại xung đột, nút chính là "Tải lại bản mới nhất", không phải "Ghi đè".
- **Warning (`{colors.warning-text}`, `{colors.warning-bg}`, `{colors.warning-border}`)** — cần chú ý nhưng dữ liệu an
  toàn. Trạng thái nào mang tone nào: cột Tone/Badge của các bảng ở EXPERIENCE › State Patterns (nguồn duy nhất).
- **Danger (`{colors.danger-text}`, `{colors.danger-bg}`, `{colors.danger-border}`, `{colors.danger}`)** — trạng thái
  tone error theo các bảng đó, và nút "Ghi đè"/"Bỏ…" (`button-dialog-danger`). Không dùng đỏ cho "chưa lưu". Dark:
  chấm/viền đỏ dùng `{colors.danger-dark}` (= `--danger-text` dark của fork). `--danger` dark `#d13438`
  đạt 3.38:1 trên `#1e1e1e` (vừa đủ cho chấm) nhưng lệch với `danger-text` dark; dùng một màu đỏ cho cả chữ và chấm.
- **Success (`{colors.success}`)** — chỉ cho receipt đã khớp ("Đã lưu vào UniWork") và bản offline đã kiểm checksum.
  Không dùng xanh lá cho "đã xếp hàng".
- **AI action cam (`{colors.ai-action}`)** — giữ vai trò trong panel AI genoffice (nút gửi chỉ có biểu tượng). `ai-action-text`
  và `on-accent` chỉ cho biểu tượng/UI (3.28:1 và 3.82:1 — không đạt cho chữ); G5/G6 không đặt chữ lên nền accent/ai-action.
- **`text-tertiary`** chỉ cho chấm `dirty` trên nền trắng (3.05:1) và icon trang trí; không cho chữ (placeholder dùng
  `text-secondary`).
- **Provider row đang chọn** — nền `accent-soft` của app chủ; tên và dòng phụ dùng `{colors.text-primary}`
  (`provider-row.selected-subline`): `text-secondary` trên `#1e3a5f` (Docs/Markdown dark) chỉ 4.40:1, `text-primary` 9.05:1.
- **`{colors.border-control}`** (slot mới, giá trị = `text-secondary`) — vòng radio chưa chọn, viền checkbox, viền nút
  `aria-disabled`, ≥ 3:1 (6.04 / 6.38). `border-strong` (1.41 / 2.24) giữ cho nút phụ kế thừa của fork, vì chữ của nút đã
  nhận diện nó; ghi chú cho đội fork: nâng `border-strong` lên ≥ `#949494` là cải tiến riêng, không thuộc G5.

**Token mới (thêm vào ba khối token của fork — `:root`, `[data-theme='dark']`, `@media (prefers-color-scheme: dark)` —
trong `packages/ui/src/tokens.css`):** `--accent-text` (`#0a52e6` / `#7aabff`), `--border-control` (`#606366` / `#a0a0a0`),
`--danger-strong` cho `{colors.danger-dark}` (`#d13438` / `#ff8a8d`), và tone `info` của `uw-pill` trong `tabbar.css`.
Không có biến CSS mới nào khác và không có giá trị hex mới: mọi giá trị đã tồn tại trong fork ở biến khác. Các khóa
frontmatter còn lại (ví dụ `on-accent-dark`, `ai-action-text-dark`, `text-dim`, `status-badge-neutral`) là tên DESIGN cho
biến/khuôn **sẵn có** của fork, không thêm vào `tokens.css`.

**Bảng ánh xạ (token → biến fork):** `surface` `--surface`; `surface-subtle` `--surface-subtle`; `border` `--border`;
`border-strong` `--border-strong`; `text-primary` `--text-primary` (fork còn `--text` `#242424` cho chữ editor và tiêu đề
`frame-dialog` — G5/G6 dùng `--text-primary` cho bề mặt mới); `text-secondary` `--text-secondary`; `text-tertiary`
`--text-tertiary` (dark `#a0a0a0`, không phải `--color-text-tertiary` `#8a8a8a`); `text-dim` `--text-dim`; `accent*`
`--accent*` của app chủ (shell: `home.css`); `dialog-primary*` `--color-dialog-primary*`; `ai-action*`
`--color-ai-action*`; `danger`, `danger-bg`, `danger-text`, `danger-border` và bản `-dark` của chúng cùng tên, trừ
`danger-dark` → `--danger-strong` (mới, xem trên); `success*`, `warning*` cùng tên; `dialog-scrim` `--color-dialog-scrim`.

Mỗi token màu có cặp light/dark; chế độ theo `data-theme` của fork (`light`, `dark`, theo hệ thống).
**Forced colors** (`forced-colors: active`): Download progress fill và chấm trạng thái dùng `forced-color-adjust: none`
với `CanvasText`/`Highlight`; badge và pill giữ viền 1px `CanvasText`; radio là `<input type=radio>` gốc. Tùy chọn đang
chọn của picker (`.ai-model-item.selected`) và tab S2 đang chọn (`[aria-selected=true]`) có viền 2px `Highlight` (không
chỉ nền); nút `[aria-disabled=true]` dùng chữ và viền `GrayText`; vòng focus là `outline` nên tự thành `Highlight`.

## Typography

Kế thừa `--gs-font-sans` của fork. `{typography.title}` (18px, `--text-body-lg`) cho tiêu đề trung tâm đồng bộ và panel
khóa; `{typography.dialog-title}` (16px, như `.ow-dlg-title`) cho tiêu đề hộp thoại; `{typography.body}` (14px,
`--text-small`) cho nội dung và câu mô tả hộp thoại; `{typography.label}` (14px, `--text-small`) cho nút và nhãn cột;
`{typography.caption}` (12px, `--text-caption`) cho pill trạng thái, badge, dòng thời gian, lời công bố AI. G5/G6 không
thêm biến cỡ chữ. `{typography.mono}` (stack của fork) chỉ cho mã phiên bản rút gọn (`v12`, checksum 8 ký tự) trong "Chi
tiết kỹ thuật". Chữ tiếng Việt có dấu: line-height tối thiểu 1.35; nhãn pill dùng `line-height: 18px` như fork để không
cắt dấu.

## Layout & Spacing

Thang 4px của fork. Hộp thoại xung đột theo `frame-dialog.css`: rộng tối đa `{spacing.dialog-width}`, phần đầu đệm
`{spacing.4}`, hàng nút xếp dọc ở **mọi** chiều rộng, mỗi nút rộng 100% và cao tối thiểu `{spacing.dialog-button-height}`,
trên dải nền `surface-subtle` có viền trên; bước xác nhận dùng cùng hộp thoại. Trung tâm đồng bộ là một pane trong cửa sổ
Cài đặt/Workbench của shell, rộng tối đa `{spacing.sync-center-width}`: đầu trang, thanh tab, bảng hàng `sync-row`.
Panel AI giữ bố cục genoffice; khi hẹp hơn `{spacing.ai-panel-min}` lời công bố thu thành một dòng có nút "Chi tiết".
Frame web: New-version bar nằm dưới thanh công cụ của renderer, trên vùng tài liệu, không đè nội dung.

Vùng chạm: `{spacing.target-min}` / `{spacing.target-coarse}`; quy tắc và ngoại lệ của nút pill ở EXPERIENCE ›
Accessibility Floor › S1 và › Vùng chạm (nguồn duy nhất).

## Elevation & Depth

Không thêm lớp đổ bóng. Hộp thoại dùng `--shadow-modal-strong` (giá trị dark riêng của fork) và scrim
`{colors.dialog-scrim}`; menu, Queue popover và picker dùng `--shadow-menu`. New-version bar, Lock panel và AI disclosure
là phẳng, phân tách bằng nền.

## Shapes

`{rounded.pill}` (14px, nửa chiều cao 28px) cho `uw-pill`, `{rounded.pill-action}` cho nút trong pill; `{rounded.full}`
cho badge, Result chip và số đếm tab; `{rounded.sm}` cho nút shell; `{rounded.md}` cho nút hộp thoại, New-version bar,
popover, Provider row, AI disclosure, Composer note, Toast; `{rounded.lg}` cho hộp thoại và Lock panel. Không thêm bán
kính mới.

## Components

Tên thành phần dùng giống nhau ở DESIGN.md, EXPERIENCE.md và chú thích trong mockup; mã S theo EXPERIENCE › Information
Architecture. Mục này chỉ nói hình thức; hành vi và ARIA ở EXPERIENCE (Component Patterns, Accessibility Floor).

- **Save pill (S1)** — mở rộng `uw-pill`, giữ anatomy của fork: chấm/spinner + nhãn + tối đa một nút. Mô hình **tone**
  của fork: cả pill nhuốm màu theo `data-tone` (`ok` → `save-pill-tone-ok`, `warn` → `save-pill-tone-warn`, `error` →
  `save-pill-tone-error`), không tone = trung tính `save-pill`; chấm là `currentColor`. Tone mới `info`
  (`save-pill-tone-info`). Nút `save-pill-action`. Nhãn co theo chiều rộng (ellipsis) như fork. Mock:
  [sync-center.html](mockups/sync-center.html) (S1).
- **Queue popover (S4)** — popover của pill (khuôn menu của shell), `queue-popover`; tối đa ba dòng + hai nút. Mock:
  [sync-center.html](mockups/sync-center.html) (S4).
- **Status badge (S2, S3)** — `status-badge-info`, `-warn`, `-error`, `-ok`, `-neutral`; luôn có chữ; viền là trang trí.
  Ánh xạ trạng thái → tone ở EXPERIENCE › State Patterns. Mock: [sync-center.html](mockups/sync-center.html) (S2, S3).
- **Sync tab (S2)** — theo tab Cài đặt của shell: chữ `text-secondary`, tab chọn `text-primary` + gạch dưới 2px
  `var(--accent)`; số đếm là badge neutral (không đổi màu khi chọn).
- **Usage header (S3)** — một dòng chữ + thanh `{spacing.1}` trang trí + nút "Thêm tài liệu…".
- **Sync row (S2, S3)** — tên tài liệu (nút), không gian làm việc, badge, dòng phụ (thời gian, kích thước, lý do), nút
  hành động. Mock: [sync-center.html](mockups/sync-center.html) (S2, S3).
- **Download progress (S2, S3)** — `download-progress` (cao `{spacing.1}`), luôn đi kèm chữ "12,4 / 30,0 MB". Mock:
  [sync-center.html](mockups/sync-center.html) (S3).
- **Sync center (S2)** — pane của shell gồm Sync header (dòng tài khoản/kết nối + nút "Đồng bộ ngay"/"Tạm dừng gửi"),
  Sync header status line (một dòng chữ `{typography.body}`, màu theo tone của điều kiện, không nền), Sync tab và bảng
  Sync row; Usage header nằm trong tabpanel S3. Mock: [sync-center.html](mockups/sync-center.html) (S2).
- **Second-window bar, Lock-while-open bar (S1, S11)** — skin của New-version bar: `new-version-bar` (info) cho
  Second-window bar, `new-version-bar-error` cho Lock-while-open bar; nút trong thanh là Link action.
- **Sign-out prompt (S1, S2)** — hộp thoại shell, skin `.ow-dlg` như Conflict dialog: `button-dialog-ghost` "Quay lại",
  `button-dialog-danger` "Đăng xuất"; trạng thái chờ là spinner + `uwSignOutWaiting` trong thẻ.
- **Discard confirm (S2, S3)** — xác nhận ngay trong Sync row: câu `{typography.caption}` + `button-dialog-danger` cỡ nhỏ
  "Bỏ" + Link action "Quay lại"; hàng không đổi chiều cao quá hai dòng.
- **New-version bar (S6)** — `new-version-bar` (sạch, đã nạp), `new-version-bar-warn` (dirty/AI/có intent),
  `new-version-bar-error` (mất quyền, đã xóa, nạp thất bại). Nút trong thanh là Link action. Mock:
  [conflict-dialog.html](mockups/conflict-dialog.html) (S6).
- **Conflict dialog (S5)** — **skin của fork thắng**: `.ow-dlg` 448px, tiêu đề 16px, câu mô tả `--text-dim`, hàng nút xếp
  dọc toàn chiều rộng trên dải `surface-subtle`, `button-dialog-primary` "Tải lại bản mới nhất", `button-dialog-ghost`
  "Lưu thành bản sao…" (không có token nút phụ riêng; chỉ khi còn quyền sửa), `button-dialog-danger`
  (nền `danger-bg`) "Ghi đè…", `button-dialog-ghost` "Hủy", nút X 28px ở góc. Desktop vẽ cùng skin. **Delta duy nhất so
  với khuôn fork:** (1) bảng hai cột "Bản của bạn" / "Bản trên UniWork" (`dl` trên nền `surface-subtle`, viền `border`,
  bo `{rounded.md}`; phiên bản, thời điểm, người lưu) cùng Link action "Xem khác biệt" trong slot nội dung; (2) bước xác
  nhận thay nội dung trong cùng thẻ (radio, câu xác nhận). Dòng lỗi trong thẻ dùng màu danger như Composer note lỗi; nút
  `aria-disabled` dùng `button-dialog-disabled`. Thứ tự nút: EXPERIENCE › State Patterns › Conflict dialog (S5). Mock:
  [conflict-dialog.html](mockups/conflict-dialog.html) (S5).
- **Radio group (S5 bước 2, desktop)** — `<fieldset>` + `<input type=radio>` gốc trong khung `border` bo `{rounded.md}`,
  vẽ bằng `radio-control`.
- **Link action (S1, S5, S6, S9)** — "Xem hàng chờ", "Xem khác biệt", "Xem thay đổi", "Đóng", "Để sau": chữ
  `{colors.accent-text}` (hoặc màu chữ của thanh chứa nó), gạch chân, vùng chạm theo Layout & Spacing.
- **Toast (S1, S2)** — toast sẵn có của shell, `toast`; không có mock riêng.
- **Lock panel (S11)** — `lock-panel` trong vùng editor: biểu tượng khóa + tiêu đề `{typography.title}` + câu + nút.
  Mock: [sync-center.html](mockups/sync-center.html) (S11).
- **Provider row (S7)** — một tùy chọn trong `AiModelPicker` như các nhà cung cấp khác, biểu tượng UniWork (cần thêm id
  `uniwork` vào `ProviderLogo`), tên "UniWork AI". Desktop: dòng phụ tín dụng `provider-row.subline`, tách khỏi tên. Web:
  không có dòng phụ. Chọn: `selected-background` + dấu chọn `selected-indicator` (accent của app chủ lúc chạy), chữ
  `selected-subline`. Focus của tùy chọn (kể cả tùy chọn đang chọn): viền trong 2px `var(--accent)` (EXPERIENCE ›
  Accessibility Floor › Focus ring). Mock: [ai-provider-states.html](mockups/ai-provider-states.html) (S7).
- **Picker footer (S7)** — dòng chú thích dưới danh sách, sau nút "Quản lý" của picker, `picker-footer`, kèm một nút.
  Mock: [ai-provider-states.html](mockups/ai-provider-states.html) (S7).
- **Composer note (S7–S9)** — ghi chú phía trên composer (khuôn `ai-notice.ts`/`acct-notice` của fork): warn, error
  hoặc neutral theo nghĩa.
- **AI disclosure (S8)** — khối `ai-disclosure` dưới composer: biểu tượng thông tin + một câu; dạng mở rộng có nút "Đã
  hiểu" và "Tìm hiểu thêm".
- **Result chip (S9)** — nhãn loại kết quả ở đầu mỗi câu trả lời, `result-chip` với màu của Status badge: "Trả lời"
  (info), "Cần làm rõ" (warn), "Đã sửa trong tài liệu" (ok), "Chưa hỗ trợ" (neutral), "Lỗi" (error). Mock:
  [ai-provider-states.html](mockups/ai-provider-states.html) (S9).

Mockup chỉ minh họa; DESIGN.md và EXPERIENCE.md thắng khi lệch. Biến `--page` (nền trang) trong mockup là riêng của mockup.

## Do's and Don'ts

| Do | Don't |
| --- | --- |
| Dùng token và component sẵn có của fork; chỉ thêm trạng thái và các slot mới đã liệt kê | Tạo bảng màu, font hoặc bộ nút mới cho G5/G6 |
| Nói bằng chữ dữ liệu đang ở đâu ("trên máy này", "trên UniWork") | Dùng một dấu tích xanh cho cả checkpoint, đã xếp hàng và đã lưu |
| Hộp thoại xung đột theo skin và thứ tự của EXPERIENCE › State Patterns › Conflict dialog (S5) | Vẽ lại hàng nút ngang hoặc đặt "Ghi đè" là nút chính |
| Chữ xanh dùng `accent-text`; accent của app chỉ cho chấm, fill, viền chọn | Đặt chữ màu `--accent` lên trắng hoặc `accent-soft` |
| Đỏ chỉ cho bị chặn/thất bại/mất quyền/khóa | Tô đỏ trạng thái "chưa lưu" hoặc "đã xếp hàng" |
| Giữ panel AI, picker và composer của genoffice | Dựng panel AI thứ hai cho UniWork AI |
