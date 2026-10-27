# Rời phòng và kết thúc họp — kế hoạch triển khai

> **Trạng thái:** in-progress · UniAI UNI-2230

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi cách rời phòng họp có một màn riêng đúng canvas đã chốt (A–H, điện thoại, logo), chủ trì rời có hộp thoại 3 lựa chọn, kết thúc dẫn tới thẻ "Việc sau họp".

**Architecture:** `MeetingRoomView` giữ một trạng thái `exit: RoomExit | null`; khi khác null, phòng LiveKit gỡ ra và màn rời (thư mục mới `packages/views/meetings/exit/`) thế chỗ ngay trong route phòng. "Vào lại" xoá `exit`, gọi lại join với thiết bị lúc rời. Server thêm ba trường cho danh sách người tham dự, một trường cho resolve link mời và một route đếm đánh giá. Thẻ "Việc sau họp" là một khối mới của trang chi tiết, dùng lại job `closeOut` hiện có.

**Tech Stack:** Next.js + React 19, TanStack Query, LiveKit components, Base UI primitives (`packages/ui`), i18next; Go (Chi, sqlc, Prometheus).

**Spec:** `docs/superpowers/specs/2026-10-27-meeting-post-leave-design.md` · Canvas: https://claude.ai/artifact/4pQbz5G8Vyhri6qhkRrBbf (bảng nguồn ở `.superpowers/post-leave-redesign/canvas/project/*.dc.html`)

## Global Constraints

- Copy tiếng Việt lấy nguyên văn từ bảng canvas; khoá i18n dưới `meetings.exit.*`, `meetings.hostLeave.*`, `meetings.closeOut.*`; thêm vào `vi.json` trước, `en.json` cùng khoá (test parity ở `packages/core`).
- Màu, cỡ chữ chỉ dùng token (`bg-meeting-stage`, `text-meeting-bar-muted-foreground`, `bg-brand-subtle`, `text-caption`, `text-title-lg`…), không hex; icon Lucide tên chuẩn, `size-3/3.5/4/5/6`, không `strokeWidth`; loading dùng `<Spinner />` hoặc `LogoLoader`.
- Logo chỉ qua `<Logo>` / `LogoLoader` của `@uniwork/ui/brand`: màn tối `variant="lockup" size={20}`, trang khách `variant="lockup" size={28}` + `variant="mark" size={14}` ở chân trang, điện thoại `variant="mark" size={18}`.
- Màn tối (A–F) bọc trong `className="dark"` như popup của phòng họp; trang khách (G/H) theo theme hệ thống.
- Nút ≥ 44px trên coarse pointer (dùng `Button`), mọi chữ JSX qua `t()`, file `.tsx` ≤ 500 dòng.
- Endpoint mới: hàm trong `packages/core/api/endpoints/meetings.ts` + `parseWithFallback` + ca malformed trong `meetings.test.ts`.
- Route mới đăng ký qua wrapper `api` với `apiOp{sdi, sdo}`; không đụng `decode` ngoài `handler/json.go`.
- Không full test suite cục bộ; chạy test hẹp từng task, `make check` chạy ở CI.
- Node 25 cục bộ: vitest chạy với `NODE_OPTIONS=--no-experimental-webstorage`.

## Review Focus

1. **Rời rồi vào lại không được hiện màn lỗi kết nối.** Gỡ `LiveKitRoom` bắn `onDisconnected(CLIENT_INITIATED)`; nhánh hiện tại đặt `mediaErrorKind="connection"`. Test ở Task 4: rời → Vào lại → thấy phòng, không thấy `meetings.mediaErrorTitle`.
2. **Bị mời ra / kết thúc khi đang ở màn rời.** Màn rời không còn LiveKit nên không nghe `ROOM_DELETED`; màn A phải tự đổi sang D khi `meeting.status` thành `ENDED` (realtime `meeting.ended` đã invalidate detail). Test ở Task 4.
3. **Khách quay lại bằng Vào lại mà phiên khách đã hết hạn.** Join trả 401/403 → màn lobby lỗi hiện có, không treo spinner. Test ở Task 9.
4. **Mạng chậm khi bấm Kết thúc cho mọi người.** LogoLoader phủ phòng tới khi server trả lời; lỗi thì gỡ lớp phủ, toast lỗi, vẫn ở trong phòng. Test ở Task 8.
5. **Chuyển quyền từ màn B cho người vừa rời phòng.** Server trả 409 `invalid_host_transferee`; màn B báo lỗi và làm mới danh sách, không chuyển sang C. Test ở Task 6.

