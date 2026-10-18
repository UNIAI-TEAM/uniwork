# Documents — Phụ lục: phân loại những hàng một lần xóa vĩnh viễn để lại (RETENTION-01, UNI-1904)

> **Trạng thái:** draft — v0.1 hợp đồng, viết 2026-10-18, chưa có dòng code nào. Thẻ RETENTION-01 (UNI-1904). Mọi `?` ở §4 chờ Advisor chốt.

**Nguồn:** `review-be-rs-r1.md` § BE-RS-4 (một "maybe-false": helper xóa không đụng `document_break_glass_grants`, `office_offline_leases`,
`office_launch_sessions`, `office_jobs`, `document_commit_intents`, snapshot items), `packet-rs.md` § BE-RS-4 (DEFERRED: tập dọn y hệt
`purgeOneDocument` trước refactor; phân loại lưu trữ là thẻ riêng).
**Quan hệ:** [phụ lục khôi phục/xóa vĩnh viễn](2026-10-17-documents-restore-purge-addendum.md) (§2 P-4 chia `hardDeleteDocumentTx`), [phụ lục Lưu trữ](2026-10-17-documents-archive-addendum.md) (`shelved`).
**Hiện trạng:** đọc ở root G5-G7 `1c7760c5f`.

Phạm vi: **chỉ đọc code và viết hợp đồng**. Không đổi code, không migration, không bảng mới, không FK.

## 0. Tập dọn hôm nay (A)

`PurgeDocument` (`document_lifecycle.go:1058`): tx → `LockDocumentTree` (`:1074`) → `LockDocumentByID` (`:1078`) → `effectiveLevel` (`:1086`) →
`decideArchiveRootAccess` (`:1090`) → đòi `archived_at` (`:1093`) → `managedArchivedSubtree` (`:1097`) → `archiveBound` (`:1101`) → khóa từng nút
(`:1106`) → `hardDeleteDocumentTx` (`:1110`) → commit (`:1127`).
`PurgeExpired` (`:1150`): keyset `ListDocumentsForPurge` (`:1170`, lô `documentSweepBatch = 200`) → `purgeOneDocument` (`:1185`, actor
`audit.System("documents.purge")`) → asset mồ côi quá `documentAssetRetentionDays = 7` (`:1200-1237`, `purgeOneAsset` `:1424`).

`hardDeleteDocumentTx` (`:1276-1418`) làm đúng những việc sau, tất cả trong transaction của người gọi:

| Việc | file:line |
|---|---|
| Đọc file id của versions + assets | `document_lifecycle.go:1277` (`ListDocumentFileIDs`) |
| Con trực tiếp ngoài tập xóa | `:1289` (`ListDocumentChildrenOutsideSet`) |
| Re-root con **còn trong thùng rác** | `:1296` (`RerootArchivedChildrenOutsideSet`) |
| Re-root con **đang sống**: tên `(n)` + `NextDocumentPosition` + `DetachDocumentToRoot` | `:1302-1326` |
| `document_versions` | `:1330` |
| `document_assets` | `:1334` |
| `document_shares` | `:1338` |
| `document_share_links` | `:1342` |
| `document_access_logs` | `:1346` |
| `comment_reactions` (qua `USING document_comments`) | `:1353` |
| `document_comment_mentions` | `:1357` |
| `document_comment_revisions` | `:1361` |
| `document_comments` | `:1365` |
| `document_favorites` | `:1369` |
| hàng `documents` | `:1377` (`DeleteArchivedDocument`, 0 hàng → bỏ qua) |
| nhả tham chiếu tệp qua FileService | `:1393` (`files.ReleaseInTx`) |
| audit + outbox `document.deleted` (`manual_purge` khi actor là người) | `:1403-1414` |

SQL tương ứng: `server/pkg/db/queries/document_gc.sql` — `ListDocumentsForPurge:13`, `ListDocumentFileIDs:28`, `DeleteDocumentVersions:40`,
`DeleteDocumentAssets:46`, `DeleteDocumentShares:52`, `DeleteDocumentShareLinks:58`, `DeleteDocumentAccessLogs:64`,
`DeleteDocumentCommentReactionsByDocument:73`, `DeleteDocumentCommentMentionsByDocument:83`, `DeleteDocumentCommentRevisionsByDocument:89`,
`DeleteDocumentComments:95`, `DeleteDocumentFavorites:101`, `DeleteArchivedDocument:109`, `ListOrphanedDocumentAssets:119`.

