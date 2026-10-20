package service

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The decision for live chat-origin shares (UNI-2012 S1-fix, S1-fix-2), run
// under the document's lock in the caller's transaction. The member-left
// reconcile decides one share at a time; a document-message delete (S1d)
// decides every share it touches in one pass and writes them set-based, so a
// 1,000-recipient card is a handful of statements, not a round trip per
// recipient.
//
// A share is backed by the live document messages of its document in rooms of
// the person's current membership, sent during that membership (or by its own
// source message when the grant itself was made during it). Its level is the
// highest level those messages granted, never more than it holds now: a
// reconcile lowers, it never raises. So:
//   - no backing message: revoked, and a manual level it had raised restored;
//   - backed below its level: lowered to the backing level (revoke and insert,
//     prior_manual_level kept), or revoked when the manual level it had raised
//     is at least the backing level, since the chat grant then adds nothing;
//   - backed at its level: kept, re-pointed when its own source no longer is
//     the message that backs it.
//
// A message written before its share_level was recorded backs the share at the
// share's current level: what it granted is unknown, and an unknown level never
// lowers anyone.

type chatShareAction int

const (
	chatShareKeep chatShareAction = iota
	chatShareRepoint
	chatShareLower
	chatShareRevoke
)

// chatShareBacking is one live document message that backs a chat grant now.
// level is "" when the message did not record what it granted.
type chatShareBacking struct {
	roomID    string
	messageID string
	level     DocumentLevel
	isSource  bool
}

// chatShareDecision is what to do with one live chat-origin share: anchor is
// the source it keeps or moves to, level the one a lowered share takes.
type chatShareDecision struct {
	share  db.DocumentShare
	action chatShareAction
	anchor chatShareBacking
	level  DocumentLevel
}

// chatMessageShareLevel reads a document message's recorded share_level. A
// chat send never grants manage, so only the three chat levels count.
func chatMessageShareLevel(raw string) (DocumentLevel, bool) {
	switch lv := DocumentLevel(raw); lv {
	case DocumentLevelView, DocumentLevelComment, DocumentLevelEdit:
		return lv, true
	default:
		return "", false
	}
}

// listChatShareBackings reads the backing messages of every share, keyed by
// share id, documentShareWriteChunk shares per statement. Each share's
// backings come in anchor order: its own source first, then oldest first.
func listChatShareBackings(ctx context.Context, q *db.Queries, doc db.Document, shares []db.DocumentShare) (map[string][]chatShareBacking, error) {
	out := make(map[string][]chatShareBacking, len(shares))
	for start := 0; start < len(shares); start += documentShareWriteChunk {
		chunk := shares[start:min(start+documentShareWriteChunk, len(shares))]
		ids := make([]string, len(chunk))
		users := make([]string, len(chunk))
		sources := make([]string, len(chunk))
		granted := make([]pgtype.Timestamptz, len(chunk))
		for i, sh := range chunk {
			ids[i], users[i], sources[i], granted[i] = sh.ID, sh.PrincipalID, sh.SourceMessageID.String, sh.CreatedAt
		}
		rows, err := q.ListChatDocumentShareBackings(ctx, db.ListChatDocumentShareBackingsParams{
			ShareIds: ids, UserIds: users, SourceMessageIds: sources, GrantedAts: granted,
			OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
		})
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			lv, _ := chatMessageShareLevel(r.ShareLevel)
			out[r.ShareID] = append(out[r.ShareID], chatShareBacking{
				roomID: r.RoomID, messageID: r.MessageID, level: lv, isSource: r.IsSource,
			})
		}
	}
	return out, nil
}

// decideChatShare is the rule above for one share and its backings.
func decideChatShare(live db.DocumentShare, backings []chatShareBacking) chatShareDecision {
	if len(backings) == 0 {
		return chatShareDecision{share: live, action: chatShareRevoke}
	}
	current := DocumentLevel(live.Level)
	levelOf := func(b chatShareBacking) DocumentLevel {
		if b.level == "" {
			return current
		}
		return b.level
	}
	target := DocumentLevelNone
	for _, b := range backings {
		if lv := levelOf(b); lv.rank() > target.rank() {
			target = lv
		}
	}
	if target.rank() > current.rank() {
		target = current
	}
	if target.rank() < current.rank() && live.PriorManualLevel.Valid &&
		DocumentLevel(live.PriorManualLevel.String).rank() >= target.rank() {
		return chatShareDecision{share: live, action: chatShareRevoke}
	}
	var anchor chatShareBacking
	for _, b := range backings {
		if levelOf(b).rank() >= target.rank() {
			anchor = b
			break
		}
	}
	switch {
	case target.rank() < current.rank():
		return chatShareDecision{share: live, action: chatShareLower, anchor: anchor, level: target}
	case live.SourceRoomID.String == anchor.roomID && live.SourceMessageID.String == anchor.messageID:
		return chatShareDecision{share: live, action: chatShareKeep, anchor: anchor}
	default:
		return chatShareDecision{share: live, action: chatShareRepoint, anchor: anchor}
	}
}

// decideChatShares decides every share against its current backings.
func decideChatShares(ctx context.Context, q *db.Queries, doc db.Document, shares []db.DocumentShare) ([]chatShareDecision, error) {
	backings, err := listChatShareBackings(ctx, q, doc, shares)
	if err != nil {
		return nil, err
	}
	out := make([]chatShareDecision, len(shares))
	for i, sh := range shares {
		out[i] = decideChatShare(sh, backings[sh.ID])
	}
	return out, nil
}

