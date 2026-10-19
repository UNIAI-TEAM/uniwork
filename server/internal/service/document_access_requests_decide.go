package service

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document access requests, manager side (DOC-07, UNI-1631; w2). The create
// path is w1's (document_access_requests.go); this file answers a request: the
// list a manager reads, the count the share dialog shows, the approve that
// creates the share, the decline, and the delivery-time check the notification
// rules filter their recipients through.
//
// Approve and decline run through withDocumentAdministerMutation: one
// transaction that locks the document row, re-evaluates the caller's level and
// only then locks the request row (FOR UPDATE). The share an approve creates is
// written by the same transaction through shareDocumentInTx, so a decision is
// one unit: either the request is closed and the share exists, or neither.
//
// The topic is document.access_request_decided (ScopeUser, ids only, addressed
// to the requester).

const topicDocumentAccessRequestDecided = "document.access_request_decided"

// DocumentAccessRequestSource is the optional task or meeting a request was
// sent from. Title is filled only when the caller reads that row; a manager who
// cannot read the source sees the kind and the id, never the title.
type DocumentAccessRequestSource struct {
	Kind  string
	ID    string
	Title string
}

// DocumentAccessRequestView is one pending request as the share dialog shows
// it. Source is nil when the request carries none or the caller cannot read
// the task/meeting it names.
type DocumentAccessRequestView struct {
	ID             string
	RequesterID    string
	RequesterName  string
	RequestedLevel string
	Message        string
	Source         *DocumentAccessRequestSource
	CreatedAt      time.Time
	ExpiresAt      time.Time
}

// DocumentAccessRequestDecision is the answer of approve and decline: the
// request, its new status, and the share an approve created (empty when the
// requester already held the granted level, so nothing was granted).
type DocumentAccessRequestDecision struct {
	ID      string
	Status  string
	ShareID string
}

// errAccessRequestClosed is §3.2: the request is no longer pending - another
// manager answered it first, or it expired unanswered - or the document is in
// the trash. The client reloads the list; the answer says nothing else.
func errAccessRequestClosed() error {
	return coded(http.StatusConflict, "access_request_closed", "yêu cầu này đã được xử lý hoặc đã hết hạn")
}

// ListDocumentAccessRequests is the manager's list: the pending, unexpired
// requests of one document, newest first. A reader who cannot administer the
// document gets an empty list rather than a refusal (the gate already decided
// they may look at the document), and an archived document has none.
func (s *DocumentService) ListDocumentAccessRequests(ctx context.Context, actor Actor, documentID string) ([]DocumentAccessRequestView, error) {
	doc, access, err := s.authorizeDocumentViewOrAdminister(ctx, actor, documentID)
	if err != nil {
		return nil, err
	}
	if !access.canAdminister() || doc.ArchivedAt.Valid {
		return []DocumentAccessRequestView{}, nil
	}
	rows, err := s.q.ListPendingDocumentAccessRequests(ctx, db.ListPendingDocumentAccessRequestsParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID, Now: ts(s.now()),
	})
	if err != nil {
		return nil, err
	}
	out := make([]DocumentAccessRequestView, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	names, err := s.accessRequestRequesterNames(ctx, rows)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		v := DocumentAccessRequestView{
			ID: r.ID, RequesterID: r.CreatedBy, RequesterName: names[r.CreatedBy],
			RequestedLevel: r.RequestedLevel, Message: r.Message,
			CreatedAt: r.CreatedAt.Time, ExpiresAt: r.ExpiresAt.Time,
		}
		if v.Source, err = s.accessRequestSourceView(ctx, actor, r); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// accessRequestRequesterNames reads the display names of the requesters in one
// query: the list shows who asked, and a row per request would be a query per
// row.
func (s *DocumentService) accessRequestRequesterNames(ctx context.Context, rows []db.DocumentAccessRequest) (map[string]string, error) {
	ids := make([]string, 0, len(rows))
	seen := make(map[string]bool, len(rows))
	for _, r := range rows {
		if !seen[r.CreatedBy] {
			seen[r.CreatedBy] = true
			ids = append(ids, r.CreatedBy)
		}
	}
	users, err := s.q.GetUsersByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	names := make(map[string]string, len(users))
	for _, u := range users {
		names[u.ID] = u.DisplayName
	}
	return names, nil
}

// accessRequestSourceView is the source of one request as the CALLER may see
// it (§4.3): the ids and the title when the caller reads that task or meeting
// through its own domain gate, and nil otherwise. A manager who cannot read the
// source sees no "from" line at all rather than a link to a row they may not
// open; an unwired port is the same nil (fail closed).
func (s *DocumentService) accessRequestSourceView(ctx context.Context, actor Actor, r db.DocumentAccessRequest) (*DocumentAccessRequestSource, error) {
	if !r.SourceKind.Valid || !r.SourceID.Valid {
		return nil, nil
	}
	src := &DocumentAccessRequestSource{Kind: r.SourceKind.String, ID: r.SourceID.String}
	switch r.SourceKind.String {
	case AccessRequestSourceKindTask:
		if s.accessRequestTasks == nil {
			return nil, nil
		}
		task, err := s.accessRequestTasks.Get(ctx, actor.ID, r.SourceID.String)
		if err != nil {
			if isGateRefusal(err) {
				return nil, nil
			}
			return nil, err
		}
		src.Title = task.Title
	case AccessRequestSourceKindMeeting:
		if s.accessRequestMeetings == nil {
			return nil, nil
		}
		meeting, err := s.accessRequestMeetings.Get(ctx, actor.ID, r.SourceID.String)
		if err != nil {
			if isGateRefusal(err) {
				return nil, nil
			}
			return nil, err
		}
		src.Title = meeting.Title
	default:
		return nil, nil
	}
	return src, nil
}

// CountPendingDocumentAccessRequests is the count the share dialog shows beside
// the requests section: the same rows ListDocumentAccessRequests answers, so it
// is 0 for a caller who cannot administer the document and for an archived
// document. It takes the document and access the caller's own gate already
// read, so the shares route pays for no second gate.
func (s *DocumentService) CountPendingDocumentAccessRequests(ctx context.Context, actor Actor, doc db.Document, access DocumentAccess) (int, error) {
	if !access.canAdminister() || doc.ArchivedAt.Valid {
		return 0, nil
	}
	n, err := s.q.CountPendingDocumentAccessRequests(ctx, db.CountPendingDocumentAccessRequestsParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID, Now: ts(s.now()),
	})
	if err != nil {
		return 0, err
	}
	return int(n), nil
}

