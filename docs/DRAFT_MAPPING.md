# Đối chiếu bản nháp `unidigiwork` ↔ UniWork

> **Trạng thái:** in-progress · **Ngày khảo sát:** 2026-09-16 · **Bản nháp tại commit:** `9f07c85a` (2026-09-15, nhánh `main`, cây làm việc sạch) · **Lần đối chiếu trước:** 2026-09-04

Mục đích: ghi lại *đã đối chiếu tới đâu*, để lần sau chỉ phải so phần thay đổi kể từ
commit ghi ở trên thay vì khảo sát lại từ đầu.

Luật tham chiếu bản nháp nằm ở `docs/roadmap/LEGACY_REFERENCE_MAP.md` và không đổi:
đọc để hiểu người dùng đã được hứa gì, **không port mã**.

## Cách đọc

| Cột | Ý nghĩa |
| --- | --- |
| Trong bản nháp | `Chạy thật` có migration đã áp dụng và/hoặc báo cáo nghiệm thu runtime · `Một phần` · `Ước tính` số suy ra chứ không đo · `Lab` chỉ dùng nội bộ sau cờ tính năng |
| Ở UniWork | `Đã có` · `Một phần` · `Chưa có` · `Khác bản nháp` có chủ đích |

## 1. Kết quả công việc và tài liệu

| Tính năng | Trong bản nháp | Ở UniWork | Task | Ghi chú |
| --- | --- | --- | --- | --- |
| Deliverable nghiệp vụ: loại tách khỏi định dạng, nhiều biểu diễn, phiên bản có ảnh chụp nguồn gốc, bình luận, xem xét/duyệt | Chạy thật | Chưa có | C-14 | Bản nháp **đổi nghĩa** "Work Products": nay là module lõi; nghĩa thương mại cũ dời sang `/work-catalog`. UniWork theo hướng này (ADR 0016) |
| Chọn nguồn ngữ cảnh AI tường minh (công tắc từng nguồn; chỉ nguồn bật mới gửi cho AI và mới ghi vào nguồn gốc phiên bản) | Chạy thật | Chưa có | C-14 lát 4 | Ý tưởng đáng giá nhất về mặt quản trị AI: người duyệt thấy AI đã đọc gì |
| Thanh công cụ AI khi bôi đen (Hỏi / Cải thiện / Rút gọn / Mở rộng / Viết lại / Dịch), luôn xem trước rồi mới ghi | Chạy thật | Chưa có | C-14 lát 4 | |
| Documents: soạn thảo cộng tác, phiên bản, chia sẻ, nhật ký truy cập | Chạy thật | Chưa có, spec đã duyệt 2026-09-08 | UNI-437 (C-01) | **Spec đã duyệt phải được bổ sung** khái niệm *tài liệu thuộc sở hữu của Kết quả công việc* (§13, ADR 0016). Phiên bản nhị phân đã có sẵn |
| Nhập DOCX giữ nguyên bản gốc, khối có neo OOXML, thay đổi chờ duyệt, vá đúng chỗ | Chạy thật | Chưa có | C-15 | Engine là TypeScript → UniWork chạy qua sidecar Node (ADR 0018). Phạm vi web **thu hẹp**: đọc + AI đề xuất + duyệt + vá; sửa tay bằng UniWork Office |
| Office Bridge: mở tài liệu bằng ứng dụng máy tính, lưu ngược có phiên bản, lệch bản → 409, thu quyền → chặn lưu | Chạy thật | Chưa có | C-16 | UniWork Office = bản tùy biến từ GenOffice. Ràng buộc `/ee` và thương hiệu ở ADR 0018 |
| So sánh hai bộ máy Office | Lab | Không mang sang | — | Công cụ nội bộ của đợt chọn engine, không phải tính năng người dùng |

## 2. Work Graph và thực thi

| Tính năng | Trong bản nháp | Ở UniWork | Task | Ghi chú |
| --- | --- | --- | --- | --- |
| Đồ thị quan hệ, từ vựng có kiểm soát, nguồn gốc người/AI | Chạy thật | Chưa có | UNI-460 (C-11) | Kiến trúc projection qua outbox và lệnh cấm suy diễn là ADR 0019 |
| Một bảng execution cho người và AI; nguồn gốc execution ↔ deliverable là bảng nối nhiều-nhiều | Chạy thật | Chưa có | UNI-447 (A-01) | ADR 0017. Bản nháp mất một đợt thiết kế riêng mới rút ra được |
| Tách duyệt kết quả AI khỏi duyệt Kết quả công việc; Outcome dẫn xuất, không có bảng | Chạy thật | Chưa có | UNI-447 (A-01) | ADR 0017 |
| Bàn gắn nhanh: kéo tài liệu thả vào công việc để tạo liên kết | Chạy thật | Chưa có | sub của UNI-460, P2 | |
| Chia sẻ bản đồ công việc bằng liên kết ngoài có hạn | Chạy thật | **Hoãn** | — | Quyết định 2026-09-16: làm nền C-11 trước, tính sau khi biết pilot có cần |

## 3. Điều hành và AI

