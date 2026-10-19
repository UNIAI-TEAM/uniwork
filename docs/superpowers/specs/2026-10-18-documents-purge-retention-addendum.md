# Documents — Phụ lục: phân loại những hàng một lần xóa vĩnh viễn để lại (RETENTION-01, UNI-1904)

> **Trạng thái:** in-progress — v0.2, viết 2026-10-18, Advisor đã chốt 04:05 và w1 đã code (`?-1` → A: purge xóa hàng
> `document_break_glass_grants` của tài liệu; `B-1` → D, `B-2` → C theo `lead-verify-ret-c0.md`). Thẻ RETENTION-01 (UNI-1904).

**Nguồn:** `review-be-rs-r1.md` § BE-RS-4 (một "maybe-false": helper xóa không đụng `document_break_glass_grants`, `office_offline_leases`,
`office_launch_sessions`, `office_jobs`, `document_commit_intents`, snapshot items), `packet-rs.md` § BE-RS-4 (DEFERRED: tập dọn y hệt
`purgeOneDocument` trước refactor; phân loại lưu trữ là thẻ riêng).
**Quan hệ:** [phụ lục khôi phục/xóa vĩnh viễn](2026-10-17-documents-restore-purge-addendum.md) (§2 P-4 chia `hardDeleteDocumentTx`), [phụ lục Lưu trữ](2026-10-17-documents-archive-addendum.md) (`shelved`).
**Hiện trạng:** đọc ở root G5-G7 `1c7760c5f`.

Phạm vi v0.1: **chỉ đọc code và viết hợp đồng**. v0.2 (w1) thêm **một câu SQL + một call site** cho `?-1` — không migration, không bảng
mới, không FK, không event mới.

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
| `document_break_glass_grants` (w1) | `:1373` (`DeleteDocumentBreakGlassGrants`) |
| hàng `documents` | `:1377` (`DeleteArchivedDocument`, 0 hàng → bỏ qua) |
| nhả tham chiếu tệp qua FileService | `:1393` (`files.ReleaseInTx`) |
| audit + outbox `document.deleted` (`manual_purge` khi actor là người) | `:1403-1414` |

SQL tương ứng: `server/pkg/db/queries/document_gc.sql` — `ListDocumentsForPurge:13`, `ListDocumentFileIDs:28`, `DeleteDocumentVersions:40`,
`DeleteDocumentAssets:46`, `DeleteDocumentShares:52`, `DeleteDocumentShareLinks:58`, `DeleteDocumentAccessLogs:64`,
`DeleteDocumentCommentReactionsByDocument:73`, `DeleteDocumentCommentMentionsByDocument:83`, `DeleteDocumentCommentRevisionsByDocument:89`,
`DeleteDocumentComments:95`, `DeleteDocumentFavorites:101`, `DeleteArchivedDocument:109`, `ListOrphanedDocumentAssets:119`; w1 thêm
`document_break_glass.sql` → `DeleteDocumentBreakGlassGrants`.

