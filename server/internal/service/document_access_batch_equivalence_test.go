package service

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// accessBatchGoldenNames maps every id a golden snapshot can meet to a stable
// name, so the rendered snapshot is the same on every run.
type accessBatchGoldenNames map[string]string

func (n accessBatchGoldenNames) replace(s string) string {
	pairs := make([]string, 0, 2*len(n))
	for id, name := range n {
		pairs = append(pairs, id, name)
	}
	return strings.NewReplacer(pairs...).Replace(s)
}

func goldenLevel(l *DocumentLevel) string {
	if l == nil {
		return "-"
	}
	return string(*l)
}

// renderAccessBatchResult is the answer of one UpdateDocumentAccess call
// without its random ids: per-item outcome (a share id only says whether one
// came back) and the preview.
func renderAccessBatchResult(res DocumentAccessBatchResult) string {
	var b strings.Builder
	for _, r := range res.Results {
		fmt.Fprintf(&b, "result %d %s/%s %s level=%s prev=%s share=%t\n",
			r.Index, r.PrincipalType, r.PrincipalID, r.Status, goldenLevel(r.Level), goldenLevel(r.PreviousLevel), r.ShareID != "")
	}
	for _, u := range res.Preview.Users {
		fmt.Fprintf(&b, "user %s %q before=%s/%s after=%s/%s\n",
			u.UserID, u.DisplayName, u.Before.Level, u.Before.Via, u.After.Level, u.After.Via)
	}
	for _, g := range res.Preview.Groups {
		fmt.Fprintf(&b, "group %s/%s level=%s members=%d losing=%d\n",
			g.PrincipalType, g.PrincipalID, goldenLevel(g.Level), g.MemberCount, g.LosingCount)
	}
	for _, w := range res.Preview.Warnings {
		fmt.Fprintf(&b, "warning %d %s\n", w.Index, w.Code)
	}
	return b.String()
}

// renderAccessBatchRows is every row a batch leaves on one document: the share
// rows (live and revoked, with provenance), then the audit rows and outbox
// rows in the order they were written. Share ids are named after their
// principal and liveness, so a share_id in an audit row or an event proves
// which row it points at.
func renderAccessBatchRows(t *testing.T, f *docPermFixture, documentID string, names accessBatchGoldenNames) string {
	t.Helper()
	var b strings.Builder
	var visibility, workspaceLevel string
	if err := f.pool.QueryRow(f.ctx, `SELECT visibility, workspace_level FROM documents WHERE id = $1`, documentID).
		Scan(&visibility, &workspaceLevel); err != nil {
		t.Fatal(err)
	}
	fmt.Fprintf(&b, "doc %s/%s\n", visibility, workspaceLevel)

	rows, err := f.pool.Query(f.ctx, `
		SELECT id, principal_type, principal_id, level, (revoked_at IS NULL), COALESCE(revoked_by, ''),
		       COALESCE(source_kind, ''), COALESCE(prior_manual_level, ''), granted_by, granted_by_kind
		  FROM document_shares WHERE document_id = $1`, documentID)
	if err != nil {
		t.Fatal(err)
	}
	var shareLines []string
	shareNames := accessBatchGoldenNames{}
	for rows.Next() {
		var id, pt, pid, lvl, revokedBy, src, prior, by, byKind string
		var live bool
		if err := rows.Scan(&id, &pt, &pid, &lvl, &live, &revokedBy, &src, &prior, &by, &byKind); err != nil {
			t.Fatal(err)
		}
		state := "revoked"
		if live {
			state = "live"
		}
		label := fmt.Sprintf("share(%s/%s/%s/%s)", pt, names.replace(pid), lvl, state)
		shareNames[id] = label
		shareLines = append(shareLines, fmt.Sprintf("%s revoked_by=%s source=%s prior=%s by=%s/%s",
			label, names.replace(revokedBy), src, prior, names.replace(by), byKind))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	sort.Strings(shareLines)
	for _, l := range shareLines {
		b.WriteString(l + "\n")
	}

	all := accessBatchGoldenNames{}
	for k, v := range names {
		all[k] = v
	}
	for k, v := range shareNames {
		all[k] = v
	}
	auditRows, err := f.pool.Query(f.ctx, `
		SELECT action, actor_id, actor_kind, changes::text, metadata::text
		  FROM audit_events WHERE resource_id = $1 ORDER BY occurred_at, id`, documentID)
	if err != nil {
		t.Fatal(err)
	}
	for auditRows.Next() {
		var action, actorID, actorKind, changes, meta string
		if err := auditRows.Scan(&action, &actorID, &actorKind, &changes, &meta); err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(&b, "audit %s by=%s/%s changes=%s meta=%s\n", action, all.replace(actorID), actorKind,
			all.replace(changes), all.replace(meta))
	}
	if err := auditRows.Err(); err != nil {
		t.Fatal(err)
	}
	auditRows.Close()

	outRows, err := f.pool.Query(f.ctx, `
		SELECT topic, payload FROM outbox_events
		 WHERE payload::jsonb->>'document_id' = $1 ORDER BY id`, documentID)
	if err != nil {
		t.Fatal(err)
	}
	for outRows.Next() {
		var topic, raw string
		if err := outRows.Scan(&topic, &raw); err != nil {
			t.Fatal(err)
		}
		var p map[string]string
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatal(err)
		}
		keys := make([]string, 0, len(p))
		for k := range p {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			parts = append(parts, k+"="+all.replace(p[k]))
		}
		fmt.Fprintf(&b, "outbox %s %s\n", topic, strings.Join(parts, " "))
	}
	if err := outRows.Err(); err != nil {
		t.Fatal(err)
	}
	outRows.Close()
	return b.String()
}

