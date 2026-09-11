# UNI-426.8 · Tasks parity web cutover Implementation Plan

> **Trạng thái:** shipped — thiết kế duyệt; Tasks 1–6 complete (web cutover); Task 7 PR pending; lát 7 hosts deferred; F-05 vẫn `MỘT PHẦN`  
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard cutover web — suite Tasks/My Tasks/Projects/detail luôn on; xóa flag `tasks_work_management_parity` + MVP; ẩn hết chrome agent user-facing; F-05 vẫn `MỘT PHẦN`; lát 7 hosts deferred.

**Architecture:** Gỡ `RequireFeatureFlag(..., "tasks_work_management_parity")` khỏi suite router group; pages luôn mount suite; xóa MVP views/gates; unmount AgentRun/PR/surface agent stubs; xóa entry Squads/Runtimes (routes + nav + paths). Server agent/VCS stubs + catalogue Unavailable giữ nguyên.

**Tech Stack:** Next.js App Router, React 19, featureflags Go, Chi router, Vitest, Playwright, i18n.

**Spec:** `docs/superpowers/specs/2026-09-09-tasks-parity-web-cutover-design.md`  
**Umbrella:** `docs/superpowers/specs/2026-09-07-tasks-work-management-parity-design.md` §11 mục 8, §13  
**Tracking:** Parent `UNI-426`; tạo sub-issue ở Task 1; base `develop` đã có UNI-519.

## Global Constraints

- Trước product code: `uniai` tạo sub-issue dưới UNI-426 → `make issue-start KEY=<KEY>` từ `develop` mới.
- Không branding Multica/`Issue` trong product.
- **Không** flip `tasks.agent_runs|squads|vcs|local_workdir|desktop.host|mobile.host` → Available.
- **Không** implement lát 7 hosts.
- Hard cutover: không giữ dual path / soft default flag.
- JSX views qua `t()`; file ≤500; TDD; conventional commits + `Refs` trailer; no `--no-verify`.
- F-05 / umbrella vẫn `MỘT PHẦN` sau lát này.
- Grep cuối: zero product refs tới `tasks_work_management_parity` (trừ docs lịch sử nếu cần).

---

## File map

### Server flag gate

- Modify: `server/internal/handler/router/router.go` — register suite **without** `RequireFeatureFlag`
- Modify: `server/internal/featureflags/keys.go` — xóa key `tasks_work_management_parity`
- Modify/tests: `feature_flag_test.go`, `catalogue_test.go`, `task_query_test.go`, `auth_test.go`, `config_test.go`, `agent_integration_stubs_test.go` — bỏ giả định flag-off → `feature_disabled` cho suite
- Modify: OpenAPI stub descriptions trong `tasks_stubs.go` — bỏ câu “Flag tasks_work_management_parity”
- Optional: `tasks.projects` → Available trong `workcapability/catalogue.go` (+ tests)

### Web always-suite

- Modify: `apps/web/.../tasks/page.tsx`, `my-tasks/page.tsx`, `projects/page.tsx`, `projects/[projectId]/page.tsx`, `tasks/[taskId]/page.tsx` — luôn suite; bỏ flag branch
- Delete or stop exporting: `task-detail-flag-gate.tsx`, `TaskDetailView` MVP (+ tests chỉ phục vụ MVP), `*Unavailable` flag-off pages

### Hide agent chrome

- Modify: `timeline-runtime-stubs.tsx` / detail timeline — không mount AgentRun/PR
- Modify: board-card, list-view, batch-action-toolbar, new-task-dialog — gỡ agent-squad-gates
- Delete UI entry: `apps/web/.../squads/`, `runtimes/`; `packages/views/squads/`, `runtimes/` (hoặc giữ unexported nếu còn import — ưu tiên xóa + knip)
- Modify: `app-sidebar.tsx` — bỏ nav Squads/Runtimes + parity flag
- Modify: `paths.ts`, reserved slugs, consistency/resolve tests, diagnostics `WORKSPACE_ROUTES`

