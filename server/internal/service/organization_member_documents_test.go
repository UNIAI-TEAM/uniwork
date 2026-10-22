package service

// DOC-06b (UNI-2092) bulk owner transfer of one member's documents, access
// addendum §2.2, §2.3, §4.2: DOC6-A04 (transferred / skipped counts, the
// batch loop, the concurrent single transfer, the per-document and per-call
// audit and outbox rows) and DOC6-A05 (the organization admin gate, P6, the
// count route).

import (
	"encoding/json"
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func newMemberDocsService(f *docPermFixture) *OrganizationMemberDocumentService {
	return NewOrganizationMemberDocumentService(NewOrganizationMemberService(f.pool, f.q, f.svc.orgs), f.svc)
}

// ownedDoc inserts a document whose ACL owner is owner, with an explicit id
// so a test can fix the batch order.
func (f *docPermFixture) ownedDoc(t *testing.T, tn docTenant, id, ws, owner, visibility string, extra map[string]any) db.Document {
	t.Helper()
	row := baseDoc(map[string]any{
		"id": id, "organization_id": tn.orgID, "workspace_id": ws, "visibility": visibility,
		"acl_owner_id": owner, "created_by": owner, "updated_by": owner,
	})
	for k, v := range extra {
		row[k] = v
	}
	insertRow(t, f.ctx, f.pool, "documents", row)
	return reloadDoc(t, f, id)
}

// ascendingIDs returns n fresh ids in ascending order.
func ascendingIDs(n int) []string {
	ids := make([]string, n)
	for i := range ids {
		ids[i] = util.NewID()
	}
	sort.Strings(ids)
	return ids
}

type bulkAuditRow struct {
	ResourceType, ResourceID string
	Metadata                 map[string]any
}

func bulkAudits(t *testing.T, f *docPermFixture, bulkID string) []bulkAuditRow {
	t.Helper()
	rs, err := f.pool.Query(f.ctx,
		`SELECT resource_type, resource_id, metadata::text FROM audit_events
		  WHERE action = $1 AND metadata::jsonb->>'bulk_id' = $2 ORDER BY occurred_at, id`,
		audit.ActionDocumentOwnersBulkTransferred, bulkID)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var out []bulkAuditRow
	for rs.Next() {
		var a bulkAuditRow
		var meta string
		if err := rs.Scan(&a.ResourceType, &a.ResourceID, &meta); err != nil {
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

func bulkPayloads(t *testing.T, f *docPermFixture, bulkID string) []map[string]any {
	t.Helper()
	rs, err := f.pool.Query(f.ctx,
		`SELECT payload::text FROM outbox_events WHERE topic = 'document.owners_bulk_transferred' AND payload::jsonb->>'bulk_id' = $1`,
		bulkID)
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

// countRowsWithBulkID counts every audit and outbox row naming bulkID.
func countRowsWithBulkID(t *testing.T, f *docPermFixture, bulkID string) (audits, events int) {
	t.Helper()
	if err := f.pool.QueryRow(f.ctx,
		`SELECT (SELECT count(*) FROM audit_events WHERE metadata::jsonb->>'bulk_id' = $1),
		        (SELECT count(*) FROM outbox_events WHERE payload::jsonb->>'bulk_id' = $1)`, bulkID,
	).Scan(&audits, &events); err != nil {
		t.Fatal(err)
	}
	return audits, events
}

func aclOwner(t *testing.T, f *docPermFixture, id string) string {
	t.Helper()
	d := reloadDoc(t, f, id)
	if !d.AclOwnerID.Valid {
		return ""
	}
	return d.AclOwnerID.String
}

// TestMemberDocumentsTransferMovesWhatTheRecipientCanOwn is DOC6-A04: the
// source owns documents in two workspaces, the recipient is a member of one.
// The documents there move (acl_owner_id + the updated_by pair, no share for
// the source), the other one is counted recipient_not_member. Each moved
// document has one audit row with the shared metadata keys plus bulk_id and
// one outbox row carrying bulk_id; the call has one bulk audit row and one
// bulk outbox row.
func TestMemberDocumentsTransferMovesWhatTheRecipientCanOwn(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt01")
	svc := newMemberDocsService(f)
	src := tn.aclOwner.ID
	dA1 := f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "workspace", nil)
	dA2 := f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "restricted", nil)
	dB := f.ownedDoc(t, tn, util.NewID(), tn.wsB, src, "workspace", nil)

	got, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, MemberDocumentsTransferInput{ToUserID: tn.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ulid.Parse(got.BulkID); err != nil {
		t.Fatalf("bulk_id %q is not a ULID", got.BulkID)
	}
	if got.Transferred != 2 || got.SkippedRecipientNotMember != 1 || got.SkippedSelfRestricted != 0 || got.HasMore || got.Cursor != "" {
		t.Fatalf("result = %+v, want 2 transferred, 1 recipient_not_member, done", got)
	}

	for _, d := range []db.Document{dA1, dA2} {
		after := reloadDoc(t, f, d.ID)
		if after.AclOwnerID.String != tn.member.ID {
			t.Fatalf("%s acl_owner_id = %+v, want the recipient", d.ID, after.AclOwnerID)
		}
		if after.UpdatedBy != tn.owner.ID || after.UpdatedByKind != "human" {
			t.Fatalf("%s updated_by = %q/%q, want the caller as human", d.ID, after.UpdatedBy, after.UpdatedByKind)
		}
		if after.Revision != d.Revision {
			t.Fatalf("%s revision %d -> %d, want unchanged", d.ID, d.Revision, after.Revision)
		}
		if s := userShares(t, f, d, src); len(s) != 0 {
			t.Fatalf("%s source shares = %+v, want none", d.ID, s)
		}
		audits := ownerTransferAudits(t, f, d.ID)
		if len(audits) != 1 {
			t.Fatalf("%s audit rows = %d, want 1", d.ID, len(audits))
		}
		a := audits[0]
		if a.ActorID != tn.owner.ID || len(a.Metadata) != 3 || a.Metadata["from_user_id"] != src ||
			a.Metadata["previous_owner_level"] != "none" || a.Metadata["bulk_id"] != got.BulkID {
			t.Fatalf("%s audit = %+v", d.ID, a)
		}
		ch, _ := a.Changes["acl_owner_id"].(map[string]any)
		if ch["from"] != src || ch["to"] != tn.member.ID {
			t.Fatalf("%s audit changes = %+v", d.ID, a.Changes)
		}
		payloads := ownerTransferPayloads(t, f, d.ID)
		if len(payloads) != 1 || len(payloads[0]) != 3 || payloads[0]["workspace_id"] != tn.wsA || payloads[0]["bulk_id"] != got.BulkID {
			t.Fatalf("%s outbox = %v, want one {document_id, workspace_id, bulk_id}", d.ID, payloads)
		}
	}
	if owner := aclOwner(t, f, dB.ID); owner != src {
		t.Fatalf("workspace B document owner = %q, want the source kept", owner)
	}
	if a := ownerTransferAudits(t, f, dB.ID); len(a) != 0 {
		t.Fatalf("skipped document audit rows = %+v, want none", a)
	}

	bulk := bulkAudits(t, f, got.BulkID)
	if len(bulk) != 1 || bulk[0].ResourceType != "organization_member" || bulk[0].ResourceID != src {
		t.Fatalf("bulk audit = %+v", bulk)
	}
	m := bulk[0].Metadata
	skipped, _ := m["skipped"].(map[string]any)
	if m["bulk_id"] != got.BulkID || m["to_user_id"] != tn.member.ID || m["transferred"] != float64(2) ||
		skipped["recipient_not_member"] != float64(1) || skipped["self_restricted"] != float64(0) {
		t.Fatalf("bulk audit metadata = %+v", m)
	}
	events := bulkPayloads(t, f, got.BulkID)
	if len(events) != 1 {
		t.Fatalf("bulk outbox rows = %d, want 1", len(events))
	}
	if e := events[0]; len(e) != 4 || e["organization_id"] != tn.orgID || e["user_id"] != tn.member.ID || e["from_user_id"] != src {
		t.Fatalf("bulk outbox payload = %v", e)
	}
}

// TestMemberDocumentsTransferToTheCallerSkipsRestrictedWithoutManage is the
// DOC-05 half of DOC6-A04: an organization admin naming themselves as the
// recipient takes a restricted document only where they already manage it.
func TestMemberDocumentsTransferToTheCallerSkipsRestrictedWithoutManage(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt02")
	svc := newMemberDocsService(f)
	src := tn.aclOwner.ID
	ids := ascendingIDs(3)
	closed := f.ownedDoc(t, tn, ids[0], tn.wsA, src, "restricted", nil)
	managed := f.ownedDoc(t, tn, ids[1], tn.wsA, src, "restricted", nil)
	f.share(t, managed, DocumentPrincipalUser, tn.orgAdmin.ID, DocumentLevelManage, src)
	open := f.ownedDoc(t, tn, ids[2], tn.wsA, src, "workspace", nil)

	got, err := svc.TransferMemberDocuments(f.ctx, Human(tn.orgAdmin.ID), tn.orgID, src, MemberDocumentsTransferInput{ToUserID: tn.orgAdmin.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got.Transferred != 2 || got.SkippedSelfRestricted != 1 || got.SkippedRecipientNotMember != 0 || got.HasMore {
		t.Fatalf("result = %+v, want 2 transferred, 1 self_restricted", got)
	}
	if owner := aclOwner(t, f, closed.ID); owner != src {
		t.Fatalf("restricted without manage owner = %q, want the source", owner)
	}
	for _, d := range []db.Document{managed, open} {
		if owner := aclOwner(t, f, d.ID); owner != tn.orgAdmin.ID {
			t.Fatalf("%s owner = %q, want the caller", d.ID, owner)
		}
	}
}

// TestMemberDocumentsTransferLoopsThroughBatches is the R1-10 loop: with the
// batch lowered to two and the first three documents skipped, the client
// loop still reaches the end, every cursor moves forward, the bulk id is the
// same on every call, and only calls that moved something write a bulk row.
func TestMemberDocumentsTransferLoopsThroughBatches(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt03")
	svc := newMemberDocsService(f)
	prev := memberDocumentsTransferBatch
	memberDocumentsTransferBatch = 2
	t.Cleanup(func() { memberDocumentsTransferBatch = prev })
	src := tn.aclOwner.ID
	ids := ascendingIDs(5)
	for i, id := range ids {
		ws := tn.wsA
		if i < 3 {
			ws = tn.wsB
		}
		f.ownedDoc(t, tn, id, ws, src, "workspace", nil)
	}

	in := MemberDocumentsTransferInput{ToUserID: tn.member.ID}
	var transferred, skipped, calls, writing int
	bulkID := ""
	for {
		calls++
		if calls > 10 {
			t.Fatal("the loop never ended")
		}
		got, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, in)
		if err != nil {
			t.Fatal(err)
		}
		if bulkID == "" {
			bulkID = got.BulkID
		} else if got.BulkID != bulkID {
			t.Fatalf("call %d bulk_id = %q, want %q echoed", calls, got.BulkID, bulkID)
		}
		transferred += got.Transferred
		skipped += got.SkippedRecipientNotMember
		if got.Transferred > 0 {
			writing++
		}
		if !got.HasMore {
			if got.Cursor != "" {
				t.Fatalf("last call cursor = %q, want empty", got.Cursor)
			}
			break
		}
		if got.Cursor == "" || got.Cursor <= in.Cursor {
			t.Fatalf("call %d cursor %q after %q: stuck", calls, got.Cursor, in.Cursor)
		}
		in.BulkID, in.Cursor = got.BulkID, got.Cursor
	}
	if transferred != 2 || skipped != 3 || calls != 3 {
		t.Fatalf("transferred %d skipped %d in %d calls, want 2 / 3 / 3", transferred, skipped, calls)
	}
	if b := bulkAudits(t, f, bulkID); len(b) != writing {
		t.Fatalf("bulk audit rows = %d, want %d (calls that moved a document)", len(b), writing)
	}
	if e := bulkPayloads(t, f, bulkID); len(e) != writing {
		t.Fatalf("bulk outbox rows = %d, want %d", len(e), writing)
	}
}

// TestMemberDocumentsTransferWaitsForAConcurrentSingleTransfer: a single
// transfer holds one listed row when the batch starts. The batch waits for
// the lock, the row no longer matches the source, so it is not counted, and
// the loop still finishes with the rest moved.
func TestMemberDocumentsTransferWaitsForAConcurrentSingleTransfer(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt04")
	svc := newMemberDocsService(f)
	src := tn.aclOwner.ID
	ids := ascendingIDs(3)
	for _, id := range ids {
		f.ownedDoc(t, tn, id, tn.wsA, src, "workspace", nil)
	}

	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(f.ctx) }()
	var holder int
	if err := tx.QueryRow(f.ctx, `SELECT pg_backend_pid()`).Scan(&holder); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(f.ctx, `SELECT id FROM documents WHERE id = $1 FOR UPDATE`, ids[1]); err != nil {
		t.Fatal(err)
	}

	type result struct {
		out MemberDocumentsTransfer
		err error
	}
	done := make(chan result, 1)
	go func() {
		out, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, MemberDocumentsTransferInput{ToUserID: tn.member.ID})
		done <- result{out, err}
	}()
	deadline := time.Now().Add(10 * time.Second)
	for {
		var n int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock'
			  AND pid <> pg_backend_pid() AND pid <> $1`, holder).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			break
		}
		select {
		case r := <-done:
			t.Fatalf("the batch finished (%+v, %v) while a row was locked", r.out, r.err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("the batch never waited for the locked row")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if _, err := tx.Exec(f.ctx, `UPDATE documents SET acl_owner_id = $2 WHERE id = $1`, ids[1], tn.wsAdmin.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	r := <-done
	if r.err != nil {
		t.Fatal(r.err)
	}
	if r.out.Transferred != 2 || r.out.HasMore || r.out.Cursor != "" {
		t.Fatalf("result = %+v, want 2 transferred and done", r.out)
	}
	if owner := aclOwner(t, f, ids[1]); owner != tn.wsAdmin.ID {
		t.Fatalf("concurrently moved document owner = %q, want the single transfer's", owner)
	}
	if a := ownerTransferAudits(t, f, ids[1]); len(a) != 0 {
		t.Fatalf("concurrently moved document bulk audit rows = %+v, want none", a)
	}
}

// TestMemberDocumentsTransferFromADeactivatedMember: the orphaned documents
// of a member deactivated before this feature move like any other.
func TestMemberDocumentsTransferFromADeactivatedMember(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt05")
	svc := newMemberDocsService(f)
	d := f.ownedDoc(t, tn, util.NewID(), tn.wsA, tn.deact.ID, "restricted", nil)

	own, err := svc.MemberDocumentOwnership(f.ctx, tn.owner.ID, tn.orgID, tn.deact.ID)
	if err != nil {
		t.Fatal(err)
	}
	if own.Total != 1 {
		t.Fatalf("deactivated member total = %d, want 1", own.Total)
	}
	got, err := svc.TransferMemberDocuments(f.ctx, Human(tn.orgAdmin.ID), tn.orgID, tn.deact.ID, MemberDocumentsTransferInput{ToUserID: tn.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got.Transferred != 1 || aclOwner(t, f, d.ID) != tn.member.ID {
		t.Fatalf("result = %+v, owner %q", got, aclOwner(t, f, d.ID))
	}
}

// TestMemberDocumentsGate is DOC6-A05 on both routes: only an active owner or
// admin of the organization; an admin never acts on another admin nor on the
// owner (P6); the owner may; a person outside the organization, as caller or
// as source, is 404. The caller may be the source.
func TestMemberDocumentsGate(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt06")
	other := f.tenant(t, "mdt06x")
	svc := newMemberDocsService(f)
	peerAdmin := f.user(t, "mdt06", "peeradmin")
	f.orgMember(t, tn.orgID, peerAdmin.ID, OrgRoleAdmin)
	to := MemberDocumentsTransferInput{ToUserID: tn.member.ID}

	call := func(actor, source string) (error, error) {
		_, getErr := svc.MemberDocumentOwnership(f.ctx, actor, tn.orgID, source)
		_, postErr := svc.TransferMemberDocuments(f.ctx, Human(actor), tn.orgID, source, to)
		return getErr, postErr
	}
	for _, c := range []struct {
		name, actor, source string
		want                error
	}{
		{"admin on admin", tn.orgAdmin.ID, peerAdmin.ID, ErrForbidden},
		{"admin on owner", tn.orgAdmin.ID, tn.owner.ID, ErrForbidden},
		{"plain member", tn.member.ID, tn.aclOwner.ID, ErrForbidden},
		{"deactivated caller", tn.deact.ID, tn.aclOwner.ID, nil},
		// The route answers an outsider 404 before the service runs
		// (orgIDFromSlug); the service's own gate is RequireMember's 403.
		{"outsider organization", other.owner.ID, tn.aclOwner.ID, ErrForbidden},
		{"source outside the organization", tn.owner.ID, other.member.ID, ErrNotFound},
	} {
		getErr, postErr := call(c.actor, c.source)
		for route, err := range map[string]error{"GET": getErr, "POST": postErr} {
			if c.want == nil {
				// A deactivated caller is refused by RequireMember itself.
				if !codedIs(err, "member_deactivated") {
					t.Fatalf("%s %s: err = %v, want member_deactivated", c.name, route, err)
				}
				continue
			}
			if !errors.Is(err, c.want) {
				t.Fatalf("%s %s: err = %v, want %v", c.name, route, err, c.want)
			}
		}
	}
	for _, c := range []struct{ name, actor, source string }{
		{"owner on admin", tn.owner.ID, tn.orgAdmin.ID},
		{"admin on member", tn.orgAdmin.ID, tn.aclOwner.ID},
		{"caller is the source", tn.owner.ID, tn.owner.ID},
	} {
		if getErr, postErr := call(c.actor, c.source); getErr != nil || postErr != nil {
			t.Fatalf("%s: GET %v, POST %v, want both allowed", c.name, getErr, postErr)
		}
	}
}

// TestMemberDocumentsTransferRefusesTheBody: a recipient who cannot own
// anything in the organization is 422 owner_target_not_member; a missing
// recipient and a bulk_id / cursor that is not a ULID are 400.
func TestMemberDocumentsTransferRefusesTheBody(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt07")
	other := f.tenant(t, "mdt07x")
	svc := newMemberDocsService(f)
	src := tn.aclOwner.ID
	d := f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "workspace", nil)
	post := func(in MemberDocumentsTransferInput) error {
		_, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, in)
		return err
	}
	for name, to := range map[string]string{
		"recipient is the source": src,
		"deactivated":             tn.deact.ID,
		"agent":                   tn.agent,
		"other organization":      other.member.ID,
		"unknown":                 util.NewID(),
	} {
		t.Run(name, func(t *testing.T) {
			wantCoded(t, post(MemberDocumentsTransferInput{ToUserID: to}), "owner_target_not_member")
		})
	}
	for name, in := range map[string]MemberDocumentsTransferInput{
		"no recipient":   {},
		"bad bulk_id":    {ToUserID: tn.member.ID, BulkID: "not-a-ulid"},
		"bad cursor":     {ToUserID: tn.member.ID, Cursor: "zzz"},
		"cursor too big": {ToUserID: tn.member.ID, Cursor: util.NewID() + "0"},
	} {
		var ve ValidationError
		if err := post(in); !errors.As(err, &ve) {
			t.Fatalf("%s: err = %v, want a validation error", name, err)
		}
	}
	if owner := aclOwner(t, f, d.ID); owner != src {
		t.Fatalf("owner after refusals = %q, want unchanged", owner)
	}
}

// TestMemberDocumentsTransferThatMovesNothingWritesNothing (Q2 A): every
// document is skipped, so the call writes no audit row and no outbox row, and
// still echoes the client's bulk id.
func TestMemberDocumentsTransferThatMovesNothingWritesNothing(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt08")
	svc := newMemberDocsService(f)
	src := tn.aclOwner.ID
	f.ownedDoc(t, tn, util.NewID(), tn.wsB, src, "workspace", nil)
	bulkID := util.NewID()

	got, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, MemberDocumentsTransferInput{ToUserID: tn.member.ID, BulkID: bulkID})
	if err != nil {
		t.Fatal(err)
	}
	if got.BulkID != bulkID || got.Transferred != 0 || got.SkippedRecipientNotMember != 1 || got.HasMore {
		t.Fatalf("result = %+v", got)
	}
	if a, e := countRowsWithBulkID(t, f, bulkID); a != 0 || e != 0 {
		t.Fatalf("rows with bulk_id: %d audit, %d outbox, want none", a, e)
	}

	// A member who owns nothing: empty batch, done.
	got, err = svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, tn.creator.ID, MemberDocumentsTransferInput{ToUserID: tn.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got.Transferred != 0 || got.SkippedRecipientNotMember != 0 || got.HasMore || got.Cursor != "" || got.BulkID == "" {
		t.Fatalf("empty result = %+v", got)
	}
}

// TestMemberDocumentsSkipWorkProductAndMyFolder: a Work Product document and
// the source's My Folder root are never listed, counted or moved; a document
// inside the My Folder moves like any other.
func TestMemberDocumentsSkipWorkProductAndMyFolder(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt09")
	svc := newMemberDocsService(f)
	src := tn.aclOwner.ID
	wp := f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "workspace", map[string]any{
		"owner_kind": "work_product", "owner_id": util.NewID(), "acl_owner_id": src,
	})
	root := f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "restricted", map[string]any{
		"kind": "folder", "system_kind": "my_folder",
	})
	inside := f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "restricted", map[string]any{"parent_id": root.ID})

	own, err := svc.MemberDocumentOwnership(f.ctx, tn.owner.ID, tn.orgID, src)
	if err != nil {
		t.Fatal(err)
	}
	if own.Total != 1 || len(own.Workspaces) != 1 || own.Workspaces[0].Count != 1 {
		t.Fatalf("ownership = %+v, want only the document inside My Folder", own)
	}
	got, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, MemberDocumentsTransferInput{ToUserID: tn.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got.Transferred != 1 || got.SkippedRecipientNotMember != 0 || got.SkippedSelfRestricted != 0 {
		t.Fatalf("result = %+v, want 1 transferred and nothing skipped", got)
	}
	if aclOwner(t, f, inside.ID) != tn.member.ID || aclOwner(t, f, wp.ID) != src || aclOwner(t, f, root.ID) != src {
		t.Fatal("only the document inside My Folder may move")
	}
}

// TestMemberDocumentOwnershipCountsByWorkspace is the GET half of DOC6-A05:
// counts per workspace with its name, archived documents included, nothing
// else about a document.
func TestMemberDocumentOwnershipCountsByWorkspace(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt10")
	svc := newMemberDocsService(f)
	src := tn.aclOwner.ID
	f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "workspace", nil)
	f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "restricted", map[string]any{
		"archived_at": time.Now().UTC(), "archived_by": src, "purge_after": time.Now().UTC().Add(30 * 24 * time.Hour),
	})
	f.ownedDoc(t, tn, util.NewID(), tn.wsB, src, "workspace", nil)
	f.ownedDoc(t, tn, util.NewID(), tn.wsB, tn.member.ID, "workspace", nil)

	got, err := svc.MemberDocumentOwnership(f.ctx, tn.owner.ID, tn.orgID, src)
	if err != nil {
		t.Fatal(err)
	}
	if got.UserID != src || got.Total != 3 || len(got.Workspaces) != 2 {
		t.Fatalf("ownership = %+v", got)
	}
	counts := map[string]MemberDocumentWorkspaceCount{}
	for _, w := range got.Workspaces {
		counts[w.WorkspaceID] = w
	}
	if a := counts[tn.wsA]; a.Count != 2 || a.WorkspaceName != "A mdt10" {
		t.Fatalf("workspace A = %+v", a)
	}
	if b := counts[tn.wsB]; b.Count != 1 || b.WorkspaceName != "B mdt10" {
		t.Fatalf("workspace B = %+v", b)
	}
	none, err := svc.MemberDocumentOwnership(f.ctx, tn.owner.ID, tn.orgID, tn.creator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if none.Total != 0 || none.Workspaces == nil || len(none.Workspaces) != 0 {
		t.Fatalf("member with nothing = %+v, want total 0 and an empty list", none)
	}
}
