package service

import (
	"context"
	"errors"
	"testing"
)

// UNI-2153: a note is a business write, so it lands with its audit row and an
// ids-only note.created on the outbox, in the note's own transaction.
func TestAddNoteRecordsAuditRowAndEvent(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	for _, body := range []string{"Chốt ngân sách", "Gửi biên bản"} {
		n, err := s.AddNote(ctx, ua.ID, m.ID, body)
		if err != nil {
			t.Fatal(err)
		}
		var events, audits int
		if err := s.pool.QueryRow(ctx,
			`SELECT count(*) FROM outbox_events WHERE topic = 'note.created'
			   AND payload::jsonb->>'note_id' = $1 AND payload::jsonb->>'meeting_id' = $2
			   AND payload::jsonb ? 'version' AND NOT payload::jsonb ? 'body'`, n.ID, m.ID).Scan(&events); err != nil {
			t.Fatal(err)
		}
		if err := s.pool.QueryRow(ctx,
			`SELECT count(*) FROM audit_events WHERE action = 'meeting.note_added'
			   AND resource_type = 'meeting_note' AND resource_id = $1 AND actor_id = $2`, n.ID, ua.ID).Scan(&audits); err != nil {
			t.Fatal(err)
		}
		if events != 1 || audits != 1 {
			t.Fatalf("note %s: outbox rows = %d, audit rows = %d, want 1 and 1", n.ID, events, audits)
		}
	}
	if _, err := s.AddNote(ctx, ua.ID, m.ID, "   "); !isValidation(err) {
		t.Fatalf("blank note: %v", err)
	}
}

// UNI-2217: the author and the meeting's clerks (host, secretary, workspace
// admin) may edit or delete a note; anyone else is refused, a note of another
// meeting is not found, and each change is audited with an ids-only event.
func TestUpdateAndDeleteNote(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	uc := workspaceUser(t, s, m.WorkspaceID, "c@example.com", "member")

	nb, err := s.AddNote(ctx, ub.ID, m.ID, "Ghi chú của B")
	if err != nil {
		t.Fatal(err)
	}
	if nb.EditedAt.Valid {
		t.Fatal("a fresh note is marked edited")
	}
	got, err := s.UpdateNote(ctx, ub.ID, m.ID, nb.ID, "B sửa")
	if err != nil || got.Body != "B sửa" || !got.EditedAt.Valid {
		t.Fatalf("author edits own note: %+v, %v", got, err)
	}
	if _, err := s.UpdateNote(ctx, ub.ID, m.ID, nb.ID, " \n "); !isValidation(err) {
		t.Fatalf("blank edit: %v, want validation", err)
	}
	if _, err := s.UpdateNote(ctx, uc.ID, m.ID, nb.ID, "C sửa"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("plain member edits another's note: %v, want forbidden", err)
	}
	if err := s.DeleteNote(ctx, uc.ID, m.ID, nb.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("plain member deletes another's note: %v, want forbidden", err)
	}
	if _, err := s.UpdateNote(ctx, ua.ID, m.ID, nb.ID, "Chủ tọa sửa"); err != nil {
		t.Fatalf("host edits another's note: %v", err)
	}

	m2, err := s.CreateInstant(ctx, ua.ID, m.WorkspaceID, "Họp khác")
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.AddNote(ctx, ua.ID, m2.ID, "Ở cuộc họp khác")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateNote(ctx, ua.ID, m.ID, other.ID, "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("note of another meeting: %v, want not found", err)
	}
	if err := s.DeleteNote(ctx, ua.ID, m.ID, other.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete note of another meeting: %v, want not found", err)
	}

	// The secretary clerks someone else's note.
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	na, err := s.AddNote(ctx, ua.ID, m.ID, "Ghi chú của A")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateNote(ctx, ub.ID, m.ID, na.ID, "Thư ký sửa"); err != nil {
		t.Fatalf("secretary edits another's note: %v", err)
	}
	if err := s.DeleteNote(ctx, ub.ID, m.ID, na.ID); err != nil {
		t.Fatalf("secretary deletes another's note: %v", err)
	}
	if err := s.DeleteNote(ctx, ua.ID, m.ID, nb.ID); err != nil {
		t.Fatalf("host deletes another's note: %v", err)
	}
	notes, err := s.Notes(ctx, ua.ID, m.ID)
	if err != nil || len(notes) != 0 {
		t.Fatalf("notes after deletes = %d, %v; want none", len(notes), err)
	}

	for _, c := range []struct {
		topic, action, noteID, actor string
		want                         int
	}{
		{"note.updated", "meeting.note_updated", nb.ID, ub.ID, 1},
		{"note.updated", "meeting.note_updated", nb.ID, ua.ID, 1},
		{"note.updated", "meeting.note_updated", na.ID, ub.ID, 1},
		{"note.deleted", "meeting.note_deleted", na.ID, ub.ID, 1},
		{"note.deleted", "meeting.note_deleted", nb.ID, ua.ID, 1},
		{"note.updated", "meeting.note_updated", nb.ID, uc.ID, 0},
	} {
		var events, audits int
		if err := s.pool.QueryRow(ctx,
			`SELECT count(*) FROM outbox_events WHERE topic = $1
			   AND payload::jsonb->>'note_id' = $2 AND payload::jsonb->>'meeting_id' = $3
			   AND NOT payload::jsonb ? 'body'`, c.topic, c.noteID, m.ID).Scan(&events); err != nil {
			t.Fatal(err)
		}
		if err := s.pool.QueryRow(ctx,
			`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_type = 'meeting_note'
			   AND resource_id = $2 AND actor_id = $3`, c.action, c.noteID, c.actor).Scan(&audits); err != nil {
			t.Fatal(err)
		}
		if audits != c.want || (c.want > 0 && events == 0) {
			t.Fatalf("%s on %s by %s: audit rows = %d (want %d), outbox rows = %d", c.action, c.noteID, c.actor, audits, c.want, events)
		}
	}
	var leaked int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE resource_type = 'meeting_note'
		   AND (metadata::text LIKE '%sửa%' OR changes::text LIKE '%sửa%')`).Scan(&leaked); err != nil {
		t.Fatal(err)
	}
	if leaked != 0 {
		t.Fatalf("%d audit rows carry note text", leaked)
	}
}
