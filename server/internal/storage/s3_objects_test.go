package storage

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

// stubS3 is a minimal S3 wire stub: it answers HeadBucket, the
// versioning/object-lock queries preflight issues, HeadObject, DeleteObject
// and PutObject for one bucket. handler hooks let a test shape a single
// answer (e.g. a 404 HeadObject) without a real backend.
type stubS3 struct {
	srv *httptest.Server
	// versioning/objectLockXML shape the preflight answers; nil means the
	// stub's defaults (unversioned, no object lock).
	versioningStatus string
	objectLockXML    string
	// headStatus is the status HeadObject answers (default 404 NotFound).
	headStatus int
	// putBody is the XML PutObject answers; a non-empty versionID in
	// putVersionID is echoed as x-amz-version-id.
	putVersionID string
	requests     []string
}

func newStubS3(t *testing.T, s *stubS3) *s3ObjectStore {
	t.Helper()
	if s.headStatus == 0 {
		s.headStatus = http.StatusNotFound
	}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.requests = append(s.requests, r.Method+" "+r.URL.RequestURI())
		q := r.URL.Query()
		switch {
		case q.Has("versioning"):
			status := s.versioningStatus
			if status == "" {
				status = "Disabled"
			}
			if status == "Disabled" {
				// Real S3 answers an empty VersioningConfiguration document.
				w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>`))
				return
			}
			fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>%s</Status></VersioningConfiguration>`, status)
		case q.Has("object-lock"):
			if s.objectLockXML == "" {
				w.WriteHeader(http.StatusNotFound)
				w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchObjectLockConfiguration</Code></Error>`))
				return
			}
			w.Write([]byte(s.objectLockXML))
		case r.Method == http.MethodHead && strings.Count(strings.Trim(r.URL.Path, "/"), "/") == 0:
			// HEAD /{bucket}
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodHead:
			w.WriteHeader(s.headStatus)
		case r.Method == http.MethodPut:
			if s.putVersionID != "" {
				w.Header().Set("x-amz-version-id", s.putVersionID)
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><PutObjectResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><ETag>"etag"</ETag></PutObjectResult>`))
		case r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(s.srv.Close)

	client := s3.New(s3.Options{
		Region:       "us-east-1",
		BaseEndpoint: aws.String(s.srv.URL),
		UsePathStyle: true,
		Credentials:  credentials.NewStaticCredentialsProvider("ak", "sk", ""),
	})
	return &s3ObjectStore{
		client:        client,
		presignClient: client,
		bucket:        "testbucket",
		backend:       BackendMinIO,
	}
}

func (s *s3ObjectStore) loc(key string) ObjectLocator {
	return ObjectLocator{Storage: s.backend, Bucket: s.bucket, Key: key}
}

func TestS3CheckLocator(t *testing.T) {
	stub := &stubS3{}
	store := newStubS3(t, stub)

	good := store.loc("a/b.bin")
	if err := store.checkLocator(good); err != nil {
		t.Fatalf("checkLocator good = %v", err)
	}
	for _, loc := range []ObjectLocator{
		{Storage: BackendLocal, Key: "a.bin"},
		{Storage: BackendS3, Bucket: "testbucket", Key: "a.bin"}, // the minio adapter refuses an s3 locator
		{Storage: BackendMinIO, Bucket: "other", Key: "a.bin"},
		{Storage: BackendMinIO, Bucket: "testbucket", Key: "../x"},
		{Storage: BackendMinIO, Bucket: "testbucket", Key: ""},
	} {
		if err := store.checkLocator(loc); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("checkLocator %+v = %v, want ErrLocatorInvalid", loc, err)
		}
	}
}

func TestS3PreflightHealthy(t *testing.T) {
	stub := &stubS3{}
	store := newStubS3(t, stub)
	if err := store.preflight(context.Background()); err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if store.versioned {
		t.Fatal("versioned = true on an unversioned bucket")
	}
}

