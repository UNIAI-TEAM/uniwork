# UniWork — Inventory file/storage trên HEAD cho FileService (T9a)

> **Trạng thái:** in-progress — inventory chỉ đọc (read-only) cho T9a/UNI-747; chưa có code, migration hay cleanup nào chạy từ tài liệu này.

**Ngày:** 2026-09-24 · **Issue:** UNI-747 (parent UNI-726) · **Lane:** `t9a-inventory`
**Nguồn:** [plan FileService](../plans/2026-09-22-shared-file-service.md) (§4 T9, §6.1 "Bước 0"), [spec FileService](2026-09-22-shared-file-service-design.md), [hợp đồng FS-C1](2026-09-24-file-service-contract.md)
**Revision khảo sát:** `5117be7c` — branch `feature/UNI-747-file-service-inventory`, base `feature/UNI-726-shared-file-service`. Mọi số dòng dưới đây đọc trên revision đó; lane tiêu thụ phải chạy lại các lệnh ở §2 trên revision của mình trước khi sửa.

**Phạm vi tài liệu:** đếm và mô tả mọi chỗ code đang gọi tầng storage, mọi cột/JSON/Markdown đang giữ key hoặc URL, consumer frontend đang dựng/cache URL, consumer legacy/G0 nằm ngoài đợt chuyển, writer ngoài đang hoạt động, test hiện có theo module, checklist Bước 0 cho bốn lane UNI-744/745/746/749, và mapping locator → `file_id` + `organization_id`.
**Ngoài phạm vi:** không sửa code, không viết migration, không fetch URL ngoài, không đọc dữ liệu không phải test, không mở destructive GC.

## 1. Cách đọc tài liệu

- §2 là bằng chứng AC-1: đúng các lệnh `rg` và số dòng mỗi lệnh, để tester chạy lại và so số.
- §3 là bảng callsite storage hiện tại: `file:line`, module, purpose FS-C1 dự kiến, nơi lưu key/URL, bucket/prefix, cleanup hiện có.
- §4 trả lời "cột/JSON/Markdown nào đang giữ key hoặc URL", kèm migration tạo ra chúng.
- §5 mô tả frontend (packages/core, packages/views): nơi dựng URL, nơi cache, cách xử lý hết hạn. Câu trả lời ngắn: hôm nay frontend **không** gọi storage; nó gọi HTTP, và chỉ cache URL có hạn ở ba chỗ (file chat, voice, recording).
- §8 là phần bốn lane UNI-744/745/746/749 cần: checklist Bước 0 theo hành vi cụ thể + test hiện có phải giữ xanh, kèm lớp test còn thiếu.
- §9 là mapping locator → `file_id` + `organization_id` cho T9b, chia verified / unresolved / shared-with-legacy, kèm rủi ro cross-tenant.
- §10 là các khoảng trống đã xác nhận trên HEAD (đầu vào cho T9b/T9c và cho người viết test Bước 0).

Thuật ngữ: "locator" = chuỗi định vị object đang nằm trong DB (object key, URL đầy đủ, hay field JSON chứa một trong hai). "Purpose" = `files.UploadPurpose` trong FS-C1 §3.

## 2. Bằng chứng AC-1: lệnh grep và số đếm

Chạy từ gốc worktree của lane (Git Bash). Hai script dưới đây nằm trong acceptance packet và sinh ra từng file bằng chứng:

```sh
bash D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/file-service/reports/t9a-inventory/ac1-greps.sh        # cmd1..cmd5
bash D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/file-service/reports/t9a-inventory/ac1-greps-extra.sh  # cmd6, cmd6b, cmd7
```

| # | Lệnh (nguyên văn) | Số dòng | Ý nghĩa |
| --- | --- | --- | --- |
| cmd1 | `rg -n --no-heading -g '!**/*_test.go' '\.(Upload\|DeleteObject\|DeleteKeys\|ObjectURL\|KeyFromURL\|CdnDomain\|GetReader\|PresignGet\|PresignGetWithContentDisposition)\(' server/ packages/` | **26** | mọi lời gọi method storage (trừ các biến thể `Delete` và trừ test) |
| cmd2 | `rg -n --no-heading -g '!**/*_test.go' '(Storage\|storage\|store)\.Delete\(' server/ packages/` | **5** | các lời gọi `Delete` best-effort (không surfaced error) |
| cmd3 | `rg -n --no-heading '(Upload\|Delete\|DeleteObject\|DeleteKeys\|ObjectURL\|KeyFromURL\|CdnDomain\|GetReader\|PresignGet\|PresignGetWithContentDisposition)\(' server/internal/storage/storage.go server/internal/storage/s3.go server/internal/storage/local.go server/internal/storage/util.go server/internal/storage/prefixes.go` | **39** | interface + hiện thực trong chính package storage (gồm hàm nội bộ) |
| cmd4 | `rg -n --no-heading -g '!**/*_test.go' 'storage\.Storage\|NewS3StorageFromEnv\|NewLocalStorageFromEnv' server/` | **14** | nơi giữ/khởi tạo `storage.Storage` (wiring) |
| cmd5 | `rg -n --no-heading -g '!**/*_test.go' 'PrefixAvatars\|PrefixChatVoice\|PrefixChatFiles\|avatars/\|chat/voice/\|chat/files/\|audit-exports/\|meetings/\|chat-voice/' server/` | **81** | hằng prefix + nơi dựng key/URL (nhiều dòng là route `/meetings/{id}`/`/chat/voice/token`, không phải object key — dùng để soi tay, không dùng để đếm) |
| cmd6 | `rg -n --no-heading -g '!**/*.test.*' 'storage\.Storage\|PresignGet\|GetReader\|KeyFromURL\|DeleteObject\(\|\.ObjectURL\(' packages/ apps/web/ e2e/` | **0** | frontend và e2e không có callsite storage nào |
| cmd6b | `rg -n --no-heading -g '!**/*.test.*' 'URL\.createObjectURL\|URL\.revokeObjectURL' packages/` | **38** | 38 chỗ frontend dựng blob URL của trình duyệt (khác hẳn object key/URL của storage) |
| cmd7 | `rg -n --no-heading -g '**/*_test.go' 'storage\.Storage\|DeleteObject\(\|\.ObjectURL\(\|GetReader\(\|KeyFromURL\(\|PresignGet' server/` | **42** | callsite phía test (fake/harness) — không nằm trong bảng §3 vì không phải đường chạy production |
| cmd8 | `rg -n --no-heading -g '!**/*_test.go' 'ObjectSize\(\|GetReaderRange\(\|UploadStream\(\|UploadFromReader\(\|NormalizeObjectURL\(' server/` | **12** | method riêng của S3, lớp stream/reader và helper chuẩn hoá URL ghi locator (bổ sung sau vòng tester; §3.4) |

Tổng hợp theo file cho cmd1 + cmd2 (26 + 5 = **31 dòng**, 11 file, tất cả trong `server/`):

| File | Số dòng | Vai trò |
| --- | --- | --- |
| `server/internal/service/task_attachments.go` | 7 | task / comment / ảnh mô tả (đường upload ghi DB) |
| `server/internal/handler/chat_voice.go` | 3 | playback recording cuộc gọi chat |
| `server/internal/storage/s3.go` | 3 | hiện thực adapter S3/MinIO |
| `server/internal/storage/local.go` | 2 | hiện thực adapter local disk |
| `server/internal/handler/avatar.go` | 2 | avatar tài khoản |
| `server/internal/handler/chat_file_message.go` | 2 | file chat |
| `server/internal/handler/chat_voice_message.go` | 2 | voice note chat |
| `server/internal/handler/meeting_ai.go` | 2 | recording cuộc họp |
| `server/internal/handler/recording_playback.go` | 2 | helper presign/stream recording dùng chung |
| `server/internal/handler/audit.go` | 1 | URL tải audit export |
| `server/internal/service/audit_export.go` | 1 | outbox ghi file audit export |

