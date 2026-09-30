# Meetings — Điểm danh (đợt 1) Implementation Plan

> **Trạng thái:** in-progress — UNI-892, nhánh `feature/UNI-892-meetings-diem-danh-thanh-vien-du-thinh-t`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chủ trì/thư ký điểm danh thành viên chính thức của cuộc họp (gợi ý tự động từ dữ liệu vào phòng, sửa tay, chốt), có tỉ lệ có mặt tối thiểu, vai Thư ký và phân biệt Thành viên/Dự thính — trong phòng họp và trên trang chi tiết.

**Architecture:** Cột mới trên `meeting_participants` (`standing`, `is_secretary`) và `meetings` (`quorum_percent`, `attendance_finalized_*`), bảng `meeting_attendance_marks`. `MeetingService` thêm cổng `requireMeetingClerk`, báo cáo điểm danh tính lúc đọc (gợi ý từ `meeting_attendance_sessions` + dòng tay), và bốn lệnh ghi audit+outbox qua `s.record`. Web: endpoint + hook riêng trong `packages/core`, panel điểm danh dùng chung cho tab Người tham gia và thẻ ở trang chi tiết.

**Tech Stack:** Go 1.27 + pgx/sqlc + chi; Postgres; Next.js/React 19 + TanStack Query + zod; vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-meeting-attendance-voting-design.md` (đợt 1 = §3.1–3.4, §4, §5.1 phần participants/attendance, §6 phần attendance/participant, §7.2–7.3 phần điểm danh). Đợt 2 (Biểu quyết) có plan riêng, viết sau khi đợt này merge.

**Sai khác có chủ ý so với spec:** hook nằm ở `packages/core/meetings/attendance-hooks.ts` (export `@uniwork/core/meetings/attendance`) thay vì `governance-hooks.ts` — đợt 2 thêm `motion-hooks.ts` riêng để mỗi file dưới 500 dòng; endpoint cũng tách file `meeting-attendance.ts` vì `meetings.ts` đã 474 dòng hiệu lực. `finalized_at`/`finalized_by` bị bỏ khỏi JSON khi rỗng (`omitempty`) thay vì `null`; client coi hai cách như nhau.

## Global Constraints

- Migration: không FK; mỗi index một file `CREATE [UNIQUE] INDEX CONCURRENTLY`; bảng mới có `organization_id TEXT NOT NULL`; tên file `999<unix-ms>_<name>.{up,down}.sql`, prefix phải lớn hơn `9991790654971297`.
- Query ở `server/pkg/db/queries/*.sql`, chạy `make sqlc`, commit `server/pkg/db/generated/`.
- Mọi lệnh đổi trạng thái gọi `s.record(ctx, q, m, actor, topic, payload, changes)` trong cùng transaction; topic mới thêm vào `meetingActionFor` (`server/internal/service/meeting.go`).
- Sự kiện mới thêm đủ ba nơi: `docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`. Payload chỉ id.
- Trạng thái điểm danh: `PRESENT` | `LATE` | `EXCUSED` | `ABSENT`. Nguồn: `AUTO` | `MANUAL` | `SUGGESTED` (chỉ ở API, không lưu).
- `standing`: `MEMBER` | `OBSERVER`. Khách mặc định `OBSERVER`; khách không được `is_secretary=true` (422 `guest_cannot_be_secretary`).
- Ân hạn đến muộn: `10 * time.Minute`, không cấu hình. Đúng mốc+10:00 vẫn `PRESENT`.
- `note` ≤ 200 ký tự, chỉ lưu khi `EXCUSED`.
- `quorum_percent`: 1–100 hoặc NULL; API nhận `0` = xoá.
- Web: response parse qua `parseWithFallback`; file `.ts/.tsx` ≤ 500 dòng (không tính dòng trống/comment); chuỗi qua `t()`, `vi.json` trước rồi `en.json`, số nhiều `_one/_other`; token màu ngữ nghĩa, icon lucide; comment code bằng tiếng Anh.
- Chạy test Go đơn lẻ: `set -a && . ./.env && set +a && cd server && go test ./internal/<pkg> -run '<Regex>' -count=1`.
- Chạy vitest đơn lẻ: `pnpm --filter @uniwork/core exec vitest run <path>` / `pnpm --filter @uniwork/views exec vitest run <path>`.
- E2E: chỉ chạy spec của đợt này; cổng cuối `make check`.

## Review Focus

1. **Người bị gỡ khỏi cuộc họp sau khi đã được điểm danh** — không còn trong danh sách và tổng hợp (report chỉ lấy `ACTIVE`). Test ở Task 3.
2. **Cuộc họp không có thành viên chính thức nào** (mọi người là dự thính) — tổng hợp toàn 0, `quorum_met` null, chốt vẫn chạy. Test ở Task 3 và Task 4.
3. **Vào/ra phòng nhiều lần** — giờ vào = lần đầu, thời gian cộng dồn, "đang trong phòng" khi còn phiên mở, `last_left_at` rỗng khi đang trong phòng. Test ở Task 3.
4. **Thư ký bị bỏ vai giữa chừng** — request kế tiếp của họ bị 403 ngay (không cache quyền). Test ở Task 2.
5. **Chốt hai lần liên tiếp / mở lại sau khi đã sửa tay** — chốt lần hai không đổi gì và không ghi audit thêm; mở lại giữ dòng `MANUAL`. Test ở Task 4.

---

## File Structure

**Server — tạo mới**
- `server/migrations/9991790740000001_meeting_governance_columns.{up,down}.sql` — cột mới + backfill khách.
- `server/migrations/9991790740000002_meeting_attendance_marks.{up,down}.sql` — bảng.
- `server/migrations/9991790740000003_meeting_attendance_marks_uidx.{up,down}.sql` — unique index.
- `server/pkg/db/queries/meeting_attendance.sql` — query điểm danh.
- `server/internal/service/meeting_attendance.go` — hằng số, `suggestAttendance`, report, lệnh điểm danh.
- `server/internal/service/meeting_duties.go` — `requireMeetingClerk`, `UpdateParticipantDuties`.
- `server/internal/service/meeting_attendance_test.go`, `meeting_duties_test.go`.
- `server/internal/handler/meeting_attendance.go` + `meeting_attendance_test.go`.

**Server — sửa**
- `server/pkg/db/queries/meeting_control.sql` (`CreateMeetingParticipant` gán `standing` theo principal).
- `server/pkg/db/queries/meetings.sql` (`UpdateMeeting` + `quorum_percent`).
- `server/internal/service/meeting.go` (`meetingActionFor`, `UpdateMeetingInput.QuorumPercent`, `Update`).
- `server/internal/service/meeting_queries.go` (webhook phát `attendance.updated`).
- `server/internal/service/errors.go` (`errNotClerk`).
- `server/internal/handler/dto/sdi/meeting.go`, `dto/sdo/meeting.go`, `handler/meeting.go` (`toMeetingDTO`, `updateMeeting`), `handler/meeting_control.go` (`toParticipantDTO`).
- `server/internal/handler/router/meetings.go`, `router/routes.go`, `handler/router.go`.
- `server/internal/realtime/publisher.go` (`participant.updated` sang scope meeting).
- `server/internal/outbox/catalogue.go`, `docs/events/CATALOGUE.md`.

**Web — tạo mới**
- `packages/core/api/endpoints/meeting-attendance.ts` + `.test.ts`.
- `packages/core/meetings/attendance-hooks.ts` + `.test.ts`.
- `packages/views/meetings/meeting-duty-menu-items.tsx` + `.test.tsx`.
- `packages/views/meetings/meeting-attendance-summary.tsx`.
- `packages/views/meetings/meeting-attendance-row.tsx`.
- `packages/views/meetings/meeting-attendance-panel.tsx` + `.test.tsx`.
- `packages/views/meetings/meeting-attendance-card.tsx`.
- `e2e/meetings-attendance.spec.ts`.

**Web — sửa**
- `packages/core/types/meeting.ts`, `types/events.ts`, `package.json` (export `./meetings/attendance`).
- `packages/core/meetings/hooks.ts` (`meetingKeys.attendance`), `meetings/status.ts` (activity key).
- `packages/core/permissions/rules.ts` (`canClerkMeeting`) + test.
- `packages/core/api/endpoints/meetings.ts` (`UpdateMeetingBody.quorum_percent`).
- `packages/core/realtime/use-realtime-sync.ts`, `realtime/use-meeting-lobby-sync.ts`.
- `packages/core/i18n/locales/vi.json`, `en.json`.
- `packages/views/meetings/meeting-signals.ts` (`MeetingParticipantRole`), `meeting-role-chip.tsx`, `meeting-participant-row.tsx` (slot menu), `meeting-room-people-tab.tsx`, `meeting-participants-section.tsx`, `meeting-detail-view.tsx`, `meeting-edit-dialog.tsx`.

---

### Task 1: Migration + query nền

**Files:**
- Create: `server/migrations/9991790740000001_meeting_governance_columns.up.sql`, `.down.sql`
- Create: `server/migrations/9991790740000002_meeting_attendance_marks.up.sql`, `.down.sql`
- Create: `server/migrations/9991790740000003_meeting_attendance_marks_uidx.up.sql`, `.down.sql`
- Create: `server/pkg/db/queries/meeting_attendance.sql`
- Modify: `server/pkg/db/queries/meeting_control.sql:1-8` (`CreateMeetingParticipant`)
- Test: `server/internal/service/meeting_duties_test.go` (test đầu tiên)

**Interfaces:**
- Produces (sqlc, `db` package): cột `MeetingParticipant.Standing string`, `MeetingParticipant.IsSecretary bool`, `Meeting.QuorumPercent pgtype.Int2`, `Meeting.AttendanceFinalizedAt pgtype.Timestamptz`, `Meeting.AttendanceFinalizedBy pgtype.Text`; struct `MeetingAttendanceMark`; queries `ListAttendanceMarks`, `UpsertAttendanceMark`, `InsertAutoAttendanceMark`, `DeleteAttendanceMark`, `DeleteAutoAttendanceMarks`, `SetAttendanceFinalized`, `AttendanceSessionTotals`, `UpdateParticipantDuties`.

- [ ] **Step 1: Viết migration**

`9991790740000001_meeting_governance_columns.up.sql`:
```sql
-- Formal-meeting attendance (spec 2026-09-30 §3.1–3.2). No FKs (post-004 rule).
ALTER TABLE meeting_participants
  ADD COLUMN IF NOT EXISTS standing TEXT NOT NULL DEFAULT 'MEMBER',
  ADD COLUMN IF NOT EXISTS is_secretary BOOLEAN NOT NULL DEFAULT false;

-- Guests who got in through a link or an approval are observers by default.
UPDATE meeting_participants SET standing = 'OBSERVER' WHERE principal_type = 'GUEST';

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS quorum_percent SMALLINT,
  ADD COLUMN IF NOT EXISTS attendance_finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_finalized_by TEXT;
```
`.down.sql`:
```sql
ALTER TABLE meetings
  DROP COLUMN IF EXISTS attendance_finalized_by,
  DROP COLUMN IF EXISTS attendance_finalized_at,
  DROP COLUMN IF EXISTS quorum_percent;
ALTER TABLE meeting_participants
  DROP COLUMN IF EXISTS is_secretary,
  DROP COLUMN IF EXISTS standing;
```
`9991790740000002_meeting_attendance_marks.up.sql`:
```sql
-- One row per participant once a clerk marks them or attendance is finalized.
CREATE TABLE IF NOT EXISTS meeting_attendance_marks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  marked_by TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
`.down.sql`: `DROP TABLE IF EXISTS meeting_attendance_marks;`

`9991790740000003_meeting_attendance_marks_uidx.up.sql`:
```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_attendance_marks_participant ON meeting_attendance_marks (meeting_id, participant_id);
```
`.down.sql`: `DROP INDEX CONCURRENTLY IF EXISTS uidx_meeting_attendance_marks_participant;`

- [ ] **Step 2: Sửa `CreateMeetingParticipant` để khách luôn là dự thính**

Trong `server/pkg/db/queries/meeting_control.sql`, thay câu insert đầu file:
```sql
-- name: CreateMeetingParticipant :one
-- A guest starts as an observer on every path that creates one (invite link,
-- join approval); a user starts as a member.
INSERT INTO meeting_participants (
  id, meeting_id, principal_type, user_id, guest_id, display_name_snapshot, email_snapshot,
  role, status, source_type, source_id, added_by, standing
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, $10, $11,
  CASE WHEN $3 = 'GUEST' THEN 'OBSERVER' ELSE 'MEMBER' END
)
RETURNING *;
```

- [ ] **Step 3: Viết `server/pkg/db/queries/meeting_attendance.sql`**

```sql
-- name: ListAttendanceMarks :many
SELECT * FROM meeting_attendance_marks WHERE meeting_id = $1;

-- name: UpsertAttendanceMark :one
INSERT INTO meeting_attendance_marks (id, organization_id, meeting_id, participant_id, status, note, source, marked_by)
VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', $7)
ON CONFLICT (meeting_id, participant_id) DO UPDATE SET
  status = EXCLUDED.status,
  note = EXCLUDED.note,
  source = 'MANUAL',
  marked_by = EXCLUDED.marked_by,
  marked_at = now()
RETURNING *;

-- name: InsertAutoAttendanceMark :exec
INSERT INTO meeting_attendance_marks (id, organization_id, meeting_id, participant_id, status, source)
VALUES ($1, $2, $3, $4, $5, 'AUTO')
ON CONFLICT (meeting_id, participant_id) DO NOTHING;

-- name: DeleteAttendanceMark :execrows
DELETE FROM meeting_attendance_marks WHERE meeting_id = $1 AND participant_id = $2;

-- name: DeleteAutoAttendanceMarks :exec
DELETE FROM meeting_attendance_marks WHERE meeting_id = $1 AND source = 'AUTO';

-- name: SetAttendanceFinalized :one
UPDATE meetings SET
  attendance_finalized_at = sqlc.narg('finalized_at'),
  attendance_finalized_by = sqlc.narg('finalized_by')
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: AttendanceSessionTotals :many
SELECT
  participant_id,
  min(joined_at)::timestamptz AS first_joined_at,
  (CASE WHEN bool_or(left_at IS NULL) THEN NULL ELSE max(left_at) END)::timestamptz AS last_left_at,
  bool_or(left_at IS NULL) AS in_room,
  count(*)::int AS session_count,
  COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(left_at, now()) - joined_at))), 0)::bigint AS present_seconds
FROM meeting_attendance_sessions
WHERE meeting_id = $1
GROUP BY participant_id;

-- name: UpdateParticipantDuties :one
UPDATE meeting_participants SET
  standing = COALESCE(sqlc.narg('standing'), standing),
  is_secretary = COALESCE(sqlc.narg('is_secretary'), is_secretary)
WHERE id = sqlc.arg('id') AND status = 'ACTIVE'
RETURNING *;
```

- [ ] **Step 4: Sinh code, kiểm biên dịch và lint migration**

Run: `make sqlc && cd server && go build ./... && set -a && . ../.env && set +a && go test ./migrations -count=1`
Expected: build OK; `ok .../migrations`. Nếu `TestMigrationPrefixesSortTheSameAsStringsAndNumbers` đỏ, đổi prefix sang `999$(date +%s%3N)` tăng dần.

- [ ] **Step 5: Viết test thất bại cho mặc định standing**

Tạo `server/internal/service/meeting_duties_test.go`:
```go
package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// governanceFixture: a live instant meeting hosted by ua with ub invited,
// started an hour ago so seeded room sessions (relative to the start) sit in
// the past — an open session in the future would add negative seconds.
func governanceFixture(t *testing.T) (*MeetingService, db.User, db.User, db.Meeting, string) {
	t.Helper()
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx,
		`UPDATE meetings SET actual_start_at = now() - interval '1 hour', starts_at = now() - interval '1 hour' WHERE id = $1`,
		m.ID); err != nil {
		t.Fatal(err)
	}
	p, err := s.Invite(ctx, ua.ID, m.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	return s, ua, ub, m, p.ID
}

func TestParticipantStandingDefaults(t *testing.T) {
	s, _, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	member, err := s.q.GetMeetingParticipant(ctx, memberPID)
	if err != nil {
		t.Fatal(err)
	}
	if member.Standing != StandingMember || member.IsSecretary {
		t.Fatalf("user participant = %q secretary=%v, want MEMBER/false", member.Standing, member.IsSecretary)
	}
	guest, err := s.q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: util.NewID(), MeetingID: m.ID, PrincipalType: PrincipalGuest,
		GuestID: strText(util.NewID()), DisplayNameSnapshot: "Khách", Role: RoleAttendee,
		SourceType: GrantInviteLink, AddedBy: "system",
	})
	if err != nil {
		t.Fatal(err)
	}
	if guest.Standing != StandingObserver {
		t.Fatalf("guest standing = %q, want OBSERVER", guest.Standing)
	}
}
```

- [ ] **Step 6: Chạy test, thấy đỏ**

Run: `set -a && . ./.env && set +a && cd server && go test ./internal/service -run TestParticipantStandingDefaults -count=1`
Expected: FAIL biên dịch `undefined: StandingMember`.

- [ ] **Step 7: Thêm hằng số**

Tạo `server/internal/service/meeting_duties.go` (phần còn lại viết ở Task 2):
```go
package service

// Standing decides whether a participant counts toward attendance and votes.
const (
	StandingMember   = "MEMBER"
	StandingObserver = "OBSERVER"
)
```

- [ ] **Step 8: Chạy lại test**

Run: như Step 6. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/migrations/9991790740000001_* server/migrations/9991790740000002_* server/migrations/9991790740000003_* \
  server/pkg/db/queries/meeting_attendance.sql server/pkg/db/queries/meeting_control.sql server/pkg/db/generated \
  server/internal/service/meeting_duties.go server/internal/service/meeting_duties_test.go
git commit -m "feat(meetings): add attendance schema, participant standing and secretary flag"
```

---

### Task 2: Cổng clerk + đổi vai (Thành viên/Dự thính, Thư ký)

**Files:**
- Modify: `server/internal/service/meeting_duties.go`
- Modify: `server/internal/service/errors.go` (sau `errNotHost`)
- Modify: `server/internal/service/meeting.go:469-485` (`meetingActionFor`)
- Modify: `server/internal/outbox/catalogue.go:191`, `docs/events/CATALOGUE.md:155`, `packages/core/types/events.ts:99`
- Modify: `server/internal/realtime/publisher.go:13-26`
- Test: `server/internal/service/meeting_duties_test.go`

**Interfaces:**
- Consumes: Task 1 `db.UpdateParticipantDutiesParams{ID string; Standing pgtype.Text; IsSecretary pgtype.Bool}`.
- Produces:
  - `func (s *MeetingService) requireMeetingClerk(ctx context.Context, userID, meetingID string) (db.Meeting, error)`
  - `type ParticipantDutiesInput struct { Standing *string; IsSecretary *bool }`
  - `func (s *MeetingService) UpdateParticipantDuties(ctx context.Context, actorID, meetingID, participantID string, in ParticipantDutiesInput) (db.MeetingParticipant, error)`
  - Topic `participant.updated` (payload `meeting_id`, `version`, `participant_id`), action `meeting.participant_updated`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `meeting_duties_test.go`:
```go
func TestUpdateParticipantDutiesPermissions(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	yes, no := true, false
	observer := StandingObserver

	// A member who is not the host cannot hand out roles.
	if _, err := s.UpdateParticipantDuties(ctx, ub.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); !codedIs(err, "not_meeting_host") {
		t.Fatalf("member assigns secretary: %v", err)
	}
	// Host makes ub secretary: ub now passes the clerk gate.
	p, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes})
	if err != nil || !p.IsSecretary {
		t.Fatalf("host assigns secretary: %+v %v", p, err)
	}
	if _, err := s.requireMeetingClerk(ctx, ub.ID, m.ID); err != nil {
		t.Fatalf("secretary clerk gate: %v", err)
	}
	// A secretary still cannot change standing or appoint anyone.
	if _, err := s.UpdateParticipantDuties(ctx, ub.ID, m.ID, memberPID, ParticipantDutiesInput{Standing: &observer}); !codedIs(err, "not_meeting_host") {
		t.Fatalf("secretary changes standing: %v", err)
	}
	// Demoted: the very next request is refused.
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &no}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.requireMeetingClerk(ctx, ub.ID, m.ID); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("demoted secretary clerk gate: %v", err)
	}
	// Host is always a clerk.
	if _, err := s.requireMeetingClerk(ctx, ua.ID, m.ID); err != nil {
		t.Fatalf("host clerk gate: %v", err)
	}
}

func TestUpdateParticipantDutiesValidation(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	yes := true
	bad := "VOTER"
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{Standing: &bad}); err == nil {
		t.Fatal("unknown standing accepted")
	}
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{}); err == nil {
		t.Fatal("empty patch accepted")
	}
	guest, err := s.q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: util.NewID(), MeetingID: m.ID, PrincipalType: PrincipalGuest,
		GuestID: strText(util.NewID()), DisplayNameSnapshot: "Khách", Role: RoleAttendee,
		SourceType: GrantInviteLink, AddedBy: "system",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, guest.ID, ParticipantDutiesInput{IsSecretary: &yes}); !codedIs(err, "guest_cannot_be_secretary") {
		t.Fatalf("guest secretary: %v", err)
	}
	member := StandingMember
	promoted, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, guest.ID, ParticipantDutiesInput{Standing: &member})
	if err != nil || promoted.Standing != StandingMember {
		t.Fatalf("promote guest to member: %+v %v", promoted, err)
	}
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, "nope", ParticipantDutiesInput{Standing: &member}); err != ErrNotFound {
		t.Fatalf("unknown participant: %v", err)
	}
}
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `set -a && . ./.env && set +a && cd server && go test ./internal/service -run 'TestUpdateParticipantDuties' -count=1`
Expected: FAIL biên dịch `undefined: ParticipantDutiesInput`.

- [ ] **Step 3: Thêm lỗi clerk vào `errors.go`**

Ngay sau `errNotHost`:
```go
func errNotClerk() error {
	return coded(http.StatusForbidden, "not_meeting_clerk", "chỉ chủ tọa, thư ký hoặc quản trị workspace mới được thực hiện")
}
```

- [ ] **Step 4: Cài đặt `meeting_duties.go`**

```go
package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Standing decides whether a participant counts toward attendance and votes.
const (
	StandingMember   = "MEMBER"
	StandingObserver = "OBSERVER"
)

// requireMeetingClerk lets through whoever runs attendance (and later votes):
// the host, a workspace admin, or an active signed-in participant the host
// made secretary. Read on every request, so a demotion bites immediately.
func (s *MeetingService) requireMeetingClerk(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	m, mem, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.HostUserID == userID || isWSAdmin(mem.Role) {
		return m, nil
	}
	p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: meetingID, UserID: strText(userID)})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, err
	}
	if err == nil && p.IsSecretary {
		return m, nil
	}
	return db.Meeting{}, errNotClerk()
}

type ParticipantDutiesInput struct {
	Standing    *string
	IsSecretary *bool
}

// UpdateParticipantDuties sets who votes (standing) and who may clerk.
// Host/admin only: a secretary must not be able to widen their own circle.
func (s *MeetingService) UpdateParticipantDuties(ctx context.Context, actorID, meetingID, participantID string, in ParticipantDutiesInput) (db.MeetingParticipant, error) {
	if in.Standing == nil && in.IsSecretary == nil {
		return db.MeetingParticipant{}, Invalid("không có thay đổi nào")
	}
	if in.Standing != nil && *in.Standing != StandingMember && *in.Standing != StandingObserver {
		return db.MeetingParticipant{}, Invalid("standing phải là MEMBER hoặc OBSERVER")
	}
	m, err := s.requireHostOrAdmin(ctx, actorID, meetingID)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	if m.Status == MeetingCanceled {
		return db.MeetingParticipant{}, errInvalidState()
	}
	p, err := s.q.GetMeetingParticipant(ctx, participantID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (p.MeetingID != meetingID || p.Status != ParticipantActive)) {
		return db.MeetingParticipant{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	if in.IsSecretary != nil && *in.IsSecretary && p.PrincipalType != PrincipalUser {
		return db.MeetingParticipant{}, coded(http.StatusUnprocessableEntity, "guest_cannot_be_secretary", "khách không thể làm thư ký")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	params := db.UpdateParticipantDutiesParams{ID: participantID}
	if in.Standing != nil {
		params.Standing = pgtype.Text{String: *in.Standing, Valid: true}
	}
	if in.IsSecretary != nil {
		params.IsSecretary = pgtype.Bool{Bool: *in.IsSecretary, Valid: true}
	}
	up, err := q.UpdateParticipantDuties(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingParticipant{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	s.record(ctx, q, m, audit.User(actorID), "participant.updated",
		meetingRelatedPayload(m, map[string]string{"participant_id": participantID}),
		audit.Diff(
			map[string]any{"standing": p.Standing, "is_secretary": p.IsSecretary},
			map[string]any{"standing": up.Standing, "is_secretary": up.IsSecretary},
		))
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingParticipant{}, err
	}
	return up, nil
}
```
Nếu sqlc sinh kiểu khác cho `sqlc.narg('standing')`/`sqlc.narg('is_secretary')` (xem `pkg/db/generated/meeting_attendance.sql.go`), sửa `params` cho khớp; hành vi không đổi.

- [ ] **Step 5: Đăng ký topic + catalogue + chép sang scope meeting**

`meeting.go` — thêm vào `meetingActionFor`:
```go
	"participant.updated":   "meeting.participant_updated",
```
`catalogue.go` — sau dòng `participant.removed`:
```go
	{Topic: "participant.updated", Version: 1, Payload: []string{"meeting_id", "version", "participant_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
```
`docs/events/CATALOGUE.md` — sau dòng `participant.removed` (giữ thứ tự bảng hiện có):
```markdown
| `participant.updated` | 1 | `meeting_id`, `version`, `participant_id` | — | workspace | outbox |
```
`packages/core/types/events.ts` — thêm `"participant.updated",` vào danh sách, theo thứ tự chữ cái sau `"participant.removed"`.
`realtime/publisher.go` — thêm `"participant.updated": {},` vào `meetingLobbyEventTypes` (khách thấy nhãn Thư ký/Dự thính).

- [ ] **Step 6: Chạy test service + catalogue**

Run: `set -a && . ./.env && set +a && cd server && go test ./internal/service -run 'TestUpdateParticipantDuties|TestParticipantStandingDefaults' -count=1 && go test ./internal/outbox ./internal/realtime -count=1 && cd .. && node --test scripts/events-catalogue.test.mjs`
Expected: tất cả PASS.

- [ ] **Step 7: Commit**

```bash
git add server/internal/service/meeting_duties.go server/internal/service/meeting_duties_test.go server/internal/service/errors.go \
  server/internal/service/meeting.go server/internal/outbox/catalogue.go server/internal/realtime/publisher.go \
  docs/events/CATALOGUE.md packages/core/types/events.ts
git commit -m "feat(meetings): let the host appoint a secretary and mark observers"
```

---

### Task 3: Báo cáo điểm danh (gợi ý tự động + tổng hợp)

**Files:**
- Create: `server/internal/service/meeting_attendance.go`
- Test: `server/internal/service/meeting_attendance_test.go`

**Interfaces:**
- Consumes: Task 1 queries `AttendanceSessionTotals` (row `db.AttendanceSessionTotalsRow{ParticipantID string; FirstJoinedAt pgtype.Timestamptz; LastLeftAt pgtype.Timestamptz; InRoom bool; SessionCount int32; PresentSeconds int64}`), `ListAttendanceMarks`.
- Produces:
  - Hằng `AttendancePresent/Late/Excused/Absent`, `AttendanceSourceAuto/Manual/Suggested`, `attendanceLateGrace`.
  - `func attendanceAnchor(m db.Meeting) time.Time`
  - `func suggestAttendance(anchor time.Time, firstJoined *time.Time) string`
  - `type AttendanceRow struct { Participant db.MeetingParticipant; Status, Source, Note string; FirstJoinedAt, LastLeftAt pgtype.Timestamptz; InRoom bool; PresentSeconds int64; SessionCount int32 }`
  - `type AttendanceSummary struct { Members, Present, Late, Excused, Absent int; QuorumMet *bool }`
  - `type AttendanceReport struct { Meeting db.Meeting; Rows []AttendanceRow; Summary AttendanceSummary }`
  - `func (s *MeetingService) Attendance(ctx context.Context, userID, meetingID string) (AttendanceReport, error)`
  - `func (s *MeetingService) attendanceReport(ctx context.Context, q *db.Queries, m db.Meeting) (AttendanceReport, error)` — đợt 2 dùng lại để lập danh sách cử tri.

- [ ] **Step 1: Viết test thất bại**

Tạo `server/internal/service/meeting_attendance_test.go`:
```go
package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// seedSession inserts an attendance session relative to the meeting's anchor
// using the database clock (the colima Postgres clock runs ahead of Go's).
// left == "" leaves the session open.
func seedSession(t *testing.T, s *MeetingService, meetingID, participantID, join, left string) {
	t.Helper()
	_, err := s.pool.Exec(context.Background(), `
		INSERT INTO meeting_attendance_sessions (id, meeting_id, conference_session_id, participant_id, provider_participant_identity, joined_at, left_at)
		SELECT $1, m.id, 'test-conf', $2, 'uw_participant_' || $2,
		       COALESCE(m.actual_start_at, m.starts_at) + $3::interval,
		       COALESCE(m.actual_start_at, m.starts_at) + NULLIF($4::text, '')::interval
		FROM meetings m WHERE m.id = $5`,
		util.NewID(), participantID, join, left, meetingID)
	if err != nil {
		t.Fatal(err)
	}
}

func rowFor(t *testing.T, rep AttendanceReport, participantID string) AttendanceRow {
	t.Helper()
	for _, r := range rep.Rows {
		if r.Participant.ID == participantID {
			return r
		}
	}
	t.Fatalf("participant %s not in report", participantID)
	return AttendanceRow{}
}

func TestSuggestAttendanceGraceBoundary(t *testing.T) {
	anchor := time.Date(2026, 9, 30, 9, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { v := anchor.Add(d); return &v }
	cases := []struct {
		name  string
		first *time.Time
		want  string
	}{
		{"never joined", nil, AttendanceAbsent},
		{"early", at(-5 * time.Minute), AttendancePresent},
		{"exactly at grace", at(10 * time.Minute), AttendancePresent},
		{"one second late", at(10*time.Minute + time.Second), AttendanceLate},
	}
	for _, c := range cases {
		if got := suggestAttendance(anchor, c.first); got != c.want {
			t.Errorf("%s: got %s want %s", c.name, got, c.want)
		}
	}
}

func TestAttendanceAnchor(t *testing.T) {
	sched := time.Date(2026, 9, 30, 9, 0, 0, 0, time.UTC)
	actual := sched.Add(7 * time.Minute)
	scheduled := db.Meeting{MeetingType: MeetingTypeScheduled}
	scheduled.StartsAt.Time, scheduled.StartsAt.Valid = sched, true
	scheduled.ActualStartAt.Time, scheduled.ActualStartAt.Valid = actual, true
	if got := attendanceAnchor(scheduled); !got.Equal(sched) {
		t.Fatalf("scheduled anchor = %v", got)
	}
	instant := scheduled
	instant.MeetingType = MeetingTypeInstant
	if got := attendanceAnchor(instant); !got.Equal(actual) {
		t.Fatalf("instant anchor = %v", got)
	}
}

func TestAttendanceReportSuggestsAndAggregates(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	if err != nil {
		t.Fatal(err)
	}
	// Host: joined on time, left, came back and is still in the room.
	seedSession(t, s, m.ID, host.ID, "1 minute", "11 minutes")
	seedSession(t, s, m.ID, host.ID, "20 minutes", "")
	// Member: joined half an hour late, left after ten minutes.
	seedSession(t, s, m.ID, memberPID, "30 minutes", "40 minutes")

	rep, err := s.Attendance(ctx, ub.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	h := rowFor(t, rep, host.ID)
	if h.Status != AttendancePresent || h.Source != AttendanceSourceSuggested {
		t.Fatalf("host = %s/%s", h.Status, h.Source)
	}
	if !h.InRoom || h.LastLeftAt.Valid || h.SessionCount != 2 {
		t.Fatalf("host in_room=%v last_left=%v sessions=%d", h.InRoom, h.LastLeftAt, h.SessionCount)
	}
	if h.PresentSeconds < 600 {
		t.Fatalf("host present_seconds = %d, want >= 600", h.PresentSeconds)
	}
	mb := rowFor(t, rep, memberPID)
	if mb.Status != AttendanceLate || mb.InRoom || !mb.LastLeftAt.Valid || mb.PresentSeconds != 600 {
		t.Fatalf("member = %s in_room=%v left=%v secs=%d", mb.Status, mb.InRoom, mb.LastLeftAt.Valid, mb.PresentSeconds)
	}
	if rep.Summary.Members != 2 || rep.Summary.Present != 1 || rep.Summary.Late != 1 || rep.Summary.Absent != 0 {
		t.Fatalf("summary = %+v", rep.Summary)
	}
	if rep.Summary.QuorumMet != nil {
		t.Fatal("quorum_met must be nil without quorum_percent")
	}
}

func TestAttendanceReportExcludesRemovedAndObservers(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	observer := StandingObserver
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{Standing: &observer}); err != nil {
		t.Fatal(err)
	}
	rep, err := s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Observers are listed but not counted.
	if len(rep.Rows) != 2 || rep.Summary.Members != 1 {
		t.Fatalf("rows=%d members=%d", len(rep.Rows), rep.Summary.Members)
	}
	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, memberPID); err != nil {
		t.Fatal(err)
	}
	rep, err = s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rep.Rows {
		if r.Participant.ID == memberPID {
			t.Fatal("removed participant still listed")
		}
	}
}

func TestAttendanceQuorum(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host, _ := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET quorum_percent = 60 WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, err := s.Attendance(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	// 1 of 2 members present = 50% < 60%.
	if rep.Summary.QuorumMet == nil || *rep.Summary.QuorumMet {
		t.Fatalf("quorum_met = %v, want false", rep.Summary.QuorumMet)
	}
	seedSession(t, s, m.ID, memberPID, "2 minutes", "")
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if rep.Summary.QuorumMet == nil || !*rep.Summary.QuorumMet {
		t.Fatalf("quorum_met = %v, want true", rep.Summary.QuorumMet)
	}
	// Nobody is a member: the ratio is undefined, not "met".
	observer := StandingObserver
	for _, pid := range []string{host.ID, memberPID} {
		if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, pid, ParticipantDutiesInput{Standing: &observer}); err != nil {
			t.Fatal(err)
		}
	}
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if rep.Summary.Members != 0 || rep.Summary.QuorumMet != nil {
		t.Fatalf("no members: %+v", rep.Summary)
	}
}
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `set -a && . ./.env && set +a && cd server && go test ./internal/service -run 'TestSuggestAttendance|TestAttendance' -count=1`
Expected: FAIL biên dịch `undefined: suggestAttendance`.

- [ ] **Step 3: Cài đặt `meeting_attendance.go` (phần đọc)**

```go
package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	AttendancePresent = "PRESENT"
	AttendanceLate    = "LATE"
	AttendanceExcused = "EXCUSED"
	AttendanceAbsent  = "ABSENT"

	AttendanceSourceAuto      = "AUTO"
	AttendanceSourceManual    = "MANUAL"
	AttendanceSourceSuggested = "SUGGESTED"

	attendanceNoteMax = 200
)

// attendanceLateGrace: joining up to this long after the anchor still counts
// as on time. Fixed by the spec, not configurable.
const attendanceLateGrace = 10 * time.Minute

// attendanceAnchor is the moment "late" is measured from: the scheduled start,
// or the actual start for an instant meeting that had no schedule.
func attendanceAnchor(m db.Meeting) time.Time {
	if m.MeetingType == MeetingTypeInstant && m.ActualStartAt.Valid {
		return m.ActualStartAt.Time
	}
	return m.StartsAt.Time
}

// suggestAttendance derives a status from the first time someone entered.
func suggestAttendance(anchor time.Time, firstJoined *time.Time) string {
	if firstJoined == nil {
		return AttendanceAbsent
	}
	if firstJoined.Sub(anchor) > attendanceLateGrace {
		return AttendanceLate
	}
	return AttendancePresent
}

type AttendanceRow struct {
	Participant    db.MeetingParticipant
	Status         string
	Source         string
	Note           string
	FirstJoinedAt  pgtype.Timestamptz
	LastLeftAt     pgtype.Timestamptz
	InRoom         bool
	PresentSeconds int64
	SessionCount   int32
}

type AttendanceSummary struct {
	Members, Present, Late, Excused, Absent int
	// QuorumMet is nil when the meeting sets no quorum or has no members.
	QuorumMet *bool
}

type AttendanceReport struct {
	Meeting db.Meeting
	Rows    []AttendanceRow
	Summary AttendanceSummary
}

// Attendance is readable by every workspace member of the meeting.
func (s *MeetingService) Attendance(ctx context.Context, userID, meetingID string) (AttendanceReport, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return AttendanceReport{}, err
	}
	return s.attendanceReport(ctx, s.q, m)
}

// attendanceReport merges clerk marks over suggestions for every active
// participant. Observers are listed but never counted.
func (s *MeetingService) attendanceReport(ctx context.Context, q *db.Queries, m db.Meeting) (AttendanceReport, error) {
	ps, err := q.ListMeetingParticipants(ctx, m.ID)
	if err != nil {
		return AttendanceReport{}, err
	}
	totals, err := q.AttendanceSessionTotals(ctx, m.ID)
	if err != nil {
		return AttendanceReport{}, err
	}
	marks, err := q.ListAttendanceMarks(ctx, m.ID)
	if err != nil {
		return AttendanceReport{}, err
	}
	byTotals := make(map[string]db.AttendanceSessionTotalsRow, len(totals))
	for _, t := range totals {
		byTotals[t.ParticipantID] = t
	}
	byMark := make(map[string]db.MeetingAttendanceMark, len(marks))
	for _, mk := range marks {
		byMark[mk.ParticipantID] = mk
	}
	anchor := attendanceAnchor(m)
	rep := AttendanceReport{Meeting: m, Rows: make([]AttendanceRow, 0, len(ps))}
	for _, p := range ps {
		if p.Status != ParticipantActive {
			continue
		}
		row := AttendanceRow{Participant: p}
		if t, ok := byTotals[p.ID]; ok {
			row.FirstJoinedAt, row.LastLeftAt = t.FirstJoinedAt, t.LastLeftAt
			row.InRoom, row.SessionCount, row.PresentSeconds = t.InRoom, t.SessionCount, t.PresentSeconds
		}
		if mk, ok := byMark[p.ID]; ok {
			row.Status, row.Source, row.Note = mk.Status, mk.Source, mk.Note
		} else {
			var first *time.Time
			if row.FirstJoinedAt.Valid {
				f := row.FirstJoinedAt.Time
				first = &f
			}
			row.Status, row.Source = suggestAttendance(anchor, first), AttendanceSourceSuggested
		}
		rep.Rows = append(rep.Rows, row)
		if p.Standing != StandingMember {
			continue
		}
		rep.Summary.Members++
		switch row.Status {
		case AttendancePresent:
			rep.Summary.Present++
		case AttendanceLate:
			rep.Summary.Late++
		case AttendanceExcused:
			rep.Summary.Excused++
		default:
			rep.Summary.Absent++
		}
	}
	if m.QuorumPercent.Valid && rep.Summary.Members > 0 {
		met := (rep.Summary.Present+rep.Summary.Late)*100 >= int(m.QuorumPercent.Int16)*rep.Summary.Members
		rep.Summary.QuorumMet = &met
	}
	return rep, nil
}
```

- [ ] **Step 4: Chạy lại test**

Run: như Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/meeting_attendance.go server/internal/service/meeting_attendance_test.go
git commit -m "feat(meetings): derive attendance from room sessions and clerk marks"
```

---

### Task 4: Lệnh điểm danh (sửa, trả về gợi ý, chốt, mở lại) + webhook realtime

**Files:**
- Modify: `server/internal/service/meeting_attendance.go`
- Modify: `server/internal/service/meeting.go` (`meetingActionFor`)
- Modify: `server/internal/service/meeting_queries.go:77-104`
- Modify: `server/internal/outbox/catalogue.go`, `docs/events/CATALOGUE.md`, `packages/core/types/events.ts`
- Test: `server/internal/service/meeting_attendance_test.go`

**Interfaces:**
- Consumes: Task 2 `requireMeetingClerk`, `errNotClerk`; Task 3 `attendanceReport`, hằng số.
- Produces:
  - `func (s *MeetingService) MarkAttendance(ctx context.Context, actorID, meetingID, participantID, status, note string) error`
  - `func (s *MeetingService) ClearAttendanceMark(ctx context.Context, actorID, meetingID, participantID string) error`
  - `func (s *MeetingService) FinalizeAttendance(ctx context.Context, actorID, meetingID string) error`
  - `func (s *MeetingService) ReopenAttendance(ctx context.Context, actorID, meetingID string) error`
  - Topics `attendance.marked` (payload `meeting_id`, `version`, `participant_id`), `attendance.finalized`, `attendance.reopened` (payload `meeting_id`, `version`) — outbox; `attendance.updated` (payload `meeting_id`) — ephemeral.
  - Timeline event type `ATTENDANCE_FINALIZED`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `meeting_attendance_test.go`:
```go
func TestMarkAttendanceRules(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	// Not a clerk.
	if err := s.MarkAttendance(ctx, ub.ID, m.ID, memberPID, AttendancePresent, ""); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member marks: %v", err)
	}
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, "HERE", ""); err == nil {
		t.Fatal("unknown status accepted")
	}
	long := strings.Repeat("a", 201)
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendanceExcused, long); err == nil {
		t.Fatal("201-char note accepted")
	}
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendanceExcused, " Đi công tác "); err != nil {
		t.Fatal(err)
	}
	rep, _ := s.Attendance(ctx, ua.ID, m.ID)
	r := rowFor(t, rep, memberPID)
	if r.Status != AttendanceExcused || r.Source != AttendanceSourceManual || r.Note != "Đi công tác" {
		t.Fatalf("excused row = %+v", r)
	}
	// The note belongs to EXCUSED only.
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendanceAbsent, "ghi chú"); err != nil {
		t.Fatal(err)
	}
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if r := rowFor(t, rep, memberPID); r.Note != "" {
		t.Fatalf("note kept on ABSENT: %q", r.Note)
	}
	// Clear returns to the suggestion.
	if err := s.ClearAttendanceMark(ctx, ua.ID, m.ID, memberPID); err != nil {
		t.Fatal(err)
	}
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if r := rowFor(t, rep, memberPID); r.Source != AttendanceSourceSuggested {
		t.Fatalf("after clear source = %s", r.Source)
	}
}

func TestMarkAttendanceNeedsLiveOrEndedMeeting(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Sau", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	host, _ := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, host.ID, AttendancePresent, ""); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("scheduled meeting: %v", err)
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("finalize scheduled: %v", err)
	}
}

func TestFinalizeAndReopenAttendance(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host, _ := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendanceExcused, "ốm"); err != nil {
		t.Fatal(err)
	}
	// A secretary can finalize.
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	if err := s.FinalizeAttendance(ctx, ub.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, _ := s.Attendance(ctx, ua.ID, m.ID)
	if !rep.Meeting.AttendanceFinalizedAt.Valid || rep.Meeting.AttendanceFinalizedBy.String != ub.ID {
		t.Fatalf("finalized = %v by %q", rep.Meeting.AttendanceFinalizedAt, rep.Meeting.AttendanceFinalizedBy.String)
	}
	if r := rowFor(t, rep, host.ID); r.Source != AttendanceSourceAuto || r.Status != AttendancePresent {
		t.Fatalf("host snapshot = %+v", r)
	}
	// Twice is a no-op: one audit row for the finalize.
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.attendance_finalized' AND resource_id = $1`, m.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("finalize audit rows = %d, want 1", n)
	}
	// Finalized: clearing a mark is refused, marking still works.
	if err := s.ClearAttendanceMark(ctx, ua.ID, m.ID, memberPID); !codedIs(err, "attendance_finalized") {
		t.Fatalf("clear after finalize: %v", err)
	}
	// Someone joining after finalize does not change the record.
	var guestPID string
	guest, err := s.q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: util.NewID(), MeetingID: m.ID, PrincipalType: PrincipalGuest, GuestID: strText(util.NewID()),
		DisplayNameSnapshot: "Khách", Role: RoleAttendee, SourceType: GrantInviteLink, AddedBy: "system",
	})
	if err != nil {
		t.Fatal(err)
	}
	guestPID = guest.ID
	seedSession(t, s, m.ID, guestPID, "40 minutes", "")
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if r := rowFor(t, rep, guestPID); r.Source != AttendanceSourceSuggested || !r.InRoom {
		t.Fatalf("late joiner after finalize = %+v", r)
	}
	// Reopen drops AUTO rows, keeps MANUAL.
	if err := s.ReopenAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, _ = s.Attendance(ctx, ua.ID, m.ID)
	if rep.Meeting.AttendanceFinalizedAt.Valid {
		t.Fatal("still finalized after reopen")
	}
	if r := rowFor(t, rep, host.ID); r.Source != AttendanceSourceSuggested {
		t.Fatalf("host after reopen = %s", r.Source)
	}
	if r := rowFor(t, rep, memberPID); r.Source != AttendanceSourceManual || r.Status != AttendanceExcused {
		t.Fatalf("manual row after reopen = %+v", r)
	}
}

func TestFinalizeWithNoMembers(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host, _ := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	observer := StandingObserver
	for _, pid := range []string{host.ID, memberPID} {
		if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, pid, ParticipantDutiesInput{Standing: &observer}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	rep, _ := s.Attendance(ctx, ua.ID, m.ID)
	if rep.Summary.Members != 0 || !rep.Meeting.AttendanceFinalizedAt.Valid {
		t.Fatalf("no-member finalize: %+v", rep.Summary)
	}
}
```
Thêm `"strings"` vào import của file test.

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `set -a && . ./.env && set +a && cd server && go test ./internal/service -run 'TestMarkAttendance|TestFinalize' -count=1`
Expected: FAIL biên dịch `s.MarkAttendance undefined`.

- [ ] **Step 3: Cài đặt lệnh trong `meeting_attendance.go`**

Thêm import `errors`, `net/http`, `strings`, `unicode/utf8`, `github.com/jackc/pgx/v5`, `internal/audit`, `internal/util`, rồi:
```go
func validAttendanceStatus(s string) bool {
	switch s {
	case AttendancePresent, AttendanceLate, AttendanceExcused, AttendanceAbsent:
		return true
	}
	return false
}

func errAttendanceFinalized() error {
	return coded(http.StatusConflict, "attendance_finalized", "điểm danh đã chốt; hãy mở lại trước")
}

// attendanceMeeting gates every attendance command: clerk, and a meeting that
// has actually happened or is happening.
func (s *MeetingService) attendanceMeeting(ctx context.Context, actorID, meetingID string) (db.Meeting, error) {
	m, err := s.requireMeetingClerk(ctx, actorID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.Status != MeetingInProgress && m.Status != MeetingEnded {
		return db.Meeting{}, errInvalidState()
	}
	return m, nil
}

func (s *MeetingService) activeParticipantOf(ctx context.Context, meetingID, participantID string) (db.MeetingParticipant, error) {
	p, err := s.q.GetMeetingParticipant(ctx, participantID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (p.MeetingID != meetingID || p.Status != ParticipantActive)) {
		return db.MeetingParticipant{}, ErrNotFound
	}
	return p, err
}

// MarkAttendance records a clerk's call for one person. Allowed after
// finalize too: the record is corrected, and the audit row says who did it.
func (s *MeetingService) MarkAttendance(ctx context.Context, actorID, meetingID, participantID, status, note string) error {
	if !validAttendanceStatus(status) {
		return Invalid("trạng thái điểm danh không hợp lệ")
	}
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > attendanceNoteMax {
		return Invalid("lý do tối đa 200 ký tự")
	}
	if status != AttendanceExcused {
		note = ""
	}
	m, err := s.attendanceMeeting(ctx, actorID, meetingID)
	if err != nil {
		return err
	}
	if _, err := s.activeParticipantOf(ctx, meetingID, participantID); err != nil {
		return err
	}
	orgID, err := s.organizationOf(ctx, m)
	if err != nil {
		return err
	}
	before, err := s.attendanceReport(ctx, s.q, m)
	if err != nil {
		return err
	}
	prev := ""
	for _, r := range before.Rows {
		if r.Participant.ID == participantID {
			prev = r.Status
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.UpsertAttendanceMark(ctx, db.UpsertAttendanceMarkParams{
		ID: util.NewID(), OrganizationID: orgID, MeetingID: meetingID, ParticipantID: participantID,
		Status: status, Note: note, MarkedBy: strText(actorID),
	}); err != nil {
		return err
	}
	s.record(ctx, q, m, audit.User(actorID), "attendance.marked",
		meetingRelatedPayload(m, map[string]string{"participant_id": participantID}),
		audit.Diff(map[string]any{"status": prev}, map[string]any{"status": status}))
	return tx.Commit(ctx)
}

// ClearAttendanceMark hands one person back to the automatic suggestion.
func (s *MeetingService) ClearAttendanceMark(ctx context.Context, actorID, meetingID, participantID string) error {
	m, err := s.attendanceMeeting(ctx, actorID, meetingID)
	if err != nil {
		return err
	}
	if m.AttendanceFinalizedAt.Valid {
		return errAttendanceFinalized()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	n, err := q.DeleteAttendanceMark(ctx, db.DeleteAttendanceMarkParams{MeetingID: meetingID, ParticipantID: participantID})
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	s.record(ctx, q, m, audit.User(actorID), "attendance.marked",
		meetingRelatedPayload(m, map[string]string{"participant_id": participantID}),
		audit.Diff(map[string]any{"source": AttendanceSourceManual}, map[string]any{"source": AttendanceSourceSuggested}))
	return tx.Commit(ctx)
}

// FinalizeAttendance freezes today's suggestions into AUTO rows. Idempotent.
func (s *MeetingService) FinalizeAttendance(ctx context.Context, actorID, meetingID string) error {
	m, err := s.attendanceMeeting(ctx, actorID, meetingID)
	if err != nil {
		return err
	}
	if m.AttendanceFinalizedAt.Valid {
		return nil
	}
	orgID, err := s.organizationOf(ctx, m)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	rep, err := s.attendanceReport(ctx, q, m)
	if err != nil {
		return err
	}
	for _, r := range rep.Rows {
		if r.Source != AttendanceSourceSuggested {
			continue
		}
		if err := q.InsertAutoAttendanceMark(ctx, db.InsertAutoAttendanceMarkParams{
			ID: util.NewID(), OrganizationID: orgID, MeetingID: m.ID, ParticipantID: r.Participant.ID, Status: r.Status,
		}); err != nil {
			return err
		}
	}
	up, err := q.SetAttendanceFinalized(ctx, db.SetAttendanceFinalizedParams{
		ID: m.ID, FinalizedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, FinalizedBy: strText(actorID),
	})
	if err != nil {
		return err
	}
	_ = s.writeAudit(ctx, q, m.ID, "ATTENDANCE_FINALIZED", actorID, "", "", "{}")
	s.record(ctx, q, up, audit.User(actorID), "attendance.finalized", nil, nil)
	return tx.Commit(ctx)
}

// ReopenAttendance drops the frozen AUTO rows; clerk marks stay.
func (s *MeetingService) ReopenAttendance(ctx context.Context, actorID, meetingID string) error {
	m, err := s.attendanceMeeting(ctx, actorID, meetingID)
	if err != nil {
		return err
	}
	if !m.AttendanceFinalizedAt.Valid {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.DeleteAutoAttendanceMarks(ctx, m.ID); err != nil {
		return err
	}
	up, err := q.SetAttendanceFinalized(ctx, db.SetAttendanceFinalizedParams{ID: m.ID})
	if err != nil {
		return err
	}
	s.record(ctx, q, up, audit.User(actorID), "attendance.reopened", nil, nil)
	return tx.Commit(ctx)
}
```
Tên field `SetAttendanceFinalizedParams` (`FinalizedAt`, `FinalizedBy`) theo `sqlc.narg` ở Task 1; nếu sqlc sinh khác thì sửa theo code sinh ra.

- [ ] **Step 4: Đăng ký topic, catalogue, webhook**

`meetingActionFor` thêm:
```go
	"attendance.marked":     "meeting.attendance_marked",
	"attendance.finalized":  "meeting.attendance_finalized",
	"attendance.reopened":   "meeting.attendance_reopened",
```
`catalogue.go` (khối meeting):
```go
	{Topic: "attendance.marked", Version: 1, Payload: []string{"meeting_id", "version", "participant_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "attendance.finalized", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "attendance.reopened", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "attendance.updated", Version: 1, Payload: []string{"meeting_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
```
`docs/events/CATALOGUE.md` — bốn dòng tương ứng, theo thứ tự chữ cái của bảng:
```markdown
| `attendance.finalized` | 1 | `meeting_id`, `version` | — | workspace | outbox |
| `attendance.marked` | 1 | `meeting_id`, `version`, `participant_id` | — | workspace | outbox |
| `attendance.reopened` | 1 | `meeting_id`, `version` | — | workspace | outbox |
| `attendance.updated` | 1 | `meeting_id` | — | workspace | ephemeral |
```
`packages/core/types/events.ts` — thêm bốn tên theo thứ tự chữ cái.

`meeting_queries.go` — thêm helper cuối file:
```go
// publishAttendanceChanged tells open attendance panels to refetch after a
// webhook opened or closed a room session. Ephemeral: a lost frame only
// delays the refresh until the next one.
func (s *MeetingService) publishAttendanceChanged(ctx context.Context, meetingID string) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if err != nil {
		return
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "attendance.updated", Payload: map[string]string{"meeting_id": meetingID}})
}
```
và gọi nó sau `OpenAttendanceSession` (case `participant_joined`) và sau `CloseAttendanceSession` thành công (case `participant_left`):
```go
		if _, err := s.q.OpenAttendanceSession(ctx, db.OpenAttendanceSessionParams{
			ID: util.NewID(), MeetingID: sess.MeetingID, ConferenceSessionID: sess.ID,
			ParticipantID: pid, ProviderParticipantIdentity: ev.Identity,
			ProviderEventID: strText(ev.ProviderEventID),
		}); err == nil {
			s.publishAttendanceChanged(ctx, sess.MeetingID)
		}
```
```go
		if err == nil {
			s.meterAttendance(ctx, sess.MeetingID, closed)
			s.publishAttendanceChanged(ctx, sess.MeetingID)
		}
```

- [ ] **Step 5: Chạy test**

Run: `set -a && . ./.env && set +a && cd server && go test ./internal/service -run 'TestMarkAttendance|TestFinalize|TestAttendance|TestOpenAttendance|TestWebhook|TestAuditCoverage' -count=1 && go test ./internal/outbox -count=1 && cd .. && node --test scripts/events-catalogue.test.mjs`
Expected: PASS. Nếu `audit_coverage_test` yêu cầu liệt kê action mới (tìm `meeting.participant_invited` trong file đó để xem cách khai báo), thêm bốn action `meeting.participant_updated`, `meeting.attendance_marked`, `meeting.attendance_finalized`, `meeting.attendance_reopened` theo đúng mẫu.

- [ ] **Step 6: Commit**

```bash
git add server/internal/service/meeting_attendance.go server/internal/service/meeting_attendance_test.go server/internal/service/meeting.go \
  server/internal/service/meeting_queries.go server/internal/outbox/catalogue.go docs/events/CATALOGUE.md packages/core/types/events.ts
git commit -m "feat(meetings): mark, finalize and reopen attendance with audit and realtime"
```

---

### Task 5: Tỉ lệ có mặt tối thiểu qua PATCH meeting

**Files:**
- Modify: `server/pkg/db/queries/meetings.sql:70-83`
- Modify: `server/internal/service/meeting.go:322-365` (`UpdateMeetingInput`, `Update`)
- Modify: `server/internal/handler/dto/sdi/meeting.go:37-45`, `dto/sdo/meeting.go:19-38`, `handler/meeting.go:25-34,121-136`
- Test: `server/internal/service/meeting_attendance_test.go`

**Interfaces:**
- Produces: `UpdateMeetingInput.QuorumPercent *int` (0 = xoá); `MeetingDTO.QuorumPercent *int16 json:"quorum_percent"`; `PatchMeetingSDI.QuorumPercent *int`.

- [ ] **Step 1: Viết test thất bại**

```go
func TestUpdateMeetingQuorum(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	sixty, zero, bad := 60, 0, 101
	up, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{QuorumPercent: &sixty})
	if err != nil || !up.QuorumPercent.Valid || up.QuorumPercent.Int16 != 60 {
		t.Fatalf("set quorum: %+v %v", up.QuorumPercent, err)
	}
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{QuorumPercent: &bad}); err == nil {
		t.Fatal("101% accepted")
	}
	title := "Giao ban tuần"
	up, err = s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Title: &title})
	if err != nil || up.QuorumPercent.Int16 != 60 {
		t.Fatalf("unrelated patch cleared quorum: %+v %v", up.QuorumPercent, err)
	}
	up, err = s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{QuorumPercent: &zero})
	if err != nil || up.QuorumPercent.Valid {
		t.Fatalf("clear quorum: %+v %v", up.QuorumPercent, err)
	}
}
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `set -a && . ./.env && set +a && cd server && go test ./internal/service -run TestUpdateMeetingQuorum -count=1`
Expected: FAIL biên dịch `unknown field QuorumPercent`.

- [ ] **Step 3: Cài đặt**

`meetings.sql` — thêm vào `UpdateMeeting` trước `updated_by`:
```sql
  quorum_percent = CASE
    WHEN sqlc.narg('quorum_percent')::smallint IS NULL THEN quorum_percent
    WHEN sqlc.narg('quorum_percent')::smallint = 0 THEN NULL
    ELSE sqlc.narg('quorum_percent')::smallint
  END,
```
Chạy `make sqlc`.

`meeting.go`:
```go
type UpdateMeetingInput struct {
	Title            *string
	Description      *string
	StartsAt         *time.Time
	EndsAt           *time.Time
	Timezone         *string
	AllowJoinRequest *bool
	ProjectID        *string
	// QuorumPercent: 1–100 sets the minimum attendance, 0 clears it.
	QuorumPercent *int
}
```
Trong `Update`, sau kiểm tra tiêu đề:
```go
	if in.QuorumPercent != nil && (*in.QuorumPercent < 0 || *in.QuorumPercent > 100) {
		return db.Meeting{}, Invalid("tỉ lệ có mặt tối thiểu phải từ 1 đến 100")
	}
```
thêm vào `params`:
```go
	if in.QuorumPercent != nil {
		params.QuorumPercent = pgtype.Int2{Int16: int16(*in.QuorumPercent), Valid: true}
	}
```
và mở rộng `audit.Diff` của `meeting.updated` với `"quorum_percent": m.QuorumPercent.Int16` / `up.QuorumPercent.Int16`.

`sdi/meeting.go` — `PatchMeetingSDI` thêm:
```go
	QuorumPercent *int `json:"quorum_percent" minimum:"0" maximum:"100" description:"Tỉ lệ có mặt tối thiểu (%); 0 = bỏ yêu cầu" example:"60"`
```
`sdo/meeting.go` — `MeetingDTO` thêm:
```go
	QuorumPercent *int16 `json:"quorum_percent" description:"Tỉ lệ có mặt tối thiểu (%), null = không yêu cầu" example:"60"`
```
`handler/meeting.go` — `toMeetingDTO`:
```go
	d := sdo.MeetingDTO{ /* existing fields unchanged */ }
	if m.QuorumPercent.Valid {
		v := m.QuorumPercent.Int16
		d.QuorumPercent = &v
	}
	return d
