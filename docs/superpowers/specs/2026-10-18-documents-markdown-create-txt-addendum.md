# Documents — Phụ lục hợp đồng: Tạo "Tệp Markdown" và mở `.txt` trên web (UNI-1813)

> **Trạng thái:** in-progress — v0.2 hợp đồng (chốt quyết định Advisor ngày 2026-10-18), ngày 2026-10-18. Thẻ: **UN-02 (UNI-1813)** trong [plan G5-G6-G7 §5.9](../plans/2026-10-12-office-g5-g6-g7.md) và brief `app-folders-uninote-handoff-2026-10-16.md` §U-UN2; phụ thuộc chế độ `plain` ở fork (**UNI-1905**, `lead-g6-fork_ui`). Phạm vi tài liệu này: hợp đồng phần **server + `packages/core`**; phần menu/copy/mở khung trên web thuộc lane **e6-web**, phần editor/app thuộc **fork** (`uniwork-office`). Tải ảnh lên: ngoài phạm vi.

**Quan hệ:** [Documents C-01](2026-09-08-documents-design.md), [phụ lục Share SRS](2026-10-15-documents-share-srs-addendum.md) (SH-S1 / U-SH2: mặc định riêng tư ở gốc), [phụ lục My Folder](2026-10-16-documents-my-folder-addendum.md) (`destination: "my_folder"`).
**Hiện trạng đọc tại:** nhánh `feature/UNI-1813-markdown-create-txt` @ `b5388f37d` (root G5-G7).

---

## 1. Hiện trạng "Tệp Markdown" (`format = "md"`) — những gì đã chạy đầu-cuối và phần còn thiếu

### 1.1 Đã có sẵn trên server và `packages/core` (chạy đầu-cuối)

| Mắt xích | Hiện trạng trong code | Trích dẫn `file:line` |
| --- | --- | --- |
| Route HTTP & SDI/SDO | `POST /api/v1/workspaces/{workspaceID}/documents/files/blank` nhận `CreateBlankDocumentFileSDI{Format, Title, ParentID, Destination, Visibility}` + header `Idempotency-Key`, trả `201 Created` kèm `sdo.DocumentSDO`. Handler kiểm `service.ValidOfficeFormat(in.Format)` rồi gọi `h.Office.CreateBlankFile`, đọc lại qua `h.respondDocumentCreated` để trả kèm `file` và `breadcrumbs`. | `server/internal/handler/router/documents.go:367-377`, `server/internal/handler/dto/sdi/office.go:45-51`, `server/internal/handler/office.go:192-215, 238-245` |
| Seed & thực thi engine | `parseOfficeFormat("md")` hợp lệ. `blankSeedFor(FormatMD, title)` sinh seed UTF-8 không rỗng `[]byte("# " + name + "\n")` (`name` = `title` đã trim hoặc `"Untitled"` nếu trống) và tên tệp lưu trữ `"untitled.md"`. `blankViaEngine(FormatMD)` là `true` → server thương lượng capability `serialize`, đăng ký `RegisterProviderOutput`, gửi job `serialize` cho `office-engine` (`"serialize:md": serializeText` kiểm UTF-8 rồi ghi nguyên bytes), xác minh qua `CompleteProviderOutput` và tạo tài liệu qua `DocumentService.CreateFileDocument` với provenance `officeEngineInfo()`. | `server/internal/service/document_office_view.go:93-101`, `server/internal/service/document_office_capability.go:303-460, 552-586`, `apps/office-engine/src/worker/handlers.ts:63-73, 397` |
| MIME & nhận diện định dạng | `CreateFileDocument` tải seed lên với `Filename: "untitled.md"` → `files.DetectContentType` thấy UTF-8 + đuôi `.md` trong `textByExtension` nên gắn `ContentType = "text/markdown"`. Khi mở lại, `officeFormatForFile` khớp `.md`/`.markdown` → `FormatMD`; `officeFrameModuleOf` ánh xạ `FormatMD` → module `"markdown"` (cờ `office_markdown_web`, mặc định bật). | `server/internal/files/detect.go:64-73, 122-127`, `server/internal/service/document_office_capability.go:196-218`, `server/internal/service/office_frame_module.go:28-70`, `server/internal/featureflags/keys.go:46, 50` |
| Mặc định riêng tư (U-SH2) & đích tạo (My Folder) | `CreateBlankFile` chuyển tiếp `ParentID`, `Destination`, `Visibility` xuống `CreateFileDocument`. Ở gốc (`ParentID == ""` và `Destination == ""`), `createHomeRow("", nil)` đặt `visibility = "restricted"`. Khi gửi `destination: "my_folder"` (mặc định của web ở trang Home), `ensureMyFolderInTx` khởi tạo/lấy Thư mục của tôi (`visibility = "restricted"`) và tài liệu mới kế thừa `restricted` từ cha. Đi kèm cả `parent_id` lẫn `destination` → `400 invalid_destination`. | `server/internal/service/document_files.go:356-365, 434-449`, `server/internal/service/document_pages.go:146-161`, `server/internal/service/document_my_folder.go:115-165` |
| Audit & Outbox (ADR 0009) | Trong cùng transaction tạo tài liệu và version 1, `CreateFileDocument` ghi `audit.ActionDocumentCreated` (`changes`: `title`, `kind: "file"`, `visibility`, `version_id`, `file_id`) và phát sự kiện outbox `document.created` với payload chỉ chứa ID (`document_id`, `workspace_id`). | `server/internal/service/document_files.go:480-496`, `docs/events/CATALOGUE.md:146` |
| Feed đồng bộ & Realtime | `document.created` nằm trong `feedDocumentActions` và `feedGrantActions` của `GET /api/v1/workspaces/{workspaceID}/documents/changes` → trả dòng `upsert` (`Kind: "file"`, `Revision: 1`, `CurrentVersion: 1`, `FileVersionID`). Trên web, `packages/core/realtime/document-events.ts` bắt `document.created` để invalidate `documentKeys.workspace(wsId)`. | `server/internal/service/document_changes_feed.go:182, 207`, `server/internal/handler/router/documents.go:532`, `packages/core/realtime/document-events.ts:43-64` |
| Headless `packages/core` & Web UI hiện có | `BLANK_DOCUMENT_FORMATS` đã có `"md"`, hàm `createBlankDocumentFile` và hook `useCreateBlankFile` đã nối sẵn. Trên web, `CREATE_TYPES` đã có `"md"`; chip nhanh đã hiển thị `"Tệp Markdown"` (vi) / `"Markdown file"` (en); `officeModuleForFormat("md")` trả `"markdown"` và pin `apps/web/platform/office-frame/markdown.pin.json` đã có. | `packages/core/api/endpoints/documents-blank.ts:15-41`, `packages/core/documents/hooks-library.ts:90-109`, `packages/views/documents/documents-create.ts:13-63`, `packages/core/office/office-modules.ts:63` |

