package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// meetingWorld adds a third person, uc, to the workspace.
func meetingWorld(t *testing.T) (*mcpToolWorld, *AskUNIService, ai.ToolContext, db.User) {
	t.Helper()
	x, s, tc := askWriteWorld(t)
	uc := registerVerified(t, s.q, NewAuthService(s.pool, s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "meet-c@example.com", "C")
	addOrgMember(t, s.q, x.w.OrganizationID, uc.ID)
	addWorkspaceMember(t, s.q, x.w.ID, uc.ID)
	return x, s, tc, uc
}

func scheduleArgsAt(start time.Time, extra string) string {
	return fmt.Sprintf(`{"title":"Giao ban","starts_at":%q,"ends_at":%q%s}`, start.Format(time.RFC3339), start.Add(time.Hour).Format(time.RFC3339), extra)
}

func TestAskWriteMeetingCapsPeopleAtTen(t *testing.T) {
	x, s, tc := askWriteWorld(t)
	ids := make([]string, 11)
	for i := range ids {
		ids[i] = fmt.Sprintf("u%d", i)
	}
	people, _ := json.Marshal(ids)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Họp", "")
	for _, c := range []struct{ tool, args string }{
		{"schedule_meeting", scheduleArgsAt(time.Now().Add(24*time.Hour), `,"attendee_ids":`+string(people))},
		{"invite_to_meeting", fmt.Sprintf(`{"meeting_id":%q,"user_ids":%s}`, m.ID, people)},
	} {
		_, err := writeToolNamed(t, s, c.tool).prepare(context.Background(), tc, json.RawMessage(c.args), nil)
		var inv McpInvalidArgs
		if !errors.As(err, &inv) || !strings.Contains(inv.Msg, "10") {
			t.Errorf("%s with 11 people: err = %v", c.tool, err)
		}
	}
}

func TestAskWriteMeetingApplyAndUndo(t *testing.T) {
	x, s, tc, uc := meetingWorld(t)
	ctx := context.Background()
	p := principalOf(tc)
	run := func(name, args string) (AskProposalResult, *askInverse, error) {
		return writeToolNamed(t, s, name).apply(ctx, p, askPrepare(t, s, tc, name, args))
	}
	undo := func(inv *askInverse) error {
		t.Helper()
		if inv == nil {
			t.Fatal("no inverse")
		}
		return askInverses[inv.Op](ctx, s, p, inv.Args)
	}
	status := func(id string) string { return x.meetingRow(t, id).Status }

	// schedule → cancel
	res, inv, err := run("schedule_meeting", scheduleArgsAt(time.Now().Add(24*time.Hour), ""))
	if err != nil || res.ObjectID == "" || res.Href == "" || inv == nil || inv.Op != "cancel_meeting" {
		t.Fatalf("schedule: %+v %v %v", res, inv, err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if got := status(res.ObjectID); got != MeetingCanceled {
		t.Fatalf("status %s", got)
	}

	// cancel → restore; restore → cancel
	var state McpToolError
	if _, err := writeToolNamed(t, s, "cancel_meeting").prepare(ctx, tc, json.RawMessage(fmt.Sprintf(`{"meeting_id":%q}`, res.ObjectID)), nil); !errors.As(err, &state) || state.Code != "invalid_meeting_state" {
		t.Fatalf("cancelling a cancelled meeting: %v", err)
	}
	m := x.meeting(t, x.ua.ID, x.w.ID, "Sắp họp", "")
	if _, inv, err = run("cancel_meeting", fmt.Sprintf(`{"meeting_id":%q,"reason":"bận"}`, m.ID)); err != nil || inv == nil || inv.Op != "restore_meeting" {
		t.Fatalf("cancel: %v %v", inv, err)
	}
	if status(m.ID) != MeetingCanceled {
		t.Fatal("not cancelled")
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if status(m.ID) != MeetingScheduled {
		t.Fatal("not restored")
	}
	_, _, _ = run("cancel_meeting", fmt.Sprintf(`{"meeting_id":%q}`, m.ID))
	if _, inv, err = run("restore_meeting", fmt.Sprintf(`{"meeting_id":%q}`, m.ID)); err != nil || inv == nil || inv.Op != "cancel_meeting" {
		t.Fatalf("restore: %v %v", inv, err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if status(m.ID) != MeetingCanceled {
		t.Fatal("not cancelled again")
	}
	// someone restored it meanwhile: undo of the cancel refuses
	_, inv, _ = run("restore_meeting", fmt.Sprintf(`{"meeting_id":%q}`, m.ID))
	v := x.meetingRow(t, m.ID).Version
	if err := s.meetings.CancelAt(ctx, x.ua.ID, m.ID, "", v); err != nil {
		t.Fatal(err)
	}
	assertUndoUnavailable(t, undo(inv))
	if status(m.ID) != MeetingCanceled {
		t.Fatal("undo wrote")
	}
	// a meeting whose end is past cannot be brought back: no inverse
	past := x.meeting(t, x.ua.ID, x.w.ID, "Đã qua", "")
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = $1`, past.ID); err != nil {
		t.Fatal(err)
	}
	res, inv, err = run("cancel_meeting", fmt.Sprintf(`{"meeting_id":%q}`, past.ID))
	if err != nil || inv != nil || res.Note == "" || status(past.ID) != MeetingCanceled {
		t.Fatalf("cancel past: %+v %v %v", res, inv, err)
	}

	// invite two, one already on the meeting: undo removes only the new one
	att := x.meeting(t, x.ua.ID, x.w.ID, "Có người", "")
	if _, err := s.meetings.Invite(ctx, x.ua.ID, att.ID, x.ub.ID); err != nil {
		t.Fatal(err)
	}
	res, inv, err = run("invite_to_meeting", fmt.Sprintf(`{"meeting_id":%q,"user_ids":[%q,%q]}`, att.ID, x.ub.ID, uc.ID))
	if err != nil || inv == nil || inv.Op != "remove_meeting_participants" || res.ObjectID != att.ID {
		t.Fatalf("invite: %+v %v %v", res, inv, err)
	}
	if !strings.Contains(string(inv.Args), uc.ID) || strings.Contains(string(inv.Args), x.ub.ID) {
		t.Fatalf("inverse args %s", inv.Args)
	}
	active := func() []string {
		rows, err := s.meetings.ListParticipants(ctx, x.ua.ID, "", att.ID)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, r := range rows {
			if r.Status == ParticipantActive {
				out = append(out, r.UserID.String)
			}
		}
		return out
	}
	if got := active(); !slices.Contains(got, uc.ID) {
		t.Fatalf("not invited: %v", got)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if got := active(); slices.Contains(got, uc.ID) || !slices.Contains(got, x.ub.ID) {
		t.Fatalf("after undo: %v", got)
	}

	// update → the old time and text come back, down to empty values
	upd := x.meeting(t, x.ua.ID, x.w.ID, "Gốc", "mô tả cũ")
	before := x.meetingRow(t, upd.ID)
	nt := time.Now().Add(48 * time.Hour)
	res, inv, err = run("update_meeting", fmt.Sprintf(`{"meeting_id":%q,"title":"Ngọn","description":"","starts_at":%q,"ends_at":%q,"project_id":null}`, upd.ID, nt.Format(time.RFC3339), nt.Add(time.Hour).Format(time.RFC3339)))
	if err != nil || inv == nil || inv.Op != "update_meeting" || len(res.Changes) != 4 {
		t.Fatalf("update: %+v %v %v", res, inv, err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	got := x.meetingRow(t, upd.ID)
	if got.Title != "Gốc" || got.Description != "mô tả cũ" || !got.StartsAt.Time.Equal(before.StartsAt.Time) || !got.EndsAt.Time.Equal(before.EndsAt.Time) {
		t.Fatalf("not restored: %+v", got)
	}
	// an edit after the update: undo refuses and writes nothing
	_, inv, _ = run("update_meeting", fmt.Sprintf(`{"meeting_id":%q,"title":"Hai"}`, upd.ID))
	other := "Người khác"
	if _, err := s.meetings.Update(ctx, x.ua.ID, upd.ID, UpdateMeetingInput{Title: &other}); err != nil {
		t.Fatal(err)
	}
	assertUndoUnavailable(t, undo(inv))
	if x.meetingRow(t, upd.ID).Title != other {
		t.Fatal("undo wrote")
	}
	// a no-op update never becomes a row
	if _, err := writeToolNamed(t, s, "update_meeting").prepare(ctx, tc, json.RawMessage(fmt.Sprintf(`{"meeting_id":%q,"title":%q}`, upd.ID, other)), nil); !errors.As(err, new(McpInvalidArgs)) {
		t.Fatalf("no-op err = %v", err)
	}
}

func TestAskWriteMeetingAudience(t *testing.T) {
	x, s, tc, uc := meetingWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Họp", "")
	names := s.memberNames(context.Background(), tc)

	row := askPrepare(t, s, tc, "invite_to_meeting", fmt.Sprintf(`{"meeting_id":%q,"user_ids":[%q,%q,%q]}`, m.ID, x.ub.ID, uc.ID, x.ua.ID))
	var got []string
	for _, n := range row.Preview.Audience.Notifies {
		got = append(got, n.Title)
	}
	slices.Sort(got)
	want := []string{names[x.ub.ID], names[uc.ID]}
	slices.Sort(want)
	if !slices.Equal(got, want) || row.Level != askLevel2 || row.Preview.Target.ID != m.ID || row.Preview.Target.Title != "Họp" {
		t.Fatalf("invite preview = %+v (%v)", row.Preview, got)
	}

	row = askPrepare(t, s, tc, "update_meeting", fmt.Sprintf(`{"meeting_id":%q,"title":"Đổi"}`, m.ID))
	if len(row.Preview.Audience.Notifies) != 0 || row.TargetRevision == nil || *row.TargetRevision != int64(m.Version) || row.Level != askLevel2 {
		t.Fatalf("update preview = %+v %v", row.Preview, row.TargetRevision)
	}
	if f := row.Preview.Fields; len(f) != 1 || f[0].Field != "title" || f[0].From != "Họp" || f[0].To != "Đổi" {
		t.Fatalf("fields = %+v", f)
	}
	// scheduling, cancelling and restoring notify nobody: the service sends nothing
	for _, row := range []askDraftRow{
		askPrepare(t, s, tc, "schedule_meeting", scheduleArgsAt(time.Now().Add(24*time.Hour), fmt.Sprintf(`,"attendee_ids":[%q]`, x.ub.ID))),
		askPrepare(t, s, tc, "cancel_meeting", fmt.Sprintf(`{"meeting_id":%q}`, m.ID)),
	} {
		if len(row.Preview.Audience.Notifies) != 0 || row.Level != askLevel2 || row.Preview.Audience.Notifies == nil {
			t.Errorf("%s audience = %+v", row.Tool, row.Preview.Audience)
		}
	}
}

func TestAskWriteMeetingRowRef(t *testing.T) {
	_, s, tc, _ := meetingWorld(t)
	ctx := context.Background()
	created := askPrepare(t, s, tc, "schedule_meeting", scheduleArgsAt(time.Now().Add(24*time.Hour), ""))
	for _, c := range []struct{ tool, args string }{
		{"update_meeting", `{"meeting_id":"{{row:1.id}}","title":"Mới"}`},
		{"invite_to_meeting", fmt.Sprintf(`{"meeting_id":"{{row:1.id}}","user_ids":[%q]}`, tc.ActorID)},
		{"cancel_meeting", `{"meeting_id":"{{row:1.id}}"}`},
		{"restore_meeting", `{"meeting_id":"{{row:1.id}}"}`},
	} {
		row := askPrepare(t, s, tc, c.tool, c.args, created)
		if row.Level != askLevel2 || row.TargetRevision != nil || row.TargetID != "" || !slices.Equal(row.Preview.Refs, []int{1}) || row.Preview.Target.Title != "Giao ban" {
			t.Errorf("%s row = %+v", c.tool, row)
		}
	}
	if _, err := writeToolNamed(t, s, "cancel_meeting").prepare(ctx, tc, json.RawMessage(`{"meeting_id":"{{row:1.id}}"}`), []askDraftRow{{Tool: "create_task"}}); !errors.As(err, new(McpInvalidArgs)) {
		t.Fatalf("wrong kind err = %v", err)
	}
}

// Rows of one turn that would half-apply are refused before a row exists.
func TestAskWriteMeetingSameTurnConflicts(t *testing.T) {
	x, s, tc, _ := meetingWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Họp", "")
	cancel := askPrepare(t, s, tc, "cancel_meeting", fmt.Sprintf(`{"meeting_id":%q}`, m.ID))
	for _, c := range []struct{ tool, args string }{
		{"update_meeting", fmt.Sprintf(`{"meeting_id":%q,"title":"Sau khi hủy"}`, m.ID)},
		{"invite_to_meeting", fmt.Sprintf(`{"meeting_id":%q,"user_ids":[%q]}`, m.ID, x.ub.ID)},
		{"cancel_meeting", fmt.Sprintf(`{"meeting_id":%q}`, m.ID)},
	} {
		if _, err := writeToolNamed(t, s, c.tool).prepare(ctx, tc, json.RawMessage(c.args), []askDraftRow{cancel}); !errors.As(err, new(McpInvalidArgs)) {
			t.Errorf("%s after a cancel of the same meeting: err = %v", c.tool, err)
		}
	}
	// a second edit would be written against a revision the first one outdates
	first := askPrepare(t, s, tc, "update_meeting", fmt.Sprintf(`{"meeting_id":%q,"title":"Một"}`, m.ID))
	if _, err := writeToolNamed(t, s, "update_meeting").prepare(ctx, tc, json.RawMessage(fmt.Sprintf(`{"meeting_id":%q,"title":"Hai"}`, m.ID)), []askDraftRow{first}); !errors.As(err, new(McpInvalidArgs)) {
		t.Errorf("second edit: err = %v", err)
	}
	// a state the service would refuse is no row
	for _, c := range []struct{ tool, args string }{
		{"restore_meeting", fmt.Sprintf(`{"meeting_id":%q}`, m.ID)}, // not cancelled
	} {
		if _, err := writeToolNamed(t, s, c.tool).prepare(ctx, tc, json.RawMessage(c.args), nil); err == nil {
			t.Errorf("%s was accepted", c.tool)
		}
	}
}