**Kết luận A:** 11 bảng + hàng `documents` + tham chiếu tệp, cộng hai lần ghi `UPDATE` lên cây (`parent_id`, `position`, `title`, `search_text`
của con sống; `parent_id` của con trong thùng rác). Không đụng bảng nào khác.

## 1. Bảng giữ id tài liệu — phân loại

Quét `server/migrations/*.up.sql` cho `document_id`, `source_document_id`, `token_document_id`, `result_document_id`, `snapshot_id`,
`lock_id`, `root_id`, `node_id`, `target_id`, `resource_id`, và đối chiếu struct trong `server/pkg/db/generated/models.go`.

Đã kiểm và **không** giữ id tài liệu (không vào bảng): `chat_message_links` (`target_type` CHECK chỉ `'task'`), `chat_thread_task_links`,
`project_resources` (`resource_type IN ('github_repo','local_directory')`), `usage_events.ref_id`, `notifications.resource_id` (generic, xem C-4),
`audit_events.resource_id` (generic, C-1), `admin_actions.target_id`, `document_settings` (khóa theo `organization_id`), `file_upload_sessions`,
`file_derivatives` (chỉ file id), `mcp_grants`, `attachments`, `task_source_contexts`, `ai_conversations`/`ai_messages`.

| # | Bảng | Loại | Bằng chứng | Khi hàng `documents` đã mất, người đọc làm gì |
|---|---|---|---|---|
| A-1 | `documents` | **A** | `:1377` | 404 (`GetDocumentByID` → `pgx.ErrNoRows`) |
| A-2 | `document_versions` | **A** | `:1330` | `GetDocumentVersion` theo `document_id`; mọi caller đã đọc `documents` trước → 404 |
| A-3 | `document_assets` | **A** | `:1334` | chỉ đọc qua tài liệu |
| A-4 | `document_shares` | **A** | `:1338` | `resolveLevelInTenant` chạy trên hàng `db.Document` đã đọc |
| A-5 | `document_share_links` | **A** | `:1342` | đọc công khai theo token → `documents` → 404 |
| A-6 | `document_access_logs` | **A** | `:1346` | báo cáo truy cập liệt kê theo tài liệu |
| A-7 | `document_comments` | **A** | `:1365` | `loadInResource` → 404 |
| A-8 | `document_comment_mentions` | **A** | `:1357` | theo bình luận |
| A-9 | `document_comment_revisions` | **A** | `:1361` | theo bình luận |
| A-10 | `comment_reactions` | **A** | `:1353` | theo bình luận |
| A-11 | `document_favorites` | **A** | `:1369` | danh sách yêu thích theo tài liệu |
| A-12 | tham chiếu tệp (`files`) | **A** | `:1393` | FileService nhả tham chiếu, byte do GC của FileService quyết |
| B-1 | `office_jobs` — hàng **đang sống** (`accepted`, `running`) | **B** (đề xuất) | không có câu DELETE nào trong `server/pkg/db/queries/office_jobs.sql` (các `-- name:` ở `:8,26,33,40,52,60,68,79,94,110,126,141,152,160`) | `OfficeJob` (`document_office_capability.go:1891-1907`) và `CancelOfficeJobForDocument` (`:1911-1928`) ủy quyền tài liệu **trước**; `GetOfficeJob` (`document_office.go:695-706`) `get` rồi `authorize`; `OpenOfficeJobOutput` (`:711-745`) `authorizeDocument` trước; `StartOfficeJob` (`:249-253`) và `StartOfficeJobForDocument` (`:621`) cũng vậy; `acceptConversion` (`document_copy_convert.go:41-53`) chỉ chạy sau khi `CopyDocument` ủy quyền nguồn (`document_copy.go:95`). **Không hàng nào đọc được** — nhưng `ListOfficeJobOutputHolds` (`office_jobs.sql:152-157`, `HeldBy` ở `document_office_reconcile.go:305-320`) giữ tệp output chừng nào hàng còn sống, nên một job sống của tài liệu đã xóa **giữ byte vô thời hạn** và `ListLiveOfficeJobs` (`office_jobs.sql:141-149`) tiếp tục quét nó (`Refresh` `document_office_reconcile.go:32-56`, `reconcileLost` `:107-132`, `verifyOutput` `:133-193`) |
| B-2 | `document_edit_locks` — nhiệm kỳ **chưa kết thúc** | **B** (đề xuất) | `ListExpiredDocumentEditLocks` (`document_edit_locks.sql:157-168`) có `AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_edit_locks.document_id)` (`:167`) nên sweeper **bỏ qua vĩnh viễn**; `expireDocumentEditLock` (`document_edit_lock_sweep.go:118-160`) cũng thoát sớm khi `LockDocumentByID` → `ErrNoRows` (`:127-130`). `PurgeDocument` **không** gọi `releaseEditLocksOnArchive` (chỉ `document_lifecycle.go:354`, `:916`, `:1003` gọi). Đường kết thúc duy nhất còn lại là consumer `DocumentEditLockReleaser` (`document_edit_lock_consumer.go:176-228`, `releaseDeleted`) trên lane notify | `GetDocumentEditLockState` (`document_edit_lock_commands.go:190`), `HeartbeatDocumentEditLock` (`:517-525`, `GetDocumentByID` → `ErrNotFound`), `AcquireDocumentEditLock` (`:287-301`), `ReleaseDocumentEditLock` (`:654+`) đều đọc `documents` trước. `GetLiveDocumentEditLock` (`document_edit_locks.sql:24-32`) **không** join `documents` — nhưng chỉ được gọi sau một lần đọc tài liệu. Rủi ro là hàng `ended_at IS NULL` tồn tại mãi, không phải rò quyền |
| C-1 | `audit_events` | **C** | ADR 0012; `event_retention.go:36` và `:197-213` chỉ xóa `outbox_events`/`webhook_inbox`/`meeting_provider_events` | đọc theo `resource_id` generic, không join `documents` |
| C-2 | `documents.source_document_id` (tự trỏ) | **C** | đọc `document_lifecycle.go:768-775` (`pristineCopyCleanup`), `document_search.go:759`; ghi `document_copy.go:268`, `document_copy_convert.go:170` | không câu nào join theo cột này; không có trong `sdo.DocumentDTO` (`handler/dto/sdo/document.go:15`) nên client không bao giờ thấy. Hàng bản sao đã xóa → 404, không phải lỗi |
| C-3 | `notifications` (hàng `resource_type='document'`) | **C** | không có câu DELETE nào cho `notifications` | `Service.List` (`notification/service.go:220-265`) hỏi `FilterReadableDocuments`; thiếu hàng → `DocumentGone` (`:248-253`) → `ResourceDeleted = true` và `snippetKeys` (`:91`) bị bỏ, nên tiêu đề/đoạn trích không lộ. `digest.go:165-205` bỏ hẳn slot; deep link push (`push_consumer.go:168-200`) chỉ dựng URL theo workspace → 404 |
| C-4 | `idempotency_keys` | **C** | không có retention (`idempotency.sql` chỉ có `:5,14,23,33`) | mọi replay đọc lại tài liệu trước: `document_commit.go:301-320` (`preflightDocument`), `document_copy.go:175-187` → `errDocumentDeleted()` 410, `document_copy_convert.go:41-53`, `document_lifecycle.go:820-840` → `ErrNotFound`, `document_comments.go:396-410` (`loadInResource`) |
| C-5 | `graph_nodes`/`graph_edges`/`graph_node_facts`/`graph_dirty` | **C** | `NodeDocument` **không** nằm trong `Projected` (`graph/catalogue.go:42`), `catalogue_test.go:68` khẳng định điều đó; `topicNodes` (`graph/projector/refs.go:17-52`) không có topic `document.*` | projector không có gì để ghi hay để quên |
| D-1 | `office_offline_leases` | **D** (+ **C** cho phần bất đồng bộ) | `OfficeLeaseRevoker` (`office_lease_consumer.go:53-56` có `document.deleted`, `:90-91` → `revokeDocument` `:199-220`) chạy lane notify; `OfficeLeaseSweeper` (`office_lease_sweep.go:19-24`, `Sweep` `:69`, query `office_offline_leases.sql:147-155`) xóa 7 ngày sau khi hết hạn/thu hồi; `OfficeLeaseTTL = 24h` (`office_lease.go:29`) | `readableFile` (`office_lease.go:556-583`) `LockOfficeLeaseDocument` → `ErrNoRows` → `officeLeaseBlocked(ACL, ErrNotFound)`; `checkRenewal` (`:586-604`) từ chối hàng thiếu (`officeLeaseRevoked`) |
| D-2 | `office_launch_sessions` | **D** | `DeleteExpiredOfficeLaunchSessions` (`office_launch.sql:53-62`) xóa 24h sau `expires_at`/`revoked_at`/`redeemed_at`; chạy trong `DocumentWorkers.purgeOfficeLaunch` (`document_workers.go:170-187`, nhịp purge mỗi giờ) → `PurgeExpired` (`office_launch.go:371-376`). Vé sống 120s (`officeLaunchTTL` `:23`) | `Exchange` (`office_launch.go:231-300`) `LockDocumentByID` → `ErrNoRows` → `ErrNotFound` (`:277-280`) — vé chưa dùng của tài liệu đã xóa **không đổi được gì** |
| D-3 | `document_commit_intents` | **D** | `SweepDocumentCommitIntents` (`document_commit_intents.sql:95-105`) xóa sau `retain_until` khi claim không sống; `DefaultCommitIntentRetention = 7 ngày` (`document_commit_intent.go:53`), nhịp 10 phút (`:70`), nối ở `document_workers.go:141-151` | `LookupCommitIntent` (`:394-440`) đọc `documents` trước → 404; khóa đã bị quét → 410 `commit_intent_unknown` |
| D-4 | `document_edit_requests` | **D** | `ExpirePendingDocumentEditRequests` (`document_edit_locks.sql:256-263`) + `DeleteClosedDocumentEditRequests` (`:267-275`) xóa 7 ngày sau khi đóng; nhịp `DocumentEditLockSweeper` (`document_edit_lock_sweep.go:81-116, 163-183`) | chỉ đọc bên trong `GetDocumentEditLockState` sau khi ủy quyền tài liệu; `CreateDocumentEditRequest` (`document_edit_lock_requests.go:56-72`) đòi `documents` và từ chối `archived_at` |
| D-5 | `document_change_snapshots` + `_items` | **D** | `DocumentChangeSnapshotSweeper` (`document_changes_sweep.go:76-120`), `SweepExpiredDocumentChangeSnapshots` (`document_changes.sql:85-98`) + `DeleteDocumentChangeSnapshotItems` (`:99-105`) trong một transaction; `DocumentChangeSnapshotTTL = 15 phút` (`document_changes.go:27`), nhịp 1 phút (`document_changes_sweep.go:19`) | `snapshotEvidence` (`document_changes_feed.go:680`) thiếu hàng → không bằng chứng; `purgeAnswer` (`:535`) trả 410 `change_cursor_expired` — client resync, không nhận `document_deleted` (`:142-149`) |
| D-6 | `ai_uniwork_conversations` | **D** (+ **C**) | `ConversationCleanupConsumer` (`ai/conversation_store_pg.go:656-717`, đăng ký lane slow ở `cmd/server/main.go:450`) gọi `DeleteByDocument` (`:250-260`); TTL `30 phút`/`24 giờ` (`ai/conversation_store.go:26,29`) quét bởi `Sweep` (`conversation_store_pg.go:323-339`, nhịp 1 phút `:45`) | `AIUniworkService.Chat` (`ai_uniwork.go:234+`) giải scope tài liệu trước; `documentScope` (`:388-410`) thất bại thì xóa transcript của người dùng và trả lỗi |
| D-7 | `file_multipart_uploads` | **D** (phiên) | `ExpireMultipartUploads` (`document_upload_sessions.go:1776-1845`) claim hàng hết hạn (`ClaimExpiredFileMultipartUploads` `file_multipart_uploads.sql:159+`, status → `expired`), hủy phiên FileService, audit `document.upload_session_gc`; `UploadSessionTTL = 24h` (`:34`); nối ở `document_workers.go:143-151` | `authorizeNonFrameUploadSession` (`:1847-1878`) và `authorizeFrameUploadSession` (`:1880-1912`) đọc tài liệu trước; `loadCompletedUploadSessionResult` (`:1464-1500`) `GetDocument(ResultDocumentID)` → `ErrNotFound` |
| ?-1 | `document_break_glass_grants` | **?** | **Không có sweeper, không có câu DELETE** — chỉ có `INSERT`/`SELECT`/`UPDATE` (`document_break_glass.sql:6,19,28,39`); TTL 24h (`document_break_glass.go:26,98`). Bảng **nằm trong** gói xuất tenant (`tenant_export_tables.go:79`) | mọi người đọc đều đi sau một lần ủy quyền tài liệu: `listLiveBreakGlass` (`document_break_glass.go:197-215`), `breakGlassExpiry` (`:231`), `DocumentAdminSummary` (`:262`), `resolveLevelInTenantFromShares` (`document_permissions.go:242-256`), `liveBreakGlassFor` (`document_list_access.go:80-96`), báo cáo (`document_access_report.go:395-401`) → tài liệu mất thì 404 **trước**. Rủi ro duy nhất: hàng sống của tài liệu đã xóa lọt vào zip xuất dữ liệu, và hàng hết hạn không bao giờ bị dọn |
| ?-2 | `office_jobs` — hàng **đã kết thúc** | **?** | không có retention nào cho `office_jobs` (không câu DELETE, không sweeper) | như B-1: không đọc được. `FileGCOfficeJobRefTenants` (`office_jobs.sql:160-164`) **không** lọc theo state, nên hàng đã kết thúc vẫn khai tenant cho `output_file_id` mãi |
| ?-3 | `file_multipart_uploads` — hàng | **?** | **Không có câu DELETE** (0 lần `DELETE` trong `file_multipart_uploads.sql`) | như D-7: không đọc được |
| ?-4 | `documents` bản sao trỏ tới nguồn đã xóa (`source_document_id`) | **?** | như C-2 | không rò; chỉ là tham chiếu treo trong hàng nội bộ |

