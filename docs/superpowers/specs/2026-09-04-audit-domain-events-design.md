# UniWork — Audit bất biến & Domain Events (nền toàn hệ thống)

**Ngày:** 2026-09-04
**Trạng thái:** Đã duyệt (2026-09-04, quangpd — UNI-421). Câu hỏi mở đã chốt trong `docs/roadmap/OPEN_QUESTIONS.md`; ADR 0007–0010 accepted.
**Spec liên quan:** `2026-08-24-uniwork-platform-design.md` (§5 realtime),
`2026-08-28-transactional-email-design.md` (mẫu outbox một bảng + một goroutine),
`2026-08-29-meeting-world-class-design.md` (`meeting_audit_logs`, `outbox_events`, `RunAutoEnd`),
`2026-09-04-notifications-design.md` (consumer đầu tiên của outbox)
**Tham chiếu:** `server/migrations/008_meeting_control_plane.up.sql`
(`meeting_audit_logs`, `outbox_events`), `server/internal/service/meeting.go`
(`writeAudit`, `enqueue`), `server/internal/service/meeting_queries.go` (`ProcessOutbox`,
`applyOutbox`), `server/internal/service/events.go` (`EventPublisher`),
`packages/core/realtime/use-realtime-sync.ts`, `packages/core/types/events.ts`.
Bản cũ (chỉ để đối chiếu hành vi): `../unidigiwork/docs/architecture/UNIWORK_SAAS_ARCHITECTURE_BLUEPRINT_V1.0.md`
§12, `../unidigiwork/docs/architecture/contracts/DOMAIN_EVENT_CATALOGUE.md`.


> **Ghi chú số migration:** số `0NN_` trong spec này là **giữ chỗ**; số thật được cấp khi viết plan, theo thứ tự triển khai trong `docs/roadmap/FEATURE_ROADMAP.md` (audit/outbox → entitlement → tasks → notifications → …) và theo migration mới nhất trên `develop` lúc đó. Các spec cùng ngày có dải số trùng nhau là cố ý.

## 1. Mục tiêu

Meetings đã có audit (`meeting_audit_logs`) và outbox (`outbox_events`) nhưng cả hai
là **của riêng module Meeting**: audit chỉ ghi được `meeting_id`, outbox chỉ có ba
topic `provider.*` mà `MeetingService.applyOutbox` hiểu. Tasks, Chat, Organization,
Workspace không ghi audit; sự kiện realtime của chúng phát thẳng từ service qua
`EventPublisher` sau commit, không có bản ghi nào để phát lại nếu process chết
giữa chừng.

Spec này nâng hai thứ đó thành nền tảng dùng chung, để mọi bounded context sau này
(Notifications, Documents, AI/Agent, Billing) chỉ cần **gọi một hàm** thay vì tự dựng.

Yêu cầu "chuẩn thế giới" (Vision §6.1, §6.4) diễn giải thành tính chất đo được:

1. **Bất biến.** Bản ghi audit không sửa, không xóa được bằng bất kỳ đường nào app
   dùng — kể cả khi service có bug. Test tamper chứng minh.
2. **Cùng transaction.** Thay đổi dữ liệu + audit + outbox commit cùng nhau hoặc
   không gì cả. Không có audit "mồ côi", không có sự kiện phát mà DB chưa ghi.
3. **Không mất sự kiện.** Consumer (realtime, notification, webhook) đọc từ outbox,
   không đọc từ bộ nhớ process. Restart, deploy, crash đều không làm mất.
4. **Truy vết được.** Một `correlation_id` đi từ HTTP request → audit → outbox →
   consumer → log. Tra một id ra được toàn bộ chuỗi.
5. **Actor là hạng nhất.** `actor_kind ∈ {human, agent, system}`; agent chưa tồn tại
   nhưng cột đã có chỗ, để Vision V6 không phải migrate lại bảng audit.
6. **Có hợp đồng.** Sự kiện `<entity>.<verb>` có phiên bản trong một catalogue duy
   nhất; thêm sự kiện là thêm một dòng, đổi payload là tăng version.
7. **Tenant xem được, tenant mang đi được.** Org admin có màn hình Security & Audit;
   export CSV/JSON theo khoảng thời gian; retention theo gói.

