package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// s3ObjectStore is the locator-contract view of an S3-compatible backend. It
// is a separate type from S3Storage because Go does not allow two Delete
// signatures on one struct - the legacy Storage interface keeps
// Delete(ctx, key) while this contract speaks Put/Open/Stat/Delete by
// ObjectLocator. One implementation serves both the s3 and the minio factory
// (shared SDK, independent config per spec §3.1); backend records which
// selector built it so a locator naming the other code is refused instead of
// silently read from the wrong deployment.
//
// The locator's Key is authoritative - unlike the legacy methods, this API
// does not prepend keyPrefix, because the files row stores the complete key.
// Errors never carry a credential, token or signed URL: smithy errors hold
// only the operation, status and code, and presign failures are wrapped
// before any URL exists (spec §3.3.1).
type s3ObjectStore struct {
	client *s3.Client
	// presignClient signs browser-facing URLs; it equals client unless a
	// public endpoint was configured (MINIO_PUBLIC_ENDPOINT), because the
	// signature covers the host the browser will reach.
	presignClient *s3.Client
	bucket        string
	backend       Backend
	// versioned records the bucket mode detected at preflight: on a versioned
	// bucket Put fills PutResult.VersionID and Delete must name the recorded
	// version, because an unversioned DeleteObject only plants a delete
	// marker and the bytes survive (spec §9.4).
	versioned bool
}

// Backend implements ObjectStore.
func (s *s3ObjectStore) Backend() Backend { return s.backend }

// Capabilities implements ObjectStore. VersionedObjects reflects the bucket
// mode preflight detected; the rest are fixed by the protocol.
func (s *s3ObjectStore) Capabilities() Capabilities {
	return Capabilities{Presign: true, Range: true, VersionedObjects: s.versioned}
}

// Put implements ObjectStore: streams the body with the unsigned-payload
// middleware (a request stream is not rewindable, so no SigV4 payload hash),
// verifies a declared length, and returns the object_version the files row
// must persist when the bucket is versioned. A stream that is shorter than
// declared fails the request; a longer one fails with ErrSizeMismatch after
// the fact, leaving no usable object claim.
func (s *s3ObjectStore) Put(ctx context.Context, loc ObjectLocator, body io.Reader, info WriteInfo) (PutResult, error) {
	if err := s.checkLocator(loc); err != nil {
		return PutResult{}, err
	}
	if s.backend == BackendS3 && info.SizeBytes < 0 {
		// Real AWS does not accept a chunked body, so an unknown length has
		// no safe encoding there - measure or buffer first (WriteInfo doc).
		// MinIO accepts the aws-chunked stream the SDK emits.
		return PutResult{}, fmt.Errorf("s3 PutObject: %w: AWS S3 requires a declared SizeBytes", ErrCapabilityUnsupported)
	}
	counter := &countingReader{r: ctxReader(ctx, body)}
	input := &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(loc.Key),
		Body:   counter,
	}
	if info.ContentType != "" {
		input.ContentType = aws.String(info.ContentType)
	}
	if info.SizeBytes >= 0 {
		input.ContentLength = aws.Int64(info.SizeBytes)
	}
	if info.Filename != "" || info.ContentType != "" {
		input.ContentDisposition = aws.String(ContentDisposition(info.ContentType, info.Filename))
	}
	out, err := s.client.PutObject(ctx, input, func(opts *s3.Options) {
		opts.APIOptions = append(opts.APIOptions, v4.SwapComputePayloadSHA256ForUnsignedPayloadMiddleware)
		opts.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
	})
	if err != nil {
		return PutResult{}, fmt.Errorf("s3 PutObject: %w", err)
	}
	if info.SizeBytes >= 0 && counter.n != info.SizeBytes {
		return PutResult{}, fmt.Errorf("s3 PutObject: %w: declared %d bytes, stored %d", ErrSizeMismatch, info.SizeBytes, counter.n)
	}
	res := PutResult{SizeBytes: counter.n}
	if out.VersionId != nil {
		res.VersionID = *out.VersionId
	}
	if s.versioned && res.VersionID == "" {
		// A versioned bucket that answers Put without a version id is a mode
		// the delete path cannot honor - say so instead of recording a row
		// that can never be cleaned precisely.
		return res, fmt.Errorf("s3 PutObject: %w: versioned bucket returned no version id", ErrCapabilityUnsupported)
	}
	return res, nil
}

