# 0017 — Một bảng execution cho cả người và AI; nguồn gốc là bảng nối, không suy diễn

**Trạng thái:** accepted (2026-09-16) — quyết định của quangpd (chủ sở hữu sản phẩm), nhận nguyên mô hình GO-4 của bản nháp `unidigiwork` tại commit `9f07c85a`.

## Bối cảnh

Bản nháp chạy một đợt thiết kế riêng (bốn tài liệu `docs/go4/*` kèm báo cáo nghiệm thu
runtime) để trả lời một câu tưởng dễ: *"Kết quả công việc này do ai làm ra?"*

Nó phát hiện **không có quan hệ xác định nào** giữa lượt thực thi và deliverable. Năm
ứng viên đều bị loại vì lý do ghi rõ trong `GO4_WORK_PRODUCT_PROVENANCE.md`: ràng buộc
work_unit là danh mục chứ không phải nguồn gốc; nội dung bàn giao là văn bản nội tuyến
trên dòng execution chứ chưa từng được chèn thành deliverable; tác giả agent là quyền
tác giả chứ không phải id lượt chạy. Kết luận trước đó của GO-3 là
`BLOCKED_BY_SOURCE_MODEL`.

Cám dỗ rõ ràng nhất là suy diễn: cùng tenant, cùng task, cùng tiêu đề, thời điểm gần
nhau thì ghép. Bản nháp thử và tự cấm, vì nó tạo ra quan hệ sai một cách im lặng —
loại lỗi không ai phát hiện cho tới khi một báo cáo cho CEO nói sai ai đã làm gì.

Vấn đề thứ hai là **hai cổng duyệt bị nhầm là một**. Hệ thống có cả duyệt *kết quả chạy
AI* (người xác nhận lượt chạy) lẫn duyệt *Kết quả công việc* (nghiệm thu giá trị nghiệp
vụ). Gộp chúng lại thì hoặc AI tự nghiệm thu được việc của mình, hoặc mọi bản nháp AI
đều kẹt chờ duyệt cấp nghiệp vụ.

Vấn đề thứ ba là cám dỗ đẻ bảng `outcomes` cho "kết quả cuối cùng" — một bảng mà không
luồng nghiệp vụ nào ghi vào và sẽ rỗng vĩnh viễn.

## Quyết định

1. **Một bảng execution duy nhất cho cả người và AI**, phân biệt bằng `executor_type`
   (`AI` | `HUMAN`). Không có loại `HYBRID`: việc vừa người vừa AI là **nhiều dòng
   execution cùng trỏ về một Work Product**.
2. Dòng của người là **nguồn gốc, không phải vòng đời**. Nó không chạy
   CONTEXT → PLAN → GENERATE → ACTION → VALIDATE → REVIEW; nó được ghi với không bước nào.
   Orchestrator vẫn chỉ dành cho AI.
3. **Nguồn gốc execution ↔ Work Product là một bảng nối nhiều-nhiều**, có vai trò
   (`DRAFT` | `REVISION` | `FINAL` | `ARTIFACT_SET`), khóa duy nhất trên cặp
   `(execution, work product)`. Không hardcode 1:1: một lượt chạy đẻ được nhiều
   deliverable, và nhiều lượt chạy góp vào một deliverable.
4. **Cấm suy diễn nguồn gốc.** Không ghép theo trùng tenant, trùng task, trùng tiêu đề
   hay gần nhau về thời điểm. Bảng nối chỉ được ghi bởi lệnh nghiệp vụ, sau khi lệnh đó
   đã tạo hoặc nối deliverable. Backfill cũng không được suy diễn.
5. **Hai cổng duyệt tách hẳn.** Duyệt lượt chạy AI là cổng *đầu ra của AI*; duyệt Work
   Product là cổng *giá trị nghiệp vụ*. Lượt chạy được chấp nhận **không bao giờ** tự
   động duyệt Work Product. Lượt chạy kết thúc không bao giờ tự nhảy sang trạng thái
   đã chấp nhận.
6. **Không có bảng `outcomes`.** Kết quả cuối cùng suy ra từ trạng thái Work Product cộng
   lần xem xét gần nhất. Đo lường SLA và giá trị thương mại là chuyện của giai đoạn sau,
   và khi đó mới bàn tiếp.
7. Điểm chất lượng do máy chấm **không phải** sự chấp nhận của con người. Hai thứ khác
   nhau, không cái nào thay cái nào.

## Hệ quả

- Câu hỏi "việc này người hay AI làm, tỉ lệ bao nhiêu" trả lời được bằng một truy vấn —
  đây là điều kiện để A-11 CEO Command Center có số thật thay vì hai nguồn khập khiễng.
- Thêm `executor_type` về sau sẽ là migration trên bảng nóng nhất hệ thống. Làm ngay từ
  A-01 rẻ hơn nhiều.
- Cái giá đã chấp nhận: mỗi lượt người làm việc sinh thêm một dòng ghi. Đổi lại là một
  mô hình nguồn gốc đối xứng, và không phải giải thích vì sao số của người và số của AI
  đếm bằng hai đơn vị khác nhau.
- Node đồ thị cho execution chỉ được thêm **sau khi** bảng nối tồn tại (ADR 0019). Ở
  C-11 chưa có nó.
- Nội dung bàn giao, gói bằng chứng và chi phí ở lại trên dòng execution; đồ thị chỉ
  giữ danh tính và loại.

## Test giữ luật

- Ràng buộc DB: `executor_type = AI` thì phải có id agent và không có id người;
  `HUMAN` thì ngược lại.
- Arch test: chỉ package lệnh nghiệp vụ được ghi bảng nối; không package nào khác
  `INSERT` vào nó.
- Test: lượt chạy chuyển sang chấp nhận **không** đổi trạng thái Work Product.
