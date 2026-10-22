package handler

import (
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// TestToChatMessageDTODocumentOriginAndOtherEditors pins the S1d (UNI-2012)
// delete-dialog fields: origin rides on every document block, access or not;
// other_editors_count is present only where the service filled it (the
// sender's own upload-origin card), and a zero count stays in the JSON.
func TestToChatMessageDTODocumentOriginAndOtherEditors(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name      string
		info      service.DocumentMessageInfo
		wantCount any
	}{
		{"sender upload, nobody else edited", service.DocumentMessageInfo{
			DocumentID: "doc", HasAccess: true, Origin: "upload", HasOtherEditorsCount: true,
		}, float64(0)},
		{"sender upload, two others edited", service.DocumentMessageInfo{
			DocumentID: "doc", HasAccess: true, Origin: "upload", OtherEditorsCount: 2, HasOtherEditorsCount: true,
		}, float64(2)},
		{"recipient without access", service.DocumentMessageInfo{
			DocumentID: "doc", Origin: "link",
		}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dto := toChatMessageDTO(service.ChatMessageRow{ID: "m", Kind: "document", Document: &tc.info})
			raw, err := json.Marshal(dto.Document)
			if err != nil {
				t.Fatal(err)
			}
			var got map[string]any
			if err := json.Unmarshal(raw, &got); err != nil {
				t.Fatal(err)
			}
			if got["origin"] != tc.info.Origin {
				t.Fatalf("origin = %v, want %q", got["origin"], tc.info.Origin)
			}
			if got["other_editors_count"] != tc.wantCount {
				t.Fatalf("other_editors_count = %v, want %v", got["other_editors_count"], tc.wantCount)
			}
			if !tc.info.HasAccess && got["title"] != nil {
				t.Fatalf("a block without access carries a title: %s", raw)
			}
		})
	}
}
