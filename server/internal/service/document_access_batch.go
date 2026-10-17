package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	maxDocumentAccessBatch = 100

	DocumentAccessOnExistingUpdate = "update"
	DocumentAccessOnExistingKeep   = "keep"

	DocumentAccessStatusGranted   = "granted"
	DocumentAccessStatusUpdated   = "updated"
	DocumentAccessStatusRevoked   = "revoked"
	DocumentAccessStatusKept      = "kept"
	DocumentAccessStatusUnchanged = "unchanged"

	DocumentAccessWarningWideScope        = "wide_scope"
	DocumentAccessWarningDirectBelowGroup = "direct_below_group"
	DocumentAccessWarningDowngrade        = "downgrade"
)

// DocumentAccessBatchItem is one principal change in UpdateDocumentAccessInput.
// Level is nil to revoke the principal's live grant (or turn the home row off
// to restricted when targeting the document's own workspace). OnExisting is
// per-item ("update" default | "keep").
type DocumentAccessBatchItem struct {
	PrincipalType string
	PrincipalID   string
	Level         *DocumentLevel
	OnExisting    string
}

// UpdateDocumentAccessInput is the input to PUT /api/v1/documents/{documentID}/access
// (SH-S2, UNI-1781).
type UpdateDocumentAccessInput struct {
	Items  []DocumentAccessBatchItem
	DryRun bool
}

// DocumentAccessRejectedItem is one rejected item in fields.rejected of a 422
// document_access_rejected error (U-SH3).
type DocumentAccessRejectedItem struct {
	Index         int    `json:"index"`
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
	Code          string `json:"code"`
}

// DocumentAccessItemResult is the outcome for one item in UpdateDocumentAccess.
type DocumentAccessItemResult struct {
	Index         int
	PrincipalType string
	PrincipalID   string
	Status        string
	ShareID       string
	Level         *DocumentLevel
	PreviousLevel *DocumentLevel
}

// DocumentAccessPreviewLevel is a person's effective level + via in a preview.
type DocumentAccessPreviewLevel struct {
	Level DocumentLevel
	Via   string
}

// DocumentAccessPreviewUser is a user item's before/after effective standing.
type DocumentAccessPreviewUser struct {
	UserID      string
	DisplayName string
	Before      DocumentAccessPreviewLevel
	After       DocumentAccessPreviewLevel
}

// DocumentAccessPreviewGroup is a workspace/organization item's summary counts.
type DocumentAccessPreviewGroup struct {
	PrincipalType string
	PrincipalID   string
	Name          string
	Level         *DocumentLevel
	MemberCount   int
	LosingCount   int
}

// DocumentAccessWarning is one warning entry in DocumentAccessPreview.Warnings.
type DocumentAccessWarning struct {
	Code  string
	Index int
}

// DocumentAccessPreview is the preview returned by UpdateDocumentAccess on both
// dry_run=true and dry_run=false (D2).
type DocumentAccessPreview struct {
	Users    []DocumentAccessPreviewUser
	Groups   []DocumentAccessPreviewGroup
	Warnings []DocumentAccessWarning
}

// DocumentAccessBatchResult is the result of UpdateDocumentAccess.
type DocumentAccessBatchResult struct {
	BatchID string
	DryRun  bool
	Results []DocumentAccessItemResult
	Preview DocumentAccessPreview
}

func errDocumentAccessRejected(rejected []DocumentAccessRejectedItem) error {
	return CodedError{
		Code:   "document_access_rejected",
		Status: http.StatusUnprocessableEntity,
		Msg:    "một số mục phân quyền không hợp lệ",
		Fields: map[string]any{"rejected": rejected},
	}
}

