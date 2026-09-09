# UniWork — Task detail & collaboration (UNI-426 lát cắt 5)

> **Trạng thái:** in-progress — thiết kế duyệt 2026-09-09; plan `../plans/2026-09-09-task-detail-collaboration.md`

**Ngày:** 2026-09-09  
**Issue:** (sub-issue dưới UNI-426 · lát cắt 5 — tạo khi `writing-plans`)  
**Parent:** UNI-426 · F-05  
**Phụ thuộc:** UNI-495 + UNI-497 + UNI-500 + UNI-502 đã merge `develop`  
**Umbrella:** `2026-09-07-tasks-work-management-parity-design.md` §4.4, §5.1, §8, §10, §11 mục 5  
**Baseline nguồn:** `multica/` @ `3d37828e9`

## 1. Mục tiêu

Port **Task detail & collaboration** từ Multica sang UniWork để khi bật
`tasks_work_management_parity` người dùng có suite detail: rich title/description
(TipTap), sidebar properties, parent/sub-tasks, timeline (comments + activity),
attachments thật (upload/preview/download), và các khối AgentRun / PR đúng chỗ
nhưng stub + reason. Flag tắt: giữ MVP `TaskDetailView`. Không làm Agent/VCS
runtime thật, desktop/mobile, hay cutover (lát 6–8).

## 2. Quyết định đã chốt (brainstorm 2026-09-09)

| Chủ đề | Quyết định |
| --- | --- |
| Phạm vi | Full umbrella §4.4; Agent/VCS runtime vẫn stub + reason (lát 6) |
| Rollout UI | Cùng flag `tasks_work_management_parity`: on → suite detail; off → MVP `TaskDetailView` |
| Cách port | Transplant Multica `issue-detail` + `packages/views/editor` (TipTap) @ `3d37828e9`; đổi brand; strip Multica |
| Attachments | Thật trên `tasks.attachments` (upload / preview / download / delete); không còn stub storage |
| Approach | `packages/views/editor/` + `packages/views/tasks/detail/`; route flag-gated; lazy-load nếu vượt bundle budget |

## 3. Phạm vi

### 3.1 Trong phạm vi

**`packages/views/editor/`**

- TipTap editor package từ Multica: title + content (Markdown, code, image embed
  trong editor khi attachment/content API sẵn).
- Deps TipTap pin qua `catalog:` trong `pnpm-workspace.yaml`; khai báo trong
  `packages/views/package.json`.
- Mention → UniWork workspace members/agents; issue-autolink → task identifier
  UniWork; không còn chuỗi/brand Multica.

**`packages/views/tasks/detail/`**

- Shell suite detail (transplant issue-detail): breadcrumb, title/description,
  right sidebar properties, parent/sub-task list + progress, timeline, attachments.
- Properties: status, priority, assignee (human/agent), project, labels, dates,
  stage, custom properties — picker UI; catalog thiếu → disabled + reason.
- Comments: thread, reply, resolve/unresolve, collapse, reactions, mentions,
  edit/delete, deep link/highlight khi API/collab hooks hỗ trợ; subscribers /
  notification theo contract đã có từ lát 2.
- Activity + source context trên timeline; AgentRun history/usage/retry/terminate
  và Pull Request list: đúng chỗ hình học, disabled + reason (không mutation runtime).
- Responsive detail/sidebar + scroll restore như baseline Multica khi khả thi
  trên web host.

**Attachments (core + server)**

- Thay stub `attachment_storage_missing` bằng storage thật (reuse
  `server/internal/storage` seam đã có cho object content).
- List / upload / get content|download / delete; safe content handling (CSP
  preview path đã có middleware pattern cho attachments).
- Capability registry: `tasks.attachments` → `available` khi đường upload/preview/
  download chạy thật.
- Client: endpoints + schemas + malformed tests; hooks qua TanStack Query;
  không ghi WS payload vào cache.

**`packages/core`**

- Tái dùng `api/endpoints/task-collaboration`, task hooks, labels/properties/
  statuses suite; mở rộng attachments endpoints nếu thiếu upload/content.
- Không Zustand mới cho detail shell trừ khi Multica chrome bắt buộc persist —
  nếu persist, StorageAdapter trong `packages/core`, không `localStorage` trực tiếp.

**`apps/web`**

- `/{org}/{ws}/tasks/[taskId]` (và path theo identifier nếu `GetByRef` / canonical
  URL đã có): page mỏng; flag on → suite detail; flag off → `TaskDetailView`.
- Lazy-load suite detail + editor khi cần giữ bundle budget route.

**i18n / parity**

- Mọi literal views qua `t()`; `vi` + locale cần thiết; i18n key parity.
- Overlay verification lát 5; brand-scan không còn chuỗi nguồn trong product/tests.

**Tùy chọn nhỏ cùng PR nếu rẻ**

- Create-task từ project detail gắn `project_id` (residual lát 4) — chỉ khi không
  phình scope; nếu không, ghi residual rõ trên PR.

### 3.2 Ngoài phạm vi

- AgentRun / squad / VCS / daemon / workdir runtime thật (lát 6) — chỉ stub UI +
  capability reason.
