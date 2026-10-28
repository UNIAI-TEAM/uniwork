# Họp: nâng cấp chuyển động và phản hồi (A–G)

> **Trạng thái:** in-progress · UniAI UNI-2285

Bảng đề xuất đã duyệt ngày 29/10/2026: https://claude.ai/artifact/2zFbSW2t7znSJqCkSXRFBU (clip nguồn và công cụ quay ở `.superpowers/meeting-craft/`). Kỹ thuật lấy từ Lucian UX/UI Prompt (MIT, https://lucianlabs.dev/en/uxui-prompt/).

## Vì sao

Các màn Họp đã ổn về cấu trúc nhưng chưa có cảm giác. Con số đứng yên, đổi trạng thái thì giật cục, và Thư ký UNI làm việc mà người dùng không thấy. Chỉ 1 trong 229 thành phần Họp dùng `motion/react`, còn `NumberFlow` có sẵn trong `packages/ui` nhưng chưa dùng ở đâu. Chủ sản phẩm muốn các màn này "hiện đại, đẳng cấp" và đúng 100% như clip đề xuất.

## Mục tiêu

- **A · Danh sách**
  - Thanh lọc trạng thái có một nền trượt giữa các nút.
  - Các dòng hiện lần lượt khi bộ lọc đổi.
  - Số đếm theo ngày cuộn.
  - Dòng đang diễn ra có mặt người trong phòng, dấu Thư ký UNI nếu đang ghi, đồng hồ đã họp cuộn từng giây, và một vệt sáng chạy dọc thanh trạng thái.
- **B · Sắp họp** (≤ 60 phút trước giờ bắt đầu)
  - Vòng thời gian vơi dần, kèm phút:giây cuộn.
  - Người được mời hiện bằng mặt: chưa trả lời thì mờ, viền đứt. Nhận lời thì mặt sáng lên, hiện dấu ✓ và chuyển lên đầu hàng. Số "N chờ" cuộn.
  - Khi còn ≤ 15 phút, nút Bắt đầu họp có viền sáng chạy.
- **C · Tạo cuộc họp**
  - Một khung chọn trượt giữa Online và Trực tiếp.
  - Người được mời trượt vào kèm ảnh đại diện; số người cuộn.
  - Nút Tạo co thành vòng quay, xong thì hiện ✓.
- **D · Phòng chờ**
  - Mic là 5 chấm nhảy theo giọng, nằm trong ô chọn mic; bỏ thanh mức âm.
  - Thông báo Thư ký UNI của thành viên gọn thành một chip, đoạn giải thích đầy đủ nằm sau nút ?.
  - Nút Vào phòng họp co thành vòng quay trong lúc vào.
- **E · Trong phòng**
  - Thông báo ai vào, rời, giơ tay, khách xin vào là các thẻ có mặt người, xếp chồng ở góc trái sân khấu và xòe ra khi rê chuột. Thẻ khách xin vào có nút Cho vào.
  - Tooltip trên thanh điều khiển trượt giữa các nút, không chờ lại.
  - Thời gian còn lại cuộn từng chữ số.
- **F · Tóm tắt**
  - Khi đang soạn: tia sáng quét qua lời thoại, câu được Thư ký UNI trích được tô.
  - Tóm tắt vừa về thì hiện dần từng chữ.
  - Mỗi câu có số nguồn; rê vào thấy lời nói gốc kèm người nói và giờ.
- **G · Giao việc**
  - Chọn việc thì một thanh nổi hiện lên, số việc cuộn.
  - Giao xong thì hàng hiện ✓ rồi gập lại, kèm thanh Hoàn tác có vòng đếm 8 giây.
  - Nhóm giao hết có dấu ✓.

## Không làm

- Không thêm thư viện. Chỉ dùng `motion/react`, `@number-flow/react` (qua `NumberFlow` của `packages/ui`), các token `--ease-*` / `--duration-*` và lớp sẵn có `.border-beam`, `.ai-shimmer`.
- Không đổi luồng nghiệp vụ. Bấm Giao trên thanh nổi vẫn mở hộp Xem lại như hiện nay; clip G bỏ bước này chỉ cho gọn.
- Không thêm sự kiện realtime mới. Dòng đang diễn ra tự làm mới 30 giây một lần.
- Không đổi màn của khách. Phòng chờ và trang link khách vẫn hiện đủ đoạn giải thích Thư ký UNI.

