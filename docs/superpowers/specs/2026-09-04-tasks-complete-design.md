# UniWork — Công việc hoàn chỉnh (Tasks Complete): lát cắt dọc đạt DoD

**Ngày:** 2026-09-04  
**Trạng thái:** Đã duyệt (2026-09-04, quangpd — UNI-421). Câu hỏi mở đã chốt trong `docs/roadmap/OPEN_QUESTIONS.md`; ADR 0007–0010 accepted.  
**Spec liên quan:** `2026-08-27-tasks-multica-parity-design.md` (thu hẹp và thay thế phần roadmap pha), `2026-08-27-workspace-permissions-design.md`, `2026-08-24-uniwork-platform-design.md`, `2026-09-04-agent-actor-model-design.md` (chỗ dành cho agent), `2026-09-04-audit-domain-events-design.md` (activity log), `2026-09-04-platform-admin-observability-design.md`  
**Tham chiếu:** `docs/vision/PROJECT_VISION.md` §5.2 (#5), §6.9 (DoD); bản cũ `unidigiwork/src/lib/api/tasks.functions.ts`, `task-views.functions.ts`, `src/lib/tasks-storage.ts`; Blueprint v1.0 §24 (bộ test bắt buộc mỗi module)


> **Ghi chú số migration:** số `0NN_` trong spec này là **giữ chỗ**; số thật được cấp khi viết plan, theo thứ tự triển khai trong `docs/roadmap/FEATURE_ROADMAP.md` (audit/outbox → entitlement → tasks → notifications → …) và theo migration mới nhất trên `develop` lúc đó. Các spec cùng ngày có dải số trùng nhau là cố ý.

## 1. Mục tiêu

Đưa **Công việc** từ MVP hiện tại (4 status, comment thêm‑không‑sửa, không attachment, không view) thành **một lát cắt dọc hoàn chỉnh** đạt Definition of Done của Vision §6.9: đầy đủ cho một đội 10–200 người dùng thật hằng ngày, có agent làm assignee về mặt mô hình, có audit, idempotency, optimistic concurrency, realtime, quyền, kiểm thử đủ tầng.

Thành công khi:

- Đội UNICOM dùng Tasks cho việc thật ≥ 4 tuần liên tục, không quay lại công cụ cũ (tiêu chí thoát giai đoạn F).
- Mọi thao tác trên task có dòng activity thật; không màn hình nào còn mock/“coming soon”.
- `make check` xanh; bộ test §9 đủ 9 loại theo Blueprint §24.

### 1.1 Hiện trạng đúng như code (không theo trạng thái plan)

| Thành phần | Thực tế 2026-09-04 |
|---|---|
| Schema | `tasks` MVP (`002`), thêm `kind` (`004`). **Không** có `task_statuses`, `number/identifier`, `task_prefix`. Plan `tasks-phase-0-skeleton` ghi `shipped` nhưng migration 008+ là meeting; cần cập nhật trạng thái plan đó thành `superseded` khi duyệt spec này. |
| Service | `TaskService` Create/List/Get/Update/Delete/AddComment/Comments; status cố định 4 giá trị; không revision, không idempotency. |
| API | 7 route trong `router/tasks.go`. |
| FE | `packages/core/tasks` (hooks, position), `packages/views/tasks` 6 file (board/list/detail/new‑dialog/card). |
| Permission | `canEditTask/canDeleteTask/canEditComment/canDeleteComment` đã có trong `rules.ts`. |

## 2. Quyết định đã chốt

| # | Quyết định |
|---|------------|
| 1 | **Thu hẹp** epic parity Multica: không gantt/swimlane/custom properties/inbox/GitHub/channel trong spec này. Làm sâu 9 năng lực ở §3, làm xong từng cái. |
| 2 | Status catalog: **7 key cố định** (`backlog, todo, in_progress, in_review, done, blocked, cancelled`), không custom status ở giai đoạn F. Cột `tasks.status` giữ key; FE nhóm board theo key. |
| 3 | **Project** là bảng riêng trong workspace, task tùy chọn thuộc 1 project. Không đổi tên thành “issue”. |
| 4 | Attachment: DB chỉ lưu `storage_provider, bucket, object_key, size, content_type, filename`; **không** lưu URL cố định; đọc qua presigned GET ngắn hạn hoặc proxy `GET /attachments/{id}/content`. |
| 5 | Concurrency: `tasks.revision INTEGER` tăng mỗi lần ghi; PATCH mang `If-Match: <revision>` (hoặc body `revision`), lệch → `409 REVISION_CONFLICT`. Board drag (status/position) là ngoại lệ **last‑write‑wins** có chủ ý, không gửi revision. |
| 6 | Idempotency: `POST /tasks` và `POST /tasks/{id}/comments` nhận header `Idempotency-Key` (ULID do client sinh), lưu 24h trong bảng `idempotency_keys` chung; trùng key → trả lại kết quả cũ, không tạo bản ghi mới. |
| 7 | Activity log **không** viết riêng cho task: đọc từ `audit_events` (spec audit‑outbox) lọc `entity_type='task'`. Task chỉ đảm bảo mọi mutation ghi audit trong cùng transaction. |
| 8 | Assignee: cột `assignee_type` (`member` \| `agent`) + `assignee_id`. Giai đoạn F chỉ nhận `member`; `agent` trả `422 AGENT_NOT_AVAILABLE` cho đến khi spec agent‑actor‑model ship. UI picker không hiển thị agent khi flag `agents_assignee` tắt. |
| 9 | Saved views là **cá nhân** (`user_id`), scope workspace; view chia sẻ để sau. My Work là query xuyên workspace của organization hiện tại, không lưu bảng. |
| 10 | Comment sửa/xóa theo policy đã chốt: tạo = member; sửa/xóa = author ∨ effective owner/admin. Xóa là soft delete (`deleted_at`), body thay bằng placeholder. |

## 3. Phạm vi

### Trong spec

1. Status 7 key, priority thêm `none`, `start_date`.
2. Projects (CRUD, archive) và gán task vào project.
3. Labels (workspace‑level, name + color) và gán nhiều label cho task.
4. Subtasks: `parent_task_id` một cấp + checklist nhẹ trên task.
5. Attachments trên task và comment qua storage adapter.
6. Comments sửa/xóa (soft), `author_type` member|agent.
7. Activity log đọc từ audit; hiển thị trên detail.
8. Saved views cá nhân; My Work xuyên workspace.
9. Revision + idempotency; realtime; quyền; test; DoD.

### Ngoài spec (giữ chỗ hoặc để sau)

- Custom status, custom properties, dependencies (`blocks/blocked_by`), gantt/swimlane/table, reactions, inbox, GitHub/channel, agent runtime, shared views, task template, recurring task.
- Migration dữ liệu từ `unidigiwork` (Vision §7.3: không migrate; import CSV là công cụ riêng).

## 4. Data model

Nguyên tắc: ULID `TEXT`, không FK sau 004, mọi query lọc `workspace_id`, index `CONCURRENTLY` đứng một mình. Migration đánh số tiếp theo số hiện có (`ls server/migrations | tail -1`), dưới đây ghi `NNN`.

### 4.1 `tasks` (ALTER)

```sql
ALTER TABLE tasks
  ADD COLUMN number         INTEGER,                      -- backfill theo created_at trong workspace
  ADD COLUMN identifier     TEXT,                         -- '<prefix>-<number>'
  ADD COLUMN project_id     TEXT,
  ADD COLUMN parent_task_id TEXT,
  ADD COLUMN assignee_type  TEXT NOT NULL DEFAULT 'member' CHECK (assignee_type IN ('member','agent')),
  ADD COLUMN start_date     DATE,
  ADD COLUMN revision       INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN updated_by     TEXT,
  ADD COLUMN completed_at   TIMESTAMPTZ,
  ADD COLUMN last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN
  ('backlog','todo','in_progress','in_review','done','blocked','cancelled'));
ALTER TABLE tasks DROP CONSTRAINT tasks_priority_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('none','low','medium','high','urgent'));
```

`workspaces` thêm `task_prefix TEXT NOT NULL DEFAULT 'TASK'` (A–Z0–9, ≤ 8, suy từ slug khi backfill) và `task_counter INTEGER NOT NULL DEFAULT 0`. Cấp `number` bằng `UPDATE workspaces SET task_counter = task_counter + 1 … RETURNING task_counter` trong cùng transaction tạo task (khóa hàng workspace, không race).

Index (mỗi file một lệnh): `UNIQUE (workspace_id, number)`, `(workspace_id, project_id, status, position)`, `(workspace_id, assignee_id) WHERE status NOT IN ('done','cancelled')`, `(parent_task_id)`.

### 4.2 Bảng mới

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `projects` | `id, workspace_id, name, key (≤8, unique/ws), description, color, status ('active'\|'archived'), lead_user_id, start_date, target_date, created_by, created_at, updated_at, archived_at` | Xóa project = archive; task giữ `project_id`. |
| `task_labels` | `id, workspace_id, name, color, created_by, created_at` | `UNIQUE (workspace_id, lower(name))`. |
| `task_label_links` | `task_id, label_id, workspace_id, created_at` | PK `(task_id, label_id)`; `workspace_id` để lọc không cần join. |
| `task_checklist_items` | `id, task_id, workspace_id, body, done_at, position, created_by, created_at` | Checklist nhẹ, không phải task con. |
| `attachments` | `id, workspace_id, owner_type ('task'\|'task_comment'), owner_id, storage_provider, bucket, object_key, filename, content_type, size_bytes, uploaded_by, created_at, deleted_at` | Không có cột URL. Giới hạn 25 MB/file (kế thừa bản cũ), 20 file/task. |
| `task_views` | `id, workspace_id, user_id, name, layout ('board'\|'list'), filters JSONB, sort JSONB, group_by TEXT, is_default BOOLEAN, created_at, updated_at` | `filters` schema: `{status[], priority[], assignee_id[], label_id[], project_id[], due: 'overdue'\|'today'\|'week'\|null, q}`. |
| `idempotency_keys` | `key TEXT PK, user_id, route, response_status, response_body JSONB, created_at` | Dùng chung mọi domain; job xóa > 24h. |

`task_comments` ALTER: thêm `workspace_id` (backfill từ task), `author_type TEXT NOT NULL DEFAULT 'member'`, `edited_at`, `deleted_at`, `deleted_by`.

### 4.3 Bất biến ở tầng service

- Mọi ghi vào `tasks`/vệ tinh nằm trong một transaction cùng: tăng `revision`, cập nhật `last_activity_at`, ghi `audit_events`, ghi `outbox_events` (spec audit‑outbox). Handler không bao giờ chạm DB.
- `parent_task_id` phải cùng workspace và không tạo chu trình (chỉ 1 cấp: parent không được có parent).
- Xóa task: soft? **Không.** Xóa cứng nhưng trong transaction: xóa `task_label_links`, `task_checklist_items`, `task_comments`, `attachments` rows (object storage xóa async qua outbox `attachment.deleted`), set `parent_task_id = NULL` cho con. Audit giữ bản snapshot.

## 5. API

Prefix `/api/v1`, SDI/SDO theo `docs/api-sdi-sdo.md`. Mọi route workspace đi qua `RequireMember`; route theo `taskID` tự resolve workspace từ task (như `authorize` hiện tại).

### 5.1 Tasks

| Method | Route | Ghi chú |
|---|---|---|
| GET | `/workspaces/{ws}/tasks?status=&priority=&assignee_id=&label_id=&project_id=&parent_task_id=&due=&q=&cursor=&limit=` | Cursor theo `(position,id)` hoặc `(updated_at,id)` tùy sort; `limit` ≤ 200. |
| POST | `/workspaces/{ws}/tasks` | Header `Idempotency-Key` bắt buộc từ FE (server chấp nhận thiếu nhưng log warn). Body: title, description, status?, priority?, assignee_type?, assignee_id?, project_id?, parent_task_id?, label_ids[]?, start_date?, due_date?. |
| GET | `/tasks/{idOrIdentifier}` | Trả task + labels + counts (comments, attachments, checklist done/total) + project tóm tắt. |
| PATCH | `/tasks/{id}` | Header `If-Match: "<revision>"`. Field vắng = không đổi; `null` = xóa (giữ kiểu `json.RawMessage` hiện có). Board drag gửi chỉ `status/position` **không** `If-Match`. |
| DELETE | `/tasks/{id}` | |
| POST | `/workspaces/{ws}/tasks/batch` | `{task_ids[], patch:{status?, priority?, assignee?, project_id?, add_label_ids?, remove_label_ids?}}`, tối đa 100. Trả từng kết quả. |
| GET | `/workspaces/{ws}/tasks/{id}/children` | Task con. |
| GET | `/me/tasks?organization_id=&scope=assigned\|created\|mentioned&due=` | **My Work** xuyên workspace: server lấy các workspace user là effective member trong org rồi union. |

### 5.2 Vệ tinh

- Projects: `GET/POST /workspaces/{ws}/projects`, `GET/PATCH /projects/{id}`, `POST /projects/{id}/archive`, `POST /projects/{id}/unarchive`.
- Labels: `GET/POST /workspaces/{ws}/labels`, `PATCH/DELETE /labels/{id}` (xóa label = xóa links trong tx).
- Checklist: `GET/POST /tasks/{id}/checklist`, `PATCH/DELETE /checklist/{itemId}`.
- Comments: `GET /tasks/{id}/comments?cursor=`, `POST` (Idempotency‑Key), `PATCH /comments/{id}` (author ∨ admin), `DELETE /comments/{id}` (soft).
- Attachments: `POST /tasks/{id}/attachments/presign` → `{upload_url, object_key, headers}` (S3/MinIO) hoặc `POST /tasks/{id}/attachments` multipart (LocalStorage dev); `POST /tasks/{id}/attachments/confirm` ghi row sau khi upload xong; `GET /attachments/{id}/content` (proxy, `Content-Disposition` an toàn); `DELETE /attachments/{id}`.
- Views: `GET/POST /workspaces/{ws}/task-views` (của tôi), `PATCH/DELETE /task-views/{id}`, `POST /task-views/{id}/default`.
- Activity: `GET /tasks/{id}/activity?cursor=` → đọc `audit_events` where `entity_type='task' AND entity_id=$1` ∪ `entity_type IN ('task_comment','attachment','task_checklist_item') AND parent_id=$1`.

### 5.3 Mã lỗi ổn định (thêm vào `mapServiceError` một lần)

`REVISION_CONFLICT` (409), `IDEMPOTENCY_REPLAY` (200 với body cũ, header `Idempotent-Replayed: true`), `AGENT_NOT_AVAILABLE` (422), `PARENT_DEPTH_EXCEEDED` (422), `ATTACHMENT_TOO_LARGE` (413), `ATTACHMENT_LIMIT` (422), `PROJECT_ARCHIVED` (422), `LABEL_DUPLICATE` (409).

### 5.4 Realtime

Giữ contract id‑only + invalidate. Sự kiện: `task.created|updated|deleted`, `task.batch_updated` (payload `task_ids` nối bằng dấu phẩy), `comment.created|updated|deleted`, `attachment.created|deleted`, `project.created|updated|archived`, `label.created|updated|deleted`, `checklist.updated` (payload `task_id`). Publish qua `EventPublisher.Publish(workspaceID, …)` **sau commit** (outbox → relay; xem spec audit‑outbox; đến khi outbox chung ship, giữ publish trực tiếp sau commit như hiện tại).

## 6. Quyền

Mở rộng ma trận `2026-08-27-workspace-permissions-design.md`, mirror trong `packages/core/permissions/rules.ts`:

| Hành động | Ai |
|---|---|
| Task CRUD, gán, đổi status, checklist, attachment thêm/xóa của mình | effective member |
| Xóa attachment người khác, xóa task người khác | member (theo quyết định #2 spec permissions: nội dung ngang nhau) — giữ, nhưng audit ghi `actor ≠ creator` |
| Sửa/xóa comment | author ∨ effective owner/admin |
| Project tạo/sửa/archive | effective member; archive/unarchive = admin‑like |
| Label tạo/sửa/xóa | admin‑like (tránh rác taxonomy) |
| Đổi `task_prefix` | workspace owner/admin (Settings) |
| Saved view | chỉ chủ view |
| My Work | user, theo membership thật |

Rule thêm: `canManageLabels`, `canArchiveProject`, `canDeleteAttachment(uploadedBy, ctx)`, `canEditTaskPrefix`.

## 7. Giao diện và package

### 7.1 Routes (builder trong `packages/core/paths/paths.ts`, test consistency)

`/{org}/{ws}/tasks` (board/list theo view), `/{org}/{ws}/tasks/{identifier}`, `/{org}/{ws}/projects`, `/{org}/{ws}/projects/{key}`, `/{org}/{ws}/my-work` (hoặc `/my-work` cấp org — xem câu hỏi mở), Settings tab **Labels** và **Task prefix**.

### 7.2 Package map

```
packages/core/types/{task,project,label,attachment,task-view}.ts
packages/core/api/endpoints/{tasks,projects,labels,attachments,task-views}.ts (+ .test.ts malformed)
packages/core/tasks/{hooks,keys,position,filters}.ts     # taskKeys.list(wsId, filters), taskKeys.detail(id), taskKeys.myWork(orgId)
packages/core/projects/hooks.ts · packages/core/labels/hooks.ts · packages/core/task-views/{hooks,store}.ts (Zustand: view đang chọn, filter tạm)
packages/core/attachments/{hooks,upload}.ts                # presign → PUT → confirm; progress; abort
packages/views/tasks/{tasks-page,task-surface,board,list,filter-bar,batch-toolbar,task-detail,comment-thread,attachment-list,checklist,activity-feed,new-task-dialog}.tsx  (mỗi file ≤ 500 dòng)
packages/views/projects/*.tsx · packages/views/my-work/*.tsx · packages/views/settings/{labels-tab,task-prefix-section}.tsx
apps/web/app/[orgSlug]/[workspaceSlug]/{tasks,projects,my-work}/…
server/internal/service/{task,task_comment,task_attachment,task_view,project,label,idempotency}.go (+ _test)
server/internal/handler/{task,project,label,attachment,task_view}.go · router/{tasks,projects,labels,attachments,task-views}.go
server/pkg/db/queries/{tasks,task_comments,attachments,projects,task_labels,task_views,idempotency_keys}.sql
```

### 7.3 Hành vi UI bắt buộc (PRODUCT.md)

- Board 7 cột; cột rỗng vẫn hiện, cột `cancelled` thu gọn mặc định. Danh sách > 200 dòng phải ảo hóa (Vision §6.3).
- Optimistic chỉ cho drag status/position; mọi thứ khác chờ server. Conflict 409 → toast “Công việc đã được người khác cập nhật” + nút tải lại, không ghi đè.
- Empty state nói rõ bước tiếp theo; không mock.
- Attribution: mỗi comment/activity hiển thị `author_type`; agent có badge riêng (chỉ khi flag bật).
- Upload: kéo‑thả, tiến trình, hủy; ảnh xem inline qua proxy, còn lại tải về.
- i18n vi/en mọi chuỗi; keys `tasks.*`, `projects.*`, `labels.*`, `myWork.*`.
- Bàn phím: `c` tạo task, `e` sửa, `esc` đóng, `⌘K` command palette có “Tạo công việc”.

## 8. Ràng buộc kỹ thuật

- Handler → service → sqlc; `arch_test.go` giữ. Idempotency middleware ở tầng handler nhưng lưu/đọc qua `IdempotencyService`.
- Storage: dùng `storage.Storage` + `Presigner` hiện có; `LocalStorage` cho dev/on‑prem nhỏ, `s3.go` cho MinIO/S3. Không thêm provider.
- Object key: `workspaces/{ws}/tasks/{task}/{attachmentId}/{sanitizedFilename}`.
- Content‑type sniff phía server; chặn `text/html`, `image/svg+xml` inline (trả attachment).
- Mọi query tasks có `workspace_id` trong WHERE, kể cả khi đã có `id` (defense in depth). My Work là ngoại lệ có chủ ý: WHERE `workspace_id = ANY($memberWorkspaces)`.
- Metrics: `uniwork_tasks_total{workspace}` (gauge cập nhật theo event), `uniwork_task_mutations_total{kind}`, histogram `uniwork_task_list_duration_seconds`.

## 9. Kiểm thử (Blueprint §24, bắt buộc mỗi loại)

| Loại | Nơi | Case tối thiểu |
|---|---|---|
| Happy path | Go service test | create → patch → comment → attach → done |
| Permission denied | Go | member khác workspace 403/404; sửa comment không phải author 403 |
| Tenant isolation | Go + e2e | user A không list/get/patch task của workspace B, kể cả bằng `identifier` trùng số |
| Invalid lifecycle | Go | status ngoài 7 key; parent 2 cấp; task vào project archived |
| Version conflict | Go | 2 PATCH cùng revision → 1 thành công, 1 `REVISION_CONFLICT` |
| Idempotent replay | Go | POST 2 lần cùng key → 1 row, response bằng nhau, header replayed |
| Audit | Go | mỗi mutation có đúng 1 `audit_events` cùng tx; rollback không để lại audit |
| Outbox | Go | event xuất hiện trong `outbox_events` sau commit; không có khi rollback |
| Error contract | Go handler test + FE malformed test | mã lỗi ổn định; FE degrade khi field lạ |
| FE | Vitest | rules mirror; hooks invalidate đúng key theo event; upload state machine |
| E2E | Playwright `e2e/tasks.spec.ts` | tạo → kéo board → detail → comment → attach → My Work thấy task |
| Migration lint | `lint_test.go` | tự chạy |

Coverage floor Go và vitest threshold **tăng** theo phần code mới; không giảm.

## 10. Definition of Done (tick đủ mới đóng)

- [ ] OpenAPI phản chiếu đủ route mới; SDI/SDO có mô tả tiếng Việt.
- [ ] Migration up/down, lint pass; backfill `number/identifier` cho task hiện có.
- [ ] Rules mirror Go ↔ TS có test.
- [ ] Audit + outbox cùng tx (hoặc publish‑sau‑commit tạm thời, ghi rõ trong plan).
- [ ] Idempotency + revision hoạt động, có test.
- [ ] UI vi/en, sáng/tối, bàn phím, mobile (board cuộn ngang, list ưu tiên trên mobile).
- [ ] `assignee_type` có trong DTO; agent trả 422 có test; không UI agent giả.
- [ ] Metrics + log có `workspace_id`, `actor_id`.
- [ ] Unit + contract + Go + e2e xanh; coverage không giảm; `pnpm knip` sạch.
- [ ] Tài liệu người dùng ngắn `docs/user/tasks.md` (vi).

## 11. Kế thừa từ bản cũ / bỏ

| Bản cũ (`unidigiwork`) | Xử lý |
|---|---|
| `create_task/update_task/transition_task/assign_task/comment_task/create_subtask` RPC | Hành vi chuyển vào `TaskService`; không port SQL. |
| `task-views.functions.ts` (`TaskSavedViewDTO`: filters/sort/group) | Kế thừa shape JSON của `filters`, đổi tên cột snake_case. |
| `tasks-storage.ts` (bucket `task-attachments`, 25 MB) | Giữ giới hạn; bucket do cấu hình, không hard‑code. |
| Tag trên task (`set_task_tags`) | Thành `task_labels` workspace‑level. |
| `home-task-kind.ts`, tùy biến View Home | Không port; My Work + saved views thay thế. |
| Bảng `work_nodes/work_edges` (work graph) | Không port trong spec này. |

## 12. Lộ trình plan (mỗi plan ship riêng, theo thứ tự)

1. **Plan T1 — Nền:** migration tasks/workspaces (status 7, priority none, number/identifier, revision, assignee_type), `idempotency_keys`, If‑Match, backfill; FE types/board 7 cột. Supersede plan `tasks-phase-0-skeleton`.
2. **Plan T2 — Taxonomy:** projects + labels + filter bar + batch.
3. **Plan T3 — Chi tiết:** comments edit/delete, checklist, subtasks, attachments qua storage adapter, activity feed (đọc audit).
4. **Plan T4 — Views:** saved views cá nhân, My Work, ảo hóa list, phím tắt, settings prefix/labels.
5. **Plan T5 — Dọn:** xóa path MVP còn sót, e2e đầy đủ, docs người dùng.

## 13. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Spec audit‑outbox chưa ship khi T1 bắt đầu | T1 ghi audit qua interface `AuditWriter` tạm (no‑op có test), publish sau commit như hiện tại; T3 activity feed phụ thuộc audit thật. |
| Backfill `number` trên dữ liệu dev không nhất quán | Pre‑launch: chấp nhận đánh số theo `created_at`; test migration trên DB có dữ liệu mẫu. |
| Upload lớn qua proxy làm nghẽn server | Ưu tiên presigned PUT thẳng S3/MinIO; proxy chỉ cho LocalStorage dev và preview. |
| Drift Go ↔ TS rules | Test bảng quyết định chung (JSON fixture đọc bởi cả hai bên). |

## 14. Câu hỏi mở (chủ sở hữu sản phẩm quyết)

1. My Work đặt ở cấp **organization** (`/{org}/my-work`, xuyên workspace) hay trong từng workspace? Đề xuất: cấp org, là trang mặc định sau đăng nhập (IA V2 “Home = việc”).
2. Xóa task là **cứng** (đề xuất, có audit snapshot) hay soft delete với thùng rác 30 ngày?
3. Label quản lý bởi admin‑like (đề xuất) hay mọi member được tạo?
4. Có cần `in_review` và `blocked` là status hay là cờ? Đề xuất giữ là status để board có cột.
5. Giới hạn dung lượng attachment theo gói (entitlement) ngay ở F hay để C khi billing có?