### 1.2 Các điểm cần lưu ý / còn thiếu quanh "Tệp Markdown"

1. **`md` có cần `office-engine` đang chạy không?**
   - **Hiện trạng:** Có. `blankViaEngine(FormatMD)` trả `true` (`document_office_capability.go:584-586`). Nếu server không cấu hình engine (`h.Office == nil` hoặc `s.engine == nil`), route trả `503 Service Unavailable` với mã `office_not_configured` (`server/internal/handler/office.go:47-48, 193-196`, `document_office_capability.go:323-325`). Nếu engine quá hạn hoặc sập, trả `504 engine_timeout` / `502 engine_crashed` (`office/contract.go:138-140`).
   - **Nhận xét:** Khác với `xlsx`/`pdf`, trình xử lý `"serialize:md"` ở engine (`apps/office-engine/src/worker/handlers.ts:63-73`) chỉ kiểm UTF-8 hợp lệ rồi chép nguyên byte seed `# <title>\n` của chính Go sinh ra. Tuy nhiên `TestDocumentOfficeBlankRefusals` (`:227-231`) và `TestDocumentOfficeBlankCreateWaitsForTheEngine` (`:301-383`) đang ghim rõ hành vi `FormatMD` đi qua engine để đóng dấu provenance engine lên version 1.
   - **Quyết định hợp đồng:** **Giữ nguyên** đường qua engine cho `FormatMD` (không đổi `blankViaEngine`), vì `office-engine` là thành phần bắt buộc của triển khai Office và các bài kiểm chứng cứ G2-07a đã ghim. Trên web (e6-web), lưu ý `isEndpointMissing` (`packages/core/documents/hooks-library.ts:42-44`) chỉ bắt `404`/`501`; khi gặp `503 office_not_configured` thì toast lỗi theo `documentErrorMessage` như hiện tại.
