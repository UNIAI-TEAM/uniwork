package service

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-676 (G1-02b): the access log. actor/via/document/version/action/
// correlation per row; the same (document, actor, action) inside five
// minutes coalesces (C-01 §3.6); a failed write never fails the read and is
// counted; no content, token or client address is stored.

type countingAccessMetrics struct {
	failed            atomic.Int64
	protectedOverflow atomic.Int64
	saves             atomic.Int64
	conflicts         atomic.Int64
	quotaRejects      atomic.Int64
	sweeps            atomic.Int64
}

func (c *countingAccessMetrics) IncDocumentAccessLogFailed() { c.failed.Add(1) }
func (c *countingAccessMetrics) IncDocumentVersionsProtectedOverflow() {
	c.protectedOverflow.Add(1)
}
func (c *countingAccessMetrics) ObserveDocumentSave(string, string, float64) { c.saves.Add(1) }
func (c *countingAccessMetrics) IncDocumentConflict(string, string)          { c.conflicts.Add(1) }
func (c *countingAccessMetrics) IncDocumentQuotaRejected(string)             { c.quotaRejects.Add(1) }
func (c *countingAccessMetrics) ObserveDocumentWorkerSweep(string, string, float64) {
	c.sweeps.Add(1)
}
func (c *countingAccessMetrics) AddDocumentWorkerRowsFailed(string, int) {}
func (c *countingAccessMetrics) IncDocumentEditLockOp(string)            {}
func (c *countingAccessMetrics) IncDocumentEditLockRefused(string)       {}
func (c *countingAccessMetrics) IncDocumentEditRequest(string)           {}

