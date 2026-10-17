package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

// TestMinIOBackendIntegration proves the typed MinIO configuration against a
// real MinIO service: the loader reads MINIO_* (and never the AWS credential
// chain), and the values it produces are enough to Put, Head, Get and Delete
// an object in the configured bucket.
//
// It is gated on the MINIO_* variables so a machine without MinIO skips it
// cleanly. `docker compose -f docker-compose.minio.yml up -d minio` followed
// by the minio-init service is the local setup; CI runs the same image as a
// job service and creates the test bucket through MINIO_DEFAULT_BUCKETS.
func TestMinIOBackendIntegration(t *testing.T) {
	required := []string{
		"MINIO_ENDPOINT",
		"MINIO_BUCKET",
		"MINIO_ACCESS_KEY_ID",
		"MINIO_SECRET_ACCESS_KEY",
		"MINIO_REGION",
	}
	for _, key := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			t.Skipf("skipping MinIO integration test: %s is not set; start MinIO with `docker compose -f docker-compose.minio.yml up -d minio`", key)
		}
	}

	// The test owns the groups it does not exercise, so an ambient
	// LOCAL_UPLOAD_DIR or S3_BUCKET cannot change what is loaded.
	t.Setenv("LOCAL_UPLOAD_DIR", "")
	t.Setenv("S3_BUCKET", "")
	// MinIO must not read these. A fallback would be caught by the access-key
	// assertion below and by the Put itself.
	t.Setenv("AWS_ACCESS_KEY_ID", "aws-chain-must-not-be-used")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "aws-chain-must-not-be-used")

	// Hide STORAGE_BACKEND so the run also covers the documented default:
	// absent selector -> minio.
	env := func(key string) (string, bool) {
		if key == "STORAGE_BACKEND" {
			return "", false
		}
		return os.LookupEnv(key)
	}

	cfg, err := LoadConfig(registryFor(t, BackendMinIO), env)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Backend != BackendMinIO {
		t.Fatalf("Backend = %q, want minio for an absent STORAGE_BACKEND", cfg.Backend)
	}
	if cfg.MinIO.AccessKeyID != os.Getenv("MINIO_ACCESS_KEY_ID") {
		t.Fatal("MinIO access key must come from MINIO_ACCESS_KEY_ID, not from the AWS credential chain")
	}
	if cfg.MinIO.Bucket != os.Getenv("MINIO_BUCKET") {
		t.Fatalf("Bucket = %q, want %q", cfg.MinIO.Bucket, os.Getenv("MINIO_BUCKET"))
	}
	t.Logf("MinIO integration target: endpoint %s bucket %s region %s", cfg.MinIO.Endpoint, cfg.MinIO.Bucket, cfg.MinIO.Region)

	client := s3.New(s3.Options{
		Region:       cfg.MinIO.Region,
		BaseEndpoint: aws.String(cfg.MinIO.Endpoint),
		// MinIO is reached path-style; virtual-host style needs wildcard DNS.
		UsePathStyle: true,
		Credentials:  credentials.NewStaticCredentialsProvider(cfg.MinIO.AccessKeyID, cfg.MinIO.SecretAccessKey, ""),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	key := fmt.Sprintf("t2-prep/%d-%s/probe.txt", os.Getpid(), time.Now().UTC().Format("20060102T150405.000000000"))
	body := []byte("t2-prep MinIO integration probe")
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		_, _ = client.DeleteObject(cleanupCtx, &s3.DeleteObjectInput{Bucket: aws.String(cfg.MinIO.Bucket), Key: aws.String(key)})
	})

	if _, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(cfg.MinIO.Bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(body),
		ContentType: aws.String("text/plain"),
	}); err != nil {
		t.Fatalf("PutObject: %v", err)
	}

	head, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(cfg.MinIO.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		t.Fatalf("HeadObject: %v", err)
	}
	if head.ContentLength == nil || *head.ContentLength != int64(len(body)) {
		t.Fatalf("HeadObject ContentLength = %v, want %d", head.ContentLength, len(body))
	}

	object, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(cfg.MinIO.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	got, readErr := io.ReadAll(object.Body)
	closeErr := object.Body.Close()
	if readErr != nil {
		t.Fatalf("read object body: %v", readErr)
	}
	if closeErr != nil {
		t.Fatalf("close object body: %v", closeErr)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("GetObject body = %q, want %q", got, body)
	}

	if _, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(cfg.MinIO.Bucket),
		Key:    aws.String(key),
	}); err != nil {
		t.Fatalf("DeleteObject: %v", err)
	}
	// The post-delete head must prove the object is gone, not merely that the
	// request failed: a transient 5xx would also error, so the assertion is
	// pinned to the not-found answer (reviewer note R2 of t2-prep).
	_, headErr := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(cfg.MinIO.Bucket),
		Key:    aws.String(key),
	})
	if headErr == nil {
		t.Fatal("HeadObject after DeleteObject succeeded, the object is still there")
	}
	if errors.Is(headErr, context.DeadlineExceeded) {
		t.Fatalf("HeadObject after delete did not answer before the deadline: %v", headErr)
	}
	var apiErr smithy.APIError
	if !errors.As(headErr, &apiErr) || apiErr.ErrorCode() != "NotFound" && apiErr.ErrorCode() != "404" {
		t.Fatalf("HeadObject after delete: error = %v, want a not-found answer", headErr)
	}
}

