# Runbook — Documents (trang, tệp, phiên bản, worker)

> **Trạng thái:** in-progress · **Cập nhật:** 2026-09-28 · **Thành phần:** `DocumentService`, `DocumentWorkers` (auto-version / purge / compact) trong tiến trình API, byte qua `FileService` · **Liên quan:** C-01 §6.3/§14, ADR 0022, `docs/ops/RUNBOOK_FILE_GC.md`, `docs/ops/RUNBOOK_OFFICE_ENGINE.md`, `docs/ops/RUNBOOK_OUTBOX.md`

Documents không giữ byte: mọi tệp nằm ở FileService (ADR 0022). Vì vậy
orphan backlog và delete-failure **không có metric riêng ở đây** — chúng là số
của FileService GC (`file_jobs`, báo cáo `FileGCReport`, xem
[`RUNBOOK_FILE_GC.md`](RUNBOOK_FILE_GC.md)); Documents chỉ giữ metadata,
quyền, lịch sử và tham chiếu (`ReferenceProvider`).

## Số cần nhìn

| Metric | Ý nghĩa | Ngưỡng gợi ý |
| --- | --- | --- |
| `uniwork_document_saves_total{kind,outcome}` | Kết quả lệnh lưu: `page` = PATCH autosave, `file` = commit phiên bản tệp. `outcome` cố định: ok/conflict/quota/forbidden/not_found/gone/invalid/unavailable/error | `outcome="error"` hoặc `"unavailable"` khác 0 liên tục = điều tra |
| `uniwork_document_save_duration_seconds{kind}` | Thời gian lệnh lưu. p95 PATCH là SLO C-01 §9.4 (< 150 ms, 200 người lưu 200 KiB/2 s) | p95 > 150 ms liên tục |
| `uniwork_document_conflicts_total{kind,code}` | Lưu thua vì base đã cũ (`revision_conflict` / `document_version_conflict`) | Tăng vọt = nhiều tab/agent cùng sửa một trang |
| `uniwork_document_quota_rejects_total{kind}` | Lưu bị từ chối vì `storage.bytes` vượt hạn mức tổ chức | > 0 kèm phản hồi người dùng |
| `uniwork_document_access_log_failed_total` | Dòng nhật ký truy cập ghi lỗi sau khi lần đọc đã thành công | > 0 = kiểm DB/khóa; lần đọc vẫn đúng |
| `uniwork_document_versions_protected_overflow_total` | Bản ghi bảo vệ (manual/restore/upload) vượt trần nén; mọi bản được giữ | Chỉ để nhìn |
| `uniwork_document_worker_sweeps_total{worker,result}` | Lượt quét auto-version/purge/compact theo kết quả | `result="error"` lặp lại |
| `uniwork_document_worker_sweep_duration_seconds{worker}` | Thời gian một lượt quét | Tăng dần đều |
| `uniwork_document_worker_oldest_pending_seconds{worker}` | Tuổi công việc quá hạn cũ nhất worker còn nợ (`autoversion` = trang quá 10 phút im chưa chụp; `purge` = tài liệu archive quá `purge_after` hoặc asset mồ côi quá 7 ngày) | Tăng liên tục = worker không theo kịp |
| FileService GC | orphan/delete-failure, quarantine, coverage gap | Xem [`RUNBOOK_FILE_GC.md`](RUNBOOK_FILE_GC.md) |
| Outbox | `document.*` / `document.shared`… không tới client | Xem [`RUNBOOK_OUTBOX.md`](RUNBOOK_OUTBOX.md) |

## Triệu chứng

- **Lưu thất bại (autosave/commit).** UI báo lỗi lưu hoặc "xung đột"; client
  giữ nháp. Metric: `uniwork_document_saves_total{outcome=...}` và
  `uniwork_document_conflicts_total`; với tệp là route
  `POST /documents/{id}/uploads` + `POST /documents/{id}/versions/commit`.
- **Storage không sẵn sàng.** Lệnh lưu trả `storage_unavailable` (503),
  `outcome="unavailable"` tăng; các lần đọc (list/history) cũng có thể lỗi.
  Đây là sự cố **FileService/backend byte**, không phải Documents.
- **Purge lỗi.** `uniwork_document_worker_sweeps_total{worker="purge",result="error"}`
  tăng, `uniwork_document_worker_oldest_pending_seconds{worker="purge"}` leo
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
   `autoversion` tăng mà sweep vẫn `ok` = có trang không đủ điều kiện chụp
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
  (`FileGCConfig.Mode=dry_run|off`, mặc định dry_run; destructive cần người
  quyết) — dừng ở đó, **không** xóa hàng lỗi thủ công để làm đẹp metric
  (plan §8.2).
- **Backup/restore (metadata + blob, cùng một mốc):**
  1. Metadata: dump Postgres (`pg_dump`), gồm `documents`, `document_versions`,
     `document_assets`, `document_shares`, `document_access_logs`.
  2. Blob: snapshot backend FileService (bucket MinIO/S3 hoặc thư mục
     `LOCAL_UPLOAD_DIR`) **tại cùng thời điểm** với dump; FileService không
     nhân bản byte nên thiếu một trong hai là không khôi phục được.
  3. Khôi phục cả hai vào môi trường đích, chạy migration tới phiên bản của
     dump, rồi kiểm bước 6: checksum khớp, `asset://` phân giải được, version
     tải được.
  4. Trong lúc khôi phục: để GC ở `dry_run`/`off`; sau khôi phục kiểm
     `file_jobs`/`files` không có `deleting` mồ côi trước khi bật lại.
  5. Rollback tính năng là **tắt flag** `documents` (org override/`FF_DOCUMENTS`),
     giữ nguyên DB/object; không chạy down migration hay purge dữ liệu như thao
     tác rollback (plan §8.2).

## Leo thang

- `outcome="error"` hoặc `"unavailable"` > 5% số lần lưu trong 10 phút → sev 2,
  gọi on-call backend (Documents + FileService).
- Purge lỗi kéo dài qua 2 lượt quét (2 giờ) hoặc `oldest_pending_seconds{purge}`
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