## 2. Phạm vi w1 (chỉ hàng B + test)

Đề xuất **chỉ B-1 và B-2**, không bảng mới, không FK, không event mới:

- **B-1 — `office_jobs` hàng sống.** Trong `hardDeleteDocumentTx`, trước `DeleteArchivedDocument`: `UPDATE office_jobs SET state='cancelled',
  error_code='document_purged', error_reason='document_deleted', finished_at=<now>, updated_at=<now> WHERE document_id=$1 AND
  organization_id=$2 AND workspace_id=$3 AND state IN ('accepted','running')` (một câu sqlc mới, có tenant, kiểu `SettleOfficeJob` `office_jobs.sql:94-107`). Hệ quả:
  `ListOfficeJobOutputHolds` thôi giữ tệp output, FileService GC nhặt byte. Hủy job trên engine là **best-effort sau khi commit** (như
  `CancelOfficeJob` `document_office.go:688`), không nằm trong transaction. Không audit riêng: `document.deleted` của chính tài liệu đã
  ghi lại việc này.
- **B-2 — `document_edit_locks` nhiệm kỳ chưa kết thúc.** Gọi `releaseLiveEditLocks(ctx, q, actor, doc, ids, DocumentEditEndDocumentDeleted)`
  (`document_edit_lock.go:499-526`) trong cùng transaction, y như `releaseEditLocksOnArchive` (`:490-493`) đang làm ở `document_lifecycle.go:354`, `:916`, `:1003` và `document_shelved.go:156`. Việc này
  ghi audit `document.edit_lock_released` + frame `document.lock_changed` và khiến consumer `DocumentEditLockReleaser` thành no-op. Không đổi
  `end_reason` (`document_deleted` đã có trong CHECK của bảng).

