package notification

// TRASH-NOTIFY-01 (UNI-1844, restore/purge addendum §4): a document landing in
// the trash because someone else archived it tells its ACL owner, once per
// (archive_batch_id, owner) whatever the batch's size. The consumer merges on
// the group key; the rule emits on the one event whose document is that
// owner's top-most batch node, so a batch never merges a second row.

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// node inserts a bare documents row - enough for archive, which only stamps
// the trash columns and reads the subtree. ownerID lands in acl_owner_id;
// parent stays NULL for a root.
func (f *documentFixture) node(t *testing.T, kind, title, ownerID string, parentID *string) string {
	t.Helper()
	id := util.NewID()
	parent := pgtype.Text{}
	if parentID != nil {
		parent = pgtype.Text{String: *parentID, Valid: true}
	}
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO documents (id, organization_id, workspace_id, parent_id, kind, title, visibility, acl_owner_id, created_by, created_by_kind, updated_by, updated_by_kind)
		 VALUES ($1,$2,$3,$4,$5,$6,'workspace',$7,$7,'human',$7,'human')`,
		id, f.orgID, f.wsID, parent, kind, title, ownerID); err != nil {
		t.Fatal(err)
	}
	return id
}

func (f *documentFixture) page(t *testing.T, title, ownerID string, parentID *string) string {
	t.Helper()
	return f.node(t, "page", title, ownerID, parentID)
}

// archive stamps a batch via the service and returns the result.
func (f *documentFixture) archive(t *testing.T, actorID, docID string) service.DocumentArchiveResult {
	t.Helper()
	res, err := f.docs.ArchiveDocument(f.ctx, service.Human(actorID), docID, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// handleTopic feeds every outbox row of a topic through the consumer, oldest
// first, like the dispatcher would.
func (f *documentFixture) handleTopic(t *testing.T, topic string) {
	t.Helper()
	for _, ev := range f.events(t, topic) {
		if err := f.consumer.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
}

// trashedNotifications lists a user's document_trashed_by_other rows with
// their decoded params.
func (f *documentFixture) trashedNotifications(t *testing.T, userID string) []db.Notification {
	t.Helper()
	var out []db.Notification
	for _, n := range f.inbox(t, userID) {
		if n.Kind == KindDocumentTrashedByOther {
			out = append(out, n)
		}
	}
	return out
}

func trashedParams(t *testing.T, n db.Notification) map[string]string {
	t.Helper()
	var p map[string]string
	if err := json.Unmarshal([]byte(n.Params), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

// makeAdmin promotes a fixture member; only a workspace owner/admin (or a
// manage share) may archive somebody else's document.
func (f *documentFixture) makeAdmin(t *testing.T, userID string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`, f.wsID, userID); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentTrashedNotifiesTheOwners(t *testing.T) {
	t.Run("TN-1 member trashes the owner's document: the owner hears once, the archiver never", func(t *testing.T) {
		f := newDocumentFixture(t)
		f.makeAdmin(t, f.member.ID)
		docID := f.page(t, "Báo cáo quý", f.owner.ID, nil)

		res := f.archive(t, f.member.ID, docID)
		f.handleTopic(t, "document.archived")

		got := f.trashedNotifications(t, f.owner.ID)
		if len(got) != 1 {
			t.Fatalf("owner notifications = %v, want one", got)
		}
		n := got[0]
		if n.TitleKey != TitleKey(KindDocumentTrashedByOther) || n.ResourceType != "document" || n.ResourceID != docID {
			t.Fatalf("notification = %+v", n)
		}
		p := trashedParams(t, n)
		if p["actor"] != f.member.DisplayName || p["document"] != "Báo cáo quý" ||
			p["document_id"] != docID || p["archive_batch_id"] != res.BatchID || p["count"] != "0" {
			t.Fatalf("params = %v", p)
		}
		date, err := time.Parse(time.RFC3339, p["date"])
		if err != nil || !date.After(time.Now()) {
			t.Fatalf("date param = %q, %v", p["date"], err)
		}
		if got := f.trashedNotifications(t, f.member.ID); len(got) != 0 {
			t.Fatalf("archiver notifications = %v, want none", got)
		}
		// No push and no digest line by default (N-3: in-app only).
		if n.PushedAt.Valid || n.DigestedAt.Valid {
			t.Fatalf("notification pushed/digested by default: %+v", n)
		}
	})

	t.Run("TN-2 one batch of two owners: one notification each, top item and count", func(t *testing.T) {
		f := newDocumentFixture(t)
		f.makeAdmin(t, f.member.ID)
		a := f.owner.ID
		b := f.addMember(t, "tn2-b@example.com", "Chủ B").ID
		folder := f.node(t, "folder", "Hồ sơ dự án", a, nil)
		// Three nodes of A (folder + 2 pages), two of B, one batch.
		a1 := f.page(t, "Kế hoạch A1", a, &folder)
		a2 := f.page(t, "Kế hoạch A2", a, &folder)
		b1 := f.page(t, "Kế hoạch B1", b, &folder)
		b2 := f.page(t, "Kế hoạch B2", b, &folder)
		bTop := b1
		if b2 < b1 {
			bTop = b2
		}
		bOther := b1
		if bTop == b1 {
			bOther = b2
		}

		f.archive(t, f.member.ID, folder)
		f.handleTopic(t, "document.archived")

		gotA := f.trashedNotifications(t, a)
		if len(gotA) != 1 {
			t.Fatalf("owner A notifications = %v, want one", gotA)
		}
		pA := trashedParams(t, gotA[0])
		if pA["document_id"] != folder || pA["document"] != "Hồ sơ dự án" || pA["count"] != "2" ||
			gotA[0].ResourceID != folder || gotA[0].Count != 1 {
			t.Fatalf("A notification = %+v params %v (a1=%s a2=%s)", gotA[0], pA, a1, a2)
		}
		gotB := f.trashedNotifications(t, b)
		if len(gotB) != 1 {
			t.Fatalf("owner B notifications = %v, want one", gotB)
		}
		pB := trashedParams(t, gotB[0])
		if pB["document_id"] != bTop || pB["count"] != "1" || gotB[0].ResourceID != bTop {
			t.Fatalf("B notification = %+v params %v (bTop=%s bOther=%s)", gotB[0], pB, bTop, bOther)
		}
		if pB["date"] != pA["date"] {
			t.Fatalf("batch date differs: %q vs %q", pB["date"], pA["date"])
		}
		if got := f.trashedNotifications(t, f.member.ID); len(got) != 0 {
			t.Fatalf("archiver notifications = %v, want none", got)
		}
	})

	t.Run("TN-3 self-trash notifies nobody", func(t *testing.T) {
		f := newDocumentFixture(t)
		docID := f.page(t, "Của tôi", f.owner.ID, nil)

		f.archive(t, f.owner.ID, docID)
		f.handleTopic(t, "document.archived")

		for _, uid := range []string{f.owner.ID, f.member.ID} {
			if got := f.trashedNotifications(t, uid); len(got) != 0 {
				t.Fatalf("notifications for %s = %v, want none", uid, got)
			}
		}
	})

	t.Run("TN-4 redelivery of the same outbox row stays one notification", func(t *testing.T) {
		f := newDocumentFixture(t)
		f.makeAdmin(t, f.member.ID)
		docID := f.page(t, "Một lần", f.owner.ID, nil)

		f.archive(t, f.member.ID, docID)
		evs := f.events(t, "document.archived")
		if len(evs) != 1 {
			t.Fatalf("archived events = %d, want 1", len(evs))
		}
		for range 3 {
			if err := f.consumer.Handle(f.ctx, evs[0]); err != nil {
				t.Fatal(err)
			}
		}
		if got := f.trashedNotifications(t, f.owner.ID); len(got) != 1 {
			t.Fatalf("owner notifications after redelivery = %v, want one", got)
		}
	})

	t.Run("TN-5 a deactivated or removed owner hears nothing", func(t *testing.T) {
		f := newDocumentFixture(t)
		f.makeAdmin(t, f.member.ID)
		gone := f.addMember(t, "tn5-gone@example.com", "Đã Nghỉ")
		dead := f.addMember(t, "tn5-dead@example.com", "Vô Hiệu")
		docGone := f.page(t, "Của người đã nghỉ", gone.ID, nil)
		docDead := f.page(t, "Của người vô hiệu", dead.ID, nil)

		if _, err := f.pool.Exec(f.ctx,
			`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, f.wsID, gone.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx,
			`DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`, f.orgID, gone.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, f.orgID, dead.ID); err != nil {
			t.Fatal(err)
		}

		f.archive(t, f.member.ID, docGone)
		f.archive(t, f.member.ID, docDead)
		f.handleTopic(t, "document.archived")

		for name, uid := range map[string]string{"removed": gone.ID, "deactivated": dead.ID} {
			if got := f.trashedNotifications(t, uid); len(got) != 0 {
				t.Fatalf("%s owner notifications = %v, want none", name, got)
			}
		}
	})

	t.Run("TN-6 purge paths emit nothing", func(t *testing.T) {
		f := newDocumentFixture(t)
		f.docs.SetFiles(filesfake.New(filesfake.Options{}))
		f.makeAdmin(t, f.member.ID)
		docID := f.page(t, "Sắp bị xóa", f.owner.ID, nil)

		f.archive(t, f.member.ID, docID)
		f.handleTopic(t, "document.archived")
		if got := f.trashedNotifications(t, f.owner.ID); len(got) != 1 {
			t.Fatalf("owner notifications after archive = %v, want one", got)
		}

		// Manual purge (RESTORE-01 P-6) and the expiry sweep share
		// hardDeleteDocumentTx; neither may notify (N-5, Q-T2 = a).
		if _, err := f.docs.PurgeDocument(f.ctx, service.Human(f.owner.ID), docID); err != nil {
			t.Fatalf("purge: %v", err)
		}
		if n := len(f.events(t, "document.deleted")); n != 1 {
			t.Fatalf("document.deleted events = %d, want 1", n)
		}
		f.handleTopic(t, "document.deleted")
		// A late-archived delivery after the purge is a no-op too.
		f.handleTopic(t, "document.archived")

		second := f.page(t, "Hết hạn", f.owner.ID, nil)
		res2 := f.archive(t, f.member.ID, second)
		// The prompt delivery lands a second row; the expiry purge may add none.
		f.handleTopic(t, "document.archived")
		if got := f.trashedNotifications(t, f.owner.ID); len(got) != 2 {
			t.Fatalf("owner notifications after second archive = %v, want two", got)
		}
		// Expire the second batch so PurgeExpired picks it up.
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE documents SET purge_after = now() - interval '1 day' WHERE archive_batch_id = $1`, res2.BatchID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.docs.PurgeExpired(f.ctx, time.Now()); err != nil {
			t.Fatalf("PurgeExpired: %v", err)
		}
		if n := len(f.events(t, "document.deleted")); n != 2 {
			t.Fatalf("document.deleted events = %d, want 2", n)
		}
		f.handleTopic(t, "document.deleted")
		f.handleTopic(t, "document.archived")

		if got := f.trashedNotifications(t, f.owner.ID); len(got) != 2 {
			t.Fatalf("owner notifications after purges = %v, want still two", got)
		}
	})
}
