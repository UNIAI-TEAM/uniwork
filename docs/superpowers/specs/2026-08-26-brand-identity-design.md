# Nhận diện thương hiệu UniWork

Ngày: 2026-08-26

## Vấn đề

UniWork không có nhận diện nào trong sản phẩm. Cụ thể, đo trên checkout hiện tại:

- Tài sản logo duy nhất là một file PNG 1254×1254 nằm ngoài repo. Không có SVG,
  không favicon, `apps/web/public/` chưa tồn tại.
- Không có component logo. `apps/web/app/layout.tsx` chỉ khai báo
  `metadata: { title: "UniWork" }` — không description, không OG, không icon.
- Onboarding rail đang vẽ logo bằng `<span className="size-5 rounded-md bg-brand" />`
  (`packages/views/onboarding/components/step-sidebar.tsx:147`) — một ô vuông giữ chỗ.
- `--brand` là `#2f5aff` (oklch hue 266), trong khi logo chạy trên trục hue 263.
  Hai thứ này không cùng một màu.

## Mâu thuẫn phải giải trước

`PRODUCT.md` liệt kê "gradient chrome" vào anti-references và quy định màu chỉ là
tín hiệu. Logo lại là một gradient rực.

Quyết định: **mark là ngoại lệ gradient duy nhất trong toàn hệ.** Gradient sống
trong logo và trong tài sản marketing sinh ra từ logo; giao diện dùng một hue
phẳng rút từ chính logo. Gradient cố ý KHÔNG trở thành token CSS — xem §3.

## Đo đạc logo gốc

Đo bằng cách quét pixel, không phải ước lượng bằng mắt.

| Đại lượng | Giá trị trong không gian 1254px |
| --- | --- |
| Bounding box của mark | x 150–1104, y 260–942 → 954 × 682 (tỉ lệ 1.399:1) |
| Trục đối xứng | x = 626.5 |
| Đầu (head) | tâm (264, 362) và (989, 362), bán kính 104 |
| Thân (body) | rộng 225, tâm x 262.5 / 990.5, đỉnh y ≈ 470, đáy y ≈ 846 (phần dưới nằm sau dải sóng) |
| Khe đầu–thân | ≈ 4px = 0.3% chiều cao mark |
| Dải sóng: đáy trũng | y ≈ 865 (đường tâm), tại x 354.5 và 898.5 |
| Dải sóng: đỉnh | y ≈ 682 (đường tâm), tại x 626.5 |
| Bề dày dải sóng | ≈ 154 (đo vuông góc) → 0.68 × bề rộng thân |
| Bán kính cong đường tâm tại đáy trũng | ≈ 82 — chỉ hơn nửa bề dày (77) đúng 5 |
| Gradient | `#0044E3` (trái) → `#00B4FC` (dải sóng) → `#02DEF5` (phải), cao nhất `#7FFFFF` |

## Bốn hiệu chỉnh craft

Concept và silhouette giữ nguyên — vẫn là "hai người nâng một dòng chảy, đọc ra
chữ W". Bốn thay đổi, mỗi cái sửa một lỗi đo được:

1. **Khe đầu–thân 0.3% → 3.8% chiều cao.** Ở 16px, 0.3% là 0.05px: đầu và thân
   dính liền thành một khối. Đây là lỗi nghiêm trọng nhất ở cỡ nhỏ.
2. **Cắt điểm loá ở đầu sáng của gradient.** Khối phải trông to hơn khối trái dù
   hình học bằng nhau — ảo giác irradiation. Cách sửa ban đầu (thu khối phải 2%)
   đã bị bỏ trong lúc dựng: hai khối dùng chung đường đỉnh và đường đáy của
   lưới, nên thu nhỏ một bên quanh bất kỳ điểm neo nào cũng đẩy đỉnh đầu bên đó
   xuống 0.8–1.6 đơn vị (≈1.7% chiều cao) — thấy được. Nguyên nhân thật là bản
   gốc để gradient loá tới `#7FFFFF`; gradient mới dừng ở `#02DEF5`.
