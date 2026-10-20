# Đợt 3 (UNI-1998): bảng việc sau họp — kế hoạch triển khai

> **Trạng thái:** in-progress — kế hoạch ngày 2026-10-20, triển khai trên nhánh `feature/UNI-1998-meetings-sau-hop-dot-3-bang-viec-sau-hop` (xếp trên UNI-1997 → UNI-1996).

**Mục tiêu:** Việc đề xuất thành bảng `meeting_action_items` có id ổn định, sống theo cuộc họp. Clerk (chủ trì, thư ký, admin) tóm tắt, thêm tay, bỏ qua, khôi phục và giao việc. Tạo lại tóm tắt chỉ thay việc AI đang chờ; việc đã giao, đã bỏ qua, việc tay, việc `LIVE` giữ nguyên. Spec: `docs/superpowers/specs/2026-10-20-meeting-follow-through-design.md` §5.1, §6.1–6.3, §7.1, §8.1–8.2, §9.1–9.3, §13.1 đợt 3.

## Tệp

- Migration `999…_meeting_action_items` (bảng + chuyển dữ liệu cũ, một file một transaction ngầm) và hai file index `CONCURRENTLY`; query `server/pkg/db/queries/meeting_action_items.sql`.
- Service: `meeting_action_items.go` (thay `meeting_summary_tasks.go`: đọc, thêm, bỏ qua, khôi phục, giao), `meeting_summarize.go` (`storeSummary` thay việc AI đang chờ), `meeting_ai.go` (`Summarize` dùng `requireMeetingClerk`, gửi việc đã có vào prompt).
- AI: `meeting_summary@4` trong `internal/ai/prompts.go`, golden `meeting_summary_v4.golden`.
- Audit/sự kiện: 4 action mới (bỏ `meeting_summary.tasks_created`), topic `action_item.created|dismissed|restored|converted` (bỏ `summary.tasks_linked`) ở ba catalogue.
- API: `GET/POST /meetings/{meetingID}/action-items`, `…/{actionItemID}/dismiss`, `…/restore`, `…/action-items/convert`; xoá `POST /summary/tasks`; `GET /summary` thôi trả việc. SDI/SDO, `pathParamSDI` cho `{actionItemID}`, ma trận cô lập.
- Core: `api/endpoints/meeting-action-items.ts` + test sai định dạng; hook `meetings/action-item-hooks.ts`, key `meetingKeys.actionItems(id)`; realtime.
- Views: `meetings/meeting-action-items/*` (mục "Việc sau họp", bản gọn cho copilot); bỏ việc khỏi `MeetingSummaryPanel`.

## Việc và test chứng minh

1. Migration + chuyển dữ liệu — `TestMeetingActionItemsBackfill` (bản mới nhất 3 việc/1 đã giao + bản cũ 1 việc đã giao → 4 việc; liên kết cũ nhất trỏ task đã xoá → lấy task còn sống; liên kết bản cũ tới task đã xoá → không sinh việc). Lint migration, `TestEveryQueryNamesItsTenant`.
2. Tạo lại tóm tắt — `TestStoreSummaryKeepsHandledItems` (đã giao, đã bỏ qua, tay còn nguyên; AI chờ bị thay; trùng tiêu đề việc đã bỏ qua không quay lại; việc có task đã xoá bị thay; metadata audit).
3. Giao — `TestConvertActionItems*` (409 `action_item_not_pending` đủ id; trùng task đang mở → 409 có `action_item_ids`; 20 goroutine → 1 task; đua với lưu tóm tắt; thư ký được, thành viên thường 403).
4. Thêm/bỏ qua/khôi phục — `TestActionItemLifecycle`.
5. Prompt `@4` — `TestPromptSnapshots`, `TestMeetingSummaryInjectionNeutralized`.
6. Audit + sự kiện — `audit_coverage_test.go`, `node --test scripts/events-catalogue.test.mjs`.
7. API — `TestIsolationMatrix`, `TestEveryBodyIDFieldHasAReferenceCase`, test handler.
8. Core — `meeting-action-items.test.ts` (sai định dạng), hook test, realtime test.
9. Views — `meeting-action-items-section.test.tsx` (ba nhóm, chip đếm, giao, bỏ qua có lý do, khôi phục, thêm, chỉ đọc khi không phải clerk).

## Quyết định

- Route cũ `POST /summary/tasks` xoá ngay (web và server cùng nhánh).
- Không xoá `meeting_summary_task_links` (đợt 4 chép bù rồi xoá); đợt này chỉ ngừng ghi.
- Quyền clerk phía client dùng `useMeetingClerk` có sẵn (đọc participants) thay vì thêm vào `useMeetingPermissions`.
- Thông báo khi giao do rule `task.created` của đợt 1 lo; không thêm rule riêng.
