# Họp: nâng cấp chuyển động và phản hồi — kế hoạch triển khai

> **Trạng thái:** in-progress · UniAI UNI-2285

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bảy màn Họp (A–G) chuyển động và phản hồi đúng như clip đề xuất đã duyệt, kèm ba thay đổi dữ liệu phía máy chủ mà các màn đó cần.

**Architecture:** Task 0 chốt hợp đồng ở `packages/core` (trường mới của schema, hàm endpoint, hook) để bốn nhánh làm song song trong worktree riêng:
- **BE:** Task 1–3, gồm `server/**`.
- **FE-trước:** Task 4–6, gồm danh sách, sắp họp, tạo cuộc họp.
- **FE-phòng:** Task 7–8, gồm phòng chờ, trong phòng.
- **FE-sau:** Task 9–10, gồm tóm tắt, giao việc.

Chuyển động dùng `motion/react` và `NumberFlow`, kèm token `--ease-settle` / `--ease-out-quart`. Không thêm thư viện. Task 11 quay lại clip trên app thật để so với clip đề xuất; Task 12–13 gồm review, PR và CI.

**Tech Stack:** Next.js + React 19, TanStack Query, motion 12, @number-flow/react, Base UI, sonner, i18next; Go (Chi, sqlc, pgx), Anthropic qua `ai.Gateway`.

**Spec:** `docs/superpowers/specs/2026-10-29-meeting-craft-motion-design.md` · Bảng: https://claude.ai/artifact/2zFbSW2t7znSJqCkSXRFBU · Clip nguồn: `.superpowers/meeting-craft/shots/<A-list|B-upcoming|C-create|D-prejoin|E-room|F-summary|G-assign>.mp4`, mã patch DOM của clip: `.superpowers/meeting-craft/tools/demos/*.inject.js` (đọc để lấy giá trị, không chép nguyên).

## Global Constraints

**Phong cách và nội dung**
- Chỉ dùng token màu và cỡ chữ (`text-caption`, `bg-surface`, `text-muted-foreground`, `--tint-violet`…); không dùng hex, trừ gradient sẵn có của ScribeMark.
- Mọi chữ JSX qua `t()`. Khoá mới đặt dưới `meetings.motion.<list|upcoming|create|prejoin|room|summary|assign>.*`, thêm vào `packages/core/i18n/locales/vi.json` và `en.json` cùng lúc. Dùng lại khoá cũ khi đã có chữ giống hệt.
- Thư ký UNI dùng `ScribeMark` / `ScribeGlyph` (`@uniwork/ui/brand/scribe-mark`), không dùng `Sparkles`. Mặt người dùng `AvatarStack` / `MeetingPersonAvatar` sẵn có: mặt không chồng lên nhau, cách 2 px.

**Chuyển động**
- Mọi hiệu ứng tắt khi `prefers-reduced-motion` (`useReducedMotion()` của motion, hoặc class `motion-reduce:`). Khi tắt, nội dung vẫn đủ và đúng.
- Đồng hồ và đếm ngược tính lại từ `Date.now()` mỗi nhịp; mỗi màn dùng một bộ đếm 1 giây chung, không mỗi dòng một `setInterval`.
- Số cuộn dùng `NumberFlow` từ `@uniwork/ui/components/ui/number-flow`. Không tự viết odometer.

**Giới hạn mã**
- `.tsx` / `.ts` tối đa 500 dòng. `meeting-detail/strip-rows.tsx` đang 477 dòng, nên phần mới của B nằm ở file riêng.
- Không cast JSON mạng; endpoint mới đi qua `parseWithFallback` và có ca malformed.

**Chạy test**
- Không chạy full suite cục bộ. Vitest chạy hẹp với `NODE_OPTIONS=--no-experimental-webstorage --coverage.enabled=false`; Go dùng `go test ./internal/... -run '<Tên>'` với `TEST_DATABASE_URL=postgres://uniwork:uniwork@localhost:5432/uniwork_test?sslmode=disable`.

**Commit**
- Commit dùng prefix quy ước (`feat(meetings)`, `test(meetings)`…). Trailer `Refs:` do hook tự thêm.

## Review Focus

