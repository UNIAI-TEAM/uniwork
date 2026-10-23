package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// countingDBTX counts the statements a function sends through it.
type countingDBTX struct {
	db.DBTX
	statements int
}

func (c *countingDBTX) Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error) {
	c.statements++
	return c.DBTX.Exec(ctx, sql, args...)
}

func (c *countingDBTX) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	c.statements++
	return c.DBTX.Query(ctx, sql, args...)
}

func (c *countingDBTX) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	c.statements++
	return c.DBTX.QueryRow(ctx, sql, args...)
}

// seedOrgUsers inserts n verified users who are members of the organization,
// in set statements, and returns their ids in insert order. A workspace id adds
// them to that workspace as members.
func (f *docPermFixture) seedOrgUsers(t *testing.T, orgID, workspaceID, prefix string, n int) []string {
	t.Helper()
	ids := make([]string, n)
	emails := make([]string, n)
	names := make([]string, n)
	for i := range n {
		ids[i] = util.NewID()
		emails[i] = fmt.Sprintf("%s-%05d-%s@example.com", prefix, i, ids[i])
		names[i] = fmt.Sprintf("%s %05d", prefix, i)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO users (id, email, display_name, password_hash, email_verified_at)
		SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), 'x', now()
	`, ids, emails, names); err != nil {
		t.Fatalf("seed %d users: %v", n, err)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO organization_members (organization_id, user_id, role)
		SELECT $1, unnest($2::text[]), 'member'
	`, orgID, ids); err != nil {
		t.Fatalf("seed %d org members: %v", n, err)
	}
	if workspaceID != "" {
		if _, err := f.pool.Exec(f.ctx, `
			INSERT INTO workspace_members (workspace_id, user_id, role, organization_id)
			SELECT $1, unnest($2::text[]), 'member', $3
		`, workspaceID, ids, orgID); err != nil {
			t.Fatalf("seed %d workspace members: %v", n, err)
		}
	}
	return ids
}

