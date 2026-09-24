package files

import (
	"fmt"
	"strings"
)

// ReadMode is how a module gets bytes to the browser. The purpose policy picks
// it, not the caller: a presigned URL is the shortest path when the object is
// reachable and the tenant boundary can be carried by the signature, and the
// proxy is for private media that needs the permission check on every request
// (FS-C1 section 8).
type ReadMode string

const (
	ReadPresign ReadMode = "presign"
	ReadProxy   ReadMode = "proxy"
)

// ScopeShape is which tenant fields a purpose requires. A module builds Scope
// from an already authorized context, and ValidateScope refuses a missing
// required field instead of filling in a default.
type ScopeShape string

const (
	// ScopeUser is the account branch: UserID required, no tenant. Only
	// UserAvatar uses it.
	ScopeUser ScopeShape = "user"
	// ScopeOrg is tenant-wide: OrganizationID required, no workspace.
	ScopeOrg ScopeShape = "org"
	// ScopeOrgWorkspace is a workspace inside a tenant: both required.
	ScopeOrgWorkspace ScopeShape = "org_workspace"
	// ScopeOrgWorkspaceOptional is a tenant with an optional workspace, for
	// chat rooms that may or may not belong to one.
	ScopeOrgWorkspaceOptional ScopeShape = "org_workspace_optional"
)

// Policy is what the registry fixes for a purpose before a byte is read: the
// byte cap, the MIME allowlist the verified type must be in, whether a
// checksum is required, and how a module reads the file back. A module never
// passes a policy per call, so two callers cannot disagree about the same
// purpose.
type Policy struct {
	MaxBytes         int64
	MIMEAllowlist    []string
	ChecksumRequired bool
	ReadMode         ReadMode
}

// Allows reports whether a verified content type is in the allowlist.
// Parameters are ignored ("text/plain; charset=utf-8" matches "text/plain"),
// because the verified type carries the evidence, not the parameter list.
func (p Policy) Allows(contentType string) bool {
	ct := NormalizeContentType(contentType)
	if ct == "" {
		return false
	}
	for _, allowed := range p.MIMEAllowlist {
		if NormalizeContentType(allowed) == ct {
			return true
		}
	}
	return false
}

// NormalizeContentType lowercases a media type and drops its parameters. It is
// the one normalization the registry, the fake and the real FileService share,
// so "Image/PNG" and "image/png; charset=binary" are the same type everywhere.
func NormalizeContentType(contentType string) string {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return ct
}

// PurposeSpec is one registry row: what FileService must know about a purpose
// before it reads a byte, and what a module reads to learn how its files are
// served.
type PurposeSpec struct {
	Purpose UploadPurpose
	// Prefix is the purpose branch of the object key (FS-C1 section 6.2),
	// without the version, tenant, date and file segments.
	Prefix string
	Scope  ScopeShape
	Policy Policy
	// Disabled marks a purpose the enum declares but the registry refuses
	// until its policy and reference provider exist (FS-C1 section 5.6). The
	// fake enables every purpose; a module must not assume one is open.
	Disabled bool
}

// ValidateScope refuses a scope that does not match the shape this purpose
// requires. The caller authorized the context; a missing field or a tenant
// branch the purpose has none of is file_scope_invalid, never a silent
// default.
func (s PurposeSpec) ValidateScope(scope Scope) error {
	switch s.Scope {
	case ScopeUser:
		if scope.UserID == "" {
			return ScopeInvalid("user scope requires a user id")
		}
		if scope.OrganizationID != "" || scope.WorkspaceID != "" {
			return ScopeInvalid("user scope carries no organization or workspace")
		}
	case ScopeOrg:
		if scope.OrganizationID == "" {
			return ScopeInvalid("organization scope requires an organization id")
		}
		if scope.WorkspaceID != "" {
			return ScopeInvalid("organization scope carries no workspace")
		}
	case ScopeOrgWorkspace:
		if scope.OrganizationID == "" {
			return ScopeInvalid("workspace scope requires an organization id")
		}
		if scope.WorkspaceID == "" {
			return ScopeInvalid("workspace scope requires a workspace id")
		}
	case ScopeOrgWorkspaceOptional:
		if scope.OrganizationID == "" {
			return ScopeInvalid("organization scope requires an organization id")
		}
	default:
		return ScopeInvalid(fmt.Sprintf("purpose %q declares no scope shape", string(s.Purpose)))
	}
	return nil
}

