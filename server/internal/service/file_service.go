package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// FileService is the real files.Service (FS-C1 v1). T3 owns this constructor
// and the upload, cancel, claim and provider-output pipeline; T4 adds the
// resolve/proxy API on top of the minimal read path in file_resolve_min.go and
// T5 the workers that drain the jobs this pipeline enqueues. Neither changes
// the struct or NewFileService: they get their dependencies from the fields
// here.
//
// Three rules shape every method:
//
//   - The intent (file row, session, job) is written before a byte reaches
//     storage, and no transaction is held open while a body streams.
//   - Every instant comes from the service clock, never the database's, so the
//     24 hour claim window (T1-Q5) is testable without sleeping.
//   - A refusal never says whether an id exists outside the caller's scope:
//     another tenant, workspace, user or actor is file_not_found.
type FileService struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	registry files.Registry
	store    storage.ObjectStore
	backend  storage.Backend
	bucket   string
	signer   FileObjectSigner
	quota    FileQuotaHook
	clock    func() time.Time
	newID    func() string
	spoolDir string
	lease    time.Duration

	// T5: the reference registry the collector asks, its configuration, and
	// test seams for the collector's barriers (nil in production).
	refs    *fileReferenceRegistry
	gc      FileGCConfig
	gcHooks fileGCHooks
}

var _ files.Service = (*FileService)(nil)

// FileQuotaHook is the reservation seam for a module that turns quota on. It
// is called once per new file, before its bytes are stored, only for
// organization files: an account avatar (NULL tenant) never counts against
// the organization that happens to be open (T1-Q9/T1-Q10). The file id is the
// idempotency key of the reservation, and a later claim or reuse of the same
// file never reserves again. Nil means no quota, which is today's default.
type FileQuotaHook interface {
	ReserveFileBytes(ctx context.Context, organizationID string, fileID files.FileID, sizeBytes int64) error
}

// FileServiceOptions wires a FileService. Pool, Storage and Backend are
// required; everything else has a production default.
type FileServiceOptions struct {
	Pool *pgxpool.Pool
	// Store is the T2 adapter new files are written to; its Backend is the
	// locator code every new row records. Bucket is the adapter's configured
	// bucket (required for s3/minio, empty for local): the locator carries it
	// and the adapter refuses any other.
	Store  storage.ObjectStore
	Bucket string
	// Registry is the purpose table. Nil loads files.DefaultRegistry.
	Registry *files.Registry
	// Signer overrides the store's own URL signing; nil uses the store.
	Signer FileObjectSigner
	Quota  FileQuotaHook
	// Clock stamps ready_at, the claim window and the write lease. Default:
	// time.Now. Instants are cut to microseconds, the database's precision,
	// so a replayed result is equal to the first one.
	Clock func() time.Time
	// NewID mints file, session and job ids. Default: util.NewID.
	NewID func() string
	// SpoolDir holds the temporary copy of an upload while it is validated.
	// Default: the system temp directory.
	SpoolDir string
	// WriteLease is how long an upload writer owns its session before a retry
	// of the same key may take over. Default: 15 minutes.
	WriteLease time.Duration
	// ReferenceProviders are every module's FS-C1 section 6 providers,
	// assembled by the composition root. The collector asks all of them
	// before it deletes a file; a catalogue column without its provider
	// keeps the collector from deleting anything (T5).
	ReferenceProviders []files.ReferenceProvider
	// GC configures the daily collector. The zero value is dry-run: it
	// reports and never deletes (Gate C).
	GC FileGCConfig
}

