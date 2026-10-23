# Runbook — thu gom file rác và reconcile của FileService

> **Trạng thái:** in-progress · **Cập nhật:** 2026-10-14 · **Thành phần:** `FileService.SweepFiles` / `FileGCWorker` trong tiến trình API · **Liên quan:** UNI-743 (T5), spec `docs/superpowers/specs/2026-09-22-shared-file-service-design.md` §9, FS-C1 §6

Collector chạy **một lần mỗi ngày** (mặc định 03:00 UTC+7) và làm ba việc
trong cùng một lượt: đóng cửa sổ claim đã quá 24 giờ, tìm file không còn ai
giữ, và xử lý các job bền trong `file_jobs` (`cleanup`, `reconcile`,
`abort_multipart`). Không có vòng quét mỗi phút; job lỗi luôn quay về
`pending` với `next_attempt_at` rơi đúng một lượt quét hằng ngày sau đó
(1, 2, 4, tối đa 8 ngày) và **không bao giờ bị bỏ**.

## Chế độ

Server đọc chế độ từ biến môi trường `FILE_GC_MODE`
(`server/internal/config/config.go`) và truyền vào `FileGCConfig.Mode`. Giá
trị khác ba giá trị dưới đây làm server không khởi động.

| `FILE_GC_MODE` | Làm gì |
| --- | --- |
| `destructive` (**mặc định của server**, khi không đặt biến) | Làm thật theo giao thức khóa: file không còn ai tham chiếu (ví dụ avatar cũ sau khi đổi, file đính kèm đã gỡ) bị xóa object rồi đánh dấu `deleted`. |
| `dry_run` | Đọc, kiểm, trả `FileGCReport` và log tóm tắt. Không lease job, không đổi trạng thái, không xóa object. Đây cũng là chế độ khi gọi `NewFileService` không truyền `GC` (test, công cụ). |
| `off` | Không quét. |

Người dùng quyết bật `destructive` ngày 2026-10-14, trước Gate E của plan
FileService (§3.3). Phạm vi xóa vẫn chỉ là hàng `files` của chính môi trường;
object legacy/G0 và object ngoài gốc `S3_KEY_PREFIX` bị cách ly, không bao giờ
bị xóa (xem bảng báo cáo). Muốn dừng xóa: đặt `FILE_GC_MODE=dry_run` (hoặc
`off`) rồi khởi động lại server; job đang chờ giữ nguyên và chạy tiếp khi bật lại.

Worker (`FileService.NewFileGCWorker`) đã nối trong `cmd/server/main.go`: khởi động
cùng server, lượt quét đầu ở mốc 03:00 kế tiếp (không quét lúc khởi động), dừng theo context trong
shutdown sequence. Mỗi lượt chỉ một replica chạy (advisory lock).

Object dưới `avatars/<user>/...` của luồng avatar cũ (cột `users.avatar_url`,
trước FileService) không có hàng `files`, nên collector không thấy và không
xóa; đổi avatar lần đầu chỉ xóa URL trong hàng user. Dọn chúng cần
`files-backfill` (T9) đưa vào `files` trước.

## Giao thức xóa

1. Lease job (`file_jobs.lease_owner` + `generation`); một replica chạy tại một
   thời điểm nhờ advisory lock `0x756e69666763`.
2. Trong một transaction: khóa `files` theo id tăng dần → sessions → jobs; kiểm
   lại tuổi (`ready_at` + 24 giờ), session (cửa sổ claim), locator có thuộc
   allowlist không, tenant của file/session/job/reference, và hỏi **mọi**
   `ReferenceProvider`.
3. File thật sự tự do → `deleting`, commit (hàng rào: claim/resolve sau đó bị từ chối).
4. Xóa object ngoài transaction, rồi `Stat` phải trả not-found cho đúng
   locator/version; nil từ `Delete` chưa phải bằng chứng.
5. `deleted` + đóng job (fence theo generation).

## Gốc môi trường (`S3_KEY_PREFIX`, UNI-947)

Nhiều môi trường có thể dùng chung một bucket (ví dụ `uniwork/develop/` và
`uniwork/production/`). FileService sinh key `<root>v1/...` với `<root>` là
`S3_KEY_PREFIX` đã chuẩn hóa, cho mọi backend. Allowlist của collector (bước 2)
và reconcile tombstone chỉ nhận key bắt đầu bằng `<root>v1/` của **chính** môi
trường đang chạy: object dưới gốc của môi trường khác, hoặc ở gốc bucket khi đã
đặt gốc (kể cả hàng `v1/...` tạo trước khi đặt gốc), là `unmanaged_locator`,
bị cách ly và không bao giờ bị xóa. Collector không liệt kê bucket; nó chỉ xóa
theo hàng `files` của database môi trường mình. Đổi `S3_KEY_PREFIX` của một
môi trường đang chạy làm mọi file cũ thành `unmanaged_locator` — không đổi giá
trị này sau khi đã có dữ liệu.

## Đọc báo cáo

Mỗi dòng `FileGCEntry` có `Action` và `Reason`. Log cuối lượt:
`files gc: sweep finished mode=… deleted=… held=… retry=… quarantined=… aborted=…`.

