package service

import (
	"context"
	"errors"
	"time"

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

// ListDocumentAccessRequests is the manager's list: the pending, unexpired
// requests of one document, newest first. A reader who cannot administer the
// document gets an empty list rather than a refusal (the gate already decided
// they may look at the document), and an archived document has none.
func (s *DocumentService) ListDocumentAccessRequests(ctx context.Context, actor Actor, documentID string) ([]DocumentAccessRequestView, error) {
	return nil, errors.New("not implemented")
}

// CountPendingDocumentAccessRequests is the count the share dialog shows beside
// the requests section: the same rows ListDocumentAccessRequests answers, so it
// is 0 for a caller who cannot administer the document and for an archived
// document.
func (s *DocumentService) CountPendingDocumentAccessRequests(ctx context.Context, actor Actor, doc db.Document, access DocumentAccess) (int, error) {
	return 0, errors.New("not implemented")
}

// ApproveDocumentAccessRequest grants the requester the chosen level on the
// document and closes the request. An empty level grants what was asked for; a
// level below or above it is accepted, up to edit (manage goes through the
// share dialog). When the requester already holds at least the granted level
// the request is approved with no new share.
func (s *DocumentService) ApproveDocumentAccessRequest(ctx context.Context, actor Actor, documentID, requestID, level string) (DocumentAccessRequestDecision, error) {
	return DocumentAccessRequestDecision{}, errors.New("not implemented")
}

// DeclineDocumentAccessRequest closes a request without granting anything. The
// decliner's note is never sent to the requester, so there is no message
// argument at all.
func (s *DocumentService) DeclineDocumentAccessRequest(ctx context.Context, actor Actor, documentID, requestID string) (DocumentAccessRequestDecision, error) {
	return DocumentAccessRequestDecision{}, errors.New("not implemented")
}

// FilterDocumentAdministrators keeps the people who may administer the document
// right now, the same computation the administrative gate makes. The
// notification rules call it at delivery time, so a manager whose access was
// revoked since the event hears nothing.
func (s *DocumentService) FilterDocumentAdministrators(ctx context.Context, documentID string, userIDs []string) ([]string, error) {
	return nil, errors.New("not implemented")
}
