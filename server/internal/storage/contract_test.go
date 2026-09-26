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
)

// The object-store contract suite (spec §3, lane brief: "one contract suite
// run on local AND MinIO"). runObjectStoreContract is the single suite; each
// backend leg supplies a live adapter through contractStore, so the same
// checks prove both the filesystem and the real MinIO implementation. The
// suite only exercises what the contract promises - a backend without a
// capability is asked for the honest refusal instead.
//
// Subtests share one uploaded object: Put runs first, every read leg uses it,
// and the delete leg runs last so nothing reads a removed object.

// contractStore builds the adapter under test. locFor maps a bare object key
// to the locator that addresses it on this backend (bucket filled in).
type contractStore struct {
	store  ObjectStore
	locFor func(key string) ObjectLocator
}

func runObjectStoreContract(t *testing.T, cs contractStore) {
	t.Helper()
	ctx := context.Background()
	store := cs.store

	key := fmt.Sprintf("contract/%d-%s/object.bin", os.Getpid(), time.Now().UTC().Format("20060102T150405.000000000"))
	loc := cs.locFor(key)
	body := []byte("0123456789 contract body - enough bytes for a range window")
	// deleteLoc gains the version id Put returns on a versioned bucket; the
	// row's persisted object_version is what a delete must name there.
	deleteLoc := loc

	// Clean the probe object even when a check fails midway.
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = store.Delete(cleanupCtx, deleteLoc)
	})

	t.Run("Put", func(t *testing.T) {
		res, err := store.Put(ctx, loc, bytes.NewReader(body), WriteInfo{
			ContentType: "application/octet-stream",
			SizeBytes:   int64(len(body)),
			Filename:    "object.bin",
		})
		if err != nil {
			t.Fatalf("Put: %v", err)
		}
		if res.SizeBytes != int64(len(body)) {
			t.Fatalf("Put SizeBytes = %d, want %d", res.SizeBytes, len(body))
		}
		if store.Capabilities().VersionedObjects && res.VersionID == "" {
			t.Fatal("Put on a versioned bucket returned no VersionID - the row could never name the bytes to delete")
		}
		if res.VersionID != "" {
			deleteLoc.Version = res.VersionID
		}
	})

	t.Run("Stat", func(t *testing.T) {
		info, err := store.Stat(ctx, loc)
		if err != nil {
			t.Fatalf("Stat: %v", err)
		}
		if info.SizeBytes != int64(len(body)) {
			t.Fatalf("Stat SizeBytes = %d, want %d", info.SizeBytes, len(body))
		}
	})

	t.Run("Open", func(t *testing.T) {
		obj, err := store.Open(ctx, loc, ReadOptions{})
		if err != nil {
			t.Fatalf("Open: %v", err)
		}
		got, readErr := io.ReadAll(obj.Body)
		closeErr := obj.Body.Close()
		if readErr != nil {
			t.Fatalf("read body: %v", readErr)
		}
		if closeErr != nil {
			t.Fatalf("close body: %v", closeErr)
		}
		if !bytes.Equal(got, body) {
			t.Fatalf("Open body = %q, want %q", got, body)
		}
		if obj.Info.SizeBytes != int64(len(body)) {
			t.Fatalf("Open SizeBytes = %d, want %d", obj.Info.SizeBytes, len(body))
		}
	})

	t.Run("RangeRead", func(t *testing.T) {
		if !store.Capabilities().Range {
			t.Skip("adapter does not claim ranged reads")
		}
		obj, err := store.Open(ctx, loc, ReadOptions{Offset: 10, Length: 8})
		if err != nil {
			t.Fatalf("Open range: %v", err)
		}
		got, readErr := io.ReadAll(obj.Body)
		_ = obj.Body.Close()
		if readErr != nil {
			t.Fatalf("read range: %v", readErr)
		}
		want := body[10:18]
		if !bytes.Equal(got, want) {
			t.Fatalf("range body = %q, want %q", got, want)
		}
		if obj.Info.RangeStart != 10 || obj.Info.RangeEnd != 17 {
			t.Fatalf("Range window = %d-%d, want 10-17", obj.Info.RangeStart, obj.Info.RangeEnd)
		}
		if obj.Info.SizeBytes != int64(len(body)) {
			t.Fatalf("ranged Open SizeBytes = %d, want the whole object's %d", obj.Info.SizeBytes, len(body))
		}
	})

	t.Run("NotFound", func(t *testing.T) {
		missing := cs.locFor("contract/never-written.bin")
		if _, err := store.Stat(ctx, missing); !errors.Is(err, ErrNotFound) {
			t.Fatalf("Stat missing = %v, want ErrNotFound", err)
		}
		if _, err := store.Open(ctx, missing, ReadOptions{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("Open missing = %v, want ErrNotFound", err)
		}
	})

	t.Run("InvalidLocator", func(t *testing.T) {
		badBackend := loc
		badBackend.Storage = Backend("__never__")
		if _, err := store.Stat(ctx, badBackend); !errors.Is(err, ErrLocatorInvalid) {
			t.Fatalf("Stat wrong backend = %v, want ErrLocatorInvalid", err)
		}
		traversal := loc
		traversal.Key = "../escape.bin"
		if _, err := store.Stat(ctx, traversal); !errors.Is(err, ErrLocatorInvalid) {
			t.Fatalf("Stat traversal key = %v, want ErrLocatorInvalid", err)
		}
		if _, err := store.Put(ctx, traversal, strings.NewReader("x"), WriteInfo{SizeBytes: 1}); !errors.Is(err, ErrLocatorInvalid) {
			t.Fatalf("Put traversal key = %v, want ErrLocatorInvalid", err)
		}
	})

	t.Run("CanceledPutLeavesNothing", func(t *testing.T) {
		canceled, cancel := context.WithCancel(context.Background())
		cancel()
		canceledLoc := cs.locFor("contract/canceled.bin")
		_, err := store.Put(canceled, canceledLoc, strings.NewReader("never committed"), WriteInfo{SizeBytes: 15})
		if err == nil {
			t.Fatal("Put with canceled context succeeded")
		}
		if _, err := store.Stat(ctx, canceledLoc); !errors.Is(err, ErrNotFound) {
			t.Fatalf("Stat canceled Put = %v, want ErrNotFound (nothing partial stored)", err)
		}
	})

	t.Run("SignRead", func(t *testing.T) {
		signed, err := store.SignRead(ctx, loc, SignOptions{TTL: time.Minute})
		if !store.Capabilities().Presign {
			if !errors.Is(err, ErrCapabilityUnsupported) {
				t.Fatalf("SignRead on a non-presign adapter = %v, want ErrCapabilityUnsupported", err)
			}
			return
		}
		if err != nil {
			t.Fatalf("SignRead: %v", err)
		}
		if signed.URL == "" || signed.Method != "GET" {
			t.Fatalf("SignRead = %+v, want a GET URL", signed)
		}
		// The URL must actually fetch the bytes - a URL that only parses is
		// not a working presign (the local leg never reaches here).
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, signed.URL, nil)
		if reqErr != nil {
			t.Fatalf("build signed request: %v", reqErr)
		}
		resp, respErr := http.DefaultClient.Do(req)
		if respErr != nil {
			t.Fatalf("GET signed URL: %v", respErr)
		}
		got, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			t.Fatalf("read signed body: %v", readErr)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("signed GET status = %d, want 200", resp.StatusCode)
		}
		if !bytes.Equal(got, body) {
			t.Fatalf("signed GET body = %q, want %q", got, body)
		}
	})

	// Delete runs last: every read leg above uses the object it removes.
	t.Run("Delete", func(t *testing.T) {
		if err := store.Delete(ctx, deleteLoc); err != nil {
			t.Fatalf("Delete: %v", err)
		}
		if _, err := store.Stat(ctx, loc); !errors.Is(err, ErrNotFound) {
			t.Fatalf("Stat after Delete = %v, want ErrNotFound", err)
		}
		// Delete is idempotent: the reconciler re-runs it.
		if err := store.Delete(ctx, deleteLoc); err != nil {
			t.Fatalf("second Delete = %v, want nil", err)
		}
	})

	t.Run("Probe", func(t *testing.T) {
		if err := store.Probe(ctx); err != nil {
			t.Fatalf("Probe: %v", err)
		}
	})
}