2. **Tiêu đề mặc định (`Title`) và tên tệp lưu trữ (`.md` filename):**
   - **Trên server:** Khi `in.Title` chỉ gồm khoảng trắng, `blankSeedFor` dùng `"Untitled"` cho dòng `# Untitled\n`, và `CreateFileDocument` rơi về `files.SanitizeFilename("untitled.md")` → tiêu đề tài liệu thành `"untitled.md"` (`document_files.go:366-372`). Tên tệp trong `FileService` luôn là `"untitled.md"` (giống hệt `"untitled.docx"`, `"untitled.xlsx"` của 5 định dạng kia); khi tải về hoặc mở khung, `currentFileInfo` (`document_pages.go:518-539`) trả `file.filename = "untitled.md"` còn `document.title` giữ tiêu đề người dùng.
   - **Trên web (e6-web):** Client luôn gửi `title: t("documents.home.default_names.md")` = `"Markdown chưa đặt tên.md"` (vi) / `"Untitled markdown.md"` (en) (`packages/core/i18n/locales/vi.json:9503`, `en.json:9509`). Điểm duy nhất lệch với brief §U-UN2 trên web là nhãn trong **menu thả xuống** `documents.home.create.md.menu` đang là `"Markdown"` (cả vi và en — `vi.json:9569`, `en.json:9575`) trong khi chip nhanh `documents.home.create.md.chip` đã là `"Tệp Markdown"` / `"Markdown file"`. Lane **e6-web** chỉ cần đồng bộ `documents.home.create.md.menu` thành `"Tệp Markdown"` (vi) và `"Markdown file"` (en).

---

## 2. Quyết định kiến trúc cho việc mở `.txt` trên web

### 2.1 Hiện trạng khi tải lên và mở tệp `.txt` hôm nay

- **Tải lên đã chạy:** `documentMIMETypes` trong `server/internal/files/registry.go:237` đã cho phép `"text/plain"`. Khi người dùng tải lên `ghi-chu.txt`, `files.DetectContentType` (`server/internal/files/detect.go:64-73, 122-127`) sniff ra `"text/plain"`, thấy `.txt` không nằm trong `textByExtension` nên giữ nguyên `ContentType = "text/plain"` và lưu `Filename = "ghi-chu.txt"`.
- **Chặn ở tầng Office & Frame:**
  - `officeFormatForFile` (`document_office_capability.go:196-218`) không có nhánh `.txt`; rơi xuống `officeFormatFromMime("text/plain")` (`:222-243`) trả `("", false)`.
  - Do đó: `GET /documents/{id}/office/capabilities` trả `501 unsupported_operation` (`reason: "format_not_supported"`, `:186-188`); `POST /documents/{id}/office/frame-token` (`office_frame.go:260-263` → `officeFrameModuleOf`) trả `404 not_found`.
  - Trên client: `officeFormat(doc)` (`packages/views/documents/document-file-view.tsx:81-91`) trả `null` và `detectDocumentFormat(doc)` (`apps/web/platform/office-frame/document-host.tsx:31-42`) trả `"unknown"` → trang chi tiết chỉ hiện thẻ tải tệp, không mở khung soạn thảo.
  - Ở phía desktop (repo fork `uniwork-office`), trình soạn Markdown đã có sẵn chế độ văn bản thường CodeMirror (`apps/markdown/src/shared/text-mode.ts:1-18`: mọi đường dẫn không khớp `\.(md|markdown)$` hay `\.json$` đều trả `TextMode = 'plain'`, tắt block editor để không diễn giải `---`, `*x*`, `1.` và không chuẩn hóa xuống dòng), nhưng `apps/shell/src/main/uniwork-docs/formats.ts:12-33` chưa khai báo `txt` / `text/plain`.

### 2.2 So sánh 3 phương án