**Ngoài phạm vi đợt này:** webhook ra ngoài (chỉ chừa topic `webhook.deliver`),
SIEM/syslog export, ký chuỗi hash (hash chaining) cho audit, alert bất thường,
retention tự động xóa (chỉ có chính sách + job đánh dấu, chưa xóa thật).

## 2. Quyết định đã chốt

| # | Quyết định | Vì sao |
|---|-----------|--------|
| 1 | **Một bảng `audit_events` chung**, không mỗi domain một bảng | Màn hình audit và export chỉ đọc một chỗ; `meeting_audit_logs` giữ nguyên làm lịch sử, ghi song song trong giai đoạn chuyển, xem §9 |
| 2 | Bất biến bằng **REVOKE UPDATE/DELETE trên role ứng dụng** + trigger `RAISE` cho chắc | Quyền DB là thứ bug service không vượt được; trigger là lớp hai cho môi trường dev dùng superuser |
| 3 | **Giữ `outbox_events` hiện có**, thêm cột, không tạo bảng mới | Claim/lease/retry đã có test; đổi tên bảng chỉ tạo diff vô ích |
| 4 | Outbox **generic**: mỗi topic có một `Consumer` đăng ký; `MeetingService.applyOutbox` trở thành một consumer của `provider.*` | Thêm consumer không sửa Meeting |
| 5 | Realtime **cũng đi qua outbox** cho sự kiện domain; `EventPublisher.Publish` trực tiếp chỉ còn cho sự kiện phù du (typing, voice signal, lobby) | Không mất sự kiện; độ trễ thêm ≤ 1 tick worker (mặc định 500 ms, đo ở §8) |
| 6 | Scope tenant của audit là **`organization_id`** (bắt buộc), `workspace_id` nullable | Tổ chức là ranh giới dữ liệu và thanh toán (Vision §7.2 V3); sự kiện org (đổi role, billing) không có workspace |
| 7 | `payload` là JSON **chỉ chứa id và giá trị trước/sau của trường đổi**, không snapshot cả row | Row có thể chứa PII; trước/sau đủ để trả lời "ai đổi gì" |
| 8 | Không thêm dependency. Không River, không NATS. Vẫn một bảng + goroutine | Cùng lý do với email outbox; nâng cấp khi đo được cần |

## 3. Dữ liệu

Tuân `docs/conventions.md`: ULID `TEXT`, không FK, index `CONCURRENTLY` một mình một
file, trạng thái là timestamp. Số migration bắt đầu từ `058` (sau `057_matrix_ids`);
số thực tế lấy lúc implement.

### 3.1 `058_audit_events`

```sql
-- Nhật ký bất biến cho mọi command quan trọng. Không FK: bản ghi phải sống lâu
-- hơn user, workspace, thậm chí organization đã xóa.
CREATE TABLE audit_events (
  id              TEXT PRIMARY KEY,                 -- ULID, thứ tự thời gian
  organization_id TEXT NOT NULL,
  workspace_id    TEXT,                             -- NULL cho sự kiện cấp org
  actor_kind      TEXT NOT NULL,                    -- 'human' | 'agent' | 'system'
  actor_id        TEXT NOT NULL,                    -- user id, agent id, hoặc tên job
  action          TEXT NOT NULL,                    -- 'task.updated', 'member.role_changed'
  resource_type   TEXT NOT NULL,                    -- 'task', 'meeting', 'workspace_member'
  resource_id     TEXT NOT NULL,
  changes         TEXT NOT NULL DEFAULT '{}',       -- JSON {field: {from, to}}
  metadata        TEXT NOT NULL DEFAULT '{}',       -- JSON tự do, không PII, không secret
  correlation_id  TEXT NOT NULL,
  request_id      TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lớp 1: role ứng dụng không có quyền sửa/xóa.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;
-- Role thật lấy từ config lúc implement (DATABASE_URL user). Nếu app chạy bằng
-- owner của schema (dev), lớp 2 dưới đây là thứ giữ luật.

-- Lớp 2: trigger chặn mọi UPDATE/DELETE, kể cả owner.
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
```

