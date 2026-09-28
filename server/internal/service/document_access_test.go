package service

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
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