Ghi chú đếm: cmd1 dùng nhóm method có tên riêng; `Upload` xuất hiện ở 5 chỗ production (`task_attachments.go:186`, `audit_export.go:83`, `avatar.go:73`, `chat_file_message.go:120`, `chat_voice_message.go:112`) cộng 1 chỗ nội bộ storage (`local.go:333`, nằm trong `UploadFromReader`). `Delete` (best-effort, không trả lỗi) chỉ có 5 chỗ production, đều là nhánh dọn dẹp khi bước sau thất bại. cmd1 không bắt các method riêng của `*storage.S3Storage` (`ObjectSize`, `GetReaderRange`), lớp `UploadStream`/`UploadFromReader` hay helper `storage.NormalizeObjectURL`; chúng nằm ở cmd8 và được liệt kê đủ ở §3.4.

## 3. Callsite storage trên HEAD (36 dòng production: 31 từ cmd1+cmd2, 5 từ cmd8)

Cột "Purpose (FS-C1)" là purpose sẽ thay thế đường này khi chuyển sang `files.Service`; cột "Cleanup hiện tại" mô tả đúng những gì code đang làm hôm nay, không phải điều mong muốn.

Phạm vi §3: (a) mọi lời gọi method của interface `storage.Storage`/`Presigner` trong production (cmd1 + cmd2); (b) method chỉ có trên `*storage.S3Storage` mà đường đọc recording dùng (`ObjectSize`, `GetReaderRange`) — cmd8; (c) helper package `storage.NormalizeObjectURL` có tham gia ghi locator — cmd8; (d) lời gọi nội bộ trong chính package storage (§3.1).

### 3.1 Adapter và nội bộ package `internal/storage`

| # | file:line | Gọi | Purpose (FS-C1) | Lưu ở đâu | Bucket / prefix | Cleanup hiện tại |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `server/internal/storage/s3.go:359` | `PresignGetWithContentDisposition` (từ `PresignGet`) | MeetingRecording, ChatCallRecording (đọc) | không ghi DB | bucket `S3_BUCKET`, key bất kỳ | không |
| 2 | `server/internal/storage/s3.go:387` | `DeleteObject` (từ `Delete`) | mọi purpose (dọn) | không ghi DB | `S3_BUCKET` | log lỗi, không trả lỗi cho caller |
| 3 | `server/internal/storage/s3.go:398` | `client.DeleteObject` (SDK) | – | – | `S3_BUCKET` | trả lỗi cho `DeleteObject` |
| 4 | `server/internal/storage/local.go:114` | `DeleteObject` (từ `Delete`) | mọi purpose (dọn) | không ghi DB | `LOCAL_UPLOAD_DIR` | xoá file + `.meta.json` + file tạm, idempotent |
| 5 | `server/internal/storage/local.go:333` | `Upload` (từ `UploadFromReader`, khai báo `local.go:327`) | – | – | `LOCAL_UPLOAD_DIR` | không |

Hai adapter đều thoả `storage.Storage`; `S3Storage` thêm `Presigner`/`DownloadPresigner`/`ObjectSize`/`GetReaderRange`, còn `LocalStorage` **không** implement presigner — đây là lý do handler recording có nhánh `h.Storage.(storage.DownloadPresigner)` và nhánh fallback blob (§5).

### 3.2 Consumer service

| # | file:line | Module | Gọi | Purpose (FS-C1) | Lưu ở đâu | Bucket / prefix | Cleanup hiện tại |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | `server/internal/service/task_attachments.go:186` | Task attachment | `storage.Upload` | TaskAttachment / TaskCommentAttachment / TaskDescriptionImage (xem ghi chú dưới) | `attachments.object_key` + `attachments.object_url` | `workspaces/<workspaceID>/attachments/<attachmentULID>/<safeName>` | nhánh lỗi ngay sau đó xoá object |
| 7 | `server/internal/service/task_attachments.go:193` | Task attachment | `DeleteObject` | như trên | – | – | khi `pool.Begin` lỗi |
| 8 | `server/internal/service/task_attachments.go:216` | Task attachment | `DeleteObject` | như trên | – | – | khi `InsertAttachment` lỗi |
| 9 | `server/internal/service/task_attachments.go:225` | Task attachment | `DeleteObject` | như trên | – | – | khi `audit.Record` lỗi |
| 10 | `server/internal/service/task_attachments.go:229` | Task attachment | `DeleteObject` | như trên | – | – | khi `tx.Commit` lỗi |
| 11 | `server/internal/service/task_attachments.go:260` | Task attachment | `GetReader` | – (đọc) | dùng `att.ObjectKey` | như trên | caller đóng reader |
| 12 | `server/internal/service/task_attachments.go:303` | Task attachment | `DeleteObject` | – (dọn) | – | – | **sau** khi row đã xoá + audit commit; best-effort, không retry |
| 13 | `server/internal/service/audit_export.go:83` | Audit export | `store.Upload` | AuditExport | `audit_exports.object_key` (ghi bởi `CompleteAuditExport` ngay sau Upload) | `audit-exports/<organizationID>/<exportULID>.<csv\|json>` | không có job xoá; object ở lại sau `expires_at` |

### 3.3 Consumer handler