// normalizeBatchID names the command's batch id, which is random per call.
func normalizeBatchID(s, batchID string) string {
	if batchID == "" {
		return s
	}
	return strings.ReplaceAll(s, batchID, "BATCH")
}

// TestDocumentAccessBatchMatchesThePerItemPath is the UNI-2012 S1e-bulk
// equivalence contract. The goldens were recorded from the per-item
// implementation (one resolver call per person and state, one write and one
// audit row per item) before the set-based rewrite, over a mixed batch that
// touches every item shape: raise, revoke, keep, same level, a chat-origin row
// at the same level (left as it is) and below it (replaced, provenance
// dropped), a workspace grant raise, a new organization grant, the home row,
// an organization admin below their member level, a revoke of nobody, and a
// run of fresh grantees. Same input must give the same results, preview,
// share rows, audit rows and outbox rows, in the same order.
func TestDocumentAccessBatchMatchesThePerItemPath(t *testing.T) {
	f := newDocPermFixture(t)

	newDoc := func(t *testing.T, slug string) (db.Document, accessBatchGoldenNames, []DocumentAccessBatchItem, string) {
		t.Helper()
		tn := f.tenant(t, slug)
		mgr := tn.aclOwner.ID
		doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: mgr, createdBy: mgr})
		doc = setWorkspaceLevel(t, f, doc, "view")
		names := accessBatchGoldenNames{
			doc.ID: "DOC", tn.orgID: "ORG", tn.wsA: "WSA", tn.wsB: "WSB",
			tn.owner.ID: "owner", tn.orgAdmin.ID: "orgadmin", tn.wsAdmin.ID: "wsadmin",
			tn.aclOwner.ID: "aclowner", tn.creator.ID: "creator", tn.member.ID: "member",
			tn.outsider.ID: "outsider", tn.bMember.ID: "bmember",
		}
		fresh := seedAccessBatchUsers(t, f, tn.orgID, "s1eq", 6)
		for i, id := range fresh {
			names[id] = fmt.Sprintf("fresh%d", i)
		}
		f.share(t, doc, DocumentPrincipalUser, tn.member.ID, DocumentLevelComment, mgr)
		f.share(t, doc, DocumentPrincipalUser, tn.bMember.ID, DocumentLevelView, mgr)
		f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelEdit, mgr)
		f.share(t, doc, DocumentPrincipalUser, tn.creator.ID, DocumentLevelComment, mgr)
		f.share(t, doc, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelView, mgr)
		for _, c := range []struct {
			user  string
			level DocumentLevel
			prior string
		}{{fresh[4], DocumentLevelView, ""}, {fresh[5], DocumentLevelComment, "view"}} {
			if _, err := f.q.InsertDocumentShare(f.ctx, db.InsertDocumentShareParams{
				ID: util.NewID(), OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
				DocumentID: doc.ID, PrincipalType: DocumentPrincipalUser, PrincipalID: c.user,
				Level: string(c.level), GrantedBy: mgr, GrantedByKind: "human",
				SourceKind: nullText(DocumentShareSourceKindChat), SourceRoomID: nullText("ROOM"),
				SourceMessageID: nullText("MSG"), PriorManualLevel: nullText(c.prior),
			}); err != nil {
				t.Fatal(err)
			}
		}
		items := []DocumentAccessBatchItem{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.member.ID, Level: docLevelPtr(DocumentLevelEdit)},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: docLevelPtr(DocumentLevelView), OnExisting: DocumentAccessOnExistingKeep},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.creator.ID, Level: docLevelPtr(DocumentLevelComment)},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: docLevelPtr(DocumentLevelComment)},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: fresh[0], Level: docLevelPtr(DocumentLevelView)},
			{PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: docLevelPtr(DocumentLevelView)},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: docLevelPtr(DocumentLevelComment)},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.orgAdmin.ID, Level: docLevelPtr(DocumentLevelView)},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.wsAdmin.ID},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: fresh[1], Level: docLevelPtr(DocumentLevelManage)},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: fresh[4], Level: docLevelPtr(DocumentLevelView)},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: fresh[5], Level: docLevelPtr(DocumentLevelEdit)},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: fresh[2], Level: docLevelPtr(DocumentLevelComment)},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: mgr, Level: docLevelPtr(DocumentLevelView)},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: fresh[3], Level: docLevelPtr(DocumentLevelView)},
		}
		return doc, names, items, mgr
	}

	t.Run("dry run", func(t *testing.T) {
		doc, names, items, mgr := newDoc(t, "s1eqdry")
		before := renderAccessBatchRows(t, f, doc.ID, names)
		res, err := f.svc.UpdateDocumentAccess(f.ctx, Human(mgr), doc.ID, UpdateDocumentAccessInput{Items: items, DryRun: true})
		if err != nil {
			t.Fatal(err)
		}
		if got := names.replace(renderAccessBatchResult(res)); got != accessBatchGoldenDryResult {
			t.Errorf("dry run answer differs from the per-item path:\n got:\n%s\nwant:\n%s", got, accessBatchGoldenDryResult)
		}
		if after := renderAccessBatchRows(t, f, doc.ID, names); after != before {
			t.Errorf("dry run wrote rows:\n before:\n%s\n after:\n%s", before, after)
		}
	})

	t.Run("apply", func(t *testing.T) {
		doc, names, items, mgr := newDoc(t, "s1eqapply")
		res, err := f.svc.UpdateDocumentAccess(f.ctx, Human(mgr), doc.ID, UpdateDocumentAccessInput{Items: items})
		if err != nil {
			t.Fatal(err)
		}
		if got := names.replace(renderAccessBatchResult(res)); got != accessBatchGoldenApplyResult {
			t.Errorf("apply answer differs from the per-item path:\n got:\n%s\nwant:\n%s", got, accessBatchGoldenApplyResult)
		}
		got := normalizeBatchID(renderAccessBatchRows(t, f, doc.ID, names), res.BatchID)
		if got != accessBatchGoldenRows {
			t.Errorf("apply rows differ from the per-item path:\n got:\n%s\nwant:\n%s", got, accessBatchGoldenRows)
		}
	})
}

