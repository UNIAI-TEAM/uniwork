package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func errMotionNotDraft() error {
	return coded(http.StatusConflict, "motion_not_draft", "chỉ sửa hoặc xóa được nội dung còn nháp")
}

func errMotionNotOpen() error {
	return coded(http.StatusConflict, "motion_not_open", "nội dung này không đang mở biểu quyết")
}

func errMotionAlreadyOpen() error {
	return coded(http.StatusConflict, "motion_already_open", "đang có nội dung khác mở biểu quyết")
}

func errAlreadyVoted() error {
	return coded(http.StatusConflict, "already_voted", "bạn đã bỏ phiếu cho nội dung này")
}

func errNotOnRoll() error {
	return coded(http.StatusForbidden, "not_on_roll", "bạn không thuộc danh sách bỏ phiếu của nội dung này")
}

// MotionInput is a new item as the clerk drafts it.
type MotionInput struct {
	Title, Description, BallotMode, Threshold, Base string
}

// MotionPatch edits a draft; a nil field stays as it is. Position moves the
// item by swapping places with the draft that holds that position now.
type MotionPatch struct {
	Title, Description, BallotMode, Threshold, Base *string
	Position                                        *int32
}

func cleanMotionTitle(v string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return "", Invalid("nội dung biểu quyết không được để trống")
	}
	if utf8.RuneCountInString(v) > motionTitleMax {
		return "", Invalid("nội dung biểu quyết tối đa 200 ký tự")
	}
	return v, nil
}

func cleanMotionDescription(v string) (string, error) {
	v = strings.TrimSpace(v)
	if utf8.RuneCountInString(v) > motionDescriptionMax {
		return "", Invalid("mô tả tối đa 2000 ký tự")
	}
	return v, nil
}

func checkBallotMode(v string) error {
	if !validBallotMode(v) {
		return Invalid("hình thức bỏ phiếu phải là PUBLIC hoặc SECRET")
	}
	return nil
}

func checkThreshold(v string) error {
	if !validThreshold(v) {
		return Invalid("ngưỡng thông qua phải là MAJORITY hoặc TWO_THIRDS")
	}
	return nil
}

func checkMotionBase(v string) error {
	if !validMotionBase(v) {
		return Invalid("cách tính phải là PRESENT hoặc ALL_MEMBERS")
	}
	return nil
}

// motionDiff is the audit change set of an edited draft: only the fields
// that actually moved end up in the row (audit.Diff drops equal values).
func motionDiff(before, after db.MeetingMotion) map[string]audit.Change {
	return audit.Diff(
		map[string]any{
			"title": before.Title, "description": before.Description, "ballot_mode": before.BallotMode,
			"threshold": before.Threshold, "base": before.Base, "position": before.Position,
		},
		map[string]any{
			"title": after.Title, "description": after.Description, "ballot_mode": after.BallotMode,
			"threshold": after.Threshold, "base": after.Base, "position": after.Position,
		},
	)
}

