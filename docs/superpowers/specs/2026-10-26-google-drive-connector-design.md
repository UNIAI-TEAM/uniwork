# Connector Google Drive — liên kết tài liệu Drive vào việc, UNI đọc và đề xuất việc

> **Trạng thái:** in-progress — bản nháp chờ người dùng ký duyệt (hitl gate); chưa có thẻ triển khai nào được cắt trước khi duyệt.

**Ngày:** 2026-10-26
**Issue:** UNI-2172 (con của UNI-923). Spec nguồn của người dùng: "1244 — Cho phép kết nối dữ liệu Google Drive vào hệ thống để sử dụng tài liệu đã lưu trữ" (không phải UniAI UNI-1244).
**Prototype đã duyệt:** artifact Q7Zh3Fx5vEjiGFhFbcDGJ6; nguồn đọc được ở thư mục run `briefs/drive-connector-prototype/` (13 artboard, 4 hàng). Mã màn hình trong spec này (1.1 … 4.2) là tiêu đề artboard trong `canvas.json`.
**ADR mới (bản nháp):** `docs/adr/drafts/0038-google-drive-chi-tham-chieu-doc-bang-ket-noi-cua-chinh-nguoi-dung.md` (§12).
**Liên quan:** ADR 0007 (actor), 0008 (tenant), 0009/0012 (audit + outbox), 0010 (đề xuất → xác nhận → thực thi), 0016 (Documents là kho duy nhất), 0031/0033 (OAuth, MCP — phép so sánh), 0035 (bộ tải chặn SSRF). Plan: `docs/superpowers/plans/2026-10-26-google-drive-connector.md`.

---

## 0. Điểm người dùng cần chốt (mỗi điểm kèm đề xuất)

Các điểm dưới đây spec đã chọn theo đề xuất để thiết kế liền mạch; người dùng đổi điểm nào thì mục được trỏ tới đổi theo.

| # | Câu hỏi | Đề xuất | Lý do ngắn | Mục |
| --- | --- | --- | --- | --- |
| Q1 | Mặc định giới hạn tên miền Google khi kết nối (QĐ 13) | **Tắt** (mọi tài khoản Google). Admin tổ chức bật và nhập một hoặc vài tên miền. | Khách hàng 10–1.000 người ở VN dùng nhiều Gmail cá nhân (prototype dùng `@gmail.com`); bật mặc định chặn ngay người dùng đầu tiên. | §5.4 |
| Q2 | Một tài khoản Google dùng chung cho nhiều người UniWork | **Chặn mặc định** theo tổ chức; admin bật "cho phép dùng chung". Chặn so theo `sub` của Google trong cùng tổ chức. | Một tài khoản dùng chung làm mất ý nghĩa "đọc bằng quyền của chính bạn" (QĐ 5) và audit không còn chỉ đúng người. | §5.5 |
| Q3 | Giữ trích đoạn và đề xuất của UNI bao lâu | Lô đề xuất (`drive_task_proposals`, chứa trích đoạn) **xóa cứng sau 7 ngày** kể từ lúc tạo, hoặc ngay khi lô được tạo việc xong / bị hủy. Trích đoạn đã vào mô tả việc là nội dung việc bình thường, theo vòng đời của việc. | Bảng chỉ là bộ đệm cho hộp duyệt; không có lý do giữ nội dung riêng tư lâu hơn một tuần. | §8.6 |
| Q4 | Kiểu đính kèm mới hay danh sách tham chiếu Drive riêng (QĐ 8) | **Danh sách riêng**: bảng `drive_file_task_links`; mục "Đính kèm" vẽ hai danh sách (tệp tải lên, rồi tệp Drive) trong cùng một khối. | `attachments` là blob (`object_key`, `/content`, `/download`) và nuôi "nguồn khác" của Tài liệu; thêm kiểu không có byte làm mọi đường đó phải rẽ nhánh. | §7.3 |
| Q5 | Endpoint riêng "tài liệu → đề xuất việc" hay chờ runtime A-01 (QĐ 9) | **Endpoint riêng**, theo mẫu `meeting_summary_tasks.go`; agent mode trong hộp tạo việc gọi endpoint này khi có tệp Drive, còn lại vẫn `agent_unavailable`. | Không phụ thuộc A-01; vẫn giữ ADR 0010 (UNI chỉ đề xuất, người bấm tạo). | §8 |
| Q6 | Danh sách tệp Drive cấp workspace: ai thấy tên tệp | **Mọi thành viên workspace** thấy tên, loại, tài khoản gắn và người liên kết (như tên tệp đính kèm của việc). Nội dung không bao giờ hiện trong UniWork. | Đúng QĐ 7 ("workspace-level"); cái giá — tên tệp riêng tư lộ trong workspace — được nói ở hộp chọn tệp (§7.1). | §7.6 |
| Q7 | Dòng "Hùng đã mở qua UniWork" ở 4.2 | **Bỏ ở v1**: mở tệp không đổi trạng thái nghiệp vụ nên không có dòng audit (ADR 0012); hoạt động ở 4.2 chỉ gồm liên kết, bỏ liên kết, gắn vào việc, tạo việc từ đề xuất, đổi tài khoản gắn. | Ghi lượt mở cần một bảng sự kiện riêng; chưa có ai cần số liệu này. | §7.7 |
| Q9 | Thông tin quản lý 4.2 trên desktop (QĐ 15 nói "panel chi tiết Tài liệu sẵn có") | Màn Tài liệu của app (`DocumentsHome.tsx`) **chưa có** panel chi tiết; panel duy nhất là `UniworkDocInfoPanel` của hộp Mở (`UniworkOpenDialog.tsx:976-980`). Đề xuất: thêm panel bên phải vào DocumentsHome cho dòng Drive, dựng theo bố cục của `UniworkDocInfoPanel`; không làm trang riêng. | Giữ ý QĐ 15 (không có trang riêng) mà không chế một kiểu panel thứ hai. | §17.3 |
| Q8 | Định dạng UNI đọc được ở v1 | Google Docs, Google Sheets (trang tính đầu), Google Slides, PDF, `text/plain`, `text/markdown`. DOCX/XLSX/PPTX tải lên Drive: **để sau**, UI nói rõ "UNI chưa đọc được định dạng này". | Ba loại Google xuất văn bản bằng `files.export`; PDF gửi thẳng làm media part qua `ai.Gateway`; Office cần trích văn bản riêng (spike S3). | §8.3 |

---

## 1. Mục tiêu

Người dùng kết nối một hoặc nhiều tài khoản Google Drive, chọn từng tệp bằng Google Picker và liên kết vào việc. UniWork **chỉ lưu tham chiếu**; xem nội dung là mở trên Google. Mục đích chính (QĐ 1): **UNI đọc tài liệu đã liên kết, đề xuất danh sách việc, người duyệt, rồi việc được tạo**.

**Tiêu chí thành công**

