package service

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// largeGrants opts into TestLargeRecipientGrants, which takes about a minute:
// go test ./internal/service -run TestLargeRecipientGrants -large-grants -v
var largeGrants = flag.Bool("large-grants", false, "measure 5,000 and 10,000 recipient grants")

// shareRow is one document_shares row as the chunk tests read it.
type shareRow struct {
	level, sourceKind, priorManual string
	live                           bool
}

// documentShareRows reads every share row of a document by principal: the live
// row and the revoked history.
func documentShareRows(t *testing.T, f *docPermFixture, documentID string) map[string][]shareRow {
	t.Helper()
	rows, err := f.pool.Query(f.ctx, `
		SELECT principal_id, level, COALESCE(source_kind, ''), COALESCE(prior_manual_level, ''), revoked_at IS NULL
		FROM document_shares WHERE document_id = $1 ORDER BY created_at, id`, documentID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string][]shareRow{}
	for rows.Next() {
		var pid string
		var r shareRow
		if err := rows.Scan(&pid, &r.level, &r.sourceKind, &r.priorManual, &r.live); err != nil {
			t.Fatal(err)
		}
		out[pid] = append(out[pid], r)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestShareDocumentBatchChunkBoundaries is SF4 for the Documents batch: the
// write chunk is 200 grants, so 199, 200, 201 (and 400, 401) recipients cross
// every boundary shape, and a replaced or unchanged row in a later chunk keeps
// its place: one live row per person, the old row revoked, the audit row and
// the notify decision on the right person.
func TestShareDocumentBatchChunkBoundaries(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "chunkb")
	mgr := Human(tn.aclOwner.ID)
	ids := f.seedOrgUsers(t, tn.orgID, "", "chunkb", 450)

	t.Run("boundaries", func(t *testing.T) {
		for _, n := range []int{199, 200, 201, 400, 401} {
			doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
			shares, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, ids[:n], DocumentLevelComment)
			if err != nil {
				t.Fatalf("%d recipients: %v", n, err)
			}
			if len(shares) != n {
				t.Fatalf("%d recipients: %d shares answered", n, len(shares))
			}
			for i, sh := range shares {
				if sh.PrincipalID != ids[i] || sh.Level != string(DocumentLevelComment) {
					t.Fatalf("%d recipients: shares[%d] = %s/%s, want %s/comment", n, i, sh.PrincipalID, sh.Level, ids[i])
				}
			}
			if got := len(documentShareRows(t, f, doc.ID)); got != n {
				t.Fatalf("%d recipients: %d principals hold a row", n, got)
			}
			if a, o := countAudit(t, f, audit.ActionDocumentShared, doc.ID), countOutbox(t, f, "document.shared", doc.ID); a != n || o != n {
				t.Fatalf("%d recipients: %d audit rows and %d outbox rows, want %d each", n, a, o, n)
			}
		}
	})

	t.Run("replaced and unchanged rows in later chunks", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		// One row per chunk (0-199, 200-399, 400-449), plus a same-level row in
		// the middle chunk that the batch must keep untouched.
		seeded := map[int]DocumentLevel{5: DocumentLevelView, 250: DocumentLevelEdit, 420: DocumentLevelView, 205: DocumentLevelComment}
		keptID := ""
		for idx, lvl := range seeded {
			sh, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
				PrincipalType: DocumentPrincipalUser, PrincipalID: ids[idx], Level: lvl,
			})
			if err != nil {
				t.Fatal(err)
			}
			if idx == 205 {
				keptID = sh.ID
			}
		}
		auditsBefore := countAudit(t, f, audit.ActionDocumentShared, doc.ID)
		outboxBefore := countOutbox(t, f, "document.shared", doc.ID)

		shares, err := f.svc.ShareDocumentBatch(f.ctx, mgr, doc.ID, ids, DocumentLevelComment)
		if err != nil {
			t.Fatal(err)
		}
		if len(shares) != len(ids) {
			t.Fatalf("answered %d shares, want %d", len(shares), len(ids))
		}
		for i, sh := range shares {
			if sh.PrincipalID != ids[i] || sh.Level != string(DocumentLevelComment) {
				t.Fatalf("shares[%d] = %s/%s, want %s/comment", i, sh.PrincipalID, sh.Level, ids[i])
			}
		}
		if shares[205].ID != keptID {
			t.Fatalf("the same-level row of ids[205] was replaced: %s, want %s kept", shares[205].ID, keptID)
		}
		rows := documentShareRows(t, f, doc.ID)
		for i, id := range ids {
			live := 0
			for _, r := range rows[id] {
				if r.live {
					live++
					if r.level != string(DocumentLevelComment) || r.sourceKind != "" || r.priorManual != "" {
						t.Fatalf("ids[%d] live row = %+v, want a manual comment row", i, r)
					}
				}
			}
			wantRows := 1
			if _, replaced := seeded[i]; replaced && i != 205 {
				wantRows = 2
			}
			if live != 1 || len(rows[id]) != wantRows {
				t.Fatalf("ids[%d]: %d live of %d rows, want 1 live of %d", i, live, len(rows[id]), wantRows)
			}
		}
		// 450 people, 449 written (ids[205] already held comment).
		if a := countAudit(t, f, audit.ActionDocumentShared, doc.ID) - auditsBefore; a != len(ids)-1 {
			t.Fatalf("audit rows written = %d, want %d", a, len(ids)-1)
		}
		if o := countOutbox(t, f, "document.shared", doc.ID) - outboxBefore; o != len(ids)-1 {
			t.Fatalf("outbox rows written = %d, want %d", o, len(ids)-1)
		}
		// The notify decision lands on the right people: raised from view or
		// from nothing is told, the downgrade from edit is not, nobody is told
		// twice.
		pr, err := f.pool.Query(f.ctx,
			`SELECT payload FROM outbox_events WHERE topic = 'document.shared' AND payload::jsonb->>'document_id' = $1
			 ORDER BY created_at, id OFFSET $2`, doc.ID, outboxBefore)
		if err != nil {
			t.Fatal(err)
		}
		defer pr.Close()
		notified := map[string]int{}
		for pr.Next() {
			var raw string
			if err := pr.Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var p map[string]string
			if err := json.Unmarshal([]byte(raw), &p); err != nil {
				t.Fatal(err)
			}
			if uid := p["notify_user_id"]; uid != "" {
				notified[uid]++
			}
		}
		if err := pr.Err(); err != nil {
			t.Fatal(err)
		}
		if len(notified) != len(ids)-2 || notified[ids[250]] != 0 || notified[ids[205]] != 0 ||
			notified[ids[5]] != 1 || notified[ids[420]] != 1 || notified[ids[449]] != 1 {
			t.Fatalf("notified %d people (ids[250]=%d ids[205]=%d ids[5]=%d ids[420]=%d ids[449]=%d), want everyone but ids[205] and ids[250], once each",
				len(notified), notified[ids[250]], notified[ids[205]], notified[ids[5]], notified[ids[420]], notified[ids[449]])
		}
	})
}

