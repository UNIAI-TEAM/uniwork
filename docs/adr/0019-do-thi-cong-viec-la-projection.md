# 0019 — Đồ thị công việc là projection, không phải nguồn sự thật

**Trạng thái:** accepted (2026-09-16) — quyết định của quangpd (chủ sở hữu sản phẩm), nhận kiến trúc GO-3 của bản nháp `unidigiwork` tại commit `9f07c85a`.

## Bối cảnh

Work Graph là nền của AI Context Engine và của Organizational Memory (Vision §5.2 mục
17). Cám dỗ khi xây nó là coi đồ thị như một kho thứ hai: ghi thẳng vào đồ thị lúc tạo
quan hệ, rồi đọc trạng thái từ đồ thị cho nhanh.

Bản nháp đi đường đó trước rồi rút ra, ghi lại trong `docs/go3/PROJECTION_ARCHITECTURE.md`
và `docs/go3/ARCHITECTURE.md`. Hai kho ghi song song thì sẽ có ngày lệch nhau, và khi
lệch thì không ai biết bên nào đúng. Nặng hơn: đồ thị lệch là đồ thị nuôi sai ngữ cảnh
cho AI, mà sai ngữ cảnh thì mọi câu trả lời phía sau đều sai một cách thuyết phục.

Cám dỗ thứ hai là **suy diễn quan hệ**: hai bản ghi cùng tenant, tiêu đề giống nhau,
tạo cách nhau vài phút thì nối lại. Bản nháp thử và tự cấm — nó tạo ra quan hệ sai một
cách im lặng, loại lỗi không ai phát hiện cho tới lúc nó đã lan vào báo cáo.

## Quyết định

1. **Nguồn sự thật nằm ở bảng nghiệp vụ.** Đồ thị được dựng lại từ đó, không bao giờ là
   nơi tra trạng thái.
2. **Đường ghi là: lệnh nghiệp vụ ghi bảng nguồn → outbox → projector idempotent.**
   Không ghi đồ thị trong cùng transaction của lệnh nghiệp vụ. Điều này khớp sẵn với
   ADR 0009 (audit + outbox cùng transaction) — projector là một consumer như mọi
   consumer khác.
3. **Khóa duy nhất trên `(từ, loại quan hệ, tới)`.** Chạy lại projector không đẻ cạnh
   trùng; backfill và luồng thường có thể cùng sinh một cạnh mà không hại.
4. **Cấm suy diễn quan hệ** từ trùng thời điểm, trùng tiêu đề, trùng tenant hay bất kỳ
   dấu hiệu gián tiếp nào. Một cạnh chỉ tồn tại khi có một bản ghi nguồn chống lưng.
5. **Từ vựng quan hệ có kiểm soát**, và mỗi cạnh mang **nguồn gốc**: do người tạo hay do
   AI suy ra. Hai loại đó không được trộn khi hiển thị.
6. **Không thêm loại node khi chưa có bảng nguồn chống lưng.** Cụ thể: node cho lượt thực
   thi chỉ được chiếu sau khi bảng nối nguồn gốc của ADR 0017 tồn tại — tức ở A-01, không
   phải ở C-11.
7. **Đồ thị chỉ giữ danh tính và loại.** Nội dung nhạy cảm (nội dung bàn giao, gói bằng
   chứng, chi phí) ở lại bảng nguồn và đọc qua đúng đường quyền của bảng đó.
8. **Node không bao giờ lộ nhiều hơn bản ghi nguồn cho phép.** Quyền xem một node suy ra
   từ quyền xem bản ghi nguồn, không rộng hơn. Không cạnh nào bắc qua hai tenant.

## Hệ quả

- C-11 làm nền quan hệ và projector; nó **không** có node cho lượt thực thi.
- Đồ thị có thể trễ so với bảng nguồn trong khoảng thời gian outbox chưa xử lý. Đây là
  cái giá đã chấp nhận, và UI không được trình bày đồ thị như số liệu tức thời.
- Dựng lại toàn bộ đồ thị từ đầu là thao tác hợp lệ và phải luôn chạy được — đó là cách
  sửa khi projector có lỗi.
- Một quan hệ do người tạo và một quan hệ do lượt thực thi sinh ra có thể cùng tồn tại
  giữa hai đối tượng; khóa duy nhất lo phần không trùng lặp. Câu hỏi "ai đã làm ra cái
  này" phải đi qua đường nguồn gốc của ADR 0017, không đọc cạnh tắt.

## Test giữ luật

- Arch test: chỉ package projector được ghi bảng node và bảng cạnh.
- Test idempotent: chạy projector hai lần trên cùng sự kiện cho ra đúng một cạnh.
- Test quyền: node không hiển thị cho người không xem được bản ghi nguồn; không cạnh nào
  nối hai tenant.
- Catalogue: mỗi loại quan hệ có một dòng khai báo; loại không khai thì projector từ chối.