1. Minh kết nối `uni-work1@gmail.com` từ Cài đặt › Tích hợp (1.1 → 1.2 → 1.3); consent của Google chỉ xin `drive.file`.
2. Minh tạo việc, bấm kẹp giấy › "Từ Google Drive", chọn "Kế hoạch ra mắt Q4" (2.1 → 2.2); thẻ Drive hiện ở mục Đính kèm của việc (2.3) với tài khoản gắn.
3. Minh chuyển sang agent, gửi tệp đó cho UNI (3.1); hộp duyệt (3.3) hiện 4 việc với căn cứ "UNI · …"; Minh bỏ trích đoạn hoặc giữ, bấm tạo; 4 việc mới là sub-task của UNI-1042, hiện ở mọi kiểu xem và toast nói đúng số (3.4).
4. Mai (được giao) mở UNI-1052: thấy tên tài liệu, trạng thái "chưa cho UniWork đọc" (không phải "bị từ chối"), bấm "Cho UniWork đọc tệp" → Picker mở sẵn đúng tệp → sau đó UNI đọc bằng tài khoản của Mai (2.4).
5. Không có đường nào dùng kết nối của Minh để đọc tệp cho Mai; không có đường nào chia sẻ tệp trên Drive.
6. Tài liệu › Google Drive (4.1) liệt kê tệp theo tài khoản và "Người khác liên kết"; trang 4.2 bỏ liên kết khỏi mọi việc mà tệp trên Drive giữ nguyên.
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
| 7 | Menu Tài liệu | Nút **Google Drive** cùng cấp "Thư mục của tôi", chỉ hiện khi có kết nối; con: "Drive: <email>" (kèm số) cho từng tài khoản, và "Người khác liên kết". Danh sách cấp workspace, mỗi dòng ghi tài khoản gắn. Trang 4.2 chỉ quản lý. |
| 8 | Việc | Hộp tạo việc: kẹp giấy mở menu "Tải tệp lên" / "Từ Google Drive" (mục hai chỉ khi đã kết nối); dán URL Drive vào mô tả được nhận ra. Chi tiết việc › Đính kèm › "Thêm tệp" có "Từ Google Drive". Thẻ Drive: Mở trên Google Drive, Tạo việc từ tài liệu, Hỏi UNI, ⋯ (Xem trong Tài liệu, Bỏ liên kết). |
| 9 | Agent mode | "Chuyển sang agent" → prompt + tệp Drive → "Gửi cho agent" → hộp duyệt 3.3. |
| 10 | Hộp duyệt | Trường cả lô: Dự án, Task cha, Trạng thái. Mỗi việc: tiêu đề, người phụ trách, độ ưu tiên, ngày bắt đầu, hạn, nhãn (chỉ nhãn có sẵn), mô tả (mục tiêu, checklist, trích đoạn + liên kết); "Bị chặn bởi" giữa các việc đề xuất; kiểm trùng với việc đang mở. Trường UNI điền có căn cứ "UNI · …"; không chắc thì để trống. Không có thuộc tính tùy chỉnh, đính kèm, stage. |
| 11 | Riêng tư | Trích đoạn từ tài liệu riêng tư ai xem được việc cũng đọc được: hộp duyệt cảnh báo và có "bỏ trích đoạn, chỉ giữ liên kết"; trang việc có ghi chú ngắn (2.4). |
| 12 | Việc đã tạo | Là việc bình thường ở mọi kiểu xem; toast "Đã tạo N việc từ <tài liệu>, là sub-task của <cha>". |
| 13 | Tài khoản Google ≠ tài khoản UniWork | Tùy chọn admin giới hạn tên miền; một tài khoản Google dùng chung bị chặn mặc định; trình duyệt đăng nhập tài khoản khác → `authuser`; admin Google Workspace chặn app → lỗi rõ ràng, không đẩy sang Gmail cá nhân; audit ghi cả người UniWork và email Google. |
| 15 | App desktop (`uniwork-office`, bổ sung 11:45–11:55) | Trong phạm vi, ra cùng đợt với web. Sidebar Tài liệu của app có cùng nút **Google Drive** (con theo tài khoản + "Người khác liên kết"), chỉ khi có kết nối; danh sách, lọc theo tài khoản, mất kết nối + kết nối lại, bỏ liên kết qua cùng API UniWork; thông tin 4.2 ở panel chi tiết, không trang riêng. Khác web: "Mở trên Google Drive" → trình duyệt hệ thống (`authuser`); "Thêm từ Google Drive", kết nối, "Tạo việc từ tài liệu", "Hỏi UNI" chuyển sang trình duyệt/web; chỉ online, không vào thư viện offline; app không giữ token Google (ADR 0034); i18n 21 ngôn ngữ của app; plan tách nhiệm vụ app cho lane fork. |
| 14 | Xác minh | `drive.file` chỉ cần brand verification (vài phút đến 2–3 ngày làm việc). Restricted scope: nhiều tuần + CASA hằng năm. |

### 2.1 Sửa đổi NFR-03 của spec nguồn

Spec nguồn ghi "NFR-03: không gửi nội dung Drive riêng tư cho AI". Người dùng thay bằng:

> **NFR-03 (sửa 2026-10-26):** UNI chỉ đọc nội dung một tệp Drive khi (a) người yêu cầu tự kết nối tài khoản Google của mình và đã cấp cho UniWork quyền với đúng tệp đó (consent `drive.file` + Picker), và (b) người đó chủ động yêu cầu (Gửi cho agent, Tạo việc từ tài liệu, Hỏi UNI). Nội dung đi qua `ai.Gateway` tới nhà cung cấp AI đã cấu hình, không được lưu trong UniWork, trừ trích đoạn người duyệt giữ lại trong mô tả việc. Trước khi giữ trích đoạn từ tệp riêng tư, người duyệt được cảnh báo rằng ai xem được việc đều đọc được.

Ngoài phạm vi vẫn như spec nguồn: tự cấp quyền trên Drive, ghi ngược lên Drive. OPEN-04 (không chuyển định dạng) giữ nguyên: UniWork không lưu, không chuyển tệp Drive; việc xuất văn bản ở §8.3 chỉ diễn ra trong bộ nhớ cho một lượt đọc.

## 3. Phạm vi

**Trong phạm vi:** app desktop `uniwork-office` theo QĐ 15 (§17); kết nối/ngắt/kết nối lại nhiều tài khoản Google mỗi người; Picker; tham chiếu tệp cấp workspace gắn kết nối; liên kết tệp với việc (hộp tạo việc, chi tiết việc, dán URL); trạng thái quyền theo từng người xem; endpoint đề xuất việc + hộp duyệt + tạo lô; Hỏi UNI với tệp Drive (3.2); menu Tài liệu › Google Drive (4.1, 4.2); chính sách tổ chức (tên miền, tài khoản dùng chung); flag, audit, outbox, isolation.

**Ngoài phạm vi:** liên kết thư mục (QĐ 3); AI sửa tài liệu (QĐ 6); trình xem trong app (QĐ 2); chia sẻ trên Drive (QĐ 5); liên kết tệp Drive vào dự án, cuộc họp, chat (prototype 1.3 nói "việc hoặc dự án" — dự án để sau, chỉ việc ở v1); runtime agent chung A-01; DOCX/XLSX/PPTX cho UNI (Q8); Microsoft OneDrive.

## 4. Hiện trạng (đối chiếu mã 2026-10-26, nhánh `feature/UNI-2172-drive-connector-spec` từ `ba31cc20f`)

