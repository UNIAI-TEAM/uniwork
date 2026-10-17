package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DocumentEditRequestView is DocumentEditRequestSDO: the row, the status as
// read now (a pending row past its expiry reads expired) and the
// requester's name.
type DocumentEditRequestView struct {
	Request       db.DocumentEditRequest
	Status        string
	RequesterName string
	// Created tells R8 201 (a new row) from 200 (the caller's open request).
	Created bool
}

// AnswerDocumentEditRequestInput is R9.
type AnswerDocumentEditRequestInput struct {
	Decision string // "accept" | "decline"
	LockID   string
}

func (s *DocumentService) editRequestView(ctx context.Context, q *db.Queries, r db.DocumentEditRequest, now time.Time) (DocumentEditRequestView, error) {
	status := r.Status
	if status == DocumentEditRequestPending && !r.ExpiresAt.Time.After(now) {
		status = DocumentEditRequestExpired
	}
	name, err := userDisplayName(ctx, q, r.RequesterID)
	if err != nil {
		return DocumentEditRequestView{}, err
	}
	return DocumentEditRequestView{Request: r, Status: status, RequesterName: name}, nil
}

func editRequestEvent(topic string, doc db.Document, requestID, userID string) audit.Event {
	return audit.Event{Topic: topic, Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": doc.WorkspaceID, "request_id": requestID, "user_id": userID,
	}}
}

// CreateDocumentEditRequest is R8 (D3): a member at edit asks the holder for
// the lock. One pending request per requester per document: an open one is
// returned as is (200); the caller's own stale pending row is closed first
// (BE-5). The DB cap DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR holds without Redis
// (the handler's 20/min limiter fails open).
func (s *DocumentService) CreateDocumentEditRequest(ctx context.Context, actor Actor, documentID string) (DocumentEditRequestView, error) {
	if err := requireHumanEditLockActor(actor); err != nil {
		return DocumentEditRequestView{}, err
	}
	cfg := s.EditLockConfig()
	var out DocumentEditRequestView
	limited := false
	err := s.editLockMutation(ctx, actor, documentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, _ DocumentAccess, now time.Time, ops *editLockOps) error {
		if doc.ArchivedAt.Valid {
			return documentArchived()
		}
		live, err := s.lockLiveForUpdate(ctx, q, doc, now, ops)
		if err != nil {
			return err
		}
		if live == nil {
			return errEditLockFree()
		}
		if live.UserID == actor.ID {
			return errEditRequestToSelf()
		}
		if _, err := q.ExpireDocumentEditRequestsOfRequester(ctx, db.ExpireDocumentEditRequestsOfRequesterParams{
			OrganizationID: doc.OrganizationID, DocumentID: doc.ID, RequesterID: actor.ID, Now: ts(now),
		}); err != nil {
			return err
		}
		open, err := q.GetPendingDocumentEditRequestOfRequester(ctx, db.GetPendingDocumentEditRequestOfRequesterParams{
			OrganizationID: doc.OrganizationID, DocumentID: doc.ID, RequesterID: actor.ID,
		})
		if err == nil {
			out, err = s.editRequestView(ctx, q, open, now)
			return err
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		since := now.Add(-time.Hour)
		recent, err := q.CountRecentDocumentEditRequests(ctx, db.CountRecentDocumentEditRequestsParams{
			Since: ts(since), OrganizationID: doc.OrganizationID, RequesterID: actor.ID, DocumentID: doc.ID,
		})
		if err != nil {
			return err
		}
		if recent.N >= int64(cfg.RequestMaxPerHour) {
			limited = true
			return errEditRequestRateLimited(recent.Oldest.Time.Add(time.Hour).Sub(now))
		}
		row, err := q.InsertDocumentEditRequest(ctx, db.InsertDocumentEditRequestParams{
			ID: util.NewID(), OrganizationID: doc.OrganizationID, DocumentID: doc.ID, LockID: live.ID,
			RequesterID: actor.ID, HolderID: live.UserID, CreatedAt: ts(now), ExpiresAt: ts(now.Add(cfg.RequestTTL)),
		})
		if err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
			Action: audit.ActionDocumentEditRequestCreated, ResourceType: "document", ResourceID: doc.ID,
			Metadata: map[string]any{"request_id": row.ID, "lock_id": live.ID},
		}, editRequestEvent(topicDocumentEditRequested, doc, row.ID, live.UserID)); err != nil {
			return err
		}
		ops.request("create")
		if out, err = s.editRequestView(ctx, q, row, now); err != nil {
			return err
		}
		out.Created = true
		return nil
	})
	if limited {
		s.editLockMetrics().IncDocumentEditRequest("rate_limited")
	}
	return out, err
}

