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

	DocumentAccessActionGranted   = "granted"
	DocumentAccessActionUpdated   = "updated"
	DocumentAccessActionRevoked   = "revoked"
	DocumentAccessActionKept      = "kept"
	DocumentAccessActionUnchanged = "unchanged"

	DocumentAccessWarningWideScope        = "wide_scope"
	DocumentAccessWarningDirectBelowGroup = "direct_below_group"
	DocumentAccessWarningDowngrade        = "downgrade"
)

// DocumentAccessBatchItem is one principal change in UpdateDocumentAccessInput.
// Level is nil to revoke the principal's live grant (or turn the home row off
// to restricted when targeting the document's own workspace).
type DocumentAccessBatchItem struct {
	PrincipalType string
	PrincipalID   string
	Level         *DocumentLevel
}

// UpdateDocumentAccessInput is the input to PUT /api/v1/documents/{documentID}/access
// (SH-S2, UNI-1781).
type UpdateDocumentAccessInput struct {
	Items      []DocumentAccessBatchItem
	OnExisting string
	DryRun     bool
}

// DocumentAccessRejectedItem is one rejected item in fields.rejected of a 422
// document_access_rejected error (U-SH3).
type DocumentAccessRejectedItem struct {
	Index         int    `json:"index"`
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
	Reason        string `json:"reason"`
}