```
và `updateMeeting` truyền `QuorumPercent: in.QuorumPercent`.

- [ ] **Step 4: Chạy test**

Run: `set -a && . ./.env && set +a && cd server && go build ./... && go test ./internal/service -run 'TestUpdateMeetingQuorum|TestMeetingCRUD' -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pkg/db/queries/meetings.sql server/pkg/db/generated server/internal/service/meeting.go server/internal/service/meeting_attendance_test.go \
  server/internal/handler/dto/sdi/meeting.go server/internal/handler/dto/sdo/meeting.go server/internal/handler/meeting.go
git commit -m "feat(meetings): let the host set a minimum attendance ratio"
```

---

### Task 6: HTTP — DTO, handler, route

**Files:**
- Create: `server/internal/handler/meeting_attendance.go`
- Modify: `server/internal/handler/dto/sdi/meeting.go`, `dto/sdo/meeting.go:76-89`, `handler/meeting_control.go:18-28`
- Modify: `server/internal/handler/router/meetings.go` (sau route `/publish`), `router/routes.go:283-290`, `handler/router.go:389-395`
- Test: `server/internal/handler/meeting_attendance_test.go`

**Interfaces:**
- Consumes: Task 2–4 service methods.
- Produces (HTTP):
  - `PATCH /api/v1/meetings/{meetingID}/participants/{participantID}` body `{standing?, is_secretary?}` → `{participant: ParticipantDTO}`
  - `GET /api/v1/meetings/{meetingID}/attendance` → `AttendanceSDO`
  - `PUT /api/v1/meetings/{meetingID}/attendance/{participantID}` body `{status, note}` → `{status:"ok"}`
  - `DELETE /api/v1/meetings/{meetingID}/attendance/{participantID}` → `{status:"ok"}`
  - `POST /api/v1/meetings/{meetingID}/attendance/finalize` · `/reopen` → `{status:"ok"}`
  - `ParticipantDTO` thêm `standing`, `is_secretary`.

- [ ] **Step 1: Viết test HTTP thất bại**

Tạo `server/internal/handler/meeting_attendance_test.go`:
```go
package handler

