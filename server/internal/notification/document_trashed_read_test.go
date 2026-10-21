package notification

// BE-R2-2 (UNI-2056 review r2): the card's trash example says the people the
// notice is addressed to read "X moved A, B, C and 47 more to the trash".
// Those people are sharees and starrers, who only read the documents, so the
// read paths (the inbox sample and GET /me/notifications/{id}/documents) must
// not drop a trashed document the caller could still read if the trash flag
// were ignored. Current shares, stars and visibility still apply.

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

func (f *docChangeFixture) readService() *Service {
	svc := NewService(f.q, PushConfig{})
	svc.SetDocumentReaders(f.docs)
	return svc
}

// trashedBatch trashes the pages as the owner and seeds a "trashed"
// document_changed notice for each of userIDs naming them in order.
func (f *docChangeFixture) trashedBatch(t *testing.T, ids []string, userIDs ...string) map[string]string {
	t.Helper()
	for _, id := range ids {
		f.archive(t, f.owner.ID, id)
	}
	out := map[string]string{}
	for _, u := range userIDs {
		out[u] = f.changedNotice(t, u, "trashed", ids...)
	}
	return out
}

func (f *docChangeFixture) documentRows(t *testing.T, svc *Service, userID, notificationID string) []DocumentRow {
	t.Helper()
	page, err := svc.Documents(f.ctx, userID, notificationID, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	return page.Rows
}

func TestTrashedNoticeNamesItsDocumentsToNonManagers(t *testing.T) {
	f := newDocChangeFixture(t)
	svc := f.readService()
	a := f.sharedPage(t, "Báo cáo A")
	b := f.sharedPage(t, "Báo cáo B")
	notices := f.trashedBatch(t, []string{a, b}, f.sharee.ID, f.starrer.ID)

	for _, u := range []string{f.sharee.ID, f.starrer.ID} {
		it := f.documentInboxItem(t, svc, u, notices[u])
		if len(it.SampleDocuments) != 2 || it.SampleDocuments[0].Title != "Báo cáo A" || it.SampleDocuments[1].Title != "Báo cáo B" {
			t.Fatalf("user %s: sample_documents = %+v, want both trashed titles", u, it.SampleDocuments)
		}
		if !contains(it.Params, a+","+b) {
			t.Fatalf("user %s: sample_document_ids lost the trashed documents: %s", u, it.Params)
		}
		rows := f.documentRows(t, svc, u, notices[u])
		if len(rows) != 2 || rows[0].Title != "Báo cáo A" || !rows[0].Trashed || rows[1].Title != "Báo cáo B" || !rows[1].Trashed {
			t.Fatalf("user %s: documents = %+v, want both titles, trashed", u, rows)
		}
	}
}

func TestTrashedNoticeDropsWhoLostAccessSinceTheCommand(t *testing.T) {
	f := newDocChangeFixture(t)
	svc := f.readService()
	keep := f.page(t, "Còn quyền", f.owner.ID, nil)
	f.restrict(t, keep)
	f.userShare(t, keep, f.sharee.ID)
	lost := f.page(t, "Mất quyền", f.owner.ID, nil)
	f.restrict(t, lost)
	f.userShare(t, lost, f.sharee.ID)
	f.userShare(t, lost, f.starrer.ID)
	notices := f.trashedBatch(t, []string{keep, lost}, f.sharee.ID, f.starrer.ID)

	// The sharee's share of one document is revoked after the trash; the
	// starrer never could read the other, and the bystander is no recipient.
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE document_shares SET revoked_at = now() WHERE document_id = $1 AND principal_id = $2`, lost, f.sharee.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE document_shares SET revoked_at = now() WHERE document_id = $1 AND principal_id = $2`, lost, f.starrer.ID); err != nil {
		t.Fatal(err)
	}

	it := f.documentInboxItem(t, svc, f.sharee.ID, notices[f.sharee.ID])
	if got := sampleIDs(it); len(got) != 1 || got[0] != keep {
		t.Fatalf("sharee samples = %v, want only %s", got, keep)
	}
	if contains(it.Params, lost) {
		t.Fatalf("params still name the document the sharee lost: %s", it.Params)
	}
	if rows := f.documentRows(t, svc, f.sharee.ID, notices[f.sharee.ID]); len(rows) != 1 || rows[0].ID != keep {
		t.Fatalf("sharee documents = %+v, want only %s", rows, keep)
	}

	starrer := f.documentInboxItem(t, svc, f.starrer.ID, notices[f.starrer.ID])
	if len(starrer.SampleDocuments) != 0 {
		t.Fatalf("starrer who lost every path to the batch still gets samples: %+v", starrer.SampleDocuments)
	}
	if rows := f.documentRows(t, svc, f.starrer.ID, notices[f.starrer.ID]); len(rows) != 0 {
		t.Fatalf("starrer who lost every path to the batch still lists documents: %+v", rows)
	}
}

