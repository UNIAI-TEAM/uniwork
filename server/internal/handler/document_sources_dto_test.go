package handler

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// UNI-1814 review R1-1: the list handler's DTO emits the parent key
// "message_id" on the wire for every row - the message id for a chat file,
// and "" for the other sources, since the SDO tag has no omitempty and a
// client reads the key without a fallback.
func TestDocumentSourceDTOAlwaysCarriesTheMessageIDKey(t *testing.T) {
	const messageID = "01J8X4MSG0N1P2Q3R4S5T6U7V8"
	cases := []struct {
		name      string
		source    string
		messageID string
		want      string
	}{
		{"chat file", service.DocumentSourceChat, messageID, messageID},
		{"task file", service.DocumentSourceTask, "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			it := service.DocumentSourceItem{
				ID: c.source + ":01J8X4ROW0N1P2Q3R4S5T6U7V8", Source: c.source,
				Parent: service.DocumentSourceParent{
					Kind: "chat_channel", ID: "01J8X4ROOM0N1P2Q3R4S5T6U7V8", Title: "Kênh dự án", MessageID: c.messageID,
				},
				Name: "file.pdf", MimeType: "application/pdf", Extension: "pdf", SizeBytes: 42,
				UpdatedAt: time.Date(2026, time.October, 12, 8, 0, 0, 0, time.UTC),
			}
			raw, err := json.Marshal(documentSourceDTO(it))
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var wire map[string]any
			if err := json.Unmarshal(raw, &wire); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			parent, ok := wire["parent"].(map[string]any)
			if !ok {
				t.Fatalf("parent = %#v in %s", wire["parent"], raw)
			}
			got, ok := parent["message_id"]
			if !ok {
				t.Fatalf("parent has no message_id key: %s", raw)
			}
			if got != c.want {
				t.Fatalf("parent.message_id = %#v, want %q in %s", got, c.want, raw)
			}
		})
	}
}
