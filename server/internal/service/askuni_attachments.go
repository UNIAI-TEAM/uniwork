package service

import (
	"context"
	"errors"
	"io"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Files on an Ask UNI question (UNI-2119). A file is uploaded the moment the
// asker picks it and sits in the file store, claimed by nobody, until a
// question names it (that send writes the ai_attachments row); one never sent
// is cleaned by the store after files.ClaimTTL. Upload and cancel are the
// asker's own: nothing here reads another person's file.

const askAttachmentsFlag = "ask_uni_attachments"

// Limits of one question's files (UNI-2119); the client checks them too.
const (
	askMaxAttachments      = 5
	askMaxAttachmentsBytes = 20 << 20
)

// AskAttachment is one file as the API and the answer path know it. Kind is
// what the model is given: image, pdf or text (everything else the file store
// admits is read as text). ID is the ai_attachments row a stored question
// holds the file by; it is empty on an upload that no question has claimed.
type AskAttachment struct {
	ID                       string
	FileID, Name, MIME, Kind string
	Size                     int64
}

// SetFiles wires FileService; without it attachments read as off.
func (s *AskUNIService) SetFiles(f files.Service) { s.files = f }

// askAttachmentKind is the kind of a stored, normalized MIME.
func askAttachmentKind(mime string) string {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return "image"
	case mime == "application/pdf":
		return "pdf"
	}
	return "text"
}

// attachmentsEnabled is whether this asker's turn would run the agent with
// files readable: agentOn (the agent flag, the read tools and a copilot_agent
// model, as the turn itself decides), the attachments flag read the same way
// for the person and the workspace's organization, and a file store to put
// them in. A turn that would fall back to P0 cannot read a file.
func (s *AskUNIService) attachmentsEnabled(ctx context.Context, userID string, w db.GetWorkspaceWithOrgRow) bool {
	tc := ai.ToolContext{ActorID: userID, OrganizationID: w.OrganizationID, WorkspaceID: w.ID}
	if s.files == nil || !s.agentOn(ctx, tc) {
		return false
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: w.OrganizationID, WorkspaceID: w.ID})
	f, _ := featureflags.Lookup(askAttachmentsFlag)
	return s.flags.IsEnabled(ctx, askAttachmentsFlag, f.Default)
}

func (s *AskUNIService) authorizeAttachments(ctx context.Context, userID, workspaceID string) (db.GetWorkspaceWithOrgRow, error) {
	w, err := s.requireMember(ctx, userID, workspaceID)
	if err != nil {
		return w, err
	}
	if !s.attachmentsEnabled(ctx, userID, w) {
		return w, ai.ErrAttachmentsUnavailable
	}
	return w, nil
}

// AuthorizeAttachmentUpload is the gate UploadAttachment runs, for the handler
// to run before it reads a body that can be 20 MiB.
func (s *AskUNIService) AuthorizeAttachmentUpload(ctx context.Context, userID, workspaceID string) error {
	_, err := s.authorizeAttachments(ctx, userID, workspaceID)
	return err
}

// UploadAttachment stores one file for the asker's next question. The file
// store decides the type from the bytes and the size from the stream; its
// refusals (type, size) are returned as coded errors. The upload is not
// audited: like the rest of the asker's Ask UNI history it is private to them,
// and it changes no business row until a question claims it.
func (s *AskUNIService) UploadAttachment(ctx context.Context, userID, workspaceID, filename string, body io.Reader) (AskAttachment, error) {
	w, err := s.authorizeAttachments(ctx, userID, workspaceID)
	if err != nil {
		return AskAttachment{}, err
	}
	up, err := s.files.Upload(ctx, files.UploadInput{
		Actor:          Human(userID),
		Purpose:        files.AiAttachment,
		Scope:          files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: workspaceID},
		IdempotencyKey: "ai-attachment-" + util.NewID(),
		Filename:       filename,
		Body:           body,
	})
	if err != nil {
		return AskAttachment{}, filesError(err)
	}
	f := up.File
	return AskAttachment{FileID: string(f.ID), Name: f.Filename, MIME: f.ContentType, Kind: askAttachmentKind(f.ContentType), Size: f.SizeBytes}, nil
}