3. **Dải sóng dày từ 0.68 → 0.733 × bề rộng thân** (22/30 trên lưới). Đoạn dốc là
   chỗ mảnh nhất về thị giác. Kèm theo: biên độ sóng giảm 12.28 → 10.6 và đáy
   trũng dịch ra ngoài (27.5 → 24). Bắt buộc — xem ràng buộc cusp bên dưới.
4. **Vùng giao dải sóng × thân vẽ thành path riêng.** Trong PNG gốc đây là bóng
   navy nhoè do raster. Trong SVG nó là một path có chủ đích, màu chốt cứng.

## Ràng buộc cusp — con số chi phối cả con sóng

Dải sóng là dải có **bề dày vuông góc không đổi** quanh một đường tâm cosin. Biên
trong của một dải như vậy suy biến thành **cusp** (điểm nhọn) ngay khi khoảng
offset chạm bán kính cong của đường tâm tại cực trị:

    R = half_period² / (π² × amp)     và cần    R − t/2 ≳ 3

Bản gốc nằm ở `R − t/2 = +0.66` — sát ngưỡng. Lần dựng đầu (amp 12.28, dày 22)
rơi xuống **−0.01**: đáy các trũng và mặt dưới đỉnh giữa thành điểm nhọn, thấy rõ
khi đặt cạnh bản gốc. Bộ tham số chốt (dày 22, amp 10.6, đáy trũng tại x=24) cho
biên **+4.29**.

`Mark.cusp_margin()` trả về con số này và `build-svg.py` từ chối ghi file nếu nó
dưới 3. Đây là ràng buộc kỹ thuật, không phải thẩm mỹ: không có nó thì mọi lần
chỉnh độ dày sau này đều có thể âm thầm làm hỏng hình.

## Lưới và biến thể

Master dựng trên `viewBox="0 0 128 92"` (giữ đúng tỉ lệ 1.399:1, không bóp méo).

| File | Vai trò | Dùng ở |
| --- | --- | --- |
| `mark.svg` | mark chính, gradient | ≥ 32px |
| `mark-compact.svg` | thân dày hơn, khe rộng hơn | 16–24px, favicon |
| `mark-flat.svg` | một màu `var(--brand)` | in một màu, dập nổi |
| `mark-mono.svg` | `currentColor` | footer, trạng thái disabled |
| `wordmark.svg` | "UniWork", đã outline sang path | không phụ thuộc font lúc render |
| `lockup-horizontal.svg` | mark + wordmark | header, auth |
| `lockup-horizontal-mono.svg` | như trên, một màu `currentColor` | ảnh OG, nền màu |
| `lockup-stacked.svg` | mark trên, chữ dưới | avatar vuông, splash |
| `app-icon.svg` | 1024 vuông, nền gradient, mark trắng | PWA, App Store |

Tất cả nằm trong `packages/ui/brand/svg/`. Lý do đặt ở `packages/ui`: đúng
Sharing Rules #4 trong CLAUDE.md — primitive và token thuộc về `ui`, và một host
desktop/mobile sau này dùng lại được mà không phải viết lại. Logo không phải
business logic nên không vi phạm ràng buộc của `packages/ui`.

## Wordmark

Typeset từ Inter SemiBold (600) — đúng font `apps/web/app/layout.tsx` đã load,
nên không thêm byte font nào. Tracking −2%. Chuyển sang path bằng `fontTools`
tại thời điểm thiết kế, nên file SVG không phụ thuộc font lúc render.

Chữ **W** vẽ lại riêng: hai đáy chữ V được bo (fillet tiếp tuyến) theo nhịp đáy
trũng của dải sóng. Inter cắt đỉnh V rất nhọn bằng một đoạn phẳng ngắn chạy
ngược chiều; đoạn phẳng đó là mỏ neo — tiếp tuyến hai nét hai bên định nghĩa một
cubic phình xuống dưới và tiếp xúc trơn với cả hai. Chỉ chữ W bị đổi; một
wordmark âm thầm vẽ lại cả bảng chữ cái là một wordmark tệ hơn.