// applyChatShareDecisions writes the decisions in q's transaction; actor is who
// the audit rows name. Plain revokes and re-points go out set-based, a chunk
// per statement, with their audit and outbox rows through RecordMany; a revoke
// that restores a manual level and a lowering keep the per-share path, since
// each inserts a row of its own. It reports how many shares were revoked and
// how many lowered.
func applyChatShareDecisions(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, decisions []chatShareDecision) (revoked, lowered int, err error) {
	var revokeIDs, repointIDs, repointRooms, repointMessages []string
	var records []audit.Recorded
	for _, d := range decisions {
		switch d.action {
		case chatShareRevoke:
			revoked++
			if d.share.PriorManualLevel.Valid {
				if err := revokeChatDocumentShare(ctx, q, actor, doc, d.share); err != nil {
					return 0, 0, err
				}
				continue
			}
			revokeIDs = append(revokeIDs, d.share.ID)
			records = append(records, documentShareRevokeRecord(actor, doc, d.share, ""))
		case chatShareLower:
			lowered++
			if err := lowerChatDocumentShare(ctx, q, actor, doc, d); err != nil {
				return 0, 0, err
			}
		case chatShareRepoint:
			repointIDs = append(repointIDs, d.share.ID)
			repointRooms = append(repointRooms, d.anchor.roomID)
			repointMessages = append(repointMessages, d.anchor.messageID)
			records = append(records, chatShareRepointRecord(actor, doc, d))
		}
	}
	for start := 0; start < len(revokeIDs); start += documentShareWriteChunk {
		if err := q.RevokeDocumentSharesByIDs(ctx, db.RevokeDocumentSharesByIDsParams{
			RevokedBy: nullText(actor.ID), Ids: revokeIDs[start:min(start+documentShareWriteChunk, len(revokeIDs))],
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		}); err != nil {
			return 0, 0, err
		}
	}
	for start := 0; start < len(repointIDs); start += documentShareWriteChunk {
		end := min(start+documentShareWriteChunk, len(repointIDs))
		if err := q.RepointDocumentSharesChatSources(ctx, db.RepointDocumentSharesChatSourcesParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
			Ids: repointIDs[start:end], SourceRoomIds: repointRooms[start:end], SourceMessageIds: repointMessages[start:end],
		}); err != nil {
			return 0, 0, err
		}
	}
	for start := 0; start < len(records); start += documentShareWriteChunk {
		if err := auditRecorder.RecordMany(ctx, q, records[start:min(start+documentShareWriteChunk, len(records))]); err != nil {
			return 0, 0, err
		}
	}
	return revoked, lowered, nil
}

// chatShareRepointRecord is the audit row of a re-point. The grant and its
// level are unchanged, so it records the source transition only and emits no
// event: nobody's access moved.
func chatShareRepointRecord(actor Actor, doc db.Document, d chatShareDecision) audit.Recorded {
	live := d.share
	return audit.Recorded{Entry: audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentShared,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes: audit.Diff(
			map[string]any{"source_room_id": live.SourceRoomID.String, "source_message_id": live.SourceMessageID.String},
			map[string]any{"source_room_id": d.anchor.roomID, "source_message_id": d.anchor.messageID},
		),
		Metadata: map[string]any{
			"share_id":       live.ID,
			"principal_type": live.PrincipalType,
			"principal_id":   live.PrincipalID,
			"level":          live.Level,
			"source_kind":    DocumentShareSourceKindChat,
			"transition":     "chat_source_repointed",
		},
	}}
}

// lowerChatDocumentShare moves a chat grant down to the level its backing
// messages give (S1-fix-2 SF3): the row is revoked and a chat row at the lower
// level, sourced by the anchor and remembering the same manual level, is
// inserted. One document.shared row records the level change, the shape a
// level change by hand has, and its event names the new share.
func lowerChatDocumentShare(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, d chatShareDecision) error {
	live := d.share
	if err := q.RevokeDocumentShare(ctx, db.RevokeDocumentShareParams{
		ID: live.ID, OrganizationID: live.OrganizationID, WorkspaceID: live.WorkspaceID,
		DocumentID: live.DocumentID, RevokedBy: nullText(actor.ID),
	}); err != nil {
		return err
	}
	sh, err := q.InsertDocumentShare(ctx, db.InsertDocumentShareParams{
		ID:               util.NewID(),
		OrganizationID:   doc.OrganizationID,
		WorkspaceID:      doc.WorkspaceID,
		DocumentID:       doc.ID,
		PrincipalType:    live.PrincipalType,
		PrincipalID:      live.PrincipalID,
		Level:            string(d.level),
		GrantedBy:        actor.ID,
		GrantedByKind:    string(actor.Kind),
		SourceKind:       nullText(DocumentShareSourceKindChat),
		SourceRoomID:     nullText(d.anchor.roomID),
		SourceMessageID:  nullText(d.anchor.messageID),
		PriorManualLevel: live.PriorManualLevel,
	})
	if err != nil {
		return err
	}
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentShared,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes:        audit.Diff(map[string]any{"level": live.Level}, map[string]any{"level": sh.Level}),
		Metadata: map[string]any{
			"share_id":          sh.ID,
			"principal_type":    sh.PrincipalType,
			"principal_id":      sh.PrincipalID,
			"replaced_share_id": live.ID,
			"source_kind":       DocumentShareSourceKindChat,
			"source_room_id":    d.anchor.roomID,
			"source_message_id": d.anchor.messageID,
			"transition":        "chat_level_lowered",
		},
	}, audit.Event{Topic: "document.shared", Payload: map[string]string{
		"document_id":  doc.ID,
		"workspace_id": doc.WorkspaceID,
		"share_id":     sh.ID,
	}})
}