| Chủ đề | Hiện có | Hệ quả cho Drive |
| --- | --- | --- |
| OAuth Google theo tài khoản | Email Hub: `StartOAuth` sinh nonce + PKCE, niêm phong state bằng secretbox (`server/internal/service/email_hub_oauth_flow.go:37-76`); `CompleteOAuth` so nonce cookie, đổi code bằng verifier, đọc email từ id_token (`email_hub_oauth_callback.go:45-155`); callback ngoài nhóm có phiên, trả trang HTML `postMessage` cho cửa sổ mở (`handler/router/email_hub.go:205-216`). Calendar: luồng Google gần nhất về hình dạng (`service/calendar_connections.go:58-101`, gọi REST googleapis trực tiếp `:465`, `:496`). | Sao chép mẫu Email Hub (nonce cookie, PKCE, state niêm phong, popup). Không có `google.golang.org/api` (`server/go.mod:41` chỉ có `golang.org/x/oauth2`): gọi Drive REST bằng `net/http` như Calendar. |
| Mã hóa token | `internal/util/secretbox` AES-256-GCM (`secretbox.go:47-94`), mỗi tính năng một khóa env (`EMAIL_HUB_CREDENTIAL_KEY`, `CALENDAR_CREDENTIAL_KEY`; `cmd/server/main.go:656-672`). | Khóa riêng `DRIVE_CREDENTIAL_KEY`. |
| Refresh + thu hồi | `oauthAccessToken` làm mới khi còn < 2 phút, khóa theo tài khoản, ghi có điều kiện theo `credential_version` (`email_hub_oauth_refresh.go:19-101`); `invalid_grant` → `markAuthFailed` + audit + `needs_reconnect` (`:111-128`, `email_hub_watcher.go:271`). | Dùng lại đúng mẫu; trạng thái "Mất kết nối". |
| Bảng kết nối | `email_hub_accounts` (theo user + tổ chức, nhiều tài khoản; `migrations/200_…`, `9991791700000001_…`); `calendar_connections` (theo workspace; `migrations/978_…`). | Bảng mới `drive_connections` theo **user + tổ chức** (§6.1). |
| Đề xuất → tạo việc | `CreateTasksFromSummary` (`service/meeting_summary_tasks.go:195`): người chọn mục, `TaskService.CreateManyWith` (`service/task.go:390`) trong một transaction, hook `Before` khóa và kiểm (`:274`), `After` ghi liên kết + audit (`:330`); chặn trùng theo lô `refuseSummaryDuplicates` (`:381-441`). Email: `CreateTasksFromThreadSummary` (`service/email_hub_ai.go:153`). | Endpoint tạo lô dùng `CreateManyWith` với hook tương tự (§8.5). |
| Chặn trùng tiêu đề | `guardActiveDuplicateTask` + advisory lock (`service/task.go:627-683`), `FindActiveDuplicateTask` so tiêu đề chuẩn hóa, cùng dự án và cha, việc chưa xong (`pkg/db/queries/tasks.sql:342-352`); 409 `active_duplicate_task`. | Hộp duyệt hiện "Có thể trùng với …" từ cùng truy vấn (§8.4). |
| Phụ thuộc | `task_dependencies` (`blocks`/`blocked_by`/`related`; `migrations/109_task_relations.up.sql:10`), `TaskService.SetDependency` có kiểm vòng (`service/task_graph.go:236`, `:398`). | "Bị chặn bởi" ghi trong hook `After` của lô. |
| Nhãn | `task_labels` + `task_label_links` (`migrations/108_…:21`, `109_…:1`). | UNI chỉ được chọn id nhãn có sẵn. |
| Tạo việc | `CreateTaskSDI` (`handler/dto/sdi/task.go:9-26`): title, description, status, priority, assignee, start/due, project_id, parent_task_id, label_ids, attachment_ids, allow_duplicate. | Mỗi mục đề xuất ánh xạ vào `CreateTaskInput`. |
| Đính kèm việc | Bảng `attachments` là blob (`object_key`, `object_url`; `migrations/110_task_collaboration.up.sql:56-75`); route list/upload/content/download/delete (`handler/router/tasks.go:440-464`). Mục "Đính kèm" (`packages/views/tasks/detail/components/attachments-section.tsx:40`) **không có nút "Thêm tệp"** — khóa `tasks.detail.attachments_upload` có trong `vi.json:2781` nhưng chưa dùng; mục trả `null` khi rỗng (`:70`). | Phải thêm nút "Thêm tệp" (menu) và cho mục hiện khi có tệp Drive (§7.3). |
| Hộp tạo việc | `create-task-dialog.tsx:29` (`manual`/`agent`); kẹp giấy `FileUploadButton` (`create-task-manual-panel.tsx:313`); editor dùng Tiptap Link `autolink`, `linkOnPaste` (`packages/views/editor/extensions/index.ts:69-72`), không có unfurl. Agent panel luôn `toast.error(t("tasks.create.agent_unavailable"))` (`create-task-agent-panel.tsx:171-175`); capability `tasks.agent_runs` Unavailable (`server/internal/workcapability/catalogue.go:34`). | Kẹp giấy thành menu; agent panel gửi tới endpoint đề xuất khi có tệp Drive (§8.1). |
| Documents | `documents` (`migrations/948_documents.up.sql:8-46`) có `kind` page/file/folder, không có cột `source` chung; "nguồn khác" là `SOURCE_KINDS = ["chat","meeting","email","task"]` (`packages/views/documents/documents-sidebar.tsx:35`) qua `GET /workspaces/{ws}/documents/sources` (`handler/router/document_sources.go:17-20`). "Thư mục của tôi" ở sidebar `:208-214`. | Tham chiếu Drive **không** là dòng `documents` (§6.4, ADR nháp 0038); nút Google Drive là mục sidebar riêng. |
| ai.Gateway | `Gateway.Complete` (`server/internal/ai/gateway.go:226`); `Request.Sources` cho cột audit, `Attachments` cho media part (PDF), `OutputSchema` của prompt cho JSON (`prompt.go:63`); capability là enum đóng có policy (`ai/policy.go:12-70`); prompt `name@N` (`ai/prompts.go:10-19`). `internal/ai` chỉ gọi query `Ai*` (`internal/arch_test.go:289-301`). | Capability mới `drive_task_proposals`, prompt `drive_task_proposals@1` (§8.2). |
| Hỏi UNI | Tool đọc `get_document` (`service/askuni_agent_tools.go:174`, `:488`); `TestAskUniToolsAreReadOnly`. | Tool đọc mới `read_drive_file` (§9). |
| Flag | `featureflags.Flag{Key, Description, Default, Public, Owner, ReviewAt}` (`server/internal/featureflags/keys.go:18-33`), ví dụ `mcp_connector_write` `:71`. | Flag `drive_connector` (§10). |
| Chính sách tổ chức | Cột trên `organizations` (`mcp_enabled_at`, `mcp_write_enabled_at`; `migrations/9991791763200002_…`, `9991792000000001_…`), service `mcp_grants.go:150-212`, route `/orgs/{org}/mcp-policy` (`router/connect.go:53-63`). | Hai cột chính sách Drive cùng mẫu (§5.4–5.5). |
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
2. `POST /api/v1/me/drive-connections/google/start` (rate limit như `connectLimit` của Email Hub) → URL consent; cookie HttpOnly nonce trên path callback. State niêm phong gồm user, tổ chức, nonce, verifier, hạn 10 phút, và `login_hint` khi là "kết nối lại".
3. 1.2: Google consent chỉ xin `drive.file`. Bản prototype có hai dòng giải thích dưới câu của Google; những dòng đó do UniWork viết ở 1.1 và 1.3, không nằm trong màn của Google.
4. Callback: so nonce (`subtle.ConstantTimeCompare`), kiểm lại membership tổ chức, đổi code với verifier, đọc `sub`, `email`, `email_verified`, `hd` từ id_token; áp §5.4 và §5.5; mã hóa token; lưu; thu hồi token cũ khi thay. Không có refresh token → `consent_required` (giống Email Hub).
5. 1.3: "Đã kết nối Google Drive", thẻ tài khoản (email, giờ kết nối, "Đang hoạt động"), phạm vi quyền "Chỉ tệp bạn chọn", số tài liệu đã liên kết, "UniWork lưu: Chỉ liên kết", khối "UNI được làm gì", "Ngắt kết nối".

Mã kết quả callback (popup gửi `{type:"uniwork:drive-oauth", ok, code}`): `connected`, `reconnected`, `consent_required`, `state_invalid`, `domain_not_allowed`, `account_in_use`, `blocked_by_workspace_admin`, `access_denied`, `provider_error`. Mỗi mã có một câu tiếng Việt ở UI (§7.9).

### 5.3 Nhiều tài khoản, kết nối lại, ngắt

- Một người có nhiều dòng `drive_connections` trong tổ chức, một dòng mỗi `google_sub` còn hoạt động. Kết nối lại cùng `sub` cập nhật **cùng dòng** (giữ id, tham chiếu không mất) và xóa `auth_failed_at`.
- `invalid_grant`/`unauthorized_client` khi refresh → `auth_failed_at` + audit `drive_connection.auth_failed` + sự kiện `drive_connection.changed`; UI "Mất kết nối · kết nối lại". **Không** thử tài khoản khác của người đó (QĐ 4).
- Ngắt kết nối: thu hồi token ở Google (như `email_hub_oauth_revoke.go:67`), xóa token mã hóa, đặt `disconnected_at`. Tham chiếu gắn kết nối đó ở lại, hiện "Mất kết nối · kết nối lại"; việc giữ thẻ Drive. Kết nối lại cùng `sub` khôi phục.
- Danh sách: `GET /api/v1/me/drive-connections` (email, trạng thái, số tệp đã liên kết, `connected_at`). Không trả token.

### 5.4 Giới hạn tên miền (QĐ 13, Q1)

- Cột `organizations.drive_allowed_domains TEXT[] NULL` (NULL = không giới hạn; đề xuất mặc định NULL).
- Callback so `hd` của id_token (không so đuôi email: Gmail có `hd` rỗng, tên miền Workspace mới tin được qua `hd`). Không khớp → `domain_not_allowed`, không lưu gì, audit `drive_connection.refused` (metadata `reason`, `google_email`).
- Admin tổ chức đặt ở Cài đặt tổ chức (`PUT /api/v1/orgs/{orgID}/drive-policy`, `requireOrgAdmin` như `mcp_grants.go:212`). Bật giới hạn không ngắt kết nối cũ ngoài miền; trang chính sách hiện số kết nối ngoài miền và cho admin ngắt từng cái (audit `drive_connection.disconnected` với actor admin).

### 5.5 Một tài khoản Google, nhiều người UniWork (QĐ 13, Q2)

- Cột `organizations.drive_shared_account_allowed_at TIMESTAMPTZ NULL` (NULL = chặn, mặc định).
- Callback: nếu một người khác trong cùng tổ chức có kết nối đang hoạt động với cùng `google_sub` → `account_in_use` (UI: "Tài khoản Google này đã được <tên> kết nối trong tổ chức. Mỗi người dùng tài khoản Google của chính mình."). Kiểm trong transaction có advisory lock theo (`organization_id`, `google_sub`) để hai callback song song không cùng qua.
- Admin bật thì được phép; audit mỗi lần đổi.

### 5.6 Trình duyệt đăng nhập tài khoản Google khác (QĐ 13)

- Mọi liên kết "Mở trên Google Drive" là `webViewLink` của Drive cộng `authuser=<email tài khoản gắn>` (Google chấp nhận email ở `authuser`). Người xem chưa đăng nhập tài khoản đó trong trình duyệt thì Google yêu cầu đăng nhập — UniWork không cố giải quyết thay.
- Picker mở bằng access token của kết nối được chọn, không phụ thuộc phiên Google của trình duyệt.

### 5.7 Admin Google Workspace chặn app (QĐ 13)

- Google trả `access_denied` kèm `admin_policy_enforced` (hoặc `org_internal`) ở callback, hoặc 403 `appNotAuthorizedToFile`/`domainPolicy` ở API. Server ánh xạ thành `blocked_by_workspace_admin`.
- UI: "Quản trị viên Google Workspace của tổ chức bạn chưa cho phép UniWork truy cập Google Drive. Hãy nhờ quản trị viên Google Workspace cho phép ứng dụng UniWork." Không có nút "dùng Gmail cá nhân". Spike S4 xác nhận hình dạng lỗi thật.

## 6. Mô hình dữ liệu

Mọi bảng: id ULID `TEXT`, `organization_id TEXT NOT NULL` (ADR 0008), không khóa ngoại (ADR 0001), mỗi index `CONCURRENTLY` một file, `created_by` đi cùng `created_by_kind` (ADR 0007). Tên cột theo `docs/conventions.md`.

### 6.1 `drive_connections`

| Cột | Ghi chú |
| --- | --- |
| `id`, `organization_id`, `user_id` | Kết nối là của **người**, dùng ở mọi workspace của tổ chức (một tài khoản một tổ chức, ADR 0032). |
| `provider` | `google` (CHECK), để ngỏ cho OneDrive sau. |
| `google_sub`, `google_email`, `google_hd` | `sub` là khóa thật; email để hiển thị và `authuser`. |
| `refresh_token_enc`, `access_token_enc`, `access_expires_at`, `credential_version` | secretbox `DRIVE_CREDENTIAL_KEY`; refresh fence theo mẫu Email Hub. |
| `scopes` | Scope Google trả về, để phát hiện người dùng bỏ tick. |
| `auth_failed_at`, `auth_failed_reason` | "Mất kết nối". |
| `created_at`, `updated_at`, `disconnected_at` | |