// DocumentAccessItemResult is the outcome for one item in UpdateDocumentAccess.
type DocumentAccessItemResult struct {
	PrincipalType string
	PrincipalID   string
	Action        string
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
	Before      *DocumentAccessPreviewLevel
	After       *DocumentAccessPreviewLevel
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

// DocumentAccessPreview is the preview returned by UpdateDocumentAccess on both
// dry_run=true and dry_run=false (D2).
type DocumentAccessPreview struct {
	Users    []DocumentAccessPreviewUser
	Groups   []DocumentAccessPreviewGroup
	Warnings []string
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

func validateAccessBatchInput(in UpdateDocumentAccessInput) ([]DocumentAccessBatchItem, string, error) {
	if len(in.Items) < 1 || len(in.Items) > maxDocumentAccessBatch {
		return nil, "", Invalid("items phải có từ 1 đến 100 mục")
	}
	onExisting := strings.TrimSpace(in.OnExisting)
	switch onExisting {
	case "":
		onExisting = DocumentAccessOnExistingUpdate
	case DocumentAccessOnExistingUpdate, DocumentAccessOnExistingKeep:
	default:
		return nil, "", Invalid("on_existing phải là update hoặc keep")
	}
	items := make([]DocumentAccessBatchItem, len(in.Items))
	for i, raw := range in.Items {
		pt := strings.TrimSpace(raw.PrincipalType)
		switch pt {
		case DocumentPrincipalUser, DocumentPrincipalWorkspace, DocumentPrincipalOrganization:
		default:
			return nil, "", Invalid("principal_type phải là user, workspace hoặc organization")
		}
		pid := strings.TrimSpace(raw.PrincipalID)
		if pid == "" {
			return nil, "", Invalid("principal_id bắt buộc")
		}
		var lvl *DocumentLevel
		if raw.Level != nil {
			trimmed := DocumentLevel(strings.TrimSpace(string(*raw.Level)))
			if err := validShareLevel(trimmed); err != nil {
				return nil, "", err
			}
			lvl = &trimmed
		}
		items[i] = DocumentAccessBatchItem{
			PrincipalType: pt,
			PrincipalID:   pid,
			Level:         lvl,
		}
	}
	return items, onExisting, nil
}

// UpdateDocumentAccess applies or previews a batch of mixed-principal access
// changes in one transaction (SH-S2, UNI-1781). Every item is validated before
// any write; if one fails semantic validation, the whole batch is refused with
// 422 document_access_rejected and zero rows are written.
func (s *DocumentService) UpdateDocumentAccess(ctx context.Context, actor Actor, documentID string, in UpdateDocumentAccessInput) (DocumentAccessBatchResult, error) {
	items, onExisting, err := validateAccessBatchInput(in)
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
			Warnings: make([]string, 0),
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

		warnSet := map[string]bool{}
		for _, it := range items {
			if (it.PrincipalType == DocumentPrincipalWorkspace || it.PrincipalType == DocumentPrincipalOrganization) &&
				it.Level != nil && (*it.Level == DocumentLevelEdit || *it.Level == DocumentLevelManage) {
				warnSet[DocumentAccessWarningWideScope] = true
			}
			res, updatedDoc, err := s.applyAccessBatchItem(ctx, q, actor, doc, access, it, onExisting, batchID, in.DryRun)
			if err != nil {
				return err
			}
			doc = updatedDoc
			if res.PreviousLevel != nil {
				if res.Action == DocumentAccessActionRevoked ||
					(res.Action == DocumentAccessActionUpdated && res.Level != nil && res.Level.rank() < res.PreviousLevel.rank()) {
					warnSet[DocumentAccessWarningDowngrade] = true
				}
			}
			out.Results = append(out.Results, res)
		}
		for _, code := range []string{
			DocumentAccessWarningWideScope,
			DocumentAccessWarningDirectBelowGroup,
			DocumentAccessWarningDowngrade,
		} {
			if warnSet[code] {
				out.Preview.Warnings = append(out.Preview.Warnings, code)
			}
		}
		return nil
	})
	if err != nil {
		return DocumentAccessBatchResult{}, err
	}
	return out, nil
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
				Reason: "duplicate_principal",
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
					Reason: "principal_not_in_organization",
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
					Reason: "level_not_allowed",
				})
				continue
			}
		}

		if it.Level != nil {
			if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID &&
				doc.Visibility == documentVisibilityRestricted && !access.Level.AtLeast(DocumentLevelManage) {
				rejected = append(rejected, DocumentAccessRejectedItem{
					Index: i, PrincipalType: it.PrincipalType, PrincipalID: it.PrincipalID,
					Reason: "break_glass_required",
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
						Reason: "break_glass_required",
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
	it DocumentAccessBatchItem,
	onExisting, batchID string,
	dryRun bool,
) (DocumentAccessItemResult, db.Document, error) {
	if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID {
		return s.applyHomeWorkspaceBatchItem(ctx, q, actor, doc, it, onExisting, batchID, dryRun)
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
				PrincipalType: it.PrincipalType,
				PrincipalID:   it.PrincipalID,
				Action:        DocumentAccessActionUnchanged,
			}, doc, nil
		}
		prev := DocumentLevel(prevShare.Level)
		if !dryRun {
			if err := revokeDocumentShareRowWithBatch(ctx, q, actor, doc, prevShare, batchID); err != nil {
				return DocumentAccessItemResult{}, doc, err
			}
		}
		return DocumentAccessItemResult{
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Action:        DocumentAccessActionRevoked,
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
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Action:        DocumentAccessActionGranted,
			ShareID:       shareID,
			Level:         &target,
		}, doc, nil
	}

	prev := DocumentLevel(prevShare.Level)
	if onExisting == DocumentAccessOnExistingKeep {
		kept := prev
		return DocumentAccessItemResult{
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Action:        DocumentAccessActionKept,
			ShareID:       prevShare.ID,
			Level:         &kept,
			PreviousLevel: &prev,
		}, doc, nil
	}
	if prev == target {
		unchanged := target
		return DocumentAccessItemResult{
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Action:        DocumentAccessActionUnchanged,
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
		PrincipalType: it.PrincipalType,
		PrincipalID:   it.PrincipalID,
		Action:        DocumentAccessActionUpdated,
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
	it DocumentAccessBatchItem,
	onExisting, batchID string,
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
				PrincipalType: it.PrincipalType,
				PrincipalID:   it.PrincipalID,
				Action:        DocumentAccessActionUnchanged,
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
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Action:        DocumentAccessActionRevoked,
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
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Action:        DocumentAccessActionGranted,
			Level:         &target,
		}, doc, nil
	}

	prev := cur
	if onExisting == DocumentAccessOnExistingKeep {
		kept := prev
		return DocumentAccessItemResult{
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Action:        DocumentAccessActionKept,
			Level:         &kept,
			PreviousLevel: &prev,
		}, doc, nil
	}
	if doc.Visibility == documentVisibilityWorkspace && DocumentLevel(doc.WorkspaceLevel) == target && len(legacy) == 0 {
		unchanged := target
		return DocumentAccessItemResult{
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Action:        DocumentAccessActionUnchanged,
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
		PrincipalType: it.PrincipalType,
		PrincipalID:   it.PrincipalID,
		Action:        DocumentAccessActionUpdated,
		Level:         &target,
		PreviousLevel: &prev,
	}, doc, nil
}