// Image types a policy may accept. Kept as one list so the avatar, editor,
// chat and asset rows cannot drift apart.
var (
	imageMIMETypes = []string{"image/jpeg", "image/png", "image/gif", "image/webp"}
	// attachmentMIMETypes mirrors the allowlist the task attachment pipeline
	// published before FileService (server/internal/service/task_attachments.go).
	attachmentMIMETypes = []string{
		"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
		"application/pdf", "text/markdown", "text/plain",
		"application/msword",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.ms-excel",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.ms-powerpoint",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	}
	// chatFileMIMETypes mirrors supportedChatFileContentTypes in the chat
	// message pipeline.
	chatFileMIMETypes = []string{"image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "text/plain"}
	// recordingMIMETypes covers what LiveKit egress and the browser recorder
	// produce today (webm/ogg/mp4), for voice notes and call recordings.
	recordingMIMETypes = []string{"audio/webm", "video/webm", "audio/ogg", "video/ogg", "audio/mp4", "video/mp4"}
	// voiceMIMETypes is the browser voice-note set (4 MiB, T1 caps above).
	voiceMIMETypes = []string{"audio/webm", "audio/ogg", "audio/mp4"}
	// exportMIMETypes is what AuditExport writes today: NDJSON or CSV.
	exportMIMETypes = []string{"application/x-ndjson", "text/csv", "application/zip"}
	// documentMIMETypes is what a Document version may hold.
	documentMIMETypes = []string{
		"application/pdf", "text/plain", "text/markdown",
		"application/msword",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.ms-excel",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.ms-powerpoint",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		"image/jpeg", "image/png",
	}
)

// DefaultSpecs is the declared registry table (FS-C1 section 8): prefix, scope
// shape and policy per purpose. Caps follow what each pipeline publishes today
// (2 MiB avatar, 25 MiB attachment, 4 MiB voice, 100/25 MiB frontend/backend
// mismatch resolved by one policy). Document purposes are declared and
// disabled, because no reference provider holds their files yet.
func DefaultSpecs() []PurposeSpec {
	return []PurposeSpec{
		{
			Purpose: UserAvatar,
			Prefix:  "avatars",
			Scope:   ScopeUser,
			Policy:  Policy{MaxBytes: 2 << 20, MIMEAllowlist: imageMIMETypes, ReadMode: ReadPresign},
		},
		{
			Purpose: TaskAttachment,
			Prefix:  "tasks/attachments",
			Scope:   ScopeOrgWorkspace,
			Policy:  Policy{MaxBytes: 25 << 20, MIMEAllowlist: attachmentMIMETypes, ReadMode: ReadProxy},
		},
		{
			Purpose: TaskDescriptionImage,
			Prefix:  "tasks/description-images",
			Scope:   ScopeOrgWorkspace,
			Policy:  Policy{MaxBytes: 10 << 20, MIMEAllowlist: imageMIMETypes, ReadMode: ReadProxy},
		},
		{
			Purpose: TaskCommentAttachment,
			Prefix:  "tasks/comments",
			Scope:   ScopeOrgWorkspace,
			Policy:  Policy{MaxBytes: 25 << 20, MIMEAllowlist: attachmentMIMETypes, ReadMode: ReadProxy},
		},
		{
			Purpose: ChatAttachment,
			Prefix:  "chat/files",
			Scope:   ScopeOrgWorkspaceOptional,
			Policy:  Policy{MaxBytes: 25 << 20, MIMEAllowlist: chatFileMIMETypes, ReadMode: ReadProxy},
		},
		{
			Purpose: ChatVoice,
			Prefix:  "chat/voice",
			Scope:   ScopeOrgWorkspaceOptional,
			Policy:  Policy{MaxBytes: 4 << 20, MIMEAllowlist: voiceMIMETypes, ReadMode: ReadPresign},
		},
		{
			Purpose: ChatCallRecording,
			Prefix:  "chat/recordings",
			Scope:   ScopeOrgWorkspaceOptional,
			Policy:  Policy{MaxBytes: 2 << 30, MIMEAllowlist: recordingMIMETypes, ReadMode: ReadPresign},
		},
		{
			Purpose: MeetingRecording,
			Prefix:  "meetings/recordings",
			Scope:   ScopeOrgWorkspace,
			Policy:  Policy{MaxBytes: 8 << 30, MIMEAllowlist: recordingMIMETypes, ReadMode: ReadPresign},
		},
		{
			Purpose: AuditExport,
			Prefix:  "audit/exports",
			Scope:   ScopeOrg,
			Policy:  Policy{MaxBytes: 100 << 20, MIMEAllowlist: exportMIMETypes, ReadMode: ReadProxy},
		},
		{
			Purpose: DocumentFile,
			Prefix:  "documents/files",
			Scope:   ScopeOrgWorkspace,
			Policy:  Policy{MaxBytes: 50 << 20, MIMEAllowlist: documentMIMETypes, ChecksumRequired: true, ReadMode: ReadProxy},
			// DOC-004: a client never sees the path or storage key of a
			// document, and the bytes are verified against a checksum.
			Disabled: true,
		},
		{
			Purpose:  DocumentAsset,
			Prefix:   "documents/assets",
			Scope:    ScopeOrgWorkspace,
			Policy:   Policy{MaxBytes: 10 << 20, MIMEAllowlist: imageMIMETypes, ChecksumRequired: true, ReadMode: ReadProxy},
			Disabled: true,
		},
	}
}

// Registry is the purpose table. It is data, not behaviour: FileService, the
// fake and the contract suite all read the same rows.
type Registry struct {
	specs map[UploadPurpose]PurposeSpec
	order []UploadPurpose
}

// NewRegistry validates and indexes a spec table. It refuses the two mistakes
// that would otherwise reach production quietly: a prefix two purposes share
// (keys would collide) and a policy value outside its enum.
func NewRegistry(specs ...PurposeSpec) (Registry, error) {
	r := Registry{specs: make(map[UploadPurpose]PurposeSpec, len(specs)), order: make([]UploadPurpose, 0, len(specs))}
	seen := make(map[string]UploadPurpose, len(specs))
	for _, spec := range specs {
		if !spec.Purpose.Valid() {
			return Registry{}, fmt.Errorf("files: registry row %q is not a declared purpose", string(spec.Purpose))
		}
		if _, dup := r.specs[spec.Purpose]; dup {
			return Registry{}, fmt.Errorf("files: purpose %q is declared twice", string(spec.Purpose))
		}
		prefix := strings.TrimSpace(spec.Prefix)
		if prefix == "" || strings.HasPrefix(prefix, "/") || strings.HasSuffix(prefix, "/") {
			return Registry{}, fmt.Errorf("files: purpose %q has invalid prefix %q", string(spec.Purpose), spec.Prefix)
		}
		if other, dup := seen[prefix]; dup {
			return Registry{}, fmt.Errorf("files: purposes %q and %q share the prefix %q", string(other), string(spec.Purpose), prefix)
		}
		switch spec.Scope {
		case ScopeUser, ScopeOrg, ScopeOrgWorkspace, ScopeOrgWorkspaceOptional:
		default:
			return Registry{}, fmt.Errorf("files: purpose %q has unknown scope shape %q", string(spec.Purpose), string(spec.Scope))
		}
		if spec.Policy.MaxBytes <= 0 {
			return Registry{}, fmt.Errorf("files: purpose %q has no byte cap", string(spec.Purpose))
		}
		if len(spec.Policy.MIMEAllowlist) == 0 {
			return Registry{}, fmt.Errorf("files: purpose %q has an empty MIME allowlist", string(spec.Purpose))
		}
		for _, ct := range spec.Policy.MIMEAllowlist {
			if NormalizeContentType(ct) != ct || ct == "" {
				return Registry{}, fmt.Errorf("files: purpose %q has malformed MIME type %q", string(spec.Purpose), ct)
			}
		}
		switch spec.Policy.ReadMode {
		case ReadPresign, ReadProxy:
		default:
			return Registry{}, fmt.Errorf("files: purpose %q has unknown read mode %q", string(spec.Purpose), string(spec.Policy.ReadMode))
		}
		spec.Prefix = prefix
		r.specs[spec.Purpose] = spec
		r.order = append(r.order, spec.Purpose)
		seen[prefix] = spec.Purpose
	}
	return r, nil
}

// DefaultRegistry is the table the real FileService loads. It declares every
// purpose in the enum, with the Document rows disabled.
func DefaultRegistry() Registry {
	r, err := NewRegistry(DefaultSpecs()...)
	if err != nil {
		// DefaultSpecs is a literal table; TestDefaultRegistryIsValid keeps
		// this branch unreachable. Failing loudly beats serving a partial
		// registry that silently refuses uploads.
		panic("files: invalid default purpose registry: " + err.Error())
	}
	return r
}

// Lookup returns the row for a purpose. An empty, unknown or unmapped purpose
// is file_purpose_unknown; a declared but disabled one is
// file_purpose_disabled. Both are refused before any byte is read.
func (r Registry) Lookup(purpose UploadPurpose) (PurposeSpec, error) {
	spec, ok := r.specs[purpose]
	if !ok {
		return PurposeSpec{}, PurposeUnknown(purpose)
	}
	if spec.Disabled {
		return PurposeSpec{}, PurposeDisabled(purpose)
	}
	return spec, nil
}

// Specs returns every row in declaration order, so a caller or a report can
// list the registry deterministically.
func (r Registry) Specs() []PurposeSpec {
	out := make([]PurposeSpec, 0, len(r.order))
	for _, purpose := range r.order {
		out = append(out, r.specs[purpose])
	}
	return out
}

// Enabled reports whether a purpose is declared and open.
func (r Registry) Enabled(purpose UploadPurpose) bool {
	spec, ok := r.specs[purpose]
	return ok && !spec.Disabled
}
