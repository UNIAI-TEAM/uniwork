# UniWork — Tasks API và client core (UNI-426 lát cắt 2)

> **Trạng thái:** approved — đã duyệt 2026-09-07; issue `UNI-497`; plan tại `../plans/2026-09-07-tasks-api-client-core.md`

**Ngày:** 2026-09-07  
**Issue:** UNI-497 · UNI-426.2  
**Parent:** UNI-426 · F-05  
**Phụ thuộc:** UNI-495 (lát cắt 1) đã shipped — schema/backfill 107–131, identifier, status seed, capability registry  
**Umbrella:** `2026-09-07-tasks-work-management-parity-design.md` §7 và §11 mục 2  
**Baseline nguồn:** `multica/` @ `3d37828e9`

## 1. Mục tiêu

Xây **lớp API HTTP + client core** đủ để lát cắt 3–4 gắn UI Work Management, mà **không** thay giao diện `/tasks` trong lát cắt này.

Kết quả mong muốn: khi bật flag `tasks_work_management_parity`, client có thể gọi đủ nhóm API Tasks / My Tasks / bảng (table·facet) / catalog / views / projects / cộng tác theo inventory Multica (đã đổi tên Issue → Task), với tenant scope, audit/outbox, revision và chống gửi trùng đúng bất biến UniWork. Khi flag tắt, bộ API MVP hiện tại vẫn phục vụ production như cũ.

## 2. Quyết định đã chốt (brainstorm 2026-09-07)

| Chủ đề | Quyết định |
| --- | --- |
| Độ rộng API | Full parity theo inventory baseline (không cắt còn “core cứng” hay chỉ wire field) |
| Namespace HTTP | Gồm cả catalogs, views **và** Projects HTTP; UI Projects / collection vẫn lát cắt 3–4 |
| Công tắc | API **mới** khóa bằng flag `tasks_work_management_parity`; MVP 7 route luôn mở |
| Cách làm | Viết theo lớp UniWork (handler → service → sqlc); Multica là checklist hành vi, không copy nguyên khối |
| UI | Ngoài phạm vi lát cắt này |
| AgentRun / VCS / daemon | Route stub (nếu có trong inventory) trả `capability_unavailable`, không giả thành công |

## 3. Phạm vi

### 3.1 Trong phạm vi

**Server (sau flag)**

- Tasks: list có lọc / sắp xếp / phân trang phù hợp Board·List·Gantt·Swimlane; chi tiết theo ULID **hoặc** identifier `<prefix>-<number>`; tạo / sửa / xóa; batch; children; dependencies.
- My Tasks theo workspace.
- Table: groups, rows, facets, column projection; CSV export nếu inventory baseline có.
- Catalog HTTP: task-statuses, task-labels, task-properties.
- Task views: CRUD / active / preference.
- Projects + project resources (HTTP only).
- Cộng tác: comment thread (reply, edit/delete, resolve), reactions, subscribers; attachments / source context / activity nếu có trong inventory.
- Mutation: tăng `revision` đúng một lần mỗi lệnh thành công; update thường nhận revision / `If-Match` → lỗi ổn định `revision_conflict`; create và comment nhận idempotency key.
- Mọi query/ghi business lọc `organization_id` + `workspace_id`; membership chỉ qua `RequireMember`.
- Audit + outbox cùng transaction với thay đổi nghiệp vụ.

**Client (`packages/core`)**

- Types / Zod / `parseWithFallback` cho mọi endpoint mới; malformed-response tests.
- React Query hooks + query keys scoped workspace (và filter hash khi cần).
- Mutation revision-aware; create/comment idempotent phía client khi server yêu cầu key.
- Realtime: map sự kiện → invalidate hoặc patch projection chắc chắn; **không** ghi payload WebSocket vào Zustand.
- Đọc capability / flag từ config trước khi gọi surface mới (UI lát cắt sau sẽ dùng; hook sẵn sàng ở đây).

### 3.2 Ngoài phạm vi

- Đổi board / list UI `/tasks`, `/my-tasks`, Projects pages (lát cắt 3–4).
- Desktop / mobile hosts (lát cắt 7).
- Runtime AgentRun / VCS / local daemon thật (lát cắt 6).
- Cutover xóa MVP và tắt flag vĩnh viễn (lát cắt 8).
- Migration schema nền (đã xong ở UNI-495); lát cắt 2 chỉ thêm query/index nếu một endpoint cụ thể bắt buộc và có migration riêng đúng quy tắc repo.