| Tiêu chí | **(a) Thêm format engine mới `txt`** | **(b) Mở `.txt` qua lane `md` ở chế độ `plain` (TextMode)** | **(c) Xem trước văn bản chỉ-đọc trên web (không qua Office frame)** |
| --- | --- | --- | --- |
| **Server (`server/`)** | Thêm `office.FormatTXT = "txt"` (`office/contract.go:26-38`), mở rộng `parseOfficeFormat` (`document_office_view.go:93`), `officeFormatForFile` (`.txt` → `txt`), `officeFormatFromMime` (`text/plain` → `txt`), `officeFormatMime` (`FormatTXT` → `text/plain`). Phải quyết định `officeFrameModules` (`office_frame_module.go:28`) dùng module `"markdown"` hay module mới, và có thêm `"txt"` vào 6 làn lọc thư viện `files.DocumentFormats()` (`files/format.go:23-41`, đang ghim cứng 6 định dạng ở `format_test.go:45` và `document_search.go:103`) hay không. | **Thu hẹp theo đuôi `.txt` và chặn sau cờ `office_txt_open` (mặc định tắt):** Chỉ ánh xạ đuôi `.txt` (không phân biệt hoa thường) → `office.FormatMD` khi cờ `office_txt_open` bật; **tuyệt đối không** ánh xạ `text/plain` trần trong `officeFormatFromMime` (để `.csv`, `.log` hoặc bất kỳ tệp nào sniff ra `text/plain` không bao giờ mở nhầm trong khung). Cờ `office_txt_open` (trong `server/internal/featureflags/keys.go`, `Default: false`, `Public: true`, `Owner: "office"`, `ReviewAt: 2027-03-31`) chặn đồng thời đường mở tài liệu (capability, mint/authorize/open frame token) và đường "Từ nơi khác" (`can_open_in_app`, mint/authorize/open source frame token). Không thêm hằng `office.Format`, không đụng `files.DocumentFormats()` (6 làn lọc giữ nguyên). | Không sửa gì trên server. Web tải trực tiếp qua `GET /api/v1/documents/{id}/download` (`handler/documents.go:573`) và dựng `<pre>`. |
| **Engine (`apps/office-engine/` & `packages/office-contracts/`)** | **Phá vỡ hợp đồng đóng băng:** Phải sửa `officeFormats` (`packages/office-contracts/src/formats.ts:11`), cập nhật fixtures parity trong `packages/office-contracts/fixtures/`, thêm `"serialize:txt": serializeText` vào `HANDLERS` (`apps/office-engine/src/worker/handlers.ts:396`) và `capability.ts`. | **Không đổi dòng nào.** `"serialize:md"` đã dùng `serializeText` (chỉ kiểm UTF-8 hợp lệ rồi ghi nguyên byte, không hề phân tích hay biến đổi cú pháp Markdown). | Không chạm engine. |
| **`packages/core` & Frame Protocol** | Nếu giữ bảng 1-1 trong `scripts/office-modules.test.mjs:57-67`, phải mở rộng `OfficeModule` hoặc sửa bài test kiểm 1-1 giữa `officeFrameModules` (Go) và `OFFICE_MODULE_SPECS` (TS). Trong `docs-frame-api.ts:273, 347`, phải xử lý MIME/đuôi tệp khi lưu. | `OFFICE_MODULE_SPECS` và `scripts/office-modules.test.mjs` **giữ nguyên** (module vẫn là `"markdown"`, cờ module vẫn là `office_markdown_web`). Khi khung mở, `createOfficeFrameApi` (`packages/core/office/docs-frame-api.ts:347-355`) đã truyền sẵn `file: { name: doc.file.filename, mimeType: doc.file.mime_type }` trong `OpenPayload` — khung có đủ `name` (`"*.txt"`) để bật `TextMode = 'plain'` mà **không cần đổi `PROTOCOL_VERSION` hay thêm trường bắt buộc**. Sửa `docs-frame-api.ts` (`save` và `saveAs`) để khi tệp đang mở trong module `"markdown"` có đuôi `.txt` (hoặc `payload.name` trong `saveAs` kết thúc bằng `.txt`) thì giữ nguyên đuôi `.txt` và `type: "text/plain"` thay vì ép `.md` / `"text/markdown"`. | Không dùng frame protocol; phải viết màn hình/component riêng trên web (mất tìm kiếm trong trình soạn, mất đồng bộ khóa sửa R1, mất Lưu bản sao, mất phím tắt và AI panel của khung Office). |
| **Bảo toàn `.txt` & `text/plain` khi Save / Commit & luật trượt MIME (`officeOutputKeepsFormat`)** | Phải tách `text/plain` khỏi `officeFormatMime(FormatMD, ...)` (`:265`), nhưng làm vậy sẽ **làm hỏng** luật trượt MIME hiện tại của chính tài liệu `.md` khi output không tên của engine sniff ra `text/plain` (`document_commit.go:548-563`, ghim bởi `TestOfficeOutputKeepsFormat` tại `document_office_capability_test.go:398-399`). | **Tự nhiên khít với luật hiện có:** (1) Khi lưu từ khung web (`POST /office-frame/documents/{id}/uploads`), client gửi kèm `filename = current.file.filename` (`"ghi-chu.txt"`). Server chạy `DetectContentType(bytes, "ghi-chu.txt")` → ra `"text/plain"`, khớp đúng `current.MimeType.String` (`"text/plain"`) nên `document_commit.go:548` đi thẳng, lưu version mới với `mime_type = "text/plain"` và tên `"ghi-chu.txt"`. (2) Ngay cả khi đi qua job `serialize` của engine (output không tên), `officeOutputKeepsFormat("md", "text/plain", "text/plain")` trả `true` (`officeFormatMime(FormatMD, ...)` chấp nhận cả `text/markdown` lẫn `text/plain`), và `document_commit.go:562` gán `f.ContentType = current.MimeType.String` → version mới **vẫn giữ nguyên `"text/plain"`**, không bao giờ bị ghi đè thành `"text/markdown"`. | Không có lưu/sửa. |
| **Chuyển đổi (Convert) & Xuất (Export)** | Phải định nghĩa luật riêng cho `txt`. | `ConvertTargets` (`xls→xlsx`, `odt→docx`) và `ExportTargets` (`docx→pdf`) tại `office/contract.go:42-53` không chứa `md` nên không mở nhầm convert/export PDF trên server. Trên khung web, module `markdown` có `exportHtml: true`; với tệp `.txt` (`plain`), fork ẩn nút xuất HTML hoặc xuất `<pre>` thuần. | Không có. |
| **Cô lập tenant (ADR 0008)** | Không bảng mới, không route mới. | Không bảng mới, không route mới, không trường `*_id` mới trong SDI → `TestIsolationMatrix` và `TestEveryQueryNamesItsTenant` giữ nguyên. | Không đổi. |
| **Việc của e6-web & fork** | Đổi cả hai repo + engine + contract fixtures. | **e6-web:** nhận diện đuôi `.txt` trong `officeFormat` (`document-file-view.tsx:81`), `detectDocumentFormat` (`document-host.tsx:31`) và `sourceFormat` (`source-links.ts:36-50`) → trả `"md"` khi cờ `office_txt_open` đang bật (và bản pin khung web đã mang **UNI-1905**). **Fork (UNI-1905):** module web `markdown` dùng lại `textModeForPath(file.name)` (`apps/markdown/src/shared/text-mode.ts:9`) khi nhận `open` payload để vào chế độ `plain`; desktop thêm `txt` vào `uniwork-docs/formats.ts` nếu mở từ UniWork. | Chỉ đọc, lệch hành vi với desktop (desktop mở `.txt` sửa được bằng CodeMirror plain mode). |