// CancelAttachment drops a file the asker uploaded and no question has
// claimed. Anything else - another person's file, another workspace's, one of
// another purpose, one a sent question holds - is not found, and repeating a
// cancel answers the same nothing. It does not need the flags: a file already
// uploaded can always be taken back.
func (s *AskUNIService) CancelAttachment(ctx context.Context, userID, workspaceID, fileID string) error {
	w, err := s.requireMember(ctx, userID, workspaceID)
	if err != nil {
		return err
	}
	if s.files == nil {
		return ErrNotFound
	}
	// The file store checks the actor and the scope; the purpose is this
	// service's to check, or a task attachment could be cancelled from here.
	sess, err := s.q.GetUploadSessionByFile(ctx, fileID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ErrNotFound
	case err != nil:
		return err
	case sess.Purpose != string(files.AiAttachment):
		return ErrNotFound
	}
	err = s.files.CancelUpload(ctx, files.CancelInput{
		Actor: Human(userID), Scope: files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: workspaceID}, FileID: files.FileID(fileID),
	})
	return askFileError(err)
}

// OpenAttachment streams a file a sent question of the asker's carries, by the
// ai_attachments id the message listed it under. Another person's file,
// another workspace's, another tenant's and an id that names nothing are one
// bare ErrNotFound. Only membership and ownership gate it, not the flags: what
// a person attached stays theirs to download after files are switched off.
func (s *AskUNIService) OpenAttachment(ctx context.Context, userID, workspaceID, attachmentID string) (files.Reader, AskAttachment, error) {
	w, err := s.requireMember(ctx, userID, workspaceID)
	if err != nil {
		return files.Reader{}, AskAttachment{}, err
	}
	if s.files == nil {
		return files.Reader{}, AskAttachment{}, ErrNotFound
	}
	row, err := s.q.AiGetUserAttachment(ctx, db.AiGetUserAttachmentParams{
		OrganizationID: w.OrganizationID, WorkspaceID: workspaceID, UserID: userID, ID: attachmentID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return files.Reader{}, AskAttachment{}, ErrNotFound
	}
	if err != nil {
		return files.Reader{}, AskAttachment{}, err
	}
	r, err := s.files.Open(ctx, files.OpenInput{
		Scope: files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: workspaceID}, FileID: files.FileID(row.FileID),
	})
	if err != nil {
		return files.Reader{}, AskAttachment{}, askFileError(err)
	}
	return r, askAttachmentRow(row), nil
}

// releaseAskFiles tells the file store that no question holds these files any
// more, in the transaction that removed their rows. One id can come back more
// than once; the store sees it once. Without a file store the rows cannot go:
// their files would stay claimed for good.
func (s *AskUNIService) releaseAskFiles(ctx context.Context, q *db.Queries, fileIDs []string) error {
	if len(fileIDs) == 0 {
		return nil
	}
	if s.files == nil {
		return errors.New("ask uni: releasing files requires FileService")
	}
	slices.Sort(fileIDs)
	ids := make([]files.FileID, 0, len(fileIDs))
	for _, id := range slices.Compact(fileIDs) {
		ids = append(ids, files.FileID(id))
	}
	return releaseFilesInTx(ctx, s.files, q, ids)
}

// askFileError is err as the asker is told it. One answer for every file that
// is not theirs to use: filesError would name the id (file_not_found), which
// tells a stranger it exists.
func askFileError(err error) error {
	var fe *files.Error
	if errors.As(err, &fe) && (fe.Code == files.CodeAlreadyClaimed || fe.Code == files.CodeNotFound) {
		return ErrNotFound
	}
	return filesError(err)
}