**Kết luận A:** 12 bảng (11 bảng cũ + `document_break_glass_grants` từ w1) + hàng `documents` + tham chiếu tệp, cộng hai lần ghi `UPDATE` lên
cây (`parent_id`, `position`, `title`, `search_text` của con sống; `parent_id` của con trong thùng rác). Không đụng bảng nào khác.

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
| B-1 | `office_jobs` — hàng **đang sống** (`accepted`, `running`) | **D** (lead chốt) | không có câu DELETE nào trong `server/pkg/db/queries/office_jobs.sql` (các `-- name:` ở `:8,26,33,40,52,60,68,79,94,110,126,141,152,160`) | `OfficeJob` (`document_office_capability.go:1891-1907`) và `CancelOfficeJobForDocument` (`:1911-1928`) ủy quyền tài liệu **trước**; `GetOfficeJob` (`document_office.go:695-706`) `get` rồi `authorize`; `OpenOfficeJobOutput` (`:711-745`) `authorizeDocument` trước; `StartOfficeJob` (`:249-253`) và `StartOfficeJobForDocument` (`:621`) cũng vậy; `acceptConversion` (`document_copy_convert.go:41-53`) chỉ chạy sau khi `CopyDocument` ủy quyền nguồn (`document_copy.go:95`). **Không hàng nào đọc được.** `lead-verify-ret-c0.md`: `RunReconciler` → `ReconcileOfficeJobs` (`document_office_reconcile.go:237`) đọc `ListLiveOfficeJobs`, `Refresh` tự kết thúc mọi hàng sống — câu trả lời của engine, engine `not_found` → `reconcileLost`, hoặc quá `deadline_at + 5s` (`officeDeadlineGrace`) → `timed_out` (`:47-50`, `:84-88`) — **không** đọc hàng `documents` (`grantFor` chỉ dùng hàng job, `document_office.go:549`). Nên giữ tệp output chỉ kéo dài tới hạn của job, **không vô hạn**: không phải hệ quả của purge |
| B-2 | `document_edit_locks` — nhiệm kỳ **chưa kết thúc** | **C** (lead chốt) | `ListExpiredDocumentEditLocks` (`document_edit_locks.sql:157-168`) có `AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_edit_locks.document_id)` (`:167`) — câu này **nói rõ** hàng ấy thuộc consumer xóa, không phải bỏ sót; `expireDocumentEditLock` (`document_edit_lock_sweep.go:118-160`) cũng thoát sớm khi `LockDocumentByID` → `ErrNoRows` (`:127-130`). Đường kết thúc theo thiết kế: consumer `DocumentEditLockReleaser` (`document_edit_lock_consumer.go:47,84`, `releaseDeleted` `:173-228`) trên lane notify (`cmd/server/main.go:488`), kết thúc nhiệm kỳ với `document_deleted`, audit + `document.lock_changed`, **kể cả khi hàng `documents` đã mất**. `TestDeleteReleasesEditLock` (`document_edit_lock_workers_test.go:631`) ghim cả lần giao lại. Thêm nữa: purge đòi `archived_at`, mà archive đã nhả mọi nhiệm kỳ (`document_lifecycle.go:354`, `:916`, `:1003`), nên nhiệm kỳ còn sống lúc purge không phải trạng thái bình thường |
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
| ?-1 | `document_break_glass_grants` | **A** (Advisor chốt 04:05, w1) | w1 thêm `DeleteDocumentBreakGlassGrants` (`document_break_glass.sql`) gọi trong `hardDeleteDocumentTx` cạnh các delete khác — trước đó bảng **không có sweeper, không có câu DELETE** (chỉ `INSERT`/`SELECT`/`UPDATE`); TTL 24h (`document_break_glass.go:26,98`). Bảng **nằm trong** gói xuất tenant (`tenant_export_tables.go:79`) | mọi người đọc đều đi sau một lần ủy quyền tài liệu: `listLiveBreakGlass` (`document_break_glass.go:197-215`), `breakGlassExpiry` (`:231`), `DocumentAdminSummary` (`:262`), `resolveLevelInTenantFromShares` (`document_permissions.go:242-256`), `liveBreakGlassFor` (`document_list_access.go:80-96`), báo cáo (`document_access_report.go:395-401`) → tài liệu mất thì 404 **trước**. Lỗ duy nhất là hàng sống của tài liệu đã xóa lọt vào zip xuất dữ liệu — w1 đóng bằng cách xóa hàng của tài liệu trong purge |
| ?-2 | `office_jobs` — hàng **đã kết thúc** | **backlog** (Q-RT2 đóng: retention toàn bảng, không phải hệ quả của purge — dòng FU §2) | không có retention nào cho `office_jobs` (không câu DELETE, không sweeper) | như B-1: không đọc được. `FileGCOfficeJobRefTenants` (`office_jobs.sql:160-164`) **không** lọc theo state, nên hàng đã kết thúc vẫn khai tenant cho `output_file_id` mãi |
| ?-3 | `file_multipart_uploads` — hàng | **backlog** (Q-RT3 đóng: phiên đã bị hủy nên byte không rò — dòng FU §2) | **Không có câu DELETE** (0 lần `DELETE` trong `file_multipart_uploads.sql`) | như D-7: không đọc được |
| ?-4 | `documents` bản sao trỏ tới nguồn đã xóa (`source_document_id`) | **C** (Q-RT4 đóng theo lead: vô hại) | như C-2 | không rò; chỉ là tham chiếu treo trong hàng nội bộ |

## 2. Phạm vi w1 (đã chốt: chỉ xóa break-glass)

Advisor chốt 04:05 (Q1 YES); lead `lead-verify-ret-c0.md` đóng hai hàng B. w1 = **một câu SQL + một call site**, không bảng mới,
không FK, không event mới:

