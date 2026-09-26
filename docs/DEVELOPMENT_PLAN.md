# Kế hoạch phát triển sau đối chiếu bản nháp 2026-09-16

> **Trạng thái:** in-progress · **Cập nhật:** 2026-09-16 · **Nguồn:** `docs/vision/PROJECT_VISION.md`, `docs/roadmap/FEATURE_ROADMAP.md`, `docs/DRAFT_MAPPING.md`

Tài liệu này là **thứ tự làm** sau đợt đối chiếu bản nháp `unidigiwork` ngày 2026-09-16.
Nó không thay `docs/roadmap/FEATURE_ROADMAP.md` — roadmap giữ danh sách tính năng và
trạng thái thật; bản này giữ **phụ thuộc, thứ tự và lý do xếp thứ tự**.

Luật không đổi: không tính năng nào bắt đầu code khi chưa có spec **Đã duyệt** trong
`docs/superpowers/specs/` và plan trong `docs/superpowers/plans/`
(`docs/engineering/FEATURE_WORKFLOW.md`).

## Nguyên tắc xếp thứ tự

Nền dữ liệu trước, bề mặt sau. Không màn hình nào đọc dữ liệu chưa có nguồn thật — đây
chính là cái bẫy bản nháp rơi vào và tự ghi lại trong các báo cáo GO-3/GO-4: xây bề mặt
trước rồi mới phát hiện không có quan hệ nào chống lưng cho câu hỏi người dùng đang hỏi.

## Giai đoạn C — phần thêm sau đối chiếu

Thứ tự dưới đây là thứ tự **phụ thuộc**, không phải mức ưu tiên.

| # | Việc | Phụ thuộc | Vì sao đứng ở đây |
| --- | --- | --- | --- |
| 1 | **C-11 Work Graph** (UNI-460) | — | Mọi quan hệ của Kết quả công việc đi qua đây. Làm sau thì C-14 phải tự đẻ quan hệ riêng rồi gỡ ra |
| 2 | **C-01 Documents** (UNI-437) | — | Là kho duy nhất (ADR 0016). Spec đã duyệt 2026-09-08, cần bổ sung ba điều bên dưới |
| 3 | **C-14 Kết quả công việc** | 1, 2 | Module lõi mới |
| 4 | **C-16 Office Bridge** | 2 | Ghi vào `document_versions`; không phụ thuộc C-14 nên chạy song song được |
| 5 | **C-15 Nhập DOCX + AI sửa có duyệt** | 3, 4, sidecar | Cần cả deliverable lẫn kho tệp mới có chỗ mà vá |

**C-11 ở đợt này không có** node cho lượt thực thi (ADR 0019 mục 6) và **không có** chia
sẻ bằng liên kết ngoài. "Bàn gắn nhanh" (kéo tài liệu thả vào công việc) là sub-issue P2.

**C-01 — spec đã duyệt 2026-09-08, phải bổ sung một khái niệm**: *tài liệu thuộc sở hữu
của một Kết quả công việc* (§13 của spec, viết 2026-09-16). Tài liệu thuộc sở hữu không
đứng trong cây tài liệu của workspace, không có chia sẻ và liên kết công khai riêng, và
mức quyền ủy quyền sang Work Product. Không có nó thì có hai cửa vào cùng một nội dung
và C-14 không khởi động được.

Phiên bản nhị phân **đã có sẵn** trong C-01 (`document_versions` mang `object_key`,
`mime_type`, `checksum_sha256`), và "nhiều định dạng" đạt được bằng **nhiều tài liệu
cùng thuộc một Work Product**, không phải bằng một tài liệu ôm nhiều định dạng.

**C-14 — năm lát:**

1. Dữ liệu + quyền + nối Work Graph.
2. Danh sách + chi tiết + soạn thảo native + tự lưu.
3. Phiên bản có ảnh chụp nguồn gốc + bình luận + xem xét/duyệt.
4. AI: bảng chọn nguồn ngữ cảnh tường minh + thanh công cụ bôi đen; mọi thứ xem trước
   rồi mới ghi, và chỉ nguồn đang bật mới được gửi đi lẫn được ghi vào nguồn gốc.
5. Tích hợp: tìm kiếm toàn cục, Home, liên kết ngược từ Dự án/Cuộc họp, bản mobile
   chỉ đọc và duyệt.

