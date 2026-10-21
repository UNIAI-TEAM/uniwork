package notification

// DOC-CHANGE-NOTIFY (UNI-2056) review r1: the lane the notice rides, the
// tenant of a fold, the purge's own reader list, the cost of a wide command,
// the privacy of a mixed command, every verb through its real command, and the
// edges of the fold window.

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// docChangeTopic is the server-only row a command writes beside its client
// frame when the change is one people hear of (BE-R1-1).
const docChangeTopic = "document.change_noticed"

// realtimeDocumentTopics carry the Documents UI frames and the chat card
// refresh; a notify-lane consumer on any of them would hold those frames
// behind the notification fan-out (chat_document_card_refresh.go).
var realtimeDocumentTopics = []string{
	"document.updated", "document.restored", "document.shelved", "document.unshelved",
	"document.workspace_access_changed", "document.link_created", "document.link_revoked",
	"document.version_created",
}

func TestDocumentChangedKeepsTheFrameTopicsOffTheNotifyLane(t *testing.T) {
	topics := (&Consumer{}).Topics()
	for _, topic := range realtimeDocumentTopics {
		if slices.Contains(topics, topic) {
			t.Errorf("the notification consumer (notify lane) subscribes to %s; it would move that frame off the realtime lane", topic)
		}
	}
	if !slices.Contains(topics, docChangeTopic) {
		t.Errorf("the notification consumer does not subscribe to %s", docChangeTopic)
	}
	def, ok := outbox.Lookup(docChangeTopic)
	if !ok || def.Scope != outbox.ScopeNone || def.Delivery != outbox.DeliveryOutbox {
		t.Errorf("catalogue row of %s = %+v, %v; want a server-only outbox row", docChangeTopic, def, ok)
	}
}

// pageIn is f.page in another workspace of the fixture organization.
func (f *docChangeFixture) pageIn(t *testing.T, wsID, title, ownerID string) string {
	t.Helper()
	id := util.NewID()
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility, acl_owner_id, created_by, created_by_kind, updated_by, updated_by_kind)
		 VALUES ($1,$2,$3,'page',$4,'workspace',$5,$5,'human',$5,'human')`,
		id, f.orgID, wsID, title, ownerID); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestDocumentChangedFoldStaysInItsWorkspace(t *testing.T) {
	f := newDocChangeFixture(t)
	v, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.orgID, "Notif WS 2", "notif-ws-2")
	if err != nil {
		t.Fatal(err)
	}
	ws2 := v.Workspace.ID
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: ws2, OrganizationID: f.orgID, UserID: f.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	a := f.page(t, "Ở workspace một", f.owner.ID, nil)
	b := f.pageIn(t, ws2, "Ở workspace hai", f.owner.ID)

	f.rename(t, f.command(), f.member.ID, a, "Một")
	f.rename(t, f.command(), f.member.ID, b, "Hai")
	f.deliver(t)

	got := f.changed(t, f.owner.ID)
	if len(got) != 2 {
		t.Fatalf("owner rows = %d, want one per workspace: %+v", len(got), got)
	}
	for _, n := range got {
		docs := f.documentsOf(t, n.ID)
		want := a
		if n.WorkspaceID.String == ws2 {
			want = b
		}
		if len(docs) != 1 || docs[0] != want || n.Count != 1 {
			t.Fatalf("row of workspace %s holds %v (count %d), want only %s", n.WorkspaceID.String, docs, n.Count, want)
		}
	}
}

// deletedAudit is the metadata of the purge's document.deleted audit row.
func (f *docChangeFixture) deletedAudit(t *testing.T, docID string) map[string]any {
	t.Helper()
	var raw string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT metadata FROM audit_events WHERE action = 'document.deleted' AND resource_id = $1`, docID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		t.Fatal(err)
	}
	return meta
}

func TestDocumentChangedPurgeOfAPrivateDocumentKeepsNoTitle(t *testing.T) {
	f := newDocChangeFixture(t)
	docID := f.page(t, "Nhật ký riêng tư", f.owner.ID, nil)
	f.restrict(t, docID)
	f.archive(t, f.owner.ID, docID)
	if _, err := f.docs.PurgeDocument(f.command(), service.Human(f.owner.ID), docID); err != nil {
		t.Fatal(err)
	}
	meta := f.deletedAudit(t, docID)
	for _, key := range []string{"title", "notify_user_ids"} {
		if _, ok := meta[key]; ok {
			t.Errorf("the owner purged their own private document and the audit row keeps %s: %v", key, meta)
		}
	}
	f.deliver(t)
	f.none(t, f.owner.ID, f.member.ID, f.starrer.ID)
}