Ngoài w1 (ghi lại, **không** làm ở vòng này): `?-1`, `?-2`, `?-3` và câu hỏi `?-4` — xem §4.

Không thêm gì cho **D**: mọi hàng D đã tự hết hạn qua sweeper đã có, và người đọc đã trả 404/410. Không xóa tay hàng D trong purge: làm vậy
chỉ nhân đôi đường dọn và tạo hai nguồn sự thật cho cùng một vòng đời.

## 3. Test lead sẽ red-prove

- **RT-1** (B-2): sau `PurgeDocument`, không còn hàng `document_edit_locks` với `ended_at IS NULL` của tài liệu; có audit
  `document.edit_lock_released` với `metadata.reason='document_deleted'`; frame `document.lock_changed` đã phát. Đỏ trước, xanh sau.
- **RT-2** (B-1): sau `PurgeDocument`, mọi `office_jobs` của tài liệu ở state terminal (`cancelled`), `finished_at` có giá trị; và
  `OfficeJobOutputProvider.HeldBy` **không** còn giữ `output_file_id` của job đó (byte được nhả).
- **RT-3** (bỏ phụ thuộc consumer): chạy `PurgeDocument` khi outbox **không** được dispatch (không consumer nào chạy), hàng khóa sửa vẫn
  `ended_at IS NOT NULL`. Đây là test chứng minh B-2 là quyết định, không phải "consumer sẽ lo".
