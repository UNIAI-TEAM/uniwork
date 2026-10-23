package service

// G1-05b BE05B-04 (Advisor-approved bounded service delta): shared-with-me
// walks share candidates by keyset, filters each with the existing
// effective-level check, and never lets a denied candidate consume a result
// slot. The candidate page size is shrunk so a handful of rows exercises the
// multi-page walk.

import (
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDocumentSharedWithMeKeysetWalk(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "swmwalk")

	oldPage := sharedWithMeCandidatePage
	sharedWithMeCandidatePage = 2
	t.Cleanup(func() { sharedWithMeCandidatePage = oldPage })

	// Visible candidates first: restricted documents shared directly with
	// the member resolve via share.
	visible := make([]db.Document, 0, 3)
	for i := 0; i < 3; i++ {
		d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, d, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
		visible = append(visible, d)
	}
	// Denied candidates created afterwards (so they sort FIRST, ahead of the
	// visible ones): a workspace share on a workspace-visible document gives
	// the member nothing above their membership level, so effectiveLevel
	// answers via=member and the row is not "shared with me".
	for i := 0; i < 2; i++ {
		d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, d, DocumentPrincipalWorkspace, tn.wsA, DocumentLevelView, tn.aclOwner.ID)
	}

	seen := map[string]bool{}
	after := SharedWithMeQuery{Limit: 2}
	pages := 0
	for {
		if pages > 6 {
			t.Fatal("shared-with-me walk did not terminate")
		}
		page, err := f.svc.ListSharedWithMe(f.ctx, tn.member.ID, tn.orgID, after)
		if err != nil {
			t.Fatal(err)
		}
		pages++
		if len(page.Items) > 2 {
			t.Fatalf("page %d returned %d rows, over limit", pages, len(page.Items))
		}
		for _, r := range page.Items {
			if r.Access.Via != DocumentViaShare || r.Access.Level == DocumentLevelNone {
				t.Fatalf("page %d non-share row: %+v", pages, r.Access)
			}
			if seen[r.Document.ID] {
				t.Fatalf("cursor repeated %s on page %d", r.Document.ID, pages)
			}
			seen[r.Document.ID] = true
		}
		if page.NextID == "" {
			break
		}
		after = SharedWithMeQuery{Limit: 2, AfterCreatedAt: page.NextCreatedAt, AfterID: page.NextID}
	}
	if len(seen) != len(visible) {
		t.Fatalf("walk saw %d rows, want %d", len(seen), len(visible))
	}
	for _, d := range visible {
		if !seen[d.ID] {
			t.Fatalf("visible document %s missing from the walk", d.ID)
		}
	}
}

// EffectiveSharedWithMeLimit is the route-visible clamp; the HTTP layer reads
// it instead of hard-coding a second copy of the rule.
func TestEffectiveSharedWithMeLimit(t *testing.T) {
	for _, tc := range []struct{ in, want int }{{0, 50}, {-3, 50}, {1, 1}, {50, 50}, {100, 100}, {101, 100}} {
		if got := EffectiveSharedWithMeLimit(tc.in); got != tc.want {
			t.Fatalf("EffectiveSharedWithMeLimit(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}
}