- **?-1 → A — `document_break_glass_grants`.** Câu mới `DeleteDocumentBreakGlassGrants :exec` (`server/pkg/db/queries/document_break_glass.sql`):
  `DELETE FROM document_break_glass_grants WHERE organization_id = sqlc.arg(organization_id) AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)` — mang tenant pair, **không** `-- tenant:` exemption. Gọi trong `hardDeleteDocumentTx`
  (`document_lifecycle.go`), trong vòng lặp delete cạnh `DeleteDocumentFavorites`, trước `DeleteArchivedDocument`: cùng transaction,
  không audit riêng, không event riêng (`document.deleted` của chính tài liệu đã ghi lại việc này). Hàng này chạy cho từng nút trong
  cây bị xóa, nên grant của một tài liệu con trong cây cũng đi theo.

**B-1 → D (`office_jobs` hàng sống).** `lead-verify-ret-c0.md`: reconciler tự kết thúc mọi hàng sống ở hạn của job
(`document_office_reconcile.go:47-50,84-88`), không đọc hàng `documents`. Tệp output được giữ tới hạn job, **không vô hạn**; không phải
hệ quả của purge. Không thêm gì cho B-1.

**B-2 → C (`document_edit_locks` nhiệm kỳ chưa kết thúc).** Kết thúc bất đồng bộ là thiết kế: consumer `DocumentEditLockReleaser`
(`document_edit_lock_consumer.go:173-228`, `releaseDeleted`) trên lane notify kết thúc nhiệm kỳ với `document_deleted`, kể cả khi hàng
`documents` đã mất; `TestDeleteReleasesEditLock` (`document_edit_lock_workers_test.go:631`) ghim nó. Archive (điều kiện tiên quyết của
purge) đã nhả mọi nhiệm kỳ. Không thêm gì cho B-2.

Ngoài w1 (ghi lại, **không** làm ở vòng này): `?-2` và `?-3` — retention của cả bảng, không phải hệ quả của purge — xem §4.

FU: table-wide retention for terminal office_jobs rows, closed file_multipart_uploads rows and expired document_break_glass_grants rows
(no sweeper today) — backlog card, not this lane.

Không thêm gì cho **D**: mọi hàng D đã tự hết hạn qua sweeper đã có, và người đọc đã trả 404/410. Không xóa tay hàng D trong purge: làm vậy
chỉ nhân đôi đường dọn và tạo hai nguồn sự thật cho cùng một vòng đời.

## 3. Test (đã red-prove)

- **RT-5** (`?-1`, đã làm): `TestDocumentManualPurge` PG-5 (`document_lifecycle_test.go`) — purge một thư mục đã lưu trữ có grant break-glass
  trên cả thư mục lẫn con: `SELECT count(*) FROM document_break_glass_grants WHERE document_id = ANY(...)` = 0, từng grant id cũng 0, và
  zip xuất tenant của tổ chức (`buildZip`) không còn tên tài liệu/grant nào của cây đã xóa. **Đối chứng**: grant của một tài liệu khác trong
  cùng tổ chức vẫn còn (cả trong bảng lẫn trong zip). Đỏ khi bỏ call: dòng `break-glass rows of the purged subtree = 2 ... want 0`, rồi
  `grant ... survived the purge (n=1)`, rồi `tenant export still names the purged break-glass row ...`.
- **RT-4** (giữ A): PG-1 giữ nguyên — 11 bảng + `documents` = 0 sau purge.
- **RT-6** (hợp đồng repo): `TestEveryQueryNamesItsTenant` cho câu mới (có `organization_id = $n`); route purge đã nằm trong
  `isolation_matrix_test.go` (`case "purge"` `:441`); `audit_coverage_test.go` giữ `PurgeDocument` (`:2237`) — không audit mới nên không đổi.
- **RT-1 / RT-2 / RT-3 / RT-7** không còn áp dụng: B-1 và B-2 đã bị hạ khỏi w1 (xem §2).

## 4. Câu hỏi cho Advisor (đã đóng)

- **Q-RT1 (`?-1`).** **Chốt: có (a)** — xóa hàng của tài liệu trong purge. Đã code ở w1 (xem §2, §3).
- **Q-RT2 (`?-2`, `office_jobs` đã kết thúc).** Chốt: thẻ riêng (retention của cả bảng), **không** w1 — xem dòng FU ở §2.
- **Q-RT3 (`?-3`, hàng `file_multipart_uploads`).** Đóng theo lead: phiên đã bị hủy nên byte không rò; retention của cả bảng là thẻ riêng —
  xem dòng FU ở §2, không làm ở w1.
