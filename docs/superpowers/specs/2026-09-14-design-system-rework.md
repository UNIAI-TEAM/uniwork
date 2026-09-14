# UniWork — Đánh giá và làm lại hệ token (design system) theo hướng shell trắng

> **Trạng thái:** Đã triển khai trên working tree `develop` (2026-09-14, phiên tự
> động; chưa commit, chưa có lượt duyệt của chủ sở hữu sản phẩm). Các quyết định
> ở §3 là lựa chọn của người viết; câu hỏi cần quangpd chốt nằm ở §6.

**Ngày:** 2026-09-14
**Phạm vi:** `packages/ui/styles/tokens.css`, `base.css`, primitive `Button`
(`brandSubtle`), `IconTile`, shell (`AppSidebar`, `WorkspaceTopBar`), màn Thông
báo (`notifications/*`). Không đụng logo, không đụng IA điều hướng.
**Tham chiếu thị giác:** ảnh màn Thông báo của unidigiwork (sidebar trắng, top bar
trắng có CTA "+ New" tô màu brand, hộp thư hai cột, popover thông báo với vòng tròn
icon theo tint module). Lấy *hướng*, không chép pixel.

## 1. Kết luận đánh giá

Hệ token hiện tại (đợt ClickUp 2026-09-10) đã ở mức tốt: mọi cặp màu có số đo
WCAG, test hợp đồng light/dark, trục accent tách khỏi light/dark, tint tách khỏi
signal, thang chữ theo vai trò, radius tường minh. Bốn khoảng cách so với chuẩn
"đẳng cấp thế giới" (Linear / Notion / Radix / Atlassian):

| # | Khoảng cách | Biểu hiện trong code | Hậu quả |
|---|---|---|---|
| 1 | **Lớp mặt phẳng (planes) không cùng thứ tự ở hai theme** | Light: shell `#f1f1f9` < page `#f8f9fa` < card trắng. Dark: page `#111` < card `#181818` < shell `#1e1e1e` — shell *sáng hơn* card | Dark mode vẽ elevation ngược; content card trông "lún" |
| 2 | **Signal chỉ có 1 giá trị, view tự pha alpha** | 48 chỗ `bg-success/10`, `bg-destructive/20`, `text-info`… | Cùng một badge đo tương phản khác nhau trên card và trên band `--muted`; không thể kiểm bằng test |
| 3 | **CTA đen tách khỏi brand** | `--primary: #202020`, trong khi badge chưa đọc, chấm chọn, nút "+ New" ở mock đều màu brand | Hai "màu chú ý" trên cùng màn (đen + tím); sidebar badge lại hồng — ba màu cho một ý |
| 4 | **Motion và type thiếu vai trò** | `220ms`/`0.15s`/`cubic-bezier(...)` rải trong `base.css`, khác `lib/motion.ts`; không có vai trò eyebrow/overline nên mỗi màn tự ghép `text-caption uppercase tracking-…` | CSS và motion/react chạy tốc độ khác nhau; nhãn nhóm mỗi nơi một kiểu |

Ngoài ra: `--radius-xl` 14px lệch với popover/dialog của mock (16px); shadow chỉ
dùng được qua `shadow-[var(--menu-shadow)]`, không có utility.

## 2. Nguyên tắc sau khi làm lại

Sáu nhóm token, mỗi nhóm một chủ sở hữu (ghi ở đầu `tokens.css`):

1. **Planes** — `app-shell → sidebar = page-canvas = background → surface →
   surface-raised`, cùng thứ tự ở cả hai theme.
2. **Ink** — `foreground / muted-foreground / faint-foreground` (bậc 3 chỉ cho
   dấu phi văn bản).
3. **Brand** — một hue, trục accent di chuyển nó. `--primary` **là** brand fill;
   `--brand-subtle` là brand pha loãng (hàng nav đang chọn, nút AI, chip đang bật).
4. **Signals** — bộ ba `X / X-soft + X-soft-foreground / X-solid` cho
   destructive, success, warning, info.
5. **Tints** — chín hue định danh module, cùng hình bộ ba; tint không bao giờ
   nghĩa là ok/nguy, signal không bao giờ trang trí (giữ nguyên PRODUCT.md §3).
6. **Geometry & motion** — radius, type scale, shadow, duration/easing.

## 3. Quyết định

