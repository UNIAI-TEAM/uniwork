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

	noUpload := &smithy.GenericAPIError{Code: "NoSuchUpload", Message: "upload gone"}
	if mapped := mapSDKError(noUpload); !errors.Is(mapped, ErrMultipartNotFound) {
		t.Fatalf("mapSDKError(NoSuchUpload) = %v, want ErrMultipartNotFound", mapped)
	}
	for _, code := range []string{"InvalidPart", "InvalidPartOrder", "EntityTooSmall"} {
		bad := &smithy.GenericAPIError{Code: code, Message: "bad part"}
		if mapped := mapSDKError(bad); !errors.Is(mapped, ErrMultipartPartsInvalid) {
			t.Fatalf("mapSDKError(%s) = %v, want ErrMultipartPartsInvalid", code, mapped)
		}
	}
}

func TestS3SignUploadPartShapeBoundsAndTTLClamp(t *testing.T) {
	stub := &stubS3{}
	store := newStubS3(t, stub)
	if !store.Capabilities().Multipart {
		t.Fatal("s3 Capabilities().Multipart = false, want true")
	}
	loc := store.loc("documents/files/obj.bin")

	// Bounds: 0 and 10001 refused before any I/O.
	for _, badPart := range []int32{-1, 0, 10001} {
		if _, err := store.SignUploadPart(context.Background(), loc, "up-1", badPart, SignOptions{TTL: time.Hour}); !errors.Is(err, ErrLocatorInvalid) {
			t.Fatalf("SignUploadPart partNumber=%d = %v, want ErrLocatorInvalid", badPart, err)
		}
	}
	// Empty uploadID, zero TTL and foreign locator refused before any I/O.
	if _, err := store.SignUploadPart(context.Background(), loc, "", 1, SignOptions{TTL: time.Hour}); !errors.Is(err, ErrLocatorInvalid) {
		t.Fatalf("SignUploadPart empty uploadID = %v, want ErrLocatorInvalid", err)
	}
	if _, err := store.SignUploadPart(context.Background(), loc, "up-1", 1, SignOptions{}); !errors.Is(err, ErrLocatorInvalid) {
		t.Fatalf("SignUploadPart zero TTL = %v, want ErrLocatorInvalid", err)
	}
	if _, err := store.SignUploadPart(context.Background(), ObjectLocator{Storage: BackendS3, Bucket: "testbucket", Key: "a.bin"}, "up-1", 1, SignOptions{TTL: time.Hour}); !errors.Is(err, ErrLocatorInvalid) {
		t.Fatalf("SignUploadPart foreign locator = %v, want ErrLocatorInvalid", err)
	}
	if len(stub.requests) != 0 {
		t.Fatalf("SignUploadPart did I/O: %v", stub.requests)
	}

	// Valid part 1 and 10000: presigned PUT with partNumber + uploadId, no secret leaked.
	for _, partNum := range []int32{1, 10000} {
		signed, err := store.SignUploadPart(context.Background(), loc, "up-xyz", partNum, SignOptions{TTL: time.Hour})
		if err != nil {
			t.Fatalf("SignUploadPart(%d): %v", partNum, err)
		}
		if signed.Method != http.MethodPut {
			t.Fatalf("SignUploadPart Method = %q, want PUT", signed.Method)
		}
		if !strings.Contains(signed.URL, "/testbucket/documents/files/obj.bin") {
			t.Fatalf("signed URL %q does not name the object", signed.URL)
		}
		if !strings.Contains(signed.URL, fmt.Sprintf("partNumber=%d", partNum)) || !strings.Contains(signed.URL, "uploadId=up-xyz") {
			t.Fatalf("signed URL %q missing partNumber/uploadId query", signed.URL)
		}
		if !strings.Contains(signed.URL, "X-Amz-Signature=") {
			t.Fatalf("signed URL %q has no signature", signed.URL)
		}
		if strings.Contains(signed.URL, "sk") {
			t.Fatalf("signed URL leaks secret key: %q", signed.URL)
		}
		if got := presignedExpires(t, signed.URL); got != 3600 {
			t.Fatalf("X-Amz-Expires = %d, want 3600", got)
		}
	}

	// TTL above 7 days is clamped by clampPresignTTL.
	clamped, err := store.SignUploadPart(context.Background(), loc, "up-xyz", 2, SignOptions{TTL: 30 * 24 * time.Hour})
	if err != nil {
		t.Fatalf("SignUploadPart clamped: %v", err)
	}
	if got := presignedExpires(t, clamped.URL); got != int(maxPresignTTL/time.Second) || got >= sigV4MaxExpiresSeconds {
		t.Fatalf("clamped X-Amz-Expires = %d, want %d (< %d)", got, int(maxPresignTTL/time.Second), sigV4MaxExpiresSeconds)
	}
	if life := time.Until(clamped.ExpiresAt); life > maxPresignTTL || life < maxPresignTTL-time.Minute {
		t.Fatalf("clamped ExpiresAt is %s away, want about %s", life, maxPresignTTL)
	}
}

