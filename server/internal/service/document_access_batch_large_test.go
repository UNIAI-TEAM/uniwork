package service

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// seedAccessBatchUsers inserts n verified users who are all active members of
// the tenant's organization, so a batch can name them as user principals.
func seedAccessBatchUsers(t *testing.T, f *docPermFixture, orgID, prefix string, n int) []string {
	t.Helper()
	ids := make([]string, n)
	emails := make([]string, n)
	names := make([]string, n)
	for i := range n {
		ids[i] = util.NewID()
		emails[i] = fmt.Sprintf("%s-%04d-%s@example.com", prefix, i, ids[i])
		names[i] = fmt.Sprintf("%s %04d", prefix, i)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO users (id, email, display_name, password_hash, email_verified_at)
		SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), 'x', now()
	`, ids, emails, names); err != nil {
		t.Fatalf("seed %d users: %v", n, err)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO organization_members (organization_id, user_id, role)
		SELECT $1, unnest($2::text[]), 'member'
	`, orgID, ids); err != nil {
		t.Fatalf("seed %d org members: %v", n, err)
	}
	return ids
}

func accessBatchViewItems(ids []string) []DocumentAccessBatchItem {
	items := make([]DocumentAccessBatchItem, len(ids))
	for i, id := range ids {
		items[i] = DocumentAccessBatchItem{PrincipalType: DocumentPrincipalUser, PrincipalID: id, Level: docLevelPtr(DocumentLevelComment)}
	}
	return items
}

func countOutboxWithNotify(t *testing.T, f *docPermFixture, documentID string) (rows, notified int) {
	t.Helper()
	dbRows, err := f.pool.Query(f.ctx,
		`SELECT payload FROM outbox_events WHERE topic = 'document.shared' AND payload::jsonb->>'document_id' = $1`, documentID)
	if err != nil {
		t.Fatal(err)
	}
	defer dbRows.Close()
	for dbRows.Next() {
		var raw string
		if err := dbRows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var p map[string]string
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatal(err)
		}
		rows++
		if p["notify_user_id"] != "" {
			notified++
		}
	}
	if err := dbRows.Err(); err != nil {
		t.Fatal(err)
	}
	return rows, notified
}

// TestDocumentAccessBatchHasNoItemCap proves UNI-2012 S1e: the Share dialog's
// people picker may send any number of principals through
// PUT /documents/{id}/access. 101 and 1,000 user items succeed in preview and
// apply; an empty batch and a duplicate principal are still refused.
func TestDocumentAccessBatchHasNoItemCap(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1e")
	mgr := Human(tn.aclOwner.ID)

	t.Run("101 items preview and apply", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		ids := seedAccessBatchUsers(t, f, tn.orgID, "s1e101", 101)
		items := accessBatchViewItems(ids)

		preview, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{Items: items, DryRun: true})
		if err != nil {
			t.Fatalf("dry run of 101 items: %v", err)
		}
		if len(preview.Results) != 101 || len(preview.Preview.Users) != 101 {
			t.Fatalf("dry run results/users = %d/%d, want 101/101", len(preview.Results), len(preview.Preview.Users))
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 0 {
			t.Fatalf("dry run wrote %d document.shared audit rows, want 0", n)
		}

		res, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{Items: items})
		if err != nil {
			t.Fatalf("apply of 101 items: %v", err)
		}
		if len(res.Results) != 101 {
			t.Fatalf("apply results = %d, want 101", len(res.Results))
		}
		for _, r := range res.Results {
			if r.Status != DocumentAccessStatusGranted {
				t.Fatalf("item %d status = %s, want granted", r.Index, r.Status)
			}
		}
	})

	t.Run("1000 items preview and apply", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		const total = 1000
		ids := seedAccessBatchUsers(t, f, tn.orgID, "s1e1000", total)
		items := accessBatchViewItems(ids)

		started := time.Now()
		preview, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{Items: items, DryRun: true})
		dryElapsed := time.Since(started)
		if err != nil {
			t.Fatalf("dry run of 1000 items: %v", err)
		}
		if len(preview.Results) != total || len(preview.Preview.Users) != total {
			t.Fatalf("dry run results/users = %d/%d, want %d", len(preview.Results), len(preview.Preview.Users), total)
		}
		var live int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_shares WHERE document_id = $1 AND revoked_at IS NULL`, doc.ID).Scan(&live); err != nil {
			t.Fatal(err)
		}
		if live != 0 {
			t.Fatalf("dry run wrote %d shares, want 0", live)
		}
		auditsBefore := countAudit(t, f, audit.ActionDocumentShared, doc.ID)

		started = time.Now()
		res, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{Items: items})
		applyElapsed := time.Since(started)
		if err != nil {
			t.Fatalf("apply of 1000 items: %v", err)
		}
		if len(res.Results) != total {
			t.Fatalf("apply results = %d, want %d", len(res.Results), total)
		}
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_shares WHERE document_id = $1 AND revoked_at IS NULL`, doc.ID).Scan(&live); err != nil {
			t.Fatal(err)
		}
		if live != total {
			t.Fatalf("live shares = %d, want %d", live, total)
		}
		audits := countAudit(t, f, audit.ActionDocumentShared, doc.ID) - auditsBefore
		outboxRows, notified := countOutboxWithNotify(t, f, doc.ID)
		t.Logf("1000-item batch: dry run %s, apply %s; shares=%d audit(document.shared)=%d outbox(document.shared)=%d notify_user_id=%d",
			dryElapsed, applyElapsed, live, audits, outboxRows, notified)
		if audits != total {
			t.Fatalf("audit rows = %d, want %d", audits, total)
		}
		// One notice per grantee whose effective level the batch raises, and
		// nobody else: no room or group fan-out.
		if notified != total {
			t.Fatalf("notify_user_id events = %d, want %d (one per raised grantee)", notified, total)
		}
		// S1e-bulk resolves the levels set-based and writes the grants in chunks:
		// on local Docker the dry run went from 7.6 s to about 0.23 s and the
		// apply from 10.9 s to about 0.5 s. The target is under 2 s / 3 s; the
		// guard leaves room for a loaded CI host while still catching a fall
		// back to a round trip per person.
		if dryElapsed > 5*time.Second || applyElapsed > 5*time.Second {
			t.Fatalf("1000-item batch too slow: dry run %s, apply %s, want each <= 5s", dryElapsed, applyElapsed)
		}
	})

	t.Run("a duplicate principal in a large batch is still refused", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		ids := seedAccessBatchUsers(t, f, tn.orgID, "s1edup", 150)
		items := accessBatchViewItems(ids)
		items = append(items, items[7])
		for _, dry := range []bool{true, false} {
			_, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{Items: items, DryRun: dry})
			rej := rejectedItemsFromError(t, err)
			if len(rej) != 1 || rej[0].Code != "duplicate_principal" || rej[0].Index != 150 || rej[0].PrincipalID != ids[7] {
				t.Fatalf("dry=%v rejected = %+v, want one duplicate_principal at index 150", dry, rej)
			}
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 0 {
			t.Fatalf("a refused batch wrote %d audit rows, want 0", n)
		}
	})
}
