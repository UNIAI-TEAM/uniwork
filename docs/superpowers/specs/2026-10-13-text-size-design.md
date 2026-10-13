# Cỡ chữ trong Cài đặt

> **Trạng thái:** in-progress

**Issue:** chưa có. Cần một `UNI-nnn` trước khi mở PR (`uniai-link.yml` chặn PR không ghi issue).

## Mục tiêu

Người dùng cần chữ to hơn để đọc dễ (người lớn tuổi, thị lực kém, màn hình nhỏ hoặc ở xa) chọn được cỡ chữ cho toàn bộ ứng dụng trong Cài đặt → Tùy chọn. Đây là tính năng trợ năng, không phải chỉnh mật độ giao diện: chữ to lên, bố cục, khoảng cách và icon giữ nguyên.

Thành công khi:

- Chọn một mức là chữ cả ứng dụng đổi ngay, không cần lưu, không tải lại.
- Tải lại trang không thấy một khung hình chữ cỡ cũ (không nháy).
- Ở mức lớn nhất, các màn chính không cuộn ngang và chữ trong control không bị cắt.
- Ở mức Mặc định, không một pixel nào khác với hiện tại.

## Quyết định đã chốt

1. **Chỉ scale chữ** (cách A). Loại cách B (đổi `font-size` của `<html>`, scale cả spacing và icon như zoom) vì phải đổi token px sang rem và 38 kích thước `[Npx]` trong layout sẽ lệch tỷ lệ. Loại cách C (CSS `zoom`) vì làm sai định vị popover, `getBoundingClientRect`, canvas và iframe.
2. **Lưu theo thiết bị** trong `localStorage`, giống chế độ sáng/tối và màu nhấn. Không có cột trên server, không đụng `PATCH /me`. Đăng nhập máy khác thì chọn lại.
3. **Ba mức**, gọi theo cỡ chữ thân bài: Mặc định 14px, Lớn 16px, Rất lớn 18px. Mọi vai trò khác nhân cùng tỷ lệ. Không có mức nhỏ hơn mặc định và không có thanh trượt.

## Phạm vi

Theo thang: mọi màn trong ứng dụng, console quản trị, trang chia sẻ công khai và nội dung soạn trong TipTap editor (các file `packages/views/editor/styles/*.css` đã đọc `var(--text-*)`).

Không theo thang:

- Tài liệu Office trong iframe genoffice (`packages/office-upstream/`). Cỡ chữ ở đó là nội dung tài liệu và iframe có zoom riêng.
- CSS trang marketing (`apps/web/features/landing/*.css`, 93 cỡ px viết cứng).
- Các vai trò `--text-hero*`, `--text-hero-opening*` (tiêu đề marketing vốn đã lớn) và `--text-avatar-stage` (theo kích thước ô video họp, không theo người đọc).

## Thiết kế

### 1. Lớp token CSS (`packages/ui/styles/tokens.css`, `base.css`)

Một biến `--font-scale`, do attribute `data-text-size` điều khiển. Tỷ lệ chỉ nằm trong CSS; JavaScript chỉ biết tên mức.

```css
:root,
[data-text-size="default"] { --font-scale: 1; }
[data-text-size="large"]   { --font-scale: calc(16 / 14); }
[data-text-size="xlarge"]  { --font-scale: calc(18 / 14); }
```

Selector không gắn với `:root`, nên một phần tử bất kỳ cũng mang được một mức riêng. Ô xem trước trong Cài đặt dùng điều này (mục 3). Selector `default` cần có vì một ô xem trước "Mặc định" nằm trong trang đang ở mức Rất lớn phải tự đặt lại tỷ lệ 1.

Các bước `micro`, `overline`, `caption`, `label`, `body`, `body-lg`, `title-sm`, `title`, `title-lg`, `display-sm`, `display` và line-height của chúng đổi thành `calc(<px hiện tại> * var(--font-scale))`. Letter-spacing tính bằng `em` nên tự theo.

Thang nằm trong `@theme inline`, nên Tailwind nhúng nguyên biểu thức vào utility (`font-size: calc(14px * var(--font-scale))`). Trình duyệt giải `--font-scale` tại phần tử lúc chạy, vì vậy không cần dời token ra khỏi khối `@theme inline`.

Code CSS đọc `var(--text-body)` (editor) nhận giá trị đã giải tại `:root`. Attribute đặt trên `<html>`, nên giá trị đó vẫn đúng. Riêng phạm vi cục bộ (một phần tử con mang `data-text-size`) chỉ có tác dụng với utility class, không với `var(--text-*)`. Chỉ ô xem trước dùng phạm vi cục bộ, và nó dùng utility.

