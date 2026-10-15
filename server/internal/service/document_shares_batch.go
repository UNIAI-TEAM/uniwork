package service

import (
	"context"
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
func (s *DocumentService) ShareDocumentBatch(ctx context.Context, actor Actor, documentID string, principalIDs []string, level DocumentLevel) ([]db.DocumentShare, error) {
	ids, err := distinctShareBatchIDs(principalIDs)
	if err != nil {
		return nil, err
	}
	if err := validShareLevel(level); err != nil {
		return nil, err
	}
	var out []db.DocumentShare
	err = s.withDocumentMutation(ctx, actor, documentID, DocumentLevelView, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
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
			ce := errPrincipalNotInOrganization().(CodedError)
			ce.Fields = map[string]any{"principal_ids": refused}
			return ce
		}
		shares := make([]db.DocumentShare, 0, len(ids))
		for _, id := range ids {
			sh, err := applyDocumentShare(ctx, q, actor, doc, DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: id, Level: level})
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
		ce := coded(422, "share_batch_too_large", "mỗi lần chia sẻ tối đa 50 người dùng").(CodedError)
		ce.Fields = map[string]any{"max": maxDocumentShareBatch}
		return nil, ce
	}
	return ids, nil
}
