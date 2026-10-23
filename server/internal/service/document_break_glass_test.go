package service

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

// breakGlassAudit reads the audit rows of one break-glass action on a document.
func breakGlassAudit(t *testing.T, f *docPermFixture, action, documentID string) []map[string]any {
	t.Helper()
	rows, err := f.pool.Query(f.ctx,
		`SELECT actor_id, actor_kind, workspace_id, metadata FROM audit_events WHERE action = $1 AND resource_id = $2 ORDER BY occurred_at, id`,
		action, documentID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var actorID, actorKind, workspaceID, meta string
		if err := rows.Scan(&actorID, &actorKind, &workspaceID, &meta); err != nil {
			t.Fatal(err)
		}
		m := map[string]any{}
		if err := json.Unmarshal([]byte(meta), &m); err != nil {
			t.Fatal(err)
		}
		m["_actor_id"], m["_actor_kind"], m["_workspace_id"] = actorID, actorKind, workspaceID
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestBreakGlassGrantAuditNotifyExpire holds DOC-05 card (a): an AdminScope
// caller opens 24 hours of view access with a reason of 10-500 runes, once
// (a second call returns the same grant and writes nothing), the grant leaves
// one audit row and one ids-only outbox row, reads then run at view through
// break_glass, and expiry or revoke cut them at once.
func TestBreakGlassGrantAuditNotifyExpire(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "bg1")
	admin := Human(tn.wsAdmin.ID)
	docR := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	docW := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	const reason = "Kiểm tra hợp đồng theo yêu cầu của kiểm toán"

	t.Run("gates", func(t *testing.T) {
		// A stranger never sees the document; a reader below admin is forbidden.
		if _, _, err := f.svc.GrantDocumentBreakGlass(f.ctx, Human(tn.member.ID), docR.ID, reason); !errors.Is(err, ErrNotFound) {
			t.Fatalf("stranger grant = %v, want ErrNotFound", err)
		}
		f.share(t, docR, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
		if _, _, err := f.svc.GrantDocumentBreakGlass(f.ctx, Human(tn.outsider.ID), docR.ID, reason); !errors.Is(err, ErrForbidden) {
			t.Fatalf("reader grant = %v, want ErrForbidden", err)
		}
		// The ACL owner needs none (manage already); a workspace-visible
		// document has no AdminScope either.
		if _, _, err := f.svc.GrantDocumentBreakGlass(f.ctx, Human(tn.aclOwner.ID), docR.ID, reason); !errors.Is(err, ErrForbidden) {
			t.Fatalf("ACL owner grant = %v, want ErrForbidden", err)
		}
		if _, _, err := f.svc.GrantDocumentBreakGlass(f.ctx, admin, docW.ID, reason); !errors.Is(err, ErrForbidden) {
			t.Fatalf("admin grant on a workspace document = %v, want ErrForbidden", err)
		}
		// An agent never reaches a restricted document.
		if _, _, err := f.svc.GrantDocumentBreakGlass(f.ctx, Actor{Kind: audit.KindAgent, ID: tn.agent}, docR.ID, reason); !errors.Is(err, ErrNotFound) {
			t.Fatalf("agent grant = %v, want ErrNotFound", err)
		}
		// A work-product document is the work product's to decide.
		docO := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, ownerID: "01WPBG0000000000000000000"})
		f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.wsAdmin.ID: DocumentLevelView})
		defer f.svc.SetOwnerLevelResolver(nil)
		if _, _, err := f.svc.GrantDocumentBreakGlass(f.ctx, admin, docO.ID, reason); !codedIs(err, "document_owned_by_work_product") {
			t.Fatalf("owned grant = %v, want document_owned_by_work_product", err)
		}
		if n := len(breakGlassAudit(t, f, audit.ActionDocumentBreakGlassGranted, docR.ID)); n != 0 {
			t.Fatalf("refused grants wrote %d audit rows", n)
		}
	})

	t.Run("reason bounds", func(t *testing.T) {
		long := strings.Repeat("ạ", breakGlassReasonMax+1) // runes, not bytes
		for name, reason := range map[string]string{
			"empty": "", "spaces only": strings.Repeat(" ", 20), "nine runes": "123456789", "padded nine": "   123456789   ", "501 runes": long,
		} {
			_, _, err := f.svc.GrantDocumentBreakGlass(f.ctx, admin, docR.ID, reason)
			var ce CodedError
			if !errors.As(err, &ce) || ce.Code != "break_glass_reason_invalid" || ce.Status != 422 {
				t.Fatalf("%s: err = %v, want 422 break_glass_reason_invalid", name, err)
			}
			if ce.Fields["min"] != breakGlassReasonMin || ce.Fields["max"] != breakGlassReasonMax {
				t.Fatalf("%s: fields = %v, want min/max", name, ce.Fields)
			}
		}
		// The length field counts runes after TrimSpace.
		_, _, err := f.svc.GrantDocumentBreakGlass(f.ctx, admin, docR.ID, "  1234  ")
		var ce CodedError
		if !errors.As(err, &ce) || ce.Fields["length"] != 4 {
			t.Fatalf("length field = %v, want 4", err)
		}
		if n := len(breakGlassAudit(t, f, audit.ActionDocumentBreakGlassGranted, docR.ID)); n != 0 {
			t.Fatalf("invalid reasons wrote %d audit rows", n)
		}
		// The bounds themselves pass, counted in runes: 10 and 500, each on a
		// document of its own so docR's audit counts stay exact.
		for i, ok := range []string{"1234567890", strings.Repeat("ạ", breakGlassReasonMax)} {
			d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
			if _, created, err := f.svc.GrantDocumentBreakGlass(f.ctx, admin, d.ID, ok); err != nil || !created {
				t.Fatalf("boundary %d: created=%v, %v", i, created, err)
			}
		}
	})

	// Before any grant: administering works, reading does not.
	if _, err := f.svc.GetDocument(f.ctx, admin, docR.ID); !errors.Is(err, ErrDocumentRestricted) {
		t.Fatalf("GetDocument before the grant = %v, want ErrDocumentRestricted", err)
	}

	first, created, err := f.svc.GrantDocumentBreakGlass(f.ctx, admin, docR.ID, "  "+reason+"  ")
	if err != nil || !created {
		t.Fatalf("first grant = %+v, created=%v, %v", first, created, err)
	}
	g := first.Grant
	if g.Level != string(DocumentLevelView) || g.Reason != reason || g.ActorID != tn.wsAdmin.ID || g.ActorKind != string(audit.KindHuman) ||
		g.DocumentID != docR.ID || g.OrganizationID != docR.OrganizationID || g.WorkspaceID != docR.WorkspaceID {
		t.Fatalf("grant row = %+v", g)
	}
	if d := g.ExpiresAt.Time.Sub(g.GrantedAt.Time); d < 23*time.Hour+55*time.Minute || d > 24*time.Hour+5*time.Minute {
		t.Fatalf("grant lasts %v, want 24h", d)
	}
	if first.ActorName == "" {
		t.Fatal("grant view carries no actor name")
	}

	t.Run("idempotent", func(t *testing.T) {
		again, created, err := f.svc.GrantDocumentBreakGlass(f.ctx, admin, docR.ID, "một lý do khác nhưng đủ dài")
		if err != nil || created || again.Grant.ID != g.ID || again.Grant.Reason != reason {
			t.Fatalf("second grant = %+v, created=%v, %v; want the first grant back", again, created, err)
		}
		if n := countAudit(t, f, audit.ActionDocumentBreakGlassGranted, docR.ID); n != 1 {
			t.Fatalf("granted audit rows = %d, want 1", n)
		}
		if n := countOutbox(t, f, "document.break_glass_granted", docR.ID); n != 1 {
			t.Fatalf("granted outbox rows = %d, want 1", n)
		}
	})

	t.Run("audit and outbox rows", func(t *testing.T) {
		rows := breakGlassAudit(t, f, audit.ActionDocumentBreakGlassGranted, docR.ID)
		if len(rows) != 1 {
			t.Fatalf("audit rows = %d, want 1", len(rows))
		}
		m := rows[0]
		if m["_actor_id"] != tn.wsAdmin.ID || m["_actor_kind"] != "human" || m["_workspace_id"] != docR.WorkspaceID ||
			m["grant_id"] != g.ID || m["level"] != "view" || m["reason"] != reason || m["expires_at"] == "" {
			t.Fatalf("audit row = %v", m)
		}
		var payload string
		if err := f.pool.QueryRow(f.ctx,
			`SELECT payload FROM outbox_events WHERE topic = 'document.break_glass_granted' AND payload::jsonb->>'document_id' = $1`, docR.ID,
		).Scan(&payload); err != nil {
			t.Fatal(err)
		}
		p := map[string]string{}
		if err := json.Unmarshal([]byte(payload), &p); err != nil {
			t.Fatal(err)
		}
		if len(p) != 3 || p["document_id"] != docR.ID || p["workspace_id"] != docR.WorkspaceID || p["grant_id"] != g.ID {
			t.Fatalf("outbox payload = %v, want ids only", p)
		}
	})

	t.Run("reads run at view through break_glass", func(t *testing.T) {
		view, err := f.svc.GetDocument(f.ctx, admin, docR.ID)
		if err != nil {
			t.Fatalf("GetDocument inside the grant: %v", err)
		}
		if view.Access.Level != DocumentLevelView || view.Access.Via != DocumentViaBreakGlass || !view.Access.AdminScope {
			t.Fatalf("access = %+v, want view via break_glass + AdminScope", view.Access)
		}
		if view.BreakGlassExpiresAt.IsZero() || !view.BreakGlassExpiresAt.Equal(g.ExpiresAt.Time) {
			t.Fatalf("view expiry = %v, want the grant's %v", view.BreakGlassExpiresAt, g.ExpiresAt.Time)
		}
		// View only: no comment, no edit.
		if _, _, err := f.svc.authorizeDocumentQ(f.ctx, f.q, admin, docR.ID, DocumentLevelComment); !errors.Is(err, ErrForbidden) {
			t.Fatalf("comment-level gate inside the grant = %v, want ErrForbidden", err)
		}
		var via string
		if err := f.pool.QueryRow(f.ctx,
			`SELECT via FROM document_access_logs WHERE document_id = $1 AND actor_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
			docR.ID, tn.wsAdmin.ID).Scan(&via); err != nil {
			t.Fatal(err)
		}
		if via != "break_glass" {
			t.Fatalf("access log via = %q, want break_glass", via)
		}
		// Someone else is unaffected: another admin still cannot read.
		if _, err := f.svc.GetDocument(f.ctx, Human(tn.owner.ID), docR.ID); !errors.Is(err, ErrDocumentRestricted) {
			t.Fatalf("another admin GetDocument = %v, want ErrDocumentRestricted", err)
		}
	})

	t.Run("admin summary and access list", func(t *testing.T) {
		sum, err := f.svc.DocumentAdminSummary(f.ctx, admin, docR.ID)
		if err != nil {
			t.Fatal(err)
		}
		if sum.Document.ID != docR.ID || !sum.My.AdminScope || sum.My.Via != DocumentViaBreakGlass ||
			sum.ACLOwner == nil || sum.ACLOwner.UserID != tn.aclOwner.ID || sum.MyGrant == nil || sum.MyGrant.Grant.ID != g.ID {
			t.Fatalf("admin summary = %+v", sum)
		}
		// A plain reader is forbidden, a stranger not found.
		if _, err := f.svc.DocumentAdminSummary(f.ctx, Human(tn.outsider.ID), docR.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("reader admin summary = %v, want ErrForbidden", err)
		}
		if _, err := f.svc.DocumentAdminSummary(f.ctx, Human(tn.member.ID), docR.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("stranger admin summary = %v, want ErrNotFound", err)
		}
		// The ACL owner sees the live grant in the access list; a reader does not.
		ov, err := f.svc.DocumentAccessList(f.ctx, Human(tn.aclOwner.ID), docR.ID)
		if err != nil || len(ov.BreakGlass) != 1 || ov.BreakGlass[0].Grant.ID != g.ID || ov.BreakGlass[0].ActorName == "" {
			t.Fatalf("owner access list break-glass = %+v, %v", ov.BreakGlass, err)
		}
		ov, err = f.svc.DocumentAccessList(f.ctx, Human(tn.outsider.ID), docR.ID)
		if err != nil || len(ov.BreakGlass) != 0 {
			t.Fatalf("reader access list break-glass = %+v, %v", ov.BreakGlass, err)
		}
	})

	t.Run("expiry cuts access at once", func(t *testing.T) {
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE document_break_glass_grants SET expires_at = now() - interval '1 second' WHERE id = $1`, g.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.GetDocument(f.ctx, admin, docR.ID); !errors.Is(err, ErrDocumentRestricted) {
			t.Fatalf("GetDocument after expiry = %v, want ErrDocumentRestricted", err)
		}
		ov, err := f.svc.DocumentAccessList(f.ctx, Human(tn.aclOwner.ID), docR.ID)
		if err != nil || len(ov.BreakGlass) != 0 {
			t.Fatalf("access list after expiry = %+v, %v; want no live grant", ov.BreakGlass, err)
		}
		// Ending an expired grant is a no-op: success, no audit row.
		if err := f.svc.RevokeDocumentBreakGlass(f.ctx, admin, docR.ID, g.ID); err != nil {
			t.Fatalf("revoke of an expired grant: %v", err)
		}
		if n := countAudit(t, f, audit.ActionDocumentBreakGlassRevoked, docR.ID); n != 0 {
			t.Fatalf("revoked audit rows after an expired no-op = %d, want 0", n)
		}
		// The admin may open a new one: a new grant, a second audit row.
		next, created, err := f.svc.GrantDocumentBreakGlass(f.ctx, admin, docR.ID, reason)
		if err != nil || !created || next.Grant.ID == g.ID {
			t.Fatalf("grant after expiry = %+v, created=%v, %v; want a new grant", next, created, err)
		}
		if n := countAudit(t, f, audit.ActionDocumentBreakGlassGranted, docR.ID); n != 2 {
			t.Fatalf("granted audit rows = %d, want 2", n)
		}
		g = next.Grant
	})

	t.Run("revoke", func(t *testing.T) {
		// A reader who is not the holder is forbidden; a stranger not found;
		// a grant of another document not found.
		if err := f.svc.RevokeDocumentBreakGlass(f.ctx, Human(tn.outsider.ID), docR.ID, g.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("reader revoke = %v, want ErrForbidden", err)
		}
		if err := f.svc.RevokeDocumentBreakGlass(f.ctx, Human(tn.member.ID), docR.ID, g.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("stranger revoke = %v, want ErrNotFound", err)
		}
		if err := f.svc.RevokeDocumentBreakGlass(f.ctx, admin, docR.ID, "01J8X4NOSUCHGRANT0N1P2Q3R4"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unknown grant revoke = %v, want ErrNotFound", err)
		}
		docR2 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if err := f.svc.RevokeDocumentBreakGlass(f.ctx, admin, docR2.ID, g.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("grant of another document revoke = %v, want ErrNotFound", err)
		}
		// The ACL owner may end someone else's grant.
		if err := f.svc.RevokeDocumentBreakGlass(f.ctx, Human(tn.aclOwner.ID), docR.ID, g.ID); err != nil {
			t.Fatalf("ACL owner revoke: %v", err)
		}
		if _, err := f.svc.GetDocument(f.ctx, admin, docR.ID); !errors.Is(err, ErrDocumentRestricted) {
			t.Fatalf("GetDocument after revoke = %v, want ErrDocumentRestricted", err)
		}
		rows := breakGlassAudit(t, f, audit.ActionDocumentBreakGlassRevoked, docR.ID)
		if len(rows) != 1 || rows[0]["_actor_id"] != tn.aclOwner.ID || rows[0]["grant_id"] != g.ID ||
			rows[0]["grantee_id"] != tn.wsAdmin.ID || rows[0]["ended_by"] != "administrator" {
			t.Fatalf("revoked audit rows = %v", rows)
		}
		if n := countOutbox(t, f, "document.break_glass_revoked", docR.ID); n != 1 {
			t.Fatalf("revoked outbox rows = %d, want 1", n)
		}
		// Idempotent: the holder ends it again, success and no new rows.
		if err := f.svc.RevokeDocumentBreakGlass(f.ctx, admin, docR.ID, g.ID); err != nil {
			t.Fatalf("second revoke: %v", err)
		}
		if n := countAudit(t, f, audit.ActionDocumentBreakGlassRevoked, docR.ID); n != 1 {
			t.Fatalf("revoked audit rows after the idempotent call = %d, want 1", n)
		}
	})

	t.Run("holder ends their own access", func(t *testing.T) {
		own, created, err := f.svc.GrantDocumentBreakGlass(f.ctx, admin, docR.ID, reason)
		if err != nil || !created {
			t.Fatalf("grant: %+v, %v, %v", own, created, err)
		}
		if _, err := f.svc.GetDocument(f.ctx, admin, docR.ID); err != nil {
			t.Fatalf("GetDocument inside the new grant: %v", err)
		}
		if err := f.svc.RevokeDocumentBreakGlass(f.ctx, admin, docR.ID, own.Grant.ID); err != nil {
			t.Fatalf("holder revoke: %v", err)
		}
		if _, err := f.svc.GetDocument(f.ctx, admin, docR.ID); !errors.Is(err, ErrDocumentRestricted) {
			t.Fatalf("GetDocument after the holder ended it = %v, want ErrDocumentRestricted", err)
		}
		rows := breakGlassAudit(t, f, audit.ActionDocumentBreakGlassRevoked, docR.ID)
		if len(rows) != 2 || rows[1]["ended_by"] != "holder" {
			t.Fatalf("revoked audit rows = %v, want the second by the holder", rows)
		}
	})
}
