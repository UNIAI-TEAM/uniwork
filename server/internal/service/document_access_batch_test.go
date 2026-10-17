package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func docLevelPtr(l DocumentLevel) *DocumentLevel { return &l }

func rejectedItemsFromError(t *testing.T, err error) []DocumentAccessRejectedItem {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("err = %v, want CodedError", err)
	}
	if ce.Code != "document_access_rejected" || ce.Status != 422 {
		t.Fatalf("err = %+v, want 422 document_access_rejected", ce)
	}
	raw, ok := ce.Fields["rejected"]
	if !ok {
		t.Fatalf("fields = %v, missing rejected", ce.Fields)
	}
	items, ok := raw.([]DocumentAccessRejectedItem)
	if !ok {
		t.Fatalf("rejected = %T (%v), want []DocumentAccessRejectedItem", raw, raw)
	}
	return items
}

func auditBatchIDs(t *testing.T, f *docPermFixture, documentID string) map[string][]string {
	t.Helper()
	rows, err := f.pool.Query(f.ctx,
		`SELECT action, metadata FROM audit_events WHERE resource_id = $1 ORDER BY occurred_at, id`,
		documentID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var action, metaRaw string
		if err := rows.Scan(&action, &metaRaw); err != nil {
			t.Fatal(err)
		}
		var meta map[string]any
		if err := json.Unmarshal([]byte(metaRaw), &meta); err != nil {
			t.Fatal(err)
		}
		bid, _ := meta["batch_id"].(string)
		out[action] = append(out[action], bid)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestDocumentAccessBatch covers SH-S2 (UNI-1781) Item 1:
// PUT /api/v1/documents/{documentID}/access batch grant, update, revoke, keep,
// home-workspace merge, atomic 422 document_access_rejected, Q-S1, and gates.
func TestDocumentAccessBatch(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs2b")
	foreign := f.tenant(t, "shs2bx")
	H := Human
	mgr := H(tn.aclOwner.ID)

	// Seed 10 extra active members in tn.orgID for AC02 and AC03.
	users10 := make([]db.User, 10)
	for i := range users10 {
		u := f.user(t, "shs2b", fmt.Sprintf("u%02d", i))
		f.orgMember(t, tn.orgID, u.ID, OrgRoleMember)
		users10[i] = u
	}

	t.Run("AC01 single user view and AC02 10 users view", func(t *testing.T) {
		doc1 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		res1, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc1.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: docLevelPtr(DocumentLevelView)},
			},
		})
		if err != nil {
			t.Fatalf("AC01 single user view: %v", err)
		}
		if res1.BatchID == "" || res1.DryRun || len(res1.Results) != 1 {
			t.Fatalf("AC01 result = %+v", res1)
		}
		r0 := res1.Results[0]
		if r0.Index != 0 || r0.Status != DocumentAccessStatusGranted || r0.ShareID == "" || r0.Level == nil || *r0.Level != DocumentLevelView || r0.PreviousLevel != nil {
			t.Fatalf("AC01 item[0] = %+v", r0)
		}
		if got := level(t, f, H(tn.outsider.ID), doc1); got != DocumentLevelView {
			t.Fatalf("AC01 outsider level = %q, want view", got)
		}
		bids := auditBatchIDs(t, f, doc1.ID)
		if len(bids[audit.ActionDocumentShared]) != 1 || bids[audit.ActionDocumentShared][0] != res1.BatchID {
			t.Fatalf("AC01 audit batch_id = %v, want [%s]", bids, res1.BatchID)
		}

		doc2 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		items10 := make([]DocumentAccessBatchItem, 10)
		for i, u := range users10 {
			items10[i] = DocumentAccessBatchItem{
				PrincipalType: DocumentPrincipalUser, PrincipalID: u.ID, Level: docLevelPtr(DocumentLevelView),
			}
		}
		res2, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc2.ID, UpdateDocumentAccessInput{Items: items10})
		if err != nil {
			t.Fatalf("AC02 10 users view: %v", err)
		}
		if len(res2.Results) != 10 {
			t.Fatalf("AC02 results len = %d, want 10", len(res2.Results))
		}
		for i, r := range res2.Results {
			if r.Index != i || r.Status != DocumentAccessStatusGranted || r.ShareID == "" || r.Level == nil || *r.Level != DocumentLevelView {
				t.Fatalf("AC02 results[%d] = %+v", i, r)
			}
			if got := level(t, f, H(users10[i].ID), doc2); got != DocumentLevelView {
				t.Fatalf("AC02 user[%d] level = %q, want view", i, got)
			}
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc2.ID); n != 10 {
			t.Fatalf("AC02 audit rows = %d, want 10", n)
		}
		if n := countOutbox(t, f, "document.shared", doc2.ID); n != 10 {
			t.Fatalf("AC02 outbox rows = %d, want 10", n)
		}
	})

	t.Run("AC03 mixed levels 3 edit and 7 view in one batch", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		items := make([]DocumentAccessBatchItem, 10)
		for i, u := range users10 {
			lvl := DocumentLevelView
			if i < 3 {
				lvl = DocumentLevelEdit
			}
			items[i] = DocumentAccessBatchItem{
				PrincipalType: DocumentPrincipalUser, PrincipalID: u.ID, Level: docLevelPtr(lvl),
			}
		}
		res, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{Items: items})
		if err != nil {
			t.Fatalf("AC03 mixed batch: %v", err)
		}
		for i, u := range users10 {
			want := DocumentLevelView
			if i < 3 {
				want = DocumentLevelEdit
			}
			if res.Results[i].Index != i || res.Results[i].Level == nil || *res.Results[i].Level != want {
				t.Fatalf("AC03 results[%d] = %+v, want %q", i, res.Results[i], want)
			}
			if got := level(t, f, H(u.ID), doc); got != want {
				t.Fatalf("AC03 user[%d] effective = %q, want %q", i, got, want)
			}
		}
	})

	t.Run("AC04 workspace view, AC11 workspace_id unchanged, AC05 organization edit, Q-S1", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		// AC04 + AC11: share to another workspace (wsB) at view; doc.WorkspaceID stays wsA.
		res, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: docLevelPtr(DocumentLevelView)},
			},
		})
		if err != nil {
			t.Fatalf("AC04 wsB view: %v", err)
		}
		if res.Results[0].Index != 0 || res.Results[0].Status != DocumentAccessStatusGranted || res.Results[0].ShareID == "" {
			t.Fatalf("AC04 result = %+v", res.Results[0])
		}
		if got := level(t, f, H(tn.bMember.ID), doc); got != DocumentLevelView {
			t.Fatalf("AC04 bMember level = %q, want view", got)
		}
		reloaded, err := f.q.GetDocumentByID(f.ctx, doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if reloaded.WorkspaceID != tn.wsA {
			t.Fatalf("AC11 workspace_id changed to %q, want %q", reloaded.WorkspaceID, tn.wsA)
		}

		// Other workspace + manage -> allowed + wide_scope warning with index 0 (Q-S1, fix1 #3 & #4).
		resManageWS, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: docLevelPtr(DocumentLevelManage)},
			},
		})
		if err != nil {
			t.Fatalf("Q-S1 other ws manage: %v", err)
		}
		if resManageWS.Results[0].Status != DocumentAccessStatusUpdated || *resManageWS.Results[0].PreviousLevel != DocumentLevelView {
			t.Fatalf("Q-S1 other ws manage result = %+v", resManageWS.Results[0])
		}
		hasWideScope := false
		for _, w := range resManageWS.Preview.Warnings {
			if w.Code == DocumentAccessWarningWideScope && w.Index == 0 {
				hasWideScope = true
			}
		}
		if !hasWideScope {
			t.Fatalf("Q-S1 other ws manage warnings = %+v, want {wide_scope, 0}", resManageWS.Preview.Warnings)
		}

		// AC05: organization edit -> allowed + wide_scope warning with index 0.
		resOrg, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: docLevelPtr(DocumentLevelEdit)},
			},
		})
		if err != nil {
			t.Fatalf("AC05 org edit: %v", err)
		}
		if resOrg.Results[0].Status != DocumentAccessStatusGranted || *resOrg.Results[0].Level != DocumentLevelEdit {
			t.Fatalf("AC05 org edit result = %+v", resOrg.Results[0])
		}
		if len(resOrg.Preview.Warnings) != 1 || resOrg.Preview.Warnings[0] != (DocumentAccessWarning{Code: DocumentAccessWarningWideScope, Index: 0}) {
			t.Fatalf("AC05 org edit warnings = %+v, want [{wide_scope 0}]", resOrg.Preview.Warnings)
		}
		if got := level(t, f, H(tn.outsider.ID), doc); got != DocumentLevelEdit {
			t.Fatalf("AC05 outsider level = %q, want edit", got)
		}

		// Q-S1: organization + manage -> 422 document_access_rejected with level_not_allowed.
		_, err = f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: docLevelPtr(DocumentLevelManage)},
			},
		})
		rej := rejectedItemsFromError(t, err)
		if len(rej) != 1 || rej[0].Index != 0 || rej[0].Code != "level_not_allowed" {
			t.Fatalf("Q-S1 org manage rejected = %+v", rej)
		}

		// Q-S1: home workspace + manage -> 422 document_access_rejected with level_not_allowed.
		_, err = f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: docLevelPtr(DocumentLevelManage)},
			},
		})
		rej = rejectedItemsFromError(t, err)
		if len(rej) != 1 || rej[0].Index != 0 || rej[0].Code != "level_not_allowed" {
			t.Fatalf("Q-S1 home ws manage rejected = %+v", rej)
		}
	})

	t.Run("U-SH3 atomic batch rejection leaves zero rows", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		_, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: docLevelPtr(DocumentLevelView)},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: foreign.owner.ID, Level: docLevelPtr(DocumentLevelView)},
				{PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: docLevelPtr(DocumentLevelManage)},
			},
		})
		rej := rejectedItemsFromError(t, err)
		if len(rej) != 2 ||
			rej[0].Index != 1 || rej[0].Code != "principal_not_in_organization" ||
			rej[1].Index != 2 || rej[1].Code != "level_not_allowed" {
			t.Fatalf("U-SH3 rejected = %+v", rej)
		}
		var shareCount int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_shares WHERE document_id = $1`, doc.ID).Scan(&shareCount); err != nil {
			t.Fatal(err)
		}
		if shareCount != 0 {
			t.Fatalf("U-SH3 wrote %d share rows on rejected batch, want 0", shareCount)
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 0 {
			t.Fatalf("U-SH3 wrote %d audit rows, want 0", n)
		}
		if n := countOutbox(t, f, "document.shared", doc.ID); n != 0 {
			t.Fatalf("U-SH3 wrote %d outbox rows, want 0", n)
		}
	})

	t.Run("AC13 per-item on_existing keep vs update, duplicate principal, home workspace merge and revoke", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		existing := f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelEdit, tn.aclOwner.ID)

		// items[0].on_existing=keep preserves existing edit grant and writes no audit row; items[1] defaults to update.
		resKeep, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: docLevelPtr(DocumentLevelView), OnExisting: DocumentAccessOnExistingKeep},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: docLevelPtr(DocumentLevelView)},
			},
		})
		if err != nil {
			t.Fatalf("AC13 keep: %v", err)
		}
		if resKeep.Results[0].Index != 0 ||
			resKeep.Results[0].Status != DocumentAccessStatusKept ||
			resKeep.Results[0].ShareID != existing.ID ||
			*resKeep.Results[0].Level != DocumentLevelEdit ||
			*resKeep.Results[0].PreviousLevel != DocumentLevelEdit {
			t.Fatalf("AC13 kept item = %+v", resKeep.Results[0])
		}
		if resKeep.Results[1].Index != 1 || resKeep.Results[1].Status != DocumentAccessStatusGranted || *resKeep.Results[1].Level != DocumentLevelView {
			t.Fatalf("AC13 granted item = %+v", resKeep.Results[1])
		}
		// Only bMember's grant wrote an audit row.
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 1 {
			t.Fatalf("AC13 audit rows = %d, want 1", n)
		}

		// Duplicate (principal_type, principal_id) in batch -> 422 duplicate_principal.
		_, err = f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: docLevelPtr(DocumentLevelView)},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: docLevelPtr(DocumentLevelEdit)},
			},
		})
		rej := rejectedItemsFromError(t, err)
		if len(rej) != 1 || rej[0].Index != 1 || rej[0].Code != "duplicate_principal" {
			t.Fatalf("AC13 duplicate rejected = %+v", rej)
		}

		// Home workspace in batch -> updates home row, no document_shares row, share_id empty, no wide_scope warning on home row.
		resHome, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: docLevelPtr(DocumentLevelEdit)},
			},
		})
		if err != nil {
			t.Fatalf("AC13 home ws grant: %v", err)
		}
		if resHome.Results[0].Index != 0 ||
			resHome.Results[0].Status != DocumentAccessStatusGranted ||
			resHome.Results[0].ShareID != "" ||
			*resHome.Results[0].Level != DocumentLevelEdit ||
			resHome.Results[0].PreviousLevel != nil {
			t.Fatalf("AC13 home ws grant result = %+v", resHome.Results[0])
		}
		if len(resHome.Preview.Warnings) != 0 {
			t.Fatalf("AC13 home ws edit must not emit wide_scope warning: %+v", resHome.Preview.Warnings)
		}
		var homeShareRows int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM document_shares WHERE document_id = $1 AND principal_type = 'workspace' AND principal_id = $2`,
			doc.ID, tn.wsA).Scan(&homeShareRows); err != nil {
			t.Fatal(err)
		}
		if homeShareRows != 0 {
			t.Fatalf("AC13 home ws wrote %d document_shares rows, want 0", homeShareRows)
		}
		bids := auditBatchIDs(t, f, doc.ID)
		if len(bids[audit.ActionDocumentWorkspaceAccessChanged]) != 1 || bids[audit.ActionDocumentWorkspaceAccessChanged][0] != resHome.BatchID {
			t.Fatalf("AC13 home ws audit batch_id = %v, want [%s]", bids, resHome.BatchID)
		}

		// Revoke via level: nil on user, home workspace, and non-existent grant.
		resRev, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: nil},
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: nil},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.creator.ID, Level: nil},
			},
		})
		if err != nil {
			t.Fatalf("revoke batch: %v", err)
		}
		if resRev.Results[0].Index != 0 || resRev.Results[0].Status != DocumentAccessStatusRevoked || resRev.Results[0].ShareID != "" ||
			resRev.Results[0].Level != nil || *resRev.Results[0].PreviousLevel != DocumentLevelEdit {
			t.Fatalf("revoke user result = %+v", resRev.Results[0])
		}
		if resRev.Results[1].Index != 1 || resRev.Results[1].Status != DocumentAccessStatusRevoked || resRev.Results[1].ShareID != "" ||
			resRev.Results[1].Level != nil || *resRev.Results[1].PreviousLevel != DocumentLevelEdit {
			t.Fatalf("revoke home ws result = %+v", resRev.Results[1])
		}
		if resRev.Results[2].Index != 2 || resRev.Results[2].Status != DocumentAccessStatusUnchanged || resRev.Results[2].ShareID != "" ||
			resRev.Results[2].Level != nil || resRev.Results[2].PreviousLevel != nil {
			t.Fatalf("revoke non-existent result = %+v", resRev.Results[2])
		}
		row, err := f.q.GetDocumentByID(f.ctx, doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if row.Visibility != documentVisibilityRestricted {
			t.Fatalf("home ws after revoke visibility = %q, want restricted", row.Visibility)
		}
	})

	t.Run("AC09 gates, 400 validation, and AdminScope break_glass_required", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelEdit, tn.aclOwner.ID)

		validIn := UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: docLevelPtr(DocumentLevelView)},
			},
		}
		// Editor (below manage) -> 403.
		if _, err := f.svc.UpdateDocumentAccess(f.ctx, H(tn.outsider.ID), doc.ID, validIn); !errors.Is(err, ErrForbidden) {
			t.Fatalf("AC09 editor = %v, want ErrForbidden", err)
		}
		// Non-reader -> 404.
		if _, err := f.svc.UpdateDocumentAccess(f.ctx, H(tn.member.ID), doc.ID, validIn); !errors.Is(err, ErrNotFound) {
			t.Fatalf("AC09 non-reader = %v, want ErrNotFound", err)
		}
		// Other tenant -> 404.
		if _, err := f.svc.UpdateDocumentAccess(f.ctx, H(foreign.owner.ID), doc.ID, validIn); !errors.Is(err, ErrNotFound) {
			t.Fatalf("AC09 foreign tenant = %v, want ErrNotFound", err)
		}

		// AdminScope caller (wsAdmin on restricted doc) trying to grant to self or home ws -> 422 break_glass_required in rejected[].
		_, err := f.svc.UpdateDocumentAccess(f.ctx, H(tn.wsAdmin.ID), doc.ID, UpdateDocumentAccessInput{
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.wsAdmin.ID, Level: docLevelPtr(DocumentLevelView)},
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: docLevelPtr(DocumentLevelView)},
			},
		})
		rej := rejectedItemsFromError(t, err)
		if len(rej) != 2 || rej[0].Code != "break_glass_required" || rej[1].Code != "break_glass_required" {
			t.Fatalf("AdminScope self-grant rejected = %+v", rej)
		}

		// 400 validation: empty items, >100 items, agent principal_type (D1), invalid item on_existing, invalid level (including "none").
		over100 := make([]DocumentAccessBatchItem, 101)
		for i := range over100 {
			over100[i] = DocumentAccessBatchItem{PrincipalType: DocumentPrincipalUser, PrincipalID: util.NewID(), Level: docLevelPtr(DocumentLevelView)}
		}
		badLevel := DocumentLevel("owner")
		noneLevel := DocumentLevel("none")
		for name, bad := range map[string]UpdateDocumentAccessInput{
			"empty items":        {},
			"over 100 items":     {Items: over100},
			"agent principal":    {Items: []DocumentAccessBatchItem{{PrincipalType: "agent", PrincipalID: tn.agent, Level: docLevelPtr(DocumentLevelView)}}},
			"empty principal_id": {Items: []DocumentAccessBatchItem{{PrincipalType: DocumentPrincipalUser, PrincipalID: "  ", Level: docLevelPtr(DocumentLevelView)}}},
			"bad on_existing":    {Items: []DocumentAccessBatchItem{{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: docLevelPtr(DocumentLevelView), OnExisting: "replace"}}},
			"bad level":          {Items: []DocumentAccessBatchItem{{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: &badLevel}}},
			"level none string":  {Items: []DocumentAccessBatchItem{{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: &noneLevel}}},
		} {
			var ve ValidationError
			if _, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, bad); !errors.As(err, &ve) {
				t.Fatalf("400 case %s: err = %v, want ValidationError", name, err)
			}
		}
	})
}

