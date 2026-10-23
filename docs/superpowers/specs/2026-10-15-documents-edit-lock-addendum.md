# Documents — Phụ lục: Một người sửa tại một thời điểm (khóa sửa tài liệu, UNI-1645)

> **Trạng thái:** in-progress — v1.1, ngày 2026-10-15 (v1.1: sửa theo review r1 BE-1..BE-12, FE-1..FE-8, ADV-1) (UNI-1645, C-01, parent UNI-437). Chỉ là hợp đồng và luật; chưa có dòng code nào. Quyết định đã ký: D1, D2, D3 (người dùng 2026-10-15, dòng "UNI-1645 decisions signed" trong `USER-DECISIONS.md` của Run; dòng AskUserQuestion 10:05 bị dòng đã ký thay ở D2 và D3). Mọi chỗ "chọn" bên dưới là quyết định nằm **trong** D1–D3 và có lý do đi kèm; điều không tự quyết được nằm ở mục 14 "Câu hỏi mở".

**Nguồn sự thật:** mô tả issue UNI-1645 (`uniai issue get UNI-1645 --output json`): hành vi 1–7, D1–D3, luồng yêu cầu, edge case 1–15, acceptance. Khi lệch `CLAUDE.md` hoặc ADR, `CLAUDE.md`/ADR thắng.
**Quan hệ:** [Documents C-01](2026-09-08-documents-design.md); [phụ lục mức quyền View/Comment/Edit](2026-10-14-documents-permission-levels-addendum.md) (thang mức dùng ở đây); [spec G5/G6/G7 §4.2, §5.1–5.3](2026-10-02-office-g5-g6-g7-design.md) (mục 10 dưới đây là amendment); [plan G5-G7](../plans/2026-10-12-office-g5-g6-g7.md) thẻ G5-08c, G5-05, G5-09, G5-10, G5-11; [DOC-005 §6.2](../../office/g0/login-sync-contract.md) (offline lease đã ký G5-D1); [EXPERIENCE.md](../../office/g5g6g7/ux/EXPERIENCE.md) (lý do bị chặn, S5, S2, S11).
**Hiện trạng:** mọi `file:line` của repo D đọc ở root `72b53366d` (v1.1 đọc lại ở `af6c9d93d`, các file trích dẫn không đổi giữa hai mốc); dòng của repo fork đọc ở commit nêu kèm (`origin/main` = `4bdba928`). Nhánh G5 của fork đã đi tiếp sau các commit đó (2026-10-15: G5-08c `1e5f8dfe`, G5-09 `f0bd8fa5`, G5-10 `d76cd39a`, G5-11 `45031872`); số dòng là của commit nêu kèm. Thẻ code phải đọc lại dòng trước khi sửa.
**Ngoài phạm vi (parked, người dùng sẽ bàn với đội):** merge 3 ô (của họ / của tôi / kết quả), merge có trợ giúp (daff, WmlComparer), đồng tác giả realtime (UNI-662).

## 0. Hiện trạng cần đổi (ở 72b53366d)

### 0.1 Đường ghi nội dung và mã lỗi hôm nay

| Dữ kiện | Nguồn |
| --- | --- |
| Autosave trang: route `PATCH /documents/{documentID}`, handler gọi `UpdateDocument` rồi `mapServiceError` | `server/internal/handler/router/documents.go:119`; `server/internal/handler/documents.go:192, 210, 218` |
| `UpdateDocument` mở `withDocumentMutationLocked(..., DocumentLevelView, ...)`, đòi Edit cho title/icon/content và Manage cho visibility, so `in.Revision != doc.Revision` → `errRevisionConflict` | `server/internal/service/document_pages.go:545, 598-611, 622-623`; CAS dự phòng `:674-676`; SQL `server/pkg/db/queries/documents.sql:89-115` |
| `errRevisionConflict` = `CodedError{Code:"revision_conflict", Status:422, Err:ErrConflict, Fields:{"current_revision"}}` | `server/internal/service/document_pages.go:95-103` |
| Commit phiên bản file: route `POST /documents/{documentID}/versions/commit`; handler gọi `CommitFileVersion` (có `Sync: middleware.DeviceSession`) | `router/documents.go:138`; `handler/documents.go:293, 307, 313, 316` |
| `CommitFileVersion` kiểm Edit trước (`decideDocumentAccess`) rồi mở `withDocumentMutation(..., DocumentLevelEdit, ...)`; base cũ → `errDocumentVersionConflict` (409, `current_revision`) | `server/internal/service/document_commit.go:232, 272, 341, 398, 406`; hàm lỗi `:82-86`; `contentBaseCurrent` `:94-96` |
| Hàm ghi version file duy nhất: `pointAtNewFileVersion` (gọi từ commit `"upload"` và từ khôi phục `"restore"`) | `document_commit.go:613, 460, 568` |
| Cổng ghi chung: `withDocumentMutation` / `withDocumentMutationLocked` khóa hàng `documents` bằng `LockDocumentByID` (`FOR UPDATE`), tính lại mức trong transaction rồi chạy `fn` | `server/internal/service/document_permissions.go:429, 446, 464, 474-481`; SQL `server/pkg/db/queries/document_access.sql:18-23` (`-- tenant: by-id`) |
| `mapServiceError` trả `CodedError` bằng `respondErrorFields(status, code, msg, fields)` | `server/internal/handler/auth.go:146, 153-154` |
| Lớp lỗi: `revision_conflict` và `document_version_conflict` thuộc `"conflict"`; metric lưu đếm hai mã này là xung đột | `server/internal/handler/dto/sdo/error_class.go:14-15`; `server/internal/service/document_metrics.go:47-48` |
| **Chưa có 423 / `http.StatusLocked` ở bất kỳ đâu** trong server | (tìm toàn bộ `server/`, không có kết quả) |
| Khôi phục phiên bản: route `POST /documents/{documentID}/versions/{versionNo}/restore`; trang: `withDocumentMutation` Edit; file: `RestoreFileVersion` | `router/documents.go:179`; `handler/documents.go:429`; `service/document_versions.go:323, 341, 367, 422, 459`; `document_commit.go:500, 523, 536` |
| Đổi tên = `PATCH` `title` (không route riêng); di chuyển `POST …/move` kiểm Edit, **không** qua `withDocumentMutation`; lưu trữ/khôi phục khỏi thùng rác `POST …/archive` / `…/restore` (Manage, transaction riêng) | `router/documents.go:119, 473, 481, 497`; `service/document_tree.go:55, 121`; `service/document_lifecycle.go:139, 203, 398, 652` |
| Tạo phiên bản thủ công của trang (chụp nội dung hiện tại, không đổi nội dung) | `router/documents.go:163`; `service/document_versions.go:54, 60` |

### 0.2 Office frame (web) và app desktop

| Dữ kiện | Nguồn |
| --- | --- |
| Frame lưu qua route riêng dùng frame token: `POST /office-frame/documents/{documentID}/uploads` rồi `…/versions/commit`; handler commit gọi cùng `CommitFileVersion` | `server/internal/handler/router/office_frame.go:74, 79`; `server/internal/handler/office_frame.go:203, 215, 230` |
| `OfficeFrameService.Authorize` chỉ kiểm view/module/workspace; Edit kiểm trong `CommitFileVersion`. **Frame token không mang `sid`** (claim `v,d,w,o,u,e,n,m`) | `server/internal/service/office_frame.go:209`; claim `:49-60`; `Mint` chỉ cho người `:136-138` |
| `server/internal/office/` chỉ là client engine (`client.go`, `contract.go`, `errors.go`, `grant.go`, `negotiate.go`), không có logic lưu | thư mục đó |
| Phía host web: `docs-frame-api.ts` gửi `writable: doc.can_edit`, `save` = `client.upload` rồi `client.commit({upload_id, base_revision})`; 409 trả về frame thành `{ok:false}` | `packages/core/office/docs-frame-api.ts:124-125, 224-248` (commit `:240`, 409 `:245`); endpoint `packages/core/api/endpoints/office-frame.ts:239, 243` |
| Phiên frame: `viewOnly = options.readonly || (module !== "docs" && can_edit === false)`; host tự từ chối `api.save` khi chỉ đọc (`throw readOnly(type)` = `forbidden` 403); host gửi `save` với `timeoutMs: 0` | `packages/views/office/frame/use-docs-frame-session.ts:57, 144, 239, 264-279, 450-472`; `docs-frame-session-model.ts:185-209` |
| Protocol host↔frame (bản vendor từ fork, "Do not edit here"): `FileMeta.writable`; sự kiện host→frame `doc.blocked {document_id, reason}` — **một chiều**: frame giữ nội dung chỉ đọc và từ chối mọi Save; lý do lạ đọc thành `permission_revoked`; `DocBlockedReason` = `permission_revoked | document_deleted | organization_suspended | member_deactivated | document_archived` | `packages/core/office/docs-frame-protocol.ts:1-6, 346-347, 678-697, 1176-1191`; fork `origin/main:web/docs/protocol/types.ts:672-677, 1169`, README `:55, 107-113, 260-269` |
| Frame web (fork) có hộp thoại xung đột với bước "tải bản của tôi" (`download`/`discard`/`back`) | fork `origin/main:web/modules/shared/conflict-dialog.ts:95-101, 242-243, 424-448` |
| Host web gắn frame: `readonly` và `my_level` truyền vào `OfficeModuleFrame` | `apps/web/platform/office-frame/module-frame-host.tsx:17-22, 39, 42`; `document-host.tsx:57-63` |
| App desktop commit qua route bearer `POST /documents/{documentID}/versions/commit` (sid = phiên thiết bị) | `handler/documents.go:313` (`middleware.DeviceSession`) |
| App desktop đã có khóa **cục bộ** một cửa sổ sửa mỗi tài liệu (`DocLock`, file lease `<scopeDir>/doc-locks/…`, kết quả `held | other_window`) | fork `origin/main:apps/shell/src/main/uniwork-sync/doc-lock.ts:8-25, 34`; `queue/dispatcher.ts:34, 127` |

### 0.3 Agent (ADR 0010)

| Dữ kiện | Nguồn |
| --- | --- |
| Chưa có code proposal/executor ("runs, proposals and the executor are A-01") | `server/internal/service/agent.go:19` |
| Agent bị chặn ở mức tối đa `view` trên tài liệu ("writes go through proposals, ADR 0010"); tạo trang, tạo file, lệnh Office đều chỉ cho người | `service/document_permissions.go:119-127`; `document_pages.go:140-142`; `document_files.go:311`; `document_office.go:185-188` |
| Công cụ ghi duy nhất là công cụ của editor Office (UniWork AI, G6); bị rút khi người dùng thiếu Edit; kết quả được **người dùng** lưu qua `versions/commit` của frame | `server/internal/ai/openai_facade.go:707, 822-831`; `service/ai_uniwork.go:290, 406`; registry `internal/ai/tools.go:10-18` |

### 0.4 Realtime, query key và client

| Dữ kiện | Nguồn |
| --- | --- |
| Catalogue sự kiện ba nơi; hàng `document.*` Scope workspace, payload chỉ id | `docs/events/CATALOGUE.md:67, 146-166`; `server/internal/outbox/catalogue.go:57-71, 250-286`; `packages/core/types/events.ts:7-11, 56-76, 183-186` |
| Catalogue **không có cột lane**; lane chọn lúc đăng ký consumer | `server/cmd/server/main.go:470, 493`; `server/internal/outbox/lane.go:32-43` |
| Client: `documentFrameKeys` ánh xạ `document.*` → invalidation (`created/updated/version_created/…` → `documentKeys.workspace(wsId)`) | `packages/core/realtime/document-events.ts:10, 17-63`; gọi ở `packages/core/realtime/use-realtime-sync.ts:117-121` |
| Frame theo dõi `HEAD_EVENTS` để báo có bản mới | `packages/views/office/frame/use-frame-remote-source.ts:22` |
| Factory `documentKeys` | `packages/core/documents/keys.ts:15-87` (`workspace :17`, `detail :18`, `list :29`, `tree :41`) |
| Autosave trang: `useDocumentSave` + `createDocumentPatchTransport`; máy trạng thái có pha `conflict`; phân lớp lỗi theo mã | `packages/core/documents/hooks.ts:185-235`; `save-state.ts:23-37, 314-316, 332`; `errors.ts:12-13, 80, 101` |
| Màn tài liệu: `canEdit = my_level === "edit" || "manage"`, chip "Chỉ xem", `Notice` chỉ đọc, editor/header/file view theo `canEdit`; hộp thoại xung đột | `packages/views/documents/document-workspace.tsx:100, 107, 156-158, 483-504, 522, 545, 561, 566-585`; `conflict-dialog.tsx:81`; `document-editor.tsx:65, 207-217` |
| Hàng thư viện: dòng tiêu đề có `Badge` (lưu trữ) và cột "người sửa" có avatar chữ cái | `packages/views/documents/documents-library-row.tsx:213-221, 251-262` |
| Đăng xuất web: `logout` → `clearSession()` (`endDraftSession`, `onLogout`) → `POST /api/v1/auth/logout` | `packages/core/auth/store.ts:52-64, 105-108`; `packages/core/api/endpoints/auth.ts:196-197` |

### 0.5 Quyền, phiên, vòng đời thành viên

| Dữ kiện | Nguồn |
| --- | --- |
| Thang mức trong code hôm nay: `view < edit < manage`; phụ lục 2026-10-14 thêm `comment` (rank 2, thẻ code e6-server/g5g8-web_ux chưa merge) | `service/document_types.go:56-80`; `packages/core/permissions/rules.ts:466-477`; [phụ lục mức quyền §1](2026-10-14-documents-permission-levels-addendum.md) |
| Workspace owner/admin và ACL owner = `manage`; thành viên với tài liệu workspace-visible = `edit` | `service/document_permissions.go:134-143` |
| Cổng đọc trả `ErrNotFound` khi `Level == none` (không lộ tồn tại) | `document_permissions.go:290-301` |
| Phiên: `sid` của bearer có trong context (`middleware.SessionID`) | `server/internal/middleware/auth.go:56, 159-161` |
| Đăng xuất / thu hồi phiên phát `session.revoked {user_id, session_id}` (`session_id` rỗng = mọi phiên) | `service/auth.go:225-240`; `service/sessions.go:17, 32-34, 37`; `service/desktop_auth.go:550, 614, 702, 712`; catalogue `outbox/catalogue.go:147` |
| Vô hiệu hóa / rời tổ chức / gỡ khỏi workspace / tạm ngưng tổ chức phát `member.deactivated` / `member.left` / `member.removed` / `organization.suspended` | `service/organization_members.go:206, 278, 372, 462`; `service/workspace.go:468, 519`; `service/admin.go:179, 213` |
| Mẫu consumer thu hồi theo các sự kiện đó (lane notify): `OfficeLeaseRevoker` | `service/office_lease_consumer.go:41-96`; đăng ký `cmd/server/main.go:470` |
| Bảng lease offline (mẫu bảng + index) đã có: `office_offline_leases`, index `CONCURRENTLY` mỗi file một câu | `server/migrations/9991791865920564_office_offline_leases.up.sql:13-44`; `…565`–`…570` |
| Rate limit theo danh tính, một ngân sách mỗi người mỗi nhóm | `server/internal/middleware/ratelimit.go:96, 109`; ví dụ `router/router.go:191, 251` |
| Mẫu cấu hình thời lượng có mặc định | `server/internal/config/config.go:33, 260, 404` |
| Thông báo Inbox: consumer lane notify đọc map `rules` topic → rule; kind + title + mặc định push; rule tài liệu lọc người nhận bằng cổng `DocumentReadChecker.FilterDocumentReaders` (consumer chỉ nối cổng đó qua `SetDocumentReaders`) | `server/internal/notification/rules.go:89-109, 513-546`; cổng `rules.go:37-40`, gọi `:456, :531`; `consumer.go:55`; `kinds.go:31-55`; `titles.go:25-82`; `prefs.go:19-24`; `cmd/server/main.go:442, 493` |
| Metric tài liệu: `metrics.Documents` (struct, `NewDocuments`, `Collectors` mà registry đăng ký); port `service.DocumentMetrics` + `nopDocumentMetrics`; `documentSaveResult` rơi mọi `CodedError` lạ có `Err: ErrConflict` vào outcome `conflict` | `server/internal/metrics/documents.go:19-29, 31, 72`; `server/internal/service/document_metrics.go:31-38, 56-74, 86-120` (`ErrConflict` `:115-116`) |
| Config: `parseDuration` rơi về mặc định khi sai (không báo); `parseOptionalDuration` + khối kiểm trong `Load` làm `Load` thất bại | `server/internal/config/config.go:404-413`; `:418-427`; mẫu `OFFICE_CHANGE_SNAPSHOT_TTL` `:240-247` |
| Fork desktop: không có client realtime theo người dùng; `office_lease.revoked` (scope user) đã có trong catalogue và `LeaseManager` đã có điểm vào nhưng chưa ai gọi | `server/internal/outbox/catalogue.go:295`; fork `1e5f8dfe:apps/shell/src/main/uniwork-sync/lease/manager.ts:172-177` ("the desktop has no client for", R1BE-5), `handleFeedRevoked` `:767`, `onRevoked` `:270`; feed tài liệu chỉ mang thay đổi tài liệu (`apps/shell/src/main/uniwork-sync/feed/`) |

