package service

// DOC-06 (UNI-2084) per-document owner transfer, addendum §2.1, §2.3, §4.2:
// A01 (the owner moves, the previous owner keeps a share, one audit row and
// one outbox row), A02 (the recipient and caller refusals) and A03 (the
// AdminScope self-transfer guard). The notification half of A01 is in
// notification/document_owner_transferred_test.go.

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ownerTransferAudit is one document.owner_transferred audit row, decoded.
type ownerTransferAudit struct {
	ActorID  string
	Changes  map[string]any
	Metadata map[string]any
}

func ownerTransferAudits(t *testing.T, f *docPermFixture, documentID string) []ownerTransferAudit {
	t.Helper()
	rs, err := f.pool.Query(f.ctx,
		`SELECT actor_id, changes::text, metadata::text FROM audit_events
		  WHERE action = $1 AND resource_id = $2 ORDER BY occurred_at, id`,
		audit.ActionDocumentOwnerTransferred, documentID)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var out []ownerTransferAudit
	for rs.Next() {
		var a ownerTransferAudit
		var changes, meta string
		if err := rs.Scan(&a.ActorID, &changes, &meta); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(changes), &a.Changes); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(meta), &a.Metadata); err != nil {
			t.Fatal(err)
		}
		out = append(out, a)
	}
	if err := rs.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// ownerTransferPayloads returns the payload of every document.owner_transferred
// outbox row of one document.
func ownerTransferPayloads(t *testing.T, f *docPermFixture, documentID string) []map[string]any {
	t.Helper()
	rs, err := f.pool.Query(f.ctx,
		`SELECT payload::text FROM outbox_events WHERE topic = 'document.owner_transferred' AND payload::jsonb->>'document_id' = $1`,
		documentID)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var out []map[string]any
	for rs.Next() {
		var raw string
		if err := rs.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		p := map[string]any{}
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatal(err)
		}
		out = append(out, p)
	}
	if err := rs.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// userShares are the live user shares of one person on a document.
