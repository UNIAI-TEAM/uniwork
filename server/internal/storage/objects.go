package storage

import (
	"context"
	"errors"
	"io"
	"strings"
	"time"
)

// This file is the locator-based object contract (spec §3 sketch): the API
// FileService (T3+) drives. It lives beside the legacy Storage interface -
// not in a second package - because spec §2 forbids a parallel storage
// abstraction. Every operation takes an ObjectLocator, so reads, resolves,
// reconciles and deletes always follow the locator a row already carries and
// never the STORAGE_BACKEND selector (spec §3.1).

// ObjectLocator addresses one stored object. A files row persists the
// Storage/Bucket/Key/Version quadruple; the storage code selects the adapter
// and the rest selects the object inside it.
type ObjectLocator struct {
	// Storage is the provider code of the adapter that owns the object
	// (local, s3, minio) - the same value the files.storage column stores.
	Storage Backend
	// Bucket is the S3/MinIO bucket; empty for local, the only backend
	// without one.
	Bucket string
	// Key is the complete object key, including any prefix segments. Adapters
	// never rewrite it (no keyPrefix prepend, no traversal collapse).
	Key string
	// Version is the object_version of the write that produced the bytes. It
	// is empty on backends without versioning; on a versioned bucket Delete
	// requires it, because an unversioned DeleteObject there only plants a
	// delete marker and the bytes survive (spec §9.4).
	Version string
}

// WriteInfo is what Put needs beside the body.
type WriteInfo struct {
	// ContentType is the already-verified MIME type. Storage never sniffs or
	// trusts a client header; an empty value stores no type.
	ContentType string
	// SizeBytes is the declared stream length, or negative when the length is
	// not known up front. A declared length is verified against the bytes that
	// arrive: a mismatch fails the Put and stores nothing. AWS S3 cannot take
	// a chunked body, so the s3 adapter rejects a negative length - stream to
	// minio or measure first when the destination is real AWS.
	SizeBytes int64
	// Filename is the original (already sanitized) name; the adapter turns it
	// into Content-Disposition so a presigned download names it correctly.
	Filename string
}

// PutResult is what a successful Put learned about the stored object.
type PutResult struct {
	// SizeBytes is the number of bytes actually stored, counted during the
	// write - the truth when WriteInfo.SizeBytes was negative.
	SizeBytes int64
	// VersionID is the object_version to persist on the files row. Empty on
	// backends without versioning; always set on a versioned bucket.
	VersionID string
}

// ReadOptions bounds an Open. Offset is the first byte to return; Length is
// how many, with <= 0 meaning "to the end of the object" - the shape HEAD and
// full reads need.
type ReadOptions struct {
	Offset int64
	Length int64
}

// Object is an opened object: the metadata a proxy route needs for headers
// plus the body stream. Info always describes the whole object, so a ranged
// read still reports the full SizeBytes (from Content-Range). The caller owns
// Body.Close.
type Object struct {
	Info ObjectInfo
	Body io.ReadCloser
}

// ObjectInfo describes a stored object without opening its body.
type ObjectInfo struct {
	SizeBytes   int64
	ContentType string
	// VersionID echoes the object_version of the stored write when the
	// backend versions; it lets a caller confirm the locator still names the
	// same bytes.
	VersionID string
	// RangeStart/RangeEnd delimit the window actually returned for a ranged
	// Open (inclusive end); both are -1 on a full read or a Stat.
	RangeStart int64
	RangeEnd   int64
}

// SignOptions shapes a presigned read.
type SignOptions struct {
	// TTL is how long the URL stays valid; must be positive. The 12 hour
	// business cap (files.MaxResolveURLTTL, T1-Q7) is enforced by the caller,
	// not the adapter.
	TTL time.Duration
	// Disposition, when set, is the response-content-disposition the URL
	// makes the storage emit - attachment for downloads, inline for previews.
	Disposition string
}

