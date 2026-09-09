# UNI-426.6 · Agent/integration surfaces Implementation Plan

> **Trạng thái:** in-progress — UNI-519 · Tasks 1–10 done (slice 6 stub surfaces + parity overlay); F-05 / umbrella vẫn MỘT PHẦN

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi flag `tasks_work_management_parity` bật, suite hiện đủ chrome AgentRun / PR / squad / runtimes / VCS / workdir đúng chỗ Multica nhưng **disabled + reason**; stub HTTP chuẩn hóa trả `capability_unavailable`; flag tắt không lộ nav/shell. Không runtime thật; không flip capability `available`.

**Architecture:** Capability-first stubs. Shared disabled control; transplant Multica detail AgentRun/PR panels + squads/runtimes page shells; mở rộng `tasks_stubs` + workspace stubs (squad directory, workdir) với SDI/SDO; client short-circuit khi catalogue unavailable. Catalogue bốn key agent* giữ `unavailable`.

**Tech Stack:** Next.js App Router, React 19, TanStack Query, Vitest, i18next, `@uniwork/ui`, Go/Chi handlers, workcapability catalogue.

**Spec:** `docs/superpowers/specs/2026-09-09-agent-integration-surfaces-design.md`  
**Umbrella:** `docs/superpowers/specs/2026-09-07-tasks-work-management-parity-design.md` §8, §11 mục 6  
**Baseline:** `multica/` @ `3d37828e9`  
**Tracking:** Parent `UNI-426`; sub-issue tạo ở Task 1; phụ thuộc UNI-505 trên `develop`.

## Global Constraints

- Trước product code: tạo sub-issue dưới UNI-426 rồi `make issue-start KEY=<KEY>` từ `develop` đã có UNI-505.
- Không branding nguồn (`multica`, `@multica/`, domain `Issue`) trong product/tests/i18n.
- **Không** fake AgentRun success / local mock run store; **không** agent write business tables.
- Capability `tasks.agent_runs` | `squads` | `vcs` | `local_workdir` **giữ unavailable** sau lát này.
- Flag off: không nav Squads/Runtimes; không mount suite agent chrome trên MVP.
- Mọi JSX text views qua `t()`; file ≤500 lines; TDD; conventional commits + Refs trailer.
- F-05 / umbrella vẫn `MỘT PHẦN`.

### Transplant rename map

| Nguồn | Đích |
| --- | --- |
| `Issue` / Agent Task | `Task` / `AgentRun` |
| `@multica/*` | `@uniwork/*` |
| Multica squads/runtimes pages | `packages/views/squads|runtimes/` |
| Multica PR/execution-log/usage | `packages/views/tasks/detail/components/` |

---

## File map

### Provenance

- Create: `docs/parity/agent-integration-surfaces-inventory.json`
- Create: `scripts/agent-integration-brand-scan.test.mjs`
- Create: `docs/parity/tasks-work-management.slice6-verification.json`

### Shared UI

- Create: `packages/views/common/capability-disabled-control.tsx` (+ test) — hoặc mở rộng pattern từ `timeline-runtime-stubs` thành shared export.

### Detail / Surface / Projects

- Replace/expand: `packages/views/tasks/detail/components/timeline-runtime-stubs.tsx` → AgentRun panel + PR list (disabled).
- Create: agent-run-panel, pull-request-list, usage dialog chrome (disabled).
- Modify: Task Surface / batch / create assignee-squad / trigger — capability gate.
- Modify: projects resources GitHub/local — contract tests.

### Shells

- Create: `packages/views/squads/**`, `packages/views/runtimes/**`
- Create: `apps/web/.../squads/page.tsx`, `runtimes/page.tsx` (+ `[id]` nếu inventory)
- Modify: sidebar, paths, reserved slugs

### API

- Modify: `server/internal/handler/router/tasks_stubs.go` (+ workspace stubs cho squads/workdir nếu thiếu)
- Ensure reason_code mapping per capability; expand handler tests
- Optional client stub endpoints under `packages/core/api/endpoints/`

### Optional

- Flip `tasks.projects` → Available nếu rẻ (catalogue nợ)

---

### Task 1: Issue branch, inventory, brand-scan

**Files:**