Index: unique một phần `(organization_id, user_id, google_sub) WHERE disconnected_at IS NULL`; `(organization_id, google_sub) WHERE disconnected_at IS NULL` cho §5.5. Không có `created_by` (dòng của chính người dùng; như `email_hub_accounts`).

### 6.2 `drive_files` — tham chiếu cấp workspace

| Cột | Ghi chú |
| --- | --- |
| `id`, `organization_id`, `workspace_id` | |
| `external_file_id` | Id tệp Drive. Unique một phần `(workspace_id, external_file_id) WHERE unlinked_at IS NULL` — khử trùng QĐ 4. |
| `connection_id` | **Kết nối gắn** (QĐ 4): kết nối của người liên kết đã chọn tệp. |
| `linked_by`, `linked_by_kind` | Người liên kết (`human`; agent không liên kết được ở v1). Cặp ADR 0007 dưới tên `created_by`/`created_by_kind`. |
| `name`, `mime_type`, `icon_kind`, `web_view_link`, `owner_display`, `drive_modified_at`, `drive_shared` | **Ảnh chụp metadata** (không phải nội dung), làm mới khi người có quyền mở danh sách hoặc thẻ (tối đa một lần mỗi 10 phút một tệp) và trước mỗi lượt đọc. `drive_shared` từ trường `shared` của Drive → nhãn "Riêng tư" / "Đã chia sẻ" ở 4.1. |
| `metadata_refreshed_at`, `access_lost_at` | `access_lost_at` khi kết nối gắn nhận 404/403 cho tệp → "Tài khoản này không còn quyền với tệp" + "Liên kết lại bằng tài khoản khác". |
| `created_at`, `updated_at`, `unlinked_at`, `unlinked_by`, `unlinked_by_kind` | Bỏ liên kết là xóa mềm (lịch sử 4.2 giữ được), id tệp có thể liên kết lại thành dòng mới. |

Cột "Quyền trên Google Drive" của 4.1 ghi "Chia sẻ với N người" trong prototype. Dưới `drive.file`, danh sách `permissions` chỉ đọc được khi tài khoản gắn có quyền quản lý; v1 hiện **"Riêng tư" / "Đã chia sẻ"** từ `shared`, số người chỉ khi Drive trả `permissions` (spike S3 đo).

### 6.3 `drive_file_access` — tệp nào người nào đọc được bằng kết nối nào

| Cột | Ghi chú |
| --- | --- |
| `id`, `organization_id`, `workspace_id`, `drive_file_id`, `user_id` | Unique `(drive_file_id, user_id)`. |
| `connection_id` | Kết nối của **chính người đó** đã cấp quyền với tệp (qua Picker). Với người liên kết, trùng `drive_files.connection_id`. |
| `state` | `granted` \| `lost` (kết nối của người đó nhận 404/403). Không có dòng = "chưa rõ" (QĐ 5). |
| `granted_at`, `checked_at` | |

Đây là chỗ giữ QĐ 4 và QĐ 5 trong dữ liệu: **mọi lượt đọc nội dung tìm kết nối qua `drive_file_access` của chính người yêu cầu**, không bao giờ qua `drive_files.connection_id` của người khác. Mở trên Google dùng email của kết nối trong dòng của người xem; chưa có dòng thì dùng `webViewLink` không kèm `authuser` (Google tự chọn).

### 6.4 `drive_file_task_links`

`id`, `organization_id`, `workspace_id`, `drive_file_id`, `task_id`, `created_by`, `created_by_kind`, `created_at`. Unique `(task_id, drive_file_id)`. Xóa cứng khi bỏ khỏi một việc (dòng audit giữ lịch sử); bỏ liên kết cả tệp xóa mọi dòng của tệp trong cùng transaction.

**Vì sao không là dòng `documents` (ADR 0016):** `documents` mang quyền UniWork (`visibility`, `workspace_level`, `document_shares`, link), phiên bản nhị phân và là nguồn của danh sách, cây, tìm kiếm, Work Graph, MCP và Hỏi UNI. Một tham chiếu Drive không có byte, quyền của nó là ACL của Google, và mọi đường kể trên sẽ phải rẽ nhánh để không chia sẻ, không tải xuống, không trả nội dung cho nó. ADR 0016 nói Document là kho duy nhất của **byte**; Drive không gửi byte nào vào UniWork nên không vi phạm. ADR nháp 0038 ghi điều này để không ai "sửa" lại thành dòng `documents`.

### 6.5 `drive_task_proposals`

| Cột | Ghi chú |
| --- | --- |
| `id`, `organization_id`, `workspace_id`, `drive_file_id`, `connection_id` | Kết nối của người yêu cầu đã dùng để đọc. |
| `requested_by`, `requested_by_kind` | Luôn `human`. |
| `prompt` | Câu người dùng gõ ở agent mode (rỗng khi từ nút "Tạo việc từ tài liệu"). |
| `context_task_id` | Việc đang mở lúc yêu cầu → gợi ý Task cha. |
| `items JSONB` | Danh sách đề xuất đã chuẩn hóa (§8.2), gồm trích đoạn. |
| `usage_event_id` | Dòng `ai_usage_events` của lượt gọi. |
| `status` | `ready` \| `converted` \| `discarded`. |
| `created_at`, `expires_at` | `expires_at = created_at + 7 ngày` (Q3). |

Bảng thuộc AI context theo nghĩa ADR 0010 §1 (kết quả AI, chưa phải nghiệp vụ); service Drive ghi nó, không phải `internal/ai` (gateway chỉ gọi `Ai*`). Tên khác `meeting_summaries` vì nội dung là đề xuất, không phải bản tóm tắt.

### 6.6 `drive_task_proposal_links`

`organization_id`, `workspace_id`, `proposal_id`, `item_index`, `task_id`, `created_at` — như `meeting_summary_task_links`, chặn tạo một mục hai lần (409 `proposal_item_already_converted`). Giữ sau khi lô bị xóa theo hạn (chỉ có id).

### 6.7 Cột chính sách trên `organizations`

`drive_allowed_domains TEXT[] NULL`, `drive_allowed_domains_set_by TEXT NULL`, `drive_shared_account_allowed_at TIMESTAMPTZ NULL`, `drive_shared_account_allowed_by TEXT NULL`.

## 7. Liên kết tài liệu (hàng 2 và 4)

### 7.1 Picker

- `POST /api/v1/me/drive-connections/{connectionID}/picker-token` → `{access_token, expires_at, developer_key, app_id}`. Access token là token `drive.file` ngắn hạn của chính kết nối đó (≤ 1 giờ), không bao giờ refresh token. Chỉ chủ kết nối gọi được. Lý do: Picker chỉ chạy được với một OAuth token trong trình duyệt; quyền `drive.file` gắn với (người dùng Google, OAuth client), nên tệp chọn bằng token này thì refresh token phía server đọc được.
- Picker (2.2) mở với các view: Gần đây, Drive của tôi, Được chia sẻ với tôi, Bộ nhớ dùng chung; chọn nhiều tệp; không cho chọn thư mục (QĐ 3). Dòng chân hộp: "UniWork chỉ được quyền với tệp bạn chọn. UniWork chỉ lưu liên kết, nội dung vẫn nằm trên Google Drive." Cảnh báo Q6 nằm ở hộp xác nhận sau khi chọn (khi tệp `shared=false`): "Tên tệp sẽ hiện cho mọi người trong workspace."
- Có nhiều kết nối: menu "Từ Google Drive" hiện "N tài khoản đã kết nối" và hỏi tài khoản trước khi mở Picker (nhớ lần chọn trước trong `StorageAdapter`).
- Mã tải script Picker (`apis.google.com/js/api.js`) nằm ở `packages/views/integrations/drive-picker/`, không dùng API Next.js; CSP của web thêm `apis.google.com` và `docs.google.com` (frame Picker).

### 7.2 Liên kết

`POST /api/v1/workspaces/{workspaceID}/drive-files` body `{connection_id, external_file_ids[1..20], task_id?}`.

Trong một transaction cho mỗi tệp:
1. `RequireMember` workspace; `connection_id` phải là kết nối đang hoạt động của chính người gọi (không thì 404).
2. Gọi `files.get` (fields `id,name,mimeType,webViewLink,iconLink,owners(displayName),modifiedTime,shared,trashed`) bằng kết nối đó; 404/403 → mục đó lỗi `drive_file_not_accessible`.
3. Đã có `drive_files` sống cùng `external_file_id` trong workspace → không tạo dòng mới; trả `already_linked` kèm email tài khoản gắn ("Đã có trong Drive: uni-work1@gmail.com"). Vẫn upsert `drive_file_access` cho người gọi, và vẫn gắn vào `task_id` nếu có.
4. Không thì chèn `drive_files` (gắn `connection_id`), `drive_file_access` (`granted`), và `drive_file_task_links` khi có `task_id` (người gọi phải sửa được việc — cùng cổng với thêm đính kèm).
5. Audit `drive_file.linked` (+ `drive_file.task_link_added` khi có `task_id`) và outbox `drive_file.linked` (+ `drive_file.task_linked`). Không phát `task.updated`: việc không đổi trường nào, thẻ Drive của việc vô hiệu qua `drive_file.task_linked` (§11).

