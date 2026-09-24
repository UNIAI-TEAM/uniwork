// Package filesfake is the in-memory FileService a module tests against before
// the real one exists (FS-C1 Gate A0). It keeps every file and upload session in
// memory, models the same state machine and the same section 7 errors as the
// real service, and passes the shared filescontract suite.
//
// Two rules a module author has to know:
//
//   - Every purpose is enabled here. A module must not read that as evidence
//     that a purpose is open in production: the real registry keeps Document
//     purposes disabled until their policy and reference provider exist.
//   - The fake does not model the garbage collector's barrier. It will not
//     delete bytes behind a claim, so a test that needs to see file_deleting
//     calls SimulateGC with exactly the files the real collector would have
//     chosen.
package filesfake

import (
	"errors"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
)

// errStorageDown is the cause the fake reports with storage_unavailable.
var errStorageDown = errors.New("filesfake: storage adapter is down")

// errIdempotencyKeyRequired: FS-C1 section 4 lists IdempotencyKey as a required
// field, so an empty one is a caller bug and not a user-facing refusal. It has
// no section 7 code on purpose.
var errIdempotencyKeyRequired = errors.New("filesfake: UploadInput.IdempotencyKey is required")

// errBodyRequired: Upload streams a body; a nil reader is a caller bug.
var errBodyRequired = errors.New("filesfake: UploadInput.Body is required")

// errBodyUnreadable wraps a failure to read the upload stream. The client
// stopped sending, so nothing was staged and the same key may be retried.
var errBodyUnreadable = errors.New("filesfake: could not read the upload body")

// errEmptyClaim: ClaimInTx attaches files, so an empty list is a caller bug.
var errEmptyClaim = errors.New("filesfake: ClaimInput.FileIDs is empty")

// errOperationRequired: RegisterProviderOutput binds a file to a provider
// operation, so an empty id is a caller bug (a retry could not find its file).
var errOperationRequired = errors.New("filesfake: ProviderOutputInput.OperationID is required")

// errDeadlinePassed: a write target that expires in the past is a caller bug.
var errDeadlinePassed = errors.New("filesfake: ProviderOutputInput.Deadline is not in the future")

// errInvalidRange: Open takes non-negative offsets and lengths.
var errInvalidRange = errors.New("filesfake: OpenInput offset and length must not be negative")

// Options configures a Fake. The zero value is the normal test setup: every
// purpose enabled, the real clock, ULID ids.
type Options struct {
	// Clock is the clock every timestamp is stamped with. A test that wants to
	// cross the 24 hour claim window replaces it (or calls Advance) instead of
	// sleeping. Default: time.Now.
	Clock func() time.Time
	// Disabled flips purposes to disabled, so a test can exercise
	// file_purpose_disabled against a purpose the enum declares. Everything
	// else stays enabled.
	Disabled []files.UploadPurpose
	// NewID is the id source, for a test that wants readable ids. Default: a
	// fresh ULID.
	NewID func() string
}

// Fake is an in-memory files.Service. It is safe for concurrent use, so a
// module test may exercise parallel saves the way the real service sees them.
type Fake struct {
	mu       sync.Mutex
	now      func() time.Time
	newID    func() string
	registry files.Registry

	storageDown bool

	entries    map[files.FileID]*entry
	uploads    map[string]*uploadAttempt
	operations map[string]files.FileID
}

// entry is one file plus the session that put it there. The real service keeps
// the same fields in files, file_upload_sessions and the intent row.
type entry struct {
	file    files.File
	spec    files.PurposeSpec
	scope   files.Scope
	actor   audit.Actor
	session files.SessionStatus

	sessionID      string
	claimExpiresAt time.Time

	// referenced is whether a module holds the file. The fake never deletes a
	// referenced file on its own; SimulateGC is explicit.
	referenced bool

	// bytes are the object's contents, written by Upload or by
	// WriteProviderOutput. The real service keeps them in storage.
	bytes       []byte
	written     bool
	writtenType string

	operationID string
}

// uploadAttempt is one idempotency key: the command it was bound to and what
// that command returned.
type uploadAttempt struct {
	fingerprint string
	result      files.Upload
	failure     *files.Error
	// transient marks a failure that left nothing behind (the stream broke
	// before a session existed), so retrying the same key starts over instead
	// of replaying an error the user cannot change.
	transient bool
}

var _ files.Service = (*Fake)(nil)

// New builds a fake. Every purpose in the enum is enabled except the ones named
// in Options.Disabled.
func New(opts Options) *Fake {
	clock := opts.Clock
	if clock == nil {
		clock = time.Now
	}
	newID := opts.NewID
	if newID == nil {
		newID = func() string { return ulid.Make().String() }
	}

	specs := files.DefaultSpecs()
	for i := range specs {
		specs[i].Disabled = false
	}
	for _, purpose := range opts.Disabled {
		for i := range specs {
			if specs[i].Purpose == purpose {
				specs[i].Disabled = true
			}
		}
	}
	registry, err := files.NewRegistry(specs...)
	if err != nil {
		// The table is files.DefaultSpecs() with the disabled flag flipped;
		// TestNewUsesTheDeclaredPrefixes keeps this branch unreachable.
		panic("filesfake: invalid purpose table: " + err.Error())
	}

	return &Fake{
		now:        clock,
		newID:      newID,
		registry:   registry,
		entries:    map[files.FileID]*entry{},
		uploads:    map[string]*uploadAttempt{},
		operations: map[string]files.FileID{},
	}
}