- **Q-RT4 (`?-4`, bản sao trỏ nguồn đã xóa).** Đóng theo lead: vô hại — cột không lộ ra client, không câu nào join; để nguyên.
- **Q-RT5 (B-1 có thuộc w1?).** Đóng theo lead: **không** — B-1 là D, reconciler tự kết thúc ở hạn job; w1 chỉ còn `?-1`.

## 5. Không đổi

Không bảng mới, không FK/cascade, không event/catalogue mới, không đổi `end_reason`, không đổi payload `document.deleted`, không đổi
`packages/core`. Mọi câu SQL mới mang tenant pair và nằm trong transaction purge đang có.

## 6. RETENTION-02 — retention cho hàng đã đóng (contract)

> **Trạng thái:** in-progress — **đã code (w1, UNI-1921)**, 2026-10-19. Hợp đồng v0.3 ở dưới được hiện thực đúng như đã chốt;
> ba bảng mà hàng hôm nay sống mãi: `office_jobs` (trạng thái kết thúc), `file_multipart_uploads` (hàng đã đóng),
> `document_break_glass_grants` (đã hết hạn/thu hồi, trên tài liệu còn tồn tại — tài liệu đã purge thì RETENTION-01 lo).
>
> **Đã hiện thực (file:line):** ba câu DELETE `-- tenant: system` — `SweepOfficeJobs` (`server/pkg/db/queries/office_jobs.sql:171`),
> `SweepFileMultipartUploads` (`server/pkg/db/queries/file_multipart_uploads.sql:189`), `SweepDocumentBreakGlassGrants`
> (`server/pkg/db/queries/document_break_glass.sql:66`). Ba hàm sweep + hằng số cửa sổ và chặn dưới lúc biên dịch:
> `server/internal/service/document_retention_sweep.go` (`officeJobRetention` `:41`, `multipartRowRetention` `:46`,
> `breakGlassRetention` `:50`, guard `:66-68`, `sweepRetentionRows` `:113`). Nối vào nhịp đã chốt trong
> `DocumentWorkers` (`server/internal/service/document_workers.go`: `purge` `:131-132`, `commit_intent` `:154`,
> nhãn metric `:209,215,221`). Hai index: `server/migrations/9991792368456870_office_jobs_finished_idx.up.sql`,
> `server/migrations/9991792368456871_file_multipart_uploads_closed_idx.up.sql`. Test:
> `server/internal/service/document_retention_sweep_test.go`.

### 6.1 Số đo và công thức

**Không có số đo vận hành trên bro** ("no measured counts available on bro"): không DB dev/seed nào mang ba bảng này —
`uniwork` trên `uniwork-postgres-1` trả `to_regclass('office_jobs' | 'file_multipart_uploads' | 'document_break_glass_grants')` = NULL
cả ba. DB test dùng chung `uniwork_test` còn rác fixture; **chỉ mang tính chỉ dấu, không phải lưu lượng**:
`office_jobs` 0; `file_multipart_uploads` 8 (2 `aborted`, 5 `expired`, 1 `completed`; `closed_at` 2026-09-26…09-27);
`document_break_glass_grants` 7 (2 còn sống, 1 đã thu hồi, 4 đã hết hạn).

| Bảng | Công thức hàng/ngày |
|---|---|
| `office_jobs` | ≈ số job Office khởi động/ngày = (open + edit + serialize + export + convert được chấp nhận) + (mỗi lần export PDF của frame). Một hàng cho mỗi lần `StartOfficeJob` chấp nhận (`InsertOfficeJob`, `document_office.go:310`); retry cùng khoá dùng lại hàng cũ (unique `uidx_office_jobs_idempotency`). Nguồn: `StartOfficeJobForDocument` (`document_office_capability.go:628`), `ExportFramePDF` (`office_frame_export.go:100`, không khoá thì tự sinh `export:<id>`). `CreateBlankFile` **không** ghi hàng `office_jobs` (gọi engine trực tiếp, `document_office_capability.go:336-475`) — không tính. |
| `file_multipart_uploads` | ≈ số phiên tải > 20 MiB/ngày (`UploadSessionThresholdBytes`, `document_upload_sessions.go:31`) = mỗi lần mở phiên (`InsertFileMultipartUpload`, `:662`). Trần mỗi người 4 phiên mở (`UploadSessionMaxOpenPerActor`, `:33`). |
| `document_break_glass_grants` | ≈ số lần cấp quyền khẩn cấp/ngày (`InsertDocumentBreakGlassGrant`, `document_break_glass.go:99`); gọi lại khi đã có grant sống thì trả chính nó (`:87-96`) → trần = số admin × số tài liệu restricted. |

