# Họp trực tiếp không giấy — kế hoạch triển khai

> **Trạng thái:** in-progress — Task 1–13 xong trên nhánh `feature/UNI-2247-hop-truc-tiep-khong-giay-ghi-am-trong-ap` (UniAI UNI-2247, sub-issue của UNI-2153), chờ PR vào develop. Những gì triển khai chốt thêm ngoài kế hoạch ghi ở spec §11.

> **Cho agent thực hiện:** BẮT BUỘC dùng superpowers:subagent-driven-development (khuyên dùng) hoặc superpowers:executing-plans để làm từng task. Các bước dùng checkbox (`- [ ]`).

**Mục tiêu:** chọn hình thức Trực tiếp khi tạo cuộc họp, bấm "Bắt đầu ghi âm" là một máy trên bàn ghi cả phòng, bấm Kết thúc là bản ghi được gửi và Thư ký UNI soạn tóm tắt, việc đề xuất, biên bản; giao diện đúng 100% bộ màn đã chốt.

**Kiến trúc:** server thêm cột `meetings.venue` và các luật cho họp trực tiếp (không mở phòng, thư ký được ghi nhận đã họp, điểm danh mặc định có mặt, tóm tắt chờ đủ phần ghi). Trình duyệt ghi bằng `MediaRecorder`, lưu từng đoạn 5 giây vào IndexedDB (`packages/core/meetings/recorder/`), Kết thúc thì ghi nhận đã họp theo độ dài rồi gửi từng phần qua đường tải tệp có sẵn (`useUploadMeetingRecording`). Màn ghi dựng lại khung phòng họp (không cần LiveKit) và màn chờ vào phòng.

**Công nghệ:** Go (Chi, pgx, sqlc), Next.js App Router, React 19, TanStack Query, zod, Vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-meeting-in-person-recorder-design.md`. **Thiết kế đã chốt (2026-10-28):** https://claude.ai/artifact/1eikX52yAUgvv46c6Fwp6y — 13 bảng "Hiện tại → Đề xuất"; ảnh đề xuất và script dựng chúng ở `.superpowers/in-person-recorder/` (`shots/p*.png`, `tools/proposals.mjs`). Mỗi task giao diện so ảnh của mình trước khi xong.

## Global Constraints

- Giá trị hình thức: cột `venue TEXT NOT NULL DEFAULT 'online'`, CHECK `venue IN ('online','in_person')`; JSON `venue`; TS `type MeetingVenue = "online" | "in_person"`, `MEETING_VENUES`.
- Mọi điều khiển ghi âm (ô chọn Trực tiếp trong Họp ngay, nút Bắt đầu ghi âm) chỉ hiện khi capability `transcription === true` (spec D5). Không thêm cờ mới.
- Chữ trên màn hình lấy đúng từ bảng thiết kế (liệt kê trong từng task), qua `t()` với khoá ở cả `packages/core/i18n/locales/vi.json` và `en.json`; giọng văn theo `docs/conventions.md`.
- Icon lucide tên chuẩn (`Mic`, `MicOff`, `Video`, `UsersRound`, `Upload`, `CloudUpload`, `AudioLines`, `Pause`, `Play`, `Square`, `Check`, `Sun`, `WifiOff`, `UserPen`, `Settings`); không đặt `strokeWidth`.
- Màu chỉ qua token (`bg-tint-violet`, `text-tint-violet-foreground`, `bg-meeting-stage`, `text-warning`…); không mã màu cứng.
- File `.ts/.tsx` ≤ 500 dòng tính theo `max-lines`. `packages/core/meetings/hooks.ts` đã ~499: hook mới đặt file riêng.
- `packages/core`: không `localStorage`/`sessionStorage`/`react-dom`/`process.env`. IndexedDB được dùng như `packages/core/office/draft-session-key.ts`.
- Không thêm dependency. `fake-indexeddb` đã là devDependency của `packages/core`.
- Migration mới: tiền tố `9991793100000001`, có cả `.up.sql` và `.down.sql`, không FK.
- Mỗi endpoint đổi có ca phản hồi hỏng trong `packages/core/api/endpoints/meetings.test.ts`.
- Chạy test có chọn lọc (Go: `cd server && go test ./internal/service -run '<Tên>' -count=1`; TS: `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter <gói> exec vitest run <file>`). CI chạy bộ đầy đủ.
- Commit theo tiền tố `feat(meetings)`, `test(meetings)`, `fix(meetings)`; hook tự thêm `Refs: UNI-2247`.

## Review Focus

1. **Khoá màn hình hoặc rút micro giữa buổi** (iOS dừng thu khi khoá máy): phần đang ghi phải được đóng và giữ trên máy, màn hiện "Ghi âm bị ngắt", "Ghi tiếp" mở phần mới với độ lệch giây đúng giờ thật. → Task 5 (`recorder.test.ts`: "a track that ends closes the part and interrupts") và Task 9 (overlay).
2. **Mất mạng lúc gửi**: không mất byte nào, hộp thoại chuyển "Chờ mạng để gửi", có mạng lại (`online`) tự gửi tiếp và tệp được nhận lại phiên tải cũ (tên tệp và `lastModified` ổn định). → Task 6 ("waits offline and resumes on the online event", "rebuilds the same File key on retry").
3. **Đóng tab hoặc hết pin giữa buổi**: đoạn 5 giây cuối đã lưu; mở lại trang cuộc họp hiện "Còn bản ghi … chưa gửi" và gửi được. → Task 5 (đoạn lưu ngay khi `dataavailable`), Task 12 (dải chưa gửi), Task 13 (e2e tải lại trang).
4. **Hai máy cùng ghi một buổi**: máy kết thúc sau gặp cuộc họp đã `ENDED`, bỏ qua bước ghi nhận đã họp và vẫn gửi phần của mình. → Task 6 ("skips record-held when the meeting already ended" và "continues when record-held answers invalid_meeting_state").
5. **Đồng hồ máy lệch**: giờ đã họp tính ở server từ `duration_seconds`, giờ từng phần từ `offset_seconds`; không gửi giờ tuyệt đối của máy khách. → Task 2 (`TestRecordHeldNowUsesServerClock`), Task 3 (`TestRequestTranscriptionOffset`).

---

### Task 1: Server — cột `venue`, tạo/sửa cuộc họp, SDO

**Files:**
- Create: `server/migrations/9991793100000001_meetings_venue.up.sql`, `.down.sql`
- Modify: `server/pkg/db/queries/meetings.sql` (`CreateMeeting`, `UpdateMeeting`), rồi `make sqlc`
- Modify: `server/internal/service/meeting.go` (hằng số, `CreateMeetingInput`, `createScheduled` fingerprint/audit/diff), `server/internal/service/meeting_update.go` (`UpdateMeetingInput`, `meetingEditable`, diff), `server/internal/service/meeting_lifecycle.go` (lời gọi `CreateMeeting` truyền `MeetingVenueOnline`)
- Modify: `server/internal/handler/dto/sdi/meeting.go` (`CreateMeetingSDI`, `PatchMeetingSDI`), `server/internal/handler/dto/sdo/meeting.go` (`MeetingDTO`), `server/internal/handler/meeting.go` (`toMeetingDTO`, `createMeeting`, `updateMeeting`)
- Test: `server/internal/service/meeting_venue_test.go` (mới), `server/internal/handler/meeting_venue_test.go` (mới)

**Interfaces:**
- Produces: `service.MeetingVenueOnline = "online"`, `service.MeetingVenueInPerson = "in_person"`; `CreateMeetingInput.Venue string` ("" là online); `UpdateMeetingInput.Venue *string`; `db.Meeting.Venue string`; SDI `venue` (enum `online,in_person`); SDO `MeetingDTO.Venue string \`json:"venue"\``.