1. **Giảm chuyển động.** Bật `prefers-reduced-motion` thì không còn vòng lặp nào (vệt sáng, tia quét, viền sáng, chấm mic), và số hiện thẳng giá trị cuối. Test: Task 4 và Task 9 mock `useReducedMotion → true`, assert không có phần tử `[data-motion-loop]`.
2. **Tab ngủ rồi mở lại.** Đồng hồ đã họp và đếm ngược phải nhảy đúng giờ thật, không chạy tiếp từ số cũ. Test ở Task 4 và Task 5: `vi.setSystemTime` +10 phút rồi advance 1 s, assert chữ hiện đúng giờ mới.
3. **Danh sách nhiều cuộc họp đang diễn ra.** Chỉ có một bộ đếm 1 giây cho cả danh sách, và `refetchInterval` chỉ bật khi có dòng `IN_PROGRESS`. Test ở Task 4.
4. **Hoàn tác khi task đã bị sửa hoặc xoá ở nơi khác.** Máy chủ bỏ qua việc đó, client chỉ mở lại các hàng có trong `restored` và không báo lỗi. Test ở Task 3 (Go) và Task 10 (vitest).
5. **Tóm tắt cũ, không có `summary_points`.** Hiện đoạn văn thường, không có số nguồn. Tải trang thì không chạy hiệu ứng hiện dần. Test ở Task 9.

---

### Task 0: Hợp đồng ở `packages/core` (làm trước, trên nhánh chính)

**Files:**
- Modify: `packages/core/types/meeting.ts`. Thêm vào `MeetingSchema`: `in_room_user_ids`, `in_room_count`, `scribe_live`. Thêm vào `MeetingSummarySchema`: `summary_points`.
- Modify: `packages/core/api/endpoints/meeting-action-items.ts`. Thêm `undoConvertMeetingActionItems`.
- Modify: `packages/core/meetings/action-item-hooks.ts`. Thêm `useUndoConvertActionItems`.
- Test: `packages/core/api/endpoints/meetings.test.ts`, `meeting-summary.test.ts`, `meeting-action-items.test.ts`.

**Interfaces (Produces):**
- `Meeting.in_room_user_ids?: string[]`, `Meeting.in_room_count?: number`, `Meeting.scribe_live?: boolean`. Mỗi trường dùng `.optional().catch(undefined)`.
- `MeetingSummary.summary_points?: MeetingSummaryDecision[]`, dạng `{ text, evidence }[]`, dùng `SummaryDecisionsSchema.catch([]).optional()`.
- `undoConvertMeetingActionItems(meetingId: string, actionItemIds: string[]): Promise<string[] | null>`. Đây là `POST /api/v1/meetings/{id}/action-items/undo-convert`, body `{ action_item_ids }`, trả `restored`; trả `null` khi không đọc được câu trả lời.
- `useUndoConvertActionItems(workspaceId: string, meetingId: string)` (mutation nhận `string[]`), `onSettled` invalidate đúng các khoá mà convert invalidate.

- [ ] Viết test malformed cho ba thay đổi trên: trường sai kiểu đọc thành `undefined` / `[]`, và câu trả lời rác của undo thành `null`.
- [ ] Thêm schema, hàm, hook; chạy ba file test; commit `feat(meetings): contracts for room presence, summary points and undo-convert`.

### Task 1 (BE): Danh sách có người trong phòng

**Files:** `server/pkg/db/queries/meetings.sql` (`ListMeetingsByWorkspaceFiltered`), `server/pkg/db/generated/*` (chạy `make sqlc`), `server/internal/service/meeting*.go` (kiểu dòng của `ListFiltered`), `server/internal/handler/dto/sdo/meeting.go` (`MeetingListItemDTO`), `server/internal/handler/meeting.go:82`.

**Interfaces:**
- Produces JSON trên mỗi dòng: `"in_room_user_ids": [...]` (≤ 3, `user_id` không rỗng, sắp theo `min(joined_at)`), `"in_room_count": n`, `"scribe_live": bool`. Ba trường đều `omitempty`, và chỉ có giá trị khi `status = 'IN_PROGRESS'`.
- Lấy từ `meeting_attendance_sessions` có `left_at IS NULL`, nối với `meeting_participants`. `scribe_live` lấy từ lần chạy Thư ký UNI mới nhất có trạng thái `ACTIVE` (bảng mà `scribe_status` của trang chi tiết đang đọc).