## 4. Kiến trúc

```text
UI (lát cắt sau) → typed endpoint (@uniwork/core)
  → handler (Chi, SDI/SDO)
  → flag gate (tasks_work_management_parity)
  → RequireMember
  → service transaction
       → sqlc (org + workspace)
       → audit_events + outbox_events
  → response kèm revision
  → realtime → cache coordinator (patch hoặc invalidate)
```

### 4.1 Hai bề mặt API

| Bề mặt | Flag tắt | Flag bật |
| --- | --- | --- |
| MVP hiện tại (`List/Create/Get/Update/Delete/Comments` + welcome) | Hoạt động | Vẫn hoạt động (chưa xóa) |
| Suite mới (mọi route lát cắt 2) | Không dùng được (404 hoặc lỗi ổn định đã chọn trong plan) | Hoạt động |

Additive fields đã có trên MVP DTO sau UNI-495 (`organization_id`, `number`, `identifier`, `revision`) **giữ nguyên** trên route cũ; hành vi revision conflict / idempotency đầy đủ là của suite mới (và được mô tả trong plan nếu có nâng route MVP).

### 4.2 Namespace mục tiêu (từ umbrella §7.1)

```text
/api/v1/workspaces/{workspaceID}/tasks
/api/v1/tasks/{taskID-or-identifier}
/api/v1/workspaces/{workspaceID}/my-tasks
/api/v1/workspaces/{workspaceID}/projects
/api/v1/workspaces/{workspaceID}/task-statuses
/api/v1/workspaces/{workspaceID}/task-labels
/api/v1/workspaces/{workspaceID}/task-properties
/api/v1/workspaces/{workspaceID}/task-views
```

Danh sách method/path cụ thể được chốt trong implementation plan bằng cách đối chiếu `docs/parity/tasks-work-management.json` + route inventory Multica @ `3d37828e9` (đổi tên theo bảng ánh xạ umbrella). Plan không được bỏ endpoint đã có trong inventory mà không ghi lý do `stubbed` + capability.

### 4.3 Client cache / realtime

- Query keys luôn có `workspaceId` (và org context qua shell hiện có).
- Optimistic chỉ khi đủ điều kiện repo (cục bộ đoán được, cùng màn hình, rollback bằng cache restore) — drag status/position là ứng viên; create/delete/navigate await server.
- WebSocket chỉ kích hoạt invalidate/patch; không phải nguồn sự thật.

## 5. Lỗi ổn định (tối thiểu)

Dùng mã đã liệt kê ở umbrella khi áp dụng: `revision_conflict`, `capability_unavailable`, `assignee_not_member`, `invalid_status`, `parent_cycle`, `cross_workspace_reference`, `forbidden`, `not_found`, cộng các mã batch/idempotency plan sẽ đặt tên cụ thể.

## 6. Kiểm thử và điều kiện xong

- Go: service/handler — happy path, permission, tenant isolation, revision race, idempotent replay, audit/outbox rollback, flag off chặn suite mới.
- Core: malformed-response mỗi endpoint; hook/cache tests cho invalidate vs patch.
- Manifest: cập nhật verification/disposition cho entry API thuộc lát cắt 2 khi có evidence (không đánh dấu UI slice).
- `make check` / `make check-worktree` xanh trước khi tuyên bố xong.
- Không có branding nguồn trong product code/tests.
- Sub-issue UniAI (ví dụ UNI-426.2) ở `in_review` sau PR; chỉ người đặt `done`.

## 7. Theo dõi và tài liệu liên quan

- Tạo sub-issue dưới UNI-426 khi bắt đầu `writing-plans` (agents không tự tạo issue ngoài sub-issue được giao — người dùng/agent session tạo theo quy trình `make issue-start` sau khi có KEY).
- Plan tương lai: `docs/superpowers/plans/2026-09-07-tasks-api-client-core.md` (tên chính thức khi viết plan).
- Không đánh dấu umbrella / F-05 xong chỉ vì lát cắt 2 ship.

## 8. Tóm tắt một câu

Lát cắt 2 = **full API + client core sau flag**, làm theo lớp UniWork, đủ Projects/catalogs HTTP, **không** làm UI; MVP cũ vẫn sống khi flag tắt.
