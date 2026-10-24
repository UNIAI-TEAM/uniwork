package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type memoryFlagFake struct{ on bool }

func (f memoryFlagFake) IsEnabled(_ context.Context, key string, def bool) bool {
	if key == askMemoryFlag {
		return f.on
	}
	return def
}

// memoryWorld is two members of one organization and the service with the flag on.
func memoryWorld(t *testing.T) (*AiMemoryService, *mcpToolWorld) {
	t.Helper()
	x, s, _ := askWriteWorld(t)
	m := NewAiMemoryService(s.pool, s.q, s.orgs, s.ws)
	m.SetFlags(memoryFlagFake{on: true})
	return m, x
}

func memCode(t *testing.T, err error, code string) {
	t.Helper()
	if got := codeOf(err); got != code {
		t.Fatalf("error code = %q (%v), want %q", got, err, code)
	}
}

func TestAiMemoryCreateListUpdateDelete(t *testing.T) {
	ctx := context.Background()
	m, x := memoryWorld(t)
	org, u := x.w.OrganizationID, x.ua.ID
	fact, err := m.Create(ctx, u, org, "fact", "Tôi làm ở phòng Kinh doanh")
	if err != nil {
		t.Fatal(err)
	}
	pref, err := m.Create(ctx, u, org, "preference", "Trả lời ngắn")
	if err != nil {
		t.Fatal(err)
	}
	l, err := m.List(ctx, u, org)
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Entries) != 2 || l.Entries[0].ID != pref.ID || l.Remaining != 48 || !l.On || l.Limit != 50 {
		t.Fatalf("list = %+v", l)
	}
	txt := "Tôi làm ở phòng Nhân sự"
	up, err := m.Update(ctx, u, org, fact.ID, nil, &txt)
	if err != nil || up.Body != txt || up.Kind != "fact" {
		t.Fatalf("update = %+v, %v", up, err)
	}
	if err := m.Delete(ctx, u, org, fact.ID); err != nil {
		t.Fatal(err)
	}
	n, err := m.Clear(ctx, u, org)
	if err != nil || n != 1 {
		t.Fatalf("clear = %d, %v", n, err)
	}
}

func TestAiMemoryValidatesText(t *testing.T) {
	ctx := context.Background()
	m, x := memoryWorld(t)
	org, u := x.w.OrganizationID, x.ua.ID
	for _, bad := range []string{"", "   ", strings.Repeat("a", 301), "hai\ndòng", "chuông\x07", "hai dòng"} {
		if _, err := m.Create(ctx, u, org, "fact", bad); !errors.As(err, new(ValidationError)) {
			t.Errorf("Create(%q) = %v, want a validation error", bad, err)
		}
	}
	// 300 runes, every other one a combining accent: counts runes, not graphemes.
	if _, err := m.Create(ctx, u, org, "fact", strings.Repeat("é", 150)); err != nil {
		t.Fatalf("300 runes refused: %v", err)
	}
	if _, err := m.Create(ctx, u, org, "people", "x"); !errors.As(err, new(ValidationError)) {
		t.Fatalf("kind people = %v", err)
	}
}

func TestAiMemoryRefusesDuplicates(t *testing.T) {
	ctx := context.Background()
	m, x := memoryWorld(t)
	org, u := x.w.OrganizationID, x.ua.ID
	first, err := m.Create(ctx, u, org, "preference", "Trả lời ngắn")
	if err != nil {
		t.Fatal(err)
	}
	_, err = m.Create(ctx, u, org, "fact", "  tra LOI  ngan ")
	memCode(t, err, "ai_memory_duplicate")
	other, err := m.Create(ctx, u, org, "fact", "Khác hẳn")
	if err != nil {
		t.Fatal(err)
	}
	dup := "tra loi ngan"
	_, err = m.Update(ctx, u, org, other.ID, nil, &dup)
	memCode(t, err, "ai_memory_duplicate")
	// An entry may be saved as itself.
	same := "Trả lời ngắn "
	if _, err := m.Update(ctx, u, org, first.ID, nil, &same); err != nil {
		t.Fatal(err)
	}
}

func TestAiMemoryCapHoldsUnderConcurrency(t *testing.T) {
	ctx := context.Background()
	m, x := memoryWorld(t)
	org, u := x.w.OrganizationID, x.ua.ID
	for i := 0; i < 49; i++ {
		if _, err := m.Create(ctx, u, org, "fact", "mục số "+strings.Repeat("x", i+1)); err != nil {
			t.Fatal(err)
		}
	}
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = m.Create(ctx, u, org, "fact", "song song "+string(rune('a'+i)))
		}()
	}
	wg.Wait()
	full := 0
	for _, e := range errs {
		if codeOf(e) == "ai_memory_full" {
			full++
		} else if e != nil {
			t.Fatal(e)
		}
	}
	n, err := m.q.AiCountMemories(ctx, db.AiCountMemoriesParams{OrganizationID: org, UserID: u})
	if err != nil || full != 1 || n != 50 {
		t.Fatalf("full=%d count=%d err=%v", full, n, err)
	}
}