// ApproveDocumentAccessRequest grants the requester the chosen level on the
// document and closes the request (§3.1). An empty level grants what was asked
// for; a level below or above it is accepted, up to edit - manage goes through
// the share dialog. When the requester already holds at least the granted level
// the request is approved with no new share, which is the "only raise" rule.
//
// The whole decision is one transaction: the document row is locked (the
// caller's administer gate), the request row is locked (FOR UPDATE), it must
// still be pending and unexpired, and the share is written by
// shareDocumentInTx on the same connection. A requester who is no longer an
// active member of the organization is the one case that must NOT roll back:
// the request is marked cancelled and committed, and the answer is the 422 the
// share path would have given (§3.1).
func (s *DocumentService) ApproveDocumentAccessRequest(ctx context.Context, actor Actor, documentID, requestID, level string) (DocumentAccessRequestDecision, error) {
	return s.decideDocumentAccessRequest(ctx, actor, documentID, requestID, level, true)
}

// DeclineDocumentAccessRequest closes a request without granting anything. The
// decliner's note is never sent to the requester, so there is no message
// argument at all (§3.1 "Từ chối").
func (s *DocumentService) DeclineDocumentAccessRequest(ctx context.Context, actor Actor, documentID, requestID string) (DocumentAccessRequestDecision, error) {
	return s.decideDocumentAccessRequest(ctx, actor, documentID, requestID, "", false)
}