**Mọi hàng đều tới trạng thái kết thúc**, nên kích thước bảng ở trạng thái ổn định ≈ hàng đến/ngày × số ngày giữ: job ở hạn + 5s
(`officeDeadlineGrace`, `document_office.go:99`; hạn mặc định 60s `:93`, trần 2 phút `:124-125`, reconciler 5s `:127-128`), phiên tải ở
`UploadSessionTTL = 24h` (`document_upload_sessions.go:34`), grant ở `breakGlassTTL = 24h` (`document_break_glass.go:26`).

### 6.2 Bảng hợp đồng (a–e)

| Bảng | (a) Hành động ghi hàng · chuyển trạng thái đóng | (b) Ai đọc hàng đã đóng · mất hàng thì sao | (c) Cửa sổ đề xuất (chặn dưới = người đọc ở b) | (d) Sweeper | (e) Ai quyết |
|---|---|---|---|---|---|
| `office_jobs` — hàng terminal (`completed`/`failed`/`timed_out`/`cancelled`) | Ghi: `StartOfficeJob` (`document_office.go:238`, insert `:310`). Đóng: `CompleteOfficeJob` (`office_jobs.sql:79`), `SettleOfficeJob` (`:94`), `CancelOfficeJob` (`:110`), reconciler `Refresh`/`settle` ở hạn (`document_office_reconcile.go:32-57`). **Không có câu DELETE nào** trong `office_jobs.sql`. | `GetOfficeJobByOutputFile` → `officeJobForOutput` (`document_commit.go:132`, dùng ở `:439`): đường commit G1-03 buộc output đã stage vào job của nó — mất hàng thì một output engine bị nhận như **upload thường**: mất kiểm tra base của job và provenance engine do client khai (`checkEngine` + `eng = in.Engine`, nhánh `job == nil` ở `document_commit.go:474-480`) thay vì do server đóng dấu (`eng = officeEngineInfo()`, `:472`). `GetOfficeJob` (`document_office.go:695`), `OpenOfficeJobOutput` (`:711`), `CancelOfficeJob` (`:659`) — đều ủy quyền tài liệu trước, mất hàng → 404 thay vì trạng thái kết thúc. `acceptConversion` (`document_copy_convert.go:41`) — người dùng "chấp nhận chuyển đổi" từ change list cần hàng `completed`. `GetOfficeJobByIdempotencyKey` (`document_office.go:261,393`; `document_office_capability.go:658`) — replay theo khoá. `ListOfficeJobOutputHolds` (`office_jobs.sql:152-157`) **chỉ** giữ file khi job sống → hàng terminal không giữ byte. `FileGCOfficeJobRefTenants` (`:160-164`, **không** lọc state) chỉ *khai tenant* cho collector (`file_references.go:149`); quyền quyết định tenant là `files.organization_id`, nên mất hàng không tạo quarantine sai. Không audit nào join (không có `office.job.*` trong `audit/actions.go`). Gói xuất tenant **loại** bảng (`tenant_export_tables.go:33`); admin console (`admin.sql`) không đọc; metric chỉ là counter lúc settle (`metrics/office.go:81`); runbook chỉ đọc hàng sống (`RUNBOOK_DOCUMENTS.md:101` lọc `state NOT IN (...)`). **Quá cửa sổ:** hàng đã xoá, nên replay `acceptConversion` và đọc trạng thái/output job theo id trả **not found**. Một yêu cầu office-start dùng lại **khoá idempotency cũ** cũng **không** phải replay: khoá chỉ được ghi bằng chính hàng job đã xoá (`uidx_office_jobs_idempotency`), nên `StartOfficeJob`/`StartOfficeJobForDocument` không tra được hàng cũ và coi đó là **một lệnh mới** — dispatch một job mới, hoặc từ chối theo base hiện tại của tài liệu — chứ không trả kết quả đã kết thúc của job cũ. | **30 ngày.** Chặn dưới kỹ thuật: cửa sổ claim của output đã stage = `files.ClaimTTL = 24h` (`internal/files/contracts.go:18`, `fileGCAge` `file_gc.go:134`) — trong cửa sổ đó một job `completed` chưa commit còn phải buộc được vào đường commit; + biên. Chặn dưới sản phẩm: bao lâu người dùng còn chấp nhận được một job convert. Dải an toàn: **7–90 ngày**. | Thêm bước vào nhịp `purge` 1 giờ của `DocumentWorkers` (`document_workers.go:42,119-131`), cạnh `PurgeExpired` + `purgeOfficeLaunch` (`:170-187`). | Sàn 24h: **kỹ thuật**. Cửa sổ trên sàn (accept convert, mở lại job): **sản phẩm**. |
| `file_multipart_uploads` — hàng đã đóng | Ghi: mở phiên (`document_upload_sessions.go:662`). Đóng: `CompleteFileMultipartUpload` (`file_multipart_uploads.sql:117`), `FailFileMultipartUpload` (`:132`), `AbortFileMultipartUpload` (`:145`), `ClaimExpiredFileMultipartUploads` (`:159`). **Tập trạng thái thật** (CHECK `file_multipart_uploads_status_check`, `9991792100200005_file_multipart_uploads.up.sql:39-41`): `completed`, `aborted`, `expired`, `failed` — **không có `cancelled`**; hủy ghi `aborted`. **0 câu DELETE** trong `file_multipart_uploads.sql`. | `GetFileMultipartUploadByID` qua `authorizeNonFrameUploadSession` (`:1847`) / `authorizeFrameUploadSession` (`:1880`) — đọc tài liệu trước, mất hàng → 404. `loadOpenSessionReplay` (`:764`) — replay `POST` mở phiên theo khoá idempotency đọc hàng để ký lại URL phần; mất hàng → 404 (trước đó là `upload_session_expired`). `handleTerminalCompleteState` (`:1442`) — `completed` → `loadCompletedUploadSessionResult` (`:1464`) đọc *tài liệu*; `failed` → `mapStoredUploadSessionFailure(row.FailureCode)` (`:2058`) trả lại **đúng lỗi đã lưu**, nên mất hàng đổi retry `complete` từ lỗi cũ sang 404. `getUploadSessionView` (`:812`) chỉ sống. Bảng **không** nằm trong danh mục tham chiếu tệp (`file_references_test.go:25` xếp nó vào bảng của FileService) nên FileService GC không đọc; không audit nào join (`document.upload_session_expired` ghi lúc chuyển trạng thái, không phải lúc xoá hàng); gói xuất tenant **loại** (`tenant_export_tables.go:29`); admin console không đọc; không metric. | **7 ngày sau `closed_at`.** Chặn dưới: `UploadSessionTTL = 24h` (`:34`) + lease kiểm tra `UploadSessionValidationLeaseTTL = 10 phút` (`:36`) — hàng phải sống lâu hơn phiên nó mô tả; + biên cho retry `open`/`complete` đọc lại trạng thái/lỗi đã lưu. Khớp họ 7 ngày đang có (commit intent `document_commit_intent.go:53`, lease `office_lease_sweep.go:20`, edit lock `document_edit_lock_sweep.go:22`). Dải an toàn: **2–30 ngày**. | Thêm bước vào nhịp `commit_intent` 10 phút (`document_workers.go:139-151`), ngay cạnh `ExpireMultipartUploads` (`:145`) — cùng bảng, cùng khái niệm "phiên đã đóng". | **Kỹ thuật** (hàng kỹ thuật, không lộ ra khách). |
| `document_break_glass_grants` — đã hết hạn hoặc đã thu hồi | Ghi: `GrantDocumentBreakGlass` (`document_break_glass.go:99`). Đóng: `RevokeDocumentBreakGlass` (`revoked_at`, `:160-164`) hoặc hết hạn sau 24h (`breakGlassTTL` `:26`). Ngoài purge (RETENTION-01 w1, `document_lifecycle.go:1377`) **không có sweeper, không câu DELETE** cho hàng đã đóng. | `GetDocumentBreakGlassGrant` trong `RevokeDocumentBreakGlass` (`:144`) đọc **mọi trạng thái**: thu hồi một grant đã kết thúc phải trả 200 idempotent (`:157-159`), mất hàng → 404 (đổi hành vi đã ghi trong route). Mọi người đọc khác lọc sống (`revoked_at IS NULL AND expires_at > now()`): `GetLiveDocumentBreakGlassGrantForActor` (4 chỗ: `document_permissions.go:242`, `document_break_glass.go:87,235,281`, `document_shares.go:704`), `ListLiveDocumentBreakGlassGrants` (panel, `:198`), `ListLiveBreakGlassGrantsForDocuments` (`document_list_access.go:84`), `ListLiveBreakGlassGrantsForReport` (`document_access_report.go:395`) — báo cáo truy cập chỉ thấy grant **sống**, nên retention không đổi báo cáo. `EXISTS` trong tìm kiếm/mention (`document_search.sql:54,181,204,310,333,556,579`; `document_mentions.sql:40,111`) cũng lọc sống — chỉ tốn index khi hàng đã đóng tích lại. Audit **không** join nhưng đã có lịch sử: `document.break_glass_granted`/`_revoked` (`audit/actions.go:154-155`, ghi ở `document_break_glass.go:108-112`, `:174-190`). Gói xuất tenant **chứa** bảng (`tenant_export_tables.go:79`); admin console không đọc; không metric. | **30 ngày sau khi kết thúc.** Chặn dưới: cửa sổ retry `DELETE .../break-glass/{grantID}` phải còn trả 200 idempotent. Ghi chú: bảng **nằm trong gói xuất tenant**, nên đổi cửa sổ là đổi nội dung zip của khách; lịch sử tuân thủ đầy đủ nằm ở `audit_events`. Dải an toàn: **7–365 ngày**. | Thêm bước vào nhịp `purge` 1 giờ, cạnh bước của `office_jobs`. | **Sản phẩm/ops (tuân thủ)** — số ngày là cam kết với khách qua gói xuất. |

