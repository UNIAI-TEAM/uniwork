package files

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	// ClaimTTL is how long an uploaded file waits for a module to reference it
	// (T1-Q5): 24 hours from ready/staged. After that, claim and a fresh URL
	// through the session are refused even if no worker has run yet; a claimed
	// file no longer carries this deadline.
	ClaimTTL = 24 * time.Hour

	// MaxResolveURLTTL is the longest a presigned read URL may live (T1-Q7).
	// A credential or grant that expires sooner wins.
	MaxResolveURLTTL = 12 * time.Hour
)

// ErrModeMismatch: ResolveInput.Mode must be the mode the purpose policy
// declares (FS-C1 section 4). A caller that asks for the other mode has a bug,
// not a user error, so this is deliberately not one of the section 7 codes and
// has no HTTP mapping - it must be fixed in the module, not shown to a client.
var ErrModeMismatch = errors.New("files: resolve mode does not match the purpose policy")

// ErrOutputVerification: the object a provider wrote does not match what the
// provider reported - a checksum that disagrees with the bytes. Like
// ErrModeMismatch this is not a section 7 code: it is an operator problem to
// reconcile (the provider's job is marked failed and retried), not a client
// error, so it has no HTTP mapping. Size and MIME failures keep their own
// codes, file_too_large and file_type_rejected.
var ErrOutputVerification = errors.New("files: provider output does not match the reported checksum")

// Service is the whole FileService contract (FS-C1 section 4). internal/service
// holds the real implementation; filesfake holds the in-memory one modules
// test against. A module keeps a field of this interface type, never a concrete
// struct, so a test can plant the fake.
type Service interface {
	// Upload streams one logical upload. The same IdempotencyKey with the same
	// command returns the earlier result and never re-reads the body; the same
	// key with a different command is idempotency_conflict.
	Upload(ctx context.Context, in UploadInput) (Upload, error)

	// CancelUpload revokes an unclaimed staged upload. A claimed file is
	// already_claimed: dropping it is the module's own unlink command.
	CancelUpload(ctx context.Context, in CancelInput) error

	// ClaimInTx attaches staged or reusable files inside the module's own
	// transaction. q is the module's q.WithTx(tx), so a rollback leaves the
	// files staged for the user to try again. Files are locked in increasing id
	// order before the module locks its own rows.
	ClaimInTx(ctx context.Context, q *db.Queries, in ClaimInput) ([]File, error)

	// ReleaseInTx tells FileService the module removed its references, in the
	// same transaction as the removal. Bytes go only when the garbage
	// collector has re-checked every provider.
	ReleaseInTx(ctx context.Context, q *db.Queries, ids []FileID) error

	// ResolveMany returns views for files the module already authorized.
	// Presign mode fills URL and URLExpiresAt; proxy mode leaves URL empty and
	// the module serves its own authorized route through Open. Errors are per
	// id, so one refused file does not hide the others.
	ResolveMany(ctx context.Context, in ResolveInput) ([]Resolved, error)

	// Open streams bytes for a module proxy route (HEAD and Range supported by
	// the caller through Offset and Length).
	Open(ctx context.Context, in OpenInput) (Reader, error)

	// RegisterProviderOutput records intent and file id before an external
	// writer (LiveKit egress, Office engine) starts, and returns a write target
	// scoped to exactly that object and deadline.
	RegisterProviderOutput(ctx context.Context, in ProviderOutputInput) (ProviderOutput, error)

	// CompleteProviderOutput verifies the object (stat, size, MIME, and the
	// checksum when the policy requires one) and marks it ready and staged for
	// ClaimInTx.
	CompleteProviderOutput(ctx context.Context, in CompleteOutputInput) (File, error)
}

// UploadInput is one logical upload. It carries no content type and no size: a
// client's Content-Type, filename extension and Content-Length are not
// evidence, and the caps and allowlists live in the purpose registry.
type UploadInput struct {
	Actor          audit.Actor
	Purpose        UploadPurpose
	Scope          Scope
	IdempotencyKey string
	Filename       string
	Body           io.Reader
}

// Upload is what a successful upload returns. ClaimExpiresAt is the 24 hour
// claim window (T1-Q5); replaying the upload does not extend it.
type Upload struct {
	File            File
	UploadSessionID string
	ClaimExpiresAt  time.Time
}

// CancelInput revokes one staged upload. The module has already authorized the
// actor, and the file must still be in that actor's scope.
type CancelInput struct {
	Actor  audit.Actor
	Scope  Scope
	FileID FileID
}

