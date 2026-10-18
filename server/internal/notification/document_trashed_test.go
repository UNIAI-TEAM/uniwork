package notification

// TRASH-NOTIFY-01 (UNI-1844, restore/purge addendum §4): a document landing in
// the trash because someone else archived it tells its ACL owner, once per
// (archive_batch_id, owner) whatever the batch's size. The consumer merges on
// the group key; the rule emits on the one event whose document is that
// owner's top-most batch node, so a batch never merges a second row.

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/outbox"
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

// trashedCount counts a user's document_trashed_by_other rows across every
// state - read and archived too - because the (batch, recipient) idempotency
// contract is about history, not about what is still open in the inbox.
func (f *documentFixture) trashedCount(t *testing.T, userID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM notifications WHERE user_id = $1 AND kind = $2`,
		userID, KindDocumentTrashedByOther).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// handleEvent feeds one outbox row through the consumer; handleTopic's
// all-rows helper cannot pick out a single document's event.
func (f *documentFixture) handleEvent(t *testing.T, ev outbox.Row) {
	t.Helper()
	if err := f.consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
}

// trashedItem lists userID's inbox through the real Service (with the real
// DocumentService gate) and returns the one trash-notice row; the flags it
// resolves are the ones the HTTP layer ships.
func (f *documentFixture) trashedItem(t *testing.T, svc *Service, userID string) Item {
	t.Helper()
	items, err := svc.List(f.ctx, userID, ListInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range items {
		if it.Kind == KindDocumentTrashedByOther {
			return it
		}
	}
	t.Fatal("no document_trashed_by_other row in the inbox")
	return Item{}
}

// BE-TN-1 (review r1): a trash notice's document sits in the trash by
// definition, so List must not flag it deleted while the recipient still
// manages it (decideArchiveRootAccess's manage -> visible). Purged, restored,
// and access-lost documents keep the fail-closed answers.
func TestDocumentTrashedInboxRow(t *testing.T) {
	t.Run("in trash and owned: the row stays a live link with its title", func(t *testing.T) {
		f := newDocumentFixture(t)
		f.makeAdmin(t, f.member.ID)
		svc := NewService(f.q, PushConfig{})
		svc.SetDocumentReaders(f.docs)
		docID := f.page(t, "Báo cáo quý", f.owner.ID, nil)

		f.archive(t, f.member.ID, docID)
		f.handleTopic(t, "document.archived")

		it := f.trashedItem(t, svc, f.owner.ID)
		if it.ResourceDeleted || it.ResourceAccessLost {
			t.Fatalf("restorable notice flagged: %+v", it)
		}
		if !contains(it.Params, "Báo cáo quý") {
			t.Fatalf("title dropped while the owner can still restore: %s", it.Params)
		}
	})

	t.Run("restored: the notice keeps its title on a readable document", func(t *testing.T) {
		f := newDocumentFixture(t)
		f.makeAdmin(t, f.member.ID)
		svc := NewService(f.q, PushConfig{})
		svc.SetDocumentReaders(f.docs)
		docID := f.page(t, "Kế hoạch", f.owner.ID, nil)

		f.archive(t, f.member.ID, docID)
		f.handleTopic(t, "document.archived")
		if _, err := f.docs.RestoreDocument(f.ctx, service.Human(f.owner.ID), docID, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
			t.Fatal(err)
		}

		it := f.trashedItem(t, svc, f.owner.ID)
		if it.ResourceDeleted || it.ResourceAccessLost {
			t.Fatalf("restored notice flagged: %+v", it)
		}
		if !contains(it.Params, "Kế hoạch") {
			t.Fatalf("restored notice lost its title: %s", it.Params)
		}
	})

	t.Run("purged: deleted, no title", func(t *testing.T) {
		f := newDocumentFixture(t)
		f.docs.SetFiles(filesfake.New(filesfake.Options{}))
		f.makeAdmin(t, f.member.ID)
		svc := NewService(f.q, PushConfig{})
		svc.SetDocumentReaders(f.docs)
		docID := f.page(t, "Nháp cũ", f.owner.ID, nil)

		f.archive(t, f.member.ID, docID)
		f.handleTopic(t, "document.archived")
		if _, err := f.docs.PurgeDocument(f.ctx, service.Human(f.owner.ID), docID); err != nil {
			t.Fatal(err)
		}

		it := f.trashedItem(t, svc, f.owner.ID)
		if !it.ResourceDeleted {
			t.Fatalf("purged notice not flagged deleted: %+v", it)
		}
		if contains(it.Params, "Nháp cũ") {
			t.Fatalf("purged notice kept its title: %s", it.Params)
		}
	})

	t.Run("access lost while trashed: gone, no title", func(t *testing.T) {
		f := newDocumentFixture(t)
		f.makeAdmin(t, f.member.ID)
		svc := NewService(f.q, PushConfig{})
		svc.SetDocumentReaders(f.docs)
		b := f.addMember(t, "tn1-b@example.com", "Chủ B")
		docID := f.page(t, "Của B", b.ID, nil)

		f.archive(t, f.member.ID, docID)
		f.handleTopic(t, "document.archived")
		// The recipient drops out of the workspace, so they no longer
		// administer the trashed document: manage -> visible no longer holds.
		if _, err := f.pool.Exec(f.ctx,
			`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, f.wsID, b.ID); err != nil {
			t.Fatal(err)
		}

		it := f.trashedItem(t, svc, b.ID)
		if !it.ResourceDeleted {
			t.Fatalf("access-lost trash notice not flagged deleted: %+v", it)
		}
		if contains(it.Params, "Của B") {
			t.Fatalf("access-lost trash notice kept its title: %s", it.Params)
		}
	})

	// BE-TN-8 (review r2): the archived branch must run the organization gate
	// before it resolves the trash level. A live manage share outlives the
	// membership rows a leave deletes, so a former member still answers
	// canAdminister through the share - and would keep the title the org gate
	// exists to withhold.
	t.Run("left the organization with a retained share: gone, no title", func(t *testing.T) {
		f := newDocumentFixture(t)
		f.makeAdmin(t, f.member.ID)
		svc := NewService(f.q, PushConfig{})
		svc.SetDocumentReaders(f.docs)
		d := f.addMember(t, "tn1-d@example.com", "Chủ D")
		docID := f.page(t, "Của D", d.ID, nil)
		// The retained manage share: a user-principal row applies by user id
		// alone (shareAppliesTo never reads membership).
		if _, err := f.pool.Exec(f.ctx,
			`INSERT INTO document_shares (id, organization_id, workspace_id, document_id, principal_type, principal_id, level, granted_by, granted_by_kind)
			 VALUES ($1,$2,$3,$4,'user',$5,'manage',$6,'human')`,
			util.NewID(), f.orgID, f.wsID, docID, d.ID, f.member.ID); err != nil {
			t.Fatal(err)
		}

		f.archive(t, f.member.ID, docID)
		f.handleTopic(t, "document.archived")
		// D leaves: the organization and workspace rows go, the share stays.
		if _, err := f.pool.Exec(f.ctx,
			`DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`, f.orgID, d.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx,
			`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, f.wsID, d.ID); err != nil {
			t.Fatal(err)
		}

		it := f.trashedItem(t, svc, d.ID)
		if !it.ResourceDeleted {
			t.Fatalf("former member's trash notice not flagged deleted: %+v", it)
		}
		if contains(it.Params, "Của D") {
			t.Fatalf("former member's trash notice kept its title: %s", it.Params)
		}
	})
}

// BE-TN-3 (review r1): the (archive_batch_id, recipient) idempotency survives
// a change of the elected top node, whether the first notice is unread, read
// or archived. Without a historical claim the sibling's event either inserts
// a second row (read/archived notice) or bumps the merge count of the open
// one - the "one notification per person per batch" contract broken in both
// directions. Only the elected top of each owner leaves the batch (restored
// for one, purged for two), so a sibling stays in the trash and becomes that
// owner's new top under the pending event.
func TestDocumentTrashedBatchClaimSurvivesTopChange(t *testing.T) {
	f := newDocumentFixture(t)
	f.docs.SetFiles(filesfake.New(filesfake.Options{}))
	f.makeAdmin(t, f.member.ID)
	b := f.addMember(t, "tn3-b@example.com", "Chủ B").ID
	c := f.addMember(t, "tn3-c@example.com", "Chủ C").ID
	d := f.addMember(t, "tn3-d@example.com", "Chủ D").ID
	folder := f.node(t, "folder", "Hồ sơ", f.owner.ID, nil)
	// Two pages of one owner under the folder: the smaller ULID is that
	// owner's top node of the batch, the other their sibling.
	owned := func(owner, first, second string) (top, other string) {
		x := f.page(t, first, owner, &folder)
		y := f.page(t, second, owner, &folder)
		if y < x {
			return y, x
		}
		return x, y
	}
	bTop, bOther := owned(b, "Kế hoạch B1", "Kế hoạch B2")
	cTop, cOther := owned(c, "Kế hoạch C1", "Kế hoạch C2")
	dTop, dOther := owned(d, "Kế hoạch D1", "Kế hoạch D2")

	f.archive(t, f.member.ID, folder)
	evFor := func(docID string) outbox.Row {
		t.Helper()
		for _, ev := range f.events(t, "document.archived") {
			if strings.Contains(ev.Payload, docID) {
				return ev
			}
		}
		t.Fatalf("no document.archived event for %s", docID)
		return outbox.Row{}
	}

	// Each owner hears on their own top node; the three inbox states - open,
	// read, archived - are what the later event must survive.
	f.handleEvent(t, evFor(bTop))
	f.handleEvent(t, evFor(cTop))
	f.handleEvent(t, evFor(dTop))
	if f.trashedCount(t, b) != 1 || f.trashedCount(t, c) != 1 || f.trashedCount(t, d) != 1 {
		t.Fatalf("notifications b=%d c=%d d=%d, want one each", f.trashedCount(t, b), f.trashedCount(t, c), f.trashedCount(t, d))
	}
	svc := NewService(f.q, PushConfig{})
	svc.SetDocumentReaders(f.docs)
	if err := svc.MarkRead(f.ctx, c, []string{f.trashedItem(t, svc, c).ID}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Archive(f.ctx, d, []string{f.trashedItem(t, svc, d).ID}); err != nil {
		t.Fatal(err)
	}

	// B's top is restored, C's and D's purged, so each owner's sibling is the
	// batch's new top when its own event is consumed.
	if _, err := f.docs.RestoreDocument(f.ctx, f.memberActor(), bTop, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
		t.Fatal(err)
	}
	for _, top := range []string{cTop, dTop} {
		if _, err := f.docs.PurgeDocument(f.ctx, f.memberActor(), top); err != nil {
			t.Fatal(err)
		}
	}

	// Consume the siblings' pending events - plus a redelivery of B's - in the
	// order the dispatcher would retry them.
	for _, docID := range []string{bOther, bOther, cOther, dOther} {
		f.handleEvent(t, evFor(docID))
	}

	for name, uid := range map[string]string{"open B": b, "read C": c, "archived D": d} {
		if n := f.trashedCount(t, uid); n != 1 {
			t.Fatalf("%s notifications after its top left the batch = %d, want one", name, n)
		}
	}
	// The open notice must not have merged the second event: one row, one item.
	if got := f.trashedNotifications(t, b); len(got) != 1 || got[0].Count != 1 {
		t.Fatalf("B open row = %+v, want one row with count 1", got)
	}
	if p := trashedParams(t, f.trashedItem(t, svc, b).Notification); p["document"] != "Kế hoạch B1" && p["document"] != "Kế hoạch B2" {
		t.Fatalf("B params = %v, want its own top title", p)
	}
}

// BE-TN-9 (review r2): the (batch, recipient) claim must be exclusive, not
// merely checked. HasNotificationGroupRow is an unlocked existence read, so two
// dispatcher nodes carrying two different events of one group can both miss it
// and merge through the upsert's count + 1. The two drafts here are the ones
// the rule itself elects on either side of the restore that re-elects the
// batch's top - the interleaving the review names - and both writes are
// released from one point, so the existence reads race the way two nodes'
// would. Exactly one row, count 1.
func TestDocumentTrashedGroupClaimIsExclusive(t *testing.T) {
	f := newDocumentFixture(t)
	f.makeAdmin(t, f.member.ID)
	// The folder belongs to the fixture owner and the two pages to another
	// member, so the pages - not the folder - are that member's only batch
	// nodes and the election below is about them alone.
	owner := f.addMember(t, "tn9-a@example.com", "Chủ A").ID
	folder := f.node(t, "folder", "Hồ sơ", f.owner.ID, nil)
	first := f.page(t, "Kế hoạch A", owner, &folder)
	second := f.page(t, "Kế hoạch B", owner, &folder)
	top, other := first, second
	if second < first {
		top, other = second, first
	}
	f.archive(t, f.member.ID, folder)
	evFor := func(docID string) outbox.Row {
		t.Helper()
		for _, ev := range f.events(t, "document.archived") {
			if strings.Contains(ev.Payload, docID) {
				return ev
			}
		}
		t.Fatalf("no document.archived event for %s", docID)
		return outbox.Row{}
	}
	topEv, otherEv := evFor(top), evFor(other)
	topDraft := f.trashDraft(t, topEv)

	// The elected top leaves the batch, so the sibling's pending event now
	// carries that owner's draft under the same (batch, recipient) group.
	if _, err := f.docs.RestoreDocument(f.ctx, f.memberActor(), top, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
		t.Fatal(err)
	}
	otherDraft := f.trashDraft(t, otherEv)
	if topDraft.GroupKey != otherDraft.GroupKey || topDraft.UserID != otherDraft.UserID {
		t.Fatalf("drafts of one group differ: %+v / %+v", topDraft, otherDraft)
	}

	// Holding the notifications table keeps both writes between their
	// delivery claim and their upsert: the existence reads then run before
	// either row is committed, which is the race the claim must survive.
	holder, err := f.pool.Acquire(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Release()
	hold, err := holder.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	// A fatal below must not leave the table locked on a pooled connection:
	// the writers would stay parked and the pool teardown would wait on them.
	defer func() { _ = hold.Rollback(f.ctx) }()
	if _, err := hold.Exec(f.ctx, `LOCK TABLE notifications IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}

	prefs := DefaultPrefs(KindDocumentTrashedByOther)
	jobs := []struct {
		eventID string
		draft   Draft
	}{{topEv.ID, topDraft}, {otherEv.ID, otherDraft}}
	// The writers run on their own pool so their backends carry a name the
	// barrier below can count (BE-TN-12). On the fixture pool every
	// connection reports the same application_name, so a single writer
	// retrying its statement would be indistinguishable from two writers.
	writerCfg, err := pgxpool.ParseConfig(f.pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	writerCfg.ConnConfig.RuntimeParams["application_name"] = writerAppName
	writerPool, err := pgxpool.NewWithConfig(f.ctx, writerCfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writerPool.Close)
	writers := NewConsumer(writerPool, f.q, f.ws)

	var wg sync.WaitGroup
	errs := make(chan error, len(jobs))
	for _, j := range jobs {
		wg.Add(1)
		go func(eventID string, d Draft) {
			defer wg.Done()
			if err := writers.write(f.ctx, eventID, "", d, prefs); err != nil {
				errs <- err
			}
		}(j.eventID, j.draft)
	}
	// Wait on an observed boundary rather than on elapsed time: both writers
	// must be parked inside their transaction - one on the held table lock,
	// the other on that or on the group advisory lock - before the release
	// below, so neither can run its existence read against a sibling row
	// that the other already committed.
	deadline := time.Now().Add(writerBlockDeadline)
	for {
		waiting := f.writersWaitingOnTheGroupLock(t, hold)
		if waiting >= len(jobs) {
			break
		}
		if time.Now().After(deadline) {
			// Free the parked writer before failing, or the pool teardown
			// below would wait on a backend still holding its transaction.
			_ = hold.Rollback(f.ctx)
			wg.Wait()
			t.Fatalf("only %d of %d writers reached the held notifications lock within %s: the group claim does not hold both writers at their existence read",
				waiting, len(jobs), writerBlockDeadline)
		}
		select {
		case err := <-errs:
			_ = hold.Rollback(f.ctx)
			wg.Wait()
			t.Fatalf("a writer failed before both reached the lock: %v", err)
		case <-time.After(10 * time.Millisecond):
		}
	}
	if err := hold.Rollback(f.ctx); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}

	if n := f.trashedCount(t, owner); n != 1 {
		t.Fatalf("trash notices after two concurrent events of one batch = %d, want one", n)
	}
	if got := f.trashedNotifications(t, owner); len(got) != 1 || got[0].Count != 1 {
		t.Fatalf("notification rows = %+v, want one row with count 1", got)
	}
}

// writerAppName names the concurrent writers' connections so the barrier can
// pick their backends out of pg_stat_activity.
const writerAppName = "notif-group-lock-writer"

// writerBlockDeadline bounds how long the barrier waits for both writers to
// park; a missing park fails the test rather than waiting longer (BE-TN-12).
const writerBlockDeadline = 10 * time.Second

// writersWaitingOnTheGroupLock counts the named writer backends parked on the
// notifications table lock or on the group advisory lock, excluding the
// holder's own backend by pid. Two means both writers are inside their
// transaction at the existence-read boundary, which is the point the release
// must find them at.
func (f *documentFixture) writersWaitingOnTheGroupLock(t *testing.T, hold pgx.Tx) int {
	t.Helper()
	var holderPID int
	if err := hold.QueryRow(f.ctx, `SELECT pg_backend_pid()`).Scan(&holderPID); err != nil {
		t.Fatal(err)
	}
	var waiting int
	if err := f.pool.QueryRow(f.ctx, `
		SELECT count(DISTINCT a.pid)
		FROM pg_stat_activity a
		JOIN pg_locks l ON l.pid = a.pid AND NOT l.granted
		WHERE a.application_name = $1
		  AND a.pid <> $2
		  AND (
		    l.locktype = 'relation' AND l.relation = 'notifications'::regclass
		    OR l.locktype = 'advisory'
		  )`, writerAppName, holderPID).Scan(&waiting); err != nil {
		t.Fatal(err)
	}
	return waiting
}

// trashDraft runs the archived rule for one event and returns the single
// once-per-group draft it elects, as Handle hands it to the write path.
func (f *documentFixture) trashDraft(t *testing.T, ev outbox.Row) Draft {
	t.Helper()
	payload := map[string]string{}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			t.Fatal(err)
		}
	}
	ds, err := rules[ev.Topic](f.ctx, f.consumer.env, ev, payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(ds) != 1 || !ds[0].OncePerGroup {
		t.Fatalf("%s drafts = %+v, want the one once-per-group trash draft", ev.Topic, ds)
	}
	return ds[0]
}