---

### Task 1 (UNI-2231): Chốt phần đã làm (hộp thoại chủ trì, chuyển quyền trong phòng, toast, chip)

**Files:** đã có trên nhánh — `meeting-host-leave-dialog.tsx`, `meeting-host-presence.tsx`, `meeting-host-handover.ts` (+ test), sửa `meeting-control-bar.tsx`, `meeting-conference.tsx`, `meeting-stage-header.tsx`, `meeting-room-people-tab.tsx`, `vi.json`, `en.json`, spec, plan.

- [ ] **Step 1:** `cd packages/views && NODE_OPTIONS=--no-experimental-webstorage npx vitest run meetings/meeting-host meetings/meeting-control-bar meetings/meeting-room-people meetings/meeting-stage-header meetings/meeting-conference --coverage.enabled=false` → PASS.
- [ ] **Step 2:** `pnpm --filter @uniwork/views exec tsc --noEmit -p .` và eslint các file trên → sạch.
- [ ] **Step 3:** Commit `feat(meetings): host leave dialog, in-room host transfer and host presence` (thân: ba lựa chọn, toast, chip; bỏ qua: tự chuyển quyền khi mất kết nối).

### Task 2 (UNI-2232): Server — người tham dự `in_room`, `removed_by`, `removed_at`; resolve `started_at`

**Files:**
- Modify: `server/internal/handler/dto/sdo/meeting.go` (`ParticipantDTO`, `PublicInviteLinkSDO`)
- Modify: `server/internal/handler/meeting_control.go` (`toParticipantDTO`, `listParticipants`, resolve handler ~dòng 192)
- Modify: `server/internal/service/meeting_participants.go`
- Modify: `packages/core/types/meeting.ts` (`ParticipantSchema`), `packages/core/api/endpoints/meetings.ts` (`PublicInviteLinkSchema`)
- Test: `server/internal/service/meeting_participant_access_test.go`, `server/internal/handler/meeting_control_test.go` (tạo nếu chưa có), `packages/core/api/endpoints/meetings.test.ts`

**Interfaces:**
- Produces (Go): `func (s *MeetingService) ListParticipantsInRoom(ctx context.Context, userID, guestID, meetingID string) ([]db.MeetingParticipant, map[string]bool, error)` — cùng cổng `authorizeActiveParticipant`, map `participant_id → in_room` từ `q.AttendanceSessionTotals`.
- Produces (JSON): participant `in_room: bool`, `removed_by?: string` (user id), `removed_at?: string` (RFC 3339); resolve `started_at?: string` (`meetings.actual_start_at`, chỉ khi có).
- Produces (TS): `ParticipantSchema` thêm `in_room: z.boolean().catch(false)`, `removed_by: z.string().optional()`, `removed_at: z.string().optional()`; `PublicInviteLinkSchema` thêm `started_at: z.string().optional()`.

