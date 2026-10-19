# Contract BIGUP-S1 (UNI-1862): phiên tải lên tệp lớn phía server

> **Trạng thái:** in-progress — contract r1 Advisor duyệt 2026-10-17 (size-cap:006): D1–D7 như viết, chia S1-a..S1-d; kiểm tra spool ≤ 20 MiB tách thành SIZE-S2. Lát BIGUP-S1 (UNI-1862) của lane size-cap (UNI-1857).

Bổ sung cho addendum `docs/superpowers/specs/2026-10-16-documents-size-cap-addendum.md` §6. Route, shape request/response, mã lỗi và copy vẫn theo §6. Tài liệu này chốt những gì §6 để lại cho contract BIGUP-S1: bảng dữ liệu, cách giữ chỗ quota, GC, giới hạn, lưu trữ multipart, thứ tự kiểm tra và cách chia việc. Đường dẫn code là của root a8b2b3914.

## 1. Quyết định chính (cần Advisor duyệt)

| # | Quyết định | Lý do |
| --- | --- | --- |
| D1 | Một phiên tải lên lớn **dựa trên** phiên FileService hiện có (`file_upload_sessions` + dòng `files`, trạng thái `receiving` → `staged`), cộng một bảng mới `file_multipart_uploads` (1:1 với phiên FileService) giữ phần riêng của multipart. Không viết luồng file thứ hai. | `staged` → claim → commit (`CommitFileVersion`, `ClaimInTx`) đã có sẵn và đã được test cô lập/audit. Quota giữ chỗ (`ReserveFileBytes`, `CountStorageBytesInOrganization`) đã đếm phiên `receiving`/`staged` và tự nhả khi phiên rời hai trạng thái đó. |
| D2 | Đích multipart là **khoá object của chính dòng `files`** (tiền tố `documents/files`), không phải tiền tố staging riêng. | Tệp ở `receiving`/`staged` chưa được tài liệu nào giữ nên không ai đọc được, tức là đã đóng vai staging. Không phải copy 200 MB lúc hoàn tất (S3 không đổi tên). Thay câu "khoá staging của phiên" trong §6.2 bằng câu này (dòng addendum r4). Luật lifecycle "abort incomplete multipart sau 2 ngày" vì vậy áp cho tiền tố `<S3_KEY_PREFIX>v1/` (gốc FileService; sửa r5: khoá thật là `<root>v1/orgs/...`, không phải `documents/files/`) và chỉ chạm multipart dở dang, không chạm object đã xong. |
| D3 | `ObjectStore` thêm năm phương thức multipart và cờ `Capabilities.Multipart`. S3/MinIO dùng aws-sdk-go-v2 (đang có), còn `local` trả `ErrCapabilityUnsupported`. `/api/v1/config` chỉ phát `chunked_upload_threshold_bytes` khi `Capabilities.Multipart && Capabilities.Presign`. | Theo §3.1: backend `local` không bao giờ có luồng này, client dùng luồng một request. |
| D4 | Giữ chỗ quota = `ReserveFileBytes(org, fileID, size_bytes)` lúc tạo phiên, trước khi ký URL phần nào. Không có cơ chế giữ chỗ mới. Nhả chỗ = đưa phiên FileService sang `canceled`/`expired` (huỷ, GC, kiểm tra hỏng). Tính phí = `consumeStorage` lúc commit như hiện có. | Đã có `usage_events` ref_type `file_reservation` và idempotent theo file id. Vượt quota → `403 quota_exceeded` (mã hiện có) trước khi tạo multipart. |
| D5 | Giới hạn 4 phiên mở mỗi người, trên mọi tổ chức: khoá advisory theo người dùng trong transaction tạo phiên, đếm `file_multipart_uploads` có `status IN ('open','validating')`. Vượt → `429 upload_sessions_exhausted` với `fields.retry_after = 60`. `mapServiceError` học đặt header `Retry-After` từ `Fields["retry_after"]` (một chỗ, mọi mã 429 dùng chung). | Giống mẫu `ai_uniwork_busy`. Hiện chỉ handler AI tự đặt header. |
| D6 | GC chạy trong vòng 10 phút của `DocumentWorkers.Run`, đã nằm trong chuỗi tắt máy của `cmd/server/main.go`. Bước GC: `ExpireMultipartUploads` (phiên `open`/`validating` quá `expires_at`) → AbortMultipart → phiên FileService `canceled` (nhả quota) → `files` theo đường dọn hiện có (`file_jobs`) → audit `document.upload_session_expired` (actor `system`). | Không thêm goroutine trần. Vòng `FileGCWorker` chạy mỗi ngày, quá thưa cho phiên 24 giờ. |
| D7 | `Idempotency-Key` bắt buộc trên ba route tạo, dùng `BeginIdempotent` với `IdempotencyOptions{RequireFingerprint: true}`. Fingerprint = route + id cha trên path + `filename` + `size_bytes` + `parent_id`/`title`/`visibility` + sha256 của probe. Cùng key + fingerprint khác → `409 idempotency_conflict` (§6.2). Mã hiện có là `idempotency_payload_mismatch`, nên dùng **mã hiện có** và sửa §6.2 trong addendum r4. | Không thêm mã lỗi song song. |

