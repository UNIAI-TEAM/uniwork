# UNI-774 — Task có khung giờ trên Calendar

> **Trạng thái:** shipped

## Hành trình

Hành trình được rút ra từ lỗi Calendar: khi người dùng kéo một khoảng giờ ở chế độ Ngày, Tuần làm việc hoặc Tuần rồi chọn tạo công việc, công việc phải giữ đúng khoảng giờ đó và nằm trong time grid thay vì trở thành sự kiện cả ngày. Sau khi tạo, người dùng có thể kéo task sang giờ khác, resize để đổi thời lượng và kéo lên hàng cả ngày mà lịch vẫn được lưu đúng.

## Bằng chứng

| Bảo đảm | Test hoặc lệnh | Loại | Kết quả |
| --- | --- | --- | --- |
| Slot có giờ mang cả ngày cục bộ lẫn `start_at` và `due_at` chính xác | `packages/views/calendar/slot-prefill.test.ts` | Unit | RED chỉ trả `due_date`; GREEN 5/5 |
| Mở form tạo task không làm mất khoảng giờ vừa kéo | `packages/views/calendar/create-from-slot.test.tsx` | Component | GREEN 9/9 cùng slot-prefill |
| Task có khoảng giờ được chuẩn hóa thành `allDay: false` | `packages/core/calendar/normalize.test.ts` | Unit | RED trả sự kiện cả ngày; GREEN 6/6 |
| HTTP create task lưu và trả lại hai timestamp | `TestCreateTaskHTTPAcceptsWorkManagementContext` | Integration | GREEN |
| Calendar service trả khoảng giờ RFC3339 đã lưu | `TestCalendarListEventsInRange` | Integration | RED compile vì thiếu field; GREEN |
| Tạo task làm mới query Calendar | `packages/core/tasks/hooks.test.tsx` | Hook integration | RED cache còn hợp lệ; GREEN |
| Migration 209 tuân thủ quy tắc migration | `go test ./migrations -run 'Test.*(Migration\|Actor\|Organization\|Index\|Foreign\|Reference)' -count=1` | Contract | GREEN |
| Kéo hoặc resize task có giờ tạo patch đủ ngày và timestamp | `packages/views/calendar/calendar-drop-patch.test.ts`, `fullcalendar-host.test.tsx` | Unit + component | RED mapper trả null và UI revert; GREEN 30/30 |
| Kéo task có giờ lên hàng cả ngày xóa timestamp cũ | `packages/views/calendar/calendar-drop-patch.test.ts` | Unit | GREEN |
| PATCH task lưu, xóa và kiểm tra cặp `start_at` / `due_at` | `TestPatchTaskHTTPScheduleTimes` | HTTP integration | RED giữ timestamp cũ; GREEN |
| Cập nhật timeline không mở rộng realtime patch ngoài ADR 0015 | `TestRealtimePatchCarriesOnlyAWholeChange` | Service integration | GREEN, sự kiện ids-only để refetch |

## Coverage

- Views slot/create: 96.96% statements, 83.33% branches, 100% functions, 96.96% lines.
- Core Calendar normalization: 100% statements, 81.25% branches, 100% functions, 100% lines.
- Views drag/resize (`calendar-drop-patch.ts`, `fullcalendar-host.tsx`): 91.74% statements, 85.54% branches, 100% functions, 91.5% lines.

## Checkpoint

- RED: `aec6320a test(calendar): reproduce timed task slots`.
- RED refresh contract: `badd75cf test(calendar): require task create to refresh planner`.
- GREEN create/display: `0c589307 fix(calendar): preserve task time ranges`.
- RED drag/resize: `612481c7 test(calendar): reproduce timed task drag and resize`.
- GREEN drag/resize: commit `fix(calendar)` chứa báo cáo này.