**Màu của wordmark luôn là `currentColor`** — kể cả bên trong lockup và kể cả khi
mark đang chạy gradient. Wordmark là chữ, và chữ lấy màu chữ. (Đây cũng là một
lỗi thật đã gặp khi dựng: gradient của mark khai báo trong `userSpaceOnUse` chạy
hết 128 đơn vị của riêng mark, còn wordmark nằm ở x ≥ 149 — tô cùng gradient thì
chữ bị kẹp ở stop cuối và ra màu aqua.)

Cách viết chốt cứng là **UniWork** (camel case). `PRODUCT.md` đang dùng
"UNIWORK" ở một chỗ — sửa cho khớp.

## §3. Màu

### Gradient không phải token

Gradient chỉ tồn tại bên trong file SVG dưới dạng `<linearGradient>`. Nó cố ý
không được khai báo trong `tokens.css`. Lý do: nếu có token, sớm muộn sẽ có
người dùng nó làm nền card — đúng thứ `PRODUCT.md` cấm. Không có token thì không
ai với tới được.

### Căn lại hue brand

| Token | Hiện tại | Mới | Lý do |
| --- | --- | --- | --- |
| `--brand` (light) | `#2f5aff` · 5.00:1 trên `#fafafa` | `#0b5bf5` · 5.25:1 | hue 262, khớp trục logo (263). Contrast tăng |
| `--brand` (dark) | `#6584ff` · 5.66:1 trên `#111113` | `#4d8dff` · 5.90:1 | hue 261 — light/dark lệch 1°. Hiện lệch 4° (266 vs 270) |
| `--info`, `--ring`, `--sidebar-primary`, `--sidebar-ring` | alias của brand | theo brand mới | đã là alias |
| `--selection` light | `#d9e1ff` | nhuộm về hue 262 | không thì vùng bôi đen ngả tím cạnh nút brand |
| `--surface-selected` light | `#eef2ff` | nhuộm về hue 262 | như trên |
| `--selection` / `--surface-selected` dark | `#2b3a72` / `#1b2340` | nhuộm về hue 262 | như trên |
| `--chart-1..5` | `oklch(… 255)` | `oklch(… 262)` | sửa lỗi có sẵn: comment nói "chart-1 là hue brand" nhưng 255 ≠ 266 |
| `RAIL_VAR_FALLBACK` | `#6584ff` | `#4d8dff` | `step-sidebar.test.tsx:56` pin giá trị này theo `.dark` |

`--primary` (đen trung tính) KHÔNG đổi — nó cố ý không phải màu brand, theo đúng
comment sẵn có trong `tokens.css`.

## Component

`packages/ui/brand/logo.tsx`, inline SVG chứ không phải `<img>`: để tone `mono`
thừa kế `currentColor`, và để không tốn thêm một network request.

```tsx
<Logo
  variant="mark" | "wordmark" | "lockup" | "lockup-stacked"
  tone="gradient" | "flat" | "mono"   // mặc định "gradient"
  size={20}                            // px chiều cao
  decorative                           // → aria-hidden; mặc định role="img" aria-label="UniWork"
/>
```

Một hành vi tự động: `variant="mark"` với `size ≤ 24` tự đổi sang `mark-compact`.
Người gọi chỉ đặt size và luôn được bản vẽ đúng cho cỡ đó.

`metrics.ts` bên cạnh giữ các hằng số hình học (tỉ lệ, safe-zone, min-size) làm
nguồn duy nhất cho cả component, script sinh tài sản và test.

## Pipeline sinh tài sản

`scripts/brand/build-assets.mjs`, dùng Chromium của Playwright (vốn là dependency
e2e của repo) render SVG ở đúng pixel size. Chạy bằng `pnpm brand:build`.

