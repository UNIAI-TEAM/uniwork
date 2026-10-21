package notification

// DOC-CHANGE-NOTIFY (UNI-2056): a command that changes a document somebody
// else can read tells the owner, the people with a live user share and the
// people who starred it - one notification per recipient per command, folded
// with the same actor's next command of the same verb inside a sliding
// two-minute window capped at thirty minutes. The actor, agents and the rest
// of the workspace hear nothing; a system actor sends nothing at all.

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// docChangeFixture adds the audience of a shared document to the document
// fixture: sharee holds a live user share, starrer starred it, bystander is a
// workspace member with neither and stands for "the whole workspace".
type docChangeFixture struct {
	*documentFixture
	sharee, starrer, bystander db.User
	handled                    map[string]bool
}

func newDocChangeFixture(t *testing.T) *docChangeFixture {
	t.Helper()
	f := &docChangeFixture{documentFixture: newDocumentFixture(t), handled: map[string]bool{}}
	f.sharee = f.addMember(t, "sharee@example.com", "Người Được Chia Sẻ")
	f.starrer = f.addMember(t, "starrer@example.com", "Người Gắn Sao")
	f.bystander = f.addMember(t, "bystander@example.com", "Người Ngoài Cuộc")
	return f
}

// sharedPage is a workspace-visible page of the owner with a user share for
// sharee and a star from starrer, written straight to the tables so no
// setup command produces a notice of its own.
func (f *docChangeFixture) sharedPage(t *testing.T, title string) string {
	t.Helper()
	id := f.page(t, title, f.owner.ID, nil)
	f.userShare(t, id, f.sharee.ID)
	f.star(t, id, f.starrer.ID)
	return id
}

func (f *docChangeFixture) userShare(t *testing.T, docID, userID string) {
	t.Helper()
	f.share(t, docID, "user", userID)
}

