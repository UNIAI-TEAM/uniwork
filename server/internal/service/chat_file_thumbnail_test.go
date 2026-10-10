package service

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

// A chat photo asks for its thumbnail in the send transaction, so the slow
// lane makes it off the request path; a document asks for nothing.
func TestChatFileMessageRequestsThumbnailForPhotosFS(t *testing.T) {
	s, _, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}

	photo, err := s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "anh.png", Body: bytes.NewReader(encodePNG(t, testPhoto(64, 48))), ClientMsgID: "thumb-photo-1",
	})
	if err != nil {
		t.Fatalf("send photo: %v", err)
	}
	if _, err := s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "ke-hoach.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "thumb-doc-1",
	}); err != nil {
		t.Fatalf("send pdf: %v", err)
	}

	rows, err := s.pool.Query(ctx, `SELECT payload FROM outbox_events WHERE topic = 'file.thumbnail_requested' AND organization_id = $1`, w.OrganizationID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var payloads []map[string]string
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		p := map[string]string{}
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatal(err)
		}
		payloads = append(payloads, p)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(payloads) != 1 || payloads[0]["file_id"] != photo.File.FileID || payloads[0]["organization_id"] != w.OrganizationID {
		t.Fatalf("thumbnail requests = %v, want one for file %s", payloads, photo.File.FileID)
	}
}
