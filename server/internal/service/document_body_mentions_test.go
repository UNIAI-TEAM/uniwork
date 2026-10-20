package service

// UNI-1968 (BODY-MENTION-NOTIFY, S6): a mention typed into a UniNote page body
// notifies the people the save newly names. The diff runs inside the save
// transaction against the previous saved content, so saving the same content
// again says nothing, removing a mention and adding it back notifies again, and
// a mention of the saving actor, of an agent, of somebody who cannot read the
// document or of an id from another organization never becomes an event. A
// content-only save still fans out no document.updated frame.

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const bodyMentionTopic = "document.body_mentioned"

// bodyMentionNodes builds a page holding exactly the mention attrs given, in
// one paragraph, the shape the editor writes.
func bodyMentionNodes(attrs ...map[string]any) json.RawMessage {
	inline := make([]any, 0, len(attrs))
	for _, a := range attrs {
		inline = append(inline, map[string]any{"type": "mention", "attrs": a})
	}
	raw, _ := json.Marshal(map[string]any{"type": "doc", "content": []any{
		map[string]any{"type": "paragraph", "content": inline},
	}})
	return raw
}

func userMention(id string) map[string]any {
	return map[string]any{"kind": "user", "id": id, "label": "Ai đó"}
}

// bodyMentionJSON mentions each id as a user.
func bodyMentionJSON(ids ...string) json.RawMessage {
	attrs := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		attrs = append(attrs, userMention(id))
	}
	return bodyMentionNodes(attrs...)
}

// savePage patches the page's content at its current revision.
func savePage(t *testing.T, f *docPermFixture, actor Actor, docID string, content json.RawMessage) DocumentView {
	t.Helper()
	d, err := f.q.GetDocumentByID(f.ctx, docID)
	if err != nil {
		t.Fatal(err)
	}
	v, err := f.svc.UpdateDocument(f.ctx, actor, docID, UpdateDocumentInput{Revision: d.Revision, Content: content})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	return v
}

