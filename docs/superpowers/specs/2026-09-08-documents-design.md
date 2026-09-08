# UniWork — Documents (soạn thảo cộng tác, phiên bản, chia sẻ, nhật ký truy cập, object storage)

> **Trạng thái:** in-progress — Đã duyệt 2026-09-08 (quangpd — UNI-437). Spec đầu tiên của Giai đoạn C (epic UNI-416); plan và sub-issue lập khi bắt đầu lát cắt 1 (§11).

**Ngày:** 2026-09-08
**Issue:** UNI-437 · C-01 · Bounded context Document · P0
**Parent:** UNI-416 · Giai đoạn C — Collaboration
**Phụ thuộc đã có:** F-08 audit + outbox (`internal/audit`, catalogue ba nơi), F-02 entitlement (meter `storage.bytes` đã giữ chỗ), F-10 actor (`created_by_kind`), F-11 feature flag theo org, F-09 AI gateway (context builder — nối nguồn `document` ở lát cắt 4), F-03 danh bạ (`foldForSearch`).
**Spec liên quan:** `2026-09-04-audit-domain-events-design.md`, `2026-09-04-tenant-subscription-entitlement-design.md` (§ meter `storage.bytes`), `2026-09-04-agent-actor-model-design.md` (§5.3 action type), `2026-09-04-ai-platform-gateway-design.md` (§3.5 context builder), `2026-08-27-workspace-permissions-design.md` (effective role), `2026-09-04-notifications-design.md` (kind mới), `2026-09-04-mobile-app-design.md` (đọc tài liệu trên mobile là đợt sau).
**Tham chiếu mã:** `server/internal/storage/storage.go` (`Storage`, `Presigner`, `DownloadPresigner`), `server/migrations/110_task_collaboration.up.sql` (bảng `attachments`: `object_key` + `object_url`), `server/internal/service/search_text.go` (`foldForSearch`), `server/migrations/135_member_profiles_search_idx.up.sql` (GIN trigram), `server/internal/service/idempotency.go` (`BeginIdempotent`, `revision_conflict`), `server/internal/featureflags/keys.go`, `packages/core/realtime/use-realtime-sync.ts`, `packages/views/layout/app-sidebar.tsx`, `packages/ui/markdown/`.
**Bản cũ (đối chiếu hành vi, không copy):** `../unidigiwork/src/routes/_authenticated/documents.tsx`, `documents.$id.tsx`, `src/lib/api/documents.functions.ts`, `src/lib/documents-storage.ts`, `supabase/migrations/*document*`, `tests/integration/10_document_access_isolation.sql`, Blueprint §15 `docs/architecture/UNIWORK_SAAS_ARCHITECTURE_BLUEPRINT_V1.0.md:731-776`.

> **Ghi chú số migration:** số `1NN_` trong spec là **giữ chỗ** nối tiếp `158` trên `develop` ngày 2026-09-08; số thật cấp khi viết plan.

## 1. Mục tiêu

Đội pilot viết và giữ tri thức ngay trong workspace: biên bản, quy trình, đề xuất, tài liệu dự án — thay vì rải ở Google Docs, Zalo và file đính kèm chat. Vision §5.2 mục 7 xếp Document vào Giai đoạn C; key point #1 "One Workspace for Work" chỉ đúng khi tài liệu là một thực thể hạng nhất có quyền, có lịch sử và được AI đọc theo quyền (key point #3, #4).

Tính chất đo được:

1. **Một tài liệu là một trang có cấu trúc**, không phải `<textarea>` markdown như bản cũ. Nội dung lưu dạng JSON có schema đóng (ProseMirror), server kiểm schema và rút văn bản thuần để tìm kiếm; client không được tin.
2. **Không mất chữ.** Tự lưu mỗi 2 giây khi có thay đổi với `revision`; hai người sửa chéo không ghi đè nhau: xung đột → 422 `revision_conflict` và UI giữ cả hai bản. Từ lát cắt 3, nhiều người gõ cùng lúc trên cùng trang qua CRDT.
3. **Phiên bản là mốc, không phải mỗi lần gõ.** Phiên bản tạo khi người dùng đặt tên, khi khôi phục, và tự động sau 10 phút không sửa kể từ thay đổi cuối. Khôi phục không xóa lịch sử: nó tạo phiên bản mới.
4. **Chia sẻ có thu hồi, mọi cấp.** Trong workspace theo membership; ra ngoài workspace (cùng tổ chức) theo người hoặc theo workspace khác; ra ngoài tổ chức bằng liên kết chỉ đọc có hạn, tắt được ở cấp tổ chức. Thu hồi có hiệu lực ngay ở lần đọc kế tiếp.
5. **Ai đã xem là dữ liệu.** Mỗi lần mở, tải, xuất tài liệu ghi một dòng `document_access_logs` có `correlation_id` và `actor_kind` — kể cả khi người đọc là agent. Người quản lý tài liệu xem được nhật ký này.
6. **File là tài liệu.** Tệp tải lên (PDF, DOCX, ảnh, bảng tính) là tài liệu `kind = file` với phiên bản, chia sẻ và nhật ký giống trang. DB chỉ giữ `object_key` + metadata; byte nằm ở object storage đã có (`S3_BUCKET`, MinIO on-prem). Dung lượng tính vào quota `storage.bytes` của tổ chức.
7. **Agent là đồng tác giả, không phải người ghi trực tiếp.** `created_by_kind = agent` có chỗ ngay từ schema; agent đọc theo quyền thành viên; agent ghi chỉ qua `agent_action_proposals` (ADR 0010) — action type định nghĩa ở đây, thực thi ở Giai đoạn A.
8. **Empty state trung thực.** Không có tài liệu thì nói cách tạo trang đầu tiên hoặc tải tệp; không có số dung lượng giả (bản cũ từng hiện "342.6 GB of 1 TB").

**Ngoài phạm vi C-01:** bình luận trên tài liệu (đợt sau, dùng cùng cơ chế `task_comments`/reactions của F-05 — câu hỏi mở §12.3), xuất PDF (chỉ Markdown/HTML), OCR/preview DOCX/XLSX phía server (mở bằng tải về), quét virus, ký số, template tài liệu, import từ Google Docs/Notion, wiki/knowledge base có cấu trúc (A-04), Work Graph edges (C-11 — spec này chỉ để lại `document_id` làm đích), mobile (C-08 đọc-only sau khi C-01 ship).

## 2. Quyết định đã chốt