func validateAccessBatchInput(in UpdateDocumentAccessInput) ([]DocumentAccessBatchItem, error) {
	if len(in.Items) < 1 || len(in.Items) > maxDocumentAccessBatch {
		return nil, Invalid("items phải có từ 1 đến 100 mục")
	}
	items := make([]DocumentAccessBatchItem, len(in.Items))
	for i, raw := range in.Items {
		pt := strings.TrimSpace(raw.PrincipalType)
		switch pt {
		case DocumentPrincipalUser, DocumentPrincipalWorkspace, DocumentPrincipalOrganization:
		default:
			return nil, Invalid("principal_type phải là user, workspace hoặc organization")
		}
		pid := strings.TrimSpace(raw.PrincipalID)
		if pid == "" {
			return nil, Invalid("principal_id bắt buộc")
		}
		onExisting := strings.TrimSpace(raw.OnExisting)
		switch onExisting {
		case "":
			onExisting = DocumentAccessOnExistingUpdate
		case DocumentAccessOnExistingUpdate, DocumentAccessOnExistingKeep:
		default:
			return nil, Invalid("on_existing phải là update hoặc keep")
		}
		var lvl *DocumentLevel
		if raw.Level != nil {
			trimmed := DocumentLevel(strings.TrimSpace(string(*raw.Level)))
			if err := validShareLevel(trimmed); err != nil {
				return nil, err
			}
			lvl = &trimmed
		}
		items[i] = DocumentAccessBatchItem{
			PrincipalType: pt,
			PrincipalID:   pid,
			Level:         lvl,
			OnExisting:    onExisting,
		}
	}
	return items, nil
}

// UpdateDocumentAccess applies or previews a batch of mixed-principal access
// changes in one transaction (SH-S2, UNI-1781). Every item is validated before
// any write; if one fails semantic validation, the whole batch is refused with
// 422 document_access_rejected and zero rows are written.
func (s *DocumentService) UpdateDocumentAccess(ctx context.Context, actor Actor, documentID string, in UpdateDocumentAccessInput) (DocumentAccessBatchResult, error) {
	items, err := validateAccessBatchInput(in)
	if err != nil {
		return DocumentAccessBatchResult{}, err
	}
	batchID := util.NewID()
	out := DocumentAccessBatchResult{
		BatchID: batchID,
		DryRun:  in.DryRun,
		Results: make([]DocumentAccessItemResult, 0, len(items)),
		Preview: DocumentAccessPreview{
			Users:    make([]DocumentAccessPreviewUser, 0),
			Groups:   make([]DocumentAccessPreviewGroup, 0),
			Warnings: make([]DocumentAccessWarning, 0),
		},
	}
	err = s.withDocumentViewOrAdministerMutationLocked(ctx, actor, documentID, "", func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if err := requireDocumentACLChange(doc, access); err != nil {
			return err
		}
		rejected, err := s.validateAccessBatchSemantics(ctx, q, doc, access, actor, items)
		if err != nil {
			return err
		}
		if len(rejected) > 0 {
			return errDocumentAccessRejected(rejected)
		}

		sharesBefore, err := q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			DocumentID:     doc.ID,
		})
		if err != nil {
			return err
		}
		docAfter, sharesAfter := simulateAccessBatchState(doc, sharesBefore, items)
		preview, err := s.buildAccessBatchPreview(ctx, q, doc, sharesBefore, docAfter, sharesAfter, items)
		if err != nil {
			return err
		}

		for i, it := range items {
			res, updatedDoc, err := s.applyAccessBatchItem(ctx, q, actor, doc, access, i, it, batchID, in.DryRun)
			if err != nil {
				return err
			}
			doc = updatedDoc
			out.Results = append(out.Results, res)
		}
		out.Preview = preview
		return nil
	})
	if err != nil {
		return DocumentAccessBatchResult{}, err
	}
	return out, nil
}

func filterHomeWorkspaceShares(shares []db.DocumentShare, homeWorkspaceID string) []db.DocumentShare {
	var out []db.DocumentShare
	for _, sh := range shares {
		if sh.PrincipalType == DocumentPrincipalWorkspace && sh.PrincipalID == homeWorkspaceID {
			out = append(out, sh)
		}
	}
	return out
}