### 6.3 Thiết kế sweeper

- **Chỗ đặt:** tái dùng `DocumentWorkers` (`document_workers.go`) — nơi `cmd/server/main.go:411` đã dựng và `:570` đã chạy trong chuỗi shutdown. Nhịp `commit_intent` 10 phút (`:141-151`) nhận thêm bước xoá hàng `file_multipart_uploads` đã đóng (cạnh `ExpireMultipartUploads` `:145`). Nhịp `purge` 1 giờ (`:122-131`) nhận thêm `purgeOfficeJobs` và `purgeBreakGlassGrants`, theo đúng khuôn `purgeOfficeLaunch` (`:170-187`). Không worker mới, không goroutine trần.
- **Lô và nhịp:** 500 hàng/lô, lặp tới khi lô trả về ngắn, trần 20 lô mỗi lượt, nghỉ 100ms giữa hai lô — như `OfficeLeaseSweeper` (`office_lease_sweep.go:19-24,69-86`) và `sweepDocumentEditLockRows` (`document_edit_lock_sweep.go:163-183`). Lượt đầu gặp backlog lớn trải qua vài nhịp thay vì giữ connection lâu.
- **Hình dạng câu xoá:** `DELETE ... WHERE id IN (SELECT id FROM <bảng> WHERE <điều kiện đã đóng> AND <cột đóng> < cutoff ORDER BY <cột đóng> LIMIT n FOR UPDATE SKIP LOCKED)` — đúng khuôn `SweepDocumentCommitIntents` (`document_commit_intents.sql:95-105`) và `ClaimExpiredFileMultipartUploads` (`file_multipart_uploads.sql:159-181`), hai replica quét song song chia việc thay vì chờ nhau.
  - `office_jobs`: `state IN ('completed','failed','timed_out','cancelled') AND finished_at < cutoff` — cả ba đường kết thúc đều set `finished_at` (`office_jobs.sql:85,99,115`; ba câu `CompleteOfficeJob`/`SettleOfficeJob`/`CancelOfficeJob` ở `:79,94,110`).
  - `file_multipart_uploads`: `status IN ('completed','aborted','expired','failed') AND closed_at < cutoff` — CHECK `file_multipart_uploads_closed_at_check` bắt buộc `closed_at NOT NULL` với bốn trạng thái này (`9991792100200005_file_multipart_uploads.up.sql:56-58`).
  - `document_break_glass_grants`: `(revoked_at IS NOT NULL AND revoked_at < cutoff) OR (expires_at < cutoff)`.