## 1. Mô hình khóa

### 1.1 Luật (hành vi 1–7, D1–D3)

1. **Khóa sửa** (`edit lock`): mở tài liệu ở chế độ sửa (editor trang web, Office frame web, app desktop) lấy một khóa độc quyền cho **một phiên editor** (user + phiên đăng nhập + `editor_id` do client sinh mỗi lần mở editor). Editor gửi heartbeat mỗi 30 s; TTL 2 phút; **không có idle timeout** (D2): khóa sống chừng nào editor còn mở và còn heartbeat. Đóng editor → nhả; crash → hết TTL.
2. **Người khác mở chỉ đọc**, thấy banner người giữ. Khi khóa được nhả/hết hạn, banner đổi sang "Sửa ngay" không cần tải lại trang.
3. **Lấy quyền sửa** (D3): người mức `manage` lấy khóa trực tiếp sau một hộp xác nhận; editor cũ thành chỉ đọc; thay đổi chưa lưu của họ đi đường "Tải bản của tôi / Tải lại", không bao giờ bị bỏ âm thầm; ghi audit.
4. **Yêu cầu quyền sửa** (D3): người mức `edit` chỉ gửi yêu cầu; người giữ chấp nhận hoặc lờ đi/từ chối; `edit` không bao giờ ép được.
5. **Server cưỡng chế**: lệnh ghi nội dung từ người không giữ khóa sống bị từ chối `423 document_locked` (mục 3.3). Kiểm revision giữ nguyên.
6. **Agent** không bao giờ giữ, lấy hoặc yêu cầu khóa; ghi của agent bị từ chối như trên khi có khóa sống (mục 1.5).
7. **Offline** (D1): desktop offline mặc định **chỉ đọc**; người giữ khóa có thể bật thủ công "Giữ quyền sửa khi offline" (tối đa 8 h mỗi lần, chuỗi gia hạn có trần); manager lấy lại được.

Mức quyền dùng bộ của [phụ lục mức quyền](2026-10-14-documents-permission-levels-addendum.md): `view` 1 < `comment` 2 < `edit` 3 < `manage` 4. Người `comment` như `view` với khóa (chỉ đọc nội dung, không yêu cầu được). Nếu thẻ khóa merge trước thẻ mức quyền, so bằng `AtLeast(DocumentLevelEdit)` / `AtLeast(DocumentLevelManage)` thì không phải sửa khi `comment` vào.

### 1.2 Bảng `document_edit_locks`

Chọn **một hàng cho mỗi nhiệm kỳ giữ khóa**, giữ hàng đã kết thúc 7 ngày (như lease, `office_offline_leases` hàng 18 của DOC-005 §6.2.1) để heartbeat/lần lưu muộn biết **vì sao** mất khóa (bị lấy, nhường, hết hạn, mất quyền) — cần cho edge 2 và 6. Lịch sử lâu dài ở `audit_events`.

```sql
-- Document edit lock (UNI-1645): one row per tenure of the one editor of a
-- document. The live tenure is the row with ended_at IS NULL; it is live
-- while now() < expires_at (heartbeat TTL) or now() < offline_hold_until.
-- No FK (ADR 0001); state lives here, never in memory (edge 14).
CREATE TABLE document_edit_locks (
  id                      TEXT PRIMARY KEY,           -- ULID, util.NewID()
  organization_id         TEXT NOT NULL,
  document_id             TEXT NOT NULL,
  user_id                 TEXT NOT NULL,              -- holder; always a human (edge 15)
  session_id              TEXT NOT NULL DEFAULT '',   -- bearer sid at claim; '' while reserved by a handover
  editor_id               TEXT NOT NULL DEFAULT '',   -- client-minted ULID of one editor instance; '' while reserved
  client                  TEXT NOT NULL DEFAULT '',   -- 'web_page' | 'web_office' | 'desktop' | '' (reserved)
  base_revision           BIGINT NOT NULL,            -- documents.revision when the tenure started
  acquired_at             TIMESTAMPTZ NOT NULL,
  heartbeat_at            TIMESTAMPTZ NOT NULL,
  expires_at              TIMESTAMPTZ NOT NULL,       -- heartbeat_at + TTL (server clock)
  offline_hold_until      TIMESTAMPTZ,                -- D1 manual hold; NULL = none
  hold_device_session_id  TEXT,                       -- device_sessions.id the hold is bound to
  hold_chain_started_at   TIMESTAMPTZ,                -- first hold of this tenure (renew cap)
  hold_renewals           INTEGER NOT NULL DEFAULT 0,
  granted_via             TEXT NOT NULL,              -- 'acquire' | 'take_over' | 'handover' | 'move_here'
  previous_lock_id        TEXT,                       -- the tenure this one replaced (take-over, handover, move here)
  ended_at                TIMESTAMPTZ,
  end_reason              TEXT,
  ended_by                TEXT,                       -- user id of the human who ended it; NULL for system
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_edit_locks_client_check
    CHECK (client IN ('web_page', 'web_office', 'desktop', '')),
  CONSTRAINT document_edit_locks_granted_via_check
    CHECK (granted_via IN ('acquire', 'take_over', 'handover', 'move_here')),
  CONSTRAINT document_edit_locks_end_reason_check
    CHECK (end_reason IS NULL OR end_reason IN (
      'released', 'expired', 'taken_over', 'handed_over', 'moved_here',
      'session_revoked', 'access_lost', 'member_deactivated', 'organization_suspended',
      'document_archived', 'document_deleted', 'document_shelved'))
);
```

Quyết định cột:
- **Không có `holder_kind`**, **không có `created_by`**: chỉ người giữ khóa (edge 15); route lấy khóa từ chối actor không phải `human` trước mọi truy vấn (như `OfficeFrameService.Mint` `office_frame.go:136-138`). Không có `created_by` nên luật cặp `created_by_kind` (ADR 0007, `TestActorKindOnEveryCreatedBy`) không áp; người kết thúc nhiệm kỳ ghi ở `ended_by` (luôn là người hoặc NULL = hệ thống) và ở audit với `actor_kind`.
- **Không có `workspace_id`**: tài liệu đổi workspace khi move; workspace của sự kiện đọc từ `documents` lúc phát. Bảng chỉ cần `organization_id` (ADR 0008). Truy vấn ràng buộc bằng `organization_id = $n`.
- `session_id` + `editor_id`: hai tab cùng trình duyệt dùng chung `sid`, nên `editor_id` mới phân biệt được (edge 9). `session_id` lấy từ `middleware.SessionID` của bearer, **không** từ body; dùng để nhả khi đăng xuất/thu hồi phiên (edge 10). Frame token không mang `sid` (mục 0.2), nên khóa của Office frame web được lấy bằng route bearer của host (mục 3.1), không bằng frame token.
- `base_revision`: phục vụ edge 1 ("lấy lại khóa nếu base không đổi").

### 1.3 Bảng `document_edit_requests`

```sql
-- Edit requests (UNI-1645, D3): a member at edit asks the holder for the
-- lock. One pending request per requester per document; it expires.
CREATE TABLE document_edit_requests (
  id               TEXT PRIMARY KEY,                  -- ULID
  organization_id  TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  lock_id          TEXT NOT NULL,                     -- the tenure the request was made to
  requester_id     TEXT NOT NULL,                     -- always a human (edge 15)
  holder_id        TEXT NOT NULL,                     -- holder of lock_id at request time
  status           TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  answered_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_edit_requests_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'superseded', 'expired'))
);
```

`expired` là trạng thái đọc ra khi `status = 'pending' AND expires_at <= now()`; worker dọn (mục 3.5) ghi lại thành `expired` để chỉ mục duy nhất giải phóng chỗ. Worker không phải đường duy nhất: R8 tự đóng hàng cũ quá hạn của chính người yêu cầu trước khi chèn (mục 3.1, R8), nên khoảng ≤ 30 s trước lần quét không bao giờ trả `23505`. Hàng giữ 7 ngày rồi xóa (lịch sử ở audit).

### 1.4 Migration (mỗi index `CONCURRENTLY` một file một câu)

Thẻ (a) đặt `<ms>` bằng mốc ms lúc viết, tăng dần, cùng mẫu `9991791865920564…570` của lease (`TestMigrationPrefixesSortTheSameAsStringsAndNumbers`):

| File `.up.sql` | Nội dung |
| --- | --- |
| `999<ms>_document_edit_locks` | `CREATE TABLE document_edit_locks` (1.2) và `CREATE TABLE document_edit_requests` (1.3) |
| `999<ms+1>_document_edit_locks_live_doc_uidx` | `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_document_edit_locks_live_doc ON document_edit_locks (document_id) WHERE ended_at IS NULL;` |
| `999<ms+2>_document_edit_locks_session_idx` | `… idx_document_edit_locks_session ON document_edit_locks (user_id, session_id) WHERE ended_at IS NULL;` (đăng xuất, edge 10) |
| `999<ms+3>_document_edit_locks_org_user_idx` | `… idx_document_edit_locks_org_user ON document_edit_locks (organization_id, user_id) WHERE ended_at IS NULL;` (vô hiệu hóa, gỡ khỏi workspace) |
| `999<ms+4>_document_edit_locks_expires_idx` | `… idx_document_edit_locks_expires ON document_edit_locks (expires_at) WHERE ended_at IS NULL;` (worker hết hạn) |
| `999<ms+5>_document_edit_locks_ended_idx` | `… idx_document_edit_locks_ended ON document_edit_locks (ended_at) WHERE ended_at IS NOT NULL;` (dọn 7 ngày) |
| `999<ms+6>_document_edit_requests_pending_uidx` | `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_document_edit_requests_pending ON document_edit_requests (document_id, requester_id) WHERE status = 'pending';` |
| `999<ms+7>_document_edit_requests_lock_idx` | `… idx_document_edit_requests_lock ON document_edit_requests (lock_id) WHERE status = 'pending';` (danh sách cho người giữ; superseded khi nhiệm kỳ kết thúc) |
| `999<ms+8>_document_edit_requests_rate_idx` | `… idx_document_edit_requests_rate ON document_edit_requests (organization_id, requester_id, document_id, created_at);` (đếm rate limit, dọn) |

Mỗi file có `.down.sql` (`DROP INDEX CONCURRENTLY IF EXISTS …` / `DROP TABLE …`). Không FK, không cascade (`server/migrations/lint_test.go`). Hai bảng có `organization_id TEXT NOT NULL` ngay migration đầu (`TestNewTablesCarryOrganizationID`, `TestTenantColumnIsNotNull`).

### 1.5 Tuần tự hóa (edge 12) và trạng thái ở DB (edge 14)

- Mọi lệnh đổi chủ khóa (lấy, lấy quyền, chấp nhận yêu cầu, sửa ở đây, nhả, giữ offline, worker hết hạn) **và** mọi lệnh ghi nội dung chạy trong một transaction mở bằng `LockDocumentByID` (`FOR UPDATE` trên hàng `documents`, `document_permissions.go:464`). Hàng tài liệu là mutex của tài liệu: hai lệnh cùng tài liệu chạy tuần tự; lệnh sau đọc thấy kết quả lệnh trước. Ghi nội dung đã đi qua cổng này (`withDocumentMutation*`), nên kiểm khóa trong cùng `fn` không có cửa sổ TOCTOU.
- Trong transaction: `SELECT … FROM document_edit_locks WHERE organization_id = $1 AND document_id = $2 AND ended_at IS NULL FOR UPDATE` (query `LockLiveDocumentEditLock`). Nếu hàng đó không còn sống (`expires_at <= now()` và hold `NULL`/`<= now()`), lệnh kết thúc nó (`end_reason='expired'`, audit + outbox như worker) rồi mới chèn nhiệm kỳ mới.
- Chỉ mục duy nhất từng phần `idx_document_edit_locks_live_doc` là lớp chặn thứ hai: một đường nào đó quên khóa hàng tài liệu vẫn không tạo được hai nhiệm kỳ sống; vi phạm `23505` dịch thành `423 document_locked` sau khi đọc lại người thắng.
- Heartbeat **không** khóa hàng tài liệu (30 s × mọi editor): `UPDATE document_edit_locks SET heartbeat_at = now(), expires_at = now() + $ttl WHERE id = $1 AND organization_id = $2 AND user_id = $3 AND ended_at IS NULL AND (expires_at > now() OR offline_hold_until > now()) RETURNING …`. Đua với lấy quyền: lấy quyền đặt `ended_at` dưới khóa hàng; heartbeat sau đó cập nhật 0 hàng → trả `edit_lock_lost`. Heartbeat tới muộn sau khi hết hạn cũng 0 hàng (không hồi sinh) → client gọi lại "lấy khóa" (mục 9, edge 13).
- Giờ luôn là `now()` của Postgres; server không đọc giờ client.
- Trạng thái chỉ ở bảng; khởi động lại hoặc deploy không nhả khóa (edge 14). Ngừng dịch vụ lâu hơn TTL làm heartbeat thất bại; editor đi đường edge 13 (lấy lại nếu còn trống và base không đổi).

### 1.6 Agent (hành vi 5, edge 15)

- Route lấy khóa, lấy quyền, yêu cầu, trả lời, giữ offline từ chối actor `agent`/`system` (`ErrNotFound`, cùng cách `Mint`). Agent không có hàng khóa nào.
- Lệnh ghi nội dung với actor `agent` (executor của ADR 0010 khi A-01 tới; hôm nay agent bị chặn ở `view`, `document_permissions.go:119-127`) bị `423 document_locked` **bất cứ khi nào có khóa sống**, bất kể ai giữ; không có khóa sống thì chạy tiếp (kiểm revision giữ nguyên). Executor không bao giờ lấy hoặc yêu cầu khóa thay người (edge 15).
- Công cụ AI trong editor Office (G6) chạy trong editor của người dùng và được người dùng lưu qua `versions/commit` của frame: chúng đi dưới khóa của người đó, không cần luật riêng.

## 2. Hành vi ghi: route nào cần khóa (edge 11)

Một lệnh ghi bị kiểm khóa khi nó đổi **nội dung** tài liệu. Luật kiểm (trong `fn` của `withDocumentMutation*`, sau kiểm mức, trước kiểm revision):

1. Không có nhiệm kỳ sống → cho qua (actor người hoặc agent). Lý do: tab cũ trong lúc rollout và lệnh không đến từ editor (job Office, tải bản mới) vẫn chạy; kiểm revision vẫn chặn ghi đè.
2. Có nhiệm kỳ sống, actor là người, `edit_lock_id` trong body = `id` của nhiệm kỳ sống **và** `user_id` của nhiệm kỳ = actor → cho qua (cập nhật luôn `heartbeat_at`/`expires_at`, như một heartbeat).
3. Còn lại → `423 document_locked`. Cùng người nhưng khác `edit_lock_id` (tab/thiết bị khác, edge 9) cũng 423, với `fields.held_by_me = true`.

| Route | Cần khóa | Ghi chú |
| --- | --- | --- |
| `PATCH /documents/{documentID}` có `content` | **Có** | autosave trang; body thêm `edit_lock_id` |
| `PATCH /documents/{documentID}` chỉ `title`/`icon` (đổi tên) | Không | chọn: đổi tên không đụng nội dung; editor của người giữ không bị phá vì revision tăng → client của người giữ đã xử lý `document.updated`. Hệ quả: người giữ có thể nhận 422 `revision_conflict` ở lần autosave kế nếu tên đổi giữa chừng — giữ đúng như hôm nay (mục 3.3) |
| `PATCH /documents/{documentID}` `visibility` | Không | việc quản trị |
| `POST /documents/{documentID}/versions/commit` (bearer: desktop, tải bản mới, job Office) | **Có** | body thêm `edit_lock_id` |
| `POST /office-frame/documents/{documentID}/versions/commit` (frame token) | **Có** | host thêm `edit_lock_id` vào body (`docs-frame-api.ts:240`); khóa được lấy bằng route bearer của host; 423 ở đây **không** đi đường 409 của frame (mục 11.1, "423 khi frame Lưu") |
| `POST /office-frame/documents/{documentID}/uploads`, upload staging | Không | chưa đổi tài liệu |
| `POST /documents/{documentID}/versions/{versionNo}/restore` | **Có** | edge 11: khôi phục thay nội dung; người khác giữ khóa → 423 |
| `POST /documents/{documentID}/versions` (tạo phiên bản thủ công) | Không | chỉ chụp nội dung hiện có |
| `POST /documents/{documentID}/move` | Không | edge 11: không đụng nội dung; sang workspace khác thì người giữ được kiểm lại quyền (mục 3.5) |
| `POST /documents/{documentID}/archive` | Không cần, **nhả** khóa | edge 4: lưu trữ (thùng rác) nhả khóa trong cùng transaction (`end_reason='document_archived'`) |
| `POST /documents/{documentID}/shelve` | Không cần, **nhả** khóa | edge 4: lưu trữ thật (ARCHIVE-01) nhả khóa trong cùng transaction (`end_reason='document_shelved'`) |
| Bình luận, chia sẻ, liên kết, yêu thích | Không | không phải nội dung |