Bước wordmark cần `python3` + `fonttools` và một file Inter SemiBold `.ttf`; nó
bị bỏ qua nếu không đặt `INTER_TTF`, vì outline đã commit sẵn — sửa mark không
cần tới font. Binary font không được commit: không có gì lúc chạy đọc nó.

| Sinh ra | Từ | Đích |
| --- | --- | --- |
| `icon.svg` | `mark-compact` | `apps/web/app/` |
| `favicon.ico` (16/32/48) | `mark-compact` | `apps/web/app/` |
| `apple-icon.png` 180 | `app-icon` | `apps/web/app/` |
| `opengraph-image.png` 1200×630 | lockup trên nền brand | `apps/web/app/` |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | `app-icon` | `apps/web/public/` |

Next App Router tự nhận các file convention trong `apps/web/app/`; không cần
khai báo tay trong `metadata.icons`.

Không có file PNG nào được chỉnh tay. Đổi logo → chạy một lệnh → mọi cỡ cập nhật.

## Nhúng vào sản phẩm

| Bề mặt | Hiện tại | Thành |
| --- | --- | --- |
| `apps/web/app/layout.tsx` | chỉ `title` | title template, description, `openGraph`, `metadataBase` |
| `apps/web/app/manifest.ts` | chưa có | manifest PWA + icon 192/512 + maskable |
| Onboarding rail `step-sidebar.tsx:147` | `<span className="size-5 rounded-md bg-brand" />` | `<Logo variant="mark" tone="mono" size={20} />` |
| `AppSidebar` | không có mark | mark 20px phía trên `WorkspaceSwitcher` |
| `login-view` / `register-view` | chỉ có chữ | lockup ngang phía trên form |

## Guideline

`packages/ui/brand/README.md`: safe-zone (bằng chiều cao khe đầu–thân, suy ra từ
chính hình chứ không phải một con số tuỳ ý), min-size (mark 16px, lockup 96px),
bảng do/don't — không xoay, không đổ bóng, không đặt trên ảnh nhiễu, không dùng
gradient của logo làm nền UI — và lý do gradient không phải token.

## Kiểm chứng

| Kiểm gì | Bằng gì |
| --- | --- |
| Mọi variant × tone render được; `mono` ra `currentColor`; `size ≤ 24` đổi sang compact; `decorative` ra `aria-hidden` | `packages/ui/brand/logo.test.tsx` |
| PNG đã commit khớp SVG nguồn (chặn việc quên chạy `pnpm brand:build`) | `scripts/brand-assets.test.mjs` — so hash SVG ghi trong `assets.lock.json`, không render lại (test đơn vị không được phụ thuộc Chromium) |
| Gradient của logo không rò vào `tokens.css` | `scripts/brand-assets.test.mjs` |
| `theme_color` của manifest đúng bằng giá trị `--brand` | `scripts/brand-assets.test.mjs` |
| Mọi icon manifest liệt kê đều có trong `public/` | `scripts/brand-assets.test.mjs` |
| Token khai báo đủ ở cả `:root` và `.dark` | `packages/ui/styles/tokens.test.ts` (đã có) |
| `RAIL_VAR_FALLBACK` khớp `.dark` | `packages/views/onboarding/components/step-sidebar.test.tsx` (đã có) |
| Tương phản chữ sau khi đổi hue, đo trên trang đã render, cả hai mode | `e2e/onboarding-contrast.spec.ts` (đã có) |
| Toàn bộ | `make check` |

## Cố ý không làm

- Không đụng `--primary`.
- Không làm illustration system, motion signature, template email/slide.
- Không thêm gradient vào `tokens.css`.
- Không commit file PNG chỉnh tay.

## Rủi ro

Đổi `--brand` chạm khoảng 15 file dùng `bg-brand` / `text-brand`. Delta màu nhỏ
(xanh → xanh) và contrast tăng ở cả hai mode, nên rủi ro thấp; nhưng đây là thay
đổi rộng nhất trong kế hoạch và bằng chứng duy nhất được chấp nhận là
`e2e/onboarding-contrast.spec.ts` chạy xanh ở cả hai mode.