Hai chỗ viết cứng trong `base.css`:

- `body { font-size: 14px }` đổi thành `var(--text-body)`.
- Ô nhập trên màn cảm ứng (`@media (pointer: coarse)`) đổi `16px` thành `max(16px, var(--text-body))`. Ngưỡng 16px chặn iOS tự phóng to khi focus; ở mức Rất lớn, chữ trong ô nhập không được nhỏ hơn chữ xung quanh.

Không có code JavaScript nào đọc `--text-*` (đã kiểm `useCssVars` và `getPropertyValue`), nên không có canvas nào phải sửa.

### 2. Trạng thái, lưu trữ, boot script

Đi đúng khuôn màu nhấn (`packages/ui/lib/accent.ts`, `packages/ui/hooks/use-accent.ts`).

`packages/ui/lib/text-size.ts`, không phụ thuộc React:

- `TEXT_SIZES = ["default", "large", "xlarge"] as const`, kiểu `TextSize`, `DEFAULT_TEXT_SIZE = "default"`, `TEXT_SIZE_STORAGE_KEY = "uniwork-text-size"`.
- `isTextSize(value)`: kiểm giá trị đọc từ storage. Storage là dữ liệu không tin được.
- `applyTextSize(size, root)`: đặt `data-text-size` trên `root`. Mức `default` thì gỡ attribute, giống màu nhấn `uniwork`.
- `readStoredTextSize()`: bọc try/catch. Storage bị chặn hoặc giá trị lạ thì trả `default`.
- `textSizeBootScript()`: chuỗi IIFE chạy trước paint. Đọc key, chỉ chấp nhận `large` hoặc `xlarge`, rồi đặt attribute. Mọi lỗi bị nuốt.

Boot script là một thẻ `<script>` thứ hai cạnh `accentBootScript()` trong `apps/web/app/layout.tsx`. Nó chạy với mọi trang dưới root layout.

`packages/ui/hooks/use-text-size.ts`, chép cấu trúc `useAccent`:

- Khởi tạo bằng `default` và đọc storage trong `useEffect`. Đọc trong lúc render sẽ lệch với HTML từ server.
- Lắng nghe sự kiện `storage` cho đúng key để tab khác đổi theo, rồi gọi `applyTextSize`.
- `setTextSize(next)` cập nhật state, áp lên `document.documentElement`, rồi ghi storage trong try/catch. Storage bị chặn thì mức vẫn áp trong phiên này.

### 3. UI cài đặt

File mới `packages/views/settings/components/text-size-panel.tsx`, render trong `preferences-tab.tsx` ngay sau `<ThemesPanel />`. `ThemesPanel` không đổi: nó tự mô tả là hai trục theming (chế độ hiển thị và màu nhấn), và cỡ chữ không phải màu.

- Một `SettingsSection` tiêu đề "Cỡ chữ", gợi ý "Cỡ chữ của toàn bộ ứng dụng. Chỉ lưu trên thiết bị này." Tiêu đề đặt tên cho nhóm radio qua `aria-labelledby`, như hai mục phía trên.
- Ba lựa chọn là radio gốc ẩn bằng `sr-only` trong `<fieldset>`. Phím mũi tên, nhóm và trạng thái checked đến từ nền tảng; viền focus dùng cùng lớp `FOCUS_FROM_RADIO` mà `ThemesPanel` dùng. Hằng này được export từ `themes-panel.tsx` và import vào panel mới, không chép.
- Mỗi lựa chọn có chữ mẫu "Aa" với `text-title-sm` bên trong một phần tử mang `data-text-size` của mức đó, nên chữ mẫu luôn hiện đúng cỡ của mức ấy (16px, khoảng 18,3px, khoảng 20,6px), bất kể mức đang chọn. Bên dưới là nhãn "Mặc định", "Lớn", "Rất lớn".
- Chọn là áp ngay. Không có nút lưu: chữ cả trang đổi tức thì, đó chính là phần xem trước.
- Touch target ≥ 44px trên con trỏ thô (`pointer-coarse:min-h-11`), như chip màu nhấn.

### 4. i18n và thuật ngữ

Key mới dưới `settings.preferences` trong cả `vi.json` và `en.json`:

| Key | vi | en |
| --- | --- | --- |
| `textSize` | Cỡ chữ | Text size |
| `textSizeHint` | Cỡ chữ của toàn bộ ứng dụng. Chỉ lưu trên thiết bị này. | Text size across the whole app. Saved on this device only. |
| `textSizeDefault` | Mặc định | Default |
| `textSizeLarge` | Lớn | Large |
| `textSizeXLarge` | Rất lớn | Extra large |
| `textSizeSample` | Aa | Aa |