## 2. Bảng `file_multipart_uploads`

Chỉ `server/internal/files` và service FileService ghi bảng này. Mọi luật migration giữ nguyên: không FK, ULID `TEXT`, `organization_id NOT NULL`, cặp `created_by`/`created_by_kind`, mỗi index `CONCURRENTLY` ở một file riêng, tên `999<unix-ms>_...`.

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | TEXT PK | ULID = `session_id` trả cho client |
| `organization_id` | TEXT NOT NULL | |
| `workspace_id` | TEXT NOT NULL | |
| `file_upload_session_id` | TEXT NOT NULL | phiên FileService 1:1 |
| `file_id` | TEXT NOT NULL | dòng `files` |
| `object_key` | TEXT NOT NULL | khoá object của tệp = đích multipart (D2), lưu để GC/hủy không cần đọc lại `files` |
| `document_id` | TEXT NULL | route tài liệu / route frame |
| `parent_id`, `title`, `visibility` | TEXT NULL | chỉ route workspace (giữ để tạo tài liệu lúc hoàn tất) |
| `filename` | TEXT NOT NULL | |
| `size_bytes` | BIGINT NOT NULL | khai báo, so lúc hoàn tất |
| `part_size` | BIGINT NOT NULL | 8 MiB (8388608) |
| `total_parts` | INTEGER NOT NULL | `ceil(size_bytes / part_size)`; ≤ 10000 (cap 2 GiB → tối đa 256) |
| `storage_upload_id` | TEXT NOT NULL | UploadId của S3 |
| `probe_head_sha256`, `probe_tail_sha256` | TEXT NOT NULL | sha256 của `head_b64` và `central_dir_b64` (chuỗi rỗng khi không phải zip) |
| `cd_offset`, `cd_size` | BIGINT NULL | cùng NULL hoặc cùng có giá trị (CHECK) |
| `opened_via` | TEXT NOT NULL | `workspace` \| `version` \| `frame` (CHECK). Mã hoá cả mục đích lẫn đường vào: `workspace` = tạo tài liệu mới (`document_id` NULL), `version` = phiên bản mới qua phiên đăng nhập, `frame` = phiên bản mới qua token frame |
| `token_document_id` | TEXT NULL | `frame` thì NOT NULL và bằng `document_id`; `version`/`workspace` thì NULL (CHECK) |
| `status` | TEXT NOT NULL | `open` → `validating` → `completed` \| `failed`; `open`/`validating` → `aborted` \| `expired` (CHECK) |
| `failure_code` | TEXT NULL | mã lỗi trả lại khi gọi lại `complete` sau khi hỏng |
| `result_document_id`, `result_version_upload_id` | TEXT NULL | để `complete` lặp lại trả cùng kết quả |
| `lease_owner`, `lease_expires_at` | TEXT / TIMESTAMPTZ NULL | khoá `validating` (chỉ một `complete` kiểm tra tại một thời điểm) |
| `created_by`, `created_by_kind` | TEXT NOT NULL | luôn `human` hôm nay (CHECK `human`/`agent`/`system`) |
| `created_at`, `updated_at`, `expires_at`, `closed_at` | TIMESTAMPTZ | `expires_at = created_at + 24h`; `closed_at` NOT NULL đúng khi trạng thái kết thúc (CHECK) |