func TestS3PreflightDetectsVersioning(t *testing.T) {
	for _, tc := range []struct {
		status    string
		versioned bool
	}{
		{"Enabled", true},
		{"Suspended", true},
		{"Disabled", false},
	} {
		t.Run(tc.status, func(t *testing.T) {
			stub := &stubS3{versioningStatus: tc.status}
			store := newStubS3(t, stub)
			if err := store.preflight(context.Background()); err != nil {
				t.Fatalf("preflight: %v", err)
			}
			if store.versioned != tc.versioned {
				t.Fatalf("versioned = %v, want %v for Status=%s", store.versioned, tc.versioned, tc.status)
			}
		})
	}
}

func TestS3PreflightRejectsDefaultRetention(t *testing.T) {
	stub := &stubS3{objectLockXML: `<?xml version="1.0" encoding="UTF-8"?><ObjectLockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>GOVERNANCE</Mode><Days>30</Days></DefaultRetention></Rule></ObjectLockConfiguration>`}
	store := newStubS3(t, stub)
	err := store.preflight(context.Background())
	if !errors.Is(err, ErrBucketUnsupported) {
		t.Fatalf("preflight with default retention = %v, want ErrBucketUnsupported", err)
	}
}

func TestS3PreflightAllowsObjectLockWithoutDefaultRule(t *testing.T) {
	stub := &stubS3{objectLockXML: `<?xml version="1.0" encoding="UTF-8"?><ObjectLockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>`}
	store := newStubS3(t, stub)
	if err := store.preflight(context.Background()); err != nil {
		t.Fatalf("preflight: %v", err)
	}
}

func TestS3PreflightBoundedOnUnreachableEndpoint(t *testing.T) {
	// A listener that accepts and never answers exercises the deadline path.
	// The deadline (preflightTimeout) is the bound; this test asserts the
	// parent ctx deadline works instead - preflight honors ctx cancellation.
	store := &s3ObjectStore{
		client: s3.New(s3.Options{
			Region:       "us-east-1",
			BaseEndpoint: aws.String("http://127.0.0.1:1"), // nothing listens
			UsePathStyle: true,
			Credentials:  credentials.NewStaticCredentialsProvider("ak", "sk", ""),
		}),
		bucket:  "b",
		backend: BackendMinIO,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	start := time.Now()
	err := store.preflight(ctx)
	if err == nil {
		t.Fatal("preflight to a dead endpoint succeeded")
	}
	if time.Since(start) > 5*time.Second {
		t.Fatalf("preflight exceeded the caller deadline: %v", time.Since(start))
	}
}

func TestS3StatMapsNotFound(t *testing.T) {
	stub := &stubS3{headStatus: http.StatusNotFound}
	store := newStubS3(t, stub)
	_, err := store.Stat(context.Background(), store.loc("missing.bin"))
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("Stat on a 404 = %v, want ErrNotFound", err)
	}
}

func TestS3StatForbiddenIsNotNotFound(t *testing.T) {
	stub := &stubS3{headStatus: http.StatusForbidden}
	store := newStubS3(t, stub)
	_, err := store.Stat(context.Background(), store.loc("denied.bin"))
	if err == nil {
		t.Fatal("Stat on a 403 succeeded")
	}
	if errors.Is(err, ErrNotFound) {
		t.Fatalf("Stat on a 403 mapped to ErrNotFound: %v", err)
	}
}

func TestS3PutVersionedBucketWithoutVersionIDFails(t *testing.T) {
	// A store that believes the bucket is versioned but the wire answer has
	// no version id cannot hand the row a delete-able locator.
	stub := &stubS3{} // Put answers without x-amz-version-id
	store := newStubS3(t, stub)
	store.versioned = true
	_, err := store.Put(context.Background(), store.loc("a.bin"), strings.NewReader("body"), WriteInfo{SizeBytes: 4})
	if !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("Put = %v, want ErrCapabilityUnsupported", err)
	}
}

