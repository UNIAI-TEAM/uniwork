# UniWork — Agent/integration surfaces (UNI-426 lát cắt 6)

> **Trạng thái:** in-progress — thiết kế duyệt 2026-09-09; plan Tasks 1–10 shipped (stub chrome + shells + overlay); capabilities agent* vẫn Unavailable; F-05 / umbrella vẫn MỘT PHẦN

**Ngày:** 2026-09-09  
**Issue:** UNI-519 (sub-issue dưới UNI-426 · lát cắt 6)  
**Parent:** UNI-426 · F-05  
**Phụ thuộc:** UNI-495 + UNI-497 + UNI-500 + UNI-502 + UNI-505 đã trên `develop`  
**Umbrella:** `2026-09-07-tasks-work-management-parity-design.md` §4.4–4.5 (phần Agent/VCS), §5.2, §8, §11 mục 6  
**Baseline nguồn:** `multica/` @ `3d37828e9`

## 1. Mục tiêu

Port **Agent/integration surfaces** theo contract stub từ Multica: UI đúng chỗ hình học
(AgentRun history/usage/retry/terminate, PR list, squad/runtime shells, VCS/workdir
controls) khi bật `tasks_work_management_parity`, mọi control disabled +
`reason_code`, API stub chuẩn hóa trả `capability_unavailable` — **không** runtime
agent/VCS/daemon thật, không flip capability sang `available`, không agent write
business tables (ADR 0010). Flag tắt: không lộ suite chrome / nav. Không desktop/
mobile (lát 7) hay cutover (lát 8).

## 2. Quyết định đã chốt (brainstorm 2026-09-09)

| Chủ đề | Quyết định |
| --- | --- |
| Phạm vi | Full stub contract parity Multica (không runtime thật) |
| Rollout UI | Cùng flag `tasks_work_management_parity` |
| Backend | Chuẩn hóa stub routes SDI/SDO + tests; vẫn `capability_unavailable` |
| Surfaces | Embedded trên Tasks/Projects **và** shell `/squads`, `/runtimes` |
| Approach | Capability-first stubs + shared disabled control; transplant chrome |

## 3. Phạm vi

### 3.1 Trong phạm vi

**Embedded UI**

- Task detail: thay stub mỏng lát 5 bằng panel AgentRun (history / usage /
  retry / terminate chrome) + Pull Request list — port từ Multica
  `execution-log-section`, `issue-usage-dialog`, `pull-request-list`, activity
  chips; mọi action disabled + reason.
- Task Surface / batch / create flows: trigger agent / assign squad —
  visible-disabled khi capability off.
- Projects resources: GitHub / local directory — siết disabled-contract tests.

**Shell pages**

- `packages/views/squads/` — list (+ optional detail) transplant chrome;
  empty/disabled; không CRUD thật.
- `packages/views/runtimes/` — list shell tương tự.
- `apps/web` routes `/{org}/{ws}/squads`, `/{org}/{ws}/runtimes` (+ `[id]` nếu
  inventory yêu cầu); sidebar nav khi flag on; unavailable khi flag off.
- `paths` + reserved slugs; lazy-load nếu bundle budget.

**API / core**

- Chuẩn hóa stub routes hiện có (`tasks_stubs`, vcs connections, agent task
  cancel/rerun, PRs, …) và bổ sung thiếu so với Multica surface: luôn
  `capability_unavailable` + stable `reason_code`; SDI/SDO có description/example.
- Client endpoints/hooks (nếu UI cần gọi): `parseWithFallback` + malformed tests;
  short-circuit khi catalogue unavailable (không toast success).
- Capability registry: **giữ** `tasks.agent_runs` / `squads` / `vcs` /
  `local_workdir` = `unavailable` (không Available trong lát này).

**i18n / parity**

- Mọi literal views qua `t()`; brand-scan; overlay verification lát 6.

**Tùy chọn nhỏ cùng PR nếu rẻ**

- Flip `tasks.projects` → `Available` nếu lát 4 đã đủ gate mà catalogue quên
  (nợ quan sát); không block DoD lát 6.

### 3.2 Ngoài phạm vi

- Agent runtime execute / proposal lifecycle / `accepted` human-only thật (F-10 /
  ADR 0010 enforcement tests đầy đủ — có thể thêm test “stub không set accepted”
  nếu rẻ, không build runtime).
- VCS provider OAuth, daemon/workdir sync thật.
- Desktop / mobile hosts (lát 7).
- Cutover xóa MVP + gỡ flag (lát 8).
- Đổi model agent identity org/ws đã có (list/create agent) trừ khi block stub UI.

## 4. Kiến trúc

```text
Flag tasks_work_management_parity
  off → MVP; no suite agent/squad/runtime nav
  on  → suite
        ├ tasks/detail     AgentRun + PR panels (disabled)
        ├ tasks/surface    trigger/assign stubs (disabled)
        ├ projects         resource GitHub/local (disabled)
        ├ views/squads     shell pages
        └ views/runtimes   shell pages
              ↓
        GET/POST stub APIs → capability_unavailable
        catalogue: agent_runs|squads|vcs|local_workdir = unavailable
```

### 4.1 Shared primitives

- Reuse / extract `CapabilityDisabledControl` (hoặc pattern từ
  `timeline-runtime-stubs`) — `aria-disabled`, tooltip/dialog, `explanation_key`.
- Không Zustand server cache cho AgentRun; không optimistic.

### 4.2 Package map đích

```text
packages/views/tasks/detail/components/   # agent-run panel, pr-list, …
packages/views/squads/
packages/views/runtimes/
packages/core/api/endpoints/              # stub client nếu cần
server/internal/handler/router/tasks_stubs.go  # mở rộng + SDI/SDO
apps/web/app/.../squads/
apps/web/app/.../runtimes/
```

## 5. Lỗi và stub

| Tình huống | Hành vi |
| --- | --- |
| Flag off | Không nav / không mount suite agent chrome |
| Capability unavailable | Disabled + reason; no mutation |
| Stub HTTP bị gọi | `capability_unavailable` + reason_code; no DB write |
| Empty squads/runtimes | Empty state + `t()` + capability explanation |
| Cross-tenant id | 404/forbidden như surface khác |

## 6. Kiểm thử và DoD

- Go: mỗi stub route → capability_unavailable; no business row side-effect.
- Views: disabled-contract tests cho detail AgentRun/PR, Surface, projects
  resources, squads/runtimes shells.
- Core: malformed endpoints nếu thêm client schemas.
- Brand-scan + parity overlay lát 6; E2E smoke flag on/off.
- `make check` xanh trước PR.
- F-05 / umbrella vẫn `MỘT PHẦN`; dual path đến lát 8; capabilities agent* vẫn
  unavailable.

## 7. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| Fake success / mock run state | Cấm local fake store; contract tests |
| Scope creep runtime | Global out-of-scope; ADR 0010 |
| Bundle budget shells | Lazy-load routes |
| Brand Multica sót | Brand-scan gate |
| Catalogue `tasks.projects` lệch | Optional fix; không block |

## 8. Việc làm tiếp theo

1. User duyệt file spec này.  
2. `writing-plans` → `docs/superpowers/plans/2026-09-09-agent-integration-surfaces.md`.  
3. Tạo sub-issue UniAI dưới UNI-426 (UNI-426.6).  
4. `make issue-start` + SDD execute.