| Tính năng | Trong bản nháp | Ở UniWork | Task | Ghi chú |
| --- | --- | --- | --- | --- |
| CEO Command Center: lọc kỳ có so kỳ trước, chuyển dịch Người↔AI, bảng nhân sự người và AI chung, chất lượng kết quả, theo bộ phận, vấn đề tự phát hiện có drill-down | Chạy thật | Chưa có | A-11 | UNI-451 (A-05) chỉ phủ home brief + dashboard nên tách ID riêng |
| Giao ban thực tế: ghi kết quả từng việc ngay trong buổi họp | Chạy thật | Chưa có | A-11 | Bản nháp đi qua lệnh nghiệp vụ sẵn có chứ không ghi thẳng DB — giữ đúng cách đó |
| Job nền: chốt KPI hằng ngày, tự tạo họp tuần, giờ giao ban riêng từng tổ, báo cáo tuần xuất PDF/Excel | Chạy thật | Chưa có | A-11 | |
| Giờ làm của người | **Ước tính** (số việc × hệ số) | **Khác bản nháp** | A-11 | Quyết định 2026-09-16: chỉ hiện số đo thật (giờ họp, giờ AI, số việc, số kết quả được duyệt). Quy đổi giờ/tiền người là **đơn giá tổ chức tự đặt** trong Cài đặt, hiện kèm công thức. Không có hằng số chôn trong code |
| Doanh thu / doanh số | Cố ý không có | Cố ý không có | — | Bản nháp từ chối dựng số doanh thu giả dù ảnh mẫu có. Giữ nguyên thái độ đó |
| Bộ não AI: đề xuất chờ duyệt, hồ sơ nhân sự AI, nhật ký, theo dõi đề xuất đã giao | Chạy thật | Chưa có | A-12 | Là **bề mặt hợp nhất**, không phải năng lực mới — phụ thuộc A-01 và A-02 |
| Bật/tắt kỹ năng theo mức rủi ro; rủi ro cao khóa "bắt buộc người duyệt" | Chạy thật | Chưa có | A-12 | Khớp thẳng policy của UNI-448 (A-02) |
| Job tự đào tạo lại hằng ngày | Chạy thật | Chưa có | — | Tách khỏi A-12: đây là năng lực thật, không nên núp trong task về màn hình. Quyết sau khi có A-01 |

## 4. Tổ chức, giao diện, nền tảng

| Tính năng | Trong bản nháp | Ở UniWork | Task | Ghi chú |
| --- | --- | --- | --- | --- |
| Hồ sơ, bộ phận, danh bạ | Chạy thật | **Đã có** | UNI-431, 499, 517, 522 | UniWork đã vượt bản nháp |
| Quản lý lịch họp cấp tổ chức; nhập Excel nhân sự/bộ phận/lịch họp/tiến độ | Một phần | **Chưa làm** | — | Quyết định 2026-09-16: chưa tạo task. Mời thành viên và CSV danh bạ của F-03 đã đủ dùng |
| Trang chủ / My Space: kéo thả và chỉnh kích thước card, lưu theo người dùng, **lịch sử bố cục có khôi phục**, hai cấu hình độc lập | Chạy thật | Một phần | UNI-451 (A-05) | Lịch sử bố cục là ý mới, bổ sung vào A-05 |
| Mobile | PWA (manifest, service worker, push, `/m/*`) | **Khác bản nháp** | UNI-444 (C-08) | Giữ ADR 0011 (app Expo). Bản nháp chọn PWA vì chạy trên Lovable — ràng buộc nền tảng, không phải kết luận sản phẩm. Chỉ mang sang **kiến trúc thông tin 5 tab và trang More** |
| Ngôn ngữ `id` (Indonesia), `ms` (Malaysia) | Chạy thật | **Chưa thêm** | UNI-436 (F-14) | Quyết định 2026-09-16: chờ nhu cầu thật ở thị trường đó |
| Trợ lý AI bán hàng trên trang công khai | Chạy thật | Chưa có | UNI-504 | |
| Giao diện hướng ClickUp: tone gradient, card modular | Chạy thật | **Đã có** | UNI-527, UNI-582 | UniWork đã bám sát |

## 5. UniWork có mà bản nháp không có

Ghi để lần đối chiếu sau không "so ngược" rồi tưởng thiếu:

- Cuộc họp trọn vòng đời LiveKit: phòng thật, lobby, khách, ghi hình, transcript, tóm tắt AI, ICS, tự kết thúc quá giờ.
- Chat đẳng cấp ClickUp: kênh gắn Project, thread hạng nhất, tin nhắn ↔ task, Posts, FollowUps, đính kèm (UNI-506…516).
- Tasks Work Management parity 8 lát + human-parity A–E (UNI-426).
- Nền tảng Go: audit bất biến + outbox + catalogue sự kiện ba nơi, entitlement fail-closed, notification sinh từ outbox, MFA và quản lý phiên, platform admin, OpenTelemetry, k6, feature flag theo org.

## 6. Bản nháp còn giữ nhưng UniWork đã loại

Không đổi so với lần trước, ghi lại cho đủ: Email Hub nội bộ trong DB · AI Market dạng
chợ mở · Blog/CMS công khai · toàn bộ hàm PL/pgSQL và policy RLS (nghiệp vụ viết lại
trong Go service) · mọi số liệu mock.

## 7. Quyết định của phiên 2026-09-16

Mười câu, chốt bởi quangpd. Chi tiết và lý do ở `docs/roadmap/OPEN_QUESTIONS.md` mục
"Phiên đối chiếu bản nháp 2026-09-16"; các quyết định kiến trúc thành ADR 0016–0019.