// decideDocumentAccessRequest is the shared body of approve and decline. The
// two differ only in what happens after the request is locked: approve resolves
// a granted level, applies the only-raise rule and writes the share; decline
// records the refusal.
func (s *DocumentService) decideDocumentAccessRequest(ctx context.Context, actor Actor, documentID, requestID, level string, approve bool) (DocumentAccessRequestDecision, error) {
	var out DocumentAccessRequestDecision
	// The granted level is resolved before the transaction: a bad value is a
	// 400 whatever the document is, and the answer depends on the body alone.
	granted := DocumentLevelNone
	if approve {
		var err error
		if granted, err = validateGrantedLevel(level); err != nil {
			return DocumentAccessRequestDecision{}, err
		}
	}
	// cancelledCommitted carries the one answer that must survive a rollback:
	// the requester is gone, the request is cancelled, and the caller still
	// gets the 422. Returning it from inside fn would roll the cancel back.
	var cancelledCommitted error
	err := s.withDocumentAdministerMutation(ctx, actor, documentID, shelveWriteRefused, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if doc.ArchivedAt.Valid {
			// §3.2 "Archive": the requests of a trashed document are closed,
			// not answered. The row is recorded cancelled and the transaction
			// COMMITS it before the 409 goes out, so a later approval cannot
			// resurrect it - which is why the refusal is raised after fn
			// returns rather than inside it.
			if err := s.closeRequestCancelled(ctx, q, doc, requestID, actor); err != nil {
				return err
			}
			cancelledCommitted = errAccessRequestClosed()
			return nil
		}
		req, err := q.GetDocumentAccessRequestForUpdate(ctx, db.GetDocumentAccessRequestForUpdateParams{
			OrganizationID: doc.OrganizationID, DocumentID: doc.ID, ID: requestID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// A request of another document, or one that does not exist: the
			// same not found, so the id is never an oracle.
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		now := s.now()
		if req.Status != AccessRequestStatusPending || !req.ExpiresAt.Valid || !now.Before(req.ExpiresAt.Time) {
			return errAccessRequestClosed()
		}
		if !approve {
			return s.recordDeclinedRequest(ctx, q, doc, req, actor, now, &out)
		}
		// DOC-05: an AdminScope caller below manage may grant to others but not
		// reach themselves; the request they raised is no exception, and the
		// audited break-glass path is the one that gives them read access.
		if err := s.refuseAdminSelfShare(ctx, q, doc, access, actor, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: req.CreatedBy,
		}); err != nil {
			return err
		}
		if granted == DocumentLevelNone {
			granted = DocumentLevel(req.RequestedLevel)
		}
		// The only-raise rule: a requester who already holds at least the
		// granted level has nothing to gain, so the request is approved with no
		// new share (§3.1).
		shareID := ""
		raise, err := s.grantRaisesLevel(ctx, q, doc, req.CreatedBy, granted)
		if err != nil {
			return err
		}
		if raise {
			sh, err := s.shareDocumentInTx(ctx, q, actor, doc, access, DocumentShareInput{
				PrincipalType: DocumentPrincipalUser, PrincipalID: req.CreatedBy, Level: granted,
			})
			if err != nil {
				if codedIs(err, "principal_not_in_organization") {
					// The requester left or was deactivated since asking. The
					// request is cancelled and COMMITTED, then the 422 is
					// answered: returning the error here would roll the cancel
					// back and leave a pending request nobody can ever grant.
					if err := s.cancelRequestRow(ctx, q, req, actor, now); err != nil {
						return err
					}
					cancelledCommitted = errPrincipalNotInOrganization()
					return nil
				}
				return err
			}
			shareID = sh.ID
		}
		return s.recordApprovedRequest(ctx, q, doc, req, actor, now, granted, shareID, &out)
	})
	if err != nil {
		return DocumentAccessRequestDecision{}, err
	}
	if cancelledCommitted != nil {
		return DocumentAccessRequestDecision{}, cancelledCommitted
	}
	return out, nil
}

// validateGrantedLevel resolves the level an approval grants: empty means "what
// was asked for", and view/comment/edit are the levels a manager may pick.
// manage is refused - a request never grants management; that goes through the
// share dialog (§3.1).
func validateGrantedLevel(level string) (DocumentLevel, error) {
	switch level {
	case "":
		return DocumentLevelNone, nil
	case string(DocumentLevelView), string(DocumentLevelComment), string(DocumentLevelEdit):
		return DocumentLevel(level), nil
	default:
		return DocumentLevelNone, Invalid("level phải là view, comment hoặc edit")
	}
}

// grantRaisesLevel answers whether granting `level` to userID would raise their
// effective level on the document. The decision is the share path's own
// (notifyOnUserShare): a person who is already at or above the level gains
// nothing, so no share is written and the request is simply approved. A user
// the tenant gate refuses is not "already at the level" - the share path will
// refuse the grant itself, and approve turns that into a cancelled request.
func (s *DocumentService) grantRaisesLevel(ctx context.Context, q *db.Queries, doc db.Document, userID string, level DocumentLevel) (bool, error) {
	acc, err := s.effectiveLevel(ctx, q, Human(userID), doc)
	if err != nil {
		if isGateRefusal(err) {
			return true, nil
		}
		return false, err
	}
	return level.rank() > acc.Level.rank(), nil
}

// recordApprovedRequest writes the approved decision and its audit + outbox
// rows in the caller's transaction. granted_level and share_id are recorded
// even when no share was written (share_id NULL), so the history says what was
// decided, not only what changed.
func (s *DocumentService) recordApprovedRequest(ctx context.Context, q *db.Queries, doc db.Document, req db.DocumentAccessRequest, actor Actor, now time.Time, granted DocumentLevel, shareID string, out *DocumentAccessRequestDecision) error {
	updated, err := q.DecideDocumentAccessRequest(ctx, db.DecideDocumentAccessRequestParams{
		Status: AccessRequestStatusApproved, GrantedLevel: nullText(string(granted)), ShareID: nullText(shareID),
		DecidedBy: nullText(actor.ID), DecidedByKind: nullText(string(actor.Kind)),
		DecidedAt: ts(now), UpdatedAt: ts(now),
		ID: req.ID, OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Another manager committed first; the FOR UPDATE read above makes this
		// unreachable in practice, and the answer is the same if it is not.
		return errAccessRequestClosed()
	}
	if err != nil {
		return err
	}
	metadata := map[string]any{
		"request_id":    updated.ID,
		"granted_level": string(granted),
	}
	if shareID != "" {
		metadata["share_id"] = shareID
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
		Action: audit.ActionDocumentAccessRequestApproved, ResourceType: "document", ResourceID: doc.ID,
		Changes:  audit.Diff(map[string]any{"status": req.Status}, map[string]any{"status": updated.Status}),
		Metadata: metadata,
	}, audit.Event{Topic: topicDocumentAccessRequestDecided, Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": doc.WorkspaceID, "request_id": updated.ID, "user_id": req.CreatedBy,
	}}); err != nil {
		return err
	}
	*out = DocumentAccessRequestDecision{ID: updated.ID, Status: updated.Status, ShareID: shareID}
	return nil
}