- [x] **Bước 1: Viết test hỏng** `TestMeetingVenue` trong `meeting_venue_test.go`, các ca con:
  - `default online`: `Create` không đặt `Venue` → `m.Venue == "online"`.
  - `in person stored`: `Venue: "in_person"` → `m.Venue == "in_person"`; diff của sự kiện `meeting.created` có `venue`.
  - `unknown refused`: `Venue: "hybrid"` → lỗi `Invalid` (422).
  - `idempotency`: cùng `IdempotencyKey`, khác `Venue` → `codedIs(err, "idempotency_payload_mismatch")`.
  - `update while scheduled`: `Update(..., UpdateMeetingInput{Venue: ptr("in_person")})` → đổi được, diff `meeting.updated` có `venue`.
  - `update after start refused`: cuộc họp `IN_PROGRESS` đổi venue → 422; `ENDED` → `invalid_meeting_state` như hiện nay.
- [x] **Bước 2: Chạy** `cd server && go test ./internal/service -run TestMeetingVenue -count=1` → FAIL (thiếu field).
- [x] **Bước 3: Migration** theo mẫu `9991792900000021_meeting_settings_scribe_policy.up.sql`: `ADD COLUMN IF NOT EXISTS venue TEXT NOT NULL DEFAULT 'online'`, `DROP CONSTRAINT IF EXISTS meetings_venue_check`, `ADD CONSTRAINT meetings_venue_check CHECK (venue IN ('online','in_person'))`; down: `DROP CONSTRAINT IF EXISTS`, `DROP COLUMN IF EXISTS venue`.
- [x] **Bước 4: Query + service.** `CreateMeeting` nhận thêm `venue` (cột cuối); `UpdateMeeting` thêm `venue = COALESCE(sqlc.narg(venue), venue)`; `make sqlc`. Trong `createScheduled`: chuẩn hoá `""`→online, từ chối giá trị khác; thêm venue vào cuối `IdempotencyFingerprint`, payload `MEETING_CREATED` (`{"meeting_type":…,"venue":…}`) và diff `meeting.created`. `meetingEditable`: venue đổi khi `IN_PROGRESS` → `Invalid("chỉ đổi được hình thức trước khi họp")`. Diff `meeting.updated` thêm `venue`. Mọi lời gọi `CreateMeeting` khác (instant, test helper `notification/reminder_test.go`, `delivery_test.go`) truyền `MeetingVenueOnline`.
- [x] **Bước 5: Handler.** SDI `CreateMeetingSDI.Venue string \`json:"venue" enum:"online,in_person" description:"Hình thức: online có phòng họp; in_person ghi âm tại phòng" example:"online"\``, `PatchMeetingSDI.Venue *string` cùng tag; `toMeetingDTO` điền `Venue`.
- [x] **Bước 6: Test handler** `TestMeetingVenueOnTheWire`: `POST /workspaces/{ws}/meetings` với `"venue":"in_person"` → `201`, body `meeting.venue == "in_person"`; `PATCH` đổi về `online` → `meeting.venue == "online"`.
- [x] **Bước 7: Chạy** `go test ./internal/service -run 'TestMeetingVenue|TestMeetingCreateIdempotencyKey|TestMeetingStateMachine' -count=1` và `go test ./internal/handler -run 'TestMeetingVenueOnTheWire' -count=1` và `go test ./migrations -count=1` → PASS.
- [x] **Bước 8: Commit** `feat(meetings): store a meeting's venue, online or in person`.

### Task 2: Server — luật của họp trực tiếp

**Files:**
- Modify: `server/internal/service/meeting_lifecycle.go` (`Start`, `CreateInstantKeyed`), `server/internal/service/errors.go` (`errMeetingInPerson`), `server/internal/service/meeting_ai.go` (`CalendarICS`), `server/internal/service/meeting_transcriptions.go` (`RecordHeld`, mới `RecordHeldNow`), `server/internal/service/meeting_attendance.go` (`attendanceReport`)
- Modify: `server/internal/handler/meeting.go` (`createInstantMeeting`), `server/internal/handler/meeting_transcriptions.go` (`recordMeetingHeld`), `server/internal/handler/dto/sdi/meeting.go` (`CreateInstantMeetingSDI`, `RecordMeetingHeldSDI`), các lời gọi `CreateInstantKeyed` khác (grep)
- Test: `server/internal/service/meeting_venue_test.go` (thêm), sửa `meeting_transcriptions_test.go` (`TestRecordHeld`), `meeting_attendance_test.go`

**Interfaces:**
- Consumes: Task 1 (`MeetingVenueInPerson`, `db.Meeting.Venue`).
- Produces: `type InstantMeetingInput struct { Title, Venue, IdempotencyKey string }`; `func (s *MeetingService) CreateInstantKeyed(ctx context.Context, userID, workspaceID string, in InstantMeetingInput) (db.Meeting, error)` (`CreateInstant` giữ chữ ký cũ); `errMeetingInPerson()` = `coded(409, "meeting_in_person", "cuộc họp trực tiếp không mở phòng họp")`; `func (s *MeetingService) RecordHeldNow(ctx context.Context, userID, meetingID string, d time.Duration) (db.Meeting, error)`; SDI `CreateInstantMeetingSDI.Venue`, `RecordMeetingHeldSDI.DurationSeconds int \`json:"duration_seconds,omitempty"\``.

- [x] **Bước 1: Viết test hỏng**, thêm vào `meeting_venue_test.go`:
  - `TestInPersonMeetingNeverOpensARoom`: tạo in_person rồi `Start` → `codedIs(err, "meeting_in_person")`, không có dòng `meeting_conference_sessions`.
  - `TestInstantInPersonStaysScheduled`: `CreateInstantKeyed(…, InstantMeetingInput{Title: "Họp nhanh", Venue: "in_person", IdempotencyKey: "k1"})` → `Status == "SCHEDULED"`, `MeetingType == "INSTANT"`, không phiên phòng, không outbox `provider.ensure_session`; gọi lại cùng khoá → cùng id; cùng khoá khác venue → `idempotency_payload_mismatch`.
  - `TestCalendarInviteOfAnInPersonMeetingHasNoDialIn`: bật dial-in như `TestCalendarInviteCarriesTheDialInLine`; ICS của in_person không chứa `"Gọi vào bằng điện thoại"`, của online vẫn chứa.
  - `TestSecretaryRecordsTheMeetingHeld`: thư ký (participant `IsSecretary`) gọi `RecordHeld` → thành công; thành viên thường → `codedIs(err, "not_meeting_clerk")`. Sửa `TestRecordHeld` (đang chờ `not_meeting_host`) sang `not_meeting_clerk`.
  - `TestRecordHeldNowUsesServerClock`: `RecordHeldNow(…, 42*time.Minute)` → `ActualEndAt` trong 5 s quanh `time.Now()`, `ActualEndAt − ActualStartAt == 42m`; `d <= 0` → `invalid_held_times`.
  - `TestInPersonRollSuggestsPresent` (trong `meeting_attendance_test.go`): cuộc họp in_person 3 người, `RecordHeldNow`, `attendanceReport` → cả 3 `PRESENT` nguồn `SUGGESTED`; `FinalizeAttendance` → 3 dấu `PRESENT`. Cuộc họp online giữ `ABSENT` như cũ.
- [x] **Bước 2: Chạy** `go test ./internal/service -run 'TestInPerson|TestInstantInPerson|TestCalendarInviteOfAnInPerson|TestSecretaryRecords|TestRecordHeld' -count=1` → FAIL.
- [x] **Bước 3: Cài.**
  - `Start`: sau `requireHostOrAdmin`, venue in_person → `errMeetingInPerson()`.
  - `CreateInstantKeyed`: fingerprint `(scopeInstant, title, venue)`. Nhánh in_person dừng sau audit `MEETING_CREATED` + `record("meeting.created")`, lưu claim với hàng `SCHEDULED`, không tạo phiên, không `StartMeeting`, không ensure.
  - `CalendarICS`: bỏ dòng dial-in khi in_person.
  - `RecordHeld`: `requireHostOrAdmin` → `requireMeetingClerk`.
  - `RecordHeldNow`: `end := time.Now()`, gọi `RecordHeld(ctx, userID, meetingID, end.Add(-d), end)`; `d <= 0` → `invalid_held_times`.
  - `attendanceReport`: khi in_person, hàng `SUGGESTED` lấy `AttendancePresent` thay vì `suggestAttendance(...)`.