> **Sửa r5 (lead, theo review S1-b R1-3):** bảng theo đúng code. Không có cột `purpose` (gộp vào `opened_via`) và không có cột `idempotency_key`: khoá idempotency nằm trong bảng `idempotency_keys` qua `BeginIdempotent` (D7), bảng này không cần lưu lại. Thêm cột `object_key`.

Index (mỗi cái một file): `(created_by) WHERE status IN ('open','validating')` cho D5; `(expires_at) WHERE status IN ('open','validating')` cho GC; UNIQUE `(file_upload_session_id)`.

Câu sqlc: theo id phiên dùng `-- tenant: by-id`, và service kiểm tra chủ thể (§3). Đếm theo người dùng (D5) dùng `-- tenant: self`. GC dùng `-- tenant: system`. Không câu nào khác bỏ ràng buộc tenant.

## 3. Chủ thể và quyền (giữ §6.1)

- **Tạo:**
  - Route workspace: `WorkspaceService.RequireMember` + quyền tạo tài liệu, cùng thứ tự từ chối như `POST .../documents/files`. `parent_id` đi qua cùng kiểm tra như route đó.
  - Route tài liệu: quyền sửa như `POST /documents/{id}/uploads`.
  - Route frame: `OfficeFrame.AuthorizeSave` như `POST /office-frame/documents/{id}/uploads`.
- **GET / complete / DELETE:**
  - Đọc phiên theo id. Phiên không thấy, hoặc chủ thể không khớp (`created_by` khác, `opened_via` khác route, `token_document_id` khác tài liệu của token) → `404 not_found`, cùng một câu trả lời.
  - Sau đó kiểm tra lại quyền hiện tại của người đó trên workspace/tài liệu (membership có thể đã bị thu hồi), qua `RequireMember` / `AuthorizeSave`.
- Không route nào nhận id tổ chức/workspace từ body.

## 4. Thứ tự xử lý

**Tạo** (một transaction cho phần DB; gọi S3 ở ngoài transaction):

1. Kiểm tra quyền.
2. Kiểm tra `size_bytes`:
   - ≤ 20 MiB → `422 upload_session_too_small`.
   - > cap → `413 file_too_large` + `fields.max_bytes`.
3. Kiểm tra đuôi tệp: không nằm trong allowlist `document_file` → `415`.
4. Kiểm tra probe:
   - `head_b64` phải ≤ 64 KiB, `cd_size` ≤ 1 MiB và đúng bằng độ dài `central_dir_b64`.
   - Detector chạy trên phần đầu.
   - Với zip, luật zip của `ValidateFile` chạy trên central directory: số mục, kích thước giải nén khai báo, `[Content_Types].xml`, thư mục chính khớp đuôi, không macro.
   - Sai → `415 unsupported_media_type` + `fields.reason`.
5. `BeginIdempotent`: nếu đã có kết quả thì trả lại đúng kết quả đó (200).
6. Khoá người dùng + đếm (D5).
7. FileService mở phiên (`receiving`, file mới) → `ReserveFileBytes` (D4).
8. `CreateMultipart` trên khoá file.
9. Ghi dòng `file_multipart_uploads`.
10. Audit `document.upload_session_opened`.
11. Ký URL phần (TTL 1 giờ).
12. Trả `201`.

Nếu `CreateMultipart` hỏng sau khi đã giữ chỗ: huỷ phiên FileService (nhả quota) rồi trả `503 storage_unavailable` (mã hiện có của storage).

**GET:**
- Nếu `open`: ListParts → `completed_parts` + URL mới cho các phần còn thiếu.
- Nếu `validating` / `completed`: trả `status` mà không có `parts`. Thêm trường `status` vào response; §6.3 có nhắc nhưng chưa nằm trong shape.
- Hết hạn / huỷ → `410 upload_session_expired`.

