# Picker người phụ trách: tần suất, quyền giao agent, chấm trạng thái

> **Trạng thái:** in-progress — spec v1 đã duyệt ngày 2026-09-29, đang triển khai trên nhánh `feature/UNI-866-…`.

**Issue:** UNI-866, parent UNI-426. **Roadmap:** F-05. **Issue liên quan:** UNI-867 (squad, chỉ spec và ADR).

## 1. Mục tiêu

`AssigneePicker` (`packages/views/tasks/pickers/assignee-picker.tsx`) đã là picker
dùng chung cho mọi chỗ chọn người phụ trách. Bản tham chiếu còn ba hành vi mà
UniWork chưa có: sắp người hay được giao lên đầu, không cho giao việc cho agent
không nhận việc được, và chấm trạng thái trên avatar. Spec này port ba hành vi đó,
điều chỉnh theo mô hình agent hiện có của UniWork: chưa có runtime (A-01), agent
chỉ có `status` `active | paused | archived`, không có owner/private/danh sách
người được gọi.

Ngoài phạm vi: squad làm người phụ trách (UNI-867); mô hình quyền owner/private của
bản tham chiếu; trạng thái runtime của agent.

## 2. Sắp theo tần suất

### 2.1 Định nghĩa

Tần suất của một người phụ trách X với người đang đăng nhập U, trong workspace W, là
số lần trong 90 ngày gần nhất U đã:

- tạo một task có người phụ trách là X (`task.created`), hoặc
- đổi người phụ trách của một task sang X (`task.updated` có thay đổi `assignee_id`).

Cả hai đã có sẵn trong `audit_events`: `changes` là JSON dạng
`{"assignee_id": {"from": …, "to": …}}` (`audit.Diff`), và dòng `task.created` dùng
`Diff(nil, …)` nên mọi trường đều có `from: null`. Một nguồn duy nhất, không cần
đếm thêm từ bảng `tasks`.

Giới hạn 90 ngày là chủ ý: `audit_events` chỉ tăng, nên truy vấn phải có cận dưới
thời gian để luôn rẻ; thói quen giao việc cũ hơn ba tháng cũng ít giá trị để sắp.

### 2.2 Backend

- **Route:** `GET /api/v1/workspaces/{workspaceID}/assignee-frequency` thay
  `WorkManagementCapabilityStub`. Bỏ nhánh `assignee-frequency` trong
  `task_stubs.go`. Danh mục route parity đổi dòng này từ `stub/stubbed` sang
  `tasks/adapted` (generator và JSON).
- **Handler → service:** handler chỉ đọc param và gọi
  `TaskService.AssigneeFrequency(ctx, userID, workspaceID)`. Service gọi
  `RequireMember` (non-member nhận 403/404 như mọi route workspace), lấy
  `organization_id` của workspace, rồi gọi query.
- **Query** `ListAssigneeFrequency` (sqlc, `server/pkg/db/queries/`): lọc
  `organization_id`, `workspace_id`, `actor_kind = 'human'`, `actor_id`,
  `action IN ('task.created','task.updated')`, `occurred_at >= now() - 90 ngày`,
  `changes::jsonb -> 'assignee_id' ->> 'to' IS NOT NULL`; nhóm theo id đích; giới
  hạn 200 dòng. `assignee_kind` suy ra bằng `LEFT JOIN workspace_agent_members` của
  chính workspace đó (`agent` nếu có dòng, ngược lại `human`) — id là ULID nên không
  trùng giữa người và agent.
- **Index:** một migration một câu lệnh
  `CREATE INDEX CONCURRENTLY … ON audit_events (workspace_id, actor_id, occurred_at DESC)`,
  tên theo quy tắc `999<unix-ms>_…`.
- **Phản hồi (SDO):** `{"items": [{"assignee_kind": "human|agent", "assignee_id": "…", "frequency": 3}]}`,
  sắp giảm dần theo `frequency`.
- **Test Go:** đếm đúng cả hai nguồn; bỏ dòng ngoài 90 ngày; không đếm hành động
  của người khác; không lẫn workspace/tổ chức khác; bỏ lần bỏ giao (`to = null`);
  suy đúng `assignee_kind`; non-member bị từ chối.

### 2.3 Frontend

- `packages/core/api/endpoints/`: `getAssigneeFrequency(wsId)` + schema lỏng
  (`assignee_kind` là `z.string()`), fallback `[]`, test phản hồi hỏng.
- `packages/core/tasks/`: `useAssigneeFrequency(wsId)` với query key trong factory
  của task, workspace id nằm trong key, `staleTime` 5 phút. Không có realtime
  invalidation: tần suất không cần tươi từng giây.