// askAttachments checks the files a question names and returns them in attach
// order, before anything is stored or claimed (the claim is store's). More than
// five or the same id twice is ai_attachments_invalid; any id while files are
// off for this asker is ai_attachments_unavailable; an id that is not an
// unsent ai_attachment upload of theirs in this workspace is the bare
// ErrNotFound, the answer for an id that names nothing; files that add up to
// more than 20 MB are ai_attachments_too_large.
func (s *AskUNIService) askAttachments(ctx context.Context, userID string, w db.GetWorkspaceWithOrgRow, ids []string) ([]AskAttachment, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			return nil, ai.ErrAttachmentsInvalid
		}
		seen[id] = true
	}
	if len(ids) > askMaxAttachments {
		return nil, ai.ErrAttachmentsInvalid
	}
	if !s.attachmentsEnabled(ctx, userID, w) {
		return nil, ai.ErrAttachmentsUnavailable
	}
	out := make([]AskAttachment, 0, len(ids))
	var total int64
	for _, id := range ids {
		a, err := s.unsentUpload(ctx, userID, w, id)
		if err != nil {
			return nil, err
		}
		total += a.Size
		out = append(out, a)
	}
	if total > askMaxAttachmentsBytes {
		return nil, ai.ErrAttachmentsTooLarge
	}
	return out, nil
}

// unsentUpload is the file id names when it is an ai_attachment the asker
// uploaded to this workspace and no question has claimed; anything else is
// ErrNotFound, whatever the reason. The upload session is the grant: it names
// who uploaded, for what and where, and ends once a question claims the file.
func (s *AskUNIService) unsentUpload(ctx context.Context, userID string, w db.GetWorkspaceWithOrgRow, id string) (AskAttachment, error) {
	sess, err := s.q.GetUploadSessionByFile(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return AskAttachment{}, ErrNotFound
	}
	if err != nil {
		return AskAttachment{}, err
	}
	if sess.Purpose != string(files.AiAttachment) || sess.CreatedBy != userID ||
		sess.OrganizationID.String != w.OrganizationID || sess.WorkspaceID.String != w.ID ||
		files.SessionStatus(sess.Status) != files.SessionStaged || sessionGrant(sess, s.now()) != nil {
		return AskAttachment{}, ErrNotFound
	}
	row, err := s.q.GetOrgFile(ctx, db.GetOrgFileParams{ID: id, OrganizationID: strText(w.OrganizationID)})
	if errors.Is(err, pgx.ErrNoRows) {
		return AskAttachment{}, ErrNotFound
	}
	if err != nil {
		return AskAttachment{}, err
	}
	if fileState(row) != nil {
		return AskAttachment{}, ErrNotFound
	}
	f := fileView(row)
	return AskAttachment{FileID: id, Name: f.Filename, MIME: f.ContentType, Kind: askAttachmentKind(f.ContentType), Size: f.SizeBytes}, nil
}

// attachAskFiles claims a question's files and writes their ai_attachments
// rows in the transaction that stores the question: q is store's q.WithTx(tx),
// so a failed question leaves every file unsent. The claim comes first, as
// FileService's lock order asks. The upload and the cancel are not audited,
// like the stage-only uploads of documents: they change no business row, and
// the claim is part of storing the question, which is the asker's private
// history like the rest of it.
func (s *AskUNIService) attachAskFiles(ctx context.Context, q *db.Queries, orgID, convID, messageID string, t askTurn) error {
	ids := make([]files.FileID, len(t.Files))
	raw := make([]string, len(t.Files))
	for i, f := range t.Files {
		ids[i], raw[i] = files.FileID(f.FileID), f.FileID
	}
	if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
		Actor: Human(t.UserID), Purpose: files.AiAttachment, Scope: files.Scope{OrganizationID: orgID, WorkspaceID: t.WorkspaceID}, FileIDs: ids,
	}); err != nil {
		return askFileError(err)
	}
	// ClaimInTx attaches a file a question already holds again, which is how
	// other modules stay safe to retry; here a file belongs to one question, so
	// the second of two that raced past the check is refused.
	held, err := q.AiListAttachmentFileIDs(ctx, raw)
	if err != nil {
		return err
	}
	if len(held) > 0 {
		return ErrNotFound
	}
	// One id each, minted in attach order: rows of one question share their
	// created_at, so the ULID order is what lists them as they were attached.
	for _, f := range t.Files {
		if err := q.AiInsertAttachment(ctx, db.AiInsertAttachmentParams{
			ID: util.NewID(), OrganizationID: orgID, WorkspaceID: t.WorkspaceID, UserID: t.UserID, ConversationID: convID,
			MessageID: messageID, FileID: f.FileID, Name: f.Name, Mime: f.MIME, SizeBytes: f.Size, Kind: f.Kind,
		}); err != nil {
			return err
		}
	}
	return nil
}