- [ ] **Step 1: Test Go thất bại** — `TestListParticipantsInRoomMarksOpenSessions`: tạo meeting, 2 người tham dự, mở phiên điểm danh cho người A (đã có helper mở phiên trong `meeting_attendance_test.go`), gọi `ListParticipantsInRoom` → `inRoom[A]==true`, `inRoom[B]==false`; khách không thuộc cuộc họp gọi → `ErrForbidden`.
- [ ] **Step 2:** `cd server && go test ./internal/service -run TestListParticipantsInRoom -count=1` → FAIL (undefined).
- [ ] **Step 3:** Viết `ListParticipantsInRoom`; `toParticipantDTO(p, redact, inRoom bool)` điền `InRoom`, `RemovedBy` (`p.RemovedBy.String`), `RemovedAt` (`p.RemovedAt.Time.UTC().Format(time.RFC3339)` khi `Valid`); khách (`redact==true`) không nhận `RemovedBy`. `listParticipants` gọi hàm mới. Các nơi khác gọi `toParticipantDTO` truyền `false`. Resolve điền `StartedAt` khi `m.ActualStartAt.Valid`. Thẻ `description`/`example` cho trường mới (docs/api-sdi-sdo.md).
- [ ] **Step 4:** Test handler `TestListParticipantsCarriesPresenceAndRemoval`: JSON có `in_room` cho người đang trong phòng, `removed_by`/`removed_at` cho dòng đã gỡ khi người gọi là thành viên, không có `removed_by` khi người gọi là khách.
- [ ] **Step 5:** `go test ./internal/service ./internal/handler -run 'TestListParticipantsInRoom|TestListParticipantsCarriesPresenceAndRemoval|TestIsolationMatrix' -count=1` → PASS.
- [ ] **Step 6: TS** — ca malformed trong `meetings.test.ts`: participant thiếu `in_room` → `false`; `started_at` sai kiểu → resolve vẫn trả link với `started_at` undefined. `pnpm --filter @uniwork/core exec vitest run api/endpoints/meetings.test.ts` → PASS.
- [ ] **Step 7:** Commit `feat(meetings): participants carry in_room and removal, invite resolve carries started_at`.

### Task 3 (UNI-2233): Server + core — đánh giá cuộc gọi

**Files:**
- Modify: `server/internal/metrics/meetings.go` (+ nơi `MustRegister` các metric meetings)
- Modify: `server/internal/service/meeting.go` (interface `MeetingMetrics`), tạo `server/internal/service/meeting_call_rating.go`
- Modify: `server/internal/handler/dto/sdi/meeting.go`, tạo `server/internal/handler/meeting_call_rating.go`
- Modify: `server/internal/handler/router/routes.go`, `router/meetings.go`, `handler/router.go`
- Modify: `packages/core/api/endpoints/meetings.ts`, tạo `packages/core/meetings/call-rating-hooks.ts`, export từ `packages/core/meetings/index.ts`
- Test: `server/internal/service/meeting_call_rating_test.go`, `server/internal/handler/meeting_call_rating_test.go`, `packages/core/api/endpoints/meetings.test.ts`

**Interfaces:**
- Produces (Go): metric `uniwork_meeting_call_ratings_total{rating="good|ok|poor"}`; `func (m *Meetings) IncCallRating(rating string)`; `MeetingMetrics` thêm `IncCallRating(string)`; `func (s *MeetingService) RateCall(ctx context.Context, userID, guestID, meetingID, rating string) error` (cổng `authorizeActiveParticipant`, rating ngoài ba giá trị → `Invalid("đánh giá không hợp lệ")`).
- Produces (HTTP): `POST /api/v1/meetings/{meetingID}/call-rating`, SDI `RateCallSDI{Rating string json:"rating" example:"good"}`, SDO `sdo.StatusSDO`; apiOp và `joinLimit` y như `AppendChatMessage` (thành viên hoặc khách đang hoạt động).
- Produces (TS): `rateCall(meetingId: string, rating: CallRating): Promise<void>`, `type CallRating = "good" | "ok" | "poor"`, hook `useRateCall(meetingId: string)` (mutation, không invalidate gì).