- [x] **Bước 4: Handler.** `createInstantMeeting` đọc `Venue` từ SDI và gọi `CreateInstantKeyed` với `InstantMeetingInput`. `recordMeetingHeld`: `DurationSeconds > 0` và hai giờ trống → `RecordHeldNow(…, time.Duration(n)*time.Second)`; còn lại giữ đường cũ.
- [x] **Bước 5: Chạy** lại bước 2 cùng `TestInstantMeeting`, `TestAttendanceReportSuggestsAndAggregates`, `TestFinalizeWritesAutoAbsent`, `TestCalendarInviteCarriesTheDialInLine`, `go test ./internal/handler -run 'TestIsolation' -count=1` → PASS.
- [x] **Bước 6: Commit** `feat(meetings): in-person meetings never open a room; clerks record them held`.

### Task 3: Server — giờ của từng phần ghi, tóm tắt chờ đủ phần

**Files:**
- Modify: `server/pkg/db/queries/meeting_transcriptions.sql` (mới `CountOpenMeetingTranscriptions`), `make sqlc`
- Modify: `server/internal/service/meeting_transcriptions.go` (`TranscriptionRequest.OffsetSeconds`, `RequestTranscription`), `server/internal/service/meeting_auto_summary.go` (`runAutoSummary`, hằng `autoSummaryTranscriptionWait = 30 * time.Second`)
- Modify: `server/internal/handler/dto/sdi/meeting.go` (`RequestTranscriptionSDI.OffsetSeconds *int \`json:"offset_seconds,omitempty"\``), `server/internal/handler/meeting_transcriptions.go`
- Test: `meeting_transcriptions_test.go`, `meeting_auto_summary_test.go`

**Interfaces:**
- Produces: `TranscriptionRequest.OffsetSeconds *int`; query `CountOpenMeetingTranscriptions(ctx, meetingID string) (int64, error)` với `-- tenant: system` (chỉ worker gọi).

- [x] **Bước 1: Viết test hỏng.**
  - `TestRequestTranscriptionOffset`: cuộc họp đã họp 42 phút; phần có `OffsetSeconds: ptr(1200)` → `starts_at == actual_start_at + 20m`; `OffsetSeconds: ptr(-1)` hoặc vượt `(actual_end − actual_start) + 60s` → 422 `invalid_offset`; không đặt offset → cách cũ (nối tiếp).
  - `TestAutoSummaryWaitsForOpenTranscriptions`: hai lần ghi lời QUEUED; hoàn tất lần một → `runAutoSummary` hoãn, `attempts` không tăng, chưa có summary; hoàn tất lần hai → tóm tắt chạy đúng một lần.
- [x] **Bước 2: Chạy** `go test ./internal/service -run 'TestRequestTranscriptionOffset|TestAutoSummaryWaitsForOpenTranscriptions' -count=1` → FAIL.
- [x] **Bước 3: Cài.** Query đếm `status IN ('QUEUED','RUNNING')` theo `meeting_id`. `RequestTranscription`: offset hợp lệ thì `startsAt = (ActualStartAt, nếu không có thì StartsAt) + offset`, bỏ `MeetingTranscriptionFileStart`. `runAutoSummary`: trước `summarizeAuto`, nếu đếm > 0 thì `return s.deferAutoSummary(ctx, row, autoSummaryTranscriptionWait)`. Handler chuyển `offset_seconds` vào request.
- [x] **Bước 4: Chạy** bước 2 cùng `TestRequestTranscription`, `TestTranscriptionFileStartCountsAFileWhoseReRunFailed`, `TestAutoSummaryWorker`, `TestCompletedUploadQueuesTheAutoSummary`, và `go test ./migrations -run TestEveryQueryNamesItsTenant -count=1` → PASS.
- [x] **Bước 5: Commit** `feat(meetings): place recording parts by their offset; summarize once every part is in`.

### Task 4: Core — venue, Họp ngay, ghi nhận theo độ dài, offset, theo dõi ghi lời

**Files:**
- Modify: `packages/core/types/meeting.ts` (`venue: z.string().optional().catch(undefined)`)
- Create: `packages/core/meetings/venue.ts` (`MeetingVenue`, `MEETING_VENUES`, `meetingVenue`)
- Modify: `packages/core/api/endpoints/meetings.ts` (`CreateMeetingBody.venue?`, `UpdateMeetingBody.venue?`, `createInstantMeeting`), `packages/core/api/endpoints/meeting-transcriptions.ts` (`recordMeetingHeld`, `requestMeetingTranscription`), `packages/core/meetings/hooks.ts` (chỉ chữ ký `useCreateInstantMeeting`), `packages/core/meetings/transcription-hooks.ts`, `packages/core/package.json` exports nếu cần cho `venue`
- Modify: lời gọi `createInstantMeeting` / `useCreateInstantMeeting` hiện có (`instant-meeting-dialog.tsx`)
- Test: `packages/core/api/endpoints/meetings.test.ts`, `packages/core/api/endpoints/meeting-transcriptions.test.ts`, `packages/core/meetings/transcription-hooks.test.tsx` (mới nếu chưa có)

**Interfaces:**
- Produces:
  - `type MeetingVenue = "online" | "in_person"`; `const MEETING_VENUES`; `function meetingVenue(m: { venue?: string | null } | null | undefined): MeetingVenue` (lạ → `"online"`).
  - `createInstantMeeting(workspaceId: string, body: { title?: string; venue?: MeetingVenue }, opts?: { idempotencyKey?: string }): Promise<Meeting | null>`.
  - `useCreateInstantMeeting(workspaceId)` mutation input `{ title?: string; venue?: MeetingVenue; idempotencyKey: string }`.
  - `recordMeetingHeld(meetingId, body: { started_at?: string; ended_at?: string; duration_seconds?: number })`; `useRecordMeetingHeld` nhận cùng body.
  - `requestMeetingTranscription` body thêm `offset_seconds?: number`; `UploadRecordingInput.offsetSeconds?: number`.
  - `useMeetingTranscriptions(meetingId, enabled)` refetch mỗi `15_000` ms khi lần mới nhất là `QUEUED` hoặc `RUNNING`.

- [x] **Bước 1: Viết test hỏng.**
  - `getMeeting reads the venue and drops an unknown one`: `{meeting:{…, venue:"in_person"}}` → `venue === "in_person"`; `venue: 7` → meeting vẫn trả về, `venue === undefined`; `meetingVenue({venue:"x"}) === "online"`.
  - `createInstantMeeting sends the venue`: body gửi đi `{ title: "Họp nhanh", venue: "in_person" }`; `{meeting:"x"}` → `null`.
  - `recordMeetingHeld sends duration_seconds`; `requestMeetingTranscription sends offset_seconds`; dữ liệu hỏng → giá trị dự phòng như các ca hiện có.
  - `useMeetingTranscriptions polls while a transcription is open`: lần đầu trả `RUNNING`, sau 15 s gọi lại; khi `COMPLETE` thì thôi.
- [x] **Bước 2: Chạy** `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @uniwork/core exec vitest run api/endpoints/meetings.test.ts api/endpoints/meeting-transcriptions.test.ts meetings/transcription-hooks.test.tsx` → FAIL.
- [x] **Bước 3: Cài** theo Interfaces; `useCreateInstantMeeting` truyền `{ title, venue }`. Cập nhật lời gọi trong `instant-meeting-dialog.tsx` (chỉ đổi chữ ký, giao diện để Task 7).
- [x] **Bước 4: Chạy** lại bước 2 và `pnpm --filter @uniwork/core typecheck`, `pnpm --filter @uniwork/views typecheck` → PASS.
- [x] **Bước 5: Commit** `feat(meetings): client reads the venue, records held by duration, places parts by offset`.