// Open implements ObjectStore. ReadOptions.Offset/Length become an HTTP Range
// request; ObjectInfo always describes the whole object (parsed from
// Content-Range) so a proxy can answer Content-Range itself.
func (s *s3ObjectStore) Open(ctx context.Context, loc ObjectLocator, opts ReadOptions) (*Object, error) {
	if err := s.checkLocator(loc); err != nil {
		return nil, err
	}
	if opts.Offset < 0 {
		return nil, fmt.Errorf("s3 Open: %w: negative offset", ErrLocatorInvalid)
	}
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(loc.Key),
	}
	if loc.Version != "" {
		input.VersionId = aws.String(loc.Version)
	}
	if opts.Offset > 0 || opts.Length > 0 {
		input.Range = aws.String(rangeHeader(opts.Offset, opts.Length))
	}
	out, err := s.client.GetObject(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("s3 GetObject: %w", mapSDKError(err))
	}
	info := ObjectInfo{RangeStart: -1, RangeEnd: -1}
	if out.ContentLength != nil {
		info.SizeBytes = *out.ContentLength
	}
	if out.ContentType != nil {
		info.ContentType = *out.ContentType
	}
	if out.VersionId != nil {
		info.VersionID = *out.VersionId
	}
	// A ranged answer reports the window's length in ContentLength; the whole
	// object size lives in Content-Range ("bytes start-end/total").
	if out.ContentRange != nil {
		if start, end, total, ok := parseContentRange(*out.ContentRange); ok {
			info.SizeBytes = total
			info.RangeStart, info.RangeEnd = start, end
		}
	}
	return &Object{Info: info, Body: out.Body}, nil
}

// Stat implements ObjectStore.
func (s *s3ObjectStore) Stat(ctx context.Context, loc ObjectLocator) (ObjectInfo, error) {
	if err := s.checkLocator(loc); err != nil {
		return ObjectInfo{}, err
	}
	input := &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(loc.Key),
	}
	if loc.Version != "" {
		input.VersionId = aws.String(loc.Version)
	}
	out, err := s.client.HeadObject(ctx, input)
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("s3 HeadObject: %w", mapSDKError(err))
	}
	info := ObjectInfo{RangeStart: -1, RangeEnd: -1}
	if out.ContentLength != nil {
		info.SizeBytes = *out.ContentLength
	}
	if out.ContentType != nil {
		info.ContentType = *out.ContentType
	}
	if out.VersionId != nil {
		info.VersionID = *out.VersionId
	}
	return info, nil
}

// Delete implements ObjectStore. A missing object is idempotent success; on a
// versioned bucket the locator must carry the recorded object_version,
// because an unversioned DeleteObject only plants a delete marker and leaves
// the bytes billable and recoverable (spec §9.4). Any other failure returns
// to the caller so the cleanup job survives for retry.
func (s *s3ObjectStore) Delete(ctx context.Context, loc ObjectLocator) error {
	if err := s.checkLocator(loc); err != nil {
		return err
	}
	if s.versioned && loc.Version == "" {
		return fmt.Errorf("s3 DeleteObject: %w: the bucket is versioned; the locator must carry object_version", ErrCapabilityUnsupported)
	}
	input := &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(loc.Key),
	}
	if loc.Version != "" {
		input.VersionId = aws.String(loc.Version)
	}
	if _, err := s.client.DeleteObject(ctx, input); err != nil {
		// A versioned delete of a version that never existed can answer
		// NoSuchVersion/404 on some backends - still the idempotent success
		// the reconciler wants. Every other failure is real and returned.
		mapped := mapSDKError(err)
		if errors.Is(mapped, ErrNotFound) {
			return nil
		}
		return fmt.Errorf("s3 DeleteObject: %w", mapped)
	}
	return nil
}

// SignRead implements ObjectStore. A presigned URL carries its signature;
// the URL itself must never be written into a log or an error string.
func (s *s3ObjectStore) SignRead(ctx context.Context, loc ObjectLocator, opts SignOptions) (SignedURL, error) {
	if err := s.checkLocator(loc); err != nil {
		return SignedURL{}, err
	}
	if opts.TTL <= 0 {
		return SignedURL{}, fmt.Errorf("s3 SignRead: %w: ttl must be positive", ErrLocatorInvalid)
	}
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(loc.Key),
	}
	if loc.Version != "" {
		input.VersionId = aws.String(loc.Version)
	}
	if opts.Disposition != "" {
		input.ResponseContentDisposition = aws.String(opts.Disposition)
	}
	out, err := s3.NewPresignClient(s.presignClient).PresignGetObject(ctx, input, func(o *s3.PresignOptions) {
		o.Expires = opts.TTL
	})
	if err != nil {
		return SignedURL{}, fmt.Errorf("s3 SignRead: %w", err)
	}
	return SignedURL{URL: out.URL, Method: "GET", ExpiresAt: time.Now().Add(opts.TTL)}, nil
}