// NewFileService validates the wiring. A missing pool or adapter is a startup
// error, not a request-time nil dereference.
func NewFileService(opts FileServiceOptions) (*FileService, error) {
	if opts.Pool == nil {
		return nil, errors.New("files: FileService needs a database pool")
	}
	if opts.Store == nil || isNilInterface(opts.Store) {
		return nil, errors.New("files: FileService needs a storage adapter")
	}
	backend := opts.Store.Backend()
	if !backend.Valid() {
		return nil, fmt.Errorf("files: unknown storage backend %q", string(backend))
	}
	bucket := strings.TrimSpace(opts.Bucket)
	if backend == storage.BackendLocal && bucket != "" {
		return nil, errors.New("files: local storage has no bucket")
	}
	if backend != storage.BackendLocal && bucket == "" {
		return nil, fmt.Errorf("files: %s storage needs a bucket", string(backend))
	}
	registry := files.DefaultRegistry()
	if opts.Registry != nil {
		registry = *opts.Registry
	}
	clock := opts.Clock
	if clock == nil {
		clock = time.Now
	}
	newID := opts.NewID
	if newID == nil {
		newID = util.NewID
	}
	lease := opts.WriteLease
	if lease <= 0 {
		lease = 15 * time.Minute
	}
	var signer FileObjectSigner = opts.Store
	if opts.Signer != nil && !isNilInterface(opts.Signer) {
		signer = opts.Signer
	}
	var quota FileQuotaHook
	if opts.Quota != nil && !isNilInterface(opts.Quota) {
		quota = opts.Quota
	}
	refs, err := newFileReferenceRegistry(opts.ReferenceProviders, managedFileReferenceSources())
	if err != nil {
		return nil, err
	}
	gc, err := opts.GC.normalized()
	if err != nil {
		return nil, err
	}
	return &FileService{
		refs:     refs,
		gc:       gc,
		pool:     opts.Pool,
		q:        db.New(opts.Pool),
		registry: registry,
		store:    opts.Store,
		backend:  backend,
		bucket:   bucket,
		signer:   signer,
		quota:    quota,
		clock:    clock,
		newID:    newID,
		spoolDir: opts.SpoolDir,
		lease:    lease,
	}, nil
}

// Registry is the purpose table this service enforces, so a module and the
// contract suite read the same caps and modes.
func (s *FileService) Registry() files.Registry { return s.registry }

// Caller bugs. FS-C1 lists these fields as required, so an empty one is not a
// section 7 refusal and has no HTTP mapping (filesfake answers the same way).
var (
	errFileIdempotencyKeyRequired = errors.New("files: UploadInput.IdempotencyKey is required")
	errFileBodyRequired           = errors.New("files: UploadInput.Body is required")
	errFileBodyUnreadable         = errors.New("files: could not read the upload body")
	errFileActorRequired          = errors.New("files: an actor with a kind and an id is required")
	errFileEmptyClaim             = errors.New("files: ClaimInput.FileIDs is empty")
	errFileOperationRequired      = errors.New("files: ProviderOutputInput.OperationID is required")
	errFileDeadlinePassed         = errors.New("files: ProviderOutputInput.Deadline is not in the future")
	errFileInvalidRange           = errors.New("files: OpenInput offset and length must not be negative")
)

// now is the service clock at the database's precision.
func (s *FileService) now() time.Time {
	return s.clock().UTC().Truncate(time.Microsecond)
}