// createdEvents counts the notification.created rows addressed to userID.
func (f *docChangeFixture) createdEvents(t *testing.T, userID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb ->> 'user_id' = $2`,
		TopicCreated, userID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestDocumentChangedWideCommandSendsAFewFrames(t *testing.T) {
	f := newDocChangeFixture(t)
	ids := make([]string, 50)
	for i := range ids {
		ids[i] = f.sharedPage(t, "Tài liệu "+strconv.Itoa(i))
	}
	ctx := f.command()
	for i, id := range ids {
		f.rename(t, ctx, f.member.ID, id, "Đổi tên "+strconv.Itoa(i))
	}
	start := time.Now()
	f.deliver(t)
	// A fold emits notification.created only when the row was last touched
	// two seconds ago or more, so a recipient hears the first insert and at
	// most one more frame per two seconds of delivery.
	bound := 1 + int(time.Since(start)/(2*time.Second)) + 1
	for _, u := range []string{f.owner.ID, f.sharee.ID, f.starrer.ID} {
		f.one(t, u, "renamed", 50)
		if got := f.createdEvents(t, u); got > bound || got >= 50 {
			t.Fatalf("user %s: %d notification.created frames for one 50-document command, want at most %d", u, got, bound)
		}
	}
}

func TestDocumentChangedMixedAudienceCommand(t *testing.T) {
	f := newDocChangeFixture(t)
	a := f.sharedPage(t, "Đọc được")
	b := f.page(t, "Không đọc được", f.owner.ID, nil)
	f.restrict(t, b)
	f.userShare(t, b, f.sharee.ID)
	f.star(t, b, f.starrer.ID) // a star without access

	ctx := f.command()
	f.rename(t, ctx, f.owner.ID, a, "Đọc được 2")
	f.rename(t, ctx, f.owner.ID, b, "Không đọc được 2")
	f.deliver(t)

	n := f.one(t, f.starrer.ID, "renamed", 1)
	if p := changeParams(t, n); p["sample_document_ids"] != a || n.Count != 1 {
		t.Fatalf("starrer: count %d params %v, want only %s", n.Count, p, a)
	}
	if docs := f.documentsOf(t, n.ID); len(docs) != 1 || docs[0] != a {
		t.Fatalf("starrer's notification_documents = %v, want only %s", docs, a)
	}
	f.one(t, f.sharee.ID, "renamed", 2)
}

func TestDocumentChangedShareLostBeforeDeliverySendsNothing(t *testing.T) {
	f := newDocChangeFixture(t)
	docID := f.page(t, "Thu hồi giữa chừng", f.owner.ID, nil)
	f.restrict(t, docID)
	f.userShare(t, docID, f.sharee.ID)
	f.userShare(t, docID, f.starrer.ID)

	f.rename(t, f.command(), f.owner.ID, docID, "Thu hồi giữa chừng 2")
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE document_shares SET revoked_at = now() WHERE document_id = $1 AND principal_id = $2`, docID, f.sharee.ID); err != nil {
		t.Fatal(err)
	}
	f.deliver(t)
	f.none(t, f.sharee.ID, f.owner.ID)
	f.one(t, f.starrer.ID, "renamed", 1)
}

// verbRows are a user's unread document_changed rows of one verb.
func (f *docChangeFixture) verbRows(t *testing.T, userID, verb string) []db.Notification {
	t.Helper()
	var out []db.Notification
	for _, n := range f.changed(t, userID) {
		if changeParams(t, n)["verb"] == verb && !n.ReadAt.Valid {
			out = append(out, n)
		}
	}
	return out
}

// fileDocument creates a file document of the owner through the service, on
// the fake file store, with a share for sharee and a star from starrer.
func (f *docChangeFixture) fileDocument(t *testing.T) service.DocumentFileResult {
	t.Helper()
	f.docs.SetFiles(filesfake.New(filesfake.Options{}))
	res, err := f.docs.CreateFileDocument(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateFileDocumentInput{
		Title: "Ghi chú", Filename: "ghi-chu.md", Body: bytes.NewReader([]byte("# Ghi chú\n")),
	})
	if err != nil {
		t.Fatal(err)
	}
	f.userShare(t, res.Document.ID, f.sharee.ID)
	f.star(t, res.Document.ID, f.starrer.ID)
	return res
}