// SignWrite implements ObjectStore: a presigned PUT for the provider-upload
// flow (the files row is registered first, the client then uploads straight
// to storage). The signature covers the key only - content type/length are
// enforced by the caller's own checks, not by the URL.
func (s *s3ObjectStore) SignWrite(ctx context.Context, loc ObjectLocator, opts SignOptions) (SignedURL, error) {
	if err := s.checkLocator(loc); err != nil {
		return SignedURL{}, err
	}
	if opts.TTL <= 0 {
		return SignedURL{}, fmt.Errorf("s3 SignWrite: %w: ttl must be positive", ErrLocatorInvalid)
	}
	out, err := s3.NewPresignClient(s.presignClient).PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(loc.Key),
	}, func(o *s3.PresignOptions) {
		o.Expires = opts.TTL
	})
	if err != nil {
		return SignedURL{}, fmt.Errorf("s3 SignWrite: %w", err)
	}
	return SignedURL{URL: out.URL, Method: "PUT", ExpiresAt: time.Now().Add(opts.TTL)}, nil
}

// Probe implements ObjectStore: one HeadBucket, bounded by the caller's
// deadline - never an upload or a delete (spec §3.3.5).
func (s *s3ObjectStore) Probe(ctx context.Context) error {
	if _, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)}); err != nil {
		return fmt.Errorf("s3 probe: %w", err)
	}
	return nil
}

// checkLocator refuses a locator this adapter does not own before any I/O:
// the storage code must be the one that built the adapter, the bucket must be
// the configured destination (this version maps exactly one bucket per code,
// spec §3.2), and the key must satisfy the object-key rules.
func (s *s3ObjectStore) checkLocator(loc ObjectLocator) error {
	if loc.Storage != s.backend {
		return fmt.Errorf("s3 storage: %w: backend %q", ErrLocatorInvalid, string(loc.Storage))
	}
	if loc.Bucket != s.bucket {
		return fmt.Errorf("s3 storage: %w: bucket does not match the configured destination", ErrLocatorInvalid)
	}
	if !validObjectKey(loc.Key) {
		return fmt.Errorf("s3 storage: %w: key", ErrLocatorInvalid)
	}
	return nil
}

// countingReader counts bytes as they stream through, so Put can verify a
// declared length after the SDK consumed the body (S3 commits atomically, so
// a post-hoc check is safe - unlike the local rename path).
type countingReader struct {
	r io.Reader
	n int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	r.n += int64(n)
	return n, err
}

// rangeHeader formats the HTTP Range value; length <= 0 is open-ended.
func rangeHeader(offset, length int64) string {
	if length > 0 {
		return "bytes=" + strconv.FormatInt(offset, 10) + "-" + strconv.FormatInt(offset+length-1, 10)
	}
	return "bytes=" + strconv.FormatInt(offset, 10) + "-"
}

// parseContentRange parses "bytes start-end/total" ("*" for unknown total is
// treated as not parsed - a proxy that cannot name the total does not emit a
// Content-Range).
func parseContentRange(v string) (start, end, total int64, ok bool) {
	v = strings.TrimSpace(strings.TrimPrefix(v, "bytes"))
	dash := strings.IndexByte(v, '-')
	slash := strings.IndexByte(v, '/')
	if dash <= 0 || slash <= dash {
		return 0, 0, 0, false
	}
	start, err1 := strconv.ParseInt(strings.TrimSpace(v[:dash]), 10, 64)
	end, err2 := strconv.ParseInt(strings.TrimSpace(v[dash+1:slash]), 10, 64)
	totals := strings.TrimSpace(v[slash+1:])
	if totals == "*" {
		return 0, 0, 0, false
	}
	total, err3 := strconv.ParseInt(totals, 10, 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return 0, 0, 0, false
	}
	return start, end, total, true
}

// mapSDKError maps the wire answer onto the contract sentinels. Only a
// genuine not-found becomes ErrNotFound (spec §9.4: timeouts and permission
// failures are not it); everything else keeps the smithy chain intact so the
// caller still sees the status and code - a chain that never contains a
// credential or a signed URL.
func mapSDKError(err error) error {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NoSuchKey", "NoSuchVersion", "NotFound", "404":
			return errors.Join(ErrNotFound, err)
		case "InvalidRange":
			// S3/MinIO answer 416 InvalidRange when the window cannot be
			// satisfied; the local adapter raises the same sentinel for an
			// offset at or past the end, so a proxy sees one shape.
			return errors.Join(ErrRangeNotSatisfiable, err)
		}
	}
	var noKey *s3types.NoSuchKey
	if errors.As(err, &noKey) {
		return errors.Join(ErrNotFound, err)
	}
	return err
}