- [ ] **Step 1:** Test Go `TestRateCallCountsOnlyKnownRatings`: thành viên `good` → counter `good` = 1; `"great"` → lỗi `invalid`, counter không đổi; người ngoài tổ chức → `ErrForbidden`/`ErrNotFound` (dùng fake metrics ghi lại lời gọi).
- [ ] **Step 2:** `go test ./internal/service -run TestRateCall -count=1` → FAIL.
- [ ] **Step 3:** Viết metric, interface, service, handler, route, SDI. Route có `{meetingID}` nên `TestIsolationMatrix` tự phủ; control của chủ tổ chức phải 200 với body ví dụ.
- [ ] **Step 4:** `go test ./internal/service ./internal/handler ./internal/handler/router -run 'TestRateCall|TestIsolationMatrix|TestEveryBodyIDFieldHasAReferenceCase|Openapi' -count=1` → PASS; `go vet ./...` sạch.
- [ ] **Step 5:** TS: `rateCall` + ca malformed (server trả `{}` → không ném). Test PASS.
- [ ] **Step 6:** Commit `feat(meetings): count call-quality ratings`.

### Task 4 (UNI-2234): Khung màn rời + trạng thái `exit` trong phòng + màn A

**Files:**
- Create: `packages/views/meetings/exit/exit-model.ts` (+ `.test.ts`)
- Create: `packages/views/meetings/exit/exit-shell.tsx`, `exit-presence-card.tsx`, `exit-rating.tsx`, `use-room-presence.ts`, `exit-left.tsx`, `meeting-exit-screen.tsx`
- Modify: `packages/views/meetings/room-view.tsx`, `meeting-conference.tsx`, `meeting-control-bar.tsx`, `meeting-host-leave-dialog.tsx`
- Modify: `packages/core/meetings/hooks.ts` (`useParticipants(meetingId, opts?: { refetchInterval?: number })`)
- Test: `packages/views/meetings/exit/meeting-exit-screen.test.tsx`, `packages/views/meetings/room-view-exit.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type ExitMedia = { audio: boolean; video: boolean };
  export type RoomExit =
    | { kind: "left"; media: ExitMedia }
    | { kind: "leftHost"; media: ExitMedia }
    | { kind: "handedOver"; media: ExitMedia; toUserId: string; toName: string }
    | { kind: "ended"; at: string }
    | { kind: "removed"; at: string };
  export function participantIdFromToken(token: string | undefined): string | null; // JWT `sub` bỏ tiền tố uw_participant_
  ```
- `MeetingConference` / `MeetingControlBar`: `onLeave: () => void` đổi thành `onExit: (exit: RoomExit) => void` và thêm `onEndForAll: () => void`. Thanh điều khiển gửi `{kind:"left", media:{audio: mic.enabled, video: camera.enabled}}`; hộp thoại chủ trì gửi `leftHost` / `handedOver` (sau khi `TransferHost` thành công) và gọi `onEndForAll` cho lựa chọn kết thúc (hộp thoại không tự gọi `End` nữa).
- `MeetingRoomView` thêm prop `onEnded?: () => void`; giữ `onLeave` = "Về trang cuộc họp".
- `useRoomPresence(meetingId: string, opts: { enabled: boolean; selfParticipantId: string | null }): { people: MeetingParticipant[]; loading: boolean }` — `useParticipants` với `refetchInterval: 15_000`, lọc `in_room && id !== self`.
- `<ExitShell tone="dark"|"light" header={{ backLabel, onBack, dateLine }} guest?>` — header có logo theo Global Constraints; `<ExitPresenceCard people startedAt>` (mặt tối đa 4 + "+n", đồng hồ `mm:ss` chạy mỗi giây); `<ExitRating meetingId compact?>` (3 nút Tốt/Tạm/Kém; bấm một lần, sau đó thay bằng "Cảm ơn bạn" và khoá).
- `<MeetingExitScreen exit meeting workspaceId guestMode meetingsHref onRejoin onBackToMeeting onEndForAll onExitChange/>` chọn biến thể A/B/C/D/F; `onExitChange(exit: RoomExit)` để màn tự chuyển (A → D khi kết thúc, B → C khi chuyển quyền). B, C ở Task 5, D ở Task 6, F ở Task 7; task này dựng A, các nhánh khác render A tạm.
- Hộp thoại chủ trì: bỏ toast "Đã chuyển quyền…" (màn C đã nói); sửa `meeting-host-leave-dialog.test.tsx`: ca kết thúc kiểm `onEndForAll` được gọi và không có `POST /end`, ca chuyển quyền kiểm `onExit({kind:"handedOver", toUserId:"u-minh", …})`.