// inTx runs fn in a transaction of the service's own pool.
func (s *FileService) inTx(ctx context.Context, fn func(q *db.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("files: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(s.q.WithTx(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("files: commit: %w", err)
	}
	return nil
}

func validActor(a audit.Actor) bool {
	switch a.Kind {
	case audit.KindHuman, audit.KindAgent, audit.KindSystem:
		return strings.TrimSpace(a.ID) != ""
	default:
		return false
	}
}

// mintObjectKey is the key layout of spec section 6.2, plus the purpose's
// ObjectKeySuffix. The segments come from an authorized scope and a server id;
// anything that could leave its segment is refused as an invalid scope rather
// than cleaned up.
func mintObjectKey(spec files.PurposeSpec, scope files.Scope, id files.FileID, at time.Time) (string, error) {
	for _, seg := range []string{scope.OrganizationID, scope.WorkspaceID, scope.UserID, string(id)} {
		if seg != "" && !safeKeySegment(seg) {
			return "", files.ScopeInvalid("scope ids must be opaque path-safe ids")
		}
	}
	tail := spec.Prefix + "/" + at.UTC().Format("2006/01") + "/" + string(id) + "/original" + spec.Policy.ObjectKeySuffix
	switch {
	case scope.OrganizationID == "":
		return storage.FileServiceKeyPrefix + "users/" + scope.UserID + "/" + tail, nil
	case scope.WorkspaceID != "":
		return storage.FileServiceKeyPrefix + "orgs/" + scope.OrganizationID + "/workspaces/" + scope.WorkspaceID + "/" + tail, nil
	default:
		return storage.FileServiceKeyPrefix + "orgs/" + scope.OrganizationID + "/" + tail, nil
	}
}

func safeKeySegment(seg string) bool {
	if seg == "." || seg == ".." {
		return false
	}
	for _, r := range seg {
		if r == '/' || r == '\\' || r < 0x21 || r == 0x7f {
			return false
		}
	}
	return true
}

// sessionScope is the authorized scope a session was opened under.
func sessionScope(row db.FileUploadSession) files.Scope {
	return files.Scope{
		OrganizationID: row.OrganizationID.String,
		WorkspaceID:    row.WorkspaceID.String,
		UserID:         row.UserID.String,
	}
}

// fileView is the technical view a module may show: never the locator.
func fileView(row db.File) files.File {
	out := files.File{
		ID:             files.FileID(row.ID),
		OrganizationID: row.OrganizationID.String,
		Filename:       row.OriginalFilename,
		ContentType:    row.ContentType.String,
		SizeBytes:      row.SizeBytes.Int64,
		ChecksumSHA256: row.ChecksumSha256.String,
		Status:         files.Status(row.Status),
	}
	if row.ReadyAt.Valid {
		out.ReadyAt = row.ReadyAt.Time
	}
	if len(row.Metadata) > 0 {
		var md map[string]any
		if err := json.Unmarshal(row.Metadata, &md); err == nil && len(md) > 0 {
			out.Metadata = md
		}
	}
	return out
}

// fileRecord is a file row and the session that staged it, loaded for one
// caller scope.
type fileRecord struct {
	file    db.File
	session db.FileUploadSession
}

// loadInScope reads the files and sessions behind ids for one scope, through
// the tenant-filtered queries (the avatar branch through its user-bound ones).
// An id missing from the result is file_not_found for that caller, whether it
// does not exist or belongs to someone else.
func (s *FileService) loadInScope(ctx context.Context, q *db.Queries, scope files.Scope, ids []files.FileID) (map[files.FileID]fileRecord, error) {
	want := make([]string, 0, len(ids))
	for _, id := range ids {
		want = append(want, string(id))
	}
	var rows []db.File
	switch {
	case scope.OrganizationID != "":
		var err error
		if rows, err = q.ListOrgFilesByIDs(ctx, db.ListOrgFilesByIDsParams{OrganizationID: fileText(scope.OrganizationID), FileIds: want}); err != nil {
			return nil, fmt.Errorf("files: load: %w", err)
		}
	case scope.UserID != "":
		for _, id := range want {
			row, err := q.GetAvatarFileForUser(ctx, db.GetAvatarFileForUserParams{ID: id, UserID: fileText(scope.UserID)})
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if err != nil {
				return nil, fmt.Errorf("files: load avatar: %w", err)
			}
			rows = append(rows, row)
		}
	}
	out := make(map[files.FileID]fileRecord, len(rows))
	for _, row := range rows {
		// The tenant is already proven by the file query; the session adds
		// the workspace/user half of the scope and the grant.
		sess, err := q.GetUploadSessionByFile(ctx, row.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("files: load session: %w", err)
		}
		if sessionScope(sess) != scope {
			continue
		}
		out[files.FileID(row.ID)] = fileRecord{file: row, session: sess}
	}
	return out, nil
}

// lockForClaim takes the lock-contract order (files by id, then their
// sessions) inside the caller's transaction. The caller checks each row
// against its scope; rows outside it stay locked until the transaction
// ends and are answered file_not_found.
func lockForClaim(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]db.File, map[files.FileID]db.FileUploadSession, error) {
	want := make([]string, 0, len(ids))
	for _, id := range ids {
		want = append(want, string(id))
	}
	sort.Strings(want)
	rows, err := q.LockFilesInIDOrder(ctx, want)
	if err != nil {
		return nil, nil, fmt.Errorf("files: lock files: %w", err)
	}
	sessions, err := q.LockUploadSessionsByFileIDs(ctx, want)
	if err != nil {
		return nil, nil, fmt.Errorf("files: lock sessions: %w", err)
	}
	fileByID := make(map[files.FileID]db.File, len(rows))
	for _, row := range rows {
		fileByID[files.FileID(row.ID)] = row
	}
	sessByFile := make(map[files.FileID]db.FileUploadSession, len(sessions))
	for _, sess := range sessions {
		sessByFile[files.FileID(sess.FileID)] = sess
	}
	return fileByID, sessByFile, nil
}