Retention (§7) không xóa dòng: nó chuyển dòng cũ sang bảng `audit_events_archive`
bằng job có quyền riêng, ngoài phạm vi đợt này. Trigger vì thế không có "cửa sau".

Kiểm tra `server/migrations/lint_test.go` có cấm `CREATE FUNCTION`/`TRIGGER` không;
nếu có, thêm ngoại lệ tường minh cho file này kèm lý do (ADR mới, xem §10).

### 3.2 Index cho `audit_events` (mỗi index một file, `059`–`061`)

```sql
-- 059: màn hình audit của org, lọc theo thời gian
CREATE INDEX CONCURRENTLY idx_audit_events_org_time
  ON audit_events (organization_id, occurred_at DESC);
-- 060: "lịch sử của một task/meeting"
CREATE INDEX CONCURRENTLY idx_audit_events_resource
  ON audit_events (resource_type, resource_id, occurred_at DESC);
-- 061: truy vết
CREATE INDEX CONCURRENTLY idx_audit_events_correlation
  ON audit_events (correlation_id);
```

### 3.3 `062_outbox_events_generic` — mở rộng bảng có sẵn

```sql
ALTER TABLE outbox_events
  ADD COLUMN organization_id TEXT,                -- backfill từ workspaces
  ADD COLUMN event_version   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN correlation_id  TEXT,
  ADD COLUMN actor_kind      TEXT,
  ADD COLUMN actor_id        TEXT,
  ADD COLUMN done_at         TIMESTAMPTZ,
  ADD COLUMN dead_at         TIMESTAMPTZ;

UPDATE outbox_events o SET organization_id = w.organization_id
  FROM workspaces w WHERE w.id = o.workspace_id AND o.organization_id IS NULL;

ALTER TABLE outbox_events ALTER COLUMN workspace_id DROP NOT NULL;
```

Cột `status` hiện có (`PENDING`/`DONE`/…) **giữ** để không phá `ClaimPendingOutbox`;
`done_at`/`dead_at` thêm để tuân quy ước timestamp và để đo lag. Khi refactor
query, `status` có thể bỏ ở một migration sau — không làm trong đợt này.

Index `063`: `CREATE INDEX CONCURRENTLY idx_outbox_events_pending ON outbox_events
(available_at) WHERE done_at IS NULL AND dead_at IS NULL;` (thay index cũ nếu trùng
mục đích; kiểm tra lúc implement).

### 3.4 `064_audit_retention_policies`

```sql
-- Một dòng mỗi organization; thiếu dòng = mặc định theo gói (service quyết).
CREATE TABLE audit_retention_policies (
  organization_id TEXT PRIMARY KEY,
  retain_days     INTEGER NOT NULL,
  updated_by      TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 4. Mô hình trong Go

### 4.1 Package mới `server/internal/audit`

```go
package audit

type ActorKind string
const (
    ActorUser   ActorKind = "user"
    ActorAgent  ActorKind = "agent"
    ActorSystem ActorKind = "system"
)

type Actor struct {
    Kind ActorKind
    ID   string
}

type Change struct{ From, To any }

type Entry struct {
    OrganizationID string
    WorkspaceID    string            // "" => NULL
    Actor          Actor
    Action         string            // "task.updated"
    ResourceType   string            // "task"
    ResourceID     string
    Changes        map[string]Change // chỉ trường đã đổi
    Metadata       map[string]any    // không PII, không secret
}

// Recorder ghi audit + outbox trong transaction của caller.
type Recorder interface {
    Record(ctx context.Context, q *db.Queries, e Entry, emit ...Event) error
}