| # | Quyết định | Vì sao |
|---|-----------|--------|
| 1 | **Hai `kind`: `page` (soạn trong app) và `file` (tệp tải lên)** trong cùng bảng `documents` | Một cây, một màn hình, một cơ chế chia sẻ/phiên bản/nhật ký; bản cũ tách "file record" khỏi "content" nên có hai đường quyền |
| 2 | **Cây trang bằng `parent_id`** (một trang có thể chứa trang/tệp con), sâu ≤ 5; không có bảng "folder" | Bản cũ dùng `folder` chuỗi tự do nên không có quyền và không kéo thả được; cây trang là mô hình người dùng đã quen (Notion, Confluence); folder là trang không có nội dung |
| 3 | **Nội dung `page` là ProseMirror JSON** với schema đóng (§3.7), server kiểm và rút `content_text`; editor là **TipTap** (React, ProseMirror, MIT) — dependency mới có lý do §7.4 | Là bộ editor React duy nhất có tích hợp Yjs chín; JSON có schema kiểm được, không HTML |
| 4 | **Bản làm việc ≠ phiên bản.** `documents.content` là bản làm việc tự lưu; `document_versions` là mốc (đặt tên / khôi phục / tự động sau 10 phút yên) | Phiên bản mỗi lần gõ làm bảng phình vô nghĩa; mốc là thứ người dùng quay lại |
| 5 | **Tự lưu có `revision`**; lệch → 422 `revision_conflict` (tái dùng `CheckTaskRevision` khái quát thành `CheckRevision`) | Không ghi đè im lặng; cùng hợp đồng lỗi với Tasks |
| 6 | **Đồng soạn thảo thời gian thực ở lát cắt 3, Go làm relay + kho update Yjs**, không dựng dịch vụ Node riêng | Hub WebSocket và Redis relay đã có; server chỉ cần lưu và phát byte update theo thứ tự — không cần hiểu CRDT; tránh thêm một process phải vận hành (câu hỏi mở §12.1) |
| 7 | **Ba mức quyền `view` / `edit` / `manage`**; không có `comment` cho đến khi có bình luận | Mức không có hành vi đi kèm là mức giả |
| 8 | **Visibility mặc định `workspace`** (mọi effective member CRUD như Tasks, spec quyền §3.3); **`restricted`** = chỉ người tạo, ws owner/admin và các share | Khớp ma trận quyền đã duyệt; "private by default" làm tài liệu đội thành tài liệu cá nhân |
| 9 | **Liên kết công khai chỉ `view`, bắt buộc hạn (mặc định 7 ngày, tối đa 90), thu hồi được, có bộ đếm; tổ chức tắt/bật bằng setting `documents.public_links` (mặc định tắt cho gói không có entitlement)** | Pilot cần gửi cho khách ngoài; mặc định tắt vì là bề mặt ẩn danh duy nhất của sản phẩm — C-10 pentest phải phủ |
| 10 | **Nhật ký truy cập là bảng riêng `document_access_logs`**, không ghi vào `audit_events` | Đọc không phải command (ADR 0009); khối lượng lớn; retention khác (câu hỏi mở §12.6) |
| 11 | **Tải lên/tải về đi qua Go** (multipart ≤ 50 MiB, tải về = 302 sang presigned GET 5 phút với `Content-Disposition: attachment`, fallback stream cho `LocalStorage`) | Không lộ credential storage cho client (bản cũ upload thẳng Supabase); presigned đã có trong `storage.Presigner` |
| 12 | **Ảnh dán vào trang là `document_assets`** (bảng riêng, cùng object storage), URL trong JSON là `asset://{id}` và được resolve khi render | Không có URL tuyệt đối trong nội dung → đổi bucket/CDN không phá tài liệu; dọn rác được |
| 13 | **Xóa hai bước:** archive (ẩn, khôi phục được, 30 ngày) → purge bởi job (xóa row + object) | Không có nút xóa vĩnh viễn ngay trên UI; audit giữ |
| 14 | **Feature flag `documents`** theo org (mặc định tắt), route và nav ẩn khi tắt; entitlement flag `documents.public_links`, quota `storage.bytes` | Đúng luật rollout (FEATURE_WORKFLOW bước 4, bước 7) |
| 15 | **Không port mã bản cũ.** Kế thừa: mô hình quyền (user/workspace/tenant share), 9 case cách ly, nhật ký truy cập, `storage_ref` chỉ là con trỏ. Bỏ: textarea markdown, comments client-side, "lịch sử" trong bộ nhớ, `DocumentApi` NOT_IMPLEMENTED, quota giả | §10 |

## 3. Dữ liệu

Mọi bảng có `organization_id` (ADR 0008); bảng có `created_by` có `created_by_kind` (ADR 0007); không FK, index `CONCURRENTLY` mỗi file (ADR 0001); id ULID `TEXT` (ADR 0002).

### 3.1 `159_documents`

```sql
CREATE TABLE documents (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  parent_id         TEXT,                          -- NULL = gốc; kiểm chu trình + depth ≤ 5 ở service
  kind              TEXT NOT NULL,                 -- 'page' | 'file'
  title             TEXT NOT NULL,                 -- 1..500 ký tự
  icon              TEXT,                          -- emoji, ≤ 8 ký tự
  visibility        TEXT NOT NULL DEFAULT 'workspace', -- 'workspace' | 'restricted'
  content           JSONB,                         -- page: ProseMirror JSON (§3.7); file: NULL
  content_text      TEXT NOT NULL DEFAULT '',      -- server rút từ content; file: tên tệp
  search_text       TEXT NOT NULL DEFAULT '',      -- foldForSearch(title + content_text[:20k])
  content_bytes     INTEGER NOT NULL DEFAULT 0,    -- len(content) để giới hạn 2 MiB
  current_version   INTEGER NOT NULL DEFAULT 0,    -- số phiên bản mới nhất
  file_version_id   TEXT,                          -- file: id document_versions đang là bản hiện hành
  revision          BIGINT NOT NULL DEFAULT 1,
  position          DOUBLE PRECISION NOT NULL DEFAULT 0, -- thứ tự trong cây (cùng position.ts của Tasks)
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,                 -- 'human' | 'agent' | 'system'
  updated_by        TEXT NOT NULL,
  updated_by_kind   TEXT NOT NULL,
  content_saved_at  TIMESTAMPTZ,                   -- lần tự lưu cuối (đầu vào cho auto-version)
  last_version_at   TIMESTAMPTZ,
  archived_at       TIMESTAMPTZ,
  archived_by       TEXT,
  purge_after       TIMESTAMPTZ,                   -- archived_at + 30 ngày
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documents_kind_check CHECK (kind IN ('page','file')),
  CONSTRAINT documents_visibility_check CHECK (visibility IN ('workspace','restricted')),
  CONSTRAINT documents_content_kind_check CHECK ((kind = 'page') OR (content IS NULL))
);
```

Index (`160`–`163`, mỗi file một index):

```sql
-- 160: cây và danh sách theo workspace
CREATE INDEX CONCURRENTLY idx_documents_ws_parent
  ON documents (workspace_id, parent_id, position) WHERE archived_at IS NULL;
-- 161: "gần đây" và sidebar
CREATE INDEX CONCURRENTLY idx_documents_ws_updated
  ON documents (workspace_id, updated_at DESC) WHERE archived_at IS NULL;
-- 162: tìm kiếm (cùng cơ chế member_profiles 135)
CREATE INDEX CONCURRENTLY idx_documents_search
  ON documents USING gin (search_text gin_trgm_ops);
-- 163: job purge
CREATE INDEX CONCURRENTLY idx_documents_purge
  ON documents (purge_after) WHERE archived_at IS NOT NULL;
```

### 3.2 `164_document_versions`