### 2.3 Quyết định kiến trúc (Advisor chốt 2026-10-18)

> **Quyết định chốt (Advisor 2026-10-18): Chọn Phương án (b) thu hẹp theo đuôi `.txt`, đặt sau một công tắc duy nhất `office_txt_open` (mặc định tắt)** — chờ thẻ **UNI-1905** (`lead-g6-fork_ui`, chế độ `plain` trên khung web) và bản pin khung tương ứng trước khi bật.

**Các ràng buộc bắt buộc:**
1. **Chỉ ánh xạ theo đuôi `.txt` → `office.FormatMD`:** Không bao giờ ánh xạ `text/plain` trần trong `officeFormatFromMime`. Mọi tệp `.csv`, `.log` hoặc tệp không có đuôi `.txt` dù sniff ra `text/plain` đều giữ nguyên trạng thái không mở được trong khung (cả khi cờ tắt lẫn khi cờ bật).
2. **Lưu / Lưu thành bản sao (`save` / `saveAs`) trên tệp `.txt`:** Bảo toàn tên tệp `.txt` và `mime_type = "text/plain"` qua mọi vòng lưu và commit.
3. **Thêm `"txt"` vào `documentSourceAppExts` ("Từ nơi khác"):** Để tệp `.txt` từ Chat/Task/Meeting/Email mở xem chỉ-đọc trong khung khi công tắc bật.
4. **Một công tắc duy nhất `office_txt_open` (mặc định `false`):** Khai báo trong `server/internal/featureflags/keys.go` (`Default: false`, `Public: true`, `Owner: "office"`, `ReviewAt: day(2027, 3, 31)` — cờ chỉ ẩn capability, không bao giờ cấp quyền). Khi `office_txt_open` tắt, cả đường mở tài liệu (`GET .../office/capabilities`, `POST .../office/frame-token`, `GET /office-frame/documents/{id}`) lẫn đường "Từ nơi khác" (`can_open_in_app` trong `GET .../documents/sources`, `POST .../sources/{id}/office/frame-token`, `GET /office-frame/sources/{id}`) giữ nguyên hành vi hiện tại từng byte (`.txt` không mở được trong khung, tránh giai đoạn chuyển tiếp mà `.txt` bị render như Markdown trước khi pin **UNI-1905**).
5. **Hạng mục 1 ("Tệp Markdown"):** Không cần thay đổi gì trên server (xem §1).
---

## 3. Hợp đồng chi tiết cho lane `e6-web` (và phần `server` / `packages/core` đi kèm)

### 3.1 Hạng mục 1 — Tạo "Tệp Markdown" từ menu Mới