type Event struct {
    Topic   string            // "task.updated"
    Version int               // mặc định 1
    Payload map[string]string // chỉ id
}
```

`Record` làm ba việc trong `q` (đã `WithTx`): insert `audit_events`, insert
`outbox_events` cho mỗi `emit`, gắn `correlation_id` / `request_id` / IP / UA lấy từ
`ctx` (§4.3). Service **không** gọi `InsertAuditEvent` hay `InsertOutboxEvent` trực
tiếp; `arch_test.go` thêm luật: chỉ package `audit` được gọi hai query đó.

### 4.2 Cách service dùng

```go
// TaskService.Update — trích
tx, _ := s.pool.Begin(ctx); defer tx.Rollback(ctx)
q := s.q.WithTx(tx)
before := task
task, err = q.UpdateTask(ctx, params)
if err != nil { return err }
err = s.audit.Record(ctx, q, audit.Entry{
    OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID,
    Actor: audit.Actor{Kind: audit.ActorUser, ID: userID},
    Action: "task.updated", ResourceType: "task", ResourceID: task.ID,
    Changes: audit.Diff(before, task, "title", "status", "assignee_id", "due_date", "priority"),
}, audit.Event{Topic: "task.updated", Payload: map[string]string{"task_id": task.ID, "workspace_id": ws.ID}})
if err != nil { return err }
return tx.Commit(ctx)
```

`audit.Diff` là helper so sánh các trường được liệt kê (tường minh, không reflect
toàn struct) và trả `map[string]Change` chỉ với trường khác nhau. Không có trường
đổi thì `Changes` rỗng và vẫn ghi (ví dụ `task.viewed` không dùng; chỉ command).

Danh sách command **bắt buộc** ghi audit trong đợt này (thêm dần bằng test §8.4):

| Domain | Action |
|---|---|
| organization | `organization.created`, `organization.updated`, `member.invited`, `member.joined`, `member.role_changed`, `member.removed` |
| workspace | `workspace.created`, `workspace.updated`, `workspace_member.added`, `workspace_member.role_changed`, `workspace_member.removed` |
| task | `task.created`, `task.updated`, `task.deleted`, `task.comment_added` |
| meeting | mọi `event_type` hiện có của `meeting_audit_logs`, đổi sang action `meeting.<verb>` chữ thường |
| auth | `auth.login_succeeded`, `auth.login_failed`, `auth.password_reset_requested`, `auth.password_changed`, `auth.session_revoked` — `workspace_id` NULL, `organization_id` = org đang active hoặc `''`? → **Không.** Auth ghi với `organization_id` của user nếu có đúng một org, còn lại ghi một dòng cho mỗi org user thuộc về (câu hỏi mở §11) |
| chat | `chat.room.created`, `chat.room.member_added`, `chat.room.member_removed`, `chat.message.deleted` (không audit tạo/sửa tin nhắn: quá nhiều, đã có lịch sử trong bảng) |

### 4.3 Correlation id

- Middleware mới `middleware.Correlation`: đọc `X-Correlation-ID` từ client (chỉ chấp
  nhận `[A-Za-z0-9_-]{8,64}`), thiếu thì sinh ULID; đặt vào `ctx`; trả lại trong
  header response. `request_id` của chi giữ nguyên, tách biệt (request_id là một hop,
  correlation là cả chuỗi).
- `packages/core/api/http.ts` gửi `X-Correlation-ID` do client sinh mỗi lần gọi và
  log nó trong `logger.ts` khi request lỗi, để support tra ngược từ màn hình lỗi.
- Consumer outbox chạy với `ctx` mang `correlation_id` của dòng outbox, nên log
  consumer và audit do consumer ghi (ví dụ notification đã tạo) cùng một id.
- `request_logger.go` thêm attr `correlation_id`.

### 4.4 Outbox generic

```go
// server/internal/outbox (package mới, tách từ MeetingService)
type Consumer interface {
    Topics() []string
    Handle(ctx context.Context, ev Row) error   // idempotent theo ev.ID
}

type Dispatcher struct { /* pool, queries, consumers map[topic][]Consumer, metrics */ }
func (d *Dispatcher) Register(c Consumer)
func (d *Dispatcher) Run(ctx context.Context)  // vòng lặp claim/lease/retry hiện có
```

- `MeetingService` implement `Consumer` cho `provider.ensure_session`,
  `provider.remove_participant`, `provider.end_session` — logic `applyOutbox` chuyển
  sang đó nguyên vẹn.
- `RealtimeConsumer` (mới): topic = mọi sự kiện domain trong catalogue §5; `Handle`
  gọi `EventPublisher.Publish(workspaceID, Event{Type: topic, Payload})`, hoặc
  `SendToUser` khi payload có `user_id` và topic thuộc nhóm user-scoped (member
  events). Đây là đường realtime chính từ nay.
- `NotificationConsumer`: spec `2026-09-04-notifications-design.md`.
- `WebhookConsumer`: chỉ đăng ký topic `webhook.deliver`, thân hàm `return nil` kèm
  `// TODO(spec-webhooks)`. Không xây thêm.
