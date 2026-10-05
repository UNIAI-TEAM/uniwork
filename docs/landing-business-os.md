# Business OS trên landing page

Business OS trình bày kiến trúc từ khởi tạo doanh nghiệp đến công việc mỗi
ngày, trong phạm vi UNI-504. Phần này nằm ngay sau demo sản phẩm, trước
phần giải pháp.
Tham chiếu ClickUp người dùng đã ghim định hướng một lưới dày: bốn ô minh
họa có màu ở giữa, bao quanh bởi các biểu tượng và tên năng lực dịu màu.

Đây là phần mở rộng cục bộ của Bright Studio, theo hợp đồng landing
`277f981e` trong `apps/web/DESIGN.md`. Khung giấy, Be Vietnam Pro, thang chữ
theo vai trò, màu ngữ nghĩa và nhận diện UniWork hiện có là nền tảng.

## Nội dung và tương tác

Lưới giữ đủ 37 năng lực: 4 ô nổi bật và 33 mục ở vành ngoài. Bốn nút lớp
04 → 03 → 02 → 01 nằm phía trên, dùng xanh lá, xanh dương, tím và cam.

| Lớp | Số năng lực | Giai đoạn hiển thị |
| --- | --- | --- |
| 04 · AI & Intelligence | 7 | Nền tảng & định hướng |
| 03 · UniWork Core | 10 | Hiện tại & mở rộng |
| 02 · uniOffice & Productivity | 7 | Đang phát triển / In development |
| 01 · Business & Digital Services | 13: 5 dịch vụ doanh nghiệp + 8 hạ tầng số | Định hướng / Planned |

Chọn nút lớp làm nổi bật tất cả mục thuộc lớp đó, không lọc hay ẩn mục.
Nút dùng `aria-pressed`; chọn lại bỏ trạng thái nhấn. Các mục vành ngoài
đổi màu khi hover. Bốn ô trung tâm có nhãn và nút minh họa, phản hồi khi
hover, focus hoặc nhấn:

| Ô nổi bật | Minh họa và phản hồi |
| --- | --- |
| Dự án | Bảng công việc hai cột, thẻ và dấu tick hoàn thành |
| Word | Chồng tài liệu mở rộng và dòng được đánh dấu |
| Hỏi UNI / Ask UNI | Tra cứu brief, câu trả lời và các chip ngữ cảnh |
| Trao đổi / Chat | Hội thoại có tài liệu, phản hồi và tín hiệu gửi |

Ô Hỏi UNI đại diện cho capability `gateway` (AI Gateway & Token Hub),
với ví dụ tra cứu theo quyền. Nó không thêm capability thứ 38. Các ô dùng
DOM được viết riêng, Lucide và nội dung minh họa có bản dịch. Phần hình
trang trí có `aria-hidden`; nút bao ngoài giữ nhãn, trạng thái nhấn và
thông tin availability dành cho trình đọc màn hình.

Nhấn ô bật hoặc tắt trạng thái phản hồi minh họa; không thực hiện workflow,
gửi tin nhắn, chỉnh tài liệu hoặc gọi backend. Chuyển động tự động của các
ô được điều khiển riêng như mô tả bên dưới.

Nhãn, giai đoạn, nội dung minh họa, trạng thái, ghi chú và CTA có đầy đủ
bản Việt–Anh. Vành ngoài dùng nhãn ngắn "Trí nhớ tổ chức"; phần tình trạng
giữ tên đầy đủ "Organizational Memory". Một CTA "Khám phá UniWork Core"
dẫn tới `#platform`; liên kết trong danh mục dùng `/#business-os`.

## Chuyển động của cụm minh họa

Bốn ô trung tâm dùng chu kỳ CSS 12 giây, lần lượt có độ trễ 0/1.8/3.6/5.4
giây cho Dự án, Word, Hỏi UNI và Trao đổi. Cụm hình dịch nhẹ 3px; thẻ dự án
dịch 5px cùng dấu xác nhận. Word mở nhẹ chồng trang và đánh dấu dòng; AI
phản hồi ở biểu tượng, dòng trả lời và chip ngữ cảnh; hội thoại có tín hiệu
phản hồi, reaction và gửi. Mỗi chu kỳ có khoảng nghỉ, còn nhãn luôn đứng
yên. Bố cục, 37 năng lực, nội dung và trạng thái triển khai giữ nguyên.