```sql
CREATE TABLE document_versions (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  document_id       TEXT NOT NULL,
  version           INTEGER NOT NULL,              -- 1, 2, 3… theo document
  kind              TEXT NOT NULL,                 -- 'page' | 'file' (snapshot kind lúc đó)
  reason            TEXT NOT NULL,                 -- 'manual' | 'auto' | 'restore' | 'upload' | 'agent'
  label             TEXT,                          -- ≤ 200 ký tự, chỉ manual/restore
  content           JSONB,                         -- page
  object_key        TEXT,                          -- file
  mime_type         TEXT,
  size_bytes        BIGINT NOT NULL DEFAULT 0,     -- page: len(content); file: kích thước tệp
  checksum_sha256   TEXT,                          -- file (Blueprint §15)
  restored_from     INTEGER,                       -- reason = restore
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_reason_check CHECK (reason IN ('manual','auto','restore','upload','agent')),
  CONSTRAINT document_versions_payload_check CHECK ((kind = 'page' AND content IS NOT NULL) OR (kind = 'file' AND object_key IS NOT NULL))
);
-- 165
CREATE UNIQUE INDEX CONCURRENTLY uidx_document_versions_doc_version ON document_versions (document_id, version);
```

Bảng chỉ INSERT từ service; không có command sửa/xóa phiên bản (purge xóa theo document).
Trần: ≤ 500 phiên bản mỗi tài liệu; đến trần thì phiên bản `auto` cũ nhất bị gộp (xóa) bởi job
`DocumentVersionCompactor` — phiên bản `manual`/`restore`/`upload` không bao giờ bị gộp.

### 3.3 `166_document_assets`

```sql
CREATE TABLE document_assets (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  document_id       TEXT NOT NULL,
  object_key        TEXT NOT NULL,
  mime_type         TEXT NOT NULL,                 -- allowlist ảnh: image/png, jpeg, gif, webp
  size_bytes        BIGINT NOT NULL,
  width             INTEGER,
  height            INTEGER,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  orphaned_at       TIMESTAMPTZ                    -- không còn được content tham chiếu; purge sau 7 ngày
);
-- 167
CREATE INDEX CONCURRENTLY idx_document_assets_doc ON document_assets (document_id);
```

### 3.4 `168_document_shares`

```sql
CREATE TABLE document_shares (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,                 -- workspace của tài liệu
  document_id       TEXT NOT NULL,
  principal_type    TEXT NOT NULL,                 -- 'user' | 'workspace' | 'organization'
  principal_id      TEXT NOT NULL,                 -- user_id | workspace_id | organization_id (= organization_id)
  level             TEXT NOT NULL,                 -- 'view' | 'edit' | 'manage'
  granted_by        TEXT NOT NULL,
  granted_by_kind   TEXT NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoked_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_shares_principal_check CHECK (principal_type IN ('user','workspace','organization')),
  CONSTRAINT document_shares_level_check CHECK (level IN ('view','edit','manage'))
);
-- 169: một share sống cho mỗi (document, principal)
CREATE UNIQUE INDEX CONCURRENTLY uidx_document_shares_live
  ON document_shares (document_id, principal_type, principal_id) WHERE revoked_at IS NULL;
-- 170: "được chia sẻ với tôi"
CREATE INDEX CONCURRENTLY idx_document_shares_principal
  ON document_shares (principal_type, principal_id) WHERE revoked_at IS NULL;
```

Thu hồi là đặt `revoked_at` (không DELETE): lịch sử "ai từng có quyền" nằm trong bảng, không cần đào audit.
Cấp lại sau thu hồi = dòng mới. Principal bắt buộc cùng `organization_id` với tài liệu (kế thừa
`PRINCIPAL_NOT_IN_TENANT`); `user` phải là org member chưa `deactivated_at`.

### 3.5 `171_document_share_links`

```sql
CREATE TABLE document_share_links (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  document_id       TEXT NOT NULL,
  token_hash        TEXT NOT NULL,                 -- sha256(token); token 32 byte random, chỉ trả một lần lúc tạo
  expires_at        TIMESTAMPTZ NOT NULL,          -- ≤ now + 90 ngày
  view_count        INTEGER NOT NULL DEFAULT 0,
  last_viewed_at    TIMESTAMPTZ,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoked_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 172
CREATE UNIQUE INDEX CONCURRENTLY uidx_document_share_links_token ON document_share_links (token_hash);
-- 173
CREATE INDEX CONCURRENTLY idx_document_share_links_doc ON document_share_links (document_id) WHERE revoked_at IS NULL;
```

Liên kết chỉ `view`, luôn có hạn; DB không giữ token gốc. Một tài liệu có ≤ 5 liên kết sống.

### 3.6 `174_document_access_logs`

```sql
CREATE TABLE document_access_logs (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  document_id       TEXT NOT NULL,
  version           INTEGER,                       -- phiên bản đã mở/tải (NULL = bản làm việc)
  action            TEXT NOT NULL,                 -- 'view' | 'download' | 'export' | 'link_view'
  actor_kind        TEXT NOT NULL,                 -- 'human' | 'agent' | 'system' | 'anonymous'
  actor_id          TEXT,                          -- NULL khi anonymous
  via               TEXT NOT NULL,                 -- 'member' | 'share' | 'link' | 'ai_context'
  share_link_id     TEXT,
  correlation_id    TEXT NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_access_logs_action_check CHECK (action IN ('view','download','export','link_view')),
  CONSTRAINT document_access_logs_via_check CHECK (via IN ('member','share','link','ai_context'))
);
-- 175
CREATE INDEX CONCURRENTLY idx_document_access_logs_doc_time ON document_access_logs (document_id, occurred_at DESC);
-- 176
CREATE INDEX CONCURRENTLY idx_document_access_logs_org_time ON document_access_logs (organization_id, occurred_at DESC);
```

Ghi bởi service trong cùng request đọc, **ngoài** transaction đọc (INSERT riêng, lỗi ghi log không
làm hỏng response nhưng có metric `document_access_log_failed_total`). Không IP, không user-agent
(không PII ngoài id; anonymous là `actor_id NULL`). Gộp: cùng `(document_id, actor_id, action)`
trong 5 phút không ghi thêm dòng (kiểm ở service bằng query dòng cuối, không cần bảng phụ).
`via = 'ai_context'` ghi khi context builder của gateway đọc tài liệu cho một câu hỏi Ask UNI
(lát cắt 4) — người quản lý thấy "UNI đã đọc tài liệu này để trả lời cho X".

### 3.7 Schema nội dung (`page`)

`content` là ProseMirror JSON `{type:'doc', content:[…]}`. Tập node/mark **đóng**, giữ ở
`server/internal/document/schema.go` và `packages/core/documents/schema.ts` (test so hai nơi):

| Node | Attr cho phép |
|---|---|
| `paragraph`, `heading{level 1..3}`, `bulletList`, `orderedList{start}`, `listItem`, `taskList`, `taskItem{checked}`, `blockquote`, `codeBlock{language}`, `horizontalRule`, `hardBreak` | như ghi |
| `image{src, alt, width}` | `src` **phải** là `asset://{ulid}` — URL ngoài bị loại |
| `table`, `tableRow`, `tableCell{colspan,rowspan}`, `tableHeader` | ≤ 200 hàng × 20 cột |
| `mention{kind:'user'|'task'|'document'|'meeting', id, label}` | id ULID; label là snapshot, client re-resolve theo quyền |
| `text` với mark `bold`, `italic`, `underline`, `strike`, `code`, `link{href}` | `href` chỉ `https://`, `mailto:`, hoặc đường dẫn nội bộ từ `paths` |

Server: `document.Sanitize(raw) (content, text, err)` — node/mark/attr lạ bị **loại** (không lỗi),
`href`/`src` sai bị loại, kích thước JSON sau sanitize ≤ 2 MiB (hơn → 413 `document_too_large`),
rút `content_text` (nối text node, xuống dòng theo block) và `search_text`. Client render qua
TipTap với cùng schema nên node lạ không bao giờ tới DOM; không có `rehype-raw`.