const accessBatchGoldenDryResult = `result 0 user/member updated level=edit prev=comment share=false
result 1 user/bmember revoked level=- prev=view share=false
result 2 user/outsider kept level=edit prev=edit share=true
result 3 user/creator unchanged level=comment prev=comment share=false
result 4 workspace/WSB updated level=comment prev=view share=false
result 5 user/fresh0 granted level=view prev=- share=false
result 6 organization/ORG granted level=view prev=- share=false
result 7 workspace/WSA updated level=comment prev=view share=false
result 8 user/orgadmin granted level=view prev=- share=false
result 9 user/wsadmin unchanged level=- prev=- share=false
result 10 user/fresh1 granted level=manage prev=- share=false
result 11 user/fresh4 unchanged level=view prev=view share=false
result 12 user/fresh5 updated level=edit prev=comment share=false
result 13 user/fresh2 granted level=comment prev=- share=false
result 14 user/aclowner granted level=view prev=- share=false
result 15 user/fresh3 granted level=view prev=- share=false
user member "member" before=comment/share after=edit/share
user bmember "bmember" before=view/share after=comment/share
user outsider "outsider" before=edit/share after=edit/share
user creator "creator" before=comment/share after=comment/member
user fresh0 "s1eq 0000" before=/ after=view/share
user orgadmin "orgadmin" before=manage/member after=manage/member
user wsadmin "wsadmin" before=manage/member after=manage/member
user fresh1 "s1eq 0001" before=/ after=manage/share
user fresh4 "s1eq 0004" before=view/share after=view/share
user fresh5 "s1eq 0005" before=comment/share after=edit/share
user fresh2 "s1eq 0002" before=/ after=comment/share
user aclowner "aclowner" before=manage/member after=manage/member
user fresh3 "s1eq 0003" before=/ after=view/share
group workspace/WSB level=comment members=3 losing=0
group organization/ORG level=view members=14 losing=0
group workspace/WSA level=comment members=6 losing=0
warning 1 downgrade
warning 2 direct_below_group
warning 8 direct_below_group
warning 14 direct_below_group
`