// lockDraftMotion takes the meeting row, then the motion row (the lock order
// every motion command keeps), and refuses anything that is no longer a draft.
func lockDraftMotion(ctx context.Context, q *db.Queries, meetingID, motionID string) (db.Meeting, db.MeetingMotion, error) {
	m, err := q.LockMeetingForAttendance(ctx, meetingID)
	if err != nil {
		return db.Meeting{}, db.MeetingMotion{}, err
	}
	mo, err := q.LockMeetingMotion(ctx, db.LockMeetingMotionParams{ID: motionID, MeetingID: meetingID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, db.MeetingMotion{}, ErrNotFound
	}
	if err != nil {
		return db.Meeting{}, db.MeetingMotion{}, err
	}
	if mo.Status != MotionDraft {
		return db.Meeting{}, db.MeetingMotion{}, errMotionNotDraft()
	}
	return m, mo, nil
}

// CreateMotion drafts an item at the end of the meeting's list. Drafting is
// allowed before the meeting starts so the clerk can prepare the agenda;
// opening it for votes waits for IN_PROGRESS.
func (s *MeetingService) CreateMotion(ctx context.Context, actorID, meetingID string, in MotionInput) (db.MeetingMotion, error) {
	m, err := s.requireMeetingClerk(ctx, actorID, meetingID)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	if m.Status != MeetingScheduled && m.Status != MeetingInProgress {
		return db.MeetingMotion{}, errInvalidState()
	}
	title, err := cleanMotionTitle(in.Title)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	description, err := cleanMotionDescription(in.Description)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	if err := checkBallotMode(in.BallotMode); err != nil {
		return db.MeetingMotion{}, err
	}
	if err := checkThreshold(in.Threshold); err != nil {
		return db.MeetingMotion{}, err
	}
	if err := checkMotionBase(in.Base); err != nil {
		return db.MeetingMotion{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// The meeting lock serializes MAX(position)+1, so two clerks drafting at
	// once do not get the same position, and re-reads the status the gate saw.
	locked, err := q.LockMeetingForAttendance(ctx, m.ID)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	if locked.Status != MeetingScheduled && locked.Status != MeetingInProgress {
		return db.MeetingMotion{}, errInvalidState()
	}
	mo, err := q.CreateMeetingMotion(ctx, db.CreateMeetingMotionParams{
		ID: util.NewID(), OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID, MeetingID: locked.ID,
		Title: title, Description: description,
		BallotMode: in.BallotMode, Threshold: in.Threshold, Base: in.Base,
		CreatedBy: actorID,
	})
	if err != nil {
		return db.MeetingMotion{}, err
	}
	s.record(ctx, q, locked, audit.User(actorID), "motion.created",
		meetingRelatedPayload(locked, map[string]string{"motion_id": mo.ID}), nil)
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingMotion{}, err
	}
	return mo, nil
}

// UpdateMotion edits a draft. A new position swaps with the item that holds
// it, which must be a draft too: open and closed items keep their place.
func (s *MeetingService) UpdateMotion(ctx context.Context, actorID, meetingID, motionID string, in MotionPatch) (db.MeetingMotion, error) {
	if in.Title == nil && in.Description == nil && in.BallotMode == nil && in.Threshold == nil && in.Base == nil && in.Position == nil {
		return db.MeetingMotion{}, Invalid("không có thay đổi nào")
	}
	m, err := s.requireMeetingClerk(ctx, actorID, meetingID)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	var title, description string
	if in.Title != nil {
		if title, err = cleanMotionTitle(*in.Title); err != nil {
			return db.MeetingMotion{}, err
		}
	}
	if in.Description != nil {
		if description, err = cleanMotionDescription(*in.Description); err != nil {
			return db.MeetingMotion{}, err
		}
	}
	if in.BallotMode != nil {
		if err := checkBallotMode(*in.BallotMode); err != nil {
			return db.MeetingMotion{}, err
		}
	}
	if in.Threshold != nil {
		if err := checkThreshold(*in.Threshold); err != nil {
			return db.MeetingMotion{}, err
		}
	}
	if in.Base != nil {
		if err := checkMotionBase(*in.Base); err != nil {
			return db.MeetingMotion{}, err
		}
	}
	if in.Position != nil && *in.Position < 1 {
		return db.MeetingMotion{}, Invalid("vị trí phải từ 1 trở lên")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	locked, mo, err := lockDraftMotion(ctx, q, m.ID, motionID)
	if err != nil {
		return db.MeetingMotion{}, err
	}
	next := db.UpdateMeetingMotionDraftParams{
		ID: mo.ID, Title: mo.Title, Description: mo.Description,
		BallotMode: mo.BallotMode, Threshold: mo.Threshold, Base: mo.Base, Position: mo.Position,
	}
	if in.Title != nil {
		next.Title = title
	}
	if in.Description != nil {
		next.Description = description
	}
	if in.BallotMode != nil {
		next.BallotMode = *in.BallotMode
	}
	if in.Threshold != nil {
		next.Threshold = *in.Threshold
	}
	if in.Base != nil {
		next.Base = *in.Base
	}
	if in.Position != nil && *in.Position != mo.Position {
		next.Position = *in.Position
		other, err := q.GetMeetingMotionAtPosition(ctx, db.GetMeetingMotionAtPositionParams{
			MeetingID: locked.ID, Position: *in.Position, ID: mo.ID,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// Nothing sits there: the item simply moves.
		case err != nil:
			return db.MeetingMotion{}, err
		case other.Status != MotionDraft:
			return db.MeetingMotion{}, errMotionNotDraft()
		default:
			if err := q.SetMeetingMotionPosition(ctx, db.SetMeetingMotionPositionParams{Position: mo.Position, ID: other.ID}); err != nil {
				return db.MeetingMotion{}, err
			}
		}
	}
	up, err := q.UpdateMeetingMotionDraft(ctx, next)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingMotion{}, errMotionNotDraft()
	}
	if err != nil {
		return db.MeetingMotion{}, err
	}
	s.record(ctx, q, locked, audit.User(actorID), "motion.updated",
		meetingRelatedPayload(locked, map[string]string{"motion_id": up.ID}), motionDiff(mo, up))
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingMotion{}, err
	}
	return up, nil
}

// DeleteMotion removes a draft for good; open and closed items are part of
// the meeting's record and stay.
func (s *MeetingService) DeleteMotion(ctx context.Context, actorID, meetingID, motionID string) error {
	m, err := s.requireMeetingClerk(ctx, actorID, meetingID)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	locked, mo, err := lockDraftMotion(ctx, q, m.ID, motionID)
	if err != nil {
		return err
	}
	n, err := q.DeleteMeetingMotionDraft(ctx, mo.ID)
	if err != nil {
		return err
	}
	if n == 0 {
		return errMotionNotDraft()
	}
	s.record(ctx, q, locked, audit.User(actorID), "motion.deleted",
		meetingRelatedPayload(locked, map[string]string{"motion_id": mo.ID}),
		audit.Diff(map[string]any{"title": mo.Title}, map[string]any{"title": nil}))
	return tx.Commit(ctx)
}