`IntersectionObserver` theo dõi từng ô để dừng animation của ô đó khi
ngoài viewport; `document.hidden` dừng cả cụm khi tab bị ẩn. Nút dừng/phát cạnh
CTA trong footer dùng `Button` của registry, kích thước 44px và các nhãn
dịch sẵn có `landing.motion.pause` / `landing.motion.play`. Nhấn dừng giữ
đồng hồ animation tại chỗ; phát tiếp tục chu kỳ. Hàng action dùng flex để
nút và CTA nằm trong chiều rộng 320px/390px.

Hover, focus hoặc `aria-pressed` hủy autoplay trên ô đang tương tác và
chuyển sang phản hồi trực tiếp với transition hiện có. Khi kết thúc tương
tác, chu kỳ của ô bắt đầu lại. Với `prefers-reduced-motion: reduce`, không
có autoplay hay vòng lặp, nút dừng/phát chung được ẩn; chồng tài liệu tĩnh
và phản hồi có ý nghĩa bằng màu hoặc độ hiện được giữ. CSS chỉ thay đổi
transform/opacity ở các phần nhỏ, không thêm canvas, thư viện, blur hoặc
ảnh raster.

## Tình trạng triển khai

`Accordion` của registry mang nhãn "Tình trạng triển khai" / "Availability"
đóng mặc định. Khi mở, nó trình bày ghi chú giới hạn của từng lớp và trạng
thái chính xác của cả 37 mục. Mỗi mục trong lưới cũng giữ trạng thái trong
nội dung dành cho trình đọc màn hình.

Trạng thái được đối chiếu với `origin/develop` tại `be29aec9`:

| Trạng thái | Năng lực |
| --- | --- |
| Có trên nền tảng | Tổ chức, nhân sự, dự án, công việc |
| Theo cấu hình | AI Gateway & Token Hub, trao đổi, họp trực tuyến, Email Hub |
| Nền tảng ban đầu | AI Context, AI Workforce |
| Đang phát triển | Cả 7 công cụ uniOffice |
| Định hướng | Work Graph, Organizational Memory, Skill Hub, Executive Intelligence, tri thức, sản phẩm công việc, tích hợp và cả 13 dịch vụ |

Trao đổi cần feature flag; họp cần LiveKit; Email Hub cần IMAP/SMTP. Hỏi UNI
đọc và tra cứu theo quyền sau khi cấu hình mô hình. uniOffice chưa có đầy
đủ trong workspace; các dịch vụ chưa mở đặt mua trên UniWork. Minh họa không
chứng minh tích hợp đã phát hành, quan hệ đối tác, kết quả năng suất hoặc
cam kết phát hành. Phần này không dùng ảnh raster hay dải đối tác.

## Bố cục theo chiều rộng

| Chiều rộng | Bố cục |
| --- | --- |
| >1100px | Lưới 10 cột × 5 hàng. Bốn ô trung tâm xếp 2 × 2, mỗi ô chiếm 2 cột × 2 hàng. Ô cuối là mark UniWork trang trí. Tiêu đề 60px |
| 768–1100px | Lưới 6 cột. Các ô minh họa đứng trước, hai ô mỗi hàng, mỗi ô chiếm 3 cột × 2 hàng. Ba mục nhỏ cuối chiếm 2 cột mỗi mục để lấp hàng; ẩn ô mark. Tiêu đề 48px |
| 360–767px | Bốn ô minh họa xếp dọc, mỗi ô chiếm 3 cột × 2 hàng; 33 mục nhỏ theo lưới 3 cột, gồm cả ba mục cuối. Nút lớp xếp 2 × 2; disclosure ở trên hàng nút dừng/phát và CTA. Tiêu đề 36px |
| ≤359px | Lưới mục nhỏ có 2 cột; mỗi ô minh họa chiếm đủ 2 cột × 2 hàng. Mục nhỏ cuối chiếm cả hàng; các phần còn lại giữ bố cục mobile |

Nguồn triển khai trong `apps/web/features/landing/`: `business-os.tsx`,
`business-os.css`, `business-os-preview.tsx`, `business-os-preview.css`
và `business-os-data.ts`. Dữ liệu giữ nhóm và trạng thái; hai stylesheet
giữ bố cục, màu lấy từ token hệ thống và phản hồi minh họa.

## Đồng bộ bản dịch

`WebLocaleProvider` trong `apps/web/platform/locale.tsx` đồng bộ resource khi
dictionary tiếng Anh được import hoặc dictionary Việt của request thay
đổi. Effect gọi `syncI18nResources` để gộp tài nguyên và thông báo cho các
bản dịch đã mount, giữ ngôn ngữ người dùng đang chọn. Tab đang mở cập nhật
nhãn qua Fast Refresh mà không cần tải lại; trạng thái nhấn ô Dự án được
giữ. Nhãn hiển thị bản dịch thay cho khóa thô `landing.businessOs.*`.

