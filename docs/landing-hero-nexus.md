# Lõi 3D ở đầu landing

Phạm vi là cảnh `InteractiveScene` trong hero, theo yêu cầu làm lõi 3D
nhiều màu, sinh động và tương lai hơn từ hình hero người dùng gửi. Đây là
điểm nhấn cục bộ ở chế độ Persuade, trên nền Bright Studio `277f981e`.
Mô tả vật liệu dưới đây thay mô tả cũ của riêng lõi được dựng bằng mã;
nội dung, CTA và các phần còn lại tiếp tục theo nhận diện hiện có.

## Vật liệu và bố cục

Lõi chung có thân kim loại, mặt ánh sắc, vòng cyan và bốn cung màu xoay.
Bốn mô-đun nổi thể hiện công việc, trao đổi, họp và AI bằng hình học
Three.js có chiều dày. Hai quỹ đạo nghiêng cùng các gói tín hiệu nối mô-đun
với lõi. Màu dùng `brand`, `brand-accent`, `landing-close-light` và
`landing-close-end`; ánh sáng cyan/hồng và room environment tạo phản xạ.
Lớp sáng nền tan dần bằng mask, không thêm khung hay chú thích.

Logo UniWork dùng component chung làm DOM overlay trước tâm lõi; hình học
không vẽ lại logo. Bốn nhãn Việt–Anh hiện có tiếp tục giải thích các mối
kết nối. Vật liệu màu và cung tín hiệu dùng palette hiện có, không thêm
token toàn cục.

| Chiều rộng | Canvas và nhãn |
| --- | --- |
| ≥1100px | Canvas cao 230px, rộng 64%; mark cao 44px |
| 768–1099px | Canvas cao 230px, rộng 68%; mark cao 44px |
| ≤767px | Canvas cao 200px, rộng 100%; vùng lõi có padding dưới 42px. Hai nhãn họp và AI nằm dưới mô hình; nút dừng/phát cách đáy 42px. Mark cao 36px |

Camera dùng `z = 6.3 * max(1, 1.72 / aspect)`, với `aspect` là tỷ lệ rộng/cao
của canvas. Khoảng lùi này giữ các mô-đun ở mặt phẳng gần trong khung khi
canvas hẹp, gồm màn hình 320px.

## Chuyển động và giới hạn

Vòng trong xoay, quỹ đạo nghiêng nhẹ, mô-đun nổi và đổi phản xạ, tín hiệu
chạy dọc đường nối. Kéo và chọn mô-đun chỉ đổi góc hoặc nhấn mạnh hình
minh họa, không thao tác dữ liệu doanh nghiệp.

Cảnh được khởi tạo khi đến gần viewport. Renderer dừng vòng lặp khi ngoài
màn hình, document bị ẩn hoặc người dùng nhấn dừng. Với
`prefers-reduced-motion: reduce`, cảnh bắt đầu ở trạng thái dừng; nút phát
vẫn cho phép chạy rõ ràng theo lựa chọn của người dùng. Cảnh phản hồi khi
tùy chọn giảm chuyển động thay đổi. Fallback khi GPU không khả dụng được
giữ lại. Pixel ratio tối đa 1.5. Không dùng bloom hậu kỳ, texture raster,
tài nguyên tải từ mạng hay dependency mới.

Nguồn: `apps/web/features/landing/interactive-scene.tsx`,
`animation/scene-models.ts`, `animation/scene-renderer.ts` và
`hero-nexus.css`. Stylesheet được import trong `landing-page.tsx`.

## Xác minh

Review độc lập kết luận `ship` trong phạm vi làm đậm lõi hero, không có sửa
đổi trọng yếu. Reviewer đã đọc hình nguồn của người dùng và cả 12 ảnh cuối
đã xác nhận hợp lệ trong `.impeccable/review/hero-nexus/`. Mỗi trường hợp
có ảnh cận lõi `<tên>.png` và toàn hero `<tên>-hero.png`:

| Tên trường hợp | Chiều rộng |
| --- | --- |
| `desktop-light-vi` | 1440px |
| `user-light-vi` | 1226px |
| `desktop-dark-en` | 1440px |
| `mobile-light-vi` | 390px |
| `mobile-dark-en` | 320px |
| `user-current-light-vi` | 1254px, tab thực tế trong trình duyệt của app |

Các trường hợp không có tràn ngang, lỗi trang hoặc lỗi tương phản chữ
hero. Ảnh chụp cố định cảnh bằng giảm chuyển động; hành vi chuyển động được
xác minh qua source và E2E, không suy ra từ ảnh tĩnh hay số FPS.

8 test liên quan riêng biệt đã đạt: 6 test `landing-opening` gồm các chiều
rộng 1440/1280/768/390px, tiếng Anh chế độ tối và trạng thái dừng/thay đổi
giảm chuyển động; 2 test `landing-motion` kiểm tra renderer thực sự dừng,
dừng ngoài viewport và fallback khi không có GPU. Sau chỉnh bố cục cuối,
3 ca opening bị ảnh hưởng và 2 ca motion đã được chạy lại, cả 5 đều đạt.
TypeScript của app, ESLint cho 4 file TS/TSX và `git diff --check` đã đạt.
Bộ dò chạy một lần trong phạm vi sửa đổi trả về `[]`.

Không có QUALITY BAR hoặc comp được duyệt được cung cấp cho phần này.
`make check` không chạy được vì host thiếu `make`; chưa xác nhận toàn bộ
repo, backend hoặc toàn bộ E2E. Không có đo FPS hay benchmark hiệu năng độc
lập trong phạm vi xác minh này.
