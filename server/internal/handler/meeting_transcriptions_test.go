package handler

import (
	"encoding/json"
	"strings"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The page sizes "đang ghi lời bản ghi n phút" from the estimate before the vendor answers (UNI-2247).
func TestTranscriptionDTOCarriesEstimatedSeconds(t *testing.T) {
	out, err := json.Marshal(toTranscriptionDTO(db.MeetingTranscription{ID: "t1", MeetingID: "m1", Status: "QUEUED", EstimatedSeconds: 2538}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"estimated_seconds":2538`) {
		t.Fatalf("estimated_seconds not served: %s", out)
	}
}