func userShares(t *testing.T, f *docPermFixture, d db.Document, userID string) []db.DocumentShare {
	t.Helper()
	shares, err := f.q.ListDocumentShares(f.ctx, db.ListDocumentSharesParams{
		OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID, DocumentID: d.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	var out []db.DocumentShare
	for _, sh := range shares {
		if sh.PrincipalType == DocumentPrincipalUser && sh.PrincipalID == userID {
			out = append(out, sh)
		}
	}
	return out
}

func reloadDoc(t *testing.T, f *docPermFixture, id string) db.Document {
	t.Helper()
	d, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// TestDocumentOwnerTransferMovesTheOwner is DOC6-A01: the ACL owner hands a
// restricted document to a workspace member. acl_owner_id and the
// updated_by pair change, revision does not; the new owner manages, the
// previous one keeps an edit share written in the same transaction; one
// audit row carries the before/after and the metadata keys; one ids-only
// outbox row goes out.
func TestDocumentOwnerTransferMovesTheOwner(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ot01")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	before := reloadDoc(t, f, d.ID)

	got, err := f.svc.TransferOwner(f.ctx, Human(tn.aclOwner.ID), d.ID, DocumentOwnerTransferInput{UserID: tn.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got.DocumentID != d.ID || got.ACLOwnerID != tn.member.ID || got.PreviousOwnerID != tn.aclOwner.ID || got.PreviousOwnerShareID == "" {
		t.Fatalf("result = %+v", got)
	}

	after := reloadDoc(t, f, d.ID)
	if !after.AclOwnerID.Valid || after.AclOwnerID.String != tn.member.ID {
		t.Fatalf("acl_owner_id = %+v, want the recipient", after.AclOwnerID)
	}
	if after.UpdatedBy != tn.aclOwner.ID || after.UpdatedByKind != "human" {
		t.Fatalf("updated_by = %q/%q, want the caller as human", after.UpdatedBy, after.UpdatedByKind)
	}
	if after.Revision != before.Revision {
		t.Fatalf("revision %d -> %d, an owner change must not bump it", before.Revision, after.Revision)
	}
	if lvl := level(t, f, Human(tn.member.ID), after); lvl != DocumentLevelManage {
		t.Fatalf("new owner level = %q, want manage", lvl)
	}
	if lvl := level(t, f, Human(tn.aclOwner.ID), after); lvl != DocumentLevelEdit {
		t.Fatalf("previous owner level = %q, want edit (the default)", lvl)
	}
	shares := userShares(t, f, after, tn.aclOwner.ID)
	if len(shares) != 1 || shares[0].Level != "edit" || shares[0].ID != got.PreviousOwnerShareID {
		t.Fatalf("previous owner shares = %+v, want one edit share %s", shares, got.PreviousOwnerShareID)
	}
	// The share is the share path's own: its audit row and event.
	if n := countOutbox(t, f, "document.shared", d.ID); n != 1 {
		t.Fatalf("document.shared outbox rows = %d, want 1", n)
	}

	audits := ownerTransferAudits(t, f, d.ID)
	if len(audits) != 1 {
		t.Fatalf("audit rows = %d, want 1", len(audits))
	}
	a := audits[0]
	if a.ActorID != tn.aclOwner.ID {
		t.Fatalf("audit actor = %q", a.ActorID)
	}
	ch, _ := a.Changes["acl_owner_id"].(map[string]any)
	if ch == nil || ch["from"] != tn.aclOwner.ID || ch["to"] != tn.member.ID {
		t.Fatalf("audit changes = %v, want acl_owner_id before -> after", a.Changes)
	}
	if a.Metadata["from_user_id"] != tn.aclOwner.ID || a.Metadata["previous_owner_level"] != "edit" {
		t.Fatalf("audit metadata = %v", a.Metadata)
	}
	if _, has := a.Metadata["bulk_id"]; has {
		t.Fatalf("a single transfer carries no bulk_id: %v", a.Metadata)
	}

	payloads := ownerTransferPayloads(t, f, d.ID)
	if len(payloads) != 1 {
		t.Fatalf("outbox rows = %d, want 1", len(payloads))
	}
	if len(payloads[0]) != 2 || payloads[0]["document_id"] != d.ID || payloads[0]["workspace_id"] != tn.wsA {
		t.Fatalf("payload = %v, want document_id + workspace_id only", payloads[0])
	}
}

// TestDocumentOwnerTransferPreviousOwnerLevel covers the previous owner's
// share: each level lands as asked, none writes nothing, an existing higher
// share is never lowered (and is the share the answer names), a lower one is
// raised, and a deactivated previous owner is skipped without an error.
func TestDocumentOwnerTransferPreviousOwnerLevel(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ot02")
	owner := Human(tn.aclOwner.ID)
	restricted := func() db.Document {
		return f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	}

	for _, lvl := range []string{"comment", "view"} {
		d := restricted()
		got, err := f.svc.TransferOwner(f.ctx, owner, d.ID, DocumentOwnerTransferInput{UserID: tn.member.ID, PreviousOwnerLevel: lvl})
		if err != nil {
			t.Fatal(err)
		}
		shares := userShares(t, f, d, tn.aclOwner.ID)
		if len(shares) != 1 || shares[0].Level != lvl || shares[0].ID != got.PreviousOwnerShareID {
			t.Fatalf("%s: shares = %+v, result %+v", lvl, shares, got)
		}
		if a := ownerTransferAudits(t, f, d.ID); len(a) != 1 || a[0].Metadata["previous_owner_level"] != lvl {
			t.Fatalf("%s: audit = %+v", lvl, a)
		}
	}

	t.Run("none writes no share", func(t *testing.T) {
		d := restricted()
		got, err := f.svc.TransferOwner(f.ctx, owner, d.ID, DocumentOwnerTransferInput{UserID: tn.member.ID, PreviousOwnerLevel: "none"})
		if err != nil {
			t.Fatal(err)
		}
		if got.PreviousOwnerShareID != "" || got.PreviousOwnerID != tn.aclOwner.ID {
			t.Fatalf("result = %+v, want no share id", got)
		}
		if s := userShares(t, f, d, tn.aclOwner.ID); len(s) != 0 {
			t.Fatalf("shares = %+v, want none", s)
		}
		if lvl := level(t, f, owner, d); lvl != DocumentLevelNone {
			t.Fatalf("previous owner level = %q, want none", lvl)
		}
		if n := countOutbox(t, f, "document.shared", d.ID); n != 0 {
			t.Fatalf("document.shared rows = %d, want 0", n)
		}
		if a := ownerTransferAudits(t, f, d.ID); len(a) != 1 || a[0].Metadata["previous_owner_level"] != "none" {
			t.Fatalf("audit = %+v", a)
		}
	})

	t.Run("a higher share is kept", func(t *testing.T) {
		d := restricted()
		existing := f.share(t, d, DocumentPrincipalUser, tn.aclOwner.ID, DocumentLevelManage, tn.aclOwner.ID)
		got, err := f.svc.TransferOwner(f.ctx, owner, d.ID, DocumentOwnerTransferInput{UserID: tn.member.ID})
		if err != nil {
			t.Fatal(err)
		}
		shares := userShares(t, f, d, tn.aclOwner.ID)
		if len(shares) != 1 || shares[0].ID != existing.ID || shares[0].Level != "manage" {
			t.Fatalf("shares = %+v, want the manage share untouched", shares)
		}
		if got.PreviousOwnerShareID != existing.ID {
			t.Fatalf("previous_owner_share_id = %q, want the kept share %q", got.PreviousOwnerShareID, existing.ID)
		}
		if n := countOutbox(t, f, "document.shared", d.ID); n != 0 {
			t.Fatalf("document.shared rows = %d, want 0", n)
		}
	})

	t.Run("a lower share is raised", func(t *testing.T) {
		d := restricted()
		existing := f.share(t, d, DocumentPrincipalUser, tn.aclOwner.ID, DocumentLevelView, tn.aclOwner.ID)
		got, err := f.svc.TransferOwner(f.ctx, owner, d.ID, DocumentOwnerTransferInput{UserID: tn.member.ID})
		if err != nil {
			t.Fatal(err)
		}
		shares := userShares(t, f, d, tn.aclOwner.ID)
		if len(shares) != 1 || shares[0].Level != "edit" || shares[0].ID == existing.ID || shares[0].ID != got.PreviousOwnerShareID {
			t.Fatalf("shares = %+v, result %+v, want a new edit share", shares, got)
		}
	})

	t.Run("a deactivated previous owner is skipped", func(t *testing.T) {
		d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.deact.ID, createdBy: tn.deact.ID})
		got, err := f.svc.TransferOwner(f.ctx, Human(tn.owner.ID), d.ID, DocumentOwnerTransferInput{UserID: tn.member.ID})
		if err != nil {
			t.Fatal(err)
		}
		if got.ACLOwnerID != tn.member.ID || got.PreviousOwnerID != tn.deact.ID || got.PreviousOwnerShareID != "" {
			t.Fatalf("result = %+v", got)
		}
		if s := userShares(t, f, d, tn.deact.ID); len(s) != 0 {
			t.Fatalf("shares of the deactivated owner = %+v, want none", s)
		}
		if a := ownerTransferAudits(t, f, d.ID); len(a) != 1 || a[0].Metadata["from_user_id"] != tn.deact.ID {
			t.Fatalf("audit = %+v", a)
		}
	})

	t.Run("an unknown level is invalid", func(t *testing.T) {
		d := restricted()
		_, err := f.svc.TransferOwner(f.ctx, owner, d.ID, DocumentOwnerTransferInput{UserID: tn.member.ID, PreviousOwnerLevel: "manage"})
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("err = %v, want a validation error", err)
		}
		if after := reloadDoc(t, f, d.ID); after.AclOwnerID.String != tn.aclOwner.ID {
			t.Fatalf("owner changed on a refused call: %+v", after.AclOwnerID)
		}
	})
}

// TestDocumentOwnerTransferRefusals is DOC6-A02: a recipient who is not an
// effective member of the document's workspace (another workspace only, no
// workspace, deactivated, an agent, an unknown id) is 422
// owner_target_not_member; a reader below manage is forbidden; a Work Product
// document is 409; a caller who cannot see the document is not found. None of
// them writes anything.
func TestDocumentOwnerTransferRefusals(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ot03")
	owner := Human(tn.aclOwner.ID)
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	for name, uid := range map[string]string{
		"other workspace": tn.bMember.ID,
		"no workspace":    tn.outsider.ID,
		"deactivated":     tn.deact.ID,
		"agent":           tn.agent,
		"unknown":         "01J8X4NOSUCHUSER0N1P2Q3R4S5",
		"empty":           "",
	} {
		_, err := f.svc.TransferOwner(f.ctx, owner, d.ID, DocumentOwnerTransferInput{UserID: uid})
		if name == "empty" {
			var ve ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("%s: err = %v, want a validation error", name, err)
			}
			continue
		}
		wantCoded(t, err, "owner_target_not_member")
	}

	// A workspace member reads the workspace document at edit: forbidden.
	_, err := f.svc.TransferOwner(f.ctx, Human(tn.member.ID), d.ID, DocumentOwnerTransferInput{UserID: tn.creator.ID})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("edit-level caller: err = %v, want forbidden", err)
	}
	// An organization member outside the workspace does not see a restricted
	// document at all.
	r := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	_, err = f.svc.TransferOwner(f.ctx, Human(tn.outsider.ID), r.ID, DocumentOwnerTransferInput{UserID: tn.member.ID})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider: err = %v, want not found", err)
	}
	_, err = f.svc.TransferOwner(f.ctx, owner, "01J8X4NOSUCHDOC0N1P2Q3R4S5T", DocumentOwnerTransferInput{UserID: tn.member.ID})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown document: err = %v, want not found", err)
	}

	// The owner resolver gives the organization owner manage on the Work
	// Product document, so the refusal is the ownership one, not a 404.
	f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.owner.ID: DocumentLevelManage})
	defer f.svc.SetOwnerLevelResolver(nil)
	wp := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, ownerID: "01J8X4WP0N1P2Q3R4S5T6U7V8W"})
	_, err = f.svc.TransferOwner(f.ctx, Human(tn.owner.ID), wp.ID, DocumentOwnerTransferInput{UserID: tn.member.ID})
	wantCoded(t, err, "document_owned_by_work_product")

	for _, id := range []string{d.ID, r.ID, wp.ID} {
		if a := ownerTransferAudits(t, f, id); len(a) != 0 {
			t.Fatalf("refused transfer audited: %+v", a)
		}
		if p := ownerTransferPayloads(t, f, id); len(p) != 0 {
			t.Fatalf("refused transfer emitted: %+v", p)
		}
		if got := reloadDoc(t, f, id); got.AclOwnerID.String != tn.aclOwner.ID {
			t.Fatalf("refused transfer moved the owner: %+v", got.AclOwnerID)
		}
	}
}