func shareLevelInSlice(shares []db.DocumentShare, principalType, principalID string) (DocumentLevel, bool) {
	for _, sh := range shares {
		if sh.PrincipalType == principalType && sh.PrincipalID == principalID {
			return DocumentLevel(sh.Level), true
		}
	}
	return DocumentLevelNone, false
}

func simulateAccessBatchState(
	doc db.Document,
	sharesBefore []db.DocumentShare,
	items []DocumentAccessBatchItem,
) (db.Document, []db.DocumentShare) {
	docAfter := doc
	sharesAfter := make([]db.DocumentShare, len(sharesBefore))
	copy(sharesAfter, sharesBefore)

	removeShare := func(pt, pid string) {
		filtered := sharesAfter[:0]
		for _, sh := range sharesAfter {
			if sh.PrincipalType == pt && sh.PrincipalID == pid {
				continue
			}
			filtered = append(filtered, sh)
		}
		sharesAfter = filtered
	}

	for _, it := range items {
		if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID {
			legacy := filterHomeWorkspaceShares(sharesAfter, doc.WorkspaceID)
			_, hasLive := currentHomeWorkspaceLevel(docAfter, legacy)
			if it.Level == nil {
				if hasLive {
					docAfter.Visibility = documentVisibilityRestricted
					removeShare(DocumentPrincipalWorkspace, doc.WorkspaceID)
				}
				continue
			}
			if hasLive && it.OnExisting == DocumentAccessOnExistingKeep {
				continue
			}
			docAfter.Visibility = documentVisibilityWorkspace
			docAfter.WorkspaceLevel = string(*it.Level)
			removeShare(DocumentPrincipalWorkspace, doc.WorkspaceID)
			continue
		}

		_, hasLive := shareLevelInSlice(sharesAfter, it.PrincipalType, it.PrincipalID)
		if it.Level == nil {
			if hasLive {
				removeShare(it.PrincipalType, it.PrincipalID)
			}
			continue
		}
		if hasLive && it.OnExisting == DocumentAccessOnExistingKeep {
			continue
		}
		target := string(*it.Level)
		updated := false
		for i := range sharesAfter {
			if sharesAfter[i].PrincipalType == it.PrincipalType && sharesAfter[i].PrincipalID == it.PrincipalID {
				sharesAfter[i].Level = target
				updated = true
				break
			}
		}
		if !updated {
			sharesAfter = append(sharesAfter, db.DocumentShare{
				OrganizationID: doc.OrganizationID,
				WorkspaceID:    doc.WorkspaceID,
				DocumentID:     doc.ID,
				PrincipalType:  it.PrincipalType,
				PrincipalID:    it.PrincipalID,
				Level:          target,
			})
		}
	}
	return docAfter, sharesAfter
}