### 3.8 Lát cắt 3 — `177_document_updates` (CRDT)

```sql
CREATE TABLE document_updates (
  id                TEXT PRIMARY KEY,              -- ULID: đơn điệu theo thời gian, dùng làm cursor
  organization_id   TEXT NOT NULL,
  document_id       TEXT NOT NULL,
  update            BYTEA NOT NULL,                -- Yjs update (opaque với server), ≤ 64 KiB
  client_id         TEXT NOT NULL,                 -- Yjs clientID của người gửi
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 178
CREATE INDEX CONCURRENTLY idx_document_updates_doc_id ON document_updates (document_id, id);
-- 179: thêm cột snapshot vào documents
ALTER TABLE documents ADD COLUMN crdt_state BYTEA, ADD COLUMN crdt_state_update_id TEXT;
```

Server không giải mã update. Client khi mở: `GET …/crdt` trả `crdt_state` + mọi update sau
`crdt_state_update_id`, áp vào `Y.Doc`. Khi gõ: gửi update qua WS frame `document.update`
(persist + fan-out đến scope `document:{id}`). Snapshot: client "chủ" (client có `clientID` nhỏ
nhất đang online) cứ 100 update hoặc 60 giây gửi `PUT …/crdt/snapshot {state, last_update_id}`;
server xóa update ≤ `last_update_id` trong cùng tx. `documents.content` (JSON) vẫn được tự lưu như
lát cắt 1 từ chính `Y.Doc` — đó là bản cho tìm kiếm, phiên bản, export, AI và cho client không
chạy CRDT (mobile đọc-only). Quy tắc "server không tin client" áp cho JSON (sanitize) chứ không
cho byte CRDT — byte chỉ đi tới client cùng quyền `edit`.

## 4. Quyền

Mức hiệu lực tính ở **một hàm** `DocumentService.effectiveLevel(ctx, actor, doc) (Level, via)`
(bảng test), là nguồn duy nhất cho mọi handler và cho `packages/core/permissions/rules.ts`
mirror (`canViewDocument`, `canEditDocument`, `canManageDocument`, mỗi rule cite dòng Go):

```
manage  nếu actor = created_by (human)                       via=member
     ∨  effective ws role ∈ {owner, admin} của doc.workspace  via=member
     ∨  share sống level=manage khớp actor/ws/org             via=share
edit    nếu visibility=workspace ∧ actor là effective member  via=member
     ∨  share sống level=edit                                 via=share
view    nếu share sống level=view                             via=share
     ∨  actor là agent member của workspace (luôn tối đa view) via=member
     ∨  liên kết hợp lệ (chưa hết hạn, chưa thu hồi)          via=link   (chỉ handler public)
none    còn lại → 404 (không lộ tồn tại)
```

`restricted`: bỏ dòng "visibility=workspace ∧ member". Share theo `workspace`/`organization`
áp cho **effective member** của principal đó tại thời điểm đọc (người rời workspace mất quyền
ngay — kế thừa case 7 bản cũ). Org member `deactivated_at` bị chặn ở cả hai gate như mọi nơi.

| Hành động | view | edit | manage | Ghi chú |
|---|---|---|---|---|
| Mở, tìm, xuất Markdown, tải file | ✓ | ✓ | ✓ | ghi access log |
| Sửa nội dung/tiêu đề, tạo phiên bản, khôi phục, tải phiên bản file mới, dán ảnh | | ✓ | ✓ | |
| Tạo trang con | | ✓ | ✓ | trang con kế thừa `visibility` cha lúc tạo, không kế thừa share (share theo từng tài liệu — câu hỏi mở §12.4) |
| Di chuyển sang cha khác | | ✓ (cả hai) | ✓ | cùng workspace |
| Share / thu hồi / đổi visibility / tạo-thu hồi liên kết | | | ✓ | liên kết còn cần entitlement `documents.public_links` + setting org bật |
| Xem nhật ký truy cập | | | ✓ | |
| Archive / khôi phục archive | | | ✓ | |
| Purge trước hạn | | | ws owner/admin | không có trên UI đợt này |

Agent: `RequireAgentMember` cho đọc; agent không bao giờ có `edit` trực tiếp — đề xuất ghi qua
proposal (§8). Platform admin `/admin/*` không đọc nội dung tài liệu (đã là luật F-11); admin chỉ
thấy đếm và dung lượng theo org.

## 5. API

Tag `Documents`; SDI/SDO ở `dto/{sdi,sdo}/document.go`; route `router/documents.go` sau
`RequireFeatureFlag("documents")` (404 `feature_disabled`); mọi route (trừ public) qua
`RequireMember`. Path param mới `{documentID}`, `{versionNo}`, `{shareID}`, `{linkID}`,
`{assetID}`, `{token}` → thêm `pathParamSDI`.

### 5.1 Tài liệu

| Method & path | Mô tả |
|---|---|
| `GET /workspaces/{workspaceID}/documents?parent_id=&q=&kind=&archived=0&updated_by=&cursor=&limit=50` | Danh sách phẳng theo cha (cây tải theo nhánh), hoặc tìm `q` (trigram trên `search_text`, tối đa 50, kèm `snippet` ≤ 160 ký tự từ `content_text`); chỉ trả tài liệu actor có ≥ view; `archived=1` cho manage |
| `GET /workspaces/{workspaceID}/documents/recent?limit=10` | Tài liệu tôi mở/sửa gần đây (từ access log + updated_by) cho Home và palette |
| `GET /workspaces/{workspaceID}/documents/tree?root=` | Cây tối đa 5 cấp `{id,title,icon,kind,children[]}` chỉ metadata, cho sidebar |
| `POST /workspaces/{workspaceID}/documents` `{title, kind:'page', parent_id?, icon?, content?, visibility?}` + `Idempotency-Key` | Tạo trang. `content` qua sanitize |
| `POST /workspaces/{workspaceID}/documents/files` multipart `file`, `parent_id?`, `title?` + `Idempotency-Key` | Tạo tài liệu `file`: kiểm MIME allowlist + kích thước ≤ 50 MiB + quota `storage.bytes` (delta = size) trong tx; ghi object trước, row sau; lỗi row → xóa object |
| `GET /documents/{documentID}` | Metadata + `content` (page) + `my_level` + `via` + `file` (mime, size, version) + `breadcrumbs`; **ghi access log `view`** |
| `PATCH /documents/{documentID}` `{title?, icon?, content?, visibility?, revision}` | Tự lưu / đổi tiêu đề. `revision` bắt buộc; lệch → 422 `revision_conflict` kèm `current_revision`; `content` qua sanitize; phát `document.content_changed` (ephemeral) và `document.updated` (outbox) **chỉ khi** title/icon/visibility đổi |
| `POST /documents/{documentID}/move` `{parent_id, position, revision}` | Đổi cha/thứ tự; chặn chu trình `document_cycle`, depth > 5 `document_too_deep`, khác workspace `cross_workspace_reference` |
| `POST /documents/{documentID}/archive` / `POST …/restore` | Archive / khôi phục (manage). Archive cha → mọi con archive cùng tx |
| `GET /documents/{documentID}/export?format=md\|html` | Xuất bản làm việc; **ghi access log `export`** |
| `GET /documents/{documentID}/download?version=` | File: 302 → presigned GET 5 phút `attachment; filename*=UTF-8''…`; local storage → stream; **ghi access log `download`** |