import (
	"net/http"
	"testing"
)

func TestAttendanceHTTPFlow(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "att-host@example.com", "password": "password123", "display_name": "Host",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Org", "slug": "att-org"})
	orgID := out["organization"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "WS", "slug": "att-ws"})
	wsID := out["workspace"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", token, map[string]string{"title": "Giao ban"})
	meetingID := out["meeting"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/attendance", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get attendance: %d %v", res.StatusCode, out)
	}
	rows := out["rows"].([]any)
	if len(rows) != 1 {
		t.Fatalf("rows = %v", rows)
	}
	hostRow := rows[0].(map[string]any)
	pid := hostRow["participant_id"].(string)
	if hostRow["status"] != "ABSENT" || hostRow["source"] != "SUGGESTED" || hostRow["standing"] != "MEMBER" {
		t.Fatalf("host row = %v", hostRow)
	}
	if out["summary"].(map[string]any)["members"].(float64) != 1 {
		t.Fatalf("summary = %v", out["summary"])
	}

	res, out = doJSON(t, srv, "PUT", "/api/v1/meetings/"+meetingID+"/attendance/"+pid, token, map[string]string{"status": "WRONG"})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad status: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", "/api/v1/meetings/"+meetingID+"/attendance/"+pid, token, map[string]string{"status": "PRESENT"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("mark: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/attendance/finalize", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("finalize: %d", res.StatusCode)
	}
	res, out = doJSON(t, srv, "DELETE", "/api/v1/meetings/"+meetingID+"/attendance/"+pid, token, nil)
	if res.StatusCode != http.StatusConflict || out["error"].(map[string]any)["code"] != "attendance_finalized" {
		t.Fatalf("clear after finalize: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/attendance", token, nil)
	if out["finalized_at"] == nil || out["finalized_at"] == "" {
		t.Fatalf("finalized_at missing: %v", out)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/attendance/reopen", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("reopen: %d", res.StatusCode)
	}

	res, out = doJSON(t, srv, "PATCH", "/api/v1/meetings/"+meetingID+"/participants/"+pid, token, map[string]any{"standing": "OBSERVER"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("patch participant: %d %v", res.StatusCode, out)
	}
	if out["participant"].(map[string]any)["standing"] != "OBSERVER" {
		t.Fatalf("participant = %v", out["participant"])
	}
	res, out = doJSON(t, srv, "PATCH", "/api/v1/meetings/"+meetingID, token, map[string]any{"quorum_percent": 60})
	if res.StatusCode != http.StatusOK || out["meeting"].(map[string]any)["quorum_percent"].(float64) != 60 {
		t.Fatalf("patch quorum: %d %v", res.StatusCode, out)
	}
}
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `set -a && . ./.env && set +a && cd server && go test ./internal/handler -run TestAttendanceHTTPFlow -count=1`
Expected: FAIL — 404/405 ở `GET .../attendance`.

- [ ] **Step 3: DTO**

`sdi/meeting.go`:
```go
// PatchParticipantSDI sets who votes and who clerks (host/admin only).
type PatchParticipantSDI struct {
	Standing    *string `json:"standing" enum:"MEMBER,OBSERVER" description:"MEMBER = thành viên chính thức, OBSERVER = dự thính" example:"OBSERVER"`
	IsSecretary *bool   `json:"is_secretary" description:"Giao/bỏ vai thư ký (chỉ tài khoản)" example:"true"`
}

// MarkAttendanceSDI is PUT /api/v1/meetings/{meetingID}/attendance/{participantID}.
type MarkAttendanceSDI struct {
	Status string `json:"status" enum:"PRESENT,LATE,EXCUSED,ABSENT" example:"EXCUSED"`
	Note   string `json:"note" maxLength:"200" description:"Lý do vắng; chỉ lưu khi EXCUSED" example:"Đi công tác"`
}
```
`sdo/meeting.go` — `ParticipantDTO` thêm hai trường, và các kiểu mới:
```go
	Standing    string `json:"standing" example:"MEMBER"`
	IsSecretary bool   `json:"is_secretary"`
```
```go
type ParticipantSDO struct {
	Participant ParticipantDTO `json:"participant"`
}

type AttendanceRowDTO struct {
	ParticipantID  string `json:"participant_id"`
	PrincipalType  string `json:"principal_type" example:"USER"`
	UserID         string `json:"user_id,omitempty"`
	DisplayName    string `json:"display_name"`
	Standing       string `json:"standing" example:"MEMBER"`
	IsSecretary    bool   `json:"is_secretary"`
	Status         string `json:"status" example:"PRESENT"`
	Source         string `json:"source" description:"AUTO | MANUAL | SUGGESTED" example:"SUGGESTED"`
	Note           string `json:"note"`
	FirstJoinedAt  string `json:"first_joined_at,omitempty"`
	LastLeftAt     string `json:"last_left_at,omitempty"`
	InRoom         bool   `json:"in_room"`
	PresentSeconds int64  `json:"present_seconds"`
	SessionCount   int32  `json:"session_count"`
}

type AttendanceSummaryDTO struct {
	Members   int   `json:"members"`
	Present   int   `json:"present"`
	Late      int   `json:"late"`
	Excused   int   `json:"excused"`
	Absent    int   `json:"absent"`
	QuorumMet *bool `json:"quorum_met"`
}

type AttendanceSDO struct {
	FinalizedAt   string               `json:"finalized_at,omitempty"`
	FinalizedBy   string               `json:"finalized_by,omitempty"`
	QuorumPercent *int16               `json:"quorum_percent"`
	Summary       AttendanceSummaryDTO `json:"summary"`
	Rows          []AttendanceRowDTO   `json:"rows"`
}
```
`meeting_control.go` — `toParticipantDTO` gán `Standing: p.Standing, IsSecretary: p.IsSecretary`.

- [ ] **Step 4: Handler**

Tạo `server/internal/handler/meeting_attendance.go`:
```go
package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func toAttendanceSDO(rep service.AttendanceReport) sdo.AttendanceSDO {
	out := sdo.AttendanceSDO{
		FinalizedAt: rfc3339(rep.Meeting.AttendanceFinalizedAt),
		FinalizedBy: rep.Meeting.AttendanceFinalizedBy.String,
		Summary: sdo.AttendanceSummaryDTO{
			Members: rep.Summary.Members, Present: rep.Summary.Present, Late: rep.Summary.Late,
			Excused: rep.Summary.Excused, Absent: rep.Summary.Absent, QuorumMet: rep.Summary.QuorumMet,
		},
		Rows: make([]sdo.AttendanceRowDTO, 0, len(rep.Rows)),
	}
	if rep.Meeting.QuorumPercent.Valid {
		v := rep.Meeting.QuorumPercent.Int16
		out.QuorumPercent = &v
	}
	for _, r := range rep.Rows {
		out.Rows = append(out.Rows, sdo.AttendanceRowDTO{
			ParticipantID: r.Participant.ID, PrincipalType: r.Participant.PrincipalType,
			UserID: r.Participant.UserID.String, DisplayName: r.Participant.DisplayNameSnapshot,
			Standing: r.Participant.Standing, IsSecretary: r.Participant.IsSecretary,
			Status: r.Status, Source: r.Source, Note: r.Note,
			FirstJoinedAt: rfc3339(r.FirstJoinedAt), LastLeftAt: rfc3339(r.LastLeftAt),
			InRoom: r.InRoom, PresentSeconds: r.PresentSeconds, SessionCount: r.SessionCount,
		})
	}
	return out
}

func (h *handlers) getAttendance(w http.ResponseWriter, r *http.Request) {
	rep, err := h.Meetings.Attendance(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toAttendanceSDO(rep))
}

func (h *handlers) markAttendance(w http.ResponseWriter, r *http.Request) {
	var in sdi.MarkAttendanceSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Meetings.MarkAttendance(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "participantID"), in.Status, in.Note); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) clearAttendanceMark(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.ClearAttendanceMark(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "participantID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) finalizeAttendance(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.FinalizeAttendance(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) reopenAttendance(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.ReopenAttendance(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) patchParticipant(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchParticipantSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	p, err := h.Meetings.UpdateParticipantDuties(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "participantID"),
		service.ParticipantDutiesInput{Standing: in.Standing, IsSecretary: in.IsSecretary})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.ParticipantSDO{Participant: toParticipantDTO(p, false)})
}
```

- [ ] **Step 5: Route + wiring**

`router/routes.go` — thêm trong struct, cạnh `SetParticipantPublish`:
```go
	PatchParticipant               http.HandlerFunc
	GetAttendance                  http.HandlerFunc
	MarkAttendance                 http.HandlerFunc
	ClearAttendanceMark            http.HandlerFunc
	FinalizeAttendance             http.HandlerFunc
	ReopenAttendance               http.HandlerFunc
```
`handler/router.go` — map tương ứng:
```go
		PatchParticipant:               h.patchParticipant,
		GetAttendance:                  h.getAttendance,
		MarkAttendance:                 h.markAttendance,
		ClearAttendanceMark:            h.clearAttendanceMark,
		FinalizeAttendance:             h.finalizeAttendance,
		ReopenAttendance:               h.reopenAttendance,
```
`router/meetings.go` — ngay sau route `/publish`:
```go
	r.Patch("/meetings/{meetingID}/participants/{participantID}", h.PatchParticipant, apiOp{
		summary: "Set a participant's standing or secretary role (host)", tags: []string{"meetings"},
		sdi: sdi.PatchParticipantSDI{}, sdo: sdo.ParticipantSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/attendance", h.GetAttendance, apiOp{
		summary: "Attendance roll: suggestions merged with clerk marks", tags: []string{"meetings"},
		sdo: sdo.AttendanceSDO{}, auth: true,
	})
	r.Put("/meetings/{meetingID}/attendance/{participantID}", h.MarkAttendance, apiOp{
		summary: "Mark one participant's attendance (clerk)", tags: []string{"meetings"},
		sdi: sdi.MarkAttendanceSDI{}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Delete("/meetings/{meetingID}/attendance/{participantID}", h.ClearAttendanceMark, apiOp{
		summary: "Return a participant to the automatic suggestion (clerk)", tags: []string{"meetings"},
		sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/attendance/finalize", h.FinalizeAttendance, apiOp{
		summary: "Finalize attendance (clerk)", tags: []string{"meetings"}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/attendance/reopen", h.ReopenAttendance, apiOp{
		summary: "Reopen finalized attendance (clerk)", tags: []string{"meetings"}, sdo: sdo.StatusSDO{}, auth: true,
	})
```
Hai tổ hợp param `meetingID` và `meetingID,participantID` đã có trong `router/openapi.go`, không cần thêm case.

- [ ] **Step 6: Chạy test handler + OpenAPI**

Run: `set -a && . ./.env && set +a && cd server && go test ./internal/handler/... -run 'TestAttendanceHTTPFlow|OpenAPI|Route' -count=1`
Expected: PASS (bao gồm test OpenAPI/route sẵn có trong package router).

- [ ] **Step 7: Commit**

```bash
git add server/internal/handler
git commit -m "feat(meetings): expose attendance and participant roles over HTTP"
```

---

### Task 7: Web core — kiểu, endpoint, hook, quyền, realtime

**Files:**
- Modify: `packages/core/types/meeting.ts:3-24,52-61`
- Create: `packages/core/api/endpoints/meeting-attendance.ts`, `meeting-attendance.test.ts`
- Modify: `packages/core/api/endpoints/meetings.ts:64-71` (`UpdateMeetingBody`)
- Modify: `packages/core/meetings/hooks.ts:29-45` (`meetingKeys.attendance`)
- Create: `packages/core/meetings/attendance-hooks.ts`, `attendance-hooks.test.ts`
- Modify: `packages/core/package.json` (exports)
- Modify: `packages/core/permissions/rules.ts` (sau `canHostMeeting`) + test hiện có của rules
- Modify: `packages/core/meetings/status.ts` (`ACTIVITY_KEYS`)
- Modify: `packages/core/realtime/use-realtime-sync.ts:180-190`, `realtime/use-meeting-lobby-sync.ts:25-45`

**Interfaces:**
- Consumes: HTTP của Task 5–6.
- Produces:
  - `type AttendanceStatus = "PRESENT" | "LATE" | "EXCUSED" | "ABSENT"`; `ATTENDANCE_STATUSES: readonly AttendanceStatus[]`
  - `type MeetingAttendance`, `type MeetingAttendanceRow` (zod infer)
  - `getMeetingAttendance(meetingId): Promise<MeetingAttendance>` (ném `meeting_attendance_invalid` khi drift)
  - `markAttendance(meetingId, participantId, body: { status: AttendanceStatus; note?: string })`, `clearAttendanceMark`, `finalizeAttendance`, `reopenAttendance`, `updateMeetingParticipant(meetingId, participantId, body: { standing?: "MEMBER" | "OBSERVER"; is_secretary?: boolean })`
  - `meetingKeys.attendance(meetingId)` = `["meeting-attendance", meetingId]`
  - Hooks: `useMeetingAttendance(meetingId, enabled?)`, `useMarkAttendance(meetingId)`, `useClearAttendanceMark(meetingId)`, `useFinalizeAttendance(meetingId)`, `useReopenAttendance(meetingId)`, `useUpdateMeetingParticipant(meetingId)`, `useMeetingClerk(meeting, wsId): { isClerk: boolean; canAssignDuties: boolean }` — import từ `@uniwork/core/meetings/attendance`.
  - `canClerkMeeting(meeting, participants, ctx): Decision` trong `rules.ts`.

- [ ] **Step 1: Viết test endpoint thất bại**

Tạo `packages/core/api/endpoints/meeting-attendance.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  clearAttendanceMark,
  finalizeAttendance,
  getMeetingAttendance,
  markAttendance,
  reopenAttendance,
  updateMeetingParticipant,
} from "./meeting-attendance";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const attendance = {
  quorum_percent: 60,
  summary: { members: 2, present: 1, late: 0, excused: 1, absent: 0, quorum_met: false },
  rows: [
    {
      participant_id: "p1", principal_type: "USER", user_id: "u1", display_name: "An",
      standing: "MEMBER", is_secretary: false, status: "PRESENT", source: "SUGGESTED", note: "",
      first_joined_at: "2026-09-30T02:01:00Z", in_room: true, present_seconds: 600, session_count: 1,
    },
  ],
};

describe("meeting attendance endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("getMeetingAttendance parses the roll", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(attendance));
    const got = await getMeetingAttendance("m1");
    expect(got.summary.members).toBe(2);
    expect(got.rows[0]?.status).toBe("PRESENT");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/meetings/m1/attendance");
  });

  it("getMeetingAttendance throws on drift instead of showing an empty roll", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ rows: "nope" }));
    await expect(getMeetingAttendance("m1")).rejects.toThrow("meeting_attendance_invalid");
  });

  it("commands hit the right verbs and bodies", async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ status: "ok" }));
    await markAttendance("m1", "p1", { status: "EXCUSED", note: "ốm" });
    await clearAttendanceMark("m1", "p1");
    await finalizeAttendance("m1");
    await reopenAttendance("m1");
    const calls = vi.mocked(fetch).mock.calls.map(([url, init]) => [String(url), init?.method, init?.body]);
    expect(calls).toEqual([
      ["http://api.test/api/v1/meetings/m1/attendance/p1", "PUT", JSON.stringify({ status: "EXCUSED", note: "ốm" })],
      ["http://api.test/api/v1/meetings/m1/attendance/p1", "DELETE", undefined],
      ["http://api.test/api/v1/meetings/m1/attendance/finalize", "POST", undefined],
      ["http://api.test/api/v1/meetings/m1/attendance/reopen", "POST", undefined],
    ]);
  });

  it("updateMeetingParticipant returns the participant or null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ participant: { id: "p1", meeting_id: "m1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE", standing: "OBSERVER", is_secretary: false } }),
    );
    const p = await updateMeetingParticipant("m1", "p1", { standing: "OBSERVER" });
    expect(p?.standing).toBe("OBSERVER");
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await updateMeetingParticipant("m1", "p1", { is_secretary: true })).toBeNull();
  });
});
```
Nếu `request` không đặt `method`/`body` đúng như trên khi không truyền body, đọc `packages/core/api/http.ts` và chỉnh expect cho khớp cách `meetings.test.ts` đang kiểm (không đổi hành vi).

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `pnpm --filter @uniwork/core exec vitest run api/endpoints/meeting-attendance.test.ts`
Expected: FAIL — không tìm thấy module `./meeting-attendance`.

- [ ] **Step 3: Kiểu trong `types/meeting.ts`**

`MeetingSchema` thêm `quorum_percent: z.number().nullish(),`. `ParticipantSchema` thêm:
```ts
  standing: z.string().optional(),
  is_secretary: z.boolean().optional(),
```
Cuối file:
```ts
export type AttendanceStatus = "PRESENT" | "LATE" | "EXCUSED" | "ABSENT";
export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ["PRESENT", "LATE", "EXCUSED", "ABSENT"];

export const AttendanceRowSchema = z.object({
  participant_id: z.string(),
  principal_type: z.string(),
  user_id: z.string().optional(),
  display_name: z.string(),
  standing: z.string(),
  is_secretary: z.boolean(),
  status: z.string(),
  source: z.string(),
  note: z.string().optional(),
  first_joined_at: z.string().optional(),
  last_left_at: z.string().optional(),
  in_room: z.boolean().optional(),
  present_seconds: z.number(),
  session_count: z.number(),
});
export type MeetingAttendanceRow = z.infer<typeof AttendanceRowSchema>;

export const MeetingAttendanceSchema = z.object({
  finalized_at: z.string().optional(),
  finalized_by: z.string().optional(),
  quorum_percent: z.number().nullish(),
  summary: z.object({
    members: z.number(),
    present: z.number(),
    late: z.number(),
    excused: z.number(),
    absent: z.number(),
    quorum_met: z.boolean().nullish(),
  }),
  rows: z.array(AttendanceRowSchema),
});
export type MeetingAttendance = z.infer<typeof MeetingAttendanceSchema>;
```

- [ ] **Step 4: Endpoint `meeting-attendance.ts`**

```ts
import { z } from "zod";
import {
  type AttendanceStatus,
  type MeetingAttendance,
  MeetingAttendanceSchema,
  type MeetingParticipant,
  ParticipantSchema,
} from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;
const base = (meetingId: string) => `/api/v1/meetings/${enc(meetingId)}`;

export async function getMeetingAttendance(meetingId: string): Promise<MeetingAttendance> {
  const raw = await request(`${base(meetingId)}/attendance`);
  const parsed = parseWithFallback<MeetingAttendance | null>(raw, MeetingAttendanceSchema, null, {
    endpoint: "GET /api/v1/meetings/{id}/attendance",
  });
  // An empty roll would read as "nobody came"; the panel shows its error state instead.
  if (!parsed) throw new Error("meeting_attendance_invalid");
  return parsed;
}

export async function markAttendance(
  meetingId: string,
  participantId: string,
  body: { status: AttendanceStatus; note?: string },
): Promise<void> {
  await request(`${base(meetingId)}/attendance/${enc(participantId)}`, { method: "PUT", body });
}

export async function clearAttendanceMark(meetingId: string, participantId: string): Promise<void> {
  await request(`${base(meetingId)}/attendance/${enc(participantId)}`, { method: "DELETE" });
}

export async function finalizeAttendance(meetingId: string): Promise<void> {
  await request(`${base(meetingId)}/attendance/finalize`, { method: "POST" });
}

export async function reopenAttendance(meetingId: string): Promise<void> {
  await request(`${base(meetingId)}/attendance/reopen`, { method: "POST" });
}

export async function updateMeetingParticipant(
  meetingId: string,
  participantId: string,
  body: { standing?: "MEMBER" | "OBSERVER"; is_secretary?: boolean },
): Promise<MeetingParticipant | null> {
  const raw = await request(`${base(meetingId)}/participants/${enc(participantId)}`, { method: "PATCH", body });
  return parseWithFallback<{ participant: MeetingParticipant } | null>(
    raw,
    z.object({ participant: ParticipantSchema }),
    null,
    { endpoint: "PATCH /api/v1/meetings/{id}/participants/{pid}" },
  )?.participant ?? null;
}
```
`meetings.ts` — `UpdateMeetingBody` thêm `quorum_percent?: number;` (comment: `/** 1–100; 0 clears it. */`).

- [ ] **Step 5: Chạy test endpoint**

Run: như Step 2. Expected: PASS.

- [ ] **Step 6: Viết test hook + quyền thất bại**

Tạo `packages/core/meetings/attendance-hooks.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { MeetingParticipant } from "../types/meeting";
import { canClerkMeeting } from "../permissions/rules";

const p = (over: Partial<MeetingParticipant>): MeetingParticipant => ({
  id: "p", meeting_id: "m1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE", ...over,
});
const ctx = (userId: string, wsRole = "member") => ({ userId, orgRole: null, wsRole });

describe("canClerkMeeting", () => {
  const meeting = { host_user_id: "host" };
  it("allows the host and workspace admins", () => {
    expect(canClerkMeeting(meeting, [], ctx("host")).allowed).toBe(true);
    expect(canClerkMeeting(meeting, [], ctx("x", "admin")).allowed).toBe(true);
  });
  it("allows an active secretary only", () => {
    const sec = p({ user_id: "u1", is_secretary: true });
    expect(canClerkMeeting(meeting, [sec], ctx("u1")).allowed).toBe(true);
    expect(canClerkMeeting(meeting, [{ ...sec, status: "REMOVED" }], ctx("u1")).allowed).toBe(false);
    expect(canClerkMeeting(meeting, [{ ...sec, is_secretary: false }], ctx("u1")).allowed).toBe(false);
    expect(canClerkMeeting(meeting, [sec], ctx("u2")).allowed).toBe(false);
  });
});
```
Run: `pnpm --filter @uniwork/core exec vitest run meetings/attendance-hooks.test.ts` → FAIL (`canClerkMeeting` không tồn tại).

- [ ] **Step 7: Quyền, key, hook**

`rules.ts` — sau `canHostMeeting`:
```ts
export function canClerkMeeting(
  meeting: { host_user_id?: string } | null,
  participants: ReadonlyArray<{ user_id?: string; status: string; principal_type: string; is_secretary?: boolean }>,
  ctx: PermissionContext,
): Decision {
  const host = canHostMeeting(meeting, ctx);
  if (host.allowed) return host;
  const secretary = participants.some(
    (p) => p.status === "ACTIVE" && p.principal_type === "USER" && p.user_id === ctx.userId && p.is_secretary === true,
  );
  if (secretary) return ALLOW;
  return deny("not_meeting_clerk", "Only the host, a secretary or a workspace admin can run attendance.");
}
```
`hooks.ts` — `meetingKeys` thêm `attendance: (meetingId: string) => ["meeting-attendance", meetingId] as const,`.

Tạo `packages/core/meetings/attendance-hooks.ts`:
```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/meeting-attendance";
import { canClerkMeeting } from "../permissions/rules";
import { useCurrentMember } from "../permissions/use-current-member";
import type { AttendanceStatus, Meeting } from "../types/meeting";
import { meetingKeys, useParticipants } from "./hooks";

export function useMeetingAttendance(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.attendance(meetingId),
    queryFn: () => api.getMeetingAttendance(meetingId),
    enabled: enabled && Boolean(meetingId),
  });
}

function useAttendanceMutation<V>(meetingId: string, fn: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.attendance(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

export function useMarkAttendance(meetingId: string) {
  return useAttendanceMutation(meetingId, (v: { participantId: string; status: AttendanceStatus; note?: string }) =>
    api.markAttendance(meetingId, v.participantId, { status: v.status, note: v.note }),
  );
}

export function useClearAttendanceMark(meetingId: string) {
  return useAttendanceMutation(meetingId, (participantId: string) => api.clearAttendanceMark(meetingId, participantId));
}

export function useFinalizeAttendance(meetingId: string) {
  return useAttendanceMutation(meetingId, () => api.finalizeAttendance(meetingId));
}

export function useReopenAttendance(meetingId: string) {
  return useAttendanceMutation(meetingId, () => api.reopenAttendance(meetingId));
}

export function useUpdateMeetingParticipant(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { participantId: string; standing?: "MEMBER" | "OBSERVER"; is_secretary?: boolean }) =>
      api.updateMeetingParticipant(meetingId, v.participantId, { standing: v.standing, is_secretary: v.is_secretary }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.attendance(meetingId) });
    },
  });
}

/** Who may run attendance here, and who may hand out roles (host/admin only). */
export function useMeetingClerk(meeting: Meeting | null, wsId: string): { isClerk: boolean; canAssignDuties: boolean } {
  const { userId, role } = useCurrentMember(wsId);
  const { data: participants } = useParticipants(meeting?.id ?? "");
  const ctx = { userId, orgRole: null, wsRole: role };
  const clerk = canClerkMeeting(meeting, participants ?? [], ctx);
  const host = meeting ? canClerkMeeting(meeting, [], ctx) : { allowed: false };
  return { isClerk: Boolean(meeting) && clerk.allowed, canAssignDuties: host.allowed };
}
```
Nếu `useCurrentMember`/`useParticipants` trả kiểu khác (vd. `userId: string | null`), chỉnh chữ ký `ctx` theo `PermissionContext` trong `rules.ts`. Nếu `useParticipants("")` không tự tắt khi id rỗng, truyền `enabled` theo cách `useParticipants` hỗ trợ.

`package.json` — `exports` thêm `"./meetings/attendance": "./meetings/attendance-hooks.ts",` ngay dưới `"./meetings"`.

`status.ts` — `ACTIVITY_KEYS` thêm `ATTENDANCE_FINALIZED: "meetings.activity_attendance_finalized",`.

- [ ] **Step 8: Realtime**

`use-realtime-sync.ts` — thêm case ngay sau khối `participant.*`:
```ts
    case "participant.updated": {
      if (payload.meeting_id) {
        push(meetingKeys.participants(payload.meeting_id));
        push(meetingKeys.attendance(payload.meeting_id));
      }
      break;
    }
    case "attendance.marked":
    case "attendance.updated": {
      if (payload.meeting_id) push(meetingKeys.attendance(payload.meeting_id));
      break;
    }
    case "attendance.finalized":
    case "attendance.reopened": {
      if (payload.meeting_id) {
        push(meetingKeys.attendance(payload.meeting_id));
        push(meetingKeys.activity(payload.meeting_id));
        push(meetingKeys.detail(payload.meeting_id));
      }
      break;
    }
```
`use-meeting-lobby-sync.ts` — thêm listener cạnh `participant.removed` và gỡ trong cleanup:
```ts
    const offParticipantUpdated = client.on("participant.updated", (payload) => {
      invalidateIfMatch(payload, meetingKeys.participants(meetingId));
    });
```
```ts
      offParticipantUpdated();
```
Nếu `use-realtime-sync.test.ts` có bảng liệt kê event → key, thêm các dòng mới theo mẫu của `participant.invited`.

- [ ] **Step 9: Chạy test core + typecheck**

Run: `pnpm --filter @uniwork/core exec vitest run api/endpoints/meeting-attendance.test.ts meetings/attendance-hooks.test.ts realtime && pnpm --filter @uniwork/core typecheck && node --test scripts/events-catalogue.test.mjs`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/core
git commit -m "feat(core): attendance endpoints, hooks, clerk rule and realtime keys"
```

---

### Task 8: Chuỗi i18n (vi rồi en)

**Files:**
- Modify: `packages/core/i18n/locales/vi.json`, `en.json` (khối `meetings`)

**Interfaces:**
- Produces: khối `meetings.governance.*` và key `meetings.activity_attendance_finalized`, `meetings.quorumLabel`, `meetings.quorumHint`, `meetings.quorumInvalid`. Task 9–11 chỉ dùng các key này.

- [ ] **Step 1: Thêm vào `vi.json`** (trong object `meetings`; `activity_attendance_finalized` cạnh `activity_link_revoked`, ba key quorum cạnh `allowJoinRequest`):

```json
"activity_attendance_finalized": "đã chốt điểm danh",
"quorumLabel": "Tỉ lệ có mặt tối thiểu (%)",
"quorumHint": "Để trống nếu không yêu cầu. Chưa đủ tỉ lệ chỉ hiện cảnh báo, không chặn cuộc họp.",
"quorumInvalid": "Nhập số nguyên từ 1 đến 100",
"governance": {
  "standing_MEMBER": "Thành viên",
  "standing_OBSERVER": "Dự thính",
  "secretary": "Thư ký",
  "makeObserver": "Chuyển thành dự thính",
  "makeMember": "Chuyển thành thành viên",
  "assignSecretary": "Giao vai thư ký",
  "removeSecretary": "Bỏ vai thư ký",
  "rolesUpdated": "Đã cập nhật vai trò",
  "attendanceTitle": "Điểm danh",
  "viewSwitch": "Chế độ xem",
  "viewRoom": "Trong phòng",
  "viewAttendance": "Điểm danh",
  "status_PRESENT": "Có mặt",
  "status_LATE": "Đến muộn",
  "status_EXCUSED": "Vắng có phép",
  "status_ABSENT": "Vắng",
  "statusFor": "Trạng thái điểm danh của {{name}}",
  "summary_one": "Có mặt {{present}} · Muộn {{late}} · Vắng có phép {{excused}} · Vắng {{absent}} / {{count}} thành viên",
  "summary_other": "Có mặt {{present}} · Muộn {{late}} · Vắng có phép {{excused}} · Vắng {{absent}} / {{count}} thành viên",
  "quorumMet": "Đủ tỉ lệ có mặt",
  "quorumMissing": "Chưa đủ tỉ lệ (cần {{percent}}%)",
  "sourceAuto": "Tự động",
  "resetToAuto": "Trả {{name}} về gợi ý tự động",
  "excuseReason": "Lý do vắng",
  "joined_one": "Vào lúc {{time}} · {{count}} phút",
  "joined_other": "Vào lúc {{time}} · {{count}} phút",
  "notJoined": "Chưa vào phòng",
  "inRoomNow": "Đang trong phòng",
  "members": "Thành viên",
  "observers_one": "Dự thính ({{count}})",
  "observers_other": "Dự thính ({{count}})",
  "noMembers": "Chưa có thành viên chính thức nào",
  "finalize": "Chốt điểm danh",
  "finalized": "Đã chốt lúc {{time}}",
  "reopen": "Mở lại",
  "finalizedToast": "Đã chốt điểm danh",
  "reopenedToast": "Đã mở lại điểm danh",
  "loadFailed": "Không tải được điểm danh"
}
```

- [ ] **Step 2: Thêm đúng các key đó vào `en.json`**

```json
"activity_attendance_finalized": "finalized attendance",
"quorumLabel": "Minimum attendance (%)",
"quorumHint": "Leave empty for none. Falling short only shows a warning; it never blocks the meeting.",
"quorumInvalid": "Enter a whole number from 1 to 100",
"governance": {
  "standing_MEMBER": "Member",
  "standing_OBSERVER": "Observer",
  "secretary": "Secretary",
  "makeObserver": "Make observer",
  "makeMember": "Make member",
  "assignSecretary": "Make secretary",
  "removeSecretary": "Remove secretary role",
  "rolesUpdated": "Role updated",
  "attendanceTitle": "Attendance",
  "viewSwitch": "View",
  "viewRoom": "In the room",
  "viewAttendance": "Attendance",
  "status_PRESENT": "Present",
  "status_LATE": "Late",
  "status_EXCUSED": "Excused",
  "status_ABSENT": "Absent",
  "statusFor": "Attendance for {{name}}",
  "summary_one": "Present {{present}} · Late {{late}} · Excused {{excused}} · Absent {{absent}} / {{count}} member",
  "summary_other": "Present {{present}} · Late {{late}} · Excused {{excused}} · Absent {{absent}} / {{count}} members",
  "quorumMet": "Quorum met",
  "quorumMissing": "Below quorum (needs {{percent}}%)",
  "sourceAuto": "Auto",
  "resetToAuto": "Reset {{name}} to the suggestion",
  "excuseReason": "Reason for absence",
  "joined_one": "Joined {{time}} · {{count}} min",
  "joined_other": "Joined {{time}} · {{count}} min",
  "notJoined": "Hasn't joined",
  "inRoomNow": "In the room now",
  "members": "Members",
  "observers_one": "Observer ({{count}})",
  "observers_other": "Observers ({{count}})",
  "noMembers": "No voting members yet",
  "finalize": "Finalize attendance",
  "finalized": "Finalized at {{time}}",
  "reopen": "Reopen",
  "finalizedToast": "Attendance finalized",
  "reopenedToast": "Attendance reopened",
  "loadFailed": "Couldn't load attendance"
}
```

- [ ] **Step 3: Chạy parity + lint giọng văn**

Run: `pnpm --filter @uniwork/core exec vitest run i18n`
Expected: PASS. Nếu lint giọng văn tiếng Việt báo từ nào, sửa theo gợi ý của nó (không tắt rule).

- [ ] **Step 4: Commit**

```bash
git add packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json
git commit -m "feat(i18n): attendance and participant role strings"
```

---

### Task 9: Nhãn + menu vai (Thư ký/Dự thính) ở phòng họp và trang chi tiết

**Files:**
- Modify: `packages/views/meetings/meeting-signals.ts:94`, `meeting-role-chip.tsx`
- Create: `packages/views/meetings/meeting-duty-menu-items.tsx`, `meeting-duty-menu-items.test.tsx`
- Modify: `packages/views/meetings/meeting-participant-row.tsx` (prop `menuExtra`, `roleChip`)
- Modify: `packages/views/meetings/meeting-room-people-tab.tsx`
- Modify: `packages/views/meetings/meeting-participants-section.tsx`

**Interfaces:**
- Consumes: Task 7 `useUpdateMeetingParticipant`, `useMeetingClerk`; Task 8 key `meetings.governance.*`.
- Produces:
  - `MeetingParticipantRole = "agent" | "guest" | "secretary" | "observer"`
  - `function dutyRole(p: { standing?: string; is_secretary?: boolean; principal_type: string } | undefined): "secretary" | "observer" | null`
  - `<MeetingDutyMenuItems meetingId participant />` (render `DropdownMenuItem`s; dùng được trong mọi `DropdownMenuContent`)
  - `MeetingParticipantRow` prop mới `menuExtra?: ReactNode`.

- [ ] **Step 1: Viết test thất bại**

Tạo `packages/views/meetings/meeting-duty-menu-items.test.tsx` (cùng khung với `meeting-participants-section.test.tsx`: `requestMock` + `wrapWithNav` + `initI18n`):
```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingParticipant } from "@uniwork/core/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingDutyMenuItems, dutyRole } from "./meeting-duty-menu-items";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ participant: { id: "p1", meeting_id: "m1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE" } });
});