**Complete:**
1. Lấy lease → `validating`. Nếu một `complete` khác đang giữ lease → `409 upload_session_busy` + `retry_after` 5.
2. So danh sách phần: thiếu phần, số phần sai, hoặc ETag khác ListParts → `422 upload_parts_invalid`. Phiên giữ `open` để client sửa.
3. `CompleteMultipart`.
4. `Stat`: size ≠ `size_bytes` → `422 upload_size_mismatch`.
5. Đọc Range phần đầu + central directory, so sha256 với probe → `422 upload_probe_mismatch`.
6. Đọc toàn bộ object một lần (stream), tính `checksum_sha256` (policy `ChecksumRequired`) và chạy `document.ValidateFile`. Lần đọc này là chi phí chính; với 200 MB thì vài giây trên S3 cùng vùng.
7. Đạt → phiên FileService `staged` (`publishUpload` với size/checksum) → audit `document.upload_session_completed` →
   - Route workspace: tạo tài liệu từ upload đã staged (biến thể `CreateFileDocument` nhận `upload_id` thay vì body; claim trong cùng transaction như hôm nay) → `DocumentSDO`.
   - Route tài liệu / frame: `DocumentUploadSDO`; client commit như hiện có.
8. Hỏng ở bước 4–6 → xoá object, phiên FileService `canceled` (nhả quota), `failed` + `failure_code`, trả `415`/`413`/`422` như trên. Gọi lại `complete` trả cùng mã.

**DELETE:**
- `open` → AbortMultipart → phiên FileService `canceled` → `aborted` → audit `document.upload_session_aborted` → `204`.
- `completed` → `409 upload_session_completed`.
- Đã `aborted`/`expired` → `204` (idempotent).

## 5. Audit, sự kiện, cô lập

- Bốn action mới trong `internal/audit/actions.go`: `document.upload_session_opened`, `document.upload_session_completed`, `document.upload_session_aborted`, `document.upload_session_expired`.
  - Mỗi action có case trong `TestEveryAuditedCommandWritesItsRow` và nằm trong `auditActions()`.
  - `expired` có case dùng GC với đồng hồ giả.
  - Dòng audit ghi `session_id`, `file_id`, `size_bytes`, không ghi tên tệp vào metadata log.
- Không có topic outbox mới. Tài liệu tạo lúc `complete` phát `document.created` qua đường tạo hiện có; phiên bản mới phát qua commit hiện có.
- `isoRoutes`: chín route của §6.1 kèm body hợp lệ. Route theo id phiên dùng phiên của A làm control.
- `isoReferences`: thêm `parent_id` của route workspace (`CreateUploadSessionSDI.parent_id`).
- `TestIsolationMatrix` phải xanh mà không thêm `isoUnseeded`. Bảng mới được seed qua API, nhưng backend `local` của test không có multipart, nên test dùng fake (§7). Nếu matrix không chạy được với fake, đưa tên bảng vào `isoUnseeded` kèm lý do và hỏi lead trước.

## 6. Cấu hình và ops

- Không có env mới:
  - Ngưỡng 20 MiB (`chunked_upload_threshold_bytes` = 20971520), `part_size` 8 MiB, TTL phần 1 giờ, phiên 24 giờ và giới hạn 4 phiên là hằng số server.
  - `.env.example` không đổi.
- `docs/ops/`: luật lifecycle bucket "AbortIncompleteMultipartUpload 2 ngày" cho tiền tố `documents/files/` (backstop của GC; vận hành tự cấu hình, server không tự cấu hình bucket). Thêm dòng vào runbook FileService/storage hiện có.
- CORS bucket: client `PUT` thẳng lên URL phần và đọc header `ETag`, nên bucket phải cho phép `PUT` từ origin web và `ExposeHeaders: ETag`. Ghi ở cùng chỗ. Preflight (`internal/storage/preflight.go`) **không** kiểm tra CORS.

## 7. Fake và test