### 5.2 Phiên bản

| Method & path | Mô tả |
|---|---|
| `GET /documents/{documentID}/versions?cursor=&limit=50` | Danh sách (metadata, không content) |
| `GET /documents/{documentID}/versions/{versionNo}` | Nội dung phiên bản (page) hoặc metadata + link tải (file); ghi access log với `version` |
| `POST /documents/{documentID}/versions` `{label?}` | Tạo mốc `manual` từ bản làm việc; nếu bản làm việc không đổi so với phiên bản cuối → 409 `document_version_unchanged` |
| `POST /documents/{documentID}/versions/{versionNo}/restore` | Tạo phiên bản mới `restore` với `restored_from`, ghi vào bản làm việc, `revision + 1`; file: đổi `file_version_id` |
| `POST /documents/{documentID}/versions/file` multipart | File: tải phiên bản mới (`reason=upload`), quota, checksum |

### 5.3 Chia sẻ

| Method & path | Mô tả |
|---|---|
| `GET /documents/{documentID}/shares` | Share sống + liên kết sống (manage) hoặc chỉ `my_level` (khác) |
| `POST /documents/{documentID}/shares` `{principal_type, principal_id, level}` | Cấp; principal ngoài org → 422 `principal_not_in_organization`; trùng principal sống → cập nhật level (revoke dòng cũ + tạo mới trong tx) |
| `DELETE /documents/{documentID}/shares/{shareID}` | Thu hồi |
| `GET /workspaces/{workspaceID}/documents/shared-with-me` | Tài liệu tôi có qua share (kể cả từ workspace khác trong org) |
| `POST /documents/{documentID}/links` `{expires_in_days ≤ 90}` | Tạo liên kết; trả `url` + token **một lần**; cần `Can("documents.public_links")` và setting org; > 5 sống → 422 `document_link_limit` |
| `DELETE /documents/{documentID}/links/{linkID}` | Thu hồi |
| `GET /public/documents/{token}` (không auth, rate limit theo IP, không nằm sau flag org — kiểm flag theo org của tài liệu) | Trả title + content đã sanitize (page) hoặc 302 tải (file, presigned 5 phút); tăng `view_count`, access log `link_view` actor anonymous; hết hạn/thu hồi → 404 |

### 5.4 Ảnh trong trang, nhật ký, CRDT

| Method & path | Mô tả |
|---|---|
| `POST /documents/{documentID}/assets` multipart ≤ 10 MiB, MIME ảnh | Trả `{id, url}` với `url = /api/v1/documents/{id}/assets/{assetID}`; quota |
| `GET /documents/{documentID}/assets/{assetID}` | 302 presigned (5 phút, `inline` chỉ cho MIME ảnh allowlist) hoặc stream; quyền = view tài liệu |
| `GET /documents/{documentID}/access-logs?cursor=&limit=50&action=` | Manage; dòng có `actor` resolved qua `ActorService.Resolve` |
| `GET /documents/{documentID}/crdt` · `PUT /documents/{documentID}/crdt/snapshot` | Lát cắt 3 (§3.8); cần edit |

### 5.5 Lỗi ổn định

`revision_conflict` (422), `document_too_large` (413), `document_cycle`, `document_too_deep`,
`cross_workspace_reference`, `principal_not_in_organization`, `document_link_limit`,
`document_version_unchanged` (409), `unsupported_media_type` (415 — MIME ngoài allowlist hoặc
không khớp magic bytes), `file_too_large` (413), `quota_exceeded` / `entitlement_required`
(từ entitlement), `feature_disabled` (404), `forbidden` / `not_found`. Thêm một lần ở
`mapServiceError`.

MIME allowlist file: PDF, ảnh (png/jpeg/gif/webp), Office (docx/xlsx/pptx), OpenDocument, text/
markdown/csv, zip. **Không** nhận html/svg/js/exe; kiểm cả phần mở rộng lẫn `http.DetectContentType`.
Tải về luôn `attachment` (không render inline) trừ ảnh asset.

## 6. Sự kiện, realtime, worker

### 6.1 Catalogue (thêm ở ba nơi)

| Topic | v | Payload | Phạm vi | Cách gửi | Consumer |
|---|---|---|---|---|---|
| `document.created` | 1 | `document_id`, `workspace_id`, `parent_id?` | workspace | outbox | realtime |
| `document.updated` | 1 | `document_id`, `workspace_id` | workspace | outbox | realtime (title/icon/visibility/move — **không** phát cho tự lưu) |
| `document.archived` / `document.restored` / `document.deleted` | 1 | `document_id`, `workspace_id` | workspace | outbox | realtime |
| `document.version_created` | 1 | `document_id`, `version`, `workspace_id` | workspace | outbox | realtime |
| `document.shared` | 1 | `document_id`, `share_id`, `principal_type`, `principal_id` | user | outbox | realtime, notification — realtime consumer gửi tới user khi `principal_type=user`, tới workspace của tài liệu khi principal là workspace/organization |
| `document.share_revoked` | 1 | `document_id`, `share_id`, `principal_type`, `principal_id` | user | outbox | realtime (cùng cách giải quyết người nhận) |
| `document.link_created` / `document.link_revoked` | 1 | `document_id`, `link_id` | workspace | outbox | realtime |
| `document.content_changed` | 1 | `document_id`, `revision` | document | ephemeral | client mở tài liệu refetch (mất thì lần tự lưu sau bù) |
| `document.presence` | 1 | `document_id`, `user_id`, `state` | document | ephemeral | con trỏ/ai đang xem |
| `document.update` | 1 | `document_id`, `update_id` | document | ephemeral (đã persist trước khi phát) | CRDT lát cắt 3 |

Phạm vi **`document`** là phạm vi mới của relay (đăng ký/hủy khi mở/đóng tài liệu, giống `chat`
với phòng); hub kiểm quyền view lúc subscribe qua `effectiveLevel`. Ghi vào `docs/events/CATALOGUE.md`
§ Quy tắc.

Audit (`audit_coverage_test.go` thêm hàng): `document.created`, `document.updated` (diff
`title, icon, visibility, parent_id`), `document.archived`, `document.restored`, `document.deleted`,
`document.version_created`, `document.version_restored`, `document.shared`, `document.share_revoked`,
`document.link_created`, `document.link_revoked`, `document.file_uploaded`. Tự lưu nội dung **không**
audit từng lần (đã có phiên bản + `updated_by`); được thay bằng `document.version_created(auto)`.

### 6.2 Notification (kind mới, spec Notifications §4.1)

| Kind | Từ topic | Người nhận | `group_key` | Push mặc định |
|---|---|---|---|---|
| `document_shared` | `document.shared` (principal=user) | người được chia sẻ | `document:{id}:shared` | tắt |
| `mentioned` | `document.version_created` khi content có `mention{kind:user}` mới so với phiên bản trước | người được nhắc | `document:{id}:mention:{version}` | bật (kind đã có) |

### 6.3 Worker (đưa vào chuỗi shutdown `main.go`, có trang `docs/ops/RUNBOOK_DOCUMENTS.md`)

