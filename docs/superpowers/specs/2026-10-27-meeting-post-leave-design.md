# Rời phòng và kết thúc họp: hộp thoại chủ trì, màn sau khi rời, logo

> **Trạng thái:** in-progress · UniAI UNI-2230 (sub-issue của UNI-2153) · Canvas đã chốt 2026-10-27: https://claude.ai/artifact/4pQbz5G8Vyhri6qhkRrBbf (trang "2 · Đề xuất")

## 1. Vì sao

Khảo sát 2026-10-27 (canvas, trang "1 · Hiện trạng"): người chủ trì rời phòng không khác gì người thường, mọi quyền điều hành bị treo; sau khi rời hoặc khi họp kết thúc, mỗi người bị đẩy sang một màn trơ trọi (một câu, một nút), khách thì quay về form vào phòng với tên bị xoá. Mục tiêu: mỗi cách rời phòng có một màn riêng nói rõ chuyện gì đã xảy ra, ai, lúc nào, và một cú bấm để làm việc tiếp theo; thương hiệu UniWork xuất hiện đúng chỗ.

## 2. Phạm vi (bản đồ "nguyên nhân → màn" trên canvas)

| Mã | Ai, chuyện gì | Màn |
|---|---|---|
| — | Chủ trì hoặc quản trị viên bấm Rời | Hộp thoại 3 lựa chọn (đã làm): chuyển quyền rồi rời / kết thúc cho mọi người / chỉ rời |
| A | Người tham dự bấm Rời | "Bạn đã rời phòng" ngay trong route phòng: Vào lại (giữ mic, camera lúc rời), Về trang cuộc họp, thẻ ai còn trong phòng + đồng hồ, đánh giá |
| B | Chủ trì chọn Chỉ rời | Như A + chip "Bạn vẫn là chủ trì", thẻ "Đang chờ bạn" (n người xin vào → Cho vào; đang ghi hình mm:ss → Dừng ghi), Chuyển quyền…, Kết thúc cho mọi người |
| C | Chủ trì chuyển quyền rồi rời | Hình bạn → người nhận (vương miện), tiêu đề "{tên} đang chủ trì", Vào lại (vai người tham dự) |
| D | Đang trong phòng khi chủ trì kết thúc, hoặc hết giờ tự kết thúc | "Cuộc họp đã kết thúc": ai kết thúc lúc mấy giờ (hoặc tự kết thúc), 3 ô số liệu (thời lượng, số người có mặt, bản ghi), thẻ Thư ký UNI đang soạn + đếm quyết định/việc/câu hỏi + chip thông báo, "Việc của bạn", Xem trang cuộc họp, Về danh sách cuộc họp, đánh giá |
| E | Chủ trì chọn Kết thúc cho mọi người | LogoLoader phủ phòng trong lúc chờ server; xong thì sang trang cuộc họp có thẻ "Việc sau họp" thay dải bước tiếp theo |
| F | Bị mời ra | "Bạn đã được mời ra khỏi phòng": ai, lúc nào, chip "Không vào lại được", Nhắn cho chủ trì, Về trang cuộc họp |
| G | Khách bấm Rời | Trang công khai sáng: như A, Vào lại giữ tên và thiết bị, "Đổi tên hoặc thiết bị", chân trang "Họp bằng UniWork" |
| H | Khách khi họp kết thúc | "Cảm ơn bạn đã tham gia": giờ kết thúc, 2 ô (bạn ở trong phòng bao lâu, mấy người cùng họp), đánh giá, thẻ "Dùng thử UniWork" |

Điện thoại (< 600px): A và D xếp dọc, nút toàn chiều rộng ở đáy, đánh giá chỉ còn 3 nút icon 44px, logo chỉ dấu 18px ở góc trên phải.

Đã làm trên nhánh, giữ nguyên: "Chuyển chủ trì…" trong tab Người, toast đổi chủ trì, chip "Chủ trì vắng mặt".

## 3. Quyết định đã chốt

1. Màn H **không** có dòng "Biên bản do … gửi cho bạn": khách không có email, không thu thêm dữ liệu cá nhân (chủ sở hữu, 2026-10-27).
2. Đánh giá Tốt/Tạm/Kém chỉ tăng một bộ đếm Prometheus `uniwork_meeting_call_ratings_total{rating}`; không lưu theo người hay cuộc họp, không bảng mới, không audit (không phải trạng thái nghiệp vụ).
3. Logo theo bảng "Logo · nơi đặt": màn tối A–F `<Logo variant="lockup" size={20}>` trên trái trước "← Cuộc họp"; G/H `<Logo variant="lockup" size={28}>` trên trái + dấu 14px ở chân trang; điện thoại `<Logo variant="mark" size={18}>` trên phải; `LogoLoader` khi chờ kết thúc. Không đặt ở trang cuộc họp trong app (E) và hộp thoại rời phòng; không cạnh dấu Thư ký UNI; không nhỏ hơn 16px.
4. Sau khi rời, người dùng **ở lại route phòng** với màn rời; chỉ "Về trang cuộc họp" mới điều hướng. Vào lại không qua màn chờ: dùng lựa chọn thiết bị cũ, mic/camera đúng trạng thái lúc rời.
5. Thẻ "Việc sau họp" (E) chỉ hiện ngay sau khi chính người đó bấm kết thúc (`?ended=1` trên trang cuộc họp); xem lại trang sau đó vẫn là dải bước tiếp theo hiện có.

Quyết định của người viết spec (chủ sở hữu kiểm khi đọc):

- "Báo tôi khi xong" là **chip trạng thái**, không phải công tắc: người tham dự đã nhận `meeting_recap_ready`, chủ trì và thư ký nhận `meeting_summary_ready` theo mặc định. Chip chỉ hiện khi tuỳ chọn thông báo của loại đó còn bật ít nhất một kênh; tắt hết thì không hiện.
- Người còn trong phòng (A/B/C/G) lấy từ `GET /meetings/{id}/participants`, server thêm `in_room` cho mỗi dòng (từ `AttendanceSessionTotals`); màn rời hỏi lại mỗi 15 giây. Khách gọi được endpoint này bằng phiên khách.
- Đồng hồ "đã họp" của khách lấy `started_at` mới trong kết quả resolve link mời; của thành viên lấy `meeting.actual_start_at`.
- F lấy "ai, lúc nào" từ dòng người tham dự của chính mình: server thêm `removed_by`, `removed_at`. Khách bị mời ra không còn đọc được danh sách: màn F của khách bỏ tên và nút nhắn, giữ giờ (giờ máy lúc bị ngắt).
- D lấy người kết thúc từ nhật ký (`MEETING_ENDED` → `actor_id`; `MEETING_AUTO_ENDED` → "Tự kết thúc khi hết giờ").
- H tính "bạn ở trong phòng bao lâu" và "mấy người cùng họp" ngay trên máy khách (cộng dồn thời gian kết nối, đếm danh tính người thật đã thấy trong phòng) trong phiên trình duyệt.

## 4. Không gồm

Tự chuyển quyền khi chủ trì mất kết nối (cần tách chủ trì trong phiên khỏi chủ sở hữu; ADR riêng); gửi biên bản cho khách; app UniChat mobile; màn admin cho đánh giá.

## 5. Kiểm chứng

Test views cho từng màn (vitest, mock transport), test Go cho endpoint và trường mới, `TestIsolationMatrix` cho route mới, chụp app local (sáng, tối, 390px) với dữ liệu demo và so từng màn với bảng canvas tương ứng.
