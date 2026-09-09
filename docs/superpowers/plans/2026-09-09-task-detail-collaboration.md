# UNI-426.5 · Task detail & collaboration Implementation Plan

> **Trạng thái:** in-progress — chờ issue KEY + execute

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi flag `tasks_work_management_parity` bật, `/{org}/{ws}/tasks/[taskId]` chạy suite detail (TipTap title/description, properties, sub-tasks, timeline comments, attachments thật); flag tắt giữ MVP `TaskDetailView`; AgentRun/PR đúng chỗ nhưng stub + reason; không regress Tasks/Projects collection.

**Architecture:** Transplant Multica `packages/views/editor/**` + `packages/views/issues/components/issue-detail*` (+ pickers/comment/timeline phụ thuộc) @ `3d37828e9` → UniWork `packages/views/editor/` + `packages/views/tasks/detail/`. Unblock attachments: thay stub `attachment_storage_missing` bằng `server/internal/storage` + sqlc trên bảng `attachments`; capability `tasks.attachments` → `available`. Route flag-gated + lazy-load editor/detail. Không fork dual detail stores; server state chỉ TanStack Query.

**Tech Stack:** Next.js App Router (`apps/web`), React 19, TipTap 3.27.1 (catalog pin), TanStack Query, Vitest + Testing Library, i18next, `@uniwork/ui`, feature flag F-11, Go/pgx/sqlc, `server/internal/storage`.

**Spec:** `docs/superpowers/specs/2026-09-09-task-detail-collaboration-design.md`  
**Umbrella:** `docs/superpowers/specs/2026-09-07-tasks-work-management-parity-design.md` §4.4, §8, §11 mục 5  
**Baseline:** `multica/` @ `3d37828e9`  
**Tracking:** Parent `UNI-426`; sub-issue tạo ở Task 1; phụ thuộc `UNI-495` + `UNI-497` + `UNI-500` + `UNI-502` đã merge `develop`.

## Global Constraints

- Trước product code: tạo sub-issue dưới UNI-426 rồi `make issue-start KEY=<KEY>` từ `develop` đã có UNI-502; không code trên nhánh umbrella trừ khi đó là branch issue.
- Không branding nguồn (`multica`, `@multica/`, domain `Issue`) trong product/tests/i18n; tên nguồn chỉ trong plan/spec/`docs/parity/`.
- Giữ `Task` / `Công việc` / `/tasks`; cột/API Multica `issues` → `tasks`; `issue-identifier` → task identifier UniWork.
- Mọi JSX text trong `packages/views/` qua `t()`; `vi` đủ key.
- File `.ts`/`.tsx` product ≤ 500 lines; Multica `issue-detail.tsx` (~3.5k) **bắt buộc** tách khi transplant.
- Server state chỉ TanStack Query; create/delete comment và upload/delete attachment await server; optimistic chỉ khi đủ State Rules (vd. reaction nếu predictable).
- Flag off: MVP `TaskDetailView`; không mount suite editor.
- AgentRun / VCS / PR / trigger-preview runtime → disabled + reason; không mutation runtime (lát 6).
- Attachments: MIME allowlist + size cap rõ; CSP preview path (`/api/v1/attachments/.../content|download`); audit mọi command ghi.
- TDD từng task; commit conventional + `Refs` trailer; trước xong `make check-worktree` + `[agent]` comment.
- F-05 / umbrella vẫn `MỘT PHẦN` sau lát cắt này; dual MVP/suite đến lát 8.

### Transplant rename map

| Nguồn | Đích |
| --- | --- |
| `Issue` / `issue` (domain) | `Task` / `task` |
| `issue-detail` | `task-detail` / `tasks/detail` |
| `issue-identifier` / Issue autolink | task identifier UniWork |
| `@multica/core` / `@multica/ui` | `@uniwork/core` / `@uniwork/ui` |
| Multica issue mutations/queries | `@uniwork/core` task hooks + `task-collaboration` + attachments endpoints |
| `/api/attachments` (Multica) | `/api/v1/attachments` (+ `/api/v1/tasks/{id}/attachments`) |
| `/api/upload-file` | `POST /api/v1/tasks/{taskID}/attachments` (multipart) |
| `text-faint-foreground` / legacy | semantic UniWork tokens only |