- [ ] Test Go `TestListMeetingsCarriesWhoIsInTheRoom`. Họp IN_PROGRESS có 2 thành viên và 1 khách đang trong phòng, cộng 1 người đã rời, thì dòng có `InRoomUserIDs` = 2 id theo thứ tự vào và `InRoomCount` = 3. Một họp `SCHEDULED` thì cả hai rỗng.
- [ ] Sửa SQL (LATERAL subquery chỉ chạy khi `status = 'IN_PROGRESS'`), chạy `make sqlc`, map sang DTO. Thêm `description` / `example` cho tag SDO.
- [ ] Chạy test hẹp; commit `feat(meetings): list rows carry who is in the room`.

### Task 2 (BE): `meeting_summary@8` với `summary_points`

**Files:** `server/migrations/999<unix-ms>_meeting_summary_points.{up,down}.sql`, `server/internal/ai/prompts.go` (`PromptMeetingSummary = "meeting_summary@8"`), `server/internal/ai/prompts_meeting.go`, `server/internal/ai/citations.go` (kết quả và `clean*`), nơi lưu và đọc `meeting_summaries` (queries + service + SDO `MeetingSummary`).

**Interfaces:**
- Kết quả mô hình có `SummaryPoints []Decision` với tag `json:"summary_points,omitempty"`. Làm sạch bằng `cleanPoints` với tối đa 6 câu, mỗi câu tối đa 300 rune. Nếu còn ≥ 1 câu thì `Summary = strings.Join(texts, " ")`.
- Cột `summary_points TEXT NOT NULL DEFAULT '[]'`, đọc và ghi như `open_questions`. Câu trả lời API có `summary_points`, các tham chiếu theo đúng dạng của `decisions`.
- Lời nhắc yêu cầu 2–6 câu, mỗi câu kèm 1–3 nhãn lời thoại có trong đầu vào. Lời nhắc của phần ghép (`meeting_summary_part@1` → final) cũng tạo `summary_points`.

- [ ] Test `TestSummaryPointsJoinIntoTheSummary`: 3 câu thành một đoạn ghép bằng dấu cách, và tham chiếu không có trong đầu vào bị bỏ (giống `Decisions`). Test `TestSummaryWithoutPointsKeepsTheModelSummary`. Cập nhật các test đang ghim `@7`.
- [ ] Migration (một câu `ALTER TABLE … ADD COLUMN IF NOT EXISTS`), sqlc, lưu và đọc, SDO.
- [ ] Chạy `go test ./internal/ai/... ./migrations/...` hẹp theo tên; commit `feat(meetings): summary sentences with their sources (meeting_summary@8)`.

### Task 3 (BE): Hoàn tác giao việc

**Files:** `server/internal/service/meeting_action_items.go` (`UndoConvertActionItems`), `server/internal/handler/meeting_action_items*.go` + `router/` (`apiOp`, SDI/SDO), `server/internal/service/audit_coverage_test.go`, `server/internal/handler/isolation_matrix_test.go` (`isoReferences` cho `action_item_ids`), `docs/api-sdi-sdo.md` nếu checklist yêu cầu.

**Interfaces:**
- `func (s *MeetingService) UndoConvertActionItems(ctx context.Context, userID, meetingID string, itemIDs []string) ([]string, error)`. Hàm trả danh sách id đã được đưa về chờ giao.
- Cổng kiểm tra giống `ConvertActionItems`. Mỗi việc chỉ được hoàn tác khi đủ cả bốn điều kiện:
  - đã được giao thành task bởi chính `userID`;
  - được giao trong 2 phút gần nhất (hằng `undoConvertWindow = 2 * time.Minute`);
  - task còn tồn tại;
  - task chưa được sửa sau khi tạo (`updated_at = created_at` hoặc revision đầu).
- Thứ tự xử lý trong một transaction: xoá task qua lệnh xoá task sẵn có (có audit và sự kiện), gỡ liên kết, đưa việc về `pending`, rồi `audit.Recorder.Record` một dòng `meeting.action_items_unconverted` kèm outbox như convert.
- Route `POST /api/v1/meetings/{meetingID}/action-items/undo-convert`. SDI `{ action_item_ids: string[] }` (tối đa 50); SDO `{ restored: string[] }`.