## 3. Route, SDI/SDO, mã lỗi

### 3.1 Route mới

Tất cả đăng ký qua wrapper `api` trong `server/internal/handler/router/documents.go` (khối tài liệu), SDI ở `server/internal/handler/dto/sdi/document_edit_lock.go`, SDO ở `server/internal/handler/dto/sdo/document_edit_lock.go`. Hai tên tham số đường dẫn mới cần case `pathParamSDI` trong `server/internal/handler/router/openapi.go:107` (cạnh `documentID,shareID` `:472`): **`documentID,lockID`** và **`documentID,requestID`**.

| # | Method + path | Mức cần | SDI | SDO | Mã |
| --- | --- | --- | --- | --- | --- |
| R1 | `GET /api/v1/documents/{documentID}/edit-lock` | view | — | `DocumentEditLockStateSDO` | 200; 404 không đọc được. **Chỉ đọc**: nhiệm kỳ quá hạn đọc ra `lock: null` nhưng R1 không kết thúc nó (việc đó của worker / lệnh đổi chủ kế tiếp, mục 1.5) — một GET không bao giờ ghi audit/outbox |
| R2 | `POST /api/v1/documents/{documentID}/edit-lock` (lấy / nhận khóa được nhường / "Sửa ở đây") | edit | `AcquireDocumentEditLockSDI {editor_id, client, move_from_self?: bool}` | `DocumentEditLockSDO` | 201 tạo; 200 khi nhiệm kỳ sống có **cùng `user_id` = actor và cùng `editor_id`** (idempotent; `session_id` không so — nó chỉ dùng để nhả khi đăng xuất), hoặc nhận khóa được nhường; cùng `editor_id` nhưng khác `user_id` → 423 như mọi người khác (BE-8); 423 `document_locked`; 403 `forbidden` (< edit); 404 |
| R3 | `POST /api/v1/documents/{documentID}/edit-lock/{lockID}/heartbeat` | edit (tính lại mỗi lần, edge 3) | — | `DocumentEditHeartbeatSDO` | 200; 409 `edit_lock_lost` (`fields.reason`, `fields.by_id`, `fields.by_name`) — cả khi nhiệm kỳ `{lockID}` thuộc người khác hoặc đã kết thúc; 404 khi `{lockID}` không phải nhiệm kỳ của `{documentID}` trong tổ chức của tài liệu; 403/404 của cổng tài liệu → nhiệm kỳ kết thúc `access_lost` |
| R4 | `DELETE /api/v1/documents/{documentID}/edit-lock/{lockID}` (nhả) | view | — | — | 204 (idempotent: đã kết thúc cũng 204); 404 khi `{lockID}` không thuộc `{documentID}` hoặc `user_id` của nó ≠ actor (không phân biệt hai trường hợp) |
| R5 | `POST /api/v1/documents/{documentID}/edit-lock/take-over` ("Lấy quyền sửa") | manage | `TakeOverDocumentEditLockSDI {editor_id, client, expected_lock_id}` | `DocumentEditLockSDO` | 201; 409 `edit_lock_changed` (nhiệm kỳ sống ≠ `expected_lock_id`: hộp xác nhận đã cũ — client đọc lại R1; `expected_lock_id` của tài liệu/tổ chức khác cũng chỉ là "khác"); 409 `edit_lock_free` (không có ai giữ → dùng R2); 409 `edit_lock_held_by_me` (người gọi đang giữ → dùng R2 `move_from_self`); 403 |
| R6 | `PUT /api/v1/documents/{documentID}/edit-lock/{lockID}/offline-hold` (bắt đầu / gia hạn, D1) | edit | `PutDocumentEditHoldSDI {}` | `DocumentEditLockSDO` | 200; 403 `edit_hold_device_required` (phiên web hoặc `sid` không có hàng `device_sessions` sống, như `offline_lease_device_required`); 409 `edit_hold_cap_reached`; 409 `edit_lock_lost`; 404 như R4 |
| R7 | `DELETE /api/v1/documents/{documentID}/edit-lock/{lockID}/offline-hold` (bỏ giữ, quay về TTL) | edit | — | `DocumentEditLockSDO` | 200 (idempotent: không có hold cũng 200); 409 `edit_lock_lost`; 404 như R4 |
| R8 | `POST /api/v1/documents/{documentID}/edit-requests` ("Yêu cầu quyền sửa") | edit | `CreateDocumentEditRequestSDI {}` | `DocumentEditRequestSDO` | 201; 200 đã có yêu cầu đang chờ **còn hạn** (idempotent, trả hàng cũ); 409 `edit_lock_free`; 409 `edit_request_to_self` (người gọi đang giữ); 429 `edit_request_rate_limited`. Trong transaction (sau `LockDocumentByID`): hàng `pending` của chính (`document_id`, `requester_id`) đã quá `expires_at` được ghi `expired` trước rồi mới chèn (BE-5), nên chỉ mục `idx_document_edit_requests_pending` không bao giờ trả `23505` ở khoảng trước lần quét |
| R9 | `POST /api/v1/documents/{documentID}/edit-requests/{requestID}/answer` | edit + `holder_id` của yêu cầu = actor | `AnswerDocumentEditRequestSDI {decision: "accept" \| "decline", lock_id}` | `DocumentEditRequestSDO` | 200; thứ tự kiểm: 404 khi `{requestID}` không thuộc `{documentID}` hoặc `holder_id` ≠ actor → 409 `edit_lock_changed` khi `lock_id` ≠ `lock_id` của yêu cầu (gồm id của tài liệu/tổ chức khác) → 409 `edit_request_closed` (đã trả lời/hủy/superseded) → 410 `edit_request_expired` → 409 `edit_lock_lost` (người trả lời không còn giữ nhiệm kỳ đó) |
| R10 | `DELETE /api/v1/documents/{documentID}/edit-requests/{requestID}` (người yêu cầu hủy) | view | — | — | 204 (idempotent, cả khi đã trả lời/hết hạn); 404 khi `{requestID}` không thuộc `{documentID}` hoặc `requester_id` ≠ actor |

Chọn thiết kế:
- Trạng thái khóa nằm ở **route riêng R1**, không nhúng vào chi tiết tài liệu: refetch chi tiết kéo theo nội dung, còn banner cần tươi ở mỗi `document.lock_changed`. Hàng danh sách mang tóm tắt `edit_lock` (mục 3.2) để hiện avatar.
- `lock_id` là "chìa" của người giữ: chỉ trả trong `DocumentEditLockSDO` của chính người giữ; R1 và 423 trả cho người khác **không** có `lock_id`.
- R2 với `move_from_self=true` (edge 9, "Sửa ở đây"): chỉ hợp lệ khi người giữ là chính actor; kết thúc nhiệm kỳ cũ `moved_here`, tạo nhiệm kỳ `granted_via='move_here'`; không phải lấy quyền của manager, không audit lấy quyền.
- R2 nhận khóa được nhường: sau R9 accept, server tạo nhiệm kỳ **dự trữ** cho người yêu cầu (`session_id=''`, `editor_id=''`, `granted_via='handover'`, `expires_at = now + TTL`); editor của người đó gọi R2 và nhận nó (điền `session_id`, `editor_id`). Không nhận trong TTL → hết hạn như thường.
- Đếm tần suất: R8 đứng sau `mw.RateLimitByIdentityBucket(d.Redis, "document-edit-request", 20, time.Minute, proxies, bearerUser(d.Minter))` (`ratelimit.go:109`, mẫu `router.go:191`) **và** trần trong DB không phụ thuộc Redis (limiter fail-open): tối đa `DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR` (5) yêu cầu mỗi người yêu cầu mỗi tài liệu mỗi giờ (đếm theo `idx_document_edit_requests_rate`), vượt → 429 `edit_request_rate_limited` với `fields.retry_after_s`.

### 3.2 SDO

```text
DocumentEditLockSDO            // chỉ cho người giữ
  lock_id, document_id, holder_id, client, acquired_at, expires_at,
  offline_hold_until?, hold_max_until?, granted_via,
  heartbeat_interval_ms, ttl_ms, server_time

DocumentEditLockSummarySDO     // R1 và hàng danh sách; không có lock_id
  holder_id, holder_name, holder_avatar_url?, since (acquired_at),
  expires_at, offline_hold_until?, reserved (bool: đang chờ người được nhường nhận),
  held_by_me (bool: cùng người gọi, có thể ở tab/thiết bị khác)

DocumentEditLockStateSDO       // R1
  lock: DocumentEditLockSummarySDO | null
  my_request: DocumentEditRequestSDO | null      // yêu cầu đang chờ của người gọi
  pending_requests: DocumentEditRequestSDO[]     // chỉ khi người gọi là người giữ
  can_take_over (bool: my_level >= manage và có lock)
  can_request (bool: my_level >= edit, không giữ, không có my_request)
  server_time

DocumentEditHeartbeatSDO        lock_id, expires_at, offline_hold_until?, server_time
DocumentEditRequestSDO          request_id, document_id, requester_id, requester_name,
                                holder_id, status, created_at, expires_at, answered_at?
```

Hàng danh sách/cây/tìm kiếm/gần đây/được chia sẻ (SDO hàng thư viện ở `dto/sdo/document.go`; **không** gồm danh sách yêu thích org-scoped — chọn: avatar người giữ không cần ở đó, đỡ một đường invalidation) thêm trường tùy chọn `edit_lock: DocumentEditLockSummarySDO | null`, nạp theo lô bằng một query `ListLiveDocumentEditLocks(organization_id, document_ids[])`. Tên người giữ: cùng nguồn tên với các trường tên người hiện có của SDO tài liệu; người gọi đã qua cổng đọc của tài liệu đó.

### 3.3 `423 document_locked` và thứ tự lỗi

Body (qua `respondErrorFields`, `auth.go:153-154`), lỗi xây ở `service/document_edit_lock.go` theo **hình** của `errRevisionConflict` (`CodedError{Code, Status, Msg, Fields}`) nhưng **không** mang `Err: ErrConflict`: nó mang sentinel mới `ErrDocumentLocked` (BE-3). Lý do: `documentSaveResult` (`document_metrics.go:86-120`) rơi mọi `CodedError` có `Err: ErrConflict` vào outcome `conflict` (`:115-116`), nên một 423 xây y hệt `errRevisionConflict` sẽ bị đếm là "lần lưu khác đã đổi base". Thẻ (a) thêm hằng `documentOutcomeLocked = "locked"` cạnh `:31-38` và một case `"document_locked"` trong `switch ce.Code` của `documentSaveResult` trả nó; test `TestDocumentSaveOutcomeForLockIsNotConflict` ghi một lần lưu 423 và kiểm nhãn `outcome="locked"`, `IncDocumentConflict` không được gọi. Các mã khác của mục này (409/410/429) cũng không mang `ErrConflict` vì cùng lý do: đường R1–R10 không đi qua `recordDocumentSave`, nhưng một sentinel sai sẽ dễ bị dùng lại.

```json
{
  "code": "document_locked",
  "message": "…",
  "fields": {
    "holder_id": "01J…",
    "holder_name": "Nguyễn Văn A",
    "since": "2026-10-15T03:12:00Z",
    "expires_at": "2026-10-15T03:20:00Z",
    "offline_hold_until": "2026-10-15T11:12:00Z",
    "held_by_me": false,
    "current_revision": "42"
  }
}
```

`offline_hold_until` vắng khi không giữ offline. `current_revision` để client đi đường conflict mà không cần thêm một lần đọc. Không có `lock_id`.

Thứ tự (lỗi đầu tiên thắng), áp cho mọi route ở mục 2:
1. 401 không phiên; 404 không đọc được (cổng đọc, không lộ tồn tại); 403 tổ chức tạm ngưng / thành viên vô hiệu hóa (`RequireMember`).
2. 403 thiếu mức (`forbidden` / mã hiện có); 403 lưu trữ (mã hiện có).
3. **423 `document_locked`** (mục 2, luật 3).
4. 422 `revision_conflict` / 409 `document_version_conflict` — giữ nguyên chỗ và nghĩa (`document_pages.go:622-623`, `document_commit.go:398, 406`).

Lý do 423 trước revision: người không giữ khóa không được ghi dù base đúng; báo xung đột cho họ sẽ đẩy họ vào "Ghi đè" — hộp thoại đó phải không xuất hiện khi tài liệu đang bị khóa.

Mã mới khác: `edit_lock_lost` 409, `edit_lock_changed` 409, `edit_lock_free` 409, `edit_lock_held_by_me` 409, `edit_hold_device_required` 403, `edit_hold_cap_reached` 409, `edit_request_to_self` 409, `edit_request_closed` 409, `edit_request_expired` 410, `edit_request_rate_limited` 429. **Lớp:** chọn để mọi mã này **không lớp** (như `offline_lease_device_required`, contract-p0 §4) — `document_locked` không phải xung đột nội dung (đặt `"conflict"` sẽ làm client cũ mở hộp thoại xung đột có "Ghi đè") và không phải mất quyền; client xử lý theo mã. Bảng `error_class.go:9-65` và `error_class_test.go` được cập nhật đúng theo cách đó (thẻ (a) đọc lại hợp đồng đóng ở đó). Metric lưu `document_metrics.go:47-48` **không** đếm `document_locked` là xung đột (`documentConflictCodes` giữ nguyên hai mã), và outcome của nó là `locked` như trên; thêm metric riêng (mục 7).

### 3.4 SDI có thêm `edit_lock_id`

`PatchDocumentSDI` (`dto/sdi/document.go:42`), `CommitDocumentVersionSDI` (`:63`), `RestoreDocumentVersionSDI` (`:82`), `CommitOfficeFrameVersionSDI` (`dto/sdi/office_frame.go:19`): thêm `edit_lock_id string` tùy chọn với `description` và `example`. Thiếu trường = không giữ khóa (luật mục 2).

### 3.5 Worker và consumer

- **`DocumentEditLockSweeper`** (mỗi `DOCUMENT_EDIT_LOCK_SWEEP_INTERVAL`, 30 s): mỗi hàng sống đã quá hạn được kết thúc `expired` trong transaction riêng có `LockDocumentByID` + audit + outbox `document.lock_changed`; yêu cầu đang chờ của nhiệm kỳ đó → `superseded`; yêu cầu quá hạn → `expired`; xóa hàng kết thúc/đóng quá 7 ngày. Đăng ký vào chuỗi shutdown của `server/cmd/server/main.go` (không goroutine trần). Nhiều node chạy cùng lúc an toàn nhờ khóa hàng tài liệu và điều kiện `ended_at IS NULL`.
- **`DocumentEditLockReleaser`** (consumer outbox, `RegisterLane(outbox.LaneNotify, …)` cạnh `main.go:470`; nó ghi audit + outbox qua nhiều bảng nên không thuộc lane realtime). Topics:
  - `session.revoked` → kết thúc mọi khóa sống của (`user_id`, `session_id`) (`session_id` rỗng = mọi phiên của người đó) với `session_revoked` (edge 10). Kể cả khóa có hold offline: thu hồi phiên là thu hồi máy.
  - `member.deactivated`, `member.left` → mọi khóa sống của người đó trong tổ chức, `member_deactivated` / `access_lost` (edge 3).
  - `member.removed`, `document.share_revoked`, `document.moved` → kiểm lại mức của người giữ trên tài liệu liên quan; dưới `edit` → `access_lost` (cùng mẫu `recheckUserInOrganization` / `recheckDocument` của `office_lease_consumer.go:99-199`).
  - `organization.suspended` → mọi khóa sống của tổ chức, `organization_suspended`.
  - `document.deleted` → `document_deleted` (edge 4). (`document.archived` không cần: lưu trữ nhả trong transaction của chính nó, mục 2.)
  Heartbeat (R3) tính lại mức mỗi 30 s nên kể cả consumer chậm, editor online mất khóa trong ≤ 30 s.

## 4. Sự kiện (catalogue ba nơi)

Hàng thêm vào `docs/events/CATALOGUE.md` (sau `:166`), `server/internal/outbox/catalogue.go` (khối tài liệu `:250-286`), `packages/core/types/events.ts` (khối `:56-76`); `scripts/events-catalogue.test.mjs` giữ ba nơi khớp. Payload chỉ id; không `Patch`.