const base = { id: "p1", meeting_id: "m1", role: "ATTENDEE", status: "ACTIVE", display_name_snapshot: "An" };

function open(participant: MeetingParticipant) {
  render(
    wrapWithNav(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <MeetingDutyMenuItems meetingId="m1" participant={participant} />
        </DropdownMenuContent>
      </DropdownMenu>,
    ),
  );
}

describe("MeetingDutyMenuItems", () => {
  it("offers observer + secretary for a member account", async () => {
    open({ ...base, principal_type: "USER", standing: "MEMBER", is_secretary: false });
    expect(screen.getByRole("menuitem", { name: "Chuyển thành dự thính" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Giao vai thư ký" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/participants/p1", {
        method: "PATCH",
        body: { is_secretary: true },
      }),
    );
  });

  it("never offers the secretary role to a guest", () => {
    open({ ...base, principal_type: "GUEST", standing: "OBSERVER" });
    expect(screen.queryByRole("menuitem", { name: "Giao vai thư ký" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Chuyển thành thành viên" })).toBeInTheDocument();
  });
});

describe("dutyRole", () => {
  it("secretary wins over observer; members carry no chip", () => {
    expect(dutyRole({ principal_type: "USER", standing: "OBSERVER", is_secretary: true })).toBe("secretary");
    expect(dutyRole({ principal_type: "USER", standing: "OBSERVER" })).toBe("observer");
    expect(dutyRole({ principal_type: "USER", standing: "MEMBER" })).toBeNull();
    expect(dutyRole(undefined)).toBeNull();
  });
});
```
Run: `pnpm --filter @uniwork/views exec vitest run meetings/meeting-duty-menu-items.test.tsx` → FAIL (module không tồn tại).

- [ ] **Step 2: Cài đặt**

`meeting-signals.ts:94`:
```ts
export type MeetingParticipantRole = "agent" | "guest" | "secretary" | "observer";
```
`meeting-role-chip.tsx` — thay phần return cuối:
```tsx
  if (role === "agent") return <AgentBadge className={cn(CHIP, className)} />;
  const label =
    role === "secretary"
      ? t("meetings.governance.secretary")
      : role === "observer"
        ? t("meetings.governance.standing_OBSERVER")
        : t("meetings.guest");
  return (
    <Badge variant="outline" className={cn(CHIP, className)}>
      {label}
    </Badge>
  );
```
Tạo `meeting-duty-menu-items.tsx`:
```tsx
"use client";
import { NotebookPen, UserCheck, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useUpdateMeetingParticipant } from "@uniwork/core/meetings/attendance";
import type { MeetingParticipant } from "@uniwork/core/types";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { toastApiError } from "../toast-api-error";

/** The chip a participant's duties earn beside their name; members carry none. */
export function dutyRole(
  p: { standing?: string; is_secretary?: boolean; principal_type: string } | undefined,
): "secretary" | "observer" | null {
  if (!p) return null;
  if (p.is_secretary) return "secretary";
  if (p.standing === "OBSERVER") return "observer";
  return null;
}

/** Host/admin menu entries that set who votes and who clerks. */
export function MeetingDutyMenuItems({
  meetingId,
  participant,
}: {
  meetingId: string;
  participant: MeetingParticipant;
}) {
  const { t } = useTranslation();
  const update = useUpdateMeetingParticipant(meetingId);
  const observer = participant.standing === "OBSERVER";
  const secretary = participant.is_secretary === true;
  const run = (patch: { standing?: "MEMBER" | "OBSERVER"; is_secretary?: boolean }) =>
    update.mutate(
      { participantId: participant.id, ...patch },
      {
        onSuccess: () => toast.success(t("meetings.governance.rolesUpdated")),
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  return (
    <>
      <DropdownMenuItem disabled={update.isPending} onClick={() => run({ standing: observer ? "MEMBER" : "OBSERVER" })}>
        {observer ? <UserCheck aria-hidden className="size-4" /> : <UserRound aria-hidden className="size-4" />}
        {observer ? t("meetings.governance.makeMember") : t("meetings.governance.makeObserver")}
      </DropdownMenuItem>
      {participant.principal_type === "USER" ? (
        <DropdownMenuItem disabled={update.isPending} onClick={() => run({ is_secretary: !secretary })}>
          <NotebookPen aria-hidden className="size-4" />
          {secretary ? t("meetings.governance.removeSecretary") : t("meetings.governance.assignSecretary")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
```
`meeting-participant-row.tsx` — thêm prop `menuExtra?: ReactNode` (import `type ReactNode` từ `react`) và render ngay sau `MeetingModerationMenuItems`:
```tsx
            {canHost ? <MeetingModerationMenuItems participant={participant} micMuted={micMuted} /> : null}
            {menuExtra}
```
`meeting-room-people-tab.tsx`:
- `participantMeta` lưu thêm bản ghi API: `api: p` (kiểu `MeetingParticipant`).
- Chip: `roleChip={participantRole(participant, guests) ?? dutyRole(participantMeta.get(participant.identity)?.api)}`. Chip "Khách" được ưu tiên vì khách mặc định là dự thính.
- Menu vai: `menuExtra={canHost && !guestMode && meetingId && meta?.api && !meta.isHost ? <MeetingDutyMenuItems meetingId={meetingId} participant={meta.api} /> : null}` với `const meta = participantMeta.get(participant.identity)`.

`meeting-participants-section.tsx`:
- Cạnh tên (`<div className="truncate ...">{name}</div>`) đổi thành một hàng flex, thêm `{dutyRole(p) ? <MeetingRoleChip role={dutyRole(p)!} /> : null}`.
- Trong `DropdownMenuContent`, trước mục "Gỡ": `<MeetingDutyMenuItems meetingId={meeting.id} participant={p} />`.
- Mở menu cho cả chủ trì khi hội đủ `canManage` (thêm `DropdownMenuSeparator` trước "Gỡ" nếu `dropdown-menu.tsx` export nó).

- [ ] **Step 3: Chạy test**

Run: `pnpm --filter @uniwork/views exec vitest run meetings/meeting-duty-menu-items.test.tsx meetings/meeting-participants-section.test.tsx meetings/meeting-room-people`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/views/meetings
git commit -m "feat(views): show and set secretary and observer roles on meeting rosters"
```

---

### Task 10: Panel điểm danh

**Files:**
- Create: `packages/views/meetings/meeting-attendance-summary.tsx`
- Create: `packages/views/meetings/meeting-attendance-row.tsx`
- Create: `packages/views/meetings/meeting-attendance-panel.tsx`, `meeting-attendance-panel.test.tsx`

**Interfaces:**
- Consumes: Task 7 hooks + kiểu; Task 8 key; `ToneBadge` (`meeting-status-badge.tsx`), `MeetingPersonAvatar` (`meeting-person.tsx`), `MeetingSectionError`/`MeetingRowsSkeleton` (`meeting-section-state.tsx`), `Select*` (`@uniwork/ui/components/ui/select`), `Collapsible*`.
- Produces: `<MeetingAttendancePanel meeting={Meeting} workspaceId={string} canEdit={boolean} density={"room" | "compact"} />`.

- [ ] **Step 1: Viết test thất bại**

Tạo `meeting-attendance-panel.test.tsx` (cùng khung `requestMock` + `wrapWithNav` + `initI18n`):
```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingAttendancePanel } from "./meeting-attendance-panel";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const meeting = {
  id: "m1", workspace_id: "ws1", title: "Giao ban", description: "", starts_at: "2026-09-30T02:00:00Z",
  ends_at: "2026-09-30T03:00:00Z", room_name: "r", created_by: "u1", status: "IN_PROGRESS",
} as Meeting;
const row = (over: Record<string, unknown>) => ({
  participant_id: "p1", principal_type: "USER", user_id: "u1", display_name: "An", standing: "MEMBER",
  is_secretary: false, status: "PRESENT", source: "SUGGESTED", note: "", present_seconds: 0, session_count: 0, ...over,
});
let attendance: Record<string, unknown>;

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  requestMock.mockReset();
  attendance = {
    quorum_percent: 60,
    summary: { members: 2, present: 1, late: 0, excused: 0, absent: 1, quorum_met: false },
    rows: [
      row({ first_joined_at: "2026-09-30T02:01:00Z", present_seconds: 1800, session_count: 1, in_room: true }),
      row({ participant_id: "p2", display_name: "Bình", status: "ABSENT", source: "MANUAL" }),
      row({ participant_id: "g1", principal_type: "GUEST", display_name: "Khách A", standing: "OBSERVER" }),
    ],
  };
  requestMock.mockImplementation((path: unknown) =>
    Promise.resolve(String(path).endsWith("/attendance") ? attendance : { status: "ok" }),
  );
});

function renderPanel(canEdit: boolean) {
  render(wrapWithNav(<MeetingAttendancePanel meeting={meeting} workspaceId="ws1" canEdit={canEdit} density="room" />));
}

describe("MeetingAttendancePanel", () => {
  it("summarizes members and flags a missing quorum", async () => {
    renderPanel(true);
    expect(await screen.findByText("Có mặt 1 · Muộn 0 · Vắng có phép 0 · Vắng 1 / 2 thành viên")).toBeInTheDocument();
    expect(screen.getByText("Chưa đủ tỉ lệ (cần 60%)")).toBeInTheDocument();
    expect(screen.getByText("Dự thính (1)")).toBeInTheDocument();
  });

  it("resets a manual mark and finalizes", async () => {
    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "Trả Bình về gợi ý tự động" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/p2", { method: "DELETE" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Chốt điểm danh" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/finalize", { method: "POST" }),
    );
  });

  it("asks for a reason when someone is excused", async () => {
    attendance.rows = [row({ status: "EXCUSED", source: "MANUAL", note: "ốm" })];
    renderPanel(true);
    const reason = (await screen.findByLabelText("Lý do vắng")) as HTMLInputElement;
    expect(reason.value).toBe("ốm");
    fireEvent.change(reason, { target: { value: "Đi công tác" } });
    fireEvent.blur(reason);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/attendance/p1", {
        method: "PUT",
        body: { status: "EXCUSED", note: "Đi công tác" },
      }),
    );
  });

  it("is read-only without the clerk role and shows the finalized stamp", async () => {
    attendance.finalized_at = "2026-09-30T02:30:00Z";
    renderPanel(false);
    expect(await screen.findByText(/Đã chốt lúc/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chốt điểm danh" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the error state instead of an empty roll when the response drifts", async () => {
    attendance = { rows: "nope" };
    renderPanel(true);
    expect(await screen.findByText("Không tải được điểm danh")).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @uniwork/views exec vitest run meetings/meeting-attendance-panel.test.tsx` → FAIL.

- [ ] **Step 2: `meeting-attendance-summary.tsx`**

```tsx
"use client";
import { useTranslation } from "react-i18next";
import type { MeetingAttendance } from "@uniwork/core/types/meeting";
import { ToneBadge } from "./meeting-status-badge";

export function MeetingAttendanceSummary({ attendance }: { attendance: MeetingAttendance }) {
  const { t } = useTranslation();
  const { summary, quorum_percent: quorum } = attendance;
  return (
    <div className="space-y-2">
      <p className="text-label text-foreground tabular-nums">
        {t("meetings.governance.summary", {
          count: summary.members,
          present: summary.present,
          late: summary.late,
          excused: summary.excused,
          absent: summary.absent,
        })}
      </p>
      {quorum && summary.quorum_met != null ? (
        <ToneBadge tone={summary.quorum_met ? "success" : "warning"}>
          {summary.quorum_met
            ? t("meetings.governance.quorumMet")
            : t("meetings.governance.quorumMissing", { percent: quorum })}
        </ToneBadge>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: `meeting-attendance-row.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ATTENDANCE_STATUSES, type AttendanceStatus, type MeetingAttendanceRow } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { MeetingPersonAvatar } from "./meeting-person";
import { ToneBadge, type MeetingTone } from "./meeting-status-badge";

const STATUS_TONE: Record<AttendanceStatus, MeetingTone> = {
  PRESENT: "success",
  LATE: "warning",
  EXCUSED: "info",
  ABSENT: "muted",
};

function asStatus(s: string): AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(s) ? (s as AttendanceStatus) : "ABSENT";
}

export function MeetingAttendanceRowItem({
  row,
  canEdit,
  finalized,
  locale,
  onMark,
  onReset,
}: {
  row: MeetingAttendanceRow;
  canEdit: boolean;
  finalized: boolean;
  locale: string;
  onMark: (status: AttendanceStatus, note?: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const status = asStatus(row.status);
  const [note, setNote] = useState(row.note ?? "");
  useEffect(() => setNote(row.note ?? ""), [row.note]);
  const joined = row.first_joined_at
    ? t("meetings.governance.joined", {
        time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(row.first_joined_at)),
        count: Math.round(row.present_seconds / 60),
      })
    : t("meetings.governance.notJoined");
  const items = ATTENDANCE_STATUSES.map((s) => ({ value: s, label: t(`meetings.governance.status_${s}`) }));
  return (
    <li className="space-y-2 px-2 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <MeetingPersonAvatar name={row.display_name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body text-foreground">{row.display_name}</p>
          <p className="truncate text-caption text-muted-foreground">
            {row.in_room ? t("meetings.governance.inRoomNow") : joined}
            {row.source !== "MANUAL" ? ` · ${t("meetings.governance.sourceAuto")}` : null}
          </p>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-1">
            {row.source === "MANUAL" && !finalized ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("meetings.governance.resetToAuto", { name: row.display_name })}
                onClick={onReset}
              >
                <Undo2 aria-hidden className="size-4" />
              </Button>
            ) : null}
            <Select items={items} value={status} onValueChange={(next) => next && onMark(next as AttendanceStatus)}>
              <SelectTrigger
                size="sm"
                variant="subtle"
                className="w-32"
                aria-label={t("meetings.governance.statusFor", { name: row.display_name })}
              >
                <SelectValue>{t(`meetings.governance.status_${status}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <ToneBadge tone={STATUS_TONE[status]}>{t(`meetings.governance.status_${status}`)}</ToneBadge>
        )}
      </div>
      {canEdit && status === "EXCUSED" ? (
        <Input
          value={note}
          maxLength={200}
          aria-label={t("meetings.governance.excuseReason")}
          placeholder={t("meetings.governance.excuseReason")}
          className="h-8"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note.trim() !== (row.note ?? "")) onMark("EXCUSED", note.trim());
          }}
        />
      ) : null}
    </li>
  );
}
```
Nếu `SelectTrigger` không nhận `size`/`variant` như trong `views/admin/quota.tsx`, bỏ hai prop đó.

- [ ] **Step 4: `meeting-attendance-panel.tsx`**

```tsx
"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useClearAttendanceMark,
  useFinalizeAttendance,
  useMarkAttendance,
  useMeetingAttendance,
  useReopenAttendance,
} from "@uniwork/core/meetings/attendance";
import type { AttendanceStatus, Meeting } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";
import { MeetingAttendanceRowItem } from "./meeting-attendance-row";
import { MeetingAttendanceSummary } from "./meeting-attendance-summary";
import { MeetingRowsSkeleton, MeetingSectionError } from "./meeting-section-state";

export function MeetingAttendancePanel({
  meeting,
  canEdit,
  density,
}: {
  meeting: Meeting;
  workspaceId: string;
  canEdit: boolean;
  density: "room" | "compact";
}) {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError, refetch } = useMeetingAttendance(meeting.id);
  const mark = useMarkAttendance(meeting.id);
  const clear = useClearAttendanceMark(meeting.id);
  const finalize = useFinalizeAttendance(meeting.id);
  const reopen = useReopenAttendance(meeting.id);
  const [observersOpen, setObserversOpen] = useState(false);
  const onError = (err: unknown) => toastApiError(err, t("common.error"));

  if (isPending) return <MeetingRowsSkeleton rows={3} className="py-1" />;
  if (isError || !data) {
    return <MeetingSectionError message={t("meetings.governance.loadFailed")} onRetry={() => void refetch()} />;
  }
  const finalized = Boolean(data.finalized_at);
  const members = data.rows.filter((r) => r.standing === "MEMBER");
  const observers = data.rows.filter((r) => r.standing !== "MEMBER");
  const rowItem = (r: (typeof data.rows)[number]) => (
    <MeetingAttendanceRowItem
      key={r.participant_id}
      row={r}
      canEdit={canEdit}
      finalized={finalized}
      locale={i18n.language}
      onMark={(status: AttendanceStatus, note?: string) =>
        mark.mutate({ participantId: r.participant_id, status, note }, { onError })
      }
      onReset={() => clear.mutate(r.participant_id, { onError })}
    />
  );

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", density === "compact" && "px-4 py-3")}>
      <MeetingAttendanceSummary attendance={data} />
      {members.length === 0 ? (
        <p className="py-3 text-center text-caption text-muted-foreground">{t("meetings.governance.noMembers")}</p>
      ) : (
        <ul className="divide-y divide-border">{members.map(rowItem)}</ul>
      )}
      {observers.length > 0 ? (
        <Collapsible open={observersOpen} onOpenChange={setObserversOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-label text-muted-foreground hover:bg-surface-hover">
            <ChevronDown
              aria-hidden
              className={cn("size-4 transition-transform duration-fast motion-reduce:transition-none", !observersOpen && "-rotate-90")}
            />
            {t("meetings.governance.observers", { count: observers.length })}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="divide-y divide-border">{observers.map(rowItem)}</ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        {finalized ? (
          <p className="text-caption text-muted-foreground">
            {t("meetings.governance.finalized", {
              time: new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(
                new Date(data.finalized_at!),
              ),
            })}
          </p>
        ) : (
          <span />
        )}
        {canEdit ? (
          finalized ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reopen.isPending}
              onClick={() =>
                reopen.mutate(undefined, { onSuccess: () => toast.success(t("meetings.governance.reopenedToast")), onError })
              }
            >
              {t("meetings.governance.reopen")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="brand"
              disabled={finalize.isPending}
              onClick={() =>
                finalize.mutate(undefined, { onSuccess: () => toast.success(t("meetings.governance.finalizedToast")), onError })
              }
            >
              {t("meetings.governance.finalize")}
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
```
`workspaceId` giữ trong props để thẻ trang chi tiết và tab phòng họp gọi giống nhau (đợt 2 dùng để tra avatar); nếu knip/eslint báo prop không dùng, bỏ khỏi destructuring nhưng giữ trong kiểu.

- [ ] **Step 5: Chạy test**

Run: `pnpm --filter @uniwork/views exec vitest run meetings/meeting-attendance-panel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/views/meetings/meeting-attendance-*.tsx
git commit -m "feat(views): attendance panel with suggestions, marks and finalize"
```

---

### Task 11: Gắn panel vào phòng họp, trang chi tiết và hộp sửa cuộc họp

**Files:**
- Modify: `packages/views/meetings/meeting-room-people-tab.tsx`
- Create: `packages/views/meetings/meeting-attendance-card.tsx`
- Modify: `packages/views/meetings/meeting-detail-view.tsx:236-248`
- Modify: `packages/views/meetings/meeting-edit-dialog.tsx`
- Test: `meeting-edit-dialog.test.tsx`, `meeting-detail-view.test.tsx` (sẵn có)

**Interfaces:**
- Consumes: Task 10 `MeetingAttendancePanel`, Task 7 `useMeetingClerk`, `UpdateMeetingBody.quorum_percent`.
- Produces: `<MeetingAttendanceCard meeting workspaceId />`.

- [ ] **Step 1: Viết test thất bại cho ô tỉ lệ tối thiểu**

Thêm vào `describe("MeetingEditDialog")` trong `meeting-edit-dialog.test.tsx` (dùng `openDialog`, `meeting`, `requestMock` sẵn có của file):
```tsx
  it("sends the quorum, and 0 when the field is emptied", async () => {
    requestMock.mockResolvedValue({ meeting });
    const dialog = openDialog({ ...meeting, quorum_percent: 50 });
    const input = within(dialog).getByLabelText("Tỉ lệ có mặt tối thiểu (%)") as HTMLInputElement;
    expect(input.value).toBe("50");
    fireEvent.change(input, { target: { value: "60" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/meetings/m1",
        expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ quorum_percent: 60 }) }),
      ),
    );
  });

  it("clears the quorum with 0", async () => {
    requestMock.mockResolvedValue({ meeting });
    const dialog = openDialog({ ...meeting, quorum_percent: 50 });
    fireEvent.change(within(dialog).getByLabelText("Tỉ lệ có mặt tối thiểu (%)"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/meetings/m1",
        expect.objectContaining({ body: expect.objectContaining({ quorum_percent: 0 }) }),
      ),
    );
  });

  it("rejects a quorum outside 1–100 and keeps focus on it", () => {
    const dialog = openDialog();
    const input = within(dialog).getByLabelText("Tỉ lệ có mặt tối thiểu (%)");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu thay đổi" }));
    expect(within(dialog).getByText("Nhập số nguyên từ 1 đến 100")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(input);
    expect(requestMock).not.toHaveBeenCalled();
  });
```

Run: `pnpm --filter @uniwork/views exec vitest run meetings/meeting-edit-dialog.test.tsx` → FAIL.

- [ ] **Step 2: Ô tỉ lệ tối thiểu trong `meeting-edit-dialog.tsx`**

- `meetingDraft` thêm `quorum: meeting.quorum_percent ? String(meeting.quorum_percent) : "",`; `meetingRevision` thêm `meeting.quorum_percent` vào mảng.
- Destructure thêm `quorum`; tính:
```tsx
  const quorumValue = quorum.trim() === "" ? 0 : Number(quorum);
  const quorumInvalid = quorum.trim() !== "" && (!Number.isInteger(quorumValue) || quorumValue < 1 || quorumValue > 100);
```
- Trong `onSubmit`, sau kiểm tra lịch:
```tsx
            if (quorumInvalid) {
              document.getElementById(`${id}-quorum`)?.focus();
              return;
            }
```
và body `update.mutate` thêm `quorum_percent: quorumValue,`.
- Trong section `access`, sau khối `Switch` cho phép xin vào:
```tsx
              <Field data-invalid={submitted && quorumInvalid ? true : undefined}>
                <FieldLabel htmlFor={`${id}-quorum`}>{t("meetings.quorumLabel")}</FieldLabel>
                <Input
                  id={`${id}-quorum`}
                  inputMode="numeric"
                  className="w-28"
                  value={quorum}
                  aria-invalid={submitted && quorumInvalid ? true : undefined}
                  aria-describedby={`${id}-quorum-hint`}
                  onChange={(e) => set("quorum")(e.target.value)}
                />
                <FieldDescription id={`${id}-quorum-hint`}>
                  {submitted && quorumInvalid ? t("meetings.quorumInvalid") : t("meetings.quorumHint")}
                </FieldDescription>
              </Field>
```
(import `Field` và `Input` nếu file chưa import; `FieldLabel`/`FieldDescription` đã có.)

- [ ] **Step 3: `meeting-attendance-card.tsx`**

```tsx
"use client";
import { ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingClerk } from "@uniwork/core/meetings/attendance";
import type { Meeting } from "@uniwork/core/types";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";
import { MeetingAttendancePanel } from "./meeting-attendance-panel";

/** Detail-page home of the roll: shown once the meeting has started. */
export function MeetingAttendanceCard({ meeting, workspaceId }: { meeting: Meeting; workspaceId: string }) {
  const { t } = useTranslation();
  const { isClerk } = useMeetingClerk(meeting, workspaceId);
  if (meeting.status !== "IN_PROGRESS" && meeting.status !== "ENDED") return null;
  return (
    <PanelCard
      id="attendance-heading"
      icon={ClipboardCheck}
      iconTone={moduleTone("meetings")}
      title={t("meetings.governance.attendanceTitle")}
      flush
    >
      <MeetingAttendancePanel meeting={meeting} workspaceId={workspaceId} canEdit={isClerk} density="compact" />
    </PanelCard>
  );
}
```
`meeting-detail-view.tsx` — trong `div` bọc `MeetingDetailRoster`, thêm ngay sau nó:
```tsx
              <MeetingAttendanceCard meeting={meeting} workspaceId={workspaceId} />
```
và đổi `div` đó thành `className={cn("order-2 flex min-w-0 flex-col gap-4", …)}` để hai thẻ có khoảng cách.

- [ ] **Step 4: Chế độ Điểm danh trong tab Người tham gia**

Trong `meeting-room-people-tab.tsx`:
```tsx
  const { isClerk } = useMeetingClerk(guestMode ? null : (meeting ?? null), workspaceId ?? "");
  const [view, setView] = useState<"room" | "attendance">("room");
  const showAttendance = isClerk && view === "attendance" && meeting;
```
Ngay đầu phần return (trước `MeetingJoinRequestsSection`):
```tsx
      {isClerk ? (
        <div
          role="group"
          aria-label={t("meetings.governance.viewSwitch")}
          className="mb-3 grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-surface-hover p-1"
        >
          {(["room", "attendance"] as const).map((v) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={view === v ? "secondary" : "ghost"}
              aria-pressed={view === v}
              className="h-8 rounded-lg"
              onClick={() => setView(v)}
            >
              {v === "room" ? t("meetings.governance.viewRoom") : t("meetings.governance.viewAttendance")}
            </Button>
          ))}
        </div>
      ) : null}
      {showAttendance ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MeetingAttendancePanel meeting={meeting} workspaceId={workspaceId ?? ""} canEdit density="room" />
        </div>
      ) : (
        <>{/* the existing join requests, invite button, search, list and dialog, unchanged */}</>
      )}
```
Toàn bộ phần hiện có của tab (join requests → dialog mời) chuyển vào nhánh `else` không đổi gì.

- [ ] **Step 5: Chạy test + typecheck + lint**

Run: `pnpm --filter @uniwork/views exec vitest run meetings && pnpm --filter @uniwork/views typecheck && pnpm lint`
Expected: PASS, không warning.

- [ ] **Step 6: Commit**

```bash
git add packages/views/meetings
git commit -m "feat(views): attendance in the room people tab, on the detail page and a quorum field"
```

---

### Task 12: E2E, chụp màn hình, cổng cuối

**Files:**
- Create: `e2e/meetings-attendance.spec.ts`

**Interfaces:**
- Consumes: helper `createRecordingAccount`, `registerApiUser`, `joinWorkspaceAsMember`, `createInstantMeeting`, `loginViaUi` trong `e2e/meeting-recording-fixture.ts`.

- [ ] **Step 1: Viết spec**

```ts
import { expect, test } from "@playwright/test";
import {
  createInstantMeeting,
  createRecordingAccount,
  joinWorkspaceAsMember,
  loginViaUi,
  registerApiUser,
} from "./meeting-recording-fixture";

// Attendance without LiveKit: nobody's client opens a room session locally,
// so the roll starts all-absent and the clerk marks people by hand — the same
// path a real clerk uses. Needs `make dev`.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8090";

test("attendance: secretary marks, quorum warns, finalize shows on the timeline", async ({ page }) => {
  const host = await createRecordingAccount(page, API, "att-host");
  const member = await registerApiUser(page, API, "att-member");
  await joinWorkspaceAsMember(page, API, host.token, host.wsId, member);
  const meeting = await createInstantMeeting(page, API, host.token, host.wsId, "Giao ban e2e");
  const auth = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };

  const me = await page.request.get(`${API}/api/v1/me`, { headers: { authorization: `Bearer ${member.token}` } });
  expect(me.ok()).toBeTruthy();
  const memberUserId = ((await me.json()) as { user: { id: string } }).user.id;
  const invited = await page.request.post(`${API}/api/v1/meetings/${meeting.id}/invitations`, {
    headers: auth,
    data: { user_id: memberUserId },
  });
  expect(invited.ok(), `invite to meeting: HTTP ${invited.status()} ${await invited.text()}`).toBeTruthy();
  const memberPid = (await invited.json()).participant.id as string;
  expect((await page.request.patch(`${API}/api/v1/meetings/${meeting.id}`, { headers: auth, data: { quorum_percent: 60 } })).ok()).toBeTruthy();
  expect(
    (await page.request.patch(`${API}/api/v1/meetings/${meeting.id}/participants/${memberPid}`, { headers: auth, data: { is_secretary: true } })).ok(),
  ).toBeTruthy();

  // The secretary runs the roll on the detail page.
  await loginViaUi(page, member.email);
  await page.goto(`/${host.orgSlug}/${host.wsSlug}/meetings/${meeting.id}`);
  // PanelCard is a <section aria-labelledby="attendance-heading">.
  const card = page.getByRole("region", { name: "Điểm danh" });
  await expect(card.getByText("Chưa đủ tỉ lệ (cần 60%)")).toBeVisible({ timeout: 15_000 });

  for (const name of ["att-host", "att-member"]) {
    await card.getByRole("combobox", { name: `Trạng thái điểm danh của ${name}` }).click();
    await page.getByRole("option", { name: "Có mặt" }).click();
  }
  await expect(card.getByText("Đủ tỉ lệ có mặt")).toBeVisible();
  await card.getByRole("button", { name: "Chốt điểm danh" }).click();
  await expect(card.getByText(/Đã chốt lúc/)).toBeVisible();
  await expect(page.getByText("đã chốt điểm danh")).toBeVisible();
});
```
Tên trong nhãn combobox là `display_name` lúc đăng ký (tham số `tag` của fixture).

- [ ] **Step 2: Chạy riêng spec này**

Run: `make start` (nếu chưa chạy; nhớ kill backend cũ trên 8090 để nạp code Go mới), rồi `pnpm exec playwright test e2e/meetings-attendance.spec.ts` từ thư mục gốc (hoặc lệnh e2e đơn lẻ mà `Makefile`/`package.json` gốc cung cấp).
Expected: 1 passed.

- [ ] **Step 3: Chụp màn hình xác minh (không commit)**

Viết spec tạm `e2e/tmp-attendance-shots.spec.ts` tái dùng kịch bản trên, chụp `page.screenshot` thẻ Điểm danh trên trang chi tiết (sáng/tối qua `page.emulateMedia({ colorScheme })`) vào scratchpad; mở ảnh kiểm tra bố cục, tương phản chip, chữ tiếng Việt không bị cắt. Xoá spec tạm sau khi xem.

- [ ] **Step 4: Cổng cuối**

Run: `make check`
Expected: xanh. Chữ ký đỏ đã biết không do thay đổi này (ghi trong memory dự án): `TestAIEndpoints` lệch đồng hồ colima, e2e `toHaveURL(/onboarding/)` chập chờn — chạy lại một lần trước khi kết luận.

- [ ] **Step 5: Commit**

```bash
git add e2e/meetings-attendance.spec.ts
git commit -m "test(e2e): secretary runs and finalizes attendance"
```

---

## Ghi chép thực thi

(Điền trong lúc làm: sai khác so với plan, tên kiểu sqlc thực tế, test đỏ sẵn có.)