func TestS3PutReturnsVersionID(t *testing.T) {
	stub := &stubS3{putVersionID: "v-123"}
	store := newStubS3(t, stub)
	store.versioned = true
	res, err := store.Put(context.Background(), store.loc("a.bin"), strings.NewReader("body"), WriteInfo{SizeBytes: 4})
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if res.VersionID != "v-123" {
		t.Fatalf("VersionID = %q, want v-123", res.VersionID)
	}
}

func TestS3VersionedDeleteRequiresVersion(t *testing.T) {
	stub := &stubS3{}
	store := newStubS3(t, stub)
	store.versioned = true
	if err := store.Delete(context.Background(), store.loc("a.bin")); !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("unversioned Delete on a versioned bucket = %v, want ErrCapabilityUnsupported", err)
	}
	// With the version the request is built - the stub answers 204.
	loc := store.loc("a.bin")
	loc.Version = "v-1"
	if err := store.Delete(context.Background(), loc); err != nil {
		t.Fatalf("versioned Delete: %v", err)
	}
	// The wire call must carry the version id.
	var sawVersion bool
	for _, req := range stub.requests {
		if strings.HasPrefix(req, "DELETE") && strings.Contains(req, "versionId=v-1") {
			sawVersion = true
		}
	}
	if !sawVersion {
		t.Fatalf("no DELETE carried versionId=v-1: %v", stub.requests)
	}
}

func TestS3SignReadMintsURL(t *testing.T) {
	stub := &stubS3{}
	store := newStubS3(t, stub)
	signed, err := store.SignRead(context.Background(), store.loc("a/b.bin"), SignOptions{TTL: 5 * time.Minute})
	if err != nil {
		t.Fatalf("SignRead: %v", err)
	}
	if !strings.Contains(signed.URL, "/testbucket/a/b.bin") {
		t.Fatalf("signed URL %q does not name the object", signed.URL)
	}
	if !strings.Contains(signed.URL, "X-Amz-Signature=") {
		t.Fatalf("signed URL %q has no signature", signed.URL)
	}
	// The URL carries the signature and the credential scope (access key is
	// public by SigV4 design), never the secret itself.
	if strings.Contains(signed.URL, "sk") {
		t.Fatalf("signed URL leaks the secret key: %q", signed.URL)
	}
	if signed.Method != "GET" || signed.ExpiresAt.Before(time.Now()) {
		t.Fatalf("signed = %+v, want GET with a future expiry", signed)
	}
	// Zero TTL is refused.
	if _, err := store.SignRead(context.Background(), store.loc("a.bin"), SignOptions{}); err == nil {
		t.Fatal("SignRead with zero TTL succeeded")
	}
}

func TestS3SignWriteMintsPUT(t *testing.T) {
	stub := &stubS3{}
	store := newStubS3(t, stub)
	signed, err := store.SignWrite(context.Background(), store.loc("provider/in.bin"), SignOptions{TTL: 5 * time.Minute})
	if err != nil {
		t.Fatalf("SignWrite: %v", err)
	}
	if signed.Method != "PUT" {
		t.Fatalf("SignWrite Method = %q, want PUT", signed.Method)
	}
	if !strings.Contains(signed.URL, "/testbucket/provider/in.bin") {
		t.Fatalf("signed URL %q does not name the object", signed.URL)
	}
	if !strings.Contains(signed.URL, "X-Amz-Signature=") {
		t.Fatalf("signed URL %q has no signature", signed.URL)
	}
	if strings.Contains(signed.URL, "sk") {
		t.Fatalf("signed URL leaks the secret key: %q", signed.URL)
	}
	if _, err := store.SignWrite(context.Background(), store.loc("a.bin"), SignOptions{}); err == nil {
		t.Fatal("SignWrite with zero TTL succeeded")
	}
	// A locator for another backend is refused before a URL is minted.
	if _, err := store.SignWrite(context.Background(), ObjectLocator{Storage: BackendS3, Bucket: "testbucket", Key: "a.bin"}, SignOptions{TTL: time.Minute}); !errors.Is(err, ErrLocatorInvalid) {
		t.Fatalf("SignWrite foreign locator = %v, want ErrLocatorInvalid", err)
	}
}