- `DocumentAutoVersioner` — mỗi 60 giây: tài liệu `page` có `content_saved_at > last_version_at`
  và `content_saved_at < now - 10 phút` → tạo phiên bản `auto` (system actor). Idempotent theo
  `(document_id, content_saved_at)`.
- `DocumentPurger` — mỗi giờ: `archived_at IS NOT NULL AND purge_after < now` → trong tx: xóa
  versions/assets/shares/links/updates, xóa row, audit `document.deleted` (system), rồi xóa object
  ngoài tx (`DeleteKeys`; thất bại → ghi vào `outbox` topic nội bộ `storage.delete_requested` để
  thử lại — không để rác bucket im lặng). Asset `orphaned_at < now - 7 ngày` cùng cách.
- `DocumentVersionCompactor` — mỗi ngày: gộp phiên bản `auto` vượt trần §3.2.
- Meter `storage.bytes` (snapshot): `CheckQuota` đếm `SUM(size_bytes)` của versions + assets chưa
  purge theo org; có index đủ để đếm trong < 50 ms ở 100k dòng (kiểm §9.4).

## 7. Frontend

### 7.1 File map

| Path | Trách nhiệm |
|---|---|
| `packages/core/types/document.ts` | `Document`, `DocumentKind`, `DocumentLevel`, `DocumentVersion`, `DocumentShare`, `DocumentShareLink`, `DocumentAccessLog`, schema lenient (`z.string()` cho enum) |
| `packages/core/documents/schema.ts` (+ `.test.ts`) | Tập node/mark đóng §3.7 dùng cho TipTap extensions; test so với `server/internal/document/schema.go` qua fixture JSON chung `docs/parity/document-schema.json` |
| `packages/core/api/endpoints/documents.ts`, `documents-share.ts`, `documents-files.ts` (+ `.test.ts`) | Mọi hàm §5, `parseWithFallback`, malformed test từng hàm; upload dùng `FormData` qua `request()` |
| `packages/core/documents/keys.ts` | `documentKeys.tree(wsId)`, `.list(wsId, filter)`, `.detail(id)`, `.versions(id)`, `.shares(id)`, `.accessLogs(id)`, `.recent(wsId)`, `.sharedWithMe(wsId)` |
| `packages/core/documents/hooks.ts`, `hooks-versions.ts`, `hooks-share.ts` | Query/mutation; `useAutosaveDocument(id)` debounce 2 s, gửi `revision`, xử lý `revision_conflict` → trạng thái `conflict` với hai bản; không optimistic cho create/delete/move |
| `packages/core/documents/export.ts` | `toMarkdown(content)` thuần (dùng cho mobile/agent sau) |
| `packages/core/realtime/use-realtime-sync.ts` | case `document.*` → invalidate keys; `document.content_changed` → invalidate `detail(id)` **chỉ khi** `revision` lớn hơn cache (tránh vòng lặp với chính mình); thêm `allWorkspaceKeys` |
| `packages/core/types/events.ts` | topic §6.1 |
| `packages/core/permissions/rules.ts` | `canViewDocument`, `canEditDocument`, `canManageDocument` mirror §4 |
| `packages/core/paths/paths.ts` | `workspace(org, ws).documents()`, `.document(id)`; `share.document(token)` → `/share/{token}`; reserved slug `share`, `documents` |
| `packages/core/feature-flags` | `useFlag("documents", false)` gate nav + route |
| `packages/views/documents/documents-page-view.tsx` | `/documents`: `CollectionPageHeader` (icon, "Tài liệu", đếm, nút "Trang mới" + "Tải tệp"), tab Tất cả / Gần đây / Được chia sẻ với tôi / Lưu trữ (manage); danh sách + cây bên trái |
| `packages/views/documents/document-tree.tsx` | Cây 5 cấp, mở/đóng, kéo thả đổi cha (cùng `position.ts`), bàn phím ←→↑↓ |
| `packages/views/documents/document-detail-view.tsx` | `/documents/{id}`: `BreadcrumbHeader` (cây › tiêu đề), trạng thái lưu ("Đã lưu 10:32" / "Đang lưu…" / "Xung đột"), nút Chia sẻ, Phiên bản, menu ⋯ (xuất, nhật ký, lưu trữ) |
| `packages/views/documents/document-editor.tsx` | **`next/dynamic`-free**: lazy qua `React.lazy` trong views (không `next/*`), chunk riêng; TipTap + extensions của schema; toolbar nổi; dán ảnh → upload asset → chèn `asset://` |
| `packages/views/documents/document-file-view.tsx` | `kind=file`: thẻ tệp (icon theo MIME, kích thước, phiên bản), nút Tải về / Tải phiên bản mới; không preview trong app đợt này (PDF cũng tải về — §12.5) |
| `packages/views/documents/conflict-dialog.tsx` | Khi 422: "Người khác vừa lưu" — xem bản của họ / giữ bản của tôi thành phiên bản `manual` "Bản của tôi lúc hh:mm" rồi nạp bản mới |
| `packages/views/documents/version-history-sheet.tsx` | Danh sách phiên bản, xem, khôi phục (confirm), đặt tên mốc |
| `packages/views/documents/share-dialog.tsx` | Visibility, thêm người/workspace/tổ chức + mức, danh sách share sống + thu hồi, mục Liên kết (ẩn khi entitlement/setting tắt, kèm lý do) |
| `packages/views/documents/access-log-sheet.tsx` | Bảng: ai (badge agent/anonymous), hành động, phiên bản, qua đâu, khi nào |
| `packages/views/documents/documents-empty.tsx` | "Chưa có tài liệu. Tạo trang đầu tiên hoặc tải một tệp lên." + hai nút |
| `packages/views/documents/public-document-view.tsx` | Trang `/share/{token}`: chỉ đọc, không shell, watermark "Chia sẻ bởi {org}", hết hạn → thông báo |
| `packages/views/layout/app-sidebar.tsx` | Mục `nav.documents` "Tài liệu" (sau Meetings), chỉ khi flag |
| `packages/views/search/search-command.tsx` | Nhóm "Tài liệu": gần đây + kết quả `q` (debounce 250 ms) |
| `packages/views/settings/components/documents-settings.tsx` | Tab tổ chức: bật/tắt liên kết công khai, hạn mặc định; dung lượng đã dùng / hạn mức (thật, từ entitlement) |
| `apps/web/app/[orgSlug]/[workspaceSlug]/documents/page.tsx`, `documents/[documentId]/page.tsx`, `apps/web/app/share/[token]/page.tsx` | Shell mỏng |

### 7.2 i18n & glossary (`docs/conventions.md` §2 thêm dòng)

| Concept | vi | en |
|---|---|---|
| document | **tài liệu** | Document |
| page (document kind) | **trang** | Page |
| file (document kind) | **tệp** | File |
| version | **phiên bản** | Version |
| share / revoke | **chia sẻ** / **thu hồi** | Share / Revoke |
| share link | **liên kết chia sẻ** | Share link |
| access log | **nhật ký truy cập** | Access log |
| archive | **lưu trữ** | Archive |

Mức quyền `view` / `edit` / `manage` là schema identifier: giữ chữ thường tiếng Anh trong giá trị,
nhãn dịch "Xem" / "Sửa" / "Quản lý". Keys `documents.*`, `nav.documents`, vi trước en.

### 7.3 Hành vi

