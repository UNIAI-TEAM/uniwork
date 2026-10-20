package service

import (
	"context"
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ShareDocumentBatch grants one level to any number of users of the
// document's organization in a single transaction (UNI-1641; UNI-2012 S1c
// removed the 50-user cap). Ids are trimmed and de-duplicated (first
// occurrence keeps its place); every user is validated before anything is
// written, so one refusal leaves no row, audit entry or event behind. Each
// user then gets exactly what ShareDocument would give: the same live level is
// a no-op, another level is revoked and replaced. The result follows the
// request order.
//
// The gate is ShareDocument's (UNI-1628, DOC-05): a reader or an AdminScope
// caller gets in and only a caller who may administer changes access. A batch
// that would reach an admin-only caller themself is refused as a whole with
// break_glass_required, after every principal is validated and before any
// write, so it leaves no row, audit entry or event.
//
// Size (S1c): the organization gate is one query for every id, and the grants
// are written documentShareWriteChunk at a time inside the one transaction.
// Audit and notice policy: every written grant keeps its own document.shared
// audit row and event, exactly what ShareDocument writes - each grantee is a
// person the caller named, the change feed and the access history read one
// principal per row, and the event is how the notify lane reaches that one
// grantee. notify_user_id is stamped only for a grantee whose effective level
// the batch strictly raises (notifyOnUsersShare, decided in one set resolve
// before the first write), so the notify lane creates exactly one document_shared notice per
// raised grantee and nobody else hears. The rows go out through
// audit.Recorder.RecordMany, one statement per table per chunk.
func (s *DocumentService) ShareDocumentBatch(ctx context.Context, actor Actor, documentID string, principalIDs []string, level DocumentLevel) ([]db.DocumentShare, error) {
	ids, err := distinctShareBatchIDs(principalIDs)
	if err != nil {
		return nil, err
	}
	if err := validShareLevel(level); err != nil {
		return nil, err
	}
	var out []db.DocumentShare
	err = s.withDocumentViewOrAdministerMutationLocked(ctx, actor, documentID, "", shelveWriteRefused, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if err := requireDocumentACLChange(doc, access); err != nil {
			return err
		}
		if err := refuseFolderShare(doc); err != nil {
			return err
		}
		// validateSharePrincipal's user leg for every id in one query.
		admitted, err := s.orgs.AdmittedMemberIDsQ(ctx, q, doc.OrganizationID, ids)
		if err != nil {
			return err
		}
		var refused []string
		for _, id := range ids {
			if !admitted[id] {
				refused = append(refused, id)
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
		// A user whose live direct share is already at level gets no write, so
		// no event to stamp: only the others need the notify decision.
		unchanged := make(map[string]bool)
		for _, sh := range sharesBefore {
			if sh.PrincipalType == DocumentPrincipalUser && sh.Level == string(level) {
				unchanged[sh.PrincipalID] = true
			}
		}
		toWrite := make([]string, 0, len(ids))
		for _, id := range ids {
			if !unchanged[id] {
				toWrite = append(toWrite, id)
			}
		}
		notify, err := s.notifyOnUsersShare(ctx, q, actor, doc, sharesBefore, toWrite, level)
		if err != nil {
			return err
		}
		live, written, err := writeUserSharesBulk(ctx, q, actor, doc, sharesBefore, ids, level, userShareSource{})
		if err != nil {
			return err
		}
		if err := recordUserSharesEach(ctx, q, actor, doc, written, notify); err != nil {
			return err
		}
		shares := make([]db.DocumentShare, 0, len(ids))
		for _, id := range ids {
			shares = append(shares, live[id])
		}
		out = shares
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// recordUserSharesEach writes, for every grant a bulk write inserted, the
// audit row and document.shared event applyDocumentShareWithBatch writes for
// one grant - same diff, same metadata, same ids-only payload with the
// recipient's notify_user_id when the caller decided one - a chunk at a time.
func recordUserSharesEach(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, written []writtenUserShare, notify map[string]string) error {
	for start := 0; start < len(written); start += documentShareWriteChunk {
		chunk := written[start:min(start+documentShareWriteChunk, len(written))]
		recs := make([]audit.Recorded, 0, len(chunk))
		for _, w := range chunk {
			sh := w.share
			var before map[string]any
			if w.prevLevel != "" {
				before = map[string]any{"level": w.prevLevel}
			}
			payload := map[string]string{
				"document_id":  doc.ID,
				"workspace_id": doc.WorkspaceID,
				"share_id":     sh.ID,
			}
			if uid := notify[sh.PrincipalID]; uid != "" {
				payload["notify_user_id"] = uid
			}
			recs = append(recs, audit.Recorded{
				Entry: audit.Entry{
					OrganizationID: doc.OrganizationID,
					WorkspaceID:    doc.WorkspaceID,
					Actor:          actor,
					Action:         audit.ActionDocumentShared,
					ResourceType:   "document",
					ResourceID:     doc.ID,
					Changes:        audit.Diff(before, map[string]any{"level": sh.Level}),
					Metadata: map[string]any{
						"share_id":       sh.ID,
						"principal_type": sh.PrincipalType,
						"principal_id":   sh.PrincipalID,
					},
				},
				Events: []audit.Event{{Topic: "document.shared", Payload: payload}},
			})
		}
		if err := auditRecorder.RecordMany(ctx, q, recs); err != nil {
			return err
		}
	}
	return nil
}

// distinctShareBatchIDs trims and de-duplicates the requested ids: empty or
// blank is a 400. There is no upper bound (UNI-2012 S1c); the 1 MiB JSON body
// cap of decode is the only size limit a request meets.
func distinctShareBatchIDs(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return nil, Invalid("principal_ids bắt buộc, ít nhất 1 người dùng")
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
	return ids, nil
}
