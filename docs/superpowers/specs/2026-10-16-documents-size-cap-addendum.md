# Tài liệu — Giới hạn 200 MB, tải lên tệp lớn, gợi ý mở bằng app khi lag (addendum, phía D)

> **Trạng thái:** in-progress — Contract r2 Advisor duyệt 2026-10-16 23:35 (UTC+7); r2 = route theo phiên riêng cho frame + chủ thể mở phiên; r4 (2026-10-17, size-cap:006) = chỉnh §6 theo contract BIGUP-S1 `2026-10-17-bigup-upload-sessions-contract.md`. Lát SIZE-SPEC (UNI-1858) của lane size-cap (UNI-1857).

**Ngày:** 2026-10-16 · **Nguồn quyết định:** `briefs/size-thresholds-proposal-2026-10-16.md` §0 (D-S1, D-S2, D-S3 user ký 18:20), `briefs/plan-size-cap-2026-10-16.md`, quyết định Advisor `reports/g5-fork_main/advisor-size-decisions-2026-10-16.md` (OQ-SIZE-1..5, BENCH-01), contract fork `contract-size-frame-v0.1` r3 · **Vùng:** `server/internal/{config,handler,service,files,document,storage}`, `server/migrations`, `packages/core/{api,office}`, `packages/views/office`, `apps/web/platform/office-frame`

Ngoài phạm vi (user chưa quyết): quota chỉ tính bản mới nhất, chính sách giữ phiên bản. Không xây.

## 1. Mục tiêu

Một giới hạn dung lượng tài liệu duy nhất (200 MB) cho tải lên **và** lưu, trên mọi client, lấy từ một giá trị cấu hình; người dùng biết giới hạn trước khi gửi byte, được cảnh báo ở 90 %, và không bao giờ mất bản đang sửa. Tệp > 20 MiB đi luồng tải lên chia phần, tiếp tục được, thẳng vào object storage. Trình duyệt chậm thì gợi ý mở bằng app, không bao giờ chặn.

## 2. Đơn vị và giá trị (OQ-SIZE-1 — đã chốt)

- Đơn vị nhị phân. `DOCUMENT_MAX_BYTES` mặc định `209715200` (= 200 × 1024 × 1024). Copy hiển thị "MB" (chia `1024 × 1024`), định dạng theo contract fork §6.1 (`Intl.NumberFormat`, ≤ 1 chữ số thập phân; vượt giới hạn thì làm tròn **lên** 0,1; trong dải cảnh báo làm tròn **xuống**).
- Ngưỡng cảnh báo khi lưu: `warn_bytes = floor(max_bytes × 0.9)` = `188743680` (180 MB).
- Ngưỡng tải chia phần: tệp **> 20 MiB** (`20971520`); phần 8 MiB (`8388608`).
- Giá trị server trong `GET /api/v1/config` là nguồn duy nhất; hằng số ở client chỉ là fallback khi không đọc được config.

## 3. Server: một giá trị cấu hình (SIZE-S1)

`DOCUMENT_MAX_BYTES` (env, `config.Config.DocumentMaxBytes int64`, khai báo trong `.env.example`). Hợp lệ: số nguyên trong `[1 MiB, 2 GiB]`; ngoài dải hoặc không phải số → server không khởi động (lỗi config rõ ràng). Thay mọi hard-code 50 MiB:

| Chỗ | Hôm nay | Sau SIZE-S1 |
| --- | --- | --- |
| `handler/documents.go` `documentFileMultipartCap`, `cappedDocumentPart{max: 50<<20}` (tạo file, upload phiên bản) | 50 MiB (+256 KiB envelope) | `DocumentMaxBytes` (+256 KiB envelope) |
| route frame `POST /office-frame/documents/{id}/uploads` (mô tả "≤ 50 MiB" trong `router/office_frame.go`) | 50 MiB | `DocumentMaxBytes`; mô tả apiOp nêu "≤ DOCUMENT_MAX_BYTES" |
| `files/registry.go` policy `document_file` | `MaxBytes: 50<<20` | `DocumentMaxBytes` (registry nhận giá trị lúc dựng, không đọc env trong package `files`) |
| `service/document_office.go` `documentFileMaxBytes()` fallback | 50 MiB | đọc cùng policy; bỏ số 50 |
| `handler/office_frame_export.go` `officeFrameExportMax` | 50 MiB | `DocumentMaxBytes` |
| `files/registry.go` policy `audit_export`, `tenant_export` | 100 MiB | **không đổi** (r2b): không phải tài liệu; bản xuất Office (PDF/HTML) ghi vào `document_file`, nên đã theo `DocumentMaxBytes` |
| `document/file_validation.go` `DefaultFileLimits.TextScanBytes` | 50 MiB | `DocumentMaxBytes` |
| `service/office_frame_module.go` `OfficeFrameSheetsMaxBytes` (10 MiB, chặn xlsx lưu trữ) | 10 MiB | **bỏ** (BENCH-01 #2): Sheets không còn giới hạn riêng; chặn thật nằm trong frame (XML worksheet 512 MiB, SIZE-F1). `scripts/office-modules.test.mjs` cập nhật cùng commit |
| quota tổ chức (`storage.bytes`) | starter 5 GiB, cao hơn 50/200 GiB | **không đổi**: gói nhỏ nhất = 25 × giới hạn; số theo gói là việc billing |

Tài sản cạnh tài liệu (10 MiB), trang UniNote (2 MiB), `PREVIEW_ASSET_MAX_BYTES`, tải xuống app (256 MiB) **không đổi**.

**Engine Office (r3, size-cap:005):** engine nhận đầu vào tối đa 383 MiB = 401604608 byte (`ENGINE_LIMITS.max_input_bytes`) vì job đi trong một envelope JSON base64 và chuỗi V8 tối đa 0x1fffffe8 ký tự; engine kẹp `DOCUMENT_MAX_BYTES` thừa hưởng về mức này và không khởi động nếu `OFFICE_ENGINE_MAX_INPUT_BYTES` đặt cao hơn. Dải của server vẫn `[1 MiB, 2 GiB]`: tài liệu lớn hơn 383 MiB vẫn lưu và tải xuống được, job engine trả 413 `upload_bounds`; transport nhị phân/streaming là việc của SIZE-OPS1.

### 3.1 `GET /api/v1/config` — thêm `documents.limits`

```json
{
  "documents": {
    "limits": {
      "upload_max_bytes": 209715200,
      "save_warn_ratio": 0.9,
      "web_open": {
        "docx": { "warn_bytes": 31457280 },
        "pptx": { "warn_bytes": 26214400 },
        "pdf":  { "warn_bytes": 52428800 },
        "xlsx": { "warn_bytes": 5242880 }
      }
    }
  }
}
```

- `sdo.ConfigSDO.Documents sdo.DocumentsConfigSDO` (SDO có `description` + `example`). Route public, không cần phiên; giá trị toàn hệ thống (không theo tổ chức).
- `web_open.*.warn_bytes`: ngưỡng kích thước cho banner gợi ý (LAG-W1) khi trình duyệt không có `PerformanceObserver` (Safari) — số từ BENCH-01 #5 (docx 30, pptx 25, pdf 50, xlsx 5 MB lưu trữ). Chỉ là gợi ý, **không** có `max_bytes` ở đây (thay đổi so với contract fork §8.1: bỏ `max_bytes` trong `web_open`, kể cả xlsx 10 MiB, vì BENCH-01 #2 bỏ chặn 10 MiB). Ngưỡng là hằng số server trong SIZE-S1 (không thêm env).
- `chunked_upload_threshold_bytes` (`20971520`) **chỉ xuất hiện khi luồng phiên tải lên chạy được** (BIGUP-S1 đã merge, backend storage presign được — backend `local` không presign nên không bao giờ có). Client: có trường → tệp lớn hơn đi phiên tải lên; không có → luồng một request như cũ. SIZE-S1 **không** phát trường này.
- `page_max_bytes`, `asset_max_bytes` (contract fork §8.1 giả định) **không** phát: chưa thẻ nào dùng.
- Client web (`packages/core/api/endpoints/config.ts`): schema lỏng, mỗi trường `.catch(undefined)`; thiếu/hỏng → fallback `{upload_max_bytes: 209715200, save_warn_ratio: 0.9}` và bảng `web_open` ở trên; test malformed-response bắt buộc.

### 3.2 `413 file_too_large` nêu giới hạn

Mọi 413 `file_too_large` của tài liệu (handler cap, `service/document_files.go` `documentFileError`, route frame, phiên tải lên) mang `fields.max_bytes`:

```json
{ "error": { "code": "file_too_large", "message": "tệp vượt quá dung lượng cho phép", "error_class": "quota", "fields": { "max_bytes": 209715200 } } }
```

(`respondErrorFields` / `CodedError.Fields`; `error_class` giữ như hiện có.) Mã cũ `too_large` của mint frame (`ErrOfficeFrameTooLarge`) chỉ còn dùng cho nhánh khác nếu có; với Sheets nó biến mất cùng `OfficeFrameSheetsMaxBytes`.

## 4. Web (SIZE-W1)

1. **Kiểm tra trước khi tải lên** (mọi chỗ web tải tệp tài liệu lên): so `file.size` với `upload_max_bytes` và đuôi tệp với danh sách định dạng được nhận, **trước** khi gửi byte. Tệp vượt: lỗi trên đúng tệp đó với copy §8 "Upload block"; tải nhiều tệp thì các tệp khác vẫn tiếp tục. Server vẫn là bên quyết định; 413 trả về thì đọc `fields.max_bytes` để nêu giới hạn.
2. **Giới hạn từ config**: hook `useDocumentLimits()` trong `packages/core` (dựa trên query config hiện có), fallback §3.1. Bỏ các bản sao: `frame-download.ts:10` (`OFFICE_FRAME_DOWNLOAD_MAX_BYTES`), `office-modules.ts:66` (`SHEETS_MAX_BYTES`, `maxBytes` của sheets, `officeModuleTooLarge` cho sheets — BENCH-01 #2).
3. **Trần tải xuống frame** (OQ-SIZE-3): `deliverFrameDownload` nhận trần `max(upload_max_bytes + 64 MiB, 256 MiB)`; `InitPayload.downloadMaxBytes` gửi cùng số.
4. **Frame nhận giới hạn**: host gửi `limits: {max_bytes: upload_max_bytes, warn_ratio: save_warn_ratio}` trong `InitPayload` và `ApiOpenResult`, và `capabilities.sizeUi: true`.
5. **Host vẽ UI kích thước** (khi frame gửi sự kiện, contract fork §3): `size_warning` → chip thanh trạng thái "Sắp chạm giới hạn {{max}} (đang {{size}})." một lần mỗi phiên tài liệu; `save_blocked` → hộp thoại "Chưa lưu được lên UniWork" với **Tải bản của tôi** (mặc định; gửi `doc.download` → frame gọi `api.download`) và "Đóng". Không bao giờ mất bản đang sửa: hộp thoại không đóng frame, không tải lại, không xoá nháp. 413 khi lưu (frame cũ không chặn trước) → cùng hộp thoại, `{{max}}` từ `fields.max_bytes`.
6. **Phụ thuộc giao thức**: các trường/sự kiện ở mục 4–5 là thay đổi giao thức frame (fork trước, vendor nguyên văn). SIZE-W1 chia hai phần: **W1a** (mục 1–3, không đụng giao thức) làm ngay; **W1b** (mục 4–5) code trên fake (§9) và vendor `docs-frame-protocol.ts` từ commit giao thức của nhánh fork SIZE-F1; trước MERGE_READY phải re-pin vào SHA fork main đã có SIZE-F1 (`office-frame-sync.mjs --pin`). Chưa có SHA fork main → W1b dừng ở MERGE_READY có điều kiện, nói rõ.

## 5. Banner gợi ý mở bằng app (LAG-W1)

- Frame gửi `lag_detected` (LAG-F1) → host hiện banner không chặn: "Tệp lớn nên có thể chạy chậm trên trình duyệt. Mở bằng app UniWork Office cho trải nghiệm tốt hơn." + **Mở bằng app** (luồng mở app hiện có) · **Tiếp tục trên web** (ẩn banner).
- Fallback theo kích thước: khi môi trường không có `PerformanceObserver` hỗ trợ `longtask`/`event` (Safari), host hiện cùng banner lúc mở nếu `file.size_bytes > web_open[format].warn_bytes`. Trình duyệt có observer thì chỉ dựa vào `lag_detected` (không hiện theo kích thước) để tránh báo hai lần.
- Bỏ qua (dismiss) nhớ theo tài liệu: `StorageAdapter` key `office.lagBanner.dismissed:<documentId>`; nhớ qua phiên. Không bao giờ chặn sửa hay lưu; "Mở bằng app" không có khi máy không mở app được (giống nút mở app hiện có).
- `open_refused` (contract fork §3.1a): host hiện thông báo từ chối với "Mở bằng app" · "Tải xuống" (thay notice "Tệp quá lớn để chỉnh sửa trên web" đang dựa vào 10 MiB). Thuộc LAG-W1 (cùng vendor giao thức với W1b).

## 6. Phiên tải lên tệp lớn — API (BIGUP-S1 / BIGUP-W1) — OQ-SIZE-2

### 6.1 Quyết định hình route (OQ-SIZE-2)

**Không** dùng một route `/api/v1/upload-sessions` nhận `workspace_id`/`document_id` trong body như contract fork đề xuất. Lý do: quy tắc D "handler không tin id tổ chức/workspace từ body", ma trận cô lập phủ route theo id trên path ngay khi đăng ký, và lưu từ frame web chạy bằng **frame token** (chỉ hợp lệ cho một tài liệu, route `/office-frame/...`), không có phiên. Thay vào đó: **tạo** theo phạm vi cha (ba route), **thao tác phiên** theo id phiên.

| Method + path | Auth | Dùng cho |
| --- | --- | --- |
| `POST /api/v1/workspaces/{workspaceID}/documents/upload-sessions` | phiên | tạo tài liệu tệp mới (web, app `uploadDocument`) |
| `POST /api/v1/documents/{documentID}/upload-sessions` | phiên | phiên bản mới (app save queue) |
| `POST /api/v1/office-frame/documents/{documentID}/upload-sessions` | frame token, quyền sửa | lưu từ frame web > 20 MiB (OQ-SIZE-4, host gọi thay frame) |
| `GET /api/v1/upload-sessions/{sessionID}` | phiên | trạng thái + URL phần mới (tiếp tục, làm mới URL hết hạn) |
| `POST /api/v1/upload-sessions/{sessionID}/complete` | phiên | hoàn tất + kiểm tra |
| `DELETE /api/v1/upload-sessions/{sessionID}` | phiên | huỷ |
| `GET` / `POST .../complete` / `DELETE` dưới `/api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}` | frame token | như trên, cho phiên tạo từ frame |

**Chọn (r2): route theo phiên riêng cho frame** — `GET`, `POST .../complete`, `DELETE` dưới `/api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}` (frame token của đúng tài liệu đó, quyền sửa); route `/api/v1/upload-sessions/{sessionID}` **không** nhận frame token (chỉ phiên đăng nhập). Lý do: frame token chỉ hợp lệ cho một tài liệu và chỉ được nhận dưới `/office-frame/...` như mọi route frame hiện có.

**Chủ thể mở phiên** được ghi trên dòng phiên: `opened_via` (`session` | `frame_token`), `created_by` + `created_by_kind` (người dùng), và với frame token thêm `document_id` của token. Một thao tác chỉ được nhận khi cùng chủ thể: phiên mở bằng phiên đăng nhập chỉ đi qua `/api/v1/upload-sessions/{id}` với cùng người dùng; phiên mở bằng frame token chỉ đi qua route frame với token của cùng người dùng và cùng `document_id`. Mọi trường hợp khác (người khác, route kia, tài liệu khác) → `404 not_found`, không lộ phiên tồn tại.

**Thay đổi với lane g5-fork_main** (gửi qua Advisor): app dùng hai route tạo theo phạm vi (thay `POST /upload-sessions` + `purpose`), và `GET /upload-sessions/{id}` thay cho `POST .../urls`. Body/response bên dưới giữ đúng tên trường contract fork §8.3, trừ `purpose`/`workspace_id`/`document_id` (nằm trên path).

### 6.2 Tạo phiên

Request (cả ba route; `parent_id`, `title`, `visibility` chỉ ở route workspace):

```json
{
  "filename": "Report.docx",
  "size_bytes": 83886080,
  "parent_id": null,
  "title": "Report.docx",
  "visibility": null,
  "probe": {
    "head_b64": "<≤ 65536 byte đầu>",
    "central_dir_b64": "<central directory + EOCD (+ ZIP64 locator), rỗng nếu không phải zip>",
    "cd_offset": 83820000,
    "cd_size": 66080
  }
}
```

Header `Idempotency-Key` bắt buộc (cùng key + cùng lệnh → cùng phiên, `200`; cùng key + lệnh khác → `409 idempotency_payload_mismatch`, mã hiện có của `BeginIdempotent`; r4 bỏ mã mới `idempotency_conflict`). Thiếu header hoặc header rỗng → `400 invalid_request` trước mọi kiểm tra khác (r5, BIGUP-S1 review: key rỗng từng tắt cả bảo đảm D7).

Server, trước khi nhận phần nào: `size_bytes` trong `(20 MiB, DOCUMENT_MAX_BYTES]` (≤ 20 MiB → `422 upload_session_too_small`: dùng luồng thường; > cap → `413 file_too_large` + `fields.max_bytes`); đuôi tệp được nhận; quyền (tạo trong workspace / sửa tài liệu, cùng thứ tự từ chối như route upload hiện có); quota `storage.bytes` **giữ chỗ** `size_bytes`; probe chạy detector + luật zip (OOXML/ODF: `[Content_Types].xml`, thư mục chính khớp đuôi, không macro, số mục và kích thước giải nén khai báo trong giới hạn; `cd_size ≤ 1 MiB`; `head_b64 ≤ 64 KiB`) → sai thì `415 unsupported_media_type` + `fields.reason`; giới hạn phiên đang mở mỗi người → `429 upload_sessions_exhausted` + `Retry-After`.

Response `201`:

```json
{
  "session_id": "01JA09K3...",
  "part_size": 8388608,
  "total_parts": 10,
  "completed_parts": [],
  "parts": [{ "part_number": 1, "url": "https://...", "headers": {}, "expires_at": "2026-10-16T16:00:00Z" }],
  "expires_at": "2026-10-17T15:00:00Z"
}
```

URL phần là presigned PUT S3 multipart tới khoá object của chính dòng `files` của phiên (r4: tệp chưa được claim nên chưa tài liệu nào đọc được, tức là đã đóng vai staging; không phải copy lúc hoàn tất), TTL 1 giờ; client gửi `PUT` thẳng, `credentials: 'omit'`, ghi lại `ETag`.

### 6.3 Trạng thái / làm mới URL

`GET .../upload-sessions/{sessionID}` → cùng shape response tạo, cộng trường `status` (`open` | `validating` | `completed`; r4; `parts` chỉ có khi `open`), `completed_parts` lấy từ S3 ListParts (`[{part_number, etag, size}]`), `parts` = URL mới cho các phần còn thiếu. Phiên hết hạn / đã huỷ / đã GC → `410 upload_session_expired`; không thấy → `404 not_found`.

### 6.4 Hoàn tất

`POST .../complete` `{ "parts": [{ "part_number": 1, "etag": "\"...\"" }] }`. Server: hoàn tất multipart; kích thước đối tượng đúng bằng `size_bytes` (khác → `422 upload_size_mismatch`); đọc lại đầu + central directory bằng Range, phải khớp probe (khác → `422 upload_probe_mismatch`); chạy kiểm tra đầy đủ (`ValidateFile`) trên đối tượng staging; hỏng → xoá đối tượng staging, trả quota giữ chỗ, `415`/`413` như luồng thường. ETag sai / thiếu phần → `422 upload_parts_invalid`. Lặp `complete` cùng phiên đã xong → cùng kết quả.

Response `200` theo route tạo:
- route workspace → `DocumentSDO` (tài liệu đã tạo, như `POST .../documents/files` trả `201`);
- route tài liệu và route frame → `DocumentUploadSDO` `{upload_id, checksum_sha256, size_bytes, claim_expires_at}` rồi commit như hiện có (`POST /documents/{id}/versions/commit` hoặc `/office-frame/documents/{id}/versions/commit`).

Kiểm tra có thể kéo dài với tệp 200 MB: request `complete` giữ kết nối tới khi xong (client hiện "Đang kiểm tra tệp…"). Nếu proxy cắt kết nối, client gọi lại `complete` (idempotent) hoặc `GET` để đọc trạng thái `validating` / `completed`.

### 6.5 Huỷ, GC, giới hạn

- `DELETE` → abort multipart, xoá staging, trả quota giữ chỗ, `204`. Huỷ phiên đã hoàn tất → `409 upload_session_completed`.
- Phiên sống 24 giờ từ lúc tạo (`expires_at`); quá hạn → worker GC (cùng chuỗi tắt máy trong `cmd/server/main.go`) abort multipart, xoá staging, trả quota, đánh dấu `expired`. Backstop: luật lifecycle bucket "abort incomplete multipart uploads sau 2 ngày" trên tiền tố staging — ghi trong `docs/ops/` (không tự cấu hình bucket).
- Mỗi người tối đa **4** phiên đang mở (chưa hoàn tất/huỷ/hết hạn), trên mọi tổ chức.
- Bộ nhớ dữ liệu: bảng mới trong FileService (chỉ `server/internal/files` + service FileService ghi), có `organization_id NOT NULL`, cặp `created_by`/`created_by_kind`, id ULID, không FK, index `CONCURRENTLY` một-lệnh-một-file; câu sqlc có `organization_id = $n` hoặc dòng `-- tenant:` (`by-id` cho thao tác theo id phiên, kiểm tra người tạo trong service). Bảng `file_multipart_uploads` (1:1 với phiên FileService), giữ chỗ quota, GC và giới hạn: contract BIGUP-S1 `2026-10-17-bigup-upload-sessions-contract.md` (Advisor duyệt size-cap:006).
- Audit (cùng transaction): `document.upload_session_opened`, `document.upload_session_completed`, `document.upload_session_aborted`, `document.upload_session_expired` (actor `system`); thêm vào `audit_coverage_test.go`. Không có topic outbox mới: tài liệu tạo lúc `complete` phát `document.created` như luồng hiện có; phiên bản mới phát qua commit hiện có.
- Ma trận cô lập: mọi route ở §6.1 tự được phủ (id trên path); `parent_id` trong body route workspace cần ca `isoReferences`.
- Luồng một request (≤ 20 MiB) đổi thứ tự: kiểm tra đầy đủ trên tệp spool cục bộ **trước** `Put` (proposal §9), không đọc lại đối tượng sau khi lưu. r4: tách thành thẻ SIZE-S2 (size-cap:006), không thuộc BIGUP-S1.

### 6.6 Web (BIGUP-W1)

Tệp > `chunked_upload_threshold_bytes` (chỉ khi config có trường này): probe ở client (`File.slice` 64 KiB đầu + đuôi tìm EOCD/central directory, cùng luật như server), tạo phiên, 4 phần song song, thử lại riêng từng phần (3 lần, 1/2/4 s), thanh tiến trình, tạm dừng/tiếp tục qua tải lại trang (`StorageAdapter`: `session_id` + khoá tệp `name:size:lastModified`; sau tải lại người dùng chọn lại tệp, khớp khoá thì tải phần còn thiếu), huỷ = `DELETE`, "Đang kiểm tra tệp…" tới khi `complete` xong. Host định tuyến `api.save` / `api.saveAs` của frame có payload > 20 MiB qua route frame §6.1 (OQ-SIZE-4), rồi commit như hiện có; frame không đổi.

## 7. Thứ tự và song song

SIZE-S1 và SIZE-W1a chạy song song ngay khi contract này được duyệt (W1a dùng fallback + fake config). W1b và LAG-W1 cần commit giao thức của fork SIZE-F1/LAG-F1 (vendor) — chạy trên fake, re-pin trước merge. BIGUP-S1 sau SIZE-S1 merge, có contract chi tiết riêng gửi Advisor (bảng, GC, cách giữ chỗ quota) trước khi code; BIGUP-W1 code trên fake §9 sau khi contract BIGUP-S1 được duyệt.

## 8. Copy (vi / en, khoá i18n D dùng `{{x}}`)

| Khoá (đề xuất) | vi | en |
| --- | --- | --- |
| `documents.upload.too_large_named` | {{name}} nặng {{size}}, vượt giới hạn {{max}}. Giảm dung lượng ảnh hoặc chia nhỏ tệp rồi tải lên lại. | {{name}} is {{size}}, which is over the {{max}} limit. Reduce image sizes or split the file, then upload again. |
| `office.size.warn_chip` | Sắp chạm giới hạn {{max}} (đang {{size}}). | Approaching the {{max}} limit (currently {{size}}). |
| `office.size.save_blocked.title` | Chưa lưu được lên UniWork | Couldn’t save to UniWork |
| `office.size.save_blocked.body` | Tài liệu đã vượt {{max}}. Thay đổi của bạn vẫn ở đây. Tải bản của bạn về máy rồi giảm dung lượng ảnh hoặc chia nhỏ tài liệu. | This document is over {{max}}. Your changes are still here. Download your copy to your computer, then reduce image sizes or split the document. |
| `office.size.save_blocked.download` | Tải bản của tôi | Download my copy |
| `office.size.save_blocked.close` | Đóng | Close |
| `office.lag_banner.body` | Tệp lớn nên có thể chạy chậm trên trình duyệt. Mở bằng app UniWork Office cho trải nghiệm tốt hơn. | This file is large and may run slowly in the browser. Open it in the UniWork Office app for a better experience. |
| `office.lag_banner.open_app` | Mở bằng app | Open in app |
| `office.lag_banner.continue` | Tiếp tục trên web | Continue on web |
| `documents.upload.checking` | Đang kiểm tra tệp… | Checking file… |

Khoá cuối cùng theo `docs/conventions.md` (worker chọn chỗ đặt trong cây hiện có, giữ nguyên chữ). Không có mã nội bộ trong copy.

## 9. Fake để làm song song

- **Config**: fixture `documents.limits` §3.1 (có và không có `chunked_upload_threshold_bytes`, và bản hỏng) trong test endpoint `config.test.ts`; web dùng `mockHttp` như các test views hiện có.
- **Frame**: fake endpoint trong test `packages/views/office/frame/` phát `size_warning`, `save_blocked`, `lag_detected`, `open_refused` với payload đúng contract fork §3.4 và ghi lại `doc.download` / `api.download`.
- **Phiên tải lên**: `packages/core/api/endpoints/upload-sessions.ts` có schema + test malformed; fake server trong test (create/get/complete/delete + PUT phần, lỗi 503 một phần, 403 URL hết hạn, 429) — BIGUP-W1 viết theo §6, không cần server thật.
- **Server**: `filesfake` thêm phương thức phiên tải lên theo interface BIGUP-S1 để test handler không cần S3.

## 10. Kiểm thử bắt buộc theo thẻ (tóm tắt)

- SIZE-S1: test config đọc/biên `DOCUMENT_MAX_BYTES` (thiếu → 209715200; 0, âm, > 2 GiB → lỗi); 413 có `fields.max_bytes` trên route tạo file, upload phiên bản, upload frame; tệp `cap` byte nhận, `cap + 1` từ chối; `/api/v1/config` có `documents.limits`; xlsx > 10 MiB mint frame được (hết `office_frame_too_large` cho sheets); `.env.example` (`scripts/env-example.test.mjs`).
- SIZE-W1: từ chối trước khi gửi (không có request) + tệp khác vẫn tải; fallback khi config hỏng; trần tải xuống 256 MiB; chip một lần; hộp thoại không mất bản; `doc.download` gửi đúng; 413 nêu `{{max}}`.
- LAG-W1: banner khi `lag_detected`; fallback kích thước chỉ khi không có observer; dismiss nhớ theo tài liệu; không chặn lưu.
- BIGUP-S1/W1: theo contract BIGUP-S1.
