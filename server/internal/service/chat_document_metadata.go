package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Chat document messages (UNI-1966 §4.2, §5). The metadata carries ids only -
// {"document_id"} for a document message, {"document_id","version_id"} for a
// version message - and the viewer-facing block is resolved per read, never
// stored, because the level it must show is the one the caller holds *now*
// (§5: the share dialog changes the level and the card follows on the next
// refetch).

const (
	chatMessageKindDocument        = "document"
	chatMessageKindDocumentVersion = "document_version"
)

// DocumentMessageInfo is the service-side `document` block of a message.
// DocumentID is the only field documentMessageFromMetadata can fill; every
// other field is the resolver's, and an unresolved block (no Documents
// service, a document the caller cannot read) stays with HasAccess false and
// the rest zero, which the SDO renders as document_id + viewer_has_access.
type DocumentMessageInfo struct {
	DocumentID        string
	VersionID         string
	HasAccess         bool
	Level             string
	CanManage         bool
	CanUploadVersion  bool
	Title             string
	Format            string
	VersionNumber     int32
	Revision          int64
	CanOpenInApp      bool
	RecipientCount    int
	HasRecipientCount bool
}

// documentMessageFromMetadata is the per-kind decode, the
// fileMessageFromMetadata shape: a document message names a document, a
// version message names a document and one version. A malformed block yields
// nil, so the message loads without a document card rather than failing the
// page.
func documentMessageFromMetadata(kind string, raw []byte) *DocumentMessageInfo {
	if kind != chatMessageKindDocument && kind != chatMessageKindDocumentVersion {
		return nil
	}
	if len(raw) == 0 {
		return nil
	}
	var meta struct {
		DocumentID string `json:"document_id"`
		VersionID  string `json:"version_id"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil
	}
	documentID := strings.TrimSpace(meta.DocumentID)
	if documentID == "" {
		return nil
	}
	info := &DocumentMessageInfo{DocumentID: documentID, VersionID: strings.TrimSpace(meta.VersionID)}
	if kind == chatMessageKindDocumentVersion && info.VersionID == "" {
		// A version message without a version id cannot name its version
		// line; the card still shows the document.
		return info
	}
	return info
}

// resolveChatDocuments fills the viewer fields of every document block in
// rows, all from room, which the caller has already authorized for reading.
// The shape is signChatMedia's: one pass over the page collects the distinct
// document ids, one batched share read and one level resolution per distinct
// document - never per row. Resolution is best effort, like signing: a
// refusal (no Documents service, a document the caller may not read, a
// deleted row) leaves the block at document_id + viewer_has_access:false
// rather than failing the whole page.
func (s *ChatService) resolveChatDocuments(ctx context.Context, room db.ChatRoom, rows []ChatMessageRow, viewerID string) {
	if s.docs == nil || len(rows) == 0 || viewerID == "" {
		return
	}
	ids := make([]string, 0, len(rows))
	seen := map[string]bool{}
	for _, row := range rows {
		if row.Document == nil || seen[row.Document.DocumentID] {
			continue
		}
		seen[row.Document.DocumentID] = true
		ids = append(ids, row.Document.DocumentID)
	}
	if len(ids) == 0 {
		return
	}
	actor := Human(viewerID)
	byID := make(map[string]*DocumentMessageInfo, len(ids))
	for _, id := range ids {
		info, err := s.resolveChatDocument(ctx, actor, room, id)
		if err != nil {
			continue
		}
		byID[id] = info
	}
	for i := range rows {
		if rows[i].Document == nil {
			continue
		}
		info, ok := byID[rows[i].Document.DocumentID]
		if !ok {
			continue
		}
		merged := *info
		merged.VersionID = rows[i].Document.VersionID
		rows[i].Document = &merged
	}
}

// resolveChatDocument is the block for one document as one viewer. It reads
// the row by id, which is safe here because the room gate already decided the
// caller may read the room: a document of another organization is not
// resolvable and comes back with HasAccess false, carrying no title or
// revision of a tenant the caller is not in.
func (s *ChatService) resolveChatDocument(ctx context.Context, actor Actor, room db.ChatRoom, documentID string) (*DocumentMessageInfo, error) {
	doc, err := s.docs.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if doc.OrganizationID != room.OrganizationID {
		return nil, nil
	}
	access, err := s.docs.effectiveLevel(ctx, s.docs.q, actor, doc)
	if err != nil {
		return nil, err
	}
	info := &DocumentMessageInfo{DocumentID: documentID}
	if access.Level == DocumentLevelNone || doc.ArchivedAt.Valid {
		return info, nil
	}
	info.HasAccess = true
	info.Level = string(access.Level)
	info.CanManage = access.canAdminister()
	info.CanUploadVersion = access.Level.AtLeast(DocumentLevelEdit)
	info.Title = doc.Title
	info.VersionNumber = doc.CurrentVersion
	info.Revision = doc.Revision
	info.Format, info.CanOpenInApp = s.chatDocumentFormat(ctx, actor.ID, doc)
	// The count is the sender's aggregate only (§5): a member who later gains
	// access must not learn the audience from the card.
	if doc.CreatedBy == actor.ID {
		count, err := s.chatDocumentRecipientCount(ctx, doc)
		if err != nil {
			return nil, err
		}
		info.RecipientCount, info.HasRecipientCount = count, true
	}
	return info, nil
}

// chatDocumentFormat is the type icon's format and the §5 open-in-app rule.
// The rule is the Office frame's own (office_frame.go's load): a live file
// document whose current version a module opens, with a .txt behind the
// txtOpenEnabled flag. A page or folder document has no file, so no format
// and no editor.
func (s *ChatService) chatDocumentFormat(ctx context.Context, userID string, doc db.Document) (string, bool) {
	if doc.Kind != DocumentKindFile {
		return "", false
	}
	file, err := s.docs.currentFileInfo(ctx, doc)
	if err != nil || file == nil {
		return "", false
	}
	format := documentSourceExtension(file.Filename)
	if format == "" {
		format = documentSourceExtension(doc.Title)
	}
	if isTxtFilename(file.Filename) && !s.docs.txtOpenEnabled(ctx, userID, doc.WorkspaceID, doc.OrganizationID) {
		return format, false
	}
	_, openable := officeFrameModuleOf(file.MimeType, file.Filename)
	return format, openable
}

// chatDocumentRecipientCount is the live grant count of a document, the §5
// "Đã chia sẻ với N người" aggregate: one count over document_shares with
// revoked_at IS NULL, in the document's tenant pair.
func (s *ChatService) chatDocumentRecipientCount(ctx context.Context, doc db.Document) (int, error) {
	n, err := s.docs.q.CountLiveDocumentShares(ctx, db.CountLiveDocumentSharesParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
	})
	if err != nil {
		return 0, err
	}
	return int(n), nil
}

// chatDocumentShareBatchCap answers whether the caller may share a document
// into room at all (L5): sending needs the room's send permission and a
// grantable audience within maxDocumentShareBatch. The audience is the
// current human room members, the sender excluded, that pass the tenant gate
// - the same set the send grants, so a room that would overflow the batch
// cap refuses the picker instead of failing the send.
func (s *ChatService) chatDocumentShareBatchCap(ctx context.Context, userID string, room db.ChatRoom) bool {
	if s.docs == nil || s.files == nil {
		return false
	}
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return false
	}
	recipients, err := s.documentGrantRecipients(ctx, userID, room)
	if err != nil {
		return false
	}
	return len(recipients) <= maxDocumentShareBatch
}

// documentGrantRecipients is who the send grants to (§3.4): the room's
// current human members, the sender excluded, minus the ids whose membership
// gate refuses (a deactivated member or a suspended organization is skipped,
// never failed). Agents are not members of a chat room's user list, so they
// are not recipients; a room with no other human member grants nothing and
// the send still writes the message for the sender.
func (s *ChatService) documentGrantRecipients(ctx context.Context, senderID string, room db.ChatRoom) ([]string, error) {
	members, err := s.q.ListChatRoomMemberUserIDs(ctx, room.ID)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(members))
	for _, memberID := range members {
		if memberID == senderID {
			continue
		}
		if _, err := s.ws.RequireMember(ctx, roomAnchorWorkspaceID(room), memberID); err != nil {
			if isGateRefusal(err) {
				continue
			}
			return nil, err
		}
		out = append(out, memberID)
	}
	return out, nil
}

// chatDocumentMessageKind reports whether a kind is a document share, so a
// caller can decide whether a message needs the resolver at all.
func chatDocumentMessageKind(kind string) bool {
	return kind == chatMessageKindDocument || kind == chatMessageKindDocumentVersion
}

// chatDocumentMIMEType reports whether a verified content type may be shared
// as a chat document (L8). The set is files.ChatDocumentMIMETypes - the ten
// editor formats, without the UNI-1232 image/css/js assets.
func chatDocumentMIMEType(contentType string) bool {
	ct := files.NormalizeContentType(contentType)
	for _, allowed := range files.ChatDocumentMIMETypes {
		if files.NormalizeContentType(allowed) == ct {
			return true
		}
	}
	return false
}