- Một dòng outbox có nhiều consumer → mỗi consumer phải idempotent; lỗi của một
  consumer làm dòng retry cả cụm. Đơn giản, chấp nhận trong đợt này; tách "delivery
  per consumer" khi có consumer ngoài (webhook).
- Retry: backoff `min(2^attempts × 1s, 5m)`, tối đa 10 lần, sau đó `dead_at`. Metric
  `outbox_dead_total`, `outbox_pending_age_seconds` (p95 = SLO ở Vision §6.3: ≤ 5 s).

### 4.5 Sự kiện phù du không qua outbox

`chat.typing`, `chat.voice.*`, lobby của meeting, `transcript.appended` (streaming)
tiếp tục dùng `EventPublisher.PublishToScope` trực tiếp. Tiêu chí: **mất thì không
ai thiệt**. Viết vào `docs/conventions.md` § Go như một câu quy tắc.

## 5. Catalogue sự kiện

File `docs/events/CATALOGUE.md` là nguồn sự thật cho con người; file
`server/internal/outbox/catalogue.go` là nguồn sự thật cho máy (map `topic →
{version, payloadKeys, scope}`), và `packages/core/types/events.ts` phải khớp —
test `scripts/events-catalogue.test.mjs` so ba nơi.

| Topic | v | Payload (chỉ id) | Scope realtime | Consumer |
|---|---|---|---|---|
| `task.created` / `task.updated` / `task.deleted` | 1 | `task_id`, `workspace_id` | workspace | realtime, notification |
| `task.comment_added` (đổi tên từ `comment.created`, giữ alias 1 release) | 1 | `task_id`, `comment_id`, `workspace_id` | workspace | realtime, notification |
| `meeting.*` (giữ nguyên tên hiện có) | 1 | như hiện tại | workspace | realtime, notification |
| `member.invited` / `member.joined` / `member.role_changed` / `member.removed` | 1 | `organization_id`, `user_id`, `workspace_id?` | user | realtime, notification |
| `chat.room.*`, `chat.message.created` / `updated` | 1 | như hiện tại | chat scope | realtime |
| `notification.created` | 1 | `notification_id`, `user_id` | user | realtime |
| `audit.exported` | 1 | `export_id`, `organization_id` | user | notification |
| `provider.*` | 1 | như hiện tại | — | meeting |
| `webhook.deliver` | 1 | `subscription_id`, `event_id` | — | webhook (stub) |

Quy tắc:

- Tên `<entity>.<verb>` chữ thường, quá khứ phân từ. Không nhúng version vào tên;
  `event_version` là cột. Đổi payload phá vỡ → tăng version, consumer switch theo
  version, giữ cả hai ≥ 1 release.
- Payload chỉ id và số phiên bản (`version` của aggregate nếu có, như meeting).
  Không nội dung, không email, không token.
- Client: `type` vẫn `z.string()` (ADR 0003), sự kiện lạ bị bỏ qua.

## 6. API

Theo `docs/api-sdi-sdo.md`: SDI/SDO trong `handler/dto/{sdi,sdo}/audit.go`, route
trong `handler/router/audit.go`, tag `Audit`.

| Method & path | Quyền | Mô tả |
|---|---|---|
| `GET /organizations/{orgId}/audit` | org owner/admin | Danh sách phân trang cursor (`before=<ulid>`), lọc `actor_id`, `action`, `resource_type`, `resource_id`, `workspace_id`, `from`, `to`. Tối đa 100/trang |
| `GET /organizations/{orgId}/audit/{eventId}` | org owner/admin | Một bản ghi đầy đủ |
| `GET /workspaces/{wsId}/resources/{type}/{id}/history` | effective ws member | Lịch sử một task/meeting, để hiển thị "Hoạt động" trong detail |
| `POST /organizations/{orgId}/audit/exports` | org owner | Tạo job export (`from`, `to`, `format ∈ csv,json`); trả `export_id`; job chạy qua outbox topic `audit.export_requested`, file lên storage, xong phát `audit.exported` → notification có link tải (hết hạn 24 h) |
| `GET /organizations/{orgId}/audit/exports/{id}` | org owner | Trạng thái + link |
| `GET|PUT /organizations/{orgId}/audit/retention` | org owner | Xem/đặt `retain_days`; giá trị hợp lệ theo entitlement (mặc định 90, Business 365, Enterprise 730 — con số chờ Billing spec) |
| `GET /admin/outbox/stats` | platform admin (chưa có → tạm `X-Admin-Token` env, thay khi có Platform Admin spec) | pending, oldest age, dead count, theo topic |