// SignedURL is one presigned URL. URL carries the signature; it must never be
// written to a log or an error string. Method is the HTTP verb the URL is
// valid for (GET for SignRead, PUT for SignWrite).
type SignedURL struct {
	URL    string
	Method string
	// Headers must be sent on the presigned request (SigV4 signed header list).
	Headers   map[string]string
	ExpiresAt time.Time
}

// Capabilities is what a built adapter can do. A flow that needs a capability
// the adapter lacks fails before upload, never halfway (spec §3.3.2).
type Capabilities struct {
	// Presign: SignRead produces a URL a browser can GET without credentials.
	// The local filesystem adapter cannot mint one (files are served by the
	// API's own authorized route), so presign-only purposes must not run on
	// local.
	Presign bool
	// Range: Open honors ReadOptions.Offset/Length.
	Range bool
	// VersionedObjects: the bucket was detected versioned at preflight. Put
	// fills PutResult.VersionID and Delete requires a locator that carries
	// Version, so a cleanup deletes the recorded bytes instead of planting a
	// delete marker.
	VersionedObjects bool
}

// ObjectStore is the contract FileService drives. Implementations are the
// adapter types in this package (localObjectStore, s3ObjectStore - separate
// from the legacy structs because Go forbids two Delete signatures on one
// type); the legacy Storage interface beside it serves pre-FileService
// consumers until they migrate (see storage.go for the manifest).
type ObjectStore interface {
	// Backend is the selector code this adapter serves - the value a locator
	// must carry in Storage.
	Backend() Backend
	// Capabilities reports what this adapter supports (spec §3.3.2).
	Capabilities() Capabilities
	// Put streams the body to the object the locator names. It honors ctx for
	// stream cancel and timeout, verifies a declared WriteInfo.SizeBytes, and
	// stores nothing partial: a failed or canceled Put leaves no object
	// behind. A Put on a locator this adapter does not own (wrong backend,
	// wrong bucket, escaping key) is ErrLocatorInvalid and does no I/O.
	Put(ctx context.Context, loc ObjectLocator, body io.Reader, info WriteInfo) (PutResult, error)
	// Open returns the object body, bounded by opts.Range when set.
	// A missing object is ErrNotFound. A requested range that cannot be
	// satisfied (Offset at or past the end) is ErrRangeNotSatisfiable on
	// every backend - the same rule S3 applies (HTTP 416).
	Open(ctx context.Context, loc ObjectLocator, opts ReadOptions) (*Object, error)
	// Stat returns object metadata. A missing object is ErrNotFound.
	Stat(ctx context.Context, loc ObjectLocator) (ObjectInfo, error)
	// Delete removes the object the locator names. A missing object is a nil
	// result (idempotent), because the cleanup reconciler re-runs deletes.
	// On a versioned bucket Version is required - see ObjectLocator.Version.
	// A real failure (timeout, permission, hold) returns the error so the
	// worker keeps the job and retries; Delete never pretends bytes are gone.
	Delete(ctx context.Context, loc ObjectLocator) error
	// SignRead mints a presigned GET URL. An adapter without the capability
	// (local) returns ErrCapabilityUnsupported instead of an empty URL that
	// looks like success (spec §3).
	SignRead(ctx context.Context, loc ObjectLocator, opts SignOptions) (SignedURL, error)
	// SignWrite mints a presigned PUT URL for the locator's key (provider
	// flows: a files row is registered first, the client then uploads
	// directly). opts.Disposition is ignored - writes carry no
	// response-disposition. An adapter without the capability returns
	// ErrCapabilityUnsupported, never a fake URL.
	SignWrite(ctx context.Context, loc ObjectLocator, opts SignOptions) (SignedURL, error)
	// Probe is the readiness dependency check: cheap, bounded by the caller's
	// ctx, and never an upload or a delete (spec §3.3.5).
	Probe(ctx context.Context) error
}