- [ ] Test Go `TestUndoConvertRestoresOnlyFreshUntouchedItemsOfTheCaller`, với bốn việc lần lượt là: của mình còn mới; của mình đã quá 2 phút; task đã bị sửa; do người khác giao. Kết quả `restored` chỉ có việc đầu, task của việc đó đã bị xoá, việc trở về pending. Thêm `TestUndoConvertNeedsTheConvertGate`.
- [ ] Thêm lệnh, route, audit coverage, isolation reference; chạy các test theo tên (gồm `TestIsolationMatrix -run` route mới nếu cách cô lập cho phép); commit `feat(meetings): undo a fresh action-item conversion`.

### Task 4 (FE-trước): A · Danh sách

**Files:**
- `packages/views/meetings/meeting-filters.tsx`: nền trượt.
- `packages/views/meetings/meeting-list.tsx`: dòng hiện lần lượt, số cuộn, refetch 30 s khi có dòng live.
- Tạo `packages/views/meetings/meeting-list-live.tsx`: `LiveRowFaces`, `ElapsedClock`, và vệt sáng của thanh.
- Test: `meeting-list-view.test.tsx`, `meeting-filters.test.tsx`.

**Interfaces:**
- Consumes `Meeting.in_room_user_ids`, `in_room_count`, `scribe_live` (Task 0).
- `ElapsedClock({ since: string; now: number })` hiện `mm:ss`, hoặc `h:mm:ss` khi từ 1 giờ trở lên, với `aria-label` = `t("meetings.motion.list.elapsed", { time })`.
- Danh sách dùng một hook `useNowTick(active: boolean)` (1 giây, đặt cạnh danh sách) cho mọi dòng.

**Thông số:**
- Nền trượt dùng `motion.span layoutId="meeting-status-pill"` nằm trong nút đang chọn. Trông như nút đang chọn hiện nay (`bg-surface`, viền, `--surface-shadow`); khung chứa `bg-muted rounded-[10px] p-[3px]`.
- Dòng hiện lần lượt theo bảng của spec, chỉ chạy khi khoá bộ lọc đổi (trạng thái, tìm kiếm, trang).
- Dòng live:
  - `AvatarStack` của tối đa 3 thành viên, nếu `scribe_live` thì thêm `ScribeMark size={20} state="live"`;
  - đồng hồ đã họp tính từ `actual_start_at ?? starts_at`;
  - thanh `bg-success` có vệt sáng (`data-motion-loop`, 2,4 s);
  - `in_room_count` > số mặt hiện thì hiện "+n".

- [ ] Test:
  - `pressed filter carries the sliding pill`: chỉ nút đang chọn có `[data-slot=status-pill]`.
  - `live row shows who is in the room and the elapsed clock`: fixture có `in_room_user_ids` 2 id, `scribe_live` true, bắt đầu 11 phút 8 giây trước; assert 2 mặt, nhãn Thư ký UNI và chữ `11:08`.
  - `elapsed clock survives a sleeping tab`: sau `vi.setSystemTime(+10 phút)` và advance 1 s thì hiện `21:09`.
  - `refetches only while a row is live`.
  - `reduced motion leaves no loops`.
- [ ] Làm, chạy test hẹp, commit `feat(meetings): list filter pill, staggered rows and live row presence`.

### Task 5 (FE-trước): B · Sắp họp

**Files:**
- Tạo `packages/views/meetings/meeting-detail/scheduled/start-countdown.tsx`: `StartCountdown` (vòng + số cuộn) và `RsvpFaces`.
- Sửa `meeting-detail/strip-rows.tsx` (`StartRow`) để dùng hai thành phần này. Không làm file vượt 500 dòng.
- Test: `meeting-detail/scheduled/start-countdown.test.tsx`.

**Thông số:**
- **Vòng đếm ngược**
  - Chỉ hiện khi `0 < startsAt - now ≤ 60 phút`; ngoài khoảng đó giữ dòng chữ cũ.
  - Vòng 28 px, nét 3: nền `muted`, phần còn lại `primary`. Tỉ lệ còn lại = `(startsAt - now) / 60 phút`, ghi vào `data-progress` (0–1, làm tròn 3 chữ số).
  - Số `mm:ss` dùng `NumberFlow`, cỡ `text-title`. Dòng phụ là `t("meetings.motion.upcoming.startsAt", { time })`.
