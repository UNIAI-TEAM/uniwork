# Rehearsal `files-backfill` — ghi chú kỹ thuật (T9b, UNI-747)

Ngày 2026-09-27 · run ledger `01M3G33BN69DTSMB51PD2BE2TA` (bản sau review r1) ·
script và artifact: `reports/t9b-backfill/rehearsal/` (`rehearse.sh`,
`seed.sql`, `objects.txt`, `transcript.txt`, `plan.json`, `verify.json`,
`rollback.json`).

## Môi trường

- DB test của worktree (`TEST_DATABASE_URL`), migrate đầy đủ tới 977 (ledger).
- MinIO rehearsal `uniwork-t9-minio` :19000, bucket `uniwork-t9` — 15 object
  seed theo shape egress/legacy thật (`workspaces/.../attachments/`,
  `avatars/`, `chat/files|voice/`, `meetings/<ws>/`, `chat-voice/<org>/<room>/`,
  `audit-exports/`) + 2 object control G0/legacy (`v1/orgs/org-1/g0/control.bin`,
  `g0-legacy/control.bin`).
- `STORAGE_BACKEND=minio`; backend/bucket mặc định cho row thiếu toạ độ qua
  `--assume-backend minio --assume-bucket uniwork-t9`.

## Kịch bản đã diễn

`plan → dry-run → apply --batch-size 1 (SIGKILL giữa chừng) → apply --run
(resume) → verify → rollback → chứng minh G0`.

| Bước | Kết quả |
| --- | --- |
| plan | 23 seen / 15 verified / 2 unresolved / 6 held / 1 foreign; 11 object riêng biệt, 2 dup ref; **0** dòng ledger |
| dry-run | 14 verified, `att-miss` → `held/object_missing`; **0** dòng ledger |
| apply bị kill | 2 item committed, run treo `running` |
| resume | `apply --run` hoàn tất: **10 files, 10 sessions**; ledger đầy đủ mọi cohort |
| verify | mọi ref applied → `consistent`; `att-miss` → `pending_apply`; held/unresolved → `unreferenced`; **0** lỗi |
| rollback | `files`=0, `file_upload_sessions`=0, `attachments.file_id` về NULL |
| G0 | `mc stat` control object còn nguyên; 0 `files` row cho `g0-legacy/*`; locator `v1/*` vẫn trong bảng (held cho GC dry-run) |

## Hành vi đáng chú ý đã chứng minh

- **Crash-safety:** checkpoint chỉ tiến sau commit; batch replay không tạo
  `files` trùng (`ON CONFLICT (storage, bucket, object_key)` rồi đọc lại
  winner). Kill giữa batch → resume xử phần còn lại.
- **Dedup cùng scope:** `att-dup` trỏ cùng object với `att-a1`; `msg-log`
  (voice_call_log) trỏ cùng object với `cvr-1` → mỗi cặp một `files` row,
  một session (unique `file_upload_sessions.file_id`).
- **Cross-tenant locator:** `chat-voice/org-1/room-1/shared-0001.mp4` được row
  org-2 tham chiếu → embedded org trong key mâu thuẫn row →
  `held/organization_mismatch`; object không bao giờ merge sang tenant khác.
  (Sau review r1, key-shape cross-check chạy trước shared-locator pass; pass
  đó vẫn là defense-in-depth cho cohort mới.)
- **Key-shape tenant proof (review r1):** recording URL chỉ verify khi key
  egress đúng shape và khớp tenant của row (`meetings/<ws>/`,
  `chat-voice/<org>/<room>/`); staged attachment → `held/staged_unbound`.
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