// bodyMentionPayloads is every document.body_mentioned event of one document,
// oldest first.
func bodyMentionPayloads(t *testing.T, f *docPermFixture, docID string) []map[string]string {
	t.Helper()
	rows, err := f.pool.Query(f.ctx,
		`SELECT payload FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2 ORDER BY id`,
		bodyMentionTopic, docID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []map[string]string
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var p map[string]string
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatal(err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func bodyMentionUserIDsOf(t *testing.T, f *docPermFixture, docID string) []string {
	t.Helper()
	var out []string
	for _, p := range bodyMentionPayloads(t, f, docID) {
		out = append(out, p["user_id"])
	}
	return out
}

// documentUpdatedMetadata is the metadata of the newest document.updated audit
// row of one document.
func documentUpdatedMetadata(t *testing.T, f *docPermFixture, docID string) map[string]any {
	t.Helper()
	var raw string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT metadata::text FROM audit_events WHERE action = $1 AND resource_id = $2 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
		"document.updated", docID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		t.Fatal(err)
	}
	return meta
}

// bodyMentionPage is a workspace-visible page of the fixture's workspace A,
// owned by aclOwner, with no content yet.
func bodyMentionPage(t *testing.T, f *docPermFixture, tn docTenant) db.Document {
	t.Helper()
	return f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
}

// addBulkReaders inserts n people who are active members of the organization
// and of the workspace, so each one reads a workspace-visible page.
func addBulkReaders(t *testing.T, f *docPermFixture, orgID, wsID string, n int) []string {
	t.Helper()
	ids := make([]string, 0, n)
	for i := range n {
		id := util.NewID()
		insertRow(t, f.ctx, f.pool, "users", map[string]any{
			"id": id, "email": fmt.Sprintf("bulk-reader-%d@example.com", i), "password_hash": "x",
			"display_name": fmt.Sprintf("Bulk Reader %d", i),
		})
		insertRow(t, f.ctx, f.pool, "organization_members", map[string]any{
			"organization_id": orgID, "user_id": id, "role": "member",
		})
		insertRow(t, f.ctx, f.pool, "workspace_members", map[string]any{
			"workspace_id": wsID, "organization_id": orgID, "user_id": id, "role": "member",
		})
		ids = append(ids, id)
	}
	return ids
}

// A mention the save newly names emits exactly one event for that person,
// carrying ids only; the same content saved again emits nothing; removing the
// mention and adding it back notifies again. A content-only save still emits no
// document.updated frame (C-01 §5.1).
func TestDocumentBodyMentionEvents(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "bmn")
	actor := Human(tn.aclOwner.ID)
	d := bodyMentionPage(t, f, tn)

	savePage(t, f, actor, d.ID, bodyMentionJSON(tn.member.ID, tn.creator.ID))
	events := bodyMentionPayloads(t, f, d.ID)
	if len(events) != 2 {
		t.Fatalf("events = %+v, want one per newly named person", events)
	}
	want := []string{tn.member.ID, tn.creator.ID}
	for i, p := range events {
		if p["user_id"] != want[i] || p["document_id"] != d.ID || p["workspace_id"] != tn.wsA || p["author_id"] != tn.aclOwner.ID {
			t.Fatalf("event %d = %+v, want ids only for %s", i, p, want[i])
		}
		if len(p) != 4 {
			t.Fatalf("event %d carries %d keys, want the four ids only: %+v", i, len(p), p)
		}
	}
	if got := bodyMentionUserIDsOf(t, f, d.ID); len(got) != 2 {
		t.Fatalf("user ids = %v", got)
	}
	// A content-only save audits metadata and fans out no frame.
	if n := countOutbox(t, f, "document.updated", d.ID); n != 0 {
		t.Fatalf("document.updated frames = %d, want 0 for an autosave", n)
	}
	if n := countAudit(t, f, "document.updated", d.ID); n != 1 {
		t.Fatalf("document.updated audit rows = %d, want 1", n)
	}
	if meta := documentUpdatedMetadata(t, f, d.ID); meta["content_changed"] != true || meta["mentions_added"] != float64(2) {
		t.Fatalf("audit metadata = %+v, want content_changed and mentions_added 2", meta)
	}

	// The same content again: the diff is empty.
	savePage(t, f, actor, d.ID, bodyMentionJSON(tn.member.ID, tn.creator.ID))
	if n := len(bodyMentionPayloads(t, f, d.ID)); n != 2 {
		t.Fatalf("a repeat save emitted %d events, want the original 2", n)
	}

	// Remove one, save, add it back, save: absent from the previous saved
	// version means notify.
	savePage(t, f, actor, d.ID, bodyMentionJSON(tn.member.ID))
	if n := len(bodyMentionPayloads(t, f, d.ID)); n != 2 {
		t.Fatalf("removing a mention emitted %d events, want 2", n)
	}
	savePage(t, f, actor, d.ID, bodyMentionJSON(tn.member.ID, tn.creator.ID))
	if got := bodyMentionUserIDsOf(t, f, d.ID); len(got) != 3 || got[2] != tn.creator.ID {
		t.Fatalf("re-adding a mention emitted %v, want a third event for the creator", got)
	}
}

// Only a mention node of kind user names a person: a task, document or meeting
// mention emits nothing. A mention node with no kind counts as a user - the
// sanitizer requires the attr, so the shape cannot arrive through a save, and
// the extractor's own answer is what this pins.
func TestDocumentBodyMentionOnlyUserNodes(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "bmnk")
	actor := Human(tn.aclOwner.ID)
	d := bodyMentionPage(t, f, tn)

	page := bodyMentionNodes(
		map[string]any{"kind": "task", "id": tn.member.ID},
		map[string]any{"kind": "document", "id": tn.creator.ID},
		map[string]any{"kind": "meeting", "id": tn.member.ID},
	)
	savePage(t, f, actor, d.ID, page)
	if n := len(bodyMentionPayloads(t, f, d.ID)); n != 0 {
		t.Fatalf("non-user mentions emitted %d events, want 0", n)
	}
	if ids := bodyMentionUserIDs(page); len(ids) != 0 {
		t.Fatalf("extractor read %v from non-user mentions, want none", ids)
	}

	// A mention node with no kind is a user mention.
	kindless := bodyMentionNodes(map[string]any{"id": tn.member.ID})
	if ids := bodyMentionUserIDs(kindless); len(ids) != 1 || ids[0] != tn.member.ID {
		t.Fatalf("extractor read %v from a kind-less mention, want the member", ids)
	}
	// Through a save the sanitizer drops the node: the mention attr is
	// required (document/schema.go), so nothing is stored and nothing is
	// notified.
	savePage(t, f, actor, d.ID, kindless)
	if n := len(bodyMentionPayloads(t, f, d.ID)); n != 0 {
		t.Fatalf("a kind-less mention emitted %d events, want 0", n)
	}
}