## Không được xảy ra

- Có chuyển động khi người dùng bật "Giảm chuyển động". Lúc đó mọi vòng lặp dừng và mọi chuyển tiếp là tức thì.
- Đồng hồ trôi sai. Mỗi nhịp phải tính lại từ `Date.now()`, không cộng dồn; mở lại tab sau khi ngủ phải hiện đúng giờ.
- Tạo việc trước khi máy chủ trả lời (luật "Create await the server"). Hàng chỉ gập sau khi giao thành công.
- Mất chữ khi tải lại trang. Hiệu ứng hiện dần chỉ chạy khi tóm tắt vừa về trong phiên đang mở; tải trang thì hiện ngay đủ chữ.

## Dữ liệu mới (backend)

1. **Danh sách cuộc họp.** Chỉ các dòng `IN_PROGRESS` mang thêm:
   - `in_room_user_ids`: tối đa 3 thành viên đang có phiên điểm danh mở, ai vào trước đứng trước.
   - `in_room_count`: tất cả người đang trong phòng, kể cả khách.
   - `scribe_live`: lần chạy Thư ký UNI mới nhất đang `ACTIVE`.
2. **`meeting_summary@8`.** Mô hình trả thêm `summary_points: [{text, evidence}]`, gồm 2–6 câu, mỗi câu kèm 1–3 tham chiếu lời thoại. Khi có câu, máy chủ ghép `summary` từ chính các câu này để đoạn văn và câu không lệch nhau. Câu được lưu ở cột mới `meeting_summaries.summary_points TEXT NOT NULL DEFAULT '[]'`.
3. **Hoàn tác giao việc.** `POST /api/v1/meetings/{meetingID}/action-items/undo-convert` nhận `{action_item_ids}` và trả `{restored}`.
   - Người gọi phải qua cùng cổng kiểm tra như lệnh giao.
   - Chỉ hoàn tác việc do chính người gọi giao trong 2 phút gần nhất, và task chưa ai dùng sau khi tạo: chưa bị sửa, chưa có task con, bình luận, tệp đính kèm, phụ thuộc hay việc họp khác nối vào. Việc không đủ điều kiện thì bỏ qua, không báo lỗi.
   - Chuyển task vào thùng rác qua đường xoá task sẵn có (có audit, khôi phục được), đưa việc về trạng thái chờ giao, rồi ghi audit kèm outbox như lệnh giao.

## Thông số chuyển động (lấy từ clip)

| Chỗ | Giá trị |
|---|---|
| Nền trượt, khung chọn | `layout` của motion, 450 ms, `UI_EASE_SETTLE` |
| Dòng hiện lần lượt | nhích lên 8 px và mờ dần, 420 ms ease-out-quart, mỗi dòng trễ 32 ms, tối đa 14 dòng |
| Mặt người, dấu ✓ bật | scale .6 → 1.08 → 1, 360 ms |
| Vệt sáng thanh trạng thái | 2,4 s một vòng |
| Tia quét lời thoại | 2,4 s một vòng |
| Chữ hiện dần | mỗi chữ mờ → rõ, blur 3 px → 0, nhích lên 5 px, 420 ms; mỗi chữ trễ 34 ms; tổng tối đa 2,4 s |
| Thanh nổi | nhích lên 12 px và mờ dần, 260 ms |
| Hàng gập | 320 ms `UI_EASE_SETTLE` |
| Hoàn tác | vòng đếm 8 s |
| Tooltip | lần đầu trễ 300 ms; sang nút bên cạnh thì hiện ngay và trượt 150 ms |
| Thông báo trong phòng | tự tắt sau 5 s (dừng khi rê chuột); hiện tối đa 3 thẻ |

## Những gì để người làm tự quyết

- Tên thành phần và chỗ tách file. Mỗi file `.tsx` tối đa 500 dòng.
- Cách nối với sonner hoặc Base UI Tooltip.
- Cách tính câu nào được tô khi đang soạn tóm tắt, miễn là chỉ tô các đoạn đã có căn cứ thật (mục Thư ký UNI ghi được trong phòng). Không có căn cứ thì chỉ quét, không tô.