---

## File map

### Provenance

- Create: `docs/parity/task-detail-collaboration-inventory.json`
- Create: `scripts/task-detail-brand-scan.test.mjs`
- Create: `docs/parity/tasks-work-management.slice5-verification.json`
- Wire brand-scan vào nhóm contract `scripts/check.sh` (cùng pattern slice 3–4).

### Editor

- Create: `packages/views/editor/**` — transplant Multica editor; split modules ≤500; export `@uniwork/views/editor`.
- Modify: `pnpm-workspace.yaml` `catalog:` — pin `@tiptap/*` `3.27.1` (+ peer deps Multica dùng: `lowlight`, `prosemirror-*` nếu cần).
- Modify: `packages/views/package.json` — deps catalog + export `./editor`.

### Attachments (server + core)

- Create/Modify: `server/pkg/db/queries/attachments.sql` (+ `make sqlc`).
- Modify: `server/internal/service/task_subscribers.go` (hoặc tách `task_attachments.go`) — thay stub bằng List/Get/Delete/Upload + content/download.
- Modify: `server/internal/handler/task_collaboration.go` + router — thêm `POST .../attachments`, `GET .../content`, `GET .../download`; SDI/SDO.
- Modify: `server/internal/workcapability/catalogue.go` — `tasks.attachments` → `Available`.
- Modify: `server/internal/service/audit_coverage_test.go` — đăng ký command mới.
- Create: `packages/core/types/attachment.ts` (+ schema).
- Create/Modify: `packages/core/api/endpoints/task-attachments.ts` (+ malformed tests).
- Create/Modify: `packages/core/tasks/hooks-attachments.ts` (+ keys cạnh collab/taskKeys).

### Detail suite views

- Create: `packages/views/tasks/detail/` — shell + components (properties, timeline, subtasks, attachments, agent/PR stubs).
- Keep: `packages/views/tasks/task-detail-view.tsx` — MVP đến lát 8.
- Modify: `apps/web/app/[orgSlug]/[workspaceSlug]/tasks/[taskId]/page.tsx` — flag gate + lazy suite.
- i18n: `packages/core/i18n/locales/{en,vi}.json` — `tasks.detail.*`, `editor.*`, capability strings nếu thiếu.

### Optional cùng PR nếu rẻ

- Project detail create-task gắn `project_id` (residual lát 4) — chỉ khi ≤ ~1 task nhỏ; nếu không, ghi residual trên PR.

### Verification

- E2E: `e2e/task-detail-parity-smoke.spec.ts`
- Overlay slice 5 + brand-scan green

---

### Task 1: Issue branch, inventory, brand-scan gate

**Files:**

- Create: `docs/parity/task-detail-collaboration-inventory.json`
- Create: `scripts/task-detail-brand-scan.test.mjs`
- Modify: `scripts/check.sh` (wire nếu chưa auto-pick `*brand-scan*`)

**Interfaces:**

- Consumes: Multica @ `3d37828e9` under `packages/views/editor/**`, `packages/views/issues/components/issue-detail*`, comment/timeline/picker deps cần cho detail.
- Produces: inventory `{schema_version:1, baseline_commit:"3d37828e9", owner_issue:"<KEY>", entries:[{source_path, target_path, disposition:"port"|"adapt"|"stub"|"skip_later_slice"}]}`.

- [ ] **Step 1: Tạo UniAI sub-issue + `issue-start` từ develop**

```bash
git fetch origin develop && git checkout develop && git pull --ff-only
uniai issue create --title "UNI-426.5 · Task detail & collaboration" --parent UNI-426 \
  --description "Lát cắt 5 F-05. Spec: docs/superpowers/specs/2026-09-09-task-detail-collaboration-design.md. Plan: docs/superpowers/plans/2026-09-09-task-detail-collaboration.md. Phụ thuộc UNI-502."
# ghi KEY từ output
make issue-start KEY=<KEY>
```