### Task 5: Core — kho ghi trên máy và bộ ghi âm

**Files:**
- Create: `packages/core/meetings/recorder/store.ts`, `packages/core/meetings/recorder/recorder.ts`, `packages/core/meetings/recorder/use-meeting-recorder.ts`, `packages/core/meetings/recorder/index.ts`
- Modify: `packages/core/package.json` (export `./meetings/recorder`)
- Test: `packages/core/meetings/recorder/store.test.ts`, `packages/core/meetings/recorder/recorder.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type RecordingPart = { id: string; userId: string; meetingId: string; startedAt: number; lastChunkAt: number;
    endedAt: number | null; mimeType: string; bytes: number; language: "vi" | "en"; offsetSeconds: number };
  interface RecordingStore {
    createPart(part: RecordingPart): Promise<void>;
    appendChunk(partId: string, seq: number, blob: Blob, at: number): Promise<void>; // cập nhật bytes, lastChunkAt
    finishPart(partId: string, endedAt: number): Promise<void>;
    listParts(userId: string, meetingId?: string): Promise<RecordingPart[]>; // theo startedAt tăng dần
    readPart(partId: string): Promise<Blob>; // ghép chunk theo seq, type = mimeType
    deletePart(partId: string): Promise<void>;
  }
  function openRecordingStore(factory?: IDBFactory): RecordingStore; // DB "uniwork-meeting-recordings" v1, store "parts" (keyPath id, index userId), "chunks" (keyPath [partId, seq])
  function memoryRecordingStore(): RecordingStore; // cho test của views
  type RecorderState = "idle" | "recording" | "paused" | "interrupted" | "stopped" | "failed";
  interface MeetingRecorder {
    readonly state: RecorderState; readonly stream: MediaStream | null; readonly error: unknown;
    activeMs(): number; // không tính khoảng tạm dừng
    start(deviceId?: string): Promise<void>; pause(): void; resume(): void;
    resumeAfterInterrupt(deviceId?: string): Promise<void>; switchDevice(deviceId: string): Promise<void>;
    stop(): Promise<void>; subscribe(fn: () => void): () => void;
  }
  function createMeetingRecorder(deps: { store: RecordingStore; userId: string; meetingId: string; language: "vi" | "en";
    getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>; MediaRecorderCtor: typeof MediaRecorder;
    now?: () => number; newId?: () => string; timesliceMs?: number; baseStartedAt?: number }): MeetingRecorder;
  function useMeetingRecorder(opts: { userId: string; meetingId: string; language: "vi" | "en"; store?: RecordingStore }):
    { recorder: MeetingRecorder; state: RecorderState; activeMs: number; wakeLockHeld: boolean };
  function useUnsentRecordings(userId: string | undefined, meetingId?: string, store?: RecordingStore):
    { parts: RecordingPart[]; seconds: number; savedAt: number | null; refresh: () => void };
  ```
- Quy ước: `timesliceMs` mặc định `5000`; MIME chọn theo thứ tự `audio/webm;codecs=opus`, `audio/mp4`, `audio/ogg;codecs=opus` (`MediaRecorder.isTypeSupported`); `audioBitsPerSecond: 48000`. Tạm dừng = `track.enabled = false` (file vẫn chạy, đoạn đó im lặng, spec D8). `offsetSeconds = round((part.startedAt − baseStartedAt) / 1000)`, `baseStartedAt` = `startedAt` của phần đầu (hoặc `deps.baseStartedAt` khi ghi tiếp bản ghi cũ). `switchDevice` và `resumeAfterInterrupt` đóng phần hiện tại và mở phần mới. Hook giữ Screen Wake Lock khi `recording|paused` (xin lại khi `visibilitychange` → visible), chặn `beforeunload` khi `recording|paused|interrupted`.

- [x] **Bước 1: Viết test hỏng** (`fake-indexeddb` `IDBFactory`; `FakeMediaRecorder` phát `dataavailable` mỗi lần `requestData`/tick; track giả có `enabled` và sự kiện `ended`):
  - `store keeps parts per user and reads chunks in order`: hai người dùng, `listParts(u1)` chỉ trả của u1; `readPart` ghép `seq` 0,1,2 đúng thứ tự; `deletePart` xoá cả chunk.
  - `every chunk is saved as soon as it arrives`: sau 2 tick, `listParts` có `bytes` = tổng hai blob, `lastChunkAt` = giờ tick 2.
  - `pause silences the track and stops the clock`: `pause()` → `track.enabled === false`, `activeMs` đứng yên khi `now` tăng; `resume()` → bật lại.
  - `a track that ends closes the part and interrupts`: phát `ended` → `state === "interrupted"`, phần có `endedAt`; `resumeAfterInterrupt()` → phần 2 có `offsetSeconds` = số giây thật từ đầu phần 1.
  - `switching device starts a new part`: `switchDevice("d2")` → 2 phần, `getUserMedia` lần hai với `deviceId: { exact: "d2" }`.
  - `refused microphone fails`: `getUserMedia` reject `NotAllowedError` → `state === "failed"`, `error` giữ lỗi.
  - `continuing an unsent recording keeps the offsets`: `baseStartedAt` = 10 phút trước → phần mới có `offsetSeconds === 600`.
- [x] **Bước 2: Chạy** `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @uniwork/core exec vitest run meetings/recorder` → FAIL.
- [x] **Bước 3: Cài** `store.ts`, `recorder.ts`, rồi `use-meeting-recorder.ts` (hook bọc `createMeetingRecorder` với `navigator.mediaDevices.getUserMedia`, `globalThis.MediaRecorder`, store `openRecordingStore()` mặc định; `useUnsentRecordings` là query key `["meeting-recordings-local", userId, meetingId]`, `seconds = Σ((endedAt ?? lastChunkAt) − startedAt)/1000`).
- [x] **Bước 4: Chạy** bước 2 và `pnpm --filter @uniwork/core typecheck lint` → PASS.
- [x] **Bước 5: Commit** `feat(meetings): record a meeting into a device-side store, five seconds at a time`.

### Task 6: Core — gửi bản ghi

