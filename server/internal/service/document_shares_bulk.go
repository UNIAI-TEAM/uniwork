package service

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// documentShareWriteChunk is how many user grants one statement writes
// (UNI-2012 S1c). There is no recipient cap any more, so a chat send to a
// 1,000-member room or a 1,000-person Documents batch share writes its grants
// a chunk at a time inside the command's one transaction: a handful of
// statements of bounded size instead of a round trip per grantee.
const documentShareWriteChunk = 200

// userShareSource marks the grants of one bulk write as chat-origin
// (UNI-2012 D2a); the zero value is a manual grant.
type userShareSource struct {
	kind      string
	roomID    string
	messageID string
}

// writtenUserShare is one grant a bulk write inserted: the new live row and
// the level of the live row it replaced ("" when there was none).
type writtenUserShare struct {
	share     db.DocumentShare
	prevLevel string
}

// writeUserSharesBulk is applyDocumentShareWithBatch for many user principals
// at one level, without the audit: the caller records the written grants in
// the shape its command promises (one row per grant for a Documents batch
// share, one batch row for a chat send). Same rules per user: the same live
// level is kept unchanged and not written (keepsLiveShare: a manual grant
// still takes over a chat-origin row), another live level is revoked and
// replaced, and a chat grant over a live share remembers the manual level it
// raised (priorManualLevelForChatGrant). before is the document's live share
// set read inside the caller's transaction before any write; userIDs are
// distinct and already gated by the caller. The answer holds every user's
// live share after the write, keyed by user id.
func writeUserSharesBulk(
	ctx context.Context, q *db.Queries, actor Actor, doc db.Document, before []db.DocumentShare,
	userIDs []string, level DocumentLevel, src userShareSource,
) (map[string]db.DocumentShare, []writtenUserShare, error) {
	prevByUser := make(map[string]db.DocumentShare, len(before))
	for _, sh := range before {
		if sh.PrincipalType == DocumentPrincipalUser {
			prevByUser[sh.PrincipalID] = sh
		}
	}
	live := make(map[string]db.DocumentShare, len(userIDs))
	todo := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
		if prev, ok := prevByUser[id]; ok && keepsLiveShare(prev, level, src.kind) {
			live[id] = prev
			continue
		}
		todo = append(todo, id)
	}
	var origin string
	var sourceKind, sourceRoomID, sourceMessageID pgtype.Text
	if src.kind == DocumentShareSourceKindChat {
		origin = DocumentShareOriginChat
		sourceKind = nullText(src.kind)
		sourceRoomID = nullText(src.roomID)
		sourceMessageID = nullText(src.messageID)
	}
	written := make([]writtenUserShare, 0, len(todo))
	for start := 0; start < len(todo); start += documentShareWriteChunk {
		chunk := todo[start:min(start+documentShareWriteChunk, len(todo))]
		var revokeIDs []string
		ids := make([]string, len(chunk))
		priors := make([]string, len(chunk))
		for i, id := range chunk {
			ids[i] = util.NewID()
			prev, hasPrev := prevByUser[id]
			if hasPrev {
				revokeIDs = append(revokeIDs, prev.ID)
			}
			if p := priorManualLevelForChatGrant(hasPrev, prev, src.kind); p.Valid {
				priors[i] = p.String
			}
		}
		if len(revokeIDs) > 0 {
			if err := q.RevokeDocumentSharesByIDs(ctx, db.RevokeDocumentSharesByIDsParams{
				RevokedBy: nullText(actor.ID), Ids: revokeIDs,
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
			}); err != nil {
				return nil, nil, err
			}
		}
		rows, err := q.InsertUserDocumentSharesBatch(ctx, db.InsertUserDocumentSharesBatchParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
			Level: string(level), GrantedBy: actor.ID, GrantedByKind: string(actor.Kind), Origin: origin,
			SourceKind: sourceKind, SourceRoomID: sourceRoomID, SourceMessageID: sourceMessageID,
			Ids: ids, PrincipalIds: chunk, PriorManualLevels: priors,
		})
		if err != nil {
			return nil, nil, err
		}
		for _, sh := range rows {
			live[sh.PrincipalID] = sh
		}
		// Request order, not RETURNING order, so the audit rows follow the
		// order the caller named the grantees in.
		for _, id := range chunk {
			written = append(written, writtenUserShare{share: live[id], prevLevel: prevByUser[id].Level})
		}
	}
	return live, written, nil
}