| Topic | v | Payload | Patch | Phạm vi | Cách gửi | Phát khi |
| --- | --- | --- | --- | --- | --- | --- |
| `document.lock_changed` | 1 | `document_id`, `workspace_id` | — | workspace | outbox | mọi đổi trạng thái thấy được: lấy, nhả, hết hạn, lấy quyền, nhường, nhận khóa nhường, sửa ở đây, bắt đầu/gia hạn/bỏ giữ offline, nhả do mất quyền/phiên/lưu trữ/xóa. **Không** phát ở heartbeat |
| `document.lock_taken_over` | 1 | `document_id`, `workspace_id`, `user_id` | — | user | outbox | lấy quyền; `user_id` = người giữ cũ |
| `document.edit_requested` | 1 | `document_id`, `workspace_id`, `request_id`, `user_id` | — | user | outbox | R8; `user_id` = người giữ |
| `document.edit_request_answered` | 1 | `document_id`, `workspace_id`, `request_id`, `user_id` | — | user | outbox | R9 (chấp nhận/từ chối); `user_id` = người yêu cầu |

Không phát sự kiện cho hủy/hết hạn yêu cầu: người yêu cầu tự thấy (`expires_at` trong `my_request`, và `document.lock_changed` khi nhiệm kỳ kết thúc). `workspace_id` đọc từ `documents` lúc phát. Không thêm `lock_id`/`requester_id` vào payload (không cần cho định tuyến; client đọc lại R1).

Client (`packages/core/realtime/document-events.ts`, thêm case trước `default` `:62`):
- Key mới `documentKeys.editLock(wsId, documentId) = [...documentKeys.workspace(wsId), "edit-lock", documentId]`: **dưới** gốc workspace (để reconnect và mọi khung `document.*` kéo theo), **ngoài** `detail` (để `document.lock_changed` không kéo lại nội dung). Hệ quả chấp nhận: mỗi `document.updated` (autosave của người giữ) đã invalidate cả gốc workspace hôm nay (`document-events.ts:43-60`), nên R1 của người xem đang mở tài liệu được tải lại một lần mỗi autosave — một GET nhỏ, cùng nhịp với `detail` vốn đã tải lại ở mỗi khung đó.
- `document.lock_changed` → invalidate `documentKeys.editLock(wsId, document_id)` và các **tiền tố** gốc danh sách mang avatar: `[...documentKeys.workspace(wsId), "list"]` (phủ mọi `filterKey`, gồm tìm kiếm trong thư viện — tìm kiếm là `list` có bộ lọc, `keys.ts:29-30`), `[...documentKeys.workspace(wsId), "tree"]` (mọi `root`/`foldersOnly`, `keys.ts:41-44`), `recent`, `sharedWithMe`. `documentKeys.list(wsId)`/`tree(wsId)` với tham số mặc định **không** phải tiền tố (chúng kết thúc bằng `""`), nên thẻ (b) thêm `listRoot(wsId)` và `treeRoot(wsId)` vào `keys.ts`. **Không** `detail`. Danh sách yêu thích (`favoritesRoot`, org-scoped, `keys.ts:79-86`) **không** mang `edit_lock` (mục 3.2) nên không cần invalidate.
- `document.lock_taken_over`, `document.edit_requested`, `document.edit_request_answered` → `documentKeys.editLock(wsId, document_id)` (+ key Inbox như các sự kiện sinh thông báo khác).
- Khi reconnect (`use-realtime-sync.ts:431-434`) đã invalidate `documentKeys.workspace(wsId)`; key mới nằm dưới gốc đó nên được kéo theo.
- Payload không bao giờ vào store hay cache (ADR 0015 chỉ cho `task.updated`); client chỉ invalidate.

## 5. Audit và thông báo

### 5.1 Hành động audit (`server/internal/audit/actions.go`, khối `:136-181`)

| Action | Khi | Metadata (không tên, không email) |
| --- | --- | --- |
| `document.edit_lock_acquired` | R2 (cả nhận khóa nhường, sửa ở đây) | `lock_id`, `client`, `granted_via`, `previous_lock_id?` |
| `document.edit_lock_released` | R4; worker hết hạn; consumer; lưu trữ | `lock_id`, `reason` (= `end_reason`) |
| `document.edit_lock_taken_over` | R5 | `lock_id` mới, `previous_lock_id`, `previous_holder_id`, `previous_offline_hold` (bool) |
| `document.edit_hold_started` / `document.edit_hold_renewed` / `document.edit_hold_ended` | R6 lần đầu / R6 gia hạn / R7 | `lock_id`, `hold_until`, `hold_renewals` |
| `document.edit_request_created` | R8 | `request_id`, `lock_id` |
| `document.edit_request_answered` | R9 | `request_id`, `decision`; khi chấp nhận thêm `lock_id` mới (nhiệm kỳ dự trữ) |
| `document.edit_request_cancelled` | R10 | `request_id` |

Không audit heartbeat (30 s × mọi editor; trạng thái nó đổi là `expires_at`, không phải chủ khóa). Mỗi hành động có audit + outbox trong **cùng transaction** với thay đổi, qua `audit.Recorder.Record` (ADR 0009/0012). Actor: người gọi (`service.Human`), hoặc `system` cho worker/consumer.

`server/internal/service/audit_coverage_test.go` có ba chỗ khác nhau, mỗi chỗ một việc (BE-6):
1. **Từ vựng**: mỗi hằng action mới vào `auditActions()` (`:1451`, danh sách viết tay; vòng `:1426` đối chiếu nó với `cases` và `actionsWithoutCommands`).
2. **Lệnh ghi action** (`TestEveryAuditedCommandWritesItsRow`, `:59`, map `cases` khóa theo **action** `:60`): một hàng cho mỗi action ở bảng trên, chạy đúng lệnh service ghi nó — `document.edit_lock_acquired` → `AcquireDocumentEditLock`, `document.edit_lock_released` → `ReleaseDocumentEditLock`, `document.edit_lock_taken_over` → `TakeOverDocumentEditLock`, ba action hold → `PutDocumentEditHold` (lần đầu / lần hai) và `ClearDocumentEditHold`, ba action yêu cầu → `CreateDocumentEditRequest` / `AnswerDocumentEditRequest` / `CancelDocumentEditRequest`. Không action nào vào `actionsWithoutCommands`.
3. **Đường dùng lại action** (`TestReusedAuditActionCommandsWriteTheirOwnRows`, `:1884-1921`): map đó khóa theo **lệnh** và hôm nay chỉ kiểm `document.created` (cho `CreateFolder`/`SaveSourceFile`), nên không thể chỉ "khai thêm tên". Thẻ (a) thêm một test cùng mẫu, `TestEditLockReleaseWritersWriteTheirOwnRows`, khóa theo lệnh: `SweepExpiredDocumentEditLocks` (nhiệm kỳ quá hạn), `DocumentEditLockReleaser.Handle` (một hàng `session.revoked`) và `ArchiveDocument` (`document_lifecycle.go:203`, tài liệu đang có khóa sống), mỗi case kiểm một dòng audit `document.edit_lock_released` với `metadata.reason` đúng **và** một dòng outbox `document.lock_changed` cho đúng tài liệu. Như vậy một đường quên ghi audit không trốn được sau `ReleaseDocumentEditLock`.

### 5.2 Thông báo

| Kind | Từ topic | Người nhận | Mặc định | vi | en |
| --- | --- | --- | --- | --- | --- |
| `document_edit_requested` | `document.edit_requested` | người giữ | in-app + **push** (cần trả lời nhanh) | `{{actor}} muốn sửa “{{document}}”` | `{{actor}} wants to edit “{{document}}”` |
| `document_edit_request_answered` | `document.edit_request_answered` | người yêu cầu | in-app | chấp nhận: `{{actor}} đã nhường quyền sửa “{{document}}” cho bạn` · từ chối: `{{actor}} chưa nhả quyền sửa “{{document}}”` | `{{actor}} handed you editing of “{{document}}”` · `{{actor}} is still editing “{{document}}”` |
| `document_edit_taken_over` | `document.lock_taken_over` | người giữ cũ | in-app + push (họ có thể đang có thay đổi chưa lưu) | `{{actor}} đã lấy quyền sửa “{{document}}”. Thay đổi chưa lưu của bạn vẫn còn trong tài liệu đang mở.` | `{{actor}} took over editing of “{{document}}”. Your unsaved changes are still in the open document.` |

Nơi sửa: `server/internal/notification/kinds.go:31-55` (hằng + `Kinds`), `prefs.go:19-24` (push cho hai kind), `titles.go:25-82` (vi, en, tiêu đề ngắn), `rules.go:89-109` (map topic → rule; rule đọc request/lock bằng id, chỉ báo khi người nhận còn đọc được tài liệu: rule gọi `e.docs.FilterDocumentReaders` như `:456, :531` — cổng khai ở `rules.go:37-40`, `SetDocumentReaders` `consumer.go:55` chỉ nối cổng), deep link `push_consumer.go` (`documentResourceURL`, thêm `?edit_request=<id>` cho kind đầu); web: `packages/core/types/notification.ts:4-28`, `packages/views/notifications/{kind-icon.tsx,kind-tone.ts,notification-category.ts,notification-title.tsx,resource-href.ts}` và chuỗi `notifications.kind.*` / `notifications.kindTitle.*` trong `packages/core/i18n/locales/{vi,en}.json`.

## 6. Isolation và tenant

- `TestEveryQueryNamesItsTenant` (`server/migrations/query_scope_test.go`): mọi query của hai bảng ràng buộc `organization_id = sqlc.arg(organization_id)` (tổ chức lấy từ tài liệu đã qua cổng). Ngoại lệ có dòng `-- tenant:`:
  - `HeartbeatDocumentEditLock` — không cần thẻ: có `organization_id = $n` và `user_id = $n`.
  - `ListExpiredDocumentEditLocks`, `DeleteEndedDocumentEditLocks`, `ExpirePendingDocumentEditRequests`, `DeleteClosedDocumentEditRequests` (worker, mọi tổ chức) — `-- tenant: system`.
  - `ListLiveDocumentEditLocksForSession` (đăng xuất theo `user_id` + `session_id`, có thể nhiều tổ chức) — `-- tenant: self`.
- `TestIsolationMatrix` (BE-1, BE-2) — làm theo đúng thứ tự dưới đây; mỗi bước nêu file và chỗ cần sửa. Tên khóa fixture (`docEditLock`, …) là khóa của `isoTenant.ids` (`isolation_world_test.go:57-58`).

  **Bước 1 — fixture.** Thêm `func (w *isoWorld) buildEditLocks(t *testing.T, tn *isoTenant)` vào `isolation_world_test.go`, gọi trong `buildTenant` sau `w.buildSeeded(t, tn)` (`:494`) và sau `w.buildOffice(t, tn)` (`:491`), vì nó cần `tn.ids["deviceSession"]` do `buildOffice` đặt (`isolation_office_test.go:94`). Nó làm:
  1. Tạo hai trang qua API như `buildDocuments` (`:655-659`): `lockDocument` (tiêu đề `marker+" Locked page"`) và `peerLockDocument` (`marker+" Peer-locked page"`); ghi `tn.ids["lockDocumentRevision"]` = `revision` trong câu trả lời tạo của `lockDocument`. Hai trang riêng, **không** dùng `document`: trang `document` đã được các hàng khác ghi (khôi phục phiên bản, bình luận, chia sẻ…), một khóa sống trên đó sẽ đổi kết quả của chúng.
  2. `tn.ids["docEditor"] = util.NewID()` (một `editor_id` do client sinh).
  3. Chèn bằng SQL thô (cùng cách `buildSeeded`, `:895-905`) — không qua R2/R8 để fixture không phụ thuộc TTL và token desktop chưa mint:
     - `docEditLock`: `document_edit_locks` trên `lockDocument`, `user_id` = chủ (`tn.userID`), `session_id` = `tn.ids["deviceSession"]`, `editor_id` = `tn.ids["docEditor"]`, `client='desktop'`, `base_revision` = `lockDocumentRevision`, `granted_via='acquire'`, `acquired_at = heartbeat_at = now()`, `expires_at = now() + interval '1 hour'`.
     - `peerEditLock`: trên `peerLockDocument`, `user_id` = `tn.peerID`, `session_id='iso-peer-session'`, `editor_id` = một ULID khác, `client='web_page'`, cùng hạn 1 giờ.
     - `docEditRequest`: `document_edit_requests` trên `lockDocument`, `lock_id` = `docEditLock`, `requester_id` = `tn.peerID`, `holder_id` = `tn.userID`, `status='pending'`, `expires_at = now() + interval '1 hour'`.
     Cả hai bảng có dòng của A nên không cần `isoUnseeded` (`isolation_matrix_test.go:1093`); băm tenant (`tenantDigest`) phủ chúng.
  4. Thế giới isolation dựng service khóa với `DOCUMENT_EDIT_LOCK_TTL = 1h`, không qua env: `newTestDeps` (`auth_test.go:102`) không nhận config và `service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)` (`isolation_world_test.go:182`) cũng không có tham số TTL, nên thẻ (a) thêm đường nối riêng (option/setter của service khóa, thế giới gọi nó ở `:182`) và **không** chạy `DocumentEditLockSweeper` (như nó không chạy dispatcher, `:495-496`): heartbeat trong write-control không kéo hạn về 2 phút, và lần chạy dài không làm fixture hết hạn giữa chừng.

  **Bước 2 — token.** `do()` (`isolation_world_test.go:332-334`) hôm nay đổi token phiên của chủ sang token thiết bị (`deviceTokens`) cho đường dẫn chứa `/office/offline-lease`. Mở rộng điều kiện thành `… || strings.Contains(path, "/edit-lock")`: mọi lệnh của chủ trên R1–R7 chạy bằng phiên desktop, đúng `session_id` của `docEditLock`, và R6 (cần `device_sessions` sống) phục vụ được chủ. Việc đổi token an toàn vì `RequireAuthWithDevice` chỉ hỏi `device_sessions` với token không phải web (`middleware/auth.go:23, 44`; `MintSession` đặt `Web=false`, `auth/token.go:37-39`) và phiên thiết bị của A còn sống (pass `untouched` khẳng định, `isolation_matrix_test.go:280-285`). Token của B cũng đổi sang thiết bị của B — vẫn là B, nên các lần tấn công không đổi nghĩa. R8–R10 (`/edit-requests`) giữ token web.

  **Bước 3 — tham số đường dẫn** (`isolation_matrix_test.go`):
  - `isoParam` (`:513`), nhánh `case "{documentID}":` (`:576`), thêm **trước** `return tn.get(t, "document")` cuối nhánh: `if under("/edit-lock/take-over") { return tn.get(t, "peerLockDocument") }` rồi `if under("/edit-lock") || under("/edit-requests") { return tn.get(t, "lockDocument") }`.
  - Hai case mới: `case "{lockID}": return tn.get(t, "docEditLock")` và `case "{requestID}": return tn.get(t, "docEditRequest")` (chữ **D** hoa; khác `{requestId}` của yêu cầu vào phòng họp `:554`).
  - `isoTenantParams` (`:438-445`): thêm `"{lockID}": true, "{requestID}": true` — hai id này là hàng của một tổ chức.
  - Hiện trạng thiếu các case này làm `isoPath` (`:494-508`) trả `("", false)` và mọi pass `continue` âm thầm: R3, R4, R6, R7, R9, R10 và hai case tham chiếu có `{lockID}`/`{requestID}` sẽ không chạy lần nào (BE-2). Có case rồi thì khóa nào chưa seed sẽ bị `tn.get` báo `t.Errorf` (`isolation_world_test.go:63-70`), không còn bị bỏ qua.

  **Bước 4 — `isoRoutes`** (`isolation_routes_test.go:181`). Chỉ các hàng sau; R1, R3, R4, R7 không có body và chủ là người giữ nên dùng mặc định (`isoScoped`, không hàng). **Không** có `skipControl` nào:

  | Route | Hàng `isoSpec` |
  | --- | --- |
  | `POST /api/v1/documents/{documentID}/edit-lock` (R2) | `{body: isoWith(map[string]string{"editor_id": "docEditor"}, map[string]any{"client": "desktop"})}` |
  | `POST /api/v1/documents/{documentID}/edit-lock/take-over` (R5) | `{body: isoWith(map[string]string{"expected_lock_id": "peerEditLock"}, map[string]any{"editor_id": "01J8X4ED1T0R0000000000000A", "client": "desktop"})}` |
  | `PUT /api/v1/documents/{documentID}/edit-lock/{lockID}/offline-hold` (R6) | `{body: isoJSON(map[string]any{})}` |
  | `POST /api/v1/documents/{documentID}/edit-requests` (R8) | `{body: isoJSON(map[string]any{}), controlAs: "third"}` |
  | `POST /api/v1/documents/{documentID}/edit-requests/{requestID}/answer` (R9) | `{body: isoWith(map[string]string{"lock_id": "docEditLock"}, map[string]any{"decision": "decline"})}` |
  | `DELETE /api/v1/documents/{documentID}/edit-requests/{requestID}` (R10) | `{controlAs: "peer"}` |

  `isoWith` (`isolation_routes_test.go:117-128`) điền id của tenant đang được gửi, nên control của C gửi id của C, còn lần tấn công gửi id của A.

  **Bước 5 — kết quả mong đợi từng pass** (để thẻ (a) viết route cho khớp; mã lấy từ bảng R1–R10 mục 3.1):

  | Pass | Gửi | Kết quả |
  | --- | --- | --- |
  | control GET (`:61-78`, chủ A và chủ B trên id của mình) | R1 | 200 |
  | cross-tenant (`:87-99`), anonymous (`:104`) | mọi route, id của A | 404 từ cổng đọc tài liệu, **trước** mọi tra cứu khóa/yêu cầu; 401 khi không phiên |
  | mixed (`:144`) và member-of-both (`:208`, B cũng là thành viên A), route hai tham số R3, R4, R6, R7, R9, R10 | `lockDocument` của B + `{lockID}`/`{requestID}` của A | các route này vào hai pass nhờ case `{lockID}`/`{requestID}` của bước 3, không nhờ hàng này; 404 mong đợi là kiểm "con thuộc cha": khóa/yêu cầu tra bằng (`organization_id` của tài liệu, `document_id`, `id`) nên không tồn tại dưới tài liệu của B |
  | write-control (`:310-357`, tenant C mới, thứ tự pha `isoWritePhase` `:392-404`) | pha 0: R2, R3, R5, R6, R8, R9; pha 2 (DELETE, đường sâu trước): R7, rồi R4 và R10 | R2 200 (cùng người + cùng `editor_id`, idempotent), R3 200, R5 201 (chủ C lấy quyền khóa của peer trên `peerLockDocument`, không đụng `lockDocument`), R6 200 (phiên desktop), R8 201 (`third` yêu cầu; peer đã có yêu cầu riêng), R9 200 (chủ từ chối yêu cầu của peer), R7 200, R4 204, R10 204 (peer hủy yêu cầu đã bị từ chối: idempotent). Không lệnh pha 0 nào đổi người giữ `docEditLock`, nên thứ tự trong pha không đổi kết quả |

  Ghi chú về tiền đề của BE-1: write-control chỉ báo lỗi khi chủ bị 401/403/404 không nằm trong `control`, hoặc 5xx (`isolation_matrix_test.go:342-355`); 409/423 không làm nó đỏ. Fixture trên vẫn nhắm 2xx cho mọi route để control chứng minh route **phục vụ** người của nó, không chỉ "quyết định ai hỏi". Điều kiện để giữ được: không route nào trả 403/404 cho người đúng vai trên hàng của chính họ — đó là lý do R3, R7, R9 trả 409 (không phải 404) khi nhiệm kỳ đã đổi chủ.

  **Bước 6 — `isoReferences`** (`isolation_references_test.go:115`). Control của mỗi case (B, id của B) phải 2xx (`referenceControls`, `:331-344`); lần tấn công (id của A) phải 4xx và A không đổi:

  | Case (`covers`) | Method + pattern | Body | Control (B) | Tấn công (id của A) |
  | --- | --- | --- | --- | --- |
  | `AnswerDocumentEditRequestSDI.lock_id` | `POST /api/v1/documents/{documentID}/edit-requests/{requestID}/answer` | `{"decision": "decline", "lock_id": isoRef("docEditLock")}` | 200 | 409 `edit_lock_changed` (`lock_id` ≠ `lock_id` của yêu cầu, kiểm trước trạng thái) |
  | `TakeOverDocumentEditLockSDI.expected_lock_id` | `POST /api/v1/documents/{documentID}/edit-lock/take-over` | `{"editor_id": "01J8X4ED1T0R0000000000000B", "client": "desktop", "expected_lock_id": isoRef("peerEditLock")}` | 201 | 409 (`edit_lock_changed`; sau control, B đang giữ nên có thể là `edit_lock_held_by_me` — đều 4xx, không đọc gì của A) |
  | `PatchDocumentSDI.edit_lock_id` | `PATCH /api/v1/documents/{documentID}`, `docKey: "lockDocument"` | `{"revision": isoOwn("lockDocumentRevision"), "content": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "edited"}]}]}, "edit_lock_id": isoRef("docEditLock")}` | 200 (luật 2 mục 2: id = nhiệm kỳ sống, `user_id` = actor; token web không đổi kết quả vì luật không so phiên) | 423 `document_locked` (đứng trước kiểm revision, nên revision cũ sau control không đổi kết quả) |

  Ba trường còn lại vào `isoRefFieldExempt` (`isolation_references_test.go:350`) với lý do viết sẵn — `CommitDocumentVersionSDI.edit_lock_id`, `RestoreDocumentVersionSDI.edit_lock_id`, `CommitOfficeFrameVersionSDI.edit_lock_id`: *"compared, never stored: the same documentEditLockAllows check the PatchDocumentSDI.edit_lock_id case attacks; a control would need its own upload/version and base revision, which the existing commit cases consume; TestEditLockIDFromAnotherTenantIsRefused sends another organization's live tenure id to all four writes"*. Hai `editor_id` cũng vào đó: `AcquireDocumentEditLockSDI.editor_id`, `TakeOverDocumentEditLockSDI.editor_id` — *"a client-minted editor instance id, not a row"*. `TestEveryBodyIDFieldHasAReferenceCase` (`:388-461`) như vậy thấy đủ tám trường.

  **Bước 7 — kiểm.** `go test ./internal/handler -run TestIsolationMatrix` (cloud runner, `pool_max_conns=4`): không có dòng "isolation fixture … has no" nào; subtest `write-control` xanh không thêm `skipControl`; một `t.Errorf` tạm trên nhánh `!ok` của `isoPath` (gỡ trước commit) không bắn cho route nào trong R1–R10, tức sáu route có `{lockID}`/`{requestID}` thật sự chạy mọi pass.
