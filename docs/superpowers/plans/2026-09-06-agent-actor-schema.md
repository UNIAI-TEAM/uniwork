# F-10 · Agent là actor hạng nhất — phần schema và attribution — Plan triển khai

> **Trạng thái:** shipped

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent có danh tính trong tổ chức (`agents`), là thành viên workspace (`workspace_agent_members`), được giao task (`assignee_kind='agent'`); mọi bản ghi nghiệp vụ mang cặp `*_by` + `*_kind`; API trả actor dạng `{id, kind, display_name, avatar_url}`; UI gắn `AgentBadge` ở mọi chỗ hiện actor. Chưa có runtime (A-01).

**Issue:** UNI-424 · **Spec:** `docs/superpowers/specs/2026-09-04-agent-actor-model-design.md` §4.1, §5.1, §6 (3 dòng đầu), §7 (badge) · **ADR:** 0007 (accepted), 0008, 0010.

## Global Constraints

- Mọi lệnh chạy từ `uniwork/`. Go: `cd server && go test ./internal/... -run X`; đầy đủ `make test-go`. TS: `pnpm --filter @uniwork/core test`, `pnpm --filter @uniwork/views test`. sqlc: `make sqlc`.
- Migration: không `REFERENCES`/`FOREIGN KEY`, index `CONCURRENTLY` một mình một file, có `.down.sql`, bảng mới có `organization_id TEXT NOT NULL` (`server/migrations/lint_test.go`).
- `actor_kind ∈ {human, agent, system}` — ADR 0007. Cột `_kind` là `TEXT NOT NULL DEFAULT 'human' CHECK (...)`.
- Chỉ `internal/audit` ghi audit/outbox; command mới có dòng trong `audit_coverage_test.go`.
- Không thêm dependency. Không chữ "multica".
- vi.json trước, en.json cùng key. JSX trong `views` qua `t()`.
- Test Go chạm DB dùng `testutil.DB(t)`; bảng mới thêm vào TRUNCATE.
- Commit sau mỗi task; message `feat(agents): …`, `refactor(service): …`.

## Quyết định lúc implement (chốt các chỗ spec để ngỏ)

| # | Chỗ spec để ngỏ | Chốt |
|---|---|---|
| 1 | Số migration | Mới nhất trên `develop` là `065` → dùng `066`–`068` |
| 2 | AG1: agent trong `workspace_members` hay bảng riêng | **Bảng riêng `workspace_agent_members`** (OPEN_QUESTIONS AG1 đã chốt). `workspace_members` **không** thêm `member_kind`/`agent_id` — hàng người vẫn là người; issue liệt kê cột này theo bản spec cũ |
| 3 | `chat_messages.author_kind` | Đặt `sender_kind` để ghép cặp với cột có sẵn `sender_id` (ADR 0007: cặp `x` + `x_kind`) |
| 4 | `tasks.assignee_id REFERENCES users(id)` (migration 002) | **Drop FK** trong `068` — agent làm assignee thì không thể giữ FK sang `users`. Down không tạo lại FK (hàng agent sẽ làm `ALTER` thất bại); ghi rõ trong file |
| 5 | Kiểu `Actor` | **Dùng lại `audit.Actor`** (`type Actor = audit.Actor` trong service, `service.Human(userID)` là constructor duy nhất handler được gọi). Không tạo type song song |
| 6 | Phạm vi refactor chữ ký | Chỉ `TaskService.Create/Update/AddComment` nhận `Actor` — nơi duy nhất đợt A cần actor không phải người (comment/task nháp do agent ký tên). Meeting và chat ghi `created_by_kind`/`sender_kind = human` cố định: theo ADR 0010 executor gọi service với actor là **người xác nhận**, nên hai đường này không có caller agent. Đường đọc giữ `userID`. Guard: `TestActorConstructedOnlyInService` — ngoài `internal/service` và `internal/audit` không có `audit.Actor{`, `audit.System(`, `KindAgent`, `KindSystem` |
| 7 | AG6 agent mặc định UNI | Tạo trong `OrganizationService.Create` (handle `uni`, owner = người tạo org, `created_by_kind='system'`); **tự vào mọi workspace mới** của org (`CreateInOrg`) để giao được ngay — không có UI thêm agent vào workspace ở đợt này |
| 8 | AG2 ai tạo agent | Org owner/admin (`AgentService.Create`); sửa: org admin **hoặc** `owner_user_id` |
| 9 | `agent-badge` ở `packages/ui` (issue) hay `packages/views` (spec) | **`packages/views/agents/agent-badge.tsx`** — `ui` không được import i18n/core, nhãn "Agent" phải qua `t()` |
| 10 | Màn hình Settings → Agents (spec §7 `agent-list`, `agent-form`) | **Hoãn sang sub-issue**: `pnpm knip` không cho core endpoint không có consumer; đợt này chỉ endpoint backend (có Swagger) + `listWorkspaceAgents` cho picker giao việc |
| 11 | Sự kiện outbox | Chỉ `workspace_agent.added` (scope workspace) — thứ duy nhất FE cần invalidate. `agent.created/updated` là audit action, không có consumer realtime nên không vào catalogue |
| 12 | `ActorDTO` resolver | `ActorService.Resolve(ctx, refs)` batch 2 query (`GetUsersByIDs`, `GetAgentsByIDs`); handler gắn `assignee` vào `TaskDTO`, `author` vào `CommentDTO`. `ListTaskComments` đổi JOIN → LEFT JOIN để bình luận của agent không biến mất |