// seedChannel creates a public channel of the fixture's workspace whose
// members are n new people (organization, workspace and room members, in set
// statements), and returns its id with their ids in insert order.
func (f *chatDocumentFixture) seedChannel(t *testing.T, name string, n int) (roomID string, memberIDs []string) {
	t.Helper()
	ctx := context.Background()
	ch, err := f.svc.CreateChannel(ctx, f.ua.ID, f.ws.ID, CreateChannelInput{Name: name, Visibility: "public"})
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	ids := make([]string, n)
	emails := make([]string, n)
	names := make([]string, n)
	roomMemberIDs := make([]string, n)
	for i := range n {
		ids[i] = util.NewID()
		emails[i] = fmt.Sprintf("%s-%05d-%s@example.com", name, i, ids[i])
		names[i] = fmt.Sprintf("%s %05d", name, i)
		roomMemberIDs[i] = util.NewID()
	}
	for _, step := range []struct {
		what string
		sql  string
		args []any
	}{
		{"users", `INSERT INTO users (id, email, display_name, password_hash, email_verified_at)
			SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), 'x', now()`, []any{ids, emails, names}},
		{"org members", `INSERT INTO organization_members (organization_id, user_id, role)
			SELECT $1, unnest($2::text[]), 'member'`, []any{f.orgID, ids}},
		{"workspace members", `INSERT INTO workspace_members (workspace_id, user_id, role, organization_id)
			SELECT $1, unnest($2::text[]), 'member', $3`, []any{f.ws.ID, ids, f.orgID}},
		{"room members", `INSERT INTO chat_room_members (id, room_id, workspace_id, user_id, role, status, organization_id, joined_at, created_at, updated_at)
			SELECT unnest($1::text[]), $2, $3, unnest($4::text[]), 'member', 'active', $5, now(), now(), now()`,
			[]any{roomMemberIDs, ch.ID, f.ws.ID, ids, f.orgID}},
	} {
		if _, err := f.pool.Exec(ctx, step.sql, step.args...); err != nil {
			t.Fatalf("seed %d %s: %v", n, step.what, err)
		}
	}
	return ch.ID, ids
}