- **RSVP**
  - Người được mời hiện bằng mặt (cỡ 24 px): chưa trả lời thì `opacity-45` và viền đứt; đã nhận lời thì đủ màu.
  - Khi một người chuyển sang nhận lời: badge ✓ bật 360 ms rồi mờ đi sau 900 ms, và mặt người đó lên đầu (`layout`).
  - Chip "N chờ" có icon đồng hồ, số dùng `NumberFlow`.
- **Nút Bắt đầu họp**: khi `due` (đã có, `SOON_MS` 15 phút) thì thêm class `border-beam` và quầng `shadow` brand; khi giảm chuyển động thì chỉ giữ quầng.

- [ ] Test:
  - `ring empties with the time left`: còn 30 phút thì `data-progress="0.5"`, chữ `30:00`.
  - `countdown jumps right after sleep`.
  - `an accepted face moves to the front and the waiting count drops`: rerender với invitation đổi trạng thái, assert thứ tự và chữ "1 chờ".
  - `start button glows only when due`.
- [ ] Làm, test, commit `feat(meetings): upcoming countdown ring and live RSVP faces`.

### Task 6 (FE-trước): C · Tạo cuộc họp

**Files:** `meeting-venue-picker.tsx`, `meeting-sheet/people-field.tsx`, `meeting-sheet/person-role-row.tsx`, `meeting-sheet/sheet-footer.tsx`. Test: `meeting-sheet/meeting-sheet.test.tsx` và một file test mới `meeting-venue-picker.test.tsx`.

**Thông số:**
- **Chọn hình thức**: một khung chọn `motion.span layoutId="meeting-venue-frame"` (ring 2 px `primary`) và dấu ✓ bật lên.
- **Người được mời**: hàng mới vào thì cao dần và mờ dần, nhích lên 6 px, 260 ms; ảnh đại diện bật lên. Số trong "N người · gồm bạn" dùng `NumberFlow`.
- **Nút Tạo cuộc họp**
  - Khi mutation pending: nút co về hình tròn 36 px trong 300 ms (settle) và có vòng quay; `aria-busy`, nhãn đọc `t("meetings.motion.create.creating")`.
  - Khi thành công: vòng chuyển màu success, vẽ ✓ trong 300 ms và giữ 600 ms rồi mới chạy tiếp như hiện nay (đóng sheet hoặc mở trang).
  - Khi lỗi: nút trở lại như cũ.
  - Trạng thái lấy từ mutation thật, không giả lập.

- [ ] Test:
  - `venue frame follows the chosen card`.
  - `submit morphs while pending and shows the check on success`: dùng mock transport đang chờ, assert `aria-busy`; resolve thì có `[data-state=done]`.
  - `submit returns to its label on error`.
- [ ] Làm, test, commit `feat(meetings): create sheet venue frame, people pop-in and submit morph`.

### Task 7 (FE-phòng): D · Phòng chờ

**Files:** `meeting-room-mic-check.tsx`, `meeting-scribe-notice.tsx`, `meeting-prejoin.tsx`, cùng các test cạnh chúng.

**Thông số:**
- **Mic**: 5 chấm 6 px nằm trong ô chọn mic, sát mép phải. Chiều cao mỗi chấm theo mức âm hiện có (0–1) với hệ số theo vị trí `[.6,.85,1,.85,.6]`. Có `role="meter"` với `aria-valuenow` và nhãn `meetings.motion.prejoin.micLevel`. Bỏ thanh mức âm cũ.
- **Thông báo Thư ký UNI**: thêm prop `variant: "chip" | "full"` cho `meeting-scribe-notice`.
  - Phòng chờ của thành viên dùng `chip`: `ScribeMark` 16 px, chữ `t("meetings.motion.prejoin.scribeChip")`, và nút ? mở `Popover` (`openOnHover`, bấm và bàn phím cũng mở) chứa đoạn đầy đủ như cũ.
  - Lobby và link khách giữ `full`.