func (f *docChangeFixture) share(t *testing.T, docID, principalType, principalID string) {
	t.Helper()
	if _, err := f.q.InsertDocumentShare(f.ctx, db.InsertDocumentShareParams{
		ID: util.NewID(), OrganizationID: f.orgID, WorkspaceID: f.wsID, DocumentID: docID,
		PrincipalType: principalType, PrincipalID: principalID, Level: "view",
		GrantedBy: f.owner.ID, GrantedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
}

func (f *docChangeFixture) star(t *testing.T, docID, userID string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO document_favorites (id, organization_id, workspace_id, document_id, user_id, created_by, created_by_kind)
		 VALUES ($1,$2,$3,$4,$5,$5,'human')`, util.NewID(), f.orgID, f.wsID, docID, userID); err != nil {
		t.Fatal(err)
	}
}

func (f *docChangeFixture) restrict(t *testing.T, docID string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, docID); err != nil {
		t.Fatal(err)
	}
}

// command is one HTTP request: every event it writes shares the
// correlation id, which is the command key of the fold.
func (f *docChangeFixture) command() context.Context {
	return audit.WithRequest(f.ctx, audit.RequestInfo{CorrelationID: util.NewID()})
}

func (f *docChangeFixture) rename(t *testing.T, ctx context.Context, actorID, docID, title string) {
	t.Helper()
	doc, err := f.q.GetDocumentByID(f.ctx, docID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.docs.UpdateDocument(ctx, service.Human(actorID), docID, service.UpdateDocumentInput{Revision: doc.Revision, Title: &title}); err != nil {
		t.Fatalf("rename %s: %v", docID, err)
	}
}

func (f *docChangeFixture) move(t *testing.T, ctx context.Context, actorID, docID, parentID string) {
	t.Helper()
	doc, err := f.q.GetDocumentByID(f.ctx, docID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.docs.MoveDocument(ctx, service.Human(actorID), docID, service.MoveDocumentInput{ParentID: parentID, Revision: doc.Revision, IdempotencyKey: util.NewID()}); err != nil {
		t.Fatalf("move %s: %v", docID, err)
	}
}

// deliver feeds every outbox row not delivered yet through the consumer,
// oldest first, like the dispatcher would.
func (f *docChangeFixture) deliver(t *testing.T) {
	t.Helper()
	rows, err := f.pool.Query(f.ctx, `SELECT * FROM outbox_events ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	evs, err := pgx.CollectRows(rows, pgx.RowToStructByName[db.OutboxEvent])
	if err != nil {
		t.Fatal(err)
	}
	for _, ev := range evs {
		if f.handled[ev.ID] {
			continue
		}
		f.handled[ev.ID] = true
		if err := f.consumer.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
}

// docChangeKind is the kind under test, spelled out so these tests compile
// before the kind exists.
const docChangeKind = "document_changed"

func (f *docChangeFixture) changed(t *testing.T, userID string) []db.Notification {
	t.Helper()
	var out []db.Notification
	for _, n := range f.inbox(t, userID) {
		if n.Kind == docChangeKind {
			out = append(out, n)
		}
	}
	return out
}

func (f *docChangeFixture) documentsOf(t *testing.T, notificationID string) []string {
	t.Helper()
	rows, err := f.q.ListNotificationDocumentsForReader(f.ctx, db.ListNotificationDocumentsForReaderParams{
		UserID: f.ownerOf(t, notificationID), NotificationID: notificationID, LimitN: 1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.DocumentID
	}
	return out
}

func (f *docChangeFixture) ownerOf(t *testing.T, notificationID string) string {
	t.Helper()
	n, err := f.q.GetNotification(f.ctx, notificationID)
	if err != nil {
		t.Fatal(err)
	}
	return n.UserID
}

func changeParams(t *testing.T, n db.Notification) map[string]string {
	t.Helper()
	var p map[string]string
	if err := json.Unmarshal([]byte(n.Params), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

// one asserts a single document_changed row with verb and document count.
func (f *docChangeFixture) one(t *testing.T, userID, verb string, count int) db.Notification {
	t.Helper()
	got := f.changed(t, userID)
	if len(got) != 1 {
		t.Fatalf("user %s: %d document_changed rows, want 1: %+v", userID, len(got), got)
	}
	p := changeParams(t, got[0])
	if p["verb"] != verb || p["document_count"] != strconv.Itoa(count) {
		t.Fatalf("user %s: params %v, want verb %s and document_count %d", userID, p, verb, count)
	}
	if docs := f.documentsOf(t, got[0].ID); len(docs) != count {
		t.Fatalf("user %s: %d notification_documents rows, want %d", userID, len(docs), count)
	}
	return got[0]
}

func (f *docChangeFixture) none(t *testing.T, userIDs ...string) {
	t.Helper()
	for _, id := range userIDs {
		if got := f.changed(t, id); len(got) != 0 {
			t.Fatalf("user %s: %d document_changed rows, want none: %+v", id, len(got), got)
		}
	}
}

func (f *docChangeFixture) age(t *testing.T, userID, column, interval string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE notifications SET `+column+` = `+column+` - $2::interval WHERE user_id = $1 AND kind = $3`,
		userID, interval, docChangeKind); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentChangedRenameNotifiesTheAudience(t *testing.T) {
	f := newDocChangeFixture(t)
	docID := f.sharedPage(t, "Kế hoạch")

	f.rename(t, f.command(), f.member.ID, docID, "Kế hoạch 2027")
	f.deliver(t)

	for _, u := range []string{f.owner.ID, f.sharee.ID, f.starrer.ID} {
		n := f.one(t, u, "renamed", 1)
		p := changeParams(t, n)
		if n.ActorID != f.member.ID || n.ActorKind != "human" || p["actor"] != f.member.DisplayName ||
			p["sample_document_ids"] != docID || n.ResourceType != "document" {
			t.Fatalf("notification = %+v params %v", n, p)
		}
		if _, ok := p["document"]; ok {
			t.Fatalf("params carry a title: %v", p)
		}
		if n.PushedAt.Valid {
			t.Fatalf("pushed by default: %+v", n)
		}
	}
	f.none(t, f.member.ID, f.bystander.ID)

	// An icon alone is not a rename.
	icon := "📄"
	doc, err := f.q.GetDocumentByID(f.ctx, docID)
	if err != nil {
		t.Fatal(err)
	}
	f.readAll(t, f.owner.ID)
	if _, err := f.docs.UpdateDocument(f.command(), service.Human(f.member.ID), docID, service.UpdateDocumentInput{Revision: doc.Revision, Icon: &icon}); err != nil {
		t.Fatal(err)
	}
	f.deliver(t)
	if got := f.changed(t, f.owner.ID); len(got) != 1 {
		t.Fatalf("icon change notified: %+v", got)
	}
}

func TestDocumentChangedPrivateDocumentSendsNothing(t *testing.T) {
	f := newDocChangeFixture(t)
	docID := f.page(t, "Nhật ký", f.owner.ID, nil)
	f.restrict(t, docID)
	f.star(t, docID, f.starrer.ID) // a stale star of somebody who cannot read it

	f.rename(t, f.command(), f.owner.ID, docID, "Nhật ký riêng")
	f.deliver(t)
	f.none(t, f.owner.ID, f.member.ID, f.starrer.ID, f.sharee.ID, f.bystander.ID)
}

func TestDocumentChangedOneCommandManyDocumentsIsOneNotice(t *testing.T) {
	f := newDocChangeFixture(t)
	ids := make([]string, 50)
	for i := range ids {
		ids[i] = f.sharedPage(t, "Tài liệu "+strconv.Itoa(i))
	}
	ctx := f.command()
	for i, id := range ids {
		f.rename(t, ctx, f.member.ID, id, "Đổi tên "+strconv.Itoa(i))
	}
	f.deliver(t)

	for _, u := range []string{f.owner.ID, f.sharee.ID, f.starrer.ID} {
		n := f.one(t, u, "renamed", 50)
		p := changeParams(t, n)
		if p["sample_document_ids"] != ids[0]+","+ids[1]+","+ids[2] || n.Count != 50 {
			t.Fatalf("user %s: count %d params %v", u, n.Count, p)
		}
	}
	f.none(t, f.member.ID, f.bystander.ID)
}

func TestDocumentChangedFoldWindow(t *testing.T) {
	t.Run("two commands of one verb inside two minutes fold, a document counts once", func(t *testing.T) {
		f := newDocChangeFixture(t)
		a, b := f.sharedPage(t, "A"), f.sharedPage(t, "B")
		f.rename(t, f.command(), f.member.ID, a, "A1")
		f.deliver(t)
		ctx := f.command()
		f.rename(t, ctx, f.member.ID, a, "A2")
		f.rename(t, ctx, f.member.ID, b, "B1")
		f.deliver(t)
		f.one(t, f.owner.ID, "renamed", 2)
	})

	t.Run("past two minutes a new notice opens", func(t *testing.T) {
		f := newDocChangeFixture(t)
		a, b := f.sharedPage(t, "A"), f.sharedPage(t, "B")
		f.rename(t, f.command(), f.member.ID, a, "A1")
		f.deliver(t)
		f.age(t, f.owner.ID, "updated_at", "3 minutes")
		f.rename(t, f.command(), f.member.ID, b, "B1")
		f.deliver(t)
		if got := f.changed(t, f.owner.ID); len(got) != 2 {
			t.Fatalf("owner rows = %d, want 2", len(got))
		}
	})

	t.Run("a read notice is not folded into", func(t *testing.T) {
		f := newDocChangeFixture(t)
		a, b := f.sharedPage(t, "A"), f.sharedPage(t, "B")
		f.rename(t, f.command(), f.member.ID, a, "A1")
		f.deliver(t)
		f.readAll(t, f.owner.ID)
		f.rename(t, f.command(), f.member.ID, b, "B1")
		f.deliver(t)
		if got := f.changed(t, f.owner.ID); len(got) != 2 {
			t.Fatalf("owner rows = %d, want 2", len(got))
		}
	})

	t.Run("the window slides but stops thirty minutes after the first notice", func(t *testing.T) {
		f := newDocChangeFixture(t)
		a, b := f.sharedPage(t, "A"), f.sharedPage(t, "B")
		f.rename(t, f.command(), f.member.ID, a, "A1")
		f.deliver(t)
		f.age(t, f.owner.ID, "created_at", "31 minutes")
		f.rename(t, f.command(), f.member.ID, b, "B1")
		f.deliver(t)
		if got := f.changed(t, f.owner.ID); len(got) != 2 {
			t.Fatalf("owner rows = %d, want 2", len(got))
		}
	})

	t.Run("another verb opens its own notice", func(t *testing.T) {
		f := newDocChangeFixture(t)
		a := f.sharedPage(t, "A")
		folder := f.node(t, "folder", "Thư mục", f.owner.ID, nil)
		f.rename(t, f.command(), f.member.ID, a, "A1")
		f.move(t, f.command(), f.member.ID, a, folder)
		f.deliver(t)
		got := f.changed(t, f.owner.ID)
		if len(got) != 2 {
			t.Fatalf("owner rows = %d, want 2", len(got))
		}
	})
}

func TestDocumentChangedWorkspaceShareDoesNotReachTheWorkspace(t *testing.T) {
	f := newDocChangeFixture(t)
	docID := f.page(t, "Chia sẻ workspace", f.owner.ID, nil)
	f.restrict(t, docID)
	f.share(t, docID, "workspace", f.wsID)
	f.star(t, docID, f.starrer.ID)

	f.rename(t, f.command(), f.owner.ID, docID, "Chia sẻ workspace 2")
	f.deliver(t)
	f.one(t, f.starrer.ID, "renamed", 1)
	f.none(t, f.member.ID, f.bystander.ID, f.sharee.ID, f.owner.ID)
}

func TestDocumentChangedNoDoubleNotice(t *testing.T) {
	t.Run("the new grantee hears document_shared only", func(t *testing.T) {
		f := newDocChangeFixture(t)
		docID := f.page(t, "Hợp đồng", f.owner.ID, nil)
		f.star(t, docID, f.starrer.ID)
		outsider := f.addOrgOutsider(t, "outsider@example.com", "Người Mới")
		if _, err := f.docs.ShareDocument(f.command(), service.Human(f.owner.ID), docID, service.DocumentShareInput{
			PrincipalType: service.DocumentPrincipalUser, PrincipalID: outsider.ID, Level: service.DocumentLevelView,
		}); err != nil {
			t.Fatal(err)
		}
		f.deliver(t)
		if got := f.sharedNotifications(t, outsider.ID); len(got) != 1 {
			t.Fatalf("grantee document_shared rows = %d, want 1", len(got))
		}
		f.none(t, outsider.ID, f.owner.ID)
		f.one(t, f.starrer.ID, "access_changed", 1)
	})

	t.Run("the owner of a trashed document hears document_trashed_by_other only", func(t *testing.T) {
		f := newDocChangeFixture(t)
		f.makeAdmin(t, f.member.ID)
		docID := f.sharedPage(t, "Báo cáo")
		if _, err := f.docs.ArchiveDocument(f.command(), service.Human(f.member.ID), docID, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
			t.Fatal(err)
		}
		f.deliver(t)
		if got := f.trashedNotifications(t, f.owner.ID); len(got) != 1 {
			t.Fatalf("owner trash rows = %d, want 1", len(got))
		}
		f.none(t, f.owner.ID, f.member.ID, f.bystander.ID)
		// Readers just before the trash command, not after it: the trashed
		// row is visible to managers only, yet sharee and starrer hear.
		f.one(t, f.sharee.ID, "trashed", 1)
		f.one(t, f.starrer.ID, "trashed", 1)
	})
}

func TestDocumentChangedRelocationTellsThePrivateOwner(t *testing.T) {
	f := newDocChangeFixture(t)
	folder := f.node(t, "folder", "Thư mục chung", f.member.ID, nil)
	docID := f.page(t, "Ghi chú riêng", f.owner.ID, &folder)
	f.restrict(t, docID)

	// UNI-2055 rule 7, as e6-server writes it: the folder-trash command moves
	// the document to the workspace root with a document.moved event and the
	// audit row that names the reason, in one transaction.
	ctx := f.command()
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(f.ctx) }()
	if err := audit.NewRecorder().Record(ctx, f.q.WithTx(tx), audit.Entry{
		OrganizationID: f.orgID, WorkspaceID: f.wsID, Actor: service.Human(f.member.ID),
		Action: audit.ActionDocumentMoved, ResourceType: "document", ResourceID: docID,
		Metadata: map[string]any{"reason": "folder_trashed", "from_folder_id": folder, "batch_id": util.NewID()},
	}, audit.Event{Topic: "document.moved", Payload: map[string]string{"document_id": docID, "workspace_id": f.wsID}}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	f.deliver(t)
	f.one(t, f.owner.ID, "relocated", 1)
	f.none(t, f.member.ID, f.bystander.ID)
}

func TestDocumentChangedPurgeKeepsTheTitle(t *testing.T) {
	f := newDocChangeFixture(t)
	f.makeAdmin(t, f.member.ID)
	docID := f.sharedPage(t, "Bản nháp cũ")
	if _, err := f.docs.ArchiveDocument(f.command(), service.Human(f.owner.ID), docID, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
		t.Fatal(err)
	}
	f.deliver(t)
	f.readAll(t, f.sharee.ID)
	f.readAll(t, f.starrer.ID)
	if _, err := f.docs.PurgeDocument(f.command(), service.Human(f.member.ID), docID); err != nil {
		t.Fatal(err)
	}
	f.deliver(t)
	n := f.one(t, f.owner.ID, "deleted", 1)
	rows, err := f.q.ListNotificationDocumentsForReader(f.ctx, db.ListNotificationDocumentsForReaderParams{
		UserID: f.owner.ID, NotificationID: n.ID, LimitN: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].TitleSnapshot.String != "Bản nháp cũ" {
		t.Fatalf("deleted rows = %+v, want the title snapshot", rows)
	}
	// Only the people who could still read the trashed row hear of the purge.
	for _, u := range []string{f.sharee.ID, f.starrer.ID} {
		for _, n := range f.changed(t, u) {
			if changeParams(t, n)["verb"] == "deleted" {
				t.Fatalf("user %s heard of the purge: %+v", u, n)
			}
		}
	}
}

func TestDocumentChangedRedeliveryIsIdempotent(t *testing.T) {
	f := newDocChangeFixture(t)
	docID := f.sharedPage(t, "Lặp lại")
	f.rename(t, f.command(), f.member.ID, docID, "Lặp lại 2")
	f.deliver(t)
	ev := f.lastEvent(t, "document.updated")
	for i := 0; i < 2; i++ {
		if err := f.consumer.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	n := f.one(t, f.owner.ID, "renamed", 1)
	if n.Count != 1 {
		t.Fatalf("count = %d after redelivery, want 1", n.Count)
	}
}

func TestDocumentChangedKindOffWritesNothing(t *testing.T) {
	f := newDocChangeFixture(t)
	if err := f.q.UpsertNotificationPreference(f.ctx, db.UpsertNotificationPreferenceParams{
		UserID: f.owner.ID, Kind: docChangeKind, InApp: false,
	}); err != nil {
		t.Fatal(err)
	}
	docID := f.sharedPage(t, "Tắt")
	f.rename(t, f.command(), f.member.ID, docID, "Tắt 2")
	f.deliver(t)
	f.none(t, f.owner.ID)
	f.one(t, f.starrer.ID, "renamed", 1)
}

func TestDocumentChangedActors(t *testing.T) {
	t.Run("an agent actor notifies, named as the agent; an agent is never a recipient", func(t *testing.T) {
		f := newDocChangeFixture(t)
		agent, err := f.q.CreateAgent(f.ctx, db.CreateAgentParams{
			ID: util.NewID(), OrganizationID: f.orgID, Name: "Trợ Lý", Handle: "tro-ly",
			OwnerUserID: f.member.ID, AutonomyPolicy: "{}", CreatedBy: f.member.ID, CreatedByKind: "human",
		})
		if err != nil {
			t.Fatal(err)
		}
		docID := f.sharedPage(t, "Agent đổi tên")
		f.userShare(t, docID, agent.ID)
		f.star(t, docID, agent.ID)
		f.rename(t, f.command(), f.member.ID, docID, "Agent đã đổi tên")
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE outbox_events SET actor_kind = 'agent', actor_id = $1 WHERE id = $2`,
			agent.ID, f.lastEvent(t, "document.updated").ID); err != nil {
			t.Fatal(err)
		}
		f.deliver(t)
		n := f.one(t, f.owner.ID, "renamed", 1)
		if n.ActorKind != "agent" || n.ActorID != agent.ID || changeParams(t, n)["actor"] != "Trợ Lý" {
			t.Fatalf("notification = %+v", n)
		}
		f.none(t, agent.ID)
	})

	t.Run("a system actor sends nothing", func(t *testing.T) {
		f := newDocChangeFixture(t)
		docID := f.sharedPage(t, "Hệ thống")
		f.rename(t, f.command(), f.member.ID, docID, "Hệ thống 2")
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE outbox_events SET actor_kind = 'system', actor_id = 'folder-ws-public' WHERE id = $1`,
			f.lastEvent(t, "document.updated").ID); err != nil {
			t.Fatal(err)
		}
		f.deliver(t)
		f.none(t, f.owner.ID, f.sharee.ID, f.starrer.ID)
	})
}