## File map

**Backend — tạo mới**
- `server/migrations/066_agents.{up,down}.sql` — `agents`, `workspace_agent_members`
- `server/migrations/067_agents_org_handle_idx.{up,down}.sql`
- `server/migrations/068_actor_kind_columns.{up,down}.sql` — cột `_kind`, `task_comments.origin`, drop FK assignee
- `server/pkg/db/queries/agents.sql`
- `server/internal/service/actor.go` — `Actor`, `Human`, `ActorService.Resolve`
- `server/internal/service/agent.go`, `agent_test.go`
- `server/internal/handler/agent.go`, `dto/sdi/agent.go`, `dto/sdo/agent.go`, `router/agents.go`

**Backend — sửa**
- `server/migrations/lint_test.go` — `TestActorKindOnEveryCreatedBy`
- `server/internal/arch_test.go` — `GetWorkspaceAgentMember` vào regex membership; `TestActorConstructedOnlyInService`
- `server/pkg/db/queries/{tasks,users,chat,meetings}.sql`
- `server/internal/service/{workspace,task,organization,meeting_lifecycle,chat,onboarding,meeting_ai}.go`
- `server/internal/audit/actions.go`; `service/audit_coverage_test.go`; `testutil/db.go`
- `server/internal/handler/{task,router.go,router/openapi.go,router/routes.go}`; `dto/sdi/task.go`, `dto/sdo/task.go`
- `server/internal/outbox/catalogue.go`, `docs/events/CATALOGUE.md`, `packages/core/types/events.ts`

**Frontend**
- `packages/core/types/actor.ts` (mới), `types/agent.ts` (mới), `types/task.ts`
- `packages/core/api/endpoints/agents.ts` + test (mới), `endpoints/tasks.ts`
- `packages/core/agents/hooks.ts` (mới); `realtime/use-realtime-sync.ts`
- `packages/core/permissions/rules.ts` + test — `canManageAgents`
- `packages/views/agents/agent-badge.tsx` + test (mới)
- `packages/views/tasks/{task-detail-view,list-view}.tsx`
- `packages/core/i18n/locales/{vi,en}.json`

**Docs**
- `CLAUDE.md` — chuyển ADR 0007 khỏi "Awaiting Enforcement", nêu tên test
- `docs/roadmap/FEATURE_ROADMAP.md` F-10 → CÓ; spec → ghi chú đợt F đã triển khai

## Tasks

### Task 1 — Migration + lint (`feat(db): agents tables and actor_kind columns`)
- [x] `066`, `067`, `068` + down
- [x] `lint_test.go`: `TestActorKindOnEveryCreatedBy` (bảng mới sau `065` có `created_by` ⇒ có `created_by_kind`); `tenantBackfillDebt` không đổi
- [x] `testutil/db.go` TRUNCATE thêm `agents`, `workspace_agent_members`
- [x] `make sqlc` sau khi thêm query ở Task 2

### Task 2 — Query + Actor + RequireAgentMember (`feat(service): Actor type, RequireAgentMember, actor resolver`)
- [x] `agents.sql`: Create/Get/List/Update agent, `GetAgentsByIDs`, `AddWorkspaceAgentMember`, `GetWorkspaceAgentMember`, `ListWorkspaceAgents`, `ListActiveAgentsInOrg`; `users.sql`: `GetUsersByIDs`
- [x] `actor.go`: `type Actor = audit.Actor`, `Human()`, `ActorInfo`, `ActorService.Resolve`
- [x] `workspace.go`: `RequireAgentMember`, `requireActorMember`; `arch_test.go` cập nhật regex + test mới
- [x] Test: `RequireAgentMember` sai workspace ⇒ `ErrForbidden`

