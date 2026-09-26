package storage

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

// stubStore is the minimal ObjectStore a factory test needs; it never does
// I/O.
type stubStore struct {
	backend Backend
}

func (s stubStore) Backend() Backend           { return s.backend }
func (s stubStore) Capabilities() Capabilities { return Capabilities{Range: true} }
func (s stubStore) Put(context.Context, ObjectLocator, io.Reader, WriteInfo) (PutResult, error) {
	return PutResult{}, nil
}
func (s stubStore) Open(context.Context, ObjectLocator, ReadOptions) (*Object, error) {
	return nil, nil
}
func (s stubStore) Stat(context.Context, ObjectLocator) (ObjectInfo, error) {
	return ObjectInfo{}, nil
}
func (s stubStore) Delete(context.Context, ObjectLocator) error { return nil }
func (s stubStore) SignRead(context.Context, ObjectLocator, SignOptions) (SignedURL, error) {
	return SignedURL{}, ErrCapabilityUnsupported
}
func (s stubStore) SignWrite(context.Context, ObjectLocator, SignOptions) (SignedURL, error) {
	return SignedURL{}, ErrCapabilityUnsupported
}
func (s stubStore) Probe(context.Context) error { return nil }

// codedFactory returns a factory for backend that builds the given store.
type codedFactory struct {
	backend Backend
	store   ObjectStore
	err     error
}

func (f codedFactory) Backend() Backend { return f.backend }
func (f codedFactory) New(context.Context, Config) (ObjectStore, error) {
	return f.store, f.err
}

// TestBuildStoresBuildsEveryDeclaredGroup: a config declaring two backends
// gets one adapter each - reads and deletes dispatch on the locator, so every
// declared group must exist, not only the selector's.
func TestBuildStoresBuildsEveryDeclaredGroup(t *testing.T) {
	reg := NewRegistry()
	for _, f := range []Factory{
		codedFactory{backend: BackendLocal, store: stubStore{backend: BackendLocal}},
		codedFactory{backend: BackendS3, store: stubStore{backend: BackendS3}},
	} {
		if err := reg.Register(f); err != nil {
			t.Fatalf("Register: %v", err)
		}
	}
	cfg := Config{
		Backend: BackendS3,
		Local:   &LocalConfig{Root: t.TempDir()},
		S3:      &S3Config{Bucket: "b", Region: "r"},
	}
	stores, err := BuildStores(context.Background(), cfg, reg)
	if err != nil {
		t.Fatalf("BuildStores: %v", err)
	}
	if len(stores) != 2 || stores[BackendLocal] == nil || stores[BackendS3] == nil {
		t.Fatalf("stores = %v, want one adapter per declared group", stores)
	}
}

// TestBuildStoresMissingFactoryFails: a declared group with no factory is a
// startup error, and the error names the group.
func TestBuildStoresMissingFactoryFails(t *testing.T) {
	reg := NewRegistry()
	if err := reg.Register(codedFactory{backend: BackendLocal, store: stubStore{backend: BackendLocal}}); err != nil {
		t.Fatalf("Register: %v", err)
	}
	cfg := Config{
		Backend: BackendMinIO,
		Local:   &LocalConfig{Root: t.TempDir()},
		MinIO:   &MinIOConfig{Endpoint: "e", Bucket: "b", Region: "r", AccessKeyID: "a", SecretAccessKey: "s"},
	}
	_, err := BuildStores(context.Background(), cfg, reg)
	if !errors.Is(err, ErrAdapterNotImplemented) {
		t.Fatalf("BuildStores = %v, want ErrAdapterNotImplemented", err)
	}
}

// TestBuildStoresNilStoreFails: a factory that returns a nil store (typed or
// untyped) must not produce a nil map entry.
func TestBuildStoresNilStoreFails(t *testing.T) {
	for name, store := range map[string]ObjectStore{
		"untyped nil": nil,
		"typed nil":   (*localObjectStore)(nil),
	} {
		reg := NewRegistry()
		if err := reg.Register(codedFactory{backend: BackendLocal, store: store}); err != nil {
			t.Fatalf("Register: %v", err)
		}
		cfg := Config{Backend: BackendLocal, Local: &LocalConfig{Root: t.TempDir()}}
		_, err := BuildStores(context.Background(), cfg, reg)
		if !errors.Is(err, ErrFactoryNil) {
			t.Fatalf("BuildStores with %s store = %v, want ErrFactoryNil", name, err)
		}
	}
}

// TestBuildStoresFactoryErrorPropagates: a preflight failure inside a factory
// surfaces as the startup error, tagged with its backend.
func TestBuildStoresFactoryErrorPropagates(t *testing.T) {
	boom := errors.New("preflight: bucket unreachable")
	reg := NewRegistry()
	if err := reg.Register(codedFactory{backend: BackendMinIO, err: boom}); err != nil {
		t.Fatalf("Register: %v", err)
	}
	cfg := Config{
		Backend: BackendMinIO,
		MinIO:   &MinIOConfig{Endpoint: "e", Bucket: "b", Region: "r", AccessKeyID: "a", SecretAccessKey: "s"},
	}
	_, err := BuildStores(context.Background(), cfg, reg)
	if !errors.Is(err, boom) {
		t.Fatalf("BuildStores = %v, want the factory's error", err)
	}
	if !strings.Contains(err.Error(), "minio") {
		t.Fatalf("BuildStores error %q does not name the backend", err)
	}
}

// TestNewDefaultRegistryHasEveryCode: the production registry covers every
// selector code, so LoadConfig can never pair a valid env with
// storage_adapter_not_implemented.
func TestNewDefaultRegistryHasEveryCode(t *testing.T) {
	reg := NewDefaultRegistry()
	for _, b := range knownBackends {
		if !reg.Has(b) {
			t.Fatalf("default registry has no factory for %q", string(b))
		}
	}
}