// TestDocumentAccessBatchDryRunAndPreview covers SH-S2 (UNI-1781) Item 2:
// dry_run=true writes zero rows while returning results + preview; dry_run=false
// returns the same preview (D2); AC07 user revoke with home-row fallback;
// direct_below_group warning; and preview.groups member_count + losing_count (D5, AC08).
//
// D5 losing_count method: computed by one SQL count per group item
// (CountDocumentAccessPreviewGroup) over active organization_members belonging
// to the group (all active org members for organization, or active org members
// with a workspace_members row in the target workspace). When the group's grant
// is lowered or revoked (prev_group_rank > after_group_rank), a group member is
// counted in losing_count iff their highest post-batch rank across all sources
// (ACL owner, home-workspace admin/member when workspace-visible, post-batch
// org share, post-batch workspace shares, post-batch direct user share, live
// break-glass grant) is strictly below prev_group_rank. Group members are never
// enumerated in preview.users.
func TestDocumentAccessBatchDryRunAndPreview(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs2p")
	H := Human
	mgr := H(tn.aclOwner.ID)

	t.Run("dry_run writes zero rows and D2 preview matches on dry_run false", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		in := UpdateDocumentAccessInput{
			DryRun: true,
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: docLevelPtr(DocumentLevelView)},
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: docLevelPtr(DocumentLevelEdit)},
			},
		}
		dry, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, in)
		if err != nil {
			t.Fatalf("dry_run=true: %v", err)
		}
		if !dry.DryRun || dry.BatchID == "" || len(dry.Results) != 2 {
			t.Fatalf("dry_run response = %+v", dry)
		}
		if dry.Results[0].ShareID != "" || dry.Results[1].ShareID != "" {
			t.Fatalf("dry_run new grants must not emit share_id: %+v", dry.Results)
		}
		var shares int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_shares WHERE document_id = $1`, doc.ID).Scan(&shares); err != nil {
			t.Fatal(err)
		}
		if shares != 0 {
			t.Fatalf("dry_run wrote %d document_shares rows, want 0", shares)
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 0 {
			t.Fatalf("dry_run wrote %d audit rows, want 0", n)
		}
		if n := countOutbox(t, f, "document.shared", doc.ID); n != 0 {
			t.Fatalf("dry_run wrote %d outbox rows, want 0", n)
		}
		if len(dry.Preview.Users) != 1 || dry.Preview.Users[0].UserID != tn.outsider.ID ||
			dry.Preview.Users[0].DisplayName != tn.outsider.DisplayName ||
			dry.Preview.Users[0].Before.Level != "" || dry.Preview.Users[0].Before.Via != "" ||
			dry.Preview.Users[0].After.Level != DocumentLevelView ||
			dry.Preview.Users[0].After.Via != string(DocumentViaShare) {
			t.Fatalf("dry_run preview.users = %+v", dry.Preview.Users)
		}
		if len(dry.Preview.Groups) != 1 || dry.Preview.Groups[0].PrincipalType != DocumentPrincipalWorkspace ||
			dry.Preview.Groups[0].PrincipalID != tn.wsB || dry.Preview.Groups[0].Name != "B shs2p" ||
			dry.Preview.Groups[0].MemberCount != 2 || dry.Preview.Groups[0].LosingCount != 0 {
			t.Fatalf("dry_run preview.groups = %+v", dry.Preview.Groups)
		}
		if len(dry.Preview.Warnings) != 1 || dry.Preview.Warnings[0] != (DocumentAccessWarning{Code: DocumentAccessWarningWideScope, Index: 1}) {
			t.Fatalf("dry_run preview.warnings = %+v, want [{wide_scope 1}]", dry.Preview.Warnings)
		}

		// D2: running with dry_run=false returns the same preview.
		in.DryRun = false
		live, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, in)
		if err != nil {
			t.Fatalf("dry_run=false: %v", err)
		}
		if len(live.Preview.Users) != 1 || live.Preview.Users[0].After.Level != DocumentLevelView {
			t.Fatalf("D2 live preview.users = %+v", live.Preview.Users)
		}
		if len(live.Preview.Groups) != 1 || live.Preview.Groups[0].MemberCount != 2 || live.Preview.Groups[0].LosingCount != 0 {
			t.Fatalf("D2 live preview.groups = %+v", live.Preview.Groups)
		}
	})

	t.Run("AC07 revoke user direct edit while home row gives view", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		doc = setWorkspaceLevel(t, f, doc, "view")
		f.share(t, doc, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)

		res, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			DryRun: true,
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.member.ID, Level: nil},
			},
		})
		if err != nil {
			t.Fatalf("AC07 dry_run: %v", err)
		}
		if len(res.Preview.Users) != 1 {
			t.Fatalf("AC07 preview.users = %+v, want 1 entry", res.Preview.Users)
		}
		u := res.Preview.Users[0]
		if u.Before.Level != DocumentLevelEdit || u.Before.Via != string(DocumentViaShare) {
			t.Fatalf("AC07 before = %+v, want edit via share", u.Before)
		}
		if u.After.Level != DocumentLevelView || u.After.Via != string(DocumentViaMember) {
			t.Fatalf("AC07 after = %+v, want view via member", u.After)
		}
		if len(res.Preview.Warnings) != 1 || res.Preview.Warnings[0] != (DocumentAccessWarning{Code: DocumentAccessWarningDowngrade, Index: 0}) {
			t.Fatalf("AC07 warnings = %+v, want [{downgrade 0}]", res.Preview.Warnings)
		}
	})

	t.Run("direct_below_group warning when user item is below organization share", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, doc, DocumentPrincipalOrganization, tn.orgID, DocumentLevelEdit, tn.aclOwner.ID)

		res, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			DryRun: true,
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: docLevelPtr(DocumentLevelView)},
			},
		})
		if err != nil {
			t.Fatalf("direct_below_group preview: %v", err)
		}
		if len(res.Preview.Users) != 1 || res.Preview.Users[0].After.Level != DocumentLevelEdit {
			t.Fatalf("direct_below_group preview.users = %+v", res.Preview.Users)
		}
		if len(res.Preview.Warnings) != 1 || res.Preview.Warnings[0] != (DocumentAccessWarning{Code: DocumentAccessWarningDirectBelowGroup, Index: 0}) {
			t.Fatalf("direct_below_group warnings = %+v, want [{direct_below_group 0}]", res.Preview.Warnings)
		}
	})

	t.Run("AC08 and D5 preview.groups losing_count excludes members with equal or higher remaining access", func(t *testing.T) {
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		// wsB has 2 active members in workspace_members: tn.owner and tn.bMember.
		// Share doc with wsB at edit, and also give tn.bMember a direct edit share.
		f.share(t, doc, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, tn.aclOwner.ID)
		f.share(t, doc, DocumentPrincipalUser, tn.bMember.ID, DocumentLevelEdit, tn.aclOwner.ID)

		// Revoking wsB: tn.owner loses edit (drops to none), while tn.bMember keeps edit via direct share -> losing_count = 1.
		rev, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			DryRun: true,
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: nil},
			},
		})
		if err != nil {
			t.Fatalf("AC08 revoke wsB preview: %v", err)
		}
		if len(rev.Preview.Users) != 0 {
			t.Fatalf("D5 group members must not be enumerated in preview.users: %+v", rev.Preview.Users)
		}
		if len(rev.Preview.Groups) != 1 {
			t.Fatalf("AC08 preview.groups = %+v", rev.Preview.Groups)
		}
		g := rev.Preview.Groups[0]
		if g.PrincipalType != DocumentPrincipalWorkspace || g.PrincipalID != tn.wsB || g.Level != nil || g.MemberCount != 2 || g.LosingCount != 1 {
			t.Fatalf("AC08 group preview = %+v, want member_count=2 losing_count=1", g)
		}

		// Lowering bMember's direct share to view AND revoking wsB in the same batch: both tn.owner and tn.bMember drop below edit -> losing_count = 2.
		revBoth, err := f.svc.UpdateDocumentAccess(f.ctx, mgr, doc.ID, UpdateDocumentAccessInput{
			DryRun: true,
			Items: []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: docLevelPtr(DocumentLevelView)},
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: nil},
			},
		})
		if err != nil {
			t.Fatalf("AC08 lower + revoke preview: %v", err)
		}
		if len(revBoth.Preview.Groups) != 1 || revBoth.Preview.Groups[0].LosingCount != 2 {
			t.Fatalf("AC08 lower + revoke group preview = %+v, want losing_count=2", revBoth.Preview.Groups)
		}
	})
}