- [ ] **Step 1: Test thất bại** (`room-view-exit.test.tsx`, mock LiveKit như `meeting-control-bar.test.tsx`): (a) `rời → thấy "Bạn đã rời phòng", nút "Vào lại", chip "Mic bật"/"Camera tắt" đúng trạng thái lúc rời`; (b) `Vào lại → join được gọi lại với audio/video lúc rời, không qua prejoin, không hiện màn lỗi kết nối` (Review Focus 1); (c) `đang ở màn A mà meeting.status thành ENDED → màn hiện "Cuộc họp đã kết thúc"` (Review Focus 2); (d) `Về trang cuộc họp gọi onLeave`.
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** `exit-model.ts` + test `participantIdFromToken` (token hỏng → null).
- [ ] **Step 4:** `room-view.tsx`: state `exit`; `exitRef` để `onDisconnected` bỏ qua mọi lý do khi đang rời; `closedReason` ended/removed → `setExit({kind, at: new Date().toISOString()})` (canceled giữ màn cũ); `rejoin()` = cập nhật `choice` với `media`, `setExit(null)`, `retryJoin()`; màn rời render trước `LiveKitRoom` nên phòng được gỡ. Màn A tự chuyển sang D khi `meeting?.status === "ENDED"`.
- [ ] **Step 5:** Dựng `ExitShell`, `ExitPresenceCard`, `ExitRating`, `ExitLeft` theo bảng `Main.dc.html`: dấu tròn 72px `bg-surface-hover` + `LogOut`, tiêu đề `text-display-sm` (32px) Plus Jakarta, dòng tên cuộc họp, thẻ người còn trong phòng, hàng nút (Vào lại `variant="default"` 48px + `Video`; Về trang cuộc họp `outline`), chip thiết bị, gạch ngăn, đánh giá. Điện thoại (< 600px, `useIsMobile`): theo `PhoneLeft.dc.html` — nút xếp dọc ở đáy, đánh giá icon 44px, logo dấu 18px góc phải.
- [ ] **Step 6:** Khoá i18n `meetings.exit.left.*`, `meetings.exit.presence_*` (`_one/_other`), `meetings.exit.rate.*`, `meetings.exit.media.*`; chạy test → PASS; chạy lại test các file đã sửa ở Task 1 → PASS.
- [ ] **Step 7:** Commit `feat(meetings): stay on a leave screen with rejoin instead of leaving the room route`.

### Task 5 (UNI-2235): Màn B (chủ trì chỉ rời) và C (đã chuyển quyền)

**Files:**
- Create: `packages/views/meetings/exit/exit-host-left.tsx`, `exit-handed-over.tsx`, `exit-handover-picker.tsx`
- Modify: `meeting-exit-screen.tsx`
- Test: `packages/views/meetings/exit/exit-host-left.test.tsx`

**Interfaces:**
- Consumes: `usePendingJoinRequests`, `useJoinRequestActions(meetingId).admitAll`, `useRecordings`, `useStopRecording`, `useTransferHost`, `handoverCandidates` (Task 1), `useRoomPresence` (Task 4).
- Produces: `<ExitHostLeft …>` và `<ExitHandedOver toUserId toName …>`; picker trả `onPicked(userId, name)`; chuyển quyền thành công → `onExitChange({kind:"handedOver", …})` (prop mới của `MeetingExitScreen`: `onExitChange(exit: RoomExit)`).