- **Nút Vào phòng họp**: khi đang vào thì co thành tròn kèm vòng quay (300 ms), `aria-busy`. Không thêm thời gian chờ.

- [ ] Test:
  - `mic dots follow the level`: level 0.5 thì `aria-valuenow=50`.
  - `member prejoin shows the scribe chip and the full text behind ?`.
  - `guest lobby keeps the full notice`.
  - `join button is busy while joining`.
- [ ] Làm, test, commit `feat(meetings): prejoin mic dots, scribe chip and join morph`.

### Task 8 (FE-phòng): E · Trong phòng

**Files:** `use-meeting-signals.tsx`, `meeting-join-request-notice.tsx` / `use-pending-join-requests.ts`, `meeting-control-bar.tsx`, `meeting-stage-header.tsx` (`meeting-remaining-time`). Có thể tạo `meeting-stage-toasts.tsx`.

**Thông số:**
- **Thông báo trong phòng**
  - Một chồng thẻ ở góc dưới bên trái sân khấu, nằm trên thanh tên ô video.
  - Thẻ mới nhất đứng trước. Thẻ thứ 2 và 3 có scale .94 / .88, nhích lên −8 / −16 px, độ mờ .7 / .4. Hiện tối đa 3 thẻ.
  - Rê chuột hoặc focus thì cả chồng xòe thành danh sách cách nhau 8 px.
  - Thẻ tự tắt sau 5 s và dừng đếm khi rê chuột. Riêng thẻ khách xin vào ở lại tới khi được xử lý và có nút `t("meetings.motion.room.admit")`, gọi đúng hành động cho vào hiện có.
  - Mỗi loại có badge riêng: vào phòng (✓ success), rời (mặt mờ), giơ tay (`Hand`), xin vào (`DoorOpen`).
  - Dùng sonner nếu đặt được toaster riêng trong khung sân khấu; không được thì tự làm, miễn đúng các thông số trên.
- **Tooltip thanh điều khiển**: nút đầu tiên trễ 300 ms. Trong cùng provider, sang nút khác thì tooltip hiện ngay và trượt vị trí 150 ms ease-out-quart.
- **Thời gian còn lại**: giờ, phút, giây dùng `NumberFlow` (`format` 2 chữ số).

- [ ] Test:
  - `stage toasts stack newest first and cap at three`.
  - `knock toast stays and admits`: bấm Cho vào thì gọi hàm cho vào với đúng id.
  - `hovering the stack pauses dismissal`.
  - `remaining time renders through NumberFlow`.
- [ ] Làm, test, commit `feat(meetings): stacked room notices, gliding control tooltips, rolling time`.

### Task 9 (FE-sau): F · Tóm tắt

**Files:** `meeting-detail/overview/overview-summary.tsx` (tách `summary-composing.tsx`, `summary-points.tsx` nếu cần), `evidence-chip.tsx` (dùng lại popover). Test: `meeting-detail/overview/overview-summary.test.tsx` (tạo mới nếu chưa có).

**Interfaces:** Consumes `MeetingSummary.summary_points` (Task 0) và trạng thái chạy `MeetingSummaryRun` sẵn có.

**Thông số:**
- **Khi đang soạn** (run `running` hoặc `queued`): thẻ gồm
  - `ScribeMark state="composing"` và nhãn `t("meetings.motion.summary.composing")` có class `ai-shimmer`;
  - tổng số câu lời thoại, cuộn từ 0 lên bằng `NumberFlow`;
  - 5 câu lời thoại cuối (giờ · mặt · chữ), có tia sáng tím quét từ trên xuống, 2,4 s, `data-motion-loop`;
  - câu nào được mục Thư ký UNI ghi trong phòng trích làm căn cứ thì tô lần lượt.
- **Hiện dần từng chữ**: chỉ khi trong phiên này ta đã thấy trạng thái soạn và sau đó tóm tắt mới xuất hiện. Tải trang có sẵn tóm tắt thì hiện ngay.
- **Số nguồn**: khi có `summary_points`, mỗi câu có số `1..n` dạng badge tròn 16 px tông brand.
  - Rê chuột, focus hoặc chạm vào số thì câu đó tô nền nhạt, và popover hiện các đoạn lời thoại được trích (mặt, tên, giờ, lời nói) như popover căn cứ hiện có.
  - Không có `summary_points` thì hiện đoạn văn như cũ.