- [ ] **Step 2: Inventory JSON** — liệt kê editor files + issue-detail modules; disposition `port` cho editor/detail UI; `stub` cho AgentRun/PR; `skip_later_slice` cho desktop-only.

- [ ] **Step 3: Brand-scan test** — fail nếu `multica` / `@multica` / `\bIssue\b` (domain) lọt `packages/views/editor/**`, `packages/views/tasks/detail/**`, product locale keys mới.

```js
// scripts/task-detail-brand-scan.test.mjs — mirror projects-suite-brand-scan.test.mjs paths
```

- [ ] **Step 4: Commit**

```bash
git add docs/parity/task-detail-collaboration-inventory.json scripts/task-detail-brand-scan.test.mjs
git commit -m "$(cat <<'EOF'
chore(parity): slice5 inventory and brand-scan gate

EOF
)"
```

---

### Task 2: TipTap catalog + editor package smoke

**Files:**

- Modify: `pnpm-workspace.yaml` (catalog `@tiptap/*` = `3.27.1` + deps editor cần)
- Modify: `packages/views/package.json`
- Create: `packages/views/editor/index.ts`
- Create: `packages/views/editor/title-editor.tsx` (minimal stub OR first transplant file)
- Create: `packages/views/editor/title-editor.test.tsx`
- Create: `packages/views/editor/content-editor.tsx` (+ smoke test)

**Interfaces:**

- Produces: `export { TitleEditor, ContentEditor } from "@uniwork/views/editor"` — props tối thiểu `{ value, onChange, editable?, placeholder? }` (khớp Multica surface sau Task 3).

- [ ] **Step 1: Failing test** — mount `TitleEditor` / `ContentEditor` trong jsdom; expect textbox / contenteditable.

- [ ] **Step 2: Pin catalog + `pnpm install`** — mọi `@tiptap/*` cùng version `3.27.1`; `scripts/catalog-check.test.mjs` PASS.

- [ ] **Step 3: Minimal editors** — có thể tạm textarea-backed **chỉ** nếu cần xanh test trước transplant đầy đủ; Task 3 thay bằng TipTap thật. Ưu tiên copy thẳng Multica `title-editor.tsx` / `content-editor.tsx` đã rename nếu deps đủ.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(editor): tip tap catalog and editor package smoke