Hộp tạo việc (2.1): việc chưa tồn tại, nên client giữ `{connection_id, external_file_id}` trong nháp; `CreateTaskSDI` thêm `drive_files: [{connection_id, external_file_id}]` (tối đa 20) và service tạo việc gọi cùng hàm liên kết trong transaction tạo việc. Việc liên kết ở hộp tạo việc không cần endpoint tạm như `POST /workspaces/{ws}/attachments`.

### 7.3 Mục "Đính kèm" của việc (2.3, Q4)

- `GET /api/v1/tasks/{taskID}/drive-files` trả thẻ Drive của việc, mỗi thẻ: tên, loại, `icon_kind`, tài khoản gắn (email), người liên kết, `drive_modified_at` + người sửa nếu Drive trả, `viewer_access` (`granted` | `lost` | `unknown` | `connection_lost`), `open_url` (đã gắn `authuser` theo §6.3).
- `TaskDetailAttachmentsSection` (`attachments-section.tsx:40`) vẽ tệp tải lên rồi tệp Drive trong cùng khối, hiện khi một trong hai có mục, và thêm nút **"Thêm tệp"** (khóa có sẵn `tasks.detail.attachments_upload`) mở menu "Tải tệp lên" / "Từ Google Drive". Mục hai chỉ khi người xem có kết nối; không có thì là "Kết nối Google Drive…" dẫn tới Cài đặt › Tích hợp.
- Thẻ Drive: nhãn "Liên kết", hành động **Mở trên Google Drive**, **Tạo việc từ tài liệu**, **Hỏi UNI**, ⋯ (**Xem trong Tài liệu** → 4.2, **Bỏ liên kết** → bỏ khỏi việc này: `DELETE /api/v1/tasks/{taskID}/drive-files/{driveFileID}`).
- Hoạt động của việc thêm dòng "Minh đã liên kết Kế hoạch ra mắt Q4 từ Google Drive" từ audit.
- Khóa query: `taskKeys.driveFiles(wsId, taskId)` bên cạnh `taskKeys.attachments` (`packages/core/tasks/keys.ts:81`).

### 7.4 Người khác mở việc (2.4)

- `viewer_access = unknown` (không có dòng `drive_file_access` của người xem): khối "Bạn chưa cho UniWork đọc tệp này. Tệp do Minh liên kết từ Google Drive của Minh. UNI đọc tệp bằng tài khoản Google Drive của chính bạn, nên cần bạn cho phép một lần." Nút **Cho UniWork đọc tệp** và **Mở trên Google Drive**; dòng phụ "Nếu Google báo bạn không có quyền, hãy nhờ chủ sở hữu chia sẻ trên Google Drive. UniWork không chia sẻ thay."
- "Cho UniWork đọc tệp": chưa có kết nối → luồng kết nối (§5.2) rồi quay lại; có → Picker với `setFileIds(external_file_id)` chọn sẵn (spike S2) → người xem bấm Chọn → `POST /api/v1/workspaces/{ws}/drive-files/{driveFileID}/access` `{connection_id}` kiểm `files.get` bằng kết nối đó và ghi `drive_file_access`. Google từ chối (người xem không có quyền trên Drive) → Picker không trả tệp → UI giữ trạng thái `unknown` và hiện dòng "nhờ chủ sở hữu chia sẻ".
- "Tạo việc từ tài liệu" và "Hỏi UNI" bị khóa (aria-disabled, chú thích) cho tới khi `viewer_access = granted`.
- Việc tạo từ đề xuất có mô tả chứa trích đoạn: dưới mô tả hiện ghi chú QĐ 11 ("UNI soạn mô tả này từ một tài liệu Google Drive riêng tư khi Minh tạo việc. Đoạn trích nằm trong UniWork, ai xem được việc đều đọc được, kể cả khi chưa có quyền xem tài liệu trên Google Drive."). Nguồn của ghi chú: `drive_task_proposal_links` có dòng cho việc và mục đó được tạo khi giữ trích đoạn, tệp `drive_shared=false` lúc tạo (lưu `excerpt_kept` + `source_private` trong `items` của lô và trên dòng link, để ghi chú vẫn hiện sau khi lô hết hạn).

### 7.5 Dán URL Drive vào mô tả (QĐ 8)

- Client nhận ra `docs.google.com/{document|spreadsheets|presentation}/d/<id>` và `drive.google.com/file/d/<id>` khi dán (mở rộng Tiptap, không đổi `linkOnPaste`). Liên kết vẫn chèn như hôm nay; bên dưới editor hiện chip "Liên kết tệp Google Drive này vào việc?".
- Dưới `drive.file`, server **không** đọc được tệp chưa qua Picker; nên chip mở Picker với `setFileIds(id)` (cùng cơ chế §7.4), không gọi server bằng URL. Người dùng không có kết nối → chip nói "Kết nối Google Drive để liên kết".
- Không unfurl phía server (ADR 0035 là của chat, và trang Google cần đăng nhập).

### 7.6 Tài liệu › Google Drive (4.1, Q6)

- Sidebar Tài liệu (`documents-sidebar.tsx`) thêm nút **Google Drive** ngay dưới "Thư mục của tôi", kèm tổng số; hiện khi người xem có ít nhất một kết nối (kể cả đang "Mất kết nối"), ẩn khi không. Con: "Drive: <email>" mỗi kết nối của người xem (kèm số, dấu "Mất kết nối" nếu hỏng) và "Người khác liên kết".
- `GET /api/v1/workspaces/{workspaceID}/drive-files?connection_id=&linked_by=others&cursor=` — danh sách cấp workspace (mọi thành viên workspace), cột: Tên, Mở bằng tài khoản (email kết nối gắn; với "Người khác liên kết" là "<tên> · <email>"), Quyền trên Google Drive (Riêng tư / Đã chia sẻ), Đang dùng ở ("UNI-1042 và 4 việc khác" / "Chưa gắn vào việc nào"). Nút "Quản lý kết nối" → Cài đặt › Tích hợp; nút "Liên kết tệp" → Picker.
- Danh sách "Đang dùng ở" chỉ đếm và nêu việc người xem thấy được (cổng việc hiện có).
- Không trộn vào danh sách, cây, tìm kiếm `documents`; Type filter của Documents không đổi.

### 7.7 Trang tệp Drive (4.2)

- Route web `/{org}/{ws}/documents/drive/{driveFileID}` (thêm builder trong `packages/core/paths/`; `consistency.test.ts`). `GET /api/v1/workspaces/{ws}/drive-files/{driveFileID}`.
- Nội dung: tiêu đề, loại + "sửa lần cuối", **Mở trên Google Drive** (khối giải thích "Xem và sửa nội dung trên Google, bằng tài khoản <email>. UniWork chỉ lưu liên kết, các việc dùng tệp và lịch sử thao tác; nội dung vẫn nằm trên Google Drive."), **Tạo việc từ tài liệu**, **Hỏi UNI**; bảng thuộc tính: Nguồn, Mở bằng tài khoản, Chủ sở hữu, Người liên kết + ngày, Quyền xem và sửa "Theo chia sẻ trên Drive"; "Đang dùng ở · N" + "Gắn vào việc"; "Hoạt động trong UniWork" từ audit `resource_type = drive_file` (Q7: không có dòng "đã mở").
- **Bỏ liên kết** (người liên kết, admin workspace/tổ chức): hộp xác nhận "Bỏ liên kết khỏi N việc? Chỉ xóa liên kết trong UniWork, tệp trên Google Drive giữ nguyên. Các việc đã tạo vẫn còn, chỉ mất liên kết về tài liệu." → `DELETE /api/v1/workspaces/{ws}/drive-files/{driveFileID}`.
- **Liên kết lại bằng tài khoản khác** (QĐ 4, khi `access_lost_at` hoặc kết nối gắn hỏng; chỉ người liên kết hoặc admin): chọn một kết nối khác của chính mình → Picker `setFileIds` → `POST …/drive-files/{driveFileID}/rebind {connection_id}`; audit `drive_file.rebound` với email cũ và mới.

### 7.8 Mở trên Google Drive

`open_url` do server dựng: `web_view_link` + `authuser=<email kết nối của người xem cho tệp này>` (§6.3). Liên kết mở tab mới, `rel="noopener noreferrer"`. Không đi qua route chuyển hướng của UniWork (Q7).

### 7.9 Câu chữ và thuật ngữ

Thêm vào bảng thuật ngữ `docs/conventions.md` (cùng PR đầu tiên của phần FE): "liên kết (tệp Drive)" = **liên kết** / Link (khác "gắn" của chat ↔ việc); "bỏ liên kết" / Unlink; "tài khoản gắn" hiển thị là **Mở bằng tài khoản** / Opens with; "kết nối" (Google Drive) / Connection; "Mất kết nối · kết nối lại" / Disconnected · Reconnect; "Người khác liên kết" / Linked by others; "Cho UniWork đọc tệp" / Let UniWork read this file. Mọi chuỗi qua `t()`; khóa dưới `drive.*` và mở rộng `tasks.*`. Icon: `HardDrive` không dùng — logo Google Drive là ảnh thương hiệu trong `packages/ui` (Google cho phép hiển thị logo cho nút tích hợp); icon loại tệp theo prototype.