- Tự lưu: debounce 2 s sau phím cuối, hoặc ngay khi rời trang (`beforeunload` + `keepalive`
  fetch trong `apps/web/platform`). Không lưu khi nội dung bằng lần lưu trước.
- Mở tài liệu đang có người khác sửa (lát cắt 1–2): banner "Minh đang sửa" từ presence; vẫn sửa
  được, xung đột xử lý qua dialog. Lát cắt 3 thay banner bằng con trỏ nhiều màu.
- Bàn phím: `⌘S` tạo mốc, `⌘⇧H` lịch sử, `/` menu block, `@` mention; toàn bộ dialog Tab được.
- Dark/light qua token; editor không hardcode màu; `prose` class từ `packages/ui` (cùng chỗ với
  markdown chat) để chat, Ask UNI và tài liệu đọc giống nhau.
- Mobile web: cây thu vào sheet; editor dùng được với bàn phím ảo ≥ 44 px toolbar.

### 7.4 Dependency mới (ghi lý do vào `pnpm-workspace.yaml` catalog và plan)

`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `-image`, `-table`
(4 gói), `-task-list`, `-task-item`, `-placeholder`, `-mention`, `-underline`; lát cắt 3: `yjs`,
`y-prosemirror`, `@tiptap/extension-collaboration`, `-collaboration-cursor`. Lý do: bộ editor
React trên ProseMirror có schema kiểm soát được, MIT, Yjs tích hợp sẵn; tự viết editor là việc
nhiều năm. `pnpm audit` và `knip` sạch; **budget**: route `documents/[documentId]` tải chunk editor
lazy, trần ratchet ghi số đo thật vào `scripts/bundle-budget.json`, mục tiêu ≤ 250 KB gzip chunk
route (shell 150 KB + editor); vượt thì tách extension table/mention thành chunk thứ hai.

## 8. Agent là đồng tác giả (định nghĩa ở C, thực thi ở A)

Thêm vào enum §5.3 spec agent (registry hằng số, plan Giai đoạn A implement):

| action_type | target | rủi ro | payload |
|---|---|---|---|
| `create_document` | document | low | `{title, parent_id?, content}` — content qua sanitize, ≤ 200 KiB |
| `append_to_document` | document | medium | `{document_id, content_blocks[]}` — nối vào cuối bản làm việc, tạo phiên bản `agent` |
| `replace_document_section` | document | high | `{document_id, heading_text, content_blocks[]}` — thay nội dung dưới một heading; có `undo_payload` là phiên bản trước |

Executor gọi `DocumentService` với `userID = decided_by`, `Origin{Kind:'agent_run'}` → service ghi
`updated_by_kind = agent`, phiên bản `reason = agent`, UI badge agent trên phiên bản. Không có
`delete_document`, không đổi share (critical → không tồn tại). Tóm tắt họp → "tạo tài liệu biên
bản" (C-03) đi qua `create_document` này khi agent chủ động; người bấm "Lưu thành tài liệu" là
human command bình thường.

Ask UNI (F-09, lát cắt 4): context builder thêm nguồn `document` (title + `content_text` cắt
1.200 ký tự quanh đoạn khớp), lọc bằng `effectiveLevel ≥ view` với actor là người hỏi, ghi
access log `via = ai_context`, citation `href` = `paths.document(id)`.

## 9. Kiểm thử bắt buộc

### 9.1 Go (Postgres thật, `-race`)

1. `TestDocumentIsolation` — ma trận kế thừa 9 case bản cũ: org B → 404 mọi route; org member không phải ws member và không share → 404; `restricted` ẩn với member thường; share `user` cấp/thu hồi có hiệu lực ngay; share `workspace` mất khi rời workspace; share `organization` mất khi `deactivated_at`; principal ngoài org → 422; versions/shares/assets/logs không có đường rò ngoài `effectiveLevel`; anonymous chỉ vào qua link hợp lệ.
2. `TestEffectiveLevelTable` — bảng: (visibility × role × share × link × actor_kind) → level, via.
3. `TestAutosaveRevision` — hai PATCH cùng `revision` song song: một 200, một 422 với `current_revision`; `revision` tăng đúng 1 mỗi lần thành công.
4. `TestSanitize` — node/mark/attr lạ bị loại; `src` không `asset://` bị loại; `href` `javascript:` bị loại; > 2 MiB → 413; `content_text` đúng thứ tự block; fixture chung với TS.
5. `TestVersions` — manual không đổi → 409; restore tạo phiên bản mới có `restored_from`, không xóa; file restore đổi `file_version_id`; trần 500 và compactor chỉ gộp `auto`.
6. `TestAutoVersioner` — 10 phút yên → 1 phiên bản; chạy lại không tạo thêm; sửa tiếp → tính lại.
7. `TestFileUpload` — MIME ngoài allowlist / magic bytes lệch → 415; > 50 MiB → 413; quota vượt → `quota_exceeded` và **không** còn object trong storage (fake storage đếm `Delete`); checksum khớp; download → 302 presigned với `attachment` và access log `download`.
8. `TestShareLinks` — hết hạn → 404; thu hồi → 404; > 5 → 422; entitlement tắt → `entitlement_required`; setting org tắt → `forbidden`; token không lưu dạng thô (grep DB); `view_count` tăng; rate limit public route.
9. `TestAccessLog` — GET ghi `view` với `correlation_id` = trace id; gộp 5 phút; lỗi INSERT không làm GET thất bại (metric tăng); agent đọc ghi `actor_kind = agent`.
10. `TestArchivePurge` — archive cha kéo con; restore; purger xóa row + object sau `purge_after`, audit `document.deleted` system; object xóa thất bại → có dòng outbox retry.
11. `TestTree` — chu trình → `document_cycle`; depth 6 → `document_too_deep`; move khác workspace → `cross_workspace_reference`.
12. `TestDocumentAuditAndOutbox` — mỗi command §6.1 có audit + outbox trong tx; rollback → không có gì; tự lưu **không** tạo audit.
13. Arch: chỉ `service/document*.go` gọi query `Document*`; `internal/document` (sanitize) không import `service`; `audit_coverage_test` có đủ hàng; `swagger_test` thấy mọi route; migration lint xanh.
14. Lát cắt 3: `TestCrdtRelay` — update persist trước khi phát; snapshot xóa update ≤ id; client không có `edit` bị từ chối subscribe; update > 64 KiB → 413.

### 9.2 Frontend

- Malformed-response test cho mọi endpoint; `schema.test.ts` so fixture với Go.
- `hooks.test.tsx`: autosave debounce, không gửi khi không đổi, `revision_conflict` → trạng thái `conflict`, không optimistic cho create/move.
- `use-realtime-sync.test.tsx`: `document.content_changed` với `revision` ≤ cache không invalidate; `document.shared` invalidate `sharedWithMe`.
- View tests: empty/error/data cho page view, tree (keyboard), share dialog (ẩn mục liên kết khi entitlement tắt kèm lý do), conflict dialog, version sheet, access-log sheet (badge agent/anonymous), public view (hết hạn).
- `permissions/rules.test.ts` mirror bảng §4; `parity.test`; `paths/consistency.test` (`documents`, `documents/[documentId]`, `share/[token]`).
- Bundle: `scripts/bundle-budget.mjs` xanh với ratchet ghi số đo.

### 9.3 E2E (Playwright, `e2e/documents.spec.ts`)