- [ ] **Step 1: Test thất bại:** (a) có 2 yêu cầu PENDING + bản ghi ACTIVE → thấy "Đang chờ bạn", "2 người xin vào", "Đang ghi hình"; "Cho vào" gọi approve cho cả 2; "Dừng ghi" gọi `/recording/stop`; (b) không có gì chờ → không có thẻ; (c) "Chuyển quyền…" → chọn Minh → `POST /host-transfer {new_host_user_id:"u-minh"}` → tiêu đề "Võ Minh đang chủ trì"; (d) server 409 → toast lỗi, vẫn ở B, danh sách được tải lại (Review Focus 5); (e) "Kết thúc cho mọi người" gọi `onEndForAll`.
- [ ] **Step 2:** FAIL → **Step 3:** dựng theo `LeftHost.dc.html` và `Handover.dc.html` (chip "Bạn vẫn là chủ trì" `bg-brand-subtle`; thẻ chờ viền/tiêu đề `warning-soft`; hai mặt nối mũi tên, mặt người nhận 72px vòng `ring-primary`, huy hiệu `Crown` 28px; chip "Vào lại với vai người tham dự"). → **Step 4:** PASS → **Step 5:** Commit `feat(meetings): host leave screens with what waits and handover`.

### Task 6 (UNI-2236): Màn D (đã kết thúc) cho thành viên, bản điện thoại

**Files:**
- Create: `packages/views/meetings/exit/exit-ended.tsx`, `exit-ended-model.ts` (+ `.test.ts`)
- Modify: `meeting-exit-screen.tsx`
- Test: `packages/views/meetings/exit/exit-ended.test.tsx`

**Interfaces:**
- Produces: `endedFacts(input: { meeting: Meeting; activity: MeetingActivityItem[]; attendance: MeetingAttendance | undefined; recordings: MeetingRecording[]; actionItems: MeetingActionItem[]; summary: MeetingSummary | null | undefined; viewerId: string }): { endedBy: { kind: "person"; userId: string } | { kind: "auto" } | null; endedAt: string | null; durationMinutes: number | null; present: number | null; recording: { seconds: number; processing: boolean } | null; counts: { decision: number; task: number; question: number }; mine: { id: string; title: string; due: string | null }[] }`.
  - `endedBy`: dòng `MEETING_ENDED` mới nhất → `person` theo `actor_id`; `MEETING_AUTO_ENDED` → `auto`.
  - `counts` = `countFeed(buildMeetingFeed({ actionItems, summary, notes: [], transcript: [], recordings: [] }))`.
  - `mine`: item `PENDING|CONVERTED` có `task?.assignee_id ?? suggested_assignee_id` = viewer; `due` = `task?.due_date ?? suggested_due_date`.
- Chip thông báo: `useNotificationPreferences()`; loại `meeting_summary_ready` nếu người xem là clerk, ngược lại `meeting_recap_ready`; hiện khi không có dòng cho loại đó (mặc định bật) hoặc có ít nhất một kênh `true`.

- [ ] **Step 1: Test model thất bại** — 5 ca: kết thúc bởi người, tự kết thúc, chưa có nhật ký → `null`; đếm loại; `mine` chỉ việc của người xem.
- [ ] **Step 2:** FAIL → **Step 3:** viết `endedFacts` → PASS.
- [ ] **Step 4: Test màn thất bại:** "Demo UniChat kết thúc lúc 16:21"; "41 phút", "6 người", "38:12"; "Thư ký UNI đang soạn biên bản" khi run `running`; chip "Báo tôi khi xong" ẩn khi cả ba kênh `false`; "Việc của bạn" có 2 dòng; "Xem trang cuộc họp" → `onBackToMeeting`; "Về danh sách cuộc họp" → `meetingsHref`.
- [ ] **Step 5:** Dựng theo `Ended.dc.html` (dấu `CalendarCheck` `bg-success-soft`, 3 ô số liệu grid, thẻ Thư ký UNI `ScribeMark` + thanh shimmer, chấm loại dùng `FeedKindMark`, danh sách việc ô vuông `border-primary`) và `PhoneEnded.dc.html` cho < 600px. → PASS.
- [ ] **Step 6:** Commit `feat(meetings): ended screen with who ended, recap and your items`.

