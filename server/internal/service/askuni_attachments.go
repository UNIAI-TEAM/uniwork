package service

import (
	"context"
	"errors"
	"io"
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

// AskAttachment is one file as the API and the answer path know it. Kind is
// what the model is given: image, pdf or text (everything else the file store
// admits is read as text).
type AskAttachment struct {
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

// attachmentsEnabled is whether this asker may send files: the attachments
// flag and the agent flag, both read for the person and the workspace's
// organization as the agent flag is, and a file store to put them in.
func (s *AskUNIService) attachmentsEnabled(ctx context.Context, userID string, w db.GetWorkspaceWithOrgRow) bool {
	if s.files == nil || s.flags == nil {
		return false
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: w.OrganizationID, WorkspaceID: w.ID})
	for _, key := range []string{askAttachmentsFlag, askAgentFlag} {
		f, _ := featureflags.Lookup(key)
		if !s.flags.IsEnabled(ctx, key, f.Default) {
			return false
		}
	}
	return true
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
	var fe *files.Error
	if errors.As(err, &fe) && fe.Code == files.CodeAlreadyClaimed {
		return ErrNotFound
	}
	return filesError(err)
}