// TestObjectStoreContractLocal runs the suite on the filesystem adapter built
// through the real factory (preflight included).
func TestObjectStoreContractLocal(t *testing.T) {
	root := t.TempDir()
	cfg := Config{
		Backend: BackendLocal,
		Local:   &LocalConfig{Root: root},
	}
	store, err := (localFactory{}).New(context.Background(), cfg)
	if err != nil {
		t.Fatalf("local factory: %v", err)
	}
	runObjectStoreContract(t, contractStore{
		store: store,
		locFor: func(key string) ObjectLocator {
			return ObjectLocator{Storage: BackendLocal, Key: key}
		},
	})
}

// TestObjectStoreContractMinIO runs the same suite on a real MinIO through the
// real factory, so bounded preflight, the credential config and the locator
// contract are all exercised end to end. Gated on the MINIO_* env like the
// T2-prep integration test.
func TestObjectStoreContractMinIO(t *testing.T) {
	required := []string{
		"MINIO_ENDPOINT",
		"MINIO_BUCKET",
		"MINIO_ACCESS_KEY_ID",
		"MINIO_SECRET_ACCESS_KEY",
		"MINIO_REGION",
	}
	for _, key := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			t.Skipf("skipping MinIO contract test: %s is not set; start MinIO with `docker compose -f docker-compose.minio.yml up -d minio`", key)
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
	runObjectStoreContract(t, contractStore{
		store: store,
		locFor: func(key string) ObjectLocator {
			return ObjectLocator{Storage: BackendMinIO, Bucket: cfg.MinIO.Bucket, Key: key}
		},
	})
}