// AnswerDocumentEditRequest is R9: the holder accepts or declines. Check
// order (contract §3): not found (not this document's, or not the caller's
// to answer) -> edit_lock_changed (the lock_id the holder answers for is not
// the request's) -> edit_request_closed -> edit_request_expired ->
// edit_lock_lost (the caller no longer holds that tenure). Accept ends the
// tenure handed_over and reserves a new one for the requester, who claims it
// with R2.
func (s *DocumentService) AnswerDocumentEditRequest(ctx context.Context, actor Actor, documentID, requestID string, in AnswerDocumentEditRequestInput) (DocumentEditRequestView, error) {
	if err := requireHumanEditLockActor(actor); err != nil {
		return DocumentEditRequestView{}, err
	}
	if in.Decision != "accept" && in.Decision != "decline" {
		return DocumentEditRequestView{}, Invalid("decision phải là accept hoặc decline")
	}
	cfg := s.EditLockConfig()
	var out DocumentEditRequestView
	err := s.editLockMutation(ctx, actor, documentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, _ DocumentAccess, now time.Time, ops *editLockOps) error {
		req, err := q.GetDocumentEditRequest(ctx, db.GetDocumentEditRequestParams{
			ID: requestID, OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
		})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && req.HolderID != actor.ID) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if in.LockID != req.LockID {
			return errEditLockChanged()
		}
		if req.Status != DocumentEditRequestPending {
			return errEditRequestClosed()
		}
		if !req.ExpiresAt.Time.After(now) {
			return errEditRequestExpired()
		}
		live, err := s.lockLiveForUpdate(ctx, q, doc, now, ops)
		if err != nil {
			return err
		}
		if live == nil || live.ID != req.LockID || live.UserID != actor.ID {
			held, err := q.GetDocumentEditLock(ctx, db.GetDocumentEditLockParams{
				ID: req.LockID, OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
			})
			if err != nil {
				return err
			}
			return s.lostAnswer(ctx, q, held)
		}
		status := DocumentEditRequestDeclined
		if in.Decision == "accept" {
			status = DocumentEditRequestAccepted
		}
		// The request closes before the tenure ends: ending it supersedes the
		// tenure's still-pending requests, this one included otherwise.
		closed, err := q.CloseDocumentEditRequest(ctx, db.CloseDocumentEditRequestParams{
			Status: status, AnsweredAt: ts(now), ID: req.ID, OrganizationID: req.OrganizationID,
		})
		if err != nil {
			return err
		}
		meta := map[string]any{"request_id": req.ID, "decision": in.Decision}
		events := []audit.Event{editRequestEvent(topicDocumentEditRequestAnswered, doc, req.ID, req.RequesterID)}
		if in.Decision == "accept" {
			if _, err := endTenureRow(ctx, q, *live, DocumentEditEndHandedOver, actor, now); err != nil {
				return err
			}
			reserved, err := q.InsertDocumentEditLock(ctx, db.InsertDocumentEditLockParams{
				ID: util.NewID(), OrganizationID: doc.OrganizationID, DocumentID: doc.ID, UserID: req.RequesterID,
				BaseRevision: doc.Revision, AcquiredAt: ts(now), ExpiresAt: ts(now.Add(cfg.TTL)),
				GrantedVia: documentEditGrantHandover, PreviousLockID: pgtype.Text{String: live.ID, Valid: true},
			})
			if err != nil {
				return err
			}
			meta["lock_id"] = reserved.ID
			events = append(events, lockChangedEvent(doc))
			ops.lock("handover")
			ops.request("accept")
		} else {
			ops.request("decline")
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
			Action: audit.ActionDocumentEditRequestAnswered, ResourceType: "document", ResourceID: doc.ID,
			Metadata: meta,
		}, events...); err != nil {
			return err
		}
		out, err = s.editRequestView(ctx, q, closed, now)
		return err
	})
	return out, err
}

// CancelDocumentEditRequest is R10: the requester withdraws. Idempotent: a
// request already answered, superseded or expired answers 204 and writes
// nothing; one that is not this document's or not the caller's is not found.
func (s *DocumentService) CancelDocumentEditRequest(ctx context.Context, actor Actor, documentID, requestID string) error {
	return s.editLockMutation(ctx, actor, documentID, DocumentLevelView, func(q *db.Queries, doc db.Document, _ DocumentAccess, now time.Time, ops *editLockOps) error {
		req, err := q.GetDocumentEditRequest(ctx, db.GetDocumentEditRequestParams{
			ID: requestID, OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
		})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (actor.Kind != audit.KindHuman || req.RequesterID != actor.ID)) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if req.Status != DocumentEditRequestPending || !req.ExpiresAt.Time.After(now) {
			return nil
		}
		if _, err := q.CloseDocumentEditRequest(ctx, db.CloseDocumentEditRequestParams{
			Status: DocumentEditRequestCancelled, ID: req.ID, OrganizationID: req.OrganizationID,
		}); err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
			Action: audit.ActionDocumentEditRequestCanceled, ResourceType: "document", ResourceID: doc.ID,
			Metadata: map[string]any{"request_id": req.ID},
		}); err != nil {
			return err
		}
		ops.request("cancel")
		return nil
	})
}