- Create: `docs/parity/agent-integration-surfaces-inventory.json`
- Create: `scripts/agent-integration-brand-scan.test.mjs`
- Wire into `scripts/check.sh` if needed

**Interfaces:**

- Inventory `{schema_version:1, baseline_commit:"3d37828e9", owner_issue:"<KEY>", entries:[… disposition port|adapt|stub|skip_later_slice]}`
- Scan roots: `packages/views/squads`, `packages/views/runtimes`, `packages/views/tasks/detail` agent/PR paths, product locale keys mới

- [ ] **Step 1: UniAI sub-issue + `make issue-start` từ develop**

```bash
git fetch origin develop && git checkout develop && git pull --ff-only
uniai issue create --title "UNI-426.6 · Agent/integration surfaces" --parent UNI-426 \
  --description "Lát cắt 6 F-05 stub contracts. Spec: docs/superpowers/specs/2026-09-09-agent-integration-surfaces-design.md. Plan: docs/superpowers/plans/2026-09-09-agent-integration-surfaces.md. Phụ thuộc UNI-505."
make issue-start KEY=<KEY>
```

- [ ] **Step 2: Inventory** — Multica `squads/`, `runtimes/`, issue agent/PR/execution/usage components; disposition stub/port/adapt.

- [ ] **Step 3: Brand-scan** — fail multica / @multica / Issue domain; empty dirs PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(parity): slice6 inventory and brand-scan gate

EOF
)"
```

---

### Task 2: Shared CapabilityDisabledControl

**Files:**

- Create: `packages/views/common/capability-disabled-control.tsx`
- Create: `packages/views/common/capability-disabled-control.test.tsx`
- Export from views package if needed

**Interfaces:**

```tsx
type Props = {
  capabilityKey: "tasks.agent_runs" | "tasks.squads" | "tasks.vcs" | "tasks.local_workdir" | string;
  children: React.ReactNode; // render prop or wrap Button
  label: string;
  testId?: string;
};
// When unavailable: aria-disabled, title/aria-describedby from explanation_key via t()
// onClick no-op (does not call mutation)
```

- [ ] **Step 1: Failing test** — unavailable → aria-disabled + reason; available → enabled (for future)

- [ ] **Step 2: Implement using `usePublicConfig` + `capabilityState`**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(views): shared capability-disabled control for stub surfaces

EOF
)"
```

---

### Task 3: Expand stub HTTP routes + Go contract tests

**Files:**

- Modify: `server/internal/handler/router/tasks_stubs.go` (and related workspace stub registration)
- Modify: `server/internal/handler/task_stubs_test.go` (or new `agent_integration_stubs_test.go`)
- SDI/SDO descriptions with reason_code documentation
- Ensure stub maps to correct reason per path family:
  - agent task / usage / cancel / rerun → `agent_runtime_missing`
  - pull-requests / vcs → `vcs_provider_missing`
  - squad directory routes (add if missing) → `squad_directory_missing`
  - workdir/daemon routes (add if missing) → `local_daemon_missing`

**Interfaces:**

- Handler continues `WorkManagementCapabilityStub` (or thin wrappers setting Fields.reason_code)
- Response: `{ code: "capability_unavailable", … reason_code }`
- Assert: no INSERT into business tables after stub POST

- [ ] **Step 1: Failing tests** for new routes + reason_code matrix

- [ ] **Step 2: Register missing stubs** (squads list/create, workdir status, terminate alias if Multica name differs)

- [ ] **Step 3: `go test` handler package PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): standardize agent integration capability stub routes

EOF
)"
```

---

### Task 4: Task detail AgentRun + PR panels

**Files:**

- Create/Modify: `packages/views/tasks/detail/components/agent-run-panel.tsx` (+ test)
- Create: `packages/views/tasks/detail/components/pull-request-list.tsx` (+ test)
- Modify: wire into detail timeline/runtime slot; replace thin `timeline-runtime-stubs` or compose it
- i18n keys `tasks.detail.agentRun.*`, `tasks.detail.pullRequests.*`

**Interfaces:**

- Panels render history/usage/retry/terminate **chrome** using CapabilityDisabledControl
- No successful mutation; optional GET stub client that expects capability error and shows empty+reason

- [ ] **Step 1: Failing disabled-contract tests**

- [ ] **Step 2: Transplant Multica chrome + rename; strip live hooks**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): detail AgentRun and PR stub panels

EOF
)"
```