- `TestIsolationRealtime`: `document.lock_changed` (workspace) không tới socket của B; ba sự kiện scope user chỉ tới đúng người.

## 7. Giá trị cấu hình (D2, D1)

| Env (thêm vào `.env.example`, `scripts/env-example.test.mjs`) | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `DOCUMENT_EDIT_LOCK_TTL` | `2m` | hạn từ heartbeat cuối (D2) |
| `DOCUMENT_EDIT_LOCK_HEARTBEAT` | `30s` | chu kỳ client, trả trong SDO `heartbeat_interval_ms` |
| `DOCUMENT_EDIT_LOCK_SWEEP_INTERVAL` | `30s` | worker hết hạn |
| `DOCUMENT_EDIT_HOLD_MAX` | `8h` | một lần giữ offline (D1, giá trị đề xuất của issue) |
| `DOCUMENT_EDIT_HOLD_CHAIN_MAX` | `24h` | trần cộng dồn từ `hold_chain_started_at` trong một nhiệm kỳ (edge 7) |
| `DOCUMENT_EDIT_REQUEST_TTL` | `15m` | hạn yêu cầu |
| `DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR` | `5` | trần DB mỗi người yêu cầu mỗi tài liệu |

Không có idle timeout (D2) — không biến nào cho nó. **Kiểm lúc khởi động** (BE-4): **không** dùng `parseDuration` (`config.go:404-413`), vì nó rơi về mặc định khi giá trị sai — gõ nhầm `DOCUMENT_EDIT_LOCK_TTL=2mn` sẽ khởi động âm thầm với 2 phút. Sáu biến thời lượng đọc bằng `parseOptionalDuration` (`:418-427`: trống → mặc định, có giá trị mà sai/≤ 0 → lỗi) **trước** literal `Config{…}` trong `Load`, theo đúng mẫu `OFFICE_CHANGE_SNAPSHOT_TTL` (`:240-247`), mỗi lỗi trả `Config{}, fmt.Errorf("DOCUMENT_EDIT_LOCK_TTL %w", err)`; `DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR` đọc bằng `strconv.Atoi` trong cùng khối (trống → 5, sai hoặc ≤ 0 → lỗi). Ngay sau đó một khối kiểm chéo mới trong `Load` (chưa có cơ chế sẵn): `HEARTBEAT * 2 > TTL` → `fmt.Errorf("DOCUMENT_EDIT_LOCK_HEARTBEAT must be at most half of DOCUMENT_EDIT_LOCK_TTL")`, `HOLD_MAX > HOLD_CHAIN_MAX` → lỗi tương tự. `Load` lỗi = server không khởi động. Test `server/internal/config/config_test.go` `TestLoadRejectsBadEditLockConfig` (bảng: TTL gõ nhầm, HEARTBEAT×2 > TTL, HOLD_MAX > HOLD_CHAIN_MAX, MAX_PER_HOUR=0 — mỗi hàng mong lỗi; pin env bằng `t.Setenv`). Hạn một lần giữ = `min(now + HOLD_MAX, hold_chain_started_at + HOLD_CHAIN_MAX, device_sessions.expires_at)`.

**Vì sao 8 h và trần 24 h:** 8 h phủ một ngày làm việc/chuyến bay; manager lấy lại được nên cái giá của giữ dài bị chặn. Trần chuỗi 24 h bằng TTL tối đa của lease đọc offline (DOC-005 §6.2.1 hàng 1), nên không có trạng thái "còn quyền sửa offline nhưng hết quyền đọc offline". Chuỗi đặt lại khi nhiệm kỳ kết thúc (nhả rồi lấy lại là một nhiệm kỳ mới) — xem câu hỏi mở Q2.

Metric (không nhãn org/user): `uniwork_document_edit_lock_ops_total{op=acquire|take_over|handover|move_here|release|expire|access_lost|session_revoked}`, `uniwork_document_edit_lock_refused_total{route=patch|commit|frame_commit|restore}`, `uniwork_document_edit_requests_total{op=create|accept|decline|cancel|expire|rate_limited}`. Ba chỗ sửa (BE-12): (1) `server/internal/metrics/documents.go` — ba trường `*prometheus.CounterVec` mới trong struct `Documents` (`:19-29`), khởi tạo trong `NewDocuments()` (`:31`), và **thêm vào `Collectors()`** (`:72`) — registry chỉ đăng ký những gì `Collectors()` trả, thiếu ở đó là vô hình ở production; cùng file thêm ba method `IncDocumentEditLockOp(op)`, `IncDocumentEditLockRefused(route)`, `IncDocumentEditRequest(op)`. (2) interface `service.DocumentMetrics` (`document_metrics.go:56-64`) thêm ba method đó. (3) `nopDocumentMetrics` (`:66-74`) thêm ba method rỗng. Test metric kiểm `uniwork_document_edit_lock_ops_total` có trong registry đã scrape.

## 8. Edge case 1–15 → hành vi → test

Tên test Go là tên đề xuất cho thẻ (a); vitest/e2e cho thẻ (b); `apps/shell` cho thẻ (c). Test Go chạy race với `pool_max_conns=4`.

| # | Hành vi | Test |
| --- | --- | --- |
| 1 | Hold hết hạn khi người giữ còn offline: app (thẻ c) đặt editor chỉ đọc theo `offline_hold_until` và đồng hồ G5-08c; thay đổi chưa lưu ở lại thành nháp mã hóa (store của G5-04, như Lock-while-open). Khi online: nếu R1 cho thấy trống và `documents.revision == base` của nháp → R2 rồi Lưu (intent mới); ngược lại → đường conflict (S5) hoặc `blocked document_locked`. Không bỏ nháp | Go `TestEditHoldExpiryFreesTheLockForOthers`; fork `apps/shell/src/main/uniwork-sync/edit-hold.test.ts` "hold expires offline → read-only, draft kept; reconnect free+same base → reacquire; else conflict" |
| 2 | Manager lấy quyền khi người giữ offline (R5 hợp lệ cả khi hold còn): nhiệm kỳ cũ `taken_over`. Khi online lại, lần dispatch intent nhận 423 → queue `blocked` lý do `document_locked` (thẻ c), byte giữ nguyên, "Tải bản của tôi về máy" (`saveMyCopy`); thông báo `document_edit_taken_over` chờ ở Inbox | Go `TestTakeOverDuringOfflineHold` (R5 thành công, audit `previous_offline_hold=true`, commit sau với `edit_lock_id` cũ → 423); fork `queue/machine.test.ts` "423 document_locked → blocked, bytes kept" |
| 3 | Người giữ mất `edit`, bị vô hiệu hóa, tổ chức bị tạm ngưng khi offline: consumer kết thúc khóa server-side (`access_lost` / `member_deactivated` / `organization_suspended`); khi online, Lưu gặp 403 → queue `blocked` với lý do hiện có (`permission_revoked` / `member_deactivated` / `organization_suspended`) | Go `TestEditLockReleasedOnAccessLoss` (bảng: share revoke, gỡ khỏi workspace, vô hiệu hóa, rời tổ chức, tạm ngưng; có và không có hold); `TestEditLockHeartbeatRechecksLevel` |
| 4 | Lưu trữ (thùng rác)/lưu trữ thật/xóa/di chuyển khi đang giữ offline: thùng rác nhả trong transaction (`document_archived`), lưu trữ thật nhả trong transaction (`document_shelved`), xóa qua consumer (`document_deleted`), di chuyển → kiểm lại mức; tombstone dừng replay theo luật G5 (§4.1, §5.3) | Go `TestArchiveReleasesEditLock`, `TestShelveReleasesEditLock`, `TestDeleteReleasesEditLock`, `TestMoveKeepsLockUnlessAccessLost`; fork queue test hiện có cho tombstone (không đổi) |
| 5 | Lùi đồng hồ: hạn hold do server cấp (`offline_hold_until`, giờ Postgres); app tính hạn hiệu dụng bằng `server_time` + đồng hồ đơn điệu như lease (`lease/clock.ts:61-77`), lùi > 5 phút → coi như hết hạn (chỉ đọc) tới khi online | fork `edit-hold.test.ts` "clock rollback > 5 min → read-only" (dùng lại `computeEffectiveNow`/`isClockRollback`); Go không cần: server không đọc giờ client (ghi rõ trong test `TestEditLockUsesServerClock` chỉ kiểm `expires_at` từ `now()` của DB) |
| 6 | Mất mạng không có hold: server hết TTL, người khác sửa được. Editor tự chuyển chỉ đọc khi quá TTL kể từ heartbeat thành công cuối (đồng hồ đơn điệu phía client); gõ trong khoảng đó → nháp (web: bộ nhớ editor + draft recovery hiện có; desktop: checkpoint) → khi online đi edge 1 | vitest `packages/core/documents/edit-lock-session.test.ts` "heartbeat fails past TTL → read-only, local content kept"; fork `edit-hold.test.ts` "no hold → read-only after TTL" |
| 7 | Gia hạn hold chỉ qua R6 (cần online); trần chuỗi 24 h → 409 `edit_hold_cap_reached`; người khác thấy `offline_hold_until` ("A giữ quyền sửa offline đến <giờ>") | Go `TestEditHoldRenewIsCapped`, `TestEditHoldVisibleToOthers` |
| 8 | Lease đọc offline (G5-D1, 24 h) và hold độc lập: mất hold không đụng lease; lease bị thu hồi không tự kết thúc hold (nhưng cùng nguyên nhân mất quyền thì consumer kết thúc cả hai) | Go `TestEditHoldIndependentOfOfflineLease` (thu hồi lease → hold còn; kết thúc hold → lease còn); fork `edit-hold.test.ts` |
| 9 | Cùng người hai cửa sổ/thiết bị: khóa theo editor; cửa sổ thứ hai chỉ đọc với "Sửa ở đây" → R2 `move_from_self=true`; editor cũ nhận `document.lock_changed`, heartbeat kế trả `edit_lock_lost reason=moved_here` → chỉ đọc + đường thay đổi chưa lưu. Desktop: `DocLock` cục bộ vẫn quyết định cửa sổ nào trong cùng máy | Go `TestEditLockMoveHereSameUser` (không audit lấy quyền, `granted_via=move_here`); `TestEditLockAcquireSameEditorOtherUserIs423` (thành viên thứ hai gửi R2 với `editor_id` của người giữ → 423, không phải 200; BE-8); e2e `e2e/document-edit-lock.spec.ts` "same user, two tabs" |
| 10 | Đăng xuất/thu hồi phiên: client web gọi R4 trước `POST /auth/logout` (best effort); server nhả qua consumer `session.revoked` (độ trễ = độ trễ lane notify, giây) | Go `TestEditLockReleasedOnSessionRevoke` (logout web, revoke một phiên, revoke all, logout desktop); vitest `packages/core/auth/store.test.ts` "logout releases held edit locks first" |
| 11 | Khôi phục phiên bản cần khóa; đổi tên, di chuyển, tạo phiên bản thủ công, visibility không cần; lưu trữ nhả khóa (mục 2) | Go `TestRestoreVersionNeedsEditLock`, `TestRenameAndMoveNeedNoEditLock` |
| 12 | Hai lấy khóa/lấy quyền/chấp nhận đua nhau: tuần tự bằng `LockDocumentByID` + chỉ mục duy nhất từng phần; đúng một thắng, bên thua 423 / `edit_lock_changed` / `edit_request_closed` | Go `TestEditLockRaceExactlyOneWins` (N goroutine với barrier: acquire×acquire, take-over×take-over, take-over×accept, accept×heartbeat); `TestEditRequestReplacesExpiredPending` (chèn yêu cầu `pending` có `expires_at` đã qua, gọi R8 trước khi worker chạy → 201, đúng một hàng `pending`, hàng cũ `expired`; BE-5) |
| 13 | Tab ẩn/máy ngủ: TTL chịu được throttle (phép tính dưới bảng); khi thức (`visibilitychange`, `online`, `focus`; desktop `powerMonitor.resume`) editor gửi heartbeat ngay; mất khóa → R2 nếu trống và base không đổi, ngược lại đường conflict | vitest `edit-lock-session.test.ts` với fake timers: nhịp 60 s (throttle mạnh) giữ khóa; ngủ 5 phút → lấy lại khi base không đổi, conflict khi đổi |
| 14 | Restart/deploy không nhả khóa: trạng thái ở bảng | Go `TestEditLockSurvivesServiceRestart` (dựng service mới trên cùng DB; khóa còn, heartbeat tiếp được) |
| 15 | Agent không bao giờ lấy quyền hay yêu cầu thay người; ghi của agent khi có khóa sống → 423 | Go `TestAgentCannotHoldTakeOverOrRequest`, `TestAgentWriteRefusedWhileLocked` |

