package notification

// BE-R1-11 (UNI-2056 review r1): a document_changed row carries resource_id =
// the FIRST document of the notice, which says nothing about the row. Under the
// verbs trashed and deleted that document is in the trash or gone by design, so
// Service.List must not read the row as dead from it; the row's readability is
// its documents (sample_documents and the rewritten sample_document_ids).

import (
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// changedNotice seeds one document_changed row for userID the way the consumer
// writes it: resource = the first document, every param a string, the sample
// ids comma-joined, plus the snippet keys a comment-style row would carry.
func (f *documentFixture) changedNotice(t *testing.T, userID, verb string, docIDs ...string) string {
	t.Helper()
	n, err := f.q.UpsertNotification(f.ctx, db.UpsertNotificationParams{
		ID: util.NewID(), UserID: userID, OrganizationID: f.orgID, WorkspaceID: pgtype.Text{String: f.wsID, Valid: true},
		Kind: docChangedKind, GroupKey: "doc_change:" + util.NewID(),
		ResourceType: "document", ResourceID: docIDs[0], ActorKind: "human", ActorID: f.owner.ID,
		TitleKey: "notifications.kind.document_changed",
		Params: fmt.Sprintf(`{"verb":%q,"document_count":"%d","sample_document_ids":%q,"snippet":"noi dung","document":"Tai lieu dau"}`,
			verb, len(docIDs), strings.Join(docIDs, ",")),
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range docIDs {
		if _, err := f.q.InsertNotificationDocument(f.ctx, db.InsertNotificationDocumentParams{
			OrganizationID: f.orgID, NotificationID: n.ID, DocumentID: id,
		}); err != nil {
			t.Fatal(err)
		}
	}
	return n.ID
}

func sampleIDs(it Item) []string {
	ids := make([]string, 0, len(it.SampleDocuments))
	for _, s := range it.SampleDocuments {
		ids = append(ids, s.ID)
	}
	return ids
}

func TestServiceDocumentChangedRowIsNotJudgedByItsFirstDocument(t *testing.T) {
	t.Run("first document in the trash and the reader administers it: row stays live, both samples named", func(t *testing.T) {
		f := newDocumentFixture(t)
		svc := NewService(f.q, PushConfig{})
		svc.SetDocumentReaders(f.docs)
		first := f.page(t, "Bản đầu", f.owner.ID, nil)
		second := f.page(t, "Bản hai", f.owner.ID, nil)
		f.archive(t, f.owner.ID, first)

		id := f.changedNotice(t, f.owner.ID, "trashed", first, second)
		it := f.documentInboxItem(t, svc, f.owner.ID, id)

		if it.ResourceDeleted || it.ResourceAccessLost {
			t.Fatalf("document_changed row judged by its first document: %+v", it)
		}
		if !contains(it.Params, "snippet") || !contains(it.Params, "Tai lieu dau") {
			t.Fatalf("snippet keys stripped from a document_changed row: %s", it.Params)
		}
		if got := sampleIDs(it); len(got) != 2 || got[0] != first || got[1] != second {
			t.Fatalf("samples = %v, want [%s %s]", got, first, second)
		}
		if !contains(it.Params, first+","+second) {
			t.Fatalf("sample_document_ids rewritten away: %s", it.Params)
		}
	})

	t.Run("reader lost the first document: row stays live, only the readable sample is named", func(t *testing.T) {
		f := newDocumentFixture(t)
		svc := NewService(f.q, PushConfig{})
		svc.SetDocumentReaders(f.docs)
		secret := f.document(t, "restricted", "Mật")
		open := f.page(t, "Công khai", f.owner.ID, nil)

		id := f.changedNotice(t, f.member.ID, "moved", secret, open)
		it := f.documentInboxItem(t, svc, f.member.ID, id)

		if it.ResourceDeleted || it.ResourceAccessLost {
			t.Fatalf("document_changed row judged by its first document: %+v", it)
		}
		if !contains(it.Params, "snippet") {
			t.Fatalf("snippet keys stripped from a document_changed row: %s", it.Params)
		}
		if got := sampleIDs(it); len(got) != 1 || got[0] != open {
			t.Fatalf("samples = %v, want only %s", got, open)
		}
		if contains(it.Params, secret) {
			t.Fatalf("params still name the document the reader lost: %s", it.Params)
		}
	})

	t.Run("no sample readable: the row is kept with no samples", func(t *testing.T) {
		f := newDocumentFixture(t)
		svc := NewService(f.q, PushConfig{})
		svc.SetDocumentReaders(f.docs)
		secret := f.document(t, "restricted", "Mật")

		id := f.changedNotice(t, f.member.ID, "moved", secret)
		it := f.documentInboxItem(t, svc, f.member.ID, id)

		if it.ResourceDeleted || it.ResourceAccessLost {
			t.Fatalf("document_changed row judged by its first document: %+v", it)
		}
		if len(it.SampleDocuments) != 0 || contains(it.Params, secret) {
			t.Fatalf("unreadable sample leaked: %+v %s", it.SampleDocuments, it.Params)
		}
	})

	t.Run("first document purged: row stays live", func(t *testing.T) {
		f := newDocumentFixture(t)
		svc := NewService(f.q, PushConfig{})
		svc.SetDocumentReaders(f.docs)
		gone := util.NewID()
		open := f.page(t, "Còn lại", f.owner.ID, nil)

		id := f.changedNotice(t, f.owner.ID, "deleted", gone, open)
		it := f.documentInboxItem(t, svc, f.owner.ID, id)

		if it.ResourceDeleted || it.ResourceAccessLost {
			t.Fatalf("document_changed row judged by its first document: %+v", it)
		}
		if got := sampleIDs(it); len(got) != 1 || got[0] != open {
			t.Fatalf("samples = %v, want only %s", got, open)
		}
	})
}