**Files:**
- Create: `packages/core/meetings/recorder/use-send-recording.ts`
- Test: `packages/core/meetings/recorder/use-send-recording.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`useRecordMeetingHeld` với `duration_seconds`, `useUploadMeetingRecording` với `offsetSeconds`), Task 5 (`RecordingStore`, `RecordingPart`).
- Produces:
  ```ts
  type SendPhase = "idle" | "holding" | "uploading" | "waiting" | "failed" | "done";
  function useSendRecording(opts: { workspaceId: string; meeting: Meeting; userId: string; store?: RecordingStore }): {
    phase: SendPhase; percent: number; sentBytes: number; totalBytes: number; seconds: number; error: unknown;
    send(): Promise<void>; retry(): void; stop(): Promise<void>;
  };
  ```
- Luật: đọc `listParts(userId, meeting.id)`; nếu `meeting.status === "SCHEDULED"` thì `recordHeld({ duration_seconds: round((cuối.endedAt − đầu.startedAt)/1000) })` (lỗi `invalid_meeting_state` → tải lại cuộc họp, nếu đã `ENDED` thì đi tiếp); từng phần theo thứ tự: `new File([await store.readPart(id)], \`ghi-am-\${part.id}.\${ext}\`, { type: part.mimeType, lastModified: part.startedAt })` (`ext` = `webm`/`m4a`/`ogg` theo MIME), `upload.mutateAsync({ file, language: part.language, consent: true, durationSeconds, offsetSeconds: part.offsetSeconds })`, rồi `store.deletePart(part.id)`. `percent` = (byte đã xong + percent của tệp đang gửi × byte của nó) / tổng. Lỗi mạng (`TypeError`, hoặc `navigator.onLine === false`) → `waiting`, nghe `online` để tự `send()` lại; lỗi từ chối (theo `uploadFailure` hiện có) → `failed`, giữ phần trên máy.

- [x] **Bước 1: Viết test hỏng** (mock transport `@uniwork/core/api/http` như các test core khác; store `memoryRecordingStore()` có 2 phần):
  - `records the meeting held by duration, then sends each part with its offset`: thứ tự gọi `POST /held {duration_seconds: 2538}`, mở phiên tải phần 1, queue với `offset_seconds: 0`, phần 2 với `offset_seconds: 1500`, `consent: true`; sau đó `listParts` rỗng, `phase === "done"`.
  - `skips record-held when the meeting already ended`.
  - `continues when record-held answers invalid_meeting_state` (cuộc họp tải lại là `ENDED`).
  - `waits offline and resumes on the online event`: lần gửi đầu `TypeError` → `phase === "waiting"`, phần còn trên máy; phát `window` `online` → gửi tiếp, `done`.
  - `rebuilds the same File key on retry`: hai lần `send()` tạo `File` cùng `name` và `lastModified`.
  - `a refusal keeps the parts`: 402 `quota_exceeded` → `phase === "failed"`, `listParts` còn đủ.
- [x] **Bước 2: Chạy** `… vitest run meetings/recorder/use-send-recording.test.tsx` → FAIL.
- [x] **Bước 3: Cài** `useSendRecording`.
- [x] **Bước 4: Chạy** lại → PASS.
- [x] **Bước 5: Commit** `feat(meetings): send an in-app recording part by part, waiting out a lost connection`.

### Task 7: Views — chọn hình thức trong Tạo cuộc họp và Họp ngay (bảng 1, 2)

**Files:**
- Create: `packages/views/meetings/meeting-venue-picker.tsx`
- Modify: `packages/views/meetings/meeting-sheet/draft-model.ts` (`MeetingDraft.venue`, `emptyDraft`, `draftFromMeeting`, `SCALARS`), `submit-plan.ts` (`buildCreatePlan`, `buildEditPlan`), `sheet-fields.tsx`, `property-chips.tsx` (prop `showJoin`), `more-options.tsx` (ẩn mục khách), `meeting-sheet.tsx` (`revisionOf`)
- Modify: `packages/views/meetings/instant-meeting-dialog.tsx`, `packages/views/meetings/meetings-page-view.tsx` (điều hướng sau Họp ngay)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`
- Test: `meeting-sheet/meeting-sheet.test.tsx`, `meeting-sheet/submit-plan.test.ts`, `instant-meeting-dialog.test.tsx`, `meeting-venue-picker.test.tsx` (mới)

**Interfaces:**
- Consumes: Task 4 (`MeetingVenue`, `meetingVenue`, `useCreateInstantMeeting` input).
- Produces: `MeetingVenuePicker({ value, onChange, readOnly?, className? }: { value: MeetingVenue; onChange: (v: MeetingVenue) => void; readOnly?: boolean; className?: string })`; `InstantMeetingDialog` prop đổi thành `onStarted: (meetingId: string, venue: MeetingVenue) => void`; `MeetingsPageView` nhận thêm `onOpenRecord?: (meetingId: string) => void`.
- Chữ (vi): nhãn `meetings.venue.label` "Hình thức"; `meetings.venue.online` "Online", `meetings.venue.onlineHint` "Phòng họp có link"; `meetings.venue.inPerson` "Trực tiếp", `meetings.venue.inPersonHint` "Ghi âm tại phòng"; nút `meetings.venue.prepare` "Chuẩn bị ghi âm".
- Hình (bảng 1–2, `shots/p02-create.png`, `p03-instant.png`): `role="radiogroup"` hai ô `grid grid-cols-2 gap-2`, mỗi ô `rounded-lg border px-3 py-2.5`, ô icon `size-8 rounded-md` (Online: `bg-tint-blue text-tint-blue-foreground` + `Video`; Trực tiếp: `bg-tint-violet text-tint-violet-foreground` + `UsersRound`), tên `text-body font-medium`, gợi ý `text-caption text-muted-foreground`; ô được chọn: `border-primary ring-1 ring-inset ring-primary bg-surface-selected` và huy hiệu tròn `size-4.5 bg-primary text-primary-foreground` có `Check` ở góc phải trên. Trong sheet: khối `mt-6` ngay dưới tiêu đề; trong Họp ngay: ngay dưới khối "Tiêu đề nhanh".

- [x] **Bước 1: Viết test hỏng.**
  - `meeting-venue-picker.test.tsx`: hai `radio` "Online" và "Trực tiếp"; bấm "Trực tiếp" → `onChange("in_person")`; mũi tên trái/phải đổi lựa chọn; `readOnly` → `aria-disabled`.
  - `meeting-sheet.test.tsx` "creates an in-person meeting": capability `transcription: true`; chọn "Trực tiếp" → không còn nút "Vào phòng" và mục "Khách bên ngoài"; gửi → body `createMeeting` có `venue: "in_person"`. "hides the venue without transcription": capability false → không có "Hình thức" (trừ khi đang sửa một cuộc họp in_person).
  - `submit-plan.test.ts`: `buildCreatePlan` có `venue`; `buildEditPlan` chỉ PATCH `venue` khi đổi.
  - `instant-meeting-dialog.test.tsx` "in person prepares the recording": chọn "Trực tiếp" → nút đọc "Chuẩn bị ghi âm", không còn "Người được chọn nhận thông báo khi phòng mở."; bấm → `POST …/instant` body `{ title, venue: "in_person" }`, `onStarted(id, "in_person")`.
- [x] **Bước 2: Chạy** `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @uniwork/views exec vitest run meetings/meeting-venue-picker.test.tsx meetings/meeting-sheet meetings/instant-meeting-dialog.test.tsx` → FAIL.
- [x] **Bước 3: Cài** theo Interfaces và hình. `meetings-page-view.tsx` gọi `onOpenRecord(id)` khi venue in_person, `onOpenRoom(id)` khi online; trang `apps/web/app/[orgSlug]/[workspaceSlug]/meetings/page.tsx` truyền `onOpenRecord` sau Task 9 (tạm thời mở trang chi tiết nếu thiếu).
- [x] **Bước 4: Chạy** lại bước 2, `pnpm --filter @uniwork/views typecheck lint` → PASS. So ảnh: mở sheet và Họp ngay ở `localhost:3000`, so với `shots/p02-create.png`, `p03-instant.png`.
- [x] **Bước 5: Commit** `feat(meetings): choose online or in person when creating a meeting`.

### Task 8: Views — trang cuộc họp trước giờ họp (bảng 3, 13 trái)

**Files:**
- Create: `packages/views/meetings/meeting-detail/ui/venue-pill.tsx`
- Modify: `meeting-detail/detail-header.tsx`, `meeting-detail/next-step-jobs.ts` (`StripInput.inPerson`, `StripInput.canRecord`, job `start` thêm `inPerson`, `canRecord`), `meeting-detail/strip-rows.tsx` (`StartRow`, `MissedRow`, `StripHandlers.onRecord`), `meeting-detail/rail/rail-properties.tsx`, `meeting-record-held-dialog.tsx` (`MeetingRecordHeldButton` nhận `label?`, `icon?`), `meeting-detail-view.tsx` (prop `onRecord?: (opts?: { send?: boolean }) => void`, tính `canRecord = isClerk && caps.transcription`)
- Modify: `apps/web/app/[orgSlug]/[workspaceSlug]/meetings/[meetingId]/page.tsx` (truyền `onRecord`, sau Task 9 có `ws.record`)
- Modify: i18n vi/en
- Test: `detail-header.test.tsx`, `next-step-jobs.test.ts`, `meeting-detail-view.test.tsx`, `rail/rail.test.tsx`, `scheduled/scheduled.test.tsx` (thanh điện thoại)

**Interfaces:**
- Consumes: Task 4 (`meetingVenue`), Task 7 (khoá `meetings.venue.*`).
- Produces: `MeetingVenuePill()` (không prop, chỉ render khi được đặt); `StripHandlers.onRecord: (opts?: { send?: boolean }) => void`.
- Chữ: pill `meetings.venue.inPerson` "Trực tiếp"; nút `meetings.venue.startRecording` "Bắt đầu ghi âm" (icon `Mic`); `meetings.venue.haveFile` "Đã có file ghi âm" (icon `Upload`); hàng rail `meetings.detail.rail.venue` "Hình thức", giá trị "Trực tiếp" (icon `UsersRound`).
- Hình (`shots/p04-due.png`, `p12-m-due.png`): pill cạnh pill trạng thái, cùng chiều cao, `bg-tint-violet text-tint-violet-foreground`, icon `UsersRound size-3`; hàng "Hình thức" là `RailProp` đầu tiên, trên "Chủ trì", chỉ khi in_person; họp trực tiếp không có `GuestsRow` và không có thao tác link khách (không có phòng để khách vào). Trên điện thoại "Bắt đầu ghi âm" là nút chính ở thanh dưới.

- [x] **Bước 1: Viết test hỏng.**
  - `detail-header.test.tsx` "shows Trực tiếp beside the status for an in-person meeting".
  - `next-step-jobs.test.ts` "an in-person start job lets a clerk record": `inPerson: true, isClerk: true, canRecord: true` → `{kind:"start", inPerson: true, canRecord: true}`.
  - `meeting-detail-view.test.tsx` "an in-person meeting starts by recording": cuộc họp in_person SCHEDULED, capability transcription → có "Bắt đầu ghi âm", không có "Bắt đầu họp"; bấm → `onRecord()` được gọi; sau giờ bắt đầu có "Đã có file ghi âm" mở hộp thoại "Ghi nhận cuộc họp đã diễn ra". Không có capability transcription → không có "Bắt đầu ghi âm" lẫn "Bắt đầu họp"; sau giờ bắt đầu chỉ còn "Đã có file ghi âm".
  - "an in-person meeting has no guests": không có hàng khách (`GuestsRow`) ở rail và không có thao tác tạo link khách.
  - `rail/rail.test.tsx` "lists Hình thức first for an in-person meeting".
  - `scheduled/scheduled.test.tsx` "the phone bar starts the recording".
- [x] **Bước 2: Chạy** `… vitest run meetings/meeting-detail meetings/meeting-detail-view.test.tsx` → FAIL.
- [x] **Bước 3: Cài.**
- [x] **Bước 4: Chạy** lại → PASS; so `shots/p04-due.png`, `p12-m-due.png`.
- [x] **Bước 5: Commit** `feat(meetings): an in-person meeting page starts a recording instead of a room`.

### Task 9: Views — trang ghi âm: chuẩn bị và đang ghi (bảng 4, 5, 13 phải)

**Files:**
- Modify: `packages/core/paths/paths.ts` (`record: (id) => \`${base}/meetings/${id}/record\``), `packages/core/paths/consistency.test.ts` (thêm `ws.record(ID)`)
- Create: `apps/web/app/[orgSlug]/[workspaceSlug]/meetings/[meetingId]/record/page.tsx` (theo `room/page.tsx`)
- Create: `packages/views/meetings/record/record-view.tsx`, `record/record-prep.tsx`, `record/record-stage.tsx`, `record/record-wave.tsx`, `record/use-mic-levels.ts`
- Modify: i18n vi/en; `apps/web/app/.../meetings/page.tsx` và `.../[meetingId]/page.tsx` nối `onOpenRecord`/`onRecord` tới `ws.record(id)`
- Test: `packages/views/meetings/record/record-view.test.tsx`, `record/record-stage.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`useMeetingRecorder`, `useUnsentRecordings`, `memoryRecordingStore` cho test), các mảnh có sẵn: `MeetingCanvas`, `MeetingDeviceField`, `MeetingMicLevel` (nhận `track`), `useMediaDevices`, `MeetingMediaToggle`, `IconControl`, `MEETING_DARK_BAR`, `MEETING_CHIP`, `formatMeetingWindow`, `rmsLevel` (`packages/views/chat/use-chat-voice-recorder.ts`).
- Produces: `MeetingRecordView({ workspaceId, meetingId, onBack, onSent, workspaceLabel?, meetingsHref?, send?, store? }: { …; send?: boolean; store?: RecordingStore })` (testid `meeting-record`, khung `fixed inset-0 z-40 bg-background` như `MeetingRoomShell`); `useMicLevels(stream: MediaStream | null, bars: number): number[]` (0..1, mỗi 150 ms).
- Chữ màn chuẩn bị (`shots/p05-prep.png`): overline `meetings.record.ready` "Sẵn sàng ghi âm"; trường "Mic" (khoá có sẵn); `meetings.transcription.language*` "Ngôn ngữ chính" / "Tiếng Việt" / "Tiếng Anh" (dùng lại khoá của hộp thoại tải tệp); ô xác nhận dùng lại `meetings.transcription.consent` "Tôi đã thông báo cho người dự họp về việc ghi âm" + gợi ý "Giọng nói là dữ liệu cá nhân."; nút `meetings.venue.startRecording` "Bắt đầu ghi âm" (icon `Mic`, `aria-disabled` đến khi tích ô, lý do `meetings.record.consentFirst` "Tích ô xác nhận ở trên để bắt đầu"); chú thích `meetings.record.placementHint` "Đặt máy giữa bàn, cắm sạc và giữ trang này mở đến hết buổi."; chip `meetings.record.micOk` "Micro đang thu tốt".
- Hình màn chuẩn bị: bố cục `MeetingPreJoin` (khung trái `rounded-2xl bg-meeting-stage p-3 ring-1 ring-surface-border`, phải là thẻ `max-w-sm rounded-2xl border bg-surface p-5`); khung trái thay camera bằng vòng micro (vòng ngoài 184 px `bg-primary/10`, vòng trong inset 26 px `bg-primary/20`, lõi 96 px `bg-primary` + `Mic size-10`), 38 vạch sóng từ `useMicLevels` (trắng, độ mờ tăng dần trái→phải), chip "Micro đang thu tốt" (`Check` xanh); dưới khung chỉ còn nút micro (bỏ camera).
- Chữ màn đang ghi (`shots/p13-rec-d.png`, `p13-rec-m.png`): `meetings.record.recording` "Đang ghi âm"; `meetings.record.paused` "Đã tạm dừng"; `meetings.record.saved` "Đã lưu trên máy"; `meetings.record.screenOn` "Màn hình luôn sáng" (chỉ khi `wakeLockHeld`); `meetings.record.people` "{{count}} người dự"; `meetings.record.end` "Kết thúc"; `meetings.record.pause` "Tạm dừng"; `meetings.record.resume` "Ghi tiếp"; `meetings.record.device` "Thiết bị"; ngắt: `meetings.record.interrupted` "Ghi âm bị ngắt", `meetings.record.savedUpTo` "{{time}} đã lưu an toàn", `meetings.record.endAndSend` "Kết thúc và gửi".
- Hình màn đang ghi: khung như `ConferenceStage` (`rounded-2xl bg-meeting-stage ring-1 ring-surface-border` > `div.dark`); đầu: breadcrumb (`workspaceLabel` / "Cuộc họp"), tiêu đề `data-stage-heading`, `<time>` khung giờ; phải: chip `MEETING_CHIP` "Đã lưu trên máy" (icon `Check` xanh) và nút destructive "Kết thúc". Giữa: nhãn trạng thái (chấm đỏ có quầng khi ghi; `Pause` màu `text-warning` khi tạm dừng), đồng hồ `font-heading font-bold tabular-nums tracking-[-0.045em]` cỡ `text-[168px]` (dưới 600 px: `text-[96px]`), màu `text-warning` khi tạm dừng; sóng 64 vạch (điện thoại 34), phẳng khi tạm dừng; hàng chip "Đã lưu trên máy" · "Màn hình luôn sáng" · "{{count}} người dự". Chân: `MEETING_DARK_BAR` với `IconControl` Tạm dừng/Ghi tiếp, `IconControl` Thiết bị (popover chọn micro → `switchDevice`), vạch ngăn, `IconControl tone="off"` nền đỏ icon `Square` "Kết thúc". Bị ngắt: bảng giữa khung (ô `MicOff` nền `bg-destructive-soft`), nút sáng "Ghi tiếp" và nút chữ "Kết thúc và gửi".

- [x] **Bước 1: Viết test hỏng** (`navigator.mediaDevices` giả như `meeting-prejoin.test.tsx:29`, `MediaRecorder` giả như `chat-composer.test.tsx:170`, store `memoryRecordingStore()`):
  - `record-view.test.tsx` "starts only after the consent": "Bắt đầu ghi âm" `aria-disabled`, có "Tích ô xác nhận ở trên để bắt đầu"; tích ô → bấm → thấy "Đang ghi âm" và đồng hồ `0:00`.
  - "pauses and resumes": "Tạm dừng" → "Đã tạm dừng", nút đọc "Ghi tiếp"; bấm → "Đang ghi âm".
  - "an interrupted recording offers to continue or send": track phát `ended` → "Ghi âm bị ngắt", "Ghi tiếp", "Kết thúc và gửi".
  - "picks the recording language": chọn "Tiếng Anh" → phần lưu có `language: "en"`.
  - `paths/consistency.test.ts` qua (có trang `record`).
- [x] **Bước 2: Chạy** `… vitest run meetings/record` và `pnpm --filter @uniwork/core exec vitest run paths` → FAIL.
- [x] **Bước 3: Cài** paths + trang app + các component.
- [x] **Bước 4: Chạy** lại → PASS; `pnpm --filter @uniwork/views typecheck lint`; so ảnh màn chuẩn bị và đang ghi (máy tính và 390 px) với `shots/p05-prep.png`, `p13-rec-d.png`, `p13-rec-m.png`.
- [x] **Bước 5: Commit** `feat(meetings): record an in-person meeting from the browser`.

### Task 10: Views — kết thúc và gửi (bảng 6, 7)

**Files:**
- Create: `packages/views/meetings/record/record-send-dialog.tsx`
- Modify: `packages/views/meetings/record/record-view.tsx` (hộp thoại kết thúc, gửi, `send` prop), `packages/views/meetings/meeting-recording-upload.tsx` (export `uploadFailure`)
- Modify: i18n vi/en
- Test: `packages/views/meetings/record/record-send-dialog.test.tsx`, `record-view.test.tsx` (thêm)

**Interfaces:**
- Consumes: Task 6 (`useSendRecording`), `ConfirmDialog`, `FormDialogContent/Header/Body/Footer`, `Progress`, `Notice`, `formatBytes`, `uploadFailure`.
- Produces: `RecordSendDialog({ phase, percent, sentBytes, totalBytes, seconds, error, onStop, onRetry, onLater }: { phase: SendPhase; …; onStop: () => void; onRetry: () => void; onLater: () => void })`.
- Chữ kết thúc (`shots/p14-end.png`, dùng `ConfirmDialog` với `destructive={false}`): tiêu đề `meetings.record.endTitle` "Kết thúc và gửi bản ghi?"; mô tả `meetings.record.endBody` "Bản ghi {{duration}} được gửi để Thư ký UNI soạn tóm tắt, việc đề xuất và biên bản."; xác nhận "Kết thúc và gửi"; huỷ `meetings.record.continue` "Ghi tiếp".
- Chữ gửi (`shots/p06-upload.png`, `p06-upload-offline.png`): `meetings.record.sendingTitle` "Đang gửi bản ghi"; `meetings.record.sendingBody` "Gửi xong, Thư ký UNI bắt đầu ghi lời và soạn tóm tắt."; hàng tệp `meetings.record.fileLabel` "Ghi âm tại phòng · {{duration}}", "{{sent}} / {{total}}", phần trăm; chân `meetings.record.keepOpen` "Giữ trang này mở đến khi gửi xong."; nút `meetings.record.stopSending` "Dừng gửi", `meetings.record.sending` "Đang gửi…"; mất mạng: `meetings.record.waitingTitle` "Chờ mạng để gửi", `meetings.record.waitingBody` "Bản ghi an toàn trên máy này. Có mạng lại là tự gửi tiếp.", nhãn `meetings.record.pausedShort` "Tạm dừng" (`text-warning`), thanh `bg-warning`, dòng `meetings.record.offline` "Mất mạng · tự gửi tiếp khi có mạng" (icon `WifiOff`), nút `meetings.record.later` "Để sau", `meetings.record.retryNow` "Thử lại ngay" (icon xoay).
- Hình: khung `FormDialogContent` như hộp thoại "Tải tệp ghi âm lên"; hàng tệp `rounded-lg border px-3 py-3` với ô `size-9 rounded-md bg-muted` + `AudioLines`; thanh tiến độ `h-1.5 rounded-full`.

- [x] **Bước 1: Viết test hỏng.**
  - `record-send-dialog.test.tsx`: phase `uploading` hiện "Đang gửi bản ghi", "18 MB / 31 MB", "58%", "Dừng gửi"; `waiting` hiện "Chờ mạng để gửi", "Mất mạng · tự gửi tiếp khi có mạng", "Thử lại ngay" gọi `onRetry`, "Để sau" gọi `onLater`; `failed` với `quota_exceeded` hiện câu từ chối của `uploadFailure`.
  - `record-view.test.tsx` "ending asks, then sends": "Kết thúc" → "Kết thúc và gửi bản ghi?"; "Ghi tiếp" đóng và vẫn ghi; "Kết thúc và gửi" → recorder `stop`, mở "Đang gửi bản ghi", xong → `onSent()`.
  - "send=1 sends what is on the device": store có 1 phần, `send` → thẳng hộp thoại gửi.
- [x] **Bước 2: Chạy** `… vitest run meetings/record` → FAIL.
- [x] **Bước 3: Cài.**
- [x] **Bước 4: Chạy** lại và `vitest run meetings/meeting-recording-upload.test.tsx` → PASS; so ảnh với `shots/p14-end.png`, `p06-upload*.png`.
- [x] **Bước 5: Commit** `feat(meetings): end an in-person recording and send it, offline included`.

### Task 11: Views — sau khi gửi: đang xử lý, gán người nói (bảng 8, 10, 11)

**Files:**
- Modify: `meeting-detail/next-step-jobs.ts` (job mới `{ kind: "transcribing"; minutes: number; etaMinutes: number }`, `closeOut.unnamedSpeakers: number`, `StripInput.transcribing: { seconds: number } | null`, `StripInput.unnamedSpeakers: number`), `meeting-detail/strip-rows.tsx` (`TranscribingRow`, `CloseOutRow`), `overview/overview-summary.tsx`, `overview/overview-tab.tsx` (`ITEMS_LATER`), `transcript/transcript-tab.tsx` hoặc `transcript-find.tsx` (nút `MeetingSpeakerLabelsButton`), `meeting-detail-view.tsx` (đọc `useMeetingTranscriptions`, `useSpeakerLabels`)
- Modify: i18n vi/en
- Test: `next-step-jobs.test.ts`, `meeting-detail-view.test.tsx`, `overview/overview-tab.test.tsx`, `transcript/transcript-tab.test.tsx`

**Interfaces:**
- Consumes: Task 4 (polling `useMeetingTranscriptions`), `useSpeakerLabels` (`packages/core/meetings/speaker-label-hooks.ts`), `MeetingSpeakerLabelsDialog`/`MeetingSpeakerLabelsButton` (có sẵn).
- Luật: `transcribing` khi venue in_person, `ENDED`, lần ghi lời mới nhất `QUEUED|RUNNING`; `minutes = ceil(estimated_seconds/60)`, `etaMinutes = max(1, round(estimated_seconds/600))`. Người nói chưa tên = nhãn không có `assigned_user_id` và `assigned_name`.
- Chữ (`shots/p07-processing.png`, `p09-done.png`, `p10-done-transcript.png`): `meetings.record.transcribingTitle` "Thư ký UNI đang ghi lời bản ghi {{minutes}} phút"; `meetings.record.transcribingEta` "Khoảng {{count}} phút nữa có tóm tắt và việc đề xuất · sẽ báo bạn và thư ký"; thẻ tóm tắt `meetings.record.summaryTranscribing` "Thư ký UNI đang ghi lời và tách người nói" + thanh tím + `meetings.record.summarySteps` "Nhận bản ghi ✓ · Ghi lời · Tóm tắt và việc đề xuất" (không nút "Soạn tóm tắt"); ô việc `meetings.detail.overview.itemsAfterTranscribing` "Việc đề xuất có sau khi Thư ký UNI soạn xong"; dải kết quả `meetings.record.unnamedSpeakers` "{{count}} người nói chưa có tên" ghép trước " · N việc chờ giao", dòng phụ `meetings.record.unnamedHint` "Gán tên để lời thoại, tóm tắt và biên bản ghi đúng người.", nút "Gán người nói" (`meetings.scribe.speakersButton`, icon `UserPen`, outline) thay "Chốt biên bản", ẩn "Lên lịch họp tiếp" khi còn người nói chưa tên.

- [x] **Bước 1: Viết test hỏng.**
  - `next-step-jobs.test.ts`: "an in-person meeting being transcribed" → `{kind:"transcribing", minutes: 42, etaMinutes: 4}` với `estimated_seconds: 2538`; "close-out names unnamed speakers first" → `closeOut.unnamedSpeakers === 3`.
  - `meeting-detail-view.test.tsx`: "shows the transcription under way" (dải + thẻ tóm tắt + ô việc, không "Soạn tóm tắt"); "asks to name speakers before finalizing" ("3 người nói chưa có tên · 13 việc chờ giao", "Gán người nói" mở hộp thoại gán, không "Chốt biên bản", không "Lên lịch họp tiếp"; khi tên đủ thì trở lại như cũ).
  - `transcript-tab.test.tsx` "offers Gán người nói beside the speaker filter while some are unnamed".
- [x] **Bước 2: Chạy** `… vitest run meetings/meeting-detail meetings/meeting-detail-view.test.tsx` → FAIL.
- [x] **Bước 3: Cài.**
- [x] **Bước 4: Chạy** lại → PASS; so `shots/p07-processing.png`, `p08-roll.png` (điểm danh đến từ server, Task 2), `p09-done.png`, `p10-done-transcript.png`.
- [x] **Bước 5: Commit** `feat(meetings): show an in-person meeting's transcription and its unnamed speakers`.