**Phép tính TTL cho edge 13.** Trình duyệt dồn timer của tab ẩn: Chrome sau 5 phút ẩn ("intensive throttling") gom timer chuỗi về **1 lần/phút**; Firefox/Safari giới hạn ≥ 1 s và có ngân sách nền, khoảng cách thực tế ≤ 60 s. Với heartbeat danh nghĩa 30 s, khoảng cách xấu nhất giữa hai lần gửi là 60 s + độ trễ mạng (≤ vài giây). TTL 120 s ≥ 2 × 60 s: tab ẩn **giữ được khóa** chừng nào mỗi lần gửi đều thành công. Không chịu được đồng thời throttle mạnh **và** một lần gửi lỗi (lần kế tới sát 120 s): lúc đó khóa có thể hết hạn và editor đi đường "thức dậy" ở trên — chấp nhận, vì kết quả xấu nhất là lấy lại khóa hoặc conflict, không mất dữ liệu. Client không dùng Web Worker để né throttle (không cần với các số trên). Desktop gửi heartbeat từ process main (không bị throttle renderer); máy ngủ dừng mọi thứ → khóa hết hạn sau 2 phút, xử lý ở `resume`.

## 9. Luồng phía client (chung web + desktop)

- **Mở để sửa** (`canEdit`): sinh `editor_id` (ULID) → R2. 201/200 → editable. 423 → chỉ đọc + banner người giữ. Người không đủ `edit` không gọi R2. Trong lúc chờ R2 (FE-8): nội dung hiện **ngay** (không chờ khóa), chỉ việc nhập bị chặn (editor `editable=false`, không spinner che nội dung); chip "Chỉ xem" và `Notice` chỉ đọc (`document-workspace.tsx:486-491, 500-503`) **không** hiện ở pha này — chúng chỉ dành cho người thiếu quyền hoặc trạng thái `other`; nếu R2 chưa trả lời sau 1 s thì header hiện spinner nhỏ (`<Spinner />`), không hiện chữ "chỉ đọc".
- **Heartbeat** mỗi `heartbeat_interval_ms`; ngay khi `visibilitychange` → visible, `online`, `focus`. Thành công cập nhật mốc đơn điệu. Mất (409 `edit_lock_lost`) hoặc quá TTL không thành công → chỉ đọc + đường thay đổi chưa lưu.
- **Đóng**: R4 ở `pagehide` (web) / khi đóng tab (desktop). Web **không** gọi `fetch` thô: hàm endpoint `releaseDocumentEditLock(documentId, lockId, {keepalive})` trong `packages/core/api/endpoints/documents-edit-lock.ts` gọi `request(…, {method: "DELETE", keepalive: opts.keepalive})` — transport đã có tùy chọn `keepalive` (`packages/core/api/http.ts:145, 200`) và tự gắn Authorization; mẫu `signalChatPresence` (`api/endpoints/chat-voice.ts:317-325`, gọi với `keepalive: true` ở `chat/use-chat-presence-heartbeat.ts:44`). Thất bại → hết TTL.
- **Khóa đang giữ ở đâu** (FE-5): một registry headless `packages/core/documents/edit-lock-registry.ts` (Map `documentId → lockId` cấp module, không phải store React; `edit-lock-session.ts` ghi vào khi lấy được và xóa khi nhả/mất). `auth/store.ts` `logout` (`:105-108`) gọi `releaseHeldEditLocks()` của registry **trước** `clearSession()` (còn token), chờ tối đa 1 s (`Promise.race`), mỗi khóa qua `releaseDocumentEditLock(…, {keepalive: true})`; lỗi bị nuốt (server vẫn nhả qua `session.revoked`, edge 10). Auth store không chạm transport ngoài hàm endpoint đó — đúng luật "chỉ auth store và `api/endpoints/*` chạm transport".
- **Lưu**: gửi `edit_lock_id` ở mọi lệnh ghi mục 2. 423 → chỉ đọc + đường thay đổi chưa lưu (không mở hộp thoại xung đột có "Ghi đè").
- **"Sửa ngay"** (khóa trống, thấy qua `document.lock_changed` hoặc khi đồng hồ client qua `expires_at` thì đọc lại R1): editor đang chỉ đọc nên sạch; nếu revision server mới hơn bản đang xem → nạp bản mới trước (đường "có phiên bản mới" hiện có) → R2 → editable. Không tải lại trang.
- **Thay đổi chưa lưu khi mất khóa** (bị lấy quyền, nhường, hết hạn, sửa ở chỗ khác, mất quyền): không bao giờ bỏ âm thầm. Hiện hộp thoại "Bạn không còn quyền sửa" — câu chữ theo `reason` của `edit_lock_lost` / `document.lock_changed` (mục 11.4: `lostTakenOver`, `lostHandedOver`, `lostMovedHere`, `lostExpired`, `lostAccessLost`, và `lostGeneric` cho lý do lạ) — với hai đường: "Tải bản của tôi" và "Tải lại bản mới nhất" (sau xác nhận bỏ thay đổi). Không có "Ghi đè". Nội dung giữ trong editor (chỉ đọc) tới khi người dùng chọn. `session_revoked` không hiện hộp thoại này: phiên đã hết, client đi đường đăng xuất (bản nháp xử lý theo `endDraftSession`, `auth/store.ts:46`).
- **"Tải bản của tôi" — định dạng** (FE-4): *trang* (TipTap) tải về **HTML** của editor đang mở (`editor.getHTML()`: nội dung sống của editor, **không** qua `sanitizePageContent` — hàm đó chỉ áp cho `instance.getJSON()` lúc lưu, `document-editor.tsx:173`), bọc trong một tài liệu `<!doctype html>` tối thiểu có `<meta charset="utf-8">` và `<title>`, MIME `text/html`, tên tệp `{tiêu đề} (bản của tôi).html` (cùng mẫu tên `{tên} (bản của tôi).{ext}` của desktop, `EXPERIENCE.md:230`, OQ-UX12). Chọn HTML vì mở được ở mọi trình duyệt và dán lại vào editor giữ định dạng; không có đường xuất trang sẵn có ở client để dùng lại (đường tải duy nhất là tệp, `document-file-actions.tsx:44-58`, dùng lại đúng cách tạo `<a download>` + `URL.createObjectURL` của nó). *Tệp Office* trong frame: bytes hiện tại của frame qua bước `download` sẵn có của frame (mục 11.1); desktop: `saveMyCopy` (mục 10.2). e2e bước 4 kiểm tệp tải về có `.html`, tên đúng mẫu và chứa chữ chưa lưu.
- **Nhận yêu cầu** (người giữ): prompt trong editor từ `pending_requests` (R1, invalidate bởi `document.edit_requested`): "Lưu và nhường quyền" (lưu trước; chỉ gửi R9 `accept` khi lưu thành công, lỗi lưu → báo lỗi, không nhường) / "Từ chối" (R9 `decline`) / đóng = lờ đi (hết hạn 15 phút).
- **Người yêu cầu**: banner chuyển "Đã gửi yêu cầu…" (`my_request`); chấp nhận → nhiệm kỳ dự trữ cho mình → R2 nhận → editable không tải lại; từ chối/hết hạn → "A chưa nhả quyền sửa", nút "Yêu cầu lại" khi không bị rate limit; người giữ đang giữ offline → "A giữ quyền sửa offline đến <giờ>" (yêu cầu vẫn tạo; thông báo tới khi họ online).

## 10. Amendment thiết kế offline G5 (spec 2026-10-02 §5.1–5.3) và các thẻ plan

### 10.1 Thay đổi luật

| Chỗ | Trước | Sau (UNI-1645, D1) |
| --- | --- | --- |
| §5.1 Gate G5-D1 / DOC-005 §6.2.1 hàng 3, 9 | Lease mang `level` `view`/`edit`; `edit` cho phép sửa + xếp Lưu offline | Lease chỉ là quyền **đọc** offline (giữ nguyên route, claim và 24 h; `level` vẫn ký để hiện "chỉ xem"). Sửa offline cần **cả** lease `level=edit` **và** hold sống của chính thiết bị (`offline_hold_until` + `hold_device_session_id` = sid). Không hold → editor offline chỉ đọc, Lưu offline bị chặn |
| §5.2 bước 1 (Lưu khi offline) | Lưu offline luôn tạo intent | Chỉ tạo intent khi hold sống. Thay đổi gõ trước khi mất mạng (edge 6) là checkpoint/nháp, không phải intent; lúc online đi edge 1 |
| §5.2 bước 3 (reconnect) | kiểm session, ACL, lease, tombstone, engine, base | thêm **khóa**: dispatch gửi `edit_lock_id`; trước dispatch, nếu không còn nhiệm kỳ của mình thì R2 (trống + base đúng) hoặc `blocked document_locked` |
| §5.2 bảng trạng thái queue, `blocked` | session/quyền/lease | thêm lý do `document_locked` (người khác giữ hoặc đã lấy quyền) |
| §5.3 conflict | ba lựa chọn Tải lại / Ghi đè / Hủy | 423 không phải conflict: không có "Ghi đè"; biến thể "đang bị khóa" có "Tải bản của tôi về máy" + "Tải lại (giữ nháp)" + "Đóng" |
| §5.3 đăng xuất desktop | xóa plaintext, khóa queue | thêm: nhả mọi khóa đang giữ (R4) khi online trước khi khóa store; offline thì hold còn tới hạn (manager lấy lại được), server nhả khi nhận `session.revoked` |
| §4.2 nhận cập nhật khi đang mở | theo trạng thái local | thêm hàng: "khóa bị lấy/nhường/hết hạn" → editor chỉ đọc, giữ nội dung, đường thay đổi chưa lưu |
| §5.1 thu hồi lease (DOC-005 hàng 16, §6.2.2 "khóa ngay") | thu hồi chỉ tới qua 403 lúc gia hạn (desktop không có kênh user-scope) | app online nhận `office_lease.revoked` qua **client realtime user-scope** mới của shell và gọi điểm vào lease của G5-08c ngay; cùng client mang các sự kiện khóa sửa (mục 10.3, ADV-1) |

### 10.2 Theo thẻ (nhánh fork đọc bằng `git show`, không checkout)

| Thẻ | Đã làm trên nhánh | Phải đổi |
| --- | --- | --- |
| **G5-08c** (UNI-1353), `origin/feature/UNI-1353-g5-08c-offline-lease` @`85c75e86` (tip 2026-10-15 `1e5f8dfe`) | Codec/store/đồng hồ lease (`lease/clock.ts:17-20, 61-77, 177-222`), client `PUT/DELETE …/offline-lease` (`lease/client.ts:9, 21-50, 305`), manager (`lease/manager.ts:24-65, 712, 730-748`), `runtime.stop()` → `lockAll('logout')` (`runtime.ts:306-319, 358`); chưa nối vào docs service. Ở `1e5f8dfe`: điểm vào `LeaseManager.handleFeedRevoked(payload)` (`lease/manager.ts:767`) + `parseLeaseRevokedEvent` (`:177`) + listener `onRevoked` (`:270`) đã có nhưng **không ai gọi** — ghi chú `:172-176`: "the desktop has no client for" kênh user-scope (R1BE-5); hôm nay thu hồi chỉ tới qua 403 lúc gia hạn | `LeaseLevel='edit'` không còn bật sửa offline một mình: thêm cổng "edit offline = lease edit + hold sống" ở nơi nối lease vào editor; thêm store hold (dùng lại `computeEffectiveNow`/`isClockRollback`; hạn từ `offline_hold_until` server); lý do Lock-while-open thêm `edit_hold_expired` (`shared/home-api.ts:347`) — chỉ đọc, nháp giữ. **Client realtime user-scope** (ADV-1, mục 10.3) gọi `handleFeedRevoked` khi nhận `office_lease.revoked` (`server/internal/outbox/catalogue.go:295`), để app đang online khóa ngay (DOC-005 hàng 16, §6.2.2) thay vì chờ lần gia hạn |
| **G5-05** (UNI-1359) | Chưa có nhánh | Tài liệu ghim mở **chỉ đọc** khi offline trừ khi có hold; menu tài liệu (online, đang giữ khóa) thêm "Giữ quyền sửa khi offline" (R6) và "Bỏ giữ" (R7); hàng S3 hiện "Giữ quyền sửa đến <giờ>" |
| **G5-09** (UNI-1356), `origin/feature/UNI-1356-g5-09-conflict-dialog` @`794ae4e9` | `UniworkConflictView`/hành động (`shared/uniwork-conflict.ts:7-53`), bước `ConflictStep` (`renderer/src/uniwork-conflict-model.ts:11, 76-334`), không có lựa chọn "tải bản của tôi" | Thêm biến thể `locked` (`locked: 'none'|'revoked'|'deleted'` ở `:36` thêm `'edit_locked'`): không Ghi đè, có "Tải bản của tôi về máy" (gọi `saveMyCopy` của G5-10) + Tải lại giữ nháp; câu chữ mục 11 |
| **G5-10** (UNI-1357), `origin/feature/UNI-1357-g5-10-sync-center` @`f083cf4e` | `SYNC_CENTER_BLOCKED_REASONS` 13 giá trị (`apps/shell/src/shared/sync-center.ts:117-133`), lý do bỏ được (`:139-144`), `lockedBy` (`:190`), `saveMyCopy` (`:23, 278-282`; main `apps/shell/src/main/uniwork-sync/sync-center.ts:818, 930`); `mapBlockedReason` gom mã lạ vào `permission_revoked` (`apps/shell/src/main/uniwork-sync/sync-center.ts:173-200`, `default` `:198`); map queue `apps/shell/src/main/uniwork-sync/queue/machine.ts:125-137` | Lý do mới **`document_locked`**: nhãn `uwReasonEditLocked` ("Người khác đang sửa"), badge **mới** `uwBadgeEditing` tông **info**, hành động "Kiểm tra lại · Tải bản của tôi về máy · Bỏ nháp…", thoát: khóa trống + base đúng → R2 → queued, base đổi → conflict. **Không** dùng `uwBadgeLocked` (FE-1/BE-7): trong bảng "Lý do bị chặn" của `EXPERIENCE.md` đó là badge **error** của khóa tài khoản/kho (`signed_out` `:149`, `foreign_account` `:150`, `store_newer` `:161`) — dùng lại sẽ đọc thành "tài khoản bị khóa". Tông info theo tiền lệ `document_archived` → info `uwBadgeArchived` (`:153`): bị chặn nhưng không ai sai, tự hết khi người kia nhả. `mapBlockedReason` (thêm case trước `default` `:198`) và `queue/machine.ts` ánh xạ 423 `document_locked` → lý do này (không rơi vào `permission_revoked`). Thẻ (c) thêm một hàng vào bảng `EXPERIENCE.md:146-161` (`document_locked` · `uwReasonEditLocked` · info `uwBadgeEditing` · hành động · thoát như trên) và cùng tên/tông trong bản đồ badge của fork; `document_locked` vào `SYNC_CENTER_DISCARDABLE_BLOCKED_REASONS` (`:139-144`) vì có "Bỏ nháp…" |
| **G5-11** (UNI-1358), `origin/feature/UNI-1358-g5-11-session-lock` @`7ea45998` | `beforeSignOut`/`afterSignOut`/`enforce` (`uniwork-docs/account-boundary.ts:135-219`), `lockSession` 6 bước (`uniwork-docs/service.ts:1762-2122`) | Trước bước 1 của `lockSession`: nhả mọi khóa đang giữ của tài khoản (R4, best effort, có giới hạn thời gian, song song chờ receipt); offline → bỏ qua (hold tự hết, server nhả khi nhận thu hồi phiên). Test "logout A→B nhả khóa" |
| **G5-09w / G5-03w** (web, đã ở D) | — | Frame web: xem mục 11.4 (thông điệp `doc.editLock`); hộp thoại xung đột của frame không mở cho 423 |

