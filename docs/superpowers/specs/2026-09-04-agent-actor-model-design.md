# UniWork — Agent là actor hạng nhất (Agent Actor Model, đợt F + A)

**Ngày:** 2026-09-04  
**Trạng thái:** Đã duyệt (2026-09-04, quangpd — UNI-421). Câu hỏi mở đã chốt trong `docs/roadmap/OPEN_QUESTIONS.md`; ADR 0007–0010 accepted.  
**Spec liên quan:** `2026-09-04-ai-platform-gateway-design.md` (tiền đề), `2026-08-27-workspace-permissions-design.md`, `2026-08-27-tasks-multica-parity-design.md`, `2026-08-24-uniwork-platform-design.md`  
**Tham chiếu:** PRODUCT.md § Agent Principles; bản cũ `unidigiwork`: `docs/architecture/ADR_AI_ACTION_PROPOSE_CONFIRM_EXECUTE.md`, `docs/ai/AI_ACTION_GOVERNANCE_V1.md`, `docs/ai/WEE2_AI_WORKER_GOVERNANCE.md`, `src/domain/work-execution/plan-schema.ts`, `src/domain/ai-governance/contracts.ts`, `docs/architecture/work-execution/*`


> **Ghi chú số migration:** số `0NN_` trong spec này là **giữ chỗ**; số thật được cấp khi viết plan, theo thứ tự triển khai trong `docs/roadmap/FEATURE_ROADMAP.md` (audit/outbox → entitlement → tasks → notifications → …) và theo migration mới nhất trên `develop` lúc đó. Các spec cùng ngày có dải số trùng nhau là cố ý.

## 1. Mục tiêu

Hiện thực tuyên bố duy nhất UniWork được phép bán: **agent là đồng sở hữu công việc**. Một agent có danh tính trong tổ chức, là thành viên workspace, được giao task, chạy việc với trạng thái thật, giao kết quả kèm bằng chứng, **đề xuất** thay đổi nghiệp vụ và **dừng lại chờ người duyệt**. Mọi việc agent làm được ghi nhận, phân biệt được bằng mắt, hoàn tác được.

Bản cũ đã có WEE-1 (pipeline), WEE-2 (governance runtime), WEE-3 (quality evidence) nhưng `ai_task_executions = 0` — chưa từng chạy. Spec này kế thừa bất biến, viết lại mô hình dữ liệu trên nền `organizations / workspaces / tasks` của UniWork, và ép bất biến bằng test thay vì tài liệu.

**Deliverable**

- **Đợt F (nền):** `actors` + `actor_kind` trên bản ghi, agent là workspace member, UI attribution. Chưa có runtime.
- **Đợt A (runtime):** giao task cho agent → run → deliverable/evidence → proposals → người duyệt/hoàn tác; activity feed; policy rủi ro.

**Ngoài phạm vi:** marketplace agent, agent tự tạo agent, agent trong workflow (spec workflow riêng), gửi email/ngoại tuyến, auto-execute mức rủi ro ≥ medium.

## 2. Quyết định đã chốt

| # | Quyết định |
|---|------------|
| 1 | **Một khái niệm actor, hai loại.** `actor_kind ∈ {human, agent}`. Người vẫn là `users`; agent là bảng `agents`. Không tạo `users` giả cho agent (tránh lẫn auth, email, mật khẩu). |
| 2 | **Agent thuộc organization, tham gia workspace như member.** `workspace_members` thêm `member_kind` (human/agent) và `agent_id`; công thức `RequireMember` không đổi cho người; agent có `RequireAgentMember` riêng, cùng file. |
| 3 | **Role của agent là `agent`** (không phải owner/admin/member). Agent không invite, không đổi role, không sửa settings, không xóa. Quyền nội dung = member với ràng buộc tool registry. |
| 4 | **Trạng thái kết thúc của agent chỉ là `waiting_review` hoặc `failed`.** `accepted` chỉ người ghi được, qua endpoint có `RequireMember` của người. Test ép: không có đường mã nào đặt `accepted` với `actor_kind='agent'`. |
| 5 | **Agent không ghi dữ liệu nghiệp vụ trực tiếp.** Mọi thay đổi ra `agent_action_proposals`; execute chỉ chạy khi `confirmed` bởi người, và executor bọc **service hiện có** (`TaskService.Update` …) với actor là người xác nhận, provenance là agent. |
| 6 | **Rủi ro do server quyết**, model không khai. `low` (thêm comment, tạo task nháp) có thể auto khi policy cho phép; `medium` (đổi trạng thái/assignee/due), `high` (đổi việc urgent, tạo họp >15 người) luôn cần duyệt; `critical` (xóa, quyền, thành viên, billing) **bị cấm**, không đăng ký tool. |
| 7 | **Hoàn tác là dữ liệu.** Mỗi proposal `executed` lưu `undo_payload` đủ để đảo ngược qua cùng service; nút "Hoàn tác" cho người, cùng affordance với undo của người. |
| 8 | **Ranh giới chi phí.** Mỗi run có `budget_tokens`; vượt ⇒ `failed(reason=budget_exceeded)`. Chi phí đi qua gateway metering với `actor_kind='agent'`. |
| 9 | **Không tạo runtime engine mới.** Run là job trong worker hiện có (goroutine + Redis lock, giống `RunAutoEnd`), gọi `ai.Gateway`; không thêm hệ thống hàng đợi mới ở đợt A. |