// BE-TN-4/BE-TN-6 (review r1): this kind never emails and never pushes by
// default - not as a stored row the user happens not to have changed, but as
// the effective preference whatever was saved.
func TestDocumentTrashedStaysInAppOnly(t *testing.T) {
	f := newDocumentFixture(t)
	f.makeAdmin(t, f.member.ID)
	docID := f.page(t, "Báo cáo quý", f.owner.ID, nil)

	if p := DefaultPrefs(KindDocumentTrashedByOther); !p.InApp || p.Push || p.Email {
		t.Fatalf("DefaultPrefs(%s) = %+v, want in-app only", KindDocumentTrashedByOther, p)
	}

	// The owner enabled email for the kind anyway; the effective answer must
	// still refuse the channel.
	svc := NewService(f.q, PushConfig{})
	full, err := svc.SetPreferences(f.ctx, f.owner.ID, []KindPrefs{
		{Kind: KindDocumentTrashedByOther, Prefs: Prefs{InApp: true, Push: false, Email: true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, kp := range full {
		if kp.Kind == KindDocumentTrashedByOther && kp.Email {
			t.Fatalf("effective prefs keep Email=true: %+v", kp)
		}
	}

	f.archive(t, f.member.ID, docID)
	f.handleTopic(t, "document.archived")

	// The digest's document gate drops a row whose document is not readable,
	// and a trashed document the owner administers is trashable, not readable
	// (digest.build). The notice must therefore be back on a live document
	// when the digest runs, or the negative assertion below holds whether or
	// not the email ceiling exists (BE-TN-10).
	if _, err := f.docs.RestoreDocument(f.ctx, service.Human(f.owner.ID), docID, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
		t.Fatal(err)
	}

	// Default push is off, so the write emits no notification.push row even
	// before any push worker runs (PushedAt alone could not prove it).
	for _, ev := range f.events(t, "notification.push") {
		if strings.Contains(ev.Payload, "notification_id") {
			t.Fatalf("trash notice emitted a push event: %s", ev.Payload)
		}
	}

	// A second, emailable row proves the digest still works for this owner:
	// a task the member assigns to them (self-assignment notifies nobody).
	task := f.newTask(t, "Việc khác")
	assignee := f.owner.ID
	p := &assignee
	if _, err := f.tasks.Update(f.ctx, service.Human(f.member.ID), task.ID, service.UpdateTaskInput{AssigneeID: &p}); err != nil {
		t.Fatal(err)
	}
	f.handleTopic(t, "task.updated")

	out := &fakeOutbox{}
	s := NewDigestScheduler(f.q, mail.Renderer{AppURL: "http://app.test"}, out)
	s.SetDocumentReaders(f.docs)
	at := time.Date(2026, 10, 18, 1, 5, 0, 0, time.UTC) // 08:05 Asia/Ho_Chi_Minh.
	if n, err := s.RunOnce(f.ctx, at); err != nil || n != 1 {
		t.Fatalf("digest = %d, %v, want one mail", n, err)
	}
	if len(out.sent) != 1 || out.sent[0].To != f.owner.Email {
		t.Fatalf("sent = %+v", out.sent)
	}
	if !contains(out.sent[0].Text, "Việc khác") {
		t.Fatalf("digest lost the task row:\n%s", out.sent[0].Text)
	}
	if contains(out.sent[0].Text, "Báo cáo quý") || contains(out.sent[0].Text, "thùng rác") {
		t.Fatalf("digest mailed the trash notice:\n%s", out.sent[0].Text)
	}
}