EOF
)"
```

---

### Task 3: Transplant Multica editor package

**Files:**

- Create: `packages/views/editor/**` (toàn bộ Multica editor trừ phần chỉ desktop)
- Modify: exports + i18n keys `editor.*` nếu literal
- Adapt: mention → members/agents UniWork; `issue-identifier-autolink` → task identifier; upload hooks → UniWork attachment endpoints (có thể stub upload callback đến Task 5–6)

**Interfaces:**

- Consumes: Task 2 catalog.
- Produces: `TitleEditor`, `ContentEditor`, `useLazyEditor`, `useEditorUpload`, `useFileDropZone`, `FileDropOverlay`, `ReadonlyContent`, attachment preview helpers — API surface ổn định cho detail shell.

- [ ] **Step 1: Copy + rename map** — cơ học; tách file >500; thay `@multica/*`; đổi Issue→Task trong product strings.

- [ ] **Step 2: Port Multica editor unit tests** còn relevant; bỏ/adapt test phụ thuộc API Multica chưa có.

- [ ] **Step 3: `pnpm --filter @uniwork/views test` editor paths PASS; brand-scan chưa fail trên editor (chưa có Issue domain).

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(editor): transplant TipTap editor from Multica baseline

EOF
)"
```

---

### Task 4: Attachments — sqlc + service (storage thật)

**Files:**

- Create: `server/pkg/db/queries/attachments.sql`
- Run: `make sqlc`
- Create/Modify: `server/internal/service/task_attachments.go` (tách khỏi stub trong `task_subscribers.go`)
- Modify: remove stub returns `attachment_storage_missing` cho List/Get/Delete
- Test: `server/internal/service/task_attachments_test.go`

**Interfaces:**

```go
// TaskService (human Actor only from handlers)
func (s *TaskService) ListTaskAttachments(ctx context.Context, actor Actor, taskID string) ([]Attachment, error)
func (s *TaskService) UploadTaskAttachment(ctx context.Context, actor Actor, taskID string, filename, contentType string, size int64, r io.Reader) (Attachment, error)
func (s *TaskService) GetAttachment(ctx context.Context, actor Actor, attachmentID string) (Attachment, error)
func (s *TaskService) OpenAttachmentContent(ctx context.Context, actor Actor, attachmentID string) (Attachment, io.ReadCloser, error)
func (s *TaskService) DeleteAttachment(ctx context.Context, actor Actor, attachmentID string) error
```

- Object key pattern: `workspaces/{workspaceID}/attachments/{attachmentID}/{safeFilename}` (hoặc convention storage hiện có — thống nhất một format trong test).
- Membership: `RequireMember` trên workspace của task trước mọi op; 404 nếu task không visible.
- Size cap: chọn một hằng (vd. 25 MiB) trong service/handler; reject 413.
- MIME: allowlist images + pdf + text/markdown + common office; reject còn lại 400.
- Audit: `attachment.uploaded` / `attachment.deleted` (tên khớp catalogue — thêm entry catalogue 3 nơi nếu event mới).
- Delete: xóa DB row + storage object trong service (transaction cho DB; storage best-effort hoặc reverse order có test).

- [ ] **Step 1: Failing service tests** — upload→list→get→delete; non-member 403/404; oversize; bad MIME.

- [ ] **Step 2: sqlc queries** — `InsertAttachment`, `ListAttachmentsByTask`, `GetAttachment`, `DeleteAttachment` filter `workspace_id` (+ `organization_id` nếu query pattern ADR 0008 đã áp dụng trên bảng này).

- [ ] **Step 3: Implement service** dùng `s.Storage` (`storage.Storage`); inject đã có từ TaskService deps — nếu chưa có field Storage, wire từ `main`/handler.New giống meeting/file paths hiện có.

- [ ] **Step 4: `make test-go` subset PASS; cập nhật `task_collaboration_test.go` bỏ expect stub capability error.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): real attachment storage on collaboration table

EOF
)"
```

---

### Task 5: Attachments — HTTP + capability + client

**Files:**

- Modify: `server/internal/handler/task_collaboration.go`, `router/tasks.go`, SDI/SDO
- Modify: `server/internal/workcapability/catalogue.go` + test → `tasks.attachments` Available
- Modify: CSP tests nếu path prefix `/api/v1/attachments/`
- Create: `packages/core/types/attachment.ts`
- Create: `packages/core/api/endpoints/task-attachments.ts` (+ `.test.ts` malformed)
- Create: `packages/core/tasks/hooks-attachments.ts`
- Modify: `packages/core/api/index.ts` exports

**Interfaces (HTTP):**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/tasks/{taskID}/attachments` | `{ attachments: [...] }` |
| POST | `/api/v1/tasks/{taskID}/attachments` | multipart field `file`; returns attachment |
| GET | `/api/v1/attachments/{attachmentID}` | metadata JSON |
| GET | `/api/v1/attachments/{attachmentID}/content` | stream; CSP preview |
| GET | `/api/v1/attachments/{attachmentID}/download` | stream + Content-Disposition |
| DELETE | `/api/v1/attachments/{attachmentID}` | 204 |

Client:

```ts
listTaskAttachments(taskId: string): Promise<Attachment[]>
uploadTaskAttachment(taskId: string, file: File): Promise<Attachment | null>
getAttachment(id: string): Promise<Attachment | null>
deleteAttachment(id: string): Promise<void>
// content/download: URL builders for <img>/<a>, không bắt buộc fetch blob trong endpoint layer
attachmentContentPath(id: string): string
attachmentDownloadPath(id: string): string
```

- [ ] **Step 1: Failing handler + malformed client tests**

- [ ] **Step 2: Implement routes** — multipart decode với cap; `decode` JSON không dùng cho upload.

- [ ] **Step 3: Capability Available**; catalogue test cập nhật.

- [ ] **Step 4: Client parseWithFallback + hooks** (`taskKeys.attachments(wsId, taskId)`).

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): attachment HTTP API and client hooks

EOF
)"
```

---

### Task 6: Detail shell composition (split issue-detail)

**Files:**

- Create: `packages/views/tasks/detail/task-detail-suite-page.tsx`
- Create: `packages/views/tasks/detail/components/*` — header, resizable layout, scroll restore helpers
- Create: `packages/views/tasks/detail/task-detail-suite-page.test.tsx` (smoke)
- Port pickers cần thiết từ Multica `issues/components/pickers/*` vào `packages/views/tasks/detail/pickers/` hoặc tái dùng pickers lát 3 nếu đã có

**Interfaces:**

```tsx
export function TaskDetailSuitePage(props: {
  workspaceId: string;
  taskId: string;
  onDeleted?: () => void;
}): JSX.Element
```

- Load task qua `useTask` / suite get-by-id hoặc identifier; 404/forbidden → shell empty.
- Title/description: `TitleEditor` / `ContentEditor` + put task mutation (revision).
- Layout: BreadcrumbHeader + resizable sidebar (reuse `@uniwork/ui` resizable nếu có; nếu thiếu `pnpm ui:add`).

- [ ] **Step 1: Failing smoke** — render với mocked http; expect title region + sidebar landmark.

- [ ] **Step 2: Transplant + split** — không một file >500; map sections: chrome, editors, sidebar slot, timeline slot, attachments slot.

- [ ] **Step 3: Wire put task / revision_conflict toast + refetch** (sonner pattern UniWork).

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): suite detail shell with TipTap title and description

EOF
)"
```

---

### Task 7: Properties sidebar + parent/sub-tasks

**Files:**

- Create: `packages/views/tasks/detail/components/properties-sidebar.tsx` (+ tests)
- Create: `packages/views/tasks/detail/components/subtasks-section.tsx` (+ tests)
- Wire: status, priority, assignee, project, labels, dates, stage, custom properties

**Interfaces:**

- Consumes: suite status/label/property hooks; `usePutTask` / field mutations đã có lát 2.
- Custom property catalog thiếu → disabled + `t("capabilities.surface_not_ready")` hoặc reason từ registry.
- Sub-tasks: list children + progress; create child await server; batch trên con nếu API batch sẵn (không invent API mới).

- [ ] **Step 1: Failing tests** — changing status calls mutation; custom prop disabled when catalog empty.

- [ ] **Step 2: Implement pickers** — tái dùng Surface pickers nếu export được; không duplicate logic.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): detail properties sidebar and subtasks section

EOF
)"
```

---

### Task 8: Timeline — comments, reactions, activity stubs

**Files:**

- Create: `packages/views/tasks/detail/components/timeline.tsx` (+ split comment-card, composer)
- Create: AgentRun / PR stub blocks (disabled + reason)
- Wire: `hooks-collaboration` (create/update/delete/resolve/reactions/subscribers)

**Interfaces:**

- Comment composer dùng `ContentEditor` (lazy) hoặc textarea fallback nếu editor nặng — ưu tiên ContentEditor + `useLazyEditor`.
- Timeline stub API (`GetTaskTimeline`) nếu vẫn stub: render comments list từ comments endpoint + activity empty/stub reason; không fake AgentRun success.
- Deep link hash `#comment-{id}` highlight nếu Multica có và port được trong budget.

- [ ] **Step 1: Failing tests** — compose comment calls create; AgentRun button `aria-disabled` + reason.

- [ ] **Step 2: Implement timeline + stubs**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): detail timeline comments and agent stub blocks

EOF
)"
```

---

### Task 9: Attachments UI on detail

**Files:**

- Create: `packages/views/tasks/detail/components/attachments-section.tsx`
- Wire: `useFileDropZone` / `useEditorUpload` → `uploadTaskAttachment`
- Preview modal từ editor package

**Interfaces:**

- List từ `useTaskAttachments`; upload progress UI; delete confirm; preview/download via path builders.
- Capability gate: nếu flag on nhưng capability unavailable (không xảy ra sau Task 5) — vẫn đọc registry.

- [ ] **Step 1: Failing tests** — drop/upload invokes endpoint mock; empty state.

- [ ] **Step 2: Implement section + safe preview (img/pdf allowlist UI)**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): detail attachments upload preview and download

EOF
)"
```

---

### Task 10: Route flag gate + lazy-load

**Files:**

- Modify: `apps/web/app/[orgSlug]/[workspaceSlug]/tasks/[taskId]/page.tsx`
- Modify: `packages/views/package.json` exports `./tasks/detail/*`
- Optional: dynamic import editor only from suite page

**Interfaces:**

```tsx
const parity = useFlag("tasks_work_management_parity", false);
if (!parity) {
  return <TaskDetailView ... />;
}
return (
  <Suspense fallback={null}>
    <TaskDetailSuitePage ... />
  </Suspense>
);
```

- [ ] **Step 1: Failing test** — page module hoặc thin wrapper test: flag false → MVP export path; flag true → suite (mock flag).

- [ ] **Step 2: Implement gate + lazy**

- [ ] **Step 3: Đo bundle nếu CI budget fail → split thêm; không nâng ceiling tùy tiện.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): flag-gate suite detail behind work management parity

EOF
)"
```

---

### Task 11: i18n + brand-scan green

**Files:**

- Modify: `packages/core/i18n/locales/en.json`, `vi.json` (+ locale khác nếu gate i18n parity yêu cầu cùng key)
- Ensure no literals in `packages/views/editor` / `tasks/detail`

- [ ] **Step 1: Add keys** `tasks.detail.*`, `editor.*`, attachment errors, stub reasons

- [ ] **Step 2: `pnpm exec vitest run` brand-scan + views lint PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(i18n): task detail and editor en/vi strings

EOF
)"
```

---

### Task 12: Parity overlay + E2E smoke + gate

**Files:**

- Create: `docs/parity/tasks-work-management.slice5-verification.json`
- Modify: `scripts/task-parity-manifest.test.mjs` (merge slice5)
- Create: `e2e/task-detail-parity-smoke.spec.ts`
- Modify: umbrella status line → lát 5 in-progress/shipped khi xong
- Update: spec status → shipped khi gate xanh

**E2E:**

```ts
// flag on (FF or seed): open task from /tasks → suite chrome (editor or detail testid)
// upload small fixture file if API allows; expect attachment row
// add comment; expect visible
// flag off: MVP detail still loads; no suite-only testids
```

- [ ] **Step 1: Overlay entries** ported editor/detail/attachments

- [ ] **Step 2: E2E smoke PASS** (app running / `make check-worktree`)

- [ ] **Step 3: `make check-worktree` xanh; `[agent]` comment trên issue với bằng chứng

- [ ] **Step 4: `make issue-pr`** — F-05 vẫn `MỘT PHẦN`; residual `project_id` create nếu chưa làm

- [ ] **Step 5: Commit verification artifacts**

```bash
git commit -m "$(cat <<'EOF'
test(tasks): slice5 parity overlay and detail E2E smoke

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| Full §4.4 UI trừ Agent/VCS runtime | 6–9 (stubs 8) |
| Same parity flag dual path | 10 |
| TipTap editor transplant | 2–3 |
| Attachments thật + capability available | 4–5, 9 |
| `views/editor` + `tasks/detail` | file map + 3, 6 |
| Errors / revision_conflict | 6 |
| Tests / E2E / overlay / DoD | 1, 11–12 |
| Ngoài scope lát 6–8 | Global Constraints + stubs |
| Optional project_id create | optional note Task 12 residual |

Không TBD trong plan. Tên HTTP/client thống nhất `/api/v1/...`. Issue KEY điền ở Task 1.