AC G5 bị ảnh hưởng: G5-A04 (thư viện offline: mở chỉ đọc khi không hold), G5-A07 (lease: thêm hold), G5-A08 (conflict: biến thể khóa). Thẻ (c) sửa lời các hàng đó trong `docs/office/g5g6g7/acceptance-rows.json` + `acceptance.md` cùng commit.

### 10.3 Client realtime user-scope trên desktop (ADV-1)

Hôm nay app desktop (fork) **không có** client realtime: feed tài liệu (`apps/shell/src/main/uniwork-sync/feed/`) chỉ mang thay đổi tài liệu, và sự kiện scope user — `office_lease.revoked` (`catalogue.go:295`) cũng như các sự kiện khóa mới — không tới được app (mục 0.5). Amendment G5:

- **Thêm** vào process main của shell (`apps/shell/src/main/uniwork-sync/realtime/`, thẻ (c)) một client WebSocket `GET /api/v1/ws?workspace_slug=org/ws` (workspace đang chọn) mỗi tài khoản đang đăng nhập; token gửi trong khung `auth` đầu tiên, không trên URL (`server/internal/handler/ws.go:48-63`), và token phiên thiết bị được nhận — `wsIdentity` kiểm phiên thiết bị bị thu hồi như HTTP (`ws.go:65-75`). Kiểm tra Origin không cần ngoại lệ cho client không phải trình duyệt: `checkOrigin` (`server/internal/realtime/hub.go:233-247`) nhận Origin rỗng và Origin có host trùng `Host` của server (Q7, đã đóng). Sự kiện scope user được hub định tuyến theo `user_id` (`RealtimeConsumer`), nên một socket nhận mọi sự kiện user của người đó; sự kiện scope workspace chỉ của workspace đang chọn. Kết nối lại có backoff; sau mỗi lần nối lại, app đọc lại R1 của các tài liệu đang mở để sửa và gia hạn lease như lúc online lại (sự kiện lỡ trong lúc rớt không được phát lại).
- Client chỉ chuyển tiếp **id** tới nơi xử lý, không giữ payload (ADR 0015):
  - `office_lease.revoked` → `LeaseManager.handleFeedRevoked(payload)` (G5-08c, `lease/manager.ts:767` @`1e5f8dfe`, lane `g5-lease_local`): app đang online khóa tài liệu ngay (DOC-005 hàng 16, §6.2.2), cache đã commit đánh dấu xóa, nháp giữ.
  - `document.lock_changed`, `document.lock_taken_over`, `document.edit_requested`, `document.edit_request_answered` → client khóa của shell (`uniwork-sync/edit-lock/`, mục 12 thẻ c): đọc lại R1, cập nhật IPC trạng thái `mine|other|lost` tới renderer (mục 11.2). `lock_taken_over` làm editor đang mở chuyển chỉ đọc ngay, không chờ heartbeat kế (≤ 30 s).
  - Phiên thiết bị của chính app bị thu hồi **không** tới dưới dạng khung `session.revoked`: sự kiện đó là `ScopeNone` (`server/internal/outbox/catalogue.go:147`, `RealtimeConsumer` không đăng ký nó) và chỉ đi qua `AccessRevoker` ở lane notify (`server/internal/realtime/access_revoker.go:91-92`), gọi `Hub.DisconnectSession` (`hub.go:872-878`) đóng socket với mã **4001** (`CloseSessionEnded`, `hub.go:58-61`). Mã 4001 **không** tự nó nghĩa là phiên bị thu hồi: server dùng cùng mã cho token truy cập hết hạn (socket tự đóng đúng hạn token, "token expired": `hub.go:1411-1416`, token sống 15 phút: `AccessTokenTTL`, `server/internal/config/config.go:253`) lẫn cho phiên bị thu hồi/kết thúc ("session ended", `DisconnectSession` ở trên), và hợp đồng của hub là "client làm mới phiên trước khi nối lại" (`hub.go:58-61`). Vì vậy shell xử lý một socket đóng mã 4001 như sau: (1) **làm mới phiên** qua đường làm mới sẵn có của app desktop rồi nối lại với token mới. Điểm vào của fork (`origin/main` @`71a2a2274`): `SessionCore.refresh()` (`apps/shell/src/main/uniwork-auth/session-core.ts:216`, một lần làm mới đang chạy dùng chung, tự áp trạng thái lỗi rồi ném lại), là đường mà `getAccessToken()` (`uniwork-auth/index.ts:284`) và `authorizedRequest` (`index.ts:500`) cùng dùng; cần làm mới **cưỡng bức** vì `getAccessToken()` trả luôn token còn hạn mà không làm mới (`session-core.ts:169-174`), trong khi phiên bị thu hồi có thể còn token chưa hết hạn — tên hàm export dùng cho việc này (và cách phân biệt "refresh trả 401" với lỗi tạm qua trạng thái tài khoản: `session-expired`/`signed-out` so với `server-unreachable`, `classifyTransportFailure` ở `uniwork-auth/mapping.ts:26`) **do lane fork xác nhận** khi viết thẻ (c); (2) làm mới thành công → nối lại, **không** đăng xuất, khóa đang giữ vẫn được heartbeat giữ (đúng đường nối lại ở mục đầu: đọc lại R1, gia hạn lease); (3) chỉ khi làm mới thất bại vì phiên bị thu hồi/kết thúc (refresh trả 401: `device_revoked`, `refresh_reused`, refresh token hết hạn) shell mới chạy đường đăng xuất/khóa phiên của G5-11 (nhả các khóa đang giữ, như HTTP 401 `device_revoked` đã có); (4) làm mới thất bại tạm thời (mạng, server không với tới được) **không** đăng xuất: thử lại với backoff, và khóa đang giữ tự hết theo TTL nếu mất kết nối lâu. Mã đóng khác chỉ kết nối lại có backoff, không làm mới.
- `document.lock_changed` của tài liệu ở workspace **khác** workspace đang chọn không tới socket này: tài liệu đó vẫn đúng nhờ heartbeat 30 s (mất khóa) và R1 lúc mở (người giữ) — chấp nhận, ghi trong test.
- Offline: không có socket; các luật hold/lease ở 10.1 giữ nguyên.
- Test (thẻ c): `apps/shell/tests/uniwork-sync-realtime.test.ts` với server WS giả: "office_lease.revoked → handleFeedRevoked called once with the ids; document locks within one event"; "document.lock_taken_over → editor IPC state lost before the next heartbeat"; "reconnect → R1 reread for open editors"; "workspace-scope frame of another workspace is ignored"; "socket closed with code 4001 on token expiry → the session is refreshed and the socket reconnects, no sign-out, the held lock is kept by the heartbeat"; "socket closed with code 4001 on a revoked session → refresh answers 401 → the G5-11 sign-out path runs and held locks are released"; "refresh fails on the network after a 4001 → retry with backoff, no sign-out"; "any other close code → reconnect with backoff, no refresh"; "the client sends no Origin header (or the target origin) and sends the auth frame first".

## 11. Hợp đồng host "chỉ đọc vì đang bị khóa" và UI

### 11.1 Đề xuất thông điệp host → frame (web) — **đề xuất**, chưa phải protocol

Thay đổi frame protocol là thay đổi **hai repo** do lane fork sở hữu; X-02 sở hữu hình dạng protocol (`types.ts:21` "additive or announced"; nguồn sự thật `contract-p0.md`/`contract-collab.md`). Phụ lục này chỉ đề xuất:

```ts
// additive (UNI-1645, proposal): edit-lock state of the open document.
// Host → frame event. Unlike doc.blocked it is reversible.
interface DocEditLockPayload {
  document_id: string
  state: 'mine' | 'other' | 'lost'
  holder?: { id: string; name: string }   // state 'other' | 'lost'
  since?: string                          // ISO 8601
  expires_at?: string
  offline_hold_until?: string
  reason?: 'taken_over' | 'handed_over' | 'expired' | 'moved_here' | 'access_lost'   // state 'lost'
}
// HostEvents['doc.editLock']: DocEditLockPayload
// Capability: 'editLock' — frame announces it understands doc.editLock.
```

Hành vi frame: `other`/`lost` → nội dung (cả thay đổi chưa lưu) giữ nguyên, chuyển chỉ đọc, từ chối Save/Save As, hiện thanh lý do; nếu dirty, thanh có "Tải bản của tôi" (dùng đường `api.download`/bước `download` sẵn có của `conflict-dialog.ts`). `mine` → bỏ chỉ đọc **không nạp lại** (host đã đảm bảo bản đang mở là head trước khi gửi). Không phải `doc.blocked` vì `doc.blocked` là một chiều và lý do lạ đọc thành `permission_revoked` (`docs-frame-protocol.ts:678-697`) — sẽ sai nghĩa.

**423 khi frame Lưu** (FE-2; host web, thẻ (b)). Hôm nay `save` trong `docs-frame-api.ts:224-248` chỉ đổi **409** thành `{ok: false, error}` (`:245`) — câu trả lời đó frame hiểu là base cũ và mở hộp thoại xung đột (Tải lại / Ghi đè); mọi lỗi khác bị ném lại. Luật mới, cùng `catch` đó:
1. `ApiError` status **423** (`code: "document_locked"`) **không bao giờ** thành `{ok: false}` (sẽ đưa người dùng vào "Ghi đè", trái mục 3.3).
2. Host chuyển trạng thái khóa của phiên frame sang `lost` (`reason` lấy từ R1 đọc lại; không đọc được → `taken_over` nếu `fields.holder_id` ≠ mình, ngược lại `moved_here`) — cùng hàm mà heartbeat `edit_lock_lost` gọi, nên banner/hộp thoại của host cập nhật như mọi đường mất khóa.
3. Frame có capability `editLock`: host gửi `doc.editLock {state: 'lost', …}` **trước**, rồi trả lời lần save đó bằng cùng lỗi chỉ đọc mà host dùng khi tự từ chối (`throw readOnly("api.save")`, mã `forbidden`, `use-docs-frame-session.ts:144`) — frame đã ở chỉ đọc nên không hiện thêm hộp thoại nào.
4. Frame chưa có capability: cũng `throw readOnly("api.save")`; host hiện banner/hộp thoại mất quyền của mình phía trên frame (mục 11.3).
Test (thẻ b): `packages/core/office/docs-frame-api.test.ts` "commit 423 document_locked → readOnly refusal, never {ok:false}"; `packages/views/office/frame/use-docs-frame-session.test.tsx` "423 on save flips the host lock state to lost and sends doc.editLock when the frame has the capability".

Frame chưa có capability `editLock` (bản pin hiện tại): host vẫn tự từ chối `api.save` (đường `refused` ở `use-docs-frame-session.ts:144`, mã `forbidden`), hiện banner của host phía trên frame, frame giữ nội dung trong draft recovery C18. "Sửa ngay" với frame cũ = host gắn lại frame ở chế độ sửa sau khi lấy khóa (frame sạch nên không mất gì). Thiếu "Tải bản của tôi" cho frame cũ là rủi ro chấp nhận tới khi thẻ (c) ship (Q4).

### 11.2 Desktop

IPC tương đương từ main → editor (fork sở hữu), cùng trạng thái `mine|other|lost`; renderer hiện cùng banner, `DocLock` cục bộ giữ nguyên vai trò cửa sổ. Heartbeat/nhả/hold chạy ở main (`uniwork-sync`).

### 11.3 Trạng thái UI

| Trạng thái | Web trang | Office frame (web/desktop) |
| --- | --- | --- |
| Đang lấy khóa | nội dung hiện ngay, chỉ chặn nhập; **không** chip "Chỉ xem"/`Notice` chỉ đọc; spinner nhỏ ở header nếu quá 1 s (mục 9) | frame mở chỉ đọc, không thanh lý do |
| `mine` | editable; header không hiện gì thêm (không "đang sửa" cho chính mình) | editable |
| `other` (online) | banner info + avatar người giữ; "Lấy quyền sửa" (manage) / "Yêu cầu quyền sửa" (edit) | như trang, banner của host |
| `other` + hold offline | banner kèm giờ hết giữ | như trang |
| `other`, cùng người (tab/thiết bị khác) | banner "Bạn đang sửa ở cửa sổ khác" + "Sửa ở đây" | như trang |
| Trống (vừa nhả/hết hạn) | banner "Sửa ngay" | như trang |
| `lost` + sạch | về `other`/trống | như trang |
| `lost` + có thay đổi chưa lưu | hộp thoại mất quyền sửa (Tải bản của tôi / Tải lại bản mới nhất) | thanh trong frame (frame mới) hoặc banner host (frame cũ) |
| Yêu cầu đang chờ (người yêu cầu) | banner "Đã gửi yêu cầu…" + "Hủy yêu cầu" | như trang |
| Có yêu cầu tới (người giữ) | prompt trong editor | như trang |

Banner: `role="status"` (polite), một câu đọc mỗi lần đổi trạng thái; hộp thoại xác nhận lấy quyền và hộp thoại mất quyền là `alertdialog`, focus mặc định ở nút an toàn ("Hủy" / "Tải bản của tôi").

### 11.4 Câu chữ (vi trước, en; thêm hàng thuật ngữ vào `docs/conventions.md` ở thẻ (b))

Thuật ngữ đề xuất cho bảng danh từ sản phẩm (`docs/conventions.md:164-212`): **quyền sửa** = editing (khóa sửa hiển thị cho người dùng; không dùng chữ "khóa" vì trùng nghĩa "khóa tài liệu"/hạn chế), **đang sửa** = editing, **lấy quyền sửa** = take over editing, **yêu cầu quyền sửa** = request to edit, **giữ quyền sửa khi offline** = keep editing offline. Cùng bộ hàng đó thêm một hàng cho **offline** (FE-7): chế độ làm việc không có mạng của app giữ chữ **"offline"** viết thường trong câu tiếng Việt (như `workspace`), khớp chữ đã dùng trong spec/UX G5 ("thư viện offline", `EXPERIENCE.md:70`) và chuỗi 21 locale của fork (thẻ c); **"Ngoại tuyến"** chỉ dùng cho trạng thái hiện diện của một **người** (`presence_offline`, `vi.json:3844`). Hàng thuật ngữ ghi rõ cả hai để thẻ (b) và (c) dùng cùng một chữ.

| Khóa (`documents.editLock.*`) | vi | en |
| --- | --- | --- |
| `bannerOther` | `{{name}} đang sửa từ {{time}}. Bạn đang xem ở chế độ chỉ đọc.` | `{{name}} has been editing since {{time}}. You’re viewing read-only.` |
| `bannerOfflineHold` | `{{name}} giữ quyền sửa offline đến {{time}}.` | `{{name}} is keeping editing offline until {{time}}.` |
| `bannerSelfElsewhere` | `Bạn đang sửa tài liệu này ở cửa sổ khác.` | `You’re editing this document in another window.` |
| `editHere` | `Sửa ở đây` | `Edit here` |
| `bannerFree` | `Không còn ai sửa tài liệu này.` | `No one is editing this document now.` |
| `editNow` | `Sửa ngay` | `Edit now` |
| `takeOver` | `Lấy quyền sửa` | `Take over editing` |
| `takeOverTitle` | `Lấy quyền sửa từ {{name}}?` | `Take over editing from {{name}}?` |
| `takeOverBody` | `{{name}} sẽ chuyển sang chỉ đọc. Thay đổi chưa lưu của họ không bị xóa, họ vẫn tải về được.` | `{{name}} will switch to read-only. Their unsaved changes aren’t deleted and they can still download them.` |
| `takeOverConfirm` / `cancel` | `Lấy quyền sửa` / `Hủy` | `Take over` / `Cancel` |
| `request` | `Yêu cầu quyền sửa` | `Request to edit` |
| `requestSent` | `Đã gửi yêu cầu tới {{name}}. Yêu cầu hết hạn lúc {{time}}.` | `Request sent to {{name}}. It expires at {{time}}.` |
| `requestCancel` | `Hủy yêu cầu` | `Cancel request` |
| `requestNotReleased` | `{{name}} chưa nhả quyền sửa.` | `{{name}} is still editing.` |
| `requestAgain` | `Yêu cầu lại` | `Ask again` |
| `requestRateLimited` | `Bạn đã yêu cầu nhiều lần. Thử lại sau {{minutes}} phút.` | `You’ve asked several times. Try again in {{minutes}} min.` |
| `incomingTitle` | `{{name}} muốn sửa tài liệu này` | `{{name}} wants to edit this document` |
| `incomingAccept` | `Lưu và nhường quyền` | `Save and hand over` |
| `incomingDecline` | `Từ chối` | `Decline` |
| `incomingSaveFailed` | `Chưa lưu được nên chưa nhường quyền. Thử lại.` | `Couldn’t save, so editing wasn’t handed over. Try again.` |
| `handedToYou` | `{{name}} đã nhường quyền sửa cho bạn.` | `{{name}} handed editing to you.` |
| `lostTitle` | `Bạn không còn quyền sửa` | `You’re no longer editing` |
| `lostTakenOver` | `{{name}} đã lấy quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.` | `{{name}} took over editing. Your unsaved changes are still here.` |
| `lostExpired` | `Quyền sửa đã hết hạn vì một lúc lâu không liên lạc được với máy chủ (mất mạng hoặc máy ngủ). Thay đổi chưa lưu của bạn vẫn ở đây.` | `Editing expired because we couldn’t reach the server for a while (no network or the device slept). Your unsaved changes are still here.` |
| `lostHandedOver` | `Bạn đã nhường quyền sửa cho {{name}}. Thay đổi chưa lưu của bạn vẫn ở đây.` | `You handed editing to {{name}}. Your unsaved changes are still here.` |
| `lostMovedHere` | `Bạn đang sửa tài liệu này ở cửa sổ khác. Thay đổi chưa lưu ở cửa sổ này vẫn ở đây.` | `You’re now editing this document in another window. The unsaved changes in this window are still here.` |
| `lostAccessLost` | `Bạn không còn quyền sửa tài liệu này. Thay đổi chưa lưu của bạn vẫn ở đây.` | `You no longer have permission to edit this document. Your unsaved changes are still here.` |
| `lostGeneric` (lý do lạ / thiếu) | `Bạn không còn giữ quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.` | `You’re no longer editing. Your unsaved changes are still here.` |
| `lostDownload` | `Tải bản của tôi` | `Download my copy` |
| `lostReload` | `Tải lại bản mới nhất` | `Reload latest version` |
| `lostReloadConfirm` | `Tải lại sẽ bỏ thay đổi chưa lưu trên trang này. Tiếp tục?` | `Reloading discards the unsaved changes on this page. Continue?` |
| `holdStart` | `Giữ quyền sửa khi offline` | `Keep editing offline` |
| `holdActive` | `Giữ quyền sửa đến {{time}}` | `Editing kept until {{time}}` |
| `holdEnd` | `Bỏ giữ quyền sửa` | `Stop keeping editing` |
| `holdCapReached` | `Đã giữ tối đa. Kết nối lại để tiếp tục sửa.` | `Maximum hold reached. Reconnect to keep editing.` |
| `rowEditing` (hàng thư viện, header) | `đang sửa` | `editing` |
| `rowEditingLabel` (aria) | `{{name}} đang sửa` | `{{name}} is editing` |