func (f *docChangeFixture) commitVersion(t *testing.T, ctx context.Context, doc db.Document, engine service.DocumentEngineInfo) service.DocumentFileResult {
	t.Helper()
	up, err := f.docs.UploadDocumentFile(ctx, service.Human(f.owner.ID), doc.ID, service.DocumentUploadInput{
		Filename: "ghi-chu.md", Body: bytes.NewReader([]byte("# Ghi chú " + util.NewID() + "\n")),
	})
	if err != nil {
		t.Fatal(err)
	}
	res, err := f.docs.CommitFileVersion(ctx, service.Human(f.owner.ID), doc.ID, service.CommitFileVersionInput{
		UploadID: up.UploadID, BaseRevision: doc.Revision, Engine: engine,
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestDocumentChangedVerbsThroughTheirCommands(t *testing.T) {
	type verbCase struct {
		name string
		// run issues the command under test; setup commands of the case run
		// before it and are read away first.
		run func(t *testing.T, f *docChangeFixture, docID string)
		// verb is the notice the audience hears; "" means none.
		verb string
		// hear are the users who must hear it (the rest of the audience
		// must not).
		hear func(f *docChangeFixture) []string
	}
	audience := func(f *docChangeFixture) []string { return []string{f.owner.ID, f.sharee.ID, f.starrer.ID} }
	cases := []verbCase{
		{name: "restored", verb: "restored", hear: audience, run: func(t *testing.T, f *docChangeFixture, docID string) {
			f.archive(t, f.member.ID, docID)
			f.settle(t)
			if _, err := f.docs.RestoreDocument(f.command(), service.Human(f.member.ID), docID, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "shelved", verb: "shelved", hear: audience, run: func(t *testing.T, f *docChangeFixture, docID string) {
			if _, err := f.docs.ShelveDocument(f.command(), service.Human(f.member.ID), docID, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "unshelved", verb: "unshelved", hear: audience, run: func(t *testing.T, f *docChangeFixture, docID string) {
			if _, err := f.docs.ShelveDocument(f.command(), service.Human(f.member.ID), docID, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
				t.Fatal(err)
			}
			f.settle(t)
			if _, err := f.docs.UnshelveDocument(f.command(), service.Human(f.member.ID), docID, service.ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "share_revoked", verb: "access_changed", hear: func(f *docChangeFixture) []string { return []string{f.owner.ID, f.starrer.ID} },
			run: func(t *testing.T, f *docChangeFixture, docID string) {
				var shareID string
				if err := f.pool.QueryRow(f.ctx, `SELECT id FROM document_shares WHERE document_id = $1 AND principal_id = $2`,
					docID, f.sharee.ID).Scan(&shareID); err != nil {
					t.Fatal(err)
				}
				if err := f.docs.RevokeDocumentShare(f.command(), service.Human(f.member.ID), docID, shareID); err != nil {
					t.Fatal(err)
				}
			}},
		{name: "link_created", verb: "access_changed", hear: audience, run: func(t *testing.T, f *docChangeFixture, docID string) {
			f.enableLinks(t)
			if _, err := f.docs.CreateDocumentLink(f.command(), service.Human(f.member.ID), docID, 7); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "link_revoked", verb: "access_changed", hear: audience, run: func(t *testing.T, f *docChangeFixture, docID string) {
			f.enableLinks(t)
			link, err := f.docs.CreateDocumentLink(f.command(), service.Human(f.member.ID), docID, 7)
			if err != nil {
				t.Fatal(err)
			}
			f.settle(t)
			if err := f.docs.RevokeDocumentLink(f.command(), service.Human(f.member.ID), docID, link.Link.ID); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "workspace_access_changed", verb: "access_changed",
			// Made private: the starrer cannot read it any more; the live
			// share still can.
			hear: func(f *docChangeFixture) []string { return []string{f.owner.ID, f.sharee.ID} },
			run: func(t *testing.T, f *docChangeFixture, docID string) {
				doc, err := f.q.GetDocumentByID(f.ctx, docID)
				if err != nil {
					t.Fatal(err)
				}
				restricted := "restricted"
				if _, err := f.docs.UpdateDocument(f.command(), service.Human(f.member.ID), docID, service.UpdateDocumentInput{Revision: doc.Revision, Visibility: &restricted}); err != nil {
					t.Fatal(err)
				}
			}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newDocChangeFixture(t)
			f.makeAdmin(t, f.member.ID)
			docID := f.sharedPage(t, "Động từ "+tc.name)
			tc.run(t, f, docID)
			f.deliver(t)
			hear := tc.hear(f)
			for _, u := range []string{f.owner.ID, f.sharee.ID, f.starrer.ID, f.member.ID, f.bystander.ID} {
				got := f.verbRows(t, u, tc.verb)
				want := 0
				if slices.Contains(hear, u) {
					want = 1
				}
				if len(got) != want {
					t.Errorf("user %s: %d unread %s rows, want %d", u, len(got), tc.verb, want)
				}
			}
		})
	}

	t.Run("version_created: an upload notifies, an editor save and a restore do not", func(t *testing.T) {
		f := newDocChangeFixture(t)
		res := f.fileDocument(t)
		f.settle(t)
		res = f.commitVersion(t, f.command(), res.Document, service.DocumentEngineInfo{})
		f.deliver(t)
		// A new file is restricted: the live share hears, the star of a
		// person who cannot read it does not.
		if got := f.verbRows(t, f.sharee.ID, "version_created"); len(got) != 1 {
			t.Fatalf("sharee: %d version_created rows after an upload, want 1", len(got))
		}
		f.none(t, f.owner.ID, f.starrer.ID, f.member.ID, f.bystander.ID)

		f.settle(t)
		res = f.commitVersion(t, f.command(), res.Document, service.DocumentEngineInfo{Name: "onlyoffice", Version: "8.2"})
		if _, err := f.docs.RestoreFileVersion(f.command(), service.Human(f.owner.ID), res.Document.ID, service.RestoreFileVersionInput{
			Version: 1, BaseRevision: res.Document.Revision,
		}); err != nil {
			t.Fatal(err)
		}
		f.deliver(t)
		if got := f.verbRows(t, f.sharee.ID, "version_created"); len(got) != 0 {
			t.Fatalf("sharee: %d version_created rows after an editor save and a restore, want none", len(got))
		}
	})
}

// settle delivers what the setup commands wrote and marks every notice
// read, so the next command's notice stands on its own.
func (f *docChangeFixture) settle(t *testing.T) {
	t.Helper()
	f.deliver(t)
	for _, u := range []string{f.owner.ID, f.member.ID, f.sharee.ID, f.starrer.ID, f.bystander.ID} {
		f.readAll(t, u)
	}
}

// enableLinks turns the organization's public-link switch on.
func (f *docChangeFixture) enableLinks(t *testing.T) {
	t.Helper()
	if _, err := f.docs.SetDocumentPublicLinks(f.ctx, service.Human(f.owner.ID), f.orgID, true); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentChangedContentOrIconAloneIsNoChange(t *testing.T) {
	f := newDocChangeFixture(t)
	docID := f.sharedPage(t, "Nội dung")
	doc, err := f.q.GetDocumentByID(f.ctx, docID)
	if err != nil {
		t.Fatal(err)
	}
	content := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"mới"}]}]}`)
	view, err := f.docs.UpdateDocument(f.command(), service.Human(f.member.ID), docID, service.UpdateDocumentInput{Revision: doc.Revision, Content: content})
	if err != nil {
		t.Fatal(err)
	}
	icon := "📄"
	if _, err := f.docs.UpdateDocument(f.command(), service.Human(f.member.ID), docID, service.UpdateDocumentInput{Revision: view.Document.Revision, Icon: &icon}); err != nil {
		t.Fatal(err)
	}
	if got := f.events(t, docChangeTopic); len(got) != 0 {
		t.Fatalf("a content and an icon edit wrote %d %s rows, want none", len(got), docChangeTopic)
	}
	f.deliver(t)
	f.none(t, f.owner.ID, f.sharee.ID, f.starrer.ID)
}

func TestDocumentChangedSameCommandFoldsPastTheWindow(t *testing.T) {
	f := newDocChangeFixture(t)
	a, b := f.sharedPage(t, "A"), f.sharedPage(t, "B")
	ctx := f.command()
	f.rename(t, ctx, f.member.ID, a, "A1")
	f.deliver(t)
	f.age(t, f.owner.ID, "updated_at", "3 minutes")
	f.rename(t, ctx, f.member.ID, b, "B1")
	f.deliver(t)
	f.one(t, f.owner.ID, "renamed", 2)
}

func TestDocumentChangedCommandKeyFallsBack(t *testing.T) {
	withCorrelation := outbox.Row{ID: "ev-1"}
	withCorrelation.CorrelationID.String, withCorrelation.CorrelationID.Valid = "corr-1", true
	for _, tc := range []struct {
		name string
		ev   outbox.Row
		p    map[string]string
		want string
	}{
		{"the request's correlation id", withCorrelation, map[string]string{"archive_batch_id": "batch-1"}, "corr-1"},
		{"else the archive batch", outbox.Row{ID: "ev-2"}, map[string]string{"archive_batch_id": "batch-2"}, "batch-2"},
		{"else the event itself", outbox.Row{ID: "ev-3"}, map[string]string{}, "ev-3"},
	} {
		if got := docCommandKey(tc.ev, tc.p); got != tc.want {
			t.Errorf("%s: docCommandKey = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestDocumentChangedRedeliveryOfAFoldedEvent(t *testing.T) {
	f := newDocChangeFixture(t)
	a, b := f.sharedPage(t, "A"), f.sharedPage(t, "B")
	ctx := f.command()
	f.rename(t, ctx, f.member.ID, a, "A1")
	f.rename(t, ctx, f.member.ID, b, "B1")
	f.deliver(t)
	second := f.lastEvent(t, docChangeTopic)
	if err := f.consumer.Handle(f.ctx, second); err != nil {
		t.Fatal(err)
	}
	n := f.one(t, f.owner.ID, "renamed", 2)
	if n.Count != 2 {
		t.Fatalf("count = %d after redelivering the folded event, want 2", n.Count)
	}
}

// docChangeDrafts runs the change rule on one event and keeps the draft of
// userID.
func (f *docChangeFixture) docChangeDraft(t *testing.T, ev outbox.Row, userID string) Draft {
	t.Helper()
	payload := map[string]string{}
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
		t.Fatal(err)
	}
	ds, err := rules[ev.Topic](f.ctx, f.consumer.env, ev, payload)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range ds {
		if d.UserID == userID {
			return d
		}
	}
	t.Fatalf("no draft of %s for %s: %+v", userID, ev.ID, ds)
	return Draft{}
}

func TestDocumentChangedGroupClaimUnderConcurrency(t *testing.T) {
	f := newDocChangeFixture(t)
	a, b := f.sharedPage(t, "A"), f.sharedPage(t, "B")
	ctx := f.command()
	f.rename(t, ctx, f.member.ID, a, "A1")
	f.rename(t, ctx, f.member.ID, b, "B1")
	evs := f.events(t, docChangeTopic)
	if len(evs) != 2 {
		t.Fatalf("%d %s rows, want 2", len(evs), docChangeTopic)
	}
	drafts := []Draft{f.docChangeDraft(t, evs[0], f.owner.ID), f.docChangeDraft(t, evs[1], f.owner.ID)}

	// Hold the group's advisory lock on one fixture connection so both
	// writers park on it inside their transaction, after the delivery claim
	// and before the fold read. With the barrier read that is two fixture
	// connections; the writers bring their own pool of two.
	holder, err := f.pool.Acquire(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Release()
	hold, err := holder.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(f.ctx) }()
	key := f.owner.ID + ":" + KindDocumentChanged + ":" + drafts[0].DocChange.GroupPrefix
	if _, err := hold.Exec(f.ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, key); err != nil {
		t.Fatal(err)
	}

	writerCfg, err := pgxpool.ParseConfig(f.pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	writerCfg.MaxConns = 2
	writerCfg.ConnConfig.RuntimeParams["application_name"] = writerAppName
	writerPool, err := pgxpool.NewWithConfig(f.ctx, writerCfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writerPool.Close)
	writers := NewConsumer(writerPool, f.q, f.ws)
	writers.SetDocumentReaders(f.docs)

	prefs := DefaultPrefs(KindDocumentChanged)
	var wg sync.WaitGroup
	errs := make(chan error, len(drafts))
	for i, d := range drafts {
		wg.Add(1)
		go func(eventID string, d Draft) {
			defer wg.Done()
			if err := writers.write(f.ctx, eventID, evs[i].CorrelationID.String, d, prefs); err != nil {
				errs <- err
			}
		}(evs[i].ID, d)
	}
	deadline := time.Now().Add(writerBlockDeadline)
	for f.writersWaitingOnTheGroupLock(t, hold) < len(drafts) {
		if time.Now().After(deadline) {
			_ = hold.Rollback(f.ctx)
			wg.Wait()
			t.Fatalf("the two writers did not both park on the group claim within %s", writerBlockDeadline)
		}
		select {
		case err := <-errs:
			_ = hold.Rollback(f.ctx)
			wg.Wait()
			t.Fatalf("a writer failed before both reached the claim: %v", err)
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
	f.one(t, f.owner.ID, "renamed", 2)
}
