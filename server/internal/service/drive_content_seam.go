package service

import (
	"context"
	"errors"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// DriveContentPurpose is why UNI reads a Drive file; it lands in the drive_file.read audit row.
type DriveContentPurpose string

const (
	DriveContentPurposeTaskProposal DriveContentPurpose = "task_proposal"
	DriveContentPurposeAskUni       DriveContentPurpose = "ask_uni"
)

// DriveContent is one read of a Drive file for a model call (spec 8.3).
type DriveContent struct {
	DriveFileID string
	Name        string
	MimeType    string
	Text        string          // untrusted; empty when the file goes as an attachment
	Truncated   bool            // cut at 200,000 chars
	Attachments []provider.Part // PDF as a media part for the first model call of the request; nil otherwise
	GoogleEmail string          // the requester's account used for the read (audit metadata, never logs)
}

// DriveContentReader is the only way Ask UNI reads Drive content. ReadForAI checks that the file is in workspaceID and
// that requesterID has a granted drive_file_access row, reads with the requester's own connection, and writes the
// drive_file.read audit row (purpose) itself.
type DriveContentReader interface {
	ReadForAI(ctx context.Context, requesterID, workspaceID, driveFileID string, purpose DriveContentPurpose) (DriveContent, error)
}

// Errors ReadForAI returns (errors.Is). The caller maps them; B8 turns the access ones into an answer that says so,
// not an error (spec 9).
var (
	ErrDriveFileNotFound       = errors.New("drive file not found")  // not in workspace / not visible -> 404
	ErrDriveAccessRequired     = errors.New("drive_access_required") // requester has no granted access row
	ErrDriveGrantRequired      = errors.New("drive_grant_required")
	ErrDriveFileNotAccessible  = errors.New("drive_file_not_accessible")
	ErrDriveUnavailable        = errors.New("drive_unavailable")
	ErrDriveFormatUnsupported  = errors.New("drive_format_unsupported")
	ErrDriveExtractUnavailable = errors.New("drive_extract_unavailable")
)