1. Luồng vàng: bật flag org → A tạo trang, gõ, reload → nội dung còn; đặt mốc; sửa tiếp; khôi phục mốc → nội dung cũ và lịch sử có 3 phiên bản.
2. Chia sẻ: A đặt `restricted`, B (cùng ws) mở → 404 UI "Không tìm thấy"; A share B `view` → B mở được, không có nút sửa; A thu hồi → B reload → 404; nhật ký của A có dòng B `view`.
3. Tệp: A tải PDF → thẻ tệp; tải về → file đúng byte; tải phiên bản 2 → lịch sử 2 phiên bản.
4. Liên kết: bật setting org → tạo link → tab ẩn danh mở được → thu hồi → 404.
5. Sáng/tối + contrast trên `/documents` và detail (`onboarding-contrast.spec` mở rộng).

### 9.4 Hiệu năng

k6 nightly (F-11) thêm kịch bản: 200 người dùng tự lưu tài liệu 200 KiB mỗi 2 s → p95 PATCH < 150 ms; tìm kiếm trigram trên 20k tài liệu p95 < 200 ms; `CheckQuota storage.bytes` với 100k dòng < 50 ms.

## 10. Kế thừa từ bản cũ & bỏ

| Bản cũ | Xử lý |
|---|---|
| `documents` + `document_versions` append-only, `(document_id, version)` unique | Kế thừa mô hình; tách bản làm việc khỏi phiên bản |
| `document_permissions` `{user, workspace, tenant} × {view, comment, edit, manage}` | Kế thừa principal ba loại; bỏ `comment` (§2 #7); thu hồi bằng `revoked_at` thay DELETE |
| `document_access_logs` với `action ∈ {view, download, print, export, share_view}` | Kế thừa; `print` bỏ (client không biết chắc), `share_view` → `link_view`; thêm `via`, `actor_kind`, `correlation_id` |
| 9 case `10_document_access_isolation.sql` | Chuyển thành `TestDocumentIsolation` Go (§9.1 #1), thêm case agent và anonymous |
| `storage_ref {provider, bucket, objectKey}` jsonb; Blueprint §15 (`checksum`, `classification`, `retention_until`) | Giữ `object_key` + `checksum_sha256` + `size_bytes` (một bucket cấu hình như `attachments`); `classification`/`retention_until` để C-06 (tenant export/delete) quyết |
| Quota `documents.storage_bytes` qua `check_quota`/`record_usage` | Dùng meter `storage.bytes` đã giữ chỗ ở F-02, mode snapshot |
| Sự kiện `document.document.created.v1`… | Đổi theo catalogue `<entity>.<verb>`, version là cột |
| Work-graph edges `ATTACHED_TO`, `GENERATES`, `REFERENCES`, `SHARED_IN` | Không port; C-11 định nghĩa lại; spec này chỉ có `mention{kind:'document'}` trong nội dung |
| `<textarea>` markdown + toolbar chèn ký tự; preview `pre-wrap` | **Bỏ**; TipTap + JSON schema |
| Comments panel `useState` không lưu; "Lịch sử" trong bộ nhớ | **Bỏ**; bình luận là câu hỏi mở §12.3; lịch sử = `document_versions` thật |
| `DocumentApi` `NOT_IMPLEMENTED`; upload thẳng Supabase Storage từ client; RLS theo segment path | **Bỏ**; mọi byte qua Go + presigned |
| "Storage 342.6 GB of 1 TB" mock; nút "Tạo tài liệu mới" NO_OP; member list 400 | **Bỏ**; dung lượng thật từ entitlement; E2E #1 chứng minh tạo được |
| G5 gap register: 26/173 case fail-closed quá tay | Bảng `effectiveLevel` có test dương (người có quyền mở được) song song test âm |
| IA V2: `Docs /documents`, `nav.documents` | Kế thừa route và vị trí nav; tên "Tài liệu" |

## 11. Phân rã delivery (mỗi mục một sub-issue dưới UNI-437, một plan)

1. **Nền + trang + phiên bản + tệp** — migration 159–167, `internal/document` sanitize, `DocumentService`, API §5.1–§5.2 (trừ shares), assets, worker AutoVersioner/Purger/Compactor, quota, flag `documents`, core endpoints/hooks, views page/tree/detail/editor/versions/file, nav, palette, E2E #1 #3 #5. **Bật flag cho org UNICOM sau lát cắt này.**
2. **Chia sẻ + liên kết + nhật ký truy cập** — migration 168–176, `effectiveLevel` đầy đủ, API §5.3 và endpoint access-logs §5.4, notification `document_shared`, settings org, public route + rate limit, views share/access-log/public, E2E #2 #4, kịch bản pentest cho C-10.
3. **Đồng soạn thảo thời gian thực** — migration 177–179, scope `document` trên relay, presence, Yjs relay + snapshot, extension collaboration, k6 §9.4 mở rộng cho WS.
4. **Nguồn AI + agent contract** — context builder nguồn `document` + `via = ai_context`, action type §8 vào registry (chưa executor), mention trong tài liệu sinh notification.

Không ship lát cắt 2 khi lát cắt 1 chưa qua DoD; lát cắt 3 chỉ lập plan khi pilot có ≥ 2 tenant
dùng tài liệu hằng ngày và phản hồi cần gõ đồng thời (câu hỏi mở §12.1). Rollback mọi lát cắt =
tắt flag; migration forward-compatible.

## 12. Câu hỏi mở (chủ sở hữu sản phẩm quyết trước khi duyệt)

1. **CRDT ở C hay để A?** Spec đặt ở lát cắt 3 với Go relay (không dịch vụ Node). Phương án khác: Hocuspocus (Node) — ít code hơn nhưng thêm một process phải vận hành và on-prem (E-01) phải đóng gói thêm. Đề xuất: giữ lát cắt 3, quyết định bật sau pilot lát cắt 1–2.
2. **Liên kết công khai mặc định tắt** ở cấp org và cần entitlement — có làm pilot khó gửi tài liệu cho khách không? Đề xuất: giữ tắt mặc định, org admin bật một lần; gói Team trở lên có entitlement.
3. **Bình luận trên tài liệu** ngay trong C-01 (thêm lát cắt) hay chờ F-05 lát cắt 5 (comment thread dùng chung) ship rồi nối? Đề xuất: chờ, để một cơ chế bình luận cho cả task và tài liệu.
4. **Share có kế thừa xuống trang con không?** Spec: không (mỗi tài liệu tự share; trang con chỉ kế thừa `visibility` lúc tạo). Kế thừa làm UI phức tạp và bản cũ không có. Đề xuất: giữ không, xem lại khi có yêu cầu thật.
5. **Xem PDF trong app** (iframe presigned inline) thay vì tải về? Rẻ nhưng mở bề mặt XSS/phishing của PDF; đề xuất: đợt sau, sau C-10.
6. **Retention nhật ký truy cập**: giữ mãi (như audit) hay 365 ngày? Ảnh hưởng C-06 export. Đề xuất: giữ mãi ở C, chính sách retention làm cùng C-06.
7. **Trần tệp 50 MiB** đủ cho pilot (bản vẽ, video ngắn)? Đề xuất: 50 MiB mặc định, entitlement `documents.max_file_bytes` nếu có khách cần hơn.
8. **Tên nav**: "Tài liệu" (đề xuất) hay "Docs" như IA V2? Ảnh hưởng glossary.