Đồng bộ khi khởi tạo trong `packages/core/i18n/index.ts` vẫn cập nhật
dictionary tiếng Anh và dictionary của request khi singleton đã tồn tại,
giữ HTML server và lần render đầu trên client nhất quán.

## Xác minh

### Chuyển động của cụm minh họa

Review độc lập đủ năm mục hợp đồng kết luận `SHIP` cho tinh chỉnh chuyển
động này, không có sửa đổi trọng yếu hoặc lỗi sàn chất lượng. Builder và
reviewer đã mở cả 10 ảnh hợp lệ trong
`.impeccable/review/business-os-motion/`: desktop tiếng Việt sáng 1440px,
tiếng Anh tối 1254px cùng các thời điểm t2/t5/t8, mobile tiếng Việt sáng
390px, tiếng Anh tối 320px, giảm chuyển động ở 320px và cận cảnh điều
khiển mobile sáng/tối. `checks.json` ghi nhận năm trường hợp không có
tràn ngang, lỗi trang hoặc lỗi tương phản chữ.

5 test Business OS E2E cuối đã đạt sau chỉnh CSS hàng action mobile, gồm
test mới kiểm tra đồng hồ animation thực sự dừng/phát tiếp, dừng ngoài
viewport và chế độ giảm chuyển động. TypeScript của app (`tsc --noEmit`),
ESLint có mục tiêu cho `business-os.tsx` và `git diff --check` đã đạt.
Bộ dò chạy một lần trả về `[]`.

Review chỉ bao phủ tinh chỉnh chuyển động này; hệ thống thiết kế rộng hơn
chưa được audit trong lượt đó. Đồng hồ animation và ảnh theo thời điểm
không chứng nhận FPS hoặc hiệu năng khung hình.

### Gallery và đồng bộ bản dịch đã xác minh trước đó

Review độc lập đã đọc ảnh lỗi người dùng gửi, tham chiếu ClickUp đã ghim
và cả 5 ảnh cuối đã xác nhận hợp lệ trong
`.impeccable/review/business-os-locale-fix/`:

| Ảnh | Phạm vi |
| --- | --- |
| `desktop-light-vi.png` | Tiếng Việt, sáng, 1440px |
| `desktop-dark-en.png` | Tiếng Anh, tối, 1226px |
| `mobile-light-vi.png` | Tiếng Việt, sáng, 390px |
| `mobile-dark-en.png` | Tiếng Anh, tối, 320px |
| `spotlights-dark-en.png` | Cận cảnh bốn ô minh họa, tiếng Anh, tối |

Kết luận `ship`, không có sửa đổi trọng yếu. Bộ dò chạy một lần trên
`locale.tsx` và `business-os.css` trả về `[]`. Tab cũ trong trình duyệt của
app đã hiển thị bản dịch đúng mà không tải lại.

Lượt xác minh gallery và locale trước đó đã đạt: 6 test Playwright chính
(4 Business OS + 2 hydration), 2 test Fast Refresh Việt–Anh, 30 test i18n
của core, TypeScript
của app (`tsc --noEmit`), ESLint cho provider, Knip ở gốc repo và
`git diff --check`. Bộ chính giữ kiểm tra bàn phím, đủ 37 mục, chuyển động
bình thường/giảm chuyển động, tương phản sáng/tối với disclosure đóng/mở
và mobile 320px/390px. Bộ hydration kiểm tra SSR và tải lại Việt–Anh,
đồng thời xác nhận không xuất hiện khóa thô `landing.businessOs.*`.
4 test parity locale và 3 test khóa trùng là các kiểm tra đã đạt trước đó.

`e2e/landing-fast-refresh.spec.ts` là bộ kiểm tra dev bật theo yêu cầu. Mỗi
test tạm đổi một nhãn dịch, xác nhận cập nhật trực tiếp không tải lại và
giữ trạng thái nhấn Dự án, rồi phục hồi đúng phần file mà test đã sửa.
Chạy tuần tự với `next dev` đang hoạt động, không chạy đồng thời với test
khác hoặc chỉnh sửa locale. Từ thư mục `e2e`:

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'; $env:E2E_FAST_REFRESH='1'; node node_modules/@playwright/test/cli.js test landing-fast-refresh.spec.ts
```

`make check` đã được thử trong lượt tinh chỉnh chuyển động nhưng host chưa
cài `make`. Gate tổng hợp, bộ test backend và toàn bộ E2E chưa được xác nhận.