SDO `AuditEventSDO`: mọi trường của bảng, `changes`/`metadata` là `map[string]any`
đã parse. `ip_address` chỉ trả cho org owner; admin thấy `null` (câu hỏi mở §11).

Quyền: handler không quyết; `AuditService.RequireOrgAdmin` gọi
`OrganizationService` (một chỗ quyết membership org, tương tự
`WorkspaceService.RequireMember`). Lịch sử resource đi qua
`WorkspaceService.RequireMember`.

## 7. Retention & export

- Job `RetentionMarker` chạy mỗi ngày qua worker: đếm dòng cũ hơn `retain_days` mỗi
  org, ghi metric `audit_events_expired_total`. **Chưa xóa, chưa archive** — đợt sau
  thêm bảng archive và job có quyền `DELETE` riêng (role DB khác app). Lý do: xóa
  audit là hành động không hoàn tác, cần ADR và diễn tập restore trước.
- Export: tối đa 1 job đang chạy mỗi org; file CSV UTF-8 BOM (Excel tiếng Việt),
  JSON Lines; ≤ 500k dòng, hơn thì bắt chia khoảng thời gian.

## 8. Testing

### 8.1 Go, service/integration (Postgres thật)

1. `TestAuditImmutable`: `UPDATE`/`DELETE` trên `audit_events` bằng pool của app →
   lỗi; bằng superuser → vẫn lỗi (trigger). Đây là test tamper bắt buộc xanh trước
   khi merge.
2. `TestRecordAtomic`: `Record` rồi `tx.Rollback` → không dòng audit, không dòng
   outbox. `Record` rồi `Commit` → đúng 1 audit + N outbox, cùng `correlation_id`.
3. `TestDispatcherFanout`: hai consumer cùng topic, một lỗi → dòng retry, consumer
   kia gọi lại lần hai vẫn không tạo side effect (idempotent theo `ev.ID`).
4. `TestDispatcherDeadLetter`: 10 lần lỗi → `dead_at` set, metric tăng.
5. `TestMeetingProviderConsumerParity`: chạy lại toàn bộ `meeting_outbox_test.go`
   qua `Dispatcher` — không đổi assertion.
6. `TestTaskUpdateWritesAudit`: đổi `status` → 1 dòng `task.updated`, `changes` chỉ
   có `status`, `actor_kind = human`.
7. `TestAuditIsolation`: org A đọc `/organizations/{B}/audit` → 403; lịch sử task
   của workspace không phải member → 404 (không lộ tồn tại, theo SECURITY.md).

### 8.2 Arch test (`server/internal/arch_test.go`)

- Chỉ `internal/audit` gọi `InsertAuditEvent`, `InsertOutboxEvent`.
- `internal/service` không import `internal/realtime` trực tiếp ngoài qua
  `EventPublisher` (đã có), và không gọi `Publish` cho topic thuộc catalogue (regex
  trên tên topic — dễ vỡ; chấp nhận, ghi rõ trong test).

### 8.3 Frontend

- `packages/core/api/endpoints/audit.ts` + test malformed-response cho mọi endpoint.
- `use-realtime-sync.test.tsx`: thêm case `task.comment_added` và alias
  `comment.created` cùng invalidate một key.

### 8.4 Test "command nào chưa audit"

`server/internal/service/audit_coverage_test.go`: bảng liệt kê action §4.2; với mỗi
action có một hàm fixture gọi command tương ứng và assert có dòng audit. Thêm command
mới mà không thêm vào bảng → reviewer hỏi; thêm vào bảng mà chưa audit → test đỏ.

### 8.5 Hiệu năng

