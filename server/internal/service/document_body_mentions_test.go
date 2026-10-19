package service

// UNI-1968 (BODY-MENTION-NOTIFY, S6): a mention typed into a UniNote page body
// notifies the people the save newly names. The diff runs inside the save
// transaction against the previous saved content, so saving the same content
// again says nothing, removing a mention and adding it back notifies again, and
// a mention of the saving actor, of an agent, of somebody who cannot read the
// document or of an id from another organization never becomes an event. A
// content-only save still fans out no document.updated frame.

import (
	"encoding/json"
	"fmt"
	"testing"

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

// One save notifies at most maxBodyMentionsPerSave people; the audit metadata
// carries how many the save newly named.
func TestDocumentBodyMentionCap(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "bmnc")
	actor := Human(tn.aclOwner.ID)
	d := bodyMentionPage(t, f, tn)

	ids := addBulkReaders(t, f, tn.orgID, tn.wsA, maxBodyMentionsPerSave+5)
	savePage(t, f, actor, d.ID, bodyMentionJSON(ids...))

	got := bodyMentionUserIDsOf(t, f, d.ID)
	if len(got) != maxBodyMentionsPerSave {
		t.Fatalf("events = %d, want the cap of %d", len(got), maxBodyMentionsPerSave)
	}
	for i, id := range got {
		if id != ids[i] {
			t.Fatalf("event %d = %s, want %s (document order up to the cap)", i, id, ids[i])
		}
	}
	if meta := documentUpdatedMetadata(t, f, d.ID); meta["mentions_added"] != float64(len(ids)) {
		t.Fatalf("mentions_added = %v, want %d (the count before the cap)", meta["mentions_added"], len(ids))
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
