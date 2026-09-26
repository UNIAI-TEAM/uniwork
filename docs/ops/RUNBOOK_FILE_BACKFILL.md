# Runbook — backfill FileService (`files-backfill`)

> **Trạng thái:** shipped · **Cập nhật:** 2026-09-27 · **Thành phần:** `server/cmd/files-backfill` + `server/internal/service/backfill` · **Liên quan:** UNI-747 (T9b/T9c), spec inventory §9, plan §4 T9 + §7, packet `reports/t9b-backfill/acceptance-packet.md`

`files-backfill` đưa các object storage kế thừa (legacy) vào `files` +
`file_upload_sessions` rồi gắn `file_id` vào bảng nghiệp vụ. Lệnh này **chỉ đọc
và ghi database**, chỉ `Stat` object — không bao giờ ghi hay xoá bytes. Mọi bước
được checkpoint trong `file_backfill_runs` / `file_backfill_items` /
`file_backfill_checkpoints` (migration 977, placeholder).

## Triệu chứng

Chạy lệnh khi một cohort (M1..M12 trong inventory §9) cần cutover sang
FileService, hoặc khi cần báo cáo trạng thái di cư:

```text
files-backfill plan      # báo cáo read-only: không ledger, không Stat
files-backfill dry-run   # plan + Stat object; vẫn không ghi gì
files-backfill apply     # mở run ledger, ghi files + sessions + file_id
files-backfill verify    # reconcile read-only: ref ↔ files ↔ session ↔ object
files-backfill rollback  # --run bắt buộc; gỡ ref, xoá session/file do run mint
```

Dấu hiệu cần chạy: consumer đã có đường FileService (`file_id` column tồn tại)
nhưng còn row với locator legacy và `file_id IS NULL`.

Flag chung: `--cohort` (lọc, mặc định tất cả), `--batch-size`, `--format
text|json`, `--items` (chi tiết từng item), `--out FILE`, `--run RUN_ID`
(resume/verify/rollback), `--assume-backend`, `--assume-bucket` (điền
backend/bucket cho source row không lưu toạ độ — ví dụ `chat_messages`).

## Kiểm tra

1. `plan` trước tiên — đọc bảng cohort và `reasons`. Item nào `held` hay
   `unresolved` phải hiểu lý do trước khi apply (`object_missing`,
   `cross_scope_shared_locator`, `external_url`, `avatar_user_mismatch`,
   `room_tenant_missing`, `organization_mismatch`, `dangling_attachment_ref`…).
2. `dry-run` — mọi object `verified` phải Stat được; `object_missing` nghĩa là
   row tham chiếu object không còn trong bucket — **không** apply đè lên nó.
   Sau `plan`/`dry-run`, `file_backfill_runs` phải vẫn trống.
3. `apply` — kiểm ledger sau mỗi batch:

   ```sql
   SELECT cohort, status, count(*) FROM file_backfill_items
    WHERE run_id = '<RUN_ID>' GROUP BY cohort, status;
   SELECT cohort, cursor FROM file_backfill_checkpoints WHERE run_id = '<RUN_ID>';
   ```

   Checkpoint chỉ cập nhật sau khi transaction batch commit: crash giữa batch
   → batch đó replay nguyên vẹn, `ON CONFLICT` trên `(storage, bucket,
   object_key)` bảo đảm không trùng `files` và một session một file.
4. `verify --run <RUN_ID>` — verdict `consistent` cho mọi ref đã apply;
   `pending_apply`/`unreferenced` là trạng thái hợp lệ cho item held/unresolved;
   `file_row_missing`, `locator_mismatch`, `session_missing`,
   `session_scope_mismatch`, `object_missing`, `size_mismatch`,
   `unexpected_reference`, `drift` là lỗi. Lưu ý: size equality kiểm
   `files.size_bytes` = `Stat`, không phải byte identity.

## Khắc phục

- **Run dở dang (`status='running'`, process đã chết):** chạy lại
  `files-backfill apply --run <RUN_ID>` — ledger bỏ qua item đã commit, replay
  phần còn lại. Không cần dọn tay.
- **Rollback một run apply** (trước khi writer mới bật, plan §7 Recovery):

  ```sh
  files-backfill rollback --run <RUN_ID>
  ```

  Rollback chỉ gỡ `file_id` còn đúng giá trị run đã ghi, xoá session do run
  mint, xoá `files` do run tạo nếu không còn session nào giữ — **không đụng
  object**, không undo thay đổi nghiệp vụ sau đó. Run kết thúc `rolled_back`.
- **Item `held`:** xử lý theo reason — `object_missing`: restore hoặc xoá row
  nguồn; `cross_scope_shared_locator`: quyết định thủ công owner (không merge
  cross-tenant); `*_mismatch`: sửa row nguồn rồi chạy lại plan.
- **Cutover theo cohort (T9c):** gỡ callsite storage trực tiếp chỉ khi đường
  FileService của consumer đó đã được nối (`s.files != nil` trong t9-int) và
  test xanh. Bảng dưới là checklist — mỗi hàng một bước, thứ tự trên xuống:

  | # | Consumer | Callsite còn lại (inventory §3) | Điều kiện gỡ | Owner |
  | --- | --- | --- | --- | --- |
  | 1 | Task/comment/description attachment | `task_attachments.go` #6–12 (Upload, DeleteObject ×4, GetReader, DeleteObject dọn) | FS path T6 merged + cohort `task-attachments` applied + verify consistent | lane consumer UNI-744 |
  | 2 | Avatar | `handler/avatar.go` #14–15 (Upload, Delete) | `AuthService.FilesEnabled()` live + cohort `avatars` applied | UNI-744 |
  | 3 | Chat file | `chat_file_message.go` #16–19 | cohort `chat-files` applied | UNI-745 |
  | 4 | Chat voice | `chat_voice_message.go` #20–23 | cohort `chat-voice` applied | UNI-745 |
  | 5 | Meeting recording | `meeting_ai.go` #27–28, #34 + `recording_playback.go` #29–30, #32–33 | `MeetingService.FileServiceEnabled()` + `meeting-recordings` applied | UNI-746 |
  | 6 | Call recording | `chat_voice.go` #24–26 + `recording_playback.go` chung | `VoiceFileServiceEnabled()` + `call-recordings` applied | UNI-746 |
  | 7 | Audit export | `audit_export.go` #13 (Upload) + `audit.go` #31 (ObjectURL) | cohort `audit-exports` applied | UNI-749 |

  Giữ nguyên: adapter `internal/storage` (S3/Local) và `NormalizeObjectURL` —
  G0/Office/legacy (inventory §6.1) còn dùng; gỡ khi G0 retire (plan §7 bước 8).

## Leo thang

- `verify` báo `drift` hoặc `unexpected_reference` → dừng cutover, ping owner
  lane FileService (UNI-726) với `verify.json` và run id.
- Locator `held` do cross-tenant → escalation tới reviewer của wave; không tự
  merge.
- Nghi ngờ ledger hỏng (checkpoint sai, run không resume được) → giữ nguyên
  bảng `file_backfill_*` và report `verify.json`, chuyển cho owner T9b.
