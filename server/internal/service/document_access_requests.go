package service

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document access requests (DOC-07, UNI-1631). A person who follows a link to
// a document they cannot read asks its managers for access; nothing is granted
// by following the link, only a manager's approval creates a share (w2).
//
// The create path is deliberately uniform. Every answer that says nothing about
// the document - an id that does not exist, another organization's document, a
// requester who is not an active member of the document's organization, a Work
// Product document, an archived document, a requester who already reads it -
// costs the same one lookup by id and comes back as the same
// DocumentAccessRequestResult{Status: sent}, with no row, no audit and no
// event. Only two answers are specific, and both concern the requester's own
// requests on that document: 409 access_request_pending (a live pending one)
// and 429 access_request_cooldown (a decline less than an hour ago). Neither
// reveals whether the document exists, because neither is reachable without
// having stored a request there first.
//
// The topic is document.access_requested (ScopeWorkspace, ids only).
// document.access_request_decided is w2's emitter.

// Stored request statuses (§3.2). "expired" is not one: a pending row past its
// expires_at reads as expired and stays 'pending' in the column until a write
// touches it, so a re-send refreshes that row in place (the upsert's DO UPDATE
// branch).
const (
	AccessRequestStatusPending   = "pending"
	AccessRequestStatusApproved  = "approved"
	AccessRequestStatusDeclined  = "declined"
	AccessRequestStatusCancelled = "cancelled"
)

// AccessRequestSent is the 202 body's status: the request was accepted for a
// manager to answer. It is a response status, never a stored one.
const AccessRequestSent = "sent"

// Source kinds a request may name (§3.1). The pair is kept only when the
// requester can read that task or meeting in the document's own organization;
// otherwise it is dropped silently, never refused - a source that cannot be
// read must not turn a uniform 202 into a probe.
const (
	AccessRequestSourceKindTask    = "task"
	AccessRequestSourceKindMeeting = "meeting"
)

// Timing and size of a request (§3.1, Q4). The pending lifetime is read from
// expires_at, so no worker is needed to expire one.
const (
	accessRequestPendingTTL = 30 * 24 * time.Hour
	accessRequestCooldown   = time.Hour
	accessRequestMessageMax = 500
)

const topicDocumentAccessRequested = "document.access_requested"

// DocumentAccessRequestInput is the create request's body after the handler has
// decoded it (SDI CreateDocumentAccessRequestSDI). Level is empty for the
// default (view).
type DocumentAccessRequestInput struct {
	RequestedLevel string
	Message        string
	SourceKind     string
	SourceID       string
}

// DocumentAccessRequestResult is the answer of the uniform path: the same
// value for every create that stored nothing and every create that stored a
// request. The handler writes it as the 202 body.
type DocumentAccessRequestResult struct {
	Status string
}

// errAccessRequestPending is Q4: the requester already has a live pending
// request on this document. Nothing changes - not the level, not the message,
// not the audit - so the client moves the locked card to "already requested"
// instead of showing a failure.
func errAccessRequestPending() error {
	return coded(http.StatusConflict, "access_request_pending",
		"bạn đã có một yêu cầu truy cập đang chờ xử lý trên tài liệu này")
}

// errAccessRequestCooldown is Q4: the requester's last request on this document
// was declined less than an hour ago. retry_after_seconds is the remaining
// seconds rounded up, never zero, so a client can count down without arithmetic
// of its own; w3's handler copies it into the Retry-After header.
func errAccessRequestCooldown(remaining time.Duration) error {
	seconds := int(math.Ceil(remaining.Seconds()))
	if seconds < 1 {
		seconds = 1
	}
	return CodedError{
		Code: "access_request_cooldown", Status: http.StatusTooManyRequests,
		Msg:    "yêu cầu trước của bạn đã bị từ chối; hãy thử lại sau",
		Fields: map[string]any{"retry_after_seconds": seconds},
	}
}

// DocumentAccessRequestTaskReader reads one task for the requester through the
// task domain's own gate (TaskService.Get). The port is one method wide on
// purpose: a document access request must not reach into the task service, and
// the two services must not import each other.
type DocumentAccessRequestTaskReader interface {
	Get(ctx context.Context, userID, taskID string) (db.Task, error)
}

// DocumentAccessRequestMeetingReader is DocumentAccessRequestTaskReader for a
// meeting source (MeetingService.Get).
type DocumentAccessRequestMeetingReader interface {
	Get(ctx context.Context, userID, meetingID string) (db.Meeting, error)
}