- **RT-4** (giữ A): mở rộng `TestDocumentManualPurge` PG-1 (`document_lifecycle_test.go:685`) — đếm trước/sau cho 11 bảng + `documents`, cộng
  thêm `office_jobs` và `document_edit_locks` (hai hàng mới của B) — tất cả phải bằng 0 sau purge.
- **RT-5** (`?` đã chốt): theo quyết định của Advisor cho `?-1` — hoặc `document_break_glass_grants` của tài liệu = 0 hàng, hoặc còn hàng nhưng
  mọi route đọc trả 404 (chứng minh không rò). Test phải đỏ được: nếu chỉ khẳng định "không đổi gì", nó vô nghĩa.
- **RT-6** (hợp đồng repo): `TestEveryQueryNamesItsTenant` cho câu SQL mới (có `organization_id = $n`); route purge đã nằm trong
  `isolation_matrix_test.go` (`case "purge"` `:441`); `audit_coverage_test.go` giữ `PurgeDocument` (`:2237`).
- **RT-7** (chống hồi quy cho D): sau purge, `office_offline_leases` còn hàng nhưng `Put` trả `officeLeaseBlocked(ACL, ErrNotFound)`; snapshot
  mất → feed trả 410 `change_cursor_expired` (không phải `document_deleted`).

