package notification

import (
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The read/mark surface: a foreign id is a 404 for the whole request and
// changes nothing; resource_deleted is resolved for the page; the badge
// counts per workspace.
func TestServiceInboxAndIsolation(t *testing.T) {
	f := newFixture(t)
	svc := NewService(f.q, PushConfig{})
	for _, title := range []string{"Một", "Hai"} {
		task := f.newTask(t, title)
		f.assign(t, task.ID, f.member.ID)
		f.handleLast(t, "task.updated")
	}
	// Delete the second task: its row stays, flagged.
	if err := f.tasks.Delete(f.ctx, f.owner.ID, f.inbox(t, f.member.ID)[0].ResourceID); err != nil {
		t.Fatal(err)
	}
	items, err := svc.List(f.ctx, f.member.ID, ListInput{WorkspaceID: f.wsID, Limit: 500})
	if err != nil || len(items) != 2 || !items[0].ResourceDeleted || items[1].ResourceDeleted {
		t.Fatalf("list = %+v err=%v", items, err)
	}
	count, err := svc.UnreadCount(f.ctx, f.member.ID)
	if err != nil || count.Total != 2 || count.ByWorkspace[f.wsID] != 2 {
		t.Fatalf("unread = %+v err=%v", count, err)
	}
	ids := []string{items[0].ID, items[1].ID}

	if err := svc.MarkRead(f.ctx, f.owner.ID, ids); !errors.Is(err, service.ErrNotFound) {
		t.Fatalf("foreign mark read = %v", err)
	}
	if err := svc.MarkRead(f.ctx, f.member.ID, nil); err == nil {
		t.Fatal("empty ids accepted")
	}
	if c, _ := svc.UnreadCount(f.ctx, f.member.ID); c.Total != 2 {
		t.Fatal("foreign mark changed the badge")
	}
	if err := svc.MarkRead(f.ctx, f.member.ID, ids[:1]); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkUnread(f.ctx, f.member.ID, ids[:1]); err != nil {
		t.Fatal(err)
	}
	if n, err := svc.MarkAllRead(f.ctx, f.member.ID, f.wsID); err != nil || n != 2 {
		t.Fatalf("mark all = %d %v", n, err)
	}
	unread, _ := svc.List(f.ctx, f.member.ID, ListInput{UnreadOnly: true})
	if len(unread) != 0 {
		t.Fatalf("unread after mark all = %d", len(unread))
	}
	if err := svc.Archive(f.ctx, f.member.ID, ids); err != nil {
		t.Fatal(err)
	}
	if rest, _ := svc.List(f.ctx, f.member.ID, ListInput{}); len(rest) != 0 {
		t.Fatalf("archived rows listed: %d", len(rest))
	}
	if err := svc.Archive(f.ctx, f.owner.ID, ids); !errors.Is(err, service.ErrNotFound) {
		t.Fatalf("foreign archive = %v", err)
	}
}

func TestServicePreferencesAndPush(t *testing.T) {
	f := newFixture(t)
	svc := NewService(f.q, PushConfig{})
	rows, err := svc.Preferences(f.ctx, f.member.ID)
	if err != nil || len(rows) != len(Kinds) || !rows[0].Push || rows[1].Push {
		t.Fatalf("defaults = %+v err=%v", rows, err)
	}
	if _, err := svc.SetPreferences(f.ctx, f.member.ID, []KindPrefs{{Kind: "bogus"}}); err == nil {
		t.Fatal("bogus kind accepted")
	}
	rows, err = svc.SetPreferences(f.ctx, f.member.ID, []KindPrefs{{Kind: KindTaskAssigned, Prefs: Prefs{InApp: true}}})
	if err != nil || rows[0].Push || rows[0].Email || !ValidKind(rows[0].Kind) {
		t.Fatalf("after set = %+v err=%v", rows, err)
	}
	if !svc.PushConfig().Enabled {
		// Push is off on this service: subscribing is a not_found.
		if err := svc.SubscribePush(f.ctx, f.member.ID, "https://p/x", "p", "a", "ua"); !errors.Is(err, service.ErrNotFound) {
			t.Fatalf("subscribe with push off = %v", err)
		}
	}
	on := NewService(f.q, PushConfig{Enabled: true, PublicKey: "BOr"})
	if err := on.SubscribePush(f.ctx, f.member.ID, "http://insecure", "p", "a", ""); err == nil {
		t.Fatal("insecure endpoint accepted")
	}
	if err := on.SubscribePush(f.ctx, f.member.ID, "https://p/x", "p", "a", "ua"); err != nil {
		t.Fatal(err)
	}
	if subs, _ := f.q.ListActivePushSubscriptions(f.ctx, f.member.ID); len(subs) != 1 {
		t.Fatalf("subscriptions = %d", len(subs))
	}
	if err := on.UnsubscribePush(f.ctx, f.member.ID, "https://p/x"); err != nil {
		t.Fatal(err)
	}
	if subs, _ := f.q.ListActivePushSubscriptions(f.ctx, f.member.ID); len(subs) != 0 {
		t.Fatal("unsubscribe left the row active")
	}
	_ = db.PushSubscription{}
}
