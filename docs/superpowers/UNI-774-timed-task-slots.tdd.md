# UNI-774 — Task có khung giờ trên Calendar

> **Trạng thái:** shipped

## Hành trình

Hành trình được rút ra từ lỗi Calendar: khi người dùng kéo một khoảng giờ ở chế độ Ngày, Tuần làm việc hoặc Tuần rồi chọn tạo công việc, công việc phải giữ đúng khoảng giờ đó và nằm trong time grid thay vì trở thành sự kiện cả ngày.

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

## Coverage

- Views slot/create: 96.96% statements, 83.33% branches, 100% functions, 96.96% lines.
- Core Calendar normalization: 100% statements, 81.25% branches, 100% functions, 100% lines.

## Checkpoint

- RED: `aec6320a test(calendar): reproduce timed task slots`.
- RED refresh contract: `badd75cf test(calendar): require task create to refresh planner`.
- GREEN implementation: commit `fix(calendar)` tiếp theo.

## Ranh giới

Thay đổi này xử lý kéo để tạo và hiển thị lại ngay trên Calendar. Sửa giờ hoặc resize một task có giờ đã tồn tại vẫn là tương tác riêng vì contract PATCH task hiện chỉ hỗ trợ lịch ở cấp ngày.