**C-15 — phạm vi đã thu hẹp so với bản nháp.** Vì UniWork Office là trình soạn thảo đầy
đủ, web **không** làm trình soạn thảo khối. Web làm: nhập tệp giữ nguyên bản gốc bất
biến (mã kiểm tra, không bao giờ ghi đè) → trích nội dung cho AI và tìm kiếm → AI đề
xuất theo khối → người duyệt → sidecar vá đúng chỗ → phiên bản mới. Vá không an toàn
được thì dừng và nói thật.

**C-16 — ba mảnh:** phiên mở tài liệu và tải xuống · lưu ngược có khóa chống lặp và 409
khi lệch phiên bản · thu hồi quyền giữa chừng và kiểm chứng cách ly chéo tổ chức.

## Giai đoạn A — phần thêm sau đối chiếu

| # | Việc | Phụ thuộc | Vì sao đứng ở đây |
| --- | --- | --- | --- |
| 1 | **A-01 Agent runtime** (UNI-447) + toàn bộ mô hình ADR 0017 | C-11, C-14 | Bảng execution chung, bảng nối nguồn gốc, hai cổng duyệt, node thực thi vào đồ thị |
| 2 | **A-02 Sổ công cụ + policy rủi ro** (UNI-448) | A-01 | |
| 3 | **A-12 Bộ não AI** | A-01, A-02 | Là bề mặt hợp nhất; ra trước thì màn hình rỗng |
| 4 | **A-05 Insights** (UNI-451) | — | Chạy song song được; thu hẹp về home brief, dashboard inline, kéo thả/kích thước card, lịch sử bố cục |
| 5 | **A-11 CEO Command Center** | A-01, A-05 | Cần số người↔AI đối xứng từ A-01 mới có nghĩa |

**A-11 — bốn lát:** tổng quan theo kỳ có so kỳ trước và drill-down · giao ban thực tế ·
theo dõi đề xuất và việc + lịch sử KPI · báo cáo bộ phận + xuất tệp + job nền.

**A-11 chỉ hiện số đo thật**: giờ họp thật, giờ AI thật, số việc, số kết quả được duyệt.
Muốn quy ra giờ hay tiền của người thì tổ chức tự đặt đơn giá trong Cài đặt, và con số
hiện kèm đúng công thức họ đã đặt. Không có hằng số quy đổi nào chôn trong mã. Không
dựng số doanh thu.

**A-09** chỉ đổi tên thành "Bán công việc"; giữ nguyên P2 và điều kiện cohort PROVEN.

## Phụ thuộc hạ tầng

Runtime Office đã chọn (service nội bộ + sidecar native của engine, ADR 0021) phải có mặt trong bộ cài **E-01 on-premise** — compose và Helm.
Bỏ sót là lỗi phát hành, không phải giới hạn đã biết.

## Cố ý không làm trong đợt này

Ghi lại để lần sau không phải khảo sát lại; lý do đầy đủ ở `docs/DRAFT_MAPPING.md` và
`docs/roadmap/OPEN_QUESTIONS.md`.

| Việc | Vì sao |
| --- | --- |
| Nhập Excel nhân sự/bộ phận/lịch họp; màn quản lý lịch họp cấp tổ chức | Mời thành viên và CSV danh bạ của F-03 đã đủ; chờ pilot thật yêu cầu |
| Ngôn ngữ `id`, `ms` | Chờ nhu cầu thật ở thị trường đó; mỗi ngôn ngữ là một món nợ dịch thuật |
| Chia sẻ bản đồ công việc bằng liên kết ngoài | Làm nền C-11 trước; tính sau khi biết pilot có cần khoe đồ thị cho khách |
| PWA | ADR 0011 giữ nguyên: mobile là app Expo |
| Engine XLSX, PPTX, PDF ngoài phạm vi đợt DOCX ban đầu | Quyết định cũ (ADR 0018, chỉ DOCX) đã bị thay bởi ADR 0021 (`adr/0021-runtime-engine-office-da-dinh-dang.md`): sáu định dạng lõi nằm trong phạm vi, mỗi thao tác có runtime theo bảng DOC-004; việc chưa chứng minh ghi thành blocker + tên test |
| Chấm công | Không dựng số giờ người bằng ước tính; xem A-11 |
| Job AI tự đào tạo lại hằng ngày | Là năng lực thật, không núp trong task về màn hình; quyết sau khi có A-01 |

## Việc kế tiếp

Viết spec **C-14 Kết quả công việc** theo `docs/engineering/FEATURE_WORKFLOW.md`, kèm
phần bổ sung cho spec C-01 mà ADR 0016 yêu cầu.
