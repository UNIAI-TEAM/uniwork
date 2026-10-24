package service

import (
	"context"
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
