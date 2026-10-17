package notification

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The document edit lock's three person-addressed topics (UNI-1645, addendum
// §5.2). The outbox row names the recipient in payload.user_id (the holder,
// the requester, the previous holder); every rule re-checks that this person
// can still read the document at delivery time, so a share revoked between
// the event and this run yields nothing - and with no document permission
// port wired the rules stay silent, like the comment rules.

const (
	editDecisionAccept  = "accept"
	editDecisionDecline = "decline"
	// editRequestAnsweredAudit is the audit action the answer writes in the
	// same transaction as the event; the answer's decision is not in the
	// payload (ids only), so the rule reads it from that row's metadata.
	editRequestAnsweredAudit = "document.edit_request_answered"
)

// editLockDocument loads the document the event names and proves it lives in
// the event's own tenant pair; ok=false means "nothing to do".
func editLockDocument(ctx context.Context, e env, ev outbox.Row, p map[string]string) (db.Document, bool, error) {
	if e.docs == nil || p["document_id"] == "" || p["user_id"] == "" {
		return db.Document{}, false, nil
	}
	doc, err := e.q.GetDocumentByID(ctx, p["document_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, false, nil
	}
	if err != nil {
		return db.Document{}, false, err
	}
	if (ev.OrganizationID.Valid && doc.OrganizationID != ev.OrganizationID.String) ||
		(ev.WorkspaceID.Valid && doc.WorkspaceID != ev.WorkspaceID.String) {
		return db.Document{}, false, nil
	}
	return doc, true, nil
}

// editLockDraft is the one draft an edit-lock topic produces, or none when
// the recipient is the actor or can no longer read the document.
func editLockDraft(ctx context.Context, e env, ev outbox.Row, p map[string]string, doc db.Document, kind, groupKey string, extra map[string]string) ([]Draft, error) {
	uid := p["user_id"]
	if isActorOfEvent(ev, uid) {
		return nil, nil
	}
	readers, err := e.docs.FilterDocumentReaders(ctx, doc.ID, []string{uid})
	if err != nil {
		return nil, err
	}
	if len(readers) == 0 {
		return nil, nil
	}
	params := map[string]string{"actor": actorName(ctx, e.q, ev), "document": doc.Title}
	for k, v := range extra {
		params[k] = v
	}
	return []Draft{{
		UserID: uid, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		Kind: kind, GroupKey: groupKey,
		ResourceType: "document", ResourceID: doc.ID,
		ActorKind: actorKindOf(ev), ActorID: ev.ActorID.String,
		Params: params,
	}}, nil
}

// ruleDocumentEditRequested tells the holder that someone asks to edit.
// request_id rides in the params: it is the deep link's ?edit_request=.
func ruleDocumentEditRequested(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	doc, ok, err := editLockDocument(ctx, e, ev, p)
	if err != nil || !ok || p["request_id"] == "" {
		return nil, err
	}
	return editLockDraft(ctx, e, ev, p, doc, KindDocumentEditRequested,
		"document:"+doc.ID+":edit_requested:"+p["request_id"], map[string]string{"request_id": p["request_id"]})
}

// ruleDocumentEditTakenOver tells the previous holder that a manager took the
// lock. Each take-over is its own row (keyed by the event), never merged: a
// person can lose the lock twice, and each loss is news.
func ruleDocumentEditTakenOver(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	doc, ok, err := editLockDocument(ctx, e, ev, p)
	if err != nil || !ok {
		return nil, err
	}
	return editLockDraft(ctx, e, ev, p, doc, KindDocumentEditTakenOver,
		"document:"+doc.ID+":edit_taken_over:"+ev.ID, nil)
}

// ruleDocumentEditRequestAnswered tells the requester how the holder
// answered. The decision comes from the audit row of the same correlation
// (see editRequestAnsweredAudit); without it the wording would be a guess, so
// the rule says nothing.
func ruleDocumentEditRequestAnswered(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	doc, ok, err := editLockDocument(ctx, e, ev, p)
	if err != nil || !ok || p["request_id"] == "" {
		return nil, err
	}
	decision, found, err := editRequestDecision(ctx, e.q, ev, p["request_id"], doc.ID)
	if err != nil || !found {
		return nil, err
	}
	return editLockDraft(ctx, e, ev, p, doc, KindDocumentEditRequestAnswered,
		"document:"+doc.ID+":edit_request_answered:"+p["request_id"],
		map[string]string{"request_id": p["request_id"], "decision": decision})
}

// editRequestDecision reads metadata.decision of the answer's audit row. The
// row's resource is the request, or the document when the writer files it
// there; both are tried so the lookup does not hang on that choice.
func editRequestDecision(ctx context.Context, q *db.Queries, ev outbox.Row, requestID, documentID string) (string, bool, error) {
	if !ev.CorrelationID.Valid || ev.CorrelationID.String == "" {
		return "", false, nil
	}
	for _, resourceID := range []string{requestID, documentID} {
		row, err := q.GetAuditEventByCorrelation(ctx, db.GetAuditEventByCorrelationParams{
			CorrelationID: ev.CorrelationID.String, Action: editRequestAnsweredAudit, ResourceID: resourceID, Before: ev.CreatedAt,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return "", false, err
		}
		var meta struct {
			Decision string `json:"decision"`
		}
		if json.Unmarshal([]byte(row.Metadata), &meta) != nil {
			continue
		}
		switch meta.Decision {
		case editDecisionAccept, editDecisionDecline:
			return meta.Decision, true, nil
		}
	}
	return "", false, nil
}