### E2E / docs

- Rewrite: collection/detail/projects E2E — không harness flag off
- Delete or shrink: `e2e/agent-integration-parity-smoke.spec.ts`
- Update: roadmap, umbrella, slice6 spec note, plan status
- Grep gate: script test hoặc assert trong existing contract

---

### Task 1: Sub-issue + branch from develop

**Files:** tracking only

- [ ] **Step 1:** Tạo sub-issue dưới UNI-426 (title kiểu `UNI-426.8 · Tasks parity web cutover`), description trỏ spec + plan này

- [ ] **Step 2:** `make issue-start KEY=<KEY>` từ `origin/develop` (không tiếp tục branch docs cutover-design trừ khi cherry-pick spec commit)

- [ ] **Step 3:** Cherry-pick hoặc copy spec `2026-09-09-tasks-parity-web-cutover-design.md` + plan file này lên branch issue nếu chưa có

- [ ] **Step 4:** Commit docs trên issue branch nếu cần

```bash
git commit -m "$(cat <<'EOF'
docs: Tasks parity web cutover spec and plan

EOF
)"
```

---

### Task 2: Server — suite APIs luôn on; xóa flag key

**Files:**

- Modify: `server/internal/handler/router/router.go`
- Modify: `server/internal/featureflags/keys.go`
- Modify: suite-related `*_test.go` expecting `feature_disabled` when flag off
- Modify: `server/internal/handler/router/catalogue_test.go` (middleware assertion)
- Modify: stub OpenAPI strings in `tasks_stubs.go` (drop Flag mention)

**Interfaces:**

- `registerTasksSuite(authed, h)` — no flag middleware wrapper
- Catalogue no longer lists `tasks_work_management_parity`

- [ ] **Step 1:** Failing/adjust tests — suite routes return 200/auth errors, not `feature_disabled` when flag absent; remove `TestRequireFeatureFlagReturns404WhenDisabled` dependency on this key or retarget another flag if middleware still needs a unit test

- [ ] **Step 2:** Remove `RequireFeatureFlag(..., "tasks_work_management_parity")` from router registration

- [ ] **Step 3:** Delete flag key from `keys.go`; fix `TestFlagsAreReviewed` / config public flags tests

- [ ] **Step 4:** `go test` packages handler/router/featureflags — PASS

- [ ] **Step 5:** Commit

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): always enable suite APIs; remove parity flag key

EOF
)"
```

---

### Task 3: Web pages — always suite; delete MVP gates

**Files:**

- Modify: `apps/web/app/[orgSlug]/[workspaceSlug]/tasks/page.tsx`
- Modify: `apps/web/.../my-tasks/page.tsx`
- Modify: `apps/web/.../projects/page.tsx`, `projects/[projectId]/page.tsx`
- Modify: `apps/web/.../tasks/[taskId]/page.tsx` — luôn `TaskDetailSuitePage` (lazy OK)
- Delete: `packages/views/tasks/task-detail-flag-gate.tsx` (+ test)
- Delete: `packages/views/tasks/task-detail-view.tsx` (+ tests only for MVP) **if** nothing else imports
- Delete: `my-tasks-unavailable`, `projects-unavailable` (+ exports) if unused
- Check: `TasksPageView` — nếu chỉ là MVP list, xóa hoặc giữ nếu còn dùng nơi khác

- [ ] **Step 1:** Update page tests / view tests that assert flag-off Unavailable

- [ ] **Step 2:** Pages always suite; remove `useFlag` parity branches

- [ ] **Step 3:** Delete dead MVP modules; `pnpm` vitest views/web related — PASS

- [ ] **Step 4:** Commit

```bash
git commit -m "$(cat <<'EOF'
feat(web): always mount Tasks suite; remove MVP flag gates

