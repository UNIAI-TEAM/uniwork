# Đợt 4 (UNI-1999): việc còn tồn từ các cuộc họp trước — kế hoạch triển khai

> **Trạng thái:** in-progress — kế hoạch ngày 2026-10-20, nhánh `feature/UNI-1999-meetings-sau-hop-dot-4-viec-con-ton-tu-c` (xếp trên UNI-1998).

**Mục tiêu:** Cuộc họp có dự án thấy các việc đã giao mà task chưa xong từ những cuộc họp đã kết thúc trước nó cùng dự án (D8). Chép bù các liên kết cũ còn sót rồi xoá `meeting_summary_task_links`. Spec: `docs/superpowers/specs/2026-10-20-meeting-follow-through-design.md` §1.3 D8, §5.1 (đoạn cuối), §6.1, §6.5, §9.2 mục 2, §9.3, §13.1 đợt 4, §13.3.

## Tệp

- Migration `999…_meeting_action_items_catch_up` (chép bù, idempotent) và `999…_drop_meeting_summary_task_links` (xoá bảng; down dựng lại bảng rỗng). Xoá `queries/meeting_summary_task_links.sql` và code sinh; `LockMeetingSummaryChanges` chuyển sang `meeting_action_items.sql`.
- Query `ListCarriedOverActionItems` trong `meeting_action_items.sql`.
- Service `MeetingService.CarriedOverItems` (`meeting_action_items.go`), dùng lại định nghĩa "xong" (`task_closed`: nhóm trạng thái done/cancelled) và "quá hạn" của đợt 3.
- API `GET /meetings/{meetingID}/carried-over-items` (thành viên), SDO `MeetingCarriedOverItemsSDO`.
- Core: `getMeetingCarriedOverItems` + schema khoan dung + test sai định dạng; `useMeetingCarriedOverItems`, key `meetingKeys.carriedOver(id)`; realtime: `task.created|updated|deleted` làm mới.
- Views: `meeting-action-items/carried-over-section.tsx` (mục trên trang chi tiết, gom theo cuộc họp gốc; nhóm thu gọn trong Copilot).
- E2E `e2e/meetings-follow-through.spec.ts` (§13.3).

## Việc và test chứng minh

1. Chép bù — `TestMeetingActionItemsCatchUp` (migrations): liên kết sống chưa có việc mang `task_id` đó → việc chờ cùng chỗ nhận task, hoặc việc mới; liên kết tới task đã xoá bỏ qua; chạy hai lần không trùng. `TestMeetingActionItemsBackfill` vẫn xanh (dựng lại bảng cũ trong transaction).
2. Xoá bảng — lint migration, `TestTenantExportClassifiesEveryTenantTable`, ma trận cô lập (bỏ dòng `isoUnseeded`).
3. Việc còn tồn — `TestCarriedOverItems` (service): chỉ việc đã giao có task chưa xong, cùng dự án, từ cuộc họp `ENDED` khác bắt đầu trước (giờ thực tế, không thì lịch); không dự án → rỗng; workspace khác không lộ; sắp theo hạn, không hạn cuối.
4. API — `TestIsolationMatrix` (route mới tự phủ), test router/OpenAPI.
5. Core — `meeting-action-items.test.ts` (sai định dạng), realtime test.
6. Views — `carried-over-section.test.tsx` (gom theo cuộc họp, ẩn khi rỗng, bản gọn thu gọn).
7. E2E — `meetings-follow-through.spec.ts`, chạy trên app của worktree nếu dựng được.

## Quyết định

- "Xong" = nhóm trạng thái `done`/`cancelled`, như `task_closed` của đợt 3 và "việc đang mở" của home/my-work.
- Quá hạn tính theo múi giờ của cuộc họp đang xem.
- Chép bù: liên kết sống (task còn) mà chưa việc nào mang `task_id` → nếu việc AI cùng `(summary_id, position)` (id tất định của đợt 3) còn chờ và chưa bỏ qua thì gắn task vào nó (liên kết cũ nhất), còn lại thêm việc mới với id tất định theo id liên kết.