// TestChatDocumentLinkGrantChunksKeepPriorManualLevels is SF4 for the chat
// grant: a room of 450 people (three chunks) where every ninth person already
// holds a manual share of the document. The send raises them to edit, and
// prior_manual_level lands on exactly the rows that replaced a manual share,
// with the level that share held, in whichever chunk the row was written; a
// person who already holds edit keeps their manual row untouched.
func TestChatDocumentLinkGrantChunksKeepPriorManualLevels(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	dm := f.dm(t)
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, dm.ID, documentMessageInput("chunk-doc-1"))
	if err != nil {
		t.Fatalf("send the document: %v", err)
	}
	docID := sent.Document.DocumentID
	ch, ids := f.seedChannel(t, "chunk-room", 450)

	manual := map[int]DocumentLevel{}
	byLevel := map[DocumentLevel][]string{}
	for i := 0; i < len(ids); i += 3 {
		lvl := []DocumentLevel{DocumentLevelView, DocumentLevelComment, DocumentLevelEdit}[(i/3)%3]
		manual[i] = lvl
		byLevel[lvl] = append(byLevel[lvl], ids[i])
	}
	for lvl, who := range byLevel {
		if _, err := f.docs.ShareDocumentBatch(ctx, Human(f.ua.ID), docID, who, lvl); err != nil {
			t.Fatalf("manual %s shares: %v", lvl, err)
		}
	}

	started := time.Now()
	in := SendDocumentLinkInput{DocumentID: docID, ShareLevel: "edit", ClientMsgID: "chunk-link-1"}
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, ch, in); err != nil {
		t.Fatalf("link send: %v", err)
	}
	t.Logf("link send to 450 members over 150 manual shares: %s", time.Since(started))

	rows, err := f.pool.Query(ctx, `
		SELECT principal_id, level, COALESCE(source_kind, ''), COALESCE(prior_manual_level, '')
		FROM document_shares WHERE document_id = $1 AND revoked_at IS NULL`, docID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	live := map[string]shareRow{}
	for rows.Next() {
		var pid string
		var r shareRow
		if err := rows.Scan(&pid, &r.level, &r.sourceKind, &r.priorManual); err != nil {
			t.Fatal(err)
		}
		live[pid] = r
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	priors := 0
	for i, id := range ids {
		got, ok := live[id]
		if !ok {
			t.Fatalf("ids[%d] has no live share", i)
		}
		want := shareRow{level: "edit", sourceKind: DocumentShareSourceKindChat}
		switch manual[i] {
		case DocumentLevelEdit:
			want = shareRow{level: "edit"} // already at edit: the manual row stays
		case DocumentLevelView, DocumentLevelComment:
			want.priorManual = string(manual[i])
			priors++
		}
		if got.level != want.level || got.sourceKind != want.sourceKind || got.priorManual != want.priorManual {
			t.Fatalf("ids[%d] (manual %q) live row = %+v, want %+v", i, manual[i], got, want)
		}
	}
	if priors != 100 {
		t.Fatalf("rows that replaced a manual share = %d, want 100", priors)
	}
}

// TestLargeRecipientGrants is the SF1 measurement: a Documents batch share and
// a chat link send to 5,000 and 10,000 people, each in the one transaction
// that holds the document row (and the room's member rows) locked. It asserts
// the result and logs the timings; there is no time bound, which would be
// machine-dependent. Opt-in with -large-grants.
func TestLargeRecipientGrants(t *testing.T) {
	if !*largeGrants {
		t.Skip("opt-in: pass -large-grants to measure 5,000 and 10,000 recipient grants")
	}
	for _, n := range []int{5000, 10000} {
		t.Run(fmt.Sprintf("batch share %d", n), func(t *testing.T) {
			f := newDocPermFixture(t)
			tn := f.tenant(t, "large")
			doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
			ids := f.seedOrgUsers(t, tn.orgID, "", "large", n)
			started := time.Now()
			shares, err := f.svc.ShareDocumentBatch(f.ctx, Human(tn.aclOwner.ID), doc.ID, ids, DocumentLevelComment)
			elapsed := time.Since(started)
			if err != nil || len(shares) != n {
				t.Fatalf("ShareDocumentBatch(%d) = %d shares, %v", n, len(shares), err)
			}
			if a := countAudit(t, f, audit.ActionDocumentShared, doc.ID); a != n {
				t.Fatalf("audit rows = %d, want %d", a, n)
			}
			t.Logf("ShareDocumentBatch(%d): %s", n, elapsed)
		})
		t.Run(fmt.Sprintf("chat link send %d", n), func(t *testing.T) {
			f := newChatDocumentFixture(t)
			ctx := context.Background()
			sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, f.dm(t).ID, documentMessageInput("large-doc-1"))
			if err != nil {
				t.Fatal(err)
			}
			docID := sent.Document.DocumentID
			ch, _ := f.seedChannel(t, "large-room", n)
			started := time.Now()
			if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, ch,
				SendDocumentLinkInput{DocumentID: docID, ShareLevel: "comment", ClientMsgID: "large-link-1"}); err != nil {
				t.Fatalf("link send to %d members: %v", n, err)
			}
			elapsed := time.Since(started)
			if got := len(f.liveSharesOfDocument(t, docID)); got != n+1 {
				t.Fatalf("live shares = %d, want %d (the room plus the DM peer)", got, n+1)
			}
			t.Logf("SendDocumentLinkMessage(%d-member room): %s", n, elapsed)
		})
	}
}
