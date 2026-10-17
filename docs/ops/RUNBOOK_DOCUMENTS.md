# Runbook — Documents (trang, tệp, phiên bản, worker)

> **Trạng thái:** in-progress · **Cập nhật:** 2026-10-15 · **Thành phần:** `DocumentService`, `DocumentWorkers` (auto-version / purge / compact) trong tiến trình API, byte qua `FileService` · **Liên quan:** C-01 §6.3/§14, ADR 0024, `docs/ops/RUNBOOK_FILE_GC.md`, `docs/ops/RUNBOOK_OFFICE_ENGINE.md`, `docs/ops/RUNBOOK_OUTBOX.md`

Documents không giữ byte: mọi tệp nằm ở FileService (ADR 0024). Vì vậy
orphan backlog và delete-failure **không có metric riêng ở đây** — chúng là số
của FileService GC (`file_jobs`, báo cáo `FileGCReport`, xem
[`RUNBOOK_FILE_GC.md`](RUNBOOK_FILE_GC.md)); Documents chỉ giữ metadata,
quyền, lịch sử và tham chiếu (`ReferenceProvider`).

## Số cần nhìn

| Metric | Ý nghĩa | Ngưỡng gợi ý |
| --- | --- | --- |
| `uniwork_document_saves_total{kind,outcome}` | Kết quả lệnh lưu: `page` = PATCH autosave, `file` = commit phiên bản tệp. `outcome` cố định: ok/conflict/quota/forbidden/not_found/gone/archived/invalid/unavailable/error. `forbidden` gồm `document_restricted` (quản trị viên giữ metadata nhưng chưa mở truy cập khẩn cấp — câu trả lời thường gặp của DOC-05); `archived` = tài liệu đã vào thùng rác, khác hẳn mất quyền đọc | `outcome="error"` hoặc `"unavailable"` khác 0 liên tục = điều tra; `forbidden`/`archived` là câu trả lời thiết kế, không phải sự cố |
| `uniwork_document_save_duration_seconds{kind}` | Thời gian lệnh lưu. p95 PATCH là SLO C-01 §9.4 (< 150 ms, 200 người lưu 200 KiB/2 s) | p95 > 150 ms liên tục |
| `uniwork_document_conflicts_total{kind,code}` | Lưu thua vì base đã cũ (`revision_conflict` / `document_version_conflict`) | Tăng vọt = nhiều tab/agent cùng sửa một trang |
| `uniwork_document_quota_rejects_total{kind}` | Bị từ chối vì `storage.bytes` vượt hạn mức tổ chức: `page` = lưu trang, `file` = tải lên hoặc commit phiên bản tệp, `asset` = tải ảnh vào trang. Tải lên bị chặn ngay ở bước giữ chỗ nên không bao giờ đếm hai lần ở commit | > 0 kèm phản hồi người dùng |
| `uniwork_document_access_log_failed_total` | Dòng nhật ký truy cập ghi lỗi sau khi lần đọc đã thành công | > 0 = kiểm DB/khóa; lần đọc vẫn đúng |
| `uniwork_document_versions_protected_overflow_total` | Bản ghi bảo vệ (manual/restore/upload) vượt trần nén; mọi bản được giữ | Chỉ để nhìn |
| `uniwork_document_worker_sweeps_total{worker,result}` | Lượt quét auto-version/purge/compact theo kết quả: `ok` = mọi row xong, `partial` = lượt chạy hết nhưng có row lỗi (bỏ qua, lượt sau thử lại), `error` = lượt dừng giữa chừng | `result="error"` hoặc `"partial"` lặp lại |
| `uniwork_document_worker_rows_failed_total{worker}` | Số row một lượt quét lỗi và bỏ qua | Tăng qua nhiều lượt = cùng row lỗi mãi, xem log `documents purge` / `documents auto-version` |
| `uniwork_document_worker_sweep_duration_seconds{worker}` | Thời gian một lượt quét | Tăng dần đều |
| `uniwork_document_worker_oldest_pending_seconds{worker}` | Tuổi công việc quá hạn cũ nhất worker còn nợ (`autoversion` = trang quá 10 phút im chưa chụp; `purge` = tài liệu archive quá `purge_after` hoặc asset mồ côi quá 7 ngày của tài liệu còn sống). Đọc tối đa mỗi 30 s | Tăng liên tục = worker không theo kịp |
| `uniwork_document_worker_lag_up{worker}` | 1 = lần đọc lag gần nhất thành công; 0 = đọc lỗi, khi đó gauge lag **vắng mặt** (không phải 0) | 0 = kiểm kết nối/khóa DB trước khi tin là hết việc |
| FileService GC | orphan/delete-failure, quarantine, coverage gap | Xem [`RUNBOOK_FILE_GC.md`](RUNBOOK_FILE_GC.md) |
| Outbox | `document.*` / `document.shared`… không tới client | Xem [`RUNBOOK_OUTBOX.md`](RUNBOOK_OUTBOX.md) |