### Task 12: Views — bản ghi chưa gửi, đăng xuất (bảng 12)

**Files:**
- Modify: `meeting-detail/next-step-jobs.ts` (job `{ kind: "unsent"; seconds: number; savedAt: number }` đứng đầu), `meeting-detail/strip-rows.tsx` (`UnsentRow`), `meeting-detail/detail-header.tsx` (`statusOverride?: DetailStatus`), `meeting-detail-view.tsx` (`useUnsentRecordings`)
- Create: `packages/views/layout/logout-unsent-guard.tsx`
- Modify: `packages/views/layout/account-menu.tsx`, `packages/views/settings/components/chat-settings-page.tsx`
- Modify: i18n vi/en
- Test: `meeting-detail-view.test.tsx`, `next-step-jobs.test.ts`, `packages/views/layout/account-menu.test.tsx` (mới hoặc có sẵn)

**Interfaces:**
- Consumes: Task 5 (`useUnsentRecordings`, `openRecordingStore().deletePart`), Task 8 (`StripHandlers.onRecord`).
- Produces: `useLogoutUnsentGuard(userId): { confirmLogout: (logout: () => Promise<void>) => void; dialog: ReactNode }`.
- Chữ (`shots/p11-unsent.png`): `meetings.record.unsentTitle` "Còn bản ghi {{duration}} chưa gửi trên máy này"; `meetings.record.unsentSub` "Lưu lúc {{time}} · chỉ bạn thấy trên máy này"; nút outline "Ghi tiếp" (icon `Mic`) → `onRecord()`; nút chính "Kết thúc và gửi" (icon `CloudUpload`) → `onRecord({ send: true })`; menu ⋯ `meetings.record.deleteLocal` "Xoá bản ghi trên máy…" (xác nhận `meetings.record.deleteLocalConfirm` "Xoá bản ghi này khỏi máy? Không lấy lại được."); pill trạng thái hiện "Đang diễn ra" khi cuộc họp còn `SCHEDULED`; đăng xuất: `meetings.record.logoutTitle` "Còn {{count}} bản ghi chưa gửi", `meetings.record.logoutBody` "Bản ghi vẫn nằm trên máy này. Đăng nhập lại để gửi.", xác nhận `meetings.record.logoutAnyway` "Vẫn đăng xuất", huỷ `meetings.record.stay` "Ở lại".
- Hình: hàng dải có ô `size-5.5 rounded-md bg-warning-soft text-warning` + `AudioLines` trước tiêu đề, dòng phụ thụt theo tiêu đề; bỏ "Thêm vào lịch" và dòng "người chưa phản hồi" khi có bản ghi chưa gửi.