- **Tenant:** `-- tenant: system` kèm lý do, như `SweepOfficeOfflineLeases` (`office_offline_leases.sql:147-148`) và `SweepDocumentCommitIntents` — đây là retention của hàng mà mọi người đọc đều đã tenant-scoped, không phải đường nghiệp vụ. Per-tenant chỉ cần nếu muốn xoá theo tổ chức, và như `purgeOfficeLaunch` nó thành vòng lặp org → workspace, không đáng cho một câu keyset.
- **Index:** cần cho hai bảng lưu lượng cao; mỗi index `CREATE INDEX CONCURRENTLY`, **một mình trong file migration riêng** (luật Database and Migration Rules).
  - `office_jobs (finished_at) WHERE finished_at IS NOT NULL` — bốn index hiện có đều không phủ: `uidx_office_jobs_idempotency`, `uidx_office_jobs_live_fingerprint`/`idx_office_jobs_live_deadline` (partial trên `accepted/running`), `idx_office_jobs_output_file`.
  - `file_multipart_uploads (closed_at) WHERE closed_at IS NOT NULL` — `idx_file_multipart_uploads_expires` là partial trên `open/validating`.
  - `document_break_glass_grants`: **không** index ở lần đầu — lượng hàng bị chặn bởi số admin × số tài liệu restricted; thêm sau nếu lượt quét lộ ra trong `pg_stat_statements`. (Index hiện có `idx_document_break_glass_grants_doc (organization_id, document_id)` phục vụ đường đọc sống.)