### Task 7 (UNI-2237): Màn F (bị mời ra)

**Files:** Create `packages/views/meetings/exit/exit-removed.tsx` (+ test); Modify `meeting-exit-screen.tsx`.

**Interfaces:** Consumes `useParticipants` (Task 2 `removed_by`, `removed_at`), `participantIdFromToken` (Task 4), `useResolveDMRoom(workspaceId)`, `paths.workspace(org, ws).chatConversation(roomId)`, `useMemberIndex`.

- [ ] **Step 1: Test thất bại:** thành viên: dòng của mình có `removed_by: "u-host"`, `removed_at` → "Demo UniChat · 15:52", chip "Không vào lại được"; "Nhắn cho chủ trì" gọi resolve DM với `u-host` rồi điều hướng tới `chatConversation(roomId)`; khách: không có tên, không có nút nhắn, giờ = `exit.at`.
- [ ] **Step 2:** FAIL → **Step 3:** dựng theo `Removed.dc.html` (dấu `UserX` `bg-destructive-soft`, chip `Lock`) → PASS → **Step 4:** Commit `feat(meetings): removed screen says who and when`.

### Task 8 (UNI-2238): E — LogoLoader khi kết thúc và thẻ "Việc sau họp"

**Files:**
- Modify: `packages/views/meetings/room-view.tsx` (state `ending`, `endForAll()`), `apps/web/app/[orgSlug]/[workspaceSlug]/meetings/[meetingId]/room/page.tsx` (`onEnded={() => replace(ws.meeting(meetingId) + "?ended=1")}`)
- Create: `packages/views/meetings/meeting-detail/just-ended-card.tsx` (+ test)
- Modify: `packages/views/meetings/meeting-detail/detail-body.tsx` (hoặc nơi render `StripJobRow`: hiện card thay dải khi `ended=1` và job là `closeOut`)

**Interfaces:**
- `endForAll()`: `ending=true` → `<LogoLoader fullScreen label={t("meetings.exit.ending")} className="fixed inset-0 z-50" />` phủ phòng; `useEndMeeting(workspaceId).mutateAsync(meetingId)` → thành công `onEnded()`; lỗi `ending=false` + `toastApiError`.
- `<MeetingJustEndedCard job={Extract<StripJob,{kind:"closeOut"}>} handlers={StripHandlers} />` — 5 bước theo `EndedHost.dc.html`: Chốt điểm danh (`useMeetingAttendance` + `useFinalizeAttendance`), Biên bản (`job.drafting` → shimmer tím; `job.minutes`), Giao n việc (`job.pending`; drafting → "có sau khi soạn xong"; nút mở review như `CloseOutRow`), Lên lịch họp tiếp (`ScheduleFollowUpButton` khi `job.canFollowUp`), Bản ghi (`useRecordings`). Tiêu đề "Đã kết thúc cho mọi người", phụ đề "Còn {{count}} việc để khép lại buổi họp" (đếm bước chưa xong).

- [ ] **Step 1: Test thất bại:** (a) room-view: bấm kết thúc → thấy `role=status` của LogoLoader; server 500 → lớp phủ biến mất, toast lỗi, phòng còn (Review Focus 4); thành công → `onEnded` được gọi; (b) card: 5 bước, "Chốt" gọi finalize, "Còn 3 việc…" với dữ liệu mẫu; không có `?ended=1` → dải cũ.
- [ ] **Step 2:** FAIL → **Step 3:** viết → PASS → **Step 4:** Commit `feat(meetings): end for everyone lands on the close-out card`.

### Task 9 (UNI-2239): G/H — màn rời và kết thúc cho khách

