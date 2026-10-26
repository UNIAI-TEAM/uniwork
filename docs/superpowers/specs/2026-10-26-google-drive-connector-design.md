# Connector Google Drive — liên kết tài liệu Drive vào việc, UNI đọc và đề xuất việc

> **Trạng thái:** in-progress — người dùng ký duyệt 2026-10-26 13:33 (UTC+7); đang triển khai theo plan, thẻ là sub-issue của UNI-2172.

**Ngày:** 2026-10-26
**Issue:** UNI-2172 (con của UNI-923). Spec nguồn của người dùng: "1244 — Cho phép kết nối dữ liệu Google Drive vào hệ thống để sử dụng tài liệu đã lưu trữ" (không phải UniAI UNI-1244).
**Prototype đã duyệt:** artifact Q7Zh3Fx5vEjiGFhFbcDGJ6; nguồn đọc được ở thư mục run `briefs/drive-connector-prototype/` (13 artboard, 4 hàng). Mã màn hình trong spec này (1.1 … 4.2) là tiêu đề artboard trong `canvas.json`.
**ADR mới (bản nháp):** `docs/adr/drafts/0038-google-drive-chi-tham-chieu-doc-bang-ket-noi-cua-chinh-nguoi-dung.md` (§12).
**Liên quan:** ADR 0007 (actor), 0008 (tenant), 0009/0012 (audit + outbox), 0010 (đề xuất → xác nhận → thực thi), 0016 (Documents là kho duy nhất), 0031/0033 (OAuth, MCP — phép so sánh), 0035 (bộ tải chặn SSRF). Plan: `docs/superpowers/plans/2026-10-26-google-drive-connector.md`.

---

## 0. Điểm đã chốt (người dùng ký duyệt 2026-10-26)

Người dùng trả lời drive-spec:1 ngày 2026-10-26 (qua Advisor, hai đợt): **mọi điểm Q1–Q11 đã chốt** — Q1, Q2, Q3, Q6, Q8 khác đề xuất cũ, Q5 thêm yêu cầu; spec dưới đây đã sửa theo. Không còn điểm mở nào. Ký duyệt 2026-10-26 13:33 (UTC+7): luồng chính được duyệt qua các câu trả lời Q1–Q11; dòng xác nhận "Tên tệp sẽ hiện cho người xem được việc này" khi gắn tệp Drive chưa chia sẻ vào việc (§7.1) **giữ lại**.

| # | Câu hỏi | Đã chốt | Ghi chú | Mục |
| --- | --- | --- | --- | --- |
| Q1 | Giới hạn tên miền Google khi kết nối (QĐ 13) | **Chốt: không giới hạn, không có tùy chọn admin.** Mọi tài khoản Google Drive kết nối được; bỏ cài đặt. | Người dùng chốt 2026-10-26. | §5.4 |
| Q2 | Một tài khoản Google cho nhiều người UniWork | **Chốt: cho phép, không chặn, không công tắc.** Mỗi người UniWork vẫn có kết nối riêng; audit ghi cả hai danh tính (người UniWork + email và `sub` Google). | Người dùng chốt 2026-10-26. | §5.5 |
| Q3 | Trích đoạn và lô đề xuất | **Chốt:** trích đoạn đã thành một phần mô tả việc thì **ở lại** cùng việc (không bao giờ bị xóa theo lô); **không có cảnh báo riêng tư** — bỏ cảnh báo ở hộp duyệt, bỏ tùy chọn "Bỏ trích đoạn, chỉ giữ liên kết", bỏ ghi chú dưới mô tả việc (QĐ 11 bị thay). Dọn lô chưa tạo/đã hủy như đề xuất: `items` đặt NULL khi tạo hoặc hủy, lô không ai xử lý xóa cứng sau 7 ngày (job mỗi giờ). | Người dùng chốt 2026-10-26. | §8.4–8.6 |
| Q4 | Kiểu đính kèm mới hay danh sách tham chiếu Drive riêng (QĐ 8) | **Chốt:** giao diện theo đúng thiết kế đã duyệt (menu đính kèm "Tải tệp lên" / "Từ Google Drive", thẻ Drive trong mục Đính kèm, prototype 2.1/2.3); phía server là danh sách riêng `drive_file_task_links`, vẽ trong cùng khối "Đính kèm". | `attachments` là blob (`object_key`, `/content`, `/download`); thêm kiểu không có byte làm mọi đường đó phải rẽ nhánh. | §7.3 |
| Q5 | Endpoint riêng "tài liệu → đề xuất việc" (QĐ 9) | **Chốt: endpoint riêng**, theo mẫu `meeting_summary_tasks.go`, **cộng**: tài liệu hiện đã có việc được tạo từ nó chưa (trạng thái + liên kết tới các việc/lần tạo), và cảnh báo trước khi tạo lại. | Người dùng chốt 2026-10-26. | §8, §8.8 |
| Q6 | Ai thấy tham chiếu Drive | **Chốt (đổi): mỗi người chỉ thấy tham chiếu Drive của chính mình** ở nút Google Drive của Tài liệu (không có danh sách cấp workspace, bỏ "Người khác liên kết"); tệp Drive gắn vào việc hiện dạng thẻ (không bao giờ nội dung) cho **ai xem được việc**. Luật chính xác ở §7.6a. | Người dùng chốt 2026-10-26. | §7.6, §7.6a |
| Q7 | Dòng "Hùng đã mở qua UniWork" ở 4.2 | **Chốt: bỏ ở v1**: mở tệp không đổi trạng thái nghiệp vụ nên không có dòng audit (ADR 0012); hoạt động ở 4.2 chỉ gồm liên kết, bỏ liên kết, gắn vào việc, tạo việc từ đề xuất, đổi tài khoản gắn. | Người dùng đồng ý. | §7.7 |
| Q9 | Thông tin quản lý 4.2 trên desktop (QĐ 15 nói "panel chi tiết Tài liệu sẵn có") | **Chốt.** Màn Tài liệu của app (`DocumentsHome.tsx`) **chưa có** panel chi tiết; panel duy nhất là `UniworkDocInfoPanel` của hộp Mở (`UniworkOpenDialog.tsx:976-980`). Đề xuất: thêm panel bên phải vào DocumentsHome cho dòng Drive, dựng theo bố cục của `UniworkDocInfoPanel`; không làm trang riêng. | Giữ ý QĐ 15 (không có trang riêng) mà không chế một kiểu panel thứ hai. | §17.3 |
| Q10 | Hỏi UNI về tệp Drive: có lưu cuộc trò chuyện không | **Chốt: không lưu**: hội thoại có tệp Drive làm ngữ cảnh chỉ sống trong panel; câu trả lời và trích dẫn không vào lịch sử Hỏi UNI. Muốn lưu như mọi hội thoại khác thì cần chấp nhận một ngoại lệ lưu nội dung (sửa NFR-03 thêm một lần). | QĐ 2 nói không lưu nội dung tài liệu; câu trả lời của UNI có thể chép lại cả đoạn dài. | §9 |
| Q11 | Liên kết tệp Drive vào **dự án** (prototype 1.1 "việc và dự án", 1.3, 4.1 "Đang dùng ở: Dự án…") | **Chốt: v1 chỉ liên kết vào việc** (QĐ 8 chỉ nêu việc). Chữ 1.1/1.3 đổi thành "…vào việc"; 4.1 "Đang dùng ở" chỉ liệt kê việc; hộp duyệt mặc định dự án của việc đang mở. Dự án là phần sau. | Liên kết dự án cần thẻ trên trang dự án, quyền theo dự án và một bảng liên kết nữa; không có trong QĐ nào. | §3, §7.6, §8.4 |
| Q8 | Định dạng UNI đọc được ở v1 | **Chốt:** Google Docs, Sheets (trang tính đầu), Slides, PDF, `text/plain`, `text/markdown` **và DOCX, XLSX, PPTX lưu trên Drive**: tải bằng kết nối của chính người yêu cầu rồi trích văn bản qua office-engine sẵn có (client `server/internal/office`). Định dạng khác: "UNI chưa đọc được định dạng này". | Người dùng chốt 2026-10-26. | §8.3, §8.3a |

---

## 1. Mục tiêu

Người dùng kết nối một hoặc nhiều tài khoản Google Drive, chọn từng tệp bằng Google Picker và liên kết vào việc. UniWork **chỉ lưu tham chiếu**; xem nội dung là mở trên Google. Mục đích chính (QĐ 1): **UNI đọc tài liệu đã liên kết, đề xuất danh sách việc, người duyệt, rồi việc được tạo**.

**Tiêu chí thành công**

1. Minh kết nối `uni-work1@gmail.com` từ Cài đặt › Tích hợp (1.1 → 1.2 → 1.3); consent của Google chỉ xin `drive.file`.
2. Minh tạo việc, bấm kẹp giấy › "Từ Google Drive", chọn "Kế hoạch ra mắt Q4" (2.1 → 2.2); thẻ Drive hiện ở mục Đính kèm của việc (2.3) với tài khoản gắn.
3. Minh chuyển sang agent, gửi tệp đó cho UNI (3.1); hộp duyệt (3.3) hiện 4 việc với căn cứ "UNI · …"; Minh sửa nếu cần rồi bấm tạo (trích đoạn ở lại trong mô tả việc); 4 việc mới là sub-task của UNI-1042, hiện ở mọi kiểu xem và toast nói đúng số (3.4).
4. Mai (được giao) mở UNI-1052: thấy tên tài liệu, trạng thái "chưa cho UniWork đọc" (không phải "bị từ chối"), bấm "Cho UniWork đọc tệp" → Picker mở sẵn đúng tệp → sau đó UNI đọc bằng tài khoản của Mai (2.4).
5. Không có đường nào dùng kết nối của Minh để đọc tệp cho Mai; không có đường nào chia sẻ tệp trên Drive.
6. Tài liệu › Google Drive (4.1) chỉ liệt kê tệp Drive của chính người xem (theo tài khoản); ai xem được UNI-1042 thấy thẻ Drive trên việc đó; trang 4.2 cho biết đã có việc nào được tạo từ tài liệu và bỏ liên kết khỏi mọi việc mà tệp trên Drive giữ nguyên.
7. Thu hồi trên Google → tệp gắn tài khoản đó hiện "Mất kết nối · kết nối lại", không tự đổi sang tài khoản khác.
8. Trên app desktop, Minh thấy cùng nút Google Drive và cùng danh sách; "Mở trên Google Drive" mở trình duyệt hệ thống đúng tài khoản; "Thêm từ Google Drive" mở web ở Picker; khi offline nút Drive báo cần mạng thay vì hiện danh sách cũ (§17).
9. Không người của tổ chức B đọc, liên kết hay đề xuất từ tham chiếu của tổ chức A (`TestIsolationMatrix`).

## 2. Quyết định đã chốt (người dùng, 2026-10-26)

| # | Chủ đề | Quyết định |
| --- | --- | --- |
| 1 | Mục đích | UNI đọc tài liệu đã liên kết → đề xuất việc → người duyệt → tạo việc. Đọc cần consent Google của người dùng. **Thay NFR-03 của spec nguồn** (§2.1). |
| 2 | Lưu gì | Chỉ tham chiếu. Không lưu nội dung. Không có trình xem trong app; xem = mở trên Google với `authuser=<tài khoản gắn>`. |
| 3 | Scope | `drive.file` + Google Picker, từng tệp. Liên kết thư mục để sau (cần `drive.readonly`, restricted scope, CASA hằng năm). Kiểm trên tài khoản thử xem chọn thư mục có cấp quyền cho con dưới `drive.file` không (spike S1). |
| 4 | Nhiều tài khoản | Mỗi tệp gắn với kết nối đã chọn nó; mở, đọc, gọi AI dùng đúng kết nối đó. Không lặng lẽ chuyển tài khoản. Chọn lại từ tài khoản khác → khử trùng theo id tệp Drive ("đã có trong Drive: <tài khoản>"). Kết nối hết hạn/bị thu hồi → "kết nối lại". Tài khoản mất quyền với tệp → "liên kết lại bằng tài khoản khác" là thao tác rõ ràng. |
| 5 | Thành viên khác | Không bao giờ dùng kết nối của người khác. Mỗi người đọc bằng kết nối của mình; "Cho UniWork đọc tệp" mở Picker chọn sẵn tệp (`setFileIds`, spike S2). Không có kết nối → trạng thái "chưa rõ", không phải "bị từ chối". Không tự chia sẻ trên Drive. |
| 6 | AI sửa tài liệu Drive | Để sau, ngoài phase này. |
| 7 | Menu Tài liệu | Nút **Google Drive** cùng cấp "Thư mục của tôi", chỉ hiện khi có kết nối; con: "Drive: <email>" (kèm số) cho từng tài khoản, và "Người khác liên kết". Danh sách cấp workspace, mỗi dòng ghi tài khoản gắn. Trang 4.2 chỉ quản lý. **Sửa bởi Q6 (2026-10-26):** danh sách chỉ gồm tệp của chính người xem, bỏ "Người khác liên kết" (§7.6). |
| 8 | Việc | Hộp tạo việc: kẹp giấy mở menu "Tải tệp lên" / "Từ Google Drive" (mục hai chỉ khi đã kết nối); dán URL Drive vào mô tả được nhận ra. Chi tiết việc › Đính kèm › "Thêm tệp" có "Từ Google Drive". Thẻ Drive: Mở trên Google Drive, Tạo việc từ tài liệu, Hỏi UNI, ⋯ (Xem trong Tài liệu, Bỏ liên kết). |
| 9 | Agent mode | "Chuyển sang agent" → prompt + tệp Drive → "Gửi cho agent" → hộp duyệt 3.3. |
| 10 | Hộp duyệt | Trường cả lô: Dự án, Task cha, Trạng thái. Mỗi việc: tiêu đề, người phụ trách, độ ưu tiên, ngày bắt đầu, hạn, nhãn (chỉ nhãn có sẵn), mô tả (mục tiêu, checklist, trích đoạn + liên kết); "Bị chặn bởi" giữa các việc đề xuất; kiểm trùng với việc đang mở. Trường UNI điền có căn cứ "UNI · …"; không chắc thì để trống. Không có thuộc tính tùy chỉnh, đính kèm, stage. |
| 11 | Riêng tư | ~~Hộp duyệt cảnh báo trích đoạn, có "bỏ trích đoạn, chỉ giữ liên kết", trang việc có ghi chú~~ — **thay bởi Q3 (2026-10-26):** trích đoạn trong mô tả việc ở lại như nội dung việc bình thường; không cảnh báo, không tùy chọn bỏ, không ghi chú. |
| 12 | Việc đã tạo | Là việc bình thường ở mọi kiểu xem; toast "Đã tạo N việc từ <tài liệu>, là sub-task của <cha>". |
| 13 | Tài khoản Google ≠ tài khoản UniWork | ~~Tùy chọn admin giới hạn tên miền; một tài khoản Google dùng chung bị chặn mặc định~~ — **sửa bởi Q1, Q2 (2026-10-26):** không giới hạn miền, cho phép một tài khoản Google cho nhiều người, không có cài đặt nào; trình duyệt đăng nhập tài khoản khác → `authuser`; admin Google Workspace chặn app → lỗi rõ ràng, không đẩy sang Gmail cá nhân; audit ghi cả người UniWork và email Google. |
| 15 | App desktop (`uniwork-office`, bổ sung 11:45–11:55) | Trong phạm vi, ra cùng đợt với web. Sidebar Tài liệu của app có cùng nút **Google Drive** (con theo tài khoản; "Người khác liên kết" bỏ theo Q6), chỉ khi có kết nối; danh sách, lọc theo tài khoản, mất kết nối + kết nối lại, bỏ liên kết qua cùng API UniWork; thông tin 4.2 ở panel chi tiết, không trang riêng. Khác web: "Mở trên Google Drive" → trình duyệt hệ thống (`authuser`); "Thêm từ Google Drive", kết nối, "Tạo việc từ tài liệu", "Hỏi UNI" chuyển sang trình duyệt/web; chỉ online, không vào thư viện offline; app không giữ token Google (ADR 0034); i18n 21 ngôn ngữ của app; plan tách nhiệm vụ app cho lane fork. |
| 14 | Xác minh | `drive.file` chỉ cần brand verification (vài phút đến 2–3 ngày làm việc). Restricted scope: nhiều tuần + CASA hằng năm. |

### 2.1 Sửa đổi NFR-03 của spec nguồn

Spec nguồn ghi "NFR-03: không gửi nội dung Drive riêng tư cho AI". Người dùng thay bằng:

> **NFR-03 (sửa 2026-10-26):** UNI chỉ đọc nội dung một tệp Drive khi (a) người yêu cầu tự kết nối tài khoản Google của mình và đã cấp cho UniWork quyền với đúng tệp đó (consent `drive.file` + Picker), và (b) người đó chủ động yêu cầu (Gửi cho agent, Tạo việc từ tài liệu, Hỏi UNI). Nội dung đi qua `ai.Gateway` tới nhà cung cấp AI đã cấu hình, không được lưu trong UniWork, trừ trích đoạn (≤ 300 ký tự mỗi việc) nằm trong mô tả việc người duyệt đã tạo — phần đó là nội dung việc, theo vòng đời của việc (Q3). Tệp Office được trích văn bản trong office-engine chỉ cho một lượt đọc, không ghi ra kho (§8.3a).

Ngoài phạm vi vẫn như spec nguồn: tự cấp quyền trên Drive, ghi ngược lên Drive. OPEN-04 (không chuyển định dạng) giữ nguyên: UniWork không lưu, không chuyển tệp Drive; việc xuất văn bản ở §8.3 chỉ diễn ra trong bộ nhớ cho một lượt đọc.

## 3. Phạm vi