- [ ] Test:
  - `composing card sweeps the last five lines`.
  - `summary reveals word by word only after composing in this session`: render ở trạng thái running, rerender có summary thì thấy `[data-reveal]`; render thẳng có summary thì không có.
  - `points carry numbered sources and open the cited lines`.
  - `old summary without points renders as one paragraph`.
  - `reduced motion leaves no loops`.
- [ ] Làm, test, commit `feat(meetings): visible summary composing, word reveal and per-sentence sources`.

### Task 10 (FE-sau): G · Giao việc

**Files:** `meeting-detail/close-out/selection-bar.tsx` (thanh nổi), `action-item-row.tsx` (checkbox bật, ✓ và gập), `action-items-board.tsx` (số cuộn, nhóm xong), `use-close-out.ts` (lưu id vừa giao để hoàn tác), `review-sheet.tsx` (giữ nguyên luồng). Test: `action-items-board.test.tsx`, `use-close-out.test.ts`.

**Interfaces:** Consumes `useUndoConvertActionItems(workspaceId, meetingId)` và `undoConvertMeetingActionItems` (Task 0).

**Thông số:**
- **Thanh nổi**: cố định ở đáy cột nội dung, căn giữa, nhích lên 12 px và mờ dần trong 260 ms.
  - Nội dung gồm: `NumberFlow` số việc kèm `t("meetings.motion.assign.selected")`; mặt các người phụ trách đã chọn; nút Đổi người và Đặt hạn (hành động sẵn có của thanh cũ); Bỏ chọn; nút chính mở hộp Xem lại như hiện nay.
- **Sau khi giao thành công** (không làm trước khi máy chủ trả lời):
  - mỗi hàng đã giao vẽ ✓ trong 300 ms rồi gập lại (320 ms);
  - mọi số đếm cuộn;
  - thanh nổi thay bằng `✓ t("meetings.motion.assign.done", { count })` cùng nút Hoàn tác có vòng đếm 8 s.
- **Hoàn tác** gọi `useUndoConvertActionItems` với các id vừa giao. Hàng có trong `restored` mở lại; các hàng còn lại vẫn đã giao; không báo lỗi khi chỉ hoàn tác được một phần. Hết 8 s thì thanh biến mất.
- **Nhóm giao hết**: tiêu đề nhóm vẽ ✓ kèm `t("meetings.motion.assign.groupDone")`.

- [ ] Test:
  - `selecting rows raises the dock with a rolling count`.
  - `rows fold only after the conversion succeeds`.
  - `undo restores only the returned rows`: mock trả 1 trong 2 id.
  - `undo bar leaves after eight seconds`.
  - `fully assigned group shows its check`.
- [ ] Làm, test, commit `feat(meetings): floating assign dock, fold with undo, group done`.

### Task 11: So với clip đề xuất

- [ ] Gộp 4 nhánh vào nhánh chính. Xung đột thường chỉ ở `vi.json` / `en.json`: giữ đủ khoá của cả hai bên.
- [ ] Chạy `make start`. Với mỗi màn A–G, quay clip thật bằng `.superpowers/meeting-craft/tools/rec.mjs` (inject rỗng) theo đúng kịch bản của demo. Đặt cạnh clip đề xuất và ghi chỗ lệch; sửa đến khi khớp.
- [ ] Chụp chế độ tối và khổ 390 px cho A, B, F, G.

### Task 12: Một vòng ponytail review

- [ ] Chạy `ponytail:ponytail-review` trên toàn bộ diff của nhánh. Sửa mọi mục "phải sửa" và "nên sửa", mỗi nhóm một commit, rồi chạy lại test hẹp.

### Task 13: PR và CI

- [ ] Chạy `make issue-pr KEY=UNI-2285`. Thân PR gồm: link bảng, bảy màn, ba thay đổi backend, những gì đã bỏ qua (full suite: CI), và clip trước/sau.
- [ ] Theo dõi `gh pr checks` tới khi xanh. Đỏ thì đọc log, sửa, push, lặp lại. Đổi `Trạng thái` của spec và kế hoạch thành `shipped` khi PR merge.
