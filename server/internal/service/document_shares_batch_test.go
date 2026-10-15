package service

import (
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
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

	t.Run("51 distinct principals rejected with 422 share_batch_too_large while 50 distinct succeed", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		ids51 := make([]string, 51)
		for i := range ids51 {
			u := f.user(t, "batch51", fmt.Sprintf("u%02d", i))
			f.orgMember(t, tn.orgID, u.ID, "member")
			ids51[i] = u.ID
		}
		_, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, ids51, DocumentLevelView)
		var ce CodedError
		if !errors.As(err, &ce) || ce.Code != "share_batch_too_large" || ce.Status != http.StatusUnprocessableEntity {
			t.Fatalf("51 distinct: err = %v, want 422 share_batch_too_large", err)
		}
		if ce.Fields["max"] != maxDocumentShareBatch {
			t.Fatalf("fields.max = %v, want %d", ce.Fields["max"], maxDocumentShareBatch)
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 0 {
			t.Fatalf("audit rows after 51 reject = %d, want 0", n)
		}

		shares, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, ids51[:50], DocumentLevelView)
		if err != nil {
			t.Fatalf("50 distinct: %v", err)
		}
		if len(shares) != 50 {
			t.Fatalf("len(shares) = %d, want 50", len(shares))
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
}