**Trong phạm vi:** app desktop `uniwork-office` theo QĐ 15 (§17); kết nối/ngắt/kết nối lại nhiều tài khoản Google mỗi người; Picker; tham chiếu tệp trong workspace gắn kết nối, mỗi người thấy tệp của mình và thẻ trên việc mình xem được (Q6); liên kết tệp với việc (hộp tạo việc, chi tiết việc, dán URL); trạng thái quyền theo từng người xem; endpoint đề xuất việc + hộp duyệt + tạo lô; Hỏi UNI với tệp Drive (3.2); trạng thái "đã tạo việc từ tài liệu" + cảnh báo tạo lại (Q5); menu Tài liệu › Google Drive (4.1, 4.2); flag, audit, outbox, isolation.

**Ngoài phạm vi:** liên kết thư mục (QĐ 3); AI sửa tài liệu (QĐ 6); trình xem trong app (QĐ 2); chia sẻ trên Drive (QĐ 5); liên kết tệp Drive vào dự án (Q11), cuộc họp, chat; runtime agent chung A-01; định dạng ngoài §8.3 (ảnh, ODT, tệp cũ .doc/.xls/.ppt…) cho UNI; Microsoft OneDrive; chính sách tổ chức cho Drive (Q1, Q2: không có); danh sách tệp Drive cấp workspace (Q6); "bỏ khỏi danh sách của tôi" mà không bỏ liên kết cả tệp.

## 4. Hiện trạng (đối chiếu mã 2026-10-26, nhánh `feature/UNI-2172-drive-connector-spec` từ `ba31cc20f`)

| Chủ đề | Hiện có | Hệ quả cho Drive |
| --- | --- | --- |
| OAuth Google theo tài khoản | Email Hub: `StartOAuth` sinh nonce + PKCE, niêm phong state bằng secretbox (`server/internal/service/email_hub_oauth_flow.go:37-76`); `CompleteOAuth` so nonce cookie, đổi code bằng verifier, đọc email từ id_token (`email_hub_oauth_callback.go:45-155`); callback ngoài nhóm có phiên nhưng vẫn đăng ký qua wrapper `api` (`apiOp`, HTML, limiter credential), trả trang HTML `postMessage` cho cửa sổ mở (`handler/router/email_hub.go:205-216`). Calendar: luồng Google gần nhất về hình dạng (`service/calendar_connections.go:58-101`, gọi REST googleapis trực tiếp `:465`, `:496`). | Sao chép mẫu Email Hub (nonce cookie, PKCE, state niêm phong, popup). Không có `google.golang.org/api` (`server/go.mod:41` chỉ có `golang.org/x/oauth2`): gọi Drive REST bằng `net/http` như Calendar. |
| Mã hóa token | `internal/util/secretbox` AES-256-GCM (`secretbox.go:47-94`), mỗi tính năng một khóa env (`EMAIL_HUB_CREDENTIAL_KEY`, `CALENDAR_CREDENTIAL_KEY`; `cmd/server/main.go:656-679`). | Khóa riêng `DRIVE_CREDENTIAL_KEY`. |
| Refresh + thu hồi | `oauthAccessToken` làm mới khi còn < 2 phút, khóa theo tài khoản, ghi có điều kiện theo `credential_version` (`email_hub_oauth_refresh.go:19-101`); `invalid_grant` → `markAuthFailed` + audit + `needs_reconnect` (`:111-128`, `email_hub_watcher.go:271`). | Dùng lại đúng mẫu; trạng thái "Mất kết nối". |
| Bảng kết nối | `email_hub_accounts` (theo user + tổ chức, nhiều tài khoản; `migrations/200_…`, `9991791700000001_…`); `calendar_connections` (theo workspace; `migrations/978_…`). | Bảng mới `drive_connections` theo **user + tổ chức** (§6.1). |
| Đề xuất → tạo việc | `CreateTasksFromSummary` (`service/meeting_summary_tasks.go:195`): người chọn mục, `TaskService.CreateManyWith` (`service/task.go:390`) trong một transaction, hook `Before` khóa và kiểm (`:274`), `After` ghi liên kết + audit (`:330`); chặn trùng theo lô `refuseSummaryDuplicates` (`:381-441`). Email: `CreateTasksFromThreadSummary` (`service/email_hub_ai.go:153`). | Endpoint tạo lô dùng `CreateManyWith` với hook tương tự (§8.5). |
| Chặn trùng tiêu đề | `guardActiveDuplicateTask` + advisory lock (`service/task.go:627-683`), `FindActiveDuplicateTask` so tiêu đề chuẩn hóa, cùng dự án và cha, việc chưa xong (`pkg/db/queries/tasks.sql:342-352`); 409 `active_duplicate_task`. | Hộp duyệt hiện "Có thể trùng với …" từ cùng truy vấn (§8.4). |
| Phụ thuộc | `task_dependencies` (`blocks`/`blocked_by`/`related`; `migrations/109_task_relations.up.sql:10`), `TaskService.SetDependency` có kiểm vòng (`service/task_graph.go:236`, `:398`). | "Bị chặn bởi" ghi trong hook `After` của lô. |
| Nhãn | `task_labels` + `task_label_links` (`migrations/108_…:21`, `109_…:1`). | UNI chỉ được chọn id nhãn có sẵn. |
| Tạo việc | `CreateTaskSDI` (`handler/dto/sdi/task.go:9-26`): title, description, status, priority, assignee, start/due, project_id, parent_task_id, label_ids, attachment_ids, allow_duplicate. | Mỗi mục đề xuất ánh xạ vào `CreateTaskInput`. |
| Đính kèm việc | Bảng `attachments` là blob (`object_key`, `object_url`; `migrations/110_task_collaboration.up.sql:56-75`); route list/upload/content/download/delete (`handler/router/tasks.go:440-464`). Mục "Đính kèm" (`packages/views/tasks/detail/components/attachments-section.tsx:40`) **không có nút "Thêm tệp"** — khóa `tasks.detail.attachments_upload` có trong `vi.json:2781` nhưng chưa dùng; mục trả `null` khi rỗng (`:70`). | Phải thêm nút "Thêm tệp" (menu) và cho mục hiện khi có tệp Drive (§7.3). |
| Hộp tạo việc | `create-task-dialog.tsx:29` (`manual`/`agent`); kẹp giấy `FileUploadButton` (`create-task-manual-panel.tsx:313`); editor dùng Tiptap Link `autolink`, `linkOnPaste` (`packages/views/editor/extensions/index.ts:69-72`), không có unfurl. Agent panel luôn `toast.error(t("tasks.create.agent_unavailable"))` (`create-task-agent-panel.tsx:171-175`); capability `tasks.agent_runs` Unavailable (`server/internal/workcapability/catalogue.go:34`). | Kẹp giấy thành menu; agent panel gửi tới endpoint đề xuất khi có tệp Drive (§8.1). |
| Documents | `documents` (`migrations/948_documents.up.sql:8-46`, `kind` page/file; `folder` thêm ở `9991791776514761_documents_kind_folder.up.sql:9-11`), không có cột `source` chung; "nguồn khác" là `SOURCE_KINDS = ["chat","meeting","email","task"]` (`packages/views/documents/documents-sidebar.tsx:35`) qua `GET /workspaces/{ws}/documents/sources` (`handler/router/document_sources.go:17-20`). "Thư mục của tôi" ở sidebar `:208-214`. | Tham chiếu Drive **không** là dòng `documents` (§6.4, ADR nháp 0038); nút Google Drive là mục sidebar riêng. |
| ai.Gateway | `Gateway.Complete` (`server/internal/ai/gateway.go:226`); `Request.Sources` cho cột audit, `Attachments` cho media part (PDF), `OutputSchema` của prompt cho JSON (`prompt.go:63`); capability là enum đóng có policy (`ai/policy.go:12-70`); prompt `name@N` (`ai/prompts.go:10-19`). `internal/ai` chỉ gọi query `Ai*` (`internal/arch_test.go:289-301`). | Capability mới `drive_task_proposals`, prompt `drive_task_proposals@1` (§8.2). |
| Hỏi UNI | Focus của panel (`packages/core/ai/store.ts:3-9`, `useAskUniOpener`); ngữ cảnh focus ở `service/askuni_context.go`; đường agent sau flag `ask_uni_agent` mặc định tắt (`featureflags/keys.go:72`) với tool đọc `get_document` (`service/askuni_agent_tools.go:174`); gateway không nhận media ở lượt trả kết quả công cụ (`ai/gateway.go:486-491`); câu trả lời được lưu (`service/askuni.go:609-636`). | Focus mới `drive_file`, nạp nội dung ở lượt đầu, hội thoại không lưu (§9, Q10). |
| Flag | `featureflags.Flag{Key, Description, Default, Public, Owner, ReviewAt}` (`server/internal/featureflags/keys.go:18-33`), ví dụ `mcp_connector_write` `:71`. | Flag `drive_connector` (§10). |
| Tích hợp (UI) | Tab workspace `integrations` (`packages/views/settings/components/settings-page.tsx:130`, `integrations-tab.tsx:34-74`); hàng Email Hub; popup OAuth chung `packages/views/integrations/use-oauth-popup.ts`. | Hàng Google Drive ở cùng tab; dùng lại `use-oauth-popup`. |
| Realtime | `document.*` vô hiệu `documentKeys.workspace(wsId)` (`packages/core/realtime/document-events.ts`, `use-realtime-sync.ts:120-122`); sự kiện theo user như `email_hub.inbox_changed` (`server/internal/outbox/catalogue.go:156`). | Sự kiện `drive_file.*` scope workspace, `drive_connection.changed` scope user (§11). |
| Isolation | `TestIsolationMatrix` (`server/internal/handler/isolation_matrix_test.go:42`), `isoRoutes` (`isolation_routes_test.go:417`, callback Email Hub `:483` là `isoPublic`/`reasonProvider`), `isoReferences` (`isolation_references_test.go:144`), `isoUnseeded` (`isolation_matrix_test.go:1283`). | Mỗi route và bảng mới có dòng (§13). |

## 5. Kết nối Google Drive (hàng 1)

### 5.1 OAuth client và scope

- Một OAuth client Google **riêng** cho Drive (`GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`), không dùng lại client đăng nhập hay Email Hub: brand verification của `drive.file` không kéo theo `mail.google.com` (restricted) và ngược lại.
- Scope: `openid email https://www.googleapis.com/auth/drive.file`. Không bao giờ `drive.readonly` ở phase này.
- Picker cần thêm `GOOGLE_DRIVE_PICKER_API_KEY` (developer key giới hạn theo HTTP referrer) và `GOOGLE_DRIVE_APP_ID` (project number). Bốn biến vào `.env.example` (`scripts/env-example.test.mjs`). Provider bật khi đủ cả client id, secret và `DRIVE_CREDENTIAL_KEY` — như `email_hub_oauth.go:55`.
- Redirect: `{API_PUBLIC_URL}/api/v1/drive-connections/google/callback`.

### 5.2 Luồng

1. 1.1: Cài đặt › Tích hợp, hàng **Google Drive** ("Chưa kết nối", nhãn "Mới"), nút "Kết nối Google Drive". Hàng chỉ hiện khi flag `drive_connector` bật và server báo provider sẵn sàng.
2. `POST /api/v1/workspaces/{workspaceID}/drive-connections/google/start` `{reconnect_connection_id?}` (rate limit như `connectLimit` của Email Hub) → URL consent; cookie HttpOnly nonce trên path callback. Tổ chức lấy từ workspace qua `RequireMember`, như Email Hub (`email_hub_oauth_flow.go:37-60`) — phiên không mang tổ chức, và tài khoản cũ thuộc hai tổ chức vẫn tồn tại (ADR 0032). State niêm phong gồm user, tổ chức, workspace, nonce cookie, nonce OIDC, verifier, hạn 10 phút; khi kết nối lại thêm `target_connection_id` và `expected_sub`, và gửi `login_hint`.
3. 1.2: Google consent chỉ xin `drive.file`. Bản prototype có hai dòng giải thích dưới câu của Google; những dòng đó do UniWork viết ở 1.1 và 1.3, không nằm trong màn của Google.
4. Callback: so nonce cookie (`subtle.ConstantTimeCompare`), kiểm lại membership tổ chức qua workspace trong state, đổi code với verifier. **Xác minh id_token** bằng verifier OIDC như đăng nhập Google (`server/internal/auth/google.go:24-73`, `go-oidc` đã có ở `server/go.mod:13`): issuer Google, audience = `GOOGLE_DRIVE_CLIENT_ID`, chưa hết hạn, `nonce` khớp nonce OIDC trong state, `sub` khác rỗng, `email_verified = true`. **Kiểm scope đã cấp**: phản hồi token phải chứa `https://www.googleapis.com/auth/drive.file` (người dùng có thể bỏ tick) — thiếu thì `scope_not_granted`, không lưu gì. Kết nối lại mà `sub` trả về khác `expected_sub` → `account_mismatch` (không gắn lại, không tạo dòng mới; Google không bảo đảm theo `login_hint`, `email_hub_oauth_callback.go:38-43`). Không kiểm tên miền (§5.4) hay tài khoản dùng chung (§5.5); mã hóa token; lưu theo §5.3. Không có refresh token → `consent_required` (giống Email Hub).
5. 1.3: "Đã kết nối Google Drive", thẻ tài khoản (email, giờ kết nối, "Đang hoạt động"), phạm vi quyền "Chỉ tệp bạn chọn", số tài liệu đã liên kết, "UniWork lưu: Chỉ liên kết", khối "UNI được làm gì", "Ngắt kết nối".

Mã kết quả callback (popup gửi `{type:"uniwork:drive-oauth", ok, code}`): `connected`, `reconnected`, `consent_required`, `scope_not_granted`, `account_mismatch`, `state_invalid`, `retry_connect`, `blocked_by_workspace_admin`, `access_denied`, `provider_error`. Mỗi mã có một câu tiếng Việt ở UI (§7.9).

### 5.3 Nhiều tài khoản, kết nối lại, ngắt

- Một người có nhiều dòng `drive_connections` trong tổ chức, **một dòng cho mỗi (tổ chức, người, `google_sub`) ở mọi trạng thái** (unique không điều kiện, §6.1). Callback khóa dòng `(organization_id, user_id, google_sub)` `FOR UPDATE`; có dòng (kể cả đã ngắt) thì **hồi sinh cùng dòng** (giữ id nên `drive_files`/`drive_file_access` không mất), xóa `disconnected_at`, `auth_failed_at`, tăng `credential_version`; không có thì chèn.
- **Không thu hồi token khi thay.** Quyền Google gắn với (tài khoản Google, OAuth client), không với từng token: thu hồi token cũ sau khi kết nối lại cùng `sub` sẽ thu hồi luôn quyền vừa cấp. Token bị thay chỉ bị ghi đè; người thua cuộc đua refresh bị bỏ, không thu hồi — đúng như Email Hub (`email_hub_oauth_revoke.go:19-26`, `email_hub_oauth_refresh.go:97-101`).
- `invalid_grant`/`unauthorized_client` khi refresh → `auth_failed_at` + audit `drive_connection.auth_failed` + sự kiện `drive_connection.changed`; UI "Mất kết nối · kết nối lại". **Không** thử tài khoản khác của người đó (QĐ 4).
- Ngắt kết nối, trong một transaction: **chuyển** refresh token mã hóa sang hàng đợi thu hồi (§6.8) rồi xóa token khỏi kết nối, tăng `credential_version` (chặn mọi refresh đang chạy ghi lại), đặt `disconnected_at`, chuyển lô đề xuất `ready` dùng kết nối đó thành `discarded` (§8.6). Cùng transaction đó ghi (upsert theo `google_sub`) một yêu cầu thu hồi vào `drive_grant_revocations` kèm bản token đó. Thu hồi ở Google **chỉ xảy ra khi không còn dòng `drive_connections` sống nào khác có cùng `google_sub`** (trên mọi tổ chức, vì quyền gắn với cùng một OAuth client) — trường hợp có là khi nhiều người dùng chung một tài khoản Google (§5.5) hoặc tài khoản cũ đa tổ chức — và theo giao thức điều phối toàn cục §5.3b. Tham chiếu gắn kết nối đó ở lại, hiện "Mất kết nối · kết nối lại"; việc giữ thẻ Drive.
- Màn 1.3 liệt kê một thẻ cho mỗi tài khoản (email, trạng thái, "Ngắt kết nối") và nút **Kết nối thêm tài khoản** (cùng luồng popup, `prompt=consent select_account` để Google cho chọn tài khoản).
- Danh sách: `GET /api/v1/workspaces/{workspaceID}/drive-connections` — kết nối của người gọi trong tổ chức của workspace (email, trạng thái, số tệp đã liên kết, `connected_at`). Không trả token. Mọi route có `{driveConnectionID}` kiểm kết nối thuộc người gọi **và** tổ chức của workspace trong đường dẫn; sai thì 404.

### 5.3b Điều phối thu hồi và kết nối lại theo `google_sub`

Quyền Google thuộc (OAuth client Drive, `google_sub`), không thuộc một tổ chức, nên khóa cũng toàn cục:

- Khóa: advisory lock transaction trên `drive_grant:<google_sub>` (không kèm tổ chức); đây là khóa duy nhất theo `google_sub`.
- Một yêu cầu đi qua ba trạng thái: **chờ** (`attempt_id` rỗng), **đang thu hồi** (`attempt_id` có, `resolved_at` rỗng — kết quả ở Google coi như *có thể đã thu hồi*), **xong** (`resolved_at` có, token đã xóa khỏi hàng đợi). Mỗi lần ngắt ghi một **thế hệ** mới (`generation`); hai cột bằng chứng `last_attempt_started_at` và `last_resolved_at` không bao giờ bị xóa khi dòng được dùng lại.
- **Upsert khi ngắt** (cùng transaction ngắt, giữ khóa): không có dòng → chèn **chờ**, `generation = 1`; dòng **chờ** → thay token, `generation + 1`; dòng **xong** → về **chờ**: token mới, `generation + 1`, `attempt_id`/`attempt_started_at`/`resolved_at` = NULL, hai cột bằng chứng giữ nguyên; dòng **đang thu hồi** không thể gặp (lúc đó không còn chủ sống và callback bị từ chối, nên không có kết nối nào để ngắt) — nếu gặp thì lỗi có log, không ghi đè.
- **Bước thu hồi** (job lane provider, thử lại theo lịch, sống qua khởi động lại vì token nằm trong hàng đợi). Lane provider có nhiều worker và có thể giao lại một dòng khi handler cũ chưa xong (`server/internal/outbox/lane.go:60-65`, `outbox.go:265-289`), nên quyền sở hữu một lần thử là **lease theo dòng**, không dựa vào lane:
  1. Transaction 1, giữ khóa: nhận dòng chỉ khi nó **chờ**, hoặc **đang thu hồi** với lease đã hết (`attempt_started_at < now() - 2 phút`, dài hơn client 15 s + transaction 2). Dòng **chờ** → đếm lại chủ sống của `google_sub`; còn chủ → xóa dòng nếu chưa có bằng chứng, hoặc về trạng thái rỗng giữ bằng chứng (xóa token), không gọi Google; không còn → đặt `attempt_id` (ULID mới), `attempt_started_at = last_attempt_started_at = now()`, `attempts + 1`, commit. Dòng **đang thu hồi** hết lease → không đếm lại, chỉ cấp `attempt_id` mới và cập nhật hai mốc. Worker giữ `(generation, attempt_id)` vừa nhận.
  2. Ngoài transaction: giải mã token **chỉ để** gọi revoke của Google (client 15 s); token trong hàng đợi không bao giờ dùng để đọc API hay refresh (`TestDriveRevocationTokenOnlyRevokes`).
  3. Transaction 2, giữ khóa, `UPDATE … WHERE google_sub = $1 AND generation = $g AND attempt_id = $a`: Google trả thành công, hoặc 400 `invalid_token` (quyền đã mất) → `resolved_at = last_resolved_at = now()`, xóa token. Không dòng nào khớp → kết quả cũ, bỏ qua (không giải quyết, không xóa token của thế hệ sau). Lỗi mạng, timeout, 5xx, hoặc transaction 2 lỗi → giữ nguyên **đang thu hồi**; lease hết thì lần sau nhận lại. Sau 24 giờ thử không được → `resolved_at = last_resolved_at = now()`, xóa token, `last_error`, cảnh báo ops (`DriveRevocationAbandoned`, có runbook) — quyền có thể còn ở Google, người dùng vẫn gỡ được ở trang tài khoản Google.
  - Mọi lệnh ngắt hàng loạt (§5.3a) chỉ ghi yêu cầu, không tự gọi Google.
- **Callback** ghi `exchange_started_at` trước khi đổi code; sau khi xác minh id_token (đã biết `sub`), trong transaction lưu kết nối, lấy cùng khóa và đọc dòng của `sub`:
  - **đang thu hồi** → không lưu gì, không xóa gì, trả `retry_connect` ("Kết nối vừa bị ngắt ở nơi khác, hãy thử lại sau ít phút");
  - mọi trạng thái khác: `last_attempt_started_at` **hoặc** `last_resolved_at` **muộn hơn** `exchange_started_at` (một lần gọi Google bắt đầu hoặc kết thúc sau khi callback bắt đầu đổi code, ở bất kỳ thế hệ nào — lần thu hồi có thể đã được Google xử lý giữa hai mốc đó) → `retry_connect`;
  - còn lại: dòng **chờ** → về trạng thái rỗng (xóa token, giữ bằng chứng) và lưu; dòng **xong** hoặc không có dòng → lưu. Dòng không còn token giữ 1 ngày rồi xóa (state OAuth hết hạn sau 10 phút, §5.2, nên không callback nào cần bằng chứng cũ hơn).
- Vì callback không bao giờ xóa bằng chứng của một lần gọi Google đã bắt đầu và một kết quả chỉ ghi được vào đúng thế hệ và lần thử đã sinh ra nó, không thứ tự nào để một callback thành công còn lại kết nối sống với quyền đã bị thu hồi. Test (fake Google, cùng tổ chức và khác tổ chức): giữ bước thu hồi giữa lúc đếm và gọi Google rồi chạy callback; callback đổi code trước, thu hồi chen giữa; Google xử lý revoke rồi mất phản hồi; Google thành công rồi transaction 2 lỗi; worker commit lần thử (t1) → callback đổi code (t2) → Google xử lý revoke (t3) → worker ghi `last_resolved_at` (t4) → callback lấy khóa (t5) phải trả `retry_connect`; hai worker cùng một dòng (một kết quả đến trễ) rồi kết nối lại → ngắt lần nữa → worker thứ ba bị giữ: kết quả trễ không giải quyết thế hệ mới và callback sau đó bị từ chối; ngắt → khởi động lại tiến trình → worker thu hồi bằng token đã lưu; yêu cầu bị hủy khi còn chủ sống thì token bị xóa.

### 5.3a Vòng đời theo tài khoản UniWork

| Sự kiện | Kết nối Drive |
| --- | --- |
| Rời tổ chức, bị vô hiệu hóa | Ngắt mọi kết nối của người đó trong tổ chức (cùng transaction với lệnh membership), thu hồi theo luật trên; tham chiếu ở lại, admin liên kết lại được. Kích hoạt lại không tự nối lại. |
| Đóng tổ chức / chuyển tổ chức (`organization_close.go:19-47`, `closeQ` dùng chung cho chuyển tổ chức qua lời mời) | Trong transaction đóng: rào token và ngắt mọi kết nối, hủy lô `ready`; sau commit thu hồi các quyền không còn chủ sống — thêm vào phần dọn sau commit sẵn có (`:106-128`), không có job đóng riêng. |
| Xóa tài khoản | Như rời tổ chức, cho mọi tổ chức. |

### 5.4 Tên miền (QĐ 13, Q1 — chốt)

Không giới hạn tên miền và không có cài đặt nào: mọi tài khoản Google (Gmail cá nhân hay Google Workspace) kết nối được. Server không đọc `hd`. Admin Google Workspace phía khách hàng vẫn chặn được app ở phía Google (§5.7).

### 5.5 Một tài khoản Google, nhiều người UniWork (QĐ 13, Q2 — chốt)

- Cho phép, không chặn, không công tắc. Mỗi người UniWork có dòng `drive_connections` riêng (unique `(organization_id, user_id, google_sub)`), token riêng, ngắt riêng; quyền ở Google là chung (cùng `sub` + OAuth client) nên ngắt của một người không thu hồi khi người khác còn giữ (§5.3, §5.3b).
- Mọi lượt đọc vẫn đi qua `drive_file_access` của chính người yêu cầu (QĐ 5): người dùng UniWork khác nhau đọc bằng kết nối riêng của mình, dù kết nối đó trỏ cùng tài khoản Google.
- Audit ghi **cả hai danh tính**: actor là người UniWork; metadata có `google_email` và `google_sub` của kết nối liên quan (§11). Màn 1.3 không cảnh báo gì; thẻ tài khoản chỉ hiện email.

### 5.6 Trình duyệt đăng nhập tài khoản Google khác (QĐ 13)

- Mọi liên kết "Mở trên Google Drive" là `webViewLink` của Drive cộng `authuser=<email tài khoản gắn>` (Google chấp nhận email ở `authuser`). Người xem chưa đăng nhập tài khoản đó trong trình duyệt thì Google yêu cầu đăng nhập — UniWork không cố giải quyết thay.
- Picker mở bằng access token của kết nối được chọn, không phụ thuộc phiên Google của trình duyệt.

### 5.7 Admin Google Workspace chặn app (QĐ 13)

- Google trả `access_denied` kèm `admin_policy_enforced` (hoặc `org_internal`) ở callback, hoặc 403 lý do `domainPolicy` ở API. Server ánh xạ thành `blocked_by_workspace_admin`.