// TestResolveLevelsBulkMatchesSingleResolver is the SF1 parity proof: for every
// person of every membership shape, on every kind of document and share set,
// the set resolver answers exactly what resolveLevelInTenantWithShares answers
// one person at a time (level, via and AdminScope).
func TestResolveLevelsBulkMatchesSingleResolver(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "bulklv")
	foreign := f.tenant(t, "bulklvx")

	docW := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.creator.ID})
	docWView := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.creator.ID})
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = 'view' WHERE id = $1`, docWView.ID); err != nil {
		t.Fatal(err)
	}
	docWView, err := f.q.GetDocumentByID(f.ctx, docWView.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.share(t, docWView, DocumentPrincipalUser, tn.member.ID, DocumentLevelComment, tn.aclOwner.ID)

	docR := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.share(t, docR, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
	f.share(t, docR, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, tn.aclOwner.ID)
	f.share(t, docR, DocumentPrincipalUser, tn.wsAdmin.ID, DocumentLevelComment, tn.aclOwner.ID)

	docR2 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.share(t, docR2, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)
	f.share(t, docR2, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)
	f.revoke(t, f.share(t, docR2, DocumentPrincipalUser, tn.creator.ID, DocumentLevelEdit, tn.aclOwner.ID), tn.aclOwner.ID)
	// Shares that name another organization never apply, a workspace of another
	// organization included.
	f.share(t, docR2, DocumentPrincipalOrganization, foreign.orgID, DocumentLevelManage, tn.aclOwner.ID)
	f.share(t, docR2, DocumentPrincipalWorkspace, foreign.wsA, DocumentLevelEdit, tn.aclOwner.ID)

	// A workspace share of a workspace of the organization the person left, and
	// two workspace shares at different levels covering the same person.
	docR3 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.share(t, docR3, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelView, tn.aclOwner.ID)
	f.share(t, docR3, DocumentPrincipalWorkspace, tn.wsA, DocumentLevelComment, tn.aclOwner.ID)

	// AdminScope: the organization owner (implicit ws admin) holds a live
	// break-glass grant, the org admin an expired one, the ws admin none.
	docBG := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.breakGlass(t, tn, docBG.ID, tn.owner.ID, time.Now().Add(time.Hour), false)
	f.breakGlass(t, tn, docBG.ID, tn.orgAdmin.ID, time.Now().Add(-time.Hour), false)
	f.breakGlass(t, tn, docBG.ID, tn.wsAdmin.ID, time.Now().Add(time.Hour), true)
	f.breakGlass(t, tn, docBG.ID, tn.aclOwner.ID, time.Now().Add(time.Hour), false)

	docOwned := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, ownerID: "01WPBULKLV0000000000000000"})
	f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.member.ID: DocumentLevelEdit, tn.aclOwner.ID: DocumentLevelView})
	defer f.svc.SetOwnerLevelResolver(nil)

	people := []string{
		tn.owner.ID, tn.orgAdmin.ID, tn.wsAdmin.ID, tn.aclOwner.ID, tn.creator.ID,
		tn.member.ID, tn.outsider.ID, tn.bMember.ID, tn.deact.ID, foreign.owner.ID, foreign.member.ID,
	}
	admitted, err := f.svc.orgs.AdmittedMemberIDsQ(f.ctx, f.q, tn.orgID, people)
	if err != nil {
		t.Fatal(err)
	}
	var gated []string
	for _, id := range people {
		if admitted[id] {
			gated = append(gated, id)
		}
	}
	if admitted[tn.deact.ID] || admitted[foreign.owner.ID] || len(gated) != 8 {
		t.Fatalf("organization gate admitted %v, want the 8 active members of the organization only", gated)
	}

	for name, doc := range map[string]db.Document{
		"workspace-visible": docW, "workspace level view": docWView, "restricted user+workspace shares": docR,
		"restricted org+user shares": docR2, "restricted workspace shares": docR3,
		"restricted break-glass": docBG, "owned": docOwned,
	} {
		shares, err := f.q.ListDocumentShares(f.ctx, db.ListDocumentSharesParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		bulk, err := f.svc.resolveLevelsInTenantWithShares(f.ctx, f.q, doc, shares, gated)
		if err != nil {
			t.Fatalf("%s: bulk: %v", name, err)
		}
		if len(bulk) != len(gated) {
			t.Fatalf("%s: bulk answered %d people, want %d", name, len(bulk), len(gated))
		}
		for _, id := range gated {
			want, err := f.svc.resolveLevelInTenantWithShares(f.ctx, f.q, Human(id), doc, shares)
			if err != nil && !isGateRefusal(err) {
				t.Fatalf("%s: single %s: %v", name, id, err)
			}
			if bulk[id] != want {
				t.Fatalf("%s: person %s: bulk = %+v, single = %+v", name, id, bulk[id], want)
			}
		}
	}
	// The break-glass document pins the interesting cells outright, so the
	// parity above cannot be two equally wrong answers.
	shares, err := f.q.ListDocumentShares(f.ctx, db.ListDocumentSharesParams{
		OrganizationID: docBG.OrganizationID, WorkspaceID: docBG.WorkspaceID, DocumentID: docBG.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	bg, err := f.svc.resolveLevelsInTenantWithShares(f.ctx, f.q, docBG, shares, gated)
	if err != nil {
		t.Fatal(err)
	}
	if got := bg[tn.owner.ID]; got.Level != DocumentLevelView || got.Via != DocumentViaBreakGlass || !got.AdminScope {
		t.Fatalf("owner with a live grant = %+v, want view via break-glass with AdminScope", got)
	}
	if got := bg[tn.orgAdmin.ID]; got.Level != DocumentLevelNone || !got.AdminScope {
		t.Fatalf("org admin with an expired grant = %+v, want none with AdminScope", got)
	}
	if got := bg[tn.wsAdmin.ID]; got.Level != DocumentLevelNone || !got.AdminScope {
		t.Fatalf("ws admin with a revoked grant = %+v, want none with AdminScope", got)
	}
	if got := bg[tn.aclOwner.ID]; got.Level != DocumentLevelManage {
		t.Fatalf("ACL owner = %+v, want manage", got)
	}
}

// TestResolveLevelsBulkStatementsDoNotGrowWithRecipients pins what SF1 is for:
// the statements the resolver sends do not depend on how many people it
// resolves, so a 10,000-member room costs the same round trips as a 100-member
// one while the document row is locked.
func TestResolveLevelsBulkStatementsDoNotGrowWithRecipients(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "bulkstmt")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.share(t, doc, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, tn.aclOwner.ID)
	f.share(t, doc, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)
	shares, err := f.q.ListDocumentShares(f.ctx, db.ListDocumentSharesParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	var counts []int
	for _, n := range []int{50, 2000} {
		ids := f.seedOrgUsers(t, tn.orgID, tn.wsB, fmt.Sprintf("bulkstmt%d", n), n)
		counter := &countingDBTX{DBTX: f.pool}
		levels, err := f.svc.resolveLevelsInTenantWithShares(f.ctx, db.New(counter), doc, shares, ids)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range ids {
			if levels[id].Level != DocumentLevelEdit {
				t.Fatalf("%d people: %s resolved to %+v, want edit through the workspace share", n, id, levels[id])
			}
		}
		counts = append(counts, counter.statements)
	}
	if counts[0] != counts[1] || counts[0] > 4 {
		t.Fatalf("statements for 50 and 2,000 people = %v, want equal and at most 4", counts)
	}
}

// TestAdmittedMemberIDsMatchRequireMember is SF3: the set gates admit exactly
// the people the one-at-a-time gates admit, whatever the state of the
// organization and of the person.
func TestAdmittedMemberIDsMatchRequireMember(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "admit")
	foreign := f.tenant(t, "admitx")
	stranger := f.user(t, "admit", "stranger")
	ids := []string{
		tn.owner.ID, tn.orgAdmin.ID, tn.wsAdmin.ID, tn.member.ID, tn.outsider.ID, tn.bMember.ID,
		tn.deact.ID, stranger.ID, foreign.owner.ID, foreign.member.ID, util.NewID(),
	}
	orgs, wss := f.svc.orgs, f.svc.ws

	for _, st := range []struct {
		name       string
		setup      string
		wantOrg    int
		wantWSA    int
		ownerAdmit bool
	}{
		// owner, org admin, ws admin, member, outsider, bMember.
		{"active organization", `UPDATE organizations SET status = 'active', deletion_scheduled_at = NULL WHERE id = $1`, 6, 4, true},
		{"suspended organization", `UPDATE organizations SET status = 'suspended', deletion_scheduled_at = NULL WHERE id = $1`, 0, 0, false},
		// Only the owner while a deletion is scheduled: the owner is an implicit
		// admin of every workspace, nobody else gets in.
		{"deletion scheduled", `UPDATE organizations SET status = 'active', deletion_scheduled_at = now() + interval '7 days' WHERE id = $1`, 1, 1, true},
	} {
		t.Run(st.name, func(t *testing.T) {
			if _, err := f.pool.Exec(f.ctx, st.setup, tn.orgID); err != nil {
				t.Fatal(err)
			}
			orgSet, err := orgs.AdmittedMemberIDsQ(f.ctx, f.q, tn.orgID, ids)
			if err != nil {
				t.Fatal(err)
			}
			wsSets := map[string]map[string]bool{}
			for _, wsID := range []string{tn.wsA, tn.wsB} {
				if wsSets[wsID], err = wss.AdmittedMemberIDsQ(f.ctx, f.q, wsID, ids); err != nil {
					t.Fatal(err)
				}
			}
			for _, id := range ids {
				_, err := orgs.RequireMemberQ(f.ctx, f.q, tn.orgID, id)
				if err != nil && !isGateRefusal(err) {
					t.Fatalf("RequireMemberQ(%s): %v", id, err)
				}
				if orgSet[id] != (err == nil) {
					t.Fatalf("organization gate for %s: set = %v, RequireMemberQ = %v", id, orgSet[id], err)
				}
				for wsID, set := range wsSets {
					_, err := wss.RequireMemberQ(f.ctx, f.q, wsID, id)
					if err != nil && !isGateRefusal(err) {
						t.Fatalf("workspace RequireMemberQ(%s, %s): %v", wsID, id, err)
					}
					if set[id] != (err == nil) {
						t.Fatalf("workspace gate %s for %s: set = %v, RequireMemberQ = %v", wsID, id, set[id], err)
					}
				}
			}
			if len(orgSet) != st.wantOrg || len(wsSets[tn.wsA]) != st.wantWSA {
				t.Fatalf("admitted = %d in the organization and %d in workspace A, want %d and %d",
					len(orgSet), len(wsSets[tn.wsA]), st.wantOrg, st.wantWSA)
			}
			if orgSet[tn.owner.ID] != st.ownerAdmit {
				t.Fatalf("owner admitted = %v, want %v", orgSet[tn.owner.ID], st.ownerAdmit)
			}
			for _, refused := range []string{tn.deact.ID, stranger.ID, foreign.owner.ID, foreign.member.ID} {
				if orgSet[refused] || wsSets[tn.wsA][refused] {
					t.Fatalf("%s is admitted to the organization or workspace, want refused", refused)
				}
			}
		})
	}
}
