# Rehearsal `files-backfill` — ghi chú kỹ thuật (T9b, UNI-747)

Ngày 2026-09-27 · run ledger `01M3G0PEG6CE17FTYZ94DG8VYY` · script và artifact:
`reports/t9b-backfill/rehearsal/` (`rehearse.sh`, `seed.sql`, `objects.txt`,
`transcript.txt`, `plan.json`, `verify.json`, `rollback.json`).

## Môi trường

- DB test của worktree (`TEST_DATABASE_URL`), migrate đầy đủ tới 977 (ledger).
- MinIO rehearsal `uniwork-t9-minio` :19000, bucket `uniwork-t9` — 15 object
  seed theo shape legacy (`workspaces/.../attachments/`, `avatars/`,
  `chat/files|voice/`, `recordings/`, `audit-exports/`) + 2 object control
  G0/legacy (`v1/orgs/org-1/g0/control.bin`, `g0-legacy/control.bin`).
- `STORAGE_BACKEND=minio`; backend/bucket mặc định cho row thiếu toạ độ qua
  `--assume-backend minio --assume-bucket uniwork-t9`.

## Kịch bản đã diễn

`plan → dry-run → apply --batch-size 1 (SIGKILL giữa chừng) → apply --run
(resume) → verify → rollback → chứng minh G0`.

| Bước | Kết quả |
| --- | --- |
| plan | 23 seen / 15 verified / 2 unresolved / 5 held / 1 foreign; 11 object riêng biệt, 2 dup ref, 1 shared locator; **0** dòng ledger |
| dry-run | 14 verified, `att-miss` → `held/object_missing`; **0** dòng ledger |
| apply bị kill | 5 item committed (3 applied, 2 held), run treo `running` |
| resume | `apply --run` hoàn tất: **10 files, 10 sessions**; ledger đầy đủ mọi cohort |
| verify | mọi ref applied → `consistent`; `att-miss` → `pending_apply`; held/unresolved → `unreferenced`; **0** lỗi |
| rollback | `files`=0, `file_upload_sessions`=0, `attachments.file_id` về NULL |
| G0 | `mc stat` control object còn nguyên; 0 `files` row cho `g0-legacy/*`; locator `v1/*` vẫn trong bảng (held cho GC dry-run) |

## Hành vi đáng chú ý đã chứng minh

- **Crash-safety:** checkpoint chỉ tiến sau commit; batch replay không tạo
  `files` trùng (`ON CONFLICT (storage, bucket, object_key)` rồi đọc lại
  winner). Kill giữa batch → 5 item đã ledger, resume xử phần còn lại.
- **Dedup cùng scope:** `att-dup` trỏ cùng object với `att-a1` → một `files`
  row, một session (unique `file_upload_sessions.file_id`), hai `file_id` giống
  nhau.
- **Cross-tenant shared locator:** `recordings/shared.mp4` được hai org tham
  chiếu → `held/cross_scope_shared_locator` cả hai phía, không merge.
- **Ref ẩn trong nội dung:** `content-refs` (markdown `attachments/<id>`) là
  evidence row — không mint file riêng; verify chỉ kiểm `file_id` của
  attachment được tham chiếu tồn tại.
- **Không đụng bytes:** mọi bước chỉ `Stat`; rollback cũng không xoá object.

## Ghi chú vận hành

- `objects.txt` phải là LF: `mc pipe` nhận `\r` cuối dòng thành một phần của
  object key (rehearsal đầu bị 404 do key `...\r`). `rehearse.sh` đã trim CR.
- `MINIO_REGION` (hoặc `S3_REGION`/`AWS_REGION`) phải được set — thiếu thì
  adapter không nối được và dry-run/apply đổ `object_missing` hàng loạt; engine
  fail-loud nếu không build được store cho locator `assume-backend`.
- Lệnh không bao giờ chạy trên DB/bucket thật: rehearsal pin cứng
  `DATABASE_URL` tới DB test trong `rehearse.sh`.