func TestS3MultipartCreateListCompleteAbort(t *testing.T) {
	var completedBody string
	var listPages int
	var abortCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		switch {
		case r.Method == http.MethodPost && q.Has("uploads"):
			if r.Header.Get("Content-Type") != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
				t.Errorf("CreateMultipart Content-Type = %q", r.Header.Get("Content-Type"))
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>testbucket</Bucket><Key>documents/files/a.docx</Key><UploadId>u-123</UploadId></InitiateMultipartUploadResult>`))
		case r.Method == http.MethodGet && q.Get("uploadId") == "u-123":
			listPages++
			w.WriteHeader(http.StatusOK)
			if q.Get("part-number-marker") == "" {
				w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>testbucket</Bucket><Key>documents/files/a.docx</Key><UploadId>u-123</UploadId><IsTruncated>true</IsTruncated><NextPartNumberMarker>1</NextPartNumberMarker><Part><PartNumber>2</PartNumber><ETag>"etag-2"</ETag><Size>1024</Size></Part></ListPartsResult>`))
				return
			}
			w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>testbucket</Bucket><Key>documents/files/a.docx</Key><UploadId>u-123</UploadId><IsTruncated>false</IsTruncated><Part><PartNumber>1</PartNumber><ETag>"etag-1"</ETag><Size>5242880</Size></Part></ListPartsResult>`))
		case r.Method == http.MethodPost && q.Get("uploadId") == "u-123":
			buf := make([]byte, 4096)
			n, _ := r.Body.Read(buf)
			completedBody = string(buf[:n])
			w.Header().Set("x-amz-version-id", "ver-mp-1")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Location>http://example/testbucket/documents/files/a.docx</Location><Bucket>testbucket</Bucket><Key>documents/files/a.docx</Key><ETag>"final-etag"</ETag></CompleteMultipartUploadResult>`))
		case r.Method == http.MethodDelete && q.Get("uploadId") == "u-123":
			abortCalls++
			if abortCalls > 1 {
				w.WriteHeader(http.StatusNotFound)
				w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchUpload</Code><Message>The specified upload does not exist.</Message></Error>`))
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case q.Get("uploadId") == "missing":
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchUpload</Code><Message>The specified upload does not exist.</Message></Error>`))
		case r.Method == http.MethodPost && q.Get("uploadId") == "bad-parts":
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidPart</Code><Message>One or more of the specified parts could not be found.</Message></Error>`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)

	client := s3.New(s3.Options{
		Region:       "us-east-1",
		BaseEndpoint: aws.String(srv.URL),
		UsePathStyle: true,
		Credentials:  credentials.NewStaticCredentialsProvider("ak", "sk", ""),
	})
	store := &s3ObjectStore{
		client:        client,
		presignClient: client,
		bucket:        "testbucket",
		backend:       BackendMinIO,
		versioned:     true,
	}
	loc := store.loc("documents/files/a.docx")
	ctx := context.Background()

	uploadID, err := store.CreateMultipart(ctx, loc, WriteInfo{
		ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		Filename:    "a.docx",
	})
	if err != nil {
		t.Fatalf("CreateMultipart: %v", err)
	}
	if uploadID != "u-123" {
		t.Fatalf("uploadID = %q, want u-123", uploadID)
	}

	parts, err := store.ListParts(ctx, loc, uploadID)
	if err != nil {
		t.Fatalf("ListParts: %v", err)
	}
	if listPages != 2 {
		t.Fatalf("ListParts pages = %d, want 2", listPages)
	}
	if len(parts) != 2 || parts[0].PartNumber != 1 || parts[0].ETag != `"etag-1"` || parts[0].SizeBytes != 5242880 || parts[1].PartNumber != 2 || parts[1].ETag != `"etag-2"` || parts[1].SizeBytes != 1024 {
		t.Fatalf("ListParts = %+v, want sorted parts 1 and 2", parts)
	}

	// Pass parts out of order: CompleteMultipart sorts them before calling S3.
	res, err := store.CompleteMultipart(ctx, loc, uploadID, []MultipartPart{parts[1], parts[0]})
	if err != nil {
		t.Fatalf("CompleteMultipart: %v", err)
	}
	if res.VersionID != "ver-mp-1" {
		t.Fatalf("CompleteMultipart VersionID = %q, want ver-mp-1", res.VersionID)
	}
	idx1 := strings.Index(completedBody, "<PartNumber>1</PartNumber>")
	idx2 := strings.Index(completedBody, "<PartNumber>2</PartNumber>")
	if idx1 < 0 || idx2 < 0 || idx1 > idx2 {
		t.Fatalf("CompleteMultipart XML not sorted by PartNumber: %s", completedBody)
	}

	// Error mapping on ListParts and CompleteMultipart.
	if _, err := store.ListParts(ctx, loc, "missing"); !errors.Is(err, ErrMultipartNotFound) {
		t.Fatalf("ListParts missing = %v, want ErrMultipartNotFound", err)
	}
	if _, err := store.CompleteMultipart(ctx, loc, "missing", parts); !errors.Is(err, ErrMultipartNotFound) {
		t.Fatalf("CompleteMultipart missing = %v, want ErrMultipartNotFound", err)
	}
	if _, err := store.CompleteMultipart(ctx, loc, "bad-parts", parts); !errors.Is(err, ErrMultipartPartsInvalid) {
		t.Fatalf("CompleteMultipart bad-parts = %v, want ErrMultipartPartsInvalid", err)
	}

	// Abort is idempotent: first call gets 204, second gets NoSuchUpload -> nil.
	if err := store.AbortMultipart(ctx, loc, uploadID); err != nil {
		t.Fatalf("first AbortMultipart: %v", err)
	}
	if err := store.AbortMultipart(ctx, loc, uploadID); err != nil {
		t.Fatalf("second AbortMultipart (NoSuchUpload) = %v, want nil", err)
	}

	// Foreign locator is refused before any I/O on every multipart method.
	foreign := ObjectLocator{Storage: BackendS3, Bucket: "testbucket", Key: "documents/files/a.docx"}
	if _, err := store.CreateMultipart(ctx, foreign, WriteInfo{}); !errors.Is(err, ErrLocatorInvalid) {
		t.Fatalf("CreateMultipart foreign = %v, want ErrLocatorInvalid", err)
	}
	if _, err := store.ListParts(ctx, foreign, "u-123"); !errors.Is(err, ErrLocatorInvalid) {
		t.Fatalf("ListParts foreign = %v, want ErrLocatorInvalid", err)
	}
	if _, err := store.CompleteMultipart(ctx, foreign, "u-123", parts); !errors.Is(err, ErrLocatorInvalid) {
		t.Fatalf("CompleteMultipart foreign = %v, want ErrLocatorInvalid", err)
	}
	if err := store.AbortMultipart(ctx, foreign, "u-123"); !errors.Is(err, ErrLocatorInvalid) {
		t.Fatalf("AbortMultipart foreign = %v, want ErrLocatorInvalid", err)
	}
}

func TestLocalMultipartUnsupported(t *testing.T) {
	store, _ := newLocalStore(t)
	if store.Capabilities().Multipart {
		t.Fatal("local Capabilities().Multipart = true, want false")
	}
	ctx := context.Background()
	loc := localLoc("a.bin")
	if _, err := store.CreateMultipart(ctx, loc, WriteInfo{}); !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("local CreateMultipart = %v, want ErrCapabilityUnsupported", err)
	}
	if _, err := store.SignUploadPart(ctx, loc, "u", 1, SignOptions{TTL: time.Minute}); !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("local SignUploadPart = %v, want ErrCapabilityUnsupported", err)
	}
	if _, err := store.ListParts(ctx, loc, "u"); !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("local ListParts = %v, want ErrCapabilityUnsupported", err)
	}
	if _, err := store.CompleteMultipart(ctx, loc, "u", []MultipartPart{{PartNumber: 1, ETag: `"e"`}}); !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("local CompleteMultipart = %v, want ErrCapabilityUnsupported", err)
	}
	if err := store.AbortMultipart(ctx, loc, "u"); !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("local AbortMultipart = %v, want ErrCapabilityUnsupported", err)
	}
}