## Triệu chứng

- **Lưu thất bại (autosave/commit).** UI báo lỗi lưu hoặc "xung đột"; client
  giữ nháp. Metric: `uniwork_document_saves_total{outcome=...}` và
  `uniwork_document_conflicts_total`; với tệp là route
  `POST /documents/{id}/uploads` + `POST /documents/{id}/versions/commit`.
- **Storage không sẵn sàng.** Lệnh cần byte trả `storage_unavailable` (503):
  tải lên, commit phiên bản tệp, tải về, ảnh trong trang. Chỉ commit phiên bản
  tệp có trong `uniwork_document_saves_total{kind="file",outcome="unavailable"}`;
  tải lên (tệp, ảnh) và tải về **không** có save outcome, nên số đó bằng 0 không
  loại trừ sự cố storage: xem tỉ lệ 5xx/503 theo route trong access log / metric
  HTTP và [`RUNBOOK_FILE_GC.md`](RUNBOOK_FILE_GC.md) / `/readyz`. Thư viện, mở
  trang và lịch sử phiên bản đọc metadata trong Postgres nên **vẫn chạy**; nếu
  chúng cũng lỗi thì là sự cố DB, không phải storage.
  Đây là sự cố **FileService/backend byte**, không phải Documents.
- **Purge lỗi.** Lỗi từng row: `uniwork_document_worker_sweeps_total{worker="purge",result="partial"}`
  và `uniwork_document_worker_rows_failed_total{worker="purge"}` tăng; cả lượt
  dừng: `result="error"`. `uniwork_document_worker_oldest_pending_seconds{worker="purge"}` leo
  thang; tài liệu hết hạn không được xóa (an toàn), hoặc xóa một nửa (row còn,
  tham chiếu chưa nhả).
- **Engine Office chết.** Job `office_jobs` không tiến triển; engine không nằm
  trong `/readyz` nên **thư viện, mở trang, lịch sử và tải về vẫn phải chạy**.
- **Backup/restore lệch.** Sau khôi phục, tệp tải về lệch checksum, ảnh trong
  trang vỡ (`asset://` không phân giải), hoặc version trỏ vào blob thiếu.

## Kiểm tra

1. Xác định loại lỗi lưu đang tăng:
   ```promql
   sum by (outcome, kind) (rate(uniwork_document_saves_total[10m]))
   sum by (code, kind) (rate(uniwork_document_conflicts_total[10m]))
   sum by (kind) (rate(uniwork_document_quota_rejects_total[10m]))
   ```
   `outcome="error"` mà không phải conflict/quota → lấy `correlation_id` từ
   response (`X-Trace-Id`) và tra log/audit; lỗi có `error_class` trên wire
   (C-01 §14.5).