### Task 3 — AgentService + audit + UNI mặc định (`feat(agents): organization agents, default UNI, workspace agent members`)
- [x] `agent.go`: `Create` (org owner/admin, handle `^[a-z0-9][a-z0-9_-]{1,31}$`), `List` (org member), `Update` (org admin hoặc owner), `AddToWorkspace` (ws admin-like, agent active cùng org), `ListInWorkspace` (member)
- [x] `actions.go`: `agent.created`, `agent.updated`, `workspace_agent.added`; catalogue `workspace_agent.added` ba nơi
- [x] `OrganizationService.Create` tạo UNI; `WorkspaceService.CreateInOrg` thêm agent active của org
- [x] `audit_coverage_test.go` ba command; `agent_test.go`: tạo/sửa/list, org khác ⇒ 403/404, UNI có sau khi tạo org và có mặt trong workspace mới

### Task 4 — Ghi `_kind` + giao task cho agent (`refactor(service): write commands take Actor; tasks assignable to agents`)
- [x] `tasks.sql`: `CreateTask` thêm `created_by_kind`, `assignee_kind`; `SetTaskAssignee` thêm `assignee_kind`; `CreateTaskComment` thêm `author_kind`, `origin`; `ListTaskComments` LEFT JOIN; `chat.sql` `sender_kind`; `meetings.sql` `created_by_kind`
- [x] `TaskService.Create/Update/AddComment(ctx, actor Actor, …)`; `CreateTaskInput.AssigneeKind`, `UpdateTaskInput.AssigneeKind`; kind agent ⇒ `RequireAgentMember` trên workspace của task, sai ⇒ `Invalid`
- [x] Meeting/chat ghi `_kind = human`; callers của TaskService (`meeting_ai.go`, handlers, tests) dùng `Human(userID)`
- [x] Test: giao task cho UNI (member) ⇒ ok, `assignee_kind='agent'`; agent không ở workspace ⇒ lỗi; comment của người ⇒ `author_kind='human'`

### Task 5 — HTTP (`feat(api): agent endpoints, actor on task and comment DTOs`)
- [x] Routes: `GET/POST /orgs/{org}/agents`, `PATCH /agents/{agentID}`, `GET/POST /workspaces/{workspaceID}/agents`; `pathParamSDI` case `agentID`
- [x] `TaskDTO`: `assignee_kind`, `created_by_kind`, `assignee *ActorDTO`; `CommentDTO`: `author_kind`, `author ActorDTO`; `CreateTaskSDI`/`PatchTaskSDI`: `assignee_kind`
- [x] `swagger_test` xanh; handler test tạo agent + giao task qua HTTP

### Task 6 — Core (`feat(core): agent types, endpoints, hooks, permission mirror`)
- [x] `types/actor.ts`, `types/agent.ts`, `TaskSchema`/`TaskCommentSchema` thêm field lenient
- [x] `endpoints/agents.ts`: `listWorkspaceAgents` + malformed test; `endpoints/tasks.ts` `TaskPatch.assignee_kind`, `CreateTaskBody.assignee_kind`
- [x] `agents/hooks.ts`: `agentKeys`, `useWorkspaceAgents(wsId)`; realtime `workspace_agent.added` ⇒ invalidate
- [x] `permissions/rules.ts`: `canManageAgents` (cite `AgentService.Create`) + test

### Task 7 — Views (`feat(views): AgentBadge and agent attribution on tasks`)
- [x] `agents/agent-badge.tsx` (dùng `Badge` variant secondary, `t("agents.badge")`) + test
- [x] `task-detail-view`: picker gộp member + agent (`value` = `kind:id`), patch gửi `assignee_kind`; badge cạnh assignee agent và tác giả bình luận agent
- [x] `list-view`: tên assignee từ `task.assignee?.display_name`, badge khi agent
- [x] i18n `agents.badge`, `tasks.assign_to_agent_hint`
- [x] Test view: task có `assignee.kind='agent'` hiện badge

### Task 8 — Docs đóng vòng (`docs: F-10 schema shipped`)
- [x] `CLAUDE.md`: ADR 0007 rời "Awaiting Enforcement" → Database rules với `TestActorKindOnEveryCreatedBy`, `TestActorConstructedOnlyInService`
- [x] Roadmap F-10 `CÓ (2026-09-06)`; spec header ghi "đợt F đã triển khai (UNI-424)"; plan → `shipped`
- [x] `make check` xanh; `[agent]` comment trên UNI-424

## Đã cố ý bỏ ra ngoài

- Runtime (`agent_runs`, proposals, executor) — A-01.
- Settings → Agents UI; endpoint xóa agent khỏi workspace; `agent.updated` realtime — sub-issue.
- Cột `member_kind`/`agent_id` trên `workspace_members` — thay bằng bảng riêng (AG1).
- Refactor `userID → Actor` trên đường đọc và trên command không ghi `_kind` — làm khi có caller không phải người.
