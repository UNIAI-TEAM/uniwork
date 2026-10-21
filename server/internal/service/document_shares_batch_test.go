package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestShareDocumentBatch(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shbatch")
	foreign := f.tenant(t, "shbatchx")
	H := Human
	mgr := H(tn.aclOwner.ID)

	t.Run("grants A+B+C at view with 3 live rows, 3 audit rows and 3 outbox events", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		wantIDs := []string{tn.outsider.ID, tn.bMember.ID, tn.member.ID}
		shares, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, wantIDs, DocumentLevelView)
		if err != nil {
			t.Fatalf("ShareDocumentBatch: %v", err)
		}
		if len(shares) != 3 {
			t.Fatalf("len(shares) = %d, want 3", len(shares))
		}
		for i, wantID := range wantIDs {
			if shares[i].PrincipalType != DocumentPrincipalUser || shares[i].PrincipalID != wantID || shares[i].Level != string(DocumentLevelView) {
				t.Fatalf("shares[%d] = %+v, want user/%s/view", i, shares[i], wantID)
			}
			if got := level(t, f, H(wantID), doc); got != DocumentLevelView {
				t.Fatalf("effective level for %s = %q, want view", wantID, got)
			}
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 3 {
			t.Fatalf("document.shared audit rows = %d, want 3", n)
		}
		if n := countOutbox(t, f, "document.shared", doc.ID); n != 3 {
			t.Fatalf("document.shared outbox rows = %d, want 3", n)
		}
	})

	t.Run("one outsider aborts the entire batch with 422 naming only that id and writes nothing", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		_, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, []string{tn.outsider.ID, foreign.owner.ID, tn.bMember.ID}, DocumentLevelView)
		var ce CodedError
		if !errors.As(err, &ce) || ce.Code != "principal_not_in_organization" || ce.Status != http.StatusUnprocessableEntity {
			t.Fatalf("err = %v, want 422 principal_not_in_organization", err)
		}
		gotIDs, ok := ce.Fields["principal_ids"].([]string)
		if !ok || !reflect.DeepEqual(gotIDs, []string{foreign.owner.ID}) {
			t.Fatalf("fields.principal_ids = %#v, want [%s]", ce.Fields["principal_ids"], foreign.owner.ID)
		}
		var count int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_shares WHERE document_id = $1`, doc.ID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("document_shares rows = %d, want 0", count)
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 0 {
			t.Fatalf("audit rows = %d, want 0", n)
		}
		if n := countOutbox(t, f, "document.shared", doc.ID); n != 0 {
			t.Fatalf("outbox rows = %d, want 0", n)
		}

		// Deactivated org member is also rejected as principal_not_in_organization.
		_, err = f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, []string{tn.outsider.ID, tn.deact.ID}, DocumentLevelView)
		if !errors.As(err, &ce) || ce.Code != "principal_not_in_organization" {
			t.Fatalf("deactivated user: err = %v, want principal_not_in_organization", err)
		}
		if got, _ := ce.Fields["principal_ids"].([]string); !reflect.DeepEqual(got, []string{tn.deact.ID}) {
			t.Fatalf("deactivated fields.principal_ids = %#v, want [%s]", ce.Fields["principal_ids"], tn.deact.ID)
		}
	})

	t.Run("grants at comment", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		shares, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, []string{tn.outsider.ID, tn.bMember.ID}, DocumentLevelComment)
		if err != nil || len(shares) != 2 {
			t.Fatalf("ShareDocumentBatch at comment = %v, %v", shares, err)
		}
		for _, sh := range shares {
			if sh.Level != string(DocumentLevelComment) {
				t.Fatalf("share = %+v, want level comment", sh)
			}
			if got := level(t, f, H(sh.PrincipalID), doc); got != DocumentLevelComment {
				t.Fatalf("effective level for %s = %q, want comment", sh.PrincipalID, got)
			}
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 2 {
			t.Fatalf("document.shared audit rows = %d, want 2", n)
		}
	})

	t.Run("replaces different live level and treats same live level as no-op without audit", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		shSame, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView,
		})
		if err != nil {
			t.Fatal(err)
		}
		shPrevEdit, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: DocumentLevelEdit,
		})
		if err != nil {
			t.Fatal(err)
		}
		// Initial setup wrote 2 audit + 2 outbox rows.
		shares, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, []string{tn.outsider.ID, tn.bMember.ID, tn.member.ID}, DocumentLevelView)
		if err != nil {
			t.Fatalf("ShareDocumentBatch: %v", err)
		}
		if len(shares) != 3 {
			t.Fatalf("len(shares) = %d, want 3", len(shares))
		}
		if shares[0].ID != shSame.ID {
			t.Fatalf("same-level share ID changed: got %s, want %s", shares[0].ID, shSame.ID)
		}
		if shares[1].ID == shPrevEdit.ID || shares[1].Level != string(DocumentLevelView) {
			t.Fatalf("replaced share = %+v, want new ID at view", shares[1])
		}
		var live, total int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FILTER (WHERE revoked_at IS NULL), count(*) FROM document_shares
			 WHERE document_id = $1 AND principal_id = $2`, doc.ID, tn.bMember.ID,
		).Scan(&live, &total); err != nil {
			t.Fatal(err)
		}
		if live != 1 || total != 2 {
			t.Fatalf("bMember live=%d total=%d, want 1/2", live, total)
		}
		// 2 initial + 2 from batch (bMember replacement + member grant; outsider was no-op) = 4.
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 4 {
			t.Fatalf("document.shared audit rows = %d, want 4", n)
		}
		if n := countOutbox(t, f, "document.shared", doc.ID); n != 4 {
			t.Fatalf("document.shared outbox rows = %d, want 4", n)
		}
	})

	t.Run("deduplicates after trimming whitespace and preserves first-occurrence order", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		in := []string{"  " + tn.bMember.ID + " ", tn.outsider.ID, tn.bMember.ID, "\t" + tn.outsider.ID + "\n"}
		shares, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, in, DocumentLevelEdit)
		if err != nil {
			t.Fatalf("ShareDocumentBatch: %v", err)
		}
		if len(shares) != 2 || shares[0].PrincipalID != tn.bMember.ID || shares[1].PrincipalID != tn.outsider.ID {
			t.Fatalf("shares = %+v, want [bMember, outsider]", shares)
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 2 {
			t.Fatalf("audit rows = %d, want 2", n)
		}
	})

	t.Run("over 50 distinct principals succeed without a batch cap", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		ids55 := make([]string, 55)
		for i := range ids55 {
			u := f.user(t, "batch55", fmt.Sprintf("u%02d", i))
			f.orgMember(t, tn.orgID, u.ID, "member")
			ids55[i] = u.ID
		}
		shares, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, ids55, DocumentLevelView)
		if err != nil {
			t.Fatalf("55 distinct: %v", err)
		}
		if len(shares) != 55 {
			t.Fatalf("len(shares) = %d, want 55", len(shares))
		}
		for i, wantID := range ids55 {
			if shares[i].PrincipalID != wantID || shares[i].Level != string(DocumentLevelView) {
				t.Fatalf("shares[%d] = %+v, want %s at view", i, shares[i], wantID)
			}
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 55 {
			t.Fatalf("audit rows after 55 grant = %d, want 55", n)
		}
	})

	t.Run("not-manage gets 403, non-reader gets 404, Work Product owned gets 409", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit,
		}); err != nil {
			t.Fatal(err)
		}
		targets := []string{tn.bMember.ID}
		if _, err := f.svc.ShareDocumentBatch(f.ctx, H(tn.outsider.ID), doc.ID, targets, DocumentLevelView); !errors.Is(err, ErrForbidden) {
			t.Fatalf("editor sharing batch: %v, want ErrForbidden", err)
		}
		if _, err := f.svc.ShareDocumentBatch(f.ctx, H(tn.member.ID), doc.ID, targets, DocumentLevelView); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-reader sharing batch: %v, want ErrNotFound", err)
		}
		if _, err := f.svc.ShareDocumentBatch(f.ctx, H(foreign.owner.ID), doc.ID, targets, DocumentLevelView); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign tenant sharing batch: %v, want ErrNotFound", err)
		}
		if _, err := f.svc.ShareDocumentBatch(f.ctx, agentActor(tn.agent), doc.ID, targets, DocumentLevelView); !errors.Is(err, ErrNotFound) {
			t.Fatalf("agent sharing restricted doc batch: %v, want ErrNotFound", err)
		}

		owned := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, ownerID: "01WPBATCH00000000000000000"})
		f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.member.ID: DocumentLevelManage, tn.outsider.ID: DocumentLevelView})
		defer f.svc.SetOwnerLevelResolver(nil)
		for _, a := range []Actor{H(tn.member.ID), H(tn.outsider.ID)} {
			if _, err := f.svc.ShareDocumentBatch(f.ctx, a, owned.ID, []string{tn.creator.ID}, DocumentLevelView); !codedIs(err, "document_owned_by_work_product") {
				t.Fatalf("owned doc actor %s: %v, want document_owned_by_work_product", a.ID, err)
			}
		}
	})

	t.Run("blank or empty principal_ids and invalid level return 400 validation error", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		for _, tc := range []struct {
			name  string
			ids   []string
			level DocumentLevel
		}{
			{name: "nil slice", ids: nil, level: DocumentLevelView},
			{name: "empty slice", ids: []string{}, level: DocumentLevelView},
			{name: "blank element", ids: []string{tn.outsider.ID, "   "}, level: DocumentLevelView},
			{name: "invalid level", ids: []string{tn.outsider.ID}, level: "owner"},
			{name: "empty level", ids: []string{tn.outsider.ID}, level: ""},
			{name: "unknown id with invalid level fails level check before db", ids: []string{util.NewID()}, level: "bad"},
		} {
			var ve ValidationError
			if _, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, tc.ids, tc.level); !errors.As(err, &ve) {
				t.Fatalf("%s: err = %v, want ValidationError", tc.name, err)
			}
		}
	})

	t.Run("an invalid id list answers the ids error before the level error", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		for _, tc := range []struct {
			name string
			ids  []string
		}{
			{name: "nil slice", ids: nil},
			{name: "empty slice", ids: []string{}},
			{name: "blank element", ids: []string{tn.outsider.ID, "   "}},
		} {
			_, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, tc.ids, "bad")
			var ve ValidationError
			if !errors.As(err, &ve) || !strings.Contains(ve.Msg, "principal_ids") {
				t.Fatalf("%s with invalid level: err = %v, want the principal_ids error", tc.name, err)
			}
		}
	})
}

