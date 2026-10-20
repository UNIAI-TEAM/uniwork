package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// chatDocumentShareRevokeActor is the system actor that records derived
// document.share_revoked rows when a chat room member leaves or is removed
// (UNI-2012 D2a).
var chatDocumentShareRevokeActor = audit.System("chat_document_share_revoke")

// chatShareReconcileBeforeCommit is a test seam: when set, it runs right
// before one share's reconcile transaction commits, while it holds the
// document lock, so a test can interleave a second removal and its reconcile
// (S1-fix B3). nil in production.
var chatShareReconcileBeforeCommit func()

// ChatDocumentShareRevoker is the outbox consumer that reconciles a person's
// chat-origin document shares when they leave or are removed from a chat
// room, a workspace or the organization (UNI-2012 D2a, S1-fix).
//
// The reconcile is state-based, never event-shaped: whichever of the three
// events arrives, it re-reads the person's CURRENT memberships and messages
// for every live chat-origin share of theirs in the organization, so the
// order of events, retries, replays and re-points change nothing. A chat
// grant is kept while the person is an invited or active member of some room
// holding a live document message of that document, sent during that
// membership (or the grant itself was made during it); a grant from an
// earlier membership is stale even after a rejoin.
//
// Hard rules:
//   - A share given by hand (source_kind IS NULL) is NEVER revoked here.
//   - Old chat grants written before D2a (source_kind IS NULL, no marker) are
//     NEVER auto-revoked here.
//   - A kept grant whose own source no longer backs it is re-pointed to the
//     room and message that do (audited, no event: access does not change).
//   - A stale grant is revoked (document.share_revoked audit + outbox in the
//     same transaction); when it had raised a lower manual share
//     (prior_manual_level), that manual share is restored with NULL
//     source_kind and its own document.shared audit + event.
//   - Deactivated organization members are skipped: deactivation keeps what
//     the person owns, and reactivation restores their rooms.
//
// It runs on the notify lane (main.go), never realtime, because it fans out
// across the member's chat-origin shares and writes audit + outbox rows in
// transactions.
type ChatDocumentShareRevoker struct {
	docs *DocumentService
}

// NewChatDocumentShareRevoker constructs the consumer over DocumentService.
func NewChatDocumentShareRevoker(docs *DocumentService) *ChatDocumentShareRevoker {
	return &ChatDocumentShareRevoker{docs: docs}
}

func (*ChatDocumentShareRevoker) Name() string { return "chat_document_share_revoker" }

func (*ChatDocumentShareRevoker) Topics() []string {
	return []string{"chat.room.member_removed", "member.removed", "member.left"}
}

func (c *ChatDocumentShareRevoker) Handle(ctx context.Context, ev outbox.Row) error {
	payload := map[string]string{}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			return fmt.Errorf("chat_document_share_revoker: payload of %s: %w", ev.ID, err)
		}
	}
	orgID := strings.TrimSpace(payload["organization_id"])
	if orgID == "" {
		orgID = strings.TrimSpace(ev.OrganizationID.String)
	}
	userID := strings.TrimSpace(payload["user_id"])
	if orgID == "" || userID == "" || c.docs == nil {
		return nil
	}
	switch ev.Topic {
	case "chat.room.member_removed", "member.removed", "member.left":
		// Never filtered by the event's room or workspace: a share may have
		// been re-pointed meanwhile, and the state decides, not the event.
		return c.docs.ReconcileChatDocumentSharesForMember(ctx, orgID, userID)
	default:
		return nil
	}
}

// ReconcileChatDocumentSharesForMember brings every live chat-origin share of
// userID in orgID in line with userID's current chat memberships: each share
// its own source no longer backs is decided again under its document's lock.
// Running it again changes nothing.
func (s *DocumentService) ReconcileChatDocumentSharesForMember(ctx context.Context, orgID, userID string) error {
	shares, err := s.q.ListChatDocumentSharesToReconcile(ctx, db.ListChatDocumentSharesToReconcileParams{
		OrganizationID: orgID,
		UserID:         userID,
	})
	if err != nil {
		return err
	}
	for _, sh := range shares {
		if err := s.reconcileChatDocumentShare(ctx, orgID, sh); err != nil {
			return err
		}
	}
	return nil
}