// Registry returns the purpose table this fake validates against, so a test or
// the contract suite reads the same caps and allowlists the fake enforces.
func (f *Fake) Registry() files.Registry { return f.registry }

// Now is the fake's current time.
func (f *Fake) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.now()
}

// Advance moves the fake's clock. Nothing else changes: sessions keep the
// deadlines they were stamped with, which is what makes the 24 hour claim
// window testable without waiting.
func (f *Fake) Advance(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	base := f.now()
	f.now = func() time.Time { return base.Add(d) }
}

// SetStorageDown injects an adapter failure: every call that would touch
// storage answers storage_unavailable until it is cleared. State already
// recorded stays as it was, which is what lets a module test the retry path.
func (f *Fake) SetStorageDown(down bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.storageDown = down
}

// WriteProviderOutput stands in for the provider's PUT. A test that registered
// a provider output writes the bytes the provider would have written to
// WriteTarget.URL through this hook; the fake then treats them as the object
// CompleteProviderOutput will verify.
func (f *Fake) WriteProviderOutput(out files.ProviderOutput, body []byte, contentType string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	e, ok := f.entries[out.FileID]
	if !ok {
		return files.NotFound(out.FileID)
	}
	e.bytes = append([]byte(nil), body...)
	e.writtenType = files.NormalizeContentType(contentType)
	e.written = true
	e.file.Status = files.StatusProcessing
	return nil
}

// SimulateGC stands in for the collector's phase that commits deleting before
// it touches storage: it moves the named files to deleting so a module can see
// file_deleting. It returns how many files it moved.
//
// The fake deliberately does not model the barrier itself. It does not decide
// eligibility, does not consult references and does not delete bytes, so a
// test names exactly the files the real collector would have chosen.
func (f *Fake) SimulateGC(ids ...files.FileID) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	moved := 0
	for _, id := range ids {
		e, ok := f.entries[id]
		if !ok || e.file.Status == files.StatusDeleted {
			continue
		}
		e.file.Status = files.StatusDeleting
		moved++
	}
	return moved
}

// entryInScope returns an entry the caller is allowed to see: an id from
// another tenant, workspace or user answers file_not_found, exactly like an id
// that does not exist, so the answer never reveals that a file is there.
func (f *Fake) entryInScope(id files.FileID, scope files.Scope) (*entry, error) {
	e, ok := f.entries[id]
	if !ok || !scopeEqual(e.scope, scope) {
		return nil, files.NotFound(id)
	}
	return e, nil
}

func scopeEqual(a, b files.Scope) bool {
	return a.OrganizationID == b.OrganizationID && a.WorkspaceID == b.WorkspaceID && a.UserID == b.UserID
}

// commandFingerprint is what an idempotency key is bound to: the same key with
// a different actor, scope, purpose or filename is a different command
// (T1-Q8), and the second one is a conflict, not a replay.
func commandFingerprint(in files.UploadInput) string {
	return string(in.Purpose) + "\x00" + in.Scope.OrganizationID + "\x00" + in.Scope.WorkspaceID + "\x00" +
		in.Scope.UserID + "\x00" + string(in.Actor.Kind) + "\x00" + in.Actor.ID + "\x00" + in.Filename
}

// Snapshot is a copy of the fake's whole state. A module's own command runs
// inside the transaction ClaimInTx is given, so a failure there must leave the
// files exactly as they were; the harness models that by taking a snapshot
// before the call and restoring it when the module's command fails.
//
// The real service gets the same guarantee from the database, which is why the
// contract suite can assert it for both.
type Snapshot struct {
	entries     map[files.FileID]entry
	uploads     map[string]uploadAttempt
	operations  map[string]files.FileID
	storageDown bool
}

// Snapshot copies the current state. The copy is deep enough that later writes
// through the fake cannot reach it.
func (f *Fake) Snapshot() Snapshot {
	f.mu.Lock()
	defer f.mu.Unlock()

	s := Snapshot{
		entries:     make(map[files.FileID]entry, len(f.entries)),
		uploads:     make(map[string]uploadAttempt, len(f.uploads)),
		operations:  make(map[string]files.FileID, len(f.operations)),
		storageDown: f.storageDown,
	}
	for id, e := range f.entries {
		copied := *e
		copied.bytes = append([]byte(nil), e.bytes...)
		s.entries[id] = copied
	}
	for key, attempt := range f.uploads {
		s.uploads[key] = *attempt
	}
	for operation, id := range f.operations {
		s.operations[operation] = id
	}
	return s
}

// Restore puts a snapshot back, replacing everything the fake holds now.
func (f *Fake) Restore(s Snapshot) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.entries = make(map[files.FileID]*entry, len(s.entries))
	for id, e := range s.entries {
		copied := e
		copied.bytes = append([]byte(nil), e.bytes...)
		f.entries[id] = &copied
	}
	f.uploads = make(map[string]*uploadAttempt, len(s.uploads))
	for key, attempt := range s.uploads {
		copied := attempt
		f.uploads[key] = &copied
	}
	f.operations = make(map[string]files.FileID, len(s.operations))
	for operation, id := range s.operations {
		f.operations[operation] = id
	}
	f.storageDown = s.storageDown
}