func TestDocumentAccessLog(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "alog")
	metrics := &countingAccessMetrics{}
	f.svc.SetMetrics(metrics)
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)
	list := func(t *testing.T) []db.DocumentAccessLog {
		t.Helper()
		rows, err := f.svc.ListDocumentAccessLogs(f.ctx, Human(tn.aclOwner.ID), d.ID, DocumentAccessLogQuery{})
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}

	t.Run("row carries actor, via, version, action and correlation", func(t *testing.T) {
		ctx := audit.WithRequest(f.ctx, audit.RequestInfo{CorrelationID: "corr-doc-1"})
		_, acc, err := f.svc.authorizeDocument(ctx, member, d.ID, DocumentLevelView)
		if err != nil {
			t.Fatal(err)
		}
		v := int32(3)
		f.svc.RecordDocumentRead(ctx, member, d, acc, DocumentAccessView, &v)
		rows := list(t)
		if len(rows) != 1 {
			t.Fatalf("rows = %d", len(rows))
		}
		r := rows[0]
		if r.ActorKind != "human" || r.ActorID.String != tn.member.ID || r.Via != "member" ||
			r.Action != "view" || !r.Version.Valid || r.Version.Int32 != 3 || r.CorrelationID != "corr-doc-1" ||
			r.OrganizationID != tn.orgID || r.WorkspaceID != tn.wsA {
			t.Fatalf("row: %+v", r)
		}
	})

	t.Run("five-minute coalescing per document, actor and action", func(t *testing.T) {
		acc := DocumentAccess{Level: DocumentLevelEdit, Via: DocumentViaMember}
		f.svc.RecordDocumentRead(f.ctx, member, d, acc, DocumentAccessView, nil)
		if n := len(list(t)); n != 1 {
			t.Fatalf("repeat view inside the window wrote a row: %d", n)
		}
		f.svc.RecordDocumentRead(f.ctx, member, d, acc, DocumentAccessExport, nil)
		f.svc.RecordDocumentRead(f.ctx, Human(tn.wsAdmin.ID), d, acc, DocumentAccessView, nil)
		if n := len(list(t)); n != 3 {
			t.Fatalf("another action / actor: rows = %d, want 3", n)
		}
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE document_access_logs SET occurred_at = now() - interval '6 minutes' WHERE document_id = $1`, d.ID); err != nil {
			t.Fatal(err)
		}
		f.svc.RecordDocumentRead(f.ctx, member, d, acc, DocumentAccessView, nil)
		if n := len(list(t)); n != 4 {
			t.Fatalf("after the window: rows = %d, want 4", n)
		}
		// Without a request the row still carries a correlation id.
		for _, r := range list(t) {
			if r.CorrelationID == "" {
				t.Fatal("empty correlation_id")
			}
		}
	})

	t.Run("a failed write is counted and never fails the caller", func(t *testing.T) {
		ctx, cancel := context.WithCancel(f.ctx)
		cancel()
		before := metrics.failed.Load()
		f.svc.RecordDocumentRead(ctx, member, d, DocumentAccess{Via: DocumentViaMember}, DocumentAccessDownload, nil)
		if metrics.failed.Load() != before+1 {
			t.Fatalf("failure not counted: %d -> %d", before, metrics.failed.Load())
		}
	})

	t.Run("only manage reads the log", func(t *testing.T) {
		if _, err := f.svc.ListDocumentAccessLogs(f.ctx, member, d.ID, DocumentAccessLogQuery{}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("editor: %v", err)
		}
		if _, err := f.svc.ListDocumentAccessLogs(f.ctx, Human(tn.outsider.ID), d.ID, DocumentAccessLogQuery{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-reader: %v", err)
		}
		if _, err := f.svc.ListDocumentAccessLogs(f.ctx, Human(tn.aclOwner.ID), d.ID, DocumentAccessLogQuery{Action: "delete"}); err == nil {
			t.Fatal("unknown action filter accepted")
		}
		rows, err := f.svc.ListDocumentAccessLogs(f.ctx, Human(tn.aclOwner.ID), d.ID, DocumentAccessLogQuery{Action: DocumentAccessExport})
		if err != nil || len(rows) != 1 || rows[0].Action != "export" {
			t.Fatalf("action filter: %v %d", err, len(rows))
		}
		rows, err = f.svc.ListDocumentAccessLogs(f.ctx, Human(tn.aclOwner.ID), d.ID, DocumentAccessLogQuery{Limit: 2})
		if err != nil || len(rows) != 2 {
			t.Fatalf("limit: %v %d", err, len(rows))
		}
		older, err := f.svc.ListDocumentAccessLogs(f.ctx, Human(tn.aclOwner.ID), d.ID, DocumentAccessLogQuery{Before: rows[1].OccurredAt.Time})
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range older {
			if !r.OccurredAt.Time.Before(rows[1].OccurredAt.Time) {
				t.Fatalf("cursor returned a newer row")
			}
		}
	})

	t.Run("no content, token or client address column exists", func(t *testing.T) {
		rows, err := f.pool.Query(f.ctx,
			`SELECT column_name FROM information_schema.columns WHERE table_name = 'document_access_logs'`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		allowed := map[string]bool{
			"id": true, "organization_id": true, "workspace_id": true, "document_id": true, "version": true,
			"action": true, "actor_kind": true, "actor_id": true, "via": true, "share_link_id": true,
			"correlation_id": true, "occurred_at": true,
		}
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				t.Fatal(err)
			}
			if !allowed[c] {
				t.Fatalf("unexpected access-log column %q", c)
			}
		}
	})

	t.Run("owned documents log via owner and keep the log for their managers", func(t *testing.T) {
		owned := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, ownerID: "01WPALOG000000000000000000"})
		f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.outsider.ID: DocumentLevelManage, tn.member.ID: DocumentLevelView})
		defer f.svc.SetOwnerLevelResolver(nil)
		_, acc, err := f.svc.authorizeDocument(f.ctx, member, owned.ID, DocumentLevelView)
		if err != nil {
			t.Fatal(err)
		}
		f.svc.RecordDocumentRead(f.ctx, member, owned, acc, DocumentAccessView, nil)
		rows, err := f.svc.ListDocumentAccessLogs(f.ctx, Human(tn.outsider.ID), owned.ID, DocumentAccessLogQuery{})
		if err != nil || len(rows) != 1 || rows[0].Via != "owner" {
			t.Fatalf("owned log: %v %+v", err, rows)
		}
	})
}

// countingTracer counts every query the pool sends, so a test can prove
// FilterReadableDocuments is bounded by the number of documents on the page
// and never by the number of notifications that name them. orgGate counts
// the organization membership gate separately (R1-3): one tenant check per
// distinct organization, not one per document.
type countingTracer struct {
	n       atomic.Int64
	orgGate atomic.Int64
}

func (c *countingTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	c.n.Add(1)
	if strings.Contains(data.SQL, "FROM organization_members") {
		c.orgGate.Add(1)
	}
	return ctx
}
func (c *countingTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// tracedDocumentService builds a DocumentService whose pool counts queries;
// the fixture pool keeps the migrations and the session advisory lock.
func tracedDocumentService(t *testing.T, base *pgxpool.Pool) (*DocumentService, *countingTracer) {
	t.Helper()
	cfg := base.Config()
	counter := &countingTracer{}
	cfg.ConnConfig.Tracer = counter
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	return NewDocumentService(pool, q, orgs, ws), counter
}

// G8-07 §4.6: one recipient against a page of documents. A page of 100
// notifications over 100 documents is bounded by the document count (never a
// query per notification), duplicates are deduped, and revoked / archived /
// deleted answer access_lost / gone / gone.
func TestFilterReadableDocuments(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "frd")
	svc, counter := tracedDocumentService(t, f.pool)
	// The plain member reads a workspace-visible document without a share.
	doc := func() db.Document {
		return f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	}

	t.Run("bounded by the document count, deduped across notifications", func(t *testing.T) {
		const docs = 100
		ids := make([]string, 0, docs)
		for i := 0; i < docs; i++ {
			ids = append(ids, doc().ID)
		}
		before := counter.n.Load()
		beforeGate := counter.orgGate.Load()
		states, err := svc.FilterReadableDocuments(f.ctx, tn.member.ID, ids)
		if err != nil {
			t.Fatal(err)
		}
		if len(states) != docs {
			t.Fatalf("states = %d, want %d", len(states), docs)
		}
		for _, s := range states {
			if s != DocumentReadable {
				t.Fatalf("state = %q, want readable", s)
			}
		}
		spent := counter.n.Load() - before
		// 1 existence read + 1 memoized org gate + a small per-document cost
		// (row read + level resolve). Never more than a handful per document.
		if spent < int64(docs) {
			t.Fatalf("query count %d does not scale with the %d documents", spent, docs)
		}
		if spent > int64(docs)*5+4 {
			t.Fatalf("query count %d exceeds the per-document bound for %d documents", spent, docs)
		}
		// R1-3: the organization gate is memoized for the page - one tenant
		// check for the one organization, not one per document.
		if gate := counter.orgGate.Load() - beforeGate; gate != 1 {
			t.Fatalf("organization gate ran %d times for one organization, want 1", gate)
		}

		// The same documents named by many notifications (duplicates) cost
		// the same: the ids are deduped before any query.
		dup := make([]string, 0, docs)
		for i := 0; i < docs; i++ {
			dup = append(dup, ids[i%10])
		}
		before = counter.n.Load()
		states, err = svc.FilterReadableDocuments(f.ctx, tn.member.ID, dup)
		if err != nil {
			t.Fatal(err)
		}
		if len(states) != 10 {
			t.Fatalf("deduped states = %d, want 10", len(states))
		}
		if spentDup := counter.n.Load() - before; spentDup > 5*10+4 {
			t.Fatalf("duplicate ids cost %d queries; dedupe did not happen", spentDup)
		}
	})

	t.Run("revoked share is access_lost", func(t *testing.T) {
		restricted := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		share := f.share(t, restricted, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
		states, err := svc.FilterReadableDocuments(f.ctx, tn.outsider.ID, []string{restricted.ID})
		if err != nil || states[restricted.ID] != DocumentReadable {
			t.Fatalf("shared read = %v, %v", states, err)
		}
		if err := f.q.RevokeDocumentShare(f.ctx, db.RevokeDocumentShareParams{
			ID: share.ID, OrganizationID: tn.orgID, WorkspaceID: tn.wsA, DocumentID: restricted.ID,
		}); err != nil {
			t.Fatal(err)
		}
		states, err = svc.FilterReadableDocuments(f.ctx, tn.outsider.ID, []string{restricted.ID})
		if err != nil || states[restricted.ID] != DocumentAccessLost {
			t.Fatalf("revoked read = %v, %v", states, err)
		}
	})

	t.Run("archived and deleted are gone", func(t *testing.T) {
		archived := doc()
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET archived_at = now() WHERE id = $1`, archived.ID); err != nil {
			t.Fatal(err)
		}
		deleted := doc()
		if _, err := f.pool.Exec(f.ctx, `DELETE FROM documents WHERE id = $1`, deleted.ID); err != nil {
			t.Fatal(err)
		}
		unknown := util.NewID()
		states, err := svc.FilterReadableDocuments(f.ctx, tn.member.ID, []string{archived.ID, deleted.ID, unknown})
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range []string{archived.ID, deleted.ID, unknown} {
			if states[id] != DocumentGone {
				t.Fatalf("state[%s] = %q, want gone", id, states[id])
			}
		}
	})

	t.Run("a non-member is access_lost", func(t *testing.T) {
		d := doc()
		states, err := svc.FilterReadableDocuments(f.ctx, tn.outsider.ID, []string{d.ID})
		if err != nil || states[d.ID] != DocumentAccessLost {
			t.Fatalf("outsider read = %v, %v", states, err)
		}
	})

	t.Run("empty input is an empty answer", func(t *testing.T) {
		states, err := svc.FilterReadableDocuments(f.ctx, tn.member.ID, nil)
		if err != nil || len(states) != 0 {
			t.Fatalf("empty = %v, %v", states, err)
		}
	})
}
