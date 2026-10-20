package notification

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// The clerk who queued an uploaded recording hears when it is transcribed
// or failed for good (UNI-2001, parent spec §8.3); the worker is the actor,
// so the requester is never excluded, and nobody else is told.
func TestRuleTranscriptionTellsTheRequester(t *testing.T) {
	for topic, kind := range map[string]string{
		"transcription.completed": KindMeetingTranscriptReady,
		"transcription.failed":    KindMeetingTranscriptFailed,
	} {
		t.Run(topic, func(t *testing.T) {
			f := newFixture(t)
			m, err := f.meetings.CreateInstant(f.ctx, f.owner.ID, f.wsID, "Họp chi bộ")
			if err != nil {
				t.Fatal(err)
			}
			id := util.NewID()
			if _, err := f.pool.Exec(f.ctx, `INSERT INTO meeting_transcriptions (id, organization_id, workspace_id, meeting_id, file_id,
				content_type, size_bytes, estimated_seconds, starts_at, language, created_by, created_by_kind)
				VALUES ($1, $2, $3, $4, $1, 'audio/mpeg', 1, 1, now(), 'vi', $5, 'human')`, id, f.orgID, f.wsID, m.ID, f.member.ID); err != nil {
				t.Fatal(err)
			}
			ev := outbox.Row{
				ID: util.NewID(), Topic: topic, EventVersion: 1, CreatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
				Payload:        `{"meeting_id":"` + m.ID + `","transcription_id":"` + id + `","workspace_id":"` + f.wsID + `"}`,
				OrganizationID: pgtype.Text{String: f.orgID, Valid: true}, WorkspaceID: pgtype.Text{String: f.wsID, Valid: true},
				ActorKind: pgtype.Text{String: "system", Valid: true}, ActorID: pgtype.Text{String: "meeting_transcription", Valid: true},
			}
			if err := f.consumer.Handle(f.ctx, ev); err != nil {
				t.Fatal(err)
			}
			got := f.inbox(t, f.member.ID)
			if len(got) != 1 || got[0].Kind != kind || got[0].ResourceType != "meeting" || got[0].ResourceID != m.ID ||
				!contains(got[0].Params, `"meeting":"Họp chi bộ"`) {
				t.Fatalf("requester inbox = %+v", got)
			}
			if len(f.inbox(t, f.owner.ID)) != 0 {
				t.Fatal("someone other than the requester was told")
			}
			// An event of another tenant names nothing it can reach.
			ev.ID, ev.OrganizationID = util.NewID(), pgtype.Text{String: "other-org", Valid: true}
			if err := f.consumer.Handle(f.ctx, ev); err != nil {
				t.Fatal(err)
			}
			if n := len(f.inbox(t, f.member.ID)); n != 1 {
				t.Fatalf("a foreign event added a row: %d", n)
			}
		})
	}
}