2. `outcome="unavailable"` → chuyển ngay sang FileService: kiểm
   `STORAGE_BACKEND` (local/MinIO/S3) và credential của backend đang chọn;
   health của MinIO/S3; [`RUNBOOK_FILE_GC.md`](RUNBOOK_FILE_GC.md) phần Khắc phục.
   Thử lại an toàn: client giữ nháp, `Idempotency-Key` làm retry không tạo
   phiên bản thứ hai.
3. Purge lỗi — đọc bảng job/tham chiếu (chỉ đọc):
   ```sql
   -- Tài liệu đã archive quá hạn còn nợ purge
   SELECT id, organization_id, workspace_id, purge_after
   FROM documents
   WHERE archived_at IS NOT NULL AND purge_after IS NOT NULL
     AND purge_after < now() AND owner_id IS NULL
   ORDER BY purge_after LIMIT 50;

   -- Phiên bản/asset của một tài liệu còn giữ tham chiếu file nào
   SELECT v.id, v.file_id, v.reason FROM document_versions v
   WHERE v.document_id = '<id>' ORDER BY v.version;
   ```
   So với FileService (`files`, `file_jobs` —
   [`RUNBOOK_FILE_GC.md`](RUNBOOK_FILE_GC.md)): file còn `held` bởi provider
   `documents` là đúng nếu Documents còn giữ; file `deleting` kẹt mới là sự cố
   phía FileService. **Không xóa tay** row Documents để "dọn" — provider sẽ
   thả byte và GC xóa theo.
4. Worker lag:
   ```promql
   uniwork_document_worker_oldest_pending_seconds
   sum by (worker, result) (rate(uniwork_document_worker_sweeps_total[15m]))
   ```
   `result="partial"` hoặc `rows_failed_total` tăng = row lỗi bị bỏ qua (log
   theo document id). `autoversion` tăng mà sweep vẫn `ok` = có trang không đủ điều kiện chụp
   (đang sửa liên tục) hoặc quét không theo kịp; `purge` tăng = mục quá hạn
   không xóa được (xem bước 3).
5. Engine down: `OFFICE_ENGINE_URL` rỗng = không có engine (đúng thiết kế,
   job bị từ chối). Có URL mà health lỗi → xem
   [`RUNBOOK_OFFICE_ENGINE.md`](RUNBOOK_OFFICE_ENGINE.md) và trạng thái job:
   ```sql
   SELECT state, count(*) FROM office_jobs
   WHERE state NOT IN ('completed','failed','cancelled','timed_out')
   GROUP BY state;
   ```
6. Restore drill: so checksum bản ghi với byte đã khôi phục —
   ```sql
   SELECT d.id, v.id AS version_id, v.checksum_sha256, v.size_bytes
   FROM documents d JOIN document_versions v ON v.id = d.file_version_id
   WHERE d.kind = 'file' ORDER BY d.updated_at DESC LIMIT 20;
   ```
   rồi tải từng bản qua `GET /api/v1/documents/{id}/download` và đối chiếu
   `X-Checksum-Sha256` (proxy Go, không presign).

## Khắc phục

- **Lưu lỗi tạm thời:** không cần can thiệp DB — client retry với
  `Idempotency-Key` cũ trả lại đúng kết quả đã lưu; base cũ trả
  `revision_conflict`/`document_version_conflict` và UI hợp nhất. Chỉ điều tra
  khi `outcome="error"` lặp lại (log warn kèm `document_id`, `correlation_id`).
- **Storage unavailable:** khôi phục FileService/backend byte trước; **không**
  đổi `STORAGE_BACKEND` trên môi trường đang có dữ liệu (backend mới sẽ không
  thấy file cũ; xem FS-C1). Sau khi backend trở lại, retry từ client là đủ.
- **Purge lỗi:** để job tự thử lại theo lượt quét (1 job sống, không thử tay).
  Nếu `purge_after` đã qua mà row còn nguyên, kiểm lỗi trong log
  (`documents purge`), và kiểm FileService `ReleaseInTx` có bị chặn bởi file
  đang `deleting` không. Khôi phục archive (`restore`) trước purge là hành vi
  đúng — purge chỉ chạy cho row còn `purge_after` quá hạn.