## 8. UNI đọc tài liệu và đề xuất việc (hàng 3, Q5)

### 8.1 Lối vào

- **Agent mode trong hộp tạo việc (3.1):** "Chuyển sang agent" → panel agent có ô prompt, chip tệp Drive (bắt buộc ở v1: không có tệp Drive thì nút "Gửi cho agent" giữ hành vi hôm nay — `tasks.create.agent_unavailable`), Dự án, "Task con của" (mặc định việc đang mở), dòng "UNI đọc tệp bằng tài khoản <email> rồi đưa ra danh sách việc để bạn duyệt. Chưa có việc nào được tạo trước khi bạn duyệt." → "Gửi cho agent".
- **"Tạo việc từ tài liệu"** trên thẻ Drive, trang 4.2 và câu trả lời Hỏi UNI: cùng endpoint, prompt rỗng.
- Capability `tasks.agent_runs` giữ Unavailable; panel agent mở theo flag `drive_connector` + có kết nối, không theo capability đó.

### 8.2 Endpoint đề xuất

`POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/task-proposals` body `{prompt?, project_id?, parent_task_id?, context_task_id?}` → 201 `DriveTaskProposalSDO`. Rate limit theo người (`drive-proposals`, 10/10 phút).

1. `RequireMember`; tệp thuộc workspace và còn sống; người gọi có `drive_file_access.state = granted` với kết nối còn hoạt động → không thì 409 `drive_access_required` (UI quay về khối §7.4).
2. Làm mới metadata; đọc nội dung bằng **kết nối của người gọi** (§8.3), trong bộ nhớ.
3. Gọi `ai.Gateway.Complete` với `Capability: drive_task_proposals`, `PromptID: drive_task_proposals@1`, `Actor` = người gọi, `Sources` = một nguồn `{kind: drive_file, id, title}` cho cột audit. Vars: nội dung tài liệu bọc "không tin cậy" (ADR 0010 §6), prompt người dùng, danh sách thành viên workspace (id, tên hiển thị, email), nhãn workspace (id, tên), dự án được chọn, ngày hôm nay (UTC+7). PDF đi ở `Attachments` thay cho văn bản.
4. `OutputSchema` của prompt (JSON): `items[≤ 20]` mỗi mục `{title, assignee_member_id?, assignee_basis?, priority?, priority_basis?, start_date?, start_basis?, due_date?, due_basis?, label_ids[], label_basis?, goal, checklist[≤ 10], excerpt{section, quote ≤ 300 ký tự}, blocked_by_indexes[]}`.
5. Server chuẩn hóa: bỏ `assignee_member_id`, `label_ids` không thuộc workspace; bỏ ngày không đúng `YYYY-MM-DD`; bỏ chỉ số `blocked_by` trỏ ra ngoài hoặc tạo vòng; trường bị bỏ thành trống kèm basis rỗng ("không chắc thì để trống", QĐ 10). Với mỗi mục chạy `FindActiveDuplicateTask` theo dự án + cha đã chọn → `possible_duplicate {task_id, identifier, title}`. Với mỗi người phụ trách đề xuất, tính `assignee_drive_access` (`granted` | `unknown`) từ `drive_file_access` để hộp duyệt hiện dòng "Lan chưa xem được tài liệu trên Google Drive…".
6. Chèn `drive_task_proposals` (`status = ready`), audit `drive_file.read` (metadata: `purpose = task_proposals`, `google_email` của kết nối, `usage_event_id`) và `drive_task_proposal.created`. Trả lô.

Không có nội dung tài liệu trong log, trong audit hay trong dòng lô ngoài `excerpt.quote` đã giới hạn.

### 8.3 Đọc nội dung (Q8)

| Loại | Cách đọc | Giới hạn |
| --- | --- | --- |
| Google Docs | `files.export` `text/markdown` (lùi về `text/plain`) | |
| Google Sheets | `files.export` `text/csv` (trang tính đầu) | |
| Google Slides | `files.export` `text/plain` | |
| PDF | `files.get?alt=media` → media part qua `Attachments` | 10 MiB |
| `text/plain`, `text/markdown` | `files.get?alt=media` | 1 MiB |
| Khác (DOCX, XLSX, PPTX, ảnh…) | 422 `drive_format_unsupported`: "UNI chưa đọc được định dạng này." | |

Văn bản cắt ở 200.000 ký tự, `Request.Truncated = true`, hộp duyệt hiện "UNI chỉ đọc phần đầu tài liệu". Export của Google giới hạn 10 MB. Mọi gọi Drive đi tới host Google cố định (`www.googleapis.com`) bằng client 15 s; không cần netguard (như Calendar), nhưng client không theo redirect ra ngoài `*.googleapis.com` / `*.googleusercontent.com`.

### 8.4 Hộp duyệt (3.3)

- Tiêu đề "UNI đề xuất N việc từ tài liệu"; "Nguồn: <tên> (<loại> · <email>)"; nhãn "Riêng tư trên Google Drive" khi `drive_shared = false`.
- "Áp dụng cho cả lô": **Dự án** (mặc định dự án của việc ngữ cảnh), **Task cha** (mặc định việc ngữ cảnh, có thể bỏ trống), **Trạng thái** (mặc định trạng thái đầu của nhóm "Cần làm" của workspace). Đổi dự án hoặc cha → client gọi lại `POST …/task-proposals/{proposalID}/duplicates` `{project_id, parent_task_id, titles[]}` để tính lại "Có thể trùng".
- Cảnh báo QĐ 11 khi tệp riêng tư: "Mô tả có trích đoạn từ tài liệu riêng tư. Ai xem được việc đều đọc được đoạn trích, kể cả người chưa có quyền trên Google Drive." + công tắc **"Bỏ trích đoạn, chỉ giữ liên kết"**.
- Mỗi việc (bật/tắt từng việc): tiêu đề, Người phụ trách, Độ ưu tiên, Ngày bắt đầu, Hạn, Nhãn (chọn từ nhãn có sẵn), dưới mỗi trường UNI điền là dòng "UNI · <basis>" (màu `text-warning-foreground` hoặc token tương đương, không mã màu cứng); "Bị chặn bởi: <tiêu đề>"; Mô tả gấp/mở gồm "Mục tiêu", "Việc cần làm" (checklist), "Nguồn: <mục>: "<trích>" · <tên tài liệu>" (liên kết). Trùng: "Có thể trùng với UNI-1037 · … đang mở." + **Bỏ việc này** / **Vẫn tạo**. Người phụ trách chưa có quyền Drive: "<tên> chưa xem được tài liệu trên Google Drive. Sau khi tạo, <tên> thấy việc và tên tài liệu, kèm nút xin quyền gửi tới chủ sở hữu." — "nút xin quyền" là **Mở trên Google Drive**, nơi Google có nút "Yêu cầu quyền truy cập"; UniWork không tự gửi (QĐ 5).
- Chân hộp: "UNI điền sẵn các trường, bạn sửa được trước khi tạo. Dòng chữ dưới trường là căn cứ của UNI; trường nào UNI không chắc thì để trống. Mỗi việc có liên kết về tài liệu." + **Hủy** (→ `discarded`) / **Tạo N việc**.
- Không có: thuộc tính tùy chỉnh, đính kèm, stage (QĐ 10).

### 8.5 Tạo lô (xác nhận của người)

`POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/tasks` body `{project_id?, parent_task_id?, status?, strip_excerpts, items: [{index, title, description, assignee_id?, priority?, start_date?, due_date?, label_ids[], blocked_by_indexes[], allow_duplicate}]}` (1..20) → `{task_ids, items[{index, task_id}]}`.

- Chỉ người yêu cầu lô gọi được (người duyệt = người đã đọc bằng quyền của mình); lô `ready` và chưa hết hạn, không thì 409 `proposal_not_ready` / 410 `proposal_expired`.
- `TaskService.CreateManyWith` với actor `service.Human(người gọi)`:
  - `Before`: khóa dòng lô `FOR UPDATE`; kiểm mục đã tạo (409 `proposal_item_already_converted`); kiểm người phụ trách, dự án, cha, nhãn thuộc workspace; chặn trùng theo lô như `refuseSummaryDuplicates` (bỏ qua mục có `allow_duplicate`); kiểm `blocked_by_indexes` chỉ trỏ vào mục trong cùng yêu cầu và không vòng.
  - Mỗi việc: mô tả do client dựng từ mục tiêu + checklist + (trích đoạn + liên kết, hoặc chỉ liên kết khi `strip_excerpts`); server kiểm lại rằng khi `strip_excerpts = true` mô tả không chứa `excerpt.quote` của mục. Liên kết tệp Drive vào mỗi việc mới (`drive_file_task_links`).
  - `After`: ghi `task_dependencies` (`blocked_by`) qua cùng đường với `SetDependency` (kiểm vòng); chèn `drive_task_proposal_links`; đặt lô `converted` (mục không chọn coi như bỏ); audit `drive_task_proposal.tasks_created` (metadata `drive_file_id`, `count`, `item_indexes`, `task_ids`, `strip_excerpts`, `google_email`); outbox `drive_task_proposal.converted` + các `task.created` do `CreateManyWith` phát sẵn.