Avatar người giữ: hàng thư viện (`documents-library-row.tsx`, cạnh `Badge` ở `:213-218`; mobile ở caption `:219-221`) và header tài liệu (`document-workspace.tsx`, fragment `actions` `:479-496`, cạnh chip chỉ đọc `:486`): avatar nhỏ + chữ "đang sửa", tooltip/`aria-label` `rowEditingLabel`. Biểu tượng theo `docs/conventions.md` › Icons (tên lucide chuẩn; ví dụ `PencilLine`), kiểm `scripts/lucide-aliases.test.mjs`.

## 12. Tách thẻ code (không code ở vòng này)

**Thẻ (a) — D server** · owner lane doc-lock_local · nhánh `feature/UNI-1645-edit-lock-server` từ root sau khi phụ lục merge.
Scope: migration mục 1.4; query sqlc `server/pkg/db/queries/document_edit_locks.sql` (`LockLiveDocumentEditLock`, `InsertDocumentEditLock`, `EndDocumentEditLock`, `HeartbeatDocumentEditLock`, `ClaimReservedDocumentEditLock`, `SetDocumentEditHold`, `ClearDocumentEditHold`, `ListLiveDocumentEditLocks`, `ListLiveDocumentEditLocksForSession`, `ListLiveDocumentEditLocksForUserInOrg`, `ListExpiredDocumentEditLocks`, `DeleteEndedDocumentEditLocks`, request CRUD + đếm rate) + `make sqlc`; service `server/internal/service/document_edit_lock.go` (lệnh R1–R10, lỗi mục 3.3, luật mục 2 gọi từ `fn` của `updateDocument` `document_pages.go:598+`, `commitFileVersion` `document_commit.go:341+`, `RestoreDocumentVersion` `document_versions.go:341` + `RestoreFileVersion` `document_commit.go:523`; lưu trữ nhả trong `documentBatchLifecycle` `document_lifecycle.go:652`); `document_edit_lock_sweep.go` + `document_edit_lock_consumer.go` (mục 3.5) đăng ký ở `cmd/server/main.go`; handler + route + SDI/SDO + `pathParamSDI` (mục 3.1–3.4); `error_class.go` + test; sentinel `ErrDocumentLocked` + outcome `locked` trong `documentSaveResult` (mục 3.3); catalogue ba nơi; audit actions (`auditActions()`, `cases`, test đường dùng lại — mục 5.1); notification kinds/rules/titles/prefs (server); config: khối `parseOptionalDuration` + kiểm chéo trong `Load` (mục 7) + `.env.example`; metric: `server/internal/metrics/documents.go` (struct, `NewDocuments`, `Collectors`), interface `service.DocumentMetrics` và `nopDocumentMetrics` (`document_metrics.go:56-74`) (mục 7); isolation: bảy bước mục 6 (`isolation_world_test.go`, `isolation_matrix_test.go`, `isolation_routes_test.go`, `isolation_references_test.go`).
Test: mọi test Go ở mục 8; `TestIsolationMatrix` (mục 6, bước 7: không `skipControl`, không route bị bỏ qua) / `TestIsolationRealtime`; `TestEditLockIDFromAnotherTenantIsRefused` (service: id nhiệm kỳ sống của tổ chức khác gửi tới PATCH, commit, commit frame, restore → 423, không ghi gì); `TestDocumentSaveOutcomeForLockIsNotConflict`; `TestEditLockReleaseWritersWriteTheirOwnRows`; `TestLoadRejectsBadEditLockConfig`; test metric (collector có trong registry); migration lint; `TestEveryQueryNamesItsTenant`; `audit_coverage_test.go`; `scripts/events-catalogue.test.mjs` + `scripts/env-example.test.mjs` (cloud runner).

**Thẻ (b) — D web (trang + host Office frame)** · owner lane doc-lock_local · nhánh `feature/UNI-1645-edit-lock-web`, sau (a) (hoặc song song trên contract + fake, rồi nối).
Scope: `packages/core/api/endpoints/documents-edit-lock.ts` (+ schema `parseWithFallback` + case malformed trong `documents-edit-lock.test.ts`); trường `edit_lock_id` trong `patchDocument`, `commitDocumentVersion`, `restore`, commit frame (`office-frame.ts:243`, `docs-frame-api.ts:240`); `documentKeys.editLock`, `listRoot`, `treeRoot` (`keys.ts`, mục 4); case realtime (`document-events.ts`); `packages/core/documents/edit-lock-session.ts` (máy trạng thái lấy/heartbeat/nhả/lost, mốc đơn điệu, sự kiện thức dậy) + `edit-lock-registry.ts` (mục 9) + hook `useDocumentEditLock(wsId, documentId, {canEdit, client})` dùng mutation (không đụng transport ngoài `api/endpoints`; nhả ở `pagehide` qua hàm endpoint có `keepalive`); lớp lỗi: `packages/core/types/document.ts:45-54` thêm `"locked"` vào `DOCUMENT_ERROR_CLASSES` (union `DocumentErrorClass` mà `isConflictClass` nhận, `errors.ts:101`), `errors.ts` thêm `CODE_TO_CLASS["document_locked"] = "locked"` (`:11`) — thiếu dòng này một 423 phân lớp `unknown` → `isConflictClass` false → pha `error` (`save-state.ts:316`) và máy cứ thử lại thay vì dừng (BE-11); `API_ERROR_CLASSES` (`api/http.ts`) không đổi vì server không gắn lớp cho mã này (mục 3.3); `save-state.ts` pha `locked` (dừng autosave, giữ nội dung); `auth/store.ts` `logout` nhả khóa qua registry trước `clearSession()` (mục 9); host frame: 423 ở `save` của `docs-frame-api.ts` theo mục 11.1 "423 khi frame Lưu"; "Tải bản của tôi" của trang = HTML (mục 9); views: `DocumentEditLockBanner`, `TakeOverDialog`, prompt yêu cầu, hộp thoại mất quyền (dùng lại khung `conflict-dialog.tsx` biến thể `locked`, không có "giữ bản tôi/ghi đè"), avatar ở hàng thư viện và header; `document-workspace.tsx` nối `canEdit && lock.state === 'mine'`; host frame: `use-docs-frame-session.ts` coi "không giữ khóa" như `viewOnly` + gửi `doc.editLock` khi frame báo capability; Inbox renderer ba kind; i18n vi+en (mục 11.4, gồm bốn khóa `lost*` theo lý do) + hàng thuật ngữ `docs/conventions.md` (gồm hàng **offline**).
Test: `edit-lock-session.test.ts` (edge 6, 13; pha "đang lấy khóa" không phát trạng thái chỉ đọc), `documents-edit-lock.test.ts` (malformed), `document-events.test.ts` (`lock_changed` invalidate `editLock` + tiền tố `listRoot`/`treeRoot`/`recent`/`sharedWithMe`, không `detail`), `auth/store.test.ts` (edge 10), `errors.test.ts` (`document_locked` → `"locked"`, không phải xung đột), `docs-frame-api.test.ts` + `use-docs-frame-session.test.tsx` (423 khi frame Lưu, mục 11.1), hộp thoại mất quyền: một case mỗi `reason` + `lostGeneric`, nút "Tải bản của tôi" tải `.html` đúng tên, `packages/views/documents/document-edit-lock-banner.test.tsx` (mọi hàng bảng 11.3), `take-over-dialog.test.tsx`, `documents-library-row.test.tsx` (avatar), `packages/views/notifications/*` (ba kind); e2e `e2e/document-edit-lock.spec.ts` hai browser context (A sửa → B chỉ đọc + 423 qua API; A đóng → B "Sửa ngay" không tải lại; A chết tab + chờ TTL; manager lấy quyền → A chỉ đọc, tải được bản của mình; B yêu cầu → A nhường; cùng người hai tab "Sửa ở đây") trên cloud runner; tester_visual vi/en × sáng/tối × desktop/mobile.

**Thẻ (c) — fork / desktop** · owner các lane G5 fork (Advisor định tuyến) · sau (a); phần protocol cần X-02 duyệt hình dạng.
Scope: mục 10.2 (G5-08c, G5-05, G5-09, G5-10, G5-11); **client realtime user-scope** của shell (mục 10.3, ADV-1: `apps/shell/src/main/uniwork-sync/realtime/`, nhận `office_lease.revoked` → `LeaseManager.handleFeedRevoked` của G5-08c, lane `g5-lease_local`, và bốn sự kiện khóa sửa → client khóa; socket đóng mã 4001 → làm mới phiên rồi nối lại; chỉ khi làm mới trả 401 (phiên bị thu hồi) mới vào đường đăng xuất G5-11, lỗi mạng thì backoff); client khóa ở `apps/shell/src/main/uniwork-sync/edit-lock/` (lấy/heartbeat ở main, `powerMonitor.resume`, nhả khi đóng tab); hold + đồng hồ; `edit_lock_id` trong intent và dispatch; lý do `document_locked` với badge mới info `uwBadgeEditing` + hàng mới trong `EXPERIENCE.md` (mục 10.2 G5-10); IPC trạng thái khóa tới renderer + banner; frame web: `doc.editLock` + capability `editLock` trong `web/docs/protocol/types.ts` (rồi vendor sang `packages/core/office/docs-frame-protocol.ts` của D — lockstep với (b)); chuỗi 21 locale theo mẫu fork.
Test: `edit-hold.test.ts` (edge 1, 5, 6, 8), `queue/machine.test.ts` (edge 2), `uniwork-sync-realtime.test.ts` (mục 10.3: thu hồi lease khóa ngay khi online; `lock_taken_over` chuyển chỉ đọc trước heartbeat kế; đóng mã 4001 do token hết hạn → làm mới + nối lại, không đăng xuất, khóa đang giữ vẫn được heartbeat giữ; đóng mã 4001 do phiên bị thu hồi → refresh trả 401 → đường đăng xuất G5-11 nhả khóa; làm mới lỗi mạng → backoff; client không gửi Origin (hoặc Origin đích) và gửi khung `auth` trước), sign-out (G5-11), conflict biến thể khóa (G5-09), sync center lý do mới + badge `uwBadgeEditing` (G5-10), protocol test cả hai repo.

| AC (UNI-1645) | Nội dung | Thẻ | Bằng chứng |
| --- | --- | --- | --- |
| EL-A01 | A mở để sửa, B mở: B chỉ đọc với tên A và thời điểm; lệnh lưu của B qua API nhận 423 | (a) + (b) | Go `TestEditLockWritesRefusedWith423` (PATCH, commit, frame commit, restore) + `TestEditLockErrorPrecedence`; views banner test; e2e bước 1 |
| EL-A02 | A đóng editor, hoặc trình duyệt A chết và qua TTL: B sửa được không tải lại | (a) + (b) | Go `TestEditLockSweeperExpires`, `TestReleaseEmitsLockChanged`; vitest "Sửa ngay"; e2e bước 2–3 |
| EL-A03 | Manager lấy quyền: editor A chỉ đọc, văn bản chưa lưu của A vẫn tải được; có dòng audit | (a) + (b) (+ (c) cho desktop) | Go `TestTakeOverAudited`; views hộp thoại mất quyền; e2e bước 4 (tải xuống có nội dung chưa lưu) |
| EL-A04 | Test Go service/handler/migration/isolation; views test banner + lấy quyền; e2e hai context | (a) + (b) | danh sách test ở trên, cloud runner |
| EL-A05 | Edge case 1–15 mỗi cái có test hoặc lý do (mục 8) | (a) + (b) + (c) | bảng mục 8 |

## 13. Ngoài phạm vi

Merge 3 ô, merge có trợ giúp (daff / WmlComparer), đồng tác giả realtime (UNI-662) — parked theo người dùng. Khóa theo đoạn/ô, khóa thư mục, khóa bình luận — không làm. Sửa nháp web qua đăng xuất (§5.3 "Web khác desktop") — không đổi.

## 14. Câu hỏi mở

| # | Câu hỏi | Khuyến nghị |
| --- | --- | --- |
| Q1 | Khi **không có khóa sống**, lệnh ghi không gửi `edit_lock_id` có được qua không (mục 2 luật 1), hay phải giữ khóa mới ghi được (chặt hơn, nhưng tab cũ lúc rollout, job Office và "tải bản mới" phải lấy khóa trước)? | Cho qua như mục 2 (kiểm revision vẫn chặn ghi đè); sau một bản phát hành khi mọi client đã gửi `edit_lock_id`, cân nhắc chặt hơn bằng flag |
| Q2 | Trần chuỗi giữ offline 24 h đặt lại khi nhả rồi lấy lại (một nhiệm kỳ mới) — người dùng có thể nối nhiều chuỗi nếu mỗi lần đều online. Có cần thời gian chờ giữa hai chuỗi? | Không cần: mỗi chuỗi mới cần online, người khác thấy giờ hết giữ, manager lấy lại được |
| Q3 | Yêu cầu hết hạn 15 phút kể cả khi người giữ đang giữ offline 8 h (họ không kịp thấy) | Giữ 15 phút; B được báo "A giữ quyền sửa offline đến <giờ>" và yêu cầu lại khi A online; thông báo Inbox của A vẫn còn |
| Q4 | Frame Office web bản pin hiện tại chưa có `doc.editLock`: thiếu "Tải bản của tôi" trong frame khi bị lấy quyền (chỉ còn draft recovery C18) | Chấp nhận tạm, thẻ (c) ưu tiên `doc.editLock` + bước tải bản trong frame; ghép vào lần re-pin frame kế tiếp (cần hỏi Advisor vì re-pin cần chụp lại golden G7-06) |
| Q5 | Đổi tên (`PATCH` chỉ `title`) không cần khóa, nhưng tăng `revision` làm autosave kế của người giữ có thể nhận 422 như hôm nay | Giữ; nếu thành phiền, tách revision metadata khỏi revision nội dung là việc riêng (không thuộc phụ lục này) |
| Q6 | Push mặc định cho `document_edit_requested` và `document_edit_taken_over` | Bật (cần phản hồi nhanh/có thể mất việc chưa lưu); hai kind còn lại chỉ in-app |
| Q7 | Client realtime của desktop (mục 10.3, ADV-1) mở `/api/v1/ws` từ process main (không phải trình duyệt): kiểm Origin của socket (`TRUSTED_PROXIES`, CLAUDE.md › Backend HTTP Rules) có nhận kết nối không gửi Origin trình duyệt không; và một socket chỉ gắn một workspace, nên `document.lock_changed` của workspace khác không tới | **Đã đóng (Advisor):** `checkOrigin` (`server/internal/realtime/hub.go:233-247`) nhận Origin rỗng và Origin có host bằng `Host` của server, nên WebSocket ở process main của shell (node ws/undici, không có Origin trình duyệt) không cần ngoại lệ phía server. Phần workspace: chấp nhận như đã viết (heartbeat 30 s + R1 lúc mở phủ), không mở nhiều socket |