const accessBatchGoldenApplyResult = `result 0 user/member updated level=edit prev=comment share=true
result 1 user/bmember revoked level=- prev=view share=false
result 2 user/outsider kept level=edit prev=edit share=true
result 3 user/creator unchanged level=comment prev=comment share=false
result 4 workspace/WSB updated level=comment prev=view share=true
result 5 user/fresh0 granted level=view prev=- share=true
result 6 organization/ORG granted level=view prev=- share=true
result 7 workspace/WSA updated level=comment prev=view share=false
result 8 user/orgadmin granted level=view prev=- share=true
result 9 user/wsadmin unchanged level=- prev=- share=false
result 10 user/fresh1 granted level=manage prev=- share=true
result 11 user/fresh4 unchanged level=view prev=view share=false
result 12 user/fresh5 updated level=edit prev=comment share=true
result 13 user/fresh2 granted level=comment prev=- share=true
result 14 user/aclowner granted level=view prev=- share=true
result 15 user/fresh3 granted level=view prev=- share=true
user member "member" before=comment/share after=edit/share
user bmember "bmember" before=view/share after=comment/share
user outsider "outsider" before=edit/share after=edit/share
user creator "creator" before=comment/share after=comment/member
user fresh0 "s1eq 0000" before=/ after=view/share
user orgadmin "orgadmin" before=manage/member after=manage/member
user wsadmin "wsadmin" before=manage/member after=manage/member
user fresh1 "s1eq 0001" before=/ after=manage/share
user fresh4 "s1eq 0004" before=view/share after=view/share
user fresh5 "s1eq 0005" before=comment/share after=edit/share
user fresh2 "s1eq 0002" before=/ after=comment/share
user aclowner "aclowner" before=manage/member after=manage/member
user fresh3 "s1eq 0003" before=/ after=view/share
group workspace/WSB level=comment members=3 losing=0
group organization/ORG level=view members=14 losing=0
group workspace/WSA level=comment members=6 losing=0
warning 1 downgrade
warning 2 direct_below_group
warning 8 direct_below_group
warning 14 direct_below_group
`