- **API gọi từ web (không đổi chữ ký):**
  - Endpoint: `POST /api/v1/workspaces/{workspaceID}/documents/files/blank`
  - Header: `Idempotency-Key: <ULID hoặc UUID v4>` (bắt buộc để retry an toàn)
  - Request body (`CreateBlankDocumentBody` tại `packages/core/api/endpoints/documents-blank.ts:18-24`):
    ```json
    {
      "format": "md",
      "title": "Markdown chưa đặt tên.md",
      "destination": "my_folder"
    }
    ```
    *(Khi đang mở một thư mục con: bỏ `destination`, gửi `"parent_id": "<folderULID>"`; hai trường loại trừ lẫn nhau).*
  - Response `201 Created` (`sdo.DocumentSDO` tại `server/internal/handler/dto/sdo/document.go:10-47`):
    ```json
    {
      "document": {
        "id": "01J...",
        "organization_id": "01J...",
        "workspace_id": "01J...",
        "parent_id": "01J...",
        "kind": "file",
        "title": "Markdown chưa đặt tên.md",
        "visibility": "restricted",
        "revision": "1",
        "current_version": 1,
        "my_level": "manage",
        "via": "owner",
        "file": {
          "file_id": "01J...",
          "version_id": "01J...",
          "version": 1,
          "filename": "untitled.md",
          "mime_type": "text/markdown",
          "size_bytes": 28,
          "checksum_sha256": "..."
        }
      }
    }
    ```
  - **Bảng mã lỗi HTTP:**
    | Status | `error.code` | Khi nào xảy ra | Hành vi client (`e6-web`) |
    | --- | --- | --- | --- |
    | `400` | `invalid_request` | `format` ngoài allowlist, `title` trống / > 500 ký tự, `visibility` khác `workspace\|restricted` | Toast lỗi qua `documentErrorMessage` |
    | `400` | `invalid_destination` | Gửi cả `parent_id` và `destination`, hoặc `destination != "my_folder"` | Toast lỗi |
    | `403` | `forbidden` / `member_deactivated` / `organization_suspended` | Không có quyền sửa thư mục cha hoặc tài khoản/tổ chức bị khóa | Toast lỗi quyền |
    | `404` | `not_found` | Không phải thành viên workspace hoặc `parent_id` không tồn tại | Toast lỗi |
    | `409` | `idempotency_payload_mismatch` / `engine_incompatible` | Trùng `Idempotency-Key` nhưng khác payload, hoặc lệch pin engine | Toast lỗi |
    | `501` | `unsupported_operation` | Định dạng không có blank generator (`xls`, `odt`) | `isEndpointMissing` đánh dấu `unavailable` trong phiên |
    | `503` | `office_not_configured` / `office_unavailable` | Server chưa cấu hình `office-engine` hoặc sai service token | Toast lỗi (`documents.home.create_failed`) |
    | `504` | `engine_timeout` | Job serialize tạo blank quá hạn (`blank_deadline`) | Toast lỗi, cho phép thử lại |
- **Việc của `e6-web` cho Hạng mục 1:**
  1. Cập nhật chuỗi i18n `documents.home.create.md.menu` trong `packages/core/i18n/locales/vi.json:9569` từ `"Markdown"` → `"Tệp Markdown"` và trong `packages/core/i18n/locales/en.json:9575` từ `"Markdown"` → `"Markdown file"` (khớp với `documents.home.create.md.chip` đã có sẵn ở `:9567` / `:9573` và đúng yêu cầu brief §U-UN2 không đặt tên "Ghi chú").
  2. Luồng điều hướng sau khi tạo (`onOpen(doc.id)`) và mở khung `OfficeModuleFrame` với `module="markdown"` đã hoạt động, không cần đổi cấu trúc component.

### 3.2 Hạng mục 2 — Mở `.txt` trên web (Phương án b thu hẹp, sau cờ `office_txt_open`)

- **Công tắc tính năng (`server/internal/featureflags/keys.go`):**
  - Khai báo cờ `office_txt_open` (`Default: false`, `Public: true`, `Owner: "office"`, `ReviewAt: day(2027, 3, 31)`).
  - Cờ được đánh giá theo ngữ cảnh `EvalContext{UserID, WorkspaceID, OrganizationID}` (ưu tiên override `user > organization > global` qua `DocumentService.flags`).
  - Điều kiện để bật cờ (`office_txt_open = true`): thẻ **UNI-1905** (`lead-g6-fork_ui`) hoàn tất chế độ `plain` cho tệp `.txt` trong module web `markdown` và `apps/web/platform/office-frame/markdown.pin.json` đã nâng lên bản build chứa UNI-1905.