- **Engine down:** xem [`RUNBOOK_OFFICE_ENGINE.md`](RUNBOOK_OFFICE_ENGINE.md).
  Không đụng tới flag `documents`; người dùng vẫn đọc/tải bản đã commit. Job
  `running` quá deadline tự `timed_out` qua reconciler; không có commit muộn.
- **Purge/cleanup nghi xóa sai:** có công tắc riêng của FileService GC
  (`FILE_GC_MODE=dry_run|off` rồi khởi động lại server; mặc định
  `destructive` từ 2026-10-14, xem [`RUNBOOK_FILE_GC.md`](RUNBOOK_FILE_GC.md))
  — dừng ở đó, **không** xóa hàng lỗi thủ công để làm đẹp metric (plan §8.2).
- **Backup/restore (metadata + blob, cùng một mốc):**
  1. Metadata: dump Postgres (`pg_dump`), gồm `documents`, `document_versions`,
     `document_assets`, `document_shares`, `document_access_logs`.
  2. Blob: snapshot backend FileService (bucket MinIO/S3 hoặc thư mục
     `LOCAL_UPLOAD_DIR`) **tại cùng thời điểm** với dump; FileService không
     nhân bản byte nên thiếu một trong hai là không khôi phục được.
  3. Khôi phục cả hai vào môi trường đích, chạy migration tới phiên bản của
     dump, rồi kiểm bước 6: checksum khớp, `asset://` phân giải được, version
     tải được.
  4. Trong lúc khôi phục: đặt `FILE_GC_MODE=dry_run` (hoặc `off`); sau khôi phục kiểm
     `file_jobs`/`files` không có `deleting` mồ côi trước khi bật lại.
  5. Rollback tính năng là **tắt flag** `documents` (org override/`FF_DOCUMENTS`),
     giữ nguyên DB/object; không chạy down migration hay purge dữ liệu như thao
     tác rollback (plan §8.2).

## Phiên tải lên tệp lớn (> 20 MiB, BIGUP-S1)

Tệp tài liệu lớn hơn 20 MiB không đi qua API: client mở một phiên, `PUT` từng phần 8 MiB thẳng lên
URL presigned của bucket, rồi gọi `complete` để server ghép và kiểm tra. Contract:
`docs/superpowers/specs/2026-10-17-bigup-upload-sessions-contract.md`.

- **Chỉ bật khi store có multipart + presign.** `GET /api/v1/config` có
  `documents.limits.chunked_upload_threshold_bytes` (20971520) khi bật; backend `local` không có trường này
  và mọi tệp đi luồng một request (giới hạn vẫn là `DOCUMENT_MAX_BYTES`).
- **Giới hạn:** mỗi người tối đa 4 phiên `open`/`validating` trên mọi tổ chức (`429 upload_sessions_exhausted`,
  `Retry-After: 60`); phiên sống 24 giờ; URL phần sống 1 giờ (`GET .../upload-sessions/{id}` cấp URL mới).
- **Quota:** giữ chỗ `size_bytes` lúc mở phiên; nhả khi huỷ, hết hạn, kiểm tra hỏng, hoặc reconcile của
  FileService khi mở phiên hỏng giữa chừng (job `reconcile` theo hạn lease của phiên).
- **GC:** `DocumentWorkers.Run` (10 phút một lần) gọi `ExpireMultipartUploads`: nhận các phiên quá hạn, abort
  multipart, huỷ phiên FileService (nhả quota), audit `document.upload_session_expired` với actor `system`.
  Abort trên storage là best-effort: lỗi chỉ ghi log WARN `documents: multipart GC abort failed`
  (`session_id`, `upload_id`) và dòng vẫn chuyển `expired`; phần dở dang còn lại do luật lifecycle bên dưới dọn.