| Action | Reason | Ý nghĩa / việc cần làm |
| --- | --- | --- |
| `deleted` / `would_delete` | `unreferenced`, `resume_deleting`, `tombstone_recheck`, `late_object` | Bình thường. |
| `held` | `held:<provider>:<reason>` | Còn reference/hold (active, version_history, soft_deleted, retention, legal_hold). Job đóng; lần gỡ reference sau sẽ tạo job mới. |
| `retry` | `too_young`, `claim_window_open`, `writer_active` | Chưa tới hạn; tự chạy lại ở lượt sau. |
| `retry` | `storage_unavailable`, `object_still_present`, `storage_version_required`, `storage_adapter_missing`, `tombstone_failed` | Lỗi storage. File giữ `deleting`, bytes chưa được coi là đã xóa. Xem mục Khắc phục. |
| `quarantined` | `cross_tenant_reference`, `tenant_mismatch_session`, `tenant_mismatch_job` | Dữ liệu lệch tenant (T1-Q10). File **không** bị xóa. Điều tra như sự cố dữ liệu. |
| `quarantined` | `unmanaged_locator`, `foreign_storage`, `legacy_locator_shared` | Object legacy/G0, của backend khác, nằm ngoài gốc môi trường này, hoặc key còn được một cột legacy dùng. Không bao giờ xóa tự động; chờ T9 bàn giao ownership. |
| `quarantined` | `object_missing` | File ready còn reference nhưng mất bytes. Reference giữ nguyên; cần phục hồi object. |
| `quarantined` | `writer_unconfirmed` | Provider (LiveKit/Office) quá deadline mà chưa có object. Không xóa; provider có thể còn ghi muộn. |
| `quarantined` | `abort_multipart_unsupported` | Chưa adapter nào abort được multipart; job được giữ. |
| `aborted` | `provider_error`, `missing_provider` | Cả batch dừng, không file nào bị xóa. |

`FileGCReport.Coverage` khác rỗng nghĩa là có cột file_id trong catalogue
hoặc purpose đang bật mà chưa có provider: **mọi job cleanup bị để nguyên**
(không lease, không tăng attempt). Lỗi khi chụp danh sách locator legacy
(một truy vấn mỗi lượt quét trên `attachments`, `users`, `meeting_recordings`,
`chat_voice_recordings`, `chat_messages`, lọc giá trị có chứa `v1/orgs/` hoặc
`v1/users/`, có hoặc không kèm gốc môi trường) cũng hiện ở đây và có cùng hậu quả. Cột `audit_exports.file_id` (T10) có provider `audit.exports`; bộ provider ở composition root phải gồm nó, nếu không collector sẽ báo gap và không xóa gì.

## Truy vấn kiểm tra (chỉ đọc)

```sql
-- Job còn sống theo mã lỗi, tuổi và số lần thử
SELECT operation, error_code, count(*), min(created_at), max(attempt)
FROM file_jobs WHERE status IN ('pending', 'leased')
GROUP BY 1, 2 ORDER BY 3 DESC;

-- File kẹt ở deleting (xóa object đang lỗi)
SELECT f.id, f.storage, j.error_code, j.attempt, j.next_attempt_at
FROM files f JOIN file_jobs j ON j.file_id = f.id AND j.operation = 'cleanup'
WHERE f.status = 'deleting' AND j.status IN ('pending', 'leased');
```

Không đọc hay log `object_key`, bucket hay URL vào kênh chung; báo cáo chỉ mang id.

## Khắc phục

- **Lỗi storage lặp lại:** kiểm credential/quyền `DeleteObject`, Object Lock
  hoặc retention trên bucket. Không bypass hold; job tự thử lại theo backoff.
  `storage_version_required` nghĩa là bucket có versioning mà file không ghi
  `object_version` — không xóa tay bằng key.
- **Quarantine tenant:** tìm hàng nghiệp vụ trỏ vào file (cột ở
  `managedFileReferenceSources`, `server/internal/service/file_references.go`),
  sửa dữ liệu theo quy trình sự cố; không xóa file để "dọn".
- **Coverage gap:** đăng ký provider còn thiếu ở composition root
  (`FileServiceOptions.ReferenceProviders`). Không tắt purpose để lách.
- **Worker crash giữa chừng:** không cần làm gì — lease hết hạn
  (`JobLease`, mặc định 30 phút) thì lượt sau lấy lại và hoàn tất file đang `deleting`.

## Leo thang

- Job `cleanup`/`reconcile` sống quá 8 ngày hoặc `attempt` ≥ 4 → báo người
  phụ trách FileService (T5) kèm id file/job và `error_code`.
- Bất kỳ `cross_tenant_reference` nào → coi là sự cố dữ liệu tenant, báo ngay
  người phụ trách bảo mật dữ liệu; không tự sửa.
- Đề xuất cảnh báo (chưa nối, cần metrics + dòng trong `deploy/alerts.yml` qua
  người tích hợp): `FileGCJobsStuck` khi job sống quá 8 ngày,
  `FileGCQuarantine` khi có job quarantined mới.
