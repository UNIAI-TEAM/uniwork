package notification

// BE-R2-4 (UNI-2056 review r2): the tenant-pair guard of the rule path and
// the per-command memo.

import (
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// An event whose organization or workspace is not the document's own drafts
// nothing, whatever the payload names: the facts are read by id, so the pair
// on the row is the only thing that ties the event to the document's tenant.
func TestDocumentChangedEventOfAnotherTenantDraftsNothing(t *testing.T) {
	f := newDocChangeFixture(t)
	docID := f.sharedPage(t, "Của workspace này")
	payload := map[string]string{"document_id": docID, "workspace_id": f.wsID, "verb": "renamed"}

	event := func(mutate func(*pgtype.Text, *pgtype.Text)) {
		ev := f.editEvent(t, docChangeTopic, f.member.ID, util.NewID(), payload)
		mutate(&ev.OrganizationID, &ev.WorkspaceID)
		f.handleEdit(t, ev)
	}
	other := func(id string) pgtype.Text { return pgtype.Text{String: id, Valid: true} }

	event(func(org, _ *pgtype.Text) { *org = other(util.NewID()) })
	event(func(_, ws *pgtype.Text) { *ws = other(util.NewID()) })
	f.none(t, f.owner.ID, f.sharee.ID, f.starrer.ID)

	// The control: the same event with the document's own pair drafts.
	event(func(*pgtype.Text, *pgtype.Text) {})
	f.one(t, f.sharee.ID, "renamed", 1)
}

func TestDocCommandMemo(t *testing.T) {
	clock := time.Date(2026, 10, 21, 8, 0, 0, 0, time.UTC)
	newMemo := func() *docCommandMemo {
		m := newDocCommandMemo()
		m.now = func() time.Time { return clock }
		return m
	}
	counting := func(calls *int, ids ...string) func() ([]string, error) {
		return func() ([]string, error) {
			*calls++
			return ids, nil
		}
	}

	t.Run("an answer is loaded once inside the TTL", func(t *testing.T) {
		m, calls := newMemo(), 0
		for i := 0; i < 3; i++ {
			got, err := m.ids("k", counting(&calls, "a", "b"))
			if err != nil || len(got) != 2 {
				t.Fatalf("ids = %v, %v", got, err)
			}
		}
		if calls != 1 {
			t.Fatalf("loads = %d, want 1", calls)
		}
		if _, err := m.ids("other", counting(&calls, "c")); err != nil || calls != 2 {
			t.Fatalf("another key must load on its own: calls = %d, err = %v", calls, err)
		}
	})

	t.Run("an answer expires after the TTL and is loaded again", func(t *testing.T) {
		m, calls := newMemo(), 0
		start := clock
		if _, err := m.ids("k", counting(&calls, "old")); err != nil {
			t.Fatal(err)
		}
		clock = start.Add(docCommandMemoTTL - time.Second)
		if got, _ := m.ids("k", counting(&calls, "new")); calls != 1 || got[0] != "old" {
			t.Fatalf("inside the TTL: calls = %d, ids = %v, want the remembered answer", calls, got)
		}
		clock = start.Add(docCommandMemoTTL)
		got, err := m.ids("k", counting(&calls, "new"))
		if err != nil || calls != 2 || got[0] != "new" {
			t.Fatalf("at the TTL: calls = %d, ids = %v, err = %v, want a reload", calls, got, err)
		}
		clock = start
	})

	t.Run("a sweep drops what expired", func(t *testing.T) {
		m, calls := newMemo(), 0
		start := clock
		if _, err := m.ids("old", counting(&calls, "x")); err != nil {
			t.Fatal(err)
		}
		clock = start.Add(2 * docCommandMemoTTL)
		if _, err := m.ids("fresh", counting(&calls, "y")); err != nil {
			t.Fatal(err)
		}
		if _, kept := m.seen["old"]; kept || len(m.seen) != 1 {
			t.Fatalf("seen after the sweep = %v, want only the fresh key", m.seen)
		}
		clock = start
	})

	t.Run("a failed load is not remembered", func(t *testing.T) {
		m, calls := newMemo(), 0
		boom := errors.New("read failed")
		if _, err := m.ids("k", func() ([]string, error) { calls++; return nil, boom }); !errors.Is(err, boom) {
			t.Fatalf("err = %v, want the load error", err)
		}
		got, err := m.ids("k", counting(&calls, "a"))
		if err != nil || calls != 2 || len(got) != 1 {
			t.Fatalf("after a failure: calls = %d, ids = %v, err = %v, want a fresh load", calls, got, err)
		}
	})

	t.Run("a nil memo always loads", func(t *testing.T) {
		var m *docCommandMemo
		calls := 0
		for i := 0; i < 2; i++ {
			if _, err := m.ids("k", counting(&calls, "a")); err != nil {
				t.Fatal(err)
			}
		}
		if calls != 2 {
			t.Fatalf("loads = %d, want 2", calls)
		}
	})
}