- **Luật lifecycle bucket (bắt buộc, vận hành tự cấu hình; server không cấu hình bucket):**
  `AbortIncompleteMultipartUpload` sau **2 ngày** trên tiền tố `<S3_KEY_PREFIX>v1/` của môi trường (gốc
  FileService, xem `RUNBOOK_FILE_GC.md` › Gốc môi trường). Luật này chỉ đụng multipart chưa hoàn tất, không
  xoá object đã ghi. Thiếu luật thì phần của phiên mà GC abort hỏng sẽ nằm lại và tính tiền lưu trữ.
- **CORS:** trình duyệt `PUT` thẳng lên bucket và đọc header `ETag`, nên bucket phải cho phép `PUT` từ origin
  web và `ExposeHeaders: ETag` (`OFFICE_ENV_CHECKLIST.md` §3). Preflight của server (`internal/storage/preflight.go`)
  không kiểm tra CORS: thiếu CORS thì tải lên tệp lớn hỏng ở trình duyệt, còn API vẫn khoẻ.

Kiểm tra nhanh (chỉ đọc):

```sql
-- Phiên đang mở hoặc đang kiểm tra, theo tổ chức
SELECT organization_id, status, count(*), min(created_at), max(expires_at)
FROM file_multipart_uploads
WHERE status IN ('open', 'validating')
GROUP BY organization_id, status;

-- Phiên lẽ ra đã được GC (quá hạn hơn 30 phút mà chưa đóng): worker không chạy hoặc lease kẹt
SELECT id, status, lease_owner, lease_expires_at, expires_at
FROM file_multipart_uploads
WHERE status IN ('open', 'validating') AND expires_at < now() - interval '30 minutes';
```

Một phiên `validating` có `lease_expires_at` đã qua là phiên mà lần `complete` trước bị cắt giữa chừng: client gọi
lại `complete` sẽ nhận lại phiên, hoặc GC dọn khi phiên hết hạn. Không sửa dòng bằng tay.

## Leo thang

- `outcome="error"` hoặc `"unavailable"` > 5% số lần lưu trong 10 phút → sev 2,
  gọi on-call backend (Documents + FileService).
- Purge lỗi (`result` = `partial`/`error`) kéo dài qua 2 lượt quét (2 giờ) hoặc `oldest_pending_seconds{purge}`
  > 24 giờ → sev 2, kèm id tài liệu + `error_code`; nghi xóa sai/xuyên tenant →
  coi là sự cố dữ liệu, báo ngay người phụ trách bảo mật dữ liệu (như
  [`RUNBOOK_FILE_GC.md`](RUNBOOK_FILE_GC.md)).
- Mất dữ liệu hoặc checksum lệch sau restore → sev 1, dừng bật lại GC
  destructive và bảo tồn hiện trường (không sửa tay).
- Engine down ảnh hưởng chỉ tính năng Office (chưa có UI sản phẩm tới G3): sev 3,
  thông báo người phụ trách engine; không mở đường lưu thứ hai.

## Đề xuất cảnh báo (chưa nối vào `deploy/alerts.yml`)

`deploy/alerts.yml` đang giữ đúng tám alert của spec F-11 §6.5; G1-09 không tự
thêm dòng (việc đó cần người sở hữu spec F-11 duyệt). Khi nối, đặt runbook cho
từng alert dưới `docs/runbooks/<AlertName>.md` với đủ bốn mục
(Triệu chứng / Kiểm tra / Khắc phục / Leo thang, xem
`scripts/alerts-runbooks.test.mjs`):

- `DocumentsSaveErrorRateHigh` — `outcome="error"`/`"unavailable"` > 5%/10 phút.
- `DocumentsWorkerLagHigh` — `oldest_pending_seconds{worker}` > 1 giờ (autoversion)
  / 24 giờ (purge).
- `DocumentsQuotaRejectsSpike` — `quota_rejects_total` tăng bất thường.

Cảnh báo orphan/delete của FileService (`FileGCJobsStuck`, `FileGCQuarantine`)
thuộc [`RUNBOOK_FILE_GC.md`](RUNBOOK_FILE_GC.md).