func (s *DocumentService) buildAccessBatchPreview(
	ctx context.Context,
	q *db.Queries,
	docBefore db.Document,
	sharesBefore []db.DocumentShare,
	docAfter db.Document,
	sharesAfter []db.DocumentShare,
	items []DocumentAccessBatchItem,
) (DocumentAccessPreview, error) {
	preview := DocumentAccessPreview{
		Users:    make([]DocumentAccessPreviewUser, 0),
		Groups:   make([]DocumentAccessPreviewGroup, 0),
		Warnings: make([]DocumentAccessWarning, 0),
	}

	homeAfterLvl, _ := currentHomeWorkspaceLevel(docAfter, filterHomeWorkspaceShares(sharesAfter, docAfter.WorkspaceID))
	orgAfterLvl, _ := shareLevelInSlice(sharesAfter, DocumentPrincipalOrganization, docAfter.OrganizationID)

	for idx, it := range items {
		if it.PrincipalType == DocumentPrincipalUser {
			u, err := q.GetUserByID(ctx, it.PrincipalID)
			if err != nil {
				return DocumentAccessPreview{}, err
			}
			accBefore, err := s.resolveLevelInTenantWithShares(ctx, q, Human(it.PrincipalID), docBefore, sharesBefore)
			if err != nil {
				return DocumentAccessPreview{}, err
			}
			accAfter, err := s.resolveLevelInTenantWithShares(ctx, q, Human(it.PrincipalID), docAfter, sharesAfter)
			if err != nil {
				return DocumentAccessPreview{}, err
			}
			var beforeLvl, afterLvl DocumentAccessPreviewLevel
			if accBefore.Level != DocumentLevelNone {
				beforeLvl = DocumentAccessPreviewLevel{Level: accBefore.Level, Via: string(accBefore.Via)}
			}
			if accAfter.Level != DocumentLevelNone {
				afterLvl = DocumentAccessPreviewLevel{Level: accAfter.Level, Via: string(accAfter.Via)}
			}
			prevDirect, _ := shareLevelInSlice(sharesBefore, DocumentPrincipalUser, it.PrincipalID)
			afterDirect, _ := shareLevelInSlice(sharesAfter, DocumentPrincipalUser, it.PrincipalID)
			if it.Level != nil && afterLvl.Level.rank() > (*it.Level).rank() {
				preview.Warnings = append(preview.Warnings, DocumentAccessWarning{
					Code:  DocumentAccessWarningDirectBelowGroup,
					Index: idx,
				})
			}
			if prevDirect.rank() > 0 && afterDirect.rank() < prevDirect.rank() {
				preview.Warnings = append(preview.Warnings, DocumentAccessWarning{
					Code:  DocumentAccessWarningDowngrade,
					Index: idx,
				})
			}
			preview.Users = append(preview.Users, DocumentAccessPreviewUser{
				UserID:      it.PrincipalID,
				DisplayName: u.DisplayName,
				Before:      beforeLvl,
				After:       afterLvl,
			})
			continue
		}

		var name string
		if it.PrincipalType == DocumentPrincipalWorkspace {
			ws, err := q.GetWorkspaceByID(ctx, it.PrincipalID)
			if err != nil {
				return DocumentAccessPreview{}, err
			}
			name = ws.Name
		} else {
			org, err := q.GetOrganizationByID(ctx, it.PrincipalID)
			if err != nil {
				return DocumentAccessPreview{}, err
			}
			name = org.Name
		}

		var prevLvl, afterLvl DocumentLevel
		var hasAfter bool
		isHome := it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == docBefore.WorkspaceID
		if isHome {
			prevLvl, _ = currentHomeWorkspaceLevel(docBefore, filterHomeWorkspaceShares(sharesBefore, docBefore.WorkspaceID))
			afterLvl, hasAfter = currentHomeWorkspaceLevel(docAfter, filterHomeWorkspaceShares(sharesAfter, docAfter.WorkspaceID))
		} else {
			prevLvl, _ = shareLevelInSlice(sharesBefore, it.PrincipalType, it.PrincipalID)
			afterLvl, hasAfter = shareLevelInSlice(sharesAfter, it.PrincipalType, it.PrincipalID)
		}
		var lvlPtr *DocumentLevel
		if hasAfter {
			l := afterLvl
			lvlPtr = &l
		}

		prevRank := prevLvl.rank()
		afterRank := afterLvl.rank()
		if !isHome && hasAfter && afterRank > prevRank && (afterLvl == DocumentLevelEdit || afterLvl == DocumentLevelManage) {
			preview.Warnings = append(preview.Warnings, DocumentAccessWarning{
				Code:  DocumentAccessWarningWideScope,
				Index: idx,
			})
		}
		if prevRank > 0 && afterRank < prevRank {
			preview.Warnings = append(preview.Warnings, DocumentAccessWarning{
				Code:  DocumentAccessWarningDowngrade,
				Index: idx,
			})
		}

		preservedUsers := make([]string, 0)
		preservedWS := make([]string, 0)
		if prevRank > 0 && afterRank < prevRank {
			for _, sh := range sharesAfter {
				if DocumentLevel(sh.Level).rank() < prevRank {
					continue
				}
				switch sh.PrincipalType {
				case DocumentPrincipalUser:
					preservedUsers = append(preservedUsers, sh.PrincipalID)
				case DocumentPrincipalWorkspace:
					preservedWS = append(preservedWS, sh.PrincipalID)
				}
			}
		}

		counts, err := q.CountDocumentAccessPreviewGroup(ctx, db.CountDocumentAccessPreviewGroupParams{
			PrevGroupRank:    int32(prevRank),
			AfterGroupRank:   int32(afterRank),
			OrgPreserves:     prevRank > 0 && orgAfterLvl.rank() >= prevRank,
			AclOwnerID:       docAfter.AclOwnerID,
			HomeAfterRank:    int32(homeAfterLvl.rank()),
			HomeVisible:      docAfter.Visibility == documentVisibilityWorkspace,
			HomeWorkspaceID:  docAfter.WorkspaceID,
			PreservedUserIds: preservedUsers,
			PreservedWsIds:   preservedWS,
			DocumentID:       docAfter.ID,
			OrganizationID:   docAfter.OrganizationID,
			PrincipalType:    it.PrincipalType,
			PrincipalID:      it.PrincipalID,
		})
		if err != nil {
			return DocumentAccessPreview{}, err
		}
		preview.Groups = append(preview.Groups, DocumentAccessPreviewGroup{
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Name:          name,
			Level:         lvlPtr,
			MemberCount:   int(counts.MemberCount),
			LosingCount:   int(counts.LosingCount),
		})
	}
	return preview, nil
}