`textSizeSample` là chữ mẫu trong ô xem trước. Nó đi qua `t()` vì `i18next/no-literal-string` cấm chuỗi trần trong JSX của `packages/views`.

Thêm dòng `Text size | Cỡ chữ` vào bảng "Generic UI words" trong `docs/conventions.md`, vì bảng thuật ngữ chưa có mục này.

## Kiểm thử

Viết test đỏ trước từng bước.

`packages/ui`:

- `lib/text-size.test.ts`, theo khuôn `accent.test.ts`: `applyTextSize` đặt và gỡ attribute; giá trị lưu lạ hoặc storage ném lỗi thì rơi về `default`; boot script chạy trong jsdom áp mức đã lưu và bỏ qua tên ngoài danh sách.
- `hooks/use-text-size.test.ts`: `setTextSize` ghi DOM và storage; sự kiện `storage` từ tab khác đồng bộ state và DOM; storage bị chặn vẫn áp được.
- `styles/tokens.test.ts`, thêm ba ca: mọi bước từ `micro` tới `display` và line-height của chúng chứa `var(--font-scale)`; các bước `hero*`, `hero-opening*`, `avatar-stage` không chứa `var(--font-scale)`; `--font-scale` có đủ ba selector `default`, `large`, `xlarge`.

`packages/views`:

- `settings/components/text-size-panel.test.tsx`: ba radio đúng nhãn; chọn "Rất lớn" thì `<html>` mang `data-text-size="xlarge"` và storage có giá trị đó; radio checked khớp giá trị đã lưu sẵn; mũi tên đổi lựa chọn.
- `preferences-tab.test.tsx`: thêm assert mục "Cỡ chữ" có mặt.

`e2e/text-size.spec.ts` (mới):

1. Vào Cài đặt → Tùy chọn, chọn "Rất lớn". Assert `getComputedStyle(document.body).fontSize === "18px"`.
2. Gắn một phần tử thử có `style="font-size: var(--text-body)"` vào trang và assert nó cũng là 18px. Ca này chứng minh đường `var(--text-*)` (editor đi đường này) theo thang, không chỉ utility class, mà không phụ thuộc dữ liệu tài liệu.
3. Tải lại trang. Assert `<html>` mang attribute (hook không bao giờ áp lúc mount, nên chỉ boot script đặt được nó) và console không có lỗi hydration.
4. Ở mức Rất lớn, mở Trang chủ, Công việc, Chat, Tài liệu, Cài đặt. Assert không có cuộn ngang: `document.documentElement.scrollWidth <= window.innerWidth`.

Hồi quy: mức Mặc định giữ nguyên mọi giá trị px, nên các spec contrast và năm spec onboarding phải pass mà không sửa. `make check` chạy trước khi báo xong.

## Rủi ro

- E2E chỉ bắt tràn ở cấp trang, không bắt chữ bị cắt trong control có chiều cao cố định (`h-8`, `h-9`) hay trong 38 kích thước `[Npx]`. Trước khi xong, chụp màn hình các màn chính ở mức Rất lớn và sửa những chỗ chật. Những chỗ sửa đó thuộc phạm vi tính năng này. Chưa ước lượng được số chỗ cho tới khi chạy app. Kết quả rà ngày 2026-10-13 (Trang chủ, Công việc, chi tiết việc, Chat, Tài liệu, Cuộc họp, Cài đặt; 1280px và 375px): không có chỗ nào bị cắt dọc, nên không phải sửa. Admin, Email Hub và phòng họp chưa được rà.
- Phần CSS marketing viết px cứng sẽ đứng yên trong khi phần dùng token trên cùng trang to lên. Chấp nhận, vì trang marketing không phải nơi người dùng đọc lâu. Nếu thấy lệch rõ, giới hạn selector vào khung ứng dụng sau.

## File chạm

- `packages/ui/styles/tokens.css`, `packages/ui/styles/base.css`, `packages/ui/styles/tokens.test.ts`
- `packages/ui/lib/text-size.ts` và test (mới)
- `packages/ui/hooks/use-text-size.ts` và test (mới)
- `apps/web/app/layout.tsx`
- `packages/views/settings/components/text-size-panel.tsx` và test (mới), `themes-panel.tsx` (chỉ export `FOCUS_FROM_RADIO`), `preferences-tab.tsx`, `preferences-tab.test.tsx`
- `packages/core/i18n/locales/vi.json`, `en.json`
- `docs/conventions.md`
- `e2e/text-size.spec.ts` (mới)