EOF
)"
```

---

### Task 4: Ẩn agent chrome + xóa Squads/Runtimes entry points

**Files:**

- Modify: `packages/views/tasks/detail/components/timeline-runtime-stubs.tsx` (and timeline tests) — no AgentRun/PR
- Delete or stop exporting: `agent-run-panel.tsx`, `pull-request-list.tsx` (+ tests) if unused
- Modify: `board-card.tsx`, `list-view.tsx`, `batch-action-toolbar.tsx`, `new-task-dialog.tsx` — remove gates
- Delete: `packages/views/tasks/surface/agent-squad-gates.tsx` (+ test) if unused
- Delete: `apps/web/.../squads/`, `runtimes/`
- Delete: `packages/views/squads/`, `runtimes/` (+ package.json exports)
- Modify: `app-sidebar.tsx` (+ test) — no parity flag; no Squads/Runtimes links
- Modify: `paths.ts`, `reserved_slugs.json` → `pnpm generate:reserved-slugs`, consistency/resolve tests
- Modify: `diagnostic-context.ts` (+ test) — remove squads/runtimes routes
- Optional: trim `scripts/agent-integration-brand-scan.test.mjs` roots that no longer exist

- [ ] **Step 1:** Failing tests for sidebar (no squads/runtimes), timeline (no agent panels), paths

- [ ] **Step 2:** Implement removals

- [ ] **Step 3:** knip/lint clean for deleted exports

- [ ] **Step 4:** Commit

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): hide agent chrome; remove squads and runtimes entry points

EOF
)"
```

---

### Task 5: Optional `tasks.projects` Available + catalogue tests

**Files:**

- Modify: `server/internal/workcapability/catalogue.go` (+ tests expecting Unavailable → Available)
- Only if Step 1 shows cheap fix; else skip and note in report

- [ ] **Step 1:** Check catalogue tests / public config expectations

- [ ] **Step 2:** Flip or skip

- [ ] **Step 3:** Commit if changed

```bash
git commit -m "$(cat <<'EOF'
feat(capabilities): mark tasks.projects available after web cutover

EOF
)"
```

---

### Task 6: E2E + docs + grep gate

**Files:**

- Modify: `e2e/tasks-collection-parity-smoke.spec.ts`, `task-detail-parity-smoke.spec.ts`, `projects-suite-parity-smoke.spec.ts` — suite always; remove flag-off matrix / harness forcing false
- Delete or rewrite: `e2e/agent-integration-parity-smoke.spec.ts` (no Squads nav / AgentRun asserts)
- Modify: `docs/roadmap/FEATURE_ROADMAP.md`, umbrella status line, slice6/8 spec status
- Add: contract assert — `rg`/node test fail nếu còn `tasks_work_management_parity` trong `apps/`, `packages/`, `server/` (exclude `docs/`)

- [x] **Step 1:** Update E2E specs

- [x] **Step 2:** Docs status — F-05 `MỘT PHẦN`; lát 7 deferred; lát 8 shipped when done

- [x] **Step 3:** Grep gate green

- [x] **Step 4:** `make check` / check-worktree PASS

- [x] **Step 5:** Commit

```bash
git commit -m "$(cat <<'EOF'
test(tasks): cutover E2E and remove parity flag references

EOF
)"
```

---

### Task 7: PR + agent note

- [ ] **Step 1:** `make issue-pr KEY=<KEY>` (push branch)

- [ ] **Step 2:** `[agent]` note trên issue — tóm tắt cutover; F-05 vẫn MỘT PHẦN; không issue-done umbrella

- [ ] **Step 3:** Human DoD / merge

---

## Self-review (plan vs spec)

| Spec | Task |
| --- | --- |
| Hard cutover xóa flag | 2–3, 6 |
| Suite always on (server+web) | 2–3 |
| Ẩn agent chrome + xóa squads/runtimes entry | 4 |
| Agent caps Unavailable | Global + 2 |
| F-05 MỘT PHẦN; lát 7 deferred | 6–7 |
| Optional tasks.projects Available | 5 |

Không TBD. Residual `project_id` create-from-project out of scope.
