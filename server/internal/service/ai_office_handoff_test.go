package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func handoffLines(format string, n int) string {
	lines := make([]string, n)
	for i := range lines {
		lines[i] = fmt.Sprintf(format, i+1)
	}
	return strings.Join(lines, "\n")
}

func TestHandoffPartsSplitsTheOutline(t *testing.T) {
	var headings []string
	for k := 1; k <= 5; k++ {
		headings = append(headings, fmt.Sprintf("## Mục %d\n- a%d\n- b%d", k, k, k))
	}
	counts := func(parts []string, sep string) []int {
		out := make([]int, len(parts))
		for i, p := range parts {
			out[i] = strings.Count(p, sep)
		}
		return out
	}

	if got := handoffParts(""); !reflect.DeepEqual(got, []string{""}) {
		t.Fatalf("empty outline: %q", got)
	}

	got := handoffParts(handoffLines("- Slide %d", 10))
	if want := []int{3, 3, 3, 1}; !reflect.DeepEqual(counts(got, "- Slide"), want) {
		t.Fatalf("10 bullets: %v", counts(got, "- Slide"))
	}

	got = handoffParts(strings.Join(headings, "\n"))
	if want := []int{3, 2}; !reflect.DeepEqual(counts(got, "## Mục"), want) {
		t.Fatalf("5 headings: %v", counts(got, "## Mục"))
	}
	if !strings.Contains(got[0], "- a3") || strings.Contains(got[0], "- a4") || !strings.Contains(got[1], "- b5") {
		t.Fatalf("sub-lines must stay with their heading: %q", got)
	}

	got = handoffParts("Mở đầu\n" + strings.Join(headings, "\n"))
	if !strings.HasPrefix(got[0], "Mở đầu\n## Mục 1") || len(got) != 2 {
		t.Fatalf("preface: %q", got)
	}

	got = handoffParts(handoffLines("%d. Việc", 30))
	if len(got) != 8 {
		t.Fatalf("30 numbered: %d parts", len(got))
	}
	if want := []int{4, 4, 4, 4, 4, 4, 4, 2}; !reflect.DeepEqual(counts(got, ". Việc"), want) {
		t.Fatalf("30 numbered: %v", counts(got, ". Việc"))
	}

	got = handoffParts("  Một đoạn văn dài.\nKhông có danh sách.  \n")
	if want := []string{"Một đoạn văn dài.\nKhông có danh sách."}; !reflect.DeepEqual(got, want) {
		t.Fatalf("paragraph: %q", got)
	}
}

func newTestHandoff(t *testing.T, q *db.Queries, in NewOfficeHandoff, now time.Time) OfficeHandoff {
	t.Helper()
	h, err := createOfficeHandoff(context.Background(), q, in, now)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func testHandoffInput(outline string) NewOfficeHandoff {
	return NewOfficeHandoff{
		OrganizationID: util.NewID(), WorkspaceID: util.NewID(), UserID: util.NewID(),
		DocumentID: util.NewID(), ProposalID: util.NewID(), Format: "docx",
		Title: "Báo cáo", Request: "Soạn báo cáo", Outline: outline,
		Sources: []OfficeHandoffSource{{Kind: "document", ID: util.NewID(), Title: "Tư liệu", Quote: "trích"}},
	}
}

func TestOfficeHandoffLoadIsScopedToItsAskerAndDocument(t *testing.T) {
	q := db.New(testutil.DB(t))
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	in := testHandoffInput("- a\n- b\n- c\n- d")
	h := newTestHandoff(t, q, in, now)

	for name, call := range map[string]func() (OfficeHandoff, error){
		"other user": func() (OfficeHandoff, error) {
			return loadOfficeHandoff(ctx, q, h.ID, in.OrganizationID, util.NewID(), in.DocumentID, "", now)
		},
		"other document": func() (OfficeHandoff, error) {
			return loadOfficeHandoff(ctx, q, h.ID, in.OrganizationID, in.UserID, util.NewID(), "", now)
		},
		"other org": func() (OfficeHandoff, error) {
			return loadOfficeHandoff(ctx, q, h.ID, util.NewID(), in.UserID, in.DocumentID, "", now)
		},
		"expired": func() (OfficeHandoff, error) {
			return loadOfficeHandoff(ctx, q, h.ID, in.OrganizationID, in.UserID, in.DocumentID, "", h.ExpiresAt)
		},
	} {
		if _, err := call(); !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s: err = %v, want ErrNotFound", name, err)
		}
	}

	got, err := loadOfficeHandoff(ctx, q, h.ID, in.OrganizationID, in.UserID, in.DocumentID, "", now)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got.Parts, h.Parts) || !reflect.DeepEqual(got.Sources, in.Sources) {
		t.Fatalf("round trip: %+v", got)
	}
	if !got.ExpiresAt.Equal(now.Add(officeHandoffTTL)) {
		t.Fatalf("expires %v", got.ExpiresAt)
	}
}

func TestOfficeHandoffAdvanceBindsOneConversation(t *testing.T) {
	q := db.New(testutil.DB(t))
	ctx := context.Background()
	now := time.Now().UTC()
	in := testHandoffInput("- a\n- b\n- c\n- d")
	h := newTestHandoff(t, q, in, now)
	if len(h.Parts) != 2 {
		t.Fatalf("want 2 parts, got %d", len(h.Parts))
	}
	load := func(conv string) (OfficeHandoff, error) {
		return loadOfficeHandoff(ctx, q, h.ID, in.OrganizationID, in.UserID, in.DocumentID, conv, now)
	}

	ok, err := advanceOfficeHandoff(ctx, q, h, "c1", now)
	if err != nil || !ok {
		t.Fatalf("first advance: %v %v", ok, err)
	}
	cur, err := load("c1")
	if err != nil || cur.NextPart != 1 || cur.ConversationID != "c1" {
		t.Fatalf("after advance: %+v %v", cur, err)
	}
	if _, err := load("c2"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other conversation: %v", err)
	}
	if ok, err := advanceOfficeHandoff(ctx, q, h, "c1", now); err != nil || ok {
		t.Fatalf("stale advance: %v %v", ok, err)
	}
	if ok, err := advanceOfficeHandoff(ctx, q, cur, "c2", now); err != nil || ok {
		t.Fatalf("advance from another conversation: %v %v", ok, err)
	}
	if ok, err := advanceOfficeHandoff(ctx, q, cur, "c1", now); err != nil || !ok {
		t.Fatalf("second advance: %v %v", ok, err)
	}
	if _, err := load("c1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("exhausted package: %v", err)
	}
}

func TestOfficeHandoffSweeperDeletesOnlyExpiredRows(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()
	now := time.Now().UTC()
	old := testHandoffInput("- a")
	fresh := testHandoffInput("- a")
	oldH := newTestHandoff(t, q, old, now.Add(-2*officeHandoffTTL))
	freshH := newTestHandoff(t, q, fresh, now)

	n, err := NewOfficeHandoffSweeper(q, nil).Sweep(ctx)
	if err != nil || n < 1 {
		t.Fatalf("sweep: %d %v", n, err)
	}
	if _, err := loadOfficeHandoff(ctx, q, freshH.ID, fresh.OrganizationID, fresh.UserID, fresh.DocumentID, "", now); err != nil {
		t.Fatalf("fresh row: %v", err)
	}
	if _, err := q.AiGetOfficeHandoff(ctx, db.AiGetOfficeHandoffParams{ID: oldH.ID, OrganizationID: old.OrganizationID}); err == nil {
		t.Fatal("expired row survived")
	}
}
