package storage

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestRegistryRegisterAndGet(t *testing.T) {
	registry := NewRegistry()
	factory := stubFactory{backend: BackendMinIO}

	if err := registry.Register(factory); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if !registry.Has(BackendMinIO) {
		t.Fatal("Has(minio) = false after Register")
	}
	if registry.Has(BackendS3) {
		t.Fatal("Has(s3) = true without a factory")
	}

	got, err := registry.Get(BackendMinIO)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Backend() != BackendMinIO {
		t.Fatalf("Get returned backend %q, want minio", got.Backend())
	}

	if _, err := registry.Get(BackendS3); !errors.Is(err, ErrAdapterNotImplemented) {
		t.Fatalf("Get(missing) error = %v, want storage_adapter_not_implemented", err)
	}
}

func TestRegistryRejectsNilFactory(t *testing.T) {
	registry := NewRegistry()

	err := registry.Register(nil)
	if !errors.Is(err, ErrFactoryNil) {
		t.Fatalf("error = %v, want storage_factory_nil", err)
	}
	if registry.Has(BackendLocal) {
		t.Fatal("a rejected registration must not be stored")
	}
}

func TestRegistryRejectsTypedNilFactory(t *testing.T) {
	registry := NewRegistry()
	var typedNil *stubFactory

	err := registry.Register(typedNil)
	if !errors.Is(err, ErrFactoryNil) {
		t.Fatalf("error = %v, want storage_factory_nil", err)
	}
	if !strings.Contains(err.Error(), "typed nil") {
		t.Fatalf("error %q must say the factory is a typed nil", err)
	}
	if registry.Has(BackendLocal) {
		t.Fatal("a typed-nil registration must not be stored")
	}
}

func TestRegistryRejectsDuplicateFactory(t *testing.T) {
	registry := NewRegistry()
	first := stubFactory{backend: BackendS3}

	if err := registry.Register(first); err != nil {
		t.Fatalf("Register: %v", err)
	}
	err := registry.Register(stubFactory{backend: BackendS3})
	if !errors.Is(err, ErrFactoryDuplicate) {
		t.Fatalf("error = %v, want storage_factory_duplicate", err)
	}

	kept, getErr := registry.Get(BackendS3)
	if getErr != nil {
		t.Fatalf("Get: %v", getErr)
	}
	if kept.Backend() != first.Backend() {
		t.Fatal("the first registration must survive a rejected duplicate")
	}
}

func TestRegistryRejectsUnknownBackendCode(t *testing.T) {
	registry := NewRegistry()

	err := registry.Register(stubFactory{backend: Backend("gcs")})
	if !errors.Is(err, ErrFactoryInvalid) {
		t.Fatalf("error = %v, want storage_factory_invalid", err)
	}
	if registry.Has(Backend("gcs")) {
		t.Fatal("an unknown code must not become registered")
	}
}

func TestRegistryNilReceivers(t *testing.T) {
	var registry *Registry

	if err := registry.Register(stubFactory{backend: BackendLocal}); !errors.Is(err, ErrFactoryInvalid) {
		t.Fatalf("error = %v, want storage_factory_invalid", err)
	}
	if registry.Has(BackendLocal) {
		t.Fatal("a nil registry has no factories")
	}
	if _, err := registry.Get(BackendLocal); !errors.Is(err, ErrAdapterNotImplemented) {
		t.Fatalf("Get error = %v, want storage_adapter_not_implemented", err)
	}
}

func TestRegistryFactoriesBuildFromConfig(t *testing.T) {
	var built Backend
	registry := NewRegistry()
	if err := registry.Register(factoryFunc(func(_ context.Context, cfg Config) (Storage, error) {
		built = cfg.Backend
		return nil, nil
	})); err != nil {
		t.Fatalf("Register: %v", err)
	}

	factory, err := registry.Get(BackendMinIO)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if _, err := factory.New(context.Background(), Config{Backend: BackendMinIO}); err != nil {
		t.Fatalf("New: %v", err)
	}
	if built != BackendMinIO {
		t.Fatalf("factory saw backend %q, want minio", built)
	}
}

// factoryFunc adapts a plain function to Factory so a test can observe the
// call.
type factoryFunc func(context.Context, Config) (Storage, error)

func (f factoryFunc) Backend() Backend { return BackendMinIO }

func (f factoryFunc) New(ctx context.Context, cfg Config) (Storage, error) {
	return f(ctx, cfg)
}