// TestShareDocumentBatch1000Recipients proves UNI-2012 S1c for a 1,000-person
// batch share:
//   - 1,000 distinct recipients succeed in one transaction across 200-row chunks.
//   - Existing live shares at another level are replaced while existing shares
//     at the same level are treated as a no-op.
//   - Notice policy: only grantees whose effective level strictly rose receive
//     notify_user_id on their document.shared outbox event (a recipient who
//     already held a higher level is not notified).
//   - Replaying the same 1,000-person batch is idempotent (0 new shares, 0 new
//     audit rows, 0 new outbox rows).
func TestShareDocumentBatch1000Recipients(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shbatch1000")
	mgr := Human(tn.aclOwner.ID)
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	const total = 1000
	ids := make([]string, total)
	emails := make([]string, total)
	names := make([]string, total)
	for i := range total {
		ids[i] = util.NewID()
		emails[i] = fmt.Sprintf("batch1000-%04d-%s@example.com", i, ids[i])
		names[i] = fmt.Sprintf("Batch1000 %04d", i)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO users (id, email, display_name, password_hash, email_verified_at)
		SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), 'x', now()
	`, ids, emails, names); err != nil {
		t.Fatalf("seed 1000 users: %v", err)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO organization_members (organization_id, user_id, role)
		SELECT $1, unnest($2::text[]), 'member'
	`, tn.orgID, ids); err != nil {
		t.Fatalf("seed 1000 org members: %v", err)
	}

	// Pre-seed:
	//   - ids[0] already holds comment (same as the batch level -> no-op, not notified).
	//   - ids[1] already holds edit (higher than comment -> replaced by comment on
	//     explicit ShareDocumentBatch, so effective level drops edit->comment -> not notified).
	//   - ids[2] already holds view (lower than comment -> replaced by comment, effective level rises -> notified).
	if _, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: ids[0], Level: DocumentLevelComment,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: ids[1], Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: ids[2], Level: DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	auditsBefore := countAudit(t, f, audit.ActionDocumentShared, doc.ID)
	outboxBefore := countOutbox(t, f, "document.shared", doc.ID)

	// The bound is a hang guard; the timing is logged, not asserted.
	ctx, cancel := context.WithTimeout(f.ctx, 2*time.Minute)
	defer cancel()
	started := time.Now()
	shares, err := f.svc.ShareDocumentBatch(ctx, mgr, doc.ID, ids, DocumentLevelComment)
	elapsed := time.Since(started)
	if err != nil {
		t.Fatalf("ShareDocumentBatch(1000): %v", err)
	}
	if len(shares) != total {
		t.Fatalf("len(shares) = %d, want %d", len(shares), total)
	}

	var liveShares int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM document_shares WHERE document_id = $1 AND revoked_at IS NULL`, doc.ID,
	).Scan(&liveShares); err != nil {
		t.Fatal(err)
	}
	if liveShares != total {
		t.Fatalf("live document_shares = %d, want %d", liveShares, total)
	}

	// 999 shares changed (ids[0] was already at comment); 998 recipients rose in effective level
	// (ids[0] stayed at comment; ids[1] dropped from edit to comment).
	auditsDelta := countAudit(t, f, audit.ActionDocumentShared, doc.ID) - auditsBefore
	outboxDelta := countOutbox(t, f, "document.shared", doc.ID) - outboxBefore
	if auditsDelta != total-1 {
		t.Fatalf("audit delta = %d, want %d (ids[0] unchanged)", auditsDelta, total-1)
	}
	if outboxDelta != total-1 {
		t.Fatalf("outbox delta = %d, want %d", outboxDelta, total-1)
	}

	rows, err := f.pool.Query(f.ctx,
		`SELECT payload FROM outbox_events WHERE topic = 'document.shared' AND payload LIKE '%' || $1 || '%' ORDER BY created_at ASC, id ASC OFFSET $2`,
		doc.ID, outboxBefore,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	notifiedUsers := map[string]bool{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var p map[string]string
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatal(err)
		}
		if uid := p["notify_user_id"]; uid != "" {
			notifiedUsers[uid] = true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(notifiedUsers) != total-2 {
		t.Fatalf("notified users = %d, want %d (ids[0] unchanged, ids[1] downgraded)", len(notifiedUsers), total-2)
	}
	if notifiedUsers[ids[0]] || notifiedUsers[ids[1]] {
		t.Fatalf("ids[0]=%v ids[1]=%v should not carry notify_user_id", notifiedUsers[ids[0]], notifiedUsers[ids[1]])
	}
	if !notifiedUsers[ids[2]] {
		t.Fatal("ids[2] (raised view->comment) must carry notify_user_id")
	}

	// Idempotent replay: calling ShareDocumentBatch again with the same 1,000 ids and level writes nothing.
	replayStart := time.Now()
	replayed, err := f.svc.ShareDocumentBatch(ctx, mgr, doc.ID, ids, DocumentLevelComment)
	replayElapsed := time.Since(replayStart)
	if err != nil {
		t.Fatalf("ShareDocumentBatch(1000) replay: %v", err)
	}
	if len(replayed) != total {
		t.Fatalf("replay len(shares) = %d, want %d", len(replayed), total)
	}
	if countAudit(t, f, audit.ActionDocumentShared, doc.ID) != auditsBefore+auditsDelta {
		t.Fatal("idempotent replay wrote additional audit rows")
	}
	if countOutbox(t, f, "document.shared", doc.ID) != outboxBefore+outboxDelta {
		t.Fatal("idempotent replay wrote additional outbox rows")
	}
	t.Logf("ShareDocumentBatch(1000): grant=%s replay=%s live_shares=%d audit_delta=%d outbox_delta=%d notified=%d",
		elapsed, replayElapsed, liveShares, auditsDelta, outboxDelta, len(notifiedUsers))
}