---

### Task 5: Surface / batch / create agent+squad gates

**Files:**

- Modify: Task Surface actions / batch toolbar / new-task dialog assignee — gate squad + agent-trigger
- Tests: control disabled when capability unavailable

- [ ] **Step 1: Failing tests** on Surface/batch entry points that currently imply agent run

- [ ] **Step 2: Wire CapabilityDisabledControl / hide mutation**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): gate Surface agent trigger and squad assign stubs

EOF
)"
```

---

### Task 6: Projects resources VCS/workdir contracts

**Files:**

- Modify: `packages/views/projects/` resources section (+ tests)
- Ensure GitHub + local directory controls use capability keys `tasks.vcs` / `tasks.local_workdir`

- [ ] **Step 1: Failing contract tests** if missing

- [ ] **Step 2: Align disabled+reason; no mutation**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(projects): tighten VCS and workdir disabled contracts

EOF
)"
```

---

### Task 7: Squads + Runtimes shell pages

**Files:**

- Create: `packages/views/squads/` (list page, unavailable, optional detail)
- Create: `packages/views/runtimes/` (list page, unavailable)
- Create: web routes under `apps/web/app/[orgSlug]/[workspaceSlug]/squads/`, `runtimes/`
- Modify: `paths`, reserved slugs, sidebar, package exports
- Lazy-load like projects

**Interfaces:**

```tsx
// Flag gate on page
const parity = useFlag("tasks_work_management_parity", false);
if (!parity) return <SquadsUnavailable />;
return <Suspense><SquadsListPage /></Suspense>;
// ListPage: empty state + capability explanation; no create success
```

- [ ] **Step 1: Failing paths + sidebar tests**

- [ ] **Step 2: Transplant thin shells + flag gate**

- [ ] **Step 3: `pnpm generate:reserved-slugs` if needed**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(integration): squads and runtimes stub shell routes

EOF
)"
```

---

### Task 8: Client stub endpoints (minimal)

**Files:**

- Create: `packages/core/api/endpoints/task-agent-stubs.ts` (+ malformed tests) **only if** detail panels fetch list endpoints
- Hooks that surface empty + error code without throwing

- [ ] **Step 1: Failing malformed + capability error parse tests**

- [ ] **Step 2: Implement thin clients**

- [ ] **Step 3: Commit** (skip commit if Task 4 short-circuits without fetch — note in report)

```bash
git commit -m "$(cat <<'EOF'
feat(core): client stubs for agent integration capability errors

EOF
)"
```

---

### Task 9: i18n + brand-scan green

**Files:**

- Modify: `en.json` / `vi.json` — `squads.*`, `runtimes.*`, agent panel strings
- Extend brand-scan to new view roots + locale keys

- [ ] **Step 1: Add keys; no literals**

- [ ] **Step 2: brand-scan + i18n parity PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(i18n): agent integration stub surface strings

EOF
)"
```

---

### Task 10: Parity overlay + E2E + gate

**Files:**

- Create: `docs/parity/tasks-work-management.slice6-verification.json`
- Modify: `scripts/task-parity-manifest.test.mjs`
- Create: `e2e/agent-integration-parity-smoke.spec.ts`
- Update umbrella + spec status; optional `tasks.projects` Available

**E2E:**

```ts
// flag on: task detail shows AgentRun/PR stubs aria-disabled; /squads and /runtimes load shell
// flag off: no Squads/Runtimes nav; MVP task detail without suite stubs
```

- [x] **Step 1: Overlay + E2E**

- [x] **Step 2: `make check` / check-worktree PASS**

- [x] **Step 3: `[agent]` comment; `make issue-pr` if auth works**

- [x] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(tasks): slice6 parity overlay and agent integration E2E smoke

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec | Task |
| --- | --- |
| Full stub parity / no runtime | Global + 3–7 |
| Same flag | 7, 10 |
| Stub API standardize | 3, 8 |
| Embedded + /squads /runtimes | 4–7 |
| Capabilities stay unavailable | Global + 3, 10 |
| Tests / DoD / F-05 MỘT PHẦN | 1, 9–10 |

Không TBD. Optional `tasks.projects` Available noted in Task 10.