func TestS3SignReadPublicEndpointHost(t *testing.T) {
	stub := &stubS3{}
	store := newStubS3(t, stub)
	// A public endpoint client signs URLs for the browser-facing host.
	public := s3.New(s3.Options{
		Region:       "us-east-1",
		BaseEndpoint: aws.String("https://files.example.com"),
		UsePathStyle: true,
		Credentials:  credentials.NewStaticCredentialsProvider("ak", "sk", ""),
	})
	store.presignClient = public
	signed, err := store.SignRead(context.Background(), store.loc("a.bin"), SignOptions{TTL: time.Minute})
	if err != nil {
		t.Fatalf("SignRead: %v", err)
	}
	if !strings.HasPrefix(signed.URL, "https://files.example.com/testbucket/a.bin") {
		t.Fatalf("public-endpoint URL = %q", signed.URL)
	}
}

func TestS3CanceledPut(t *testing.T) {
	stub := &stubS3{}
	store := newStubS3(t, stub)
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := store.Put(canceled, store.loc("a.bin"), strings.NewReader("x"), WriteInfo{SizeBytes: 1}); err == nil {
		t.Fatal("Put on canceled ctx succeeded")
	}
}

func TestRangeHeaderAndParseContentRange(t *testing.T) {
	if got := rangeHeader(10, 8); got != "bytes=10-17" {
		t.Fatalf("rangeHeader(10,8) = %q", got)
	}
	if got := rangeHeader(10, 0); got != "bytes=10-" {
		t.Fatalf("rangeHeader(10,0) = %q", got)
	}
	start, end, total, ok := parseContentRange("bytes 10-17/56")
	if !ok || start != 10 || end != 17 || total != 56 {
		t.Fatalf("parseContentRange = %d,%d,%d,%v", start, end, total, ok)
	}
	if _, _, _, ok := parseContentRange("bytes */56"); ok {
		t.Fatal("parseContentRange accepted an unbounded range")
	}
	if _, _, _, ok := parseContentRange("bytes 10-17/*"); ok {
		t.Fatal("parseContentRange accepted an unknown total")
	}
	if _, _, _, ok := parseContentRange("garbage"); ok {
		t.Fatal("parseContentRange accepted garbage")
	}
}

func TestMapSDKError(t *testing.T) {
	notFound := &smithyhttp.ResponseError{
		Response: &smithyhttp.Response{Response: &http.Response{StatusCode: 404}},
		Err:      &smithy.GenericAPIError{Code: "NotFound", Message: "nope"},
	}
	if mapped := mapSDKError(notFound); !errors.Is(mapped, ErrNotFound) {
		t.Fatalf("mapSDKError(404) = %v, want ErrNotFound", mapped)
	}
	noKey := &smithy.GenericAPIError{Code: "NoSuchKey", Message: "nope"}
	if mapped := mapSDKError(noKey); !errors.Is(mapped, ErrNotFound) {
		t.Fatalf("mapSDKError(NoSuchKey) = %v, want ErrNotFound", mapped)
	}
	denied := &smithyhttp.ResponseError{
		Response: &smithyhttp.Response{Response: &http.Response{StatusCode: 403}},
		Err:      &smithy.GenericAPIError{Code: "AccessDenied", Message: "nope"},
	}
	mapped := mapSDKError(denied)
	if errors.Is(mapped, ErrNotFound) {
		t.Fatal("mapSDKError(403) mapped to ErrNotFound")
	}
	// The original chain survives - the caller can still read the code.
	var apiErr smithy.APIError
	if !errors.As(mapped, &apiErr) || apiErr.ErrorCode() != "AccessDenied" {
		t.Fatalf("mapSDKError lost the original chain: %v", mapped)
	}
}