// recordDeclinedRequest closes a request as declined with its audit and outbox
// rows. The decliner's note is never stored or sent.
func (s *DocumentService) recordDeclinedRequest(ctx context.Context, q *db.Queries, doc db.Document, req db.DocumentAccessRequest, actor Actor, now time.Time, out *DocumentAccessRequestDecision) error {
	updated, err := q.DecideDocumentAccessRequest(ctx, db.DecideDocumentAccessRequestParams{
		Status:    AccessRequestStatusDeclined,
		DecidedBy: nullText(actor.ID), DecidedByKind: nullText(string(actor.Kind)),
		DecidedAt: ts(now), UpdatedAt: ts(now),
		ID: req.ID, OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return errAccessRequestClosed()
	}
	if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
		Action: audit.ActionDocumentAccessRequestDeclined, ResourceType: "document", ResourceID: doc.ID,
		Changes:  audit.Diff(map[string]any{"status": req.Status}, map[string]any{"status": updated.Status}),
		Metadata: map[string]any{"request_id": updated.ID},
	}, audit.Event{Topic: topicDocumentAccessRequestDecided, Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": doc.WorkspaceID, "request_id": updated.ID, "user_id": req.CreatedBy,
	}}); err != nil {
		return err
	}
	*out = DocumentAccessRequestDecision{ID: updated.ID, Status: updated.Status}
	return nil
}

// closeRequestCancelled is the archived-document answer (§3.2 "Archive"): the
// pending request is recorded cancelled. It returns nil on success - even when
// the request was no longer pending, because then there is nothing to write and
// the 409 is the same answer - so the gate's transaction COMMITS the cancel
// before the caller raises the refusal. Returning the 409 from here would roll
// the write back and leave a pending request that can never be answered.
func (s *DocumentService) closeRequestCancelled(ctx context.Context, q *db.Queries, doc db.Document, requestID string, actor Actor) error {
	req, err := q.GetDocumentAccessRequestForUpdate(ctx, db.GetDocumentAccessRequestForUpdateParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID, ID: requestID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// A request of another document, or one that does not exist: the same
		// not found the live path gives, and nothing was written.
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if req.Status != AccessRequestStatusPending {
		return nil
	}
	return s.cancelRequestRow(ctx, q, req, actor, s.now())
}

// cancelRequestRow closes a pending request as cancelled. It writes no event:
// the requester learns nothing from a cancelled request, and a manager's list
// refreshes when the next one lands.
func (s *DocumentService) cancelRequestRow(ctx context.Context, q *db.Queries, req db.DocumentAccessRequest, actor Actor, now time.Time) error {
	_, err := q.DecideDocumentAccessRequest(ctx, db.DecideDocumentAccessRequestParams{
		Status:    AccessRequestStatusCancelled,
		DecidedBy: nullText(actor.ID), DecidedByKind: nullText(string(actor.Kind)),
		DecidedAt: ts(now), UpdatedAt: ts(now),
		ID: req.ID, OrganizationID: req.OrganizationID, DocumentID: req.DocumentID,
	})
	return err
}

// FilterDocumentAdministrators keeps the people who may administer the document
// right now, the same computation the administrative gate makes (§3.1, R1-6).
// The notification rules call it at delivery time, so a manager whose access
// was revoked since the event hears nothing - and an AdminScope caller stays
// in, because they are exactly who the fallback recipient list names.
func (s *DocumentService) FilterDocumentAdministrators(ctx context.Context, documentID string, userIDs []string) ([]string, error) {
	out := make([]string, 0, len(userIDs))
	if documentID == "" {
		return out, nil
	}
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	for _, id := range userIDs {
		if id == "" {
			continue
		}
		access, err := s.effectiveLevel(ctx, s.q, Human(id), doc)
		if err != nil {
			if isGateRefusal(err) {
				continue
			}
			return nil, err
		}
		if access.canAdminister() {
			out = append(out, id)
		}
	}
	return out, nil
}
