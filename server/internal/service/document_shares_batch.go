package service

import (
	"context"
	"net/http"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// maxDocumentShareBatch caps the distinct users one batch grant may name.
const maxDocumentShareBatch = 50

// ShareDocumentBatch grants one level to 1-50 users of the document's
// organization in a single transaction (UNI-1641). Ids are trimmed and
// de-duplicated (first occurrence keeps its place); every user is validated
// before anything is written, so one refusal leaves no row, audit entry or
// event behind. Each user then gets exactly what ShareDocument would give:
// the same live level is a no-op, another level is revoked and replaced.
// The result follows the request order.
//
// The gate is ShareDocument's (UNI-1628, DOC-05): a reader or an AdminScope
// caller gets in and only a caller who may administer changes access. A batch
// that would reach an admin-only caller themself is refused as a whole with
// break_glass_required, after every principal is validated and before any
// write, so it leaves no row, audit entry or event.
func (s *DocumentService) ShareDocumentBatch(ctx context.Context, actor Actor, documentID string, principalIDs []string, level DocumentLevel) ([]db.DocumentShare, error) {
	ids, err := distinctShareBatchIDs(principalIDs)
	if err != nil {
		return nil, err
	}
	if err := validShareLevel(level); err != nil {
		return nil, err
	}
	var out []db.DocumentShare
	err = s.withDocumentViewOrAdministerMutationLocked(ctx, actor, documentID, "", func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if err := requireDocumentACLChange(doc, access); err != nil {
			return err
		}
		var refused []string
		for _, id := range ids {
			err := s.validateSharePrincipal(ctx, q, doc, DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: id, Level: level})
			switch {
			case err == nil:
			case codedIs(err, "principal_not_in_organization"):
				refused = append(refused, id)
			default:
				return err
			}
		}
		if len(refused) > 0 {
			return CodedError{
				Code:   "principal_not_in_organization",
				Status: http.StatusUnprocessableEntity,
				Msg:    "người hoặc nhóm được chia sẻ không thuộc tổ chức của tài liệu",
				Fields: map[string]any{"principal_ids": refused},
			}
		}
		for _, id := range ids {
			if err := s.refuseAdminSelfShare(ctx, q, doc, access, actor, DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: id, Level: level}); err != nil {
				return err
			}
		}
		sharesBefore, err := q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			DocumentID:     doc.ID,
		})
		if err != nil {
			return err
		}
		shares := make([]db.DocumentShare, 0, len(ids))
		for _, id := range ids {
			notifyUserID, err := s.notifyOnUserShare(ctx, q, actor, doc, sharesBefore, id, level)
			if err != nil {
				return err
			}
			sh, err := s.applyDocumentShareWithBatch(ctx, q, actor, doc, access, DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: id, Level: level}, "", notifyUserID)
			if err != nil {
				return err
			}
			shares = append(shares, sh)
		}
		out = shares
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// distinctShareBatchIDs trims and de-duplicates the requested ids and applies
// the two size checks that need no database: empty or blank is a 400, more
// than maxDocumentShareBatch distinct ids is a 422 carrying the cap.
func distinctShareBatchIDs(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return nil, Invalid("principal_ids bắt buộc, từ 1 đến 50 người dùng")
	}
	seen := make(map[string]struct{}, len(raw))
	ids := make([]string, 0, len(raw))
	for _, id := range raw {
		id = strings.TrimSpace(id)
		if id == "" {
			return nil, Invalid("principal_ids không được chứa phần tử rỗng")
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) > maxDocumentShareBatch {
		return nil, CodedError{
			Code:   "share_batch_too_large",
			Status: http.StatusUnprocessableEntity,
			Msg:    "mỗi lần chia sẻ tối đa 50 người dùng",
			Fields: map[string]any{"max": maxDocumentShareBatch},
		}
	}
	return ids, nil
}