**Ánh xạ lỗi Drive API** (đọc `error.errors[].reason` trước mã HTTP; [hướng dẫn lỗi của Google](https://developers.google.com/workspace/drive/api/guides/handle-errors)):

| Lý do Google | Mã UniWork | Đổi trạng thái lưu? |
| --- | --- | --- |
| `appNotAuthorizedToFile` | `drive_grant_required` — người dùng chưa cấp tệp cho app; UI mở Picker `setFileIds` | Không |
| `domainPolicy` | `blocked_by_workspace_admin` | Không |
| `notFound` (404), `insufficientFilePermissions`, `forbidden` | `drive_file_not_accessible` | Có: `drive_file_access.state = lost` của người đó; với người liên kết qua kết nối gắn, thêm `drive_files.access_lost_at` |
| `rateLimitExceeded`, `userRateLimitExceeded` (403 hoặc 429), 5xx, timeout | `drive_unavailable` (thử lại sau) | Không |
| 401 / `authError` | refresh một lần; `invalid_grant` → `auth_failed` (§5.3) | Có, trên kết nối |

- UI: "Quản trị viên Google Workspace của tổ chức bạn chưa cho phép UniWork truy cập Google Drive. Hãy nhờ quản trị viên Google Workspace cho phép ứng dụng UniWork." Không có nút "dùng Gmail cá nhân". Spike S4 xác nhận hình dạng lỗi thật.

## 6. Mô hình dữ liệu

Mọi bảng: id ULID `TEXT`, `organization_id TEXT NOT NULL` (ADR 0008), không khóa ngoại (ADR 0001), mỗi index `CONCURRENTLY` một file, `created_by` đi cùng `created_by_kind` (ADR 0007). Tên cột theo `docs/conventions.md`.

### 6.1 `drive_connections`

| Cột | Ghi chú |
| --- | --- |
| `id`, `organization_id`, `user_id` | Kết nối là của **người** trong một tổ chức, dùng ở mọi workspace của tổ chức đó. |
| `provider` | `google` (CHECK), để ngỏ cho OneDrive sau. |
| `google_sub`, `google_email` | `sub` (từ id_token đã xác minh) là khóa thật; email để hiển thị và `authuser`. |
| `refresh_token_enc`, `access_token_enc`, `access_expires_at`, `credential_version` | secretbox `DRIVE_CREDENTIAL_KEY`; refresh fence theo mẫu Email Hub; ngắt kết nối tăng `credential_version`. |
| `scopes` | Scope Google đã cấp; luôn chứa `drive.file` (callback từ chối nếu thiếu, §5.2). |
| `auth_failed_at`, `auth_failed_reason` | "Mất kết nối". |
| `created_at`, `updated_at`, `disconnected_at` | |

Index: unique **không điều kiện** `(organization_id, user_id, google_sub)` — một danh tính ổn định, kết nối lại hồi sinh cùng dòng (§5.3); `(google_sub) WHERE disconnected_at IS NULL` cho kiểm "còn chủ sống không" trước khi thu hồi (§5.3). Không có `created_by` (dòng của chính người dùng; như `email_hub_accounts`).

### 6.2 `drive_files` — tham chiếu trong workspace (một dòng mỗi tệp, ai thấy gì ở §7.6a)

| Cột | Ghi chú |
| --- | --- |
| `id`, `organization_id`, `workspace_id` | |
| `external_file_id`, `drive_id` | Id tệp Drive; `drive_id` khi tệp nằm trong Bộ nhớ dùng chung. Unique một phần `(workspace_id, external_file_id) WHERE unlinked_at IS NULL` — khử trùng QĐ 4. |
| `connection_id`, `bound_by` | **Kết nối gắn** (QĐ 4) và chủ của nó: lúc liên kết là kết nối của người liên kết (`bound_by = created_by`); sau `/rebind` là kết nối **của người rebind** (`bound_by` = người đó). `connection_id` luôn thuộc `bound_by`; `created_by` không bao giờ đổi. Chỉ đổi qua `/rebind` (§7.7). **Mọi chỗ hiện tài khoản gắn theo `bound_by`**: thẻ Drive trên việc, trang 4.2 và panel desktop đều lấy tên của `bound_by` và email của `connection_id`; khi `bound_by ≠ created_by` thì kèm "(gắn lại bởi <tên>)". "Người liên kết + ngày" vẫn là `created_by`. SDO tệp có `bound_by_id`, `bound_by_name`, `created_by_name`. |
| `created_by`, `created_by_kind` | Người liên kết (`human`; agent không liên kết được ở v1). UI gọi là "Người liên kết". |
| `name`, `mime_type`, `icon_kind`, `web_view_link`, `owner_display`, `drive_modified_at`, `drive_modified_by_display`, `sharing_state` | **Ảnh chụp metadata** (không phải nội dung), làm mới khi một người có quyền đọc mở danh sách hoặc thẻ (tối đa một lần mỗi 10 phút một tệp, bằng kết nối **của chính người đó**) và trước mỗi lượt đọc. `drive_modified_by_display` từ `lastModifyingUser.displayName` ("Lan sửa 2 giờ trước"). `sharing_state`: `private` (Drive trả `shared=false`), `shared` (`shared=true`), `unknown` (Drive không trả `shared`, như mọi tệp trong Bộ nhớ dùng chung). Tệp Bộ nhớ dùng chung không có `owners`: chủ sở hữu hiện "Bộ nhớ dùng chung". |
| `metadata_refreshed_at`, `access_lost_at` | `access_lost_at` khi **kết nối gắn** nhận `notFound`/`insufficientFilePermissions` (§5.7) → "Tài khoản này không còn quyền với tệp" + "Liên kết lại bằng tài khoản khác". |
| `created_at`, `updated_at`, `unlinked_at`, `unlinked_by`, `unlinked_by_kind` | Bỏ liên kết là xóa mềm (lịch sử 4.2 giữ được), id tệp có thể liên kết lại thành dòng mới. |

Cột "Quyền trên Google Drive" của 4.1 ghi "Chia sẻ với N người" trong prototype. Dưới `drive.file`, danh sách `permissions` chỉ đọc được khi tài khoản có quyền quản lý tệp; v1 hiện **Riêng tư / Đã chia sẻ / Bộ nhớ dùng chung / Chưa rõ** từ `sharing_state` và `drive_id`, số người chỉ khi Drive trả `permissions` (spike S3 đo). `shared=true` **không** có nghĩa người xem việc đọc được tệp; nó chỉ là nhãn.

### 6.3 `drive_file_access` — tệp nào người nào đọc được bằng kết nối nào

| Cột | Ghi chú |
| --- | --- |
| `id`, `organization_id`, `workspace_id`, `drive_file_id`, `user_id` | Unique `(drive_file_id, user_id)`. Có dòng (bất kể `state`) = tệp nằm trong "Google Drive của tôi" của người đó (§7.6). |
| `connection_id` | Kết nối của **chính người đó** (`drive_connections.user_id = drive_file_access.user_id`, kiểm ở mọi lệnh ghi) đã cấp quyền với tệp (qua Picker). Với người đang giữ kết nối gắn (`bound_by`), luôn bằng `drive_files.connection_id`. |
| `state` | `granted` \| `lost` (kết nối của người đó nhận `notFound`/`insufficientFilePermissions`). Không có dòng = "chưa rõ" (QĐ 5). Lỗi tạm thời (hạn mức, 5xx) không đổi `state` (§5.7). |
| `granted_at`, `checked_at` | |

Đây là chỗ giữ QĐ 4 và QĐ 5 trong dữ liệu: **mọi lượt đọc nội dung tìm kết nối qua `drive_file_access` của chính người yêu cầu**, không bao giờ qua `drive_files.connection_id` của người khác. Mở trên Google dùng email của kết nối trong dòng của người xem; chưa có dòng thì dùng `webViewLink` không kèm `authuser` (Google tự chọn).

**Luật ghi đè (không lặng lẽ đổi tài khoản):**
- Chọn lại cùng tệp bằng **cùng** kết nối: idempotent (cập nhật `checked_at`, `state = granted`).
- Chọn lại bằng **kết nối khác** khi dòng đang `granted`: dòng giữ nguyên; API trả `already_linked` kèm "Bạn đang mở bằng: <email cũ>". Không có đường nào đổi kết nối đọc của một người ngoài hai lệnh có tên, và cả hai chỉ đụng dòng của **chính người gọi**: `/rebind` (người liên kết hoặc admin; đặt `drive_files.connection_id` = một kết nối của người gọi, `bound_by` = người gọi, và dòng truy cập của người gọi = kết nối đó, cùng transaction; dòng truy cập của người liên kết gốc và của mọi người khác **giữ nguyên**, vẫn trỏ tới kết nối của chính họ) và "Đổi tài khoản đọc" (`PUT …/drive-files/{driveFileID}/access {connection_id}`, sau Picker `setFileIds`). Người đang là `bound_by` gọi "Đổi tài khoản đọc" → 409 `use_rebind`: với họ, đổi tài khoản đọc là đổi kết nối gắn, nên đi qua `/rebind`.
- Dòng đang `lost`: chọn lại bằng kết nối bất kỳ của mình thay dòng (đây là thao tác rõ ràng "Cho UniWork đọc tệp", §7.4). Nếu người gọi là `bound_by` và kết nối mới khác kết nối gắn, lệnh chạy đúng như `/rebind` (đổi cả hai phía, audit `drive_file.rebound`).

### 6.4 `drive_file_task_links`

`id`, `organization_id`, `workspace_id`, `drive_file_id`, `task_id`, `created_by`, `created_by_kind`, `created_at`. Unique `(task_id, drive_file_id)`. Xóa cứng khi bỏ khỏi một việc (dòng audit trên việc giữ lịch sử); bỏ liên kết cả tệp xóa mọi dòng của tệp trong cùng transaction.

**Vì sao không là dòng `documents` (ADR 0016):** `documents` mang quyền UniWork (`visibility`, `workspace_level`, `document_shares`, link), phiên bản nhị phân và là nguồn của danh sách, cây, tìm kiếm, Work Graph, MCP và Hỏi UNI. Một tham chiếu Drive không có byte, quyền của nó là ACL của Google, và mọi đường kể trên sẽ phải rẽ nhánh để không chia sẻ, không tải xuống, không trả nội dung cho nó. ADR 0016 nói Document là kho duy nhất của **byte**; Drive không gửi byte nào vào UniWork nên không vi phạm. ADR nháp 0038 ghi điều này để không ai "sửa" lại thành dòng `documents`.

### 6.5 `drive_task_proposals`

| Cột | Ghi chú |
| --- | --- |
| `id`, `organization_id`, `workspace_id`, `drive_file_id`, `connection_id` | Kết nối của người yêu cầu đã dùng để đọc. |
| `requested_by`, `requested_by_kind` | Luôn `human`. **Chỉ người này** đọc, tính trùng, hủy hay tạo từ lô (§8.2a). |
| `prompt` | Câu người dùng gõ ở agent mode (rỗng khi từ nút "Tạo việc từ tài liệu"). |
| `context_task_id` | Việc đang mở lúc yêu cầu → gợi ý Task cha. |
| `items JSONB NULL` | Danh sách đề xuất đã chuẩn hóa (§8.2), gồm trích đoạn. **Đặt NULL** trong transaction tạo lô hoặc hủy (Q3). |
| `truncated` | Ảnh chụp lúc đọc. |
| `usage_event_id` | Dòng `ai_usage_events` của lượt gọi. |
| `status`, `status_changed_at` | `ready` \| `converted` \| `discarded`. |
| `created_at`, `expires_at` | `expires_at = created_at + 7 ngày` (Q3). |

Bảng thuộc AI context theo nghĩa ADR 0010 §1 (kết quả AI, chưa phải nghiệp vụ); service Drive ghi nó, không phải `internal/ai` (gateway chỉ gọi `Ai*`).

### 6.6 `drive_task_proposal_links` — nguồn gốc bền của việc tạo từ đề xuất

| Cột | Ghi chú |
| --- | --- |
| `id` (PK), `organization_id`, `workspace_id` | |
| `proposal_id`, `item_index` | Unique `(proposal_id, item_index)` — chặn tạo một mục hai lần (409 `proposal_item_already_converted`). |
| `task_id`, `drive_file_id`, `external_file_id` | `external_file_id` chép từ tệp lúc tạo, để lịch sử "đã tạo việc" (§8.8) còn khi tệp bị bỏ liên kết rồi liên kết lại thành dòng `drive_files` mới. Index `(workspace_id, external_file_id, created_at)`. |
| `created_by`, `created_by_kind`, `created_at` | Người xác nhận, `human`. |

Dòng này sống theo việc (không bị job lưu giữ xóa); trạng thái "đã tạo việc từ tài liệu" (§8.8) và dòng Hoạt động đọc từ đây, nên vẫn hiện sau khi lô bị xóa. Các dòng cùng `proposal_id` là một **lần tạo**.

### 6.7 (bỏ) Cột chính sách trên `organizations`

Không có (Q1, Q2 chốt không có cài đặt).


### 6.8 `drive_grant_revocations` — hàng đợi thu hồi theo `google_sub` (§5.3b)

`google_sub TEXT PRIMARY KEY`, `generation BIGINT`, `requested_at`, `refresh_token_enc NULL` (secretbox `DRIVE_CREDENTIAL_KEY`; upsert giữ token mới nhất — revoke một refresh token gỡ cả quyền của client), `attempt_id NULL`, `attempt_started_at NULL`, `resolved_at NULL`, `last_attempt_started_at NULL`, `last_resolved_at NULL` (bằng chứng, không bị upsert xóa), `attempts`, `last_error`. Chuyển trạng thái ở §5.3b. Token chỉ dùng để revoke, bị xóa khi yêu cầu bị hủy hoặc **xong**. Bảng hạ tầng toàn cục (quyền Google không thuộc tổ chức nào), vào `tenantExemptTables` với lý do "hàng đợi thu hồi theo danh tính Google, dùng chung mọi tổ chức; không chứa nội dung"; query mang `-- tenant: system`.

## 7. Liên kết tài liệu (hàng 2 và 4)

### 7.1 Picker

- `POST /api/v1/workspaces/{workspaceID}/drive-connections/{driveConnectionID}/picker-token` → `{access_token, expires_at, developer_key, app_id}`. Access token là token `drive.file` ngắn hạn của chính kết nối đó (≤ 1 giờ), không bao giờ refresh token. Chỉ chủ kết nối gọi được; **phiên desktop bị từ chối** (§17.5). Lý do: Picker chỉ chạy được với một OAuth token trong trình duyệt; quyền `drive.file` gắn với (tài khoản Google, OAuth client), nên tệp chọn bằng token này thì refresh token phía server đọc được.
- **Picker là widget do Google vẽ.** Artboard 2.2 chỉ minh họa: chữ trong Picker là của Google; UniWork chỉ cấu hình view, ngôn ngữ (`setLocale` theo ngôn ngữ UI), chọn nhiều, tiêu đề. View yêu cầu: tệp của tôi, được chia sẻ với tôi, Bộ nhớ dùng chung (`setEnableDrives(true)`), không cho chọn thư mục (QĐ 3); S2 xác nhận các view này dưới `drive.file`. Câu "UniWork chỉ được quyền với tệp bạn chọn. UniWork chỉ lưu liên kết, nội dung vẫn nằm trên Google Drive." nằm ở bước chọn tài khoản trước Picker (hoặc dòng phụ của menu khi chỉ có một tài khoản).
- Sau khi chọn **để gắn vào một việc** (hộp tạo việc, Đính kèm, chip dán URL): hộp xác nhận ngắn "Liên kết N tệp" khi có tệp `sharing_state ≠ shared`: "Tên tệp sẽ hiện cho người xem được việc này. Nội dung vẫn chỉ mở trên Google Drive." (Q6). Không có tệp như vậy, hoặc chọn từ 4.1 (không gắn việc — chỉ người chọn thấy), thì liên kết ngay.
- Có nhiều kết nối: menu "Từ Google Drive" hiện "N tài khoản đã kết nối" và hỏi tài khoản trước khi mở Picker (nhớ lần chọn trước qua `StorageAdapter`); tài khoản "Mất kết nối" bị khóa kèm "kết nối lại".
- Mã tải script Picker (`apis.google.com/js/api.js`) nằm ở `packages/views/integrations/drive-picker/`, không dùng API Next.js. Web không đặt CSP cho trang (`apps/web/next.config.mjs:45-48` chỉ có header của frame Office), nên Picker không cần đổi header; Q1/Q2 kiểm Picker dưới header production.

### 7.2 Liên kết

`POST /api/v1/workspaces/{workspaceID}/drive-files` body `{connection_id, external_file_ids[1..20], task_id?}` → kết quả từng tệp (`linked` | `already_linked` | lỗi theo §5.7).

Mỗi tệp một transaction:
1. `RequireMember` workspace; `connection_id` phải là kết nối đang hoạt động của chính người gọi trong tổ chức của workspace (không thì 404).
2. Gọi `files.get` (fields `id,name,mimeType,webViewLink,iconLink,driveId,owners(displayName),lastModifyingUser(displayName),modifiedTime,shared,trashed`) bằng kết nối đó; lỗi ánh xạ theo §5.7.
3. Khóa theo `(workspace_id, external_file_id)` (advisory lock) rồi tìm `drive_files` sống. Có → không tạo dòng mới. Người gọi **đã có** dòng truy cập: áp luật ghi đè §6.3 và trả `already_linked` kèm email **của chính người gọi** ("Đã có trong Drive: uni-work1@gmail.com"). Người gọi **chưa có** dòng: chèn dòng truy cập `granted` bằng kết nối vừa dùng và trả `linked` — không bao giờ trả email hay tên người khác (Q6: tệp người khác đã liên kết không lộ qua lệnh liên kết). Vẫn gắn vào `task_id` nếu có.
4. Không có → chèn `drive_files` (gắn `connection_id`), `drive_file_access` (`granted`), và `drive_file_task_links` khi có `task_id` (người gọi phải sửa được việc — cùng cổng với thêm đính kèm).
5. Audit `drive_file.linked` (resource `drive_file`) và, khi gắn vào việc, `task.drive_file_linked` (resource `task`, metadata `drive_file_id`, `google_email`) để dòng hiện trong Hoạt động của việc (`useResourceHistory(wsId, "task", taskId)`, `packages/views/tasks/detail/components/timeline.tsx:103`). Outbox `drive_file.linked` (+ `drive_file.task_linked`). Không phát `task.updated`: việc không đổi trường nào.

Hộp tạo việc (2.1): việc chưa tồn tại, nên client giữ `{connection_id, external_file_id}` trong nháp; `CreateTaskSDI` thêm `drive_files: [{connection_id, external_file_id}]` (tối đa 20) và service tạo việc gọi cùng hàm liên kết trong transaction tạo việc. Một tệp lỗi → **cả lệnh tạo việc lỗi**, nháp giữ nguyên, chip tệp lỗi được đánh dấu kèm lý do; người dùng bỏ chip rồi tạo lại.

### 7.3 Mục "Đính kèm" của việc (2.3, Q4)

- `GET /api/v1/tasks/{taskID}/drive-files` trả thẻ Drive của việc, mỗi thẻ: tên, loại, `icon_kind`, tài khoản gắn (email), người liên kết, `drive_modified_at` + `drive_modified_by_display`, `viewer_access` (`granted` | `lost` | `unknown` | `connection_lost`), `viewer_account_email`, `open_url` (đã gắn `authuser` theo §6.3).
- `TaskDetailAttachmentsSection` (`attachments-section.tsx:40`) hôm nay trả `null` khi không có tệp (`:70`) và không có tiêu đề hiện. Sửa: khi người xem sửa được việc và có ít nhất một cách thêm (capability `tasks.attachments` hoặc Drive khả dụng), khối **luôn hiện** một hàng tiêu đề "Đính kèm" + nút **"Thêm tệp"** (khóa có sẵn `tasks.detail.attachments_upload`; en đổi "Upload" → "Add file"), thân rỗng dùng `tasks.detail.attachments_empty` có sẵn. Không có mục và không có cách thêm → không vẽ gì. Danh sách tệp tải lên và danh sách Drive tải độc lập: một bên đang tải hoặc lỗi không ẩn bên kia.
- Giao diện theo đúng thiết kế đã duyệt (Q4: prototype 2.1, 2.3). "Thêm tệp": khi Drive khả dụng cho người xem (flag + có kết nối) là menu "Tải tệp lên" (`useUploadTaskAttachment`) / "Từ Google Drive"; không thì là nút tải lên trực tiếp như kẹp giấy hôm nay (không có menu một mục).
- Thẻ Drive hiện cho **ai xem được việc** (§7.6a). Mỗi thẻ trả cờ của người xem: `can_remove_from_task` (sửa được việc), `can_propose`, `can_ask` (`viewer_access = granted` + AI khả dụng + không phải khách workspace); hành động thiếu cờ thì ẩn (khách và người chỉ xem thấy thẻ, Mở trên Google Drive và "Cho UniWork đọc tệp"). Thẻ: nhãn "Liên kết", dòng "Đã tạo N việc từ tài liệu" khi có (§8.8), hành động **Mở trên Google Drive**, **Tạo việc từ tài liệu**, **Hỏi UNI**, ⋯ (`aria-label` "Thêm thao tác cho <tên>"): **Xem trong Tài liệu** → 4.2 (ẩn khi flag `documents` tắt), **Bỏ liên kết** → bỏ khỏi việc này: `DELETE /api/v1/tasks/{taskID}/drive-files/{driveFileID}`, audit `task.drive_file_unlinked`.
- Hoạt động của việc: "Minh đã liên kết Kế hoạch ra mắt Q4 từ Google Drive" (`task.drive_file_linked`); "Minh đã tạo công việc từ đề xuất của UNI (Kế hoạch ra mắt Q4)" từ `task.created` có `metadata.source = "drive_task_proposal"` (§8.5). Khóa `audit.actions.task.drive_file_*` và `resources.drive_file` thêm vào locale.
- Khóa query: `driveKeys.task(wsId, taskId)` nằm dưới tiền tố `driveKeys.workspace(wsId)` (§11), không dưới `taskKeys`.

### 7.4 Người khác mở việc (2.4)

- `viewer_access = unknown` (không có dòng `drive_file_access` của người xem): khối "Bạn chưa cho UniWork đọc tệp này. Tệp do Minh liên kết từ Google Drive của Minh. UNI đọc tệp bằng tài khoản Google Drive của chính bạn, nên cần bạn cho phép một lần." Nút **Cho UniWork đọc tệp** và **Mở trên Google Drive**; dòng phụ "Nếu Google báo bạn không có quyền, hãy nhờ chủ sở hữu chia sẻ trên Google Drive. UniWork không chia sẻ thay."
- "Cho UniWork đọc tệp": chưa có kết nối → Cài đặt › Tích hợp (người dùng bấm kết nối, §7.11) rồi quay lại; có → Picker với `setFileIds(external_file_id)` chọn sẵn (spike S2) → người xem bấm Chọn → `POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access` `{connection_id}` kiểm `files.get` bằng kết nối đó và ghi `drive_file_access` (audit `drive_file.access_granted`). Google từ chối (người xem không có quyền trên Drive) → Picker không trả tệp → UI giữ `unknown` và hiện dòng "nhờ chủ sở hữu chia sẻ".
- `lost`: "Tài khoản <email> không còn quyền với tệp này." + **Cho UniWork đọc tệp** (chọn lại, có thể bằng tài khoản khác). `connection_lost`: "Kết nối Google Drive <email> đã hết hạn." + **Kết nối lại**.
- "Tạo việc từ tài liệu" và "Hỏi UNI" bị khóa (`aria-disabled`, chú thích) cho tới khi `viewer_access = granted`.

### 7.5 Dán URL Drive vào mô tả (QĐ 8)

- Client nhận ra `docs.google.com/{document|spreadsheets|presentation}/d/<id>` và `drive.google.com/file/d/<id>` khi dán (mở rộng Tiptap, không đổi `linkOnPaste`). Liên kết vẫn chèn như hôm nay; bên dưới editor hiện chip "Liên kết tệp Google Drive này vào việc?".
- Dưới `drive.file`, server **không** đọc được tệp chưa qua Picker; nên chip mở Picker với `setFileIds(id)` (cùng cơ chế §7.4), không gọi server bằng URL. Không có kết nối → chip nói "Kết nối Google Drive để liên kết".
- Gợi ý trong menu kẹp giấy (prototype 2.1) đổi thành "Hoặc dán liên kết Google Drive vào mô tả, UniWork gợi ý liên kết tệp" (không hứa "tự nhận ra" vì vẫn cần một lần bấm Picker).
- Không unfurl phía server (ADR 0035 là của chat, và trang Google cần đăng nhập).

### 7.6 Tài liệu › Google Drive (4.1, Q6)

- Sidebar Tài liệu (`documents-sidebar.tsx`) thêm nút **Google Drive** ngay dưới "Thư mục của tôi", kèm tổng số; hiện khi người xem có ít nhất một kết nối (kể cả đang "Mất kết nối") và flag `documents` bật, ẩn khi không. Con: "Drive: <email>" mỗi kết nối của người xem (kèm số, dấu "Mất kết nối" nếu hỏng). Không có "Người khác liên kết" (Q6). Mục đang chọn có `aria-current="page"`.
- URL theo mẫu sẵn có của sidebar (`LibraryView` ở `documents-sidebar.tsx:25-33`, `documents-view-url.ts`): `…/documents?view=drive` (tất cả), `&account=<driveConnectionID>`. Builder trong `packages/core/paths/` (`consistency.test.ts`).
- `GET /api/v1/workspaces/{workspaceID}/drive-files?connection_id=&cursor=` — **chỉ tệp của người gọi**: `drive_files` sống trong workspace mà người gọi có dòng `drive_file_access` (§6.3); `connection_id` (phải là kết nối của người gọi) lọc theo `drive_file_access.connection_id`. Bảng có ngữ nghĩa `table`, cột: Tên, Mở bằng tài khoản (email kết nối **trong dòng truy cập của người gọi**), Quyền trên Google Drive (§6.2), Đang dùng ở ("UNI-1042 và 4 việc khác" / "Chưa gắn vào việc nào"), Đã tạo việc ("N việc" / trống, §8.8).
- Tiêu đề và dòng phụ: tất cả — "Google Drive" / "Tệp Google Drive bạn đã liên kết hoặc cho UniWork đọc. Chỉ bạn thấy danh sách này; UniWork chỉ lưu liên kết."; một tài khoản — "Drive: <email>"; tài khoản hỏng — dòng phụ "Kết nối hết hạn · kết nối lại để mở các tệp này".
- Hành động: **Thêm từ Google Drive** (tất cả) / **Thêm từ <email>** (một tài khoản; khóa khi tài khoản hỏng) → Picker; **Quản lý kết nối** → Cài đặt › Tích hợp.
- "Đang dùng ở" và "Đã tạo việc" chỉ đếm và nêu việc người xem thấy được (cổng việc hiện có).
- Không trộn vào danh sách, cây, tìm kiếm `documents`; Type filter của Documents không đổi.

### 7.6a Ai thấy gì (Q6 — luật chính xác)

Tham chiếu chỉ là metadata (tên, loại, tài khoản gắn, người liên kết, trạng thái); nội dung không bao giờ hiện trong UniWork ở bất kỳ đâu.

| Bề mặt | Ai thấy | Cổng (server) |
| --- | --- | --- |
| Nút Google Drive + danh sách 4.1 (web, desktop) | Chỉ người có dòng `drive_file_access` của tệp: người đã liên kết nó, hoặc đã "Cho UniWork đọc tệp" / chọn lại tệp đó. | `RequireMember` workspace + `drive_file_access.user_id = người gọi`. Admin workspace/tổ chức **không** có danh sách toàn workspace. |
| Thẻ Drive trên việc (`GET /tasks/{taskID}/drive-files`) | **Ai xem được việc** — thành viên, khách workspace, người được giao — theo cổng đọc việc hiện có. | Cổng đọc việc của `TaskService` (cùng cổng với đính kèm); không thêm điều kiện Drive. |
| Trang 4.2 (`GET …/drive-files/{driveFileID}`) và panel desktop | Người có dòng truy cập, **hoặc** xem được ít nhất một việc đang gắn tệp. | Không thỏa → 404 như id không tồn tại (không lộ tệp có thật). "Đang dùng ở" và "Đã tạo việc" chỉ liệt kê việc người xem thấy được. |
| Hành động trên 4.2 | Bỏ liên kết cả tệp, liên kết lại: người liên kết (`created_by`), người giữ kết nối gắn (`bound_by`) hoặc admin workspace/tổ chức **khi họ tới được 4.2** theo dòng trên. Gắn vào việc / bỏ khỏi việc: người sửa được việc đó. | `can_unlink`, `can_rebind` (§13). |
| Hoạt động (lịch sử audit theo resource: `GET /api/v1/workspaces/{ws}/resources/{type}/{id}/history`, cả web `useResourceHistory` và kênh desktop `uniwork-drive:get-history`) | `drive_file`: đúng cổng của trang 4.2 (dòng trên). `drive_connection`: chỉ chủ kết nối. `drive_task_proposal`: chỉ người yêu cầu (§8.2a). | Hôm nay route này chỉ `RequireMember` rồi đọc theo type/id (`handler/router/audit.go:83-89`, `handler/audit.go:92-103`, `service/audit_service.go:150-166`, `queries/audit.sql:28-32`) và trả nguyên metadata — gồm email và `sub` Google (Q2). `AuditService.ResourceHistory` thêm một cổng theo type: ba type Drive gọi cổng của service Drive **trước khi đọc dòng audit**, sai → 404 giống id không tồn tại. Id tệp lộ qua frame workspace không mở được lịch sử. |
| Sự kiện realtime `drive_file.*` | ids-only, ScopeWorkspace; client vô hiệu khóa và tải lại qua các cổng trên, nên người không thấy tệp chỉ nhận lại đúng phần mình được thấy. | §11. |

Vì sao không hẹp hơn "ai xem được việc": thẻ chỉ có metadata, cùng mức với tên tệp đính kèm tải lên mà mọi người xem việc đã thấy hôm nay; hẹp hơn (chỉ người được giao) sẽ làm thẻ biến mất với người theo dõi và khách mà việc vẫn hiện cho họ. Email Google của tài khoản gắn hiện trên thẻ cho người xem việc — đó là danh tính người liên kết đã chọn dùng, và cũng là `authuser` cần để mở; hộp xác nhận ở §7.1 nói tên tệp sẽ hiện cho người xem việc.

### 7.7 Trang tệp Drive (4.2)

- Route web `/{org}/{ws}/documents/drive/{driveFileID}` (`apps/web/app/[orgSlug]/[workspaceSlug]/documents/drive/[driveFileId]/page.tsx`; đoạn tĩnh `drive` đứng trước `[documentId]`; builder trong `packages/core/paths/`). `GET /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}` trả thêm `can_unlink`, `can_rebind` (server quyết, §13).
- Nội dung: tiêu đề, loại + "<người> sửa <thời gian>", **Mở trên Google Drive**, **Tạo việc từ tài liệu**, **Hỏi UNI**; bảng thuộc tính: Nguồn, **Tài khoản gắn** (email kết nối gắn, theo `bound_by`), **Bạn mở bằng** (email kết nối của người xem; `unknown` → khối §7.4 thay cho dòng này), Chủ sở hữu, Người liên kết + ngày, Quyền xem và sửa "Theo chia sẻ trên Drive"; khối giải thích "Xem và sửa nội dung trên Google, bằng tài khoản <email của người xem>. UniWork chỉ lưu liên kết, các việc dùng tệp và lịch sử thao tác; nội dung vẫn nằm trên Google Drive."; "Đang dùng ở · N" + "Gắn vào việc"; khối **"Việc đã tạo từ tài liệu"** (§8.8); "Hoạt động trong UniWork" qua `useResourceHistory(wsId, "drive_file", id)` (Q7: không có dòng "đã mở").
- **Bỏ liên kết** (khi `can_unlink`): hộp xác nhận "Bỏ liên kết khỏi N việc? Chỉ xóa liên kết trong UniWork, tệp trên Google Drive giữ nguyên. Các việc đã tạo vẫn còn, chỉ mất liên kết về tài liệu." → `DELETE /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}`.
- **Liên kết lại bằng tài khoản khác** (QĐ 4, khi `can_rebind` và `access_lost_at` hoặc kết nối gắn hỏng): chọn một kết nối khác của chính mình → Picker `setFileIds` → `POST …/drive-files/{driveFileID}/rebind {connection_id}` (kết nối phải thuộc người gọi; ngữ nghĩa ở §6.3); "Tài khoản gắn" từ đó hiện email kết nối của người rebind kèm "(gắn lại bởi <tên>)"; audit `drive_file.rebound` với email cũ, email mới, `bound_by` cũ và mới.

### 7.8 Mở trên Google Drive

`open_url` do server dựng: `web_view_link` + `authuser=<email kết nối của người xem cho tệp này>` (§6.3). Liên kết mở tab mới, `rel="noopener noreferrer"`. Không đi qua route chuyển hướng của UniWork (Q7).

### 7.9 Câu chữ, thuật ngữ, icon

- Thêm vào bảng thuật ngữ `docs/conventions.md` (cùng PR đầu tiên của phần FE): "liên kết (tệp Drive)" = **liên kết** / Link (khác "gắn" của chat ↔ việc); "bỏ liên kết" / Unlink; **Tài khoản gắn** / Bound account; **Mở bằng tài khoản** / Opens with; "kết nối" (Google Drive) / Connection; "Mất kết nối · kết nối lại" / Disconnected · Reconnect; "Việc đã tạo từ tài liệu" / Tasks created from this document; "Cho UniWork đọc tệp" / Let UniWork read this file.
- "Sub-task" / "Task cha": giữ đúng chữ đang chạy ở hộp tạo việc (`vi.json:2284`, `:2326`, `:2675`) cho toast và hộp duyệt; bảng thuật ngữ ghi chú dòng "subtask" rằng UI tạo việc dùng "sub-task"/"Task cha" — không đổi thuật ngữ ở spec này.
- Mọi chuỗi qua `t()`; khóa dưới `drive.*` và mở rộng `tasks.*`, `audit.actions.*`, `resources.*`.
- Icon: logo Google Drive là ảnh thương hiệu trong `packages/ui`; icon loại tệp mở rộng `packages/views/documents/document-type-icon.tsx` (thêm Google Docs/Sheets/Slides), không thêm bộ icon thứ hai; trạng thái cần chú ý `TriangleAlert`, kết nối lại `RefreshCw` (`docs/conventions.md` › Icons).

### 7.10 Trạng thái (mọi bề mặt web)

| Trạng thái | Ở đâu | Hiển thị | Hành động |
| --- | --- | --- | --- |
| Đang tải | 4.1, thẻ Drive, 4.2 | skeleton của `CollectionPageState` / hàng | — |
| Rỗng (đã kết nối, chưa liên kết) | 4.1 tất cả / một tài khoản | `CollectionPageState` "Chưa có tệp Google Drive nào được liên kết." | Thêm từ Google Drive |
| Không tìm thấy (404 của §7.6a) | 4.2, panel desktop | trạng thái không tìm thấy sẵn có của Tài liệu: "Không tìm thấy tệp này hoặc bạn không có quyền xem." | Về Google Drive của tôi |
| Lỗi tải | 4.1, thẻ Drive, 4.2 | `CollectionPageState` lỗi / dòng lỗi trong khối Đính kèm (danh sách tải lên vẫn hiện) | Thử lại |
| Tài khoản mất kết nối | sidebar, 4.1, thẻ, chọn tài khoản | `TriangleAlert` + "Mất kết nối" (không chỉ bằng màu) | Kết nối lại |
| Người xem `unknown` / `lost` / `connection_lost` | thẻ Drive, 4.2 | §7.4 | §7.4 |
| AI không khả dụng (`useAiCapabilities` tắt, Hỏi UNI không mở được) | thẻ Drive, 4.2, agent panel | nút ẩn | — |
| Script Picker không tải được (offline, bị chặn) | mọi lối Picker | toast "Không mở được Google Picker. Kiểm tra kết nối mạng rồi thử lại." | Thử lại |
| `picker-token` lỗi (kết nối hỏng) | mọi lối Picker | đánh dấu tài khoản "Mất kết nối" | Kết nối lại |
| Popup kết nối bị chặn | Tích hợp | câu `blocked` sẵn có của `use-oauth-popup.ts` | Thử lại |
| Đã có việc tạo từ tài liệu | thẻ Drive, 4.2, popover "Tạo việc từ tài liệu", agent panel | "Đã tạo N việc từ tài liệu này" + liên kết (§8.8); trước khi gửi: cảnh báo tạo lại | Xem các việc đã tạo / Vẫn gửi cho UNI |
| Định dạng chưa đọc được | Tạo việc từ tài liệu, Hỏi UNI | "UNI chưa đọc được định dạng này." | Mở trên Google Drive |

### 7.11 Tham số chuyển giao trong URL

`?connect=drive` (Cài đặt › Tích hợp), `?view=drive&pick=1` (4.1), `?propose=1`, `?ask=1` (4.2) chỉ **đưa người dùng tới đúng chỗ**: chọn tab, cuộn và đặt focus vào hàng Google Drive hoặc nút liên quan, mở popover "Tạo việc từ tài liệu" hoặc panel Hỏi UNI của tệp (chưa gửi). Không tham số nào tự mở popup OAuth (trình chặn popup chặn `window.open` không do bấm, `use-oauth-popup.ts`), tự mở Picker, hay tự gọi API có tác dụng phụ (lượt gọi AI tính hạn mức). Tham số bị xóa khỏi URL (`replace`) sau khi dùng, để tải lại trang không mở lại.

## 8. UNI đọc tài liệu và đề xuất việc (hàng 3, Q5)

### 8.1 Lối vào

- **Agent mode trong hộp tạo việc (3.1):** "Chuyển sang agent" → panel agent (`create-task-agent-panel.tsx`). Khi có chip tệp Drive: hàng chọn agent (`AgentPicker`, `:267`) thay bằng hàng cố định "Tạo bởi UNI" và nút gửi không đòi `selectedAgent` (`:171`, `:303`); nút độ ưu tiên/hạn (`:279-290`) và nút tải tệp (`:304`) ẩn (hộp duyệt đặt các trường đó từng việc). Panel có ô prompt, chip tệp Drive, Dự án, "Task con của" (mặc định việc đang mở), dòng "UNI đọc tệp bằng tài khoản <email> rồi đưa ra danh sách việc để bạn duyệt. Chưa có việc nào được tạo trước khi bạn duyệt." → **Gửi cho agent**. Không có chip Drive: panel giữ nguyên hành vi hôm nay (`tasks.create.agent_unavailable`).
- **"Tạo việc từ tài liệu"** trên thẻ Drive, trang 4.2 và câu trả lời Hỏi UNI: mở một popover xác nhận nhỏ gồm dòng tài khoản đọc ("UNI đọc tệp bằng tài khoản <email>…"), cảnh báo tạo lại khi tài liệu đã có việc tạo từ nó (§8.8), ô prompt tùy chọn và nút **Gửi cho agent**; chỉ cú bấm đó gọi endpoint (cùng endpoint, prompt có thể rỗng). `?propose=1` (§7.11) mở đúng popover này.
- Capability `tasks.agent_runs` giữ Unavailable; lối Drive mở theo flag `drive_connector` + `viewer_access = granted` + AI khả dụng (`useAiCapabilities`), không theo capability đó.

### 8.2 Endpoint đề xuất

`POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/task-proposals` body `{prompt?, project_id?, parent_task_id?, context_task_id?}` → 201 `DriveTaskProposalSDO`. Rate limit theo người (`drive-proposals`, 10/10 phút).

1. `RequireMember`; tệp thuộc workspace và còn sống; người gọi có `drive_file_access.state = granted` với kết nối còn hoạt động → không thì 409 `drive_access_required` (UI quay về khối §7.4).
2. Làm mới metadata; đọc nội dung bằng **kết nối của người gọi** (§8.3), trong bộ nhớ. Không giữ transaction hay khóa DB trong lúc gọi mạng.
3. Gọi `ai.Gateway.Complete` với `Capability: drive_task_proposals`, `PromptID: drive_task_proposals@1`, `Actor` = người gọi, `Sources` = một nguồn `{kind: drive_file, id, title}` cho cột audit. Vars: nội dung tài liệu bọc "không tin cậy" (ADR 0010 §6), prompt người dùng, danh sách thành viên workspace (id, tên hiển thị, email), nhãn workspace (id, tên), dự án được chọn, ngày hôm nay (UTC+7). PDF đi ở `Attachments` của lượt đầu.
4. `OutputSchema` của prompt (JSON): `items[≤ 20]` mỗi mục `{title, assignee_member_id?, assignee_basis?, priority?, priority_basis?, start_date?, start_basis?, due_date?, due_basis?, label_ids[], label_basis?, goal, checklist[≤ 10], excerpt{section, quote ≤ 300 ký tự}, blocked_by_indexes[]}`.
5. Server chuẩn hóa: bỏ `assignee_member_id`, `label_ids` không thuộc workspace; bỏ ngày không đúng `YYYY-MM-DD`; bỏ chỉ số `blocked_by` trỏ ra ngoài hoặc tạo vòng; trường bị bỏ thành trống kèm basis rỗng ("không chắc thì để trống", QĐ 10). Với mỗi mục chạy `FindActiveDuplicateTask` theo dự án + cha đã chọn → `possible_duplicate {task_id, identifier, title}`. Với mỗi người phụ trách đề xuất, tính `assignee_drive_access` (`granted` | `unknown`) từ `drive_file_access`.
6. **Kiểm lại rồi ghi, trong một transaction** (§8.2b): khóa dòng kết nối rồi dòng `drive_files` (`FOR SHARE`); tệp còn sống, dòng truy cập của người gọi vẫn `granted` với cùng kết nối, kết nối chưa ngắt/hỏng và `credential_version` không đổi so với lúc đọc. Sai → 409 `drive_source_changed`, không chèn lô (lượt AI đã tính vẫn tính). Đúng → chèn `drive_task_proposals` (`status = ready`), audit `drive_file.read` (metadata `purpose = task_proposals`, `google_email`, `usage_event_id`) và `drive_task_proposal.created`. Trả lô.

Không có nội dung tài liệu trong log, trong audit hay trong dòng lô ngoài `excerpt.quote` đã giới hạn.

**Phía client (F11):** yêu cầu có thể mất tới vài chục giây (đọc + model). Nút chuyển "UNI đang đọc tài liệu…" (`aria-live="polite"`), có **Hủy** (bỏ chờ phía client; nếu lô vẫn được tạo, nó không được hiện và hết hạn theo §8.6). Mỗi lỗi có câu riêng: `drive_access_required` → khối §7.4; `drive_format_unsupported`; 429 → "Bạn đã nhờ UNI đọc tài liệu nhiều lần. Thử lại sau ít phút."; AI không khả dụng; `drive_source_changed` → "Tài liệu vừa thay đổi kết nối hoặc bị bỏ liên kết."

### 8.2a Ai được dùng một lô đề xuất

Mọi route có `{proposalID}` — `GET`, `DELETE` (hủy), `POST …/duplicates`, `POST …/tasks` — qua một cổng: `RequireMember` workspace, lô thuộc workspace đó, **`requested_by` = người gọi**. Sai bất kỳ điều nào → 404 giống nhau (không lộ lô tồn tại). Thành viên khác cùng workspace không đọc được trích đoạn của lô người khác; test cùng workspace khác người là bắt buộc (ma trận hai tổ chức không bắt được trường hợp này).

### 8.2b Thứ tự khóa và tranh chấp

Một thứ tự cho mọi lệnh chạm nguồn của lô: dòng `drive_connections` → dòng `drive_files` → dòng `drive_task_proposals`. Ngắt kết nối (§5.3) khóa kết nối `FOR UPDATE`; bỏ liên kết (§7.7) khóa `drive_files` `FOR UPDATE`; cả hai hủy lô `ready` liên quan trong cùng transaction. Bước 6 của §8.2 và `Before` của §8.5 lấy khóa chia sẻ theo đúng thứ tự trên, nên một lượt đọc đang chờ model không thể chèn lô `ready` sau khi nguồn đã bị bỏ. Test: giữ lượt AI giả, chạy ngắt kết nối / bỏ liên kết, thả lượt AI → không có lô `ready`.

### 8.3 Đọc nội dung (Q8)

| Loại | Cách đọc | Giới hạn |
| --- | --- | --- |
| Google Docs | `files.export` `text/markdown` (lùi về `text/plain`) | |
| Google Sheets | `files.export` `text/csv` (trang tính đầu) | |
| Google Slides | `files.export` `text/plain` | |
| PDF | `files.get?alt=media` → media part ở `Attachments` của lượt đầu | 10 MiB |
| `text/plain`, `text/markdown` | `files.get?alt=media` | 1 MiB |
| DOCX, XLSX, PPTX (Office Open XML lưu trên Drive) | `files.get?alt=media` bằng kết nối của người yêu cầu → office-engine trích văn bản (§8.3a) | 20 MiB tệp; văn bản như dưới |
| Khác (ảnh, ODT, .doc/.xls/.ppt cũ…) | 422 `drive_format_unsupported`: "UNI chưa đọc được định dạng này." | |

Văn bản cắt ở 200.000 ký tự, `Request.Truncated = true`, hộp duyệt hiện "UNI chỉ đọc phần đầu tài liệu". Export của Google giới hạn 10 MB. Mọi gọi Drive đi tới host Google cố định (`www.googleapis.com`) bằng client 15 s; không cần netguard (như Calendar), nhưng client không theo redirect ra ngoài `*.googleapis.com` / `*.googleusercontent.com`. Hàm đọc duy nhất là `drive_content.ReadForAI(ctx, requester, workspaceID, driveFileID)`: nhận workspace đã qua `RequireMember` và từ chối tệp ngoài workspace đó.

### 8.3a Tệp Office qua office-engine (Q8)

- **Hiện trạng:** office-engine (`apps/office-engine/`, client Go `server/internal/office/client.go`) nhận byte đầu vào ngay trong khung job (`InputSource`, `client.go:191-199`, `Submit` `:212`), nên không cần đưa tệp vào kho; nhưng **chưa có thao tác trích văn bản**: các handler đang gắn là `open/edit/serialize:xlsx`, `open/edit/serialize:pdf`, `serialize:md|html`, `convert:xls|odt`, `export:docx` (`apps/office-engine/src/worker/handlers.ts:411`), và đầu ra hiện được supervisor PUT tới một đích FileService do grant chỉ định (`apps/office-engine/src/output.ts:1-13`). `JobGrant` gắn với `DocumentID` (`server/internal/office/contract.go:315-331`).
- **Thêm:** thao tác engine `extract_text` cho `docx`, `xlsx`, `pptx` → văn bản thuần/markdown (DOCX: đoạn + bảng; XLSX: trang tính đầu thành CSV, như Sheets; PPTX: chữ từng slide + ghi chú người nói). Kết quả trả **thẳng trong trạng thái job cuối**: engine cắt văn bản ở 200.000 ký tự **trước khi** trả, trường kết quả ≤ 512 KiB UTF-8; client Go hôm nay đọc tối đa 1 MiB cho **cả** phản hồi JSON (`client.go:38`, `:278-285`, `:326-338`), nên giới hạn đọc của trạng thái `extract_text` được tính cho phần bao JSON và ký tự thoát (≤ 2 MiB cho thao tác này, không đổi các thao tác khác), **không** có đích output và không PUT vào kho — nội dung Drive không bao giờ thành object trong UniWork (ADR nháp 0038, QĐ 2). Thư mục job của engine bị dọn sau job như mọi job khác (`cleanup.ts`).
- **Grant:** token engine thực sự kiểm là `ServiceGrant` ký HMAC (`server/internal/office/grant.go:34-58`, `:69-79`; engine `apps/office-engine/src/grants.ts:39-58`, `:106-136`, `:177-193`, kiểm ở `server.ts:246-276`), không phải `JobGrant` của `contract.go`. Thêm **một biến thể chỉ cho trích văn bản** vào cả hai định nghĩa, bộ đọc và bộ ràng buộc: gắn actor, tổ chức, workspace, `drive_file_id`, digest đầu vào, output rỗng, thao tác `extract_text`; mọi thao tác khác giữ nguyên luật document/version hiện có (không nới chung). Ca mới vào fixture đối chiếu hai ngôn ngữ `server/internal/office/testdata/grant-parity.json`. Hàng capability `extract_text` cho ba định dạng (evidence theo luật capability hiện có).
- **Luồng:** `drive_content.ReadForAI` (vẫn là hàm đọc duy nhất) tải byte bằng kết nối của người yêu cầu (`files.get?alt=media`, ≤ 20 MiB, chỉ trong bộ nhớ), `Submit` tới engine, chờ trạng thái cuối với hạn 60 s (`Status`), rồi đưa văn bản vào cùng đường với Google Docs. Engine không sẵn sàng (`Ready`) hoặc hết hạn → 503 `drive_extract_unavailable` ("UNI chưa đọc được tệp này lúc này, thử lại sau."); tệp có mật khẩu/hỏng → 422 theo lớp lỗi mở của engine (`OpenPasswordRequired`, `OpenCorrupted`…).
- **Spike S6** (trước B11): engine có sẵn bộ đọc DOCX/PPTX nào trong `@uniwork/office-engine` không, hay cần thêm thư viện; đo thời gian trích trên tệp 20 MiB; chạy văn bản sát trần (ASCII) và nhiều ký tự thoát (xuống dòng, ngoặc kép) qua `office.Client.Status` thật để chốt giới hạn đọc.
- **Kết quả S6 (2026-10-26):**
  - **Bộ đọc & thư viện (Q1):** `@uniwork/office-engine` hiện chưa xuất bộ đọc văn bản cho DOCX và PPTX (`packages/office-engine/src/node/convert/` chỉ đọc `.xls`/`.odt` và ghi `.docx`/`.xlsx`); nhánh XLSX đang nạp `dist/xlsx-gateway.mjs` (`readBasicWorkbook` ở `packages/office-upstream/upstream/packages/xlsx-gateway/src/gateway/xlsx-gateway.ts:494`, gói qua `@uniwork/office-engine/xlsx` `openXlsxModel` ở `adapter-service.ts:95`) nhưng bộ đọc đó giải nén toàn bộ mọi trang tính. Trong `packages/office-upstream/upstream/packages/` đã vendor sẵn `@genoffice/file-parse` (`docxToText` ở `src/docx.ts:4` gọi `parseDocx` của `@genoffice/docx-engine/src/parse.ts:299`, `xlsxToText` ở `src/xlsx.ts:73`, `pptxToText` ở `src/pptx.ts:61` — lưu ý `pptxToText` chưa đọc `notesSlide`) và `@genoffice/pptx-engine` (`getSlideNotes` ở `src/notes.ts:66`). Tuy nhiên, đối chiếu thực nghiệm cho thấy **không cần và không nên thêm phụ thuộc ngoài mới** (trong `pnpm-workspace.yaml` `catalog:` đã có `jszip: "3.10.1"`, `0` CVE trên `jszip`; `fast-xml-parser@5.10.1` chỉ nằm ở `packages/office-upstream/upstream/package-lock.json:9788`): viết trực tiếp bộ đọc chọn lọc entry trong `@uniwork/office-engine` (mở rộng `readCentralDirectory` ở `packages/office-engine/src/shared/zip-central.ts:67` + `inflateRawSync` của `node:zlib` ở `src/node/convert/zip.ts:1` + `readCompoundStreams` ở `src/node/convert/cfb.ts:39`) chỉ giải nén đúng các phần XML văn bản (`word/document.xml`, `xl/workbook.xml` + `xl/sharedStrings.xml` + trang tính đầu, `ppt/presentation.xml` + `ppt/slides/slide*.xml` + `ppt/notesSlides/notesSlide*.xml`) và bỏ qua toàn bộ `media/` nhúng, nhanh hơn 8–22 lần và tốn ít RAM hơn 2–3 lần so với `JSZip` + upstream bundle.
  - **Đo thời gian & bộ nhớ trên tệp ~20 MiB (Q2, 3 lần chạy mỗi loại trên Node v22.23.2, lấy trung vị):**

| Định dạng & kịch bản (~20 MiB) | Bộ đọc chọn lọc (`node:zlib` + central dir) — Wall / Peak RSS (ΔRSS) | Upstream bundle (`JSZip` + `docx-engine`/`xlsx-gateway`/`pptx-engine`) — Wall / Peak RSS (ΔRSS) |
| --- | --- | --- |
| DOCX (`20,950,865 B`, 500 đoạn + bảng 50×4 + ảnh) | **17.33 ms** (trích 7.43 ms) / **60.35 MiB** (+21.68 MiB) | 340.94 ms (trích 331.66 ms) / 103.38 MiB (+64.52 MiB) |
| XLSX (`20,836,175 B`, 5.000 dòng trang đầu + ảnh) | **63.32 ms** (trích 56.06 ms) / **65.58 MiB** (+26.86 MiB) | 534.35 ms (trích 525.30 ms) / 89.13 MiB (+48.90 MiB) |
| XLSX nặng XML (`26,368,033 B`, 80.000 dòng trên 2 trang tính) | **159.99 ms** (trích 149.01 ms) / **80.64 MiB** (+41.95 MiB) | 2,128.20 ms (trích 2,117.19 ms) / 190.90 MiB (+152.14 MiB) |
| PPTX (`20,990,058 B`, 50 slide + 50 `notesSlide` + ảnh) | **20.73 ms** (trích 12.28 ms) / **60.22 MiB** (+21.44 MiB) | 456.17 ms (trích 445.73 ms) / 107.29 MiB (+68.59 MiB) |

  - **Giới hạn khung & trạng thái job cuối (Q3):** Phía engine không giới hạn kích thước JSON của `GET /v1/jobs/{id}` (`apps/office-engine/src/server.ts:54-65`, `:326-335`, `jobs.ts:319`, `:410-428`), và khi `grant.output === null` thì `deliver()` (`apps/office-engine/src/jobs.ts:378-383`) chuyển thẳng sang `completed` mà không gọi `measureOutput`/`putOutput`. Phía Go client, `roundTrip` (`server/internal/office/client.go:334`) dùng `io.LimitReader(res.Body, maxResponseBytes)` với `maxResponseBytes = 1 << 20` (`client.go:38`, đúng 1.048.576 byte). Thực nghiệm qua `office.Client.Status` thật cho thấy: nếu cắt ở 200.000 ký tự và `≤ 512 KiB` UTF-8 thì văn bản ASCII (200.392 B), tiếng Việt nhiều dấu + thoát (304.392 B), toàn `"\n` (400.392 B) và 200.000 ký tự UTF-8 3 byte (600.392 B) đều qua `1 MiB`; **nhưng** văn bản chứa nhiều ký tự điều khiển thoát `\u0001` (1.200.392 B), hoặc trường hợp trần văn bản `≤ 1 MiB` (1.048.400 ký tự ASCII → 1.048.792 B do ~392 B vỏ JSON `JobStatus`; hoặc 512 KiB dấu `"` thoát thành `\"` → 1.048.968 B) bị `io.LimitReader` cắt cụt ở 1.048.576 B và `parseJob` (`client.go:283-284`) trả lỗi `office engine: engine_result_invalid (job_json)`. **Chốt cho B11:** giữ cắt văn bản ở engine (200.000 ký tự, trần UTF-8 `≤ 1 MiB` hoặc `≤ 512 KiB`) **và** nâng giới hạn đọc phản hồi trạng thái ở Go client cho `extract_text` lên **`2 << 20` (2 MiB)** (hoặc truyền giới hạn riêng ở `Status`), giữ nguyên `1 << 20` cho các thao tác khác.
  - **Phân lớp lỗi mật khẩu & tệp hỏng sang 422 (Q4):** Tệp OOXML đặt mật khẩu của MS Office (Standard/Agile Encryption cho cả DOCX, XLSX, PPTX) được bọc trong container OLE2/CFB (`D0 CF 11 E0 A1 B1 1A E1`) có stream `EncryptedPackage` và `EncryptionInfo`: hiện tại `JSZip.loadAsync` ném `Error("Can't find end of central directory...")` (làm nhầm với tệp hỏng), còn `XlsxAdapter.open` (`packages/office-engine/src/xlsx/adapter.ts:208-210`) báo `not_office_file: CFB container`. Trong B11, bộ đọc `extract_text` kiểm tra chữ ký đầu tệp trước: nếu là CFB có stream `EncryptedPackage`/`EncryptionInfo` hoặc ZIP entry bật cờ mã hóa (`bit 0` của general purpose flag hoặc method `99` WinZip AES) → trả `ok: false, code: "engine_result_invalid", reason: "password_required"`; nếu là CFB thường không mã hóa (`.doc`/`.xls`/`.ppt` cũ) → `reason: "not_office_file"`; nếu không phải ZIP, thiếu EOCD, hỏng luồng deflate hoặc thiếu part chính (`word/document.xml`, `xl/workbook.xml`, `ppt/presentation.xml` / không có slide) → `reason: "corrupted"`. Go `drive_content.ReadForAI` ánh xạ `job.State == JobFailed` với `error.code == "engine_result_invalid"` và `reason` thuộc `{"password_required", "corrupted", "not_office_file"}` sang HTTP **422** (tương ứng lớp lỗi mở `OpenPasswordRequired` / `OpenCorrupted` / `OpenNotOfficeFile`), không trả 502/503.

### 8.4 Hộp duyệt (3.3)

- Tiêu đề "UNI đề xuất N việc từ tài liệu"; "Nguồn: <tên> (<loại> · <email>)"; "UNI chỉ đọc phần đầu tài liệu" khi `truncated`.
- "Áp dụng cho cả lô": **Dự án** (mặc định dự án của việc ngữ cảnh; dòng phụ "Dự án của việc bạn đang mở" — v1 không có liên kết tệp ↔ dự án, Q11), **Task cha** (mặc định việc ngữ cảnh; dòng phụ "Việc bạn đang mở tài liệu từ đó · có thể bỏ trống"), **Trạng thái** (mặc định trạng thái đầu của nhóm "Cần làm" của workspace). Đổi dự án hoặc cha → client gọi `POST …/drive-task-proposals/{proposalID}/duplicates` `{project_id, parent_task_id, titles[]}` để tính lại "Có thể trùng".
- Mỗi việc (công tắc có nhãn "Tạo việc: <tiêu đề>"): tiêu đề, Người phụ trách, Độ ưu tiên, Ngày bắt đầu, Hạn, Nhãn (chọn từ nhãn có sẵn); dưới mỗi trường UNI điền là dòng "UNI · <basis>" (token `text-warning`, có tiền tố chữ "UNI ·" nên không chỉ dựa vào màu); "Bị chặn bởi: <tiêu đề>"; Mô tả gấp/mở gồm "Mục tiêu", "Việc cần làm" (checklist), "Nguồn: <mục>: "<trích>" · <tên tài liệu>" (liên kết). Trùng: "Có thể trùng với UNI-1037 · … đang mở." + **Bỏ việc này** / **Vẫn tạo**. Người phụ trách chưa có quyền Drive: "<tên> chưa xem được tài liệu trên Google Drive. Sau khi tạo, <tên> thấy việc và tên tài liệu, kèm nút mở tài liệu trên Google Drive để xin quyền chủ sở hữu." — xin quyền là nút "Yêu cầu quyền truy cập" của Google; UniWork không tự gửi (QĐ 5).
- Chân hộp: "UNI điền sẵn các trường, bạn sửa được trước khi tạo. Dòng chữ dưới trường là căn cứ của UNI; trường nào UNI không chắc thì để trống. Mỗi việc có liên kết về tài liệu." + **Hủy** / **Tạo N việc** (không chọn việc nào: nút khóa với nhãn "Chọn ít nhất 1 việc").
- Đóng hộp (Hủy, Esc, nút đóng, bấm nền): hỏi "Bỏ đề xuất này? UNI sẽ không giữ lại danh sách." → đồng ý = `DELETE …/drive-task-proposals/{proposalID}` (`discarded`); không = ở lại.
- Không có: thuộc tính tùy chỉnh, đính kèm, stage (QĐ 10).

### 8.5 Tạo lô (xác nhận của người)

`POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/tasks` body `{project_id?, parent_task_id?, status?, items: [{index, title, description, assignee_id?, priority?, start_date?, due_date?, label_ids[], blocked_by_indexes[], allow_duplicate}]}` (1..20) → `{task_ids, items[{index, task_id}]}`.

- Cổng §8.2a; lô `ready` và chưa hết hạn, không thì 409 `proposal_not_ready` / 410 `proposal_expired`.
- `TaskService.CreateManyWith` (`server/internal/service/task.go:390`) với actor `service.Human(người gọi)`:
  - `Before` (trong transaction của lô): khóa theo §8.2b; nguồn còn sống, người gọi vẫn `granted` (không thì 409 `drive_source_changed`); kiểm mục đã tạo (409 `proposal_item_already_converted`); kiểm người phụ trách, dự án, cha, nhãn thuộc workspace; chặn trùng theo lô như `refuseSummaryDuplicates` (`meeting_summary_tasks.go:381-441`; bỏ qua mục có `allow_duplicate`); kiểm `blocked_by_indexes` chỉ trỏ vào mục trong cùng yêu cầu và không vòng.
  - Mỗi việc: mô tả do client dựng từ mục tiêu + checklist + trích đoạn + liên kết (người duyệt sửa được như mọi trường; Q3: trích đoạn ở lại trong mô tả, không có tùy chọn bỏ). Liên kết tệp Drive vào mỗi việc mới (`drive_file_task_links`). Dòng audit `task.created` của mỗi việc có `metadata.source = "drive_task_proposal"`, `drive_file_id`.
  - `After` (cùng `q` của transaction): ghi `task_dependencies` (`blocked_by`) qua một hàm **nhận `q` của transaction** và hai việc đã được xác thực (`setDependencyTx`), dùng chung kiểm vòng và dựng sự kiện với `SetDependency` (`task_graph.go:236`) nhưng không mở transaction riêng — `SetDependency` hôm nay đọc qua `s.q` và tự commit (`:236-305`, `:398-402`), nên không gọi thẳng nó được; chèn `drive_task_proposal_links` (cờ tính ở server, §6.6); đặt lô `converted`, `items = NULL`, `status_changed_at`; audit `drive_task_proposal.tasks_created` (metadata `drive_file_id`, `count`, `item_indexes`, `task_ids`, `google_email`, `google_sub`); outbox `drive_task_proposal.converted` + các `task.created` do `CreateManyWith` phát sẵn. Một lỗi ở bất kỳ bước nào rollback tất cả (việc, cạnh, liên kết, audit, outbox) — có test.
- Toast (3.4): "Đã tạo N việc từ <tài liệu>, là sub-task của <cha>" (không có cha: "Đã tạo N việc từ <tài liệu>") + "Xem <cha>". Việc mới là việc bình thường ở Kanban, Danh sách, Bảng, Timeline, Swimlane (`packages/views/tasks/modes/`) — không có nhánh hiển thị riêng (QĐ 12); huy hiệu "Mới" trong prototype chỉ minh họa.

**Thuộc tính ADR 0010:** model chỉ sinh đề xuất vào `drive_task_proposals`; không lời gọi nào từ `internal/ai` tới service nghiệp vụ; việc chỉ được tạo bởi lệnh của người (`created_by_kind = human`, như "người bấm thì trực tiếp" ở Hệ quả của 0010). Nguồn gốc AI ghi ở `drive_task_proposal_links` và audit, không suy diễn.

### 8.6 Lưu giữ (Q3)

- Tạo lô hoặc hủy: `items` (bản nháp đề xuất, gồm trích đoạn) đặt NULL **trong cùng transaction**; chỉ còn id, trạng thái và dòng nguồn gốc §6.6. Trích đoạn đã vào mô tả việc **không** bị đụng tới (Q3).
- Ngắt kết nối hoặc bỏ liên kết tệp: lô `ready` liên quan chuyển `discarded`, `items = NULL`, cùng transaction (§8.2b).
- Job lane chậm chạy mỗi giờ: mỗi vòng một transaction `DELETE … WHERE id IN (SELECT id … WHERE expires_at < now() OR status <> 'ready' … FOR UPDATE SKIP LOCKED LIMIT 500)`, lặp tới hết; an toàn đa replica (ADR 0025), đăng ký trong trình tự tắt của `cmd/server/main.go`. Vậy trích đoạn của lô không ai xử lý tồn tại tối đa 7 ngày + 1 giờ. Không ghi audit mỗi vòng (cùng mẫu `document_retention_sweep.go:32-85`); đếm bằng metric `drive_task_proposals_purged_total`.

### 8.8 Tài liệu đã được dùng để tạo việc chưa (Q5)

- **Dữ liệu:** `drive_task_proposal_links` (§6.6) là nguồn bền: mỗi lần tạo = các dòng cùng `proposal_id`, có người xác nhận, thời điểm, việc tạo ra. Không đọc `drive_task_proposals` (lô bị job lưu giữ xóa, §8.6). Tra theo `(workspace_id, external_file_id)` để lịch sử còn qua bỏ liên kết rồi liên kết lại.
- **API:** `GET …/drive-files/{driveFileID}`, mỗi thẻ của `GET /tasks/{taskID}/drive-files` **và mỗi dòng của danh sách 4.1** (`GET …/drive-files`, tính một lần cho cả trang bằng một truy vấn gộp, không gọi chi tiết từng dòng) trả `tasks_created: {count, last_created_at, last_created_by_name}`; chi tiết 4.2 trả thêm `task_creations: [{proposal_id, created_at, created_by_id, created_by_name, tasks: [{task_id, identifier, title, status}]}]` (mới nhất trước, tối đa 10 lần, phân trang sau). Chỉ tính và trả việc **người xem thấy được** (cổng việc hiện có); lần tạo không còn việc nào người xem thấy thì bỏ khỏi danh sách. Endpoint đề xuất (§8.2) trả `prior_creations` cùng hình dạng rút gọn để hộp duyệt hiện lại.
- **Hiện ở đâu:** thẻ Drive trên việc — dòng "Đã tạo N việc từ tài liệu · <ngày>"; 4.2 và panel desktop — khối "Việc đã tạo từ tài liệu": mỗi lần tạo một nhóm "<ngày> · <tên> · N việc" với liên kết tới từng việc (web: trang việc; desktop: `webPathOf` kiểu `task`); bảng 4.1 — cột "Đã tạo việc".
- **Cảnh báo trước khi tạo lại:** popover "Tạo việc từ tài liệu" và agent panel (khi có chip Drive) đọc `tasks_created`; nếu `count > 0` thì hiện "Tài liệu này đã được dùng để tạo N việc (lần gần nhất <ngày>, bởi <tên>). Tạo thêm có thể trùng." + **Xem các việc đã tạo** (mở 4.2 ở khối trên) và nút chính đổi thành **Vẫn gửi cho UNI**. Cảnh báo là vùng `role="status"`, nút chính trỏ tới nó bằng `aria-describedby`, nên trình đọc màn hình đọc cảnh báo cùng nhãn nút mới. Đây chỉ là cảnh báo: không chặn; kiểm trùng theo tiêu đề vẫn chạy trong hộp duyệt (§8.4) và khi tạo lô (§8.5). Hộp duyệt lặp lại một dòng "Đã tạo N việc từ tài liệu này trước đây" khi `prior_creations` khác rỗng.
- **Realtime:** `drive_task_proposal.converted` (ScopeWorkspace, §11) vô hiệu tiền tố `driveKeys.workspace(wsId)` để thẻ, 4.2 và danh sách cập nhật số việc.

### 8.7 Truy cập và màn nhỏ

- Hộp duyệt là `Dialog` của `packages/ui` (bẫy focus, focus đầu vào tiêu đề), trên màn nhỏ (`useIsMobile`) là sheet toàn màn hình; mục tiêu chạm ≥ 44px; số "Tạo N việc" và kết quả tạo đọc qua `aria-live`; mô tả gấp/mở dùng `aria-expanded`.
- Trạng thái không bao giờ chỉ bằng màu: "Mất kết nối", "Riêng tư", "UNI · …" luôn có chữ/icon.
- Sidebar Google Drive và con có `aria-current`; bảng 4.1 là `table` thật; menu ⋯ có `aria-label`.
- Màn mới vào `e2e/onboarding-contrast.spec.ts`-style kiểm tương phản ở Q1.

## 9. Hỏi UNI với tệp Drive (3.2, Q10)

- Lối vào: "Hỏi UNI" trên thẻ Drive, trang 4.2 và câu trả lời. Dùng cơ chế focus sẵn có: thêm `drive_file` vào `AskUniPanelFocus.kind` (`packages/core/ai/store.ts:3-9`, `openWithFocus`), mở bằng `useAskUniOpener` (`packages/views/ai/ask-uni-focus-button.tsx`) nên nút tự ẩn khi Hỏi UNI không khả dụng; khóa `ai.ask_about_drive_file`. Chip "<tên> — UNI đang dùng tài liệu này làm ngữ cảnh" và dòng "Nội dung tài liệu xem trên Google Drive. UNI đọc tệp bằng tài khoản <email của người hỏi> khi trả lời."
- Server: focus `drive_file` được kiểm ở lớp ngữ cảnh Hỏi UNI (`server/internal/service/askuni_context.go`) — tệp thuộc workspace của lượt hỏi, người hỏi `granted`. Nội dung nạp **một lần ở lượt đầu** qua `drive_content.ReadForAI` (văn bản vào ngữ cảnh bọc "không tin cậy"; PDF ở `Attachments` của lượt đầu, vì gateway không nhận media ở lượt trả kết quả công cụ, `ai/gateway.go:486-491`). Cách này chạy được ở cả đường Hỏi UNI mặc định và đường agent (flag `ask_uni_agent`, mặc định tắt, `featureflags/keys.go:72`), không cần tool mới. Mỗi lượt đọc một dòng audit `drive_file.read` (`purpose = ask_uni`).
- **Không lưu (đề xuất Q10) — chế độ tạm thời của Hỏi UNI.** Hôm nay mọi câu hỏi tạo hoặc tiếp một hội thoại lưu (`askuni.go:336`), cả hai đường dựng lịch sử từ `AiListMessages` (`askuni.go:259`, `askuni_agent.go:327`) và ghi câu trả lời (`askuni.go:609-636`); body là `AskUniSDI` (`handler/dto/sdi/ai.go:9-18`). Thêm một chế độ yêu cầu riêng:
  - `AskUniSDI` thêm `transient` (bool) và `transcript` (≤ 20 lượt `{role: user|assistant, text}`, tổng ≤ 32.000 ký tự); `transient` bắt buộc khi `focus.kind = "drive_file"` và cấm đi cùng `conversation_id` (400).
  - Ở chế độ này server **không** tạo hội thoại, không ghi tin nhắn hay trích dẫn, không ghi dòng nào ngoài `ai_usage_events` và audit `drive_file.read`; dùng `transcript` làm `History` (bọc "không tin cậy" như nội dung người dùng, chỉ hai vai); trích dẫn chỉ trả trong phản hồi. Chạy ở cả đường mặc định và đường agent.
  - Mỗi yêu cầu kiểm lại focus (thành viên, tệp thuộc workspace, người hỏi `granted`) và đọc lại tệp; "lượt đầu" (PDF ở `Attachments`) nghĩa là lời gọi model đầu tiên của **mỗi yêu cầu**.
  - Panel giữ bản chép trong bộ nhớ (store của core, không `StorageAdapter`, không `useAiMessages(conversationId)`), gửi lại mỗi câu hỏi; danh sách lịch sử Hỏi UNI không có mục cho hội thoại này.
  - **Hợp đồng luồng stream** (`packages/core/ai/use-ask-uni-stream.ts`, `api/endpoints/ai-stream.ts`): ở chế độ tạm thời frame `run` mang `conversation_id` rỗng (schema client đổi thành `z.string().catch("")`, `ai-stream.ts:25`, kèm case malformed); hook rẽ nhánh theo `transient`: khi `done` nối câu hỏi + câu trả lời vào bản chép, **không** `setQueryData`/vô hiệu `aiKeys.messages(...)` hay `aiKeys.conversations(wsId)` (`use-ask-uni-stream.ts:114-117`), vẫn vô hiệu `capabilities`/`usages`; `stop()` giữ phần chữ đã nhận làm lượt "đã dừng" trong bản chép và **không** vô hiệu hay hẹn thăm lại 1.500 ms (`:153-158`), vì server không lưu lượt dừng nào.
  - Câu trả lời tạm thời không có id tin nhắn: ẩn phản hồi (thích/không thích) và "tạo lại"; "Hỏi lại" gửi lại câu hỏi cuối từ bản chép.
  - Giới hạn bản chép ở client là cửa sổ trượt: trước khi gửi, bỏ lượt cũ nhất cho tới khi ≤ 20 lượt và ≤ 32.000 ký tự, kèm dòng nhỏ "UNI chỉ nhớ các lượt gần nhất"; 400 từ server chỉ xảy ra khi client sai.
  - Đóng panel, đổi focus, chọn một hội thoại trong lịch sử hoặc bấm "Hội thoại mới" đều xóa bản chép và thoát chế độ tạm thời (chọn hội thoại đã lưu bỏ focus `drive_file`). chân panel ghi "UNI đọc tài liệu khi trả lời, không lưu bản sao nội dung, và cuộc trò chuyện này không được lưu." Đây là cách giữ đúng QĐ 2 và NFR-03 sửa đổi; muốn lưu thì cần người dùng chấp nhận một ngoại lệ lưu nội dung (Q10).
- Trích dẫn "<tài liệu> · mục N" trỏ tới trang 4.2 trong app (`isInAppHref` chỉ cho đường dẫn nội bộ, `packages/views/ai/ask-uni-links.ts:7-13`), nơi có "Mở trên Google Drive". Gợi ý "Tạo việc từ tài liệu này" → §8.2.

## 10. Flag, cấu hình, quan sát

- Flag `drive_connector` (`keys.go`): `Default: false`, `Public: true`, `Owner: "work"`, `ReviewAt: day(2027, 4, 30)`, mô tả "Connector Google Drive: kết nối, liên kết tệp, UNI đề xuất việc (UNI-2172, ADR 0038)". Tắt flag ẩn mọi lối vào web và route trả 404 `feature_disabled`; tham chiếu và kết nối giữ nguyên.
- Env: `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_PICKER_API_KEY`, `GOOGLE_DRIVE_APP_ID`, `DRIVE_CREDENTIAL_KEY` → `.env.example`, `config.Config`, `main.go` (cùng nhóm với khóa Calendar).
- `GET /api/v1/config` báo `drive.available` (provider sẵn sàng + flag) cho web.
- Metric Prometheus: `drive_api_requests_total{op, status}`, `drive_token_refresh_failures_total`, `drive_task_proposals_total{result}`. Log chỉ id (`scripts/no-pii-log.test.mjs`): không email Google, không tên tệp, không nội dung.
- Alert `DriveTokenRefreshFailuresHigh` + runbook `docs/runbooks/drive-connector.md` bốn mục (`scripts/alerts-runbooks.test.mjs`).

## 11. Audit và sự kiện

Mọi lệnh đổi trạng thái ghi `audit_events` + `outbox_events` trong cùng transaction qua `audit.Recorder.Record` (`server/internal/audit/audit.go:119`); thêm vào `audit_coverage_test.go`. Metadata mọi dòng Drive có `google_email` và `google_sub` của kết nối liên quan, cạnh actor là người UniWork (QĐ 13, Q2: hai danh tính).

| Action (resource) | Khi | Event (ids-only) |
| --- | --- | --- |
| `drive_connection.connected` / `.reconnected` (`drive_connection`) | callback thành công | `drive_connection.changed {connection_id, user_id}` — ScopeUser |
| `drive_connection.refused` | admin Google chặn, sai tài khoản, thiếu scope | — |
| `drive_connection.auth_failed` | refresh `invalid_grant` | `drive_connection.changed` |
| `drive_connection.disconnected` | người dùng, rời/vô hiệu hóa/đóng tổ chức (§5.3a) | `drive_connection.changed` |
| `drive_file.linked` (`drive_file`) | liên kết mới | `drive_file.linked {drive_file_id, workspace_id}` — ScopeWorkspace |
| `drive_file.access_granted` / `.access_changed` / `.access_lost` (`drive_file`) | người xem cho UniWork đọc / đổi tài khoản đọc / Google báo mất quyền (chỉ khi trạng thái lưu đổi) | `drive_file.access_changed {drive_file_id, workspace_id, user_id}` — ScopeUser; khi lệnh cũng đổi trạng thái chung của tệp (`access_lost_at` của kết nối gắn đặt hoặc xóa) thì thêm `drive_file.updated {drive_file_id, workspace_id}` (ScopeWorkspace) trong cùng transaction, để người khác đang mở 4.2 thấy "Liên kết lại". Test: người thứ hai đang xem 4.2 nhận frame và làm mới |
| `task.drive_file_linked` / `task.drive_file_unlinked` (`task`) | gắn/bỏ khỏi việc (hiện ở Hoạt động của việc) | `drive_file.task_linked {drive_file_id, task_id, workspace_id}` — ScopeWorkspace |
| `drive_file.unlinked` (`drive_file`) | bỏ liên kết cả tệp | `drive_file.unlinked {drive_file_id, workspace_id}` |
| `drive_file.rebound` (`drive_file`) | liên kết lại bằng tài khoản khác | `drive_file.updated {drive_file_id, workspace_id}` |
| `drive_file.read` (`drive_file`) | UNI đọc (đề xuất, Hỏi UNI) | — |
| `drive_task_proposal.created` / `.discarded` (`drive_task_proposal`) | lô tạo / hủy | — (chỉ người yêu cầu thấy, đọc qua query) |
| `drive_task_proposal.tasks_created` | tạo lô | `drive_task_proposal.converted {proposal_id, workspace_id}` + `task.created` sẵn có |

Ba bản catalogue (`docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`) thêm cùng lúc; `scripts/events-catalogue.test.mjs`. Không frame nào được ghi vào store/query (không có `Patch`).

**Vô hiệu phía client** (tệp mới `packages/core/realtime/drive-events.ts`, như `document-events.ts`; `use-realtime-sync.ts` đã sát trần 500 dòng nên chỉ thêm một lời gọi):
- Mọi khóa Drive của một workspace nằm dưới `driveKeys.workspace(wsId)`: danh sách 4.1, chi tiết 4.2, thẻ Drive của từng việc (`driveKeys.task(wsId, taskId)`).
- Mọi frame `drive_file.*` vô hiệu cả tiền tố `driveKeys.workspace(wsId)` — nên bỏ liên kết cả tệp, rebind hay đổi quyền làm mới mọi thẻ đang mở, không cần `task_id` trong payload.
- `drive_connection.changed` vô hiệu `driveKeys.connections(...)` và mọi tiền tố `driveKeys.workspace(*)` đang có trong cache (trạng thái `viewer_access`, `open_url` phụ thuộc kết nối).
- `drive_task_proposal.converted` và `task.deleted` vô hiệu tiền tố `driveKeys.workspace(wsId)` (số "Đã tạo việc", §8.8, không cũ khi một việc bị xóa); các query Drive bật refetch khi cửa sổ lấy lại focus; danh sách việc đã được `task.created` vô hiệu.

## 12. ADR nháp 0038

`docs/adr/drafts/0038-google-drive-chi-tham-chieu-doc-bang-ket-noi-cua-chinh-nguoi-dung.md` (`proposed`) ghi bốn quyết định, mỗi cái đổi hoặc làm rõ một luật:

1. Tham chiếu tệp ngoài không phải dòng `documents` (phạm vi ADR 0016 là byte).
2. Nội dung Drive chỉ đọc bằng kết nối của chính người yêu cầu; không route, job hay tool nào đọc bằng kết nối của người khác. Guard dự kiến: `TestDriveContentReadsUseTheCallersConnection` (service test) và test arch: chỉ `service/drive_content.go` gọi export/`alt=media`.
3. NFR-03 sửa đổi: AI đọc nội dung riêng tư với consent của người yêu cầu, không lưu ngoài trích đoạn nằm trong mô tả việc đã tạo (Q3: ở lại, không cảnh báo) — áp ADR 0010 §6 (ngữ cảnh chỉ gồm dữ liệu người khởi tạo được đọc), không thêm ngoại lệ cho 0010.
4. Token Google không rời server: trình duyệt chỉ nhận access token `drive.file` ngắn hạn của chính người đó cho Picker; app desktop không nhận token Google nào (cùng tinh thần ADR 0034).

Khi người dùng duyệt spec: ADR chuyển ra `docs/adr/`, `accepted`, thêm vào bảng README và `CLAUDE.md` (mục Audit and Events) cùng test giữ luật, trong PR đầu tiên của phần BE.

## 13. Cách ly tenant và quyền

- Mọi query trên bảng mới ràng buộc `organization_id`/`workspace_id` bằng tham số hoặc có dòng `-- tenant:` (`TestEveryQueryNamesItsTenant`); query `drive_connections` theo `organization_id` của workspace đã qua `RequireMember` + `user_id` của phiên. Tài khoản cũ thuộc hai tổ chức chỉ thấy kết nối của tổ chức trong đường dẫn.
- Tham số đường dẫn mới: `{driveConnectionID}`, `{driveFileID}`, `{proposalID}` — **không** dùng `{connectionID}`, vốn đang là chỗ giữ id giả của route VCS trong ma trận (`isolation_matrix_test.go:886-890`, `:985-1002`). Mỗi tham số có `pathParamSDI` (`server/internal/handler/router/openapi.go`) và một ánh xạ thật trong ma trận (danh sách tham số tenant `isolation_matrix_test.go:503-516`) tới dòng seed của tổ chức A, để các lượt cha của B + con của A và người thuộc cả hai tổ chức chạy với id thật.
- `isoRoutes`: callback `GET /api/v1/drive-connections/google/callback` → `isoPublic`, `reasonProvider` (như Email Hub `isolation_routes_test.go:483`); mọi route khác nằm dưới `/workspaces/{workspaceID}` hoặc `/tasks/{taskID}` nên mặc định `isoScoped`.
- `isoReferences`: `connection_id`, `task_id`, `drive_files[].connection_id`, `project_id`, `parent_task_id`, `context_task_id`, `assignee_id`, `label_ids`, `items[].assignee_id`, `items[].label_ids` (`TestEveryBodyIDFieldHasAReferenceCase`). `external_file_id`, `external_file_ids` được miễn có lý do ("id tệp của Google, không phải dòng tenant"), như các id của nhà cung cấp đã miễn (`isolation_references_test.go:567`).
- Seed `isolation_world_test.go` một dòng mỗi bảng mới cho mỗi tổ chức, kèm một lô đề xuất của một người khác trong cùng workspace (§8.2a) và một tệp chỉ người khác có dòng truy cập (danh sách 4.1 của người gọi không thấy, 4.2 trả 404 khi không gắn việc người gọi xem được — §7.6a). Gọi Google trong test bằng fake transport (không gọi mạng).
- Quyền: liên kết / gắn vào việc / bỏ khỏi việc — người sửa được việc (cổng đính kèm hiện có); bỏ liên kết cả tệp, liên kết lại (`can_unlink`, `can_rebind`) — người liên kết, người giữ kết nối gắn hoặc admin workspace/tổ chức khi tới được 4.2; xem danh sách và thẻ — theo §7.6a; lô đề xuất — chỉ người yêu cầu (§8.2a); khách workspace: chỉ thấy thẻ trên việc họ xem được, không có lối "Từ Google Drive"; agent: không route Drive nào ở v1. Vòng đời kết nối theo tài khoản UniWork ở §5.3a.

## 14. API client

`packages/core/api/endpoints/drive.ts` (mỗi hàm qua `parseWithFallback`, schema khoan dung, enum server là `z.string()`), `drive.test.ts` có ca response hỏng cho từng endpoint; hook trong `packages/core/drive/` với `driveKeys` (khóa workspace luôn có `wsId`; danh sách kết nối khóa theo `wsId` vì kết nối thuộc tổ chức của workspace, như `useEmailHubAccounts(wsId)`). `drive.available` thêm vào schema config công khai và `EMPTY_CONFIG` của core. Mỗi endpoint và hook được thêm cùng màn đầu tiên dùng nó (knip không cho export chưa dùng). Mutation liên kết/bỏ liên kết/tạo lô chờ server (không optimistic: tạo, xóa). `CreateTaskBody` thêm `drive_files`.

## 15. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| `setFileIds` không chọn sẵn hoặc không cấp `drive.file` cho người thứ hai | Spike S2 trước mọi việc FE của §7.4; phương án dự phòng: Picker mở ở "Được chia sẻ với tôi" kèm ô tìm theo tên. |
| Brand verification chậm hoặc bị yêu cầu thêm | Nộp ngay khi có domain + privacy policy (phụ thuộc ngoài E1); trong lúc chờ, test user (≤ 100) trên client chưa xác minh. |
| Model bịa người phụ trách/ngày | Chuẩn hóa server bỏ id lạ; basis bắt buộc cho trường được điền; người duyệt sửa trước khi tạo. |
| Prompt injection trong tài liệu | Nội dung bọc "không tin cậy"; output chỉ là JSON đề xuất; không tool ghi; người duyệt từng mục. |
| Tên tệp riêng tư lộ cho người xem việc | Q6: danh sách chỉ của chính mình; thẻ chỉ trên việc người đó xem được; hộp xác nhận khi gắn vào việc (§7.1). |
| office-engine chậm/không sẵn sàng khi trích DOCX/XLSX/PPTX | Hạn 60 s, lỗi riêng `drive_extract_unavailable`, không ảnh hưởng Google Docs/PDF; S6 đo trước. |
| Access token Picker ở trình duyệt | Chỉ access token `drive.file` ngắn hạn của chính người đó; không refresh token; không log. |

## 16. Kiểm thử

- Go: OAuth start/callback với fake Google (nonce cookie, nonce OIDC, issuer/audience/hạn sai, PKCE, thiếu `drive.file`, sai tài khoản khi kết nối lại, hai người UniWork một tài khoản Google (đều kết nối được, audit hai danh tính), admin chặn, không refresh token); kết nối lại cùng `sub` không thu hồi; ngắt kết nối khi còn/không còn chủ sống khác; kết nối lại sau ngắt giữ id; vòng đời §5.3a (rời, vô hiệu hóa, đóng/chuyển tổ chức); ánh xạ lỗi §5.7 theo từng lý do; refresh + `invalid_grant`; liên kết/khử trùng/rebind; `drive_file_access` chọn đúng kết nối (`TestDriveContentReadsUseTheCallersConnection`); đề xuất với fake gateway (chuẩn hóa id lạ, ngày sai, vòng phụ thuộc, trùng); tạo lô (trùng, stale, đã tạo, phụ thuộc, rollback toàn phần; trích đoạn trong mô tả còn sau khi lô bị xóa); trích văn bản DOCX/XLSX/PPTX qua engine giả (thành công, mật khẩu, hỏng, hết hạn, engine tắt; không object nào được ghi vào kho); cổng lô §8.2a cùng workspace khác người; tranh chấp §8.2b; job dọn; luật ghi đè `drive_file_access` §6.3; luật thấy §7.6a (danh sách chỉ của mình, thẻ theo cổng việc, 4.2 404 khi không có đường); "đã tạo việc" §8.8 (chỉ việc người xem thấy, còn qua bỏ liên kết/liên kết lại); audit coverage; isolation matrix; events catalogue.
- TS: endpoint malformed; hook vô hiệu realtime; `attachments-section` hai danh sách + "Thêm tệp"; hộp tạo việc menu kẹp giấy và chip dán URL; agent panel; hộp duyệt (basis, trống khi không chắc, trùng, phụ thuộc; không còn cảnh báo/tùy chọn trích đoạn); sidebar Google Drive hiện/ẩn; 4.2 bỏ liên kết; khối "Việc đã tạo từ tài liệu" và cảnh báo tạo lại.
- E2E (Picker giả lập bằng adapter trong môi trường test; Google thật chỉ ở checklist thủ công): kết nối → liên kết → đề xuất → tạo lô → Kanban; người thứ hai thấy `unknown`.
- Checklist thủ công trên tài khoản Google thật (plan, nhiệm vụ cuối): consent, Picker, `authuser`, admin Workspace chặn, thu hồi ở myaccount.google.com.

## 17. App desktop `uniwork-office` (QĐ 15)

Đối chiếu fork `uniwork-office` ở commit `659b5e8b0`; đường dẫn dưới đây tính từ `apps/shell/` trừ khi ghi khác. App ra **cùng đợt** với web: Q3 của plan chỉ đóng khi cả hai qua checklist.

### 17.1 Hiện trạng app

| Chủ đề | Hiện có | Hệ quả |
| --- | --- | --- |
| Sidebar Tài liệu | Bảng tĩnh `DOCUMENTS_HOME_NAV_ENTRIES` (`src/renderer/src/uniwork-home/documents-home-model.ts:60-109`, kiểu `:49-54`, id `:30-38`, nguồn dữ liệu `:40-47`); vẽ ở `DocumentsHome.tsx:1082-1101` (`button.dh-nav-item`, icon `SubNavIcon` `:104`); "Thư mục của tôi" là mục `my-folder`/`uhNavMyFolder` (`documents-home-model.ts:67-72`). App không có nút nguồn chat/cuộc họp/email/việc. | Thêm mục `google-drive` và mục con động theo kết nối; nguồn dữ liệu mới `drive`. |
| Panel chi tiết | DocumentsHome không có; panel duy nhất là `UniworkDocInfoPanel.tsx`, dùng ở `UniworkOpenDialog.tsx:976-980` qua `uniworkDocumentProperties` (`uniwork-library-api.ts:42`). | Q9: panel phải mới cho DocumentsHome, theo bố cục `UniworkDocInfoPanel`. |
| Gọi API | Renderer `window.aiOffice.*` → preload `ipcRenderer.invoke` (`src/preload/index.ts:1134-1160`) → `ipcMain.handle` (`src/main/uniwork-docs/wiring.ts:865-869`) → service (`service.ts:5221`) → `UniworkDocsClient` (`client.ts:120`, `:957`); token UniWork ở main, mọi request qua `createUniworkSend` (`client.ts:445-470`). Kênh khai trong `src/shared/home-api.ts:1795`. | API Drive đi đúng năm bước đó; token Google không bao giờ cần ở app. |
| Mở web | `webPathOf` (`src/main/uniwork-work/wiring.ts:31-58`) ánh xạ đích → đường dẫn web, kiểm slug/id `/^[A-Za-z0-9_-]{1,128}$/` (`:28`); `openWeb` (`:113-125`) ghép origin + đường dẫn rồi `shell.openExternal` (inject ở `src/main/index.ts:4581`); kiểu đích `WorkWebTarget` (`src/shared/uniwork-work-api.ts:174-177`). Không có IPC mở URL tùy ý; `safeExternalUrl` (`packages/electron-utils/src/safe-external-url.ts:21`) chỉ kiểm giao thức. | Thêm đích mới vào `webPathOf`; mở Google qua một IPC riêng kiểm host. |
| Realtime | Không websocket; main thăm dò `documents/changes` mỗi 60 s (`uniwork-sync/runtime.ts:69`), coalescer đẩy `uniwork-doc:tree-changed`. | Feed không chứa sự kiện Drive; danh sách Drive làm mới khi mở nút, khi cửa sổ lấy lại focus, và sau mỗi thao tác. |
| Bật/tắt | App không đọc flag công khai; tính năng theo tổ chức đọc từ `GET /orgs/{orgID}/office/capabilities` (`uniwork-sync/capability/client.ts:5-13`, cache `capability/cache.ts`); server ở `server/internal/service/office_app_capabilities.go`. | Thêm trường `drive_connector` vào capability đó (server: flag + provider sẵn sàng). |
| Offline | Thư viện offline ở `src/main/uniwork-sync/offline-library/`; trạng thái mạng của sync center (`sync-center-model.ts:425-436`); DocumentsHome chỉ có lỗi `network` + thử lại (`DocumentsHome.tsx:425`). | Nút Drive là online-only; không có toggle offline trên dòng Drive. |
| i18n | 21 locale ở `src/renderer/src/i18n/uniwork-home/*.ts`, `zh` định nghĩa tập khóa, các locale khác `satisfies Record<keyof typeof zh, string>`; `tests/i18n-key-parity.test.ts:16-30`. | Mọi khóa mới (`uhNavGoogleDrive`, `uhDrive*`) có đủ 21 locale. |
| Test | Vitest; `tests/uniwork-documents-home-ui.test.ts` (jsdom), `tests/uniwork-documents-home-model.test.ts`. | Test D theo hai file đó. |

### 17.2 Sidebar và danh sách

- Mục **Google Drive** ngay dưới "Thư mục của tôi", kèm tổng số; chỉ hiện khi capability `drive_connector` bật **và** người dùng có ít nhất một kết nối (`GET /workspaces/{ws}/drive-connections`). Mục con: "Drive: <email>" mỗi kết nối (số; dấu "Mất kết nối" khi `auth_failed_at`). Không có "Người khác liên kết" (Q6).
- Danh sách dùng `GET /workspaces/{ws}/drive-files` (cùng tham số `connection_id`; chỉ tệp của người dùng, §7.6a) với cột như web §7.6: Tên, Mở bằng tài khoản, Quyền trên Google Drive, Đang dùng ở, Đã tạo việc. Không trộn vào cây, tìm kiếm hay "Gần đây" của app.
- Dòng thuộc kết nối hỏng: "Mất kết nối · kết nối lại" → chuyển sang web (§17.4).
- Không có hành động offline, đổi tên, di chuyển, xóa, mở trong app trên dòng Drive. Nhấp đúp hoặc Enter = "Mở trên Google Drive".
- Capability: `drive_connector` là trường **tùy chọn** trong `parseCapabilities` (thiếu = `false`, để server cũ không làm hỏng cả body), `false` trong `NEVER_READ_CAPABILITIES` và khi cache quá hạn (`uniwork-sync/capability/cache.ts`).
- Offline (sync center báo `offline`, hoặc request trả lỗi mạng): trong một phiên đã thấy nút, nút ở lại và màn hiện "Cần kết nối mạng để xem tệp Google Drive." + "Thử lại". Khởi động lạnh khi offline: capability chưa đọc được nên nút ẩn (không có gì được lưu xuống đĩa). Ba trường hợp này có test ở D1/D2.
- Trạng thái rỗng và lỗi dùng cùng câu với web §7.10.

### 17.3 Panel chi tiết (Q9)

- Chọn một dòng Drive mở panel phải trong DocumentsHome, bố cục theo `UniworkDocInfoPanel`: tên, loại, sửa lần cuối, Nguồn, Tài khoản gắn, Bạn mở bằng (email kết nối của người xem, hoặc "Chưa cho UniWork đọc tệp" + nút chuyển sang web), Chủ sở hữu, Người liên kết + ngày, Quyền "Theo chia sẻ trên Drive", Đang dùng ở · N (mỗi việc mở web qua `webPathOf` kiểu `task`), Việc đã tạo từ tài liệu (§8.8, nhóm theo lần tạo, mỗi việc mở web), Hoạt động (cùng route lịch sử audit theo resource mà web dùng cho `useResourceHistory(wsId, "drive_file", id)`, qua kênh `uniwork-drive:get-history`).
- Nút: **Mở trên Google Drive**, **Tạo việc từ tài liệu** (web), **Hỏi UNI** (web), **Bỏ liên kết** (cùng hộp xác nhận và câu chữ như web; chỉ người liên kết hoặc admin — server quyết, app ẩn nút khi SDO báo `can_unlink = false`).
- "Liên kết lại bằng tài khoản khác" cần Picker → chuyển sang web (trang 4.2).

### 17.4 Chuyển giao sang trình duyệt / web

| Hành động | App làm gì |
| --- | --- |
| Mở trên Google Drive | IPC mới `uniwork-drive:open-on-google {driveFileId}`: main gọi `GET …/drive-files/{id}`, lấy `open_url` (đã có `authuser` của người xem, §6.3), kiểm host thuộc `docs.google.com` / `drive.google.com` và `https`, rồi `shell.openExternal`. Renderer không bao giờ truyền URL. |
| Thêm từ Google Drive / Thêm từ <email> | `openWeb` đích `drive-pick` → `/{org}/{ws}/documents?view=drive&pick=1[&account=<id>]` (web đặt focus vào nút "Thêm từ…"; người dùng bấm để mở Picker, §7.11). Google chặn đăng nhập trong webview nhúng, nên Picker và consent luôn chạy ở trình duyệt (spike S5). |
| Kết nối / Kết nối lại | đích `drive-connect` → `/{org}/{ws}/settings?tab=integrations&connect=drive` (web đặt focus vào hàng Google Drive; người dùng bấm "Kết nối", vì popup OAuth phải mở từ một cú bấm, §7.11). |
| Tạo việc từ tài liệu | Panel hiện cảnh báo tạo lại (§8.8) trước khi chuyển; đích `drive-file` + `action=propose` → `/{org}/{ws}/documents/drive/{driveFileID}?propose=1` (web mở popover "Tạo việc từ tài liệu" §8.1; người dùng bấm xác nhận). |
| Hỏi UNI | đích `drive-file` + `action=ask` → `…/documents/drive/{driveFileID}?ask=1` (mở panel Hỏi UNI với focus tệp). |
| Việc trong "Đang dùng ở" | đích `task` sẵn có. |

Sau khi chuyển giao, app làm mới danh sách khi cửa sổ lấy lại focus. Mọi id đi qua kiểm `/^[A-Za-z0-9_-]{1,128}$/` sẵn có của `webPathOf`.

### 17.5 Không token Google trong app

App chỉ gọi API UniWork bằng phiên UniWork sẵn có ở main. Không route nào trả token Google cho app: `picker-token` (§7.1) từ chối phiên desktop (kiểm loại phiên ở handler, test `TestDrivePickerTokenRefusesDesktopSession`), vì app không chạy Picker. Đúng tinh thần ADR 0034 (khóa không rời server) và ADR nháp 0038 §4.

### 17.6 i18n app

Khóa mới trong `src/renderer/src/i18n/uniwork-home/zh.ts` và 20 locale còn lại: `uhNavGoogleDrive`, `uhNavDriveAccount` ("Drive: {email}"), `uhDriveColName`, `uhDriveColAccount`, `uhDriveColAccess`, `uhDriveColUsedIn`, `uhDriveColTasksCreated`, `uhDriveTasksCreatedTitle`, `uhDriveTasksCreatedGroup` ("{date} · {name} · {count} việc"), `uhDriveRecreateWarning`, `uhDriveRecreateView` ("Xem các việc đã tạo"), `uhDriveRecreateContinue` ("Vẫn gửi cho UNI"), `uhDriveTasksCreatedLine` ("Đã tạo {count} việc từ tài liệu"; khóa có số theo luật số nhiều của từng locale), `uhDriveNotFound`, `uhDrivePrivate`, `uhDriveShared`, `uhDriveLost`, `uhDriveReconnect`, `uhDriveOpenOnGoogle`, `uhDriveAddFromDrive` ("Thêm từ Google Drive"), `uhDriveAddFromAccount` ("Thêm từ {email}"), `uhDriveEmpty`, `uhDriveLoadError`, `uhDriveBoundAccount`, `uhDriveReboundBy` ("(gắn lại bởi {name})"), `uhDriveYouOpenWith`, `uhDriveCreateTasks`, `uhDriveAskUni`, `uhDriveUnlink`, `uhDriveUnlinkConfirm*`, `uhDriveOffline`, `uhDriveNotUsed`, `uhDriveUsedIn*`. Câu tiếng Việt và tiếng Anh lấy đúng từ web (`drive.*`) để hai bên đồng bộ; 19 ngôn ngữ còn lại dịch theo quy trình dịch hiện có của fork. `tests/i18n-key-parity.test.ts` giữ.