func (s *DocumentService) validateAccessBatchSemantics(
	ctx context.Context,
	q *db.Queries,
	doc db.Document,
	access DocumentAccess,
	actor Actor,
	items []DocumentAccessBatchItem,
) ([]DocumentAccessRejectedItem, error) {
	type principalKey struct {
		typ string
		id  string
	}
	seen := make(map[principalKey]bool, len(items))
	var rejected []DocumentAccessRejectedItem
	for i, it := range items {
		key := principalKey{typ: it.PrincipalType, id: it.PrincipalID}
		if seen[key] {
			rejected = append(rejected, DocumentAccessRejectedItem{
				Index: i, PrincipalType: it.PrincipalType, PrincipalID: it.PrincipalID,
				Code: "duplicate_principal",
			})
			continue
		}
		seen[key] = true

		err := s.validateSharePrincipal(ctx, q, doc, DocumentShareInput{
			PrincipalType: it.PrincipalType, PrincipalID: it.PrincipalID,
		})
		if err != nil {
			if codedIs(err, "principal_not_in_organization") {
				rejected = append(rejected, DocumentAccessRejectedItem{
					Index: i, PrincipalType: it.PrincipalType, PrincipalID: it.PrincipalID,
					Code: "principal_not_in_organization",
				})
				continue
			}
			return nil, err
		}

		if it.Level != nil && *it.Level == DocumentLevelManage {
			if it.PrincipalType == DocumentPrincipalOrganization ||
				(it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID) {
				rejected = append(rejected, DocumentAccessRejectedItem{
					Index: i, PrincipalType: it.PrincipalType, PrincipalID: it.PrincipalID,
					Code: "level_not_allowed",
				})
				continue
			}
		}

		if it.Level != nil {
			if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID &&
				doc.Visibility == documentVisibilityRestricted && !access.Level.AtLeast(DocumentLevelManage) {
				rejected = append(rejected, DocumentAccessRejectedItem{
					Index: i, PrincipalType: it.PrincipalType, PrincipalID: it.PrincipalID,
					Code: "break_glass_required",
				})
				continue
			}
			err := s.refuseAdminSelfShare(ctx, q, doc, access, actor, DocumentShareInput{
				PrincipalType: it.PrincipalType, PrincipalID: it.PrincipalID, Level: *it.Level,
			})
			if err != nil {
				if codedIs(err, "break_glass_required") {
					rejected = append(rejected, DocumentAccessRejectedItem{
						Index: i, PrincipalType: it.PrincipalType, PrincipalID: it.PrincipalID,
						Code: "break_glass_required",
					})
					continue
				}
				return nil, err
			}
		}
	}
	return rejected, nil
}