Bench `outbox_dispatch_bench_test.go`: 10k dòng pending, 1 worker → thông lượng ≥
2k/s trên máy dev; lag p95 ≤ 5 s ở 500 sự kiện/s (SLO Vision §6.3). Ghi số vào
`docs/superpowers/plans/<plan>.md` khi ship.

## 9. Kế thừa & bỏ

| Từ bản cũ (`unidigiwork`) | Xử lý |
|---|---|
| Trường audit §12.1 Blueprint (`before_state`, `after_state`, `source`, ...) | Kế thừa ý; gộp `before/after` thành `changes`, `source` thành `actor_kind` |
| Envelope event `{eventId, eventType, tenantId, aggregateId, occurredAt, payload}` | Kế thừa; map sang cột `outbox_events` (không JSON envelope riêng) |
| `_set_correlation_context` + `/api/admin/trace/$correlationId` | Kế thừa ý; endpoint trace chờ Platform Admin spec |
| Catalogue `domain.action.vN` | Bỏ version trong tên, dùng cột |
| Audit bằng trigger `audit_row_change` trên từng bảng | **Bỏ.** Ghi từ service tường minh: chỉ command, có actor, có changes gọn |
| `meeting_audit_logs` | Giữ đọc; ghi song song 1 release qua `audit.Record` (Meeting gọi cả `writeAudit` cũ và `Record` mới), rồi bỏ `writeAudit` ở plan tiếp theo |

## 10. Definition of Done (theo Vision §6.9)

- [ ] Migration `058`–`064` up/down, qua `lint_test.go` (kèm ngoại lệ trigger có ADR).
- [ ] ADR mới: "Audit bất biến bằng quyền DB + trigger; xóa chỉ qua archive job" — trạng thái `accepted` khi merge.
- [ ] Package `audit`, `outbox` với test §8.1–8.5 xanh; `coverage.floor` không giảm.
- [ ] Meeting chạy qua `Dispatcher`, test cũ không đổi.
- [ ] Tasks, Workspace, Organization, Auth, Chat ghi audit theo bảng §4.2; `audit_coverage_test` xanh.
- [ ] Realtime của task/meeting/member đi qua outbox; đo lag ghi vào plan.
- [ ] API §6 có SDI/SDO, Swagger test xanh, FE endpoints + malformed tests.
- [ ] UI: tab "Bảo mật & Nhật ký" trong settings org (`packages/views/settings/audit/`), bảng lọc + chi tiết + export; tab "Hoạt động" trong task/meeting detail. vi/en đủ, `parity.test` xanh, sáng/tối, bàn phím.
- [ ] `docs/events/CATALOGUE.md`, `catalogue.go`, `events.ts` khớp, test ba nơi xanh.
- [ ] Metric `outbox_pending_age_seconds`, `outbox_dead_total`, `audit_events_total{action}` xuất Prometheus; dashboard tối thiểu trong `docs/ops/` (file mới).
- [ ] `docs/conventions.md` § Go thêm quy tắc: command quan trọng phải `audit.Record`; sự kiện domain đi outbox, phù du đi `Publish`.

## 11. Câu hỏi mở (chủ sở hữu sản phẩm quyết)

1. **Auth audit thuộc org nào?** Login không có ngữ cảnh org. Đề xuất: ghi
   `organization_id = ''` (sentinel) và chỉ platform admin xem; org admin chỉ thấy
   `member.*`. Cần chốt vì ảnh hưởng `NOT NULL`.
2. **Org admin có thấy `ip_address` không?** Đề xuất: chỉ owner; admin thấy null.
   Liên quan Nghị định 13 (IP là dữ liệu cá nhân).
3. **Retention mặc định 90 ngày** cho Free/Team có đủ với khách SME không, hay 180?
4. **Chat message create/update có audit không?** Đề xuất không (khối lượng lớn,
   lịch sử đã có trong `chat_messages`). Nếu khách enterprise yêu cầu, bật theo
   entitlement.
5. **Realtime qua outbox làm tăng độ trễ ~0,5 s** cho task board. Chấp nhận, hay
   giữ `Publish` trực tiếp song song với outbox (double publish, client dedup theo
   `event id`)? Đề xuất: chấp nhận, đo trước, tối ưu tick worker xuống 200 ms nếu cần.
