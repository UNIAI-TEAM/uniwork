// Package files is the FileService contract every consuming module codes
// against (FS-C1 v1, docs/superpowers/specs/2026-09-24-file-service-contract.md).
//
// It holds types, enums, the purpose registry and the Service and
// ReferenceProvider interfaces - no implementation. internal/service holds the
// real FileService; filesfake is the in-memory double a module tests with and
// filescontract is the suite both must pass. The package is a leaf: it imports
// pkg/db (the module's own q.WithTx(tx) handle) and internal/audit (Actor) and
// nothing else from this repo, so importing it never pulls in the service or
// handler tier (server/internal/arch_test.go holds the rule).
package files

import "time"

// FileID is an opaque ULID. Business tables store it; nothing parses it.
type FileID string

// UploadPurpose selects key prefix, policy and the scope the caller must have
// authorized. A purpose is never guessed from a request body: the endpoint or
// the module picks it, and an empty, unknown or disabled value is refused
// before a byte is read.
type UploadPurpose string

// The purposes FS-C1 v1 declares. Documents and Office are declared here but
// stay disabled in DefaultRegistry until their policy and reference providers
// exist (FS-C1 section 5.6); nothing may assume a purpose is open.
const (
	UserAvatar            UploadPurpose = "user_avatar"
	TaskAttachment        UploadPurpose = "task_attachment"
	TaskDescriptionImage  UploadPurpose = "task_description_image"
	TaskCommentAttachment UploadPurpose = "task_comment_attachment"
	ChatAttachment        UploadPurpose = "chat_attachment"
	ChatVoice             UploadPurpose = "chat_voice"
	ChatCallRecording     UploadPurpose = "chat_call_recording"
	MeetingRecording      UploadPurpose = "meeting_recording"
	AuditExport           UploadPurpose = "audit_export"
	DocumentFile          UploadPurpose = "document_file"
	DocumentAsset         UploadPurpose = "document_asset"
)

// purposes is the enum in declaration order. The registry table is checked
// against it, so a new constant without a row fails a test instead of quietly
// becoming unreachable.
var purposes = []UploadPurpose{
	UserAvatar,
	TaskAttachment,
	TaskDescriptionImage,
	TaskCommentAttachment,
	ChatAttachment,
	ChatVoice,
	ChatCallRecording,
	MeetingRecording,
	AuditExport,
	DocumentFile,
	DocumentAsset,
}

// Purposes returns every declared purpose in declaration order. The slice is a
// copy: a caller cannot reorder the enum for everyone else.
func Purposes() []UploadPurpose {
	out := make([]UploadPurpose, len(purposes))
	copy(out, purposes)
	return out
}

// Valid reports whether p is one of the declared purposes. A string cast to
// UploadPurpose is not evidence of anything, so the registry validates at
// runtime; this only answers "is it in the enum".
func (p UploadPurpose) Valid() bool {
	for _, known := range purposes {
		if p == known {
			return true
		}
	}
	return false
}

// Scope is built by the calling module from an already authorized context,
// never from a request body. OrganizationID is empty only for UserAvatar: the
// account avatar is the one file a person owns outside a tenant, and it is
// reachable only through that purpose (T1-Q10).
type Scope struct {
	OrganizationID string
	WorkspaceID    string
	UserID         string
}

// Status is the file lifecycle: it says whether bytes and metadata are there,
// not whether a module references the file.
type Status string

const (
	StatusPending    Status = "pending"
	StatusProcessing Status = "processing"
	StatusReady      Status = "ready"
	StatusFailed     Status = "failed"
	StatusDeleting   Status = "deleting"
	StatusDeleted    Status = "deleted"
)

// SessionStatus is the upload session lifecycle: receiving -> staged ->
// claimed, with canceled and expired as terminal exits. A module never sees
// this value - a refused session reaches it as one of the codes in section 7 -
// but filesfake and the real FileService model the same machine, so the states
// live with the contract.
type SessionStatus string

const (
	SessionReceiving SessionStatus = "receiving"
	SessionStaged    SessionStatus = "staged"
	SessionClaimed   SessionStatus = "claimed"
	SessionCanceled  SessionStatus = "canceled"
	SessionExpired   SessionStatus = "expired"
)

// File is the technical view a module may show. It never carries the storage
// locator, credentials or session scope: the locator stays inside FileService
// so a module has nothing to persist by accident.
type File struct {
	ID             FileID
	OrganizationID string // "" only for account avatars
	Filename       string // sanitized at upload; the one shared name (T1-Q4)
	ContentType    string // verified from content, never the client's claim
	SizeBytes      int64
	ChecksumSHA256 string // "" unless the purpose policy requires it (T1-Q2)
	Status         Status
	Metadata       map[string]any // versioned technical attributes (T1-Q1)
	ReadyAt        time.Time
}