const accessBatchGoldenRows = `doc workspace/comment
share(organization/ORG/view/live) revoked_by= source= prior= by=aclowner/human
share(user/aclowner/view/live) revoked_by= source= prior= by=aclowner/human
share(user/bmember/view/revoked) revoked_by=aclowner source= prior= by=aclowner/human
share(user/creator/comment/live) revoked_by= source= prior= by=aclowner/human
share(user/fresh0/view/live) revoked_by= source= prior= by=aclowner/human
share(user/fresh1/manage/live) revoked_by= source= prior= by=aclowner/human
share(user/fresh2/comment/live) revoked_by= source= prior= by=aclowner/human
share(user/fresh3/view/live) revoked_by= source= prior= by=aclowner/human
share(user/fresh4/view/live) revoked_by= source=chat prior= by=aclowner/human
share(user/fresh5/comment/revoked) revoked_by=aclowner source=chat prior=view by=aclowner/human
share(user/fresh5/edit/live) revoked_by= source= prior= by=aclowner/human
share(user/member/comment/revoked) revoked_by=aclowner source= prior= by=aclowner/human
share(user/member/edit/live) revoked_by= source= prior= by=aclowner/human
share(user/orgadmin/view/live) revoked_by= source= prior= by=aclowner/human
share(user/outsider/edit/live) revoked_by= source= prior= by=aclowner/human
share(workspace/WSB/comment/live) revoked_by= source= prior= by=aclowner/human
share(workspace/WSB/view/revoked) revoked_by=aclowner source= prior= by=aclowner/human
audit document.shared by=aclowner/human changes={"level":{"from":"comment","to":"edit"}} meta={"batch_id":"BATCH","principal_id":"member","principal_type":"user","share_id":"share(user/member/edit/live)"}
audit document.share_revoked by=aclowner/human changes={} meta={"batch_id":"BATCH","level":"view","principal_id":"bmember","principal_type":"user","share_id":"share(user/bmember/view/revoked)"}
audit document.shared by=aclowner/human changes={"level":{"from":"view","to":"comment"}} meta={"batch_id":"BATCH","principal_id":"WSB","principal_type":"workspace","share_id":"share(workspace/WSB/comment/live)"}
audit document.shared by=aclowner/human changes={"level":{"from":null,"to":"view"}} meta={"batch_id":"BATCH","principal_id":"fresh0","principal_type":"user","share_id":"share(user/fresh0/view/live)"}
audit document.shared by=aclowner/human changes={"level":{"from":null,"to":"view"}} meta={"batch_id":"BATCH","principal_id":"ORG","principal_type":"organization","share_id":"share(organization/ORG/view/live)"}
audit document.workspace_access_changed by=aclowner/human changes={"workspace_level":{"from":"view","to":"comment"}} meta={"batch_id":"BATCH"}
audit document.shared by=aclowner/human changes={"level":{"from":null,"to":"view"}} meta={"batch_id":"BATCH","principal_id":"orgadmin","principal_type":"user","share_id":"share(user/orgadmin/view/live)"}
audit document.shared by=aclowner/human changes={"level":{"from":null,"to":"manage"}} meta={"batch_id":"BATCH","principal_id":"fresh1","principal_type":"user","share_id":"share(user/fresh1/manage/live)"}
audit document.shared by=aclowner/human changes={"level":{"from":"comment","to":"edit"}} meta={"batch_id":"BATCH","principal_id":"fresh5","principal_type":"user","share_id":"share(user/fresh5/edit/live)"}
audit document.shared by=aclowner/human changes={"level":{"from":null,"to":"comment"}} meta={"batch_id":"BATCH","principal_id":"fresh2","principal_type":"user","share_id":"share(user/fresh2/comment/live)"}
audit document.shared by=aclowner/human changes={"level":{"from":null,"to":"view"}} meta={"batch_id":"BATCH","principal_id":"aclowner","principal_type":"user","share_id":"share(user/aclowner/view/live)"}
audit document.shared by=aclowner/human changes={"level":{"from":null,"to":"view"}} meta={"batch_id":"BATCH","principal_id":"fresh3","principal_type":"user","share_id":"share(user/fresh3/view/live)"}
outbox document.shared document_id=DOC notify_user_id=member share_id=share(user/member/edit/live) workspace_id=WSA
outbox document.share_revoked document_id=DOC share_id=share(user/bmember/view/revoked) workspace_id=WSA
outbox document.shared document_id=DOC share_id=share(workspace/WSB/comment/live) workspace_id=WSA
outbox document.shared document_id=DOC notify_user_id=fresh0 share_id=share(user/fresh0/view/live) workspace_id=WSA
outbox document.shared document_id=DOC share_id=share(organization/ORG/view/live) workspace_id=WSA
outbox document.workspace_access_changed document_id=DOC workspace_id=WSA
outbox document.shared document_id=DOC share_id=share(user/orgadmin/view/live) workspace_id=WSA
outbox document.shared document_id=DOC notify_user_id=fresh1 share_id=share(user/fresh1/manage/live) workspace_id=WSA
outbox document.shared document_id=DOC notify_user_id=fresh5 share_id=share(user/fresh5/edit/live) workspace_id=WSA
outbox document.shared document_id=DOC notify_user_id=fresh2 share_id=share(user/fresh2/comment/live) workspace_id=WSA
outbox document.shared document_id=DOC share_id=share(user/aclowner/view/live) workspace_id=WSA
outbox document.shared document_id=DOC notify_user_id=fresh3 share_id=share(user/fresh3/view/live) workspace_id=WSA
`