// inScope reports whether a locked file and its session belong to scope: the
// tenant on the file and the full scope on the session must both match.
func inScope(file db.File, sess db.FileUploadSession, ok bool, scope files.Scope) bool {
	return ok && file.OrganizationID.String == scope.OrganizationID && sessionScope(sess) == scope
}

// sessionGrant is the one rule for an unclaimed file (T1-Q5): a canceled
// session is refused and the 24 hour window is measured from ready/staged. A
// claimed session is past the window for good.
func sessionGrant(sess db.FileUploadSession, now time.Time) error {
	id := files.FileID(sess.FileID)
	switch files.SessionStatus(sess.Status) {
	case files.SessionClaimed:
		return nil
	case files.SessionCanceled:
		return files.UploadCanceled(id)
	case files.SessionExpired:
		return files.ClaimExpired(id)
	case files.SessionStaged:
		if !sess.ClaimExpiresAt.Valid || !now.Before(sess.ClaimExpiresAt.Time) {
			return files.ClaimExpired(id)
		}
		return nil
	default:
		return files.NotReady(id)
	}
}

// fileState refuses a file that cannot be served or attached.
func fileState(file db.File) error {
	id := files.FileID(file.ID)
	switch files.Status(file.Status) {
	case files.StatusReady:
		return nil
	case files.StatusDeleting:
		return files.Deleting(id)
	case files.StatusDeleted:
		return files.NotFound(id)
	default:
		return files.NotReady(id)
	}
}

// enqueueJob queues durable work for a file. uidx_file_jobs_live dedupes, so a
// second cleanup for the same file is a no-op.
func (s *FileService) enqueueJob(ctx context.Context, q *db.Queries, file db.File, operation string, at time.Time) error {
	if err := q.EnqueueFileJob(ctx, db.EnqueueFileJobParams{
		ID:             s.newID(),
		FileID:         file.ID,
		OrganizationID: file.OrganizationID,
		Operation:      operation,
		NextAttemptAt:  fileTime(at),
		Details:        []byte("{}"),
	}); err != nil {
		return fmt.Errorf("files: enqueue %s: %w", operation, err)
	}
	return nil
}

// Job operations of file_jobs_operation_check.
const (
	fileJobCleanup   = "cleanup"
	fileJobReconcile = "reconcile"
)

// --- storage access ---------------------------------------------------------

// FileObjectSigner is the part of storage.ObjectStore that mints presigned
// URLs. It is its own option only so a host whose adapter cannot sign (the
// local filesystem) may plug a signer in front of it - tests do, to drive the
// presign and provider paths on local. Without one the store signs, and a
// store without the capability answers storage_unavailable for that call
// (Advisor ruling D3), never a fake URL.
type FileObjectSigner interface {
	SignRead(ctx context.Context, loc storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error)
	SignWrite(ctx context.Context, loc storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error)
}

// locator is where a file row's bytes live, exactly as the row records them.
func locator(file db.File) storage.ObjectLocator {
	return storage.ObjectLocator{
		Storage: storage.Backend(file.Storage),
		Bucket:  file.Bucket.String,
		Key:     file.ObjectKey,
		Version: file.ObjectVersion.String,
	}
}

// readObjectHead returns the first DetectHeadBytes of an object.
func (s *FileService) readObjectHead(ctx context.Context, loc storage.ObjectLocator) ([]byte, error) {
	obj, err := s.store.Open(ctx, loc, storage.ReadOptions{Offset: 0, Length: files.DetectHeadBytes})
	if err != nil {
		return nil, err
	}
	defer obj.Body.Close()
	return io.ReadAll(obj.Body)
}

// hashObject reads a whole object for its SHA-256. Only a purpose that
// requires a checksum, or a provider that reported one, pays for this read
// (T1-Q2).
func (s *FileService) hashObject(ctx context.Context, loc storage.ObjectLocator) (string, error) {
	obj, err := s.store.Open(ctx, loc, storage.ReadOptions{})
	if err != nil {
		return "", err
	}
	defer obj.Body.Close()
	h := sha256.New()
	if _, err := io.Copy(h, obj.Body); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// --- small conversions --------------------------------------------------------

func fileText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func fileTime(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func isNilInterface(v any) bool {
	value := reflect.ValueOf(v)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Ptr, reflect.Slice:
		return value.IsNil()
	default:
		return false
	}
}

func uniqueFileIDs(ids []files.FileID) []files.FileID {
	seen := make(map[files.FileID]bool, len(ids))
	out := make([]files.FileID, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}