func TestAiMemoryIsPrivateToItsOwner(t *testing.T) {
	ctx := context.Background()
	m, x := memoryWorld(t)
	org := x.w.OrganizationID
	mine, err := m.Create(ctx, x.ua.ID, org, "fact", "chuyện riêng của A")
	if err != nil {
		t.Fatal(err)
	}
	theirs, err := m.Create(ctx, x.ub.ID, org, "fact", "chuyện riêng của B")
	if err != nil {
		t.Fatal(err)
	}
	txt := "đổi"
	if _, err := m.Update(ctx, x.ub.ID, org, mine.ID, nil, &txt); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update other's = %v", err)
	}
	if err := m.Delete(ctx, x.ua.ID, org, theirs.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete other's = %v", err)
	}
	if err := m.Delete(ctx, x.ua.ID, org, "no-such-id"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete unknown = %v", err)
	}
	l, err := m.List(ctx, x.ub.ID, org)
	if err != nil || len(l.Entries) != 1 || l.Entries[0].ID != theirs.ID {
		t.Fatalf("list = %+v, %v", l, err)
	}
}

func TestAiMemoryFlagOffRefuses(t *testing.T) {
	ctx := context.Background()
	m, x := memoryWorld(t)
	org, u := x.w.OrganizationID, x.ua.ID
	e, err := m.Create(ctx, u, org, "fact", "có trước")
	if err != nil {
		t.Fatal(err)
	}
	m.SetFlags(memoryFlagFake{on: false})
	txt := "đổi"
	_, e1 := m.List(ctx, u, org)
	_, e2 := m.Create(ctx, u, org, "fact", "mới")
	_, e3 := m.Update(ctx, u, org, e.ID, nil, &txt)
	e4 := m.Delete(ctx, u, org, e.ID)
	_, e5 := m.Clear(ctx, u, org)
	e6 := m.SetOn(ctx, u, false)
	for i, err := range []error{e1, e2, e3, e4, e5, e6} {
		if codeOf(err) != "ai_memory_disabled" {
			t.Errorf("command %d: %v", i, err)
		}
	}
}

func TestAiMemorySetOn(t *testing.T) {
	ctx := context.Background()
	m, x := memoryWorld(t)
	org, u := x.w.OrganizationID, x.ua.ID
	if err := m.SetOn(ctx, u, false); err != nil {
		t.Fatal(err)
	}
	if l, _ := m.List(ctx, u, org); l.On {
		t.Fatal("still on")
	}
	if err := m.SetOn(ctx, u, true); err != nil {
		t.Fatal(err)
	}
	if l, _ := m.List(ctx, u, org); !l.On {
		t.Fatal("still off")
	}
}

func TestAiMemoryAuditCarriesNoText(t *testing.T) {
	ctx := context.Background()
	m, x := memoryWorld(t)
	org, u := x.w.OrganizationID, x.ua.ID
	secret, secret2 := "mật khẩu cũ là cam", "mật khẩu mới là quýt"
	e, err := m.Create(ctx, u, org, "fact", secret)
	if err != nil {
		t.Fatal(err)
	}
	kind := "preference"
	if _, err := m.Update(ctx, u, org, e.ID, &kind, &secret2); err != nil {
		t.Fatal(err)
	}
	if err := m.Delete(ctx, u, org, e.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Create(ctx, u, org, "fact", secret); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Clear(ctx, u, org); err != nil {
		t.Fatal(err)
	}
	rows, err := m.q.ListAuditEvents(ctx, db.ListAuditEventsParams{OrganizationID: org, LimitN: 200})
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]int{}
	for _, r := range rows {
		if !strings.HasPrefix(r.Action, "ai_memory.") {
			continue
		}
		seen[r.Action]++
		blob := string(r.Changes) + string(r.Metadata)
		for _, w := range []string{"cam", "quýt", "mật khẩu"} {
			if strings.Contains(blob, w) {
				t.Errorf("%s audit row carries %q: %s", r.Action, w, blob)
			}
		}
		if r.Action != audit.ActionAIMemoryCleared {
			for _, k := range []string{`"chars"`, `"kind"`, `"source"`} {
				if !strings.Contains(string(r.Metadata), k) {
					t.Errorf("%s metadata lacks %s: %s", r.Action, k, r.Metadata)
				}
			}
		} else if !strings.Contains(string(r.Metadata), `"count"`) {
			t.Errorf("cleared metadata lacks count: %s", r.Metadata)
		}
	}
	for _, a := range []string{audit.ActionAIMemoryCreated, audit.ActionAIMemoryUpdated, audit.ActionAIMemoryDeleted, audit.ActionAIMemoryCleared} {
		if seen[a] == 0 {
			t.Errorf("no %s row", a)
		}
	}
}
