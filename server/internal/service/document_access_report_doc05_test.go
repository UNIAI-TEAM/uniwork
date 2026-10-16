package service

import (
	"bytes"
	"encoding/csv"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The access report (UNI-1643) under G8-18's comment level and DOC-05's
// AdminScope and break-glass grants: the report lists what the caller may
// administer (canAdminister), shows every live grant as a row, and never
// carries a document's content.

// arBreakGlass inserts a break-glass grant of userID on d; revoked or expired
// grants are history the report must not show.
func (f *docPermFixture) arBreakGlass(t *testing.T, d db.Document, userID string, expires time.Time, revoked bool) string {
	t.Helper()
	id := util.NewID()
	row := map[string]any{
		"id": id, "organization_id": d.OrganizationID, "workspace_id": d.WorkspaceID, "document_id": d.ID,
		"actor_id": userID, "actor_kind": "human", "level": "view", "reason": "kiểm tra hợp đồng khẩn",
		"expires_at": expires,
	}
	if revoked {
		row["revoked_at"] = time.Now()
		row["revoked_by"] = userID
	}
	insertRow(t, f.ctx, f.pool, "document_break_glass_grants", row)
	return id
}

func TestAccessReportDOC05AdminScopeCommentAndBreakGlass(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ard1")
	r := f.arDoc(t, tn, arDocSpec{title: "Lương 2026", visibility: "restricted", aclOwner: tn.aclOwner.ID})
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET content_text = 'NOI-DUNG-MAT' WHERE id = $1`, r.ID); err != nil {
		t.Fatal(err)
	}
	f.share(t, r, DocumentPrincipalUser, tn.member.ID, DocumentLevelComment, tn.aclOwner.ID)
	f.arBreakGlass(t, r, tn.wsAdmin.ID, time.Now().Add(23*time.Hour), false)
	f.arBreakGlass(t, r, tn.orgAdmin.ID, time.Now().Add(-time.Minute), false) // expired
	f.arBreakGlass(t, r, tn.owner.ID, time.Now().Add(time.Hour), true)        // revoked

	// The organization owner holds AdminScope only: listed (canAdminister),
	// no read level, no content.
	page := f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{})
	arSame(t, "listed", arIDs(page), []string{r.ID})
	it := arItem(t, page, r.ID)
	if it.Item.Access.Level != DocumentLevelNone || !it.Item.Access.AdminScope {
		t.Fatalf("caller access = %+v, want AdminScope with no level", it.Item.Access)
	}
	if it.Item.Document.Title != "Lương 2026" || it.Item.Document.ContentText != "" || len(it.Item.Document.Content) != 0 {
		t.Fatalf("document block carries content: title=%q content_text=%q", it.Item.Document.Title, it.Item.Document.ContentText)
	}
	arSame(t, "rows", arRowKeys(it), []string{
		"acl_owner|member|user|" + tn.aclOwner.ID + "|manage|manage|active",
		"share|share|user|" + tn.member.ID + "|comment|comment|active",
		"break_glass|break_glass|user|" + tn.wsAdmin.ID + "|view|view|active",
	})
	bg := it.Rows[2]
	if bg.GrantedAt == nil || bg.GrantedBy != tn.wsAdmin.ID || bg.GrantedByName != "wsadmin" || bg.PrincipalName != "wsadmin" || bg.ShareID != "" {
		t.Fatalf("break-glass row: %+v", bg)
	}

	// The level filter treats comment and the grant's view like any level.
	page = f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{Levels: []string{"comment"}})
	arSame(t, "comment filter", arRowKeys(arItem(t, page, r.ID)), []string{
		"share|share|user|" + tn.member.ID + "|comment|comment|active",
	})
	page = f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{Levels: []string{"view"}})
	arSame(t, "view filter", arRowKeys(arItem(t, page, r.ID)), []string{
		"break_glass|break_glass|user|" + tn.wsAdmin.ID + "|view|view|active",
	})

	// The person filter reads a grant into the person's level.
	page = f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{PersonID: tn.wsAdmin.ID})
	if it := arItem(t, page, r.ID); it.PersonLevel != DocumentLevelView || len(it.Rows) != 1 || it.Rows[0].Source != AccessReportSourceBreakGlass {
		t.Fatalf("person wsAdmin: level=%q rows=%v", it.PersonLevel, arRowKeys(it))
	}
	page = f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{PersonID: tn.member.ID})
	if it := arItem(t, page, r.ID); it.PersonLevel != DocumentLevelComment {
		t.Fatalf("person member: level=%q", it.PersonLevel)
	}

	// The admin holding the grant reads at view through it and still
	// administers the document; the comment reader is skipped, not listed.
	page = f.report(t, Human(tn.wsAdmin.ID), tn.wsA, DocumentAccessReportQuery{})
	if it := arItem(t, page, r.ID); it.Item.Access.Level != DocumentLevelView || it.Item.Access.Via != DocumentViaBreakGlass || !it.Item.Access.AdminScope {
		t.Fatalf("grant holder access = %+v", it.Item.Access)
	}
	page = f.report(t, Human(tn.member.ID), tn.wsA, DocumentAccessReportQuery{})
	if len(page.Items) != 0 || page.Skipped != 1 {
		t.Fatalf("comment reader: items=%v skipped=%d, want none and 1", arIDs(page), page.Skipped)
	}

	// The export writes the same rows, comment and break_glass as their
	// keys, and no content.
	var buf bytes.Buffer
	if _, err := f.svc.ExportDocumentAccessReport(f.ctx, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{}, AccessReportFormatCSV, &buf); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(buf.Bytes(), []byte("NOI-DUNG-MAT")) || bytes.Contains(buf.Bytes(), []byte("kiểm tra hợp đồng")) {
		t.Fatal("the export carries the document content or the break-glass reason")
	}
	lines, err := csv.NewReader(bytes.NewReader(buf.Bytes()[3:])).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, l := range lines[1:] {
		got = append(got, strings.Join([]string{l[7], l[8], l[12], l[13]}, "|"))
	}
	arSame(t, "export rows", got, []string{
		"acl_owner|member|manage|manage",
		"share|share|comment|comment",
		"break_glass|break_glass|view|view",
	})
}

// A restricted folder scopes the report for an admin who administers it
// without reading it (its title is metadata to them); a member who cannot
// read it still gets the one not-found answer.
func TestAccessReportDOC05RestrictedFolderScope(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ard2")
	folder := f.arDoc(t, tn, arDocSpec{kind: DocumentKindFolder, title: "Nhân sự", visibility: "restricted", aclOwner: tn.aclOwner.ID})
	child := f.arDoc(t, tn, arDocSpec{parent: folder.ID, visibility: "restricted", aclOwner: tn.aclOwner.ID})

	page := f.report(t, Human(tn.wsAdmin.ID), tn.wsA, DocumentAccessReportQuery{FolderID: folder.ID})
	if page.FolderID != folder.ID || page.FolderTitle != "Nhân sự" {
		t.Fatalf("scope = %q %q", page.FolderID, page.FolderTitle)
	}
	arSame(t, "listed", arIDs(page), arSorted(folder.ID, child.ID))

	_, err := f.svc.DocumentAccessReport(f.ctx, Human(tn.member.ID), tn.wsA, DocumentAccessReportQuery{FolderID: folder.ID})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("member on a restricted folder: err = %v, want not found", err)
	}
}

// decideFileSave answers an archived row before the content gate: whoever
// could save learns it is archived, everyone below edit - an AdminScope
// caller with no read level included - gets not_found, the preflight's
// answer (readableDocument), never document_restricted for a row in the
// trash. A live row keeps decideDocumentContent at edit.
func TestDecideFileSaveArchivedAnswersBeforeRestricted(t *testing.T) {
	live := db.Document{Visibility: documentVisibilityRestricted}
	archived := live
	archived.ArchivedAt.Valid = true
	adminOnly := DocumentAccess{AdminScope: true}
	for _, c := range []struct {
		name   string
		doc    db.Document
		access DocumentAccess
		want   error
	}{
		{"archived, admin only", archived, adminOnly, ErrNotFound},
		{"archived, admin with a break-glass view", archived, DocumentAccess{Level: DocumentLevelView, Via: DocumentViaBreakGlass, AdminScope: true}, ErrNotFound},
		{"archived, comment share", archived, DocumentAccess{Level: DocumentLevelComment, Via: DocumentViaShare}, ErrNotFound},
		{"archived, editor", archived, DocumentAccess{Level: DocumentLevelEdit, Via: DocumentViaShare}, ErrDocumentArchived},
		{"archived, manager", archived, DocumentAccess{Level: DocumentLevelManage}, ErrDocumentArchived},
		{"live, admin only", live, adminOnly, ErrDocumentRestricted},
		{"live, comment share", live, DocumentAccess{Level: DocumentLevelComment, Via: DocumentViaShare}, ErrForbidden},
		{"live, nobody", live, DocumentAccess{}, ErrNotFound},
		{"live, editor", live, DocumentAccess{Level: DocumentLevelEdit, Via: DocumentViaShare}, nil},
	} {
		t.Run(c.name, func(t *testing.T) {
			err := decideFileSave(c.doc, c.access)
			if c.want == nil {
				if err != nil {
					t.Fatalf("err = %v, want nil", err)
				}
				return
			}
			if !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
			if c.want == ErrNotFound && errors.Is(err, ErrDocumentRestricted) {
				t.Fatalf("err = %v also reads as document_restricted", err)
			}
		})
	}
}
