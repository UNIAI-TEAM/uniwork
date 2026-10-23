# 0016 — Work Product là bounded context riêng; Document là kho duy nhất

**Trạng thái:** accepted (2026-09-16) — quyết định của quangpd (chủ sở hữu sản phẩm) sau khi đối chiếu bản nháp `unidigiwork` tại commit `9f07c85a`.

## Bối cảnh

Bản nháp `unidigiwork` dựng một module mới tên "Kết quả công việc" và trong quá trình
đó tự va vào hai vấn đề mà nó ghi lại trong `.lovable/plan/work-products-*` và
`docs/go3a/CURRENT_WORK_PRODUCT_MODEL_MAP.md`.

Thứ nhất là **thuật ngữ**. Hệ thống đã có "Work Products" mang nghĩa *hợp đồng sản phẩm
công việc* (bảng `work_units`, màn `/work-catalog`): đầu vào, SLA, định giá, tiêu chí
nghiệm thu — tức một khái niệm thương mại. Module mới lại cần đúng cái tên đó cho một
khái niệm khác: *deliverable nghiệp vụ* mà người ta soạn, duyệt và giao. Bản nháp phải
đặt nhãn tiếng Việt khác nhau để đi tiếp. Roadmap của `uniwork` thừa hưởng đúng sự lẫn
này: A-09 "Work Products (bán công việc hoàn thành)".

Thứ hai là **kho lưu trữ**. Bản nháp kết thúc với hai đường ghi tệp song song:
`work_product_artifacts` do module mới tạo, và `document_versions` mà Office Bridge
(GO-2C) ghi vào và GO-3 nối bằng cạnh `REALIZED_AS`. Hai đường lưu trữ nghĩa là hai bộ
quyền, hai nhật ký truy cập, và hai chỗ phải nhớ khi thu hồi chia sẻ. Bản nháp không
dọn kịp vì mỗi đợt làm thêm một đường.

Một deliverable thật không trùng với một tệp: một Đề xuất có thể tồn tại đồng thời ở
dạng soạn trong ứng dụng, dạng DOCX và dạng PDF. Nên Document không đủ làm đơn vị
nghiệp vụ, và Work Product không nên tự nuôi kho riêng.

## Quyết định

1. **Work Product là bounded context riêng.** Nó sở hữu: loại nghiệp vụ (đề xuất, báo
   cáo, phân tích, hợp đồng, kế hoạch…), vòng đời trạng thái, xem xét và duyệt, ảnh chụp
   nguồn ngữ cảnh đã dùng, phiên bản *nghiệp vụ*.
2. **Work Product không sở hữu byte.** Mọi tệp và mọi phiên bản nhị phân nằm ở Document.
   Không có bảng artifact riêng của Work Product. Một Work Product tham chiếu tới các
   document version tạo nên các biểu diễn của nó.
3. **Loại nghiệp vụ tách hoàn toàn khỏi định dạng.** Định dạng là thuộc tính của biểu
   diễn, không phải của Work Product.
4. **Ranh giới ba bên**, mỗi bên một câu:
   - Document — tệp, phiên bản nhị phân, nhật ký truy cập, chia sẻ và thu hồi.
   - Work Product — đây là *cái gì* về mặt nghiệp vụ, đang ở bước nào, ai duyệt, dựa
     trên nguồn nào.
   - `work_units` — hợp đồng thương mại của một *loại* việc. Không đụng hai cái trên.
5. **Work Product không có khóa ngoại tới dự án.** Quan hệ với thế giới đi qua Work
   Graph (ADR 0019). Chỉ giữ một "ngữ cảnh chính" (loại + id, cho phép rỗng) để hiển thị
   "thuộc về đâu" trên danh sách.
6. **A-09 đổi tên thành "Bán công việc"**, trả lại thuật ngữ "Work Product" cho nghĩa
   deliverable.

## Hệ quả

- Roadmap thêm C-14 "Kết quả công việc" là module lõi của Giai đoạn C, ngang hàng Task
  và Document, chứ không phải một lớp mỏng ở A-09.
- **Spec C-01 Documents (`2026-09-08-documents-design.md`, đã duyệt 2026-09-08) phải
  được bổ sung một khái niệm: tài liệu thuộc sở hữu của một Work Product.** Đây là điều
  kiện để C-14 khởi động, không phải gợi ý. Bổ sung ghi thẳng vào spec đã duyệt kèm ngày
  và lý do (§13), không viết spec mới.

  *Đính chính 2026-09-16, sau khi đọc kỹ spec C-01:* bản đầu của ADR này nêu ba yêu cầu
  bổ sung. Hai trong ba đã được C-01 đáp ứng — `document_versions` mang `object_key`,
  `mime_type`, `size_bytes`, `checksum_sha256` nên **phiên bản nhị phân đã có**; và
  **"nhiều định dạng" không cần một tài liệu ôm nhiều định dạng**, nó đạt được bằng
  nhiều tài liệu, mỗi tài liệu một định dạng, cùng thuộc một Work Product, mỗi tài liệu
  giữ lịch sử phiên bản riêng. Thứ thật sự còn thiếu là **quyền sở hữu và ủy quyền
  quyền**: tài liệu thuộc Work Product không đứng trong cây tài liệu của workspace,
  không có chia sẻ và liên kết công khai riêng, và mức quyền của nó ủy quyền sang Work
  Product — nếu không thì có hai cửa vào cùng một nội dung, đúng cái mà quyết định "một
  kho duy nhất" muốn tránh. Quyết định ở trên không đổi; chỉ phần hệ quả này được nói
  lại cho đúng.
- Một đường quyền, một nhật ký truy cập, một chỗ thu hồi chia sẻ. Đổi lại: mỗi thao tác
  trên Work Product đụng tệp đều phải đi qua Document service, không được ghi tắt.
- Office Bridge (C-16) ghi vào `document_versions`, thống nhất với quyết định này.
- Cái giá đã chấp nhận: một Work Product "rỗng" (chưa có biểu diễn nào) là trạng thái
  hợp lệ và UI phải xử lý, thay vì dựa vào việc luôn có sẵn một tệp.

## Test giữ luật

- Migration lint: không bảng mới nào tên `work_product_*` mang cột trỏ tới object
  storage (`bucket`, `object_key`, `storage_path`).
- Arch test: package Work Product không import storage adapter; nó chỉ gọi Document
  service.