- **Thứ tự với FileService GC: không ràng buộc.** Hàng job terminal không giữ file (`ListOfficeJobOutputHolds` lọc `state IN ('accepted','running')`, `office_jobs.sql:152-157`) và `FileGCOfficeJobRefTenants` (`:160-164`) chỉ *khai tenant*; `file_multipart_uploads` không nằm trong danh mục tham chiếu tệp. Nhưng **cửa sổ giữ phải > cửa sổ claim của FileService** (`ClaimTTL = 24h`) vì đường commit đọc hàng job — đó là chặn dưới ở (c), không phải ràng buộc thứ tự.
- **Audit: không hàng audit mỗi lượt.** Nhất quán với `OfficeLeaseSweeper` (`office_lease_sweep.go:26-28`: "Deleting a dead row changes no business state"), `SweepCommitIntents` (`document_commit_intent.go:471-488`), `EventRetention` (`event_retention.go:36`) và `sweepDocumentEditLockRows`. Phân biệt rõ: `ExpireMultipartUploads` **có** ghi `document.upload_session_expired` (`document_upload_sessions.go:1810-1815`) nhưng đó là **chuyển trạng thái** open → expired kèm huỷ phiên FileService và nhả quota, không phải retention của hàng đã đóng — xoá hàng đã đóng không cần audit riêng.
- **Metric/log:** `recordDocumentSweep("<worker>", 0, err, started)` (`document_metrics.go:191`) → `uniwork_document_worker_sweeps_total{worker,result}` + `uniwork_document_worker_sweep_duration_seconds`, nhãn `office_job`, `multipart_row`, `break_glass`. Thêm `slog.Info("<tên> sweep", "deleted", n)` khi `n > 0`, như `OfficeLeaseSweeper` (`office_lease_sweep.go:58-60`) và `EventRetention` (`event_retention.go:146-149`). Không thêm gauge lag: `DocumentLagCollector` gắn nhãn cố định `autoversion`/`purge` (`documents_lag.go:107-108`), và lag retention không phải hàng đợi khách thấy.

### 6.4 Không đổi (RETENTION-02)

Không bảng mới, không FK/cascade, không event/catalogue mới, không đổi payload nào, không đổi phân loại gói xuất tenant. Ba câu DELETE mới
(`-- tenant: system`) + hai index (mỗi index một file migration riêng). Không audit mới, nên `audit_coverage_test.go` không đổi.

### 6.5 Câu hỏi cho Advisor / người dùng

| # | Số | Loại | Đề xuất | Dải an toàn | Trạng thái w1 |
|---|---|---|---|---|---|
| Q-RT2-1 | Số ngày giữ hàng `office_jobs` terminal | **sản phẩm** (phần trên sàn) + kỹ thuật (sàn 24h) | **30 ngày** | 7–90 | **chờ người dùng, mặc định 30 ngày** — `officeJobRetention`, đổi một dòng |
| Q-RT2-2 | Số ngày giữ hàng `file_multipart_uploads` đã đóng | **kỹ thuật** | **7 ngày** sau `closed_at` | 2–30 | đã chốt: `multipartRowRetention` |
| Q-RT2-3 | Số ngày giữ `document_break_glass_grants` đã kết thúc | **sản phẩm/ops (tuân thủ)** — bảng nằm trong gói xuất tenant | **30 ngày** | 7–365 | **chờ người dùng, mặc định 30 ngày** — `breakGlassRetention`, đổi một dòng |
| Q-RT2-4 | Chỗ đặt sweeper | kỹ thuật | multipart vào nhịp 10 phút; office_jobs + break-glass vào nhịp `purge` 1 giờ | hoặc gộp cả ba vào `purge` | đã chốt, đã code |
| Q-RT2-5 | Index cho break-glass | kỹ thuật | **chưa thêm** (lượng hàng nhỏ, đọc sống đã có index) | thêm `(expires_at)` + partial `(revoked_at)` nếu quét lộ ra | đã chốt: chưa thêm |