- **Thay đổi phía Server (`server/`):**
  1. `server/internal/service/document_office_capability.go`:
     - `officeFormatFromMime`: **giữ nguyên**, tuyệt đối không ánh xạ `"text/plain"` (để `.csv`, `.log` hoặc tệp không đuôi `.txt` mang `text/plain` không bao giờ mở được).
     - Ở điểm phân giải định dạng cho tài liệu (`formatForVersion` / `officeFormatForFile`) và mở khung (`officeFrameModuleOf` trong `office_frame_module.go`, được gọi bởi `OfficeFrameService.load`, `Recents`, `MintSource`, `AuthorizeSource` và `AIUniworkService.documentScope`): chỉ khi tên tệp có đuôi `.txt` (không phân biệt hoa thường) **và** cờ `office_txt_open` đang bật cho tổ chức/người dùng thì mới ánh xạ sang `office.FormatMD` / module `"markdown"`. Khi cờ tắt, trả `("", false)` y hệt hiện tại (`capability` trả `501 format_not_supported`, `frame-token` trả `404 not_found`).
  2. `server/internal/service/document_sources.go`:
     - Thêm `"txt": true` vào `documentSourceAppExts`, nhưng chỉ đặt `CanOpenInApp = true` cho `ext == "txt"` khi cờ `office_txt_open` đang bật cho tổ chức/người dùng của request (`List`, `ViewSource`, `Open`). Khi cờ tắt, tệp `.txt` trong "Từ nơi khác" vẫn trả `can_open_in_app: false` và `MintSource` trả `404 not_found`.
  3. **Đường Commit / Save (`server/internal/service/document_commit.go:548-563` & `officeOutputKeepsFormat`):**
     - Giữ nguyên: tệp `.txt` đang có `current.MimeType.String = "text/plain"`; khi lưu bản mới tên `.txt` (`f.ContentType = "text/plain"`) hoặc qua job engine `FormatMD` (`officeOutputKeepsFormat("md", "text/plain", "text/plain") == true`), version mới luôn giữ nguyên `mime_type = "text/plain"` và tên tệp `.txt`.
  4. **Danh sách & bộ lọc thư viện (`files.DocumentFormats()`):** **Không** thêm `"txt"` vào 6 chip lọc định dạng (`docx, xlsx, pptx, pdf, md, html` tại `server/internal/files/format.go:23-41`).
- **API mở khung trên web (khi `office_txt_open` bật; không thêm route mới):**
  1. `GET /api/v1/documents/{documentID}/office/capabilities` → trả `200 OK` với `"format": "md"`. (Khi `office_txt_open` tắt → `501 unsupported_operation`, `reason: "format_not_supported"`).
  2. `POST /api/v1/documents/{documentID}/office/frame-token` → trả `201 Created` (`sdo.OfficeFrameTokenSDO` tại `server/internal/handler/dto/sdo/office_frame.go:6-18`) với `"module": "markdown"`. (Khi `office_txt_open` tắt → `404 not_found`).
  3. `GET /api/v1/office-frame/documents/{documentID}` (gọi bằng Bearer frame token) → trả `200 OK` (`sdo.OfficeFrameDocumentSDO` tại `dto/sdo/office_frame.go:24-40`) với:
     - `"module": "markdown"`
     - `"file": { "filename": "<name>.txt", "mime_type": "text/plain", "version": 1, "version_id": "...", "file_id": "...", "size_bytes": ..., "checksum_sha256": "..." }`
     - `"download_url": "/api/v1/office-frame/documents/{documentID}/content?version=1"`
     (Nếu cờ `office_txt_open` bị tắt sau khi đã mint token, mọi lời gọi `GET/POST /api/v1/office-frame/documents/{id}*` hoặc `/api/v1/office-frame/sources/{id}*` cho tệp `.txt` đều bị từ chối `404`).
  4. Khi người dùng bấm Lưu trong khung:
     - `POST /api/v1/office-frame/documents/{documentID}/uploads` (multipart với `filename = "<name>.txt"`) → trả `201 Created` (`upload_id`).
     - `POST /api/v1/office-frame/documents/{documentID}/versions/commit` với `{ "upload_id": "...", "base_revision": "..." }` → trả `200 OK` (`OfficeFrameDocumentSDO` mới có `file.filename = "<name>.txt"` và `file.mime_type = "text/plain"`).