func currentHomeWorkspaceLevel(doc db.Document, legacy []db.DocumentShare) (DocumentLevel, bool) {
	var cur DocumentLevel
	if doc.Visibility == documentVisibilityWorkspace {
		cur = DocumentLevel(doc.WorkspaceLevel)
	}
	for _, sh := range legacy {
		if l := DocumentLevel(sh.Level); l.rank() > cur.rank() {
			cur = l
		}
	}
	return cur, cur != DocumentLevelNone
}

func (s *DocumentService) applyAccessBatchItem(
	ctx context.Context,
	q *db.Queries,
	actor Actor,
	doc db.Document,
	access DocumentAccess,
	index int,
	it DocumentAccessBatchItem,
	batchID string,
	dryRun bool,
) (DocumentAccessItemResult, db.Document, error) {
	if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID {
		return s.applyHomeWorkspaceBatchItem(ctx, q, actor, doc, index, it, batchID, dryRun)
	}
	prevShare, err := q.GetDocumentShare(ctx, db.GetDocumentShareParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
		PrincipalType:  it.PrincipalType,
		PrincipalID:    it.PrincipalID,
	})
	hasLive := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return DocumentAccessItemResult{}, doc, err
	}

	if it.Level == nil {
		if !hasLive {
			return DocumentAccessItemResult{
				Index:         index,
				PrincipalType: it.PrincipalType,
				PrincipalID:   it.PrincipalID,
				Status:        DocumentAccessStatusUnchanged,
			}, doc, nil
		}
		prev := DocumentLevel(prevShare.Level)
		if !dryRun {
			if err := revokeDocumentShareRowWithBatch(ctx, q, actor, doc, prevShare, batchID); err != nil {
				return DocumentAccessItemResult{}, doc, err
			}
		}
		return DocumentAccessItemResult{
			Index:         index,
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Status:        DocumentAccessStatusRevoked,
			PreviousLevel: &prev,
		}, doc, nil
	}

	target := *it.Level
	if !hasLive {
		var shareID string
		if !dryRun {
			sh, err := applyDocumentShareWithBatch(ctx, q, actor, doc, access, DocumentShareInput{
				PrincipalType: it.PrincipalType, PrincipalID: it.PrincipalID, Level: target,
			}, batchID)
			if err != nil {
				return DocumentAccessItemResult{}, doc, err
			}
			shareID = sh.ID
		}
		return DocumentAccessItemResult{
			Index:         index,
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Status:        DocumentAccessStatusGranted,
			ShareID:       shareID,
			Level:         &target,
		}, doc, nil
	}

	prev := DocumentLevel(prevShare.Level)
	if it.OnExisting == DocumentAccessOnExistingKeep {
		kept := prev
		return DocumentAccessItemResult{
			Index:         index,
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Status:        DocumentAccessStatusKept,
			ShareID:       prevShare.ID,
			Level:         &kept,
			PreviousLevel: &prev,
		}, doc, nil
	}
	if prev == target {
		unchanged := target
		return DocumentAccessItemResult{
			Index:         index,
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Status:        DocumentAccessStatusUnchanged,
			Level:         &unchanged,
			PreviousLevel: &prev,
		}, doc, nil
	}

	var shareID string
	if !dryRun {
		sh, err := applyDocumentShareWithBatch(ctx, q, actor, doc, access, DocumentShareInput{
			PrincipalType: it.PrincipalType, PrincipalID: it.PrincipalID, Level: target,
		}, batchID)
		if err != nil {
			return DocumentAccessItemResult{}, doc, err
		}
		shareID = sh.ID
	}
	return DocumentAccessItemResult{
		Index:         index,
		PrincipalType: it.PrincipalType,
		PrincipalID:   it.PrincipalID,
		Status:        DocumentAccessStatusUpdated,
		ShareID:       shareID,
		Level:         &target,
		PreviousLevel: &prev,
	}, doc, nil
}

