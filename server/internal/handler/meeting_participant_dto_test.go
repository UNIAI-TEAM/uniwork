package handler

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestToParticipantDTOHidesRemoverFromGuests(t *testing.T) {
	at := time.Date(2026, 10, 27, 8, 52, 0, 0, time.UTC)
	p := db.MeetingParticipant{
		ID: "p1", MeetingID: "m1", PrincipalType: "USER", Status: "REMOVED",
		RemovedBy: pgtype.Text{String: "u-host", Valid: true},
		RemovedAt: pgtype.Timestamptz{Time: at, Valid: true},
	}
	member := toParticipantDTO(p, false, true)
	if !member.InRoom || member.RemovedBy != "u-host" || member.RemovedAt != "2026-10-27T08:52:00Z" {
		t.Fatalf("member view = %+v", member)
	}
	guest := toParticipantDTO(p, true, false)
	if guest.RemovedBy != "" {
		t.Fatalf("guest sees remover %q", guest.RemovedBy)
	}
	if guest.RemovedAt != "2026-10-27T08:52:00Z" || guest.InRoom {
		t.Fatalf("guest view = %+v", guest)
	}
}
