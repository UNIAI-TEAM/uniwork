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
	return &DocumentMessageInfo{DocumentID: documentID, VersionID: strings.TrimSpace(meta.VersionID)}
}

// resolveChatDocuments fills the viewer fields of every document block in
// rows, all from room, which the caller has already authorized for reading.
// The shape is signChatMedia's: one pass over the page collects the distinct
// document ids, then each distinct document is resolved once (a row read, a
// level resolution, its file info and, for the sender, a share count) - never
// per row. The resolution is not batched across documents. Resolution is best effort, like signing: a
// refusal (no Documents service, a document the caller may not read, a
// deleted row) leaves the block at document_id + viewer_has_access:false
// rather than failing the whole page.
func (s *ChatService) resolveChatDocuments(ctx context.Context, room db.ChatRoom, rows []ChatMessageRow, viewerID string) {
	if s.docs == nil || len(rows) == 0 || viewerID == "" {
		return
	}
	for i := range rows {
		if rows[i].Kind == "file" && rows[i].File != nil && rows[i].Document == nil && rows[i].SenderID == viewerID {
			rows[i].CanShareAsDocument = s.chatFileSaveableAsDocument(*rows[i].File)
		}
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
		if err != nil || info == nil {
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
	info.CanUploadVersion = chatDocumentCanUploadVersion(doc, access)
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

// chatDocumentCanUploadVersion reports whether the viewer may upload a new
// file version from the card (UNI-2012 D5/R6): only file documents have file
// versions, and uploading one requires at least edit.
func chatDocumentCanUploadVersion(doc db.Document, access DocumentAccess) bool {
	return doc.Kind == DocumentKindFile && access.Level.AtLeast(DocumentLevelEdit)
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

// chatDocumentCanSend answers can_send_document (L5): the caller may share a
// document into room - the Documents service is wired and the caller holds
// the room's send permission. It used to also require a grantable audience
// within the 50-user batch cap; UNI-2012 S1c removed the cap, so the flag is
// now send permission alone and costs no member walk.
func (s *ChatService) chatDocumentCanSend(ctx context.Context, userID string, room db.ChatRoom) bool {
	if s.docs == nil || s.files == nil {
		return false
	}
	return s.requireCanSendInRoom(ctx, userID, room.ID, room) == nil
}

// documentGrantRecipients is who the send grants to (§3.4): the room's
// current human members, the sender excluded, minus the ids whose membership
// gate refuses (a deactivated member or a suspended organization is skipped,
// never failed). Agents are not members of a chat room's user list, so they
// are not recipients; a room with no other human member grants nothing and
// the send still writes the message for the sender. Every member is gated in
// one query per tier (UNI-2012 S1c: a room of any size), the admission
// RequireMember would decide for each: an active member of the room's
// organization (R3: the share writer does not validate principals itself),
// and for workspace/channel rooms of the room's workspace too.
func (s *ChatService) documentGrantRecipients(ctx context.Context, senderID string, room db.ChatRoom) ([]string, error) {
	members, err := s.q.ListChatRoomMemberUserIDs(ctx, room.ID)
	if err != nil {
		return nil, err
	}
	others := make([]string, 0, len(members))
	for _, memberID := range members {
		if memberID != senderID {
			others = append(others, memberID)
		}
	}
	if len(others) == 0 {
		return []string{}, nil
	}
	inOrg, err := s.ws.orgs.AdmittedMemberIDsQ(ctx, s.q, room.OrganizationID, others)
	if err != nil {
		return nil, err
	}
	var inWorkspace map[string]bool
	switch room.Kind {
	case chatRoomKindWorkspace, chatRoomKindChannel:
		inWorkspace, err = s.ws.AdmittedMemberIDsQ(ctx, s.q, roomAnchorWorkspaceID(room), others)
		if err != nil {
			return nil, err
		}
	}
	out := make([]string, 0, len(others))
	for _, memberID := range others {
		if !inOrg[memberID] || (inWorkspace != nil && !inWorkspace[memberID]) {
			continue
		}
		out = append(out, memberID)
	}
	return out, nil
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

// chatFileSaveableAsDocument is the L6 / S10 verdict for a chat file attachment:
// the stored record must be saveable as a document (within the document_file
// cap and on its allowlist) and on L8's narrower chat document MIME subset.
func (s *ChatService) chatFileSaveableAsDocument(file FileMessageInfo) bool {
	if s.files == nil || s.docs == nil {
		return false
	}
	if file.FileID == "" && file.ObjectKey == "" {
		return false
	}
	ext := documentSourceExtension(file.Filename)
	if !documentSourceSaveable(documentFilePolicyFor(s.files), ext, file.ContentType, file.SizeBytes) {
		return false
	}
	ct := files.NormalizeContentType(file.ContentType)
	if ct == "" || ct == "application/octet-stream" {
		ct = documentSourceExtTypes[ext]
	}
	return chatDocumentMIMEType(ct)
}