// TestMinIOMultipartIntegration exercises CreateMultipart, presigned
// UploadPart, ListParts, CompleteMultipart, Stat, Open and AbortMultipart
// against a real MinIO service.
func TestMinIOMultipartIntegration(t *testing.T) {
	required := []string{
		"MINIO_ENDPOINT",
		"MINIO_BUCKET",
		"MINIO_ACCESS_KEY_ID",
		"MINIO_SECRET_ACCESS_KEY",
		"MINIO_REGION",
	}
	for _, key := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			t.Skipf("skipping MinIO multipart integration test: %s is not set; start MinIO with `docker compose -f docker-compose.minio.yml up -d minio`", key)
		}
	}

	t.Setenv("LOCAL_UPLOAD_DIR", "")
	t.Setenv("S3_BUCKET", "")
	env := func(key string) (string, bool) {
		if key == "STORAGE_BACKEND" {
			return "", false
		}
		return os.LookupEnv(key)
	}
	cfg, err := LoadConfig(registryFor(t, BackendMinIO), env)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	store, err := (minioFactory{}).New(ctx, cfg)
	if err != nil {
		t.Fatalf("minio factory: %v", err)
	}
	if !store.Capabilities().Multipart {
		t.Fatal("minio store Capabilities().Multipart = false, want true")
	}

	stamp := fmt.Sprintf("multipart/%d-%s", os.Getpid(), time.Now().UTC().Format("20060102T150405.000000000"))
	loc := ObjectLocator{Storage: BackendMinIO, Bucket: cfg.MinIO.Bucket, Key: stamp + "/assembled.bin"}
	abortLoc := ObjectLocator{Storage: BackendMinIO, Bucket: cfg.MinIO.Bucket, Key: stamp + "/aborted.bin"}

	uploadID, err := store.CreateMultipart(ctx, loc, WriteInfo{
		ContentType: "application/octet-stream",
		Filename:    "assembled.bin",
	})
	if err != nil {
		t.Fatalf("CreateMultipart: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		_ = store.AbortMultipart(cleanupCtx, loc, uploadID)
		_ = store.Delete(cleanupCtx, loc)
	})

	// First part 5 MiB (S3 minimum non-final part size), second part smaller.
	part1 := bytes.Repeat([]byte("A1B2C3D4"), (5*1024*1024)/8)
	part2 := []byte("trailing second part payload")
	full := append(append([]byte(nil), part1...), part2...)

	putPart := func(partNum int32, payload []byte) string {
		t.Helper()
		signed, err := store.SignUploadPart(ctx, loc, uploadID, partNum, SignOptions{TTL: 15 * time.Minute})
		if err != nil {
			t.Fatalf("SignUploadPart(%d): %v", partNum, err)
		}
		req, err := http.NewRequestWithContext(ctx, signed.Method, signed.URL, bytes.NewReader(payload))
		if err != nil {
			t.Fatalf("NewRequest part %d: %v", partNum, err)
		}
		req.ContentLength = int64(len(payload))
		for k, v := range signed.Headers {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("PUT part %d: %v", partNum, err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("PUT part %d status = %d, want 200", partNum, resp.StatusCode)
		}
		etag := resp.Header.Get("ETag")
		if etag == "" {
			t.Fatalf("PUT part %d returned empty ETag", partNum)
		}
		return etag
	}

	etag1 := putPart(1, part1)
	etag2 := putPart(2, part2)

	parts, err := store.ListParts(ctx, loc, uploadID)
	if err != nil {
		t.Fatalf("ListParts: %v", err)
	}
	if len(parts) != 2 {
		t.Fatalf("ListParts len = %d, want 2 (%+v)", len(parts), parts)
	}
	if parts[0].PartNumber != 1 || parts[0].ETag != etag1 || parts[0].SizeBytes != int64(len(part1)) {
		t.Fatalf("part[0] = %+v, want PartNumber=1 ETag=%s SizeBytes=%d", parts[0], etag1, len(part1))
	}
	if parts[1].PartNumber != 2 || parts[1].ETag != etag2 || parts[1].SizeBytes != int64(len(part2)) {
		t.Fatalf("part[1] = %+v, want PartNumber=2 ETag=%s SizeBytes=%d", parts[1], etag2, len(part2))
	}

	if _, err := store.CompleteMultipart(ctx, loc, uploadID, parts); err != nil {
		t.Fatalf("CompleteMultipart: %v", err)
	}

	info, err := store.Stat(ctx, loc)
	if err != nil {
		t.Fatalf("Stat assembled object: %v", err)
	}
	if info.SizeBytes != int64(len(full)) {
		t.Fatalf("Stat SizeBytes = %d, want %d", info.SizeBytes, len(full))
	}

	obj, err := store.Open(ctx, loc, ReadOptions{})
	if err != nil {
		t.Fatalf("Open assembled object: %v", err)
	}
	got, readErr := io.ReadAll(obj.Body)
	_ = obj.Body.Close()
	if readErr != nil {
		t.Fatalf("read assembled object: %v", readErr)
	}
	if !bytes.Equal(got, full) {
		t.Fatalf("assembled object bytes mismatch (got %d bytes, want %d)", len(got), len(full))
	}

	// Second upload: Abort, then ListParts gives ErrMultipartNotFound, and a
	// second Abort gives nil.
	abortID, err := store.CreateMultipart(ctx, abortLoc, WriteInfo{ContentType: "application/octet-stream"})
	if err != nil {
		t.Fatalf("CreateMultipart abort upload: %v", err)
	}
	if err := store.AbortMultipart(ctx, abortLoc, abortID); err != nil {
		t.Fatalf("first AbortMultipart: %v", err)
	}
	if _, err := store.ListParts(ctx, abortLoc, abortID); !errors.Is(err, ErrMultipartNotFound) {
		t.Fatalf("ListParts after AbortMultipart = %v, want ErrMultipartNotFound", err)
	}
	if err := store.AbortMultipart(ctx, abortLoc, abortID); err != nil {
		t.Fatalf("second AbortMultipart = %v, want nil", err)
	}
}