func TestTrashedNoticeStaysClosedToWhoNeverReadIt(t *testing.T) {
	f := newDocChangeFixture(t)
	svc := f.readService()
	outsider := f.addOrgOutsider(t, "ngoai-ws@example.com", "Ngoài Không Gian")
	secret := f.page(t, "Chỉ chủ sở hữu", f.owner.ID, nil)
	f.restrict(t, secret)
	notices := f.trashedBatch(t, []string{secret}, f.bystander.ID, outsider.ID)

	for _, u := range []string{f.bystander.ID, outsider.ID} {
		if it := f.documentInboxItem(t, svc, u, notices[u]); len(it.SampleDocuments) != 0 || contains(it.Params, secret) {
			t.Fatalf("user %s named a trashed document they never read: %+v %s", u, it.SampleDocuments, it.Params)
		}
		if rows := f.documentRows(t, svc, u, notices[u]); len(rows) != 0 {
			t.Fatalf("user %s lists a trashed document they never read: %+v", u, rows)
		}
	}
}

func TestTrashedNoticeStillReadsAPurgedDocumentByTheSnapshotRule(t *testing.T) {
	f := newDocChangeFixture(t)
	svc := f.readService()
	live := f.sharedPage(t, "Còn trong thùng")
	purged := util.NewID()
	f.archive(t, f.owner.ID, live)
	id := f.changedNotice(t, f.sharee.ID, "trashed", purged, live)
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE notification_documents SET title_snapshot = 'Tiêu đề đã xóa' WHERE notification_id = $1 AND document_id = $2`, id, purged); err != nil {
		t.Fatal(err)
	}

	// Under the trashed verb a purged document is a deleted row with no title
	// (only the deleted verb keeps one), and no sample names it.
	rows := f.documentRows(t, svc, f.sharee.ID, id)
	if len(rows) != 2 {
		t.Fatalf("documents = %+v, want the purged row and the trashed one", rows)
	}
	for _, r := range rows {
		switch r.ID {
		case purged:
			if !r.Deleted || r.Title != "" {
				t.Fatalf("purged row = %+v, want deleted with no title under the trashed verb", r)
			}
		case live:
			if r.Deleted || r.Title != "Còn trong thùng" || !r.Trashed {
				t.Fatalf("trashed row = %+v", r)
			}
		}
	}
	if got := sampleIDs(f.documentInboxItem(t, svc, f.sharee.ID, id)); len(got) != 1 || got[0] != live {
		t.Fatalf("samples = %v, want only %s", got, live)
	}
}

func TestTrashedReadDoesNotLoosenOtherVerbs(t *testing.T) {
	f := newDocChangeFixture(t)
	svc := f.readService()
	doc := f.sharedPage(t, "Đã vào thùng sau đó")
	f.archive(t, f.owner.ID, doc)
	// A moved notice whose document has since gone to the trash is still not
	// readable by a person who does not manage it.
	id := f.changedNotice(t, f.sharee.ID, "moved", doc)

	if it := f.documentInboxItem(t, svc, f.sharee.ID, id); len(it.SampleDocuments) != 0 {
		t.Fatalf("moved notice names a trashed document to a non-manager: %+v", it.SampleDocuments)
	}
	if rows := f.documentRows(t, svc, f.sharee.ID, id); len(rows) != 0 {
		t.Fatalf("moved notice lists a trashed document to a non-manager: %+v", rows)
	}
	// The manager keeps seeing it, as before.
	own := f.changedNotice(t, f.owner.ID, "moved", doc)
	if rows := f.documentRows(t, svc, f.owner.ID, own); len(rows) != 1 || !rows[0].Trashed {
		t.Fatalf("owner documents = %+v, want the trashed document", rows)
	}
}

func TestTrashedNoticeIsClosedToAFormerMemberWithARetainedShare(t *testing.T) {
	f := newDocChangeFixture(t)
	svc := f.readService()
	doc := f.page(t, "Chia sẻ còn lại", f.owner.ID, nil)
	f.restrict(t, doc)
	f.userShare(t, doc, f.sharee.ID)
	notices := f.trashedBatch(t, []string{doc}, f.sharee.ID)
	// The share row outlives the leave; the organization gate still closes it.
	if _, err := f.pool.Exec(f.ctx,
		`DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`, f.orgID, f.sharee.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx,
		`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, f.wsID, f.sharee.ID); err != nil {
		t.Fatal(err)
	}

	if it := f.documentInboxItem(t, svc, f.sharee.ID, notices[f.sharee.ID]); len(it.SampleDocuments) != 0 || contains(it.Params, doc) {
		t.Fatalf("a former member names a trashed document: %+v %s", it.SampleDocuments, it.Params)
	}
	if rows := f.documentRows(t, svc, f.sharee.ID, notices[f.sharee.ID]); len(rows) != 0 {
		t.Fatalf("a former member lists a trashed document: %+v", rows)
	}
}