- [x] **Bước 1: Viết test hỏng.**
  - `meeting-detail-view.test.tsx` "an unsent recording comes first": store có phần 35:12 → dải "Còn bản ghi 35:12 chưa gửi trên máy này", "Ghi tiếp" gọi `onRecord()`, "Kết thúc và gửi" gọi `onRecord({ send: true })`, pill "Đang diễn ra"; người khác trên cùng máy (userId khác) không thấy.
  - "deletes the local recording after confirming".
  - `account-menu.test.tsx` "warns before signing out with an unsent recording": "Đăng xuất" → "Còn 1 bản ghi chưa gửi"; "Ở lại" không gọi `logout`; "Vẫn đăng xuất" gọi; không có bản ghi → đăng xuất ngay.
- [x] **Bước 2: Chạy** `… vitest run meetings/meeting-detail-view.test.tsx layout/account-menu.test.tsx` → FAIL.
- [x] **Bước 3: Cài.**
- [x] **Bước 4: Chạy** lại → PASS; so `shots/p11-unsent.png`.
- [x] **Bước 5: Commit** `feat(meetings): offer to continue or send a recording left on this device`.

### Task 13: E2E, tài liệu, rà soát cuối

**Files:**
- Create: `e2e/meeting-in-person.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-28-meeting-in-person-recorder-design.md` (mục "Bổ sung sau khi duyệt": cột `venue`, `duration_seconds`, `offset_seconds`, link canvas), file plan này (đánh dấu task)

- [x] **Bước 1: Viết spec e2e** (Chromium `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` theo cấu hình Playwright hiện có; `page.route("**/meeting-capabilities")` đặt `transcription: true`):
  - "records an in-person meeting and keeps it across a reload": Họp ngay → "Trực tiếp" → "Chuẩn bị ghi âm" → URL `/record` → tích ô xác nhận → "Bắt đầu ghi âm" → thấy "Đang ghi âm" và đồng hồ ≥ `0:03` → "Tạm dừng" → "Đã tạm dừng" → tải lại trang → mở trang cuộc họp → thấy "Còn bản ghi" và "Kết thúc và gửi".
  - "an in-person meeting page offers Bắt đầu ghi âm, not a room".
- [x] **Bước 2: Chạy** `E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/meeting-in-person.spec.ts` (app đang chạy) → PASS.
- [x] **Bước 3: Cập nhật spec và plan; chạy** `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `cd server && go vet ./... && go tool staticcheck ./...` → sạch; Go và TS test có chọn lọc của mọi task chạy lại một lượt.
- [x] **Bước 4: Commit** `test(meetings): e2e for recording an in-person meeting` và `docs: in-person recorder spec and plan`.