| # | file:line | Module | Gọi | Purpose (FS-C1) | Lưu ở đâu | Bucket / prefix | Cleanup hiện tại |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 14 | `server/internal/handler/avatar.go:73` | Avatar | `Storage.Upload` | UserAvatar | `users.avatar_url` (URL trả về của Upload) | `avatars/<userID>/<ulid>.<ext>` | khi `UpdateAvatar` lỗi: `Storage.Delete` (#31) |
| 15 | `server/internal/handler/avatar.go:84` | Avatar | `Storage.Delete` | UserAvatar | – | – | best-effort sau khi row update fail |
| 16 | `server/internal/handler/chat_file_message.go:120` | Chat file | `Storage.Upload` | ChatAttachment | `chat_messages.metadata` JSON (`object_key`, `filename`, `content_type`, `size_bytes`), `kind='file'` | `chat/files/<organizationID>/<roomID>/<ulid>.<ext>` | khi tạo message lỗi (#29) hoặc message đã tồn tại (#30) |
| 17 | `server/internal/handler/chat_file_message.go:127` | Chat file | `Storage.Delete` | ChatAttachment | – | – | `CreateFileMessage` lỗi |
| 18 | `server/internal/handler/chat_file_message.go:132` | Chat file | `Storage.Delete` | ChatAttachment | – | – | `client_msg_id` trùng → xoá bản upload thứ hai |
| 19 | `server/internal/handler/chat_file_message.go:153` | Chat file | `Storage.GetReader` | – (đọc) | `msg.File.ObjectKey` (đọc từ metadata JSON) | như trên | `defer reader.Close()` |
| 20 | `server/internal/handler/chat_voice_message.go:112` | Chat voice | `Storage.Upload` | ChatVoice | `chat_messages.metadata` JSON (cùng shape), `kind='voice'` | `chat/voice/<organizationID>/<roomID>/<ulid>.<ext>` | khi tạo message lỗi (#27) hoặc trùng (#28) |
| 21 | `server/internal/handler/chat_voice_message.go:119` | Chat voice | `Storage.Delete` | ChatVoice | – | – | `CreateVoiceMessage` lỗi |
| 22 | `server/internal/handler/chat_voice_message.go:124` | Chat voice | `Storage.Delete` | ChatVoice | – | – | `client_msg_id` trùng → xoá bản upload thứ hai |
| 23 | `server/internal/handler/chat_voice_message.go:145` | Chat voice | `Storage.GetReader` | – (đọc) | `msg.Voice.ObjectKey` | như trên | `defer reader.Close()` |
| 24 | `server/internal/handler/chat_voice.go:159` | Chat call recording | `Storage.KeyFromURL` | ChatCallRecording | `chat_voice_recordings.file_url` (đọc) | `chat-voice/<orgID>/<roomID>/<callID>-<time>.mp4` (do LiveKit ghi, §6) | không |
| 25 | `server/internal/handler/chat_voice.go:165` | Chat call recording | `PresignGetWithContentDisposition` | ChatCallRecording | – | – | TTL 15 phút (`recordingPlaybackTTL`), không cache phía server |
| 26 | `server/internal/handler/chat_voice.go:195` | Chat call recording | `Storage.KeyFromURL` | ChatCallRecording | `chat_voice_recordings.file_url` (đọc) | như trên | không |
| 27 | `server/internal/handler/meeting_ai.go:216` | Meeting recording | `Storage.KeyFromURL` | MeetingRecording | `meeting_recordings.file_url` (đọc) | `meetings/<workspaceID>/<meetingID>-<time>.mp4` (do LiveKit ghi) | không |
| 28 | `server/internal/handler/meeting_ai.go:247` | Meeting recording | `Storage.KeyFromURL` | MeetingRecording | `meeting_recordings.file_url` (đọc) | như trên | không |
| 29 | `server/internal/handler/recording_playback.go:23` | Recording dùng chung | `presigner.PresignGetWithContentDisposition` | MeetingRecording + ChatCallRecording | – | key do caller truyền vào | TTL 15 phút, disposition `inline` |
| 30 | `server/internal/handler/recording_playback.go:77` | Recording dùng chung | `Storage.GetReader` | MeetingRecording + ChatCallRecording | – | key do caller truyền vào | `defer reader.Close()`; dùng khi storage không phải `*storage.S3Storage` |
| 31 | `server/internal/handler/audit.go:190` | Audit export | `Storage.ObjectURL` | AuditExport | trả `download_url` cho client (không ghi DB) | `audit-exports/...` | chỉ trả URL khi `completed_at` còn trong 24h |

Ghi chú quan trọng cho bảng trên:

- **Ba purpose task gộp thành một đường hôm nay.** Cùng endpoint/flow `task_attachments.go` phục vụ đính kèm task, đính kèm comment và ảnh mô tả; row đã bind luôn có `task_id` — row staged thì `task_id` và `comment_id` đều NULL kèm `expires_at` (§4 #3, `task_attachments_test.go:122`); không có query nào set `comment_id` (`server/pkg/db/queries/attachments.sql` chỉ có `BindAttachmentsToTask`), nên hôm nay chỉ tồn tại `TaskAttachment`. Việc tách purpose theo ngữ cảnh bind là của FS-C1/T6, không phải hành vi hiện có.
- **Upload task ghi object trước, ghi DB sau** (`Upload` ở dòng 186 rồi mở transaction). Bốn nhánh lỗi gọi `DeleteObject`; nếu process crash giữa hai bước thì object nằm lại vĩnh viễn (không có reconciler cho prefix này).
- **Chat file/voice ghi object trước, message sau**; `Storage.Delete` là best-effort nên crash giữa hai bước để lại object mồ côi. Ngoài ra `DeleteChatMessage` (`server/internal/service/chat_actions.go:55`) chỉ soft-delete row — **không** xoá bytes (xem §10).
- **Recording không đi qua `storage.Upload`**: LiveKit Egress ghi trực tiếp vào bucket recording rồi webhook ghi URL vào `file_url`; app chỉ đọc lại key bằng `KeyFromURL` (§6, §9).
- **Audit export** là consumer duy nhất ghi key do mình tự dựng với tiền tố `audit-exports/` và ghi `object_key` vào row sau khi upload xong.
### 3.4 Method riêng của S3 và helper package (bổ sung sau vòng tester)

| # | file:line | Module | Gọi | Purpose (FS-C1) | Lưu ở đâu | Bucket / prefix | Cleanup hiện tại |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | `server/internal/handler/recording_playback.go:40` | Recording dùng chung | `(*storage.S3Storage).ObjectSize` (HEAD) | MeetingRecording + ChatCallRecording | – | key do caller truyền vào | đọc size để phục vụ Range |
| 33 | `server/internal/handler/recording_playback.go:51` | Recording dùng chung | `(*storage.S3Storage).GetReaderRange` | MeetingRecording + ChatCallRecording | – | key do caller truyền vào | `defer reader.Close()`; đây là đường S3 thật của `/content` |
| 34 | `server/internal/service/meeting_ai.go:453` | Meeting recording | `storage.NormalizeObjectURL` | MeetingRecording | ghi vào `meeting_recordings.file_url` | URL LiveKit trả về (`meetings/...`) | không (chuẩn hoá URL méo trước khi lưu) |
| 35 | `server/internal/service/chat_voice_recording.go:162` | Chat call recording | `storage.NormalizeObjectURL` | ChatCallRecording | ghi vào `chat_voice_recordings.file_url` | URL LiveKit trả về (`chat-voice/...`) | không |
| 36 | `server/internal/storage/s3.go:312` | Adapter | `GetReaderRange` (từ `GetReader`) | mọi purpose (đọc) | – | `S3_BUCKET` | caller đóng reader |

## 4. Nơi lưu key/URL: cột DB, JSON và Markdown

Bảng dưới liệt kê mọi chỗ đã tìm thấy đang giữ locator (object key hoặc URL). Cột "Dạng" phân biệt key trần, URL đầy đủ, hay ref nằm trong nội dung.

| # | Bảng.cột / field | Migration | Dạng | Ai ghi | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| 1 | `attachments.object_key` | `110_task_collaboration.up.sql:64` | key (`workspaces/<ws>/attachments/<id>/<name>`) | `task_attachments.go:207` | `NOT NULL`; là locator chuẩn cho đính kèm |
| 2 | `attachments.object_url` | `110_task_collaboration.up.sql:65` | URL đầy đủ (`/uploads/...` hoặc CDN/S3) | `task_attachments.go:208` | nullable; DTO **không** trả field này, client chỉ thấy `/api/v1/attachments/{id}/...` |
| 3 | `attachments.expires_at` | `192_attachment_staging.up.sql` | – | `task_attachments.go:213` | staged row (`task_id`/`comment_id` NULL) sống 24h; bind xoá về NULL |
| 4 | `users.avatar_url` | `001_init.up.sql:6` | URL đầy đủ | `auth.go:286` (`UpdateAvatar`), `googleauth.go:45/53/65` | upload avatar ghi URL storage; **Google sign-in ghi URL của Google** (ảnh ngoài, không phải object của mình) |
| 5 | `agents.avatar_url` | `066_agents.up.sql:10` | URL ngoài do client gửi | `service/agent.go:85/166` | không đi qua storage; không phải locator của mình |
| 6 | `chat_messages.metadata` (JSONB) | `046_chat_core.up.sql:38` (``metadata``; dòng 36 là ``kind``; `159`/`160`/`181` mở rộng ``kind``) | key trong JSON | `chat_file_message.go:170-175`, `chat_voice_message.go:170-175` | `{"filename","object_key","content_type","size_bytes"}` cho `kind='file'`/`'voice'`; DTO bỏ `object_key` |
| 7 | `chat_messages.metadata` (`voice_call_log`) | như trên | URL trong JSON (`recording_url`) | `chat_voice_recording.go:210-214` | bản sao locator của `chat_voice_recordings.file_url` (cùng object, hai nơi) |
| 8 | `meeting_recordings.file_url` | `037_meeting_ai.up.sql:30` | URL đầy đủ | `meeting_ai.go:453` (`NormalizeObjectURL` từ webhook) | LiveKit ghi trực tiếp; app đọc key bằng `KeyFromURL` |
| 9 | `chat_voice_recordings.file_url` | `189_chat_voice_recordings.up.sql:12` | URL đầy đủ | `chat_voice_recording.go:162` | như trên, prefix `chat-voice/` |
| 10 | `audit_exports.object_key` | `064_audit_exports.up.sql:12` | key (`audit-exports/<org>/<id>.<fmt>`) | `audit_export.go:87` (`CompleteAuditExport`) | `expires_at` đặt trong cùng câu update (24h) |
| 11 | `tasks.description` (Markdown) | `002_tasks.up.sql:5` | ref trong nội dung (`/api/v1/attachments/<id>/download`) | editor FE khi chèn ảnh/file (`packages/views/editor/attachment.tsx`, `use-file-upload.ts`) | server không kiểm tra ref này thuộc task nào |
| 12 | `task_comments.body` (Markdown) | `002_tasks.up.sql:24` | ref trong nội dung | như trên (draft comment upload → chèn markdown) | cùng dạng với #11 |
| 13 | `chat_messages.body` | `046_chat_core.up.sql:35` | ref trong nội dung (với file/voice: là tên file) | service chat | body file/voice chỉ chứa tên file, không chứa key |
| 14 | `task_source_contexts.snapshot` (JSONB) | `110_task_collaboration.up.sql:86` | ảnh chụp nội dung comment/task | `task_collaboration.go` | có thể chứa markdown ref (#11/#12) trong snapshot — cần soi khi backfill |
| 15 | `invoices.hosted_url` | `078_invoices.up.sql:16` | URL của provider thanh toán | billing | **không** phải object storage của mình (ghi ra để loại trừ) |

Field có URL nhưng cố ý ngoài phạm vi FileService: `email_hub_attachments` (`204_email_hub_attachments.up.sql`) chỉ giữ metadata IMAP (`part_id`), bytes đọc lại từ IMAP khi cần — không có object storage.

Kiểm chứng "không có ref ẩn khác": `rg -n "asset://"` toàn repo chỉ khớp tài liệu thiết kế Documents (`docs/superpowers/specs/2026-09-08-documents-design.md`), tức `asset://{id}` chưa tồn tại trong code/DB ở revision này; `document_versions`/`document_assets`/`office_jobs` cũng chưa có migration nào.

## 5. Frontend: nơi dựng URL, nơi cache, xử lý hết hạn

Frontend không gọi storage (cmd6 = 0 dòng). Nó chỉ dựng URL theo hai họ: URL ổn định cùng origin `/api/v1/attachments/{id}/...`, và URL có hạn (presigned playback). Ba chỗ cache URL có hạn:

| # | Vị trí | Việc nó làm | Hết hạn xử lý thế nào |
| --- | --- | --- | --- |
| 1 | `packages/views/editor/attachment.tsx:254-272` (`pickInlineMediaURL`), `:112-164` (`normalize`), `:280-296` (`storageURLMatchesCdnDomain`) | Chọn URL để render `<img>/<video>`/file card theo thứ tự: `download_url` có chữ ký → `record.url` khớp CDN (khi `cdn_signed=false`) → `/uploads/...` local → `markdown_url` → `url` → URL đầu vào | Không tự làm mới; URL ổn định được ưu tiên. `download_url` có chữ ký chỉ dùng cho "lần render này" (không persist) |
| 2 | `packages/views/editor/hooks/use-inline-media-url.ts:30` (`RESIGN_STALE_MS = 20 phút`), `:51-104` | Khi client không tải được URL API (desktop `file://`, webview, origin tách), lấy lại metadata (`api.getAttachment`) và thay bằng `download_url` mới; nếu server không có URL ký thì tải bytes qua `/content` thành blob URL | TTL giả định 30 phút, refetch sau 20 phút; blob cache giữ 5 phút sau khi unmount |
| 3 | `packages/core/editor/config-store.ts:11-15` | Store `cdnDomain` / `cdnSigned` điều khiển nhánh (1) | **Chưa được nạp ở đâu** trong HEAD (`rg useConfigStore` chỉ thấy nơi đọc) → hiện luôn `""`/`false`, tức nhánh CDN không bao giờ chạy |
| 4 | `packages/core/meetings/recording-playback-cache.ts:11-20` | Cache Map cho playback recording cuộc họp, key `meetingId:recordingId` | `remote` hết hạn khi `Date.now() >= expiresAt - 30s`; hết hạn thì xoá entry và gọi lại API |
| 5 | `packages/core/chat/voice-recording-playback-cache.ts:15-20` | Như trên cho recording cuộc gọi chat, key `workspaceId:roomId:recordingId` | như trên |
| 6 | `packages/core/api/endpoints/meetings.ts:530-549`, `packages/core/api/endpoints/chat-voice.ts:263-288` | `resolve…Playback`: thử presign trước, lỗi/rỗng thì tải blob qua `/content` và trả `kind:"blob"` | blob URL thu hồi qua `release…` khi bị thay/hết hạn |
| 7 | `packages/views/meetings/meeting-recording-dialog.tsx:46-104`, `packages/views/chat/voice-call-recording-dialog.tsx:52-110` | Dialog phát lại: dùng cache, gọi resolve khi thiếu, và khi `<video onError>` thì bỏ URL remote và chuyển sang blob | đây là đường "làm mới URL theo hạn" duy nhất của FE hôm nay |
| 8 | `packages/views/chat/use-chat-file-object-url.ts:11-40`, `packages/views/chat/chat-file-attachment.tsx:79-84` | File/voice chat: tải bytes qua `/content` (react-query theo message), dựng `URL.createObjectURL`, thu hồi khi unmount/thay | URL là blob của phiên render, không có hạn; bytes nằm trong query cache |
| 9 | `packages/views/settings/components/audit-exports.tsx:190,199-204` | Audit export: hiện mốc hết hạn và mở `job.download_url` bằng thẻ link | Không tự làm mới; server bỏ `download_url` sau 24h nên link biến mất ở lần tải danh sách sau |
| 10 | `packages/core/types/attachment-url.ts`, `packages/core/attachments/image-sequence.ts:103-123`, `packages/ui/markdown/file-cards.ts:21,74-92` | Nhận dạng/bóc id attachment từ URL ổn định `/api/v1/attachments/<id>/download`; nhận diện URL CDN để biến link thô thành file card | không liên quan hạn (URL ổn định) |
| 11 | `packages/views/people/person-avatar.tsx:38`, `packages/views/layout/app-sidebar.tsx:259`, `packages/views/settings/components/account-tab.tsx:172` (và ~40 chỗ khác) | Avatar: `<img src={avatar_url}>` trực tiếp | không có hạn, không chữ ký; cache do trình duyệt |

Hệ quả cần nhớ khi chuyển sang FileService:

- FE hôm nay **không** có khái niệm `file_id`; định danh gắn với attachment/message/recording id. Hook chung của T4 (`useFileUrl`/resolve) phải thay được các nhánh ở #1–#3 mà không buộc mỗi module tự làm mới URL theo expiry (điều plan §3.4 cấm).
- Comment trong code FE còn nhắc `server/internal/handler/file.go` (`buildMarkdownURL`, signed `download_url` 30 phút) — **file đó không tồn tại** trên HEAD; nghĩa là một phần hợp đồng API cũ chưa có ở nhánh này. Ghi nhận để T4/T9 không "khôi phục" hành vi đã bị bỏ.
- `attachment_download_url` (FE đọc ở `packages/views/editor/use-download-attachment.ts:51-60,133,164`) chưa được server trả; `AttachmentDTO` hiện chỉ có `url`/`download_url`/`markdown_url` (`server/internal/handler/dto/sdo/task_collaboration.go:55-58`).

## 6. Consumer ngoài phạm vi (G0/Office/legacy) và writer ngoài đang hoạt động

### 6.1 Ngoài phạm vi, kèm owner

| Hạng mục | Bằng chứng trên HEAD | Owner / điều kiện gỡ |
| --- | --- | --- |
| Documents/Office G0 ledger lưu URL từ `ObjectURL` | Chỉ có trong tài liệu: `docs/superpowers/specs/2026-09-08-documents-design.md` (§ ledger, `asset://{id}`); `scripts/office-g0/` **không tồn tại** ở nhánh này | DOC-004/UNI-668 (G0) — B1 UNI-748 xử lý phần còn lại sau khi G0 bàn giao |
| Documents/Office G1–G2 dùng `document_versions.file_id`/`document_assets.file_id` | Chưa có migration `document_*`/`office_jobs` nào trên HEAD | plan G1–G2 (UNI-657/658); Documents chưa có dữ liệu production nên không có bước chuyển dữ liệu |
| Draft desktop/browser của G0 (store theo tài khoản, không phải `local` adapter của API) | DOC-005/UNI-669; không có code trong repo này | chủ DOC-005; không dọn bằng staged TTL |
| `invoices.hosted_url` (URL provider thanh toán) | `078_invoices.up.sql:16` | billing; không phải object storage |
| `email_hub_attachments` (bytes đọc lại từ IMAP) | `204_email_hub_attachments.up.sql`, `server/internal/emailhub/imapclient/attachments.go` | Email Hub (UNI-706); không đi qua storage |
| Avatar do Google đặt (`users.avatar_url` = URL Google) | `server/internal/service/googleauth.go:45,53,65` | identity scope; **không** backfill thành file của mình |
| `uploads/*` static route chỉ có ở local backend | `server/internal/handler/router/meta.go:31-36` | legacy read path; giữ tới khi mọi consumer dùng resolve/proxy |
| FE tin vào `server/internal/handler/file.go` (không tồn tại) và `attachment_download_url` | `packages/views/editor/hooks/use-inline-media-url.ts:26-33`, `packages/views/editor/use-download-attachment.ts:100-133` | T4/T9: chốt lại hợp đồng URL ở boundary, không hồi sinh nhánh đã bỏ |

### 6.2 Writer ngoài đang hoạt động

| Writer | Ghi vào đâu | Bằng chứng | Hệ quả cho inventory/backfill |
| --- | --- | --- | --- |
| LiveKit Egress — recording cuộc họp | bucket `LIVEKIT_RECORDING_BUCKET`, key `meetings/<workspaceID>/<meetingID>-{time}.mp4` | `meeting_ai.go:358` (`FilePrefix`), `server/internal/meetings/livekit.go:159-170`, `cmd/server/main.go:184-195` | key **không chứa organizationID**; webhook ghi URL vào `meeting_recordings.file_url` sau khi egress kết thúc (`meeting_ai.go:447-464`) |
| LiveKit Egress — recording cuộc gọi chat | cùng bucket, key `chat-voice/<organizationID>/<roomID>/<callID>-{time}.mp4` | `chat_voice_recording.go:63-69`, `chat_voice_recording.go:154-168` | URL ghi vào `chat_voice_recordings.file_url` **và** copy vào metadata `voice_call_log` (`:210-214`) |
| Outbox consumer audit export | `S3_BUCKET` (hoặc local), key `audit-exports/<organizationID>/<exportID>.<format>` | `service/audit_export.go:82-88`; topic `audit.export_requested` | idempotent theo export id; retry outbox không tạo bản thứ hai |
| (Không phải writer) IMAP fetch bytes theo yêu cầu | – | `emailhub/imapclient/attachments.go` | ngoài phạm vi |

Hai điểm cần chốt cho T9b/T9c: (a) `LIVEKIT_RECORDING_BUCKET` có thể **khác** `S3_BUCKET` — `.env.example:216-225` mô tả cả hai dùng cùng bucket là tuỳ chọn; khi khác bucket, `storage.KeyFromURL` vẫn trả key (fallback "lấy sau dấu `/` cuối", `s3.go:292-297`) nhưng app sẽ đọc key đó từ bucket của mình → hoặc 404, hoặc **đọc nhầm object cùng tên ở bucket khác**. (b) Egress bắt đầu **trước** khi DB có row (`meeting_ai.go:356-369`, `chat_voice_recording.go:63-86`), nên tồn tại cửa sổ object không có metadata.
## 7. Test hiện có theo module mà Bước 0 phải giữ xanh

Không có test nào được tạo trong task này. Bảng dưới là các file đang tồn tại trên HEAD, theo module; cột cuối ghi lớp còn thiếu theo plan §6.1.

| Module | Go (server/) | Frontend (packages/) | E2E (e2e/) | Còn thiếu |
| --- | --- | --- | --- | --- |
| Nền storage | `internal/storage/s3_test.go`, `local_test.go`, `local_atomic_test.go`, `util_test.go` | – | – | contract Local/MinIO bằng 1 bộ test chạy cho cả hai adapter |
| Task/editor/avatar (UNI-744) | `service/task_attachments_test.go`, `handler/task_attachments_test.go`, `handler/avatar_test.go` | `core/api/endpoints/task-attachments.test.ts`, `core/tasks/hooks-collaboration.test.tsx`, `core/attachments/image-sequence.test.ts`, `core/types/attachment-url.test.ts`, `views/tasks/detail/components/attachments-section.test.tsx`, `views/tasks/new-task-dialog.test.tsx`, `views/editor/content-editor.test.tsx`, `views/editor/readonly-content.test.tsx`, `views/editor/extensions/file-card-markdown.test.ts`, `views/editor/utils/preprocess-channel-media.test.ts` | `create-task-parity.spec.ts` (bind đính kèm staged), `task-detail-parity-smoke.spec.ts` (comment + đính kèm), `tasks-collection-parity-smoke.spec.ts` | smoke `@files-smoke`; e2e riêng cho avatar và cho gỡ đính kèm/quá cap/hủy trước khi lưu |
| Chat file/voice (UNI-745) | `service/chat_file_message_test.go`, `service/chat_voice_message_test.go`, `handler/chat_file_message_test.go`, `handler/chat_voice_message_test.go` | `core/api/endpoints/chat-voice.test.ts`, `core/chat/voice-playback-store.test.ts`, `views/chat/chat-file-message-row.test.tsx`, `views/chat/chat-file-accept.test.ts`, `views/chat/chat-voice-message-row.test.tsx`, `views/chat/use-chat-media-send.test.tsx` | **không có** | smoke `@files-smoke`; e2e gửi file/voice trong phòng, người ngoài phòng không tải được, gửi lại khi mất mạng không nhân đôi |
| Recording (UNI-746) | `service/meeting_ai_test.go`, `service/chat_voice_recording_test.go`, `handler/chat_voice_recording_test.go`, `internal/meetings/fake_test.go` | `core/api/endpoints/meetings.test.ts`, `views/meetings/meeting-recording-dialog.test.tsx`, `views/chat/chat-voice-recordings-sheet.test.tsx` | `meetings.spec.ts`, `meetings-livekit.spec.ts` (chỉ chạy khi `E2E_LIVEKIT=1`) | smoke `@files-smoke`; ca seek (Range) + người ngoài cuộc họp bị chặn trong e2e |
| Audit export (UNI-749) | `service/audit_export_test.go`, `service/audit_service_test.go`, `handler/audit_test.go` | `core/api/endpoints/audit.test.ts`, `views/settings/components/audit-tab.test.tsx` | `audit.spec.ts` (chỉ kiểm nhật ký, **không** kiểm export) | smoke `@files-smoke`; e2e tạo export → tải → hết hạn không tải được |

`@files-smoke` chưa tồn tại ở đâu trong repo (`rg -n "@files-smoke"` chỉ khớp plan và FS-C1) — biến nó thành tag Playwright thật là việc của T2/T6–T10, không phải của T9a.

## 8. Checklist Bước 0 theo module (hành vi hiện tại phải giữ xanh)

Mỗi mục là một hành vi đang chạy trên HEAD, kèm test đang giữ nó. Lane tương ứng phải (a) chạy lại đúng các test này trên revision của mình trước khi sửa, và (b) giữ chúng xanh sau khi chuyển sang FileService — chỉ đổi assertion khi hành vi đổi có chủ ý (ví dụ URL 12h, cap thống nhất) và ghi lý do trong cùng PR.

### 8.1 UNI-744 — task attachment, comment attachment, ảnh mô tả, avatar

| # | Hành vi hiện tại | Test giữ |
| --- | --- | --- |
| U744-1 | Upload vào task đang có: multipart `file`, cap 25 MiB, allowlist MIME (jpeg/png/gif/webp/bmp/pdf/markdown/text + doc/docx/xls/xlsx/ppt/pptx), object ở `workspaces/<ws>/attachments/<attID>/<name>`, row `attachments` có `object_key` + `object_url`, audit `attachment_uploaded` + outbox `attachment.uploaded` | `server/internal/service/task_attachments_test.go:15 TestUploadListGetOpenDeleteAttachment`; `server/internal/handler/task_attachments_test.go:46 TestAttachmentHTTPRoundTrip` |
| U744-2 | Từ chối quá cap và MIME ngoài allowlist với 413/400 (không ghi object, không ghi row) | `service/task_attachments_test.go:98 TestUploadAttachmentRejectsOversizeAndBadMIME`; `handler/task_attachments_test.go:167 TestUploadTaskAttachmentRejectsMissingFile` |
| U744-3 | Upload trước khi task tồn tại (staged workspace attachment): `expires_at = now+24h`, bind **nguyên tử** khi `CreateTask` (`BindAttachmentsToTask`, tối đa 20 id), bind file của người khác / file đã bind bị từ chối | `service/task_attachments_test.go:122 TestStageAttachmentAndBindAtomicallyOnTaskCreate`, `:150 TestCreateTaskRejectsForeignOrAlreadyBoundAttachment` |
| U744-4 | Staged row chỉ người upload thấy; row staged hết hạn trả 404 | `service/task_attachments_test.go:168 TestStagedAttachmentIsPrivateToUploader` |
| U744-5 | Hiển thị: DTO đính kèm trả `url` = `/api/v1/attachments/<id>/content`, `download_url` = `markdown_url` = `/api/v1/attachments/<id>/download`, **không** trả `object_key`/`object_url` | `handler/task_attachments_test.go:46`, đặc biệt phần kiểm "object_key must not be exposed" | 
| U744-6 | Ảnh mô tả/comment: editor upload rồi chèn markdown ref ổn định `/api/v1/attachments/<id>/download`; màn task detail không lặp lại đính kèm đã có trong mô tả | `views/tasks/detail/components/attachments-section.test.tsx:132,172`; `views/editor/content-editor.test.tsx:54`; `core/attachments/image-sequence.test.ts:32,40` |
| U744-7 | Tải/preview nội dung: `/content` inline, `/download` ép `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `Content-Type`/`Content-Length` theo row | `handler/task_attachments_test.go:46`; `service/task_attachments_test.go:15` |
| U744-8 | Xoá: xoá row + audit `attachment_deleted` + outbox `attachment.deleted`, sau đó best-effort xoá object; API trả 204 | `service/task_attachments_test.go:15`; `packages/core/api/endpoints/task-attachments.test.ts:79`; `views/tasks/detail/components/attachments-section.test.tsx:240` |
| U744-9 | Quyền: non-member bị 403/404; staged chỉ uploader; `task_id`/`comment_id` đều NULL chỉ hợp lệ khi còn `expires_at` | `service/task_attachments_test.go:168`; `handler/task_attachments_test.go` |
| U744-10 | Avatar: multipart cap 2 MiB, chỉ nhận PNG/JPEG/GIF/WebP theo sniff nội dung, key `avatars/<userID>/<ulid>.<ext>`, `users.avatar_url` nhận URL storage; lỗi update row thì xoá object best-effort | `server/internal/handler/avatar_test.go:64,109,122,135` — **test chưa phủ** nhánh xoá object khi `UpdateAvatar` lỗi (`avatar.go:84`), T6 bổ sung khi viết test Bước 0 |
| U744-11 | FE: URL CDN/CDN-signed và URL blob không bao giờ bị persist vào markdown (`isObjectURL`, `attachmentIdFromDownloadURL`) | `core/types/attachment-url.test.ts:10,25`; `views/editor/attachment.tsx` (nhánh persist) |

### 8.2 UNI-745 — chat file, voice

| # | Hành vi hiện tại | Test giữ |
| --- | --- | --- |
| U745-1 | Gửi file: multipart, cap 25 MiB, sniff jpeg/png/gif/webp/pdf/text, key `chat/files/<orgID>/<roomID>/<ulid>.<ext>`, metadata JSON giữ `object_key` + filename + content_type + size_bytes, `kind='file'` | `server/internal/handler/chat_file_message_test.go:14,41,91`; `server/internal/service/chat_file_message_test.go:28,114` |
| U745-2 | Idempotency: cùng `client_msg_id` trả message cũ và **xoá** bản upload thứ hai (không nhân đôi object/message) | `handler/chat_file_message.go:131-133`; `service/chat_file_message_test.go:114` |
| U745-3 | Hiển thị: DTO bỏ `object_key` (chỉ filename/content_type/size_bytes) | `handler/chat_file_message_test.go:41 TestToChatMessageDTOMapsFileWithoutObjectKey`; `views/chat/chat-file-message-row.test.tsx:21,72,278` |
| U745-4 | Tải/stream: `GET …/messages/{id}/content` kiểm quyền phòng rồi stream từ storage; ảnh inline, file khác attachment (`chat_file_message.go:161-169`) | `handler/chat_file_message_test.go:91 TestSendAndStreamChatFileMessage` (phủ quyền + bytes + DTO; **test chưa phủ** phần `Content-Disposition`/`Cache-Control`) |
| U745-5 | Voice note: multipart cap 4 MiB, sniff WebM/Ogg/MP4 audio, `duration_ms` bắt buộc, key `chat/voice/<orgID>/<roomID>/<ulid>.<ext>`, `kind='voice'`, metadata cùng shape | `service/chat_voice_message_test.go:9,39`; `handler/chat_voice_message_test.go:9,31`; `views/chat/chat-voice-message-row.test.tsx:10` |
| U745-6 | Phát voice: FE tải blob qua `/content`, cache theo message, dựng/thu hồi object URL theo vòng đời mount | `views/chat/use-chat-file-object-url.ts`; `core/chat/voice-playback-store.test.ts`; `views/chat/use-chat-media-send.test.tsx` |
| U745-7 | Quyền: người ngoài phòng không lấy được metadata lẫn bytes (`GetFileMessage`/`GetVoiceMessage` đi qua gate phòng) | `service/chat_file_message_test.go:114`; `service/chat_voice_message_test.go` |
| U745-8 | Xoá: `DeleteChatMessage` **chỉ soft-delete** row; bytes không bị xoá (hành vi hiện tại — phải giữ hoặc đổi có chủ ý kèm lý do) | `service/chat_actions.go:55-70`; `service/chat_test.go:246` |

### 8.3 UNI-746 — meeting/call recording

| # | Hành vi hiện tại | Test giữ |
| --- | --- | --- |
| U746-1 | Bắt đầu ghi **cuộc họp**: host/admin + feature flag + meeting `IN_PROGRESS`; egress dùng prefix `meetings/<workspaceID>/<meetingID>`, row `meeting_recordings` ghi `egress_id` **sau** khi provider trả về; đang có recording active thì **409** | `service/meeting_ai_test.go:165 TestRecordingLifecycle` (409, chỉ đúng cho meeting); đường chat idempotent — xem U746-6 |
| U746-2 | Dừng ghi: gọi provider stop rồi chuyển row sang `PROCESSING`; webhook kết thúc điền `file_url` (qua `NormalizeObjectURL`) và `COMPLETE`/`FAILED` | `service/meeting_ai_test.go:165`; `service/chat_voice_recording_test.go:188 TestFinishVoiceRecordingByEgressFailed` |
| U746-3 | Playback URL: chỉ khi row `COMPLETE` + có `file_url`; trả `playback_url` presigned TTL 15 phút + `expires_at`; storage không phải presigner → 501 từ handler | `handler/chat_voice_recording_test.go:33 TestPresignRecordingPlaybackURL`, `:206 TestMeetingRecordingHTTP`; `service/meeting_ai_test.go:209 TestMeetingRecordingForPlayback` |
| U746-4 | Stream `/content`: S3 dùng HEAD + Range (`206`, `Content-Range`, `Accept-Ranges`), storage khác đọc full; range sai → 416; `Content-Type: video/mp4`, `Cache-Control: private, max-age=300` | `handler/chat_voice_recording_test.go:302 TestParseByteRange`, `:59 TestStreamRecordingObjectLocalStorage`, `:339 TestStreamRecordingObjectFullMissingFile` — **test chưa phủ** đường S3 (`ObjectSize` + `GetReaderRange`, `206`/`Content-Range`/`Accept-Ranges`) |
| U746-5 | Quyền: người ngoài cuộc họp/khách không có `file_url` bị chặn; danh sách cho khách ẩn recording chưa có file | `service/meeting_ai_test.go:209`; `service/chat_voice_recording_test.go:140 TestChatVoiceRecordingGuards`; `handler/chat_voice_recording_test.go:115,206` |
| U746-6 | Ghi âm cuộc gọi chat: một egress cho mỗi call, prefix `chat-voice/<orgID>/<roomID>/<callID>`, hangup tự dừng egress, call-log message mang `recording_id`/`recording_status`/`recording_url`; gọi start lần hai trên cùng call trả **cùng** recording (idempotent, không 409) | `service/chat_voice_recording_test.go:35,90`; `chat_voice_recording.go:193-216` |
| U746-7 | FE phát lại: ưu tiên URL presigned, lỗi thì tải blob qua `/content`, cache theo 30 giây trước hạn, `<video onError>` chuyển sang blob | `views/meetings/meeting-recording-dialog.test.tsx:18,26`; `core/api/endpoints/meetings.test.ts:273`; `core/api/endpoints/chat-voice.test.ts:79`; `core/meetings/recording-playback-cache.ts` |

### 8.4 UNI-749 — audit export

| # | Hành vi hiện tại | Test giữ |
| --- | --- | --- |
| U749-1 | Tạo export (owner/admin): row `audit_exports` + audit + outbox `audit.export_requested`; người ngoài org bị từ chối | `handler/audit_test.go:109,164` |
| U749-2 | Consumer: `started_at` rồi encode CSV (UTF-8 BOM) / JSON Lines, upload key `audit-exports/<orgID>/<exportID>.<format>`, `CompleteAuditExport` ghi `object_key`, `row_count`, `expires_at = now()+24h` | `service/audit_export_test.go:62,124` |
| U749-3 | Idempotent theo export id: retry outbox không upload bản thứ hai | `service/audit_export_test.go:102` |
| U749-4 | Lỗi to: > `exportMaxRows` (500 000) → `failed_at` + thông báo chia nhỏ; thiếu storage → lỗi rõ ràng | `service/audit_export_test.go:159`; `service/audit_service.go:33-35` |
| U749-5 | Danh sách/chi tiết: `download_url` chỉ xuất hiện khi `completed_at` còn trong 24h (`auditExportLinkTTL`), kèm `expires_at`; FE hiện link tải + mốc hết hạn | `handler/audit_test.go:109`; `packages/core/api/endpoints/audit.test.ts:118,123,137`; `views/settings/components/audit-tab.test.tsx:251,262` |
| U749-6 | Export không chứa IP người dùng (PII) và giữ nguyên bộ cột hiện tại | `service/audit_export_test.go:62,124` |
| U749-7 | Hết hạn: sau 24h `download_url` biến mất nhưng object **vẫn nằm trong bucket** (không có job xoá) — hành vi hiện tại | `handler/audit.go:188-192` |
## 9. Mapping locator → `file_id` + `organization_id`

Chưa có bảng `files`/`file_id` trên HEAD (Gate A0 chưa merge), nên "đích" của mapping là: mỗi locator dưới đây sẽ thành **một** hàng `files` với `organization_id` xác định, và mọi bảng nghiệp vụ giữ `file_id`. Bảng này nói rõ nguồn suy ra `organization_id`, trạng thái, và chỗ phải hold.

| # | Locator | Bảng.field | Nguồn `organization_id` | Trạng thái | Ghi chú cho backfill |
| --- | --- | --- | --- | --- | --- |
| M1 | object key `workspaces/<ws>/attachments/<id>/<name>` | `attachments.object_key` | `attachments.organization_id` (NOT NULL, đã tenant từ migration 110) — và key cross-check được vì `workspaces.organization_id` NOT NULL | **verified** | mỗi `object_key` = một file; `attachments.object_url` chỉ là gợi ý, không phải nguồn |
| M2 | URL trong `attachments.object_url` | như trên | như M1 | **verified** (nếu chuẩn hoá được) | URL có thể là CDN/bucket/`/uploads/...`; nếu host không khớp cấu hình thì giữ unresolved, không đoán storage từ hostname |
| M3 | key `chat/files/<orgID>/<roomID>/<ulid>.<ext>` trong JSON | `chat_messages.metadata->>'object_key'` | `chat_messages` **không có** `organization_id` (nằm trong `tenantBackfillDebt`, `server/migrations/lint_test.go:261-273`) → suy qua `chat_rooms.organization_id`; cột này **nullable** (`052_chat_rooms_organization_id.up.sql` chỉ ADD + backfill từ workspace) | **verified** khi key và room khớp org; **unresolved** khi `chat_rooms.organization_id` NULL (phòng cũ không neo workspace) | dùng chính prefix `chat/files/<orgID>/` làm nguồn thứ hai; hai nguồn lệch nhau → hold |
| M4 | key `chat/voice/<orgID>/<roomID>/<ulid>.<ext>` trong JSON | `chat_messages.metadata->>'object_key'` (`kind='voice'`) | như M3 | như M3 | như M3 |
| M5 | URL trong `meeting_recordings.file_url` | `meeting_recordings.file_url` | `meetings` **không có** `organization_id` (debt) → `meetings.workspace_id` → `workspaces.organization_id` | **derived**; **unresolved** nếu URL méo/rỗng/bucket khác cấu hình | key `meetings/<workspaceID>/<meetingID>-<time>.mp4` cross-check được với workspace; phải chạy `NormalizeObjectURL` trước khi bóc key |
| M6 | URL trong `chat_voice_recordings.file_url` | `chat_voice_recordings.file_url` | `chat_voice_recordings.organization_id` (NOT NULL từ 189), key `chat-voice/<orgID>/...` cross-check | **verified** | cùng object còn xuất hiện ở M7 — gộp về một file |
| M7 | URL trong metadata `voice_call_log` (`recording_url`) | `chat_messages.metadata->>'recording_url'` | như M3 (theo phòng) | **verified** khi khớp M6; nếu không có row recording tương ứng → **unresolved** | đây là **cùng một object** với M6 (ghi hai nơi) — chỉ được tạo một `file_id`, tránh đếm trùng khi backfill |
| M8 | URL/key `avatars/<userID>/<ulid>.<ext>` | `users.avatar_url` | **không có org** — identity scope; FS-C1 cho phép `organization_id` NULL cho avatar tài khoản | **shared-with-legacy** | hàng avatar dùng chung nhiều tổ chức theo thiết kế; **không** gán org, không để GC theo org quét |
| M9 | URL ngoài (Google picture, CDN lạ) | `users.avatar_url` | – | **unresolved / foreign** | `googleauth.go:45,53,65` ghi URL Google; không phải object của mình → không backfill |
| M10 | URL ngoài do client gửi | `agents.avatar_url` | `agents.organization_id` có, nhưng object không thuộc mình | **unresolved / foreign** | không có bytes để import; giữ nguyên URL cho tới khi có upload thật |
| M11 | ref trong Markdown `/api/v1/attachments/<id>/download` | `tasks.description`, `task_comments.body`, `task_source_contexts.snapshot` | theo row `attachments` (M1) | **verified** khi parse được id; **unresolved** với URL thô kiểu CDN/`/uploads/...` (nội dung viết trước UNI-0) | ref chỉ là con trỏ tới M1 → không tạo file mới; snapshot có thể lặp lại ref của comment (không tính là tham chiếu thứ hai) |
| M12 | key `audit-exports/<orgID>/<exportID>.<fmt>` | `audit_exports.object_key` | `audit_exports.organization_id` (NOT NULL từ 064) | **verified** | idempotent theo export id; hết hạn 24h nhưng object không bị xoá hôm nay |

### 9.1 Rủi ro locator dùng chung giữa tenant

1. **Đường đọc không kiểm tenant.** `meeting_ai.go:216/247` và `chat_voice.go:159/195` bóc key từ `file_url` rồi đọc thẳng object; quyền được quyết định bởi row meeting/room, **không** bởi object key. Một URL bị sửa/copy sai (hoặc record legacy trỏ sang key của tenant khác) sẽ được phục vụ bình thường. Vì vậy T9b phải coi "locator dùng bởi > 1 tenant" là hold + copy có kiểm soát (plan §4 T9a bullet 2), và T4 phải kiểm `files.organization_id` khi resolve.
2. **Avatar là ngoại lệ cố ý.** Cùng một object `avatars/<userID>/...` phục vụ mọi tổ chức người đó tham gia; gán org cho nó sẽ phá GC theo tenant (FS-C1 §3 chốt NULL cho avatar tài khoản).
3. **Prefix `meetings/<workspaceID>/...` không mang org.** Suy org qua workspace là bắt buộc; workspace thuộc đúng một org (`workspaces.organization_id` NOT NULL) nên suy được, nhưng phải kiểm khi backfill chứ không tin URL.
4. **Bucket recording có thể khác bucket storage.** `LIVEKIT_RECORDING_BUCKET` độc lập với `S3_BUCKET` (`.env.example:216-225`); `KeyFromURL` fallback "lấy sau `/` cuối" (`s3.go:292-297`) không phân biệt bucket → cùng tên key ở bucket khác có thể bị đọc nhầm. Đây là rủi ro cross-tenant/cross-bucket cụ thể nhất tìm được, phải chốt trước T9b.
5. **URL trùng giữa M6 và M7** (recording row + call-log metadata) là cùng object; gộp trước khi đếm để không tạo hai `file_id` cho một object.
6. **Nội dung Markdown có thể trỏ vào attachment của task khác trong cùng workspace** (server không kiểm ref khi lưu mô tả/comment). Backfill phải cộng ref theo `attachment_id`, không theo nội dung.

## 10. Khoảng trống và rủi ro đã xác nhận trên HEAD (đầu vào cho T9b/T9c)

| # | Khoảng trống | Bằng chứng | Việc cần làm ở lane nào |
| --- | --- | --- | --- |
| G1 | Không có bảng `files`/`file_id`, không có `internal/files` | `server/internal/files` không tồn tại; FS-C1 §8 chưa merge | T1a/T1b; T9b chỉ chạy sau Gate A |
| G2 | Object mồ côi khi crash giữa Put và ghi DB (task attachment, chat file, chat voice) | `task_attachments.go:186-231`; `chat_file_message.go:120-133`; `chat_voice_message.go:112-125` | T3/T5 (intent + GC); T9b đối soát rows/objects |
| G3 | Xoá attachment chỉ best-effort; xoá message chat **không** xoá bytes | `task_attachments.go:302-304`; `service/chat_actions.go:55-70` (soft delete) | T5/T7 |
| G4 | `attachments.expires_at` không có job dọn: row + object staged hết hạn nằm lại vĩnh viễn | chỉ dùng trong `BindAttachmentsToTask`/`loadAttachment`; không có worker nào xoá | T5/T6 |
| G5 | Audit export hết hạn vẫn còn object; URL tải là CDN/bucket URL **không ký** | `handler/audit.go:188-192` gọi `ObjectURL`; `s3.go:478-479` trả `https://<cdn>/<key>` | T10 (claim + expiry + quyền tải) |
| G6 | Recording: egress chạy trước khi có row; URL là locator được tin tuyệt đối | `meeting_ai.go:356-369`; `chat_voice_recording.go:63-86`; `KeyFromURL` | T8 (intent/lease/reconcile) |
| G7 | Presign recording TTL 15 phút, không phải 12h như policy plan §2.8 | `handler/recording_playback.go:15` | T4/T8 chốt lại (đổi có chủ ý thì sửa assertion Bước 0 + ghi lý do) |
| G8 | `packages/core/editor/config-store.ts` không được nạp → nhánh CDN/CDN-signed của editor chết | `rg useConfigStore` chỉ có nơi đọc | chủ sở hữu editor/T4 (ghi nhận, không sửa trong T9a) |
| G9 | Hợp đồng FE còn nhắc `server/internal/handler/file.go` và `attachment_download_url` không tồn tại | `use-inline-media-url.ts:26-33`; `use-download-attachment.ts:100-133`; `dto/sdo/task_collaboration.go:55-58` | T4/T9 khi chốt API boundary |
| G10 | Không có e2e hai tổ chức cho bất kỳ luồng file nào, và `@files-smoke` chưa tồn tại | `rg -n "@files-smoke"` chỉ khớp tài liệu; e2e hiện có không có ca hai org cho file | T6–T10 + T9c |
| G11 | Không có e2e cho chat file/voice và cho export audit (tải/hết hạn) | `e2e/` không có spec chat file; `audit.spec.ts` chỉ kiểm nhật ký | T7, T10 |
| G12 | `chat_rooms.organization_id` nullable → org của chat file/voice phải suy từ key đối chiếu | `052_chat_rooms_organization_id.up.sql` | T9b: hold khi hai nguồn lệch |
| G13 | G0/Office ledger (`ObjectURL`, `asset://`) không có code trong repo này | §6.1 | DOC-004 (UNI-668), G1–G2 (UNI-657/658), B1 (UNI-748) |

## 11. Bằng chứng và acceptance

- Lệnh và số đếm AC-1: §2; script tái chạy được: `ac1-greps.sh`, `ac1-greps-extra.sh`; output thô: `ac1-cmd1..cmd8*.txt` (gồm `ac1-cmd8-s3-methods.txt`) trong `D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/file-service/reports/t9a-inventory/`.
- Test bắt buộc của task tài liệu này: `node --test scripts/governance.test.mjs` — chạy trên chính revision chứa tài liệu này; smoke/e2e không áp dụng (tài liệu chỉ đọc, không đổi runtime) và điều đó được ghi rõ trong PR body.
- Revision và PR: xem PR "UNI-747: …" nhắm `feature/UNI-726-shared-file-service`; reviewer BE soi bảng §3/§4 và các câu "verified/derived/unresolved" ở §9.
- Việc này không tự chốt cutover: mọi kết luận ở §9/§10 là đầu vào cho T9b (backfill + rehearsal) và T9c (cutover), dưới Gate D như plan §4 T9.
## 12. Đính chính sau vòng tester + reviewer (4105de9c)

Vòng kiểm tra độc lập trên revision `4105de9c` (Tester: `reports/t9a-inventory/tester-report.md`, BE Reviewer: `reports/t9a-inventory/reviewer-report.md`) mở lại tài liệu này và tìm ra các lỗi sau; tất cả đã được sửa trong chính tài liệu này (revision kế tiếp của cùng PR), không có code hay migration nào bị chạm.

| # | Nguồn | Lỗi đã tìm thấy | Sửa trong tài liệu |
| --- | --- | --- | --- |
| 1 | Tester | §3 thiếu hai lời gọi method riêng của S3 trên đường đọc recording: `recording_playback.go:40` (`ObjectSize`) và `:51` (`GetReaderRange`) | thêm §3.4 (dòng 32–33) + cmd8 ở §2 |
| 2 | Tester | §3 thiếu helper ghi locator `storage.NormalizeObjectURL` ở `meeting_ai.go:453` và `chat_voice_recording.go:162` | thêm §3.4 (dòng 34–35); nêu rõ phạm vi §3 |
| 3 | Tester + Reviewer (F1) | §3.1 dòng 5 gọi `local.go:333` là "từ `UploadStream`" — thực tế là `UploadFromReader` (`local.go:327`); footnote §2 còn trỏ sai `s3.go:333` | sửa dòng 5 và footnote §2; bỏ khẳng định sai về `s3.go:333` |
| 4 | Tester + Reviewer (F2) | §4 dòng 6 trỏ `046_chat_core.up.sql:36` (cột `kind`) thay vì `:38` (`metadata`) | sửa thành `:38` kèm ghi chú dòng 36 là `kind` |
| 5 | Tester | Ghi chú §3.2 nói row đính kèm "luôn có `task_id`" — row staged thì không | viết lại: row đã bind có `task_id`, row staged có cả hai NULL + `expires_at` |
| 6 | Tester | U745-4 và U746-4 viện dẫn test không phủ hết hành vi được khẳng định (header `Content-Disposition`/`Cache-Control`; đường Range S3) | ghi rõ phần code giữ hành vi và đánh dấu **test chưa phủ** để T7/T8 bổ sung |
| 7 | Tester | U744-10 không có test cho nhánh xoá object best-effort khi `UpdateAvatar` lỗi | đánh dấu **test chưa phủ** (`avatar.go:84`) |
| 8 | Reviewer (F3) | U746-1 gộp "409 khi đang ghi" cho cả meeting và chat; thực tế đường chat **idempotent** (trả cùng recording) | tách khẳng định: 409 chỉ cho meeting; thêm câu idempotent vào U746-6 |

Hai vòng kiểm tra đều tái lập đúng tám số đếm AC-1 (26/5/39/14/81/0/38/42) và `node --test scripts/governance.test.mjs` (15/15 pass) trên `4105de9c`; vòng sau (re-test + re-review) chạy trên revision chứa mục §12 này, và kết quả được ghi ở PR body + acceptance packet.