// SetAccessRequestSources wires the two domains a request may name as its
// source. Passing nil drops that source kind silently, which is also the
// default: an unwired seam keeps no source rather than trusting one.
func (s *DocumentService) SetAccessRequestSources(tasks DocumentAccessRequestTaskReader, meetings DocumentAccessRequestMeetingReader) {
	s.accessRequestTasks = tasks
	s.accessRequestMeetings = meetings
}

// resolveAccessRequestSource answers the source pair to store for one create:
// the ids when the requester reads that task or meeting and it belongs to the
// document's organization, otherwise empty values. Every refusal - a gate, a
// missing row, another organization - is the same "drop it", so the answer
// never distinguishes why, and an unwired port drops too.
func (s *DocumentService) resolveAccessRequestSource(ctx context.Context, actor Actor, doc db.Document, kind, id string) (pgtype.Text, pgtype.Text) {
	var orgID string
	switch kind {
	case AccessRequestSourceKindTask:
		if s.accessRequestTasks == nil {
			return pgtype.Text{}, pgtype.Text{}
		}
		task, err := s.accessRequestTasks.Get(ctx, actor.ID, id)
		if err != nil {
			return pgtype.Text{}, pgtype.Text{}
		}
		orgID = task.OrganizationID
	case AccessRequestSourceKindMeeting:
		if s.accessRequestMeetings == nil {
			return pgtype.Text{}, pgtype.Text{}
		}
		meeting, err := s.accessRequestMeetings.Get(ctx, actor.ID, id)
		if err != nil {
			return pgtype.Text{}, pgtype.Text{}
		}
		orgID = meeting.OrganizationID
	default:
		return pgtype.Text{}, pgtype.Text{}
	}
	if orgID != doc.OrganizationID {
		return pgtype.Text{}, pgtype.Text{}
	}
	return pgtype.Text{String: kind, Valid: true}, pgtype.Text{String: id, Valid: true}
}

// accessRequestInput is the create body after validation: the level to store,
// the trimmed message, and the source pair the caller asked for (already
// checked for shape; whether it survives is decided per document).
type accessRequestInput struct {
	level      DocumentLevel
	message    string
	sourceKind string
	sourceID   string
}

// validateAccessRequestInput is the body-only half of the create: a bad level,
// an over-long message or a half-formed source is a 400 whatever the document
// is, because the answer depends on the body alone and so leaks nothing about
// the document (§4.3).
func validateAccessRequestInput(in DocumentAccessRequestInput) (accessRequestInput, error) {
	out := accessRequestInput{message: strings.TrimSpace(in.Message)}
	switch in.RequestedLevel {
	case "":
		out.level = DocumentLevelView
	case string(DocumentLevelView), string(DocumentLevelComment), string(DocumentLevelEdit):
		out.level = DocumentLevel(in.RequestedLevel)
	default:
		return accessRequestInput{}, Invalid("requested_level phải là view, comment hoặc edit")
	}
	if len([]rune(out.message)) > accessRequestMessageMax {
		return accessRequestInput{}, Invalid("lời nhắn tối đa 500 ký tự")
	}
	switch {
	case in.SourceKind == "" && in.SourceID == "":
	case in.SourceKind == "" || in.SourceID == "":
		return accessRequestInput{}, Invalid("source_kind và source_id phải đi cùng nhau")
	case in.SourceKind != AccessRequestSourceKindTask && in.SourceKind != AccessRequestSourceKindMeeting:
		return accessRequestInput{}, Invalid("source_kind phải là task hoặc meeting")
	default:
		if _, err := ulid.Parse(in.SourceID); err != nil {
			return accessRequestInput{}, Invalid("source_id không phải ULID")
		}
		out.sourceKind, out.sourceID = in.SourceKind, in.SourceID
	}
	return out, nil
}