- `storage` có `fakeMultipartStore` (in-memory, test-only) cho test service/handler. `filesfake` thêm các phương thức phiên.
- Test S3 thật: thêm vào integration test MinIO hiện có của `internal/storage` (CI đã có service MinIO cho test này, `.github/workflows/ci.yml`). Đi đủ một vòng Create → UploadPart ×2 → ListParts → Complete → Stat, và Abort.
- Test bắt buộc:
  - Ba route tạo:
    - ≤ 20 MiB → 422.
    - cap + 1 → 413 với `max_bytes`.
    - Đuôi lạ → 415.
    - Probe hỏng: zip có macro, `cd_size` > 1 MiB, `head_b64` > 64 KiB → 415 `reason`.
    - Quota vượt → 403 `quota_exceeded`, và không tạo multipart.
    - Phiên thứ 5 → 429 với header `Retry-After: 60`.
    - Idempotency: cùng key trả cùng phiên; fingerprint khác → 409.
  - Chủ thể: người khác, route kia, tài liệu khác của frame token → 404 như nhau.
  - GET:
    - `completed_parts` từ ListParts.
    - URL mới chỉ cho phần thiếu.
    - Hết hạn → 410.
  - Complete:
    - Thiếu phần / ETag sai → 422 `upload_parts_invalid` và phiên vẫn `open`.
    - Size sai → 422.
    - Probe khác → 422.
    - `ValidateFile` hỏng → 415, object bị xoá và quota được nhả (đếm `CountStorageBytesInOrganization` trước/sau).
    - Đạt:
      - Route workspace trả `DocumentSDO` và phát `document.created`.
      - Route tài liệu trả `DocumentUploadSDO`, commit được qua `versions/commit`.
      - Route frame commit được qua route frame.
    - Gọi `complete` lần hai trả cùng kết quả.
    - Hai `complete` song song → một bên 409 busy.
  - DELETE:
    - Abort + nhả quota + 204.
    - Phiên đã xong → 409.
  - GC:
    - Phiên quá hạn → abort, nhả quota, audit `system`.
    - Phiên còn hạn không bị đụng.
    - Phiên `staged` vẫn do sweep FileService hiện có lo.
  - Config: có `chunked_upload_threshold_bytes` khi store có multipart + presign, không có khi backend `local`.
  - `mapServiceError` đặt `Retry-After` từ `fields.retry_after`.
  - Audit coverage + isolation matrix + `TestEveryQueryNamesItsTenant` + migration lint xanh.
- Luồng một request (§6.5 ý cuối, kiểm tra trên spool trước `Put`) **tách khỏi BIGUP-S1** thành thẻ nhỏ SIZE-S2 nếu Advisor đồng ý. Lý do: nó thay đổi `uploadChecked` / `checkStoredFile` cho mọi upload ≤ 20 MiB, không liên quan multipart, và BIGUP-S1 đã lớn.

## 8. Chia việc (song song sau khi contract được duyệt)

| Task | Phạm vi | Phụ thuộc |
| --- | --- | --- |
| S1-a | `ObjectStore` multipart + `Capabilities.Multipart` (s3, minio, local unsupported) + `fakeMultipartStore` + test | không |
| S1-b | Migration + index files + sqlc queries + FileService session service (tạo, GET, complete, delete, GC) trên fake store; quota, D5, idempotency, audit coverage | interface S1-a (đã chốt ở đây) |
| S1-c | Handler + router `apiOp` + SDI/SDO (+ `pathParamSDI` cho `sessionID`) + `mapServiceError` Retry-After + config field + isolation routes/references | interface service S1-b (chữ ký hàm chốt trong brief) |
| S1-d | `docs/ops` lifecycle + CORS, addendum r4 (D2, D7, trường `status`) | lead |

Mỗi task có red test trước. Review BE theo vùng (storage, service, handler), diff nhỏ. Có một vòng cloud trên SHA cuối, rồi Jev ac.

## 9. Câu hỏi cho Advisor (đã trả lời size-cap:006: duyệt D1–D7; tách SIZE-S2; Advisor báo D7 cho lane g5-fork_main)

1. D1–D7 có được duyệt không? Khuyến nghị: duyệt cả bảy.
2. Có tách "kiểm tra trên spool trước `Put`" thành SIZE-S2 không? Khuyến nghị: có tách.
3. `409 idempotency_conflict` trong §6.2 có đổi thành mã hiện có `idempotency_payload_mismatch` không? Khuyến nghị: dùng mã hiện có. Contract fork §8.3 cần biết, nên Advisor báo lane g5-fork_main.