- Desktop / mobile hosts (lát 7).
- Cutover xóa MVP Tasks + gỡ flag (lát 8).
- Inbox / global search / settings catalogs sâu ngoài những gì detail đã cần
  (đã có từ lát trước hoặc lát khác).
- UI merge phức tạp cho `revision_conflict` (toast + refetch là đủ).

## 4. Kiến trúc

```text
Flag tasks_work_management_parity
  off → TaskDetailView (MVP)
  on  → TaskDetailSuitePage
        ├ packages/views/editor/          (TipTap transplant)
        └ packages/views/tasks/detail/    (shell, props, timeline, subtasks, attachments)
              → TanStack Query (task, collab, attachments, catalogs)
              → AgentRun / PR blocks: stub + reason (lát 6)
```

### 4.1 Cấu trúc thư mục đích

```text
packages/views/editor/                 # TipTap package (tách module ≤ 500 dòng/file)
packages/views/tasks/detail/
  task-detail-suite-page.tsx           # shell / composition root
  components/                          # properties, timeline, subtasks, attachments, …
packages/views/tasks/task-detail-view.tsx  # MVP — giữ đến lát 8
apps/web/app/.../tasks/[taskId]/page.tsx  # flag gate + lazy import
```

Tên file cụ thể có thể bám Multica sau khi transplant, miễn boundary
`editor/` vs `tasks/detail/` và max-lines được giữ.

### 4.2 State và data flow

- Server state: TanStack Query; workspace-scoped keys gồm `wsId`; task detail /
  comments / attachments / reactions dùng factories sẵn có hoặc mở rộng cạnh
  `taskKeys` / collab keys.
- Realtime: invalidate keys qua `use-realtime-sync`; không ghi frame payload vào
  query hay store.
- Optimistic: chỉ khi đủ điều kiện State Rules (vd. reaction toggle nếu outcome
  local predictable). Create/delete comment, upload/delete attachment, create
  sub-task, navigate — await server.
- Put task / comment: revision / If-Match; conflict → toast + refetch.
- Permissions: mirror Go gates; UI disable theo `PermissionContext` + capability
  registry, không tự đoán membership ở handler.

### 4.3 Attachments data notes

- Metadata row + object storage key; membership qua `RequireMember` trên task /
  workspace trước mọi đọc/ghi.
- Upload multipart có cap riêng (không dựa `maxJSONBody` 1 MiB cho binary lớn —
  chọn limit rõ trong handler, test cap).
- Preview: content-type allowlist + CSP attachment preview path; không serve
  executable / unsafe HTML như document.
- Delete: service cleanup metadata + storage trong transaction/service order
  đúng rule (không FK cascade).

## 5. Lỗi và stub

| Tình huống | Hành vi |
| --- | --- |
| Flag off | MVP detail; không mount suite editor / không lộ suite-only chrome |
| Task 404 / forbidden | Not found / forbidden; không lộ cross-tenant |
| Collab / upload fail | Toast + giữ form; không silent success |
| `revision_conflict` | Toast + refetch; không merge UI phức tạp |
| Custom property catalog thiếu | Control disabled + reason |
| AgentRun / PR / VCS | Đúng chỗ; disabled + reason; không mutation runtime |
| Empty timeline / no attachments | Empty state shell + `t()` |

## 6. Kiểm thử và DoD

- Core: attachments endpoints + malformed; collab schema nếu đổi; capability
  `tasks.attachments` = available.
- Views: suite detail smoke (shell, comment compose, attachment slot); editor
  mount smoke; stub contracts AgentRun/PR.
- Go: upload/get/delete attachment + membership/isolation; audit + outbox trên
  command mới (đăng ký `audit_coverage_test`); storage cleanup.
- Brand-scan + parity overlay lát 5.
- E2E: flag on → mở task → title/comment/attachment happy path; flag off → MVP
  không regress.
- Bundle: lazy-load nếu route vượt budget; không nâng ceiling tùy tiện.
- `make check` / `make check-worktree` xanh trước PR.
- Roadmap F-05 vẫn `MỘT PHẦN`; không đánh dấu F-05 xong; dual MVP/suite đến lát 8.

## 7. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| TipTap / editor phình bundle | Lazy-load detail+editor; tách package; đo budget route |
| File >500 lines sau transplant | Tách `components/` / editor modules cơ học |
| Stub storage quên gỡ | Catalogue + handler tests đổi từ stub → available; xóa
  `attachment_storage_missing` path |
| Safe content / XSS qua preview | Allowlist MIME + CSP path có sẵn; test CSP/preview |
| Brand Multica sót | Brand-scan gate + i18n parity |
| Scope creep Agent runtime | Stub-only; lát 6 sở hữu runtime |

## 8. Việc làm tiếp theo

1. ~~User duyệt file spec này.~~  
2. ~~`writing-plans` → plan file.~~  
3. Tạo sub-issue UniAI dưới UNI-426 (UNI-426.5 · Task detail & collaboration) — Task 1 của plan.  
4. `make issue-start` + worktree; SDD transplant + attachments thật + tests + PR.