// CreateDocumentAccessRequest is DOC-07's create (§3.1, §5). It never grants
// anything: a stored request is a row a manager answers later.
//
// Order: the actor must be a signed-in person (an agent is not a share
// principal and gets 403); the body is validated; the document is read by id
// and every answer that would say something about it collapses into the
// uniform result; then, in one transaction, the cooldown read, the upsert and -
// only when a row came back - the audit and outbox rows.
func (s *DocumentService) CreateDocumentAccessRequest(ctx context.Context, actor Actor, documentID string, in DocumentAccessRequestInput) (DocumentAccessRequestResult, error) {
	sent := DocumentAccessRequestResult{Status: AccessRequestSent}
	if !validActor(actor) || documentID == "" {
		return DocumentAccessRequestResult{}, ErrNotFound
	}
	if actor.Kind != audit.KindHuman {
		// An agent is never a share principal (§3.1); w3 maps this to
		// 403 forbidden.
		return DocumentAccessRequestResult{}, ErrForbidden
	}
	body, err := validateAccessRequestInput(in)
	if err != nil {
		return DocumentAccessRequestResult{}, err
	}
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sent, nil
	}
	if err != nil {
		return DocumentAccessRequestResult{}, err
	}
	// The organization gate first: a requester who is not an active member of
	// the document's organization is indistinguishable from one asking about a
	// document that does not exist.
	if _, err := s.orgs.RequireMemberQ(ctx, s.q, doc.OrganizationID, actor.ID); err != nil {
		if isGateRefusal(err) {
			return sent, nil
		}
		return DocumentAccessRequestResult{}, err
	}
	if doc.OwnerKind.Valid {
		// §13.4: an owned document's access comes from the owning work
		// product's resolver; a share - and so a request that could lead to
		// one - is the product's decision, not this document's.
		return sent, nil
	}
	if doc.ArchivedAt.Valid {
		return sent, nil
	}
	access, err := s.effectiveLevel(ctx, s.q, actor, doc)
	if err != nil {
		if isGateRefusal(err) {
			return sent, nil
		}
		return DocumentAccessRequestResult{}, err
	}
	if access.Level.AtLeast(body.level) {
		// Already reads at least what they are asking for: nothing to store.
		// AdminScope alone is not a read level, so an admin who cannot read
		// the content still gets a request stored.
		return sent, nil
	}
	sourceKind, sourceID := s.resolveAccessRequestSource(ctx, actor, doc, body.sourceKind, body.sourceID)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DocumentAccessRequestResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	// (1) Take the document row lock decisions and purge take, then re-read
	// eligibility inside the transaction so an archive, ownership change, purge
	// or concurrent grant that committed after the preflight still returns the
	// uniform 202 and stores nothing (BE-SD7-1, BE-SD7-5).
	doc, err = q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sent, nil
	}
	if err != nil {
		return DocumentAccessRequestResult{}, err
	}
	if doc.OwnerKind.Valid || doc.ArchivedAt.Valid {
		return sent, nil
	}
	access, err = s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		if isGateRefusal(err) {
			return sent, nil
		}
		return DocumentAccessRequestResult{}, err
	}
	if access.Level.AtLeast(body.level) {
		return sent, nil
	}
	now := s.now()

	// (2) The cooldown of the requester's own latest decline on this document,
	// read under the document lock so a concurrent decline is seen before the
	// upsert.
	declined, err := q.GetLatestDeclinedDocumentAccessRequest(ctx, db.GetLatestDeclinedDocumentAccessRequestParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID, CreatedBy: actor.ID,
	})
	switch {
	case err == nil:
		if declined.DecidedAt.Valid {
			if retryAt := declined.DecidedAt.Time.Add(accessRequestCooldown); now.Before(retryAt) {
				return DocumentAccessRequestResult{}, errAccessRequestCooldown(retryAt.Sub(now))
			}
		}
	case errors.Is(err, pgx.ErrNoRows):
	default:
		return DocumentAccessRequestResult{}, err
	}

	// (3) The upsert: a new row, or the caller's own expired pending row
	// refreshed in place. A live pending row makes the DO UPDATE's WHERE
	// false, so no row comes back and the answer is 409 - the same answer the
	// loser of two concurrent sends gets, which is what the partial unique
	// index enforces.
	row, err := q.UpsertPendingDocumentAccessRequest(ctx, db.UpsertPendingDocumentAccessRequestParams{
		ID: util.NewID(), OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		DocumentID: doc.ID, CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
		RequestedLevel: string(body.level), Message: body.message,
		SourceKind: sourceKind, SourceID: sourceID,
		ExpiresAt: ts(now.Add(accessRequestPendingTTL)), Now: ts(now),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentAccessRequestResult{}, errAccessRequestPending()
	}
	if err != nil {
		return DocumentAccessRequestResult{}, err
	}

	// (4) Audit and outbox in the same transaction as the row. The message
	// text is never in the audit metadata: it lives in the request row, which
	// only the document's managers read.
	metadata := map[string]any{
		"request_id":      row.ID,
		"requested_level": string(body.level),
		"has_message":     body.message != "",
	}
	if sourceKind.Valid {
		metadata["source_kind"] = sourceKind.String
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
		Action: audit.ActionDocumentAccessRequested, ResourceType: "document", ResourceID: doc.ID,
		Metadata: metadata,
	}, audit.Event{Topic: topicDocumentAccessRequested, Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": doc.WorkspaceID, "request_id": row.ID,
	}}); err != nil {
		return DocumentAccessRequestResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DocumentAccessRequestResult{}, err
	}
	return sent, nil
}