func (s *DocumentService) applyHomeWorkspaceBatchItem(
	ctx context.Context,
	q *db.Queries,
	actor Actor,
	doc db.Document,
	index int,
	it DocumentAccessBatchItem,
	batchID string,
	dryRun bool,
) (DocumentAccessItemResult, db.Document, error) {
	legacy, err := homeWorkspaceShares(ctx, q, doc)
	if err != nil {
		return DocumentAccessItemResult{}, doc, err
	}
	cur, hasLive := currentHomeWorkspaceLevel(doc, legacy)

	if it.Level == nil {
		if !hasLive {
			return DocumentAccessItemResult{
				Index:         index,
				PrincipalType: it.PrincipalType,
				PrincipalID:   it.PrincipalID,
				Status:        DocumentAccessStatusUnchanged,
			}, doc, nil
		}
		prev := cur
		if !dryRun {
			updated, err := writeDocumentHomeRow(ctx, q, actor, doc, documentHomeRowMove{
				Visibility:     documentVisibilityRestricted,
				WorkspaceLevel: doc.WorkspaceLevel,
				BatchID:        batchID,
			})
			if err != nil {
				return DocumentAccessItemResult{}, doc, err
			}
			doc = updated
		}
		return DocumentAccessItemResult{
			Index:         index,
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Status:        DocumentAccessStatusRevoked,
			PreviousLevel: &prev,
		}, doc, nil
	}

	target := *it.Level
	if !hasLive {
		if !dryRun {
			updated, err := writeDocumentHomeRow(ctx, q, actor, doc, documentHomeRowMove{
				Visibility:     documentVisibilityWorkspace,
				WorkspaceLevel: string(target),
				BatchID:        batchID,
			})
			if err != nil {
				return DocumentAccessItemResult{}, doc, err
			}
			doc = updated
		}
		return DocumentAccessItemResult{
			Index:         index,
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Status:        DocumentAccessStatusGranted,
			Level:         &target,
		}, doc, nil
	}

	prev := cur
	if it.OnExisting == DocumentAccessOnExistingKeep {
		kept := prev
		return DocumentAccessItemResult{
			Index:         index,
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Status:        DocumentAccessStatusKept,
			Level:         &kept,
			PreviousLevel: &prev,
		}, doc, nil
	}
	if doc.Visibility == documentVisibilityWorkspace && DocumentLevel(doc.WorkspaceLevel) == target && len(legacy) == 0 {
		unchanged := target
		return DocumentAccessItemResult{
			Index:         index,
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Status:        DocumentAccessStatusUnchanged,
			Level:         &unchanged,
			PreviousLevel: &prev,
		}, doc, nil
	}
	if !dryRun {
		updated, err := writeDocumentHomeRow(ctx, q, actor, doc, documentHomeRowMove{
			Visibility:     documentVisibilityWorkspace,
			WorkspaceLevel: string(target),
			BatchID:        batchID,
		})
		if err != nil {
			return DocumentAccessItemResult{}, doc, err
		}
		doc = updated
	}
	return DocumentAccessItemResult{
		Index:         index,
		PrincipalType: it.PrincipalType,
		PrincipalID:   it.PrincipalID,
		Status:        DocumentAccessStatusUpdated,
		Level:         &target,
		PreviousLevel: &prev,
	}, doc, nil
}
