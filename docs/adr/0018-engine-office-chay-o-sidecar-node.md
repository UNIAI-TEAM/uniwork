# 0018 — Engine Office chạy ở sidecar Node, dùng chung với ứng dụng UniWork Office

**Trạng thái:** superseded by 0021 (2026-09-25) — quyết định gốc của quangpd (chủ sở hữu sản phẩm) ngày 2026-09-16, được thay bởi [0021](0021-runtime-engine-office-da-dinh-dang.md). Lịch sử giữ nguyên, không sửa phần còn lại. Định hướng: UniWork Office là bản tùy biến từ GenOffice (`genspark-ai/genoffice`, Apache-2.0).

## Bối cảnh

UniWork cần đọc và ghi DOCX ở phía máy chủ cho ba việc: trích nội dung để AI đọc và để
tìm kiếm đánh index; vá thay đổi mà AI đề xuất sau khi người duyệt; xuất tệp bàn giao.

Máy chủ UniWork là **Go**. Engine OOXML dùng được là `docx-engine` của GenOffice —
**TypeScript thuần**, khoảng 22.700 dòng, phụ thuộc `jszip`, `fast-xml-parser`, `utif2`,
đều MIT, không binding native. Bản nháp `unidigiwork` đã nhúng và chạy thật; báo cáo
`WORK_PRODUCTS_DOCX_ROUNDTRIP_ACCEPTANCE.md` và `WORK_PRODUCTS_OFFICE_ENGINE_BENCHMARK.md`
là bằng chứng nó đọc–vá–ghi được tài liệu Word có sẵn mà giữ nguyên phần không đụng tới.

Bản nháp làm được điều đó vì runtime của nó vốn là TypeScript. UniWork không có sẵn lối
đó, nên phải chọn: viết lại engine bằng Go, hay chạy engine ở một tiến trình riêng.

Viết lại bị loại. 22.700 dòng xử lý OOXML là nhiều năm công trường hợp biên — trường
đánh dấu, VML, ký tự đặc biệt, metafile, bảng ô gộp, đầu chân trang. Một bản Go viết lại
sẽ lệch dần so với engine mà ứng dụng máy tính dùng, và chính chỗ lệch đó phá đúng lời
hứa "giữ nguyên định dạng gốc".

Điều làm cân bằng nghiêng hẳn: **UniWork Office là bản tùy biến từ chính GenOffice**.
Nếu máy chủ chạy cùng engine với ứng dụng máy tính thì hai bên không bao giờ bất đồng về
định dạng. Nếu máy chủ chạy engine thứ hai do mình viết thì chắc chắn sẽ có ngày bất đồng.

## Quyết định

1. Trong Go có **một adapter Office**. Nó gọi qua **HTTP nội bộ** tới một **dịch vụ Node
   sidecar** trong monorepo, chạy đúng `docx-engine` mà bản UniWork Office dùng.
2. Xác thực máy chủ–máy chủ bằng khóa bí mật. Khóa **không bao giờ** tới trình duyệt.
   Endpoint không công khai.
3. Mọi lần xuất hoặc vá đều ghi lại engine và phiên bản engine thực tế đã dùng. Không gán
   nhãn engine này cho tệp do engine khác tạo.
4. **Sidecar chết thì hỏng có giới hạn**: thao tác vá và xuất báo lỗi rõ ràng; mọi chức
   năng khác của Work Product (danh sách, soạn native, bình luận, duyệt, phiên bản) vẫn
   chạy bình thường.
5. **Sidecar là thành phần bắt buộc của bộ cài on-premise (E-01)** — compose và Helm.
   Bỏ sót nó nghĩa là bản on-premise mất tính năng DOCX, và đó là lỗi phát hành chứ
   không phải giới hạn đã biết.
6. Phạm vi đợt này **chỉ DOCX**. XLSX, PPTX, PDF bàn sau khi DOCX có kết luận.

## Ràng buộc giấy phép và thương hiệu cho bản tùy biến UniWork Office

GenOffice là Apache-2.0, chủ sở hữu Mainfunc, Inc. Fork và tùy biến được, với ba điều
kiện **bắt buộc kiểm bằng máy, không bằng trí nhớ**:

1. Giữ nguyên `LICENSE` và `NOTICE` của thượng nguồn, ghi rõ commit gốc đã fork.
2. **Loại trừ thư mục `/ee` của thượng nguồn**, và chặn bằng một bước kiểm trong CI.
   Thư mục đó nhiều khả năng không theo Apache-2.0; bản nháp cũng đã cố ý loại nó.
3. Không dùng tên hay logo "GenOffice" / "Genspark" làm thương hiệu. Tên chỉ được xuất
   hiện như định danh engine trong siêu dữ liệu kỹ thuật.

## Hệ quả

- Sơ đồ triển khai có thêm một runtime. Đây là cái giá thật, đã cân nhắc và chấp nhận.
- Một engine, hai nơi chạy: máy chủ và máy tính cá nhân không bao giờ bất đồng định dạng.
- Vì đã có UniWork Office làm trình soạn thảo đầy đủ, **trình duyệt không đua sửa DOCX
  giữ nguyên định dạng**. Trên web: đọc, AI đề xuất theo khối, người duyệt, vá qua
  sidecar, sinh phiên bản mới. Sửa tay định dạng nặng thì mở UniWork Office.
- Không bao giờ ghi đè tệp gốc. Bản gốc là bất biến, có mã kiểm tra; mỗi lần vá sinh một
  phiên bản mới.
- Vá không an toàn được thì **dừng và nói thật** ("phần này chưa sửa được mà vẫn giữ
  nguyên định dạng gốc"), không im lặng dựng lại tài liệu.

## Test giữ luật

- Arch test: không package nào ngoài adapter Office gọi tới sidecar.
- Test: khóa sidecar không xuất hiện trong bundle client.
- CI bộ cài E-01: kiểm sidecar có mặt trong compose và Helm.
- CI bản fork UniWork Office: kiểm không tồn tại đường dẫn `/ee`.
