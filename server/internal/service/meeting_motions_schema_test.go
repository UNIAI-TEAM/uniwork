package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Database-level proof of the vote tables (spec 2026-09-30 §3.5–3.8): the
// one-open-item and one-ballot-per-member indexes and the secret ballot that
// never stores a choice hold in Postgres, so a racing service call cannot
// break them. Service rules come later; this only drives the queries.

func expectUniqueViolation(t *testing.T, err error, index string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" || pgErr.ConstraintName != index {
		t.Fatalf("expected unique violation on %s, got %v", index, err)
	}
}

func createMotionRow(t *testing.T, s *MeetingService, m db.Meeting, orgID, actorID, title, mode string) db.MeetingMotion {
	t.Helper()
	mo, err := s.q.CreateMeetingMotion(context.Background(), db.CreateMeetingMotionParams{
		ID: util.NewID(), OrganizationID: orgID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
		Title: title, Description: "", BallotMode: mode, Threshold: "MAJORITY", Base: "PRESENT",
		CreatedBy: actorID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return mo
}

func TestMeetingMotionSchema(t *testing.T) {
	s, ua, _, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	orgID, err := s.organizationOf(ctx, m)
	if err != nil {
		t.Fatal(err)
	}

	secret := createMotionRow(t, s, m, orgID, ua.ID, "Bầu thư ký", "SECRET")
	public := createMotionRow(t, s, m, orgID, ua.ID, "Thông qua kế hoạch", "PUBLIC")
	if secret.Position != 1 || public.Position != 2 {
		t.Fatalf("positions = %d, %d; want 1, 2", secret.Position, public.Position)
	}
	if secret.Status != "DRAFT" || secret.Version != 1 || secret.CreatedByKind != "human" || secret.YesCount != 0 {
		t.Fatalf("new motion defaults = %+v", secret)
	}
	_, err = s.q.CreateMeetingMotion(ctx, db.CreateMeetingMotionParams{
		ID: util.NewID(), OrganizationID: orgID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
		Title: "x", BallotMode: "OPEN", Threshold: "MAJORITY", Base: "PRESENT", CreatedBy: ua.ID,
	})
	expectCheckViolation(t, err, "meeting_motions_ballot_mode_check")
	list, err := s.q.ListMeetingMotions(ctx, m.ID)
	if err != nil || len(list) != 2 || list[0].ID != secret.ID || list[1].ID != public.ID {
		t.Fatalf("ListMeetingMotions = %v, %v", list, err)
	}

	t.Run("one open item per meeting", func(t *testing.T) {
		opened, err := s.q.OpenMeetingMotion(ctx, db.OpenMeetingMotionParams{
			OpenedBy: strText(ua.ID), TotalMembers: 2, RollSize: 1, ID: secret.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		if opened.Status != "OPEN" || !opened.RollSize.Valid || opened.RollSize.Int32 != 1 ||
			opened.TotalMembers.Int32 != 2 || !opened.OpenedAt.Valid || opened.Version != 2 {
			t.Fatalf("opened = %+v", opened)
		}
		_, err = s.q.OpenMeetingMotion(ctx, db.OpenMeetingMotionParams{
			OpenedBy: strText(ua.ID), TotalMembers: 2, RollSize: 1, ID: public.ID,
		})
		expectUniqueViolation(t, err, "uidx_meeting_motions_open")
		if _, err := s.q.OpenMeetingMotion(ctx, db.OpenMeetingMotionParams{
			OpenedBy: strText(ua.ID), TotalMembers: 2, RollSize: 1, ID: secret.ID,
		}); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("re-open of an OPEN motion = %v, want ErrNoRows", err)
		}
		got, err := s.q.GetOpenMeetingMotion(ctx, m.ID)
		if err != nil || got.ID != secret.ID {
			t.Fatalf("GetOpenMeetingMotion = %s, %v", got.ID, err)
		}
	})

	t.Run("one ballot per member and a secret ballot keeps no choice", func(t *testing.T) {
		if err := s.q.InsertMeetingMotionBallot(ctx, db.InsertMeetingMotionBallotParams{
			ID: util.NewID(), OrganizationID: orgID, MeetingID: m.ID, MotionID: secret.ID, ParticipantID: memberPID,
		}); err != nil {
			t.Fatal(err)
		}
		err := s.q.InsertMeetingMotionBallot(ctx, db.InsertMeetingMotionBallotParams{
			ID: util.NewID(), OrganizationID: orgID, MeetingID: m.ID, MotionID: secret.ID, ParticipantID: memberPID,
		})
		expectUniqueViolation(t, err, "uidx_meeting_motion_ballots_participant")

		n, err := s.q.CastSecretMeetingBallot(ctx, db.CastSecretMeetingBallotParams{MotionID: secret.ID, ParticipantID: memberPID})
		if err != nil || n != 1 {
			t.Fatalf("CastSecretMeetingBallot = %d, %v; want 1 row", n, err)
		}
		b, err := s.q.GetMeetingMotionBallot(ctx, db.GetMeetingMotionBallotParams{MotionID: secret.ID, ParticipantID: memberPID})
		if err != nil {
			t.Fatal(err)
		}
		if b.Choice.Valid || !b.CastAt.Valid {
			t.Fatalf("secret ballot = choice %+v cast_at %+v; want NULL choice, cast_at set", b.Choice, b.CastAt)
		}
		if n, err := s.q.CastSecretMeetingBallot(ctx, db.CastSecretMeetingBallotParams{MotionID: secret.ID, ParticipantID: memberPID}); err != nil || n != 0 {
			t.Fatalf("second cast = %d, %v; want 0 rows", n, err)
		}
		if err := s.q.CountMeetingMotionVote(ctx, db.CountMeetingMotionVoteParams{Choice: "YES", ID: secret.ID}); err != nil {
			t.Fatal(err)
		}
		closed, err := s.q.CloseMeetingMotion(ctx, db.CloseMeetingMotionParams{Outcome: "PASSED", ClosedBy: strText(""), ID: secret.ID})
		if err != nil {
			t.Fatal(err)
		}
		if closed.Status != "CLOSED" || closed.Outcome.String != "PASSED" || closed.YesCount != 1 ||
			closed.NoCount != 0 || closed.ClosedBy.Valid || !closed.ClosedAt.Valid {
			t.Fatalf("closed = %+v", closed)
		}
	})

	t.Run("a public ballot names the voter", func(t *testing.T) {
		if _, err := s.q.OpenMeetingMotion(ctx, db.OpenMeetingMotionParams{
			OpenedBy: strText(ua.ID), TotalMembers: 2, RollSize: 1, ID: public.ID,
		}); err != nil {
			t.Fatalf("open after the other item closed: %v", err)
		}
		if err := s.q.InsertMeetingMotionBallot(ctx, db.InsertMeetingMotionBallotParams{
			ID: util.NewID(), OrganizationID: orgID, MeetingID: m.ID, MotionID: public.ID, ParticipantID: memberPID,
		}); err != nil {
			t.Fatal(err)
		}
		n, err := s.q.CastPublicMeetingBallot(ctx, db.CastPublicMeetingBallotParams{
			Choice: strText("NO"), MotionID: public.ID, ParticipantID: memberPID,
		})
		if err != nil || n != 1 {
			t.Fatalf("CastPublicMeetingBallot = %d, %v; want 1 row", n, err)
		}
		member, err := s.q.GetMeetingParticipant(ctx, memberPID)
		if err != nil {
			t.Fatal(err)
		}
		voters, err := s.q.ListPublicMeetingVoters(ctx, m.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(voters) != 1 || voters[0].MotionID != public.ID || voters[0].Choice.String != "NO" ||
			voters[0].DisplayNameSnapshot != member.DisplayNameSnapshot {
			t.Fatalf("public voters = %+v; want only %q voting NO on the public item", voters, member.DisplayNameSnapshot)
		}
		mine, err := s.q.ListMeetingBallotsForParticipant(ctx, db.ListMeetingBallotsForParticipantParams{MeetingID: m.ID, ParticipantID: memberPID})
		if err != nil || len(mine) != 2 {
			t.Fatalf("ballots for member = %d, %v; want 2", len(mine), err)
		}
	})

	t.Run("closed items are no longer drafts", func(t *testing.T) {
		if _, err := s.q.UpdateMeetingMotionDraft(ctx, db.UpdateMeetingMotionDraftParams{
			Title: "đổi", BallotMode: "PUBLIC", Threshold: "MAJORITY", Base: "PRESENT", Position: 1, ID: secret.ID,
		}); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("UpdateMeetingMotionDraft on CLOSED = %v, want ErrNoRows", err)
		}
		if n, err := s.q.DeleteMeetingMotionDraft(ctx, secret.ID); err != nil || n != 0 {
			t.Fatalf("DeleteMeetingMotionDraft on CLOSED = %d, %v; want 0 rows", n, err)
		}
		closedList, err := s.q.ListClosedMeetingMotions(ctx, m.ID)
		if err != nil || len(closedList) != 1 || closedList[0].ID != secret.ID {
			t.Fatalf("ListClosedMeetingMotions = %v, %v", closedList, err)
		}
		open, err := s.q.ListOpenMeetingMotionsForUpdate(ctx, m.ID)
		if err != nil || len(open) != 1 || open[0].ID != public.ID {
			t.Fatalf("ListOpenMeetingMotionsForUpdate = %v, %v", open, err)
		}
	})

	t.Run("reorder finds and moves the neighbour", func(t *testing.T) {
		third := createMotionRow(t, s, m, orgID, ua.ID, "Phân bổ ngân sách", "PUBLIC")
		if third.Position != 3 {
			t.Fatalf("third position = %d, want 3", third.Position)
		}
		at, err := s.q.GetMeetingMotionAtPosition(ctx, db.GetMeetingMotionAtPositionParams{MeetingID: m.ID, Position: 2, ID: third.ID})
		if err != nil || at.ID != public.ID {
			t.Fatalf("GetMeetingMotionAtPosition(2) = %s, %v; want the public item", at.ID, err)
		}
		if err := s.q.SetMeetingMotionPosition(ctx, db.SetMeetingMotionPositionParams{Position: 3, ID: public.ID}); err != nil {
			t.Fatal(err)
		}
		moved, err := s.q.UpdateMeetingMotionDraft(ctx, db.UpdateMeetingMotionDraftParams{
			Title: third.Title, Description: "Ghi chú", BallotMode: "SECRET", Threshold: "TWO_THIRDS",
			Base: "ALL_MEMBERS", Position: 2, ID: third.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		if moved.Position != 2 || moved.Version != 2 || moved.Threshold != "TWO_THIRDS" || moved.Description != "Ghi chú" {
			t.Fatalf("moved = %+v", moved)
		}
		if _, err := s.q.GetMeetingMotionAtPosition(ctx, db.GetMeetingMotionAtPositionParams{MeetingID: m.ID, Position: 2, ID: third.ID}); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("position 2 still has another item: %v", err)
		}
		if _, err := s.q.LockMeetingMotion(ctx, db.LockMeetingMotionParams{ID: third.ID, MeetingID: util.NewID()}); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("LockMeetingMotion with a foreign meeting = %v, want ErrNoRows", err)
		}
		if n, err := s.q.DeleteMeetingMotionDraft(ctx, third.ID); err != nil || n != 1 {
			t.Fatalf("DeleteMeetingMotionDraft on DRAFT = %d, %v; want 1 row", n, err)
		}
	})
}

// Every participant's GET /motions reads their ballots by meeting, and every
// GET after a public vote closes reads the voters by meeting. Without an index
// led by meeting_id both are full scans of a table shared by all tenants.
func TestMeetingMotionBallotsIndexedByMeeting(t *testing.T) {
	s, _, _, _, _ := governanceFixture(t)
	var def string
	if err := s.pool.QueryRow(context.Background(),
		`SELECT indexdef FROM pg_indexes WHERE tablename = 'meeting_motion_ballots' AND indexname = 'idx_meeting_motion_ballots_meeting'`,
	).Scan(&def); err != nil {
		t.Fatalf("idx_meeting_motion_ballots_meeting: %v", err)
	}
	if !strings.Contains(def, "(meeting_id, participant_id)") {
		t.Fatalf("index = %s, want (meeting_id, participant_id)", def)
	}
}