func (s *DocumentService) reconcileChatDocumentShare(ctx context.Context, orgID string, candidate db.DocumentShare) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	doc, err := q.LockDocumentByID(ctx, candidate.DocumentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if doc.OrganizationID != orgID {
		return nil
	}
	// The re-read under the lock: a concurrent reconcile may have revoked or
	// re-pointed the row since the list was read.
	live, err := q.GetLiveDocumentShareByID(ctx, db.GetLiveDocumentShareByIDParams{
		ID:             candidate.ID,
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// Hard rule: manual shares and old chat grants without a source_kind marker
	// are never auto-revoked.
	if !live.SourceKind.Valid || live.SourceKind.String != DocumentShareSourceKindChat {
		return nil
	}

	if _, err := decideChatDocumentShare(ctx, q, chatDocumentShareRevokeActor, doc, live); err != nil {
		return err
	}
	if chatShareReconcileBeforeCommit != nil {
		chatShareReconcileBeforeCommit()
	}
	return tx.Commit(ctx)
}

// decideChatDocumentShare is the reconcile decision for one live chat-origin
// share, run under its document's lock in the caller's transaction: kept (and
// re-pointed) while a live document message of the person's current
// membership backs it, revoked otherwise. Both the member-left consumer and
// the document-message delete (S1d) decide through it; actor is who the audit
// rows name. It reports whether the share was revoked.
func decideChatDocumentShare(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, live db.DocumentShare) (bool, error) {
	anchor, err := q.FindChatDocumentShareAnchor(ctx, db.FindChatDocumentShareAnchorParams{
		OrganizationID:  doc.OrganizationID,
		UserID:          live.PrincipalID,
		DocumentID:      doc.ID,
		SourceMessageID: live.SourceMessageID.String,
		GrantedAt:       live.CreatedAt,
	})
	switch {
	case err == nil:
		return false, repointChatDocumentShare(ctx, q, actor, doc, live, anchor)
	case errors.Is(err, pgx.ErrNoRows):
		return true, revokeChatDocumentShare(ctx, q, actor, doc, live)
	default:
		return false, err
	}
}

// repointChatDocumentShare moves a kept grant's source to the room and message
// that back it now, with an audit row of the transition. A source that already
// backs the grant is a no-op, so a replay writes nothing.
func repointChatDocumentShare(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, live db.DocumentShare, anchor db.FindChatDocumentShareAnchorRow) error {
	if live.SourceRoomID.String == anchor.RoomID && live.SourceMessageID.String == anchor.MessageID {
		return nil
	}
	if _, err := q.RepointDocumentShareChatSource(ctx, db.RepointDocumentShareChatSourceParams{
		ID:              live.ID,
		OrganizationID:  doc.OrganizationID,
		WorkspaceID:     doc.WorkspaceID,
		DocumentID:      doc.ID,
		SourceRoomID:    nullText(anchor.RoomID),
		SourceMessageID: nullText(anchor.MessageID),
	}); err != nil {
		return err
	}
	// The grant and its level are unchanged, so the row records the source
	// transition only and emits no event: nobody's access moved.
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentShared,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes: audit.Diff(
			map[string]any{"source_room_id": live.SourceRoomID.String, "source_message_id": live.SourceMessageID.String},
			map[string]any{"source_room_id": anchor.RoomID, "source_message_id": anchor.MessageID},
		),
		Metadata: map[string]any{
			"share_id":       live.ID,
			"principal_type": live.PrincipalType,
			"principal_id":   live.PrincipalID,
			"level":          live.Level,
			"source_kind":    DocumentShareSourceKindChat,
			"transition":     "chat_source_repointed",
		},
	})
}

// revokeChatDocumentShare revokes a stale chat grant through the revoke path
// (document.share_revoked audit + outbox) and restores the manual share it
// had raised, recording that grant as its own document.shared row and event.
func revokeChatDocumentShare(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, live db.DocumentShare) error {
	if err := revokeDocumentShareRow(ctx, q, actor, doc, live); err != nil {
		return err
	}
	if !live.PriorManualLevel.Valid {
		return nil
	}
	restored, err := q.InsertDocumentShare(ctx, db.InsertDocumentShareParams{
		ID:             util.NewID(),
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
		PrincipalType:  live.PrincipalType,
		PrincipalID:    live.PrincipalID,
		Level:          live.PriorManualLevel.String,
		GrantedBy:      chatDocumentShareRevokeActor.ID,
		GrantedByKind:  string(chatDocumentShareRevokeActor.Kind),
	})
	if err != nil {
		return err
	}
	// No notify_user_id: getting back the level one had before is no news.
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentShared,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes:        audit.Diff(nil, map[string]any{"level": restored.Level}),
		Metadata: map[string]any{
			"share_id":               restored.ID,
			"principal_type":         restored.PrincipalType,
			"principal_id":           restored.PrincipalID,
			"restored_from_share_id": live.ID,
			"transition":             "manual_share_restored",
		},
	}, audit.Event{Topic: "document.shared", Payload: map[string]string{
		"document_id":  doc.ID,
		"workspace_id": doc.WorkspaceID,
		"share_id":     restored.ID,
	}})
}

// Compile-time check that the consumer fits the dispatcher.
var _ interface {
	Name() string
	Topics() []string
	Handle(context.Context, outbox.Row) error
} = (*ChatDocumentShareRevoker)(nil)