// TestDocumentOwnerTransferAdminScope is DOC6-A03: a workspace admin who only
// holds AdminScope on a restricted document may hand it to someone else but
// not take it themselves (break_glass_required); an archived document is
// still transferable by an administrator.
func TestDocumentOwnerTransferAdminScope(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ot04")
	admin := Human(tn.wsAdmin.ID)
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	_, err := f.svc.TransferOwner(f.ctx, admin, d.ID, DocumentOwnerTransferInput{UserID: tn.wsAdmin.ID})
	wantCoded(t, err, "break_glass_required")
	if got := reloadDoc(t, f, d.ID); got.AclOwnerID.String != tn.aclOwner.ID {
		t.Fatalf("self-transfer moved the owner: %+v", got.AclOwnerID)
	}

	got, err := f.svc.TransferOwner(f.ctx, admin, d.ID, DocumentOwnerTransferInput{UserID: tn.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got.ACLOwnerID != tn.member.ID || got.PreviousOwnerID != tn.aclOwner.ID || got.PreviousOwnerShareID == "" {
		t.Fatalf("result = %+v", got)
	}
	// The admin still reads nothing.
	if lvl := level(t, f, admin, reloadDoc(t, f, d.ID)); lvl != DocumentLevelNone {
		t.Fatalf("admin level after the transfer = %q, want none", lvl)
	}

	archived := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.exec(t, `UPDATE documents SET archived_at = now() WHERE id = $1`, archived.ID)
	if _, err := f.svc.TransferOwner(f.ctx, admin, archived.ID, DocumentOwnerTransferInput{UserID: tn.member.ID, PreviousOwnerLevel: "none"}); err != nil {
		t.Fatalf("archived transfer: %v", err)
	}
	if got := reloadDoc(t, f, archived.ID); got.AclOwnerID.String != tn.member.ID {
		t.Fatalf("archived owner = %+v", got.AclOwnerID)
	}
}

// TestDocumentOwnerTransferSameOwner: handing a document to its current owner
// answers 200 with the owner named and writes nothing - no row change, no
// share, no audit, no event.
func TestDocumentOwnerTransferSameOwner(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ot05")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.creator.ID})
	before := reloadDoc(t, f, d.ID)

	got, err := f.svc.TransferOwner(f.ctx, Human(tn.owner.ID), d.ID, DocumentOwnerTransferInput{UserID: tn.aclOwner.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got != (DocumentOwnerTransfer{DocumentID: d.ID, ACLOwnerID: tn.aclOwner.ID}) {
		t.Fatalf("result = %+v, want the owner named and nothing else", got)
	}
	after := reloadDoc(t, f, d.ID)
	if after.UpdatedBy != before.UpdatedBy || !after.UpdatedAt.Time.Equal(before.UpdatedAt.Time) {
		t.Fatalf("row touched: %q %v -> %q %v", before.UpdatedBy, before.UpdatedAt.Time, after.UpdatedBy, after.UpdatedAt.Time)
	}
	if a := ownerTransferAudits(t, f, d.ID); len(a) != 0 {
		t.Fatalf("audit rows = %d, want 0", len(a))
	}
	if p := ownerTransferPayloads(t, f, d.ID); len(p) != 0 {
		t.Fatalf("outbox rows = %d, want 0", len(p))
	}
	if s := userShares(t, f, d, tn.aclOwner.ID); len(s) != 0 {
		t.Fatalf("shares = %+v, want none", s)
	}
}

// TestDocumentOwnerTransferConcurrent: two administrators transfer the same
// document at once. The row lock serializes them: both succeed, the second
// sees the first one's owner as its previous owner, the final owner is one of
// the two recipients, and exactly two audit rows exist.
func TestDocumentOwnerTransferConcurrent(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ot06")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	type call struct {
		actor Actor
		to    string
	}
	calls := []call{{Human(tn.owner.ID), tn.member.ID}, {Human(tn.wsAdmin.ID), tn.creator.ID}}
	results := make([]DocumentOwnerTransfer, len(calls))
	errs := make([]error, len(calls))
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i, c := range calls {
		wg.Add(1)
		go func(i int, c call) {
			defer wg.Done()
			<-start
			results[i], errs[i] = f.svc.TransferOwner(f.ctx, c.actor, d.ID, DocumentOwnerTransferInput{UserID: c.to, PreviousOwnerLevel: "none"})
		}(i, c)
	}
	close(start)
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	final := reloadDoc(t, f, d.ID).AclOwnerID.String
	if final != tn.member.ID && final != tn.creator.ID {
		t.Fatalf("final owner = %q, want one of the recipients", final)
	}
	audits := ownerTransferAudits(t, f, d.ID)
	if len(audits) != 2 {
		t.Fatalf("audit rows = %d, want 2", len(audits))
	}
	// Serialized: one of the two saw the original owner, the other saw the
	// first recipient.
	prev := map[string]bool{results[0].PreviousOwnerID: true, results[1].PreviousOwnerID: true}
	if !prev[tn.aclOwner.ID] || len(prev) != 2 {
		t.Fatalf("previous owners = %v, want the original owner and the first recipient", prev)
	}
	if p := ownerTransferPayloads(t, f, d.ID); len(p) != 2 {
		t.Fatalf("outbox rows = %d, want 2", len(p))
	}
}