- Toast (3.4): "Đã tạo N việc từ <tài liệu>, là sub-task của <cha>" (không có cha: "Đã tạo N việc từ <tài liệu>") + "Xem <cha>". Việc mới là việc bình thường ở Kanban, Danh sách, Bảng, Timeline, Swimlane (`packages/views/tasks/modes/`) — không có nhánh hiển thị riêng (QĐ 12); thẻ Kanban không có huy hiệu "Mới" lâu dài (huy hiệu prototype chỉ minh họa).

**Thuộc tính ADR 0010:** model chỉ sinh đề xuất vào `drive_task_proposals`; không lời gọi nào từ `internal/ai` tới service nghiệp vụ; việc chỉ được tạo bởi lệnh của người (`created_by_kind = human`, như "người bấm thì trực tiếp" ở Hệ quả của 0010). Nguồn gốc AI ghi ở `drive_task_proposal_links` và audit, không suy diễn.

### 8.6 Lưu giữ (Q3)

- Job trên lane chậm mỗi giờ xóa cứng `drive_task_proposals` có `expires_at < now()` hoặc `status IN ('converted','discarded')` quá 1 giờ, theo lô 500 dòng, an toàn đa replica (`FOR UPDATE SKIP LOCKED`, ADR 0025). Xóa lô không phải lệnh nghiệp vụ nên không ghi audit từng dòng; một dòng audit hệ thống `drive_task_proposal.purged` mỗi lần chạy có số lượng (actor `system`), như các job dọn hiện có.
- Ngắt kết nối hoặc bỏ liên kết tệp: lô `ready` của tệp đó chuyển `discarded` trong cùng transaction.

## 9. Hỏi UNI với tệp Drive (3.2)

- "Hỏi UNI" trên thẻ Drive hoặc 4.2 mở panel Hỏi UNI (`packages/views/ai/ask-uni-panel.tsx`) với chip "Kế hoạch ra mắt Q4 — UNI đang dùng tài liệu này làm ngữ cảnh" và dòng "Nội dung tài liệu xem trên Google Drive. UNI đọc tệp bằng tài khoản <email> khi trả lời."
- Server: tool đọc mới `read_drive_file {drive_file_id}` trong `askuni_agent_tools.go`, chỉ đọc (`TestAskUniToolsAreReadOnly` giữ), dùng `drive_file_access` của người hỏi (không có → kết quả công cụ "người dùng chưa cho UniWork đọc tệp này", không lỗi), cùng bảng định dạng §8.3, nội dung bọc "không tin cậy". Mỗi lần đọc một dòng audit `drive_file.read` (`purpose = ask_uni`).
- Câu trả lời có trích dẫn "<tài liệu> · mục N" (liên kết mở trên Google) và gợi ý "Tạo việc từ tài liệu này" → §8.2. Không lưu nội dung; chân panel "UNI đọc tài liệu khi trả lời, không lưu bản sao nội dung."
- Hội thoại Hỏi UNI hiện có lưu tin nhắn; câu trả lời của UNI có thể trích nội dung tài liệu và được lưu như mọi câu trả lời khác — đúng NFR-03 sửa đổi (người hỏi đã đồng ý, chỉ người hỏi thấy hội thoại của mình).

## 10. Flag, cấu hình, quan sát

- Flag `drive_connector` (`keys.go`): `Default: false`, `Public: true`, `Owner: "work"`, `ReviewAt: day(2027, 4, 30)`, mô tả "Connector Google Drive: kết nối, liên kết tệp, UNI đề xuất việc (UNI-2172, ADR 0038)". Tắt flag ẩn mọi lối vào web và route trả 404 `feature_disabled`; tham chiếu và kết nối giữ nguyên.
- Env: `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_PICKER_API_KEY`, `GOOGLE_DRIVE_APP_ID`, `DRIVE_CREDENTIAL_KEY` → `.env.example`, `config.Config`, `main.go` (cùng nhóm với khóa Calendar).
- `GET /api/v1/config` báo `drive.available` (provider sẵn sàng + flag) cho web.
- Metric Prometheus: `drive_api_requests_total{op, status}`, `drive_token_refresh_failures_total`, `drive_task_proposals_total{result}`. Log chỉ id (`scripts/no-pii-log.test.mjs`): không email Google, không tên tệp, không nội dung.
- Alert `DriveTokenRefreshFailuresHigh` + runbook `docs/runbooks/drive-connector.md` bốn mục (`scripts/alerts-runbooks.test.mjs`).

## 11. Audit và sự kiện

Mọi lệnh đổi trạng thái ghi `audit_events` + `outbox_events` trong cùng transaction qua `audit.Recorder.Record` (`server/internal/audit/audit.go:119`); thêm vào `audit_coverage_test.go`. Metadata mọi dòng Drive có `google_email` của kết nối liên quan (QĐ 13); `ResourceType` là `drive_connection`, `drive_file` hoặc `drive_task_proposal`.

| Action | Khi | Event (ids-only) |
| --- | --- | --- |
| `drive_connection.connected` / `.reconnected` | callback thành công | `drive_connection.changed {connection_id, user_id}` — ScopeUser |
| `drive_connection.refused` | miền, dùng chung, admin Google chặn | — |
| `drive_connection.auth_failed` | refresh `invalid_grant` | `drive_connection.changed` |
| `drive_connection.disconnected` | người dùng hoặc admin ngắt | `drive_connection.changed` |
| `organization.drive_policy_changed` | đổi miền / dùng chung | — |
| `drive_file.linked` | liên kết mới | `drive_file.linked {drive_file_id, workspace_id}` — ScopeWorkspace |
| `drive_file.access_granted` | người xem cho UniWork đọc | `drive_file.access_changed {drive_file_id, workspace_id, user_id}` — ScopeUser |
| `drive_file.task_link_added` / `.task_link_removed` | gắn/bỏ khỏi việc | `drive_file.task_linked {drive_file_id, task_id, workspace_id}` — ScopeWorkspace |
| `drive_file.unlinked` | bỏ liên kết cả tệp | `drive_file.unlinked {drive_file_id, workspace_id}` |
| `drive_file.rebound` | liên kết lại bằng tài khoản khác | `drive_file.updated {drive_file_id, workspace_id}` |
| `drive_file.read` | UNI đọc (đề xuất, Hỏi UNI) | — |
| `drive_task_proposal.created` / `.discarded` | lô tạo / hủy | — (chỉ người yêu cầu thấy, đọc qua query) |
| `drive_task_proposal.tasks_created` | tạo lô | `drive_task_proposal.converted {proposal_id, workspace_id}` + `task.created` sẵn có |
| `drive_task_proposal.purged` | job dọn | — |

Ba bản catalogue (`docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`) thêm cùng lúc; `scripts/events-catalogue.test.mjs`. Client: `drive_file.*` vô hiệu `driveKeys.workspace(wsId)` và `taskKeys.driveFiles` của việc trong payload; `drive_connection.changed` vô hiệu `driveKeys.connections()`. Không frame nào được ghi vào store/query (không có `Patch`).

## 12. ADR nháp 0038

`docs/adr/drafts/0038-google-drive-chi-tham-chieu-doc-bang-ket-noi-cua-chinh-nguoi-dung.md` (`proposed`) ghi bốn quyết định, mỗi cái đổi hoặc làm rõ một luật:

1. Tham chiếu tệp ngoài không phải dòng `documents` (phạm vi ADR 0016 là byte).
2. Nội dung Drive chỉ đọc bằng kết nối của chính người yêu cầu; không route, job hay tool nào đọc bằng kết nối của người khác. Guard dự kiến: `TestDriveContentReadsUseTheCallersConnection` (service test) và test arch: chỉ `service/drive_content.go` gọi export/`alt=media`.
3. NFR-03 sửa đổi: AI đọc nội dung riêng tư với consent của người yêu cầu, không lưu ngoài trích đoạn người duyệt giữ — áp ADR 0010 §6 (ngữ cảnh chỉ gồm dữ liệu người khởi tạo được đọc), không thêm ngoại lệ cho 0010.
4. Token Google không rời server: trình duyệt chỉ nhận access token `drive.file` ngắn hạn của chính người đó cho Picker; app desktop không nhận token Google nào (cùng tinh thần ADR 0034).

Khi người dùng duyệt spec: ADR chuyển ra `docs/adr/`, `accepted`, thêm vào bảng README và `CLAUDE.md` (mục Audit and Events) cùng test giữ luật, trong PR đầu tiên của phần BE.

## 13. Cách ly tenant và quyền

