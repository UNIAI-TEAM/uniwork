# Đợt 2 (UNI-1997): task hiện "Từ cuộc họp" — kế hoạch triển khai

> **Trạng thái:** in-progress — kế hoạch ngày 2026-10-20, triển khai trên nhánh `feature/UNI-1997-meetings-sau-hop-dot-2-task-hien-tu-cuoc`.

**Mục tiêu:** đóng G2 của spec `2026-10-20-meeting-follow-through-design.md` (§9.1, §9.4,
§12 dòng 2). Cột `tasks.origin_type`/`origin_id` (migration 107) đã có và đã được ghi
(tóm tắt cuộc họp → `meeting`, chat → `chat_message`, email → `email_thread`) nhưng chưa ra
API hay UI.

## Tệp

- `server/internal/handler/dto/sdo/task.go` — `TaskDTO` thêm `origin_type`, `origin_id`
  (con trỏ, `omitempty`, có `description`/`example`).
- `server/internal/handler/task.go` — `fillLegacyTaskDTOFields` điền hai trường; mọi đường
  ra `TaskDTO` (chi tiết, danh sách, query, table rows, home) đi qua hàm này.
- `server/internal/handler/task_dto_test.go` — test hai trường có/không có.
- `packages/core/types/task.ts` — `TaskSchema` thêm `origin_type`, `origin_id`
  (`nullish().catch(undefined)`: giá trị hỏng chỉ mất dòng nguồn gốc, không mất task).
- `packages/core/api/endpoints/tasks.test.ts` — ca phản hồi sai định dạng cho hai trường.
- `packages/views/tasks/detail/components/task-detail-context-line.tsx` — thêm mục
  "Từ cuộc họp: {tên} · {ngày}" (`useMeeting`, `paths.workspace(..).meeting(id)`, icon
  `MODULE_ICONS.meetings`); đọc lỗi → "Cuộc họp không còn"; chỉ khi `origin_type === "meeting"`.
- `packages/core/i18n/locales/vi.json` rồi `en.json` — `tasks.detail.from_meeting`,
  `tasks.detail.meeting_gone`.

## Việc và test chứng minh

1. Go: `TestTaskDTOCarriesOrigin` (đỏ → xanh), `go test ./internal/handler/ -run TestTaskDTO`.
2. Core: test schema giữ `origin_*` và bỏ qua giá trị sai kiểu (đỏ → xanh).
3. Views: `task-detail-context-line.test.tsx` — hiện tên + ngày + liên kết; cuộc họp lỗi →
   "Cuộc họp không còn"; `origin_type` khác → không hiện, không gọi API cuộc họp.

## Quyết định

- Không thêm `origin_*` vào `CreateTask` SDI: nguồn gốc chỉ do server đặt (tóm tắt, chat,
  email), client không được tự khai.
- Ngày hiển thị theo `formatMeetingDay(meetingDayKey(starts_at))` có sẵn ở
  `views/meetings/meeting-datetime.ts`.
