package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// UNI-2039 S3: a share made by sending a document in Chat is recorded as
// origin chat; every other share is direct; a copy keeps the source's origin;
// the audit row carries it; no channel name travels anywhere.
func TestAccessReportChatShareOriginAndAudit(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	msg, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("origin-1"))
	if err != nil {
		t.Fatal(err)
	}
	docID := msg.Document.DocumentID
	shares := f.liveSharesOfDocument(t, docID)
	if len(shares) != 1 || shares[0].Origin != AccessReportOriginChat {
		t.Fatalf("chat share rows = %+v, want one with origin chat", shares)
	}
	auditOrigin := func(shareID string) string {
		var origin string
		if err := f.pool.QueryRow(ctx, `SELECT metadata::jsonb->>'origin' FROM audit_events
			WHERE action = 'document.shared' AND resource_id = $1 AND metadata::jsonb->>'share_id' = $2`, docID, shareID).Scan(&origin); err != nil {
			t.Fatal(err)
		}
		return origin
	}
	// A chat send records one batch row for its grants (UNI-2012 S1c), keyed
	// by the message rather than a share id.
	var chatOrigin string
	if err := f.pool.QueryRow(ctx, `SELECT metadata::jsonb->>'origin' FROM audit_events
		WHERE action = 'document.shared' AND resource_id = $1 AND metadata::jsonb->>'source_message_id' = $2`, docID, msg.ID).Scan(&chatOrigin); err != nil {
		t.Fatal(err)
	}
	if chatOrigin != "chat" {
		t.Fatalf("document.shared metadata.origin = %q, want chat", chatOrigin)
	}

	// The report says so, and the source filter finds it.
	page, err := f.docs.DocumentAccessReport(ctx, Human(f.ua.ID), f.ws.ID, DocumentAccessReportQuery{Sources: []string{"chat"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Item.Document.ID != docID || len(page.Items[0].Rows) != 1 {
		t.Fatalf("chat source page = %+v", page.Items)
	}
	if row := page.Items[0].Rows[0]; row.Origin != "chat" || row.PrincipalID != f.ub.ID || row.RevokeKind != "share" || row.RevokeID != shares[0].ID {
		t.Fatalf("chat row = %+v", row)
	}
	page, err = f.docs.DocumentAccessReport(ctx, Human(f.ua.ID), f.ws.ID, DocumentAccessReportQuery{Sources: []string{"direct"}})
	if err != nil || len(page.Items) != 0 {
		t.Fatalf("direct source page = %+v, %v", page.Items, err)
	}

	// A hand-made re-share at another level is a new row, direct.
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), docID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: f.ub.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	shares = f.liveSharesOfDocument(t, docID)
	if len(shares) != 1 || shares[0].Origin != AccessReportOriginDirect || shares[0].Level != "view" {
		t.Fatalf("after a hand-made re-share: %+v", shares)
	}
	if got := auditOrigin(shares[0].ID); got != "direct" {
		t.Fatalf("direct share audit origin = %q", got)
	}

	// A copy keeps each grant's source origin.
	srcMsg, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("origin-2"))
	if err != nil {
		t.Fatal(err)
	}
	src, err := f.q.GetDocumentByID(ctx, srcMsg.Document.DocumentID)
	if err != nil {
		t.Fatal(err)
	}
	dstID := util.NewID()
	insertRow(t, ctx, f.pool, "documents", baseDoc(map[string]any{
		"id": dstID, "organization_id": f.orgID, "workspace_id": f.ws.ID, "visibility": "restricted",
		"created_by": f.ua.ID, "updated_by": f.ua.ID,
	}))
	dst, err := f.q.GetDocumentByID(ctx, dstID)
	if err != nil {
		t.Fatal(err)
	}
	if err := copyDocumentShares(ctx, f.q, src, dst, Human(f.ua.ID)); err != nil {
		t.Fatal(err)
	}
	copied := f.liveSharesOfDocument(t, dst.ID)
	if len(copied) != 1 || copied[0].Origin != AccessReportOriginChat {
		t.Fatalf("copied shares = %+v, want the source's chat origin", copied)
	}
}