- **Thay đổi trong `packages/core`:**
  1. `packages/core/office/docs-frame-api.ts`: trong `createOfficeFrameApi`, khi `module === "markdown"` và tệp đang mở (`uploadName` / `current.file.filename` trong `save`, hoặc `payload.name` trong `saveAs`) có đuôi `.txt` (không phân biệt hoa thường):
     - Trong `save`: tạo `Blob` với `type: "text/plain"` (và giữ nguyên tên tệp `.txt`) thay vì ép `type: "text/markdown"`.
     - Trong `saveAs`: nếu `payload.name` kết thúc bằng `.txt` (không phân biệt hoa thường), giữ nguyên đuôi `.txt`, cắt `.txt` khi lấy `title`, và tạo `File` với `type: "text/plain"` thay vì nối thêm `.md` và dùng `"text/markdown"`.
- **Thay đổi của lane `e6-web` (chờ cờ `office_txt_open` & pin UNI-1905):**
  1. `packages/views/documents/document-file-view.tsx:81-91` (`officeFormat`): trả `"md"` khi `filename.toLowerCase().endsWith(".txt")` (chỉ theo đuôi `.txt`, không bắt `text/plain` trần) và cờ `office_txt_open` đang bật.
  2. `apps/web/platform/office-frame/document-host.tsx:31-42` (`detectDocumentFormat`): trả `"md"` khi `filename.toLowerCase().endsWith(".txt")` và cờ `office_txt_open` đang bật.
  3. `packages/views/documents/source-links.ts:36-50` (`FORMAT_BY_EXTENSION` và `sourceFormat`): thêm `txt: "md"` theo đuôi `.txt` (khi `can_open_in_app` / `office_txt_open` bật) để tệp `.txt` trong "Từ nơi khác" cũng mở xem được trong khung sau khi pin khung mang **UNI-1905**.

---

## 4. Tiêu chí nghiệm thu & Danh sách bài test (Server + `packages/core`)

### 4.1 Go tests (`server/`)

1. **`server/internal/featureflags/keys_test.go`:**
   - Kiểm tra cờ `office_txt_open` có mặt trong `Catalogue()`, `Default == false`, `Public == true`, `Owner == "office"`, có `ReviewAt` hợp lệ.
2. **`server/internal/service/document_office_capability_test.go`:**
   - Khi `office_txt_open` tắt (mặc định): tệp `ghi-chu.txt` (`text/plain`) gọi `Capability` trả lỗi `501 unsupported_operation` (`reason: "format_not_supported"`), giống hệt trước đây.
   - Khi `office_txt_open` bật: `ghi-chu.txt` (`text/plain`) và `README.TXT` (`application/octet-stream`) trả `Format: office.FormatMD`; trong khi tệp `.csv` (`text/csv` hoặc `text/plain`) và `.log` (`text/plain`) **luôn** bị từ chối `format_not_supported` cả khi cờ tắt lẫn khi cờ bật (chứng minh không ánh xạ `text/plain` trần).
3. **`server/internal/service/office_frame_test.go` & `server/internal/handler/office_frame_test.go` & `server/internal/handler/office_frame_source_test.go`:**
   - Khi `office_txt_open` tắt: mint frame token cho tài liệu `ghi-chu.txt` và source `ghi-chu.txt` trả `404 not_found`; danh sách `GET .../documents/sources` trả `can_open_in_app: false` cho `.txt`.
   - Khi `office_txt_open` bật: mint và open tài liệu `ghi-chu.txt` trả `module: "markdown"`, `file.filename: "ghi-chu.txt"`, `file.mime_type: "text/plain"`; lưu (upload + commit version 2) trên `ghi-chu.txt` giữ nguyên `file.filename: "ghi-chu.txt"` và `file.mime_type: "text/plain"`; danh sách sources trả `can_open_in_app: true` cho `.txt` và mint/open source frame token trả `module: "markdown"`; tệp `.csv` và `.log` (`text/plain`) vẫn `can_open_in_app: false` và mint trả `404 not_found`.

### 4.2 TypeScript / `packages/core` tests

1. **`packages/core/office/docs-frame-api.test.ts`:**
   - `preserves .txt extension and text/plain mime on save and saveAs in the markdown module`: khi `client.open` trả `file: { filename: "ghi-chu.txt", mime_type: "text/plain", ... }`, lệnh `save` gửi `Blob` có `type === "text/plain"` và giữ tên `"ghi-chu.txt"` (còn tệp `.md` vẫn gửi `type === "text/markdown"`); lệnh `saveAs` với `name: "ban-sao.txt"` (hoặc `"BAN-SAO.TXT"`) tạo `File` tên `"ban-sao.txt"`, `title: "ban-sao"`, `type: "text/plain"` (không bị nối thành `"ban-sao.txt.md"`), còn `name: "ban-sao"` không đuôi vẫn nối `.md` và dùng `"text/markdown"`.