// Startup and call-time error codes of the object contract. They are
// sentinels: errors.Is distinguishes "object absent" from "storage broken"
// without parsing text, and the text itself never contains a credential,
// token or signed URL (spec §3.3.1).
var (
	// ErrNotFound: the object (or the named version of it) does not exist.
	// Timeout and permission failures are NOT this - spec §9.4.
	ErrNotFound = errors.New("storage_object_not_found")
	// ErrLocatorInvalid: the locator is empty, names another backend or
	// bucket, or holds a key that escapes the backend's root.
	ErrLocatorInvalid = errors.New("storage_locator_invalid")
	// ErrCapabilityUnsupported: the adapter lacks a capability the call needs
	// (SignRead on local, an unversioned Delete on a versioned bucket).
	ErrCapabilityUnsupported = errors.New("storage_capability_unsupported")
	// ErrSizeMismatch: the stream did not deliver the declared
	// WriteInfo.SizeBytes; nothing was stored.
	ErrSizeMismatch = errors.New("storage_size_mismatch")
	// ErrBucketUnsupported: preflight found a bucket mode the adapter cannot
	// serve safely (default object-lock retention, undeletable hold) - the
	// configured destination is refused before the first upload (spec §3.3.2).
	ErrBucketUnsupported = errors.New("storage_bucket_unsupported")
	// ErrRangeNotSatisfiable: the requested window starts at or past the end
	// of the object (HTTP 416). Both adapters answer the same sentinel so a
	// proxy can emit one status without backend branches.
	ErrRangeNotSatisfiable = errors.New("storage_range_not_satisfiable")
)

// ValidObjectKey exposes the key-shape rule the write path enforces so
// tooling that classifies stored locators (files-backfill) can hold a key
// the adapters would refuse instead of discovering it at Stat time.
func ValidObjectKey(key string) bool { return validObjectKey(key) }

// validObjectKey refuses the key shapes no object may have. Object keys are
// server-generated (FileService mints them), so rejecting is a bug barrier,
// not a user error: empty keys, absolute or volume-qualified paths, traversal
// that could escape a filesystem root, NUL, and the suffixes the local
// backend reserves for its own files (the .meta.json sidecar and the
// .<name>.tmp staging file - a stored key ending in one would alias an
// adapter implementation detail).
func validObjectKey(key string) bool {
	if key == "" {
		return false
	}
	for _, r := range key {
		if r == 0 {
			return false
		}
	}
	if isInternalLocalPath(key) {
		return false
	}
	// A leading separator or a volume name would let the key climb out of the
	// root on the filesystem backend; neither appears in a generated key.
	if key[0] == '/' || key[0] == '\\' {
		return false
	}
	// Clean and compare the way the filesystem will read it: a key that only
	// reaches its target through ".." is a traversal attempt even when the
	// cleaned form still lands inside the root (a/../b). Reject any ".."
	// segment outright - generated keys never contain one. A ":" inside a
	// segment is refused too: it is a drive/ADS qualifier on Windows and
	// never part of a minted key. Empty segments (a//b, trailing/) are
	// rejected as well: FieldsFunc would hide them, so this splits raw.
	for _, seg := range splitKey(key) {
		if seg == ".." || seg == "." || seg == "" {
			return false
		}
		if strings.ContainsRune(seg, ':') {
			return false
		}
		// A trailing dot or space silently aliases another key on Windows
		// ("victim." opens "victim"), so generated keys may not end a segment
		// with either.
		if strings.HasSuffix(seg, ".") || strings.HasSuffix(seg, " ") {
			return false
		}
	}
	return true
}

// splitKey splits on both separators - keeping empty segments - so a Windows
// path separator cannot hide a traversal segment and a double separator or
// trailing slash surfaces as the empty segment it is.
func splitKey(key string) []string {
	return strings.Split(strings.ReplaceAll(key, "\\", "/"), "/")
}