## 4. Câu hỏi cho Advisor

- **Q-RT1 (`?-1`, `document_break_glass_grants`).** Hôm nay bảng này không có sweeper và không có câu DELETE: hàng hết hạn ở lại mãi, hàng sống
  của tài liệu đã xóa lọt vào gói xuất tenant. Chọn: (a) **xóa hàng của tài liệu trong purge** (một câu `DELETE ... WHERE document_id = $1` có
  tenant, không audit riêng vì `document.deleted` đã bao) — nhỏ, khớp A-4/A-5; (b) để nguyên và mở thẻ riêng cho retention của bảng (thêm
  sweeper + xét lại phân loại tenant export); (c) để nguyên hoàn toàn.
  **Đề xuất (a)** cho w1: một câu SQL + một test, và nó đóng đúng cái lỗ "hàng sống của tài liệu không còn tồn tại" mà bảng này đang có. Việc
  thiếu sweeper cho hàng hết hạn là thẻ riêng (không phụ thuộc purge).
- **Q-RT2 (`?-2`, `office_jobs` đã kết thúc).** Không có retention nào. Chọn: (a) thẻ riêng w2 thêm sweeper xóa hàng terminal quá N ngày (kèm
  điều kiện output đã được nhả/commit); (b) xóa hàng terminal của tài liệu bị xóa ngay trong purge; (c) để nguyên.
  **Đề xuất (a)** và **không** làm trong w1: đây là retention của cả bảng, không phải hệ quả của purge, và xóa hàng job sẽ làm
  `FileGCOfficeJobRefTenants` mất nguồn khai tenant cho tệp output.
- **Q-RT3 (`?-3`, hàng `file_multipart_uploads`).** Phiên hết hạn bị đánh dấu `expired` nhưng hàng không bao giờ bị xóa, và nó giữ
  `document_id` + `file_id` mãi. Chọn: (a) thẻ riêng w2 thêm retention cho hàng đã đóng; (b) xóa hàng của tài liệu bị xóa trong purge sau khi
  đã hủy phiên FileService; (c) để nguyên. **Đề xuất (a)**, không làm trong w1 (phiên đã bị hủy nên byte không rò; chỉ là hàng kỹ thuật).
- **Q-RT4 (`?-4`, bản sao trỏ nguồn đã xóa).** `source_document_id` của một bản sao còn sống trỏ tới tài liệu vừa bị xóa. Chọn: (a) để nguyên
  (cột không lộ ra client, không câu nào join); (b) null hóa khi nguồn bị xóa. **Đề xuất (a)**: null hóa là `UPDATE` thêm lên hàng đang sống
  trong purge, không đổi hành vi nào người dùng thấy.
- **Q-RT5 (B-1 có thuộc w1?).** B-1 không phải lỗ quyền — mọi reader đều ủy quyền tài liệu trước. Nó là rò tài nguyên (giữ tệp output vô hạn +
  reconciler quét mãi). Chọn: (a) làm trong w1 cùng B-2; (b) dời sang w2 cùng Q-RT2 để gom một lần đụng `office_jobs`.
  **Đề xuất (a)**: cùng một chỗ sửa, và test RT-2 chứng minh byte được nhả.

## 5. Không đổi

Không bảng mới, không FK/cascade, không event/catalogue mới, không đổi `end_reason`, không đổi payload `document.deleted`, không đổi
`packages/core`. Mọi câu SQL mới mang tenant pair và nằm trong transaction purge đang có.