// A self-mention notifies nobody; an agent's id is not a person; a
// deactivated organization member and a member of another organization are
// dropped. Read access is NOT decided here: a member of the document's own
// organization who cannot read the page still gets the event, and the
// notification rule drops them at delivery (S3,
// notification/document_body_mentions_test.go).
func TestDocumentBodyMentionExclusions(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "bmne")
	other := f.tenant(t, "bmnex")
	actor := Human(tn.aclOwner.ID)
	d := bodyMentionPage(t, f, tn)

	// The saving actor mentions themselves, an agent of the workspace, a
	// deactivated member and a member of another organization.
	savePage(t, f, actor, d.ID, bodyMentionJSON(tn.aclOwner.ID, tn.agent, tn.deact.ID, other.member.ID))
	if got := bodyMentionUserIDsOf(t, f, d.ID); len(got) != 0 {
		t.Fatalf("events = %v, want none for a self-mention, an agent, a deactivated member or another tenant", got)
	}
	if meta := documentUpdatedMetadata(t, f, d.ID); meta["mentions_added"] != float64(0) {
		t.Fatalf("mentions_added = %v, want 0", meta["mentions_added"])
	}

	// A workspace B member of the same organization is still a member of the
	// document's organization, so the save writes the event; the delivery-time
	// read gate is what keeps the notification from them.
	savePage(t, f, actor, d.ID, bodyMentionJSON(tn.bMember.ID))
	if got := bodyMentionUserIDsOf(t, f, d.ID); len(got) != 1 || got[0] != tn.bMember.ID {
		t.Fatalf("events = %v, want one for the same-organization non-reader", got)
	}

	// A workspace A member reads the page and is notified.
	savePage(t, f, actor, d.ID, bodyMentionJSON(tn.member.ID))
	if got := bodyMentionUserIDsOf(t, f, d.ID); len(got) != 2 || got[1] != tn.member.ID {
		t.Fatalf("events = %v, want a second for the workspace member", got)
	}
}

// An agent actor's save notifies nobody (ADR 0010). An agent cannot reach the
// save path at all - the document gate caps it at view (document_05b) - so the
// rule is pinned where it lives.
func TestDocumentBodyMentionAgentActorSilent(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "bmna")
	d := bodyMentionPage(t, f, tn)
	before := bodyMentionJSON(tn.creator.ID)

	got, added, err := f.svc.newBodyMentionRecipients(f.ctx, f.q, agentActor(tn.agent), d, before, bodyMentionJSON(tn.member.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 || added != 0 {
		t.Fatalf("agent actor recipients = %v (%d), want none", got, added)
	}
	if _, err := f.svc.UpdateDocument(f.ctx, agentActor(tn.agent), d.ID, UpdateDocumentInput{Revision: d.Revision, Content: bodyMentionJSON(tn.member.ID)}); !isGateRefusal(err) {
		t.Fatalf("agent save = %v, want a gate refusal", err)
	}
	if n := len(bodyMentionPayloads(t, f, d.ID)); n != 0 {
		t.Fatalf("agent save emitted %d events, want 0", n)
	}
}

// One save notifies at most 50 people in document order of their first
// appearance; the audit metadata carries how many eligible recipients the save
// newly named before the cap (RBM-02, RBM-201).
func TestDocumentBodyMentionCap(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "bmnc")
	actor := Human(tn.aclOwner.ID)
	d := bodyMentionPage(t, f, tn)

	ids := addBulkReaders(t, f, tn.orgID, tn.wsA, 55)
	// Place the 55 recipients in reverse id order and repeat the first after the
	// second so sorting ids or deduplicating by last appearance fails (RBM-201).
	slices.Reverse(ids)
	mentioned := append([]string{ids[0], ids[1], ids[0]}, ids[2:]...)
	savePage(t, f, actor, d.ID, bodyMentionJSON(mentioned...))

	got := bodyMentionUserIDsOf(t, f, d.ID)
	if len(got) != 50 {
		t.Fatalf("events = %d, want 50", len(got))
	}
	for i, id := range got {
		if id != ids[i] {
			t.Fatalf("event %d = %s, want %s (first 50 distinct ids in document order)", i, id, ids[i])
		}
	}
	if meta := documentUpdatedMetadata(t, f, d.ID); meta["mentions_added"] != float64(55) {
		t.Fatalf("mentions_added = %v, want 55 (the count before the cap)", meta["mentions_added"])
	}
}