**Files:**
- Create: `packages/views/meetings/exit/exit-guest.tsx` (+ test), `use-guest-tally.ts`
- Modify: `meeting-exit-screen.tsx`, `room-view.tsx` (đặt `<GuestTally/>` trong `LiveKitRoom` khi `guestMode`), `apps/web/app/invite/meeting/[linkId]/room/page.tsx`

**Interfaces:**
- `useGuestTally(): { ref: MutableRefObject<{ connectedMs: number; since: number | null; seen: Set<string> }> }`; `<GuestTally tally={ref}/>` dùng `useParticipants` của LiveKit (người thật, `humanParticipants`) cộng dồn.
- G: `resolveInviteLink(linkId, secret)` một lần khi vào màn (lấy `started_at`); "Vào lại" = `rejoin`; "Đổi tên hoặc thiết bị" = `leaveMeetingInvite(nav, linkId)` (form đã tự điền tên từ sessionStorage); chân trang "Họp bằng [mark 14px] UniWork · Dùng cho đội của bạn" → `paths.register()`.
- H: "Cảm ơn bạn đã tham gia", "Cuộc họp đã kết thúc lúc HH:mm · {title}", ô "{n} phút / bạn ở trong phòng" và "{n} người / cùng họp", đánh giá, thẻ "Họp, ghi biên bản và giao việc trong một chỗ" + "Dùng thử UniWork" → `paths.register()`. **Không** có dòng biên bản (quyết định 1).

- [ ] **Step 1: Test thất bại:** G có lockup (`aria-label="UniWork"`), "5 người vẫn đang họp", "Nguyễn An" trên chip tên; Vào lại join lại không qua form; phiên khách hết hạn (join 401) → màn lobby lỗi, không spinner treo (Review Focus 3); H hiện "32 phút" từ tally giả, không có chữ "Biên bản".
- [ ] **Step 2:** FAIL → **Step 3:** dựng theo `GuestLeft.dc.html`, `GuestEnded.dc.html` → PASS → **Step 4:** Commit `feat(meetings): guest leave and end screens keep the name and thank the guest`.

### Task 10 (UNI-2240): Đối chiếu canvas trên app thật

**Files:** không sửa mã trừ lỗi tìm thấy; script chụp ở `.superpowers/post-leave-redesign/` (`current-shots.mjs`, `host-leave-shot.mjs` làm mẫu).

- [ ] **Step 1:** `make start`; dựng dữ liệu (cuộc họp instant Demo chủ trì, mời minh/lan/ha, link khách AUTO_ADMIT).
- [ ] **Step 2:** Chụp A, B, C, D, E, F, G, H ở 1440×900 sáng và tối, A và D ở 390×844; đặt cạnh ảnh bảng canvas tương ứng (đọc `.dc.html` trong backup), ghi từng chỗ lệch.
- [ ] **Step 3:** Sửa lệch, chụp lại tới khi khớp; khi app đang chạy, `cd e2e && npx playwright test meetings.spec.ts meetings-livekit.spec.ts` → PASS (không đổi spec e2e có sẵn).
- [ ] **Step 4:** Bình luận `[agent]` vào UNI-2230 kèm đường dẫn ảnh; commit sửa lệch `fix(meetings): match leave screens to the canvas`.

### Task 11 (UNI-2241): Kiểm cuối và PR

- [ ] **Step 1:** `pnpm --filter @uniwork/views exec tsc --noEmit -p .`, `pnpm --filter @uniwork/core exec tsc --noEmit -p .`, eslint các file đã đổi, `node --test scripts/lucide-aliases.test.mjs scripts/events-catalogue.test.mjs`, `cd server && go test ./internal/... -run 'Meeting|Isolation|Arch|Openapi' -count=1`.
- [ ] **Step 2:** Plan và spec đổi `Trạng thái` sang `shipped` khi merge (không trước).
- [ ] **Step 3:** `make issue-pr KEY=UNI-2230` (PR `UNI-2230: …`, thân có ảnh trước/sau và danh sách quyết định).