| Quyết định | Giá trị | Lý do / số đo |
|---|---|---|
| Sidebar, page, surface **trắng**; shell `#f4f4f8` | light | Theo mock: một tờ trắng với hairline. Mọi tỉ lệ mực tối đã đo trên trắng (lightest) nên vẫn đúng trên band |
| Dark: shell `#0a0a0a`, sidebar = page `#111111`, card `#181818` | dark | Cùng thứ tự với light; sửa lỗi elevation ngược |
| `--primary` = `--brand` ở mọi theme/accent | `#7612fa`/trắng (6.49); dark `#b38cff`/`#0d0a1f` (7.51) | Một màu chú ý. Đã thử `#7f3ffa` chữ trắng cho dark: 5.26 dưới chữ nhưng chỉ 3.59 so với page — bỏ. Khối `[data-accent]` derive `--primary` từ `--brand`; test giữ hai slot bằng nhau |
| `--brand-subtle` / `-foreground` | `#efedfd`/`#7612fa` (5.62); dark `#2a1f4a`/`#b38cff` (5.82) | Cùng công thức với `--surface-selected` dưới accent (mix 11% / 24%) |
| Bộ ba signal | soft: destructive 6.25, success 5.51, warning 6.06, info 5.02 trên fill; solid: 5.33 / 4.85 / 4.68 / 5.49 dưới trắng | Trùng giá trị với tint red/green/yellow/blue *có chủ ý* — mắt chỉ cần một màu đỏ; view gọi đúng **việc** (`bg-success-soft` cho trạng thái, `bg-tint-green` cho module) |
| `--radius-xl` 14 → 16px | | Popover/dialog của mock; `tokens.test.ts` cập nhật |
| Motion trong CSS | `--duration-micro/fast/standard` = 100/150/200ms, `--ease-out-quart` = `UI_EASE_OUT` | `base.css` đọc token (right-sidebar 220ms → 200ms); test giữ bằng `lib/motion.ts` |
| Vai trò `text-overline` | 11px / 16px / 0.08em, mono, uppercase, 500 | Eyebrow và nhãn nhóm — case/family/weight đi cùng size |
| Shadow utilities | `shadow-surface / shadow-menu / shadow-floating` | Alias của 3 slot có sẵn |
| Badge chưa đọc (sidebar + chuông) | `bg-primary` | Trước: sidebar hồng đặc, chuông đen — hai màu cho một ý. Đỏ trong mock bị bỏ: đỏ dành cho destructive |
| Dấu loại thông báo | `IconTile shape="circle"` tint theo module (`kind-tone.ts` đọc `module-tones.ts`) | Hàng thông báo nói "từ đâu tới" trước khi đọc tiêu đề; cùng bảng màu với nav |
| Hàng chưa đọc | thanh brand 2px cạnh trái (`before:`) + tiêu đề đậm | Cue của mock; quét dọc thấy ngay |
| Top bar | "+ New" là nút `default` (brand fill) có nhãn từ `md` | Nút tô màu duy nhất trên thanh |
| `Button brandSubtle` | đọc `--brand-subtle` thay alpha | Cùng số đo trên card và band; chữ màu brand như nút AI ở mock |
| `IconTile` tone | thêm `success`, `info`, `brand`; `destructive`/`warning` đổi sang cặp soft | Bỏ alpha |

## 4. Những gì cố ý KHÔNG làm

- **Lớp primitive riêng** (`--color-blue-600`…): user đã chốt 2026-09-10 chỉ một
  lớp app; thêm lớp thứ hai là thêm một nơi để giá trị trôi.
- **Nhóm nav WORK / COMMUNICATION / RESULTS** như mock: là thay đổi IA
  (PRODUCT.md §7 nhóm theo hành vi), không thuộc design system.
- **Đổi hàng loạt 48 chỗ `bg-success/10`…** sang bộ ba mới: token và alias đã
  có, primitive (`IconTile`, `Button brandSubtle`) đã dùng; các view đổi dần
  khi chạm tới. Ghi ở §6.
- **Logo**: `packages/ui/brand` vẫn gradient hue 262 (xanh), lệch với brand tím —
  việc của tài sản thương hiệu (`scripts/brand/geometry.py`), ngoài phạm vi token.
- Tab / tìm kiếm / phân trang / checkbox trong hộp thư của mock: tính năng, không
  phải hệ thống.

## 5. Kiểm chứng đã chạy

- `packages/ui` vitest 196/196, `packages/views` vitest 1669/1669 (gồm
  `tokens.test.ts` mới: bộ ba signal, `--primary` = `--brand` ở 4 khối, motion =
  `lib/motion.ts`, overline; `themes-panel.tokens.test.ts` với MOCK mới;
  `accent.contrast.test.ts` với nền trắng; `kind-tone.test.ts`).
- `pnpm typecheck` + `pnpm lint --max-warnings 0` cho ui/views.
- `scripts/no-legacy-tokens`, `brand-assets`, 4 brand-scan: 16/16.
- E2E contrast (`onboarding/auth/admin-contrast.spec.ts`): xem ghi chú cuối
  phiên — `GATE_LEVEL=fast` nên `make check` không tự chạy.

## 6. Câu hỏi cần chốt

1. Dark CTA pastel (`#b38cff` chữ mực) hay tím đậm chữ trắng (`#7f3ffa`, 3.59 so
   với page)? Spec chọn pastel vì cùng cặp với `sidebar-primary` và đọc được như
   *hình*, không chỉ như nhãn.
2. Có đổi seed màu status ở server (`task_status_catalog.go`) theo bộ ba signal
   không? (Đã ghi từ đợt 3, vẫn để ngỏ.)
3. Lộ trình thay 48 chỗ alpha signal: làm một đợt riêng hay theo từng issue?