// Calling the registered MCP update_document tool with audit.WithVia saves as
// the consenting human (ADR 0033) and emits a document.body_mentioned event
// for a newly mentioned readable member with that human as author_id, whereas
// an autonomous agent actor emits nothing (ADR 0010, RBM-04).
func TestDocumentBodyMentionMCPUpdate(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	member := x.member(t)

	agentID := util.NewID()
	if _, err := x.tools.q.CreateAgent(ctx, db.CreateAgentParams{
		ID: agentID, OrganizationID: x.w.OrganizationID, Name: "bmn-mcp-agent", Handle: "bmn-mcp-agent",
		OwnerUserID: x.ua.ID, AutonomyPolicy: "{}", CreatedBy: x.ua.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	if err := x.tools.q.AddWorkspaceAgentMember(ctx, db.AddWorkspaceAgentMemberParams{
		WorkspaceID: x.w.ID, AgentID: agentID, OrganizationID: x.w.OrganizationID,
		CreatedBy: x.ua.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	agent := agentActor(agentID)
	if got, added, err := docs.newBodyMentionRecipients(ctx, x.tools.q, agent, v.Document, v.Document.Content, bodyMentionJSON(member.UserID)); err != nil || len(got) != 0 || added != 0 {
		t.Fatalf("autonomous agent recipients = %v (%d), %v, want none", got, added, err)
	}
	if _, err := docs.UpdateDocument(ctx, agent, v.Document.ID, UpdateDocumentInput{
		Revision: v.Document.Revision, Content: bodyMentionJSON(member.UserID),
	}); !isGateRefusal(err) {
		t.Fatalf("autonomous agent save = %v, want a gate refusal", err)
	}
	if n := x.count(t, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`, bodyMentionTopic, v.Document.ID); n != 0 {
		t.Fatalf("autonomous agent emitted %d body-mention events, want 0", n)
	}

	via := audit.Via{Kind: "mcp", ClientID: "c1", GrantID: "g1", ClientName: "Claude"}
	mcpCtx := audit.WithVia(ctx, via)
	md := "Nhờ [@Bình](uniwork://user/" + member.UserID + ") kiểm tra"
	if _, err := x.callCtx(t, mcpCtx, x.p, "update_document", map[string]any{
		"workspace_id": x.w.ID,
		"document_id":  v.Document.ID,
		"revision":     v.Document.Revision,
		"content":      md,
	}); err != nil {
		t.Fatalf("update_document: %v", err)
	}

	rows, err := x.tools.ask.pool.Query(ctx,
		`SELECT payload, coalesce(actor_kind, ''), coalesce(actor_id, '') FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2 ORDER BY id`,
		bodyMentionTopic, v.Document.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var payloads []map[string]string
	var actorKinds, actorIDs []string
	for rows.Next() {
		var raw, ak, aid string
		if err := rows.Scan(&raw, &ak, &aid); err != nil {
			t.Fatal(err)
		}
		var p map[string]string
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatal(err)
		}
		payloads = append(payloads, p)
		actorKinds = append(actorKinds, ak)
		actorIDs = append(actorIDs, aid)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(payloads) != 1 {
		t.Fatalf("MCP update_document body-mention events = %+v, want 1", payloads)
	}
	want := map[string]string{
		"document_id":  v.Document.ID,
		"workspace_id": x.w.ID,
		"user_id":      member.UserID,
		"author_id":    x.ua.ID,
	}
	if len(payloads[0]) != len(want) {
		t.Fatalf("MCP event payload = %+v, want %+v", payloads[0], want)
	}
	for k, w := range want {
		if payloads[0][k] != w {
			t.Fatalf("MCP event payload[%q] = %q, want %q (%+v)", k, payloads[0][k], w, payloads[0])
		}
	}
	if actorKinds[0] != "human" || actorIDs[0] != x.ua.ID {
		t.Fatalf("MCP event actor = %s/%s, want human/%s", actorKinds[0], actorIDs[0], x.ua.ID)
	}
}

// A folder or file document never carries content, so the walker is not
// reached; a page saved with no mention diff emits nothing.
func TestDocumentBodyMentionNoMentionContent(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "bmnp")
	actor := Human(tn.aclOwner.ID)
	d := bodyMentionPage(t, f, tn)

	savePage(t, f, actor, d.ID, pageJSON("Chỉ là chữ."))
	if n := len(bodyMentionPayloads(t, f, d.ID)); n != 0 {
		t.Fatalf("a page without mentions emitted %d events", n)
	}
	if meta := documentUpdatedMetadata(t, f, d.ID); meta["mentions_added"] != float64(0) {
		t.Fatalf("mentions_added = %v, want 0", meta["mentions_added"])
	}
}
