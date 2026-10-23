package notification

import (
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// breakGlassNotifications lists a user's document_break_glass notifications.
func (f *documentFixture) breakGlassNotifications(t *testing.T, userID string) []map[string]string {
	t.Helper()
	var out []map[string]string
	for _, n := range f.inbox(t, userID) {
		if n.Kind != KindDocumentBreakGlass {
			continue
		}
		params := map[string]string{}
		if err := json.Unmarshal([]byte(n.Params), &params); err != nil {
			t.Fatal(err)
		}
		params["_resource_id"] = n.ResourceID
		out = append(out, params)
	}
	return out
}

// TestBreakGlassGrantNotifiesTheOwner is DOC-05's "Thông báo chủ": opening
// emergency access to a restricted document notifies the ACL owner once (ids,
// the two names the title renders, never the reason); without an ACL owner the
// workspace owners hear instead; the admin who opened it hears nothing; and an
// idempotent second grant and a redelivered event add nothing.
func TestBreakGlassGrantNotifiesTheOwner(t *testing.T) {
	f := newDocumentFixture(t)
	admin := f.addMember(t, "bg-admin@example.com", "Quản Trị")
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`, f.wsID, admin.ID); err != nil {
		t.Fatal(err)
	}
	bystander := f.addMember(t, "bg-member@example.com", "Thành Viên Khác")
	const reason = "Kiểm tra hợp đồng theo yêu cầu của kiểm toán"
	docID := f.document(t, "restricted", `Hợp đồng "A" & <B>`)

	grant, created, err := f.docs.GrantDocumentBreakGlass(f.ctx, service.Human(admin.ID), docID, reason)
	if err != nil || !created {
		t.Fatalf("grant: %+v, created=%v, %v", grant, created, err)
	}
	pushBefore := len(f.events(t, TopicPush))
	f.handleLast(t, "document.break_glass_granted")

	got := f.breakGlassNotifications(t, f.owner.ID)
	if len(got) != 1 {
		t.Fatalf("ACL owner notifications = %v, want one", got)
	}
	p := got[0]
	if p["document_id"] != docID || p["grant_id"] != grant.Grant.ID || p["_resource_id"] != docID ||
		p["actor"] != admin.DisplayName || p["document"] != `Hợp đồng "A" & <B>` {
		t.Fatalf("notification params = %v", p)
	}
	for k, v := range p {
		if v == reason || k == "reason" {
			t.Fatalf("the reason leaked into the notification params: %v", p)
		}
	}
	if n := len(f.events(t, TopicPush)) - pushBefore; n != 1 {
		t.Fatalf("push events = %d, want 1 (push is on by default)", n)
	}
	for name, uid := range map[string]string{"admin": admin.ID, "bystander": bystander.ID} {
		if kinds := f.inboxKinds(t, uid); len(kinds) != 0 {
			t.Fatalf("%s inbox = %v, want empty", name, kinds)
		}
	}

	// A redelivered event reaches nobody twice; an idempotent second grant
	// emits no event at all.
	f.handleLast(t, "document.break_glass_granted")
	if again, created, err := f.docs.GrantDocumentBreakGlass(f.ctx, service.Human(admin.ID), docID, reason); err != nil || created || again.Grant.ID != grant.Grant.ID {
		t.Fatalf("second grant: %+v, created=%v, %v", again, created, err)
	}
	if n := len(f.events(t, "document.break_glass_granted")); n != 1 {
		t.Fatalf("granted events = %d, want 1", n)
	}
	if got := f.breakGlassNotifications(t, f.owner.ID); len(got) != 1 {
		t.Fatalf("ACL owner notifications after redelivery = %v, want one", got)
	}

	t.Run("no ACL owner: the workspace owners hear", func(t *testing.T) {
		second := f.addMember(t, "bg-owner2@example.com", "Chủ Thứ Hai")
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE workspace_members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2`, f.wsID, second.ID); err != nil {
			t.Fatal(err)
		}
		orphan := f.document(t, "restricted", "Không có chủ ACL")
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET acl_owner_id = NULL WHERE id = $1`, orphan); err != nil {
			t.Fatal(err)
		}
		g, created, err := f.docs.GrantDocumentBreakGlass(f.ctx, service.Human(admin.ID), orphan, reason)
		if err != nil || !created {
			t.Fatalf("grant: %+v, created=%v, %v", g, created, err)
		}
		f.handleLast(t, "document.break_glass_granted")
		for name, uid := range map[string]string{"first owner": f.owner.ID, "second owner": second.ID} {
			n := 0
			for _, p := range f.breakGlassNotifications(t, uid) {
				if p["document_id"] == orphan && p["grant_id"] == g.Grant.ID {
					n++
				}
			}
			if n != 1 {
				t.Fatalf("%s notifications for the orphan document = %d, want 1", name, n)
			}
		}
		if got := f.breakGlassNotifications(t, admin.ID); len(got) != 0 {
			t.Fatalf("the admin who opened it was notified: %v", got)
		}
	})
}