## 3. Mô hình khái niệm

```
organization
└── agents (danh tính, owner là người, trạng thái active/paused)
    └── workspace_members (member_kind='agent') ── tasks.assignee_kind='agent'
            │
            ▼
        agent_runs (queued → running → waiting_review → accepted | failed | cancelled)
            ├── agent_run_steps    (plan/generate/evaluate, mỗi bước có usage_event_id)
            ├── agent_deliverables (nội dung bàn giao + evidence citations)
            └── agent_action_proposals (proposed → confirmed | rejected → executed | undone | failed)
```

Vòng đời một task giao cho agent:

1. Người assign task cho agent (assignee_kind=agent) → service tạo `agent_run` `queued`, event `agent_run.created`.
2. Worker nhận run → `running`; pipeline **PLAN → GENERATE → EVALUATE** (kế thừa WEE-1; ACTION nằm trong PLAN dưới dạng `action_intent` enum đóng).
3. Kết quả: `agent_deliverables` (markdown + citations tới nguồn có quyền) và 0..n `agent_action_proposals`.
4. Run → `waiting_review`; task nhận comment hệ thống "UNI đã hoàn thành bản nháp, chờ bạn duyệt" (author = agent, attribution rõ).
5. Người review: chấp nhận run (`accepted`), yêu cầu sửa (`requested_changes` → tạo run mới nối `parent_run_id`), hoặc từ chối (`rejected`). Từng proposal xác nhận/từ chối riêng.
6. Proposal `confirmed` → executor gọi service hiện có với `actor = người xác nhận`, `origin = agent:<id>`, ghi `undo_payload` → `executed`. Event `task.updated` bình thường + `agent_proposal.executed`.
7. Người bấm "Hoàn tác" ⇒ executor áp `undo_payload` ⇒ `undone`.

## 4. Data model

Không FK, ULID text, index `CONCURRENTLY` file riêng.

### 4.1 Đợt F

```sql
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,                     -- unique trong org, dùng @mention: 'uni'
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',    -- active | paused | archived
  owner_user_id TEXT NOT NULL,              -- người chịu trách nhiệm
  autonomy_policy TEXT NOT NULL DEFAULT '{}',-- JSON {low:'auto'|'approve', medium:'approve', high:'approve', critical:'deny'}
  allowed_tools TEXT NOT NULL DEFAULT '[]', -- JSON tên tool ⊆ registry
  budget_tokens_per_run INTEGER NOT NULL DEFAULT 60000,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
-- unique (organization_id, handle) WHERE archived_at IS NULL

ALTER TABLE workspace_members ADD COLUMN member_kind TEXT NOT NULL DEFAULT 'human';  -- human | agent
ALTER TABLE workspace_members ADD COLUMN agent_id TEXT;                              -- NOT NULL khi agent
-- PK hiện tại (workspace_id, user_id): hàng agent dùng user_id = agent_id (ULID không trùng không gian) — câu hỏi mở #1

ALTER TABLE tasks ADD COLUMN assignee_kind TEXT NOT NULL DEFAULT 'human';           -- human | agent
ALTER TABLE tasks ADD COLUMN created_by_kind TEXT NOT NULL DEFAULT 'human';
ALTER TABLE task_comments ADD COLUMN author_kind TEXT NOT NULL DEFAULT 'human';
ALTER TABLE task_comments ADD COLUMN origin TEXT;                                   -- 'agent_run:<id>' khi do run sinh
ALTER TABLE meetings ADD COLUMN created_by_kind TEXT NOT NULL DEFAULT 'human';
ALTER TABLE chat_messages ADD COLUMN author_kind TEXT NOT NULL DEFAULT 'human';
```