- Mọi query trên bảng mới ràng buộc `organization_id`/`workspace_id` bằng tham số hoặc có dòng `-- tenant:` (`TestEveryQueryNamesItsTenant`); `drive_connections` theo `self` (`user_id` của phiên) cộng `organization_id`.
- `isoRoutes`: callback `GET /api/v1/drive-connections/google/callback` → `isoPublic`, `reasonProvider` (như Email Hub `isolation_routes_test.go:483`); các route `/me/drive-connections…` → `isoSelf`; `/orgs/{orgID}/drive-policy` mặc định `isoScoped`; route theo `{workspaceID}`, `{taskID}`, `{driveFileID}`, `{proposalID}` mặc định `isoScoped`. Tham số mới `{connectionID}`, `{driveFileID}`, `{proposalID}` cần `pathParamSDI` (`server/internal/handler/router/openapi.go`).
- `isoReferences`: `connection_id`, `task_id`, `drive_files[].connection_id`, `project_id`, `parent_task_id`, `context_task_id`, `assignee_id`, `label_ids`, `items[].assignee_id`, `items[].label_ids` (`TestEveryBodyIDFieldHasAReferenceCase`).
- Seed `isolation_world_test.go` có một dòng mỗi bảng mới; gọi Google trong test bằng fake transport (không gọi mạng).
- Quyền: liên kết / gắn vào việc — người sửa được việc (cổng đính kèm hiện có); bỏ khỏi việc — người sửa được việc; bỏ liên kết cả tệp, liên kết lại — người liên kết hoặc admin workspace/tổ chức; xem danh sách — thành viên workspace; khách workspace: chỉ thấy thẻ trên việc họ xem được, không có lối "Từ Google Drive"; agent: không route Drive nào ở v1. Thành viên bị vô hiệu hóa: kết nối của họ bị coi như ngắt (không đọc được), tham chiếu ở lại; admin có thể liên kết lại.
- Đóng tổ chức (ADR 0032): job đóng thu hồi mọi kết nối Drive ở Google.

## 14. API client

`packages/core/api/endpoints/drive.ts` (mỗi hàm qua `parseWithFallback`, schema khoan dung, enum server là `z.string()`), `drive.test.ts` có ca response hỏng cho từng endpoint; hook trong `packages/core/drive/` với `driveKeys` (khóa workspace luôn có `wsId`). Mutation liên kết/bỏ liên kết/tạo lô chờ server (không optimistic: tạo, xóa). `CreateTaskBody` thêm `drive_files`.

## 15. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| `setFileIds` không chọn sẵn hoặc không cấp `drive.file` cho người thứ hai | Spike S2 trước mọi việc FE của §7.4; phương án dự phòng: Picker mở ở "Được chia sẻ với tôi" kèm ô tìm theo tên. |
| Brand verification chậm hoặc bị yêu cầu thêm | Nộp ngay khi có domain + privacy policy (phụ thuộc ngoài E1); trong lúc chờ, test user (≤ 100) trên client chưa xác minh. |
| Model bịa người phụ trách/ngày | Chuẩn hóa server bỏ id lạ; basis bắt buộc cho trường được điền; người duyệt sửa trước khi tạo. |
| Prompt injection trong tài liệu | Nội dung bọc "không tin cậy"; output chỉ là JSON đề xuất; không tool ghi; người duyệt từng mục. |
| Tên tệp riêng tư lộ trong workspace | Q6 + cảnh báo khi chọn. |
| Access token Picker ở trình duyệt | Chỉ access token `drive.file` ngắn hạn của chính người đó; không refresh token; không log. |

## 16. Kiểm thử

- Go: OAuth start/callback với fake Google (nonce, PKCE, miền, dùng chung, admin chặn, không refresh token); refresh + `invalid_grant`; liên kết/khử trùng/rebind; `drive_file_access` chọn đúng kết nối (`TestDriveContentReadsUseTheCallersConnection`); đề xuất với fake gateway (chuẩn hóa id lạ, ngày sai, vòng phụ thuộc, trùng); tạo lô (trùng, stale, đã tạo, strip excerpt, phụ thuộc); job dọn; audit coverage; isolation matrix; events catalogue.
- TS: endpoint malformed; hook vô hiệu realtime; `attachments-section` hai danh sách + "Thêm tệp"; hộp tạo việc menu kẹp giấy và chip dán URL; agent panel; hộp duyệt (basis, trống khi không chắc, trùng, strip, phụ thuộc); sidebar Google Drive hiện/ẩn; 4.2 bỏ liên kết.
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

- Mục **Google Drive** ngay dưới "Thư mục của tôi", kèm tổng số; chỉ hiện khi capability `drive_connector` bật **và** người dùng có ít nhất một kết nối (`GET /me/drive-connections`). Mục con: "Drive: <email>" mỗi kết nối (số; dấu "Mất kết nối" khi `auth_failed_at`), "Người khác liên kết".
- Danh sách dùng `GET /workspaces/{ws}/drive-files` (cùng tham số `connection_id`, `linked_by=others`) với cột như web §7.6: Tên, Mở bằng tài khoản, Quyền trên Google Drive, Đang dùng ở. Không trộn vào cây, tìm kiếm hay "Gần đây" của app.
- Dòng thuộc kết nối hỏng: "Mất kết nối · kết nối lại" → chuyển sang web (§17.4).
- Không có hành động offline, đổi tên, di chuyển, xóa, mở trong app trên dòng Drive. Nhấp đúp hoặc Enter = "Mở trên Google Drive".
- Offline (sync center báo `offline`, hoặc request trả lỗi mạng): nút vẫn hiện nếu lần trước có kết nối, màn hiện "Cần kết nối mạng để xem tệp Google Drive." + "Thử lại"; không lưu danh sách xuống đĩa.

### 17.3 Panel chi tiết (Q9)

- Chọn một dòng Drive mở panel phải trong DocumentsHome, bố cục theo `UniworkDocInfoPanel`: tên, loại, sửa lần cuối, Nguồn, Mở bằng tài khoản, Chủ sở hữu, Người liên kết + ngày, Quyền "Theo chia sẻ trên Drive", Đang dùng ở · N (mỗi việc mở web qua `webPathOf` kiểu `task`), Hoạt động (từ `GET …/drive-files/{id}` như web).
- Nút: **Mở trên Google Drive**, **Tạo việc từ tài liệu** (web), **Hỏi UNI** (web), **Bỏ liên kết** (cùng hộp xác nhận và câu chữ như web; chỉ người liên kết hoặc admin — server quyết, app ẩn nút khi SDO báo `can_unlink = false`).
- "Liên kết lại bằng tài khoản khác" cần Picker → chuyển sang web (trang 4.2).

### 17.4 Chuyển giao sang trình duyệt / web

| Hành động | App làm gì |
| --- | --- |
| Mở trên Google Drive | IPC mới `uniwork-drive:open-on-google {driveFileId}`: main gọi `GET …/drive-files/{id}`, lấy `open_url` (đã có `authuser` của người xem, §6.3), kiểm host thuộc `docs.google.com` / `drive.google.com` và `https`, rồi `shell.openExternal`. Renderer không bao giờ truyền URL. |
| Thêm từ Google Drive / Liên kết tệp | `openWeb` đích `drive-pick` → `/{org}/{ws}/documents/drive?pick=1` (web W8 mở Picker ngay). Google chặn đăng nhập trong webview nhúng, nên Picker và consent luôn chạy ở trình duyệt (spike S5). |
| Kết nối / Kết nối lại | đích `drive-connect` → `/{org}/{ws}/settings?tab=integrations&connect=drive` (web W2). |
| Tạo việc từ tài liệu | đích `drive-file` + `action=propose` → `/{org}/{ws}/documents/drive/{driveFileID}?propose=1` (web mở hộp agent/đề xuất). |
| Hỏi UNI | đích `drive-file` + `action=ask` → `…/documents/drive/{driveFileID}?ask=1`. |
| Việc trong "Đang dùng ở" | đích `task` sẵn có. |

Sau khi chuyển giao, app làm mới danh sách khi cửa sổ lấy lại focus. Mọi id đi qua kiểm `/^[A-Za-z0-9_-]{1,128}$/` sẵn có của `webPathOf`.

### 17.5 Không token Google trong app

App chỉ gọi API UniWork bằng phiên UniWork sẵn có ở main. Không route nào trả token Google cho app: `picker-token` (§7.1) từ chối phiên desktop (kiểm loại phiên ở handler, test `TestDrivePickerTokenRefusesDesktopSession`), vì app không chạy Picker. Đúng tinh thần ADR 0034 (khóa không rời server) và ADR nháp 0038 §4.

### 17.6 i18n app

Khóa mới trong `src/renderer/src/i18n/uniwork-home/zh.ts` và 20 locale còn lại: `uhNavGoogleDrive`, `uhNavDriveAccount` ("Drive: {email}"), `uhNavDriveOthers`, `uhDriveColName`, `uhDriveColAccount`, `uhDriveColAccess`, `uhDriveColUsedIn`, `uhDrivePrivate`, `uhDriveShared`, `uhDriveLost`, `uhDriveReconnect`, `uhDriveOpenOnGoogle`, `uhDriveAddFromDrive`, `uhDriveCreateTasks`, `uhDriveAskUni`, `uhDriveUnlink`, `uhDriveUnlinkConfirm*`, `uhDriveOffline`, `uhDriveNotUsed`, `uhDriveUsedIn*`. Câu tiếng Việt và tiếng Anh lấy đúng từ web (`drive.*`) để hai bên đồng bộ; 19 ngôn ngữ còn lại dịch theo quy trình dịch hiện có của fork. `tests/i18n-key-parity.test.ts` giữ.
