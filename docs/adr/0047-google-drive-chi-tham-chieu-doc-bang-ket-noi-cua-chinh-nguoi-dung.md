# 0047 — Google Drive: chỉ tham chiếu, đọc bằng kết nối của chính người yêu cầu

**Trạng thái:** accepted (2026-10-26, UNI-2172 / UNI-2179). Người dùng ký duyệt spec ngày 2026-10-26; bản nháp đề xuất với số tạm 0038 chuyển ra `docs/adr/` ở nhiệm vụ B9 (cùng PR với B3) và nhận số 0047 vì 0038–0046 đã được dùng trên nhánh gốc.
**Issue:** UNI-2172 (con của UNI-923) · **Liên quan:** [0010](0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md), [0016](0016-work-product-la-bounded-context-tai-lieu-la-kho-duy-nhat.md), [0008](0008-cach-ly-tenant-o-tang-service.md), [0034](0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md) (khóa không rời server).

## Bối cảnh

Người dùng (2026-10-26) duyệt connector Google Drive: UniWork liên kết từng tệp chọn bằng Google Picker (scope `drive.file`), UNI đọc tài liệu đã liên kết để đề xuất việc, người duyệt rồi việc mới được tạo. Spec nguồn "1244" có NFR-03 "không gửi nội dung Drive riêng tư cho AI"; người dùng thay nó bằng đọc có consent. Một người có thể kết nối nhiều tài khoản Google, và nhiều người UniWork có thể dùng chung một tài khoản Google (người dùng chốt Q2). Mỗi người chỉ thấy tham chiếu Drive của chính mình trong Tài liệu; tệp gắn vào việc hiện dạng thẻ cho ai xem được việc (Q6); quyền đọc nội dung thật nằm ở ACL của Google.

Ba chỗ dễ bị "sửa" sai về sau:

1. ADR 0016 nói Document là kho duy nhất — người đến sau dễ cho rằng tham chiếu Drive phải là dòng `documents`.
2. Kết nối của người liên kết đọc được tệp; dùng nó để đọc cho người khác là đường tắt tiện lợi nhưng vượt qua ACL của Drive.
3. AI đọc nội dung riêng tư trông như mâu thuẫn với NFR-03 cũ và ADR 0010.

## Quyết định

1. **Tham chiếu tệp ngoài không phải dòng `documents`.** Tham chiếu Drive nằm ở bảng riêng (`drive_files`, `drive_file_access`, `drive_file_task_links`). ADR 0016 giữ nguyên: Document là kho duy nhất của **byte** và quyền UniWork trên byte đó; Drive không đưa byte nào vào UniWork và quyền của nó là ACL của Google, nên nó không đi qua chia sẻ, link, phiên bản, danh sách, cây, tìm kiếm hay Work Graph của Documents. Một connector khác (OneDrive…) theo cùng quyết định.
2. **Nội dung Drive chỉ được đọc bằng kết nối của chính người yêu cầu.** Mọi lượt đọc nội dung (đề xuất việc, Hỏi UNI, mọi tính năng sau) tìm kết nối qua `drive_file_access` của người yêu cầu; không route, job, tool hay agent nào đọc bằng kết nối của người khác, kể cả của người liên kết. Không có kết nối hợp lệ thì trạng thái là "chưa rõ" và người dùng được mời tự cho phép (Picker), không bao giờ lặng lẽ thử tài khoản khác. UniWork không chia sẻ tệp trên Drive thay ai.
3. **AI đọc nội dung riêng tư khi người yêu cầu đồng ý (NFR-03 sửa đổi).** Điều kiện: người yêu cầu đã cấp `drive.file` cho đúng tệp và chủ động yêu cầu. Nội dung đi qua `ai.Gateway`, không được lưu trong UniWork ngoài trích đoạn ≤ 300 ký tự nằm trong mô tả việc người duyệt đã tạo; trích đoạn đó là nội dung việc, ở lại theo vòng đời của việc, không kèm cảnh báo hay ghi chú (người dùng chốt Q3). Bản nháp đề xuất trong lô bị xóa ngay khi lô được tạo việc hoặc hủy; lô không ai xử lý bị xóa cứng sau tối đa 7 ngày + 1 giờ. Tệp DOCX/XLSX/PPTX được trích văn bản trong office-engine cho đúng một lượt đọc; kết quả trả thẳng trong trạng thái job, không thành object trong kho (Q8). Hội thoại Hỏi UNI có tệp Drive làm ngữ cảnh không được lưu (spec Q10; lưu sẽ cần sửa quyết định này). Đây là áp dụng ADR 0010 §6 (ngữ cảnh chỉ gồm dữ liệu người khởi tạo được đọc), không phải ngoại lệ: UNI chỉ đề xuất, việc chỉ được tạo bởi lệnh của người.
4. **Token Google không rời server.** Refresh token mã hóa bằng `DRIVE_CREDENTIAL_KEY`; trình duyệt chỉ nhận access token `drive.file` ngắn hạn của chính người đó để chạy Picker; app desktop không nhận token Google nào (như khóa BYOK ở ADR 0034).

## Hệ quả

- Màn Tài liệu có nút Google Drive riêng thay vì trộn vào danh sách tài liệu, và nút đó chỉ liệt kê tệp của chính người xem (không có danh sách cấp workspace); Type filter và tìm kiếm Documents không thấy tệp Drive. Cái giá: hai chỗ hiện "tệp", nhưng không có đường nào vô tình áp quyền UniWork lên tệp Drive.
- Thấy một tham chiếu (tên, tài khoản gắn) không bao giờ cho đọc nội dung: thẻ trên việc theo cổng đọc việc, nội dung theo quyết định 2.
- Người thứ hai muốn UNI đọc tệp phải tự kết nối và chọn tệp một lần (Picker chọn sẵn). Cái giá: thêm một bước; đổi lại không ai đọc được thứ Google không cho họ đọc.
- Trích đoạn trong mô tả việc là nội dung việc bình thường, theo vòng đời của việc; ai xem được việc đọc được nó (người dùng chấp nhận, Q3).

## Test giữ luật (điều kiện để đưa luật vào `CLAUDE.md`)

- `TestDriveContentReadsUseTheCallersConnection` (service): mọi hàm đọc nội dung nhận người yêu cầu và từ chối kết nối không phải của họ.
- `TestDriveContentOnlyFromDriveContent` (`server/internal/arch_test.go`): chỉ `server/internal/service/drive_content.go` gọi `files.export` / `alt=media`.
- `TestDriveProposalOnlyItsRequester` (service): lô đề xuất chỉ người yêu cầu đọc/hủy/tạo được, kể cả trong cùng workspace.
- `TestAskUniDriveFocusIsNotPersisted` (service): lượt Hỏi UNI có focus `drive_file` không ghi tin nhắn hay trích dẫn.
- Migration lint (`TestDriveTablesCarryNoObjectStorageColumns`): không bảng `drive_*` nào mang cột trỏ tới object storage (`object_key`, `bucket`, `storage_path`).
- `TestDriveOfficeExtractWritesNoObject` (service, engine giả): trích DOCX/XLSX/PPTX không xin đích output và không ghi object nào.