Quy ước từ nay: **mọi bảng mới có `created_by` phải có `created_by_kind`**; lint migration (`server/migrations/lint_test.go`) thêm rule này cho migration sau số áp dụng.

### 4.2 Đợt A

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  parent_run_id TEXT,
  requested_by TEXT NOT NULL,               -- người assign / yêu cầu sửa
  status TEXT NOT NULL DEFAULT 'queued',    -- queued | running | waiting_review | accepted | rejected | failed | cancelled
  reason_code TEXT,                         -- budget_exceeded | tool_not_allowed | provider_error | evaluation_failed | ...
  instructions TEXT NOT NULL DEFAULT '',    -- yêu cầu sửa từ người (run con)
  budget_tokens INTEGER NOT NULL,
  used_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  quality_score INTEGER,                    -- 0..100 từ EVALUATE, không quyết accept
  reviewed_by TEXT,                         -- luôn là user (người)
  reviewed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,                       -- plan | generate | evaluate | tool
  status TEXT NOT NULL,                     -- succeeded | failed | skipped
  tool_name TEXT,
  usage_event_id TEXT,                      -- nối ai_usage_events
  summary TEXT NOT NULL DEFAULT '',         -- không lưu prompt/nội dung nguồn
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_deliverables (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'markdown',
  content TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',     -- [{source_id, kind, href, quote}]
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_action_proposals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  action_type TEXT NOT NULL,                -- enum đóng §5.3
  target_kind TEXT NOT NULL,                -- task | meeting | comment
  target_id TEXT,
  payload TEXT NOT NULL,                    -- JSON đã qua schema, chỉ field được phép
  risk_level TEXT NOT NULL,                 -- server quyết
  governance TEXT NOT NULL DEFAULT '{}',    -- {decision, reason_code, policy_version, effective_scope}
  status TEXT NOT NULL DEFAULT 'proposed',  -- proposed | confirmed | rejected | executed | undone | failed | denied
  decided_by TEXT,                          -- user
  decided_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  undo_payload TEXT,                        -- JSON đảo ngược
  undone_by TEXT,
  undone_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_events (  -- feed chung người + agent (đợt A, dùng lại cho notifications)
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  verb TEXT NOT NULL,                       -- task.assigned | agent_run.waiting_review | proposal.executed | ...
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  origin TEXT,                              -- agent_run:<id> khi hành động người do agent đề xuất
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Index: `agent_runs(workspace_id, status, created_at DESC)`, `agent_runs(task_id, created_at DESC)`, `agent_action_proposals(run_id)`, `agent_action_proposals(workspace_id, status)`, `activity_events(workspace_id, created_at DESC)`, `activity_events(target_kind, target_id, created_at DESC)`.

## 5. Quy tắc nghiệp vụ

### 5.1 Membership & quyền

- `WorkspaceService.RequireMember(userID, wsID)` không đổi. Thêm `RequireAgentMember(agentID, wsID)` cùng file — arch test giữ "chỉ workspace.go đọc `workspace_members`".
- Agent thấy đúng những gì member thấy trong workspace đó, **giao** với `agent.allowed_tools` và phạm vi run (`task_id`, workspace). Không có nhánh hợp (kế thừa WEE-2: worker ∩ người yêu cầu ∩ run).
- Người yêu cầu (`requested_by`) mất quyền giữa chừng ⇒ run `failed(reason=requester_forbidden)`; proposal đang chờ ⇒ `denied`.
- Agent `paused` ⇒ run mới `cancelled`, proposal chờ vẫn duyệt được (người quyết), nhưng không execute cho tới khi agent active — câu hỏi mở #3.

### 5.2 Trạng thái run (máy trạng thái, test bảng)

| Từ | Đến | Ai |
|---|---|---|
| queued | running | worker |
| running | waiting_review / failed | worker (**chỉ hai đích này**) |
| waiting_review | accepted / rejected | người có `RequireMember` |
| waiting_review | queued (run con, `parent_run_id`) | người: "Yêu cầu sửa" |
| queued / running | cancelled | người, hoặc hệ thống khi agent paused/budget |

Test `TestAgentCannotAccept`: gọi `RunService.Transition(..., actorKind=agent, to=accepted)` ⇒ `ErrForbidden`. Test `TestWorkerTerminalStates`: worker chỉ có thể ghi `waiting_review|failed`.

### 5.3 Action type (enum đóng) & rủi ro

| action_type | target | rủi ro | payload cho phép |
|---|---|---|---|
| `add_comment` | task | low | `{body}` |
| `create_task` | task | low | `{title, description, priority?, due_date?}` — không assignee |
| `update_task_fields` | task | medium; high nếu task `high|urgent` và đổi `assignee_id|due_date` | `{title?, description?, status?, priority?, due_date?, assignee_id?}` |
| `create_meeting` | meeting | medium; high nếu >15 attendee | `{title, starts_at, ends_at, attendee_ids[]}` |

Không có `delete_*`, không đổi member/role/settings/billing (critical ⇒ không tồn tại trong registry). Payload qua JSON schema nghiêm ngặt (kế thừa `plan-schema.ts`): trường lạ bị loại, không "sửa cho qua".

`resolveRiskLevel(action, payload, target)` là hàm thuần trong `service/agent_policy.go`, có bảng test; model không truyền `risk`.

### 5.4 Autonomy policy

`agents.autonomy_policy` mặc định `{low:'approve', medium:'approve', high:'approve', critical:'deny'}`. Chỉ `low` được đặt `'auto'`; đặt `'auto'` cho mức khác ⇒ validation error. Hằng `AutoExecuteEnabled` toàn hệ thống mặc định `false` ở đợt A; bật qua env `AGENT_AUTO_EXECUTE_LOW_RISK=true` sau khi có ≥ 200 run thật (tiêu chí thoát đợt A trong Vision).

Đánh giá policy ở **hai cổng** (kế thừa WEE-2): lúc tạo proposal (deny ⇒ không ghi proposal, step `skipped` với reason) và lúc confirm (nạp lại policy hiện tại; quyền bị thu hồi ⇒ `denied`).

### 5.5 Executor

`service/agent_executor.go`: `switch action_type` → gọi `TaskService.Update / AddComment / Create`, `MeetingService.Create` với `userID = decided_by`, kèm `Origin{Kind:"agent_run", ID}` để service ghi `*_kind` và `origin`. Trước khi gọi, đọc trạng thái hiện tại để dựng `undo_payload` (ví dụ `{status:'todo', assignee_id:'…'}`). Executor **không** có SQL riêng — arch test chặn `agent_executor.go` import `pkg/db` ngoài kiểu.

Undo: `Undo(proposalID, userID)` áp `undo_payload` qua cùng service; nếu bản ghi đã bị người khác sửa sau execute (so `updated_at`) ⇒ `ErrConflict`, UI giải thích và mở bản ghi.

### 5.6 Pipeline run (worker)

1. **PLAN** (`agent_planning`): input = task + context pack (gateway ContextBuilder, actor = agent member); output schema `{objective, steps[≤6]{summary, action_intent?}}`, `action_intent.action_type ∈ enum`.
2. **GENERATE** (`agent_generation`): deliverable markdown + citations; citation validator gỡ nguồn không có trong pack.
3. **EVALUATE** (`agent_evaluation`): chấm 0..100 theo tiêu chí trong task description (acceptance criteria nếu có) — chỉ là **tín hiệu**, không tự accept; < ngưỡng `AGENT_MIN_QUALITY=40` ⇒ `failed(reason=evaluation_failed)`, người vẫn xem được deliverable.
4. Mỗi `action_intent` ⇒ `resolveRiskLevel` ⇒ policy ⇒ proposal hoặc skip.
5. Ghi comment hệ thống lên task, run → `waiting_review`, event.

Budget: tổng token của 3 bước ≤ `budget_tokens`; vượt sau bước nào thì `failed` sau bước đó, bước đã chạy giữ lại.

## 6. API

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET/POST | `/organizations/{id}/agents` | org admin tạo; member xem | SDI `{name, handle, description, autonomy_policy?, allowed_tools?}` |
| PATCH | `/agents/{id}` | org admin hoặc owner_user_id | đổi status/policy/tools |
| POST | `/workspaces/{id}/members` | ws admin | mở rộng SDI `{agent_id}` thay `user_id`; role cố định `agent` |
| PATCH | `/tasks/{id}` | member | `assignee_id` + `assignee_kind='agent'` ⇒ tạo run (server, không endpoint riêng) |
| GET | `/tasks/{id}/runs` | member | run + steps tóm tắt |
| GET | `/runs/{id}` | member | run, deliverable mới nhất, proposals |
| POST | `/runs/{id}/review` | member (người) | SDI `{decision:'accept'|'reject'|'request_changes', instructions?}` |
| POST | `/runs/{id}/cancel` | member | |
| POST | `/proposals/{id}/decide` | member (người) | SDI `{decision:'confirm'|'reject', edits?}` — `edits` chỉ trong field cho phép; confirm ⇒ execute đồng bộ |
| POST | `/proposals/{id}/undo` | member (người) | |
| GET | `/workspaces/{id}/activity?actor_kind=&target=` | member | feed |
| GET | `/workspaces/{id}/runs?status=waiting_review` | member | hàng chờ duyệt |

Mã lỗi: `agent_paused`, `agent_not_member`, `run_invalid_transition`, `proposal_denied`, `proposal_conflict`, `agent_budget_exceeded`, `action_not_allowed`.

Realtime (`<entity>.<verb>`, payload id): `agent_run.created|updated`, `agent_proposal.created|updated`, `activity.created`, cộng `task.updated` hiện có. FE invalidate `runKeys.byTask(taskId)`, `proposalKeys.byRun`, `activityKeys.list(wsId)`.

## 7. Frontend

| Path | Trách nhiệm |
|---|---|
| `packages/core/types/agent.ts` | `Agent`, `AgentRun`, `AgentRunStatus` (+ `AGENT_RUN_STATUSES`), `AgentProposal`, `ActivityEvent`; lenient |
| `packages/core/api/endpoints/agents.ts` | CRUD agent, runs, review, decide, undo, activity + malformed tests |
| `packages/core/agents/hooks.ts` | `agentKeys`, `runKeys`, `proposalKeys`, `activityKeys` (đều có `wsId`); mutation không optimistic (kết quả không dự đoán được cục bộ) |
| `packages/core/permissions/rules.ts` | `canReviewRun`, `canDecideProposal`, `canManageAgents` — mirror Go; agent actor luôn `false` cho review/decide |
| `packages/views/agents/agent-badge.tsx` | Badge "Agent" cạnh tên/avatar; dùng ở mọi nơi hiển thị actor (comment, assignee, activity, chat) — **một component**, không tự vẽ lại |
| `packages/views/agents/agent-list.tsx`, `agent-form.tsx` | Settings tổ chức → Agents |
| `packages/views/tasks/task-detail` | Panel "UNI" trong task detail: trạng thái run thật (queued/running/waiting_review/failed + timestamp), deliverable, danh sách proposal với Xác nhận / Từ chối / Sửa rồi xác nhận, Hoàn tác; không fake progress |
| `packages/views/agents/review-queue.tsx` | `/{org}/{ws}/agents/review`: hàng chờ duyệt; `paths.agentReview(org, ws)` |
| `packages/views/activity/activity-feed.tsx` | Lọc theo `actor_kind`; hành động người có `origin` hiển thị "theo đề xuất của UNI" |
| `packages/core/i18n/locales` | `agent.*`, `run.status.*`, `proposal.*`; giọng đồng nghiệp, không mascot |

Trạng thái hiển thị: `queued` "Đang xếp hàng", `running` "Đang làm", `waiting_review` "Chờ bạn duyệt", `failed` "Không hoàn thành", `accepted` "Đã nghiệm thu" — kèm thời điểm thật. Empty state task chưa giao agent: "Giao cho UNI để nhận bản nháp chờ bạn duyệt".

## 8. Bất biến thành test (bắt buộc trước khi merge đợt A)

| Test | Chặn gì |
|---|---|
| `TestAgentCannotAccept` | agent đặt `accepted` |
| `TestWorkerTerminalStates` | worker ghi trạng thái ngoài `waiting_review|failed` |
| `TestProposalRequiresHumanDecision` | execute khi `decided_by` không phải user |
| `TestExecutorUsesServicesOnly` (arch) | `agent_executor.go` có SQL/ghi trực tiếp |
| `TestRiskResolvedServerSide` | payload có trường `risk` ⇒ bị bỏ; bảng rủi ro đúng §5.3 |
| `TestCriticalActionsNotRegistered` | registry chứa delete/member/role/billing |
| `TestAutonomyOnlyLowCanAuto` | policy `medium:'auto'` bị từ chối |
| `TestPolicyReevaluatedOnConfirm` | thu hồi quyền giữa chừng ⇒ `denied` |
| `TestRunScopeIntersection` | tool đọc dữ liệu ngoài workspace của run |
| `TestBudgetStopsRun` | vượt budget ⇒ `failed(budget_exceeded)`, không gọi bước tiếp |
| `TestUndoRoundTrip` | update → undo trả đúng giá trị cũ; conflict khi có sửa chen |
| `TestActorKindOnEveryCreatedBy` (migration lint) | bảng mới có `created_by` mà không có `created_by_kind` |
| E2E | assign task cho UNI → chờ `waiting_review` (fake provider) → confirm proposal → task đổi trạng thái với badge Agent → undo → trạng thái cũ; user khác workspace không thấy run |

Coverage floor tăng cùng đợt; `pnpm knip` sạch; vi/en đủ khóa.

## 9. Kế thừa từ WEE-1/2/3

| Bản cũ | Xử lý |
|---|---|
| Pipeline CONTEXT→PLAN→GENERATE→ACTION→VALIDATE→REVIEW | Gộp thành PLAN→GENERATE→EVALUATE; ACTION là `action_intent` trong PLAN; REVIEW là trạng thái `waiting_review` |
| Trạng thái kết thúc `WAITING_REVIEW|FAILED`, `ACCEPTED` chỉ người | Kế thừa nguyên vẹn, thành test |
| `plan-schema.ts` enum đóng 4 action | Kế thừa 4 action, đổi tên snake_case, bỏ `create_email_draft` (không có email) → thay `add_comment` |
| WEE-2: worker ∩ user ∩ run, hai cổng, fail-closed, `governance` jsonb | Kế thừa |
| WEE-2 `SUGGEST→PREPARE→EXECUTE_WITH_APPROVAL→AUTO_EXECUTE` | Rút gọn `approve|auto|deny` theo mức rủi ro |
| WEE-3 quality evidence, cohort | Giữ `quality_score` + citations; cohort/work products để đợt sau (Reporting) |
| `ai_workers`, `ai_task_executions`, `ai_action_proposals` (Supabase) | Không port; thiết kế lại trên `organizations/workspaces` |
| `ai_worker.policy_evaluated` audit event | Thành `activity_events` + `proposal.governance` |

## 10. Câu hỏi mở (chủ sở hữu sản phẩm quyết)

1. **Khóa `workspace_members`:** giữ PK `(workspace_id, user_id)` và để hàng agent dùng `user_id = agent_id` (ít migration, hơi "lệch tên"), hay tạo bảng `workspace_agent_members` riêng (sạch, nhưng `RequireMember` phải hợp hai bảng)? Đề xuất: bảng riêng.
2. **Ai được tạo agent:** chỉ org owner/admin, hay ws admin cũng được tạo agent phạm vi workspace? Ảnh hưởng chi phí AI theo org.
3. **Agent `paused` còn proposal chờ:** cho người vẫn xác nhận và execute (người chịu trách nhiệm) hay đóng băng hết? Spec đang chọn: xác nhận được, execute được — vì executor chạy bằng quyền người.
4. **Auto-execute mức `low`:** bật ngay cho `add_comment` từ đợt A hay giữ mọi thứ chờ duyệt cho tới khi có 200 run thật? Vision đề xuất chờ.
5. **Ngưỡng chất lượng `AGENT_MIN_QUALITY`:** có chặn `failed` khi điểm thấp, hay luôn giao về người duyệt kèm điểm? Chặn giúp tiết kiệm thời gian người, nhưng che mất deliverable "gần đạt".
6. **Một agent mặc định "UNI" cho mọi org** (tạo lúc onboarding, hàng chờ Ask UNI dùng chung danh tính) hay để org tự tạo? Đề xuất: tạo mặc định, org đổi tên được.