// ClaimInput attaches files to a business object inside the module's
// transaction. Replaces carries the files the same command supersedes, so
// ClaimInTx can lock old and new rows in one order and the collector can never
// collect a file that is being swapped out.
type ClaimInput struct {
	Actor    audit.Actor
	Purpose  UploadPurpose
	Scope    Scope
	FileIDs  []FileID
	Replaces []FileID
}

// Disposition is what the browser should do with the bytes.
type Disposition string

const (
	DispositionInline     Disposition = "inline"
	DispositionAttachment Disposition = "attachment"
)

// ResolveInput asks for read access to files the module has authorized. Mode
// must be the mode the purpose policy declares; Disposition only shapes the
// signature or the proxy response headers.
type ResolveInput struct {
	Scope       Scope
	Mode        ReadMode
	Disposition Disposition
	FileIDs     []FileID
}

// Resolved is one entry of a batch resolve. Err is per id: a file that is out
// of scope, not ready, being deleted or already deleted is refused in its own
// entry while the other ids still resolve. URL is empty in proxy mode, where
// the module serves its own authorized route through Open.
type Resolved struct {
	File         File
	URL          string
	URLExpiresAt time.Time
	Err          error
}

// OpenInput streams one file through a module proxy route. Offset is the first
// byte to send and Length is how many; Length 0 means "to the end", which is
// also what a HEAD request needs.
type OpenInput struct {
	Scope  Scope
	FileID FileID
	Offset int64
	Length int64
}

// Reader is the proxy read path: the verified file view plus the bytes. The
// caller owns Close, so a proxy handler that returns early still releases the
// stream.
type Reader struct {
	File File
	Body io.ReadCloser
}

// Close releases the stream.
func (r Reader) Close() error {
	if r.Body == nil {
		return nil
	}
	return r.Body.Close()
}

// ProviderOutputInput reserves a file id and a write target for an external
// writer. OperationID is the provider's own id (an egress id, an Office job
// id), so a retry or a webhook replay finds the same file instead of a second
// one.
type ProviderOutputInput struct {
	Actor       audit.Actor
	Purpose     UploadPurpose
	Scope       Scope
	OperationID string
	Deadline    time.Time
}

// ProviderOutput is what the provider needs: the id to report back and the
// target to write to. It carries no storage key and no credential beyond the
// signature inside WriteTarget.URL.
type ProviderOutput struct {
	FileID      FileID
	WriteTarget WriteTarget
}

// WriteTarget is a request the provider may make exactly once: PUT URL to that
// object, valid until ExpiresAt, with Headers sent verbatim (a signature over
// the content type fails if the caller drops them).
type WriteTarget struct {
	URL       string
	Method    string
	Headers   map[string]string
	ExpiresAt time.Time
}

// CompleteOutputInput reports that the provider has finished writing.
// ChecksumSHA256 is what the provider says it wrote, when it can compute one;
// the object itself is always verified.
type CompleteOutputInput struct {
	Actor          audit.Actor
	Scope          Scope
	FileID         FileID
	OperationID    string
	ChecksumSHA256 string
}

// HoldReason is why a reference provider still holds a file. It must be the
// strongest reason that applies: any hold stops the collector for that batch.
type HoldReason string

const (
	// HoldActive: business rows point at the file right now.
	HoldActive HoldReason = "active"
	// HoldVersionHistory: an old version still restores to this file.
	HoldVersionHistory HoldReason = "version_history"
	// HoldSoftDeleted: the object is soft deleted and restorable.
	HoldSoftDeleted HoldReason = "soft_deleted"
	// HoldRetention: the module keeps the file for its retention window.
	HoldRetention HoldReason = "retention"
	// HoldLegalHold: a hold outside the module's policy forbids deletion.
	HoldLegalHold HoldReason = "legal_hold"
)

// ReferenceProvider is how a module tells FileService which files it still
// holds (FS-C1 section 6). Every column or table that stores a file id needs
// one before its purpose may be enabled in the real registry, because without
// it the collector cannot tell a garbage file from one a user can still see.
//
// HeldBy must see soft-deleted rows, old versions and retention holds, and it
// runs on the caller's transaction so it observes work that has just
// committed. A provider error stops the whole batch: fail closed, keep the
// file.
type ReferenceProvider interface {
	// Name is a stable identifier, e.g. "documents.versions".
	Name() string
	// Purposes are the purposes whose files this provider can hold.
	Purposes() []UploadPurpose
	// HeldBy returns every requested id still held, with the strongest reason.
	HeldBy(ctx context.Context, q *db.Queries, ids []FileID) (map[FileID]HoldReason, error)
}