// TestDocumentAccessBatchPreviewLevelsMatchThePerUserResolver holds the set
// resolve of the preview (UNI-2012 S1e-bulk) to the per-user resolver it
// replaced, live: every user item's before/after level and via must be what
// resolveLevelInTenantWithShares answers for that person on the command-start
// and the simulated final state. It covers what the golden does not: a
// restricted document, AdminScope with and without a break-glass grant, the
// home row turned on and off, and a workspace share revoked under its members.
func TestDocumentAccessBatchPreviewLevelsMatchThePerUserResolver(t *testing.T) {
	f := newDocPermFixture(t)
	for _, visibility := range []string{"restricted", "workspace"} {
		t.Run(visibility, func(t *testing.T) {
			tn := f.tenant(t, "s1elv"+visibility[:2])
			doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: visibility, aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
			f.share(t, doc, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, tn.aclOwner.ID)
			f.share(t, doc, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
			if visibility == "restricted" {
				if _, _, err := f.svc.GrantDocumentBreakGlass(f.ctx, Human(tn.wsAdmin.ID), doc.ID, "truy cap khan cap cho kiem tra"); err != nil {
					t.Fatal(err)
				}
			}
			home := docLevelPtr(DocumentLevelComment)
			if visibility == "workspace" {
				home = nil
			}
			items := []DocumentAccessBatchItem{
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: home},
				{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.owner.ID, Level: docLevelPtr(DocumentLevelView)},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.orgAdmin.ID},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.wsAdmin.ID},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.creator.ID, Level: docLevelPtr(DocumentLevelView)},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.member.ID, Level: docLevelPtr(DocumentLevelEdit)},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: docLevelPtr(DocumentLevelComment)},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: docLevelPtr(DocumentLevelView)},
				{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.aclOwner.ID},
			}
			sharesBefore, err := f.q.ListDocumentShares(f.ctx, db.ListDocumentSharesParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
			})
			if err != nil {
				t.Fatal(err)
			}
			docAfter, sharesAfter := simulateAccessBatchState(doc, sharesBefore, items)

			res, err := f.svc.UpdateDocumentAccess(f.ctx, Human(tn.aclOwner.ID), doc.ID, UpdateDocumentAccessInput{Items: items, DryRun: true})
			if err != nil {
				t.Fatal(err)
			}
			if len(res.Preview.Users) != 8 {
				t.Fatalf("preview users = %d, want 8", len(res.Preview.Users))
			}
			want := func(acc DocumentAccess) DocumentAccessPreviewLevel {
				if acc.Level == DocumentLevelNone {
					return DocumentAccessPreviewLevel{}
				}
				return DocumentAccessPreviewLevel{Level: acc.Level, Via: string(acc.Via)}
			}
			sawBreakGlass := visibility != "restricted"
			for _, u := range res.Preview.Users {
				before, err := f.svc.resolveLevelInTenantWithShares(f.ctx, f.q, Human(u.UserID), doc, sharesBefore)
				if err != nil {
					t.Fatal(err)
				}
				after, err := f.svc.resolveLevelInTenantWithShares(f.ctx, f.q, Human(u.UserID), docAfter, sharesAfter)
				if err != nil {
					t.Fatal(err)
				}
				if u.Before != want(before) || u.After != want(after) {
					t.Errorf("%s: preview before/after = %+v/%+v, per-user resolver = %+v/%+v",
						u.DisplayName, u.Before, u.After, want(before), want(after))
				}
				if u.Before.Via == string(DocumentViaBreakGlass) {
					sawBreakGlass = true
				}
			}
			if !sawBreakGlass {
				t.Fatal("no preview level came through the break-glass grant; the case does not cover AdminScope")
			}
		})
	}
}