- Thứ tự được tính ở nơi dựng danh sách lựa chọn (`useWorkspaceAssigneeOptions`),
  không ở `AssigneePicker`, để mọi picker dùng chung một thứ tự. Thành viên và agent
  mỗi nhóm sắp giảm dần theo tần suất; hòa (kể cả 0) thì giữ thứ tự cũ (sort ổn
  định). Lỗi hoặc dữ liệu hỏng thì coi như không có tần suất.

## 3. Quyền giao việc cho agent

### 3.1 Quy tắc

Chỉ agent `status = 'active'` và chưa `archived_at` mới nhận được việc mới.

| Trạng thái agent | Giao mới | Mã lỗi backend |
| --- | --- | --- |
| `active` | được | — |
| `paused` | không | 422 `agent_paused` |
| `archived` hoặc có `archived_at` | không | 422 `agent_archived` |

Quy tắc chỉ áp khi người phụ trách **đổi sang** agent đó (tạo task, sửa task, sửa
hàng loạt). Task đang giao cho một agent vừa bị tạm dừng vẫn sửa được các trường
khác, và vẫn bỏ giao được.

### 3.2 Backend

`TaskService.assigneeKind`, nhánh `audit.KindAgent`: sau `RequireAgentMember`, đọc
agent (cùng tổ chức) và từ chối theo bảng trên. Nơi gọi truyền thêm người phụ trách
hiện tại để bỏ qua kiểm tra khi giá trị không đổi. Test Go cho active/paused/archived
trên tạo, sửa và sửa hàng loạt, và cho trường hợp sửa trường khác của task đã giao.

### 3.3 Frontend

- `packages/core/permissions/`: rule thuần
  `canAssignAgent(agent) → { allowed: boolean; reason: "paused" | "archived" | null }`,
  kèm test. Rule ghi rõ nó phản chiếu gate nào trong `task.go`.
- `AssigneeOption` thêm `disabledReason?: string` (chuỗi đã dịch). Hàng có lý do:
  `aria-disabled="true"`, không chọn được bằng chuột, Enter hay khi gõ tìm rồi Enter;
  điều hướng phím bỏ qua hàng đó; tooltip hiện lý do. Agent đang được giao vẫn hiện
  dấu ✓ để người dùng thấy giá trị hiện tại.
- Picker vẫn liệt kê agent paused/archived có trong danh sách workspace (để thấy và
  hiểu vì sao không chọn được), không ẩn đi.

## 4. Chấm trạng thái trên avatar

- `ActorAvatar` (`packages/ui/components/common/actor-avatar.tsx`) thêm prop
  `status?: { tone: "success" | "warning" | "muted"; label: string }`. Chấm tròn ở
  góc dưới phải, viền `ring-background`, màu `bg-success-solid` /
  `bg-warning-solid` / `bg-muted-foreground`; `label` là `aria-label` của chấm
  (`role="img"`). `packages/ui` không biết "online" hay "paused" nghĩa là gì.
- Nguồn trạng thái, quyết định trong `packages/views`:
  - Thành viên: `success` + "Đang trực tuyến" khi presence của chat
    (`selectIsUserOnline`) báo online; không có chấm khi offline (presence không
    phân biệt offline với chưa biết).
  - Agent: `active` → `success` "Đang hoạt động"; `paused` → `warning` "Tạm dừng";
    `archived` → `muted` "Đã lưu trữ".
- Chấm hiện ở hàng trong picker và ở avatar trên nút kích hoạt khi đã có người phụ trách.
- Token màu dùng lại slot đã khai báo ở cả `:root` và `.dark`.

## 5. Kế hoạch triển khai (sub-issue)

1. Backend tần suất + client + sắp xếp (mục 2).
2. Quyền giao agent, backend + frontend (mục 3).
3. Chấm trạng thái (mục 4).

Mỗi phần viết test trước, rồi code. Kiểm tra hẹp khi làm: `make test-go` (hoặc
`go test` của package), vitest của core/views/ui, `pnpm typecheck`, `pnpm lint`,
`pnpm knip`, `node --test scripts/task-api-route-catalogue.test.mjs`.

## 6. Rủi ro

- `changes` là `TEXT`; ép `::jsonb` sẽ lỗi nếu có dòng không phải JSON. Mọi dòng do
  `audit.Recorder` ghi bằng `json.Marshal`, nên chấp nhận; nếu gặp lỗi thật thì
  endpoint trả 500 và picker giữ thứ tự cũ.
- Presence chỉ có khi `WorkspaceChatPresence` được mount (luôn có trong shell). Màn
  hình ngoài shell không có chấm thành viên, không sai lệch gì khác.
